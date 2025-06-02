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
import { AnomalyDetector } from "../services/anomalyDetector.js";
import { AlertManager } from "../alerts/alertManager.js";
import { Logger } from "../infrastructure/logger.js";
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

    // Keep track of signals for correlation analysis
    private readonly maxHistorySize = 100;
    private readonly correlationWindowMs = 60000; // 1 minute

    constructor(
        private readonly anomalyDetector: AnomalyDetector,
        private readonly alertManager: AlertManager,
        private readonly logger: Logger,
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

        // Clean up old signals periodically
        setInterval(() => {
            this.cleanupOldSignals();
        }, 60000); // Every minute
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

            // Store signal for correlation analysis
            this.storeSignal(signal);

            // Check confidence threshold
            if (signal.confidence < this.config.confidenceThreshold) {
                this.logger.debug("Signal rejected due to low confidence", {
                    signalId: signal.id,
                    confidence: signal.confidence,
                    threshold: this.config.confidenceThreshold,
                });
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
     * Create confirmed signal from processed signal
     */
    private createConfirmedSignal(
        signal: ProcessedSignal,
        correlation: SignalCorrelation,
        anomaly: MarketAnomaly | null
    ): ConfirmedSignal {
        // Boost confidence based on correlations
        let finalConfidence = signal.confidence;
        if (correlation.strength > 0) {
            finalConfidence = Math.min(
                finalConfidence * (1 + correlation.strength * 0.2),
                1.0
            );
        }

        // Reduce confidence if anomaly detected
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
                  }
                : {
                      detected: false,
                  },
        };

        return confirmedSignal;
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
     * Check for market anomalies
     */
    private checkMarketAnomaly(price: number): MarketAnomaly | null {
        try {
            const marketHealth = this.anomalyDetector.getMarketHealth();
            if (marketHealth.isHealthy || !marketHealth.highestSeverity) {
                return null;
            }

            const marketAnomaly: MarketAnomaly = {
                affectedPriceRange: { min: price * 0.99, max: price * 1.01 },
                detectedAt: Date.now(),
                severity: marketHealth.highestSeverity,
                recommendedAction: marketHealth.recommendation,
                type: "health_check",
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
     * Send alerts for trading signal
     */
    private async sendAlerts(tradingSignal: Signal): Promise<void> {
        try {
            await this.alertManager.sendAlert(tradingSignal);
            this.logger.debug("Alert sent for trading signal", {
                signalId: tradingSignal.id,
            });
        } catch (error) {
            this.logger.error("Failed to send alert", {
                signalId: tradingSignal.id,
                error: error instanceof Error ? error.message : String(error),
            });
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
}
