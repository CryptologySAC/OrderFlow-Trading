// src/utils/automaticParameterOptimizer.ts
//
// ✅ AUTOMATIC 90-MINUTE PARAMETER OPTIMIZER: Complete signal analysis
//
// This module analyzes BOTH rejected AND passed signals every 90 minutes, correlates them with
// actual price movements, and sends optimization recommendations via Claude app notifications.
//
// CORE METHODOLOGY:
// 1. Load rejected signals from last 90 minutes
// 2. Load successful signals from last 90 minutes
// 3. Query database for actual price/volume movements during both rejection and success periods
// 4. Identify which rejections were actually top/bottom signals (missed opportunities)
// 5. Identify which successful signals were noise vs real top/bottom signals
// 6. Calculate optimal parameter values to maximize top/bottom capture while minimizing noise
// 7. Send Claude app notification with recommended settings (DO NOT modify config.json)

import * as fs from "fs/promises";
import * as path from "path";
import Database from "better-sqlite3";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import { Config } from "../core/config.js";

/**
 * Raw rejection data from CSV files
 */
interface RejectionData {
    timestamp: number;
    detectorType: string;
    rejectionReason: string;
    price: number;
    thresholdType: string;
    thresholdValue: number;
    actualValue: number;
    aggressiveVolume: number;
    passiveVolume: number;
    priceEfficiency: number | null;
    confidence: number;
}

/**
 * Raw successful signal data from CSV files - matches actual 50+ column structure
 */
interface SuccessfulSignalData {
    timestamp: number;
    detectorType: string;
    price: number;
    minAggVolume: number | null;
    exhaustionThreshold: number | null;
    absorptionThreshold: number | null;
    passiveAbsorptionThreshold: number | null;
    priceEfficiency: number | null;
    confidence: number | null;
    aggressiveVolume: number | null;
    passiveVolume: number | null;
    volumeRatio: number | null;
    institutionalVolumeRatio: number | null;
    marketVolume: number;
    marketSpread: number;
    marketVolatility: number;
    subsequentMovement5min: number | null;
    subsequentMovement15min: number | null;
    subsequentMovement90min: number | null;
    wasTopOrBottomSignal: boolean | null;
    signalQuality: string | null;
}

/**
 * Signal analysis result combining both rejected and successful signals
 */
interface CompleteSignalAnalysis {
    timestamp: number;
    detectorType: "exhaustion" | "absorption";
    signalStatus: "rejected" | "successful";
    price: number;

    // Parameter values at time of signal
    parameterName: string;
    thresholdValue: number;
    actualValue: number;

    // Market context
    aggressiveVolume: number;
    passiveVolume: number;
    priceEfficiency: number | null;
    confidence: number;

    // 90-minute outcome analysis
    priceMovement90min: number;
    wasTopOrBottomSignal: boolean;
    signalType: "top" | "bottom" | "noise";

    // Optimization classification
    correctDecision: boolean; // true if rejection was correct (noise) or success was correct (top/bottom)
    missedOpportunity: boolean; // true if rejected but was actually top/bottom
    falsePositive: boolean; // true if successful but was actually noise
}

/**
 * Comprehensive parameter optimization recommendation
 */
interface ParameterRecommendation {
    detectorType: "exhaustion" | "absorption";
    parameterName: string;
    currentThreshold: number;
    recommendedThreshold: number;

    // Analysis breakdown
    totalSignals: number;
    successfulSignals: number;
    rejectedSignals: number;

    // Outcome analysis
    missedTopBottomSignals: number; // rejected but were actually top/bottom
    capturedTopBottomSignals: number; // successful and were actually top/bottom
    noiseSignalsRejected: number; // rejected and were actually noise
    noiseSignalsAccepted: number; // successful but were actually noise

    // Performance metrics
    currentPrecision: number; // successful top/bottom / total successful
    currentRecall: number; // successful top/bottom / total top/bottom
    projectedPrecision: number; // with recommended threshold
    projectedRecall: number; // with recommended threshold

    // Recommendation justification
    optimizationReason: string;
    confidenceScore: number;
    urgencyLevel: "high" | "medium" | "low";
}

/**
 * Automatic Parameter Optimizer - Complete signal analysis every 90 minutes
 */
