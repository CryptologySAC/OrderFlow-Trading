// src/services/icebergDetector.ts

/**
 * SimpleIcebergDetector - Real Iceberg Order Detection
 *
 * Detects actual iceberg orders by tracking exact-size order patterns:
 *
 * 1. Passive Icebergs: Limit orders of identical size at same price level
 * 2. Aggressive Icebergs: Market orders of identical size (LTC or USDT value)
 *
 * NO statistical analysis - pure pattern matching for real trading behavior.
 */

import { randomUUID } from "crypto";
import { Detector } from "../indicators/base/detectorEnrichedTrade.ts";
import { FinancialMath } from "../utils/financialMath.ts";
import { Config } from "../core/config.ts";
import type { ILogger } from "../infrastructure/loggerInterface.ts";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.ts";
import type { ISignalLogger } from "../infrastructure/signalLoggerInterface.ts";
import type { AnomalyDetector } from "./anomalyDetector.ts";
import type { EnrichedTradeEvent } from "../types/marketEvents.ts";
import type { SignalCandidate } from "../types/signalTypes.ts";

// Configuration type from simpleIceberg settings in config.json
export interface SimpleIcebergConfig {
    enhancementMode: "disabled" | "testing" | "production";
    minOrderCount: number;
    minTotalSize: number;
    maxOrderGapMs: number;
    timeWindowIndex: number;
    maxActivePatterns: number;
    maxRecentTrades: number;
}

export interface SimpleIcebergEvent {
    id: string;
    type: "passive" | "aggressive_ltc" | "aggressive_usdt";
    price?: number; // Only for passive icebergs
    side: "buy" | "sell";
    orderSize: number; // Exact size of identical orders
    orderCount: number; // Number of identical orders detected
    totalSize: number; // Total volume (orderSize * orderCount)
    firstSeen: number;
    lastSeen: number;
    priceRange?: { min: number; max: number }; // For aggressive icebergs across multiple prices
    avgRefillGap?: number; // Backward compatibility - average time between orders
}

export interface SimpleIcebergZone {
    id: string;
    type: "simple_iceberg";
    icebergType: "passive" | "aggressive_ltc" | "aggressive_usdt";
    priceRange: { min: number; max: number };
    startTime: number;
    endTime: number;
    side: "buy" | "sell";
    orderSize: number;
    orderCount: number;
    totalVolume: number;
}

interface TradeInfo {
    size: number;
    timestamp: number;
    price: number;
    tradeId: string;
    side: "buy" | "sell";
}

enum IcebergPatternState {
    CANDIDATE = "candidate", // Building up to minOrderCount
    DETECTED = "detected", // Signal emitted, continuing to grow
    COMPLETED = "completed", // No longer active
}

interface IcebergPattern {
    id: string;
    state: IcebergPatternState;
    type: "passive" | "aggressive_ltc" | "aggressive_usdt";
    trades: TradeInfo[];
    exactValue: number; // Price for passive, LTC for aggressive_ltc, USDT for aggressive_usdt
    side: "buy" | "sell";
    firstSeen: number;
    lastSeen: number;
    signalEmitted: boolean; // Track if signal was already emitted
}

/**
 * Simple iceberg order detection using exact-size pattern matching
 */
export class SimpleIcebergDetector extends Detector {
    private config: SimpleIcebergConfig;
    private anomalyDetector?: AnomalyDetector;

    // Single pattern tracking with unique keys: "type_side_exactValue"
    private activePatterns = new Map<string, IcebergPattern>();

    // Completed icebergs for monitoring
    private completedIcebergs: SimpleIcebergEvent[] = [];

    constructor(
        id: string,
        logger: ILogger,
        metricsCollector: IMetricsCollector,
        signalLogger?: ISignalLogger
    ) {
        super(id, logger, metricsCollector, signalLogger);
        this.config = Config.SIMPLE_ICEBERG_DETECTOR;

        // Cleanup expired patterns periodically
        setInterval(() => this.cleanupExpiredPatterns(), 60000); // Every minute
    }

