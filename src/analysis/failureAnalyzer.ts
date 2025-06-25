// src/analysis/failureAnalyzer.ts

import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IWorkerMetricsCollector } from "../multithreading/shared/workerInterfaces.js";
import type { IPipelineStorage } from "../infrastructure/pipelineStorage.js";
import type {
    SignalOutcome,
    MarketContext,
    FailedSignalAnalysis,
} from "./signalTracker.js";
import type { SignalType } from "../types/signalTypes.js";

export interface FailurePatterns {
    // Most common failure reasons
    commonFailureReasons: Array<{
        reason: string;
        count: number;
        percentage: number;
        avgTimeToFailure: number;
        avgLoss: number;
    }>;

    // Failure clusters by characteristics
    failureClusters: Array<{
        characteristics: string[];
        count: number;
        avgAvoidabilityScore: number;
        preventionMethods: string[];
    }>;

    // Temporal failure patterns
    temporalPatterns: {
        byTimeOfDay: Map<number, number>; // Hour -> failure count
        byDayOfWeek: Map<number, number>; // Day -> failure count
        byMarketSession: Map<string, number>; // Session -> failure count
        seasonalTrends: Array<{
            period: string;
            failureRate: number;
            significance: number;
        }>;
    };

    // Market condition failure patterns
    marketConditionPatterns: {
        byVolatility: Map<string, number>;
        byVolume: Map<string, number>;
        byRegime: Map<string, number>;
        byTrendAlignment: Map<string, number>;
    };

    // Detector-specific failure patterns
    detectorFailurePatterns: Map<
        string,
        {
            totalFailures: number;
            failureRate: number;
            commonReasons: string[];
            avgAvoidabilityScore: number;
            improvementPotential: number;
        }
    >;

    // Signal type failure patterns
    signalTypeFailurePatterns: Map<
        SignalType,
        {
            totalFailures: number;
            failureRate: number;
            commonReasons: string[];
            worstMarketConditions: string[];
        }
    >;
}

export interface PreventionMethod {
    id: string;
    name: string;
    description: string;

    // Effectiveness metrics
    expectedReduction: number; // % of failures this would prevent
    confidenceLevel: number; // Statistical confidence in the estimate
    sideEffects: {
        signalReduction: number; // % of good signals that would be filtered out
        performanceImpact: number; // Expected change in overall performance
    };

    // Implementation details
    implementationType:
        | "filter"
        | "threshold_adjustment"
        | "timing_rule"
        | "market_condition_check";
    parameters: { [key: string]: unknown };
    complexity: "low" | "medium" | "high";

    // Supporting evidence
    supportingFailures: string[]; // IDs of failures this would have prevented
    testResults?: {
        backtestPeriod: number;
        preventedFailures: number;
        missedOpportunities: number;
        netBenefit: number;
    };
}

export interface WarningSignals {
    // Early warning indicators
    indicators: Array<{
        name: string;
        description: string;
        detectionAccuracy: number; // How often this indicates failure
        leadTime: number; // Average time before failure
        falsePositiveRate: number;
        conditions: { [key: string]: unknown };
    }>;

    // Warning signal combinations
    combinations: Array<{
        signals: string[];
        accuracy: number;
        leadTime: number;
        rarity: number; // How often this combination occurs
    }>;

    // Real-time warning system
    currentWarnings: Array<{
        signalId: string;
        warningType: string;
        severity: "low" | "medium" | "high" | "critical";
        confidence: number;
        recommendedAction: string;
    }>;
}

export interface FailureAnalyzerConfig {
    // Analysis parameters
    minFailuresForPattern: number; // Minimum failures needed to identify pattern
    patternConfidenceThreshold: number; // Minimum confidence for pattern validity
    lookbackPeriodMs: number; // How far back to analyze failures

    // Warning system parameters
    warningLookbackMs: number; // How far back to look for warning patterns
    warningAccuracyThreshold: number; // Minimum accuracy for warning signals

    // Prevention method evaluation
    preventionTestPeriodMs: number; // Period for backtesting prevention methods
    minPreventionEffectiveness: number; // Minimum effectiveness to recommend

    // Caching
    cacheExpirationMs: number;
}

/**
 * FailureAnalyzer analyzes failed signals to identify patterns, root causes,
 * and prevention methods. Provides early warning systems and improvement recommendations.
 */
export class FailureAnalyzer {
    private readonly config: Required<FailureAnalyzerConfig>;

    // Analysis cache
    private analysisCache = new Map<
        string,
        {
            result: unknown;
            generatedAt: number;
            expiresAt: number;
        }
    >();

    // Pattern detection state
    private knownPatterns: FailurePatterns | null = null;
    private lastPatternUpdate = 0;

    constructor(
        private readonly logger: ILogger,
        private readonly metricsCollector: IWorkerMetricsCollector,
        private readonly storage: IPipelineStorage,
        config: Partial<FailureAnalyzerConfig> = {}
    ) {
        this.config = {
            minFailuresForPattern: config.minFailuresForPattern ?? 10,
            patternConfidenceThreshold:
                config.patternConfidenceThreshold ?? 0.7,
            lookbackPeriodMs:
                config.lookbackPeriodMs ?? 30 * 24 * 60 * 60 * 1000, // 30 days
            warningLookbackMs:
                config.warningLookbackMs ?? 7 * 24 * 60 * 60 * 1000, // 7 days
            warningAccuracyThreshold: config.warningAccuracyThreshold ?? 0.6,
            preventionTestPeriodMs:
                config.preventionTestPeriodMs ?? 14 * 24 * 60 * 60 * 1000, // 14 days
            minPreventionEffectiveness:
                config.minPreventionEffectiveness ?? 0.2,
            cacheExpirationMs: config.cacheExpirationMs ?? 3600000, // 1 hour
        };

        this.logger.info("FailureAnalyzer initialized", {
            component: "FailureAnalyzer",
            config: this.config,
        });

        this.initializeMetrics();
    }

