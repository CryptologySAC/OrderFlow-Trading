// src/indicators/supportResistanceDetector.ts

import type { EnrichedTradeEvent } from "../types/marketEvents.js";
import { BaseDetector } from "./base/baseDetector.js";
import { WorkerLogger } from "../multithreading/workerLogger";
import type { MetricsCollector } from "../infrastructure/metricsCollector.js";
import type { ISignalLogger } from "../services/signalLogger.js";
import { SpoofingDetector } from "../services/spoofingDetector.js";
import type {
    DetectorCallback,
    BaseDetectorSettings,
    DetectorFeatures,
} from "./interfaces/detectorInterfaces.js";
import type { SignalType } from "../types/signalTypes.js";

export interface SupportResistanceLevel {
    id: string;
    price: number;
    type: "support" | "resistance";
    strength: number; // 0-1, based on number of touches and volume
    firstDetected: number; // timestamp
    lastTouched: number; // timestamp
    touchCount: number;
    touches: Array<{
        timestamp: number;
        price: number;
        volume: number;
        wasRejection: boolean; // true if price bounced off level
    }>;
    volumeAtLevel: number; // total volume traded at this level
    roleReversals: Array<{
        timestamp: number;
        fromType: "support" | "resistance";
        toType: "support" | "resistance";
    }>;
    hasBeenEmitted: boolean; // track if this level has already been signaled
    lastEmittedAt?: number; // timestamp of last emission
}

export interface SupportResistanceConfig {
    priceTolerancePercent: number; // How close prices need to be to same level
    minTouchCount: number; // Minimum touches to confirm level
    minStrength: number; // Minimum strength to emit level
    timeWindowMs: number; // How long to track levels
    volumeWeightFactor: number; // How much volume affects strength
    rejectionConfirmationTicks: number; // How many ticks for rejection confirmation
}

export class SupportResistanceDetector extends BaseDetector {
    protected readonly detectorType: SignalType =
        "support_resistance_level" as SignalType;
    private readonly config: SupportResistanceConfig;
    private readonly levels = new Map<string, SupportResistanceLevel>();
    private readonly recentTrades: EnrichedTradeEvent[] = [];
    private readonly maxTradeHistory = 1000;
    private lastDetectionRun = 0;
    private readonly detectionIntervalMs = 60000; // Only run detection every 1 minute

    constructor(
        id: string,
        callback: DetectorCallback,
        settings: BaseDetectorSettings &
            Partial<SupportResistanceConfig> & { features?: DetectorFeatures },
        logger: WorkerLogger,
        spoofingDetector: SpoofingDetector,
        metricsCollector: MetricsCollector,
        signalLogger?: ISignalLogger
    ) {
        super(
            id,
            callback,
            settings,
            logger,
            spoofingDetector,
            metricsCollector,
            signalLogger
        );

        this.config = {
            priceTolerancePercent: settings.priceTolerancePercent ?? 0.1, // 0.1% - wider tolerance
            minTouchCount: settings.minTouchCount ?? 5, // Require more touches
            minStrength: settings.minStrength ?? 0.7, // Higher strength threshold
            timeWindowMs: settings.timeWindowMs ?? 7200000, // 2 hours - longer window
            volumeWeightFactor: settings.volumeWeightFactor ?? 0.3,
            rejectionConfirmationTicks:
                settings.rejectionConfirmationTicks ?? 5,
        };

        this.logger.info("SupportResistanceDetector initialized", {
            symbol: this.symbol,
            config: this.config,
        });
    }

    protected onEnrichedTradeSpecific(event: EnrichedTradeEvent): void {
        this.detect(event);
    }

    public detect(event: EnrichedTradeEvent): void {
        // Add trade to history
        this.recentTrades.push(event);
        if (this.recentTrades.length > this.maxTradeHistory) {
            this.recentTrades.shift();
        }

        // Always check for level touches as this is important for updating existing levels
        this.checkLevelTouches(event);

        // Only run full detection periodically to reduce noise
        const now = Date.now();
        if (now - this.lastDetectionRun >= this.detectionIntervalMs) {
            this.lastDetectionRun = now;

            // Clean up old levels
            this.cleanupOldLevels(event.timestamp);

            // Detect new levels from price action
            this.detectNewLevels(event);

            // Update level strengths
            this.updateLevelStrengths();

            // Check for role reversals
            this.checkRoleReversals(event);

            // Emit significant levels
            this.emitSignificantLevels();
        }
    }