    /**
     * Calculate USDT value for aggressive iceberg detection with proper rounding
     */
    private calculateUsdtValue(price: number, quantity: number): number {
        const exactValue = FinancialMath.multiplyQuantities(price, quantity);
        // Round to nearest cent for realistic USDT matching
        return FinancialMath.financialRound(exactValue, 2);
    }

    /**
     * Check if two sizes are exactly equal using FinancialMath (zero tolerance)
     */
    private areExactSizes(size1: number, size2: number): boolean {
        return FinancialMath.compareQuantities(size1, size2) === 0;
    }

    /**
     * Generate unique pattern key for tracking
     */
    private generatePatternKey(
        type: string,
        side: string,
        exactValue: number
    ): string {
        return `${type}_${side}_${exactValue}`;
    }

    /**
     * Set the anomaly detector for event forwarding
     */
    public setAnomalyDetector(anomalyDetector: AnomalyDetector): void {
        this.anomalyDetector = anomalyDetector;
    }

    /**
     * Process trade event for simple iceberg detection
     */
    public onEnrichedTrade(trade: EnrichedTradeEvent): void {
        try {
            // Trigger cleanup of expired patterns on each trade
            this.cleanupExpiredPatterns();

            const side = trade.buyerIsMaker ? "sell" : "buy";
            const tradeInfo: TradeInfo = {
                size: trade.quantity,
                timestamp: trade.timestamp,
                price: trade.price,
                tradeId: trade.tradeId,
                side: side,
            };

            // Try iceberg detection with priority: Passive > Aggressive LTC > Aggressive USDT
            // Only emit one signal per pattern (not per trade)

            // Priority 1: Passive iceberg (same price/side/size)
            const passiveEmitted = this.processPassiveIceberg(tradeInfo);

            // Priority 2: Aggressive LTC iceberg (only if no passive signal)
            let aggressiveLtcEmitted = false;
            if (!passiveEmitted) {
                aggressiveLtcEmitted =
                    this.processAggressiveLtcIceberg(tradeInfo);
            }

            // Priority 3: Aggressive USDT iceberg (only if no other signals)
            if (!passiveEmitted && !aggressiveLtcEmitted) {
                const usdtValue = this.calculateUsdtValue(
                    trade.price,
                    trade.quantity
                );
                this.processAggressiveUsdtIceberg(tradeInfo, usdtValue);
            }
        } catch (error) {
            this.handleError(
                error instanceof Error ? error : new Error(String(error)),
                "SimpleIcebergDetector.onEnrichedTrade"
            );
        }
    }

    /**
     * Process passive iceberg pattern: identical sizes at same price level
     */
    private processPassiveIceberg(tradeInfo: TradeInfo): boolean {
        // For passive icebergs, pattern key only includes price and side (size validation happens inside pattern)
        const patternKey = `passive_${tradeInfo.side}_${tradeInfo.price}`;

        // Get or create pattern
        let pattern = this.activePatterns.get(patternKey);
        if (!pattern) {
            pattern = {
                id: randomUUID(),
                state: IcebergPatternState.CANDIDATE,
                type: "passive",
                trades: [],
                exactValue: tradeInfo.size, // Store expected size from first trade
                side: tradeInfo.side,
                firstSeen: tradeInfo.timestamp,
                lastSeen: tradeInfo.timestamp,
                signalEmitted: false,
            };
            this.activePatterns.set(patternKey, pattern);
        } else {
            // CRITICAL: Validate exact size match for passive icebergs (zero tolerance)
            const expectedSize = pattern.exactValue;
            if (!this.areExactSizes(tradeInfo.size, expectedSize)) {
                return false; // Size doesn't match - reject this trade
            }
        }

        return this.updatePattern(pattern, tradeInfo);
    }