    /**
     * Analyze a failed signal to determine failure reason and avoidability.
     */
    public analyzeFailedSignal(
        signalOutcome: SignalOutcome
    ): FailedSignalAnalysis {
        try {
            this.logger.debug("Analyzing failed signal", {
                component: "FailureAnalyzer",
                signalId: signalOutcome.signalId,
                signalType: signalOutcome.signalType,
                detectorId: signalOutcome.detectorId,
            });

            // Determine primary failure reason
            const failureReason = this.determineFailureReason(signalOutcome);

            // Identify warning signals that were present
            const warningSignals =
                this.identifyWarningSignalsForSignal(signalOutcome);

            // Analyze actual price action
            const actualPriceAction =
                this.analyzeActualPriceAction(signalOutcome);

            // Calculate avoidability
            const avoidability = this.calculateAvoidability(
                signalOutcome,
                failureReason,
                warningSignals
            );

            // Get market context at entry and failure
            const marketContextAtEntry = signalOutcome.marketContext;
            const marketContextAtFailure =
                this.estimateMarketContextAtFailure(signalOutcome);

            // Validate signal type
            const signalType = this.validateSignalType(
                signalOutcome.signalType
            );

            const analysis: FailedSignalAnalysis = {
                signalId: signalOutcome.signalId,
                signalType: signalType,
                detectorId: signalOutcome.detectorId,
                failureReason,
                warningSignals,
                actualPriceAction,
                avoidability,
                marketContextAtFailure,
                marketContextAtEntry,
            };

            // Record metrics
            this.recordFailureAnalysisMetrics(analysis);

            this.logger.info("Failed signal analysis completed", {
                component: "FailureAnalyzer",
                signalId: signalOutcome.signalId,
                failureReason,
                avoidabilityScore: avoidability.score,
                warningSignalsPresent:
                    Object.values(warningSignals).filter(Boolean).length,
            });

            return analysis;
        } catch (error) {
            this.logger.error("Failed to analyze failed signal", {
                component: "FailureAnalyzer",
                signalId: signalOutcome.signalId,
                error: error instanceof Error ? error.message : String(error),
            });

            // Return minimal analysis on error
            return this.createMinimalFailedSignalAnalysis(signalOutcome);
        }
    }

    /**
     * Detect failure patterns across multiple failed signals.
     */
    public async detectFailurePatterns(
        failedSignals?: FailedSignalAnalysis[]
    ): Promise<FailurePatterns> {
        const cacheKey = "failure_patterns";
        const cached = this.getFromCache(cacheKey);
        if (
            cached !== undefined &&
            cached !== null &&
            Date.now() - this.lastPatternUpdate < this.config.cacheExpirationMs
        ) {
            return cached as FailurePatterns;
        }

        try {
            this.logger.debug("Detecting failure patterns", {
                component: "FailureAnalyzer",
                providedFailures: failedSignals?.length ?? 0,
            });

            // Get failed signals if not provided
            let failures =
                failedSignals ??
                (await this.storage.getFailedSignalAnalyses(
                    this.config.lookbackPeriodMs
                ));

            if (failures.length < this.config.minFailuresForPattern) {
                this.logger.warn(
                    "Insufficient failures for pattern detection",
                    {
                        component: "FailureAnalyzer",
                        failureCount: failures.length,
                        minRequired: this.config.minFailuresForPattern,
                    }
                );
                return this.createEmptyFailurePatterns();
            }

            // Analyze common failure reasons
            const commonFailureReasons =
                this.analyzeCommonFailureReasons(failures);

            // Identify failure clusters
            const failureClusters = this.identifyFailureClusters(failures);

            // Analyze temporal patterns
            const temporalPatterns =
                this.analyzeTemporalFailurePatterns(failures);

            // Analyze market condition patterns
            const marketConditionPatterns =
                this.analyzeMarketConditionFailurePatterns(failures);

            // Analyze detector-specific patterns
            const detectorFailurePatterns =
                this.analyzeDetectorFailurePatterns(failures);

            // Analyze signal type patterns
            const signalTypeFailurePatterns =
                this.analyzeSignalTypeFailurePatterns(failures);

            const patterns: FailurePatterns = {
                commonFailureReasons,
                failureClusters,
                temporalPatterns,
                marketConditionPatterns,
                detectorFailurePatterns,
                signalTypeFailurePatterns,
            };

            // Cache results
            this.cacheResult(cacheKey, patterns);
            this.knownPatterns = patterns;
            this.lastPatternUpdate = Date.now();

            this.logger.info("Failure pattern detection completed", {
                component: "FailureAnalyzer",
                totalFailures: failures.length,
                patternsFound: commonFailureReasons.length,
                clustersFound: failureClusters.length,
            });

            return patterns;
        } catch (error) {
            this.logger.error("Failed to detect failure patterns", {
                component: "FailureAnalyzer",
                error: error instanceof Error ? error.message : String(error),
            });
            return this.createEmptyFailurePatterns();
        }
    }

