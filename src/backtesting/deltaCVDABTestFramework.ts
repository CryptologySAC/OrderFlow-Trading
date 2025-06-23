// src/backtesting/deltaCVDABTestFramework.ts

import { EventEmitter } from "events";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import type { DeltaCVDConfirmationSettings } from "../indicators/deltaCVDConfirmation.js";
import { DeltaCVDConfirmation } from "../indicators/deltaCVDConfirmation.js";
import type { EnrichedTradeEvent } from "../types/marketEvents.js";
import type { SignalCandidate } from "../types/signalTypes.js";
import { PerformanceAnalyzer } from "./performanceAnalyzer.js";
import { Config } from "../core/config.js";
import type { ISignalLogger } from "../infrastructure/signalLoggerInterface.js";

/**
 * A/B Test Profile definitions for DeltaCVD passive volume optimization
 */
export enum DeltaCVDTestProfile {
    SIMPLIFIED_NO_PASSIVE = "simplified_no_passive",
    SIMPLIFIED_WITH_PASSIVE = "simplified_with_passive",
    CURRENT_COMPLEX = "current_complex",
}

/**
 * Configuration presets for each test profile
 */
export const TEST_PROFILE_CONFIGS: Record<
    DeltaCVDTestProfile,
    Partial<DeltaCVDConfirmationSettings>
> = {
    [DeltaCVDTestProfile.SIMPLIFIED_NO_PASSIVE]: {
        usePassiveVolume: false,
        enableDepthAnalysis: false,
        detectionMode: "momentum",
        baseConfidenceRequired: 0.3,
        finalConfidenceRequired: 0.5,
    },
    [DeltaCVDTestProfile.SIMPLIFIED_WITH_PASSIVE]: {
        usePassiveVolume: true,
        enableDepthAnalysis: false,
        detectionMode: "momentum",
        baseConfidenceRequired: 0.3,
        finalConfidenceRequired: 0.5,
    },
    [DeltaCVDTestProfile.CURRENT_COMPLEX]: {
        usePassiveVolume: true,
        enableDepthAnalysis: true,
        detectionMode: "hybrid",
        baseConfidenceRequired: 0.4,
        finalConfidenceRequired: 0.6,
    },
};

/**
 * Performance metrics for A/B testing
 */
export interface ABTestMetrics {
    // Signal quality metrics
    totalSignals: number;
    confirmedSignals: number;
    falsePositives: number;
    missedOpportunities: number;
    signalToNoiseRatio: number;
    avgConfidence: number;

    // Performance metrics
    avgProcessingTimeMs: number;
    maxProcessingTimeMs: number;
    memoryUsageMB: number;
    cpuUtilization: number;

    // Market condition analysis
    performanceByVolatility: Map<string, number>;
    performanceByVolume: Map<string, number>;
    performanceByTrend: Map<string, number>;

    // Timing metrics
    avgSignalLeadTimeMs: number;
    avgSignalDurationMs: number;
    signalAccuracy: number;
}

/**
 * A/B test result for a single profile
 */
export interface ABTestResult {
    profile: DeltaCVDTestProfile;
    config: Partial<DeltaCVDConfirmationSettings>;
    metrics: ABTestMetrics;
    startTime: number;
    endTime: number;
    symbol: string;
    marketConditions: MarketConditionSummary;
    errors: string[];
}

/**
 * Market condition summary during test
 */
export interface MarketConditionSummary {
    avgVolatility: number;
    avgVolume: number;
    trendDirection: "up" | "down" | "sideways";
    priceRange: { high: number; low: number };
    totalTrades: number;
}

/**
 * A/B test comparison result
 */
export interface ABTestComparison {
    winner: DeltaCVDTestProfile | null;
    confidenceLevel: number; // Statistical significance
    performanceGain: number; // Percentage improvement
    memoryReduction: number; // Percentage reduction
    processingSpeedGain: number; // Percentage improvement
    recommendations: string[];
    detailedComparison: Map<string, ProfileComparison>;
}

interface ProfileComparison {
    metricName: string;
    profile1Value: number;
    profile2Value: number;
    improvement: number;
    significant: boolean;
}

/**
 * DeltaCVD A/B Testing Framework
 * Provides comprehensive testing and comparison of passive volume configurations
 */
export class DeltaCVDABTestFramework extends EventEmitter {
    private testResults: Map<DeltaCVDTestProfile, ABTestResult[]> = new Map();
    private activeTests: Map<string, DeltaCVDConfirmation> = new Map();
    private performanceAnalyzers: Map<string, PerformanceAnalyzer> = new Map();

