// src/indicators/accumulationZoneDetector.ts

import { EventEmitter } from "events";
import {
    AccumulationZone,
    ZoneUpdate,
    ZoneSignal,
    ZoneDetectionData,
    ZoneAnalysisResult,
    ZoneDetectorConfig,
} from "../types/zoneTypes.js";
import type { EnrichedTradeEvent } from "../types/marketEvents.js";
import { Logger } from "../infrastructure/logger.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import { ZoneManager } from "../trading/zoneManager.js";
import { DetectorUtils } from "./base/detectorUtils.js";
import { RollingWindow } from "../utils/rollingWindow.js";
import { ObjectPool, SharedPools } from "../utils/objectPool.js";
import {
    EnhancedZoneFormation,
    type InstitutionalSignals,
    type MarketRegime,
} from "./enhancedZoneFormation.js";

interface AccumulationCandidate {
    priceLevel: number;
    startTime: number;
    trades: EnrichedTradeEvent[];
    buyVolume: number;
    sellVolume: number;
    totalVolume: number;
    averageOrderSize: number;
    lastUpdate: number;
    consecutiveBuyTrades: number;
    priceStability: number;
}

/**
 * Zone-based AccumulationDetector - detects accumulation zones rather than point events
 * Tracks evolving accumulation zones over time and emits zone-based signals
 */
export class AccumulationZoneDetector extends EventEmitter {
    private readonly config: ZoneDetectorConfig;
    private readonly zoneManager: ZoneManager;

    // Candidate tracking for zone formation
    private candidates = new Map<number, AccumulationCandidate>();
    private readonly recentTrades = new RollingWindow<EnrichedTradeEvent>(
        200,
        false
    );

    // Object pool for candidates to reduce GC pressure
    private readonly candidatePool = new ObjectPool<AccumulationCandidate>(
        () => ({
            priceLevel: 0,
            startTime: 0,
            trades: [],
            buyVolume: 0,
            sellVolume: 0,
            totalVolume: 0,
            averageOrderSize: 0,
            lastUpdate: 0,
            consecutiveBuyTrades: 0,
            priceStability: 1.0,
        }),
        (candidate) => {
            candidate.priceLevel = 0;
            candidate.startTime = 0;
            candidate.trades.length = 0;
            candidate.buyVolume = 0;
            candidate.sellVolume = 0;
            candidate.totalVolume = 0;
            candidate.averageOrderSize = 0;
            candidate.lastUpdate = 0;
            candidate.consecutiveBuyTrades = 0;
            candidate.priceStability = 1.0;
        }
    );

    // Configuration
    private readonly symbol: string;
    private readonly pricePrecision: number;
    private readonly zoneTicks: number;

    // Enhanced zone formation analyzer
    private readonly enhancedZoneFormation: EnhancedZoneFormation;

    // Detection parameters are now provided via config

    constructor(
        symbol: string,
        config: Partial<ZoneDetectorConfig>,
        logger: Logger,
        metricsCollector: MetricsCollector
    ) {
        super();

        this.symbol = symbol;
        this.pricePrecision = 2; // Should come from config
        this.zoneTicks = 2; // Price levels that define a zone

        // Enhanced institutional-grade thresholds (75-85% buy dominance)
        this.config = {
            maxActiveZones: config.maxActiveZones ?? 3,
            zoneTimeoutMs: config.zoneTimeoutMs ?? 3600000, // 1 hour
            minZoneVolume: config.minZoneVolume ?? 200, // Increased from 100
            maxZoneWidth: config.maxZoneWidth ?? 0.008, // Tighter from 1%
            minZoneStrength: config.minZoneStrength ?? 0.7, // Increased from 0.5
            completionThreshold: config.completionThreshold ?? 0.85, // Increased from 0.8
            strengthChangeThreshold: config.strengthChangeThreshold ?? 0.12, // More sensitive
            minCandidateDuration: config.minCandidateDuration ?? 300000, // 5 minutes minimum
            maxPriceDeviation: config.maxPriceDeviation ?? 0.003, // Tighter price stability
            minTradeCount: config.minTradeCount ?? 15, // More trades required
            minBuyRatio: config.minBuyRatio ?? 0.75, // Institutional threshold: 75% minimum
        };

        this.zoneManager = new ZoneManager(
            this.config,
            logger,
            metricsCollector
        );

        // Initialize enhanced zone formation analyzer
        this.enhancedZoneFormation = new EnhancedZoneFormation(
            50, // Institutional size threshold
            15, // Iceberg detection window
            0.4 // Min institutional ratio
        );

        // Forward zone manager events
        this.zoneManager.on("zoneCreated", (zone) =>
            this.emit("zoneCreated", zone)
        );
        this.zoneManager.on("zoneUpdated", (update) =>
            this.emit("zoneUpdated", update)
        );
        this.zoneManager.on("zoneCompleted", (zone) =>
            this.emit("zoneCompleted", zone)
        );
        this.zoneManager.on("zoneInvalidated", (update) =>
            this.emit("zoneInvalidated", update)
        );

        logger.info("AccumulationZoneDetector initialized", {
            component: "AccumulationZoneDetector",
            symbol,
            config: this.config,
        });

        // Cleanup old candidates periodically
        setInterval(() => this.cleanupOldCandidates(), 300000); // Every 5 minutes
    }