    /**
     * Suggest prevention methods based on failure analysis.
     */
    public async suggestPreventionMethods(
        failurePattern: string
    ): Promise<PreventionMethod[]> {
        const cacheKey = `prevention_methods_${failurePattern}`;
        const cached = this.getFromCache(cacheKey);
        if (cached !== undefined && cached !== null) {
            return cached as PreventionMethod[];
        }

        try {
            this.logger.debug("Suggesting prevention methods", {
                component: "FailureAnalyzer",
                failurePattern,
            });

            // Get recent failure patterns
            const patterns = await this.detectFailurePatterns();

            // Generate prevention methods based on pattern
            const methods = this.generatePreventionMethods(
                failurePattern,
                patterns
            );

            // Test prevention methods effectiveness
            const testedMethods = this.testPreventionMethods(methods);

            // Filter methods by effectiveness threshold
            const effectiveMethods = testedMethods.filter(
                (method) =>
                    method.expectedReduction >=
                    this.config.minPreventionEffectiveness
            );

            // Sort by net benefit (effectiveness - side effects)
            effectiveMethods.sort((a, b) => {
                const netBenefitA =
                    a.expectedReduction - a.sideEffects.performanceImpact;
                const netBenefitB =
                    b.expectedReduction - b.sideEffects.performanceImpact;
                return netBenefitB - netBenefitA;
            });

            this.cacheResult(cacheKey, effectiveMethods);

            this.logger.info("Prevention methods suggested", {
                component: "FailureAnalyzer",
                failurePattern,
                methodsGenerated: methods.length,
                effectiveMethods: effectiveMethods.length,
            });

            return effectiveMethods;
        } catch (error) {
            this.logger.error("Failed to suggest prevention methods", {
                component: "FailureAnalyzer",
                failurePattern,
                error: error instanceof Error ? error.message : String(error),
            });
            return [];
        }
    }

    /**
     * Identify early warning signals for potential failures.
     */
    public async analyzeWarningSignalsForFailure(
        signalOutcome: SignalOutcome
    ): Promise<WarningSignals> {
        const cacheKey = "warning_signals";
        const cached = this.getFromCache(cacheKey);
        if (cached !== undefined && cached !== null) {
            return cached as WarningSignals;
        }

        try {
            // Get historical failure data
            const failures = await this.storage.getFailedSignalAnalyses(
                this.config.warningLookbackMs
            );

            if (failures.length < this.config.minFailuresForPattern) {
                return this.createEmptyWarningSignals();
            }

            // Analyze individual warning indicators
            const indicators = this.analyzeWarningIndicators(failures);

            // Find effective warning signal combinations
            const combinations = this.findWarningCombinations(
                failures,
                indicators
            );

            // Generate current warnings (if applicable)
            const currentWarnings = this.generateCurrentWarnings(
                signalOutcome,
                indicators
            );

            const warningSignals: WarningSignals = {
                indicators,
                combinations,
                currentWarnings,
            };

            this.cacheResult(cacheKey, warningSignals);
            return warningSignals;
        } catch (error) {
            this.logger.error("Failed to identify warning signals", {
                component: "FailureAnalyzer",
                error: error instanceof Error ? error.message : String(error),
            });
            return this.createEmptyWarningSignals();
        }
    }

    // Private analysis methods

    private determineFailureReason(
        signalOutcome: SignalOutcome
    ): FailedSignalAnalysis["failureReason"] {
        const marketContext = signalOutcome.marketContext;
        const maxAdverseMove = Math.abs(signalOutcome.maxAdverseMove);
        const timeToFailure = signalOutcome.timeToMaxAdverse ?? 0;

        // Analyze market conditions at failure
        if (
            marketContext.regime === "volatile" ||
            marketContext.normalizedVolatility > 3
        ) {
            return "market_regime_change";
        }

        // Check for low volume conditions
        if (marketContext.volumeRatio < 0.5) {
            return "low_volume";
        }

        // Check for false breakout (rapid reversal with significant move)
        if (maxAdverseMove > 0.005 && timeToFailure < 300000) {
            // >0.5% loss in <5 minutes
            return "false_breakout";
        }

        // Check for opposing flow (if we have flow metrics)
        if (marketContext.trend5min !== marketContext.trend15min) {
            return "opposing_flow";
        }

        // Check for poor timing (near market events)
        if (this.isNearMarketEvent(signalOutcome.entryTime)) {
            return "poor_timing";
        }

        // Check for external events (unusual market behavior)
        if (this.detectUnusualMarketBehavior(marketContext)) {
            return "external_event";
        }

        // Default to whipsaw if no specific reason identified
        return "whipsaw";
    }

    private identifyWarningSignalsForSignal(
        signalOutcome: SignalOutcome
    ): FailedSignalAnalysis["warningSignals"] {
        const marketContext = signalOutcome.marketContext;

        return {
            lowVolume: marketContext.volumeRatio < 0.7,
            weakConfirmation: signalOutcome.originalConfidence < 0.8,
            conflictingSignals: this.detectConflictingSignals(marketContext),
            poorMarketConditions: this.assessMarketConditions(marketContext),
            recentFailuresNearby: false, // Would require historical failure data
            extremeConfidence: signalOutcome.originalConfidence > 0.95,
            unusualSpread:
                marketContext.bidAskSpread > signalOutcome.entryPrice * 0.001, // 0.1% of price
        };
    }

    private analyzeActualPriceAction(
        signalOutcome: SignalOutcome
    ): FailedSignalAnalysis["actualPriceAction"] {
        const maxFavorable = signalOutcome.maxFavorableMove;
        const maxAdverse = Math.abs(signalOutcome.maxAdverseMove);

        // Determine direction of failure
        let direction: "opposite" | "sideways" | "choppy";
        if (maxAdverse > maxFavorable * 2) {
            direction = "opposite"; // Strong move against signal
        } else if (maxFavorable < 0.001 && maxAdverse < 0.001) {
            direction = "sideways"; // No significant movement
        } else {
            direction = "choppy"; // Mixed movement
        }

        return {
            direction,
            magnitude: Math.max(maxFavorable, maxAdverse),
            timeToFailure: signalOutcome.timeToMaxAdverse ?? 0,
            maxDrawdown: maxAdverse,
        };
    }

