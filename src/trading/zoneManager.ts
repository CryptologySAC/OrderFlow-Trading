// src/trading/zoneManager.ts

import { EventEmitter } from "events";
import {
    TradingZone,
    ZoneUpdate,
    ZoneDetectionData,
    ZoneQueryOptions,
} from "../types/zoneTypes.js";
import { Config } from "../core/config.js";
import type { EnrichedTradeEvent } from "../types/marketEvents.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";

export class ZoneManager extends EventEmitter {
    private readonly activeZones = new Map<string, TradingZone>();
    private completedZones: TradingZone[] = [];
    private readonly zoneHistory = new Map<string, TradingZone[]>();

    // Zone configuration - uses universal zone config
    private readonly config: typeof Config.UNIVERSAL_ZONE_CONFIG;

    constructor(
        config: typeof Config.UNIVERSAL_ZONE_CONFIG,
        private readonly logger: ILogger,
        private readonly metricsCollector: IMetricsCollector
    ) {
        super();

        this.config = config;

        // Cleanup old zones periodically
        setInterval(() => this.cleanupExpiredZones(), 300000); // Every 5 minutes

        // Enhanced memory management cleanup for completed zones and history
        setInterval(() => this.cleanup(), 1800000); // Every 30 minutes

        this.logger.info("ZoneManager initialized", {
            component: "ZoneManager",
            config: this.config,
        });
    }

    // Zone lifecycle management
    public createZone(
        type: "accumulation" | "distribution",
        symbol: string,
        initialTrade: EnrichedTradeEvent,
        detection: ZoneDetectionData
    ): TradingZone {
        // Check if we've hit the limit for active zones
        const activeSymbolZones = this.getActiveZones(symbol);
        if (activeSymbolZones.length >= this.config.maxActiveZones) {
            // Remove weakest zone to make room
            const weakestZone = activeSymbolZones.reduce((weakest, zone) =>
                zone.strength < weakest.strength ? zone : weakest
            );
            this.invalidateZone(weakestZone.id, "replaced_by_stronger_zone");
        }

        const zoneId = `${type}_${symbol}_${Date.now()}`;

        const zone: TradingZone = {
            id: zoneId,
            type,
            symbol,
            startTime: initialTrade.timestamp,
            priceRange: {
                min: detection.priceRange.min,
                max: detection.priceRange.max,
                center: detection.priceRange.center,
                width: detection.priceRange.max - detection.priceRange.min,
            },
            totalVolume: detection.totalVolume,
            averageOrderSize: detection.averageOrderSize,
            tradeCount: 1,
            timeInZone: 0,
            intensity: 0,
            strength: detection.initialStrength,
            completion: 0.1, // Just started
            confidence: detection.confidence,
            significance: this.classifySignificance(detection),
            isActive: true,
            lastUpdate: initialTrade.timestamp,
            strengthHistory: [
                {
                    timestamp: initialTrade.timestamp,
                    strength: detection.initialStrength,
                    volume: detection.totalVolume,
                },
            ],
            supportingFactors: detection.supportingFactors,
        };

        this.activeZones.set(zoneId, zone);

        this.logger.info("New zone created", {
            component: "ZoneManager",
            zoneId,
            type,
            symbol,
            priceRange: zone.priceRange,
            initialStrength: zone.strength,
            significance: zone.significance,
        });

        this.metricsCollector.incrementCounter("zones_created_total", 1, {
            type,
            symbol,
            significance: zone.significance,
        });

        this.emit("zoneCreated", zone);

        return zone;
    }

