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
import type { IPipelineStorage } from "../storage/pipelineStorage.js";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import {
    ANOMALY_SIGNAL_IMPACT_MATRIX,
    calculateAnomalyAdjustedConfidence,
    getAnomalyFilteringRules,
    type AnomalySignalImpact,
} from "./anomalySignalImpact.js";

import {
    calculateProfitTarget,
    calculateStopLoss,
} from "../utils/calculations.js";

export interface SignalManagerConfig {
    enableAnomalyFiltering?: boolean;
    anomalyConfidenceThreshold?: number;
    blockSignalsDuringCritical?: boolean;
    maxActiveAnomalies?: number;
    confidenceThreshold?: number;
    signalTimeout?: number;
    enableAnomalyDetection?: boolean;
    enableAlerts?: boolean;
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
    private readonly config: Required<SignalManagerConfig>;
    private activeAnomalies = new Map<string, AnomalyEvent>();
    private anomalyImpactCache = new Map<string, number>();
    private signalBlocklist = new Set<string>(); // Temporarily blocked signal types
    private lastAnomalyCleanup = 0;
    private readonly recentSignals = new Map<string, ProcessedSignal>();
    private readonly correlations = new Map<string, SignalCorrelation>();
    private readonly signalHistory: ProcessedSignal[] = [];
    private lastAnomalyCheck = 0;

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
            enableAnomalyFiltering: config.enableAnomalyFiltering ?? true,
            anomalyConfidenceThreshold:
                config.anomalyConfidenceThreshold ?? 0.3,
            blockSignalsDuringCritical:
                config.blockSignalsDuringCritical ?? true,
            maxActiveAnomalies: config.maxActiveAnomalies ?? 20,
            confidenceThreshold: config.confidenceThreshold ?? 0.75,
            signalTimeout: config.signalTimeout ?? 300000,
            enableAnomalyDetection: config.enableAnomalyDetection ?? true,
            enableAlerts: config.enableAlerts ?? true,
        };

        // restore persisted anomalies on restart
        for (const a of this.storage.getActiveAnomalies()) {
            this.activeAnomalies.set(a.type, a);
        }

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
            this.storage.purgeSignalHistory();
        }, 60000); // Every minute
    }

    /**
     * Main signal processing with full anomaly integration
     */
    public processSignal(signal: ProcessedSignal): ConfirmedSignal | null {
        try {
            // 1. Clean up expired anomalies
            this.cleanupExpiredAnomalies();

            // 2. Check if signal type is temporarily blocked
            if (this.isSignalTypeBlocked(signal.type)) {
                this.logger.debug("Signal blocked due to anomaly filtering", {
                    signalId: signal.id,
                    signalType: signal.type,
                    blockedReasons: Array.from(this.signalBlocklist),
                });

                this.recordMetric("signal_blocked_by_anomaly", signal.type);
                return null;
            }

            // 3. Apply anomaly-based confidence adjustment
            const anomalyAdjustment: {
                adjustedConfidence: number;
                impactFactors: Array<{
                    anomalyType: string;
                    impact: "positive" | "negative" | "neutral";
                    multiplier: number;
                    decayedMultiplier: number;
                    reasoning: string;
                }>;
            } = this.calculateAnomalyConfidenceAdjustment(signal);

            // 4. Check if adjusted confidence meets threshold
            if (
                anomalyAdjustment.adjustedConfidence <
                this.config.anomalyConfidenceThreshold
            ) {
                this.logger.debug(
                    "Signal rejected due to low anomaly-adjusted confidence",
                    {
                        signalId: signal.id,
                        originalConfidence: signal.confidence,
                        adjustedConfidence:
                            anomalyAdjustment.adjustedConfidence,
                        threshold: this.config.anomalyConfidenceThreshold,
                        impactFactors: anomalyAdjustment.impactFactors,
                    }
                );

                this.recordMetric(
                    "signal_rejected_low_confidence",
                    signal.type
                );
                return null;
            }

            // 5. Get market anomaly context (existing method)
            const marketAnomaly = this.checkMarketAnomaly(signal.data.price);

            // 6. Calculate signal correlations (existing method)
            const correlation = this.calculateSignalCorrelation(signal);

            // 7. Create confirmed signal with anomaly context
            const confirmedSignal = this.createAnomalyAwareConfirmedSignal(
                signal,
                correlation,
                marketAnomaly,
                anomalyAdjustment
            );

            // 8. Log and emit metrics
            this.logSignalProcessing(
                signal,
                confirmedSignal,
                anomalyAdjustment
            );

            return confirmedSignal;
        } catch (error) {
            this.logger.error(
                "Failed to process signal with anomaly integration",
                {
                    signalId: signal.id,
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
            return null;
        }
    }

    /**
     * Setup anomaly event handlers
     */
    private setupAnomalyEventHandlers(): void {
        this.anomalyDetector.on("anomaly", (anomaly: AnomalyEvent) => {
            this.handleAnomalyEvent(anomaly);
            this.storage.saveActiveAnomaly(anomaly);
        });

        this.logger.debug("Anomaly event handlers initialized", {
            component: "SignalManager",
            anomalyFilteringEnabled: this.config.enableAnomalyFiltering,
        });
    }

    /**
     * Handle real-time anomaly events
     */
    /**
     * Handle incoming anomaly events
     */
    private handleAnomalyEvent(anomaly: AnomalyEvent): void {
        try {
            // Store active anomaly
            this.activeAnomalies.set(anomaly.type, anomaly);

            // Update signal filtering based on anomaly
            this.updateSignalFiltering(anomaly);

            // Cache impact score
            const impactScore = this.calculateAnomalyImpactScore(anomaly);
            this.anomalyImpactCache.set(anomaly.type, impactScore);

            // Handle critical anomalies
            if (
                anomaly.severity === "critical" &&
                this.config.blockSignalsDuringCritical
            ) {
                this.handleCriticalAnomaly(anomaly);
            }

            // Emit anomaly context event
            this.emit("anomalyContextUpdated", {
                anomaly,
                activeCount: this.activeAnomalies.size,
                blockedSignalTypes: Array.from(this.signalBlocklist),
                impactScore,
            });

            // Record metrics
            this.recordAnomalyMetrics(anomaly);

            this.logger.info("Anomaly processed and integrated", {
                anomalyType: anomaly.type,
                severity: anomaly.severity,
                activeAnomalies: this.activeAnomalies.size,
                blockedSignalTypes: this.signalBlocklist.size,
            });
        } catch (error) {
            this.logger.error("Failed to handle anomaly event", {
                anomalyType: anomaly.type,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Update signal filtering rules based on new anomaly
     */
    private updateSignalFiltering(anomaly: AnomalyEvent): void {
        if (!this.config.enableAnomalyFiltering) return;

        const filteringRules = getAnomalyFilteringRules();
        const rules = filteringRules[anomaly.type];

        if (!rules) return;

        const blockKey = `${anomaly.type}:${Date.now()}`;

        // Block signal types based on filtering rules
        if (rules.meanReversion.block) {
            this.signalBlocklist.add(`mean_reversion:${blockKey}`);
            this.storage.removeActiveAnomaly(anomaly.type);
            this.logger.debug("Blocking mean reversion signals", {
                anomaly: anomaly.type,
                reason: rules.meanReversion.reason,
            });
        }

        if (rules.momentum.block) {
            this.signalBlocklist.add(`momentum:${blockKey}`);
            this.logger.debug("Blocking momentum signals", {
                anomaly: anomaly.type,
                reason: rules.momentum.reason,
            });
        }

        if (rules.breakout.block) {
            this.signalBlocklist.add(`breakout:${blockKey}`);
            this.logger.debug("Blocking breakout signals", {
                anomaly: anomaly.type,
                reason: rules.breakout.reason,
            });
        }

        // Auto-remove blocks after anomaly expires
        setTimeout(
            () => {
                this.signalBlocklist.delete(`mean_reversion:${blockKey}`);
                this.signalBlocklist.delete(`momentum:${blockKey}`);
                this.signalBlocklist.delete(`breakout:${blockKey}`);
            },
            this.getAnomalyDuration(anomaly.type) * 60 * 1000
        );
    }

    /**
     * Check if signal type is currently blocked
     */
    private isSignalTypeBlocked(signalType: string): boolean {
        for (const blockedType of this.signalBlocklist) {
            if (blockedType.startsWith(`${signalType}:`)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Calculate anomaly-adjusted confidence for a signal
     */
    private calculateAnomalyConfidenceAdjustment(signal: ProcessedSignal): {
        adjustedConfidence: number;
        impactFactors: Array<{
            anomalyType: string;
            impact: "positive" | "negative" | "neutral";
            multiplier: number;
            decayedMultiplier: number;
            reasoning: string;
        }>;
    } {
        const activeAnomalies = Array.from(this.activeAnomalies.values()).map(
            (a) => ({
                type: a.type,
                detectedAt: a.detectedAt,
                severity: a.severity,
            })
        );

        return calculateAnomalyAdjustedConfidence(
            signal.confidence,
            signal.type as "meanReversion" | "momentum" | "breakout",
            activeAnomalies
        );
    }

    /**
     * Create confirmed signal with comprehensive anomaly awareness
     */
    private createAnomalyAwareConfirmedSignal(
        signal: ProcessedSignal,
        correlation: SignalCorrelation,
        marketAnomaly: MarketAnomaly | null,
        anomalyAdjustment: {
            adjustedConfidence: number;
            impactFactors: Array<{
                anomalyType: string;
                impact: "positive" | "negative" | "neutral";
                multiplier: number;
                decayedMultiplier: number;
                reasoning: string;
            }>;
        }
    ): ConfirmedSignal {
        // Calculate final confidence incorporating all factors
        let finalConfidence = anomalyAdjustment.adjustedConfidence;

        // Apply correlation boost
        if (correlation.strength > 0) {
            finalConfidence = Math.min(
                finalConfidence * (1 + correlation.strength * 0.15),
                1.0
            );
        }

        // Apply market anomaly adjustment
        if (marketAnomaly && marketAnomaly.severity === "high") {
            finalConfidence *= 0.85;
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
            anomalyData: {
                detected: marketAnomaly !== null,
                anomaly: marketAnomaly,
                activeAnomaliesCount: this.activeAnomalies.size,
                confidenceAdjustment: {
                    originalConfidence: signal.confidence,
                    adjustedConfidence: anomalyAdjustment.adjustedConfidence,
                    finalConfidence,
                    impactFactors: anomalyAdjustment.impactFactors,
                },
                supportingAnomalies: this.getSupportingAnomalies(signal.type),
                opposingAnomalies: this.getOpposingAnomalies(signal.type),
            },
        };

        this.storage.saveSignalHistory(signal);
        return confirmedSignal;
    }

    /**
     * Get anomalies that support the signal type
     */
    private getSupportingAnomalies(
        signalType: string
    ): Array<{ type: string; impact: number; reasoning: string }> {
        const supporting: Array<{
            type: string;
            impact: number;
            reasoning: string;
        }> = [];

        for (const [type, anomaly] of this.activeAnomalies) {
            const impactConfig = ANOMALY_SIGNAL_IMPACT_MATRIX[type];
            if (!impactConfig) continue;
            void anomaly; //TODO

            const signalImpact = impactConfig[
                signalType as keyof AnomalySignalImpact
            ] as {
                impact: "positive" | "negative" | "neutral";
                multiplier: number;
                reasoning: string;
            };
            if (signalImpact.impact === "positive") {
                supporting.push({
                    type,
                    impact: signalImpact.multiplier,
                    reasoning: signalImpact.reasoning,
                });
            }
        }

        return supporting.sort((a, b) => b.impact - a.impact);
    }

    /**
     * Get anomalies that oppose the signal type
     */
    private getOpposingAnomalies(
        signalType: string
    ): Array<{ type: string; impact: number; reasoning: string }> {
        const opposing: Array<{
            type: string;
            impact: number;
            reasoning: string;
        }> = [];

        for (const [type, anomaly] of this.activeAnomalies) {
            const impactConfig = ANOMALY_SIGNAL_IMPACT_MATRIX[type];
            if (!impactConfig) continue;
            void anomaly; //TODO

            const signalImpact = impactConfig[
                signalType as keyof AnomalySignalImpact
            ] as {
                impact: "positive" | "negative" | "neutral";
                multiplier: number;
                reasoning: string;
            };
            if (signalImpact.impact === "negative") {
                opposing.push({
                    type,
                    impact: signalImpact.multiplier,
                    reasoning: signalImpact.reasoning,
                });
            }
        }

        return opposing.sort((a, b) => a.impact - b.impact); // Sort by most negative impact
    }

    /**
     * Handle critical anomalies with immediate actions
     */
    private handleCriticalAnomaly(anomaly: AnomalyEvent): void {
        this.logger.warn(
            "Critical anomaly detected - implementing emergency measures",
            {
                anomalyType: anomaly.type,
                severity: anomaly.severity,
                recommendedAction: anomaly.recommendedAction,
            }
        );

        // Block all signal types temporarily for flash crashes and liquidity voids
        if (
            anomaly.type === "flash_crash" ||
            anomaly.type === "liquidity_void"
        ) {
            const blockKey = `emergency:${anomaly.type}:${Date.now()}`;
            this.signalBlocklist.add(`mean_reversion:${blockKey}`);
            this.signalBlocklist.add(`momentum:${blockKey}`);
            this.signalBlocklist.add(`breakout:${blockKey}`);

            // Auto-remove emergency blocks after 60 seconds
            setTimeout(() => {
                this.signalBlocklist.delete(`mean_reversion:${blockKey}`);
                this.signalBlocklist.delete(`momentum:${blockKey}`);
                this.signalBlocklist.delete(`breakout:${blockKey}`);
            }, 60000);
        }

        // Emit critical anomaly event
        this.emit("criticalAnomalyDetected", {
            anomaly,
            timestamp: Date.now(),
            emergencyMeasures: {
                signalsBlocked: true,
                blockDuration: 60000,
                recommendedAction: anomaly.recommendedAction,
            },
        });
    }

    /**
     * Calculate overall impact score for an anomaly
     */
    private calculateAnomalyImpactScore(anomaly: AnomalyEvent): number {
        let score = 0;

        // Base score by severity
        switch (anomaly.severity) {
            case "critical":
                score = 1.0;
                break;
            case "high":
                score = 0.8;
                break;
            case "medium":
                score = 0.5;
                break;
            case "info":
                score = 0.2;
                break;
        }

        // Adjust by confidence if available
        if (
            anomaly.details.confidence &&
            typeof anomaly.details.confidence === "number"
        ) {
            score *= anomaly.details.confidence;
        }

        return score;
    }

    /**
     * Get anomaly duration from impact matrix
     */
    private getAnomalyDuration(anomalyType: string): number {
        const config = ANOMALY_SIGNAL_IMPACT_MATRIX[anomalyType];
        return config?.timeDecay || 30; // Default 30 minutes
    }

    /**
     * Clean up expired anomalies and signal blocks
     */
    private cleanupExpiredAnomalies(): void {
        const now = Date.now();

        // Only run cleanup every 30 seconds
        if (now - this.lastAnomalyCleanup < 30000) return;
        this.lastAnomalyCleanup = now;

        let removedCount = 0;

        // Remove expired anomalies
        for (const [type, anomaly] of this.activeAnomalies) {
            const duration = this.getAnomalyDuration(type) * 60 * 1000; // Convert to ms
            if (now - anomaly.detectedAt > duration) {
                this.activeAnomalies.delete(type);
                this.anomalyImpactCache.delete(type);
                removedCount++;
            }
        }

        // Clean up orphaned signal blocks
        for (const blockKey of this.signalBlocklist) {
            if (blockKey.includes(":")) {
                const timestamp = parseInt(blockKey.split(":").pop() || "0");
                if (now - timestamp > 300000) {
                    // 5 minutes max
                    this.signalBlocklist.delete(blockKey);
                }
            }
        }

        if (removedCount > 0) {
            this.logger.debug("Cleaned up expired anomalies", {
                removedCount,
                activeCount: this.activeAnomalies.size,
                blockedSignalTypes: this.signalBlocklist.size,
            });

            // Update metrics
            this.metricsCollector.setGauge(
                "signal_manager_active_anomalies_count",
                this.activeAnomalies.size
            );
        }
    }

    /**
     * Enhanced market anomaly check using real-time context
     */
    private checkMarketAnomaly(price: number): MarketAnomaly | null {
        try {
            // Get current market health from anomaly detector
            const marketHealth = this.anomalyDetector.getMarketHealth();
            if (marketHealth.isHealthy || !marketHealth.highestSeverity) {
                return null;
            }

            // Check for recent critical anomalies
            const criticalAnomalies = Array.from(
                this.activeAnomalies.values()
            ).filter(
                (a) =>
                    a.severity === "critical" &&
                    Date.now() - a.detectedAt < 60000
            );

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

            // Fallback to market health check
            return {
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
        } catch (error) {
            this.logger.error("Failed to check market anomaly", {
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }

    /**
     * Record anomaly-related metrics
     */
    private recordAnomalyMetrics(anomaly: AnomalyEvent): void {
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

        const impactScore = this.calculateAnomalyImpactScore(anomaly);
        this.metricsCollector.recordHistogram(
            "signal_manager_anomaly_impact_score",
            impactScore,
            {
                anomaly_type: anomaly.type,
                severity: anomaly.severity,
            }
        );
    }

    /**
     * Record signal processing metrics
     */
    private recordMetric(metricName: string, signalType: string): void {
        this.metricsCollector.incrementCounter(
            `signal_manager_${metricName}_total`,
            1,
            { signal_type: signalType }
        );
    }

    /**
     * Log comprehensive signal processing information
     */
    private logSignalProcessing(
        signal: ProcessedSignal,
        confirmedSignal: ConfirmedSignal,
        anomalyAdjustment: ReturnType<typeof calculateAnomalyAdjustedConfidence>
    ): void {
        this.logger.info("Signal processed with anomaly integration", {
            signalId: signal.id,
            signalType: signal.type,
            confidence: {
                original: signal.confidence,
                anomalyAdjusted: anomalyAdjustment.adjustedConfidence,
                final: confirmedSignal.confidence,
            },
            anomalyContext: {
                activeAnomalies: this.activeAnomalies.size,
                impactFactors: anomalyAdjustment.impactFactors.length,
                supportingAnomalies:
                    confirmedSignal.anomalyData?.supportingAnomalies?.length ||
                    0,
                opposingAnomalies:
                    confirmedSignal.anomalyData?.opposingAnomalies?.length || 0,
            },
        });
    }

    /**
     * Get current anomaly context for external systems
     */
    public getAnomalyContext(): {
        activeAnomalies: AnomalyEvent[];
        blockedSignalTypes: string[];
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
        const blockedSignalTypes = Array.from(this.signalBlocklist);

        return {
            activeAnomalies: active,
            blockedSignalTypes,
            totalImpact: Math.min(1.0, totalImpact),
            criticalCount,
            lastUpdate: Date.now(),
        };
    }

    /**
     * Initialize anomaly-related metrics
     */
    private initializeMetrics(): void {
        try {
            this.metricsCollector.createCounter(
                "signal_manager_anomalies_detected_total",
                "Total number of anomalies detected",
                ["anomaly_type", "severity", "recommended_action"]
            );

            this.metricsCollector.createCounter(
                "signal_manager_signal_blocked_by_anomaly_total",
                "Total number of signals blocked by anomalies",
                ["signal_type"]
            );

            this.metricsCollector.createCounter(
                "signal_manager_signal_rejected_low_confidence_total",
                "Total number of signals rejected due to low anomaly-adjusted confidence",
                ["signal_type"]
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

            this.logger.debug("Anomaly metrics initialized", {
                component: "SignalManager",
            });
        } catch (error) {
            this.logger.error("Failed to initialize anomaly metrics", {
                component: "SignalManager",
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    // Placeholder methods - implement based on your existing SignalManager
    private calculateSignalCorrelation(
        signal: ProcessedSignal
    ): SignalCorrelation {
        // Your existing correlation logic
        return {
            signalId: signal.id,
            correlatedSignals: [],
            strength: 0,
            timestamp: Date.now(),
        };
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
    private checkMarketAnomaly_old(price: number): MarketAnomaly | null {
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
                      anomaly: null,
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
}