    /**
     * Main analysis method - processes trade and returns zone updates/signals
     */
    public analyze(trade: EnrichedTradeEvent): ZoneAnalysisResult {
        const updates: ZoneUpdate[] = [];
        const signals: ZoneSignal[] = [];

        // Add trade to recent trades history
        this.recentTrades.push(trade);

        // 1. Update existing zones with new trade
        const activeZones = this.zoneManager.getActiveZones(this.symbol);
        for (const zone of activeZones) {
            const update = this.zoneManager.updateZone(zone.id, trade);
            if (update) {
                updates.push(update);

                // Generate signals based on zone updates
                const zoneSignals = this.generateZoneSignals(update);
                signals.push(...zoneSignals);
            }
        }

        // 2. Update accumulation candidates
        this.updateCandidates(trade);

        // 3. Check for new zone formation
        const newZone = this.checkForZoneFormation(trade);
        if (newZone) {
            const createUpdate: ZoneUpdate = {
                updateType: "zone_created",
                zone: newZone,
                significance: "medium",
                timestamp: trade.timestamp,
            };
            updates.push(createUpdate);

            // Generate initial zone entry signal
            const entrySignal = this.generateZoneEntrySignal(newZone);
            if (entrySignal) signals.push(entrySignal);
        }

        // 4. Check for zone invalidation (price breaks out of zone bounds)
        const invalidations = this.checkZoneInvalidations(trade, activeZones);
        updates.push(...invalidations);

        return {
            updates,
            signals,
            activeZones: this.zoneManager.getActiveZones(this.symbol),
        };
    }

    /**
     * Update accumulation candidates with new trade
     */
    private updateCandidates(trade: EnrichedTradeEvent): void {
        const priceLevel = this.getPriceLevel(trade.price);
        const isBuyTrade = !trade.buyerIsMaker; // Market buy (aggressive buy)

        // Get or create candidate for this price level
        if (!this.candidates.has(priceLevel)) {
            const candidate = this.candidatePool.acquire();
            candidate.priceLevel = priceLevel;
            candidate.startTime = trade.timestamp;
            candidate.lastUpdate = trade.timestamp;
            this.candidates.set(priceLevel, candidate);
        }

        const candidate = this.candidates.get(priceLevel)!;

        // Update candidate with new trade
        candidate.trades.push(trade);
        candidate.totalVolume += trade.quantity;
        candidate.lastUpdate = trade.timestamp;
        candidate.averageOrderSize =
            candidate.totalVolume / candidate.trades.length;

        if (isBuyTrade) {
            candidate.buyVolume += trade.quantity;
            candidate.consecutiveBuyTrades++;
        } else {
            candidate.sellVolume += trade.quantity;
            candidate.consecutiveBuyTrades = 0; // Reset consecutive buy counter
        }

        // Update price stability
        candidate.priceStability = this.calculatePriceStability(candidate);

        // Limit candidate trade history to prevent memory bloat
        if (candidate.trades.length > 100) {
            const removedTrade = candidate.trades.shift()!;
            candidate.totalVolume -= removedTrade.quantity;
            if (!removedTrade.buyerIsMaker) {
                candidate.buyVolume -= removedTrade.quantity;
            } else {
                candidate.sellVolume -= removedTrade.quantity;
            }
        }
    }