    /**
     * Process aggressive LTC iceberg pattern: identical LTC quantities
     */
    private processAggressiveLtcIceberg(tradeInfo: TradeInfo): boolean {
        const patternKey = this.generatePatternKey(
            "aggressive_ltc",
            tradeInfo.side,
            tradeInfo.size
        );

        // Get or create pattern
        let pattern = this.activePatterns.get(patternKey);
        if (!pattern) {
            pattern = {
                id: randomUUID(),
                state: IcebergPatternState.CANDIDATE,
                type: "aggressive_ltc",
                trades: [],
                exactValue: tradeInfo.size,
                side: tradeInfo.side,
                firstSeen: tradeInfo.timestamp,
                lastSeen: tradeInfo.timestamp,
                signalEmitted: false,
            };
            this.activePatterns.set(patternKey, pattern);
        }

        // Validate exact size match (zero tolerance)
        if (pattern.trades.length > 0) {
            const expectedSize = pattern.exactValue;
            if (!this.areExactSizes(tradeInfo.size, expectedSize)) {
                return false; // Size doesn't match - reject
            }

            // CRITICAL: Check if this looks like a passive iceberg instead
            // If all trades so far are at the same price, this should be passive, not aggressive
            const prices = pattern.trades.map((t) => t.price);
            const allSamePrice = prices.every(
                (p) => FinancialMath.compareQuantities(p, tradeInfo.price) === 0
            );
            if (allSamePrice) {
                return false; // This should be detected as passive, not aggressive
            }
        }

        return this.updatePattern(pattern, tradeInfo);
    }

    /**
     * Universal pattern update method with state management
     */
    private updatePattern(
        pattern: IcebergPattern,
        newTrade: TradeInfo
    ): boolean {
        pattern.trades.push(newTrade);
        pattern.lastSeen = newTrade.timestamp;

        // Filter valid trades within time window
        const validTrades = this.filterValidTrades(pattern.trades);

        // Update pattern with valid trades only
        pattern.trades = validTrades;

        // Check if pattern should emit signal (only once)
        if (
            validTrades.length >= this.config.minOrderCount &&
            !pattern.signalEmitted
        ) {
            const totalSize = validTrades.reduce((sum, t) => sum + t.size, 0);

            if (totalSize >= this.config.minTotalSize) {
                pattern.state = IcebergPatternState.DETECTED;
                pattern.signalEmitted = true;
                this.emitIcebergSignal(pattern);
                // Continue collecting trades even after signal emission
                return true; // Signal emitted
            }
        }

        // CRITICAL: Always update completed icebergs if pattern was already detected
        if (pattern.signalEmitted) {
            this.updateCompletedIceberg(pattern);
        }

        return false; // No new signal emitted
    }

    /**
     * Update completed iceberg data as pattern continues to grow
     */
    private updateCompletedIceberg(pattern: IcebergPattern): void {
        // Find the existing completed iceberg and update it
        const icebergIndex = this.completedIcebergs.findIndex(
            (iceberg) => iceberg.id === pattern.id
        );

        if (icebergIndex !== -1) {
            const trades = pattern.trades;
            const prices = trades.map((t) => t.price);

            // Update the existing iceberg with current pattern state
            this.completedIcebergs[icebergIndex] = {
                ...this.completedIcebergs[icebergIndex],
                orderCount: trades.length,
                totalSize: trades.reduce((sum, t) => sum + t.size, 0),
                lastSeen: pattern.lastSeen,
                ...(pattern.type === "passive"
                    ? {}
                    : {
                          priceRange: {
                              min: FinancialMath.calculateMin(prices),
                              max: FinancialMath.calculateMax(prices),
                          },
                      }),
            };
        }
    }