    private checkLevelTouches(event: EnrichedTradeEvent): void {
        const tolerance =
            event.price * (this.config.priceTolerancePercent / 100);

        for (const level of this.levels.values()) {
            const priceDiff = Math.abs(event.price - level.price);

            if (priceDiff <= tolerance) {
                // Check if this is a rejection (price bounced off level)
                const wasRejection = this.isRejection(event, level);

                level.touches.push({
                    timestamp: event.timestamp,
                    price: event.price,
                    volume: event.quantity,
                    wasRejection,
                });

                level.touchCount++;
                level.lastTouched = event.timestamp;
                level.volumeAtLevel += event.quantity;
            }
        }
    }

    private isRejection(
        event: EnrichedTradeEvent,
        level: SupportResistanceLevel
    ): boolean {
        // For now, use order type as a proxy - market orders often indicate rejection
        // In a full implementation, we'd wait for future trades to confirm
        if (level.type === "support" && !event.buyerIsMaker) {
            return true; // Buying at support suggests bounce
        }
        if (level.type === "resistance" && event.buyerIsMaker) {
            return true; // Selling at resistance suggests rejection
        }

        return false;
    }

    private detectNewLevels(event: EnrichedTradeEvent): void {
        // Look for potential new levels by finding price clusters
        const recentTrades = this.getRecentTrades(300000); // 5 minutes
        const priceClusters = this.findPriceClusters(recentTrades);

        this.logger.debug("Price clusters found for level detection", {
            clusterCount: priceClusters.length,
            clusters: priceClusters.map((c) => ({
                price: c.price,
                tradeCount: c.tradeCount,
                totalVolume: c.totalVolume,
                meetsMinTouchCount: c.tradeCount >= this.config.minTouchCount,
            })),
        });

        for (const cluster of priceClusters) {
            if (cluster.tradeCount >= this.config.minTouchCount) {
                const levelId = this.generateLevelId(cluster.price);

                if (!this.levels.has(levelId)) {
                    const level: SupportResistanceLevel = {
                        id: levelId,
                        price: cluster.price,
                        type: this.determineLevelType(cluster, event),
                        strength: 0,
                        firstDetected: event.timestamp,
                        lastTouched: event.timestamp,
                        touchCount: cluster.tradeCount,
                        touches: cluster.trades.map(
                            (t: EnrichedTradeEvent) => ({
                                timestamp: t.timestamp,
                                price: t.price,
                                volume: t.quantity,
                                wasRejection: false,
                            })
                        ),
                        volumeAtLevel: cluster.totalVolume,
                        roleReversals: [],
                        hasBeenEmitted: false,
                    };

                    this.levels.set(levelId, level);

                    this.logger.info("New support/resistance level detected", {
                        levelId,
                        price: level.price,
                        type: level.type,
                        touchCount: level.touchCount,
                        volume: level.volumeAtLevel,
                        strength: level.strength,
                        minStrengthRequired: this.config.minStrength,
                    });
                }
            }
        }
    }

    private findPriceClusters(trades: EnrichedTradeEvent[]): Array<{
        price: number;
        tradeCount: number;
        totalVolume: number;
        trades: EnrichedTradeEvent[];
    }> {
        const clusters: Map<number, EnrichedTradeEvent[]> = new Map();
        const tolerance = 0.01; // 1 cent clustering tolerance

        for (const trade of trades) {
            const clusterPrice =
                Math.round(trade.price / tolerance) * tolerance;

            if (!clusters.has(clusterPrice)) {
                clusters.set(clusterPrice, []);
            }
            clusters.get(clusterPrice)!.push(trade);
        }

        return Array.from(clusters.entries()).map(([price, clusterTrades]) => ({
            price,
            tradeCount: clusterTrades.length,
            totalVolume: clusterTrades.reduce(
                (sum, t: EnrichedTradeEvent) => sum + t.quantity,
                0
            ),
            trades: clusterTrades,
        }));
    }

    private determineLevelType(
        cluster: { price: number; trades: EnrichedTradeEvent[] },
        currentEvent: EnrichedTradeEvent
    ): "support" | "resistance" {
        // If current price is above the level, it's likely support
        // If current price is below the level, it's likely resistance
        if (currentEvent.price > cluster.price) {
            return "support";
        } else {
            return "resistance";
        }
    }

    private updateLevelStrengths(): void {
        for (const level of this.levels.values()) {
            // Calculate strength based on touch count, volume, and rejections
            const touchStrength = Math.min(level.touchCount / 5, 1); // Max at 5 touches (more sensitive)
            const volumeStrength = Math.min(level.volumeAtLevel / 500, 1); // Lower volume threshold
            const rejectionCount = level.touches.filter(
                (t) => t.wasRejection
            ).length;
            const rejectionStrength = Math.min(rejectionCount / 3, 1); // Max at 3 rejections (more sensitive)

            // Give more weight to touch count and rejections for price action significance
            level.strength =
                touchStrength * 0.5 +
                volumeStrength * this.config.volumeWeightFactor +
                rejectionStrength * 0.4;
        }
    }