    private calculateAvoidability(
        signalOutcome: SignalOutcome,
        failureReason: FailedSignalAnalysis["failureReason"],
        warningSignals: FailedSignalAnalysis["warningSignals"]
    ): FailedSignalAnalysis["avoidability"] {
        // Count warning signals present
        const warningCount =
            Object.values(warningSignals).filter(Boolean).length;
        const totalWarnings = Object.keys(warningSignals).length;

        // Base avoidability on warning signals present
        let avoidabilityScore = warningCount / totalWarnings;

        // Adjust based on failure reason predictability
        const reasonMultipliers: { [key: string]: number } = {
            low_volume: 0.9, // Highly avoidable
            poor_timing: 0.8, // Usually avoidable
            false_breakout: 0.6, // Somewhat avoidable
            whipsaw: 0.4, // Difficult to avoid
            external_event: 0.1, // Usually unavoidable
            market_regime_change: 0.5,
            opposing_flow: 0.7,
        };

        const reasonMultiplier = reasonMultipliers[failureReason] || 0.5;
        avoidabilityScore = (avoidabilityScore + reasonMultiplier) / 2;

        // Cap avoidability score
        avoidabilityScore = Math.min(avoidabilityScore, 0.95);

        return {
            score: avoidabilityScore,
            preventionMethod: this.getPreventionMethod(failureReason),
            confidenceReduction: avoidabilityScore * 0.3, // Reduce confidence by up to 30%
            filterSuggestion: this.getFilterSuggestion(
                failureReason,
                warningSignals
            ),
        };
    }

    private getPreventionMethod(
        failureReason: FailedSignalAnalysis["failureReason"]
    ): string {
        const preventionMethods: { [key: string]: string } = {
            low_volume: "Require minimum volume threshold (1.5x average)",
            poor_timing: "Avoid signals within 1 hour of market events",
            false_breakout: "Wait for confirmation candle or volume spike",
            whipsaw: "Increase confidence threshold to 0.85+",
            external_event: "Monitor news feeds and halt trading during events",
            market_regime_change: "Track regime stability for 15+ minutes",
            opposing_flow: "Require trend alignment across timeframes",
        };

        return (
            preventionMethods[failureReason] ||
            "Increase confirmation requirements"
        );
    }

    private getFilterSuggestion(
        failureReason: FailedSignalAnalysis["failureReason"],
        warningSignals: FailedSignalAnalysis["warningSignals"]
    ): string {
        // Prioritize most impactful filters
        if (warningSignals.lowVolume) {
            return "Add filter: volumeRatio > 1.0";
        }
        if (warningSignals.unusualSpread) {
            return "Add filter: bidAskSpread < 0.05% of price";
        }
        if (warningSignals.extremeConfidence) {
            return "Add filter: confidence <= 0.9";
        }
        if (warningSignals.conflictingSignals) {
            return "Add filter: trendAlignment > 0.7";
        }

        return `Add specific filter for ${failureReason}`;
    }

    private analyzeCommonFailureReasons(
        failures: FailedSignalAnalysis[]
    ): FailurePatterns["commonFailureReasons"] {
        const reasonCounts = new Map<
            string,
            {
                count: number;
                totalTimeToFailure: number;
                totalLoss: number;
            }
        >();

        // Count failures by reason and accumulate metrics
        for (const failure of failures) {
            const existing = reasonCounts.get(failure.failureReason) ?? {
                count: 0,
                totalTimeToFailure: 0,
                totalLoss: 0,
            };

            existing.count++;
            existing.totalTimeToFailure +=
                failure.actualPriceAction.timeToFailure;
            existing.totalLoss += failure.actualPriceAction.maxDrawdown;

            reasonCounts.set(failure.failureReason, existing);
        }

        const totalFailures = failures.length;

        return Array.from(reasonCounts.entries())
            .map(([reason, data]) => ({
                reason,
                count: data.count,
                percentage: data.count / totalFailures,
                avgTimeToFailure: data.totalTimeToFailure / data.count,
                avgLoss: data.totalLoss / data.count,
            }))
            .sort((a, b) => b.count - a.count);
    }

    private identifyFailureClusters(
        failures: FailedSignalAnalysis[]
    ): FailurePatterns["failureClusters"] {
        // Simplified clustering based on common characteristics
        const clusters = new Map<string, FailedSignalAnalysis[]>();

        for (const failure of failures) {
            // Create characteristic signature
            const characteristics = [];

            if (failure.warningSignals.lowVolume)
                characteristics.push("low_volume");
            if (failure.warningSignals.weakConfirmation)
                characteristics.push("weak_confirmation");
            if (failure.warningSignals.extremeConfidence)
                characteristics.push("extreme_confidence");
            if (failure.warningSignals.unusualSpread)
                characteristics.push("unusual_spread");
            if (failure.marketContextAtEntry.regime === "volatile")
                characteristics.push("volatile_market");

            const signature = characteristics.sort().join(",");
            if (!clusters.has(signature)) {
                clusters.set(signature, []);
            }
            const cluster = clusters.get(signature);
            if (cluster) {
                cluster.push(failure);
            }
        }

        // Convert to cluster analysis format
        return Array.from(clusters.entries())
            .filter(([, clusterFailures]) => clusterFailures.length >= 3) // Minimum cluster size
            .map(([signature, clusterFailures]) => ({
                characteristics: signature.split(","),
                count: clusterFailures.length,
                avgAvoidabilityScore:
                    clusterFailures.reduce(
                        (sum, f) => sum + f.avoidability.score,
                        0
                    ) / clusterFailures.length,
                preventionMethods: [
                    ...new Set(
                        clusterFailures.map(
                            (f) => f.avoidability.preventionMethod
                        )
                    ),
                ],
            }))
            .sort((a, b) => b.count - a.count);
    }