    /**
     * Process aggressive USDT iceberg pattern: identical USDT values
     */
    private processAggressiveUsdtIceberg(
        tradeInfo: TradeInfo,
        usdtValue: number
    ): boolean {
        const patternKey = this.generatePatternKey(
            "aggressive_usdt",
            tradeInfo.side,
            usdtValue
        );

        // Get or create pattern
        let pattern = this.activePatterns.get(patternKey);
        if (!pattern) {
            pattern = {
                id: randomUUID(),
                state: IcebergPatternState.CANDIDATE,
                type: "aggressive_usdt",
                trades: [],
                exactValue: usdtValue,
                side: tradeInfo.side,
                firstSeen: tradeInfo.timestamp,
                lastSeen: tradeInfo.timestamp,
                signalEmitted: false,
            };
            this.activePatterns.set(patternKey, pattern);
        }

        // Validate exact USDT value match (zero tolerance after rounding)
        if (pattern.trades.length > 0) {
            const expectedUsdtValue = pattern.exactValue;
            const currentUsdtValue = this.calculateUsdtValue(
                tradeInfo.price,
                tradeInfo.size
            );
            if (!this.areExactSizes(currentUsdtValue, expectedUsdtValue)) {
                return false; // USDT value doesn't match - reject
            }

            // CRITICAL: Check if this looks like a passive iceberg instead
            // If all trades so far are at the same price, this should be passive, not aggressive
            const prices = pattern.trades.map((t) => t.price);
            const allSamePrice = prices.every(
                (p) => FinancialMath.compareQuantities(p, tradeInfo.price) === 0
            );
            if (allSamePrice) {
                return false; // This should be detected as passive, not aggressive
            }
        }

        return this.updatePattern(pattern, tradeInfo);
    }

    /**
     * Filter trades to only include those within the tracking window and order gap
     */
    private filterValidTrades(trades: TradeInfo[]): TradeInfo[] {
        const now = Date.now();
        const windowStart =
            now - Config.getTimeWindow(this.config.timeWindowIndex);

        // Filter by time window
        let validTrades = trades.filter(
            (trade) => trade.timestamp >= windowStart
        );

        // Sort by timestamp
        validTrades.sort((a, b) => a.timestamp - b.timestamp);

        // Check for order gaps
        const filteredTrades: TradeInfo[] = [];
        for (let i = 0; i < validTrades.length; i++) {
            if (i === 0) {
                filteredTrades.push(validTrades[i]);
            } else {
                const gap =
                    validTrades[i].timestamp - validTrades[i - 1].timestamp;
                if (gap <= this.config.maxOrderGapMs) {
                    filteredTrades.push(validTrades[i]);
                } else {
                    // Gap too large, start new sequence
                    filteredTrades.length = 0;
                    filteredTrades.push(validTrades[i]);
                }
            }
        }

        return filteredTrades;
    }

    /**
     * Emit iceberg signal from pattern
     */
    private emitIcebergSignal(pattern: IcebergPattern): void {
        const trades = pattern.trades;
        const prices = trades.map((t) => t.price);

        // Calculate average refill gap for backward compatibility
        const avgRefillGap =
            trades.length > 1
                ? (pattern.lastSeen - pattern.firstSeen) / (trades.length - 1)
                : 0;

        const icebergEvent: SimpleIcebergEvent = {
            id: pattern.id,
            type: pattern.type,
            side: pattern.side,
            orderSize:
                pattern.type === "passive"
                    ? trades[0].size
                    : pattern.exactValue,
            orderCount: trades.length,
            totalSize: trades.reduce((sum, t) => sum + t.size, 0),
            firstSeen: pattern.firstSeen,
            lastSeen: pattern.lastSeen,
            avgRefillGap: avgRefillGap,
            ...(pattern.type === "passive"
                ? { price: pattern.exactValue }
                : {
                      priceRange: {
                          min: FinancialMath.calculateMin(prices),
                          max: FinancialMath.calculateMax(prices),
                      },
                  }),
        };

        this.emitIcebergEvent(icebergEvent);

        this.logger.info("Iceberg detected", {
            component: "SimpleIcebergDetector",
            operation: "emitIcebergSignal",
            icebergType: pattern.type,
            ...icebergEvent,
        });
    }

