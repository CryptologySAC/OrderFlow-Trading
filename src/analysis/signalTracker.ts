// src/analysis/signalTracker.ts

import { EventEmitter } from "events";
import { Logger } from "../infrastructure/logger.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import type { IPipelineStorage } from "../storage/pipelineStorage.js";
import type { ConfirmedSignal, SignalType } from "../types/signalTypes.js";

export interface MarketContext {
    timestamp: number;
    price: number;

    // Volume context
    currentVolume: number;
    avgVolume24h: number;
    volumeRatio: number;

    // Volatility context
    recentVolatility: number;
    normalizedVolatility: number;

    // Liquidity context
    bidAskSpread: number;
    bidDepth: number;
    askDepth: number;
    liquidityRatio: number;

    // Trend context
    trend5min: "up" | "down" | "sideways";
    trend15min: "up" | "down" | "sideways";
    trend1hour: "up" | "down" | "sideways";
    trendAlignment: number;

    // Support/Resistance context
    distanceFromSupport: number;
    distanceFromResistance: number;
    nearKeyLevel: boolean;

    // Market regime
    regime:
        | "bull_trending"
        | "bear_trending"
        | "ranging"
        | "breakout"
        | "volatile";
    regimeConfidence: number;
}

export interface SignalOutcome {
    signalId: string;
    signalType: string;
    detectorId: string;

    // Entry data
    entryPrice: number;
    entryTime: number;
    originalConfidence: number;

    // Performance tracking
    priceAfter1min?: number;
    priceAfter5min?: number;
    priceAfter15min?: number;
    priceAfter1hour?: number;

    // Outcome metrics
    maxFavorableMove: number;
    maxAdverseMove: number;
    timeToMaxFavorable?: number;
    timeToMaxAdverse?: number;

    // Final classification
    outcome: "success" | "failure" | "mixed" | "timeout" | "pending";
    finalizedAt?: number;

    // Market context at signal time
    marketContext: MarketContext;

    // Performance metrics
    currentPrice?: number;
    currentReturn?: number;
    lastUpdated: number;
    isActive?: boolean;
}

export interface PerformanceMetrics {
    timeWindow: number;
    totalSignals: number;
    activeSignals: number;
    completedSignals: number;

    // Overall performance
    overallSuccessRate: number;
    avgReturnPerSignal: number;
    totalReturn: number;

    // Risk metrics
    maxDrawdown: number;
    avgDrawdown: number;
    sharpeRatio: number;
    winRate: number;

    // Timing metrics
    avgTimeToSuccess: number;
    avgTimeToFailure: number;

    // By signal type
    performanceByType: Record<
        string,
        {
            count: number;
            successRate: number;
            avgReturn: number;
        }
    >;

    // By detector
    performanceByDetector: Record<
        string,
        {
            count: number;
            successRate: number;
            avgReturn: number;
        }
    >;
}

export interface FailedSignalAnalysis {
    signalId: string;
    signalType: SignalType;
    detectorId: string;
    failureReason: string;

    // Warning signals that were present
    warningSignals: {
        lowVolume: boolean;
        weakConfirmation: boolean;
        conflictingSignals: boolean;
        poorMarketConditions: boolean;
        recentFailuresNearby: boolean;
        extremeConfidence: boolean;
        unusualSpread: boolean;
    };

    // Actual price action analysis
    actualPriceAction: {
        direction: "opposite" | "sideways" | "choppy";
        magnitude: number;
        timeToFailure: number;
        maxDrawdown: number;
    };

    // Avoidability analysis
    avoidability: {
        score: number; // 0-1 scale, how avoidable this failure was
        preventionMethod: string;
        confidenceReduction: number;
        filterSuggestion: string;
    };

    // Market context
    marketContextAtEntry: MarketContext;
    marketContextAtFailure: MarketContext;
}

export interface SignalTrackerConfig {
    signalTimeoutMs: number; // How long to track signals (default: 1 hour)
    priceUpdateIntervalMs: number; // How often to update prices (default: 1 minute)
    maxActiveSignals: number; // Max signals to track simultaneously (default: 1000)
    successThreshold: number; // Return threshold for success (default: 0.002 = 0.2%)
    failureThreshold: number; // Return threshold for failure (default: -0.001 = -0.1%)
}