export class AutomaticParameterOptimizer {
    private readonly dbPath: string;

    constructor(
        private readonly logger: ILogger,
        private readonly outputDir: string = "logs/signal_validation"
    ) {
        this.dbPath = "orderflow.db";
    }

    /**
     * Run complete 90-minute optimization analysis
     */
    public async runOptimization(): Promise<void> {
        const startTime = Date.now();
        const analysisTimestamp = new Date().toISOString();

        this.logger.info(
            "AutomaticParameterOptimizer: Starting complete 90-minute analysis",
            {
                timestamp: analysisTimestamp,
                analysisWindow: "90 minutes",
                analysisType: "rejected + successful signals",
            }
        );

        try {
            // Step 1: Load both rejected and successful signals from last 90 minutes
            const [rejectedSignals, successfulSignals] = await Promise.all([
                this.loadRecentRejections(),
                this.loadRecentSuccessfulSignals(),
            ]);

            if (
                rejectedSignals.length === 0 &&
                successfulSignals.length === 0
            ) {
                this.logger.info(
                    "AutomaticParameterOptimizer: No signals in last 90 minutes"
                );
                return;
            }

            // Step 2: Analyze all signals against actual price movements
            const completeAnalyses = await this.analyzeAllSignals(
                rejectedSignals,
                successfulSignals
            );

            // Step 3: Calculate comprehensive parameter recommendations
            const recommendations =
                this.calculateParameterRecommendations(completeAnalyses);

            // Step 4: Send Claude app notification with recommendations
            if (recommendations.length > 0) {
                await this.sendClaudeAppNotification(
                    recommendations,
                    completeAnalyses,
                    analysisTimestamp
                );
                await this.saveAnalysisReport(
                    recommendations,
                    completeAnalyses,
                    analysisTimestamp
                );
            }

            const executionTime = Date.now() - startTime;
            this.logger.info(
                "AutomaticParameterOptimizer: Complete analysis finished",
                {
                    executionTimeMs: executionTime,
                    rejectedSignalsAnalyzed: rejectedSignals.length,
                    successfulSignalsAnalyzed: successfulSignals.length,
                    recommendationsGenerated: recommendations.length,
                    timestamp: analysisTimestamp,
                }
            );
        } catch (error) {
            this.logger.error("AutomaticParameterOptimizer: Analysis failed", {
                error: error instanceof Error ? error.message : String(error),
                timestamp: analysisTimestamp,
            });
        }
    }

    /**
     * Load rejected signals from the last 90 minutes
     */
    private async loadRecentRejections(): Promise<RejectionData[]> {
        const cutoffTime = Date.now() - 90 * 60 * 1000;
        const today = new Date().toISOString().split("T")[0];

        const rejectionFiles = await this.findFilesWithPattern(
            "signal_rejections_",
            today!
        );
        const recentRejections: RejectionData[] = [];

        for (const filePath of rejectionFiles) {
            try {
                const content = await fs.readFile(filePath, "utf-8");
                const lines = content.split("\n").slice(1); // Skip header

                for (const line of lines) {
                    if (line.trim() === "") continue;

                    const fields = line.split(",");
                    const timestamp = parseInt(fields[0]!, 10);

                    if (timestamp >= cutoffTime) {
                        recentRejections.push({
                            timestamp,
                            detectorType: fields[1]!,
                            rejectionReason: fields[2]!,
                            price: parseFloat(fields[3]!),
                            thresholdType: fields[4]!,
                            thresholdValue: parseFloat(fields[5]!),
                            actualValue: parseFloat(fields[6]!),
                            aggressiveVolume: parseFloat(fields[7]!),
                            passiveVolume: parseFloat(fields[8]!),
                            priceEfficiency: fields[9]
                                ? parseFloat(fields[9])
                                : null,
                            confidence: parseFloat(fields[10]!),
                        });
                    }
                }
            } catch {
                this.logger.warn("Failed to read rejection file", { filePath });
            }
        }

        return recentRejections;
    }

