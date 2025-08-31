// src/trading/signalManager.ts

import { EventEmitter } from "events";
import type {
    Signal,
    TradingSignalData,
    ProcessedSignal,
    SignalType,
    ConfirmedSignal,
} from "../types/signalTypes.js";
import { AnomalyDetector } from "../services/anomalyDetector.js";
import { AlertManager } from "../alerts/alertManager.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import { ThreadManager } from "../multithreading/threadManager.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import type { EnhancedMetrics } from "../infrastructure/metricsCollector.js";
import {
    calculateProfitTarget,
    calculateStopLoss,
} from "../utils/calculations.js";
import type {
    SignalTracker,
    PerformanceMetrics,
} from "../analysis/signalTracker.js";
import type { MarketContextCollector } from "../analysis/marketContextCollector.js";
import { Config } from "../core/config.js";
import { FinancialMath } from "../utils/financialMath.js";

export interface SignalManagerConfig {
    confidenceThreshold: number;
    signalTimeout: number;
    enableMarketHealthCheck: boolean;
    enableAlerts: boolean;
    maxQueueSize: number;
    processingBatchSize: number;
    backpressureThreshold: number;
    detectorThresholds: Record<string, number>;
    positionSizing: Record<string, number>;

    // 🔧 Enhanced backpressure configuration
    enableSignalPrioritization: boolean;
    adaptiveBatchSizing: boolean;
    maxAdaptiveBatchSize: number;
    minAdaptiveBatchSize: number;
    circuitBreakerThreshold: number;
    circuitBreakerResetMs: number;
    signalTypePriorities: Record<string, number>;
    adaptiveBackpressure: boolean;
    highPriorityBypassThreshold: number;

    // 🎯 Conflict resolution configuration
    conflictResolution: {
        enabled: boolean;
        strategy: "confidence_weighted" | "priority_based" | "market_context";
        minimumSeparationMs: number;
        contradictionPenaltyFactor: number;
        priceTolerance: number;
        volatilityNormalizationFactor: number;
    };
    signalPriorityMatrix: {
        highVolatility: Record<string, number>;
        lowVolatility: Record<string, number>;
        balanced: Record<string, number>;
    };

    // 🔧 Configurable parameters to eliminate magic numbers (REQUIRED)
    // Option B: Removed boost factors - detectors handle confidence internally
    priceTolerancePercent: number;
    signalThrottleMs: number;
    correlationWindowMs: number;
    maxHistorySize: number;
    defaultPriority: number;
    volatilityHighThreshold: number;
    volatilityLowThreshold: number;
    defaultLowVolatility: number;
    defaultVolatilityError: number;
    priorityQueueHighThreshold: number;
    backpressureYieldMs: number;
    marketVolatilityWeight: number;

    // RSI Dashboard Integration parameters
    rsiUpdateFrequency: number;
    maxRsiBacklogSize: number;
    maxSignalBacklogAgeMinutes: number;

    // Detector priorities (to eliminate magic numbers)
    accumulationDetectorPriority: number;
    distributionDetectorPriority: number;
}

interface SignalCorrelation {
    signalId: string;
    correlatedSignals: ProcessedSignal[];
    timestamp: number;
    strength: number;
}

interface SignalConflict {
    signal1: ProcessedSignal;
    signal2: ProcessedSignal;
    type: "opposite_direction" | "same_zone" | "timing_conflict";
    timestamp: number;
}

interface PrioritizedSignal {
    signal: ProcessedSignal;
    priority: number;
    enqueuedAt: number;
    processingAttempts: number;
}

interface CircuitBreakerState {
    isOpen: boolean;
    failureCount: number;
    lastFailureTime: number;
    nextRetryTime: number;
}

interface AdaptiveMetrics {
    avgProcessingTimeMs: number;
    queueThroughputPerSecond: number;
    recentProcessingTimes: number[];
    lastThroughputCalculation: number;
}

/**
 * Simplified SignalManager focused on signal coordination and market health gatekeeper.
 * Uses AnomalyDetector only for market health checks, not signal enhancement.
 * Implements backpressure management for high-frequency signal processing.
 */
export class SignalManager extends EventEmitter {
    private readonly config: Required<
        Omit<SignalManagerConfig, "conflictResolution" | "signalPriorityMatrix">
    > &
        Pick<
            SignalManagerConfig,
            "conflictResolution" | "signalPriorityMatrix"
        >;
    private readonly recentSignals = new Map<string, ProcessedSignal>();
    private readonly correlations = new Map<string, SignalCorrelation>();
    private readonly signalHistory: ProcessedSignal[] = [];
    private lastRejectReason?: string | undefined;

    // Keep track of signals for correlation analysis - configured values
    private readonly maxHistorySize: number;
    private readonly correlationWindowMs: number;

    // Signal throttling and deduplication - configured values
    private readonly recentTradingSignals = new Map<string, number>(); // signalKey -> timestamp
    private readonly signalThrottleMs: number;
    private readonly priceTolerancePercent: number;

    // Configurable parameters to eliminate magic numbers
    // Option B: Removed boost factors - detectors handle confidence internally
    // private readonly correlationBoostFactor: number;
    private readonly defaultPriority: number;
    private readonly volatilityHighThreshold: number;
    private readonly volatilityLowThreshold: number;
    // private readonly contextBoostHigh: number;
    // private readonly contextBoostLow: number;
    private readonly priorityQueueHighThreshold: number;

    // Enhanced backpressure management for high-frequency signal processing
    private signalQueue: PrioritizedSignal[] = [];
    private readonly droppedSignalCounts = new Map<string, number>(); // type -> count
    private isProcessing = false;
    private backpressureActive = false;

    // 🔧 Enhanced backpressure features
    private readonly circuitBreakers = new Map<string, CircuitBreakerState>(); // detectorId -> state
    private readonly adaptiveMetrics: AdaptiveMetrics = {
        avgProcessingTimeMs: 0,
        queueThroughputPerSecond: 0,
        recentProcessingTimes: [],
        lastThroughputCalculation: Date.now(),
    };
    private currentBatchSize: number = 10;
    private lastQueueSizeCheck = Date.now();
    private queueGrowthRate = 0;

    constructor(
        private readonly anomalyDetector: AnomalyDetector,
        private readonly alertManager: AlertManager,
        private readonly logger: ILogger,
        private readonly metricsCollector: IMetricsCollector,
        private readonly threadManager: ThreadManager,
        private readonly signalTracker?: SignalTracker,
        private readonly marketContextCollector?: MarketContextCollector
    ) {
        super();

        // NUCLEAR CLEANUP: Config validation handled exclusively in config.ts
        this.config = Config.SIGNAL_MANAGER;

        // Initialize configurable parameters from config
        // Option B: Removed boost factors - detectors handle confidence internally
        // this.correlationBoostFactor = this.config.correlationBoostFactor;
        this.priceTolerancePercent = this.config.priceTolerancePercent;
        this.signalThrottleMs = this.config.signalThrottleMs;
        this.correlationWindowMs = this.config.correlationWindowMs;
        this.maxHistorySize = this.config.maxHistorySize;
        this.defaultPriority = this.config.defaultPriority;
        this.volatilityHighThreshold = this.config.volatilityHighThreshold;
        this.volatilityLowThreshold = this.config.volatilityLowThreshold;
        // this.contextBoostHigh = this.config.contextBoostHigh;
        // this.contextBoostLow = this.config.contextBoostLow;
        this.priorityQueueHighThreshold =
            this.config.priorityQueueHighThreshold;

        this.logger.info(
            "[SignalManager] SignalManager initialized as market health gatekeeper",
            {
                component: "SignalManager",
                config: this.config,
                role: "signal_coordination_and_health_check",
            }
        );

        // Initialize enhanced backpressure features
        this.currentBatchSize = this.config.processingBatchSize;

        // Initialize metrics
        this.initializeMetrics();

        // Clean up old signals periodically
        setInterval(() => {
            this.cleanupOldSignals();
            void this.threadManager.callStorage("purgeSignalHistory");
            void this.threadManager.callStorage("purgeConfirmedSignals");
        }, 60000); // Every minute

        // 🔧 Enhanced adaptive metrics and circuit breaker management
        setInterval(() => {
            this.updateAdaptiveMetrics();
            this.adjustAdaptiveBatchSize();
            this.checkCircuitBreakers();
        }, 5000); // Every 5 seconds
    }

    /**
     * Simplified signal processing - market health gatekeeper + signal coordination.
     * No complex anomaly enhancement, just health-based allow/block decisions.
     */
    private processSignal(signal: ProcessedSignal): ConfirmedSignal | null {
        this.lastRejectReason = undefined;
        try {
            // 1. Market health check (infrastructure safety)
            if (!this.checkMarketHealth()) {
                this.logger.info(
                    "[SignalManager] Signal blocked due to market health",
                    {
                        signalId: signal.id,
                        signalType: signal.type,
                        healthStatus: this.anomalyDetector.getMarketHealth(),
                    }
                );

                this.recordMetric("signal_blocked_by_health", signal.type);
                this.recordDetailedSignalMetrics(
                    signal,
                    "blocked",
                    "unhealthy_market"
                );
                this.lastRejectReason = "unhealthy_market";
                // Track rejected signals by type
                if (this.signalTypeStats[signal.type]) {
                    this.signalTypeStats[signal.type]!.rejected++;
                }
                return null;
            }

            // 2. [REMOVED] Detector-specific confidence threshold check
            // Detectors now handle their own confidence thresholds internally
            // and only emit signals that meet their criteria (Option B)
            // This eliminates redundant filtering and simplifies the system

            // 3. Check for conflicting signals if enabled
            if (this.config.conflictResolution.enabled) {
                const conflict = this.detectSignalConflict(signal);
                if (conflict) {
                    const resolvedSignal = this.resolveConflict(
                        conflict,
                        signal
                    );
                    if (!resolvedSignal) {
                        this.logger.info(
                            "[SignalManager] Signal rejected due to conflict resolution",
                            {
                                signalId: signal.id,
                                signalType: signal.type,
                                conflictType: conflict.type,
                                conflictingSignalId: conflict.signal2.id,
                            }
                        );

                        this.recordMetric(
                            "signal_rejected_conflict",
                            signal.type
                        );
                        this.recordDetailedSignalMetrics(
                            signal,
                            "rejected",
                            "conflict_resolution"
                        );
                        this.lastRejectReason = "conflict_resolution";
                        // Track rejected signals by type
                        if (this.signalTypeStats[signal.type]) {
                            this.signalTypeStats[signal.type]!.rejected++;
                        }
                        return null;
                    }
                    // Update signal with adjusted confidence
                    signal = resolvedSignal;
                }
            }

            // 4. Calculate signal correlations (existing logic)
            const correlation = this.calculateSignalCorrelation(signal);

            // 5. Create confirmed signal (no anomaly enhancement)
            const confirmedSignal = this.createConfirmedSignal(
                signal,
                correlation
            );

            // 6. Log and emit metrics
            this.logSignalProcessing(signal, confirmedSignal);
            this.recordDetailedSignalMetrics(
                signal,
                "confirmed",
                undefined,
                confirmedSignal
            );
            this.lastRejectReason = undefined;
            return confirmedSignal;
        } catch (error) {
            this.logger.error("[SignalManager] Failed to process signal", {
                signalId: signal.id,
                error: error instanceof Error ? error.message : String(error),
            });
            this.recordDetailedSignalMetrics(
                signal,
                "rejected",
                "processing_error"
            );
            this.lastRejectReason = "processing_error";
            return null;
        }
    }

    /**
     * [REMOVED] Filter signal by detector-specific confidence threshold.
     * Detectors now handle their own confidence thresholds internally.
     */