    private checkRoleReversals(event: EnrichedTradeEvent): void {
        for (const level of this.levels.values()) {
            const timeSinceLastTouch = event.timestamp - level.lastTouched;

            // Only check for reversals on recently touched levels
            if (timeSinceLastTouch < 300000) {
                // 5 minutes
                const newType = this.determineLevelType(
                    { price: level.price, trades: [event] },
                    event
                );

                if (newType !== level.type) {
                    level.roleReversals.push({
                        timestamp: event.timestamp,
                        fromType: level.type,
                        toType: newType,
                    });

                    this.logger.info(
                        "Support/Resistance role reversal detected",
                        {
                            levelId: level.id,
                            price: level.price,
                            fromType: level.type,
                            toType: newType,
                            tradePrice: event.price,
                        }
                    );

                    level.type = newType;
                }
            }
        }
    }

    private emitSignificantLevels(): void {
        const now = Date.now();
        const reEmitCooldownMs = 300000; // 5 minutes between re-emissions

        for (const level of this.levels.values()) {
            if (
                level.strength >= this.config.minStrength &&
                level.touchCount >= this.config.minTouchCount
            ) {
                const shouldEmit =
                    !level.hasBeenEmitted || // Never emitted before
                    (level.lastEmittedAt &&
                        now - level.lastEmittedAt > reEmitCooldownMs && // Cooldown passed
                        level.roleReversals.some(
                            (r) => r.timestamp > (level.lastEmittedAt || 0)
                        )); // Role reversal since last emission

                if (shouldEmit) {
                    // Create a Detected object for the callback
                    const detectedSignal = {
                        id: level.id,
                        side:
                            level.type === "support"
                                ? "buy"
                                : ("sell" as "buy" | "sell"),
                        price: level.price,
                        trades: [], // Support/resistance doesn't have specific trades
                        totalAggressiveVolume: level.volumeAtLevel,
                        passiveVolume: 0, // Not applicable for support/resistance
                        zone: level.price,
                        refilled: false,
                        detectedAt: now,
                        detectorSource: "absorption" as const, // Closest match
                        metadata: {
                            level: level,
                            levelType: level.type,
                            strength: level.strength,
                            touchCount: level.touchCount,
                            volumeAtLevel: level.volumeAtLevel,
                            roleReversals: level.roleReversals.length,
                            firstDetected: level.firstDetected,
                            lastTouched: level.lastTouched,
                        },
                    };

                    // Use the callback to emit the signal
                    this.callback(detectedSignal);

                    // Also emit the event for WebSocket broadcasting
                    this.emit("supportResistanceLevel", {
                        type: "support_resistance_level",
                        data: level,
                        timestamp: new Date(),
                    });

                    // Mark as emitted
                    level.hasBeenEmitted = true;
                    level.lastEmittedAt = now;

                    this.logger.info("Support/Resistance level emitted", {
                        levelId: level.id,
                        price: level.price,
                        type: level.type,
                        strength: level.strength,
                        touchCount: level.touchCount,
                        isReEmission: level.lastEmittedAt ? true : false,
                    });
                }
            }
        }
    }

    private cleanupOldLevels(currentTimestamp: number): void {
        const cutoffTime = currentTimestamp - this.config.timeWindowMs;

        for (const [levelId, level] of this.levels.entries()) {
            if (level.lastTouched < cutoffTime) {
                this.levels.delete(levelId);
                this.logger.debug("Removed old support/resistance level", {
                    levelId,
                    price: level.price,
                    lastTouched: new Date(level.lastTouched),
                });
            }
        }
    }

    private getRecentTrades(windowMs: number): EnrichedTradeEvent[] {
        const cutoffTime = Date.now() - windowMs;
        return this.recentTrades.filter((t) => t.timestamp > cutoffTime);
    }

    private generateLevelId(price: number): string {
        return `sr_${Math.round(price * 100)}`;
    }

    public getLevels(): SupportResistanceLevel[] {
        return Array.from(this.levels.values());
    }

    public getStatus(): string {
        const levels = Array.from(this.levels.values());
        const strongLevels = levels.filter(
            (l) => l.strength >= this.config.minStrength
        );
        const recentReversals = levels.reduce((sum, l) => {
            const recentReversals = l.roleReversals.filter(
                (r) => Date.now() - r.timestamp < 3600000 // 1 hour
            );
            return sum + recentReversals.length;
        }, 0);

        return `support_resistance_level detector: ${JSON.stringify({
            activeLevels: levels.length,
            strongLevels: strongLevels.length,
            recentRoleReversals: recentReversals,
        })}`;
    }

    protected getSignalType(): SignalType {
        return this.detectorType;
    }
}