    /**
     * Load successful signals from the last 90 minutes
     */
    private async loadRecentSuccessfulSignals(): Promise<
        SuccessfulSignalData[]
    > {
        const cutoffTime = Date.now() - 90 * 60 * 1000;
        const today = new Date().toISOString().split("T")[0];

        const successfulFiles = await this.findFilesWithPattern(
            "successful_signals_",
            today!
        );
        const recentSuccessful: SuccessfulSignalData[] = [];

        for (const filePath of successfulFiles) {
            try {
                const content = await fs.readFile(filePath, "utf-8");
                const lines = content.split("\n").slice(1); // Skip header

                for (const line of lines) {
                    if (line.trim() === "") continue;

                    const fields = line.split(",");
                    const timestamp = parseInt(fields[0]!, 10);

                    if (timestamp >= cutoffTime) {
                        // Parse based on ACTUAL CSV column positions (50+ columns)
                        recentSuccessful.push({
                            timestamp,
                            detectorType: fields[1]!,
                            price: parseFloat(fields[2]!),
                            minAggVolume: fields[3]
                                ? parseFloat(fields[3])
                                : null,
                            exhaustionThreshold: fields[4]
                                ? parseFloat(fields[4])
                                : null,
                            absorptionThreshold: fields[23]
                                ? parseFloat(fields[23])
                                : null, // Column 23!
                            passiveAbsorptionThreshold: fields[27]
                                ? parseFloat(fields[27])
                                : null, // Column 27!
                            priceEfficiency: fields[42]
                                ? parseFloat(fields[42])
                                : null, // Column 42!
                            confidence: fields[43]
                                ? parseFloat(fields[43])
                                : null, // Column 43!
                            aggressiveVolume: fields[44]
                                ? parseFloat(fields[44])
                                : null, // Column 44!
                            passiveVolume: fields[45]
                                ? parseFloat(fields[45])
                                : null, // Column 45!
                            volumeRatio: fields[46]
                                ? parseFloat(fields[46])
                                : null, // Column 46!
                            institutionalVolumeRatio: fields[47]
                                ? parseFloat(fields[47])
                                : null, // Column 47!
                            marketVolume: parseFloat(fields[48] || "0"), // Column 48!
                            marketSpread: parseFloat(fields[49] || "0"), // Column 49!
                            marketVolatility: parseFloat(fields[50] || "0"), // Column 50!
                            subsequentMovement5min: fields[51]
                                ? parseFloat(fields[51])
                                : null,
                            subsequentMovement15min: fields[52]
                                ? parseFloat(fields[52])
                                : null,
                            subsequentMovement90min: fields[53]
                                ? parseFloat(fields[53])
                                : null,
                            wasTopOrBottomSignal: fields[54] === "true",
                            signalQuality: fields[55] || null,
                        });
                    }
                }
            } catch {
                this.logger.warn("Failed to read successful signals file", {
                    filePath,
                });
            }
        }

        return recentSuccessful;
    }

    /**
     * Find files with pattern for the given date
     */
    private async findFilesWithPattern(
        pattern: string,
        dateString: string
    ): Promise<string[]> {
        try {
            const files = await fs.readdir(this.outputDir);
            return files
                .filter(
                    (file) =>
                        file.startsWith(pattern) && file.includes(dateString)
                )
                .map((file) => path.join(this.outputDir, file));
        } catch {
            return [];
        }
    }

    /**
     * Analyze all signals (both rejected and successful) against price movements
     */
    private async analyzeAllSignals(
        rejectedSignals: RejectionData[],
        successfulSignals: SuccessfulSignalData[]
    ): Promise<CompleteSignalAnalysis[]> {
        const analyses: CompleteSignalAnalysis[] = [];

        // Analyze rejected signals
        for (const rejection of rejectedSignals) {
            const analysis = await this.analyzeRejectedSignal(rejection);
            if (analysis) analyses.push(analysis);
        }

        // Analyze successful signals
        for (const success of successfulSignals) {
            const analysis = await this.analyzeSuccessfulSignal(success);
            if (analysis) analyses.push(analysis);
        }

        this.logger.info("Complete signal analysis finished", {
            totalAnalyses: analyses.length,
            rejectedAnalyzed: rejectedSignals.length,
            successfulAnalyzed: successfulSignals.length,
            topBottomFound: analyses.filter((a) => a.wasTopOrBottomSignal)
                .length,
            noiseFound: analyses.filter((a) => !a.wasTopOrBottomSignal).length,
            missedOpportunities: analyses.filter((a) => a.missedOpportunity)
                .length,
            falsePositives: analyses.filter((a) => a.falsePositive).length,
        });

        return analyses;
    }

