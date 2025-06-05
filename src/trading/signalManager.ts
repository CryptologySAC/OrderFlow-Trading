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
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import {
    calculateProfitTarget,
    calculateStopLoss,
} from "../utils/calculations.js";

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
    private readonly config: Required<SignalManagerConfig>;
    private readonly recentSignals = new Map<string, ProcessedSignal>();
    private readonly correlations = new Map<string, SignalCorrelation>();
    private readonly signalHistory: ProcessedSignal[] = [];

    // Keep track of signals for correlation analysis
    private readonly maxHistorySize = 100;
    private readonly correlationWindowMs = 60000; // 1 minute

    constructor(
        private readonly anomalyDetector: AnomalyDetector,
        private readonly alertManager: AlertManager,
        private readonly logger: Logger,
        private readonly metricsCollector: MetricsCollector,
        private readonly storage: IPipelineStorage,
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
        }, 60000); // Every minute
    }

    /**
     * Simplified signal processing - market health gatekeeper + signal coordination.
     * No complex anomaly enhancement, just health-based allow/block decisions.
     */
    public processSignal(signal: ProcessedSignal): ConfirmedSignal | null {
        try {
            // 1. Market health check (infrastructure safety)
            if (!this.checkMarketHealth()) {
                this.logger.info("Signal blocked due to market health", {
                    signalId: signal.id,
                    signalType: signal.type,
                    healthStatus: this.anomalyDetector.getMarketHealth(),
                });

                this.recordMetric("signal_blocked_by_health", signal.type);
                return null;
            }

            // 2. Confidence threshold check
            if (signal.confidence < this.config.confidenceThreshold) {
                this.logger.debug("Signal rejected due to low confidence", {
                    signalId: signal.id,
                    confidence: signal.confidence,
                    threshold: this.config.confidenceThreshold,
                });

                this.recordMetric(
                    "signal_rejected_low_confidence",
                    signal.type
                );
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

            return confirmedSignal;
        } catch (error) {
            this.logger.error("Failed to process signal", {
                signalId: signal.id,
                error: error instanceof Error ? error.message : String(error),
            });
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

            // Block trading for infrastructure issues or insufficient data
            if (
                health.recommendation === "pause" ||
                health.recommendation === "close_positions" ||
                health.recommendation === "insufficient_data"
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

        this.storage.saveSignalHistory(signal);
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
    public handleProcessedSignal(signal: ProcessedSignal): void {
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

            // Store signal for correlation analysis
            this.storeSignal(signal);

            // Process signal through simplified pipeline
            const confirmedSignal = this.processSignal(signal);

            if (!confirmedSignal) {
                this.emit("signalRejected", {
                    signal,
                    reason: "processing_failed",
                });
                return;
            }

            // Generate final trading signal
            const tradingSignal = this.createTradingSignal(confirmedSignal);

            this.metricsCollector.incrementCounter(
                "signal_manager_signals_confirmed_total",
                1,
                {
                    signal_type: signal.type,
                    detector_id: signal.detectorId,
                    trading_side: tradingSignal.side,
                }
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
        } catch (error) {
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

        // Determine trading direction based on signal type
        const side: "buy" | "sell" = this.getSignalDirection(
            originalSignal.type
        );

        const profitTarget = calculateProfitTarget(
            confirmedSignal.finalPrice,
            side
        );
        const stopLoss = calculateStopLoss(confirmedSignal.finalPrice, side);

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
            takeProfit: profitTarget.price,
            stopLoss,
            closeReason: "swing_detection",
            signalData,
        };

        return signal;
    }

    /**
     * Get trading direction based on signal type.
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
     * Record signal processing metrics.
     */
    private recordMetric(metricName: string, signalType: string): void {
        this.metricsCollector.incrementCounter(
            `signal_manager_${metricName}_total`,
            1,
            { signal_type: signalType }
        );
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
     * Initialize simplified metrics.
     */
    private initializeMetrics(): void {
        try {
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

            this.logger.debug("Simplified metrics initialized", {
                component: "SignalManager",
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
    } {
        return {
            recentSignalsCount: this.recentSignals.size,
            correlationsCount: this.correlations.size,
            historySize: this.signalHistory.length,
            marketHealth: this.getMarketHealthContext(),
            config: this.config,
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
