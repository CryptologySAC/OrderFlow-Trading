// src/analysis/deltaCVDABMonitor.ts

import { EventEmitter } from "events";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import type { SignalCandidate } from "../types/signalTypes.js";
import { DeltaCVDTestProfile } from "../backtesting/deltaCVDABTestFramework.js";

/**
 * Real-time performance tracking for A/B testing
 */
interface ProfilePerformance {
    profile: DeltaCVDTestProfile;
    signalCount: number;
    processingTimes: number[];
    confidences: number[];
    memorySnapshots: number[];
    lastUpdate: number;
    errors: number;
}

/**
 * Real-time comparison metrics
 */
export interface RealtimeComparison {
    timestamp: number;
    leader: DeltaCVDTestProfile;
    metrics: {
        signalQuality: Map<DeltaCVDTestProfile, number>;
        processingSpeed: Map<DeltaCVDTestProfile, number>;
        memoryEfficiency: Map<DeltaCVDTestProfile, number>;
        overallScore: Map<DeltaCVDTestProfile, number>;
    };
    insights: string[];
}

/**
 * A/B Test allocation strategy
 */
export enum AllocationStrategy {
    ROUND_ROBIN = "round_robin",
    RANDOM = "random",
    PERFORMANCE_WEIGHTED = "performance_weighted",
    TIME_BASED = "time_based",
}

/**
 * Real-time A/B testing monitor for DeltaCVD
 * Tracks performance metrics and provides live insights
 */
export class DeltaCVDABMonitor extends EventEmitter {
    private performances: Map<DeltaCVDTestProfile, ProfilePerformance> =
        new Map();
    private currentAllocation: Map<string, DeltaCVDTestProfile> = new Map();
    private allocationStrategy: AllocationStrategy =
        AllocationStrategy.ROUND_ROBIN;
    private rotationCounter = 0;
    private comparisonInterval: NodeJS.Timeout | null = null;

    // Performance thresholds for alerts
    private readonly thresholds = {
        processingTimeMs: 10,
        memoryMB: 100,
        errorRate: 0.05,
        minSamplesForComparison: 100,
    };

    constructor(
        private readonly logger: ILogger,
        private readonly metricsCollector: IMetricsCollector
    ) {
        super();
        this.initializeProfiles();
    }

    /**
     * Initialize performance tracking for all profiles
     */
    private initializeProfiles(): void {
        for (const profile of Object.values(DeltaCVDTestProfile)) {
            this.performances.set(profile, {
                profile: profile,
                signalCount: 0,
                processingTimes: [],
                confidences: [],
                memorySnapshots: [],
                lastUpdate: Date.now(),
                errors: 0,
            });
        }
    }

    /**
     * Start monitoring with periodic comparisons
     */
    public startMonitoring(comparisonIntervalMs: number = 60000): void {
        this.logger.info("Starting DeltaCVD A/B monitoring", {
            interval: comparisonIntervalMs,
            strategy: this.allocationStrategy,
        });

        // Start periodic comparisons
        this.comparisonInterval = setInterval(() => {
            const comparison = this.compareProfiles();
            this.emit("comparison", comparison);

            // Adjust allocation strategy based on performance
            if (
                this.allocationStrategy ===
                AllocationStrategy.PERFORMANCE_WEIGHTED
            ) {
                this.updatePerformanceWeights();
            }
        }, comparisonIntervalMs);

        // Start metrics collection
        this.startMetricsCollection();
    }

    /**
     * Stop monitoring
     */
    public stopMonitoring(): void {
        if (this.comparisonInterval) {
            clearInterval(this.comparisonInterval);
            this.comparisonInterval = null;
        }

        this.logger.info("Stopped DeltaCVD A/B monitoring");
    }

    /**
     * Assign a profile to a user/session
     */
    public assignProfile(userId: string): DeltaCVDTestProfile {
        let profile: DeltaCVDTestProfile;

        switch (this.allocationStrategy) {
            case AllocationStrategy.ROUND_ROBIN:
                const profiles = Object.values(DeltaCVDTestProfile);
                profile = profiles[this.rotationCounter % profiles.length];
                this.rotationCounter++;
                break;

            case AllocationStrategy.RANDOM:
                const randomProfiles = Object.values(DeltaCVDTestProfile);
                profile =
                    randomProfiles[
                        Math.floor(Math.random() * randomProfiles.length)
                    ];
                break;

            case AllocationStrategy.PERFORMANCE_WEIGHTED:
                profile = this.selectWeightedProfile();
                break;

            case AllocationStrategy.TIME_BASED:
                // Rotate every hour
                const hour = new Date().getHours();
                const timeProfiles = Object.values(DeltaCVDTestProfile);
                profile = timeProfiles[hour % timeProfiles.length];
                break;

            default:
                profile = DeltaCVDTestProfile.SIMPLIFIED_WITH_PASSIVE;
        }

        this.currentAllocation.set(userId, profile);

        this.logger.debug("Assigned A/B test profile", {
            userId,
            profile,
            strategy: this.allocationStrategy,
        });

        return profile;
    }