    constructor(
        private readonly logger: ILogger,
        private readonly metricsCollector: IMetricsCollector
    ) {
        super();
        this.initializeTestProfiles();
    }

    private initializeTestProfiles(): void {
        for (const profile of Object.values(DeltaCVDTestProfile)) {
            this.testResults.set(profile as DeltaCVDTestProfile, []);
        }
    }

    /**
     * Run A/B test for a specific profile
     */
    public async runTestProfile(
        profile: DeltaCVDTestProfile,
        tradeStream: AsyncIterable<EnrichedTradeEvent>,
        symbol: string
    ): Promise<ABTestResult> {
        const startTime = Date.now();
        const testId = `${profile}_${startTime}`;

        const profileConfig = TEST_PROFILE_CONFIGS[profile];
        const baseConfig = Config.DELTACVD_DETECTOR;
        const config = { ...baseConfig, ...profileConfig };

        const signalLogger: ISignalLogger = {
            logEvent: () => {},
            logProcessedSignal: () => {},
            logProcessingError: () => {},
        };

        const spoofingDetector = {
            checkSpoof: () => ({ isSpoofed: false, confidence: 0 }),
        } as unknown as import("../services/spoofingDetector.js").SpoofingDetector;

        const detector = new DeltaCVDConfirmation(
            testId,
            config as DeltaCVDConfirmationSettings,
            this.logger,
            spoofingDetector,
            this.metricsCollector,
            signalLogger
        );

        this.activeTests.set(testId, detector);

        const analyzer = new PerformanceAnalyzer();
        this.performanceAnalyzers.set(testId, analyzer);

        // Initialize metrics
        const metrics: ABTestMetrics = {
            totalSignals: 0,
            confirmedSignals: 0,
            falsePositives: 0,
            missedOpportunities: 0,
            signalToNoiseRatio: 0,
            avgConfidence: 0,
            avgProcessingTimeMs: 0,
            maxProcessingTimeMs: 0,
            memoryUsageMB: 0,
            cpuUtilization: 0,
            performanceByVolatility: new Map(),
            performanceByVolume: new Map(),
            performanceByTrend: new Map(),
            avgSignalLeadTimeMs: 0,
            avgSignalDurationMs: 0,
            signalAccuracy: 0,
        };

        const processingTimes: number[] = [];
        const confidences: number[] = [];
        const errors: string[] = [];

        // Track market conditions
        const marketConditions: MarketConditionSummary = {
            avgVolatility: 0,
            avgVolume: 0,
            trendDirection: "sideways",
            priceRange: { high: 0, low: Number.MAX_SAFE_INTEGER },
            totalTrades: 0,
        };

        detector.on("signal", (signal: SignalCandidate) => {
            metrics.totalSignals++;
            confidences.push(signal.confidence);
            analyzer.recordSignal({
                timestamp: Date.now(),
                detectorType: signal.type,
                configId: testId,
                side:
                    (signal.side === "neutral" ? "buy" : signal.side) || "buy",
                confidence: signal.confidence,
                price: (signal.data as { price: number }).price || 0,
                data: (signal.data as unknown as Record<string, unknown>) || {},
            });
        });

        // Process trade stream
        try {
            for await (const trade of tradeStream) {
                const startProcess = Date.now();

                try {
                    detector.processMarketEvent(trade);

                    this.updateMarketConditions(trade, marketConditions);
                } catch (error) {
                    const errorMessage =
                        error instanceof Error ? error.message : String(error);
                    errors.push(`Trade processing error: ${errorMessage}`);
                }

                const processingTime = Date.now() - startProcess;
                processingTimes.push(processingTime);
                metrics.maxProcessingTimeMs = Math.max(
                    metrics.maxProcessingTimeMs,
                    processingTime
                );
            }
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            errors.push(`Stream processing error: ${errorMessage}`);
        }

        // Calculate final metrics
        const endTime = Date.now();

        if (processingTimes.length > 0) {
            metrics.avgProcessingTimeMs =
                processingTimes.reduce((a, b) => a + b, 0) /
                processingTimes.length;
        }

        if (confidences.length > 0) {
            metrics.avgConfidence =
                confidences.reduce((a, b) => a + b, 0) / confidences.length;
        }

        // Get memory usage
        const memUsage = process.memoryUsage();
        metrics.memoryUsageMB = memUsage.heapUsed / 1024 / 1024;

        try {
            const analyzerResults = (
                analyzer.getPerformanceSummary as () => {
                    confirmedSignals?: number;
                    accuracy?: number;
                }
            )();
            const confirmedSignals = analyzerResults.confirmedSignals;
            const accuracy = analyzerResults.accuracy;

            metrics.confirmedSignals =
                typeof confirmedSignals === "number" ? confirmedSignals : 0;
            metrics.signalAccuracy =
                typeof accuracy === "number" ? accuracy : 0;
        } catch (error) {
            this.logger.error("Failed to get analyzer results", { error });
            metrics.confirmedSignals = 0;
            metrics.signalAccuracy = 0;
        }
        metrics.signalToNoiseRatio =
            metrics.totalSignals > 0
                ? metrics.confirmedSignals / metrics.totalSignals
                : 0;

        // Create result
        const result: ABTestResult = {
            profile,
            config: profileConfig,
            metrics,
            startTime,
            endTime,
            symbol,
            marketConditions,
            errors,
        };

        // Store result
        this.testResults.get(profile)!.push(result);

        // Cleanup
        this.activeTests.delete(testId);
        this.performanceAnalyzers.delete(testId);

        this.emit("testComplete", result);

        return result;
    }