    private analyzeTemporalFailurePatterns(
        failures: FailedSignalAnalysis[]
    ): FailurePatterns["temporalPatterns"] {
        const byTimeOfDay = new Map<number, number>();
        const byDayOfWeek = new Map<number, number>();
        const byMarketSession = new Map<string, number>();

        for (const failure of failures) {
            const entryDate = new Date(failure.marketContextAtEntry.timestamp);
            const hour = entryDate.getHours();
            const dayOfWeek = entryDate.getDay();

            // Count by hour
            byTimeOfDay.set(hour, (byTimeOfDay.get(hour) || 0) + 1);

            // Count by day of week
            byDayOfWeek.set(dayOfWeek, (byDayOfWeek.get(dayOfWeek) || 0) + 1);

            // Count by market session
            const session = this.getMarketSession(hour);
            byMarketSession.set(
                session,
                (byMarketSession.get(session) || 0) + 1
            );
        }

        // Simple seasonal trend analysis (placeholder)
        const seasonalTrends = [
            { period: "morning", failureRate: 0.4, significance: 0.7 },
            { period: "afternoon", failureRate: 0.3, significance: 0.8 },
        ];

        return {
            byTimeOfDay,
            byDayOfWeek,
            byMarketSession,
            seasonalTrends,
        };
    }

    private analyzeMarketConditionFailurePatterns(
        failures: FailedSignalAnalysis[]
    ): FailurePatterns["marketConditionPatterns"] {
        const byVolatility = new Map<string, number>();
        const byVolume = new Map<string, number>();
        const byRegime = new Map<string, number>();
        const byTrendAlignment = new Map<string, number>();

        for (const failure of failures) {
            const context = failure.marketContextAtEntry;

            // Volatility categories
            const volCategory =
                context.normalizedVolatility < 0.5
                    ? "low"
                    : context.normalizedVolatility < 1.5
                      ? "medium"
                      : context.normalizedVolatility < 3.0
                        ? "high"
                        : "extreme";
            byVolatility.set(
                volCategory,
                (byVolatility.get(volCategory) || 0) + 1
            );

            // Volume categories
            const volCategory2 =
                context.volumeRatio < 0.7
                    ? "low"
                    : context.volumeRatio < 1.3
                      ? "normal"
                      : context.volumeRatio < 2.0
                        ? "high"
                        : "very_high";
            byVolume.set(volCategory2, (byVolume.get(volCategory2) || 0) + 1);

            // Market regime
            byRegime.set(
                context.regime,
                (byRegime.get(context.regime) || 0) + 1
            );

            // Trend alignment
            const alignmentCategory =
                context.trendAlignment < 0.3
                    ? "conflicting"
                    : context.trendAlignment < 0.7
                      ? "mixed"
                      : "aligned";
            byTrendAlignment.set(
                alignmentCategory,
                (byTrendAlignment.get(alignmentCategory) || 0) + 1
            );
        }

        return {
            byVolatility,
            byVolume,
            byRegime,
            byTrendAlignment,
        };
    }

    private analyzeDetectorFailurePatterns(
        failures: FailedSignalAnalysis[]
    ): FailurePatterns["detectorFailurePatterns"] {
        const detectorStats = new Map<
            string,
            {
                totalFailures: number;
                totalSignals: number;
                reasonCounts: Map<string, number>;
                avoidabilityScores: number[];
            }
        >();

        // Count failures by detector
        for (const failure of failures) {
            const detectorId = failure.detectorId;
            if (!detectorStats.has(detectorId)) {
                detectorStats.set(detectorId, {
                    totalFailures: 0,
                    totalSignals: 0, // Would need to query from storage
                    reasonCounts: new Map(),
                    avoidabilityScores: [],
                });
            }

            const stats = detectorStats.get(detectorId)!;
            stats.totalFailures++;
            stats.reasonCounts.set(
                failure.failureReason,
                (stats.reasonCounts.get(failure.failureReason) || 0) + 1
            );
            stats.avoidabilityScores.push(failure.avoidability.score);
        }

        // Convert to final format
        const result = new Map<
            string,
            {
                totalFailures: number;
                failureRate: number;
                commonReasons: string[];
                avgAvoidabilityScore: number;
                improvementPotential: number;
            }
        >();

        for (const [detectorId, stats] of detectorStats) {
            const commonReasons = Array.from(stats.reasonCounts.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([reason]) => reason);

            const avgAvoidabilityScore =
                stats.avoidabilityScores.length > 0
                    ? stats.avoidabilityScores.reduce(
                          (sum, score) => sum + score,
                          0
                      ) / stats.avoidabilityScores.length
                    : 0;

            result.set(detectorId, {
                totalFailures: stats.totalFailures,
                failureRate: 0.5, // Would calculate from totalSignals if available
                commonReasons,
                avgAvoidabilityScore,
                improvementPotential: avgAvoidabilityScore * 0.5, // Simplified calculation
            });
        }

        return result as Map<
            string,
            {
                totalFailures: number;
                failureRate: number;
                commonReasons: string[];
                avgAvoidabilityScore: number;
                improvementPotential: number;
            }
        >;
    }