    /**
     * Check if any candidates are ready to form accumulation zones
     */
    private checkForZoneFormation(
        trade: EnrichedTradeEvent
    ): AccumulationZone | null {
        const now = trade.timestamp;

        // Find the best accumulation candidate
        let bestCandidate: AccumulationCandidate | null = null;
        let bestScore = 0;

        for (const candidate of this.candidates.values()) {
            const duration = now - candidate.startTime;

            // Must meet minimum duration requirement
            if (duration < this.config.minCandidateDuration) continue;

            // Must have minimum volume and trade count
            if (candidate.totalVolume < this.config.minZoneVolume) continue;
            if (candidate.trades.length < this.config.minTradeCount) continue;

            // Must show strong institutional accumulation pattern (75%+ buying)
            const buyRatio = candidate.buyVolume / candidate.totalVolume;
            if (buyRatio < (this.config.minBuyRatio ?? 0)) continue;

            // Must have institutional-grade price stability
            if (candidate.priceStability < 0.85) continue;

            // Analyze institutional signals for enhanced validation
            const institutionalSignals =
                this.enhancedZoneFormation.analyzeInstitutionalSignals(
                    candidate.trades
                );

            // Require minimum institutional activity
            const institutionalScore =
                this.calculateInstitutionalScore(institutionalSignals);
            if (institutionalScore < 0.4) continue; // Institutional threshold

            // Calculate enhanced candidate score with institutional factors
            const score = this.scoreEnhancedCandidateForZone(
                candidate,
                institutionalSignals
            );

            if (score > bestScore && score > 0.75) {
                // Enhanced institutional threshold
                bestScore = score;
                bestCandidate = candidate;
            }
        }

        if (!bestCandidate) return null;

        // Create zone from best candidate
        const zoneDetection = this.createZoneDetectionData(bestCandidate);
        const zone = this.zoneManager.createZone(
            "accumulation",
            this.symbol,
            trade,
            zoneDetection
        );

        // Remove candidate as it's now a zone
        this.candidates.delete(bestCandidate.priceLevel);
        this.candidatePool.release(bestCandidate);

        return zone;
    }

    /**
     * Enhanced scoring with institutional factors
     */
    private scoreEnhancedCandidateForZone(
        candidate: AccumulationCandidate,
        institutionalSignals: InstitutionalSignals
    ): number {
        const buyRatio = candidate.buyVolume / candidate.totalVolume;
        const duration = Date.now() - candidate.startTime;

        // Determine market regime for adaptive scoring
        const marketRegime = this.analyzeMarketRegime(candidate.trades);

        // Use enhanced zone formation scoring
        const enhancedResult =
            this.enhancedZoneFormation.calculateEnhancedScore(
                buyRatio,
                1 - buyRatio, // sellRatio
                candidate.priceStability,
                candidate.totalVolume,
                duration,
                candidate.averageOrderSize,
                institutionalSignals,
                marketRegime
            );

        return enhancedResult.score;
    }

    /**
     * Legacy scoring for backwards compatibility (now enhanced)
     */
    private scoreCandidateForZone(candidate: AccumulationCandidate): number {
        const institutionalSignals =
            this.enhancedZoneFormation.analyzeInstitutionalSignals(
                candidate.trades
            );
        return this.scoreEnhancedCandidateForZone(
            candidate,
            institutionalSignals
        );
    }

    /**
     * Calculate institutional activity score
     */
    private calculateInstitutionalScore(signals: InstitutionalSignals): number {
        return (
            signals.largeBlockRatio * 0.3 +
            signals.icebergDetection * 0.25 +
            signals.volumeConsistency * 0.2 +
            signals.priceEfficiency * 0.15 +
            signals.orderSizeDistribution * 0.1
        );
    }

