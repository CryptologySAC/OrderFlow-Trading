// src/trading/zoneManager.ts

import { EventEmitter } from "events";
import {
    AccumulationZone,
    ZoneUpdate,
    ZoneDetectionData,
    ZoneDetectorConfig,
    ZoneQueryOptions,
} from "../types/zoneTypes.js";
import type { EnrichedTradeEvent } from "../types/marketEvents.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";

export class ZoneManager extends EventEmitter {
    private activeZones = new Map<string, AccumulationZone>();
    private completedZones: AccumulationZone[] = [];
    private zoneHistory = new Map<string, AccumulationZone[]>();

    // Zone configuration
    private readonly config: ZoneDetectorConfig;

    constructor(
        config: Partial<ZoneDetectorConfig>,
        private logger: ILogger,
        private metricsCollector: MetricsCollector
    ) {
        super();

        this.config = {
            maxActiveZones: config.maxActiveZones ?? 5,
            zoneTimeoutMs: config.zoneTimeoutMs ?? 7200000, // 2 hours
            minZoneVolume: config.minZoneVolume ?? 100,
            maxZoneWidth: config.maxZoneWidth ?? 0.02, // 2%
            minZoneStrength: config.minZoneStrength ?? 0.4,
            completionThreshold: config.completionThreshold ?? 0.8,
            strengthChangeThreshold: config.strengthChangeThreshold ?? 0.1,
            minCandidateDuration: config.minCandidateDuration ?? 180_000,
            maxPriceDeviation: config.maxPriceDeviation ?? 0.005,
            minTradeCount: config.minTradeCount ?? 10,
            minBuyRatio: config.minBuyRatio,
            minSellRatio: config.minSellRatio,
        };

        // Cleanup old zones periodically
        setInterval(() => this.cleanupExpiredZones(), 300000); // Every 5 minutes

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
    ): AccumulationZone {
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

        const zone: AccumulationZone = {
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
            totalVolume: initialTrade.quantity,
            averageOrderSize: initialTrade.quantity,
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
                    volume: initialTrade.quantity,
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
        if (!zone || !zone.isActive) return null;

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
    private calculateZoneStrength(zone: AccumulationZone): number {
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

    private calculateZoneCompletion(zone: AccumulationZone): number {
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

    private calculateZoneConfidence(zone: AccumulationZone): number {
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
        zone: AccumulationZone,
        trade: EnrichedTradeEvent
    ): AccumulationZone["supportingFactors"] {
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
        zone: AccumulationZone
    ): boolean {
        return (
            trade.price >= zone.priceRange.min &&
            trade.price <= zone.priceRange.max
        );
    }

    private classifySignificance(
        detection: ZoneDetectionData
    ): AccumulationZone["significance"] {
        const volume = detection.totalVolume;
        const orderSize = detection.averageOrderSize;

        if (volume > 1000 && orderSize > 50) return "institutional";
        if (volume > 500 && orderSize > 20) return "major";
        if (volume > 200) return "moderate";
        return "minor";
    }

    private calculateUpdateSignificance(
        strengthChange: number,
        zone: AccumulationZone
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

    private moveToCompleted(zone: AccumulationZone): void {
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

    private getExpectedZoneVolume(zone: AccumulationZone): number {
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

    private getExpectedZoneTime(zone: AccumulationZone): number {
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
    public getActiveZones(symbol?: string): AccumulationZone[] {
        const zones = Array.from(this.activeZones.values());
        return symbol ? zones.filter((z) => z.symbol === symbol) : zones;
    }

    public getZone(zoneId: string): AccumulationZone | undefined {
        return this.activeZones.get(zoneId);
    }

    public getZonesNearPrice(
        symbol: string,
        price: number,
        tolerance: number = 0.01
    ): AccumulationZone[] {
        return this.getActiveZones(symbol).filter((zone) => {
            const priceDistance =
                price > 0
                    ? Math.abs(price - zone.priceRange.center) / price
                    : 0;
            return priceDistance <= tolerance;
        });
    }

    public getCompletedZones(
        symbol: string,
        timeWindow?: number
    ): AccumulationZone[] {
        const symbolHistory = this.zoneHistory.get(symbol) || [];

        if (!timeWindow) return symbolHistory;

        const cutoff = Date.now() - timeWindow;
        return symbolHistory.filter(
            (zone) => (zone.endTime || zone.startTime) > cutoff
        );
    }

    public queryZones(options: ZoneQueryOptions): AccumulationZone[] {
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
}