    /**
     * Analyze a rejected signal
     */
    private async analyzeRejectedSignal(
        rejection: RejectionData
    ): Promise<CompleteSignalAnalysis | null> {
        try {
            const priceMovement = await this.getPriceMovement90Min(
                rejection.timestamp,
                rejection.price
            );
            const absMovement = Math.abs(priceMovement);
            const wasTopOrBottomSignal = absMovement >= 0.007; // 0.7% threshold

            let signalType: "top" | "bottom" | "noise" = "noise";
            if (wasTopOrBottomSignal) {
                signalType = priceMovement >= 0.007 ? "bottom" : "top";
            }

            const parameterName = this.mapRejectionReasonToParameter(
                rejection.rejectionReason
            );

            return {
                timestamp: rejection.timestamp,
                detectorType: rejection.detectorType as
                    | "exhaustion"
                    | "absorption",
                signalStatus: "rejected",
                price: rejection.price,
                parameterName,
                thresholdValue: rejection.thresholdValue,
                actualValue: rejection.actualValue,
                aggressiveVolume: rejection.aggressiveVolume,
                passiveVolume: rejection.passiveVolume,
                priceEfficiency: rejection.priceEfficiency,
                confidence: rejection.confidence,
                priceMovement90min: priceMovement,
                wasTopOrBottomSignal,
                signalType,
                correctDecision: !wasTopOrBottomSignal, // Correct if rejected noise
                missedOpportunity: wasTopOrBottomSignal, // Missed if rejected top/bottom
                falsePositive: false, // Can't be false positive if rejected
            };
        } catch {
            return null;
        }
    }

    /**
     * Analyze a successful signal
     */
    private async analyzeSuccessfulSignal(
        success: SuccessfulSignalData
    ): Promise<CompleteSignalAnalysis | null> {
        try {
            const priceMovement = await this.getPriceMovement90Min(
                success.timestamp,
                success.price
            );
            const absMovement = Math.abs(priceMovement);
            const wasTopOrBottomSignal = absMovement >= 0.007; // 0.7% threshold

            let signalType: "top" | "bottom" | "noise" = "noise";
            if (wasTopOrBottomSignal) {
                signalType = priceMovement >= 0.007 ? "bottom" : "top";
            }

            // For successful signals, we need to determine which parameter would have been most restrictive
            const parameterName =
                this.determineKeyParameterForSuccessfulSignal(success);
            const thresholdValue = this.getThresholdValueForParameter(
                success,
                parameterName
            );
            const actualValue = this.getActualValueForParameter(
                success,
                parameterName
            );

            return {
                timestamp: success.timestamp,
                detectorType: success.detectorType as
                    | "exhaustion"
                    | "absorption",
                signalStatus: "successful",
                price: success.price,
                parameterName,
                thresholdValue,
                actualValue,
                aggressiveVolume: success.aggressiveVolume || 0,
                passiveVolume: success.passiveVolume || 0,
                priceEfficiency: success.priceEfficiency,
                confidence: success.confidence || 0,
                priceMovement90min: priceMovement,
                wasTopOrBottomSignal,
                signalType,
                correctDecision: wasTopOrBottomSignal, // Correct if successful top/bottom
                missedOpportunity: false, // Can't be missed opportunity if successful
                falsePositive: !wasTopOrBottomSignal, // False positive if successful noise
            };
        } catch {
            return null;
        }
    }