    /**
     * Emit iceberg event and signal
     */
    private emitIcebergEvent(icebergEvent: SimpleIcebergEvent): void {
        // Store completed iceberg
        this.completedIcebergs.push(icebergEvent);
        if (this.completedIcebergs.length > this.config.maxRecentTrades) {
            this.completedIcebergs = this.completedIcebergs.slice(
                -this.config.maxRecentTrades
            );
        }

        // Emit signal candidate
        const signalCandidate: SignalCandidate = {
            id: icebergEvent.id,
            type: "absorption", // Use existing type for compatibility
            side: icebergEvent.side,
            confidence: 0.8, // High confidence for exact-size matches
            timestamp: icebergEvent.lastSeen,
            data: {
                price:
                    icebergEvent.price ||
                    (icebergEvent.priceRange
                        ? FinancialMath.calculateMidPrice(
                              icebergEvent.priceRange.min,
                              icebergEvent.priceRange.max,
                              4
                          )
                        : 0),
                zone: Math.round((icebergEvent.price || 0) * 100),
                side: icebergEvent.side,
                aggressive: icebergEvent.totalSize,
                passive: icebergEvent.totalSize,
                refilled: true,
                confidence: 0.8,
                metrics: {
                    icebergType: icebergEvent.type,
                    orderSize: icebergEvent.orderSize,
                    orderCount: icebergEvent.orderCount,
                    duration: icebergEvent.lastSeen - icebergEvent.firstSeen,
                },
                meta: {
                    simpleIcebergDetected: true,
                    icebergEvent,
                },
            },
        };

        this.emitSignalCandidate(signalCandidate);

        // Emit zone update for dashboard visualization
        const zone: SimpleIcebergZone = {
            id: `simple_iceberg_${icebergEvent.id}`,
            type: "simple_iceberg",
            icebergType: icebergEvent.type,
            priceRange: icebergEvent.priceRange || {
                min: icebergEvent.price! - 0.01,
                max: icebergEvent.price! + 0.01,
            },
            startTime: icebergEvent.firstSeen,
            endTime: icebergEvent.lastSeen,
            side: icebergEvent.side,
            orderSize: icebergEvent.orderSize,
            orderCount: icebergEvent.orderCount,
            totalVolume: icebergEvent.totalSize,
        };

        this.emit("zoneUpdated", {
            updateType: "zone_created",
            zone,
            significance: "high",
        });

        // Forward to anomaly detector if available
        if (this.anomalyDetector) {
            this.anomalyDetector.onSpoofingEvent(
                {
                    priceStart: zone.priceRange.min,
                    priceEnd: zone.priceRange.max,
                    side: icebergEvent.side,
                    wallBefore: icebergEvent.totalSize,
                    wallAfter: 0,
                    canceled: 0,
                    executed: icebergEvent.totalSize,
                    timestamp: icebergEvent.lastSeen,
                    spoofedSide: icebergEvent.side === "buy" ? "bid" : "ask",
                    spoofType: "iceberg_manipulation",
                    confidence: 0.8,
                    cancelTimeMs:
                        icebergEvent.lastSeen - icebergEvent.firstSeen,
                    marketImpact: 0.7,
                },
                FinancialMath.calculateMidPrice(
                    zone.priceRange.min,
                    zone.priceRange.max,
                    4
                )
            );
        }
    }

    /**
     * Cleanup expired patterns to prevent memory growth
     */
    private cleanupExpiredPatterns(): void {
        const now = Date.now();
        const expiredThreshold =
            now - Config.getTimeWindow(this.config.timeWindowIndex);

        // Clean up expired patterns
        for (const [key, pattern] of this.activePatterns) {
            if (pattern.lastSeen < expiredThreshold) {
                this.activePatterns.delete(key);
            } else {
                // Clean up expired trades within active patterns
                pattern.trades = pattern.trades.filter(
                    (t: TradeInfo) => t.timestamp >= expiredThreshold
                );

                // Remove patterns with no valid trades
                if (pattern.trades.length === 0) {
                    this.activePatterns.delete(key);
                }
            }
        }

        // Limit total patterns to prevent memory issues
        if (this.activePatterns.size > this.config.maxActivePatterns) {
            // Sort by last seen and remove oldest patterns
            const sortedPatterns = Array.from(
                this.activePatterns.entries()
            ).sort(([, a], [, b]) => a.lastSeen - b.lastSeen);

            const patternsToRemove = sortedPatterns.slice(
                0,
                this.activePatterns.size - this.config.maxActivePatterns
            );

            for (const [key] of patternsToRemove) {
                this.activePatterns.delete(key);
            }
        }
    }