    public updateZone(
        zoneId: string,
        trade: EnrichedTradeEvent
    ): ZoneUpdate | null {
        const zone = this.activeZones.get(zoneId);
        if (!zone?.isActive) return null;

        // Check if trade is within zone
        if (!this.isTradeInZone(trade, zone)) return null;

        const previousStrength = zone.strength;
        const previousCompletion = zone.completion;

        // Update zone with new trade
        zone.totalVolume += trade.quantity;
        zone.tradeCount++;
        zone.timeInZone = trade.timestamp - zone.startTime;
        zone.intensity =
            zone.totalVolume / Math.max(zone.timeInZone / 60000, 1); // volume per minute
        zone.averageOrderSize =
            zone.tradeCount > 0 ? zone.totalVolume / zone.tradeCount : 0;
        zone.lastUpdate = trade.timestamp;

        // Recalculate zone metrics
        zone.strength = this.calculateZoneStrength(zone);
        zone.completion = this.calculateZoneCompletion(zone);
        zone.confidence = this.calculateZoneConfidence(zone);

        // Update supporting factors
        zone.supportingFactors = this.updateSupportingFactors(zone, trade);

        // Update strength history
        zone.strengthHistory.push({
            timestamp: trade.timestamp,
            strength: zone.strength,
            volume: trade.quantity,
        });

        // Limit history size
        if (zone.strengthHistory.length > 100) {
            zone.strengthHistory.shift();
        }

        // Determine update type
        let updateType: ZoneUpdate["updateType"] = "zone_updated";
        const strengthChange = zone.strength - previousStrength;

        if (strengthChange > this.config.strengthChangeThreshold) {
            updateType = "zone_strengthened";
        } else if (strengthChange < -this.config.strengthChangeThreshold) {
            updateType = "zone_weakened";
        }

        // Check for completion
        if (
            zone.completion > this.config.completionThreshold &&
            updateType !== "zone_weakened"
        ) {
            updateType = "zone_completed";
            zone.isActive = false;
            zone.endTime = trade.timestamp;
            this.moveToCompleted(zone);
        }

        const update: ZoneUpdate = {
            updateType,
            zone: { ...zone }, // Clone to avoid mutation
            significance: this.calculateUpdateSignificance(
                strengthChange,
                zone
            ),
            timestamp: trade.timestamp,
            changeMetrics: {
                strengthChange,
                volumeAdded: trade.quantity,
                timeProgression: zone.timeInZone,
                completionChange: zone.completion - previousCompletion,
            },
        };

        this.logger.debug("Zone updated", {
            component: "ZoneManager",
            zoneId,
            updateType,
            strengthChange: strengthChange.toFixed(3),
            newStrength: zone.strength.toFixed(3),
            completion: zone.completion.toFixed(3),
        });

        this.metricsCollector.incrementCounter("zone_updates_total", 1, {
            type: zone.type,
            symbol: zone.symbol,
            updateType,
        });

        this.emit("zoneUpdated", update);

        return update;
    }

    public invalidateZone(zoneId: string, reason: string): ZoneUpdate | null {
        const zone = this.activeZones.get(zoneId);
        if (!zone) return null;

        zone.isActive = false;
        zone.endTime = Date.now();

        this.activeZones.delete(zoneId);

        this.logger.info("Zone invalidated", {
            component: "ZoneManager",
            zoneId,
            reason,
            duration: zone.timeInZone,
            finalStrength: zone.strength.toFixed(3),
        });

        this.metricsCollector.incrementCounter("zones_invalidated_total", 1, {
            type: zone.type,
            symbol: zone.symbol,
            reason,
        });

        const update: ZoneUpdate = {
            updateType: "zone_invalidated",
            zone,
            significance: "high",
            timestamp: Date.now(),
        };

        this.emit("zoneInvalidated", update);

        return update;
    }

    // Zone analysis methods
    private calculateZoneStrength(zone: TradingZone): number {
        // Zone strength based on multiple factors
        const factors = {
            // Volume concentration (more volume = stronger)
            volumeStrength: Math.min(zone.totalVolume / 1000, 1.0), // Normalize to 1000 as max

            // Time consistency (longer stable accumulation = stronger)
            timeStrength: Math.min(zone.timeInZone / 3600000, 1.0), // Normalize to 1 hour

            // Price stability within zone (less volatility = stronger)
            stabilityStrength:
                zone.priceRange.center > 0
                    ? Math.max(
                          0,
                          1 - zone.priceRange.width / zone.priceRange.center
                      )
                    : 0,

            // Order flow consistency
            flowStrength: zone.supportingFactors.flowConsistency,

            // Order size profile (institutional = stronger)
            profileStrength:
                zone.supportingFactors.orderSizeProfile === "institutional"
                    ? 1.0
                    : zone.supportingFactors.orderSizeProfile === "mixed"
                      ? 0.7
                      : 0.4,
        };

        // Weighted average of strength factors
        const weights = {
            volume: 0.25,
            time: 0.2,
            stability: 0.2,
            flow: 0.2,
            profile: 0.15,
        };

        return Math.max(
            0,
            Math.min(
                1,
                factors.volumeStrength * weights.volume +
                    factors.timeStrength * weights.time +
                    factors.stabilityStrength * weights.stability +
                    factors.flowStrength * weights.flow +
                    factors.profileStrength * weights.profile
            )
        );
    }

