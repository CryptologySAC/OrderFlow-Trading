// src/trading/signalManager.ts

import { EventEmitter } from "events";
import type {
    Signal,
    TradingSignalData,
    ProcessedSignal,
    SignalType,
    ConfirmedSignal,
} from "../types/signalTypes.js";
import type { MarketAnomaly } from "../utils/types.js";
import { AnomalyDetector, AnomalyEvent } from "../services/anomalyDetector.js";
import { AlertManager } from "../alerts/alertManager.js";
import { Logger } from "../infrastructure/logger.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";

import {
    calculateProfitTarget,
    calculateStopLoss,
} from "../utils/calculations.js";

export interface SignalManagerConfig {
    confidenceThreshold: number;
    enableAnomalyDetection: boolean;
    enableAlerts: boolean;
    signalTimeout: number; // ms
}

interface SignalCorrelation {
    signalId: string;
    correlatedSignals: ProcessedSignal[];
    timestamp: number;
    strength: number;
}

/**
 * Manages trading signal generation and processing
 */
export class SignalManager extends EventEmitter {
    private readonly config: SignalManagerConfig;
    private readonly recentSignals = new Map<string, ProcessedSignal>();
    private readonly correlations = new Map<string, SignalCorrelation>();
    private readonly signalHistory: ProcessedSignal[] = [];
    private activeAnomalies = new Map<string, AnomalyEvent>();
    private anomalyImpactCache = new Map<string, number>();
    private lastAnomalyCheck = 0;

    // Keep track of signals for correlation analysis
    private readonly maxHistorySize = 100;
    private readonly correlationWindowMs = 60000; // 1 minute

    constructor(
        private readonly anomalyDetector: AnomalyDetector,
        private readonly alertManager: AlertManager,
        private readonly logger: Logger,
        private readonly metricsCollector: MetricsCollector,
        config: Partial<SignalManagerConfig> = {}
    ) {
        super();

        this.config = {
            confidenceThreshold: 0.7,
            enableAnomalyDetection: true,
            enableAlerts: true,
            signalTimeout: 300000, // 5 minutes
            ...config,
        };

        this.logger.info("SignalManager initialized", {
            component: "SignalManager",
            config: this.config,
        });

        // Initialize metrics
        this.initializeMetrics();
        this.setupAnomalyEventHandlers();

        // Clean up old signals periodically
        setInterval(() => {
            this.cleanupOldSignals();
        }, 60000); // Every minute
    }

    /**
     * Setup real-time anomaly event handlers
     */
    private setupAnomalyEventHandlers(): void {
        // Listen to all anomalies
        this.anomalyDetector.on("anomaly", (anomaly: AnomalyEvent) => {
            this.handleAnomalyEvent(anomaly);
        });

        // Optionally listen to symbol-specific anomalies if you have a specific symbol
        // this.anomalyDetector.on(`anomaly:${symbol}`, (anomaly: AnomalyEvent) => {
        //     this.handleSymbolSpecificAnomaly(anomaly);
        // });

        this.logger.debug("Anomaly event handlers setup", {
            component: "SignalManager",
            operation: "setupAnomalyEventHandlers",
        });
    }

