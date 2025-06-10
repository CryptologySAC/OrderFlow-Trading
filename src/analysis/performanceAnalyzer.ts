// src/analysis/performanceAnalyzer.ts

import { WorkerLogger } from "../multithreading/workerLogger";
import { MetricsCollector } from "../infrastructure/metricsCollector.js";
import type { IPipelineStorage } from "../storage/pipelineStorage.js";
import type {
    SignalOutcome,
    MarketContext,
    FailedSignalAnalysis,
} from "./signalTracker.js";
import type { SignalType } from "../types/signalTypes.js";

export interface PerformanceReport {
    // Summary metrics
    totalSignals: number;
    overallSuccessRate: number;
    avgReturnPerSignal: number;
    sharpeRatio: number;

    // Time window analysis
    timeWindow: number;
    generatedAt: number;

    // Performance by confidence
    confidenceBands: {
        [range: string]: {
            count: number;
            successRate: number;
            avgReturn: number;
            calibrationError: number; // How well confidence predicts success
        };
    };

    // Performance by signal type
    signalTypePerformance: {
        [signalType: string]: {
            count: number;
            successRate: number;
            avgReturn: number;
            bestMarketConditions: string[];
            worstMarketConditions: string[];
            avgConfidence: number;
        };
    };

    // Performance by detector
    detectorPerformance: {
        [detectorId: string]: {
            count: number;
            successRate: number;
            avgReturn: number;
            uniqueValue: number; // How much this detector adds uniquely
            replacementValue: number; // How much performance would drop without it
            avgConfidence: number;
            consistencyScore: number; // How consistent the performance is
        };
    };

    // Temporal patterns
    performanceByTimeOfDay: Map<number, PerformanceStats>;
    performanceByDayOfWeek: Map<number, PerformanceStats>;

    // Recent trends
    recentPerformanceTrend: "improving" | "declining" | "stable";
    performanceChangeRate: number; // Rate of change per hour

    // Risk metrics
    maxDrawdown: number;
    avgDrawdown: number;
    volatilityOfReturns: number;
    winRate: number;
    profitFactor: number; // Total profits / Total losses

    // Efficiency metrics
    avgTimeToSuccess: number;
    avgTimeToFailure: number;
    signalFrequency: number; // Signals per hour
}

export interface DetectorAnalysis {
    detectorId: string;
    totalSignals: number;
    successRate: number;
    avgReturn: number;

    // Performance breakdown
    performanceBySignalType: Map<SignalType, PerformanceStats>;
    performanceByMarketRegime: Map<string, PerformanceStats>;
    performanceByConfidenceLevel: Map<string, PerformanceStats>;

    // Quality metrics
    confidenceCalibration: ConfidenceCalibration;
    consistencyScore: number;
    signalQuality: "excellent" | "good" | "average" | "poor";

    // Comparative analysis
    relativePerformance: number; // vs overall average
    uniqueContribution: number; // Unique value this detector provides
    correlationWithOthers: Map<string, number>;

    // Recommendations
    recommendedConfidenceThreshold: number;
    suggestedImprovements: string[];
    optimalMarketConditions: MarketContext[];
}

export interface FailurePatternAnalysis {
    // Pattern identification
    commonFailureReasons: { [reason: string]: number };
    failuresByMarketCondition: { [condition: string]: number };
    failuresByConfidenceLevel: { [level: string]: number };

    // Temporal patterns
    failuresByTimeOfDay: Map<number, number>;
    failuresByDayOfWeek: Map<number, number>;

    // Predictive patterns
    earlyWarningSignals: Array<{
        signal: string;
        predictionAccuracy: number;
        leadTime: number; // Average time before failure
    }>;

    // Avoidability analysis
    avoidableFailures: {
        count: number;
        percentage: number;
        potentialReturnImprovement: number;
    };

    // Prevention methods
    suggestedFilters: Array<{
        filter: string;
        expectedReduction: number; // % of failures this would prevent
        sideEffects: string; // What good signals might be lost
    }>;
}

export interface ConfidenceCalibration {
    // Overall calibration
    calibrationError: number; // Mean absolute error between confidence and actual success rate
    isWellCalibrated: boolean;

    // Calibration by confidence bands
    calibrationBands: Array<{
        confidenceRange: [number, number];
        expectedSuccessRate: number; // Average confidence in this band
        actualSuccessRate: number;
        count: number;
        calibrationError: number;
    }>;

    // Recommendations
    recommendedCalibrationAdjustment: number;
    overconfidentRanges: number[]; // Confidence ranges where detector is overconfident
    underconfidentRanges: number[]; // Confidence ranges where detector is underconfident
}

export interface MarketConditionAnalysis {
    // Performance by market regime
    performanceByRegime: Map<
        string,
        {
            count: number;
            successRate: number;
            avgReturn: number;
            optimalDetectors: string[];
        }
    >;

    // Performance by volatility
    performanceByVolatility: Map<string, PerformanceStats>;

    // Performance by volume
    performanceByVolume: Map<string, PerformanceStats>;

    // Performance by trend alignment
    performanceByTrendAlignment: Map<string, PerformanceStats>;

    // Optimal conditions
    bestMarketConditions: MarketContext[];
    worstMarketConditions: MarketContext[];

    // Recommendations
    marketTimingRecommendations: Array<{
        condition: string;
        action: "increase_activity" | "decrease_activity" | "avoid";
        expectedImprovement: number;
    }>;
}

export interface ImprovementRecommendations {
    // Priority recommendations
    highPriorityActions: Array<{
        action: string;
        expectedImpact: number; // Expected % improvement in overall performance
        implementationDifficulty: "low" | "medium" | "high";
        timeframe: "immediate" | "short_term" | "long_term";
    }>;

    // Detector-specific recommendations
    detectorRecommendations: Map<string, string[]>;

    // Configuration adjustments
    suggestedConfigChanges: Array<{
        parameter: string;
        currentValue: number;
        suggestedValue: number;
        reasoning: string;
    }>;

    // Market condition adjustments
    marketConditionAdjustments: Array<{
        condition: string;
        adjustment: string;
        expectedBenefit: string;
    }>;
}

export interface PerformanceStats {
    count: number;
    successRate: number;
    avgReturn: number;
    maxReturn: number;
    minReturn: number;
    stdDevReturn: number;
    sharpeRatio: number;
}

export interface PerformanceAnalyzerConfig {
    // Analysis settings
    minSignalsForAnalysis: number; // Minimum signals needed for statistical significance
    confidenceBandSize: number; // Size of confidence bands (default: 0.1 = 10%)
    performanceTrendPeriod: number; // Period for trend analysis (default: 7 days)

    // Calibration settings
    calibrationTolerance: number; // Acceptable calibration error (default: 0.05 = 5%)

    // Caching
    cacheExpirationMs: number; // How long to cache analysis results
}

/**
 * PerformanceAnalyzer provides comprehensive analysis of signal performance,
 * including detector analysis, failure patterns, and improvement recommendations.
 */
