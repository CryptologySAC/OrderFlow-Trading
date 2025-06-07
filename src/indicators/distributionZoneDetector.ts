// src/indicators/distributionZoneDetector.ts

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
import { RollingWindow } from "../utils/rollingWindow.js";

interface DistributionCandidate {
    priceLevel: number;
    startTime: number;
    trades: EnrichedTradeEvent[];
    buyVolume: number;
    sellVolume: number;
    totalVolume: number;
    averageOrderSize: number;
    lastUpdate: number;
    consecutiveSellTrades: number;
    priceStability: number;
    volumeDistribution: number; // How distributed the selling is
}

/**
 * Zone-based DistributionDetector - detects distribution zones rather than point events
 * Tracks evolving distribution zones over time and emits zone-based signals
 */
export class DistributionZoneDetector extends EventEmitter {
    private readonly config: ZoneDetectorConfig;
    private readonly zoneManager: ZoneManager;

    // Candidate tracking for zone formation
    private candidates = new Map<number, DistributionCandidate>();
    private readonly recentTrades = new RollingWindow<EnrichedTradeEvent>(
        200,
        false
    );

    // Configuration
    private readonly symbol: string;
    private readonly pricePrecision: number;
    private readonly zoneTicks: number;

    // Detection parameters
    private readonly minCandidateDuration = 120000; // 2 minutes (distribution is faster than accumulation)
    private readonly minZoneVolume = 150;
    private readonly minSellRatio = 0.68; // 68% sell volume for distribution
    private readonly maxPriceDeviation = 0.008; // 0.8% max price movement in zone
    private readonly minTradeCount = 8;

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
            zoneTimeoutMs: config.zoneTimeoutMs ?? 1800000, // 30 minutes (shorter than accumulation)
            minZoneVolume: config.minZoneVolume ?? 150,
            maxZoneWidth: config.maxZoneWidth ?? 0.012, // 1.2% (slightly wider than accumulation)
            minZoneStrength: config.minZoneStrength ?? 0.45,
            completionThreshold: config.completionThreshold ?? 0.75, // Lower threshold for distribution
            strengthChangeThreshold: config.strengthChangeThreshold ?? 0.12,
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

        logger.info("DistributionZoneDetector initialized", {
            component: "DistributionZoneDetector",
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
        const activeZones = this.zoneManager
            .getActiveZones(this.symbol)
            .filter((z) => z.type === "distribution");
        for (const zone of activeZones) {
            const update = this.zoneManager.updateZone(zone.id, trade);
            if (update) {
                updates.push(update);

                // Generate signals based on zone updates
                const zoneSignals = this.generateZoneSignals(update);
                signals.push(...zoneSignals);
            }
        }

        // 2. Update distribution candidates
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
     * Update distribution candidates with new trade
     */
    private updateCandidates(trade: EnrichedTradeEvent): void {
        const priceLevel = this.getPriceLevel(trade.price);
        const isSellTrade = trade.buyerIsMaker; // Market sell (aggressive sell)

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
                consecutiveSellTrades: 0,
                priceStability: 1.0,
                volumeDistribution: 0,
            });
        }

        const candidate = this.candidates.get(priceLevel)!;

        // Update candidate with new trade
        candidate.trades.push(trade);
        candidate.totalVolume += trade.quantity;
        candidate.lastUpdate = trade.timestamp;
        candidate.averageOrderSize =
            candidate.totalVolume / candidate.trades.length;

        if (isSellTrade) {
            candidate.sellVolume += trade.quantity;
            candidate.consecutiveSellTrades++;
        } else {
            candidate.buyVolume += trade.quantity;
            candidate.consecutiveSellTrades = 0; // Reset consecutive sell counter
        }

        // Update price stability and volume distribution
        candidate.priceStability = this.calculatePriceStability(candidate);
        candidate.volumeDistribution =
            this.calculateVolumeDistribution(candidate);

