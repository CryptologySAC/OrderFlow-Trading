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
import { Logger } from "../infrastructure/logger.js";
import type { IPipelineStorage } from "../storage/pipelineStorage.js";
import {
    MetricsCollector,
    type EnhancedMetrics,
} from "../infrastructure/metricsCollector.js";
import {
    calculateProfitTarget,
    calculateStopLoss,
} from "../utils/calculations.js";
import type {
    SignalTracker,
    PerformanceMetrics,
} from "../analysis/signalTracker.js";
import type { MarketContextCollector } from "../analysis/marketContextCollector.js";

export interface SignalManagerConfig {
    confidenceThreshold?: number;
    signalTimeout?: number;
    enableMarketHealthCheck?: boolean;
    enableAlerts?: boolean;
}

interface SignalCorrelation {
    signalId: string;
    correlatedSignals: ProcessedSignal[];
    timestamp: number;
    strength: number;
}

/**
 * Simplified SignalManager focused on signal coordination and market health gatekeeper.
 * Uses AnomalyDetector only for market health checks, not signal enhancement.
 */
export class SignalManager extends EventEmitter {
    /**
     * Priority queue to throttle signals by confidence per symbol.
     * Keeps the top N signals within a rolling time window.
     */
    private static PriorityThrottleQueue = class {
        private readonly queue = new Map<string, ProcessedSignal[]>();

        constructor(
            private readonly capacity: number,
            private readonly windowMs: number
        ) {}

        public tryAdd(signal: ProcessedSignal): boolean {
            const data = signal.data as unknown as {
                symbol?: string;
                severity?: string;
            };
            const symbol = data.symbol ?? "UNKNOWN";
            const severity = data.severity;
            const now = Date.now();

            const list = this.queue.get(symbol) ?? [];
            const filtered = list.filter(
                (s) => now - s.timestamp.getTime() <= this.windowMs
            );

            if (list.length !== filtered.length) {
                this.queue.set(symbol, filtered);
            }

            if (severity === "critical") {
                this.insert(filtered, signal);
                this.trim(filtered);
                this.queue.set(symbol, filtered);
                return true;
            }

            if (filtered.length < this.capacity) {
                this.insert(filtered, signal);
                this.queue.set(symbol, filtered);
                return true;
            }

            const lowest = filtered[filtered.length - 1];
            if (signal.confidence <= lowest.confidence) {
                return false;
            }

            this.insert(filtered, signal);
            this.trim(filtered);
            this.queue.set(symbol, filtered);
            return true;
        }

        private insert(list: ProcessedSignal[], signal: ProcessedSignal): void {
            list.push(signal);
            list.sort((a, b) => b.confidence - a.confidence);
        }

        private trim(list: ProcessedSignal[]): void {
            if (list.length > this.capacity) {
                list.length = this.capacity;
            }
        }
    };

    private readonly config: Required<SignalManagerConfig>;
    private readonly recentSignals = new Map<string, ProcessedSignal>();
    private readonly correlations = new Map<string, SignalCorrelation>();
    private readonly signalHistory: ProcessedSignal[] = [];
    private lastRejectReason?: string;

    // Keep track of signals for correlation analysis
    private readonly maxHistorySize = 100;
    private readonly correlationWindowMs = 60000; // 1 minute

    // Signal throttling and deduplication
    private readonly recentTradingSignals = new Map<string, number>(); // signalKey -> timestamp
    private readonly signalThrottleMs = 30000; // 30 seconds minimum between similar signals
    private readonly priceTolerancePercent = 0.05; // 0.05% price tolerance for duplicates - slightly wider for deduplication

    // Priority throttling for top signals per symbol
    private readonly priorityQueue = new SignalManager.PriorityThrottleQueue(
        3,
        5 * 60 * 1000
    );