    /**
     * Get detector status (required by base Detector class)
     */
    public getStatus(): string {
        const stats = this.getStatistics();
        return `Active patterns: ${stats.activePatterns}, Completed icebergs: ${stats.completedIcebergs}`;
    }

    /**
     * Mark signal as confirmed (required by base Detector class)
     */
    public markSignalConfirmed(zone: number, side: "buy" | "sell"): void {
        this.logger.info("Simple iceberg signal confirmed", {
            component: "SimpleIcebergDetector",
            zone,
            side,
            timestamp: Date.now(),
        });
    }

    /**
     * Get completed icebergs
     */
    public getCompletedIcebergs(
        windowMs: number = 300000
    ): SimpleIcebergEvent[] {
        const cutoff = Date.now() - windowMs;
        return this.completedIcebergs.filter(
            (iceberg) => iceberg.lastSeen > cutoff
        );
    }

    /**
     * Get iceberg detection statistics
     */
    public getStatistics(): {
        activePatterns: number;
        completedIcebergs: number;
        totalVolumeDetected: number;
        activeCandidates?: number;
    } {
        const recentIcebergs = this.getCompletedIcebergs();

        // Count active patterns
        const activePatterns = this.activePatterns.size;

        return {
            activePatterns,
            completedIcebergs: recentIcebergs.length,
            totalVolumeDetected: recentIcebergs.reduce(
                (sum, i) => sum + i.totalSize,
                0
            ),
            // Backward compatibility
            activeCandidates: activePatterns,
        };
    }

    /**
     * Get active iceberg candidates (backward compatibility method)
     * Maps new pattern structure to old candidate format
     */
    public getActiveCandidates(): Array<{
        id: string;
        side: string;
        price: number;
        pieces: Array<{ size: number; timestamp: number; price: number }>;
        priceRange: { min: number; max: number };
        totalSize: number;
        totalExecuted: number;
        firstSeen: number;
        lastUpdate: number;
    }> {
        // For backward compatibility, prioritize passive patterns (same price = most likely iceberg type)
        const patterns = Array.from(this.activePatterns.values());
        const passivePatterns = patterns.filter((p) => p.type === "passive");

        // Return passive patterns first, then others (old tests expect passive behavior)
        const relevantPatterns =
            passivePatterns.length > 0 ? passivePatterns : patterns.slice(0, 1);

        return relevantPatterns.map((pattern) => {
            const prices = pattern.trades.map((t) => t.price);
            return {
                id: pattern.id,
                side: pattern.side,
                price: prices.length > 0 ? prices[0] : 0, // Use first trade price for all pattern types
                pieces: pattern.trades.map((t) => ({
                    size: t.size,
                    timestamp: t.timestamp,
                    price: t.price,
                })),
                priceRange: {
                    min: FinancialMath.calculateMin(prices),
                    max: FinancialMath.calculateMax(prices),
                },
                totalSize: pattern.trades.reduce((sum, t) => sum + t.size, 0),
                totalExecuted: pattern.trades.reduce(
                    (sum, t) => sum + t.size,
                    0
                ), // Same as totalSize for backward compatibility
                firstSeen: pattern.firstSeen,
                lastUpdate: pattern.lastSeen,
            };
        });
    }
}

// Export for backward compatibility
export const IcebergDetector = SimpleIcebergDetector;
export type IcebergDetectorConfig = SimpleIcebergConfig;
