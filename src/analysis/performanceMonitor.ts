// src/analysis/performanceMonitor.ts

import { EventEmitter } from "events";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import type { SignalTracker } from "./signalTracker.js";
import type {
    PerformanceAnalyzer,
    PerformanceReport,
} from "./performanceAnalyzer.js";
import type { FailureAnalyzer, FailurePatterns } from "./failureAnalyzer.js";

export interface PerformanceAlert {
    id: string;
    type:
        | "performance_degradation"
        | "high_failure_rate"
        | "detector_anomaly"
        | "market_condition_alert"
        | "confidence_miscalibration"
        | "system_health";
    severity: "low" | "medium" | "high" | "critical";
    title: string;
    message: string;
    data: Record<string, unknown>;
    timestamp: number;
    acknowledged: boolean;
    resolvedAt?: number;
}

export interface PerformanceTrend {
    metric: string;
    timeframe: string;
    direction: "improving" | "declining" | "stable";
    rate: number; // Rate of change
    significance: number; // Statistical significance
    startValue: number;
    endValue: number;
    duration: number;
}

export interface SystemHealthStatus {
    overall: "healthy" | "warning" | "critical" | "unknown";
    components: {
        [component: string]: {
            status: "healthy" | "warning" | "critical" | "unknown";
            lastCheck: number;
            issues: string[];
            metrics: { [key: string]: number };
        };
    };
    lastUpdate: number;
    uptime: number;
}

export interface PerformanceMonitorConfig {
    // Monitoring intervals
    performanceAnalysisIntervalMs: number; // How often to run full analysis
    quickCheckIntervalMs: number; // How often to run quick checks
    healthCheckIntervalMs: number; // How often to check system health

    // Alert thresholds
    successRateAlertThreshold: number; // Alert if below this success rate
    performanceDeclineAlertThreshold: number; // Alert if performance declines by this %
    failureRateAlertThreshold: number; // Alert if failure rate exceeds this

    // Trend detection
    trendDetectionPeriod: number; // Period for trend analysis
    significanceThreshold: number; // Minimum significance for trends

    // Health monitoring
    minSignalsForHealthCheck: number; // Minimum signals needed for health assessment
    healthCheckLookbackMs: number; // How far back to look for health assessment

    // Alert management
    maxActiveAlerts: number; // Maximum number of active alerts
    alertCooldownMs: number; // Cooldown period between similar alerts

    // Reporting
    reportGenerationIntervalMs: number; // How often to generate reports
    reportRetentionDays: number; // How long to keep reports
}

/**
 * PerformanceMonitor continuously monitors signal performance, detects issues,
 * and generates alerts and reports for system health and optimization.
 */
export class PerformanceMonitor extends EventEmitter {
    private readonly config: Required<PerformanceMonitorConfig>;

    // Monitoring intervals
    private performanceAnalysisInterval?: NodeJS.Timeout | undefined;
    private quickCheckInterval?: NodeJS.Timeout | undefined;
    private healthCheckInterval?: NodeJS.Timeout | undefined;
    private reportGenerationInterval?: NodeJS.Timeout | undefined;

    // State tracking
    private readonly activeAlerts = new Map<string, PerformanceAlert>();
    private readonly alertHistory: PerformanceAlert[] = [];
    private lastPerformanceReport?: PerformanceReport;
    private lastFailurePatterns?: FailurePatterns;
    private recentTrends: PerformanceTrend[] = [];
    private systemHealth: SystemHealthStatus;

    // Alert cooldowns
    private readonly alertCooldowns = new Map<string, number>();