export class PerformanceAnalyzer {
    private readonly config: Required<PerformanceAnalyzerConfig>;

    // Analysis cache
    private analysisCache = new Map<
        string,
        {
            result: unknown;
            generatedAt: number;
            expiresAt: number;
        }
    >();

    constructor(
        private readonly logger: WorkerLogger,
        private readonly metricsCollector: MetricsCollector,
        private readonly storage: IPipelineStorage,
        config: Partial<PerformanceAnalyzerConfig> = {}
    ) {
        this.config = {
            minSignalsForAnalysis: config.minSignalsForAnalysis ?? 20,
            confidenceBandSize: config.confidenceBandSize ?? 0.1,
            performanceTrendPeriod: config.performanceTrendPeriod ?? 604800000, // 7 days
            calibrationTolerance: config.calibrationTolerance ?? 0.05,
            cacheExpirationMs: config.cacheExpirationMs ?? 300000, // 5 minutes
        };

        this.logger.info("PerformanceAnalyzer initialized", {
            component: "PerformanceAnalyzer",
            config: this.config,
        });
    }

    /**
     * Analyze overall performance for a time window.
     */
    public async analyzeOverallPerformance(
        timeWindow: number
    ): Promise<PerformanceReport> {
        const cacheKey = `overall_performance_${timeWindow}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) {
            return cached as PerformanceReport;
        }

        try {
            this.logger.debug("Starting overall performance analysis", {
                component: "PerformanceAnalyzer",
                timeWindow,
            });

            // Get signal outcomes from storage
            const signalOutcomes =
                await this.storage.getSignalOutcomes(timeWindow);

            if (signalOutcomes.length < this.config.minSignalsForAnalysis) {
                this.logger.warn("Insufficient signals for reliable analysis", {
                    component: "PerformanceAnalyzer",
                    signalCount: signalOutcomes.length,
                    minRequired: this.config.minSignalsForAnalysis,
                });
                return this.createEmptyPerformanceReport(timeWindow);
            }

            // Filter to completed signals only
            const completedSignals = signalOutcomes.filter(
                (s) => s.outcome && s.outcome !== "pending"
            );

            // Calculate basic metrics
            const totalSignals = completedSignals.length;
            const successfulSignals = completedSignals.filter(
                (s) => s.outcome === "success"
            );
            const overallSuccessRate =
                totalSignals > 0 ? successfulSignals.length / totalSignals : 0;

            // Calculate returns
            const returns = completedSignals
                .filter((s) => s.maxFavorableMove !== undefined)
                .map((s) => s.maxFavorableMove);

            const avgReturnPerSignal =
                returns.length > 0
                    ? returns.reduce((sum, r) => sum + r, 0) / returns.length
                    : 0;

            const sharpeRatio = this.calculateSharpeRatio(returns);

            // Analyze performance by confidence
            const confidenceBands =
                this.analyzeConfidenceBands(completedSignals);

            // Analyze performance by signal type
            const signalTypePerformance =
                this.analyzeSignalTypePerformance(completedSignals);

            // Analyze performance by detector
            const detectorPerformance =
                this.analyzeDetectorPerformanceBySignals(completedSignals);

            // Analyze temporal patterns
            const { performanceByTimeOfDay, performanceByDayOfWeek } =
                this.analyzeTemporalPatterns(completedSignals);

            // Analyze performance trends
            const { recentPerformanceTrend, performanceChangeRate } =
                await this.analyzePerformanceTrends(timeWindow);

            // Calculate risk metrics
            const {
                maxDrawdown,
                avgDrawdown,
                volatilityOfReturns,
                winRate,
                profitFactor,
            } = this.calculateRiskMetrics(returns);

            // Calculate efficiency metrics
            const { avgTimeToSuccess, avgTimeToFailure, signalFrequency } =
                this.calculateEfficiencyMetrics(completedSignals, timeWindow);

            const report: PerformanceReport = {
                totalSignals,
                overallSuccessRate,
                avgReturnPerSignal,
                sharpeRatio,
                timeWindow,
                generatedAt: Date.now(),
                confidenceBands,
                signalTypePerformance,
                detectorPerformance,
                performanceByTimeOfDay,
                performanceByDayOfWeek,
                recentPerformanceTrend,
                performanceChangeRate,
                maxDrawdown,
                avgDrawdown,
                volatilityOfReturns,
                winRate,
                profitFactor,
                avgTimeToSuccess,
                avgTimeToFailure,
                signalFrequency,
            };

            this.cacheResult(cacheKey, report);

            this.logger.info("Overall performance analysis completed", {
                component: "PerformanceAnalyzer",
                totalSignals,
                successRate: overallSuccessRate,
                avgReturn: avgReturnPerSignal,
                sharpeRatio,
            });

            return report;
        } catch (error) {
            this.logger.error("Failed to analyze overall performance", {
                component: "PerformanceAnalyzer",
                timeWindow,
                error: error instanceof Error ? error.message : String(error),
            });
            return this.createEmptyPerformanceReport(timeWindow);
        }
    }

    /**
     * Analyze performance for a specific detector.
     */
    public async analyzeDetectorPerformance(
        detectorId: string
    ): Promise<DetectorAnalysis> {
        const cacheKey = `detector_performance_${detectorId}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) {
            return cached as DetectorAnalysis;
        }