    /**
     * Get actual price movement 90 minutes after timestamp from database
     */
    private getPriceMovement90Min(
        timestamp: number,
        originalPrice: number
    ): Promise<number> {
        try {
            const db = new Database(this.dbPath);
            const futureTimestamp = timestamp + 90 * 60 * 1000;

            // Query for price data 90 minutes after the signal
            const priceQuery = `
                SELECT price 
                FROM trades 
                WHERE timestamp >= ? AND timestamp <= ?
                ORDER BY timestamp ASC
                LIMIT 50
            `;

            const prices = db
                .prepare(priceQuery)
                .all(
                    futureTimestamp,
                    futureTimestamp + 5 * 60 * 1000
                ) as Array<{ price: number }>;
            db.close();

            if (prices.length === 0) {
                // No data available, return 0 movement
                return Promise.resolve(0);
            }

            // Calculate average price in the 5-minute window after 90 minutes
            const averagePrice =
                prices.reduce((sum: number, row) => sum + row.price, 0) /
                prices.length;

            // Return percentage movement
            return Promise.resolve(
                (averagePrice - originalPrice) / originalPrice
            );
        } catch (error) {
            this.logger.warn("Failed to query price movement from database", {
                timestamp,
                originalPrice,
                error: error instanceof Error ? error.message : String(error),
            });
            // Return 0 if database query fails
            return Promise.resolve(0);
        }
    }

    /**
     * Map rejection reason to parameter name
     */
    private mapRejectionReasonToParameter(rejectionReason: string): string {
        const mapping: Record<string, string> = {
            trade_quantity_too_small: "minAggVolume",
            insufficient_aggressive_volume: "minAggVolume",
            passive_volume_ratio_too_low: "passiveAbsorptionThreshold",
            balanced_institutional_flow: "balanceThreshold",
            price_efficiency_too_low: "priceEfficiencyThreshold",
            confidence_too_low: "minEnhancedConfidenceThreshold",
        };
        return mapping[rejectionReason] || "unknown";
    }

    /**
     * Determine key parameter for successful signal
     */
    private determineKeyParameterForSuccessfulSignal(
        success: SuccessfulSignalData
    ): string {
        // For successful signals, identify the most restrictive parameter
        if (success.detectorType === "exhaustion") {
            return "minAggVolume"; // Most common restrictive parameter
        } else {
            return "minAggVolume"; // Most common restrictive parameter for absorption
        }
    }

    /**
     * Get threshold value for parameter from actual config.json - ALL 40+ parameters
     */
    private getThresholdValueForParameter(
        success: SuccessfulSignalData,
        parameterName: string
    ): number {
        // Get actual threshold values from config based on detector type and parameter
        if (success.detectorType === "absorption") {
            const config = Config.ABSORPTION_DETECTOR;
            const mapping: Record<string, number> = {
                minAggVolume: config.minAggVolume,
                timeWindowIndex: config.timeWindowIndex,
                eventCooldownMs: config.eventCooldownMs,
                priceEfficiencyThreshold: config.priceEfficiencyThreshold,
                maxPriceImpactRatio: config.maxPriceImpactRatio,
                minPassiveMultiplier: config.minPassiveMultiplier,
                passiveAbsorptionThreshold: config.passiveAbsorptionThreshold,
                expectedMovementScalingFactor:
                    config.expectedMovementScalingFactor,
                maxZoneCountForScoring: config.maxZoneCountForScoring,
                balanceThreshold: config.balanceThreshold,
            };
            return mapping[parameterName] || 0;
        } else if (success.detectorType === "exhaustion") {
            const config = Config.EXHAUSTION_DETECTOR;
            const mapping: Record<string, number> = {
                minAggVolume: config.minAggVolume,
                timeWindowIndex: config.timeWindowIndex,
                exhaustionThreshold: config.exhaustionThreshold,
                eventCooldownMs: config.eventCooldownMs,
                passiveRatioBalanceThreshold:
                    config.passiveRatioBalanceThreshold,
            };
            return mapping[parameterName] || 0;
        }
        return 0;
    }

