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

    // Configuration
    private readonly symbol: string;
    private readonly pricePrecision: number;
    private readonly zoneTicks: number;

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

        this.config = {
            maxActiveZones: config.maxActiveZones ?? 3,
            zoneTimeoutMs: config.zoneTimeoutMs ?? 3600000, // 1 hour
            minZoneVolume: config.minZoneVolume ?? 100,
            maxZoneWidth: config.maxZoneWidth ?? 0.01, // 1%
            minZoneStrength: config.minZoneStrength ?? 0.5,
            completionThreshold: config.completionThreshold ?? 0.8,
            strengthChangeThreshold: config.strengthChangeThreshold ?? 0.15,
            minCandidateDuration: config.minCandidateDuration ?? 180000,
            maxPriceDeviation: config.maxPriceDeviation ?? 0.005,
            minTradeCount: config.minTradeCount ?? 10,
            minBuyRatio: config.minBuyRatio ?? 0.65,
        };

        this.zoneManager = new ZoneManager(
            this.config,
            logger,
            metricsCollector
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
            this.candidates.set(priceLevel, {
                priceLevel,
                startTime: trade.timestamp,
                trades: [],
                buyVolume: 0,
                sellVolume: 0,
                totalVolume: 0,
                averageOrderSize: 0,
                lastUpdate: trade.timestamp,
                consecutiveBuyTrades: 0,
                priceStability: 1.0,
            });
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

            // Must show accumulation pattern (more buying than selling)
            const buyRatio = candidate.buyVolume / candidate.totalVolume;
            if (buyRatio < (this.config.minBuyRatio ?? 0)) continue;

            // Must have price stability
            if (candidate.priceStability < 0.8) continue;

            // Calculate candidate score
            const score = this.scoreCandidateForZone(candidate);

            if (score > bestScore && score > 0.6) {
                // Minimum score threshold
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

        return zone;
    }

    /**
     * Score candidate for zone formation potential
     */
    private scoreCandidateForZone(candidate: AccumulationCandidate): number {
        const buyRatio = candidate.buyVolume / candidate.totalVolume;
        const duration = Date.now() - candidate.startTime;
        const volumeScore = Math.min(candidate.totalVolume / 500, 1.0); // Normalize to 500
        const durationScore = Math.min(duration / 600000, 1.0); // Normalize to 10 minutes
        const orderSizeScore = Math.min(candidate.averageOrderSize / 50, 1.0); // Normalize to 50

        // Weighted score
        return (
            buyRatio * 0.35 + // 35% weight on buy dominance
            candidate.priceStability * 0.25 + // 25% weight on price stability
            volumeScore * 0.2 + // 20% weight on volume
            durationScore * 0.15 + // 15% weight on duration
            orderSizeScore * 0.05 // 5% weight on order size
        );
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
        const prices = candidate.trades.map((t) => t.price);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
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