    constructor(
        private readonly anomalyDetector: AnomalyDetector,
        private readonly alertManager: AlertManager,
        private readonly logger: Logger,
        private readonly metricsCollector: MetricsCollector,
        private readonly storage: IPipelineStorage,
        private readonly signalTracker?: SignalTracker,
        private readonly marketContextCollector?: MarketContextCollector,
        config: Partial<SignalManagerConfig> = {}
    ) {
        super();

        this.config = {
            confidenceThreshold: config.confidenceThreshold ?? 0.75,
            signalTimeout: config.signalTimeout ?? 300000,
            enableMarketHealthCheck: config.enableMarketHealthCheck ?? true,
            enableAlerts: config.enableAlerts ?? true,
        };

        this.logger.info(
            "SignalManager initialized as market health gatekeeper",
            {
                component: "SignalManager",
                config: this.config,
                role: "signal_coordination_and_health_check",
            }
        );

        // Initialize metrics
        this.initializeMetrics();

        // Clean up old signals periodically
        setInterval(() => {
            this.cleanupOldSignals();
            this.storage.purgeSignalHistory();
            this.storage.purgeConfirmedSignals();
        }, 60000); // Every minute
    }

    /**
     * Simplified signal processing - market health gatekeeper + signal coordination.
     * No complex anomaly enhancement, just health-based allow/block decisions.
     */
    public processSignal(signal: ProcessedSignal): ConfirmedSignal | null {
        this.lastRejectReason = undefined;
        try {
            // 1. Market health check (infrastructure safety)
            if (!this.checkMarketHealth()) {
                this.logger.info("Signal blocked due to market health", {
                    signalId: signal.id,
                    signalType: signal.type,
                    healthStatus: this.anomalyDetector.getMarketHealth(),
                });

                this.recordMetric("signal_blocked_by_health", signal.type);
                this.recordDetailedSignalMetrics(
                    signal,
                    "blocked",
                    "unhealthy_market"
                );
                this.lastRejectReason = "unhealthy_market";
                return null;
            }

            // 2. Confidence threshold check (with floating-point rounding)
            const roundedConfidence = Math.round(signal.confidence * 100) / 100;
            const roundedThreshold =
                Math.round(this.config.confidenceThreshold * 100) / 100;

            if (roundedConfidence < roundedThreshold) {
                this.logger.debug("Signal rejected due to low confidence", {
                    signalId: signal.id,
                    confidence: signal.confidence,
                    roundedConfidence,
                    threshold: this.config.confidenceThreshold,
                    roundedThreshold,
                });

                this.recordMetric(
                    "signal_rejected_low_confidence",
                    signal.type
                );
                this.recordDetailedSignalMetrics(
                    signal,
                    "rejected",
                    "low_confidence"
                );
                this.lastRejectReason = "low_confidence";
                return null;
            }

            // 3. Calculate signal correlations (existing logic)
            const correlation = this.calculateSignalCorrelation(signal);

            // 4. Create confirmed signal (no anomaly enhancement)
            const confirmedSignal = this.createConfirmedSignal(
                signal,
                correlation
            );

            // 5. Log and emit metrics
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
            this.logger.error("Failed to process signal", {
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
            this.logger.error("Failed to check market health", {
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
        // Simple confidence calculation with correlation boost only
        let finalConfidence = signal.confidence;

        // Apply correlation boost
        if (correlation.strength > 0) {
            finalConfidence = Math.min(
                finalConfidence * (1 + correlation.strength * 0.15),
                1.0
            );
        }

        // Get market health for context (not enhancement)
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
                confidenceAdjustment: {
                    originalConfidence: signal.confidence,
                    adjustedConfidence: finalConfidence,
                    finalConfidence,
                    correlationBoost: correlation.strength * 0.15,
                    healthImpact: "none", // No health-based confidence changes
                    impactFactors: [],
                },
            },
        };

        // Ensure signals are persisted before emitting to prevent backlog issues
        this.storage.saveSignalHistory(signal);
        this.storage.saveConfirmedSignal(confirmedSignal);

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

                this.logger.debug("Signal tracking initiated", {
                    signalId: confirmedSignal.id,
                    price: confirmedSignal.finalPrice,
                    confidence: confirmedSignal.confidence,
                });
            } catch (error) {
                this.logger.error("Failed to initiate signal tracking", {
                    signalId: confirmedSignal.id,
                    error:
                        error instanceof Error ? error.message : String(error),
                });
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

        // Find signals of the same type near the same price
        const correlatedSignals = recentSignals.filter((s) => {
            const priceDiff = Math.abs(s.data.price - signal.data.price);
            const priceThreshold = signal.data.price * 0.001; // 0.1% price tolerance

            return s.type === signal.type && priceDiff <= priceThreshold;
        });

        // Calculate correlation strength
        const strength = Math.min(correlatedSignals.length / 3, 1.0); // Max strength at 3+ correlations

        const correlation: SignalCorrelation = {
            signalId: signal.id,
            correlatedSignals,
            timestamp: Date.now(),
            strength,
        };

        this.correlations.set(signal.id, correlation);

        this.logger.debug("Signal correlation analyzed", {
            signalId: signal.id,
            correlatedCount: correlatedSignals.length,
            strength,
        });

        return correlation;
    }

    /**
     * Handle processed signal from SignalCoordinator.
     * This is the main entry point for signals from the coordinator.
     */
    public handleProcessedSignal(
        signal: ProcessedSignal
    ): ConfirmedSignal | null {
        let confirmedSignal: ConfirmedSignal | null = null;
        try {
            this.logger.info("Handling processed signal", {
                component: "SignalManager",
                operation: "handleProcessedSignal",
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

            // Apply priority throttling per symbol
            if (!this.priorityQueue.tryAdd(signal)) {
                this.logger.info("Signal discarded by priority queue", {
                    signalId: signal.id,
                    signalType: signal.type,
                    confidence: signal.confidence,
                });
                this.recordDetailedSignalMetrics(
                    signal,
                    "rejected",
                    "throttled_priority"
                );
                this.lastRejectReason = "throttled_priority";
                this.emit("signalRejected", {
                    signal,
                    reason: this.lastRejectReason,
                });
                return null;
            }

            // Store signal for correlation analysis
            this.storeSignal(signal);

            // Process signal through simplified pipeline
            confirmedSignal = this.processSignal(signal);

            if (!confirmedSignal) {
                this.emit("signalRejected", {
                    signal,
                    reason: this.lastRejectReason ?? "processing_failed",
                });
                return null;
            }

            // Generate final trading signal
            const tradingSignal = this.createTradingSignal(confirmedSignal);

            // Check for duplicate/throttled signals
            if (this.isSignalThrottled(tradingSignal)) {
                this.logger.info("Signal throttled to prevent duplicates", {
                    signalId: tradingSignal.id,
                    type: tradingSignal.type,
                    price: tradingSignal.price,
                    side: tradingSignal.side,
                });
                this.recordDetailedSignalMetrics(
                    signal,
                    "rejected",
                    "throttled_duplicate"
                );
                this.lastRejectReason = "throttled_duplicate";
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

            // Emit the final trading signal
            this.emit("signalGenerated", tradingSignal);
            this.emit("signalConfirmed", confirmedSignal);

            this.logger.info("Signal processed successfully", {
                signalId: signal.id,
                finalSignalId: tradingSignal.id,
                price: tradingSignal.price,
                side: tradingSignal.side,
                confidence: confirmedSignal.confidence,
                marketHealth: confirmedSignal.anomalyData.marketHealthy,
            });
        } catch (error: unknown) {
            this.logger.error("Failed to handle processed signal", {
                component: "SignalManager",
                operation: "handleProcessedSignal",
                signalId: signal.id,
                error: error instanceof Error ? error.message : String(error),
            });

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

        const result = confirmedSignal;

        return result;
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

        // Determine trading direction from signal data if available, otherwise use signal type
        const side: "buy" | "sell" =
            this.getSignalDirectionFromData(originalSignal);

        // Validate finalPrice before calculating TP/SL
        if (
            !confirmedSignal.finalPrice ||
            isNaN(confirmedSignal.finalPrice) ||
            confirmedSignal.finalPrice <= 0
        ) {
            this.logger.error("Invalid finalPrice for signal calculations", {
                signalId: confirmedSignal.id,
                finalPrice: confirmedSignal.finalPrice,
                side,
            });
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
            this.logger.error("Invalid TP/SL calculations", {
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

        const signalData: TradingSignalData = {
            confidence: confirmedSignal.confidence,
            confirmations: Array.from(originalSignal.confirmations),
            meta: originalSignal.metadata,
            anomalyCheck: confirmedSignal.anomalyData,
            correlationData: confirmedSignal.correlationData,
            side,
            price: confirmedSignal.finalPrice,
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
     * Get trading direction from signal data or fallback to signal type.
     */
    private getSignalDirectionFromData(
        signal: ConfirmedSignal["originalSignals"][0]
    ): "buy" | "sell" {
        // Try to extract side from signal metadata first (metadata = signal.data from detector)
        if (signal.metadata && typeof signal.metadata === "object") {
            const metadata = signal.metadata as unknown as Record<
                string,
                unknown
            >;
            if (metadata.side === "buy" || metadata.side === "sell") {
                return metadata.side;
            }
        }

        // Fallback to signal type-based direction
        return this.getSignalDirection(signal.type);
    }

    /**
     * Get trading direction based on signal type (fallback method).
     */
    private getSignalDirection(signalType: SignalType): "buy" | "sell" {
        switch (signalType) {
            case "absorption":
                return "buy"; // Absorption typically indicates support
            case "exhaustion":
                return "sell"; // Exhaustion typically indicates resistance/reversal
            case "accumulation":
                return "buy"; // Accumulation indicates buying interest
            case "distribution":
                return "sell"; // Distribution indicates selling pressure
            default:
                return "buy"; // Default fallback
        }
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
            default:
                return "flow";
        }
    }

    /**
     * Send alerts for trading signal.
     */
    private async sendAlerts(tradingSignal: Signal): Promise<void> {
        try {
            await this.alertManager.sendAlert(tradingSignal);
            this.logger.debug("Alert sent for trading signal", {
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
            this.logger.error("Failed to send alert", {
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

        this.logger.debug("Checking signal throttling", {
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
            this.logger.info("Signal throttled - exact match found", {
                signalId: tradingSignal.id,
                signalKey,
                timeSinceLastMs: timeDiff,
                throttleWindowMs: this.signalThrottleMs,
            });
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
                        "Signal throttled - similar signal found",
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

        this.logger.debug("Signal not throttled - proceeding", {
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

        this.logger.debug("Recorded trading signal for throttling", {
            signalId: tradingSignal.id,
            signalKey,
            timestamp,
            totalRecordedSignals: this.recentTradingSignals.size,
        });

        // Clean up old entries periodically
        this.cleanupThrottledSignals();
    }

    /**
     * Generate a unique key for signal deduplication.
     */
    private generateSignalKey(tradingSignal: Signal): string {
        const priceKey = Math.round(tradingSignal.price * 100);
        const key = `${tradingSignal.type}_${tradingSignal.side}_${priceKey}`;

        this.logger.debug("Generated signal key", {
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

        const existingPrice = priceStr ? parseInt(priceStr, 10) / 100 : NaN;

        // Check if same type and side
        if (tradingSignal.type !== type || tradingSignal.side !== side) {
            this.logger.debug("Signals not similar - different type/side", {
                newType: tradingSignal.type,
                newSide: tradingSignal.side,
                existingType: type,
                existingSide: side,
            });
            return false;
        }

        // Check if prices are within tolerance
        const priceDiff = Math.abs(tradingSignal.price - existingPrice);
        const priceToleranceAbs =
            existingPrice * (this.priceTolerancePercent / 100);
        const isSimilar = priceDiff <= priceToleranceAbs;

        this.logger.debug("Price similarity check", {
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

        this.logger.debug("Cleaned up old signals", {
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
        this.recordSignalQualityMetrics(signal, outcome, confirmedSignal);

        // Rejection reason tracking
        if (outcome === "rejected" || outcome === "blocked") {
            this.recordRejectionMetrics(signal, rejectionReason ?? "unknown");
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
        outcome: string,
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
                health_recommendation:
                    confirmedSignal.anomalyData.healthRecommendation ??
                    "unknown",
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
        const bucket = Math.floor(confidence * 10) * 10;
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
        this.logger.info("Signal processed with market health check", {
            signalId: signal.id,
            signalType: signal.type,
            confidence: {
                original: signal.confidence,
                final: confirmedSignal.confidence,
                correlationBoost:
                    confirmedSignal.correlationData.correlationStrength * 0.15,
            },
            marketHealth: {
                healthy: confirmedSignal.anomalyData.marketHealthy,
                recommendation:
                    confirmedSignal.anomalyData.healthRecommendation,
                criticalIssues:
                    confirmedSignal.anomalyData.criticalIssues?.length || 0,
            },
        });
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

            this.logger.debug("Enhanced signal metrics initialized", {
                component: "SignalManager",
                metricsCount: "legacy + detailed tracking",
            });
        } catch (error) {
            this.logger.error("Failed to initialize metrics", {
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
        performanceTracking?: {
            activeSignalsCount: number;
            completedSignalsCount: number;
            isTracking: boolean;
        };
    } {
        const status = {
            recentSignalsCount: this.recentSignals.size,
            correlationsCount: this.correlations.size,
            historySize: this.signalHistory.length,
            marketHealth: this.getMarketHealthContext(),
            config: this.config,
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
                "Performance metrics requested but SignalTracker not available",
                {
                    component: "SignalManager",
                }
            );
            return null;
        }

        try {
            return this.signalTracker.getPerformanceMetrics(timeWindow);
        } catch (error) {
            this.logger.error("Failed to get performance metrics", {
                component: "SignalManager",
                error: error instanceof Error ? error.message : String(error),
            });
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
        return metrics.counters[metricName]?.value || 0;
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

    /**
     * Priority queue to throttle signals by confidence per symbol.
     * Keeps the top N signals within a rolling time window.
     */
    private static PriorityThrottleQueue = class {
        private readonly queue = new Map<string, ProcessedSignal[]>();

        constructor(
            private readonly capacity: number,
            private readonly windowMs: number
        ) {}

        public tryAdd(signal: ProcessedSignal): boolean {
            const data = signal.data as unknown as {
                symbol?: string;
                severity?: string;
            };
            const symbol = data.symbol ?? "UNKNOWN";
            const severity = data.severity;
            const now = Date.now();

            const list = this.queue.get(symbol) ?? [];
            const filtered = list.filter(
                (s) => now - s.timestamp.getTime() <= this.windowMs
            );

            if (list.length !== filtered.length) {
                this.queue.set(symbol, filtered);
            }

            if (severity === "critical") {
                this.insert(filtered, signal);
                this.trim(filtered);
                this.queue.set(symbol, filtered);
                return true;
            }

            if (filtered.length < this.capacity) {
                this.insert(filtered, signal);
                this.queue.set(symbol, filtered);
                return true;
            }

            const lowest = filtered[filtered.length - 1];
            if (signal.confidence <= lowest.confidence) {
                return false;
            }

            this.insert(filtered, signal);
            this.trim(filtered);
            this.queue.set(symbol, filtered);
            return true;
        }

        private insert(list: ProcessedSignal[], signal: ProcessedSignal): void {
            list.push(signal);
            list.sort((a, b) => b.confidence - a.confidence);
        }

        private trim(list: ProcessedSignal[]): void {
            if (list.length > this.capacity) {
                list.length = this.capacity;
            }
        }
    };
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