    /**
     * Calculate position size based on detector type.
     */
    private calculatePositionSizeByType(signalType: SignalType): number {
        const positionSizes = Config.DETECTOR_POSITION_SIZING;
        const positionSize = positionSizes[signalType];

        if (positionSize === undefined) {
            throw new Error(
                `Missing position size for signal type: ${signalType}. Expected one of: ${Object.keys(positionSizes).join(", ")}`
            );
        }

        return positionSize;
    }

    /**
     * Simple market health check - infrastructure safety only.
     * Returns true if trading should continue, false if should pause/block.
     */
    private checkMarketHealth(): boolean {
        if (!this.config.enableMarketHealthCheck) return true;

        try {
            const health = this.anomalyDetector.getMarketHealth();

            // Block trading only for critical issues or insufficient data
            if (
                health.recommendation === "close_positions" ||
                health.recommendation === "insufficient_data" ||
                health.highestSeverity === "critical" ||
                health.criticalIssues.length > 0
            ) {
                return false;
            }

            return true;
        } catch (error) {
            this.logger.error("[SignalManager] Failed to check market health", {
                error: error instanceof Error ? error.message : String(error),
            });
            // Default to allow trading if health check fails
            return true;
        }
    }

    /**
     * Create confirmed signal with clean market health context.
     * No complex anomaly enhancement - just health status for context.
     */
    private createConfirmedSignal(
        signal: ProcessedSignal,
        correlation: SignalCorrelation
    ): ConfirmedSignal {
        // Option B Architecture: No confidence modification in signal manager
        // Detectors handle their own confidence calculations
        const finalConfidence = signal.confidence;

        // Get market health for context only (no enhancement)
        const health = this.anomalyDetector.getMarketHealth();

        const confirmedSignal: ConfirmedSignal = {
            id: `confirmed_${signal.id}`,
            originalSignals: [
                {
                    id: signal.id,
                    type: signal.type,
                    confidence: signal.confidence,
                    detectorId: signal.detectorId,
                    confirmations: new Set([signal.detectorId]),
                    metadata: signal.data,
                },
            ],
            confidence: finalConfidence,
            finalPrice: signal.data.price,
            confirmedAt: Date.now(),
            correlationData: {
                correlatedSignals: correlation.correlatedSignals.length,
                correlationStrength: correlation.strength,
            },
            anomalyData: {
                marketHealthy: health.isHealthy,
                tradingAllowed:
                    health.recommendation === "continue" ||
                    health.recommendation === "reduce_size",
                healthRecommendation: health.recommendation,
                criticalIssues: health.criticalIssues,
                recentAnomalyTypes: health.recentAnomalyTypes,
                // Option B: No confidence adjustment in signal manager
            },
            // Pass through phase-based classification
            ...(signal.signalClassification && {
                signalClassification: signal.signalClassification,
            }),
            ...(signal.phaseContext && {
                phaseContext: signal.phaseContext,
            }),
        };

        // Ensure signals are persisted before emitting to prevent backlog issues
        void this.threadManager.callStorage("saveSignalHistory", signal);
        void this.threadManager.callStorage(
            "saveConfirmedSignal",
            confirmedSignal
        );

        // Track signal performance if tracker is available
        if (this.signalTracker && this.marketContextCollector) {
            try {
                const marketContext =
                    this.marketContextCollector.getCurrentMarketContext(
                        confirmedSignal.finalPrice,
                        confirmedSignal.confirmedAt
                    );
                this.signalTracker.onSignalGenerated(
                    confirmedSignal,
                    marketContext
                );

                this.logger.debug("[SignalManager] Signal tracking initiated", {
                    signalId: confirmedSignal.id,
                    price: confirmedSignal.finalPrice,
                    confidence: confirmedSignal.confidence,
                });
            } catch (error) {
                this.logger.error(
                    "[SignalManager] Failed to initiate signal tracking",
                    {
                        signalId: confirmedSignal.id,
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    }
                );
            }
        }

        return confirmedSignal;
    }

    /**
     * Calculate signal correlations with recent signals.
     */
    private calculateSignalCorrelation(
        signal: ProcessedSignal
    ): SignalCorrelation {
        const cutoffTime = Date.now() - this.correlationWindowMs;
        const recentSignals = this.signalHistory.filter(
            (s) => s.timestamp.getTime() > cutoffTime && s.id !== signal.id
        );

        // Find signals of the same side near the same price (for correlation analysis)
        const correlatedSignals = recentSignals.filter((s) => {
            const priceDiff = FinancialMath.calculateAbs(
                FinancialMath.safeSubtract(s.data.price, signal.data.price)
            );
            const priceThreshold = FinancialMath.multiplyQuantities(
                signal.data.price,
                FinancialMath.divideQuantities(this.priceTolerancePercent, 100)
            ); // Configurable price tolerance

            return (
                s.data.side === signal.data.side && priceDiff <= priceThreshold
            );
        });

        // Calculate correlation strength
        const strength = Math.min(
            FinancialMath.divideQuantities(correlatedSignals.length, 3),
            1.0
        ); // Max strength at 3+ correlations (design parameter)

        const correlation: SignalCorrelation = {
            signalId: signal.id,
            correlatedSignals,
            timestamp: Date.now(),
            strength,
        };

        this.correlations.set(signal.id, correlation);

        this.logger.debug("[SignalManager] Signal correlation analyzed", {
            signalId: signal.id,
            correlatedCount: correlatedSignals.length,
            strength,
        });

        return correlation;
    }

    /**
     * Detect signal conflicts based on configured strategy.
     * Uses FinancialMath for all calculations (CLAUDE.md compliant).
     */
    private detectSignalConflict(
        newSignal: ProcessedSignal
    ): SignalConflict | null {
        if (!this.config.conflictResolution) return null;
        if (!this.config.conflictResolution.enabled) return null;

        const { minimumSeparationMs, priceTolerance } =
            this.config.conflictResolution;
        const cutoffTime = newSignal.timestamp.getTime() - minimumSeparationMs;

        // Find recent signals that might conflict (include signals exactly at boundary)
        const recentSignals = this.signalHistory.filter(
            (s) => s.timestamp.getTime() >= cutoffTime && s.id !== newSignal.id
        );

        for (const existingSignal of recentSignals) {
            // Calculate time difference using FinancialMath
            const timeDiff = FinancialMath.calculateAbs(
                FinancialMath.safeSubtract(
                    newSignal.timestamp.getTime(),
                    existingSignal.timestamp.getTime()
                )
            );

            // Signals are already filtered by time window above, this is just for logging
            // No need to check time again since recentSignals already filtered by cutoffTime

            // Calculate price difference using FinancialMath
            const priceDiff = FinancialMath.calculateAbs(
                FinancialMath.safeSubtract(
                    newSignal.data.price,
                    existingSignal.data.price
                )
            );
            const priceThreshold = FinancialMath.multiplyQuantities(
                newSignal.data.price,
                priceTolerance
            );

            // Check for price proximity
            if (priceDiff > priceThreshold) continue;

            // Check for opposite direction signals (the main issue)
            if (existingSignal.data.side !== newSignal.data.side) {
                this.logger.warn(
                    "[SignalManager] Detected conflicting opposite signals",
                    {
                        newSignal: {
                            id: newSignal.id,
                            type: newSignal.type,
                            side: newSignal.data.side,
                            price: newSignal.data.price,
                            confidence: newSignal.confidence,
                        },
                        existingSignal: {
                            id: existingSignal.id,
                            type: existingSignal.type,
                            side: existingSignal.data.side,
                            price: existingSignal.data.price,
                            confidence: existingSignal.confidence,
                        },
                        timeDiff,
                        priceDiff,
                    }
                );

                return {
                    signal1: newSignal,
                    signal2: existingSignal,
                    type: "opposite_direction",
                    timestamp: Date.now(),
                };
            }
        }

        return null;
    }

    /**
     * Resolve signal conflicts using confidence-based strategy.
     * Uses FinancialMath for all calculations (CLAUDE.md compliant).
     */
    private resolveConflict(
        conflict: SignalConflict,
        currentSignal: ProcessedSignal
    ): ProcessedSignal | null {
        if (!this.config.conflictResolution) return currentSignal;

        const { contradictionPenaltyFactor, strategy } =
            this.config.conflictResolution;

        if (strategy === "confidence_weighted") {
            // Apply penalty to both signals' confidence
            const signal1Confidence = FinancialMath.multiplyQuantities(
                conflict.signal1.confidence,
                FinancialMath.safeSubtract(1, contradictionPenaltyFactor)
            );

            const signal2Confidence = FinancialMath.multiplyQuantities(
                conflict.signal2.confidence,
                FinancialMath.safeSubtract(1, contradictionPenaltyFactor)
            );

            // Check which signal should win after penalty
            if (currentSignal.id === conflict.signal1.id) {
                // Current signal is signal1
                if (signal1Confidence > signal2Confidence) {
                    // Current signal wins, return with adjusted confidence
                    return {
                        ...currentSignal,
                        confidence: signal1Confidence,
                    };
                } else {
                    // Existing signal wins, reject current
                    return null;
                }
            } else {
                // Current signal is signal2
                if (signal2Confidence > signal1Confidence) {
                    // Current signal wins, return with adjusted confidence
                    return {
                        ...currentSignal,
                        confidence: signal2Confidence,
                    };
                } else {
                    // Existing signal wins, reject current
                    return null;
                }
            }
        }

        // Priority-based resolution strategy
        if (strategy === "priority_based") {
            return this.resolvePriorityBased(conflict, currentSignal);
        }

        // Market context-based resolution strategy
        if (strategy === "market_context") {
            return this.resolveMarketContext(conflict, currentSignal);
        }

        // Default: return current signal if strategy is not recognized
        return currentSignal;
    }

    /**
     * Resolve conflict using priority-based strategy.
     * Uses signal priority matrix to determine which detector should win.
     */
    private resolvePriorityBased(
        conflict: SignalConflict,
        currentSignal: ProcessedSignal
    ): ProcessedSignal | null {
        if (
            !this.config.signalPriorityMatrix ||
            !this.config.conflictResolution
        ) {
            return currentSignal;
        }

        // Calculate market volatility to determine priority matrix
        const marketVolatility = this.getMarketVolatility();
        const volatilityRegime =
            this.determineVolatilityRegime(marketVolatility);

        // Get priority matrix for current market conditions
        const priorityMatrix =
            this.config.signalPriorityMatrix[volatilityRegime];
        if (!priorityMatrix) {
            this.logger.warn(
                "[SignalManager] No priority matrix found for volatility regime",
                {
                    volatilityRegime,
                    marketVolatility,
                }
            );
            return currentSignal;
        }

        // Get priorities for both signals
        const signal1Priority =
            priorityMatrix[conflict.signal1.type] !== undefined
                ? priorityMatrix[conflict.signal1.type]
                : this.defaultPriority;
        const signal2Priority =
            priorityMatrix[conflict.signal2.type] !== undefined
                ? priorityMatrix[conflict.signal2.type]
                : this.defaultPriority;

        // Apply penalty factor to lower priority signal
        const { contradictionPenaltyFactor } = this.config.conflictResolution;

        let winningSignal: ProcessedSignal;
        let winningConfidence: number;

        if (signal1Priority! > signal2Priority!) {
            // Signal1 wins - apply penalty to signal2
            winningSignal = conflict.signal1;
            winningConfidence = conflict.signal1.confidence;
        } else if (signal2Priority! > signal1Priority!) {
            // Signal2 wins - apply penalty to signal1
            winningSignal = conflict.signal2;
            winningConfidence = conflict.signal2.confidence;
        } else {
            // Equal priority - fall back to confidence comparison
            const adjustedConf1 = FinancialMath.multiplyQuantities(
                conflict.signal1.confidence,
                FinancialMath.safeSubtract(1, contradictionPenaltyFactor)
            );
            const adjustedConf2 = FinancialMath.multiplyQuantities(
                conflict.signal2.confidence,
                FinancialMath.safeSubtract(1, contradictionPenaltyFactor)
            );

            if (adjustedConf1 > adjustedConf2) {
                winningSignal = conflict.signal1;
                winningConfidence = adjustedConf1;
            } else {
                winningSignal = conflict.signal2;
                winningConfidence = adjustedConf2;
            }
        }

        // Return the winning signal if it's the current signal, otherwise reject
        if (currentSignal.id === winningSignal.id) {
            this.logger.info(
                "[SignalManager] Signal won priority-based conflict resolution",
                {
                    signalId: currentSignal.id,
                    signalType: currentSignal.type,
                    priority: signal1Priority,
                    conflictingType:
                        winningSignal === conflict.signal1
                            ? conflict.signal2.type
                            : conflict.signal1.type,
                    conflictingPriority: signal2Priority,
                    volatilityRegime,
                }
            );

            return {
                ...currentSignal,
                confidence: winningConfidence,
            };
        } else {
            this.logger.info(
                "[SignalManager] Signal lost priority-based conflict resolution",
                {
                    signalId: currentSignal.id,
                    signalType: currentSignal.type,
                    winningType: winningSignal.type,
                    volatilityRegime,
                }
            );
            return null;
        }
    }