    private calculateZoneCompletion(zone: TradingZone): number {
        // Completion based on volume accumulation and time
        const expectedVolume = this.getExpectedZoneVolume(zone);
        const expectedTime = this.getExpectedZoneTime(zone);

        const volumeCompletion =
            expectedVolume > 0
                ? Math.min(zone.totalVolume / expectedVolume, 1.0)
                : 0;
        const timeCompletion = Math.min(zone.timeInZone / expectedTime, 1.0);

        // Use the higher of the two (some zones complete faster with high volume)
        return Math.max(volumeCompletion, timeCompletion);
    }

    private calculateZoneConfidence(zone: TradingZone): number {
        // Confidence increases with consistent patterns
        const consistencyFactors = [
            zone.supportingFactors.volumeConcentration,
            zone.supportingFactors.timeConsistency,
            zone.supportingFactors.priceStability,
            zone.supportingFactors.flowConsistency,
        ];

        const avgConsistency =
            consistencyFactors.reduce((a, b) => a + b) /
            consistencyFactors.length;

        // Boost confidence for longer-duration zones
        const durationBoost = Math.min(zone.timeInZone / 1800000, 0.2); // Up to 20% boost for 30+ min

        return Math.min(avgConsistency + durationBoost, 1.0);
    }

    private updateSupportingFactors(
        zone: TradingZone,
        trade: EnrichedTradeEvent
    ): TradingZone["supportingFactors"] {
        // Calculate volume concentration (how much volume is in this specific zone vs nearby prices)
        const volumeConcentration = Math.min(
            zone.totalVolume / (zone.totalVolume + 500),
            1.0
        ); // Simplified

        // Time consistency based on regular trading activity
        const timeSinceLastUpdate = trade.timestamp - zone.lastUpdate;
        const consistentInterval = timeSinceLastUpdate < 300000; // Less than 5 minutes
        const timeConsistency = consistentInterval
            ? Math.min(zone.supportingFactors.timeConsistency + 0.1, 1.0)
            : Math.max(zone.supportingFactors.timeConsistency - 0.05, 0.0);

        // Price stability within zone
        const priceFromCenter = Math.abs(trade.price - zone.priceRange.center);
        const priceStability = Math.max(
            0,
            zone.priceRange.width > 0
                ? 1 - priceFromCenter / (zone.priceRange.width / 2)
                : 1
        );

        // Flow consistency (accumulation should be mostly buy-side, distribution sell-side)
        const expectedSide = zone.type === "accumulation" ? "buy" : "sell";
        const isExpectedSide =
            (trade.buyerIsMaker && expectedSide === "sell") ||
            (!trade.buyerIsMaker && expectedSide === "buy");
        const flowConsistency = isExpectedSide
            ? Math.min(zone.supportingFactors.flowConsistency + 0.05, 1.0)
            : Math.max(zone.supportingFactors.flowConsistency - 0.02, 0.0);

        // Order size profile
        let orderSizeProfile: "retail" | "institutional" | "mixed" =
            zone.supportingFactors.orderSizeProfile;
        if (trade.quantity > 100) {
            orderSizeProfile =
                zone.averageOrderSize > 50 ? "institutional" : "mixed";
        }

        return {
            volumeConcentration,
            orderSizeProfile,
            timeConsistency,
            priceStability,
            flowConsistency,
        };
    }

    // Helper methods
    private isTradeInZone(
        trade: EnrichedTradeEvent,
        zone: TradingZone
    ): boolean {
        return (
            trade.price >= zone.priceRange.min &&
            trade.price <= zone.priceRange.max
        );
    }