    constructor(
        private readonly signalTracker: SignalTracker,
        private readonly performanceAnalyzer: PerformanceAnalyzer,
        private readonly failureAnalyzer: FailureAnalyzer,
        private readonly logger: ILogger,
        private readonly metricsCollector: IMetricsCollector,
        config: Partial<PerformanceMonitorConfig> = {}
    ) {
        super();

        this.config = {
            performanceAnalysisIntervalMs:
                config.performanceAnalysisIntervalMs ?? 3600000, // 1 hour
            quickCheckIntervalMs: config.quickCheckIntervalMs ?? 900000, // 15 minutes
            healthCheckIntervalMs: config.healthCheckIntervalMs ?? 300000, // 5 minutes
            successRateAlertThreshold: config.successRateAlertThreshold ?? 0.4,
            performanceDeclineAlertThreshold:
                config.performanceDeclineAlertThreshold ?? 0.1,
            failureRateAlertThreshold: config.failureRateAlertThreshold ?? 0.6,
            trendDetectionPeriod: config.trendDetectionPeriod ?? 86400000 * 7, // 7 days
            significanceThreshold: config.significanceThreshold ?? 0.05,
            minSignalsForHealthCheck: config.minSignalsForHealthCheck ?? 10,
            healthCheckLookbackMs: config.healthCheckLookbackMs ?? 3600000, // 1 hour
            maxActiveAlerts: config.maxActiveAlerts ?? 50,
            alertCooldownMs: config.alertCooldownMs ?? 1800000, // 30 minutes
            reportGenerationIntervalMs:
                config.reportGenerationIntervalMs ?? 86400000, // 24 hours
            reportRetentionDays: config.reportRetentionDays ?? 30,
        };

        // Initialize system health
        this.systemHealth = {
            overall: "unknown",
            components: {},
            lastUpdate: Date.now(),
            uptime: 0,
        };

        this.logger.info("PerformanceMonitor initialized", {
            component: "PerformanceMonitor",
            config: this.config,
        });

        this.initializeMetrics();
    }

    /**
     * Start all monitoring processes.
     */
    public startMonitoring(): void {
        this.logger.info("Starting performance monitoring", {
            component: "PerformanceMonitor",
        });

        // Performance analysis (comprehensive)
        this.performanceAnalysisInterval = setInterval(() => {
            void this.runPerformanceAnalysis();
        }, this.config.performanceAnalysisIntervalMs);

        // Quick performance checks
        this.quickCheckInterval = setInterval(() => {
            void this.runQuickPerformanceCheck();
        }, this.config.quickCheckIntervalMs);

        // System health monitoring
        this.healthCheckInterval = setInterval(() => {
            void this.runHealthCheck();
        }, this.config.healthCheckIntervalMs);

        // Report generation
        this.reportGenerationInterval = setInterval(() => {
            void this.generatePerformanceReport();
        }, this.config.reportGenerationIntervalMs);

        // Run initial checks
        void this.runPerformanceAnalysis();
        void this.runHealthCheck();

        this.emit("monitoringStarted");
    }

    /**
     * Stop all monitoring processes.
     */
    public stopMonitoring(): void {
        this.logger.info("Stopping performance monitoring", {
            component: "PerformanceMonitor",
        });

        if (this.performanceAnalysisInterval) {
            clearInterval(this.performanceAnalysisInterval);
            this.performanceAnalysisInterval = undefined;
        }
        if (this.quickCheckInterval) {
            clearInterval(this.quickCheckInterval);
            this.quickCheckInterval = undefined;
        }
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = undefined;
        }
        if (this.reportGenerationInterval) {
            clearInterval(this.reportGenerationInterval);
            this.reportGenerationInterval = undefined;
        }