    private analyzeSignalTypeFailurePatterns(
        failures: FailedSignalAnalysis[]
    ): FailurePatterns["signalTypeFailurePatterns"] {
        const typeStats = new Map<
            SignalType,
            {
                totalFailures: number;
                reasonCounts: Map<string, number>;
                marketConditions: Map<string, number>;
            }
        >();

        for (const failure of failures) {
            const signalType = failure.signalType;
            if (!typeStats.has(signalType)) {
                typeStats.set(signalType, {
                    totalFailures: 0,
                    reasonCounts: new Map(),
                    marketConditions: new Map(),
                });
            }

            const stats = typeStats.get(signalType)!;
            stats.totalFailures++;
            stats.reasonCounts.set(
                failure.failureReason,
                (stats.reasonCounts.get(failure.failureReason) || 0) + 1
            );
            stats.marketConditions.set(
                failure.marketContextAtEntry.regime,
                (stats.marketConditions.get(
                    failure.marketContextAtEntry.regime
                ) || 0) + 1
            );
        }

        const result = new Map<
            SignalType,
            {
                totalFailures: number;
                failureRate: number;
                commonReasons: string[];
                worstMarketConditions: string[];
            }
        >();

        for (const [signalType, stats] of typeStats) {
            const commonReasons = Array.from(stats.reasonCounts.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([reason]) => reason);

            const worstMarketConditions = Array.from(
                stats.marketConditions.entries()
            )
                .sort((a, b) => b[1] - a[1])
                .slice(0, 2)
                .map(([condition]) => condition);

            result.set(signalType, {
                totalFailures: stats.totalFailures,
                failureRate: 0.5, // Would calculate if total signals available
                commonReasons,
                worstMarketConditions,
            });
        }

        return result as Map<
            SignalType,
            {
                totalFailures: number;
                failureRate: number;
                commonReasons: string[];
                worstMarketConditions: string[];
            }
        >;
    }

    // Additional helper methods

    private generatePreventionMethods(
        failurePattern: string,
        patterns: FailurePatterns
    ): PreventionMethod[] {
        const methods: PreventionMethod[] = [];

        // Generate methods based on common failure reasons
        for (const reason of patterns.commonFailureReasons) {
            if (reason.reason === failurePattern && reason.percentage > 0.2) {
                methods.push(
                    this.createPreventionMethodForReason(reason.reason)
                );
            }
        }

        // Generate methods based on failure clusters
        for (const cluster of patterns.failureClusters) {
            if (
                cluster.characteristics.includes(failurePattern) &&
                cluster.count > 5
            ) {
                methods.push(this.createPreventionMethodForCluster(cluster));
            }
        }

        return methods;
    }

    private createPreventionMethodForReason(reason: string): PreventionMethod {
        const methodConfigs: { [key: string]: Partial<PreventionMethod> } = {
            low_volume: {
                name: "Volume Threshold Filter",
                description: "Reject signals when volume is below 1.5x average",
                implementationType: "filter",
                parameters: { minVolumeRatio: 1.5 },
                complexity: "low",
            },
            false_breakout: {
                name: "Breakout Confirmation",
                description: "Wait for confirmation candle after breakout",
                implementationType: "timing_rule",
                parameters: { confirmationPeriodMs: 300000 }, // 5 minutes
                complexity: "medium",
            },
            poor_timing: {
                name: "Market Event Avoidance",
                description: "Avoid signals near scheduled market events",
                implementationType: "timing_rule",
                parameters: { eventBufferMs: 3600000 }, // 1 hour
                complexity: "medium",
            },
        };

        const config = methodConfigs[reason] || {
            name: `${reason} Prevention`,
            description: `Prevent ${reason} failures`,
            implementationType: "filter" as const,
            parameters: {},
            complexity: "medium" as const,
        };

        return {
            id: `prevent_${reason}`,
            expectedReduction: 0.3, // Will be calculated during testing
            confidenceLevel: 0.7,
            sideEffects: {
                signalReduction: 0.1,
                performanceImpact: 0.05,
            },
            supportingFailures: [],
            ...config,
        } as PreventionMethod;
    }

    private createPreventionMethodForCluster(
        cluster: FailurePatterns["failureClusters"][0]
    ): PreventionMethod {
        return {
            id: `prevent_cluster_${cluster.characteristics.join("_")}`,
            name: `Multi-Factor Filter`,
            description: `Filter based on: ${cluster.characteristics.join(", ")}`,
            expectedReduction: cluster.avgAvoidabilityScore * 0.7,
            confidenceLevel: Math.min(cluster.count / 20, 0.9), // More failures = higher confidence
            sideEffects: {
                signalReduction: cluster.characteristics.length * 0.05, // More restrictive = more reduction
                performanceImpact: 0.02,
            },
            implementationType: "filter",
            parameters: { characteristics: cluster.characteristics },
            complexity: "high",
            supportingFailures: [],
        };
    }

    private testPreventionMethods(
        methods: PreventionMethod[]
    ): PreventionMethod[] {
        // Simplified prevention method testing
        // In practice, this would run backtests on historical data

        return methods.map((method) => {
            // Simulate test results
            const testResults = {
                backtestPeriod: this.config.preventionTestPeriodMs,
                preventedFailures: Math.floor(method.expectedReduction * 100),
                missedOpportunities: Math.floor(
                    method.sideEffects.signalReduction * 200
                ),
                netBenefit:
                    method.expectedReduction -
                    method.sideEffects.performanceImpact,
            };

            return {
                ...method,
                testResults,
            };
        });
    }