    /**
     * Handle real-time anomaly events
     */
    private handleAnomalyEvent(anomaly: AnomalyEvent): void {
        try {
            this.logger.info("Anomaly event received", {
                component: "SignalManager",
                operation: "handleAnomalyEvent",
                anomalyType: anomaly.type,
                severity: anomaly.severity,
                detectedAt: anomaly.detectedAt,
            });

            // Store active anomaly for signal processing context
            this.activeAnomalies.set(anomaly.type, anomaly);

            // Calculate impact score for this anomaly type
            const impactScore = this.calculateAnomalyImpact(anomaly);
            this.anomalyImpactCache.set(anomaly.type, impactScore);

            // Update metrics
            this.metricsCollector.incrementCounter(
                "signal_manager_anomalies_detected_total",
                1,
                {
                    anomaly_type: anomaly.type,
                    severity: anomaly.severity,
                    recommended_action: anomaly.recommendedAction,
                }
            );

            this.metricsCollector.setGauge(
                "signal_manager_active_anomalies_count",
                this.activeAnomalies.size
            );

            this.metricsCollector.recordHistogram(
                "signal_manager_anomaly_impact_score",
                impactScore,
                {
                    anomaly_type: anomaly.type,
                    severity: anomaly.severity,
                }
            );

            // Take immediate action based on anomaly severity
            this.handleCriticalAnomalies(anomaly);

            // Clean up old anomalies
            this.cleanupExpiredAnomalies();
        } catch (error) {
            this.logger.error("Failed to handle anomaly event", {
                component: "SignalManager",
                operation: "handleAnomalyEvent",
                anomalyType: anomaly.type,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Calculate impact score for anomaly (0-1)
     */
    private calculateAnomalyImpact(anomaly: AnomalyEvent): number {
        let impact = 0;

        // Base impact by severity
        switch (anomaly.severity) {
            case "critical":
                impact = 1.0;
                break;
            case "high":
                impact = 0.8;
                break;
            case "medium":
                impact = 0.5;
                break;
            case "info":
                impact = 0.2;
                break;
        }

        // Adjust by anomaly type
        const typeMultipliers: Record<string, number> = {
            flash_crash: 1.0,
            liquidity_void: 0.9,
            spoofing: 0.8,
            whale_activity: 0.7,
            extreme_volatility: 0.8,
            momentum_ignition: 0.6,
            absorption: 0.4,
            exhaustion: 0.4,
            flow_imbalance: 0.5,
            orderbook_imbalance: 0.5,
            iceberg_order: 0.3,
            order_size_anomaly: 0.3,
            api_gap: 0.6,
        };

        const multiplier = typeMultipliers[anomaly.type] || 0.5;
        impact *= multiplier;

        // Adjust by confidence if available
        if (
            anomaly.details.confidence &&
            typeof anomaly.details.confidence === "number"
        ) {
            impact *= anomaly.details.confidence;
        }

        return Math.min(1.0, impact);
    }

    /**
     * Handle critical anomalies with immediate actions
     */
    private handleCriticalAnomalies(anomaly: AnomalyEvent): void {
        if (anomaly.severity === "critical") {
            this.logger.warn(
                "Critical anomaly detected - taking immediate action",
                {
                    anomalyType: anomaly.type,
                    recommendedAction: anomaly.recommendedAction,
                }
            );

            // Emit critical anomaly event for external systems
            this.emit("criticalAnomalyDetected", {
                anomaly,
                timestamp: Date.now(),
                recommendedAction: anomaly.recommendedAction,
            });

            // Potentially pause signal processing temporarily
            if (
                anomaly.type === "flash_crash" ||
                anomaly.type === "liquidity_void"
            ) {
                this.emit("emergencyPause", {
                    reason: `Critical ${anomaly.type} detected`,
                    duration: 30000, // 30 seconds
                    anomaly,
                });
            }
        }
    }

    /**
     * Enhanced market anomaly check using real-time context
     */
    private checkMarketAnomaly(price: number): MarketAnomaly | null {
        try {
            // Get current market health
            const marketHealth = this.anomalyDetector.getMarketHealth();
            if (marketHealth.isHealthy || !marketHealth.highestSeverity) {
                return null;
            }

            // Check for recent critical anomalies that should block signals
            const criticalAnomalies = Array.from(
                this.activeAnomalies.values()
            ).filter(
                (a) =>
                    a.severity === "critical" &&
                    Date.now() - a.detectedAt < 60000
            ); // Last 1 minute

            if (criticalAnomalies.length > 0) {
                const mostRecent = criticalAnomalies.sort(
                    (a, b) => b.detectedAt - a.detectedAt
                )[0];

                return {
                    affectedPriceRange: mostRecent.affectedPriceRange,
                    detectedAt: mostRecent.detectedAt,
                    severity: mostRecent.severity,
                    recommendedAction: mostRecent.recommendedAction,
                    type: `realtime_${mostRecent.type}`,
                    details: {
                        ...mostRecent.details,
                        realtimeDetection: true,
                        activeAnomalies: this.activeAnomalies.size,
                    },
                };
            }

            // Use the existing market health check as fallback
            const marketAnomaly: MarketAnomaly = {
                affectedPriceRange: { min: price * 0.99, max: price * 1.01 },
                detectedAt: Date.now(),
                severity: marketHealth.highestSeverity,
                recommendedAction: marketHealth.recommendation,
                type: "health_check",
                details: {
                    marketHealth,
                    activeAnomaliesCount: this.activeAnomalies.size,
                    recentAnomalies: marketHealth.recentAnomalies,
                },
            };

            return marketAnomaly;
        } catch (error) {
            this.logger.error("Failed to check market anomaly", {
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }

    /**
     * Enhanced confidence calculation that factors in active anomalies
     */
    private createConfirmedSignal(
        signal: ProcessedSignal,
        correlation: SignalCorrelation,
        anomaly: MarketAnomaly | null
    ): ConfirmedSignal {
        // Start with base confidence
        let finalConfidence = signal.confidence;

        // Boost confidence based on correlations
        if (correlation.strength > 0) {
            finalConfidence = Math.min(
                finalConfidence * (1 + correlation.strength * 0.2),
                1.0
            );
        }

        // Reduce confidence based on active anomalies
        const activeAnomalyImpact = this.calculateActiveAnomalyImpact(
            signal.data.price
        );
        if (activeAnomalyImpact > 0) {
            finalConfidence *= 1 - activeAnomalyImpact * 0.5; // Up to 50% reduction

            this.logger.debug(
                "Signal confidence reduced due to active anomalies",
                {
                    signalId: signal.id,
                    originalConfidence: signal.confidence,
                    anomalyImpact: activeAnomalyImpact,
                    finalConfidence,
                    activeAnomalies: this.activeAnomalies.size,
                }
            );
        }

        // Reduce confidence if specific anomaly detected
        if (anomaly && anomaly.severity === "medium") {
            finalConfidence *= 0.9;
        }

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
            anomalyData: anomaly
                ? {
                      detected: true,
                      anomaly,
                      activeAnomalyImpact,
                      activeAnomaliesCount: this.activeAnomalies.size,
                  }
                : {
                      detected: false,
                      activeAnomalyImpact,
                      activeAnomaliesCount: this.activeAnomalies.size,
                  },
        };

        return confirmedSignal;
    }

    /**
     * Calculate impact of active anomalies on a given price
     */
    private calculateActiveAnomalyImpact(price: number): number {
        let totalImpact = 0;
        const now = Date.now();

        for (const [type, anomaly] of this.activeAnomalies) {
            // Skip old anomalies
            if (now - anomaly.detectedAt > 300000) continue; // 5 minutes

            // Check if price is in affected range
            const inRange =
                price >= anomaly.affectedPriceRange.min &&
                price <= anomaly.affectedPriceRange.max;

            if (inRange) {
                const impact = this.anomalyImpactCache.get(type) || 0;
                // Decay impact over time
                const ageMinutes = (now - anomaly.detectedAt) / 60000;
                const decayFactor = Math.max(0.1, 1 - ageMinutes / 5); // Decay over 5 minutes
                totalImpact += impact * decayFactor;
            }
        }

        return Math.min(1.0, totalImpact);
    }

    /**
     * Clean up expired anomalies
     */
    private cleanupExpiredAnomalies(): void {
        const now = Date.now();
        const expireTime = 300000; // 5 minutes

        for (const [type, anomaly] of this.activeAnomalies) {
            if (now - anomaly.detectedAt > expireTime) {
                this.activeAnomalies.delete(type);
                this.anomalyImpactCache.delete(type);
            }
        }

        // Update gauge
        this.metricsCollector.setGauge(
            "signal_manager_active_anomalies_count",
            this.activeAnomalies.size
        );
    }

    /**
     * Get current anomaly context for external systems
     */
    public getAnomalyContext(): {
        activeAnomalies: AnomalyEvent[];
        totalImpact: number;
        criticalCount: number;
        lastUpdate: number;
    } {
        const active = Array.from(this.activeAnomalies.values());
        const totalImpact = Array.from(this.anomalyImpactCache.values()).reduce(
            (sum, impact) => sum + impact,
            0
        );
        const criticalCount = active.filter(
            (a) => a.severity === "critical"
        ).length;

        return {
            activeAnomalies: active,
            totalImpact: Math.min(1.0, totalImpact),
            criticalCount,
            lastUpdate: Date.now(),
        };
    }

    /**
     * Handle processed signal from SignalCoordinator
     * This is the main entry point for signals from the coordinator
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

            // Check confidence threshold
            if (signal.confidence < this.config.confidenceThreshold) {
                this.logger.debug("Signal rejected due to low confidence", {
                    signalId: signal.id,
                    confidence: signal.confidence,
                    threshold: this.config.confidenceThreshold,
                });

                this.metricsCollector.incrementCounter(
                    "signal_manager_signals_rejected_total",
                    1,
                    {
                        signal_type: signal.type,
                        rejection_reason: "low_confidence",
                        detector_id: signal.detectorId,
                    }
                );

                this.emit("signalRejected", {
                    signal,
                    reason: "low_confidence",
                });
                return;
            }

            // Analyze correlations with recent signals
            const correlation = this.analyzeSignalCorrelation(signal);

            // Check for market anomalies if enabled
            let anomaly: MarketAnomaly | null = null;
            if (this.config.enableAnomalyDetection) {
                anomaly = this.checkMarketAnomaly(signal.data.price);

                if (anomaly?.severity === "critical") {
                    this.logger.warn(
                        "Signal rejected due to critical market anomaly",
                        {
                            signalId: signal.id,
                            anomaly,
                        }
                    );

                    this.metricsCollector.incrementCounter(
                        "signal_manager_signals_rejected_total",
                        1,
                        {
                            signal_type: signal.type,
                            rejection_reason: "market_anomaly",
                            detector_id: signal.detectorId,
                        }
                    );
                    this.metricsCollector.incrementCounter(
                        "signal_manager_anomaly_rejections_total",
                        1,
                        {
                            signal_type: signal.type,
                            anomaly_severity: anomaly.severity,
                        }
                    );

                    this.emit("signalRejected", {
                        signal,
                        reason: "market_anomaly",
                        anomaly,
                    });
                    return;
                }
            }

            // Create confirmed signal
            const confirmedSignal = this.createConfirmedSignal(
                signal,
                correlation,
                anomaly
            );

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
                correlation.strength,
                {
                    signal_type: signal.type,
                }
            );

            this.metricsCollector.setGauge(
                "signal_manager_correlated_signals_count",
                correlation.correlatedSignals.length
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
     * Store signal for correlation analysis
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
     * Analyze correlation with recent signals
     */
    private analyzeSignalCorrelation(
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
     * Create trading signal from confirmed signal
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
     * Get trading direction based on signal type
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
     * Get signal type string for trading signal
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
     * Send alerts for trading signal
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
     * Clean up old signals and correlations
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
     * Get signal manager status
     */
    public getStatus(): {
        recentSignalsCount: number;
        correlationsCount: number;
        historySize: number;
        config: SignalManagerConfig;
    } {
        return {
            recentSignalsCount: this.recentSignals.size,
            correlationsCount: this.correlations.size,
            historySize: this.signalHistory.length,
            config: this.config,
        };
    }

    /**
     * Initialize metrics with MetricsCollector
     */
    private initializeMetrics(): void {
        try {
            // Counters
            this.metricsCollector.createCounter(
                "signal_manager_signals_received_total",
                "Total number of signals received from coordinator",
                ["signal_type", "detector_id"]
            );

            this.metricsCollector.createCounter(
                "signal_manager_signals_confirmed_total",
                "Total number of signals confirmed and converted to trading signals",
                ["signal_type", "detector_id", "trading_side"]
            );

            this.metricsCollector.createCounter(
                "signal_manager_signals_rejected_total",
                "Total number of signals rejected",
                ["signal_type", "rejection_reason", "detector_id"]
            );

            this.metricsCollector.createCounter(
                "signal_manager_anomaly_rejections_total",
                "Total number of signals rejected due to anomalies",
                ["signal_type", "anomaly_severity"]
            );

            this.metricsCollector.createCounter(
                "signal_manager_alerts_sent_total",
                "Total number of alerts sent",
                ["signal_type", "trading_side"]
            );

            this.metricsCollector.createCounter(
                "signal_manager_alert_errors_total",
                "Total number of alert errors",
                ["signal_type", "error_type"]
            );

            this.metricsCollector.createCounter(
                "signal_manager_errors_total",
                "Total number of signal processing errors",
                ["signal_type", "detector_id", "error_type"]
            );

            // Histograms
            this.metricsCollector.createHistogram(
                "signal_manager_processing_duration_seconds",
                "Time spent processing signals in SignalManager",
                ["signal_type", "detector_id"],
                [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5]
            );

            this.metricsCollector.createHistogram(
                "signal_manager_confidence_score",
                "Final confidence scores of confirmed signals",
                ["signal_type", "detector_id"],
                [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
            );

            this.metricsCollector.createHistogram(
                "signal_manager_correlation_strength",
                "Correlation strength between signals",
                ["signal_type"],
                [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
            );

            // Gauges
            this.metricsCollector.createGauge(
                "signal_manager_recent_signals_count",
                "Current number of recent signals in memory"
            );

            this.metricsCollector.createGauge(
                "signal_manager_signal_history_size",
                "Current size of signal history"
            );

            this.metricsCollector.createGauge(
                "signal_manager_correlations_count",
                "Current number of signal correlations tracked"
            );

            this.metricsCollector.createGauge(
                "signal_manager_correlated_signals_count",
                "Number of correlated signals for the most recent signal"
            );

            this.logger.debug("SignalManager metrics initialized", {
                component: "SignalManager",
                operation: "initializeMetrics",
            });

            // Add anomaly-specific metrics
            this.metricsCollector.createCounter(
                "signal_manager_anomalies_detected_total",
                "Total number of anomalies detected",
                ["anomaly_type", "severity", "recommended_action"]
            );

            this.metricsCollector.createGauge(
                "signal_manager_active_anomalies_count",
                "Current number of active anomalies"
            );

            this.metricsCollector.createHistogram(
                "signal_manager_anomaly_impact_score",
                "Impact scores of detected anomalies",
                ["anomaly_type", "severity"],
                [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
            );
        } catch (error) {
            this.logger.error("Failed to initialize SignalManager metrics", {
                component: "SignalManager",
                operation: "initializeMetrics",
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
}