    /**
     * Expand zone price range to accommodate new price levels during merges
     * This prevents volume loss when overlapping candidates are merged
     */
    public expandZoneRange(zoneId: string, newPrice: number): boolean {
        const zone = this.activeZones.get(zoneId);
        if (!zone) return false;

        // Calculate if expansion is needed
        const needsExpansion =
            newPrice < zone.priceRange.min || newPrice > zone.priceRange.max;
        if (!needsExpansion) return true; // No expansion needed

        // Expand the zone's price range to include the new price
        const originalMin = zone.priceRange.min;
        const originalMax = zone.priceRange.max;

        zone.priceRange.min = Math.min(zone.priceRange.min, newPrice);
        zone.priceRange.max = Math.max(zone.priceRange.max, newPrice);
        zone.priceRange.center =
            (zone.priceRange.min + zone.priceRange.max) / 2;
        zone.priceRange.width = zone.priceRange.max - zone.priceRange.min;

        this.logger.debug("Zone price range expanded", {
            component: "ZoneManager",
            zoneId,
            originalRange: { min: originalMin, max: originalMax },
            newRange: { min: zone.priceRange.min, max: zone.priceRange.max },
            expansionPrice: newPrice,
        });

        return true;
    }

    private classifySignificance(
        detection: ZoneDetectionData
    ): TradingZone["significance"] {
        const volume = detection.totalVolume;
        const orderSize = detection.averageOrderSize;

        if (volume > 1000 && orderSize > 50) return "institutional";
        if (volume > 500 && orderSize > 20) return "major";
        if (volume > 200) return "moderate";
        return "minor";
    }

    private calculateUpdateSignificance(
        strengthChange: number,
        zone: TradingZone
    ): ZoneUpdate["significance"] {
        if (
            Math.abs(strengthChange) > 0.2 ||
            zone.significance === "institutional"
        )
            return "high";
        if (Math.abs(strengthChange) > 0.1 || zone.significance === "major")
            return "medium";
        return "low";
    }

    private moveToCompleted(zone: TradingZone): void {
        this.activeZones.delete(zone.id);
        this.completedZones.push(zone);

        // Maintain completed zones history per symbol
        const symbolHistory = this.zoneHistory.get(zone.symbol) || [];
        symbolHistory.push(zone);
        this.zoneHistory.set(zone.symbol, symbolHistory);

        // Limit history size
        if (symbolHistory.length > 20) {
            symbolHistory.shift();
        }

        this.logger.info("Zone completed", {
            component: "ZoneManager",
            zoneId: zone.id,
            type: zone.type,
            symbol: zone.symbol,
            duration: zone.timeInZone,
            finalStrength: zone.strength.toFixed(3),
            totalVolume: zone.totalVolume,
        });

        this.metricsCollector.incrementCounter("zones_completed_total", 1, {
            type: zone.type,
            symbol: zone.symbol,
            significance: zone.significance,
        });

        this.emit("zoneCompleted", zone);
    }

    private cleanupExpiredZones(): void {
        const now = Date.now();
        const expiredZones = Array.from(this.activeZones.values()).filter(
            (zone) => now - zone.startTime > this.config.zoneTimeoutMs
        );

        for (const zone of expiredZones) {
            this.invalidateZone(zone.id, "timeout");
        }
    }

    private getExpectedZoneVolume(zone: TradingZone): number {
        // Expected volume based on zone significance
        switch (zone.significance) {
            case "institutional":
                return 2000;
            case "major":
                return 1000;
            case "moderate":
                return 500;
            case "minor":
                return 200;
        }
    }

    private getExpectedZoneTime(zone: TradingZone): number {
        // Expected time based on zone type (accumulation takes longer than distribution)
        const baseTime = zone.type === "accumulation" ? 3600000 : 1800000; // 1 hour vs 30 min

        // Adjust for significance
        switch (zone.significance) {
            case "institutional":
                return baseTime * 2;
            case "major":
                return baseTime * 1.5;
            case "moderate":
                return baseTime;
            case "minor":
                return baseTime * 0.5;
        }
    }

    // Public query methods
    public getActiveZones(symbol?: string): TradingZone[] {
        const zones = Array.from(this.activeZones.values());
        return symbol ? zones.filter((z) => z.symbol === symbol) : zones;
    }

    public getZone(zoneId: string): TradingZone | undefined {
        return this.activeZones.get(zoneId);
    }

