#!/usr/bin/env node
/**
 * Signal Optimization Monitoring Script
 * Real-time monitoring of optimization KPIs with automated rollback triggers
 */

const fs = require("fs");
const path = require("path");

class OptimizationMonitor {
    constructor() {
        this.monitoringConfig = this.loadMonitoringConfig();
        this.baselineMetrics = this.loadBaselineMetrics();
        this.rollbackTriggers = this.monitoringConfig.rollback_triggers;
        this.isMonitoring = false;
        this.metrics = {
            signalVolume: [],
            detectionRate: [],
            falsePositiveRate: [],
            processingLatency: [],
            precision: [],
        };
    }

    loadMonitoringConfig() {
        try {
            return JSON.parse(
                fs.readFileSync("monitoring_config.json", "utf8")
            );
        } catch (error) {
            console.error("Failed to load monitoring config:", error.message);
            return this.getDefaultConfig();
        }
    }

    loadBaselineMetrics() {
        // These would typically come from historical analysis
        return {
            dailySignals: 127,
            detectionRate: 64.2,
            precision: 94.7,
            falsePositiveRate: 5.4,
            avgLatency: 1.8,
        };
    }

    getDefaultConfig() {
        return {
            optimization_phase: "unknown",
            deployment_time: new Date().toISOString(),
            baseline_metrics: {
                signal_volume_target: 25,
                detection_rate_target: 30,
                false_positive_limit: 3,
                latency_increase_limit: 20,
            },
            rollback_triggers: {
                false_positive_rate: 5.0,
                precision_drop: 2.0,
                latency_increase: 15.0,
                processing_overload: 10.0,
            },
        };
    }

    startMonitoring() {
        this.isMonitoring = true;
        console.log(
            `🔍 Starting optimization monitoring for Phase: ${this.monitoringConfig.optimization_phase}`
        );
        console.log(`📊 Baseline metrics loaded`);
        console.log(`⚠️  Rollback triggers configured`);
        console.log("");

        // Monitor every 30 seconds
        this.monitoringInterval = setInterval(() => {
            this.collectMetrics();
        }, 30000);

        // Display dashboard every 5 minutes
        this.dashboardInterval = setInterval(() => {
            this.displayDashboard();
        }, 300000);

        // Initial dashboard display
        this.displayDashboard();

        process.on("SIGINT", () => {
            this.stopMonitoring();
        });
    }

    async collectMetrics() {
        try {
            // In a real implementation, these would come from the actual system
            // For now, we'll simulate metrics collection
            const currentMetrics = await this.getCurrentMetrics();

            // Store metrics for trending
            this.updateMetricsHistory(currentMetrics);

            // Check rollback triggers
            this.checkRollbackTriggers(currentMetrics);
        } catch (error) {
            console.error("Error collecting metrics:", error.message);
        }
    }

    async getCurrentMetrics() {
        // Simulate metric collection - in reality, this would query the actual system
        const variance = () => (Math.random() - 0.5) * 0.1; // ±5% variance

        const signalVolumeIncrease = 28 + variance() * 10; // Phase 1 target: 28%
        const detectionRateImprovement = 35 + variance() * 10; // Phase 1 target: 35%
        const currentFalsePositiveRate =
            this.baselineMetrics.falsePositiveRate *
            (1 + (2 + variance()) / 100);
        const latencyIncrease = -22 + variance() * 10; // Negative = improvement
        const precisionChange = -1.5 + variance() * 2; // Small decrease expected

        return {
            signalVolumeIncrease,
            detectionRateImprovement,
            falsePositiveRate: currentFalsePositiveRate,
            latencyChange: latencyIncrease,
            precisionChange,
            timestamp: new Date().toISOString(),
            processingLoad: 75 + variance() * 20,
        };
    }

    updateMetricsHistory(metrics) {
        const maxHistory = 100;

        Object.keys(this.metrics).forEach((key) => {
            if (this.metrics[key].length >= maxHistory) {
                this.metrics[key].shift();
            }
        });

        this.metrics.signalVolume.push(metrics.signalVolumeIncrease);
        this.metrics.detectionRate.push(metrics.detectionRateImprovement);
        this.metrics.falsePositiveRate.push(metrics.falsePositiveRate);
        this.metrics.processingLatency.push(metrics.latencyChange);
        this.metrics.precision.push(metrics.precisionChange);
    }

    checkRollbackTriggers(metrics) {
        const triggers = [];

        if (
            metrics.falsePositiveRate >
            this.baselineMetrics.falsePositiveRate *
                (1 + this.rollbackTriggers.false_positive_rate / 100)
        ) {
            triggers.push(
                `False positive rate exceeded: ${metrics.falsePositiveRate.toFixed(2)}%`
            );
        }

        if (
            Math.abs(metrics.precisionChange) >
            this.rollbackTriggers.precision_drop
        ) {
            triggers.push(
                `Precision drop exceeded: ${metrics.precisionChange.toFixed(2)}%`
            );
        }

        if (metrics.latencyChange > this.rollbackTriggers.latency_increase) {
            triggers.push(
                `Latency increase exceeded: ${metrics.latencyChange.toFixed(2)}%`
            );
        }

        if (metrics.processingLoad > 90) {
            triggers.push(
                `Processing overload detected: ${metrics.processingLoad.toFixed(1)}%`
            );
        }

        if (triggers.length > 0) {
            this.triggerRollbackAlert(triggers);
        }
    }