        try {
            // Get signals for this detector from last 30 days
            const timeWindow = 30 * 24 * 60 * 60 * 1000; // 30 days
            const allSignals = await this.storage.getSignalOutcomes(timeWindow);
            const detectorSignals = allSignals.filter(
                (s) => s.detectorId === detectorId && s.outcome !== "pending"
            );

            if (detectorSignals.length < this.config.minSignalsForAnalysis) {
                this.logger.warn("Insufficient signals for detector analysis", {
                    component: "PerformanceAnalyzer",
                    detectorId,
                    signalCount: detectorSignals.length,
                });
                return this.createEmptyDetectorAnalysis(detectorId);
            }

            // Calculate basic metrics
            const totalSignals = detectorSignals.length;
            const successfulSignals = detectorSignals.filter(
                (s) => s.outcome === "success"
            );
            const successRate = successfulSignals.length / totalSignals;
            const avgReturn =
                detectorSignals
                    .filter((s) => s.maxFavorableMove !== undefined)
                    .reduce((sum, s) => sum + s.maxFavorableMove, 0) /
                totalSignals;

            // Performance breakdown by signal type
            const performanceBySignalType = this.groupPerformanceBy(
                detectorSignals,
                (s) => s.signalType
            ) as Map<SignalType, PerformanceStats>;

            // Performance breakdown by market regime
            const performanceByMarketRegime = this.groupPerformanceBy(
                detectorSignals,
                (s) => s.marketContext.regime
            );

            // Performance breakdown by confidence level
            const performanceByConfidenceLevel =
                this.groupPerformanceByConfidenceLevel(detectorSignals);

            // Confidence calibration analysis
            const confidenceCalibration =
                this.calculateConfidenceCalibration(detectorSignals);

            // Calculate consistency score
            const consistencyScore =
                this.calculateConsistencyScore(detectorSignals);

            // Determine signal quality
            const signalQuality = this.classifySignalQuality(
                successRate,
                avgReturn,
                consistencyScore
            );

            // Comparative analysis
            const {
                relativePerformance,
                uniqueContribution,
                correlationWithOthers,
            } = this.analyzeDetectorComparativePerformance(
                detectorId,
                allSignals
            );

            // Generate recommendations
            const {
                recommendedConfidenceThreshold,
                suggestedImprovements,
                optimalMarketConditions,
            } = this.generateDetectorRecommendations(
                detectorId,
                detectorSignals
            );

            const analysis: DetectorAnalysis = {
                detectorId,
                totalSignals,
                successRate,
                avgReturn,
                performanceBySignalType,
                performanceByMarketRegime,
                performanceByConfidenceLevel,
                confidenceCalibration,
                consistencyScore,
                signalQuality,
                relativePerformance,
                uniqueContribution,
                correlationWithOthers,
                recommendedConfidenceThreshold,
                suggestedImprovements,
                optimalMarketConditions,
            };

            this.cacheResult(cacheKey, analysis);
            return analysis;
        } catch (error) {
            this.logger.error("Failed to analyze detector performance", {
                component: "PerformanceAnalyzer",
                detectorId,
                error: error instanceof Error ? error.message : String(error),
            });
            return this.createEmptyDetectorAnalysis(detectorId);
        }
    }

    /**
     * Analyze failure patterns across all signals.
     */
    public async analyzeFailurePatterns(): Promise<FailurePatternAnalysis> {
        const cacheKey = "failure_patterns";
        const cached = this.getFromCache(cacheKey);
        if (cached) {
            return cached as FailurePatternAnalysis;
        }

        try {
            // Get failed signals from last 30 days
            const timeWindow = 30 * 24 * 60 * 60 * 1000; // 30 days
            const failedAnalyses =
                await this.storage.getFailedSignalAnalyses(timeWindow);

            if (failedAnalyses.length === 0) {
                return this.createEmptyFailurePatternAnalysis();
            }

            // Analyze common failure reasons
            const commonFailureReasons: { [reason: string]: number } = {};
            failedAnalyses.forEach((analysis) => {
                commonFailureReasons[analysis.failureReason] =
                    (commonFailureReasons[analysis.failureReason] || 0) + 1;
            });

            // Analyze failures by market condition
            const failuresByMarketCondition: { [condition: string]: number } =
                {};
            failedAnalyses.forEach((analysis) => {
                const regime = analysis.marketContextAtEntry.regime;
                failuresByMarketCondition[regime] =
                    (failuresByMarketCondition[regime] || 0) + 1;
            });

            // Analyze failures by confidence level
            const failuresByConfidenceLevel =
                this.groupFailuresByConfidenceLevel(failedAnalyses);

            // Analyze temporal patterns
            const { failuresByTimeOfDay, failuresByDayOfWeek } =
                this.analyzeFailureTemporalPatterns(failedAnalyses);

            // Identify early warning signals
            const earlyWarningSignals =
                this.identifyEarlyWarningSignals(failedAnalyses);

            // Calculate avoidability metrics
            const avoidableFailures =
                this.calculateAvoidabilityMetrics(failedAnalyses);

            // Generate suggested filters
            const suggestedFilters =
                this.generateSuggestedFilters(failedAnalyses);

            const analysis: FailurePatternAnalysis = {
                commonFailureReasons,
                failuresByMarketCondition,
                failuresByConfidenceLevel,
                failuresByTimeOfDay,
                failuresByDayOfWeek,
                earlyWarningSignals,
                avoidableFailures,
                suggestedFilters,
            };

            this.cacheResult(cacheKey, analysis);
            return analysis;
        } catch (error) {
            this.logger.error("Failed to analyze failure patterns", {
                component: "PerformanceAnalyzer",
                error: error instanceof Error ? error.message : String(error),
            });
            return this.createEmptyFailurePatternAnalysis();
        }
    }

    /**
     * Analyze confidence calibration across all detectors.
     */
    public async analyzeConfidenceCalibration(): Promise<ConfidenceCalibration> {
        const cacheKey = "confidence_calibration";
        const cached = this.getFromCache(cacheKey);
        if (cached) {
            return cached as ConfidenceCalibration;
        }

        try {
            // Get signals from last 30 days
            const timeWindow = 30 * 24 * 60 * 60 * 1000; // 30 days
            const signals = await this.storage.getSignalOutcomes(timeWindow);
            const completedSignals = signals.filter(
                (s) => s.outcome !== "pending"
            );

            if (completedSignals.length < this.config.minSignalsForAnalysis) {
                return this.createEmptyConfidenceCalibration();
            }

            const calibration =
                this.calculateConfidenceCalibration(completedSignals);
            this.cacheResult(cacheKey, calibration);
            return calibration;
        } catch (error) {
            this.logger.error("Failed to analyze confidence calibration", {
                component: "PerformanceAnalyzer",
                error: error instanceof Error ? error.message : String(error),
            });
            return this.createEmptyConfidenceCalibration();
        }
    }

    /**
     * Analyze performance by market conditions.
     */
    public async analyzePerformanceByMarketConditions(): Promise<MarketConditionAnalysis> {
        const cacheKey = "market_condition_analysis";
        const cached = this.getFromCache(cacheKey);
        if (cached) {
            return cached as MarketConditionAnalysis;
        }

        try {
            // Get signals from last 30 days
            const timeWindow = 30 * 24 * 60 * 60 * 1000; // 30 days
            const signals = await this.storage.getSignalOutcomes(timeWindow);
            const completedSignals = signals.filter(
                (s) => s.outcome !== "pending"
            );

            if (completedSignals.length < this.config.minSignalsForAnalysis) {
                return this.createEmptyMarketConditionAnalysis();
            }

            // Analyze performance by market regime
            const performanceByRegime = new Map<
                string,
                {
                    count: number;
                    successRate: number;
                    avgReturn: number;
                    optimalDetectors: string[];
                }
            >();

            const regimeGroups = this.groupBy(
                completedSignals,
                (s) => s.marketContext.regime
            );
            for (const [regime, regimeSignals] of regimeGroups) {
                const successRate =
                    regimeSignals.filter((s) => s.outcome === "success")
                        .length / regimeSignals.length;
                const avgReturn =
                    regimeSignals
                        .filter((s) => s.maxFavorableMove !== undefined)
                        .reduce((sum, s) => sum + s.maxFavorableMove, 0) /
                    regimeSignals.length;

                // Find optimal detectors for this regime
                const detectorPerf = this.groupBy(
                    regimeSignals,
                    (s) => s.detectorId
                );
                const optimalDetectors = Array.from(detectorPerf.entries())
                    .map(([detector, signals]) => ({
                        detector,
                        successRate:
                            signals.filter((s) => s.outcome === "success")
                                .length / signals.length,
                    }))
                    .filter((d) => d.successRate > successRate + 0.1) // 10% better than average
                    .sort((a, b) => b.successRate - a.successRate)
                    .slice(0, 3)
                    .map((d) => d.detector);

                performanceByRegime.set(regime, {
                    count: regimeSignals.length,
                    successRate,
                    avgReturn,
                    optimalDetectors,
                });
            }

            // Similar analysis for volatility, volume, and trend alignment
            const performanceByVolatility =
                this.analyzePerformanceByVolatility(completedSignals);
            const performanceByVolume =
                this.analyzePerformanceByVolume(completedSignals);
            const performanceByTrendAlignment =
                this.analyzePerformanceByTrendAlignment(completedSignals);

            // Identify best and worst market conditions
            const { bestMarketConditions, worstMarketConditions } =
                this.identifyOptimalMarketConditions(completedSignals);

            // Generate recommendations
            const marketTimingRecommendations =
                this.generateMarketTimingRecommendations(
                    performanceByRegime,
                    performanceByVolatility
                );

            const analysis: MarketConditionAnalysis = {
                performanceByRegime,
                performanceByVolatility,
                performanceByVolume,
                performanceByTrendAlignment,
                bestMarketConditions,
                worstMarketConditions,
                marketTimingRecommendations,
            };

            this.cacheResult(cacheKey, analysis);
            return analysis;
        } catch (error) {
            this.logger.error(
                "Failed to analyze performance by market conditions",
                {
                    component: "PerformanceAnalyzer",
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
            return this.createEmptyMarketConditionAnalysis();
        }
    }

    /**
     * Generate improvement recommendations.
     */
    public async generateRecommendations(): Promise<ImprovementRecommendations> {
        const cacheKey = "improvement_recommendations";
        const cached = this.getFromCache(cacheKey);
        if (cached) {
            return cached as ImprovementRecommendations;
        }

        try {
            // Get comprehensive analysis
            const overallPerformance = await this.analyzeOverallPerformance(
                30 * 24 * 60 * 60 * 1000
            ); // 30 days
            const failurePatterns = await this.analyzeFailurePatterns();
            const marketConditionAnalysis =
                await this.analyzePerformanceByMarketConditions();

            // Generate high priority actions
            const highPriorityActions = this.generateHighPriorityActions(
                overallPerformance,
                failurePatterns,
                marketConditionAnalysis
            );

            // Generate detector-specific recommendations
            const detectorRecommendations = new Map<string, string[]>();
            for (const [detectorId] of Object.entries(
                overallPerformance.detectorPerformance
            )) {
                const analysis =
                    await this.analyzeDetectorPerformance(detectorId);
                detectorRecommendations.set(
                    detectorId,
                    analysis.suggestedImprovements
                );
            }

            // Suggest configuration changes
            const suggestedConfigChanges =
                this.generateConfigurationRecommendations(overallPerformance);

            // Market condition adjustments
            const marketConditionAdjustments =
                this.generateMarketConditionAdjustments(
                    marketConditionAnalysis
                );

            const recommendations: ImprovementRecommendations = {
                highPriorityActions,
                detectorRecommendations,
                suggestedConfigChanges,
                marketConditionAdjustments,
            };

            this.cacheResult(cacheKey, recommendations);
            return recommendations;
        } catch (error) {
            this.logger.error(
                "Failed to generate improvement recommendations",
                {
                    component: "PerformanceAnalyzer",
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
            return {
                highPriorityActions: [],
                detectorRecommendations: new Map(),
                suggestedConfigChanges: [],
                marketConditionAdjustments: [],
            };
        }
    }

    // Private helper methods

    private analyzeConfidenceBands(
        signals: SignalOutcome[]
    ): PerformanceReport["confidenceBands"] {
        const bands: PerformanceReport["confidenceBands"] = {};
        const bandSize = this.config.confidenceBandSize;

        for (let start = 0; start < 1; start += bandSize) {
            const end = Math.min(start + bandSize, 1);
            const bandKey = `${(start * 100).toFixed(0)}-${(end * 100).toFixed(0)}%`;

            const bandSignals = signals.filter(
                (s) =>
                    s.originalConfidence >= start && s.originalConfidence < end
            );

            if (bandSignals.length === 0) continue;

            const successCount = bandSignals.filter(
                (s) => s.outcome === "success"
            ).length;
            const successRate = successCount / bandSignals.length;
            const avgReturn =
                bandSignals
                    .filter((s) => s.maxFavorableMove !== undefined)
                    .reduce((sum, s) => sum + s.maxFavorableMove, 0) /
                bandSignals.length;

            const avgConfidence =
                bandSignals.reduce((sum, s) => sum + s.originalConfidence, 0) /
                bandSignals.length;
            const calibrationError = Math.abs(avgConfidence - successRate);

            bands[bandKey] = {
                count: bandSignals.length,
                successRate,
                avgReturn,
                calibrationError,
            };
        }

        return bands;
    }

    private analyzeSignalTypePerformance(
        signals: SignalOutcome[]
    ): PerformanceReport["signalTypePerformance"] {
        const performance: PerformanceReport["signalTypePerformance"] = {};

        const typeGroups = this.groupBy(signals, (s) => s.signalType);

        for (const [signalType, typeSignals] of typeGroups) {
            const successCount = typeSignals.filter(
                (s) => s.outcome === "success"
            ).length;
            const successRate = successCount / typeSignals.length;
            const avgReturn =
                typeSignals
                    .filter((s) => s.maxFavorableMove !== undefined)
                    .reduce((sum, s) => sum + s.maxFavorableMove, 0) /
                typeSignals.length;
            const avgConfidence =
                typeSignals.reduce((sum, s) => sum + s.originalConfidence, 0) /
                typeSignals.length;

            // Find best and worst market conditions for this signal type
            const regimeGroups = this.groupBy(
                typeSignals,
                (s) => s.marketContext.regime
            );
            const regimePerformance = Array.from(regimeGroups.entries())
                .map(([regime, regimeSignals]) => ({
                    regime,
                    successRate:
                        regimeSignals.filter((s) => s.outcome === "success")
                            .length / regimeSignals.length,
                    count: regimeSignals.length,
                }))
                .filter((r) => r.count >= 3) // Only consider regimes with at least 3 signals
                .sort((a, b) => b.successRate - a.successRate);

            const bestMarketConditions = regimePerformance
                .slice(0, 2)
                .map((r) => r.regime);
            const worstMarketConditions = regimePerformance
                .slice(-2)
                .map((r) => r.regime);

            performance[signalType] = {
                count: typeSignals.length,
                successRate,
                avgReturn,
                bestMarketConditions,
                worstMarketConditions,
                avgConfidence,
            };
        }

        return performance;
    }

    private analyzeDetectorPerformanceBySignals(
        signals: SignalOutcome[]
    ): PerformanceReport["detectorPerformance"] {
        const performance: PerformanceReport["detectorPerformance"] = {};

        const detectorGroups = this.groupBy(signals, (s) => s.detectorId);
        // const overallSuccessRate =
        //     signals.filter((s) => s.outcome === "success").length /
        //     signals.length;

        for (const [detectorId, detectorSignals] of detectorGroups) {
            const successCount = detectorSignals.filter(
                (s) => s.outcome === "success"
            ).length;
            const successRate = successCount / detectorSignals.length;
            const avgReturn =
                detectorSignals
                    .filter((s) => s.maxFavorableMove !== undefined)
                    .reduce((sum, s) => sum + s.maxFavorableMove, 0) /
                detectorSignals.length;
            const avgConfidence =
                detectorSignals.reduce(
                    (sum, s) => sum + s.originalConfidence,
                    0
                ) / detectorSignals.length;

            // Calculate unique value (how much this detector adds beyond others)
            const uniqueValue = this.calculateDetectorUniqueValue(
                detectorId,
                signals
            );

            // Calculate replacement value (performance drop if removed)
            const replacementValue = this.calculateDetectorReplacementValue(
                detectorId,
                signals
            );

            // Calculate consistency score
            const consistencyScore =
                this.calculateConsistencyScore(detectorSignals);

            performance[detectorId] = {
                count: detectorSignals.length,
                successRate,
                avgReturn,
                uniqueValue,
                replacementValue,
                avgConfidence,
                consistencyScore,
            };
        }

        return performance;
    }

    private analyzeTemporalPatterns(signals: SignalOutcome[]): {
        performanceByTimeOfDay: Map<number, PerformanceStats>;
        performanceByDayOfWeek: Map<number, PerformanceStats>;
    } {
        const performanceByTimeOfDay = new Map<number, PerformanceStats>();
        const performanceByDayOfWeek = new Map<number, PerformanceStats>();

        // Group by hour of day
        for (let hour = 0; hour < 24; hour++) {
            const hourSignals = signals.filter((s) => {
                const signalHour = new Date(s.entryTime).getHours();
                return signalHour === hour;
            });

            if (hourSignals.length >= 3) {
                performanceByTimeOfDay.set(
                    hour,
                    this.calculatePerformanceStats(hourSignals)
                );
            }
        }

        // Group by day of week
        for (let day = 0; day < 7; day++) {
            const daySignals = signals.filter((s) => {
                const signalDay = new Date(s.entryTime).getDay();
                return signalDay === day;
            });

            if (daySignals.length >= 3) {
                performanceByDayOfWeek.set(
                    day,
                    this.calculatePerformanceStats(daySignals)
                );
            }
        }

        return { performanceByTimeOfDay, performanceByDayOfWeek };
    }

    private async analyzePerformanceTrends(timeWindow: number): Promise<{
        recentPerformanceTrend: "improving" | "declining" | "stable";
        performanceChangeRate: number;
    }> {
        try {
            const trendPeriod = Math.min(
                timeWindow,
                this.config.performanceTrendPeriod
            );
            const halfPeriod = trendPeriod / 2;

            // Get signals from first half and second half of period
            const firstHalfSignals = await this.storage.getSignalOutcomes(
                trendPeriod,
                Date.now() - halfPeriod
            );
            const secondHalfSignals =
                await this.storage.getSignalOutcomes(halfPeriod);

            const firstHalfPerf =
                this.calculateBasicPerformance(firstHalfSignals);
            const secondHalfPerf =
                this.calculateBasicPerformance(secondHalfSignals);

            const performanceChange =
                secondHalfPerf.successRate - firstHalfPerf.successRate;
            const changeThreshold = 0.05; // 5% change threshold

            let trend: "improving" | "declining" | "stable";
            if (performanceChange > changeThreshold) {
                trend = "improving";
            } else if (performanceChange < -changeThreshold) {
                trend = "declining";
            } else {
                trend = "stable";
            }

            // Calculate rate of change per hour
            const hoursInPeriod = halfPeriod / (1000 * 60 * 60);
            const performanceChangeRate =
                hoursInPeriod > 0 ? performanceChange / hoursInPeriod : 0;

            return { recentPerformanceTrend: trend, performanceChangeRate };
        } catch (error) {
            this.logger.error("Failed to analyze performance trends", {
                component: "PerformanceAnalyzer",
                error: error instanceof Error ? error.message : String(error),
            });
            return {
                recentPerformanceTrend: "stable",
                performanceChangeRate: 0,
            };
        }
    }

    private calculateSharpeRatio(returns: number[]): number {
        if (returns.length < 2) return 0;

        const avgReturn =
            returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const stdDev = Math.sqrt(
            returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
                returns.length
        );

        return stdDev > 0 ? avgReturn / stdDev : 0;
    }

    private calculateRiskMetrics(returns: number[]): {
        maxDrawdown: number;
        avgDrawdown: number;
        volatilityOfReturns: number;
        winRate: number;
        profitFactor: number;
    } {
        if (returns.length === 0) {
            return {
                maxDrawdown: 0,
                avgDrawdown: 0,
                volatilityOfReturns: 0,
                winRate: 0,
                profitFactor: 0,
            };
        }

        const negativeReturns = returns.filter((r) => r < 0);
        const positiveReturns = returns.filter((r) => r > 0);

        const maxDrawdown =
            negativeReturns.length > 0 ? Math.min(...negativeReturns) : 0;
        const avgDrawdown =
            negativeReturns.length > 0
                ? negativeReturns.reduce((sum, r) => sum + r, 0) /
                  negativeReturns.length
                : 0;

        const avgReturn =
            returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const volatilityOfReturns = Math.sqrt(
            returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
                returns.length
        );

        const winRate = positiveReturns.length / returns.length;

        const totalProfits = positiveReturns.reduce((sum, r) => sum + r, 0);
        const totalLosses = Math.abs(
            negativeReturns.reduce((sum, r) => sum + r, 0)
        );
        const profitFactor =
            totalLosses > 0
                ? totalProfits / totalLosses
                : totalProfits > 0
                  ? Infinity
                  : 0;

        return {
            maxDrawdown,
            avgDrawdown,
            volatilityOfReturns,
            winRate,
            profitFactor,
        };
    }

    private calculateEfficiencyMetrics(
        signals: SignalOutcome[],
        timeWindow: number
    ): {
        avgTimeToSuccess: number;
        avgTimeToFailure: number;
        signalFrequency: number;
    } {
        const successfulSignals = signals.filter(
            (s) => s.outcome === "success" && s.timeToMaxFavorable
        );
        const failedSignals = signals.filter(
            (s) => s.outcome === "failure" && s.timeToMaxAdverse
        );

        const avgTimeToSuccess =
            successfulSignals.length > 0
                ? successfulSignals.reduce(
                      (sum, s) => sum + (s.timeToMaxFavorable || 0),
                      0
                  ) / successfulSignals.length
                : 0;

        const avgTimeToFailure =
            failedSignals.length > 0
                ? failedSignals.reduce(
                      (sum, s) => sum + (s.timeToMaxAdverse || 0),
                      0
                  ) / failedSignals.length
                : 0;

        const signalFrequency = (signals.length * 3600000) / timeWindow; // Signals per hour

        return { avgTimeToSuccess, avgTimeToFailure, signalFrequency };
    }

    // Additional helper methods for analysis...

    private groupBy<T, K>(array: T[], keyFn: (item: T) => K): Map<K, T[]> {
        const groups = new Map<K, T[]>();
        for (const item of array) {
            const key = keyFn(item);
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key)!.push(item);
        }
        return groups;
    }

    private calculatePerformanceStats(
        signals: SignalOutcome[]
    ): PerformanceStats {
        const successfulSignals = signals.filter(
            (s) => s.outcome === "success"
        );
        const returns = signals
            .filter((s) => s.maxFavorableMove !== undefined)
            .map((s) => s.maxFavorableMove);

        if (returns.length === 0) {
            return {
                count: signals.length,
                successRate: 0,
                avgReturn: 0,
                maxReturn: 0,
                minReturn: 0,
                stdDevReturn: 0,
                sharpeRatio: 0,
            };
        }

        const avgReturn =
            returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const stdDevReturn = Math.sqrt(
            returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
                returns.length
        );

        return {
            count: signals.length,
            successRate: successfulSignals.length / signals.length,
            avgReturn,
            maxReturn: Math.max(...returns),
            minReturn: Math.min(...returns),
            stdDevReturn,
            sharpeRatio: stdDevReturn > 0 ? avgReturn / stdDevReturn : 0,
        };
    }

    // Cache management methods

    private getFromCache(key: string): unknown {
        const cached = this.analysisCache.get(key);
        if (!cached || Date.now() > cached.expiresAt) {
            this.analysisCache.delete(key);
            return null;
        }
        return cached.result;
    }

    private cacheResult(key: string, result: unknown): void {
        this.analysisCache.set(key, {
            result,
            generatedAt: Date.now(),
            expiresAt: Date.now() + this.config.cacheExpirationMs,
        });
    }

    // Empty result creators for error cases

    private createEmptyPerformanceReport(
        timeWindow: number
    ): PerformanceReport {
        return {
            totalSignals: 0,
            overallSuccessRate: 0,
            avgReturnPerSignal: 0,
            sharpeRatio: 0,
            timeWindow,
            generatedAt: Date.now(),
            confidenceBands: {},
            signalTypePerformance: {},
            detectorPerformance: {},
            performanceByTimeOfDay: new Map(),
            performanceByDayOfWeek: new Map(),
            recentPerformanceTrend: "stable",
            performanceChangeRate: 0,
            maxDrawdown: 0,
            avgDrawdown: 0,
            volatilityOfReturns: 0,
            winRate: 0,
            profitFactor: 0,
            avgTimeToSuccess: 0,
            avgTimeToFailure: 0,
            signalFrequency: 0,
        };
    }

    // Additional placeholder methods that would need full implementation...
    // (These are simplified versions for the interface)

    private createEmptyDetectorAnalysis(detectorId: string): DetectorAnalysis {
        return {
            detectorId,
            totalSignals: 0,
            successRate: 0,
            avgReturn: 0,
            performanceBySignalType: new Map(),
            performanceByMarketRegime: new Map(),
            performanceByConfidenceLevel: new Map(),
            confidenceCalibration: this.createEmptyConfidenceCalibration(),
            consistencyScore: 0,
            signalQuality: "poor",
            relativePerformance: 0,
            uniqueContribution: 0,
            correlationWithOthers: new Map(),
            recommendedConfidenceThreshold: 0.7,
            suggestedImprovements: [],
            optimalMarketConditions: [],
        };
    }

    private createEmptyConfidenceCalibration(): ConfidenceCalibration {
        return {
            calibrationError: 0,
            isWellCalibrated: true,
            calibrationBands: [],
            recommendedCalibrationAdjustment: 0,
            overconfidentRanges: [],
            underconfidentRanges: [],
        };
    }

    private createEmptyFailurePatternAnalysis(): FailurePatternAnalysis {
        return {
            commonFailureReasons: {},
            failuresByMarketCondition: {},
            failuresByConfidenceLevel: {},
            failuresByTimeOfDay: new Map(),
            failuresByDayOfWeek: new Map(),
            earlyWarningSignals: [],
            avoidableFailures: {
                count: 0,
                percentage: 0,
                potentialReturnImprovement: 0,
            },
            suggestedFilters: [],
        };
    }

    private createEmptyMarketConditionAnalysis(): MarketConditionAnalysis {
        return {
            performanceByRegime: new Map(),
            performanceByVolatility: new Map(),
            performanceByVolume: new Map(),
            performanceByTrendAlignment: new Map(),
            bestMarketConditions: [],
            worstMarketConditions: [],
            marketTimingRecommendations: [],
        };
    }

    // Simplified implementations of complex analysis methods
    // In a full implementation, these would contain much more sophisticated logic

    private calculateConfidenceCalibration(
        signals: SignalOutcome[]
    ): ConfidenceCalibration {
        // Simplified confidence calibration analysis
        const bandSize = 0.1; // 10% bands
        const calibrationBands: ConfidenceCalibration["calibrationBands"] = [];
        let totalCalibrationError = 0;

        for (let start = 0; start < 1; start += bandSize) {
            const end = Math.min(start + bandSize, 1);
            const bandSignals = signals.filter(
                (s) =>
                    s.originalConfidence >= start && s.originalConfidence < end
            );

            if (bandSignals.length < 3) continue; // Need minimum signals for reliability

            const avgConfidence =
                bandSignals.reduce((sum, s) => sum + s.originalConfidence, 0) /
                bandSignals.length;
            const successCount = bandSignals.filter(
                (s) => s.outcome === "success"
            ).length;
            const actualSuccessRate = successCount / bandSignals.length;
            const calibrationError = Math.abs(
                avgConfidence - actualSuccessRate
            );

            calibrationBands.push({
                confidenceRange: [start, end],
                expectedSuccessRate: avgConfidence,
                actualSuccessRate,
                count: bandSignals.length,
                calibrationError,
            });

            totalCalibrationError += calibrationError;
        }

        const avgCalibrationError =
            calibrationBands.length > 0
                ? totalCalibrationError / calibrationBands.length
                : 0;

        const isWellCalibrated =
            avgCalibrationError <= this.config.calibrationTolerance;

        // Identify over/under confident ranges
        const overconfidentRanges = calibrationBands
            .filter(
                (band) =>
                    band.expectedSuccessRate - band.actualSuccessRate > 0.1
            )
            .map((band) => band.confidenceRange[0]);

        const underconfidentRanges = calibrationBands
            .filter(
                (band) =>
                    band.actualSuccessRate - band.expectedSuccessRate > 0.1
            )
            .map((band) => band.confidenceRange[0]);

        return {
            calibrationError: avgCalibrationError,
            isWellCalibrated,
            calibrationBands,
            recommendedCalibrationAdjustment: isWellCalibrated
                ? 0
                : -avgCalibrationError,
            overconfidentRanges,
            underconfidentRanges,
        };
    }

    private calculateConsistencyScore(signals: SignalOutcome[]): number {
        // Calculate how consistent the detector's performance is over time
        if (signals.length < 10) return 0.5; // Default for insufficient data

        // Group signals by time periods and calculate variance in success rate
        const periodSize = Math.ceil(signals.length / 5); // 5 periods
        const periods: SignalOutcome[][] = [];

        for (let i = 0; i < signals.length; i += periodSize) {
            periods.push(signals.slice(i, i + periodSize));
        }

        const successRates = periods.map((period) => {
            const successCount = period.filter(
                (s) => s.outcome === "success"
            ).length;
            return successCount / period.length;
        });

        const avgSuccessRate =
            successRates.reduce((sum, sr) => sum + sr, 0) / successRates.length;
        const variance =
            successRates.reduce(
                (sum, sr) => sum + Math.pow(sr - avgSuccessRate, 2),
                0
            ) / successRates.length;
        const stdDev = Math.sqrt(variance);

        // Consistency score: lower variance = higher consistency
        // Normalize to 0-1 scale
        return Math.max(0, 1 - stdDev * 2); // Multiply by 2 to make it more sensitive
    }

    private classifySignalQuality(
        successRate: number,
        avgReturn: number,
        consistencyScore: number
    ): DetectorAnalysis["signalQuality"] {
        const overallScore =
            successRate * 0.4 +
            Math.max(0, avgReturn) * 0.3 +
            consistencyScore * 0.3;

        if (overallScore >= 0.8) return "excellent";
        if (overallScore >= 0.6) return "good";
        if (overallScore >= 0.4) return "average";
        return "poor";
    }

    private calculateDetectorUniqueValue(
        detectorId: string,
        allSignals: SignalOutcome[]
    ): number {
        // Simplified calculation of detector's unique contribution
        // In practice, this would involve more sophisticated analysis
        const detectorSignals = allSignals.filter(
            (s) => s.detectorId === detectorId
        );
        const otherSignals = allSignals.filter(
            (s) => s.detectorId !== detectorId
        );

        const detectorSuccessRate =
            detectorSignals.filter((s) => s.outcome === "success").length /
            detectorSignals.length;
        const othersSuccessRate =
            otherSignals.filter((s) => s.outcome === "success").length /
            otherSignals.length;

        return Math.max(0, detectorSuccessRate - othersSuccessRate);
    }

    private calculateDetectorReplacementValue(
        detectorId: string,
        allSignals: SignalOutcome[]
    ): number {
        // Simplified calculation of performance impact if detector was removed
        const detectorSignals = allSignals.filter(
            (s) => s.detectorId === detectorId
        );
        const detectorContribution = detectorSignals.filter(
            (s) => s.outcome === "success"
        ).length;

        return detectorContribution / allSignals.length;
    }

    // Placeholder implementations for complex methods
    private groupPerformanceBy<K>(
        signals: SignalOutcome[],
        keyFn: (s: SignalOutcome) => K
    ): Map<K, PerformanceStats> {
        const groups = this.groupBy(signals, keyFn);
        const result = new Map<K, PerformanceStats>();

        for (const [key, groupSignals] of groups) {
            result.set(key, this.calculatePerformanceStats(groupSignals));
        }

        return result;
    }

    private groupPerformanceByConfidenceLevel(
        signals: SignalOutcome[]
    ): Map<string, PerformanceStats> {
        const result = new Map<string, PerformanceStats>();
        const bandSize = 0.2; // 20% bands

        for (let start = 0; start < 1; start += bandSize) {
            const end = Math.min(start + bandSize, 1);
            const bandKey = `${(start * 100).toFixed(0)}-${(end * 100).toFixed(0)}%`;

            const bandSignals = signals.filter(
                (s) =>
                    s.originalConfidence >= start && s.originalConfidence < end
            );

            if (bandSignals.length >= 3) {
                result.set(
                    bandKey,
                    this.calculatePerformanceStats(bandSignals)
                );
            }
        }

        return result;
    }

    private calculateBasicPerformance(signals: SignalOutcome[]): {
        successRate: number;
        avgReturn: number;
    } {
        if (signals.length === 0) return { successRate: 0, avgReturn: 0 };

        const completedSignals = signals.filter((s) => s.outcome !== "pending");
        const successCount = completedSignals.filter(
            (s) => s.outcome === "success"
        ).length;
        const successRate =
            completedSignals.length > 0
                ? successCount / completedSignals.length
                : 0;

        const returns = completedSignals
            .filter((s) => s.maxFavorableMove !== undefined)
            .map((s) => s.maxFavorableMove);
        const avgReturn =
            returns.length > 0
                ? returns.reduce((sum, r) => sum + r, 0) / returns.length
                : 0;

        return { successRate, avgReturn };
    }

    // Additional placeholder methods would be implemented here...
    // For brevity, I'm including basic implementations

    private analyzeDetectorComparativePerformance(
        detectorId: string,
        allSignals: SignalOutcome[]
    ): {
        relativePerformance: number;
        uniqueContribution: number;
        correlationWithOthers: Map<string, number>;
    } {
        const detectorSignals = allSignals.filter(
            (s) => s.detectorId === detectorId
        );
        const otherSignals = allSignals.filter(
            (s) => s.detectorId !== detectorId
        );

        const detectorPerf = this.calculateBasicPerformance(detectorSignals);
        const othersPerf = this.calculateBasicPerformance(otherSignals);

        const relativePerformance =
            detectorPerf.successRate - othersPerf.successRate;
        const uniqueContribution = this.calculateDetectorUniqueValue(
            detectorId,
            allSignals
        );
        const correlationWithOthers = new Map<string, number>(); // Simplified

        return {
            relativePerformance,
            uniqueContribution,
            correlationWithOthers,
        };
    }

    private generateDetectorRecommendations(
        detectorId: string,
        signals: SignalOutcome[]
    ): {
        recommendedConfidenceThreshold: number;
        suggestedImprovements: string[];
        optimalMarketConditions: MarketContext[];
    } {
        const performance = this.calculateBasicPerformance(signals);

        // Find optimal confidence threshold
        let bestThreshold = 0.7;
        let bestPerformance = 0;

        for (let threshold = 0.5; threshold <= 0.95; threshold += 0.05) {
            const filteredSignals = signals.filter(
                (s) => s.originalConfidence >= threshold
            );
            if (filteredSignals.length < 5) continue;

            const perf = this.calculateBasicPerformance(filteredSignals);
            const score =
                perf.successRate *
                perf.avgReturn *
                Math.sqrt(filteredSignals.length);

            if (score > bestPerformance) {
                bestPerformance = score;
                bestThreshold = threshold;
            }
        }

        // Generate improvement suggestions
        const suggestedImprovements: string[] = [];
        if (performance.successRate < 0.6) {
            suggestedImprovements.push(
                "Increase confidence threshold to improve signal quality"
            );
        }
        if (performance.avgReturn < 0.001) {
            suggestedImprovements.push(
                "Review signal timing and exit criteria"
            );
        }

        // Find optimal market conditions (simplified)
        const regimeGroups = this.groupBy(
            signals,
            (s) => s.marketContext.regime
        );
        const bestRegimes = Array.from(regimeGroups.entries())
            .map(([regime, regimeSignals]) => ({
                regime,
                performance: this.calculateBasicPerformance(regimeSignals),
            }))
            .filter(
                (r) => r.performance.successRate > performance.successRate + 0.1
            )
            .slice(0, 3);

        const optimalMarketConditions =
            bestRegimes.length > 0
                ? bestRegimes.map(
                      (r) => regimeGroups.get(r.regime)![0].marketContext
                  )
                : [];

        return {
            recommendedConfidenceThreshold: bestThreshold,
            suggestedImprovements,
            optimalMarketConditions,
        };
    }

    // More placeholder implementations...
    private groupFailuresByConfidenceLevel(_failures: FailedSignalAnalysis[]): {
        [level: string]: number;
    } {
        // Placeholder implementation - would analyze failures by confidence level
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _ = _failures;
        const result: { [level: string]: number } = {};
        const bandSize = 0.2;

        for (let start = 0; start < 1; start += bandSize) {
            const end = Math.min(start + bandSize, 1);
            const bandKey = `${(start * 100).toFixed(0)}-${(end * 100).toFixed(0)}%`;

            // This would use signal confidence data if available in failure analysis
            result[bandKey] = 0; // Placeholder
        }

        return result;
    }

    private analyzeFailureTemporalPatterns(_failures: FailedSignalAnalysis[]): {
        failuresByTimeOfDay: Map<number, number>;
        failuresByDayOfWeek: Map<number, number>;
    } {
        // Placeholder implementation - would analyze failure temporal patterns
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _ = _failures;
        const failuresByTimeOfDay = new Map<number, number>();
        const failuresByDayOfWeek = new Map<number, number>();

        // Placeholder implementation
        return { failuresByTimeOfDay, failuresByDayOfWeek };
    }

    private identifyEarlyWarningSignals(
        _failures: FailedSignalAnalysis[]
    ): FailurePatternAnalysis["earlyWarningSignals"] {
        // Placeholder - would analyze patterns in warning signals
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _ = _failures;
        return [];
    }

    private calculateAvoidabilityMetrics(
        failures: FailedSignalAnalysis[]
    ): FailurePatternAnalysis["avoidableFailures"] {
        const avoidableCount = failures.filter(
            (f) => f.avoidability.score > 0.7
        ).length;
        const percentage =
            failures.length > 0 ? avoidableCount / failures.length : 0;

        return {
            count: avoidableCount,
            percentage,
            potentialReturnImprovement: percentage * 0.1, // Simplified estimate
        };
    }

    private generateSuggestedFilters(
        _failures: FailedSignalAnalysis[]
    ): FailurePatternAnalysis["suggestedFilters"] {
        // Placeholder - would analyze failure patterns to suggest filters
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _ = _failures;
        return [];
    }

    private analyzePerformanceByVolatility(
        signals: SignalOutcome[]
    ): Map<string, PerformanceStats> {
        // Group by volatility levels
        return this.groupPerformanceBy(signals, (s) => {
            const vol = s.marketContext.normalizedVolatility;
            if (vol < 0.5) return "low";
            if (vol < 1.5) return "medium";
            if (vol < 3.0) return "high";
            return "extreme";
        });
    }

    private analyzePerformanceByVolume(
        signals: SignalOutcome[]
    ): Map<string, PerformanceStats> {
        // Group by volume levels
        return this.groupPerformanceBy(signals, (s) => {
            const vol = s.marketContext.volumeRatio;
            if (vol < 0.7) return "low";
            if (vol < 1.3) return "normal";
            if (vol < 2.0) return "high";
            return "very_high";
        });
    }

    private analyzePerformanceByTrendAlignment(
        signals: SignalOutcome[]
    ): Map<string, PerformanceStats> {
        // Group by trend alignment
        return this.groupPerformanceBy(signals, (s) => {
            const alignment = s.marketContext.trendAlignment;
            if (alignment < 0.3) return "conflicting";
            if (alignment < 0.7) return "mixed";
            return "aligned";
        });
    }

    private identifyOptimalMarketConditions(signals: SignalOutcome[]): {
        bestMarketConditions: MarketContext[];
        worstMarketConditions: MarketContext[];
    } {
        // Simplified implementation
        const successfulSignals = signals.filter(
            (s) => s.outcome === "success"
        );
        const failedSignals = signals.filter((s) => s.outcome === "failure");

        const bestMarketConditions = successfulSignals
            .slice(0, 5)
            .map((s) => s.marketContext);
        const worstMarketConditions = failedSignals
            .slice(0, 5)
            .map((s) => s.marketContext);

        return { bestMarketConditions, worstMarketConditions };
    }

    private generateMarketTimingRecommendations(
        regimePerformance: Map<string, { successRate: number }>,
        _volatilityPerformance: Map<string, PerformanceStats>
    ): MarketConditionAnalysis["marketTimingRecommendations"] {
        // Simplified implementation
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _ = _volatilityPerformance;
        const recommendations: MarketConditionAnalysis["marketTimingRecommendations"] =
            [];

        for (const [regime, performance] of regimePerformance) {
            if (performance.successRate > 0.7) {
                recommendations.push({
                    condition: `Market regime: ${regime}`,
                    action: "increase_activity",
                    expectedImprovement: 0.1,
                });
            } else if (performance.successRate < 0.4) {
                recommendations.push({
                    condition: `Market regime: ${regime}`,
                    action: "decrease_activity",
                    expectedImprovement: 0.05,
                });
            }
        }

        return recommendations;
    }

    private generateHighPriorityActions(
        overallPerformance: PerformanceReport,
        failurePatterns: FailurePatternAnalysis,
        _marketConditionAnalysis: MarketConditionAnalysis
    ): ImprovementRecommendations["highPriorityActions"] {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _ = _marketConditionAnalysis;
        const actions: ImprovementRecommendations["highPriorityActions"] = [];

        if (overallPerformance.overallSuccessRate < 0.5) {
            actions.push({
                action: "Review and increase confidence thresholds",
                expectedImpact: 0.15,
                implementationDifficulty: "low",
                timeframe: "immediate",
            });
        }

        if (failurePatterns.avoidableFailures.percentage > 0.3) {
            actions.push({
                action: "Implement failure prevention filters",
                expectedImpact:
                    failurePatterns.avoidableFailures
                        .potentialReturnImprovement,
                implementationDifficulty: "medium",
                timeframe: "short_term",
            });
        }

        return actions;
    }

    private generateConfigurationRecommendations(
        _performance: PerformanceReport
    ): ImprovementRecommendations["suggestedConfigChanges"] {
        // Placeholder implementation
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _ = _performance;
        return [];
    }

    private generateMarketConditionAdjustments(
        _analysis: MarketConditionAnalysis
    ): ImprovementRecommendations["marketConditionAdjustments"] {
        // Placeholder implementation
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _ = _analysis;
        return [];
    }
}