    public getZonesNearPrice(
        symbol: string,
        price: number,
        tolerance: number = 0.01
    ): TradingZone[] {
        const activeZones = this.getActiveZones(symbol);

        this.logger.debug("Zone proximity search initiated", {
            component: "ZoneManager",
            symbol,
            price,
            tolerance,
            activeZoneCount: activeZones.length,
        });

        return activeZones.filter((zone) => {
            const priceDistance =
                price > 0
                    ? Math.abs(price - zone.priceRange.center) / price
                    : 0;

            const isNearby = priceDistance <= tolerance;

            // Zone proximity analysis completed

            return isNearby;
        });
    }

    public getCompletedZones(
        symbol: string,
        timeWindow?: number
    ): TradingZone[] {
        const symbolHistory = this.zoneHistory.get(symbol) || [];

        if (!timeWindow) return symbolHistory;

        const cutoff = Date.now() - timeWindow;
        return symbolHistory.filter(
            (zone) => (zone.endTime || zone.startTime) > cutoff
        );
    }

    public queryZones(options: ZoneQueryOptions): TradingZone[] {
        let zones =
            options.isActive !== false
                ? this.getActiveZones(options.symbol)
                : this.getCompletedZones(options.symbol || "", options.maxAge);

        if (options.type) {
            zones = zones.filter((z) => z.type === options.type);
        }

        if (options.minStrength !== undefined) {
            zones = zones.filter((z) => z.strength >= options.minStrength!);
        }

        if (options.nearPrice) {
            const { price, tolerance } = options.nearPrice;
            zones = zones.filter((zone) => {
                const priceDistance =
                    price > 0
                        ? Math.abs(price - zone.priceRange.center) / price
                        : 0;
                return priceDistance <= tolerance;
            });
        }

        return zones;
    }

    public getZoneStatistics(): {
        activeZones: number;
        completedZones: number;
        avgZoneStrength: number;
        avgZoneDuration: number;
        zonesByType: Record<string, number>;
        zonesBySignificance: Record<string, number>;
    } {
        const activeZones = Array.from(this.activeZones.values());
        const allCompletedZones = this.completedZones;

        const allZones = [...activeZones, ...allCompletedZones];

        return {
            activeZones: activeZones.length,
            completedZones: allCompletedZones.length,
            avgZoneStrength:
                allZones.length > 0
                    ? allZones.reduce((sum, z) => sum + z.strength, 0) /
                      allZones.length
                    : 0,
            avgZoneDuration:
                allZones.length > 0
                    ? allZones.reduce((sum, z) => sum + z.timeInZone, 0) /
                      allZones.length
                    : 0,
            zonesByType: allZones.reduce(
                (acc, z) => {
                    acc[z.type] = (acc[z.type] || 0) + 1;
                    return acc;
                },
                {} as Record<string, number>
            ),
            zonesBySignificance: allZones.reduce(
                (acc, z) => {
                    acc[z.significance] = (acc[z.significance] || 0) + 1;
                    return acc;
                },
                {} as Record<string, number>
            ),
        };
    }

    /**
     * Enhanced memory management cleanup for zone data
     */
    public cleanup(maxCompletedZones: number = 100): void {
        // Clean up old completed zones to prevent memory accumulation
        if (this.completedZones.length > maxCompletedZones) {
            // Keep only the most recent zones
            const toRemove = this.completedZones.length - maxCompletedZones;
            this.completedZones = this.completedZones.filter(
                (_, index) => index >= toRemove
            );

            this.logger.info(
                "ZoneManager cleanup: removed old completed zones",
                {
                    component: "ZoneManager",
                    removedCount: toRemove,
                    remainingCount: this.completedZones.length,
                }
            );
        }

        // Clean up very old zone history entries
        const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

        for (const [symbol, history] of this.zoneHistory) {
            const filteredHistory = history.filter(
                (zone) => (zone.endTime || zone.startTime) > oneWeekAgo
            );

            if (filteredHistory.length !== history.length) {
                this.zoneHistory.set(symbol, filteredHistory);
                this.logger.info(
                    "ZoneManager cleanup: removed old zone history",
                    {
                        component: "ZoneManager",
                        symbol,
                        removedCount: history.length - filteredHistory.length,
                        remainingCount: filteredHistory.length,
                    }
                );
            }
        }
    }
}