        // Limit candidate trade history to prevent memory bloat
        if (candidate.trades.length > 100) {
            const removedTrade = candidate.trades.shift()!;
            candidate.totalVolume -= removedTrade.quantity;
            if (removedTrade.buyerIsMaker) {
                candidate.sellVolume -= removedTrade.quantity;
            } else {
                candidate.buyVolume -= removedTrade.quantity;
            }
        }
    }

    /**
     * Check if any candidates are ready to form distribution zones
     */
    private checkForZoneFormation(
        trade: EnrichedTradeEvent
    ): AccumulationZone | null {
        const now = trade.timestamp;

        // Find the best distribution candidate
        let bestCandidate: DistributionCandidate | null = null;
        let bestScore = 0;

        for (const candidate of this.candidates.values()) {
            const duration = now - candidate.startTime;

            // Must meet minimum duration requirement
            if (duration < this.minCandidateDuration) continue;

            // Must have minimum volume and trade count
            if (candidate.totalVolume < this.minZoneVolume) continue;
            if (candidate.trades.length < this.minTradeCount) continue;

            // Must show distribution pattern (more selling than buying)
            const sellRatio = candidate.sellVolume / candidate.totalVolume;
            if (sellRatio < this.minSellRatio) continue;

            // Must have price stability
            if (candidate.priceStability < 0.75) continue; // Slightly lower than accumulation

            // Calculate candidate score
            const score = this.scoreCandidateForZone(candidate);

            if (score > bestScore && score > 0.55) {
                // Slightly lower threshold than accumulation
                bestScore = score;
                bestCandidate = candidate;
            }
        }

        if (!bestCandidate) return null;

        // Create zone from best candidate
        const zoneDetection = this.createZoneDetectionData(bestCandidate);
        const zone = this.zoneManager.createZone(
            "distribution",
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
    private scoreCandidateForZone(candidate: DistributionCandidate): number {
        const sellRatio = candidate.sellVolume / candidate.totalVolume;
        const duration = Date.now() - candidate.startTime;
        const volumeScore = Math.min(candidate.totalVolume / 600, 1.0); // Normalize to 600 (higher than accumulation)
        const durationScore = Math.min(duration / 300000, 1.0); // Normalize to 5 minutes
        const orderSizeScore = Math.min(candidate.averageOrderSize / 40, 1.0); // Normalize to 40
        const distributionScore = candidate.volumeDistribution;

        // Weighted score - distribution patterns are typically more intense
        return (
            sellRatio * 0.4 + // 40% weight on sell dominance (higher than accumulation)
            candidate.priceStability * 0.2 + // 20% weight on price stability
            volumeScore * 0.18 + // 18% weight on volume
            distributionScore * 0.12 + // 12% weight on distribution pattern
            durationScore * 0.07 + // 7% weight on duration (less important)
            orderSizeScore * 0.03 // 3% weight on order size
        );
    }

    /**
     * Calculate price stability within candidate
     */
    private calculatePriceStability(candidate: DistributionCandidate): number {
        if (candidate.trades.length < 2) return 1.0;

        const prices = candidate.trades.map((t) => t.price);
        const avgPrice = prices.reduce((a, b) => a + b) / prices.length;
        const maxDeviation = Math.max(
            ...prices.map((p) => Math.abs(p - avgPrice) / avgPrice)
        );

        return Math.max(0, 1 - maxDeviation / this.maxPriceDeviation);
    }

    /**
     * Calculate volume distribution pattern (how consistently distributed the selling is)
     */
    private calculateVolumeDistribution(
        candidate: DistributionCandidate
    ): number {
        if (candidate.trades.length < 3) return 0;

        // Check for consistent selling pressure over time
        const timeWindows = 3;
        const windowSize = Math.floor(candidate.trades.length / timeWindows);
        if (windowSize < 1) return 0;

        let consistentWindows = 0;

        for (let i = 0; i < timeWindows; i++) {
            const startIdx = i * windowSize;
            const endIdx = Math.min(
                startIdx + windowSize,
                candidate.trades.length
            );
            const windowTrades = candidate.trades.slice(startIdx, endIdx);

            const windowSellVolume = windowTrades
                .filter((t) => t.buyerIsMaker)
                .reduce((sum, t) => sum + t.quantity, 0);
            const windowTotalVolume = windowTrades.reduce(
                (sum, t) => sum + t.quantity,
                0
            );

            const windowSellRatio =
                windowTotalVolume > 0
                    ? windowSellVolume / windowTotalVolume
                    : 0;

            if (windowSellRatio > 0.6) {
                // At least 60% selling in this window
                consistentWindows++;
            }
        }

        return consistentWindows / timeWindows;
    }

    /**
     * Create zone detection data from candidate
     */
    private createZoneDetectionData(
        candidate: DistributionCandidate
    ): ZoneDetectionData {
        const prices = candidate.trades.map((t) => t.price);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const centerPrice = (minPrice + maxPrice) / 2;

        const sellRatio = candidate.sellVolume / candidate.totalVolume;
        const orderSizeProfile =
            candidate.averageOrderSize > 45
                ? "institutional"
                : candidate.averageOrderSize > 18
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
            confidence: Math.min(sellRatio * 1.4, 1.0), // Higher confidence for strong sell dominance
            supportingFactors: {
                volumeConcentration: Math.min(candidate.totalVolume / 400, 1.0),
                orderSizeProfile,
                timeConsistency: Math.min(
                    (Date.now() - candidate.startTime) / 300000,
                    1.0
                ),
                priceStability: candidate.priceStability,
                flowConsistency: sellRatio,
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
                    zone.strength > 0.65 &&
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
                        expectedDirection: "down", // Distribution suggests downward movement
                        zoneStrength: zone.strength,
                        completionLevel: zone.completion,
                        invalidationLevel: zone.priceRange.max * 1.005, // 0.5% above zone
                        breakoutTarget: zone.priceRange.center * 0.98, // 2% below center
                        positionSizing:
                            zone.significance === "institutional"
                                ? "heavy"
                                : zone.significance === "major"
                                  ? "normal"
                                  : "light",
                        stopLossLevel: zone.priceRange.max * 1.01, // 1% above zone
                        takeProfitLevel: zone.priceRange.center * 0.97, // 3% profit target
                    });
                }
                break;

            case "zone_completed":
                signals.push({
                    signalType: "zone_completion",
                    zone,
                    actionType: "prepare_for_breakout",
                    confidence: Math.min(zone.confidence * 1.15, 1.0), // Boost confidence for completion
                    urgency: "high",
                    timeframe: "immediate",
                    expectedDirection: "down",
                    zoneStrength: zone.strength,
                    completionLevel: zone.completion,
                    invalidationLevel: zone.priceRange.max * 1.01,
                    breakoutTarget: zone.priceRange.center * 0.95, // Higher target on completion
                    positionSizing: "normal", // Standard sizing for breakout
                    stopLossLevel: zone.priceRange.max * 1.015,
                    takeProfitLevel: zone.priceRange.center * 0.95,
                });
                break;

            case "zone_weakened":
                if (zone.strength < 0.35) {
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
                        invalidationLevel: zone.priceRange.max,
                        positionSizing: "light",
                        stopLossLevel: zone.priceRange.max * 1.005,
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
            expectedDirection: "down",
            zoneStrength: zone.strength,
            completionLevel: zone.completion,
            invalidationLevel: zone.priceRange.max * 1.005,
            breakoutTarget: zone.priceRange.center * 0.975,
            positionSizing:
                zone.significance === "institutional"
                    ? "heavy"
                    : zone.significance === "major"
                      ? "normal"
                      : "light",
            stopLossLevel: zone.priceRange.max * 1.01,
            takeProfitLevel: zone.priceRange.center * 0.97,
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
            // Check if price breaks significantly above zone (invalidation for distribution)
            const invalidationPrice = zone.priceRange.max * 1.005; // 0.5% above zone

            if (trade.price > invalidationPrice) {
                const update = this.zoneManager.invalidateZone(
                    zone.id,
                    "price_breakthrough"
                );
                if (update) invalidations.push(update);
            }
        }

        return invalidations;
    }

    /**
     * Convert price to discrete level for candidate tracking
     */
    private getPriceLevel(price: number): number {
        const tickSize = Math.pow(10, -this.pricePrecision);
        return (
            Math.round(price / (tickSize * this.zoneTicks)) *
            (tickSize * this.zoneTicks)
        );
    }

    /**
     * Cleanup old candidates that haven't formed zones
     */
    private cleanupOldCandidates(): void {
        const now = Date.now();
        const maxAge = 900000; // 15 minutes max candidate age (shorter than accumulation)

        for (const [priceLevel, candidate] of this.candidates) {
            if (now - candidate.startTime > maxAge) {
                this.candidates.delete(priceLevel);
            }
        }
    }

    // Public query methods
    public getActiveZones(): AccumulationZone[] {
        return this.zoneManager
            .getActiveZones(this.symbol)
            .filter((z) => z.type === "distribution");
    }

    public getZoneNearPrice(
        price: number,
        tolerance: number = 0.01
    ): AccumulationZone[] {
        return this.zoneManager
            .getZonesNearPrice(this.symbol, price, tolerance)
            .filter((z) => z.type === "distribution");
    }

    public getZoneStatistics() {
        return this.zoneManager.getZoneStatistics();
    }

    public getCandidateCount(): number {
        return this.candidates.size;
    }

    public getCandidates(): DistributionCandidate[] {
        return Array.from(this.candidates.values());
    }
}