    /**
     * Analyze market regime from candidate trades
     */
    private analyzeMarketRegime(trades: EnrichedTradeEvent[]): MarketRegime {
        if (trades.length < 5) {
            return {
                volatilityLevel: "medium",
                volumeLevel: "medium",
                trendStrength: 0.5,
                marketPhase: "accumulation",
            };
        }

        const prices = trades.map((t) => t.price);
        return this.enhancedZoneFormation.analyzeMarketRegime(trades, prices);
    }

    /**
     * Calculate price stability within candidate
     */
    private calculatePriceStability(candidate: AccumulationCandidate): number {
        if (candidate.trades.length < 2) return 1.0;

        const prices = candidate.trades.map((t) => t.price);
        const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
        if (avgPrice === 0) return 0;
        const maxDeviation = Math.max(
            ...prices.map((p) => Math.abs(p - avgPrice) / avgPrice)
        );

        return Math.max(0, 1 - maxDeviation / this.config.maxPriceDeviation);
    }

    /**
     * Create zone detection data from candidate
     */
    private createZoneDetectionData(
        candidate: AccumulationCandidate
    ): ZoneDetectionData {
        // Use array pool to reduce allocations
        const arrayPool = SharedPools.getInstance().arrays;
        const prices: number[] = arrayPool.acquire(
            candidate.trades.length
        ) as number[];

        for (let i = 0; i < candidate.trades.length; i++) {
            prices[i] = candidate.trades[i].price;
        }

        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);

        // Return array to pool
        arrayPool.release(prices);
        const centerPrice = (minPrice + maxPrice) / 2;

        const buyRatio = candidate.buyVolume / candidate.totalVolume;
        const orderSizeProfile =
            candidate.averageOrderSize > 50
                ? "institutional"
                : candidate.averageOrderSize > 20
                  ? "mixed"
                  : "retail";