/**
 * SignalTracker tracks signal outcomes over time to enable performance analysis.
 * It monitors price movements after signal generation and classifies outcomes.
 */
export class SignalTracker extends EventEmitter {
    private readonly config: Required<SignalTrackerConfig>;
    private readonly activeSignals = new Map<string, SignalOutcome>();
    private readonly completedSignals: SignalOutcome[] = [];
    private readonly maxCompletedSignals = 10000; // Keep last 10k completed signals in memory

    private priceUpdateInterval?: NodeJS.Timeout;

    constructor(
        private readonly logger: Logger,
        private readonly metricsCollector: MetricsCollector,
        private readonly storage: IPipelineStorage,
        config: Partial<SignalTrackerConfig> = {}
    ) {
        super();

        this.config = {
            signalTimeoutMs: config.signalTimeoutMs ?? 3600000, // 1 hour
            priceUpdateIntervalMs: config.priceUpdateIntervalMs ?? 60000, // 1 minute
            maxActiveSignals: config.maxActiveSignals ?? 1000,
            successThreshold: config.successThreshold ?? 0.002, // 0.2%
            failureThreshold: config.failureThreshold ?? -0.001, // -0.1%
            ...config,
        };

        this.logger.info("SignalTracker initialized", {
            component: "SignalTracker",
            config: this.config,
        });

        this.setupMetrics();
        this.startPeriodicCleanup();
    }

