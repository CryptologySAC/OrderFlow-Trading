import { EventEmitter } from "events";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";

/**
 * A/B Testing Configuration for Absorption Detector
 */
export interface AbsorptionABTestConfig {
    testId: string;
    name: string;
    description: string;
    variants: AbsorptionVariant[];
    trafficSplit: number[]; // Percentage split between variants (must sum to 100)
    durationHours: number;
    minSamplesPerVariant: number;
    successMetric: "tpHitRate" | "profitFactor" | "winRate";
}

/**
 * Absorption Detector Variant Configuration
 */
export interface AbsorptionVariant {
    variantId: string;
    name: string;
    description: string;

    // Threshold configurations
    thresholds: {
        passiveAbsorptionThreshold: number;
        minPassiveMultiplier: number;
        priceEfficiencyThreshold: number;
        minAggVolume: number;
        balanceThreshold: number;
        priceStabilityTicks: number;
        absorptionDirectionThreshold: number;
        minPassiveVolumeForDirection: number;
        useZoneSpecificPassiveVolume: boolean;
    };

    // Phase timing configurations
    phaseTiming: {
        maxDistanceFromExtreme: number; // 0.001 = 0.1%
        requirePhaseConfirmation: boolean;
        allowSidewaysPhases: boolean;
    };

    // Risk management configurations
    riskManagement: {
        vwapMaxDeviation: number; // 0.025 = 2.5%
        rsiFilterEnabled: boolean;
        rsiOverboughtThreshold: number;
        rsiOversoldThreshold: number;
        oirMinStrength: number;
    };
}

/**
 * A/B Test Results
 */
export interface ABTestResults {
    testId: string;
    variantResults: VariantResult[];
    winner: string | null;
    confidence: number;
    totalSamples: number;
    testDuration: number;
    recommendations: string[];
}

/**
 * Individual Variant Performance
 */
export interface VariantResult {
    variantId: string;
    name: string;
    samples: number;
    metrics: {
        totalSignals: number;
        successfulSignals: number;
        failedSignals: number;
        tpHitRate: number;
        avgProfit: number;
        profitFactor: number;
        winRate: number;
        avgTimeToTP: number;
        buySignals: number;
        sellSignals: number;
    };
    phaseDistribution: {
        upPhase: number;
        downPhase: number;
        sidewaysPhase: number;
        noPhase: number;
    };
    riskMetrics: {
        avgDrawdown: number;
        maxDrawdown: number;
        vwapRejections: number;
        rsiRejections: number;
        oirRejections: number;
    };
}

/**
 * A/B Testing Manager for Absorption Detector Optimization
 */
export class AbsorptionABTestManager extends EventEmitter {
    private activeTests: Map<string, AbsorptionABTestConfig> = new Map();
    private testResults: Map<string, ABTestResults> = new Map();
    private variantAssignments: Map<string, string> = new Map(); // detectorId -> variantId

    constructor(
        private readonly logger: ILogger,
        private readonly metrics: IMetricsCollector
    ) {
        super();
    }

    /**
     * Start a new A/B test
     */
    public startTest(config: AbsorptionABTestConfig): void {
        // Validate configuration
        if (
            config.trafficSplit.reduce((sum, split) => sum + split, 0) !== 100
        ) {
            throw new Error("Traffic split must sum to 100%");
        }

        if (config.variants.length !== config.trafficSplit.length) {
            throw new Error(
                "Number of variants must match traffic split array length"
            );
        }

        this.activeTests.set(config.testId, config);
        this.logger.info("AbsorptionABTestManager: Started A/B test", {
            testId: config.testId,
            name: config.name,
            variants: config.variants.length,
            durationHours: config.durationHours,
        });

        this.emit("testStarted", config);

        // Record test start in metrics
        this.metrics.incrementCounter("ab_test_started", 1, {
            testId: config.testId,
            name: config.name,
        });
    }

    /**
     * Assign detector to a test variant
     */
    public assignVariant(
        detectorId: string,
        testId: string
    ): AbsorptionVariant | null {
        const test = this.activeTests.get(testId);
        if (!test) {
            this.logger.warn("AbsorptionABTestManager: Test not found", {
                testId,
                detectorId,
            });
            return null;
        }

        // Check if already assigned
        if (this.variantAssignments.has(detectorId)) {
            const existingVariantId = this.variantAssignments.get(detectorId)!;
            const variant = test.variants.find(
                (v) => v.variantId === existingVariantId
            );
            return variant ?? null;
        }

        // Ensure we have variants to assign
        if (test.variants.length === 0) {
            this.logger.error(
                "AbsorptionABTestManager: No variants available for test",
                { testId }
            );
            return null;
        }

        // Assign based on traffic split
        const random = Math.random() * 100;
        let cumulativeSplit = 0;

        for (let i = 0; i < test.variants.length; i++) {
            const trafficSplit = test.trafficSplit[i] ?? 0; // Default to 0 if undefined
            cumulativeSplit += trafficSplit;
            if (random <= cumulativeSplit) {
                const variant = test.variants[i];
                if (!variant) continue; // Safety check

                this.variantAssignments.set(detectorId, variant.variantId);

                this.logger.info("AbsorptionABTestManager: Assigned variant", {
                    detectorId,
                    testId,
                    variantId: variant.variantId,
                    variantName: variant.name,
                });

                return variant;
            }
        }

        // Fallback to first variant
        const fallbackVariant = test.variants[0];
        if (!fallbackVariant) {
            this.logger.error(
                "AbsorptionABTestManager: No fallback variant available",
                { testId }
            );
            return null;
        }

        this.variantAssignments.set(detectorId, fallbackVariant.variantId);
        return fallbackVariant;
    }