        return {
            priceRange: {
                min: minPrice,
                max: maxPrice,
                center: centerPrice,
            },
            totalVolume: candidate.totalVolume,
            averageOrderSize: candidate.averageOrderSize,
            initialStrength: this.scoreCandidateForZone(candidate),
            confidence: Math.min(buyRatio * 1.5, 1.0), // Higher confidence for strong buy dominance
            supportingFactors: {
                volumeConcentration: Math.min(candidate.totalVolume / 300, 1.0),
                orderSizeProfile,
                timeConsistency: Math.min(
                    (Date.now() - candidate.startTime) / 600000,
                    1.0
                ),
                priceStability: candidate.priceStability,
                flowConsistency: buyRatio,
            },
        };
    }

    /**
     * Generate signals based on zone updates
     */
    private generateZoneSignals(update: ZoneUpdate): ZoneSignal[] {
        const signals: ZoneSignal[] = [];
        const zone = update.zone;

        switch (update.updateType) {
            case "zone_strengthened":
                if (
                    zone.strength > 0.7 &&
                    (update.changeMetrics?.strengthChange ?? 0) >
                        this.config.strengthChangeThreshold
                ) {
                    signals.push({
                        signalType: "zone_strength_change",
                        zone,
                        actionType: "add_to_zone",
                        confidence: zone.confidence,
                        urgency: "medium",
                        timeframe: "short_term",
                        expectedDirection: "up", // Accumulation suggests upward movement
                        zoneStrength: zone.strength,
                        completionLevel: zone.completion,
                        invalidationLevel: zone.priceRange.min * 0.995, // 0.5% below zone
                        breakoutTarget: zone.priceRange.center * 1.02, // 2% above center
                        positionSizing:
                            zone.significance === "institutional"
                                ? "heavy"
                                : zone.significance === "major"
                                  ? "normal"
                                  : "light",
                        stopLossLevel: zone.priceRange.min * 0.99, // 1% below zone
                        takeProfitLevel: zone.priceRange.center * 1.03, // 3% profit target
                    });
                }
                break;

            case "zone_completed":
                signals.push({
                    signalType: "zone_completion",
                    zone,
                    actionType: "prepare_for_breakout",
                    confidence: Math.min(zone.confidence * 1.2, 1.0), // Boost confidence for completion
                    urgency: "high",
                    timeframe: "immediate",
                    expectedDirection: "up",
                    zoneStrength: zone.strength,
                    completionLevel: zone.completion,
                    invalidationLevel: zone.priceRange.min * 0.99,
                    breakoutTarget: zone.priceRange.center * 1.05, // Higher target on completion
                    positionSizing: "normal", // Standard sizing for breakout
                    stopLossLevel: zone.priceRange.min * 0.985,
                    takeProfitLevel: zone.priceRange.center * 1.05,
                });
                break;

            case "zone_weakened":
                if (zone.strength < 0.4) {
                    signals.push({
                        signalType: "zone_invalidation",
                        zone,
                        actionType: "exit_zone",
                        confidence: 0.8,
                        urgency: "high",
                        timeframe: "immediate",
                        expectedDirection: "neutral",
                        zoneStrength: zone.strength,
                        completionLevel: zone.completion,
                        invalidationLevel: zone.priceRange.min,
                        positionSizing: "light",
                        stopLossLevel: zone.priceRange.min * 0.995,
                    });
                }
                break;
        }

        return signals;
    }

    /**
     * Generate zone entry signal when zone is created
     */
    private generateZoneEntrySignal(zone: AccumulationZone): ZoneSignal | null {
        if (zone.strength < this.config.minZoneStrength) return null;

        return {
            signalType: "zone_entry",
            zone,
            actionType: "enter_zone",
            confidence: zone.confidence,
            urgency: zone.significance === "institutional" ? "high" : "medium",
            timeframe: "short_term",
            expectedDirection: "up",
            zoneStrength: zone.strength,
            completionLevel: zone.completion,
            invalidationLevel: zone.priceRange.min * 0.995,
            breakoutTarget: zone.priceRange.center * 1.025,
            positionSizing:
                zone.significance === "institutional"
                    ? "heavy"
                    : zone.significance === "major"
                      ? "normal"
                      : "light",
            stopLossLevel: zone.priceRange.min * 0.99,
            takeProfitLevel: zone.priceRange.center * 1.03,
        };
    }

    /**
     * Check for zone invalidations (price breaks zone boundaries)
     */
    private checkZoneInvalidations(
        trade: EnrichedTradeEvent,
        activeZones: AccumulationZone[]
    ): ZoneUpdate[] {
        const invalidations: ZoneUpdate[] = [];

        for (const zone of activeZones) {
            // Check if price breaks significantly below zone (invalidation)
            const invalidationPrice = zone.priceRange.min * 0.995; // 0.5% below zone

            if (trade.price < invalidationPrice) {
                const update = this.zoneManager.invalidateZone(
                    zone.id,
                    "price_breakdown"
                );
                if (update) invalidations.push(update);
            }
        }

        return invalidations;
    }

    /**
     * Convert price to discrete level for candidate tracking
     * Uses standardized zone calculation for consistency
     */
    private getPriceLevel(price: number): number {
        return DetectorUtils.calculateZone(
            price,
            this.zoneTicks,
            this.pricePrecision
        );
    }

    /**
     * Cleanup old candidates that haven't formed zones
     */
    private cleanupOldCandidates(): void {
        const now = Date.now();
        const maxAge = 1800000; // 30 minutes max candidate age

        for (const [priceLevel, candidate] of this.candidates) {
            if (now - candidate.startTime > maxAge) {
                this.candidates.delete(priceLevel);
                this.candidatePool.release(candidate);
            }
        }
    }

    // Public query methods
    public getActiveZones(): AccumulationZone[] {
        return this.zoneManager.getActiveZones(this.symbol);
    }

    public getZoneNearPrice(
        price: number,
        tolerance: number = 0.01
    ): AccumulationZone[] {
        return this.zoneManager.getZonesNearPrice(
            this.symbol,
            price,
            tolerance
        );
    }

    public getZoneStatistics() {
        return this.zoneManager.getZoneStatistics();
    }

    public getCandidateCount(): number {
        return this.candidates.size;
    }

    public getCandidates(): AccumulationCandidate[] {
        return Array.from(this.candidates.values());
    }
}