    /**
     * Run parallel A/B tests for all profiles
     */
    public async runParallelTests(
        tradeStream: EnrichedTradeEvent[],
        symbol: string
    ): Promise<Map<DeltaCVDTestProfile, ABTestResult>> {
        const results = new Map<DeltaCVDTestProfile, ABTestResult>();

        // Run tests in parallel for fair comparison
        const testPromises = Object.values(DeltaCVDTestProfile).map(
            async (profile) => {
                // Create independent trade stream for each test
                const tradeIterator = this.createTradeIterator(tradeStream);
                const result = await this.runTestProfile(
                    profile as DeltaCVDTestProfile,
                    tradeIterator,
                    symbol
                );
                results.set(profile as DeltaCVDTestProfile, result);
            }
        );

        await Promise.all(testPromises);

        return results;
    }

    /**
     * Compare test results and determine winner
     */
    public compareResults(
        results: Map<DeltaCVDTestProfile, ABTestResult>
    ): ABTestComparison {
        const comparisons = new Map<string, ProfileComparison>();
        const recommendations: string[] = [];

        // Get results for comparison
        const simplifiedNoPassive = results.get(
            DeltaCVDTestProfile.SIMPLIFIED_NO_PASSIVE
        );
        const simplifiedWithPassive = results.get(
            DeltaCVDTestProfile.SIMPLIFIED_WITH_PASSIVE
        );
        const currentComplex = results.get(DeltaCVDTestProfile.CURRENT_COMPLEX);

        if (!simplifiedNoPassive || !simplifiedWithPassive || !currentComplex) {
            throw new Error("Missing test results for comparison");
        }

        // Compare key metrics
        const metrics = [
            { name: "signalAccuracy", weight: 0.3 },
            { name: "avgProcessingTimeMs", weight: 0.2, inverse: true },
            { name: "memoryUsageMB", weight: 0.2, inverse: true },
            { name: "signalToNoiseRatio", weight: 0.2 },
            { name: "avgConfidence", weight: 0.1 },
        ];

        let bestProfile: DeltaCVDTestProfile | null = null;
        let bestScore = -Infinity;

        // Calculate weighted scores
        const scores = new Map<DeltaCVDTestProfile, number>();

        for (const [profile, result] of results) {
            let score = 0;

            for (const metric of metrics) {
                const metricsObj = result.metrics as unknown as Record<
                    string,
                    number
                >;
                const value = metricsObj[metric.name] || 0;
                const normalizedValue = metric.inverse
                    ? 1 / (value + 1)
                    : value;
                score += normalizedValue * metric.weight;
            }

            scores.set(profile, score);

            if (score > bestScore) {
                bestScore = score;
                bestProfile = profile;
            }
        }

        // Calculate performance gains
        const complexMetrics = currentComplex.metrics;
        const winnerMetrics = bestProfile
            ? results.get(bestProfile)!.metrics
            : complexMetrics;

        const performanceGain =
            ((winnerMetrics.signalAccuracy - complexMetrics.signalAccuracy) /
                complexMetrics.signalAccuracy) *
            100;

        const memoryReduction =
            ((complexMetrics.memoryUsageMB - winnerMetrics.memoryUsageMB) /
                complexMetrics.memoryUsageMB) *
            100;

        const processingSpeedGain =
            ((complexMetrics.avgProcessingTimeMs -
                winnerMetrics.avgProcessingTimeMs) /
                complexMetrics.avgProcessingTimeMs) *
            100;

        // Generate recommendations
        if (memoryReduction > 50) {
            recommendations.push(
                `Significant memory reduction of ${memoryReduction.toFixed(1)}% achieved`
            );
        }

        if (processingSpeedGain > 40) {
            recommendations.push(
                `Processing speed improved by ${processingSpeedGain.toFixed(1)}%`
            );
        }

        if (
            simplifiedWithPassive.metrics.signalAccuracy >
            simplifiedNoPassive.metrics.signalAccuracy * 1.1
        ) {
            recommendations.push(
                "Passive volume significantly improves signal accuracy"
            );
        }

        // Statistical significance (simplified)
        const confidenceLevel = this.calculateStatisticalSignificance(results);

        return {
            winner: bestProfile,
            confidenceLevel,
            performanceGain,
            memoryReduction,
            processingSpeedGain,
            recommendations,
            detailedComparison: comparisons,
        };
    }