    /**
     * Record detector performance metrics
     */
    public recordPerformance(
        profile: DeltaCVDTestProfile,
        processingTimeMs: number,
        signal?: SignalCandidate,
        error?: boolean
    ): void {
        const performance = this.performances.get(profile);
        if (!performance) return;

        // Update metrics
        performance.processingTimes.push(processingTimeMs);
        performance.lastUpdate = Date.now();

        if (signal) {
            performance.signalCount++;
            performance.confidences.push(signal.confidence);
        }

        if (error !== undefined && error !== null) {
            performance.errors++;
        }

        // Keep arrays bounded (last 1000 samples)
        if (performance.processingTimes.length > 1000) {
            performance.processingTimes.shift();
        }
        if (performance.confidences.length > 1000) {
            performance.confidences.shift();
        }

        // Record memory snapshot periodically
        if (
            performance.memorySnapshots.length === 0 ||
            Date.now() - performance.lastUpdate > 10000
        ) {
            const memUsage = process.memoryUsage();
            performance.memorySnapshots.push(memUsage.heapUsed / 1024 / 1024);

            if (performance.memorySnapshots.length > 100) {
                performance.memorySnapshots.shift();
            }
        }

        // Emit alerts for performance issues
        if (processingTimeMs > this.thresholds.processingTimeMs) {
            this.emit("performanceAlert", {
                profile,
                metric: "processingTime",
                value: processingTimeMs,
                threshold: this.thresholds.processingTimeMs,
            });
        }

        // Update metrics collector
        this.metricsCollector.incrementCounter("deltacvd_ab_signals_total", 1, {
            profile,
            has_signal: signal ? "true" : "false",
        });

        this.metricsCollector.setGauge(
            "deltacvd_ab_processing_time_ms",
            processingTimeMs,
            { profile }
        );
    }

    /**
     * Compare profile performances
     */
    private compareProfiles(): RealtimeComparison {
        const comparison: RealtimeComparison = {
            timestamp: Date.now(),
            leader: DeltaCVDTestProfile.SIMPLIFIED_WITH_PASSIVE,
            metrics: {
                signalQuality: new Map(),
                processingSpeed: new Map(),
                memoryEfficiency: new Map(),
                overallScore: new Map(),
            },
            insights: [],
        };

        let bestScore = -Infinity;

        for (const [profile, performance] of this.performances) {
            // Skip profiles with insufficient data
            if (
                performance.processingTimes.length <
                this.thresholds.minSamplesForComparison
            ) {
                continue;
            }

            // Calculate signal quality score
            const avgConfidence = this.calculateAverage(
                performance.confidences
            );
            const signalRate =
                performance.signalCount /
                (performance.processingTimes.length || 1);
            const errorRate =
                performance.errors / (performance.processingTimes.length || 1);
            const signalQuality = avgConfidence * signalRate * (1 - errorRate);
            comparison.metrics.signalQuality.set(profile, signalQuality);

            // Calculate processing speed score
            const avgProcessingTime = this.calculateAverage(
                performance.processingTimes
            );
            const processingSpeed = 1 / (avgProcessingTime + 1); // Inverse for scoring
            comparison.metrics.processingSpeed.set(profile, processingSpeed);

            // Calculate memory efficiency
            const avgMemory = this.calculateAverage(
                performance.memorySnapshots
            );
            const memoryEfficiency = 100 / (avgMemory + 1); // Inverse for scoring
            comparison.metrics.memoryEfficiency.set(profile, memoryEfficiency);

            // Calculate overall score (weighted)
            const overallScore =
                signalQuality * 0.4 +
                processingSpeed * 0.3 +
                memoryEfficiency * 0.3;

            comparison.metrics.overallScore.set(profile, overallScore);

            if (overallScore > bestScore) {
                bestScore = overallScore;
                comparison.leader = profile;
            }
        }

        // Generate insights
        this.generateInsights(comparison);

        return comparison;
    }