    /**
     * Get config threshold value by detector type and parameter name
     */
    private getConfigThresholdValue(
        detectorType: "exhaustion" | "absorption",
        parameterName: string
    ): number {
        if (detectorType === "absorption") {
            const config = Config.ABSORPTION_DETECTOR;
            const mapping: Record<string, number> = {
                minAggVolume: config.minAggVolume,
                timeWindowIndex: config.timeWindowIndex,
                eventCooldownMs: config.eventCooldownMs,
                priceEfficiencyThreshold: config.priceEfficiencyThreshold,
                maxPriceImpactRatio: config.maxPriceImpactRatio,
                minPassiveMultiplier: config.minPassiveMultiplier,
                passiveAbsorptionThreshold: config.passiveAbsorptionThreshold,
                expectedMovementScalingFactor:
                    config.expectedMovementScalingFactor,
                maxZoneCountForScoring: config.maxZoneCountForScoring,
                balanceThreshold: config.balanceThreshold,
            };
            return mapping[parameterName] || 0;
        } else if (detectorType === "exhaustion") {
            const config = Config.EXHAUSTION_DETECTOR;
            const mapping: Record<string, number> = {
                minAggVolume: config.minAggVolume,
                timeWindowIndex: config.timeWindowIndex,
                exhaustionThreshold: config.exhaustionThreshold,
                eventCooldownMs: config.eventCooldownMs,
                passiveRatioBalanceThreshold:
                    config.passiveRatioBalanceThreshold,
            };
            return mapping[parameterName] || 0;
        }
        return 0;
    }

    /**
     * Get actual value for parameter
     */
    private getActualValueForParameter(
        success: SuccessfulSignalData,
        parameterName: string
    ): number {
        const mapping: Record<string, keyof SuccessfulSignalData> = {
            minAggVolume: "aggressiveVolume",
            passiveAbsorptionThreshold: "passiveVolume",
            priceEfficiencyThreshold: "priceEfficiency",
            confidence: "confidence",
        };
        const field = mapping[parameterName];
        return field ? (success[field] as number) || 0 : 0;
    }

    /**
     * Calculate comprehensive parameter recommendations
     */
    private calculateParameterRecommendations(
        analyses: CompleteSignalAnalysis[]
    ): ParameterRecommendation[] {
        const recommendations: ParameterRecommendation[] = [];

        // Group by detector type and parameter
        const groups = this.groupAnalysesByDetectorAndParameter(analyses);

        for (const [detectorType, parameterGroups] of Object.entries(groups)) {
            for (const [parameterName, parameterAnalyses] of Object.entries(
                parameterGroups
            )) {
                const recommendation = this.calculateParameterRecommendation(
                    detectorType as "exhaustion" | "absorption",
                    parameterName,
                    parameterAnalyses
                );

                if (recommendation) {
                    recommendations.push(recommendation);
                }
            }
        }

        return recommendations;
    }

    /**
     * Group analyses by detector and parameter
     */
    private groupAnalysesByDetectorAndParameter(
        analyses: CompleteSignalAnalysis[]
    ): Record<string, Record<string, CompleteSignalAnalysis[]>> {
        const grouped: Record<
            string,
            Record<string, CompleteSignalAnalysis[]>
        > = {};

        for (const analysis of analyses) {
            if (!grouped[analysis.detectorType]) {
                grouped[analysis.detectorType] = {};
            }
            if (!grouped[analysis.detectorType]![analysis.parameterName]) {
                grouped[analysis.detectorType]![analysis.parameterName] = [];
            }
            grouped[analysis.detectorType]![analysis.parameterName]!.push(
                analysis
            );
        }

        return grouped;
    }