    /**
     * Generate comprehensive A/B test report
     */
    public generateReport(comparison: ABTestComparison): string {
        const report: string[] = [
            "# DeltaCVD A/B Testing Report",
            "",
            "## Executive Summary",
            `- Winner: ${comparison.winner || "No clear winner"}`,
            `- Confidence Level: ${(comparison.confidenceLevel * 100).toFixed(1)}%`,
            `- Performance Gain: ${comparison.performanceGain.toFixed(1)}%`,
            `- Memory Reduction: ${comparison.memoryReduction.toFixed(1)}%`,
            `- Processing Speed Gain: ${comparison.processingSpeedGain.toFixed(1)}%`,
            "",
            "## Recommendations",
        ];

        for (const rec of comparison.recommendations) {
            report.push(`- ${rec}`);
        }

        report.push("", "## Detailed Metrics Comparison", "");

        // Add detailed comparison table
        report.push(
            "| Metric | Simplified (No Passive) | Simplified (With Passive) | Current Complex |"
        );
        report.push(
            "|--------|------------------------|---------------------------|-----------------|"
        );

        for (const profile of Object.values(DeltaCVDTestProfile)) {
            const results = this.testResults.get(
                profile as DeltaCVDTestProfile
            );
            if (results && results.length > 0) {
                // TODO: Add metrics rows to report table
            }
        }

        return report.join("\n");
    }

    private updateMarketConditions(
        trade: EnrichedTradeEvent,
        conditions: MarketConditionSummary
    ): void {
        conditions.totalTrades++;
        conditions.priceRange.high = Math.max(
            conditions.priceRange.high,
            trade.price
        );
        conditions.priceRange.low = Math.min(
            conditions.priceRange.low,
            trade.price
        );
        // Additional market condition tracking...
    }

    public createTradeIterator(
        trades: EnrichedTradeEvent[]
    ): AsyncIterable<EnrichedTradeEvent> {
        return {
            async *[Symbol.asyncIterator]() {
                for (const trade of trades) {
                    await Promise.resolve();
                    yield trade;
                }
            },
        };
    }

    private calculateStatisticalSignificance(
        results: Map<DeltaCVDTestProfile, ABTestResult>
    ): number {
        // Simplified statistical significance calculation
        // In production, use proper statistical tests (t-test, etc.)
        const accuracies = Array.from(results.values()).map(
            (r) => r.metrics.signalAccuracy
        );

        if (accuracies.length === 0) return 0;

        const mean = accuracies.reduce((a, b) => a + b, 0) / accuracies.length;

        // Protect against division by zero when mean is 0
        if (mean === 0 || !Number.isFinite(mean)) return 0;

        const variance =
            accuracies.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
            accuracies.length;
        const stdDev = Math.sqrt(variance);

        // Higher variance = lower confidence - safe division to prevent NaN
        if (!Number.isFinite(stdDev) || stdDev === 0) return 1; // Perfect confidence if no variance

        const relativeDev = stdDev / mean;
        if (!Number.isFinite(relativeDev)) return 0; // Invalid calculation

        return Math.max(0, Math.min(1, 1 - relativeDev));
    }
}