    /**
     * Generate insights from comparison
     */
    private generateInsights(comparison: RealtimeComparison): void {
        const insights = comparison.insights;

        // Compare passive volume impact
        const noPassiveQuality =
            comparison.metrics.signalQuality.get(
                DeltaCVDTestProfile.SIMPLIFIED_NO_PASSIVE
            ) ?? 0;
        const withPassiveQuality =
            comparison.metrics.signalQuality.get(
                DeltaCVDTestProfile.SIMPLIFIED_WITH_PASSIVE
            ) ?? 0;

        if (withPassiveQuality > noPassiveQuality * 1.1) {
            insights.push(
                "Passive volume improves signal quality by " +
                    ((withPassiveQuality / noPassiveQuality - 1) * 100).toFixed(
                        1
                    ) +
                    "%"
            );
        }

        // Compare simplified vs complex
        const simplifiedSpeed =
            comparison.metrics.processingSpeed.get(
                DeltaCVDTestProfile.SIMPLIFIED_WITH_PASSIVE
            ) ?? 0;
        const complexSpeed =
            comparison.metrics.processingSpeed.get(
                DeltaCVDTestProfile.CURRENT_COMPLEX
            ) ?? 0;

        if (simplifiedSpeed > complexSpeed * 1.4) {
            insights.push(
                "Simplified configuration is " +
                    ((simplifiedSpeed / complexSpeed - 1) * 100).toFixed(1) +
                    "% faster"
            );
        }

        // Memory efficiency
        const simplifiedMemory =
            comparison.metrics.memoryEfficiency.get(
                DeltaCVDTestProfile.SIMPLIFIED_WITH_PASSIVE
            ) ?? 0;
        const complexMemory =
            comparison.metrics.memoryEfficiency.get(
                DeltaCVDTestProfile.CURRENT_COMPLEX
            ) ?? 0;

        if (simplifiedMemory > complexMemory * 1.5) {
            insights.push(
                "Simplified configuration uses " +
                    ((1 - complexMemory / simplifiedMemory) * 100).toFixed(1) +
                    "% less memory"
            );
        }

        // Leader recommendation
        if (comparison.leader !== DeltaCVDTestProfile.CURRENT_COMPLEX) {
            const leaderScore =
                comparison.metrics.overallScore.get(comparison.leader) ?? 0;
            const complexScore =
                comparison.metrics.overallScore.get(
                    DeltaCVDTestProfile.CURRENT_COMPLEX
                ) ?? 0;

            if (leaderScore > complexScore * 1.05) {
                insights.push(
                    `${comparison.leader} outperforms current configuration by ` +
                        ((leaderScore / complexScore - 1) * 100).toFixed(1) +
                        "%"
                );
            }
        }
    }

    /**
     * Update performance-based allocation weights
     */
    private updatePerformanceWeights(): void {
        // TODO: Implement dynamic weight adjustment based on performance
    }

    /**
     * Select profile based on performance weights
     */
    private selectWeightedProfile(): DeltaCVDTestProfile {
        const comparison = this.compareProfiles();
        const scores = comparison.metrics.overallScore;

        // Convert scores to probabilities
        const totalScore = Array.from(scores.values()).reduce(
            (a, b) => a + b,
            0
        );
        const probabilities = new Map<DeltaCVDTestProfile, number>();

        for (const [profile, score] of scores) {
            probabilities.set(profile, score / totalScore);
        }

        // Random selection based on probabilities
        const random = Math.random();
        let cumulative = 0;

        for (const [profile, probability] of probabilities) {
            cumulative += probability;
            if (random <= cumulative) {
                return profile;
            }
        }

        return DeltaCVDTestProfile.SIMPLIFIED_WITH_PASSIVE; // Default
    }

    /**
     * Get current A/B test status
     */
    public getStatus(): {
        profiles: Map<DeltaCVDTestProfile, ProfilePerformance>;
        allocations: Map<string, DeltaCVDTestProfile>;
        comparison: RealtimeComparison | null;
    } {
        return {
            profiles: this.performances,
            allocations: this.currentAllocation,
            comparison: this.compareProfiles(),
        };
    }

    /**
     * Export performance data for analysis
     */
    public exportPerformanceData(): {
        timestamp: string;
        profiles: Record<
            string,
            {
                signalCount: number;
                avgProcessingTime: number;
                avgConfidence: number;
                avgMemoryMB: number;
                errorRate: number;
                sampleSize: number;
            }
        >;
    } {
        const data: {
            timestamp: string;
            profiles: Record<
                string,
                {
                    signalCount: number;
                    avgProcessingTime: number;
                    avgConfidence: number;
                    avgMemoryMB: number;
                    errorRate: number;
                    sampleSize: number;
                }
            >;
        } = {
            timestamp: new Date().toISOString(),
            profiles: {},
        };

        for (const [profile, performance] of this.performances) {
            data.profiles[profile] = {
                signalCount: performance.signalCount,
                avgProcessingTime: this.calculateAverage(
                    performance.processingTimes
                ),
                avgConfidence: this.calculateAverage(performance.confidences),
                avgMemoryMB: this.calculateAverage(performance.memorySnapshots),
                errorRate:
                    performance.errors /
                    (performance.processingTimes.length || 1),
                sampleSize: performance.processingTimes.length,
            };
        }

        return data;
    }

    private calculateAverage(values: number[]): number {
        if (values.length === 0) return 0;
        return values.reduce((a, b) => a + b, 0) / values.length;
    }

    private startMetricsCollection(): void {
        // Set up periodic metrics export
        setInterval(() => {
            const data = this.exportPerformanceData();

            for (const [profile, metrics] of Object.entries(data.profiles)) {
                const m = metrics;

                this.metricsCollector.setGauge(
                    "deltacvd_ab_avg_processing_ms",
                    m.avgProcessingTime,
                    { profile }
                );

                this.metricsCollector.setGauge(
                    "deltacvd_ab_avg_confidence",
                    m.avgConfidence,
                    { profile }
                );

                this.metricsCollector.setGauge(
                    "deltacvd_ab_memory_mb",
                    m.avgMemoryMB,
                    { profile }
                );

                this.metricsCollector.setGauge(
                    "deltacvd_ab_error_rate",
                    m.errorRate,
                    { profile }
                );
            }
        }, 30000); // Every 30 seconds
    }
}