    /**
     * Resolve conflict using market context strategy.
     * Considers market volatility and trend direction.
     */
    private resolveMarketContext(
        conflict: SignalConflict,
        currentSignal: ProcessedSignal
    ): ProcessedSignal | null {
        if (!this.config.conflictResolution) return currentSignal;

        const marketVolatility = this.getMarketVolatility();
        const { volatilityNormalizationFactor, contradictionPenaltyFactor } =
            this.config.conflictResolution;

        // Normalize volatility (0-1 scale)
        const normalizedVolatility = Math.min(
            FinancialMath.divideQuantities(
                marketVolatility,
                volatilityNormalizationFactor
            ),
            1.0
        );

        // In high volatility: favor trend-following signals (deltacvd)
        // In low volatility: favor counter-trend signals (absorption)
        let contextBoost1 = 1.0;
        let contextBoost2 = 1.0;

        if (normalizedVolatility > 0.7) {
            // High volatility - favor trend-following
            if (conflict.signal1.type === "deltacvd") contextBoost1 = 1.2;
            if (conflict.signal2.type === "deltacvd") contextBoost2 = 1.2;
            if (conflict.signal1.type === "absorption") contextBoost1 = 0.8;
            if (conflict.signal2.type === "absorption") contextBoost2 = 0.8;
        } else if (normalizedVolatility < 0.3) {
            // Low volatility - favor counter-trend
            if (conflict.signal1.type === "absorption") contextBoost1 = 1.2;
            if (conflict.signal2.type === "absorption") contextBoost2 = 1.2;
            if (conflict.signal1.type === "deltacvd") contextBoost1 = 0.8;
            if (conflict.signal2.type === "deltacvd") contextBoost2 = 0.8;
        }

        // Apply context boosts and conflict penalties
        const adjustedConf1 = FinancialMath.multiplyQuantities(
            FinancialMath.multiplyQuantities(
                conflict.signal1.confidence,
                contextBoost1
            ),
            FinancialMath.safeSubtract(1, contradictionPenaltyFactor)
        );

        const adjustedConf2 = FinancialMath.multiplyQuantities(
            FinancialMath.multiplyQuantities(
                conflict.signal2.confidence,
                contextBoost2
            ),
            FinancialMath.safeSubtract(1, contradictionPenaltyFactor)
        );

        // Determine winning signal
        const signal1Wins = adjustedConf1 > adjustedConf2;
        const winningSignal = signal1Wins ? conflict.signal1 : conflict.signal2;
        const winningConfidence = signal1Wins ? adjustedConf1 : adjustedConf2;

        // Return result based on current signal
        if (currentSignal.id === winningSignal.id) {
            this.logger.info(
                "[SignalManager] Signal won market context conflict resolution",
                {
                    signalId: currentSignal.id,
                    signalType: currentSignal.type,
                    marketVolatility,
                    normalizedVolatility,
                    contextBoost: signal1Wins ? contextBoost1 : contextBoost2,
                    finalConfidence: winningConfidence,
                }
            );

            return {
                ...currentSignal,
                confidence: Math.min(winningConfidence, 1.0), // Cap at 1.0
            };
        } else {
            this.logger.info(
                "[SignalManager] Signal lost market context conflict resolution",
                {
                    signalId: currentSignal.id,
                    signalType: currentSignal.type,
                    winningType: winningSignal.type,
                    marketVolatility,
                    normalizedVolatility,
                }
            );
            return null;
        }
    }

    /**
     * Get market volatility from AnomalyDetector.
     * No fallbacks, no defaults - use provided data only.
     */
    private getMarketVolatility(): number {
        const health = this.anomalyDetector.getMarketHealth();
        return health.metrics.volatility;
    }

    /**
     * Determine volatility regime based on calculated volatility.
     */
    private determineVolatilityRegime(
        volatility: number
    ): "highVolatility" | "lowVolatility" | "balanced" {
        if (volatility > this.volatilityHighThreshold) {
            // > configurable high threshold annualized
            return "highVolatility";
        } else if (volatility < this.volatilityLowThreshold) {
            // < configurable low threshold annualized
            return "lowVolatility";
        } else {
            return "balanced";
        }
    }