        this.emit("monitoringStopped");
    }

    /**
     * Get current system health status.
     */
    public getSystemHealth(): SystemHealthStatus {
        return { ...this.systemHealth };
    }

    /**
     * Get active performance alerts.
     */
    public getActiveAlerts(): PerformanceAlert[] {
        return Array.from(this.activeAlerts.values());
    }

    /**
     * Get performance trends.
     */
    public getPerformanceTrends(): PerformanceTrend[] {
        return [...this.recentTrends];
    }

    /**
     * Acknowledge an alert.
     */
    public acknowledgeAlert(alertId: string): boolean {
        const alert = this.activeAlerts.get(alertId);
        if (alert) {
            alert.acknowledged = true;
            this.logger.info("Alert acknowledged", {
                component: "PerformanceMonitor",
                alertId,
                alertType: alert.type,
            });
            this.emit("alertAcknowledged", alert);
            return true;
        }
        return false;
    }

    /**
     * Resolve an alert.
     */
    public resolveAlert(alertId: string): boolean {
        const alert = this.activeAlerts.get(alertId);
        if (alert) {
            alert.resolvedAt = Date.now();
            this.activeAlerts.delete(alertId);
            this.alertHistory.push(alert);

            this.logger.info("Alert resolved", {
                component: "PerformanceMonitor",
                alertId,
                alertType: alert.type,
                duration: alert.resolvedAt - alert.timestamp,
            });

            this.emit("alertResolved", alert);
            return true;
        }
        return false;
    }

    // Private monitoring methods

    private async runPerformanceAnalysis(): Promise<void> {
        try {
            this.logger.debug("Running comprehensive performance analysis", {
                component: "PerformanceMonitor",
            });

            // Get comprehensive performance report
            const report =
                await this.performanceAnalyzer.analyzeOverallPerformance(
                    86400000
                ); // 24 hours
            this.lastPerformanceReport = report;

            // Update metrics
            this.updatePerformanceMetrics(report);

            // Check for performance issues
            this.checkPerformanceIssues(report);

            // Analyze trends
            this.analyzeTrends(report);

            // Get failure patterns
            const failurePatterns =
                await this.failureAnalyzer.detectFailurePatterns();
            this.lastFailurePatterns = failurePatterns;

            // Check failure patterns for issues
            this.checkFailurePatternIssues(failurePatterns);

            this.logger.info("Performance analysis completed", {
                component: "PerformanceMonitor",
                totalSignals: report.totalSignals,
                successRate: report.overallSuccessRate,
                activeAlerts: this.activeAlerts.size,
            });

            this.emit("performanceAnalysisCompleted", report);
        } catch (error) {
            this.logger.error("Performance analysis failed", {
                component: "PerformanceMonitor",
                error: error instanceof Error ? error.message : String(error),
            });

            this.createAlert({
                type: "system_health",
                severity: "medium",
                title: "Performance Analysis Failed",
                message: `Performance analysis encountered an error: ${error instanceof Error ? error.message : String(error)}`,
                data: { error: String(error) },
            });
        }
    }

    private runQuickPerformanceCheck(): void {
        try {
            this.logger.debug("Running quick performance check", {
                component: "PerformanceMonitor",
            });

            // Get recent performance metrics
            const recentMetrics =
                this.signalTracker.getPerformanceMetrics(3600000); // 1 hour

            if (
                recentMetrics.totalSignals <
                this.config.minSignalsForHealthCheck
            ) {
                this.logger.debug(
                    "Insufficient signals for quick performance check",
                    {
                        component: "PerformanceMonitor",
                        signalCount: recentMetrics.totalSignals,
                        minRequired: this.config.minSignalsForHealthCheck,
                    }
                );
                return;
            }

            // Check success rate
            if (
                recentMetrics.overallSuccessRate <
                this.config.successRateAlertThreshold
            ) {
                this.createAlert({
                    type: "performance_degradation",
                    severity: "high",
                    title: "Low Success Rate Detected",
                    message: `Recent success rate (${(recentMetrics.overallSuccessRate * 100).toFixed(1)}%) is below threshold (${(this.config.successRateAlertThreshold * 100).toFixed(1)}%)`,
                    data: {
                        successRate: recentMetrics.overallSuccessRate,
                        threshold: this.config.successRateAlertThreshold,
                        signalCount: recentMetrics.totalSignals,
                        timeWindow: "1 hour",
                    },
                });
            }

            // Check for unusual patterns
            if (recentMetrics.avgReturnPerSignal < -0.01) {
                // -1% average return
                this.createAlert({
                    type: "performance_degradation",
                    severity: "medium",
                    title: "Negative Returns Detected",
                    message: `Recent average return (${(recentMetrics.avgReturnPerSignal * 100).toFixed(2)}%) is significantly negative`,
                    data: {
                        avgReturn: recentMetrics.avgReturnPerSignal,
                        signalCount: recentMetrics.totalSignals,
                    },
                });
            }

            this.emit("quickPerformanceCheckCompleted", recentMetrics);
        } catch (error) {
            this.logger.error("Quick performance check failed", {
                component: "PerformanceMonitor",
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private runHealthCheck(): void {
        try {
            this.logger.debug("Running system health check", {
                component: "PerformanceMonitor",
            });

            const now = Date.now();
            const components: SystemHealthStatus["components"] = {};

            // Check SignalTracker health
            const trackerStatus = this.signalTracker.getStatus();
            components["signalTracker"] = {
                status: this.assessComponentHealth("signalTracker", {
                    activeSignals: trackerStatus.activeSignals,
                    finalizedSignals: trackerStatus.completedSignals,
                }),
                lastCheck: now,
                issues: [],
                metrics: {
                    activeSignals: trackerStatus.activeSignals,
                    finalizedSignals: trackerStatus.completedSignals,
                },
            };

            // Check recent signal generation
            const recentMetrics = this.signalTracker.getPerformanceMetrics(
                this.config.healthCheckLookbackMs
            );
            components["signalGeneration"] = {
                status: this.assessComponentHealth("signalGeneration", {
                    recentSignals: recentMetrics.totalSignals,
                    successRate: recentMetrics.overallSuccessRate,
                }),
                lastCheck: now,
                issues: [],
                metrics: {
                    recentSignals: recentMetrics.totalSignals,
                    successRate: recentMetrics.overallSuccessRate,
                },
            };

            // Check alert system
            components["alertSystem"] = {
                status: this.assessComponentHealth("alertSystem", {
                    activeAlerts: this.activeAlerts.size,
                    alertHistory: this.alertHistory.length,
                }),
                lastCheck: now,
                issues: [],
                metrics: {
                    activeAlerts: this.activeAlerts.size,
                    alertHistory: this.alertHistory.length,
                },
            };

            // Determine overall health
            const componentStatuses = Object.values(components).map(
                (c) => c.status
            );
            const criticalCount = componentStatuses.filter(
                (s) => s === "critical"
            ).length;
            const warningCount = componentStatuses.filter(
                (s) => s === "warning"
            ).length;

            let overallStatus: SystemHealthStatus["overall"];
            if (criticalCount > 0) {
                overallStatus = "critical";
            } else if (warningCount > 0) {
                overallStatus = "warning";
            } else if (componentStatuses.every((s) => s === "healthy")) {
                overallStatus = "healthy";
            } else {
                overallStatus = "unknown";
            }

            // Update system health
            this.systemHealth = {
                overall: overallStatus,
                components,
                lastUpdate: now,
                uptime: now - (this.systemHealth.lastUpdate || now),
            };

            // Update metrics
            this.metricsCollector.setGauge(
                "performance_monitor_system_health_score",
                this.getHealthScore(overallStatus)
            );
            this.metricsCollector.setGauge(
                "performance_monitor_active_alerts_count",
                this.activeAlerts.size
            );

            this.emit("healthCheckCompleted", this.systemHealth);
        } catch (error) {
            this.logger.error("Health check failed", {
                component: "PerformanceMonitor",
                error: error instanceof Error ? error.message : String(error),
            });

            this.systemHealth.overall = "critical";
        }
    }

    private async generatePerformanceReport(): Promise<void> {
        try {
            this.logger.info("Generating performance report", {
                component: "PerformanceMonitor",
            });

            if (!this.lastPerformanceReport) {
                await this.runPerformanceAnalysis();
            }

            const report = {
                generatedAt: Date.now(),
                performanceReport: this.lastPerformanceReport,
                failurePatterns: this.lastFailurePatterns,
                systemHealth: this.systemHealth,
                activeAlerts: Array.from(this.activeAlerts.values()),
                trends: this.recentTrends,
            };

            this.emit("performanceReportGenerated", report);

            // Log report generation - AlertManager is for trading signals only
            this.logger.info("Daily performance report generated", {
                component: "PerformanceMonitor",
                reportData: {
                    generatedAt: report.generatedAt,
                    hasPerformanceReport: !!report.performanceReport,
                    hasFailurePatterns: !!report.failurePatterns,
                    systemHealth: report.systemHealth.overall,
                    activeAlerts: report.activeAlerts.length,
                    trends: report.trends.length,
                },
            });
        } catch (error) {
            this.logger.error("Failed to generate performance report", {
                component: "PerformanceMonitor",
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private checkPerformanceIssues(report: PerformanceReport): void {
        // Check overall performance decline
        if (
            report.recentPerformanceTrend === "declining" &&
            Math.abs(report.performanceChangeRate) >
                this.config.performanceDeclineAlertThreshold
        ) {
            this.createAlert({
                type: "performance_degradation",
                severity: this.getSeverityForDecline(
                    Math.abs(report.performanceChangeRate)
                ),
                title: "Performance Decline Detected",
                message: `System performance is declining at ${(report.performanceChangeRate * 100).toFixed(2)}% per hour`,
                data: {
                    trend: report.recentPerformanceTrend,
                    changeRate: report.performanceChangeRate,
                    successRate: report.overallSuccessRate,
                    totalSignals: report.totalSignals,
                },
            });
        }

        // Check detector-specific issues
        for (const [detectorId, performance] of Object.entries(
            report.detectorPerformance
        )) {
            if (performance.successRate < 0.3 && performance.count > 10) {
                this.createAlert({
                    type: "detector_anomaly",
                    severity: "medium",
                    title: `Detector Performance Issue: ${detectorId}`,
                    message: `Detector ${detectorId} has low success rate (${(performance.successRate * 100).toFixed(1)}%)`,
                    data: {
                        detectorId,
                        successRate: performance.successRate,
                        signalCount: performance.count,
                        avgReturn: performance.avgReturn,
                    },
                });
            }
        }

        // Check confidence calibration issues
        const miscalibratedBands = Object.entries(
            report.confidenceBands
        ).filter(([, band]) => band.calibrationError > 0.2); // 20% calibration error

        if (miscalibratedBands.length > 0) {
            this.createAlert({
                type: "confidence_miscalibration",
                severity: "medium",
                title: "Confidence Calibration Issues",
                message: `${miscalibratedBands.length} confidence bands are poorly calibrated`,
                data: {
                    miscalibratedBands: miscalibratedBands.map(
                        ([band, data]) => ({
                            band,
                            calibrationError: data.calibrationError,
                            count: data.count,
                        })
                    ),
                },
            });
        }
    }

    private checkFailurePatternIssues(patterns: FailurePatterns): void {
        // Check for high failure rates
        const totalFailures = patterns.commonFailureReasons.reduce(
            (sum, reason) => sum + reason.count,
            0
        );
        if (totalFailures > 0) {
            const highFailureReasons = patterns.commonFailureReasons.filter(
                (reason) =>
                    reason.percentage > this.config.failureRateAlertThreshold
            );

            for (const reason of highFailureReasons) {
                this.createAlert({
                    type: "high_failure_rate",
                    severity: "high",
                    title: `High Failure Rate: ${reason.reason}`,
                    message: `Failure reason '${reason.reason}' accounts for ${(reason.percentage * 100).toFixed(1)}% of failures`,
                    data: {
                        failureReason: reason.reason,
                        count: reason.count,
                        percentage: reason.percentage,
                        avgLoss: reason.avgLoss,
                    },
                });
            }
        }

        // Check detector failure patterns
        for (const [
            detectorId,
            detectorPattern,
        ] of patterns.detectorFailurePatterns) {
            if (
                detectorPattern.failureRate > 0.7 &&
                detectorPattern.totalFailures > 5
            ) {
                this.createAlert({
                    type: "detector_anomaly",
                    severity: "high",
                    title: `High Detector Failure Rate: ${detectorId}`,
                    message: `Detector ${detectorId} has ${(detectorPattern.failureRate * 100).toFixed(1)}% failure rate`,
                    data: {
                        detectorId,
                        failureRate: detectorPattern.failureRate,
                        totalFailures: detectorPattern.totalFailures,
                        commonReasons: detectorPattern.commonReasons,
                    },
                });
            }
        }
    }

    private analyzeTrends(report: PerformanceReport): void {
        try {
            // Analyze success rate trend
            const successRateTrend = this.calculateTrend(
                "successRate",
                report.overallSuccessRate
            );
            if (successRateTrend) {
                this.recentTrends.push(successRateTrend);
            }

            // Analyze return trend
            const returnTrend = this.calculateTrend(
                "avgReturn",
                report.avgReturnPerSignal
            );
            if (returnTrend) {
                this.recentTrends.push(returnTrend);
            }

            // Analyze Sharpe ratio trend
            const sharpeTrend = this.calculateTrend(
                "sharpeRatio",
                report.sharpeRatio
            );
            if (sharpeTrend) {
                this.recentTrends.push(sharpeTrend);
            }

            // Keep only recent trends
            const cutoff = Date.now() - this.config.trendDetectionPeriod;
            this.recentTrends = this.recentTrends.filter(
                (trend) => trend.duration > cutoff
            );

            // Alert on significant negative trends
            const significantNegativeTrends = this.recentTrends.filter(
                (trend) =>
                    trend.direction === "declining" &&
                    trend.significance < this.config.significanceThreshold &&
                    Math.abs(trend.rate) > 0.1 // 10% decline
            );

            for (const trend of significantNegativeTrends) {
                this.createAlert({
                    type: "performance_degradation",
                    severity: "medium",
                    title: `Declining Trend: ${trend.metric}`,
                    message: `${trend.metric} is declining at ${(trend.rate * 100).toFixed(2)}% per hour`,
                    data: {
                        metric: trend.metric,
                        timeframe: trend.timeframe,
                        direction: trend.direction,
                        rate: trend.rate,
                        significance: trend.significance,
                        startValue: trend.startValue,
                        endValue: trend.endValue,
                        duration: trend.duration,
                    } as Record<string, unknown>,
                });
            }
        } catch (error) {
            this.logger.error("Failed to analyze trends", {
                component: "PerformanceMonitor",
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private calculateTrend(
        metric: string,
        currentValue: number
    ): PerformanceTrend | null {
        // Simplified trend calculation
        // In practice, this would use historical data and statistical analysis

        const historicalValue = this.getHistoricalValue(metric);
        if (historicalValue === null) return null;

        const change = currentValue - historicalValue;
        const rate = change / historicalValue;

        let direction: PerformanceTrend["direction"];
        if (Math.abs(rate) < 0.05) {
            // Less than 5% change
            direction = "stable";
        } else if (rate > 0) {
            direction = "improving";
        } else {
            direction = "declining";
        }

        return {
            metric,
            timeframe: "24h",
            direction,
            rate,
            significance: Math.abs(rate) > 0.1 ? 0.01 : 0.1, // Simplified significance
            startValue: historicalValue,
            endValue: currentValue,
            duration: 86400000, // 24 hours
        };
    }

    private getHistoricalValue(metric: string): number | null {
        // Placeholder - would get from historical data storage
        // For now, return a mock value based on the metric
        const mockValues: { [key: string]: number } = {
            successRate: 0.65,
            avgReturn: 0.005,
            sharpeRatio: 0.8,
        };

        return mockValues[metric] || null;
    }

    private createAlert(
        alertData: Omit<PerformanceAlert, "id" | "timestamp" | "acknowledged">
    ): void {
        // Check cooldown
        const cooldownKey = `${alertData.type}_${alertData.severity}`;
        const lastAlert = this.alertCooldowns.get(cooldownKey);
        if (lastAlert && Date.now() - lastAlert < this.config.alertCooldownMs) {
            this.logger.debug("Alert suppressed due to cooldown", {
                component: "PerformanceMonitor",
                alertType: alertData.type,
                cooldownRemaining:
                    this.config.alertCooldownMs - (Date.now() - lastAlert),
            });
            return;
        }

        // Check if we're at max alerts
        if (this.activeAlerts.size >= this.config.maxActiveAlerts) {
            this.logger.warn(
                "Maximum active alerts reached, cannot create new alert",
                {
                    component: "PerformanceMonitor",
                    maxAlerts: this.config.maxActiveAlerts,
                    alertType: alertData.type,
                }
            );
            return;
        }

        const alert: PerformanceAlert = {
            id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now(),
            acknowledged: false,
            ...alertData,
        };

        this.activeAlerts.set(alert.id, alert);
        this.alertCooldowns.set(cooldownKey, Date.now());

        // Log alert - AlertManager is for trading signals only
        this.logger.warn("Performance alert created", {
            component: "PerformanceMonitor",
            alertId: alert.id,
            alertType: alert.type,
            severity: alert.severity,
            title: alert.title,
            message: alert.message,
            data: alert.data,
        });

        // Update metrics
        this.metricsCollector.incrementCounter(
            "performance_monitor_alerts_created_total",
            1,
            {
                alert_type: alert.type,
                severity: alert.severity,
            }
        );

        this.emit("alertCreated", alert);
    }

    // Utility methods

    private assessComponentHealth(
        componentName: string,
        metrics: { [key: string]: number }
    ): "healthy" | "warning" | "critical" | "unknown" {
        switch (componentName) {
            case "signalTracker":
                if (
                    metrics["activeSignals"] !== undefined &&
                    metrics["activeSignals"] > 1000
                )
                    return "warning"; // Too many active signals
                if (metrics["finalizedSignals"] === 0) return "critical"; // No finalized signals
                return "healthy";

            case "signalGeneration":
                if (metrics["recentSignals"] === 0) return "critical"; // No recent signals
                if (
                    metrics["successRate"] !== undefined &&
                    metrics["successRate"] < 0.3
                )
                    return "warning"; // Low success rate
                return "healthy";

            case "alertSystem":
                if (
                    metrics["activeAlerts"] !== undefined &&
                    metrics["activeAlerts"] > this.config.maxActiveAlerts * 0.8
                )
                    return "warning";
                return "healthy";

            default:
                return "unknown";
        }
    }

    private getHealthScore(status: SystemHealthStatus["overall"]): number {
        switch (status) {
            case "healthy":
                return 1.0;
            case "warning":
                return 0.6;
            case "critical":
                return 0.2;
            case "unknown":
                return 0.4;
            default:
                return 0.0;
        }
    }

    private getSeverityForDecline(rate: number): PerformanceAlert["severity"] {
        if (rate > 0.3) return "critical"; // 30%+ decline
        if (rate > 0.2) return "high"; // 20%+ decline
        if (rate > 0.1) return "medium"; // 10%+ decline
        return "low";
    }

    private updatePerformanceMetrics(report: PerformanceReport): void {
        try {
            this.metricsCollector.setGauge(
                "performance_monitor_overall_success_rate",
                report.overallSuccessRate
            );
            this.metricsCollector.setGauge(
                "performance_monitor_avg_return",
                report.avgReturnPerSignal
            );
            this.metricsCollector.setGauge(
                "performance_monitor_sharpe_ratio",
                report.sharpeRatio
            );
            this.metricsCollector.setGauge(
                "performance_monitor_total_signals",
                report.totalSignals
            );
            this.metricsCollector.setGauge(
                "performance_monitor_win_rate",
                report.winRate
            );

            // Performance trend metric
            const trendScore =
                report.recentPerformanceTrend === "improving"
                    ? 1
                    : report.recentPerformanceTrend === "declining"
                      ? -1
                      : 0;
            this.metricsCollector.setGauge(
                "performance_monitor_trend_score",
                trendScore
            );
        } catch (error) {
            this.logger.error("Failed to update performance metrics", {
                component: "PerformanceMonitor",
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private initializeMetrics(): void {
        try {
            // Performance metrics
            this.metricsCollector.createGauge(
                "performance_monitor_overall_success_rate",
                "Overall signal success rate"
            );

            this.metricsCollector.createGauge(
                "performance_monitor_avg_return",
                "Average return per signal"
            );

            this.metricsCollector.createGauge(
                "performance_monitor_sharpe_ratio",
                "Signal Sharpe ratio"
            );

            this.metricsCollector.createGauge(
                "performance_monitor_total_signals",
                "Total signals in analysis"
            );

            this.metricsCollector.createGauge(
                "performance_monitor_win_rate",
                "Win rate of signals"
            );

            this.metricsCollector.createGauge(
                "performance_monitor_trend_score",
                "Performance trend score (-1 declining, 0 stable, 1 improving)"
            );

            // System health metrics
            this.metricsCollector.createGauge(
                "performance_monitor_system_health_score",
                "System health score (0-1)"
            );

            this.metricsCollector.createGauge(
                "performance_monitor_active_alerts_count",
                "Number of active performance alerts"
            );

            // Alert metrics
            this.metricsCollector.createCounter(
                "performance_monitor_alerts_created_total",
                "Total performance alerts created",
                ["alert_type", "severity"]
            );

            this.logger.debug("PerformanceMonitor metrics initialized", {
                component: "PerformanceMonitor",
            });
        } catch (error) {
            this.logger.error(
                "Failed to initialize PerformanceMonitor metrics",
                {
                    component: "PerformanceMonitor",
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
        }
    }

    /**
     * Get comprehensive status of the performance monitor.
     */
    public getStatus(): {
        isMonitoring: boolean;
        activeAlerts: number;
        systemHealth: SystemHealthStatus["overall"];
        lastAnalysis?: number;
        recentTrends: number;
        config: PerformanceMonitorConfig;
    } {
        return {
            isMonitoring: !!this.performanceAnalysisInterval,
            activeAlerts: this.activeAlerts.size,
            systemHealth: this.systemHealth.overall,
            lastAnalysis: this.lastPerformanceReport?.generatedAt ?? -1,
            recentTrends: this.recentTrends.length,
            config: this.config,
        };
    }

    /**
     * Force a performance analysis run.
     */
    public async forceAnalysis(): Promise<void> {
        this.logger.info("Forcing performance analysis", {
            component: "PerformanceMonitor",
        });
        await this.runPerformanceAnalysis();
    }

    /**
     * Cleanup and shutdown.
     */
    public shutdown(): void {
        this.stopMonitoring();
        this.removeAllListeners();

        this.logger.info("PerformanceMonitor shutdown completed", {
            component: "PerformanceMonitor",
            finalActiveAlerts: this.activeAlerts.size,
        });
    }
}