    /**
     * Record signal result for A/B testing
     */
    public recordSignalResult(
        detectorId: string,
        testId: string,
        variantId: string,
        signalResult: {
            signalId: string;
            side: "buy" | "sell";
            price: number;
            phaseDirection?: string;
            reachedTP: boolean;
            profit: number;
            timeToTP: number;
            maxDrawdown: number;
            riskReason?: string;
        }
    ): void {
        const test = this.activeTests.get(testId);
        if (!test) return;

        this.logger.debug("AbsorptionABTestManager: Recorded signal result", {
            detectorId,
            testId,
            variantId,
            signalId: signalResult.signalId,
            side: signalResult.side,
            reachedTP: signalResult.reachedTP,
            profit: signalResult.profit,
        });

        // Emit event for result processing
        this.emit("signalResult", {
            testId,
            variantId,
            result: signalResult,
        });
    }

    /**
     * Get current test results
     */
    public getTestResults(testId: string): ABTestResults | null {
        return this.testResults.get(testId) || null;
    }

    /**
     * Stop a test and calculate final results
     */
    public stopTest(testId: string): ABTestResults | null {
        const test = this.activeTests.get(testId);
        if (!test) return null;

        // Calculate results (simplified - would need actual result aggregation)
        const results: ABTestResults = {
            testId,
            variantResults: [], // Would be populated from actual data
            winner: null,
            confidence: 0,
            totalSamples: 0,
            testDuration: Date.now() - Date.now(), // Would calculate actual duration
            recommendations: [],
        };

        this.testResults.set(testId, results);
        this.activeTests.delete(testId);

        this.logger.info("AbsorptionABTestManager: Stopped A/B test", {
            testId,
            winner: results.winner,
            confidence: results.confidence,
        });

        this.emit("testCompleted", results);
        return results;
    }

    /**
     * Get all active tests
     */
    public getActiveTests(): AbsorptionABTestConfig[] {
        return Array.from(this.activeTests.values());
    }

    /**
     * Create default A/B test configuration for absorption optimization
     */
    public createDefaultTest(): AbsorptionABTestConfig {
        return {
            testId: `absorption-optimization-${Date.now()}`,
            name: "Absorption Detector Optimization",
            description:
                "Testing different threshold combinations for absorption signals",
            variants: [
                {
                    variantId: "conservative",
                    name: "Conservative Thresholds",
                    description: "Higher thresholds for quality over quantity",
                    thresholds: {
                        passiveAbsorptionThreshold: 0.9,
                        minPassiveMultiplier: 20,
                        priceEfficiencyThreshold: 0.001,
                        minAggVolume: 200,
                        balanceThreshold: 0.15,
                        priceStabilityTicks: 7,
                        absorptionDirectionThreshold: 0.7,
                        minPassiveVolumeForDirection: 15,
                        useZoneSpecificPassiveVolume: true,
                    },
                    phaseTiming: {
                        maxDistanceFromExtreme: 0.0005, // 0.05%
                        requirePhaseConfirmation: true,
                        allowSidewaysPhases: false,
                    },
                    riskManagement: {
                        vwapMaxDeviation: 0.02,
                        rsiFilterEnabled: true,
                        rsiOverboughtThreshold: 75,
                        rsiOversoldThreshold: 25,
                        oirMinStrength: 0.15,
                    },
                },
                {
                    variantId: "balanced",
                    name: "Balanced Thresholds",
                    description:
                        "Moderate thresholds balancing quality and frequency",
                    thresholds: {
                        passiveAbsorptionThreshold: 0.85,
                        minPassiveMultiplier: 15,
                        priceEfficiencyThreshold: 0.002,
                        minAggVolume: 174,
                        balanceThreshold: 0.1,
                        priceStabilityTicks: 5,
                        absorptionDirectionThreshold: 0.6,
                        minPassiveVolumeForDirection: 10,
                        useZoneSpecificPassiveVolume: true,
                    },
                    phaseTiming: {
                        maxDistanceFromExtreme: 0.001, // 0.1%
                        requirePhaseConfirmation: true,
                        allowSidewaysPhases: true,
                    },
                    riskManagement: {
                        vwapMaxDeviation: 0.025,
                        rsiFilterEnabled: true,
                        rsiOverboughtThreshold: 75,
                        rsiOversoldThreshold: 25,
                        oirMinStrength: 0.1,
                    },
                },
                {
                    variantId: "aggressive",
                    name: "Aggressive Thresholds",
                    description: "Lower thresholds for higher frequency",
                    thresholds: {
                        passiveAbsorptionThreshold: 0.75,
                        minPassiveMultiplier: 10,
                        priceEfficiencyThreshold: 0.003,
                        minAggVolume: 150,
                        balanceThreshold: 0.05,
                        priceStabilityTicks: 3,
                        absorptionDirectionThreshold: 0.55,
                        minPassiveVolumeForDirection: 8,
                        useZoneSpecificPassiveVolume: false,
                    },
                    phaseTiming: {
                        maxDistanceFromExtreme: 0.002, // 0.2%
                        requirePhaseConfirmation: false,
                        allowSidewaysPhases: true,
                    },
                    riskManagement: {
                        vwapMaxDeviation: 0.03,
                        rsiFilterEnabled: false,
                        rsiOverboughtThreshold: 80,
                        rsiOversoldThreshold: 20,
                        oirMinStrength: 0.05,
                    },
                },
            ],
            trafficSplit: [33, 34, 33], // Roughly equal split
            durationHours: 24, // 24 hours test
            minSamplesPerVariant: 50,
            successMetric: "profitFactor",
        };
    }
}