    /**
     * Calculate recommendation for a single parameter
     */
    private calculateParameterRecommendation(
        detectorType: "exhaustion" | "absorption",
        parameterName: string,
        analyses: CompleteSignalAnalysis[]
    ): ParameterRecommendation | null {
        if (analyses.length === 0) return null;

        const successful = analyses.filter(
            (a) => a.signalStatus === "successful"
        );
        const rejected = analyses.filter((a) => a.signalStatus === "rejected");

        const missedTopBottom = rejected.filter(
            (a) => a.wasTopOrBottomSignal
        ).length;
        const capturedTopBottom = successful.filter(
            (a) => a.wasTopOrBottomSignal
        ).length;
        const noiseRejected = rejected.filter(
            (a) => !a.wasTopOrBottomSignal
        ).length;
        const noiseAccepted = successful.filter(
            (a) => !a.wasTopOrBottomSignal
        ).length;

        const totalTopBottom = missedTopBottom + capturedTopBottom;
        const currentPrecision =
            successful.length > 0 ? capturedTopBottom / successful.length : 0;
        const currentRecall =
            totalTopBottom > 0 ? capturedTopBottom / totalTopBottom : 0;

        // Calculate recommended threshold using actual config values
        const currentThreshold = this.getConfigThresholdValue(
            detectorType,
            parameterName
        );
        let recommendedThreshold = currentThreshold;
        let optimizationReason = "Current threshold appears optimal";
        // Determine urgency based on confidence score and missed opportunities
        let urgencyLevel: "high" | "medium" | "low" = "low";
        const confidenceScore = analyses.length > 10 ? 0.9 : 0.7;

        if (missedTopBottom > 0) {
            // We're missing top/bottom signals - need to relax threshold
            const missedValues = rejected
                .filter((a) => a.wasTopOrBottomSignal)
                .map((a) => a.actualValue);
            const isMinThreshold = [
                "minAggVolume",
                "priceEfficiencyThreshold",
            ].includes(parameterName);

            if (isMinThreshold) {
                recommendedThreshold = Math.min(...missedValues) * 0.99;
            } else {
                recommendedThreshold = Math.max(...missedValues) * 1.01;
            }

            optimizationReason = `Relax threshold to capture ${missedTopBottom} missed top/bottom signals`;

            // Urgency based on confidence and number of missed signals
            if (confidenceScore >= 0.85 && missedTopBottom > 2) {
                urgencyLevel = "high";
            } else if (confidenceScore >= 0.7 && missedTopBottom > 0) {
                urgencyLevel = "medium";
            } else {
                urgencyLevel = "low";
            }
        }

        const projectedPrecision = Math.min(1.0, currentPrecision + 0.1); // Estimated improvement
        const projectedRecall = Math.min(
            1.0,
            (capturedTopBottom + missedTopBottom) / Math.max(1, totalTopBottom)
        );

        return {
            detectorType,
            parameterName,
            currentThreshold,
            recommendedThreshold,
            totalSignals: analyses.length,
            successfulSignals: successful.length,
            rejectedSignals: rejected.length,
            missedTopBottomSignals: missedTopBottom,
            capturedTopBottomSignals: capturedTopBottom,
            noiseSignalsRejected: noiseRejected,
            noiseSignalsAccepted: noiseAccepted,
            currentPrecision,
            currentRecall,
            projectedPrecision,
            projectedRecall,
            optimizationReason,
            confidenceScore,
            urgencyLevel,
        };
    }

    /**
     * Send Claude app notification with recommendations
     */
    private async sendClaudeAppNotification(
        recommendations: ParameterRecommendation[],
        analyses: CompleteSignalAnalysis[],
        timestamp: string
    ): Promise<void> {
        const highPriorityRecs = recommendations.filter(
            (r) => r.urgencyLevel === "high"
        );
        const mediumPriorityRecs = recommendations.filter(
            (r) => r.urgencyLevel === "medium"
        );

        const notificationMessage = this.formatNotificationMessage(
            recommendations,
            analyses,
            timestamp
        );

        // Write notification to timestamped file (doesn't overwrite)
        const reportTimestamp = timestamp
            .replace(/[:.]/g, "-")
            .split("T")
            .join("_");
        const notificationPath = path.join(
            this.outputDir,
            `optimization_notification_${reportTimestamp}.json`
        );

        // Also create/update a "latest" file for easy monitoring
        const latestNotificationPath = path.join(
            this.outputDir,
            "latest_optimization_notification.json"
        );
        const notification = {
            timestamp,
            urgency:
                highPriorityRecs.length > 0
                    ? "high"
                    : mediumPriorityRecs.length > 0
                      ? "medium"
                      : "low",
            title: "90-Minute Parameter Optimization Results",
            message: notificationMessage,
            recommendations,
            summary: {
                totalSignalsAnalyzed: analyses.length,
                missedOpportunities: analyses.filter((a) => a.missedOpportunity)
                    .length,
                falsePositives: analyses.filter((a) => a.falsePositive).length,
                recommendationsCount: recommendations.length,
                highPriorityCount: highPriorityRecs.length,
            },
        };

        // Write both timestamped and latest files
        await Promise.all([
            fs.writeFile(
                notificationPath,
                JSON.stringify(notification, null, 2)
            ),
            fs.writeFile(
                latestNotificationPath,
                JSON.stringify(notification, null, 2)
            ),
        ]);

        this.logger.info("Optimization notifications written", {
            timestampedFile: notificationPath,
            latestFile: latestNotificationPath,
            urgency: notification.urgency,
            recommendationsCount: recommendations.length,
            highPriorityCount: highPriorityRecs.length,
        });
    }