    /**
     * Handle processed signal from SignalCoordinator.
     * This is the main entry point for signals from the coordinator.
     * Implements backpressure management for high-frequency scenarios.
     */
    public handleProcessedSignal(
        signal: ProcessedSignal
    ): ConfirmedSignal | null {
        // 🔍 CRITICAL DEBUG: Log every signal entry with full details
        this.logger.info("[SignalManager] SIGNAL ENTRY ANALYSIS", {
            signalId: signal.id,
            signalType: signal.type,
            detectorId: signal.detectorId,
            confidence: signal.confidence,
            hasStatsForType: !!this.signalTypeStats[signal.type],
            currentStats: this.signalTypeStats[signal.type],
            allExpectedTypes: Object.keys(this.signalTypeStats),
            signalKeys: Object.keys(signal),
        });

        // ✅ Track signal type IMMEDIATELY for dashboard metrics (before any rejections)
        if (this.signalTypeStats[signal.type]) {
            this.signalTypeStats[signal.type]!.candidates++;
            this.logger.info("[SignalManager] TRACKED CANDIDATE", {
                signalType: signal.type,
                newCandidates: this.signalTypeStats[signal.type]!.candidates,
                allCurrentStats: this.signalTypeStats,
            });
        } else {
            this.logger.error(
                "[SignalManager] CRITICAL: Unknown signal type - cannot track",
                {
                    receivedSignalType: signal.type,
                    expectedTypes: Object.keys(this.signalTypeStats),
                    signalId: signal.id,
                    detectorId: signal.detectorId,
                }
            );
        }

        // 🔧 Enhanced circuit breaker check for detector
        if (this.isCircuitBreakerOpen(signal.detectorId)) {
            // Track rejected signals by type
            if (this.signalTypeStats[signal.type]) {
                this.signalTypeStats[signal.type]!.rejected++;
            }
            this.recordDroppedSignal(signal, "circuit_breaker");
            return null;
        }

        // 🔧 Enhanced backpressure check with prioritization
        const priority = this.calculateSignalPriority(signal);
        const shouldDrop = this.shouldDropSignal(signal, priority);

        if (shouldDrop) {
            // Track rejected signals by type
            if (this.signalTypeStats[signal.type]) {
                this.signalTypeStats[signal.type]!.rejected++;
            }
            this.recordDroppedSignal(signal, "backpressure");
            return null;
        }

        // 🔧 High-priority bypass for critical signals
        const isHighPriority =
            priority >= this.config.highPriorityBypassThreshold;

        // For high load, use prioritized queued processing
        if (this.signalQueue.length > 0 || this.isProcessing) {
            const prioritizedSignal: PrioritizedSignal = {
                signal,
                priority,
                enqueuedAt: Date.now(),
                processingAttempts: 0,
            };

            if (isHighPriority && this.config.enableSignalPrioritization) {
                // Insert high-priority signals at front of queue
                this.signalQueue.unshift(prioritizedSignal);
            } else {
                // Regular signals go to back, maintain insertion order for same priority
                this.signalQueue.push(prioritizedSignal);
            }

            // 🔧 Enhanced queue sorting by priority if enabled
            if (this.config.enableSignalPrioritization) {
                this.signalQueue.sort((a, b) => b.priority - a.priority);
            }

            this.metricsCollector.setGauge(
                "signal_manager_queue_size",
                this.signalQueue.length
            );
            this.metricsCollector.setGauge(
                "signal_manager_avg_queue_priority",
                this.signalQueue.reduce((sum, s) => sum + s.priority, 0) /
                    this.signalQueue.length
            );

            void this.startProcessing();
            return null; // Async processing
        }

        // For normal load, process synchronously (backward compatibility)
        const startTime = Date.now();
        let result: ConfirmedSignal | null = null;

        try {
            result = this.processSignalSync(signal);
            const processingTime = Date.now() - startTime;

            // Update adaptive metrics and circuit breaker state
            this.updateProcessingMetrics(processingTime, result !== null);

            if (result !== null) {
                this.resetCircuitBreaker(signal.detectorId);
            } else {
                // Track rejected signals by type
                if (this.signalTypeStats[signal.type]) {
                    this.signalTypeStats[signal.type]!.rejected++;
                }
                this.recordCircuitBreakerFailure(signal.detectorId);
            }
        } catch (error) {
            const processingTime = Date.now() - startTime;
            this.updateProcessingMetrics(processingTime, false);
            this.recordCircuitBreakerFailure(signal.detectorId);

            // Track rejected signals by type for exceptions
            if (this.signalTypeStats[signal.type]) {
                this.signalTypeStats[signal.type]!.rejected++;
            }

            this.logger.error(
                "[SignalManager] Failed to process signal synchronously",
                {
                    signalId: signal.id,
                    detectorId: signal.detectorId,
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );

            result = null;
        }

        return result;
    }

    /**
     * 🔧 Enhanced process signals from queue with adaptive batch management.
     */
    private async startProcessing(): Promise<void> {
        if (this.isProcessing) return;

        this.isProcessing = true;
        let batchStartTime = Date.now();

        while (this.signalQueue.length > 0) {
            // 🔧 Use adaptive batch sizing for optimal performance
            const batchSize = this.config.adaptiveBatchSizing
                ? this.currentBatchSize
                : this.config.processingBatchSize;

            const batch = this.signalQueue.filter(
                (_, index) => index < batchSize
            );
            this.signalQueue = this.signalQueue.filter(
                (_, index) => index >= batchSize
            );
            let successCount = 0;

            for (const prioritizedSignal of batch) {
                try {
                    prioritizedSignal.processingAttempts++;
                    const startTime = Date.now();

                    const result = this.processSignalSync(
                        prioritizedSignal.signal
                    );

                    const processingTime = Date.now() - startTime;
                    const success = result !== null;

                    if (success) {
                        successCount++;
                        // Track confirmed signals by type
                        if (
                            this.signalTypeStats[prioritizedSignal.signal.type]
                        ) {
                            this.signalTypeStats[prioritizedSignal.signal.type]!
                                .confirmed++;
                        }
                        this.resetCircuitBreaker(
                            prioritizedSignal.signal.detectorId
                        );
                    } else {
                        // Track rejected signals by type
                        if (
                            this.signalTypeStats[prioritizedSignal.signal.type]
                        ) {
                            this.signalTypeStats[prioritizedSignal.signal.type]!
                                .rejected++;
                        }
                        this.recordCircuitBreakerFailure(
                            prioritizedSignal.signal.detectorId
                        );
                    }

                    // Update adaptive processing metrics
                    this.updateProcessingMetrics(processingTime, success);
                } catch (error) {
                    this.logger.error(
                        "[SignalManager] Failed to process prioritized signal",
                        {
                            signalId: prioritizedSignal.signal.id,
                            priority: prioritizedSignal.priority,
                            attempts: prioritizedSignal.processingAttempts,
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                        }
                    );

                    this.recordCircuitBreakerFailure(
                        prioritizedSignal.signal.detectorId
                    );
                }
            }

            // 🔧 Update enhanced queue metrics
            this.metricsCollector.setGauge(
                "signal_manager_queue_size",
                this.signalQueue.length
            );
            this.metricsCollector.setGauge(
                "signal_manager_current_batch_size",
                batchSize
            );
            this.metricsCollector.setGauge(
                "signal_manager_batch_success_rate",
                batch.length > 0 ? successCount / batch.length : 0
            );

            const batchProcessingTime = Date.now() - batchStartTime;
            this.metricsCollector.setGauge(
                "signal_manager_batch_processing_time_ms",
                batchProcessingTime
            );

            // 🔧 Adaptive yield time based on queue pressure
            const queuePressure =
                this.signalQueue.length / this.config.maxQueueSize;
            const yieldTimeMs = queuePressure > 0.7 ? 1 : 5; // Shorter yield under high pressure

            await new Promise((resolve) => setTimeout(resolve, yieldTimeMs));
            batchStartTime = Date.now();
        }

        this.isProcessing = false;
    }

    /**
     * Synchronous signal processing for backward compatibility.
     */
    private processSignalSync(signal: ProcessedSignal): ConfirmedSignal | null {
        let confirmedSignal: ConfirmedSignal | null = null;
        try {
            this.logger.info("[SignalManager] Processing signal", {
                component: "SignalManager",
                operation: "processSignalSync",
                signalId: signal.id,
                signalType: signal.type,
                detectorId: signal.detectorId,
                confidence: signal.confidence,
            });

            this.metricsCollector.incrementCounter(
                "signal_manager_signals_received_total",
                1,
                {
                    signal_type: signal.type,
                    detector_id: signal.detectorId,
                }
            );
            // Track received signals by type for stats page
            this.metricsCollector.incrementCounter(
                `signal_manager_signals_received_total_${signal.type}`,
                1
            );

            // Process signal through simplified pipeline (phase logic now in detectors)
            confirmedSignal = this.processSignal(signal);

            // Store signal for correlation analysis only if it succeeds
            if (confirmedSignal) {
                this.storeSignal(signal);
            }

            if (!confirmedSignal) {
                this.emit("signalRejected", {
                    signal,
                    reason: this.lastRejectReason
                        ? this.lastRejectReason
                        : "processing_failed",
                });
                // Track rejected signals by type
                if (this.signalTypeStats[signal.type]) {
                    this.signalTypeStats[signal.type]!.rejected++;
                }
                return null;
            }

            // Generate final trading signal
            const tradingSignal = this.createTradingSignal(confirmedSignal);

            // Check for duplicate/throttled signals
            if (this.isSignalThrottled(tradingSignal)) {
                this.logger.info(
                    "[SignalManager] Signal throttled to prevent duplicates",
                    {
                        signalId: tradingSignal.id,
                        type: tradingSignal.type,
                        price: tradingSignal.price,
                        side: tradingSignal.side,
                    }
                );
                this.recordDetailedSignalMetrics(
                    signal,
                    "rejected",
                    "throttled_duplicate"
                );
                this.lastRejectReason = "throttled_duplicate";
                // Track rejected signals by type
                if (this.signalTypeStats[signal.type]) {
                    this.signalTypeStats[signal.type]!.rejected++;
                }
                return null;
            }

            // Record this signal to prevent future duplicates
            this.recordTradingSignal(tradingSignal);

            this.metricsCollector.incrementCounter(
                "signal_manager_signals_confirmed_total",
                1,
                {
                    signal_type: signal.type,
                    detector_id: signal.detectorId,
                    trading_side: tradingSignal.side,
                }
            );
            // Track confirmed signals by type
            this.metricsCollector.incrementCounter(
                `signal_manager_signals_confirmed_total_${signal.type}`,
                1
            );

            this.metricsCollector.recordHistogram(
                "signal_manager_confidence_score",
                confirmedSignal.confidence,
                {
                    signal_type: signal.type,
                    detector_id: signal.detectorId,
                }
            );

            // Correlation metrics
            this.metricsCollector.recordHistogram(
                "signal_manager_correlation_strength",
                confirmedSignal.correlationData.correlationStrength,
                {
                    signal_type: signal.type,
                }
            );

            // Send alerts if enabled
            if (this.config.enableAlerts) {
                void this.sendAlerts(tradingSignal);
            }

            // 🚨 CRITICAL DEBUG: Log successful signal emission
            this.logger.error("🚨 SIGNALMANAGER EMITTING SUCCESSFUL SIGNAL", {
                signalType: signal.type,
                tradingSignalType: tradingSignal.type,
                signalId: signal.id,
                price: tradingSignal.price,
                timestamp: Date.now(),
            });

            // Track confirmed signals by type
            if (this.signalTypeStats[signal.type]) {
                this.signalTypeStats[signal.type]!.confirmed++;
            }

            // Emit the final trading signal
            this.emit("signalGenerated", tradingSignal);
            this.emit("signalConfirmed", confirmedSignal);

            this.logger.info("[SignalManager] Signal processed successfully", {
                signalId: signal.id,
                finalSignalId: tradingSignal.id,
                price: tradingSignal.price,
                side: tradingSignal.side,
                confidence: confirmedSignal.confidence,
                marketHealth: confirmedSignal.anomalyData.marketHealthy,
                confirmedSignal: confirmedSignal,
                tradingSignal: tradingSignal,
            });
        } catch (error: unknown) {
            this.logger.error(
                "[SignalManager] Failed to handle processed signal",
                {
                    component: "SignalManager",
                    operation: "handleProcessedSignal",
                    signalId: signal.id,
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );

            this.metricsCollector.incrementCounter(
                "signal_manager_errors_total",
                1,
                {
                    signal_type: signal.type,
                    detector_id: signal.detectorId,
                    error_type:
                        error instanceof Error
                            ? error.constructor.name
                            : "UnknownError",
                }
            );

            this.emit("signalError", { signal, error });
            throw error;
        }

        return confirmedSignal;
    }

    /**
     * Check if signal should be dropped due to backpressure.
     */
    private shouldDropSignal(
        signal: ProcessedSignal,
        priority: number
    ): boolean {
        const queueUtilization =
            this.signalQueue.length / this.config.maxQueueSize;

        // 🔧 Adaptive backpressure threshold based on market conditions
        let backpressureThreshold = this.config.backpressureThreshold;
        if (this.config.adaptiveBackpressure) {
            // Lower threshold during high-volatility conditions (more selective)
            const marketHealth = this.anomalyDetector.getMarketHealth();
            const marketVolatility =
                typeof marketHealth.metrics.volatility === "number"
                    ? marketHealth.metrics.volatility
                    : 0.5;
            backpressureThreshold = Math.max(
                0.5,
                FinancialMath.safeSubtract(
                    this.config.backpressureThreshold,
                    FinancialMath.multiplyQuantities(marketVolatility, 0.2)
                )
            );
        }

        // Activate backpressure if queue is getting full
        if (queueUtilization >= backpressureThreshold) {
            if (!this.backpressureActive) {
                this.backpressureActive = true;
                this.logger.warn(
                    "[SignalManager] Enhanced backpressure activated",
                    {
                        queueSize: this.signalQueue.length,
                        maxSize: this.config.maxQueueSize,
                        utilization: queueUtilization,
                        adaptiveThreshold: backpressureThreshold,
                        signalPriority: priority,
                    }
                );
            }

            // 🔧 Priority-based dropping during backpressure
            const priorityThreshold =
                this.calculateBackpressurePriorityThreshold(queueUtilization);
            if (priority < priorityThreshold) {
                return true;
            }

            // 🔧 Additional confidence-based filtering for medium priority signals
            if (priority < this.priorityQueueHighThreshold) {
                const confidenceThreshold =
                    0.8 + (queueUtilization - backpressureThreshold) * 0.4;
                if (signal.confidence < Math.min(confidenceThreshold, 0.95)) {
                    return true;
                }
            }
        } else if (
            this.backpressureActive &&
            queueUtilization < backpressureThreshold * 0.5
        ) {
            // Deactivate backpressure when queue clears
            this.backpressureActive = false;
            this.logger.info(
                "[SignalManager] Enhanced backpressure deactivated",
                {
                    queueSize: this.signalQueue.length,
                    utilization: queueUtilization,
                }
            );
        }

        // 🔧 Hard limit: drop signals if queue is completely full (except highest priority)
        if (this.signalQueue.length >= this.config.maxQueueSize) {
            return priority < this.config.highPriorityBypassThreshold;
        }

        return false;
    }

    /**
     * 🔧 Enhanced record metrics for dropped signals with detailed reasons.
     */
    private recordDroppedSignal(
        signal: ProcessedSignal,
        dropReason: string
    ): void {
        const currentCount = this.droppedSignalCounts.get(signal.type) || 0;
        this.droppedSignalCounts.set(signal.type, currentCount + 1);

        this.metricsCollector.incrementCounter(
            "signal_manager_signals_dropped_total",
            1,
            {
                signal_type: signal.type,
                detector_id: signal.detectorId,
                drop_reason: dropReason,
            }
        );

        // Track drop reasons separately for analysis
        this.metricsCollector.incrementCounter(
            `signal_manager_drops_${dropReason}_total`,
            1,
            {
                signal_type: signal.type,
            }
        );

        this.logger.warn(
            "[SignalManager] Signal dropped with enhanced tracking",
            {
                signalId: signal.id,
                signalType: signal.type,
                confidence: signal.confidence,
                queueSize: this.signalQueue.length,
                backpressureActive: this.backpressureActive,
                dropReason,
                priority: this.calculateSignalPriority(signal),
            }
        );
    }

    /**
     * Store signal for correlation analysis.
     */
    private storeSignal(signal: ProcessedSignal): void {
        // Add to recent signals
        this.recentSignals.set(signal.id, signal);

        // Add to history
        this.signalHistory.push(signal);

        // Limit history size
        if (this.signalHistory.length > this.maxHistorySize) {
            this.signalHistory.shift();
        }

        this.metricsCollector.setGauge(
            "signal_manager_recent_signals_count",
            this.recentSignals.size
        );
        this.metricsCollector.setGauge(
            "signal_manager_signal_history_size",
            this.signalHistory.length
        );
    }

    /**
     * Create trading signal from confirmed signal.
     */
    private createTradingSignal(confirmedSignal: ConfirmedSignal): Signal {
        const originalSignal = confirmedSignal.originalSignals[0];
        if (!originalSignal) {
            throw new Error("No original signal found");
        }

        // Determine trading direction from signal data - required
        const side = this.getSignalDirectionFromData(originalSignal);
        if (side === null) {
            this.logger.error(
                "[SignalManager] Signal missing required direction data",
                {
                    signalId: confirmedSignal.id,
                    signalType: originalSignal.type,
                }
            );
            throw new Error(
                `Signal ${confirmedSignal.id} missing required direction data`
            );
        }

        // Validate finalPrice before calculating TP/SL
        if (
            !confirmedSignal.finalPrice ||
            isNaN(confirmedSignal.finalPrice) ||
            confirmedSignal.finalPrice <= 0
        ) {
            this.logger.error(
                "[SignalManager] Invalid finalPrice for signal calculations",
                {
                    signalId: confirmedSignal.id,
                    finalPrice: confirmedSignal.finalPrice,
                    side,
                }
            );
            throw new Error(
                `Invalid finalPrice: ${confirmedSignal.finalPrice}`
            );
        }

        const profitTargetData = calculateProfitTarget(
            confirmedSignal.finalPrice,
            side
        );
        const stopLoss = calculateStopLoss(confirmedSignal.finalPrice, side);

        // Extract price from profit target calculation result
        const profitTarget = profitTargetData.price;

        // Validate calculated values
        if (isNaN(profitTarget) || isNaN(stopLoss)) {
            this.logger.error("[SignalManager] Invalid TP/SL calculations", {
                signalId: confirmedSignal.id,
                finalPrice: confirmedSignal.finalPrice,
                side,
                profitTarget,
                stopLoss,
            });
            throw new Error(
                `Invalid TP/SL calculations: TP=${profitTarget}, SL=${stopLoss}`
            );
        }

        // Calculate position size based on detector type
        const positionSize = this.calculatePositionSizeByType(
            originalSignal.type
        );

        const signalData: TradingSignalData = {
            confidence: confirmedSignal.confidence,
            confirmations: Array.from(originalSignal.confirmations),
            meta: originalSignal.metadata,
            anomalyCheck: confirmedSignal.anomalyData,
            correlationData: confirmedSignal.correlationData,
            side,
            price: confirmedSignal.finalPrice,
            positionSize,
        };

        const signal: Signal = {
            id: confirmedSignal.id,
            side,
            time: confirmedSignal.confirmedAt,
            price: confirmedSignal.finalPrice,
            type: this.getSignalTypeConfirmed(originalSignal.type),
            takeProfit: profitTarget,
            stopLoss,
            signalData,
        };

        return signal;
    }

    /**
     * Get trading direction from signal data only - no fallbacks.
     */
    private getSignalDirectionFromData(
        signal: ConfirmedSignal["originalSignals"][0]
    ): "buy" | "sell" | null {
        // Extract side from signal metadata (metadata = signal.data from detector)
        if (signal.metadata && typeof signal.metadata === "object") {
            const metadata = signal.metadata as unknown as Record<
                string,
                unknown
            >;
            if (metadata["side"] === "buy" || metadata["side"] === "sell") {
                return metadata["side"];
            }
        }

        // No fallbacks - signal must provide direction data
        return null;
    }

    /**
     * Get signal type string for trading signal.
     */
    private getSignalTypeConfirmed(signalType: SignalType): SignalType {
        switch (signalType) {
            case "absorption":
                return "absorption_confirmed";
            case "exhaustion":
                return "exhaustion_confirmed";
            case "accumulation":
                return "accumulation_confirmed";
            case "distribution":
                return "distribution_confirmed";
            case "deltacvd":
                return "deltacvd_confirmed";
            default:
                return signalType; // Return original if no confirmed variant exists
        }
    }

    /**
     * Send alerts for trading signal.
     */
    private async sendAlerts(tradingSignal: Signal): Promise<void> {
        try {
            await this.alertManager.sendAlert(tradingSignal);
            this.logger.debug("[SignalManager] Alert sent for trading signal", {
                signalId: tradingSignal.id,
            });
            this.metricsCollector.incrementCounter(
                "signal_manager_alerts_sent_total",
                1,
                {
                    signal_type: tradingSignal.type,
                    trading_side: tradingSignal.side,
                }
            );
        } catch (error) {
            this.logger.error("[SignalManager] Failed to send alert", {
                signalId: tradingSignal.id,
                error: error instanceof Error ? error.message : String(error),
            });

            this.metricsCollector.incrementCounter(
                "signal_manager_alert_errors_total",
                1,
                {
                    signal_type: tradingSignal.type,
                    error_type:
                        error instanceof Error
                            ? error.constructor.name
                            : "UnknownError",
                }
            );
        }
    }

    /**
     * Check if a trading signal should be throttled to prevent duplicates.
     */
    private isSignalThrottled(tradingSignal: Signal): boolean {
        const signalKey = this.generateSignalKey(tradingSignal);
        const now = Date.now();

        this.logger.debug("[SignalManager] Checking signal throttling", {
            signalId: tradingSignal.id,
            signalKey,
            type: tradingSignal.type,
            side: tradingSignal.side,
            price: tradingSignal.price,
            recentSignalsCount: this.recentTradingSignals.size,
        });

        // Check if we have a recent similar signal
        const lastSignalTime = this.recentTradingSignals.get(signalKey);
        if (lastSignalTime && now - lastSignalTime < this.signalThrottleMs) {
            const timeDiff = now - lastSignalTime;
            this.logger.info(
                "[SignalManager] Signal throttled - exact match found",
                {
                    signalId: tradingSignal.id,
                    signalKey,
                    timeSinceLastMs: timeDiff,
                    throttleWindowMs: this.signalThrottleMs,
                }
            );
            return true; // Signal is throttled
        }

        // Check for similar signals with price tolerance
        for (const [
            existingKey,
            timestamp,
        ] of this.recentTradingSignals.entries()) {
            if (now - timestamp < this.signalThrottleMs) {
                if (this.areSignalsSimilar(tradingSignal, existingKey)) {
                    const timeDiff = now - timestamp;
                    this.logger.info(
                        "[SignalManager] Signal throttled - similar signal found",
                        {
                            signalId: tradingSignal.id,
                            newSignalKey: signalKey,
                            existingKey,
                            timeSinceLastMs: timeDiff,
                            throttleWindowMs: this.signalThrottleMs,
                        }
                    );
                    return true; // Similar signal found within throttle window
                }
            }
        }

        this.logger.debug("[SignalManager] Signal not throttled - proceeding", {
            signalId: tradingSignal.id,
            signalKey,
        });
        return false;
    }

    /**
     * Record a trading signal to prevent future duplicates.
     */
    private recordTradingSignal(tradingSignal: Signal): void {
        const signalKey = this.generateSignalKey(tradingSignal);
        const timestamp = Date.now();
        this.recentTradingSignals.set(signalKey, timestamp);

        this.logger.debug(
            "[SignalManager] Recorded trading signal for throttling",
            {
                signalId: tradingSignal.id,
                signalKey,
                timestamp,
                totalRecordedSignals: this.recentTradingSignals.size,
            }
        );

        // Clean up old entries periodically
        this.cleanupThrottledSignals();
    }

    /**
     * Generate a unique key for signal deduplication.
     */
    private generateSignalKey(tradingSignal: Signal): string {
        const priceKey = FinancialMath.financialRound(
            FinancialMath.multiplyQuantities(tradingSignal.price, 100),
            0
        );
        const key = `${tradingSignal.type}_${tradingSignal.side}_${priceKey}`;

        this.logger.debug("[SignalManager] Generated signal key", {
            signalId: tradingSignal.id,
            type: tradingSignal.type,
            side: tradingSignal.side,
            originalPrice: tradingSignal.price,
            priceKey,
            generatedKey: key,
        });

        return key;
    }

    /**
     * Check if two signals are similar enough to be considered duplicates.
     */
    private areSignalsSimilar(
        tradingSignal: Signal,
        existingKey: string
    ): boolean {
        const parts = existingKey.split("_");
        const priceStr = parts.pop();
        const side = parts.pop();
        const type = parts.join("_");

        const existingPrice = priceStr
            ? FinancialMath.divideQuantities(parseInt(priceStr, 10), 100)
            : NaN;

        // Check if same type and side
        if (tradingSignal.type !== type || tradingSignal.side !== side) {
            this.logger.debug(
                "[SignalManager] Signals not similar - different type/side",
                {
                    newType: tradingSignal.type,
                    newSide: tradingSignal.side,
                    existingType: type,
                    existingSide: side,
                }
            );
            return false;
        }

        // Check if prices are within tolerance
        const priceDiff = FinancialMath.calculateAbs(
            FinancialMath.safeSubtract(tradingSignal.price, existingPrice)
        );
        const priceToleranceAbs = FinancialMath.multiplyQuantities(
            existingPrice,
            FinancialMath.divideQuantities(this.priceTolerancePercent, 100)
        );
        const isSimilar = priceDiff <= priceToleranceAbs;

        this.logger.debug("[SignalManager] Price similarity check", {
            newPrice: tradingSignal.price,
            existingPrice,
            priceDiff,
            priceToleranceAbs,
            priceTolerancePercent: this.priceTolerancePercent,
            isSimilar,
        });

        return isSimilar;
    }

    /**
     * Clean up old throttled signals.
     */
    private cleanupThrottledSignals(): void {
        const now = Date.now();
        const cutoff = now - this.signalThrottleMs * 2; // Keep for 2x throttle period

        for (const [key, timestamp] of this.recentTradingSignals.entries()) {
            if (timestamp < cutoff) {
                this.recentTradingSignals.delete(key);
            }
        }
    }

    /**
     * Clean up old signals and correlations.
     */
    private cleanupOldSignals(): void {
        const cutoffTime = Date.now() - this.config.signalTimeout;

        // Clean up recent signals
        for (const [id, signal] of this.recentSignals.entries()) {
            if (signal.timestamp.getTime() < cutoffTime) {
                this.recentSignals.delete(id);
            }
        }

        // Clean up correlations
        for (const [id, correlation] of this.correlations.entries()) {
            if (correlation.timestamp < cutoffTime) {
                this.correlations.delete(id);
            }
        }

        this.metricsCollector.setGauge(
            "signal_manager_recent_signals_count",
            this.recentSignals.size
        );
        this.metricsCollector.setGauge(
            "signal_manager_correlations_count",
            this.correlations.size
        );

        this.logger.debug("[SignalManager] Cleaned up old signals", {
            recentSignalsCount: this.recentSignals.size,
            correlationsCount: this.correlations.size,
        });
    }

    /**
     * Enhanced signal metrics recording with detailed statistics.
     */
    private recordMetric(metricName: string, signalType: string): void {
        this.metricsCollector.incrementCounter(
            `signal_manager_${metricName}_total`,
            1,
            { signal_type: signalType }
        );
    }

    /**
     * Record detailed signal processing metrics including quality and rejection reasons.
     */
    private recordDetailedSignalMetrics(
        signal: ProcessedSignal,
        outcome: "confirmed" | "rejected" | "blocked",
        rejectionReason?: string,
        confirmedSignal?: ConfirmedSignal
    ): void {
        const labels = {
            signal_type: signal.type,
            detector_id: signal.detectorId,
            outcome,
        };

        // 🔍 CRITICAL DEBUG: Log every processed signal increment
        this.logger.info("[SignalManager] INCREMENTING PROCESSED COUNTER", {
            signalId: signal.id,
            signalType: signal.type,
            detectorId: signal.detectorId,
            outcome,
            rejectionReason,
            labels,
        });

        // Core signal processing metrics
        this.metricsCollector.incrementCounter(
            `signal_manager_signals_processed_total`,
            1,
            labels
        );

        // Record confidence score distribution
        this.metricsCollector.recordHistogram(
            `signal_manager_signal_confidence_distribution`,
            signal.confidence,
            {
                signal_type: signal.type,
                detector_id: signal.detectorId,
                outcome,
            }
        );

        // Signal quality metrics
        this.recordSignalQualityMetrics(signal, confirmedSignal);

        // Rejection reason tracking
        if (outcome === "rejected" || outcome === "blocked") {
            this.recordRejectionMetrics(
                signal,
                rejectionReason ? rejectionReason : "unknown"
            );
        }

        // Confirmation metrics with enhanced details
        if (outcome === "confirmed" && confirmedSignal) {
            this.recordConfirmationMetrics(signal, confirmedSignal);
        }

        // Signal timing metrics
        this.recordSignalTimingMetrics(signal);
    }

    /**
     * Record signal quality metrics including confidence adjustments and correlation strength.
     */
    private recordSignalQualityMetrics(
        signal: ProcessedSignal,
        confirmedSignal?: ConfirmedSignal
    ): void {
        const qualityLabels = {
            signal_type: signal.type,
            detector_id: signal.detectorId,
            quality_tier: this.getQualityTier(signal.confidence),
        };

        // Quality tier distribution
        this.metricsCollector.incrementCounter(
            `signal_manager_quality_tier_total`,
            1,
            qualityLabels
        );

        // Confidence score metrics by detector
        this.metricsCollector.recordHistogram(
            `signal_manager_detector_confidence_score`,
            signal.confidence,
            {
                detector_id: signal.detectorId,
                signal_type: signal.type,
            }
        );

        // If confirmed, track confidence adjustments
        if (confirmedSignal) {
            const originalConfidence = signal.confidence;
            const finalConfidence = confirmedSignal.confidence;
            const adjustment = finalConfidence - originalConfidence;

            this.metricsCollector.recordHistogram(
                `signal_manager_confidence_adjustment`,
                adjustment,
                {
                    signal_type: signal.type,
                    adjustment_type:
                        adjustment > 0
                            ? "boost"
                            : adjustment < 0
                              ? "reduction"
                              : "none",
                }
            );

            // Correlation strength impact
            const correlationStrength =
                confirmedSignal.correlationData.correlationStrength;
            this.metricsCollector.recordHistogram(
                `signal_manager_correlation_strength_distribution`,
                correlationStrength,
                {
                    signal_type: signal.type,
                    has_correlation: correlationStrength > 0 ? "yes" : "no",
                }
            );
        }
    }

    /**
     * Record detailed rejection metrics with categorized reasons.
     */
    private recordRejectionMetrics(
        signal: ProcessedSignal,
        rejectionReason: string
    ): void {
        const rejectionLabels = {
            signal_type: signal.type,
            detector_id: signal.detectorId,
            rejection_reason: rejectionReason,
            confidence_bucket: this.getConfidenceBucket(signal.confidence),
        };

        // Detailed rejection tracking
        this.metricsCollector.incrementCounter(
            `signal_manager_rejections_detailed_total`,
            1,
            rejectionLabels
        );

        // Per-type rejection counter for stats aggregation
        this.metricsCollector.incrementCounter(
            `signal_manager_rejections_detailed_total_${signal.type}`,
            1
        );

        // Rejection reason distribution
        this.metricsCollector.incrementCounter(
            `signal_manager_rejection_reasons_total`,
            1,
            { reason: rejectionReason }
        );

        // Track rejection by confidence level
        this.metricsCollector.incrementCounter(
            `signal_manager_rejections_by_confidence_total`,
            1,
            {
                signal_type: signal.type,
                confidence_bucket: this.getConfidenceBucket(signal.confidence),
                rejection_category:
                    this.categorizeRejectionReason(rejectionReason),
            }
        );

        // Detector-specific rejection rates
        this.metricsCollector.incrementCounter(
            `signal_manager_detector_rejections_total`,
            1,
            {
                detector_id: signal.detectorId,
                rejection_reason: rejectionReason,
            }
        );
    }

    /**
     * Record confirmation metrics with enhanced signal correlation data.
     */
    private recordConfirmationMetrics(
        signal: ProcessedSignal,
        confirmedSignal: ConfirmedSignal
    ): void {
        const confirmationLabels = {
            signal_type: signal.type,
            detector_id: signal.detectorId,
            market_healthy: confirmedSignal.anomalyData.marketHealthy
                ? "yes"
                : "no",
            has_correlation:
                confirmedSignal.correlationData.correlatedSignals > 0
                    ? "yes"
                    : "no",
        };

        // Enhanced confirmation tracking
        this.metricsCollector.incrementCounter(
            `signal_manager_confirmations_enhanced_total`,
            1,
            confirmationLabels
        );

        // Market health impact on confirmations
        this.metricsCollector.incrementCounter(
            `signal_manager_confirmations_by_market_health_total`,
            1,
            {
                signal_type: signal.type,
                market_healthy: confirmedSignal.anomalyData.marketHealthy
                    ? "healthy"
                    : "unhealthy",
                health_recommendation: confirmedSignal.anomalyData
                    .healthRecommendation
                    ? confirmedSignal.anomalyData.healthRecommendation
                    : "unknown",
            }
        );

        // Correlation impact metrics
        if (confirmedSignal.correlationData.correlatedSignals > 0) {
            this.metricsCollector.recordHistogram(
                `signal_manager_correlated_signals_count`,
                confirmedSignal.correlationData.correlatedSignals,
                { signal_type: signal.type }
            );

            this.metricsCollector.incrementCounter(
                `signal_manager_correlated_confirmations_total`,
                1,
                {
                    signal_type: signal.type,
                    correlation_strength_tier: this.getCorrelationTier(
                        confirmedSignal.correlationData.correlationStrength
                    ),
                }
            );
        }

        // Final confidence distribution for confirmed signals
        this.metricsCollector.recordHistogram(
            `signal_manager_confirmed_signal_final_confidence`,
            confirmedSignal.confidence,
            {
                signal_type: signal.type,
                detector_id: signal.detectorId,
            }
        );
    }

    /**
     * Record signal timing and processing metrics.
     */
    private recordSignalTimingMetrics(signal: ProcessedSignal): void {
        const processingTime = Date.now() - signal.timestamp.getTime();

        this.metricsCollector.recordHistogram(
            `signal_manager_signal_processing_duration_ms`,
            processingTime,
            {
                signal_type: signal.type,
                detector_id: signal.detectorId,
            }
        );

        // Signal age when processed
        this.metricsCollector.recordHistogram(
            `signal_manager_signal_age_ms`,
            processingTime,
            { signal_type: signal.type }
        );
    }

    /**
     * Get quality tier based on confidence score.
     */
    private getQualityTier(confidence: number): string {
        if (confidence >= 0.9) return "high";
        if (confidence >= 0.8) return "medium_high";
        if (confidence >= 0.7) return "medium";
        if (confidence >= 0.6) return "medium_low";
        return "low";
    }

    /**
     * Get confidence bucket for statistical analysis.
     */
    private getConfidenceBucket(confidence: number): string {
        const bucket =
            Math.floor(FinancialMath.multiplyQuantities(confidence, 10)) * 10; // Math.floor acceptable for integer bucket calculation
        return `${bucket}-${bucket + 10}`;
    }

    /**
     * Get correlation strength tier.
     */
    private getCorrelationTier(strength: number): string {
        if (strength >= 0.8) return "very_strong";
        if (strength >= 0.6) return "strong";
        if (strength >= 0.4) return "moderate";
        if (strength >= 0.2) return "weak";
        return "very_weak";
    }

    /**
     * Categorize rejection reasons for analysis.
     */
    private categorizeRejectionReason(reason: string): string {
        switch (reason) {
            case "low_confidence":
                return "quality_filter";
            case "unhealthy_market":
                return "market_condition";
            case "processing_error":
                return "technical_error";
            case "timeout":
                return "timing_issue";
            case "duplicate":
            case "throttled_duplicate":
                return "duplicate_filter";
            default:
                return "other";
        }
    }

    /**
     * Log signal processing information.
     */
    private logSignalProcessing(
        signal: ProcessedSignal,
        confirmedSignal: ConfirmedSignal
    ): void {
        this.logger.info(
            "[SignalManager] Signal processed with market health check",
            {
                signalId: signal.id,
                signalType: signal.type,
                confidence: {
                    original: signal.confidence,
                    final: confirmedSignal.confidence,
                    correlationBoost:
                        confirmedSignal.correlationData.correlationStrength *
                        0.15,
                },
                marketHealth: {
                    healthy: confirmedSignal.anomalyData.marketHealthy,
                    recommendation:
                        confirmedSignal.anomalyData.healthRecommendation,
                    criticalIssues:
                        confirmedSignal.anomalyData.criticalIssues?.length || 0,
                },
            }
        );
    }

    /**
     * Get current market health context for external systems.
     */
    public getMarketHealthContext(): MarketHealthContext {
        const health = this.anomalyDetector.getMarketHealth();

        return {
            isHealthy: health.isHealthy,
            recommendation: health.recommendation,
            criticalIssues: health.criticalIssues,
            recentAnomalyTypes: health.recentAnomalyTypes,
            lastUpdate: Date.now(),
        };
    }

    /**
     * Initialize enhanced signal metrics.
     */
    private initializeMetrics(): void {
        try {
            // Legacy metrics (keep for compatibility)
            this.metricsCollector.createCounter(
                "signal_manager_signals_received_total",
                "Total number of signals received",
                ["signal_type", "detector_id"]
            );

            this.metricsCollector.createCounter(
                "signal_manager_signal_blocked_by_health_total",
                "Total number of signals blocked by market health checks",
                ["signal_type"]
            );

            this.metricsCollector.createCounter(
                "signal_manager_signal_rejected_low_confidence_total",
                "Total number of signals rejected due to low confidence",
                ["signal_type"]
            );

            this.metricsCollector.createCounter(
                "signal_manager_signals_confirmed_total",
                "Total number of signals confirmed",
                ["signal_type", "detector_id", "trading_side"]
            );

            this.metricsCollector.createGauge(
                "signal_manager_recent_signals_count",
                "Current number of recent signals"
            );

            this.metricsCollector.createHistogram(
                "signal_manager_confidence_score",
                "Distribution of signal confidence scores",
                ["signal_type", "detector_id"],
                [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
            );

            // Enhanced detailed metrics
            this.metricsCollector.createCounter(
                "signal_manager_signals_processed_total",
                "Total signals processed with detailed tracking",
                ["signal_type", "detector_id", "outcome"]
            );

            this.metricsCollector.createHistogram(
                "signal_manager_signal_confidence_distribution",
                "Distribution of signal confidence scores by outcome",
                ["signal_type", "detector_id", "outcome"],
                [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
            );

            this.metricsCollector.createCounter(
                "signal_manager_quality_tier_total",
                "Signals by quality tier",
                ["signal_type", "detector_id", "quality_tier"]
            );

            this.metricsCollector.createHistogram(
                "signal_manager_detector_confidence_score",
                "Confidence scores by detector",
                ["detector_id", "signal_type"],
                [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
            );

            this.metricsCollector.createHistogram(
                "signal_manager_confidence_adjustment",
                "Confidence adjustments during processing",
                ["signal_type", "adjustment_type"],
                [-0.5, -0.3, -0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2, 0.3, 0.5]
            );

            this.metricsCollector.createHistogram(
                "signal_manager_correlation_strength_distribution",
                "Distribution of correlation strength values",
                ["signal_type", "has_correlation"],
                [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
            );

            // Rejection metrics
            this.metricsCollector.createCounter(
                "signal_manager_rejections_detailed_total",
                "Detailed rejection tracking",
                [
                    "signal_type",
                    "detector_id",
                    "rejection_reason",
                    "confidence_bucket",
                ]
            );

            this.metricsCollector.createCounter(
                "signal_manager_rejection_reasons_total",
                "Rejection reasons distribution",
                ["reason"]
            );

            this.metricsCollector.createCounter(
                "signal_manager_rejections_by_confidence_total",
                "Rejections by confidence level",
                ["signal_type", "confidence_bucket", "rejection_category"]
            );

            this.metricsCollector.createCounter(
                "signal_manager_detector_rejections_total",
                "Detector-specific rejection rates",
                ["detector_id", "rejection_reason"]
            );

            // Confirmation metrics
            this.metricsCollector.createCounter(
                "signal_manager_confirmations_enhanced_total",
                "Enhanced confirmation tracking",
                [
                    "signal_type",
                    "detector_id",
                    "market_healthy",
                    "has_correlation",
                ]
            );

            this.metricsCollector.createCounter(
                "signal_manager_confirmations_by_market_health_total",
                "Confirmations by market health status",
                ["signal_type", "market_healthy", "health_recommendation"]
            );

            this.metricsCollector.createHistogram(
                "signal_manager_correlated_signals_count",
                "Number of correlated signals",
                ["signal_type"],
                [0, 1, 2, 3, 4, 5, 10, 15, 20, 25, 50]
            );

            this.metricsCollector.createCounter(
                "signal_manager_correlated_confirmations_total",
                "Confirmations with correlation data",
                ["signal_type", "correlation_strength_tier"]
            );

            this.metricsCollector.createHistogram(
                "signal_manager_confirmed_signal_final_confidence",
                "Final confidence for confirmed signals",
                ["signal_type", "detector_id"],
                [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
            );

            // Timing metrics
            this.metricsCollector.createHistogram(
                "signal_manager_signal_processing_duration_ms",
                "Signal processing duration",
                ["signal_type", "detector_id"],
                [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]
            );

            this.metricsCollector.createHistogram(
                "signal_manager_signal_age_ms",
                "Signal age when processed",
                ["signal_type"],
                [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]
            );

            // Backpressure and queue management metrics
            this.metricsCollector.createGauge(
                "signal_manager_queue_size",
                "Current signal queue size"
            );

            this.metricsCollector.createCounter(
                "signal_manager_signals_dropped_total",
                "Total signals dropped due to backpressure",
                ["signal_type", "detector_id", "drop_reason"]
            );

            this.metricsCollector.createHistogram(
                "signal_manager_queue_utilization",
                "Signal queue utilization percentage",
                [],
                [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
            );

            this.logger.debug(
                "[SignalManager] Enhanced signal metrics initialized",
                {
                    component: "SignalManager",
                    metricsCount: "legacy + detailed tracking + backpressure",
                }
            );
        } catch (error) {
            this.logger.error("[SignalManager] Failed to initialize metrics", {
                component: "SignalManager",
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Get signal manager status.
     */
    public getStatus(): {
        recentSignalsCount: number;
        correlationsCount: number;
        historySize: number;
        marketHealth: MarketHealthContext;
        config: SignalManagerConfig;
        backpressure: {
            queueSize: number;
            queueUtilization: number;
            isActive: boolean;
            droppedSignalCounts: Record<string, number>;
        };
        performanceTracking?: {
            activeSignalsCount: number;
            completedSignalsCount: number;
            isTracking: boolean;
        };
    } {
        const queueUtilization =
            this.signalQueue.length / this.config.maxQueueSize;

        const status = {
            recentSignalsCount: this.recentSignals.size,
            correlationsCount: this.correlations.size,
            historySize: this.signalHistory.length,
            marketHealth: this.getMarketHealthContext(),
            config: this.config,
            backpressure: {
                queueSize: this.signalQueue.length,
                queueUtilization,
                isActive: this.backpressureActive,
                droppedSignalCounts: Object.fromEntries(
                    this.droppedSignalCounts
                ),
            },
            performanceTracking: {
                activeSignalsCount: 0,
                completedSignalsCount: 0,
                isTracking: false,
            },
        };

        // Add performance tracking status if available
        if (this.signalTracker) {
            const trackerStatus = this.signalTracker.getStatus();
            status.performanceTracking = {
                activeSignalsCount: trackerStatus.activeSignals,
                completedSignalsCount: trackerStatus.completedSignals,
                isTracking: true,
            };
        }

        return status;
    }

    /**
     * Retrieve the reason for the most recently rejected signal.
     */
    public getLastRejectReason(): string | undefined {
        return this.lastRejectReason;
    }

    /**
     * Get performance metrics from signal tracker if available.
     */
    public getPerformanceMetrics(
        timeWindow?: number
    ): PerformanceMetrics | null {
        if (!this.signalTracker) {
            this.logger.warn(
                "[SignalManager] Performance metrics requested but SignalTracker not available",
                {
                    component: "SignalManager",
                }
            );
            return null;
        }

        try {
            return this.signalTracker.getPerformanceMetrics(timeWindow);
        } catch (error) {
            this.logger.error(
                "[SignalManager] Failed to get performance metrics",
                {
                    component: "SignalManager",
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
            return null;
        }
    }

    /**
     * Get comprehensive signal processing statistics.
     */
    public getSignalStatistics(): SignalStatistics {
        const metrics = this.metricsCollector.getMetrics();

        return {
            processing: {
                totalProcessed: this.getCounterValue(
                    metrics,
                    "signal_manager_signals_processed_total"
                ),
                totalReceived: this.getCounterValue(
                    metrics,
                    "signal_manager_signals_received_total"
                ),
                totalConfirmed: this.getCounterValue(
                    metrics,
                    "signal_manager_signals_confirmed_total"
                ),
                processingDurationP50: this.getHistogramPercentile(
                    metrics,
                    "signal_manager_signal_processing_duration_ms",
                    50
                ),
                processingDurationP95: this.getHistogramPercentile(
                    metrics,
                    "signal_manager_signal_processing_duration_ms",
                    95
                ),
            },
            rejections: {
                totalRejected: this.getCounterValue(
                    metrics,
                    "signal_manager_rejections_detailed_total"
                ),
                byReason: {
                    lowConfidence: this.getCounterValue(
                        metrics,
                        "signal_manager_signal_rejected_low_confidence_total"
                    ),
                    unhealthyMarket: this.getCounterValue(
                        metrics,
                        "signal_manager_signal_blocked_by_health_total"
                    ),
                    processingError: this.getCounterValueByLabel(
                        metrics,
                        "signal_manager_rejection_reasons_total",
                        "reason",
                        "processing_error"
                    ),
                    timeout: this.getCounterValueByLabel(
                        metrics,
                        "signal_manager_rejection_reasons_total",
                        "reason",
                        "timeout"
                    ),
                    duplicate: this.getCounterValueByLabel(
                        metrics,
                        "signal_manager_rejection_reasons_total",
                        "reason",
                        "duplicate"
                    ),
                },
                byConfidenceBucket:
                    this.getRejectionsByConfidenceBucket(metrics),
            },
            quality: {
                averageConfidence: this.getHistogramMean(
                    metrics,
                    "signal_manager_signal_confidence_distribution"
                ),
                confidenceP50: this.getHistogramPercentile(
                    metrics,
                    "signal_manager_signal_confidence_distribution",
                    50
                ),
                confidenceP95: this.getHistogramPercentile(
                    metrics,
                    "signal_manager_signal_confidence_distribution",
                    95
                ),
                qualityTiers: this.getQualityTierDistribution(metrics),
                averageConfidenceAdjustment: this.getHistogramMean(
                    metrics,
                    "signal_manager_confidence_adjustment"
                ),
            },
            correlation: {
                averageStrength: this.getHistogramMean(
                    metrics,
                    "signal_manager_correlation_strength_distribution"
                ),
                correlatedSignalsP50: this.getHistogramPercentile(
                    metrics,
                    "signal_manager_correlated_signals_count",
                    50
                ),
                correlatedSignalsP95: this.getHistogramPercentile(
                    metrics,
                    "signal_manager_correlated_signals_count",
                    95
                ),
                confirmationsWithCorrelation: this.getCounterValueByLabel(
                    metrics,
                    "signal_manager_confirmations_enhanced_total",
                    "has_correlation",
                    "yes"
                ),
            },
            byDetector: this.getDetectorStatistics(metrics),
            bySignalType: this.getSignalTypeStatistics(metrics),
            marketHealth: {
                confirmationsHealthyMarket: this.getCounterValueByLabel(
                    metrics,
                    "signal_manager_confirmations_by_market_health_total",
                    "market_healthy",
                    "healthy"
                ),
                confirmationsUnhealthyMarket: this.getCounterValueByLabel(
                    metrics,
                    "signal_manager_confirmations_by_market_health_total",
                    "market_healthy",
                    "unhealthy"
                ),
                blockedByHealth: this.getCounterValue(
                    metrics,
                    "signal_manager_signal_blocked_by_health_total"
                ),
            },
            timing: {
                averageSignalAge: this.getHistogramMean(
                    metrics,
                    "signal_manager_signal_age_ms"
                ),
                signalAgeP95: this.getHistogramPercentile(
                    metrics,
                    "signal_manager_signal_age_ms",
                    95
                ),
            },
        };
    }

    // Helper methods for metrics extraction
    private getCounterValue(
        metrics: EnhancedMetrics,
        metricName: string
    ): number {
        const value = metrics.counters[metricName]?.value;
        const numericValue = Number(value);
        return isNaN(numericValue) ? 0 : numericValue;
    }

    private getCounterValueByLabel(
        metrics: EnhancedMetrics,
        metricName: string,
        labelKey: string,
        labelValue: string
    ): number {
        // This is a simplified implementation - in practice, you'd need to filter by labels
        // For now, return a placeholder value
        void metrics;
        void metricName;
        void labelKey;
        void labelValue;
        return 0; // TODO: Implement proper label filtering when MetricsCollector supports it
    }

    private getHistogramPercentile(
        metrics: EnhancedMetrics,
        metricName: string,
        percentile: number
    ): number {
        const histogram = metrics.histograms[metricName];
        return histogram?.percentiles?.[`p${percentile}`] || 0;
    }

    private getHistogramMean(
        metrics: EnhancedMetrics,
        metricName: string
    ): number {
        const histogram = metrics.histograms[metricName];
        return histogram?.mean || 0;
    }

    private getRejectionsByConfidenceBucket(
        metrics: EnhancedMetrics
    ): Record<string, number> {
        void metrics;
        // TODO: Implement when label-based filtering is available
        return {};
    }

    private getQualityTierDistribution(
        metrics: EnhancedMetrics
    ): Record<string, number> {
        void metrics;
        // TODO: Implement when label-based filtering is available
        return {};
    }

    private getDetectorStatistics(
        metrics: EnhancedMetrics
    ): Record<string, DetectorStats> {
        void metrics;
        // TODO: Implement when label-based filtering is available
        return {};
    }

    private getSignalTypeStatistics(
        metrics: EnhancedMetrics
    ): Record<string, SignalTypeStats> {
        void metrics;
        // TODO: Implement when label-based filtering is available
        return {};
    }

    // 🔧 =============== ENHANCED BACKPRESSURE HELPER METHODS ===============

    /**
     * Calculate priority score for a signal based on type, confidence, and market conditions.
     */
    private calculateSignalPriority(signal: ProcessedSignal): number {
        // Base priority from signal type configuration
        const baseTypePriority =
            this.config.signalTypePriorities[signal.type] ||
            this.defaultPriority;

        // Confidence boost (0.5 - 1.0 confidence maps to 0-2 priority points)
        const confidenceBoost = Math.max(
            0,
            FinancialMath.multiplyQuantities(
                FinancialMath.safeSubtract(signal.confidence, 0.5),
                4
            )
        );

        // Market health modifier
        const marketHealth = this.anomalyDetector.getMarketHealth();
        const healthModifier = marketHealth.isHealthy ? 0.5 : -0.5;

        // Time sensitivity - newer signals get slight priority
        const ageMs = Date.now() - signal.timestamp.getTime();
        const freshnessBoost = Math.max(
            0,
            FinancialMath.safeSubtract(
                1,
                FinancialMath.divideQuantities(ageMs, 60000)
            )
        ); // Decay over 1 minute

        const totalPriority = FinancialMath.safeAdd(
            FinancialMath.safeAdd(
                FinancialMath.safeAdd(baseTypePriority, confidenceBoost),
                healthModifier
            ),
            freshnessBoost
        );

        return Math.min(10, Math.max(0, totalPriority));
    }

    /**
     * Calculate priority threshold for dropping signals during backpressure.
     */
    private calculateBackpressurePriorityThreshold(
        queueUtilization: number
    ): number {
        // Progressive priority thresholds based on queue pressure
        if (queueUtilization >= 0.95) return 9; // Only highest priority
        if (queueUtilization >= 0.9) return 8; // High priority
        if (queueUtilization >= 0.85) return 7; // Medium-high priority
        if (queueUtilization >= 0.8) return 6; // Medium priority
        return 5; // Medium-low and above
    }

    /**
     * Check if circuit breaker is open for a detector.
     */
    private isCircuitBreakerOpen(detectorId: string): boolean {
        const state = this.circuitBreakers.get(detectorId);
        if (!state) return false;

        if (state.isOpen && Date.now() > state.nextRetryTime) {
            // Time to test if circuit can be closed
            state.isOpen = false;
            this.logger.info("[SignalManager] Circuit breaker test mode", {
                detectorId,
            });
        }

        return state.isOpen;
    }

    /**
     * Record circuit breaker failure for a detector.
     */
    private recordCircuitBreakerFailure(detectorId: string): void {
        let state = this.circuitBreakers.get(detectorId);
        if (!state) {
            state = {
                isOpen: false,
                failureCount: 0,
                lastFailureTime: 0,
                nextRetryTime: 0,
            };
            this.circuitBreakers.set(detectorId, state);
        }

        state.failureCount++;
        state.lastFailureTime = Date.now();

        if (state.failureCount >= this.config.circuitBreakerThreshold) {
            state.isOpen = true;
            state.nextRetryTime =
                Date.now() + this.config.circuitBreakerResetMs;

            this.logger.warn(
                "[SignalManager] Circuit breaker opened for detector",
                {
                    detectorId,
                    failureCount: state.failureCount,
                    nextRetryTime: new Date(state.nextRetryTime).toISOString(),
                }
            );

            this.metricsCollector.incrementCounter(
                "signal_manager_circuit_breaker_opened_total",
                1,
                { detector_id: detectorId }
            );
        }
    }

    /**
     * Reset circuit breaker on successful processing.
     */
    private resetCircuitBreaker(detectorId: string): void {
        const state = this.circuitBreakers.get(detectorId);
        if (state && state.failureCount > 0) {
            state.failureCount = 0;
            if (state.isOpen) {
                state.isOpen = false;
                this.logger.info("[SignalManager] Circuit breaker reset", {
                    detectorId,
                });
                this.metricsCollector.incrementCounter(
                    "signal_manager_circuit_breaker_reset_total",
                    1,
                    { detector_id: detectorId }
                );
            }
        }
    }

    /**
     * Update processing metrics for adaptive optimization.
     */
    private updateProcessingMetrics(
        processingTimeMs: number,
        success: boolean
    ): void {
        // Update processing time metrics
        this.adaptiveMetrics.recentProcessingTimes.push(processingTimeMs);

        // Keep only recent measurements (last 100)
        if (this.adaptiveMetrics.recentProcessingTimes.length > 100) {
            this.adaptiveMetrics.recentProcessingTimes.shift();
        }

        // Calculate rolling average
        this.adaptiveMetrics.avgProcessingTimeMs =
            this.adaptiveMetrics.recentProcessingTimes.reduce(
                (sum, time) => sum + time,
                0
            ) / this.adaptiveMetrics.recentProcessingTimes.length;

        // Update success rate metrics
        this.metricsCollector.incrementCounter(
            success
                ? "signal_manager_processing_success_total"
                : "signal_manager_processing_failure_total",
            1
        );

        this.metricsCollector.setGauge(
            "signal_manager_avg_processing_time_ms",
            this.adaptiveMetrics.avgProcessingTimeMs
        );
    }

    /**
     * Update adaptive metrics and throughput calculations.
     */
    private updateAdaptiveMetrics(): void {
        const now = Date.now();
        const timeSinceLastUpdate =
            now - this.adaptiveMetrics.lastThroughputCalculation;

        if (timeSinceLastUpdate >= 5000) {
            // Update every 5 seconds
            // Calculate throughput based on recent processing
            const recentProcessingCount =
                this.adaptiveMetrics.recentProcessingTimes.length;
            this.adaptiveMetrics.queueThroughputPerSecond =
                recentProcessingCount / (timeSinceLastUpdate / 1000);

            this.adaptiveMetrics.lastThroughputCalculation = now;

            // Update queue growth rate
            const currentQueueSize = this.signalQueue.length;
            const timeDiff = now - this.lastQueueSizeCheck;
            if (timeDiff > 0) {
                this.queueGrowthRate = currentQueueSize / (timeDiff / 1000); // Signals per second
            }
            this.lastQueueSizeCheck = now;

            this.metricsCollector.setGauge(
                "signal_manager_queue_throughput_per_sec",
                this.adaptiveMetrics.queueThroughputPerSecond
            );
            this.metricsCollector.setGauge(
                "signal_manager_queue_growth_rate",
                this.queueGrowthRate
            );
        }
    }

    /**
     * Adjust batch size based on performance metrics.
     */
    private adjustAdaptiveBatchSize(): void {
        if (!this.config.adaptiveBatchSizing) return;

        const currentLoad = this.signalQueue.length / this.config.maxQueueSize;
        const avgProcessingTime = this.adaptiveMetrics.avgProcessingTimeMs;

        // Increase batch size if:
        // - Queue is growing faster than we can process
        // - Processing time is low (system has capacity)
        // - Queue utilization is high
        if (
            this.queueGrowthRate >
                this.adaptiveMetrics.queueThroughputPerSecond &&
            avgProcessingTime < 10 &&
            currentLoad > 0.3
        ) {
            this.currentBatchSize = Math.min(
                this.config.maxAdaptiveBatchSize,
                FinancialMath.safeAdd(this.currentBatchSize, 2) // Fixed by using conditional instead of array
            );
        }
        // Decrease batch size if:
        // - Processing time is high (system overloaded)
        // - Queue is stable or shrinking
        else if (
            avgProcessingTime > 50 ||
            (this.queueGrowthRate <=
                this.adaptiveMetrics.queueThroughputPerSecond &&
                currentLoad < 0.5)
        ) {
            this.currentBatchSize = Math.max(
                this.config.minAdaptiveBatchSize,
                FinancialMath.safeSubtract(this.currentBatchSize, 1)
            );
        }

        this.metricsCollector.setGauge(
            "signal_manager_adaptive_batch_size",
            this.currentBatchSize
        );
    }

    /**
     * Check and update circuit breaker states.
     */
    private checkCircuitBreakers(): void {
        for (const [detectorId, state] of this.circuitBreakers) {
            this.metricsCollector.setGauge(
                "signal_manager_circuit_breaker_failure_count",
                state.failureCount,
                { detector_id: detectorId }
            );
            this.metricsCollector.setGauge(
                "signal_manager_circuit_breaker_is_open",
                state.isOpen ? 1 : 0,
                { detector_id: detectorId }
            );
        }
    }

    // Internal signal type tracking
    private readonly signalTypeStats: Record<
        string,
        {
            candidates: number;
            confirmed: number;
            rejected: number;
        }
    > = {
        absorption: { candidates: 0, confirmed: 0, rejected: 0 },
        exhaustion: { candidates: 0, confirmed: 0, rejected: 0 },
        accumulation: { candidates: 0, confirmed: 0, rejected: 0 },
        distribution: { candidates: 0, confirmed: 0, rejected: 0 },
        deltacvd: { candidates: 0, confirmed: 0, rejected: 0 },
    };

    /**
     * Get signal type breakdown metrics for dashboard display
     */
    public getSignalTypeBreakdown(): Record<
        string,
        {
            candidates: number;
            confirmed: number;
            rejected: number;
            successRate: string;
        }
    > {
        const breakdown: Record<
            string,
            {
                candidates: number;
                confirmed: number;
                rejected: number;
                successRate: string;
            }
        > = {};

        this.logger.debug("[SignalManager] Getting signal type breakdown", {
            currentStats: this.signalTypeStats,
        });

        for (const [signalType, stats] of Object.entries(
            this.signalTypeStats
        )) {
            const successRate =
                stats.candidates > 0
                    ? ((stats.confirmed / stats.candidates) * 100).toFixed(1)
                    : "--";

            breakdown[signalType] = {
                candidates: stats.candidates,
                confirmed: stats.confirmed,
                rejected: stats.rejected,
                successRate: successRate === "--" ? "--" : successRate + "%",
            };
        }

        return breakdown;
    }

    /**
     * Get aggregated signal totals for dashboard overview
     * Uses accurate signalTypeStats to avoid double-counting from detailed metrics
     */
    public getSignalTotals(): {
        candidates: number;
        confirmed: number;
        rejected: number;
    } {
        let totalCandidates = 0;
        let totalConfirmed = 0;
        let totalRejected = 0;

        for (const stats of Object.values(this.signalTypeStats)) {
            totalCandidates += stats.candidates;
            totalConfirmed += stats.confirmed;
            totalRejected += stats.rejected;
        }

        return {
            candidates: totalCandidates,
            confirmed: totalConfirmed,
            rejected: totalRejected,
        };
    }
}

type MarketHealthContext = {
    isHealthy: boolean;
    recommendation: string;
    criticalIssues: string[];
    recentAnomalyTypes: string[];
    lastUpdate: number;
};

// Enhanced signal statistics interfaces
export interface SignalStatistics {
    processing: {
        totalProcessed: number;
        totalReceived: number;
        totalConfirmed: number;
        processingDurationP50: number;
        processingDurationP95: number;
    };
    rejections: {
        totalRejected: number;
        byReason: {
            lowConfidence: number;
            unhealthyMarket: number;
            processingError: number;
            timeout: number;
            duplicate: number;
        };
        byConfidenceBucket: Record<string, number>;
    };
    quality: {
        averageConfidence: number;
        confidenceP50: number;
        confidenceP95: number;
        qualityTiers: Record<string, number>;
        averageConfidenceAdjustment: number;
    };
    correlation: {
        averageStrength: number;
        correlatedSignalsP50: number;
        correlatedSignalsP95: number;
        confirmationsWithCorrelation: number;
    };
    byDetector: Record<string, DetectorStats>;
    bySignalType: Record<string, SignalTypeStats>;
    marketHealth: {
        confirmationsHealthyMarket: number;
        confirmationsUnhealthyMarket: number;
        blockedByHealth: number;
    };
    timing: {
        averageSignalAge: number;
        signalAgeP95: number;
    };
}

export interface DetectorStats {
    totalProcessed: number;
    totalConfirmed: number;
    totalRejected: number;
    averageConfidence: number;
    rejectionRate: number;
    confirmationRate: number;
    averageProcessingTime: number;
}

export interface SignalTypeStats {
    totalProcessed: number;
    totalConfirmed: number;
    totalRejected: number;
    averageConfidence: number;
    averageCorrelationStrength: number;
    qualityDistribution: Record<string, number>;
    rejectionReasons: Record<string, number>;
}