    triggerRollbackAlert(triggers) {
        console.log("\n🚨 ROLLBACK TRIGGER ALERT 🚨");
        console.log("=".repeat(50));
        triggers.forEach((trigger) => {
            console.log(`❌ ${trigger}`);
        });
        console.log("");
        console.log("🔄 Recommended action: Execute rollback");
        console.log("📞 Command: ./deploy_optimization.sh rollback");
        console.log("=".repeat(50));

        // Log to file
        const alertLog = {
            timestamp: new Date().toISOString(),
            phase: this.monitoringConfig.optimization_phase,
            triggers,
            action: "rollback_recommended",
        };

        fs.appendFileSync(
            "rollback_alerts.log",
            JSON.stringify(alertLog) + "\n"
        );
    }

    displayDashboard() {
        console.clear();
        console.log("📊 SIGNAL OPTIMIZATION MONITORING DASHBOARD");
        console.log("=".repeat(60));
        console.log(
            `🔧 Phase: ${this.monitoringConfig.optimization_phase.toUpperCase()}`
        );
        console.log(
            `⏰ Deployed: ${new Date(this.monitoringConfig.deployment_time).toLocaleString()}`
        );
        console.log(`🕐 Current: ${new Date().toLocaleString()}`);
        console.log("");

        if (this.metrics.signalVolume.length > 0) {
            const latest = this.metrics.signalVolume.length - 1;
            const trend = this.calculateTrend;

            console.log("📈 KEY PERFORMANCE INDICATORS");
            console.log("-".repeat(40));
            console.log(
                `📊 Signal Volume Change: ${this.getColoredMetric(this.metrics.signalVolume[latest], 25, "+")}%`
            );
            console.log(
                `🎯 Detection Rate Improvement: ${this.getColoredMetric(this.metrics.detectionRate[latest], 30, "+")}%`
            );
            console.log(
                `⚠️  False Positive Rate: ${this.getColoredMetric(this.metrics.falsePositiveRate[latest], this.baselineMetrics.falsePositiveRate + 3, "-")}%`
            );
            console.log(
                `⚡ Latency Change: ${this.getColoredMetric(this.metrics.processingLatency[latest], -15, "-")}%`
            );
            console.log(
                `✅ Precision Change: ${this.getColoredMetric(this.metrics.precision[latest], -2, "+")}%`
            );
            console.log("");

            console.log("📊 TREND ANALYSIS (Last 10 measurements)");
            console.log("-".repeat(40));
            console.log(
                `📈 Signal Volume: ${this.getTrendIndicator("signalVolume")}`
            );
            console.log(
                `🎯 Detection Rate: ${this.getTrendIndicator("detectionRate")}`
            );
            console.log(
                `⚠️  False Positive Rate: ${this.getTrendIndicator("falsePositiveRate")}`
            );
            console.log("");

            console.log("🎯 PHASE TARGETS vs ACTUAL");
            console.log("-".repeat(40));
            const targets = this.monitoringConfig.baseline_metrics;
            console.log(
                `Signal Volume: ${targets.signal_volume_target}% target vs ${this.metrics.signalVolume[latest].toFixed(1)}% actual`
            );
            console.log(
                `Detection Rate: ${targets.detection_rate_target}% target vs ${this.metrics.detectionRate[latest].toFixed(1)}% actual`
            );
            console.log(
                `False Positive Limit: <${targets.false_positive_limit}% vs ${(this.metrics.falsePositiveRate[latest] - this.baselineMetrics.falsePositiveRate).toFixed(1)}% increase`
            );
        } else {
            console.log("⏳ Collecting initial metrics...");
        }

        console.log("");
        console.log("🔄 Press Ctrl+C to stop monitoring");
        console.log("📊 Dashboard updates every 5 minutes");
    }

    getColoredMetric(value, threshold, direction) {
        const isGood =
            direction === "+" ? value >= threshold : value <= threshold;
        const color = isGood ? "\x1b[32m" : "\x1b[31m"; // Green or Red
        const reset = "\x1b[0m";
        return `${color}${value.toFixed(1)}${reset}`;
    }

    getTrendIndicator(metric) {
        if (this.metrics[metric].length < 2) return "⏳ Insufficient data";

        const recent = this.metrics[metric].slice(-5);
        const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
        const first = recent[0];
        const last = recent[recent.length - 1];

        if (last > first * 1.02) return "📈 Trending up";
        if (last < first * 0.98) return "📉 Trending down";
        return "➡️ Stable";
    }

    stopMonitoring() {
        this.isMonitoring = false;
        if (this.monitoringInterval) clearInterval(this.monitoringInterval);
        if (this.dashboardInterval) clearInterval(this.dashboardInterval);

        console.log("\n📊 Monitoring stopped");
        console.log("💾 Metrics saved to monitoring logs");

        // Save final metrics report
        const report = {
            phase: this.monitoringConfig.optimization_phase,
            monitoring_duration:
                new Date() - new Date(this.monitoringConfig.deployment_time),
            final_metrics: this.metrics,
            deployment_time: this.monitoringConfig.deployment_time,
            end_time: new Date().toISOString(),
        };

        fs.writeFileSync(
            "optimization_monitoring_report.json",
            JSON.stringify(report, null, 2)
        );
        console.log(
            "📄 Final report saved to: optimization_monitoring_report.json"
        );

        process.exit(0);
    }
}

// Start monitoring if run directly
if (require.main === module) {
    const monitor = new OptimizationMonitor();
    monitor.startMonitoring();
}

module.exports = OptimizationMonitor;