    /**
     * Format notification message
     */
    private formatNotificationMessage(
        recommendations: ParameterRecommendation[],
        analyses: CompleteSignalAnalysis[],
        timestamp: string
    ): string {
        const totalSignals = analyses.length;
        const missedOpportunities = analyses.filter(
            (a) => a.missedOpportunity
        ).length;
        const falsePositives = analyses.filter((a) => a.falsePositive).length;

        let message = `🎯 90-Minute Signal Analysis Complete\n\n`;
        message += `📊 Analysis Summary:\n`;
        message += `• Total signals analyzed: ${totalSignals}\n`;
        message += `• Missed top/bottom opportunities: ${missedOpportunities}\n`;
        message += `• False positive noise signals: ${falsePositives}\n\n`;

        if (recommendations.length === 0) {
            message += `✅ All parameters appear optimal - no changes recommended`;
            return message;
        }

        message += `🔧 Parameter Recommendations:\n\n`;

        for (const rec of recommendations) {
            const changePercent = (
                ((rec.recommendedThreshold - rec.currentThreshold) /
                    rec.currentThreshold) *
                100
            ).toFixed(1);
            const direction =
                rec.recommendedThreshold > rec.currentThreshold ? "↑" : "↓";

            message += `${rec.urgencyLevel === "high" ? "🔴" : rec.urgencyLevel === "medium" ? "🟡" : "🟢"} `;
            message += `${rec.detectorType.toUpperCase()}.${rec.parameterName}\n`;
            message += `   Current: ${rec.currentThreshold}\n`;
            message += `   Recommended: ${rec.recommendedThreshold} (${direction}${Math.abs(parseFloat(changePercent))}%)\n`;
            message += `   Reason: ${rec.optimizationReason}\n`;
            message += `   Impact: Capture ${rec.missedTopBottomSignals} more signals, filter ${rec.noiseSignalsRejected} noise\n\n`;
        }

        message += `⏰ Analysis time: ${new Date(timestamp).toLocaleString()}\n`;
        message += `🔄 Next analysis: ${new Date(Date.now() + 90 * 60 * 1000).toLocaleString()}`;

        return message;
    }

    /**
     * Save detailed analysis report
     */
    private async saveAnalysisReport(
        recommendations: ParameterRecommendation[],
        analyses: CompleteSignalAnalysis[],
        timestamp: string
    ): Promise<void> {
        try {
            const reportTimestamp = timestamp
                .replace(/[:.]/g, "-")
                .split("T")
                .join("_");
            const reportPath = path.join(
                this.outputDir,
                `complete_analysis_${reportTimestamp}.json`
            );

            const report = {
                timestamp,
                analysisType: "complete_signal_analysis",
                analysisWindow: "90 minutes",
                summary: {
                    totalSignalsAnalyzed: analyses.length,
                    successfulSignals: analyses.filter(
                        (a) => a.signalStatus === "successful"
                    ).length,
                    rejectedSignals: analyses.filter(
                        (a) => a.signalStatus === "rejected"
                    ).length,
                    topBottomSignalsFound: analyses.filter(
                        (a) => a.wasTopOrBottomSignal
                    ).length,
                    noiseSignalsFound: analyses.filter(
                        (a) => !a.wasTopOrBottomSignal
                    ).length,
                    missedOpportunities: analyses.filter(
                        (a) => a.missedOpportunity
                    ).length,
                    falsePositives: analyses.filter((a) => a.falsePositive)
                        .length,
                    correctDecisions: analyses.filter((a) => a.correctDecision)
                        .length,
                },
                recommendations,
                detailedAnalyses: analyses,
            };

            await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

            this.logger.info("Complete analysis report saved", {
                reportPath,
                analysesCount: analyses.length,
                recommendationsCount: recommendations.length,
            });
        } catch (error) {
            this.logger.error("Failed to save analysis report", {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
}