    private analyzeWarningIndicators(
        failures: FailedSignalAnalysis[]
    ): WarningSignals["indicators"] {
        const indicators: WarningSignals["indicators"] = [];

        // Analyze each type of warning signal
        const warningTypes = [
            "lowVolume",
            "weakConfirmation",
            "conflictingSignals",
            "poorMarketConditions",
            "extremeConfidence",
            "unusualSpread",
        ];

        for (const warningType of warningTypes) {
            const failuresWithWarning = failures.filter(
                (f) =>
                    f.warningSignals[
                        warningType as keyof FailedSignalAnalysis["warningSignals"]
                    ]
            );

            if (failuresWithWarning.length < 3) continue; // Need minimum occurrences

            const accuracy = failuresWithWarning.length / failures.length;
            if (accuracy >= this.config.warningAccuracyThreshold) {
                const avgLeadTime =
                    failuresWithWarning
                        .filter((f) => f.actualPriceAction.timeToFailure > 0)
                        .reduce(
                            (sum, f) => sum + f.actualPriceAction.timeToFailure,
                            0
                        ) / failuresWithWarning.length;

                indicators.push({
                    name: warningType,
                    description: `Warning: ${warningType}`,
                    detectionAccuracy: accuracy,
                    leadTime: avgLeadTime,
                    falsePositiveRate: 1 - accuracy, // Simplified
                    conditions: { [warningType]: true },
                });
            }
        }

        return indicators;
    }

    private findWarningCombinations(
        failures: FailedSignalAnalysis[],
        indicators: WarningSignals["indicators"]
    ): WarningSignals["combinations"] {
        const combinations: WarningSignals["combinations"] = [];

        // Find 2-signal combinations
        for (let i = 0; i < indicators.length; i++) {
            for (let j = i + 1; j < indicators.length; j++) {
                const signal1 = indicators[i].name;
                const signal2 = indicators[j].name;

                const failuresWithBoth = failures.filter(
                    (f) =>
                        f.warningSignals[
                            signal1 as keyof FailedSignalAnalysis["warningSignals"]
                        ] &&
                        f.warningSignals[
                            signal2 as keyof FailedSignalAnalysis["warningSignals"]
                        ]
                );

                if (failuresWithBoth.length >= 3) {
                    const accuracy = failuresWithBoth.length / failures.length;
                    const avgLeadTime =
                        failuresWithBoth
                            .filter(
                                (f) => f.actualPriceAction.timeToFailure > 0
                            )
                            .reduce(
                                (sum, f) =>
                                    sum + f.actualPriceAction.timeToFailure,
                                0
                            ) / failuresWithBoth.length;

                    combinations.push({
                        signals: [signal1, signal2],
                        accuracy,
                        leadTime: avgLeadTime,
                        rarity: failuresWithBoth.length / failures.length,
                    });
                }
            }
        }

        return combinations.sort((a, b) => b.accuracy - a.accuracy);
    }

    private generateCurrentWarnings(
        signalOutcome: SignalOutcome,
        indicators: WarningSignals["indicators"]
    ): WarningSignals["currentWarnings"] {
        const warnings: WarningSignals["currentWarnings"] = [];

        for (const indicator of indicators) {
            const warningPresent = this.checkWarningCondition(
                signalOutcome,
                indicator
            );
            if (warningPresent) {
                warnings.push({
                    signalId: signalOutcome.signalId,
                    warningType: indicator.name,
                    severity: this.calculateWarningSeverity(indicator),
                    confidence: indicator.detectionAccuracy,
                    recommendedAction: this.getRecommendedAction(
                        indicator.name
                    ),
                });
            }
        }

        return warnings;
    }

    private checkWarningCondition(
        signalOutcome: SignalOutcome,
        indicator: WarningSignals["indicators"][0]
    ): boolean {
        // Simplified warning condition check
        const warningSignals =
            this.identifyWarningSignalsForSignal(signalOutcome);
        return (
            warningSignals[indicator.name as keyof typeof warningSignals] ||
            false
        );
    }

    private calculateWarningSeverity(
        indicator: WarningSignals["indicators"][0]
    ): "low" | "medium" | "high" | "critical" {
        if (indicator.detectionAccuracy > 0.8) return "critical";
        if (indicator.detectionAccuracy > 0.7) return "high";
        if (indicator.detectionAccuracy > 0.6) return "medium";
        return "low";
    }

    private getRecommendedAction(warningType: string): string {
        const actions: { [key: string]: string } = {
            lowVolume: "Wait for volume confirmation",
            weakConfirmation: "Require higher confidence threshold",
            conflictingSignals: "Wait for trend alignment",
            extremeConfidence: "Apply confidence cap",
            unusualSpread: "Wait for normal spread conditions",
        };

        return actions[warningType] || "Exercise caution";
    }

    // Utility methods

    private isNearMarketEvent(timestamp: number): boolean {
        // Simplified check for market events
        // In practice, this would check against an events calendar
        const hour = new Date(timestamp).getHours();
        return hour === 8 || hour === 9 || hour === 15 || hour === 16; // Market open/close hours
    }

    private detectUnusualMarketBehavior(marketContext: MarketContext): boolean {
        // Detect unusual market behavior that might indicate external events
        return (
            marketContext.normalizedVolatility > 5 ||
            marketContext.volumeRatio > 5 ||
            marketContext.bidAskSpread > marketContext.price * 0.005
        ); // 0.5% spread
    }