    /**
     * Track a new signal generation
     */
    public onSignalGenerated(
        signal: ConfirmedSignal,
        marketContext: MarketContext
    ): void {
        try {
            // Check if we're at max capacity
            if (this.activeSignals.size >= this.config.maxActiveSignals) {
                this.logger.warn(
                    "Maximum active signals reached, skipping tracking",
                    {
                        component: "SignalTracker",
                        signalId: signal.id,
                        activeCount: this.activeSignals.size,
                        maxActive: this.config.maxActiveSignals,
                    }
                );
                return;
            }

            const signalOutcome: SignalOutcome = {
                signalId: signal.id,
                signalType: signal.originalSignals[0]?.type || "unknown",
                detectorId: signal.originalSignals[0]?.detectorId || "unknown",
                entryPrice: signal.finalPrice,
                entryTime: signal.confirmedAt,
                originalConfidence: signal.confidence,
                maxFavorableMove: 0,
                maxAdverseMove: 0,
                outcome: "pending",
                marketContext,
                lastUpdated: Date.now(),
            };

            this.activeSignals.set(signal.id, signalOutcome);

            // Save to storage
            //TODO void this.storage.saveSignalOutcome(signalOutcome);

            // Update metrics
            this.metricsCollector.incrementCounter(
                "signal_tracker_signals_started_total",
                1,
                {
                    signal_type: signalOutcome.signalType,
                    detector_id: signalOutcome.detectorId,
                }
            );

            this.metricsCollector.setGauge(
                "signal_tracker_active_signals",
                this.activeSignals.size
            );

            this.logger.info("Signal tracking started", {
                component: "SignalTracker",
                signalId: signal.id,
                signalType: signalOutcome.signalType,
                detectorId: signalOutcome.detectorId,
                entryPrice: signalOutcome.entryPrice,
                activeSignals: this.activeSignals.size,
            });

            this.emit("signalTrackingStarted", signalOutcome);
        } catch (error) {
            this.logger.error("Failed to start signal tracking", {
                component: "SignalTracker",
                signalId: signal.id,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Update signal with market price movements
     */
    public updateSignalOutcome(
        signalIdOrAll: string,
        currentPrice: number,
        timestamp: number
    ): void {
        try {
            const signalsToUpdate =
                signalIdOrAll === "ALL_ACTIVE"
                    ? Array.from(this.activeSignals.values())
                    : ([this.activeSignals.get(signalIdOrAll)].filter(
                          Boolean
                      ) as SignalOutcome[]);

            for (const signalOutcome of signalsToUpdate) {
                this.updateSingleSignalOutcome(
                    signalOutcome,
                    currentPrice,
                    timestamp
                );
            }
        } catch (error) {
            this.logger.error("Failed to update signal outcomes", {
                component: "SignalTracker",
                signalId: signalIdOrAll,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private updateSingleSignalOutcome(
        signalOutcome: SignalOutcome,
        currentPrice: number,
        timestamp: number
    ): void {
        const timeElapsed = timestamp - signalOutcome.entryTime;
        const priceChange = currentPrice - signalOutcome.entryPrice;
        const returnPct = priceChange / signalOutcome.entryPrice;

        // Update current metrics
        signalOutcome.currentPrice = currentPrice;
        signalOutcome.currentReturn = returnPct;
        signalOutcome.lastUpdated = timestamp;

        // Update max moves
        if (returnPct > signalOutcome.maxFavorableMove) {
            signalOutcome.maxFavorableMove = returnPct;
            signalOutcome.timeToMaxFavorable = timeElapsed;
        }
        if (returnPct < signalOutcome.maxAdverseMove) {
            signalOutcome.maxAdverseMove = returnPct;
            signalOutcome.timeToMaxAdverse = timeElapsed;
        }

        // Update time-based price snapshots
        if (timeElapsed >= 60000 && !signalOutcome.priceAfter1min) {
            // 1 minute
            signalOutcome.priceAfter1min = currentPrice;
        }
        if (timeElapsed >= 300000 && !signalOutcome.priceAfter5min) {
            // 5 minutes
            signalOutcome.priceAfter5min = currentPrice;
        }
        if (timeElapsed >= 900000 && !signalOutcome.priceAfter15min) {
            // 15 minutes
            signalOutcome.priceAfter15min = currentPrice;
        }
        if (timeElapsed >= 3600000 && !signalOutcome.priceAfter1hour) {
            // 1 hour
            signalOutcome.priceAfter1hour = currentPrice;
        }

        // Check if signal should be finalized
        const shouldFinalize = this.shouldFinalizeSignal(
            signalOutcome,
            timeElapsed,
            returnPct
        );
        if (shouldFinalize) {
            this.finalizeSignalOutcome(signalOutcome.signalId, shouldFinalize);
        } else {
            // Update storage with current state
            // TODO void this.storage.updateSignalOutcome(signalOutcome.signalId, {
            /*     currentPrice: signalOutcome.currentPrice,
                currentReturn: signalOutcome.currentReturn,
                maxFavorableMove: signalOutcome.maxFavorableMove,
                maxAdverseMove: signalOutcome.maxAdverseMove,
                timeToMaxFavorable: signalOutcome.timeToMaxFavorable,
                timeToMaxAdverse: signalOutcome.timeToMaxAdverse,
                priceAfter1min: signalOutcome.priceAfter1min,
                priceAfter5min: signalOutcome.priceAfter5min,
                priceAfter15min: signalOutcome.priceAfter15min,
                priceAfter1hour: signalOutcome.priceAfter1hour,
                lastUpdated: signalOutcome.lastUpdated,
            });*/
        }
    }

    private shouldFinalizeSignal(
        signalOutcome: SignalOutcome,
        timeElapsed: number,
        returnPct: number
    ): "success" | "failure" | "timeout" | null {
        // Check for timeout
        if (timeElapsed >= this.config.signalTimeoutMs) {
            return "timeout";
        }

        // Check for success threshold
        if (returnPct >= this.config.successThreshold) {
            return "success";
        }

        // Check for failure threshold
        if (returnPct <= this.config.failureThreshold) {
            return "failure";
        }

        return null;
    }

    /**
     * Mark signal as complete and classify outcome
     */
    public finalizeSignalOutcome(
        signalId: string,
        finalClassification: "success" | "failure" | "mixed" | "timeout"
    ): void {
        try {
            const signalOutcome = this.activeSignals.get(signalId);
            if (!signalOutcome) {
                this.logger.warn("Cannot finalize unknown signal", {
                    component: "SignalTracker",
                    signalId,
                });
                return;
            }

            // Update outcome
            signalOutcome.outcome = finalClassification;
            signalOutcome.finalizedAt = Date.now();

            // Move from active to completed
            this.activeSignals.delete(signalId);
            this.completedSignals.push(signalOutcome);

            // Maintain memory limits
            if (this.completedSignals.length > this.maxCompletedSignals) {
                this.completedSignals.shift();
            }

            // Update storage
            //TODO void this.storage.updateSignalOutcome(signalId, {
            //    outcome: signalOutcome.outcome,
            //    finalizedAt: signalOutcome.finalizedAt,
            //});

            // Update metrics
            this.metricsCollector.incrementCounter(
                "signal_tracker_signals_completed_total",
                1,
                {
                    signal_type: signalOutcome.signalType,
                    detector_id: signalOutcome.detectorId,
                    outcome: finalClassification,
                }
            );

            this.metricsCollector.setGauge(
                "signal_tracker_active_signals",
                this.activeSignals.size
            );

            this.metricsCollector.recordHistogram(
                "signal_tracker_signal_duration_ms",
                (signalOutcome.finalizedAt || Date.now()) -
                    signalOutcome.entryTime,
                {
                    signal_type: signalOutcome.signalType,
                    outcome: finalClassification,
                }
            );

            if (signalOutcome.currentReturn !== undefined) {
                this.metricsCollector.recordHistogram(
                    "signal_tracker_signal_return",
                    signalOutcome.currentReturn,
                    {
                        signal_type: signalOutcome.signalType,
                        outcome: finalClassification,
                    }
                );
            }

            this.logger.info("Signal tracking completed", {
                component: "SignalTracker",
                signalId,
                outcome: finalClassification,
                duration:
                    (signalOutcome.finalizedAt || Date.now()) -
                    signalOutcome.entryTime,
                finalReturn: signalOutcome.currentReturn,
                maxFavorableMove: signalOutcome.maxFavorableMove,
                maxAdverseMove: signalOutcome.maxAdverseMove,
            });

            this.emit("signalTrackingCompleted", signalOutcome);
        } catch (error) {
            this.logger.error("Failed to finalize signal outcome", {
                component: "SignalTracker",
                signalId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Get performance metrics for a time window
     */
    public getPerformanceMetrics(
        timeWindow: number = 86400000
    ): PerformanceMetrics {
        const cutoffTime = Date.now() - timeWindow;

        // Get relevant signals (completed + active from time window)
        const relevantCompleted = this.completedSignals.filter(
            (s) => s.entryTime > cutoffTime
        );
        const relevantActive = Array.from(this.activeSignals.values()).filter(
            (s) => s.entryTime > cutoffTime
        );
        const allRelevant = [...relevantCompleted, ...relevantActive];

        const totalSignals = allRelevant.length;
        const activeSignals = relevantActive.length;
        const completedSignals = relevantCompleted.length;

        if (totalSignals === 0) {
            return this.getEmptyPerformanceMetrics(timeWindow);
        }

        // Calculate overall performance
        const successfulSignals = relevantCompleted.filter(
            (s) => s.outcome === "success"
        );
        const overallSuccessRate =
            completedSignals > 0
                ? successfulSignals.length / completedSignals
                : 0;

        // Calculate returns
        const signalsWithReturns = allRelevant.filter(
            (s) => s.currentReturn !== undefined
        );
        const totalReturn = signalsWithReturns.reduce(
            (sum, s) => sum + (s.currentReturn || 0),
            0
        );
        const avgReturnPerSignal =
            signalsWithReturns.length > 0
                ? totalReturn / signalsWithReturns.length
                : 0;

        // Calculate risk metrics
        const returns = signalsWithReturns.map((s) => s.currentReturn || 0);
        const maxDrawdown = Math.min(...returns.map((r) => Math.min(r, 0)));
        const avgDrawdown =
            returns.filter((r) => r < 0).reduce((sum, r) => sum + r, 0) /
            Math.max(returns.filter((r) => r < 0).length, 1);
        const winRate =
            returns.filter((r) => r > 0).length / Math.max(returns.length, 1);

        // Calculate Sharpe ratio (simplified)
        const avgReturn =
            returns.reduce((sum, r) => sum + r, 0) /
            Math.max(returns.length, 1);
        const returnStdDev = Math.sqrt(
            returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
                Math.max(returns.length, 1)
        );
        const sharpeRatio = returnStdDev > 0 ? avgReturn / returnStdDev : 0;

        // Timing metrics
        const successfulWithTiming = successfulSignals.filter(
            (s) => s.timeToMaxFavorable !== undefined
        );
        const failedWithTiming = relevantCompleted.filter(
            (s) => s.outcome === "failure" && s.timeToMaxAdverse !== undefined
        );
        const avgTimeToSuccess =
            successfulWithTiming.length > 0
                ? successfulWithTiming.reduce(
                      (sum, s) => sum + (s.timeToMaxFavorable || 0),
                      0
                  ) / successfulWithTiming.length
                : 0;
        const avgTimeToFailure =
            failedWithTiming.length > 0
                ? failedWithTiming.reduce(
                      (sum, s) => sum + (s.timeToMaxAdverse || 0),
                      0
                  ) / failedWithTiming.length
                : 0;

        // Performance by type
        const performanceByType: Record<
            string,
            { count: number; successRate: number; avgReturn: number }
        > = {};
        const typeGroups = this.groupBy(allRelevant, (s) => s.signalType);
        for (const [type, signals] of typeGroups) {
            const completedOfType = signals.filter(
                (s) => s.outcome !== "pending"
            );
            const successfulOfType = signals.filter(
                (s) => s.outcome === "success"
            );
            const withReturnsOfType = signals.filter(
                (s) => s.currentReturn !== undefined
            );

            performanceByType[type] = {
                count: signals.length,
                successRate:
                    completedOfType.length > 0
                        ? successfulOfType.length / completedOfType.length
                        : 0,
                avgReturn:
                    withReturnsOfType.length > 0
                        ? withReturnsOfType.reduce(
                              (sum, s) => sum + (s.currentReturn || 0),
                              0
                          ) / withReturnsOfType.length
                        : 0,
            };
        }

        // Performance by detector
        const performanceByDetector: Record<
            string,
            { count: number; successRate: number; avgReturn: number }
        > = {};
        const detectorGroups = this.groupBy(allRelevant, (s) => s.detectorId);
        for (const [detector, signals] of detectorGroups) {
            const completedOfDetector = signals.filter(
                (s) => s.outcome !== "pending"
            );
            const successfulOfDetector = signals.filter(
                (s) => s.outcome === "success"
            );
            const withReturnsOfDetector = signals.filter(
                (s) => s.currentReturn !== undefined
            );

            performanceByDetector[detector] = {
                count: signals.length,
                successRate:
                    completedOfDetector.length > 0
                        ? successfulOfDetector.length /
                          completedOfDetector.length
                        : 0,
                avgReturn:
                    withReturnsOfDetector.length > 0
                        ? withReturnsOfDetector.reduce(
                              (sum, s) => sum + (s.currentReturn || 0),
                              0
                          ) / withReturnsOfDetector.length
                        : 0,
            };
        }

        return {
            timeWindow,
            totalSignals,
            activeSignals,
            completedSignals,
            overallSuccessRate,
            avgReturnPerSignal,
            totalReturn,
            maxDrawdown,
            avgDrawdown,
            sharpeRatio,
            winRate,
            avgTimeToSuccess,
            avgTimeToFailure,
            performanceByType,
            performanceByDetector,
        };
    }

    /**
     * Get failed signals for analysis
     */
    public getFailedSignals(timeWindow: number = 86400000): SignalOutcome[] {
        const cutoffTime = Date.now() - timeWindow;
        return this.completedSignals.filter(
            (s) => s.entryTime > cutoffTime && s.outcome === "failure"
        );
    }

    /**
     * Get all signal outcomes for a time window
     */
    public getSignalOutcomes(timeWindow: number = 86400000): SignalOutcome[] {
        const cutoffTime = Date.now() - timeWindow;
        const relevantCompleted = this.completedSignals.filter(
            (s) => s.entryTime > cutoffTime
        );
        const relevantActive = Array.from(this.activeSignals.values()).filter(
            (s) => s.entryTime > cutoffTime
        );
        return [...relevantCompleted, ...relevantActive];
    }

    private getEmptyPerformanceMetrics(timeWindow: number): PerformanceMetrics {
        return {
            timeWindow,
            totalSignals: 0,
            activeSignals: 0,
            completedSignals: 0,
            overallSuccessRate: 0,
            avgReturnPerSignal: 0,
            totalReturn: 0,
            maxDrawdown: 0,
            avgDrawdown: 0,
            sharpeRatio: 0,
            winRate: 0,
            avgTimeToSuccess: 0,
            avgTimeToFailure: 0,
            performanceByType: {},
            performanceByDetector: {},
        };
    }

    private groupBy<T, K>(array: T[], keyFn: (item: T) => K): Map<K, T[]> {
        const groups = new Map<K, T[]>();
        for (const item of array) {
            const key = keyFn(item);
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key)!.push(item);
        }
        return groups;
    }

    private setupMetrics(): void {
        try {
            this.metricsCollector.createCounter(
                "signal_tracker_signals_started_total",
                "Total signals started tracking",
                ["signal_type", "detector_id"]
            );

            this.metricsCollector.createCounter(
                "signal_tracker_signals_completed_total",
                "Total signals completed tracking",
                ["signal_type", "detector_id", "outcome"]
            );

            this.metricsCollector.createGauge(
                "signal_tracker_active_signals",
                "Number of actively tracked signals"
            );

            this.metricsCollector.createHistogram(
                "signal_tracker_signal_duration_ms",
                "Signal tracking duration",
                ["signal_type", "outcome"],
                [60000, 300000, 900000, 1800000, 3600000, 7200000] // 1min to 2hr
            );

            this.metricsCollector.createHistogram(
                "signal_tracker_signal_return",
                "Signal return percentage",
                ["signal_type", "outcome"],
                [-0.05, -0.02, -0.01, -0.005, 0, 0.005, 0.01, 0.02, 0.05] // -5% to +5%
            );

            this.logger.debug("SignalTracker metrics initialized", {
                component: "SignalTracker",
            });
        } catch (error) {
            this.logger.error("Failed to setup SignalTracker metrics", {
                component: "SignalTracker",
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private startPeriodicCleanup(): void {
        // Clean up old completed signals every 10 minutes
        setInterval(() => {
            this.cleanupOldSignals();
        }, 600000); // 10 minutes

        // Check for timed out active signals every 5 minutes
        setInterval(() => {
            this.checkForTimeouts();
        }, 300000); // 5 minutes
    }

    private cleanupOldSignals(): void {
        const cutoffTime = Date.now() - this.config.signalTimeoutMs * 2; // Keep signals for 2x timeout period

        const initialCount = this.completedSignals.length;
        let removedCount = 0;

        // Remove old completed signals
        for (let i = this.completedSignals.length - 1; i >= 0; i--) {
            if (this.completedSignals[i].entryTime < cutoffTime) {
                this.completedSignals.splice(i, 1);
                removedCount++;
            }
        }

        if (removedCount > 0) {
            this.logger.debug("Cleaned up old signal outcomes", {
                component: "SignalTracker",
                removedCount,
                remainingCount: this.completedSignals.length,
                initialCount,
            });
        }
    }

    private checkForTimeouts(): void {
        const now = Date.now();
        const timeoutSignals: string[] = [];

        for (const [signalId, outcome] of this.activeSignals) {
            if (now - outcome.entryTime >= this.config.signalTimeoutMs) {
                timeoutSignals.push(signalId);
            }
        }

        for (const signalId of timeoutSignals) {
            this.finalizeSignalOutcome(signalId, "timeout");
        }

        if (timeoutSignals.length > 0) {
            this.logger.info("Finalized timed out signals", {
                component: "SignalTracker",
                timeoutCount: timeoutSignals.length,
                timeoutAfterMs: this.config.signalTimeoutMs,
            });
        }
    }

    /**
     * Get current status of the signal tracker
     */
    public getStatus(): {
        activeSignals: number;
        completedSignals: number;
        config: SignalTrackerConfig;
    } {
        return {
            activeSignals: this.activeSignals.size,
            completedSignals: this.completedSignals.length,
            config: this.config,
        };
    }

    /**
     * Shutdown the signal tracker
     */
    public shutdown(): void {
        if (this.priceUpdateInterval) {
            clearInterval(this.priceUpdateInterval);
        }

        // Finalize all active signals as timeout
        const activeSignalIds = Array.from(this.activeSignals.keys());
        for (const signalId of activeSignalIds) {
            this.finalizeSignalOutcome(signalId, "timeout");
        }

        this.logger.info("SignalTracker shutdown completed", {
            component: "SignalTracker",
            finalizedSignals: activeSignalIds.length,
        });
    }
}