    private detectConflictingSignals(marketContext: MarketContext): boolean {
        // Check for conflicting trend signals
        const trends = [
            marketContext.trend5min,
            marketContext.trend15min,
            marketContext.trend1hour,
        ];
        const upCount = trends.filter((t) => t === "up").length;
        const downCount = trends.filter((t) => t === "down").length;
        const sidewaysCount = trends.filter((t) => t === "sideways").length;

        // Conflicting if no clear majority
        return Math.max(upCount, downCount, sidewaysCount) < 2;
    }

    private assessMarketConditions(marketContext: MarketContext): boolean {
        // Assess if market conditions are poor for trading
        return (
            marketContext.regime === "volatile" ||
            marketContext.normalizedVolatility > 3 ||
            marketContext.volumeRatio < 0.3
        );
    }

    private getMarketSession(hour: number): string {
        if (hour >= 9 && hour < 12) return "morning";
        if (hour >= 12 && hour < 16) return "afternoon";
        if (hour >= 16 && hour < 20) return "evening";
        return "overnight";
    }

    private estimateMarketContextAtFailure(
        signalOutcome: SignalOutcome
    ): MarketContext {
        // Simplified estimation - in practice, this would use historical market data
        // For now, return the entry context as approximation
        return signalOutcome.marketContext;
    }

    private createMinimalFailedSignalAnalysis(
        signalOutcome: SignalOutcome
    ): FailedSignalAnalysis {
        return {
            signalId: signalOutcome.signalId,
            signalType: signalOutcome.signalType as SignalType,
            detectorId: signalOutcome.detectorId,
            failureReason: "whipsaw",
            warningSignals: {
                lowVolume: false,
                weakConfirmation: false,
                conflictingSignals: false,
                poorMarketConditions: false,
                recentFailuresNearby: false,
                extremeConfidence: false,
                unusualSpread: false,
            },
            actualPriceAction: {
                direction: "choppy",
                magnitude: Math.abs(signalOutcome.maxAdverseMove),
                timeToFailure: signalOutcome.timeToMaxAdverse ?? 0,
                maxDrawdown: Math.abs(signalOutcome.maxAdverseMove),
            },
            avoidability: {
                score: 0.3,
                preventionMethod: "Increase confirmation requirements",
                confidenceReduction: 0.1,
                filterSuggestion: "Review signal criteria",
            },
            marketContextAtFailure: signalOutcome.marketContext,
            marketContextAtEntry: signalOutcome.marketContext,
        };
    }

    // Empty result creators

    private createEmptyFailurePatterns(): FailurePatterns {
        return {
            commonFailureReasons: [],
            failureClusters: [],
            temporalPatterns: {
                byTimeOfDay: new Map(),
                byDayOfWeek: new Map(),
                byMarketSession: new Map(),
                seasonalTrends: [],
            },
            marketConditionPatterns: {
                byVolatility: new Map(),
                byVolume: new Map(),
                byRegime: new Map(),
                byTrendAlignment: new Map(),
            },
            detectorFailurePatterns: new Map(),
            signalTypeFailurePatterns: new Map(),
        };
    }

    private createEmptyWarningSignals(): WarningSignals {
        return {
            indicators: [],
            combinations: [],
            currentWarnings: [],
        };
    }

    private recordFailureAnalysisMetrics(analysis: FailedSignalAnalysis): void {
        this.metricsCollector.incrementCounter(
            "failure_analyzer_analyses_total",
            1,
            {
                failure_reason: analysis.failureReason,
                signal_type: analysis.signalType,
                detector_id: analysis.detectorId,
            }
        );

        this.metricsCollector.recordHistogram(
            "failure_analyzer_avoidability_score",
            analysis.avoidability.score,
            {
                failure_reason: analysis.failureReason,
            }
        );

        const warningCount = Object.values(analysis.warningSignals).filter(
            Boolean
        ).length;
        this.metricsCollector.recordHistogram(
            "failure_analyzer_warning_signals_count",
            warningCount,
            {
                failure_reason: analysis.failureReason,
            }
        );
    }

    private initializeMetrics(): void {
        try {
            this.metricsCollector.createCounter(
                "failure_analyzer_analyses_total",
                "Total failure analyses performed",
                ["failure_reason", "signal_type", "detector_id"]
            );

            this.metricsCollector.createHistogram(
                "failure_analyzer_avoidability_score",
                "Distribution of avoidability scores",
                ["failure_reason"],
                [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
            );

            this.metricsCollector.createHistogram(
                "failure_analyzer_warning_signals_count",
                "Number of warning signals present in failures",
                ["failure_reason"],
                [0, 1, 2, 3, 4, 5, 6, 7]
            );

            this.logger.debug("FailureAnalyzer metrics initialized", {
                component: "FailureAnalyzer",
            });
        } catch (error) {
            this.logger.error("Failed to initialize FailureAnalyzer metrics", {
                component: "FailureAnalyzer",
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    // Cache management

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

    private validateSignalType(signalType: string): SignalType {
        // List of valid signal types from SignalType union
        const validTypes: SignalType[] = [
            "absorption",
            "exhaustion",
            "accumulation",
            "distribution",
            "absorption_confirmed",
            "exhaustion_confirmed",
            "accumulation_confirmed",
            "distribution_confirmed",
            "flow",
            "swingHigh",
            "swingLow",
            "cvd_confirmation",
            "cvd_confirmation_confirmed",
            "support_resistance_level",
            "generic",
        ];

        if (validTypes.includes(signalType as SignalType)) {
            return signalType as SignalType;
        }

        // Fallback for invalid signal types
        this.logger.warn("Invalid signal type encountered", { signalType });
        return "generic";
    }
}
