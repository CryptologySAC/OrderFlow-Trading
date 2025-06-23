// src/backtesting/configMatrix.ts

import type {
    HiddenOrderDetectorConfig,
    IcebergDetectorConfig,
    SpoofingDetectorConfig,
} from "../services/index.js";
import type {
    AbsorptionSettings,
    ExhaustionSettings,
    DeltaCVDConfirmationSettings,
    AccumulationSettings,
    SuperiorFlowSettings,
} from "../indicators/index.js";
import type { SupportResistanceConfig } from "../indicators/supportResistanceDetector.js";

export interface ConfigurationMatrix {
    hiddenOrderDetector: Array<Partial<HiddenOrderDetectorConfig>>;
    icebergDetector: Array<Partial<IcebergDetectorConfig>>;
    spoofingDetector: Array<Partial<SpoofingDetectorConfig>>;
    absorptionDetector: Array<Partial<AbsorptionSettings>>;
    exhaustionDetector: Array<Partial<ExhaustionSettings>>;
    deltaCVDDetector: Array<Partial<DeltaCVDConfirmationSettings>>;
    accumulationDetector: Array<Partial<AccumulationSettings>>;
    distributionDetector: Array<Partial<SuperiorFlowSettings>>;
    supportResistanceDetector: Array<Partial<SupportResistanceConfig>>;
}

export interface TestConfiguration {
    id: string;
    detectorType: keyof ConfigurationMatrix;
    config: Record<string, unknown>;
    description: string;
    profile:
        | "conservative"
        | "balanced"
        | "aggressive"
        | "custom"
        | "simplified_no_passive"
        | "simplified_with_passive"
        | "current_complex";
}

export interface ConfigMatrixOptions {
    includeProfiles?: boolean;
    includeGridSearch?: boolean;
    gridSearchPoints?: number;
    customRanges?: Partial<ConfigurationMatrix>;
    singleDetector?: keyof ConfigurationMatrix;
    hierarchicalTesting?: boolean;
    phase?: 1 | 2;
    phase1Results?: TestConfiguration[];
}

/**
 * Configuration Matrix Generator for Detector Backtesting
 *
 * Generates comprehensive parameter combinations for testing detector performance
 * across different market conditions and sensitivity levels.
 */
export class ConfigMatrix {
    private options: ConfigMatrixOptions;

    constructor(options: ConfigMatrixOptions = {}) {
        this.options = {
            includeProfiles: true,
            includeGridSearch: true,
            gridSearchPoints: 4,
            singleDetector: "deltaCVDDetector",
            hierarchicalTesting: false,
            phase: 1,
            ...options,
        };
    }

    /**
     * Generate all test configurations for all detectors or single detector
     */
    public generateAllConfigurations(): TestConfiguration[] {
        const configurations: TestConfiguration[] = [];

        if (this.options.singleDetector) {
            // Single detector mode
            const detectorConfigs = this.generateDetectorConfigurations(
                this.options.singleDetector
            );
            configurations.push(...detectorConfigs);
        } else {
            // Multi-detector mode (original behavior)
            const detectorTypes: Array<keyof ConfigurationMatrix> = [
                "deltaCVDDetector",
                "hiddenOrderDetector",
                "icebergDetector",
                "spoofingDetector",
                "absorptionDetector",
                "exhaustionDetector",
                "accumulationDetector",
                "distributionDetector",
                "supportResistanceDetector",
            ];

            for (const detectorType of detectorTypes) {
                const detectorConfigs =
                    this.generateDetectorConfigurations(detectorType);
                configurations.push(...detectorConfigs);
            }
        }

        return configurations;
    }

    /**
     * Generate configurations for a specific detector
     */
    public generateDetectorConfigurations(
        detectorType: keyof ConfigurationMatrix
    ): TestConfiguration[] {
        const configurations: TestConfiguration[] = [];

        if (this.options.hierarchicalTesting) {
            // Hierarchical testing mode
            if (this.options.phase === 1) {
                configurations.push(
                    ...this.generatePhase1Configurations(detectorType)
                );
            } else if (this.options.phase === 2) {
                configurations.push(
                    ...this.generatePhase2Configurations(detectorType)
                );
            }
        } else {
            // Standard testing mode
            // Add profile-based configurations
            if (this.options.includeProfiles) {
                configurations.push(
                    ...this.generateProfileConfigurations(detectorType)
                );
            }

            // Add grid search configurations
            if (this.options.includeGridSearch) {
                configurations.push(
                    ...this.generateGridSearchConfigurations(detectorType)
                );
            }
        }

        return configurations;
    }

    /**
     * Generate profile-based configurations (conservative, balanced, aggressive)
     */
    private generateProfileConfigurations(
        detectorType: keyof ConfigurationMatrix
    ): TestConfiguration[] {
        const configurations: TestConfiguration[] = [];

        switch (detectorType) {
            case "hiddenOrderDetector":
                configurations.push(
                    {
                        id: `hidden_conservative`,
                        detectorType,
                        config: {
                            minHiddenVolume: 20,
                            minTradeSize: 10,
                            minConfidence: 0.9,
                            priceTolerance: 0.0001,
                            maxDepthAgeMs: 500,
                        },
                        description:
                            "Conservative hidden order detection with high confidence",
                        profile: "conservative",
                    },
                    {
                        id: `hidden_balanced`,
                        detectorType,
                        config: {
                            minHiddenVolume: 10,
                            minTradeSize: 5,
                            minConfidence: 0.8,
                            priceTolerance: 0.001,
                            maxDepthAgeMs: 1000,
                        },
                        description: "Balanced hidden order detection",
                        profile: "balanced",
                    },
                    {
                        id: `hidden_aggressive`,
                        detectorType,
                        config: {
                            minHiddenVolume: 5,
                            minTradeSize: 2,
                            minConfidence: 0.6,
                            priceTolerance: 0.01,
                            maxDepthAgeMs: 2000,
                        },
                        description:
                            "Aggressive hidden order detection with lower thresholds",
                        profile: "aggressive",
                    }
                );
                break;

            case "icebergDetector":
                configurations.push(
                    {
                        id: `iceberg_conservative`,
                        detectorType,
                        config: {
                            minRefillCount: 5,
                            maxSizeVariation: 0.1,
                            minTotalSize: 100,
                            institutionalSizeThreshold: 20,
                            maxRefillTimeMs: 15000,
                        },
                        description:
                            "Conservative iceberg detection for large institutional orders",
                        profile: "conservative",
                    },
                    {
                        id: `iceberg_balanced`,
                        detectorType,
                        config: {
                            minRefillCount: 3,
                            maxSizeVariation: 0.2,
                            minTotalSize: 50,
                            institutionalSizeThreshold: 10,
                            maxRefillTimeMs: 30000,
                        },
                        description: "Balanced iceberg detection",
                        profile: "balanced",
                    },
                    {
                        id: `iceberg_aggressive`,
                        detectorType,
                        config: {
                            minRefillCount: 2,
                            maxSizeVariation: 0.3,
                            minTotalSize: 25,
                            institutionalSizeThreshold: 5,
                            maxRefillTimeMs: 60000,
                        },
                        description:
                            "Aggressive iceberg detection for smaller fragmented orders",
                        profile: "aggressive",
                    }
                );
                break;

            case "spoofingDetector":
                configurations.push(
                    {
                        id: `spoofing_conservative`,
                        detectorType,
                        config: {
                            minWallSize: 100,
                            maxCancellationRatio: 0.9,
                            rapidCancellationMs: 200,
                            ghostLiquidityThresholdMs: 100,
                        },
                        description:
                            "Conservative spoofing detection for obvious manipulation",
                        profile: "conservative",
                    },
                    {
                        id: `spoofing_balanced`,
                        detectorType,
                        config: {
                            minWallSize: 50,
                            maxCancellationRatio: 0.8,
                            rapidCancellationMs: 500,
                            ghostLiquidityThresholdMs: 200,
                        },
                        description: "Balanced spoofing detection",
                        profile: "balanced",
                    },
                    {
                        id: `spoofing_aggressive`,
                        detectorType,
                        config: {
                            minWallSize: 20,
                            maxCancellationRatio: 0.6,
                            rapidCancellationMs: 1000,
                            ghostLiquidityThresholdMs: 500,
                        },
                        description:
                            "Aggressive spoofing detection for subtle manipulation",
                        profile: "aggressive",
                    }
                );
                break;

            case "absorptionDetector":
                configurations.push(
                    {
                        id: `absorption_conservative`,
                        detectorType,
                        config: {
                            minAggVolume: 1000,
                            absorptionThreshold: 0.85,
                            minPassiveMultiplier: 3.0,
                            eventCooldownMs: 30000,
                        },
                        description:
                            "Conservative absorption detection for strong signals",
                        profile: "conservative",
                    },
                    {
                        id: `absorption_balanced`,
                        detectorType,
                        config: {
                            minAggVolume: 600,
                            absorptionThreshold: 0.75,
                            minPassiveMultiplier: 2.0,
                            eventCooldownMs: 15000,
                        },
                        description: "Balanced absorption detection",
                        profile: "balanced",
                    },
                    {
                        id: `absorption_aggressive`,
                        detectorType,
                        config: {
                            minAggVolume: 300,
                            absorptionThreshold: 0.65,
                            minPassiveMultiplier: 1.5,
                            eventCooldownMs: 5000,
                        },
                        description:
                            "Aggressive absorption detection for early signals",
                        profile: "aggressive",
                    }
                );
                break;

            case "exhaustionDetector":
                configurations.push(
                    {
                        id: `exhaustion_conservative`,
                        detectorType,
                        config: {
                            minAggVolume: 1000,
                            exhaustionThreshold: 0.8,
                            maxPassiveRatio: 0.3,
                            eventCooldownMs: 30000,
                        },
                        description: "Conservative exhaustion detection",
                        profile: "conservative",
                    },
                    {
                        id: `exhaustion_balanced`,
                        detectorType,
                        config: {
                            minAggVolume: 600,
                            exhaustionThreshold: 0.7,
                            maxPassiveRatio: 0.5,
                            eventCooldownMs: 15000,
                        },
                        description: "Balanced exhaustion detection",
                        profile: "balanced",
                    },
                    {
                        id: `exhaustion_aggressive`,
                        detectorType,
                        config: {
                            minAggVolume: 300,
                            exhaustionThreshold: 0.6,
                            maxPassiveRatio: 0.7,
                            eventCooldownMs: 5000,
                        },
                        description: "Aggressive exhaustion detection",
                        profile: "aggressive",
                    }
                );
                break;

            case "deltaCVDDetector":
                // A/B Test configurations for passive volume analysis
                configurations.push(
                    {
                        id: `deltacvd_simplified_no_passive`,
                        detectorType,
                        config: {
                            minZ: 3,
                            minTradesPerSec: 0.5,
                            minVolPerSec: 20,
                            divergenceThreshold: 0.3,
                            // SIMPLIFIED: Disable all enhancement phases
                            enableDepthAnalysis: false,
                            detectionMode: "momentum",
                            // Disable passive volume usage for core signal
                            usePassiveVolume: false,
                            // Minimal confidence requirements
                            baseConfidenceRequired: 0.3,
                            finalConfidenceRequired: 0.5,
                        },
                        description:
                            "Simplified DeltaCVD without passive depth analysis",
                        profile: "simplified_no_passive",
                    },
                    {
                        id: `deltacvd_simplified_with_passive`,
                        detectorType,
                        config: {
                            minZ: 3,
                            minTradesPerSec: 0.5,
                            minVolPerSec: 20,
                            divergenceThreshold: 0.3,
                            // SIMPLIFIED: Disable advanced phases but keep passive volume
                            enableDepthAnalysis: false,
                            detectionMode: "momentum",
                            // Test passive volume usage
                            usePassiveVolume: true,
                            // Minimal confidence requirements
                            baseConfidenceRequired: 0.3,
                            finalConfidenceRequired: 0.5,
                        },
                        description:
                            "Simplified DeltaCVD with basic passive volume analysis",
                        profile: "simplified_with_passive",
                    },
                    {
                        id: `deltacvd_current_complex`,
                        detectorType,
                        config: {
                            minZ: 3,
                            minTradesPerSec: 0.5,
                            minVolPerSec: 20,
                            divergenceThreshold: 0.3,
                            // CURRENT: All enhancement phases enabled (baseline comparison)
                            enableDepthAnalysis: true,
                            detectionMode: "hybrid",
                            usePassiveVolume: true,
                            // Higher confidence requirements due to complexity
                            baseConfidenceRequired: 0.4,
                            finalConfidenceRequired: 0.6,
                        },
                        description:
                            "Current complex DeltaCVD implementation (baseline)",
                        profile: "current_complex",
                    }
                );
                break;

            default:
                // Default profiles for other detectors
                configurations.push(
                    {
                        id: `${detectorType}_conservative`,
                        detectorType,
                        config: {},
                        description: `Conservative ${detectorType} configuration`,
                        profile: "conservative",
                    },
                    {
                        id: `${detectorType}_balanced`,
                        detectorType,
                        config: {},
                        description: `Balanced ${detectorType} configuration`,
                        profile: "balanced",
                    },
                    {
                        id: `${detectorType}_aggressive`,
                        detectorType,
                        config: {},
                        description: `Aggressive ${detectorType} configuration`,
                        profile: "aggressive",
                    }
                );
        }

        return configurations;
    }

    /**
     * Generate grid search configurations for parameter optimization
     */
    private generateGridSearchConfigurations(
        detectorType: keyof ConfigurationMatrix
    ): TestConfiguration[] {
        const configurations: TestConfiguration[] = [];
        const points = this.options.gridSearchPoints || 4;

        switch (detectorType) {
            case "hiddenOrderDetector":
                const hiddenConfigs = this.generateParameterGrid(
                    {
                        minHiddenVolume: [5, 10, 20, 50],
                        minConfidence: [0.6, 0.7, 0.8, 0.9],
                        priceTolerance: [0.0001, 0.001, 0.01],
                        minTradeSize: [2, 5, 10],
                    },
                    points
                );

                hiddenConfigs.forEach((config, index) => {
                    configurations.push({
                        id: `hidden_grid_${index}`,
                        detectorType,
                        config,
                        description: `Grid search configuration ${index} for hidden order detector`,
                        profile: "custom",
                    });
                });
                break;

            case "icebergDetector":
                const icebergConfigs = this.generateParameterGrid(
                    {
                        minRefillCount: [2, 3, 4, 5],
                        maxSizeVariation: [0.1, 0.2, 0.3, 0.4],
                        institutionalSizeThreshold: [5, 10, 15, 20],
                        minTotalSize: [25, 50, 75, 100],
                    },
                    points
                );

                icebergConfigs.forEach((config, index) => {
                    configurations.push({
                        id: `iceberg_grid_${index}`,
                        detectorType,
                        config,
                        description: `Grid search configuration ${index} for iceberg detector`,
                        profile: "custom",
                    });
                });
                break;

            case "spoofingDetector":
                const spoofingConfigs = this.generateParameterGrid(
                    {
                        minWallSize: [10, 25, 50, 100],
                        maxCancellationRatio: [0.6, 0.7, 0.8, 0.9],
                        rapidCancellationMs: [200, 500, 1000, 2000],
                        ghostLiquidityThresholdMs: [100, 200, 500],
                    },
                    points
                );

                spoofingConfigs.forEach((config, index) => {
                    configurations.push({
                        id: `spoofing_grid_${index}`,
                        detectorType,
                        config,
                        description: `Grid search configuration ${index} for spoofing detector`,
                        profile: "custom",
                    });
                });
                break;

            case "absorptionDetector":
                const absorptionConfigs = this.generateParameterGrid(
                    {
                        minAggVolume: [300, 600, 900, 1200],
                        absorptionThreshold: [0.65, 0.75, 0.85, 0.95],
                        minPassiveMultiplier: [1.5, 2.0, 2.5, 3.0],
                        eventCooldownMs: [5000, 15000, 30000, 60000],
                    },
                    points
                );

                absorptionConfigs.forEach((config, index) => {
                    configurations.push({
                        id: `absorption_grid_${index}`,
                        detectorType,
                        config,
                        description: `Grid search configuration ${index} for absorption detector`,
                        profile: "custom",
                    });
                });
                break;

            case "exhaustionDetector":
                const exhaustionConfigs = this.generateParameterGrid(
                    {
                        minAggVolume: [300, 600, 900, 1200],
                        exhaustionThreshold: [0.6, 0.7, 0.8, 0.9],
                        maxPassiveRatio: [0.3, 0.5, 0.7, 0.9],
                        eventCooldownMs: [5000, 15000, 30000, 60000],
                    },
                    points
                );

                exhaustionConfigs.forEach((config, index) => {
                    configurations.push({
                        id: `exhaustion_grid_${index}`,
                        detectorType,
                        config,
                        description: `Grid search configuration ${index} for exhaustion detector`,
                        profile: "custom",
                    });
                });
                break;
        }

        return configurations;
    }

    /**
     * Generate Phase 1 configurations - Major parameters with broad ranges
     */
    private generatePhase1Configurations(
        detectorType: keyof ConfigurationMatrix
    ): TestConfiguration[] {
        const configurations: TestConfiguration[] = [];

        switch (detectorType) {
            case "deltaCVDDetector":
                const majorParams = {
                    minZ: [1.5, 2, 2.5, 3, 3.5, 4, 4.5],
                    divergenceThreshold: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
                };

                // Generate all combinations of major parameters
                const deltaCVDPhase1Configs = this.generateParameterGrid(
                    majorParams,
                    100 // Allow more combinations for major parameter exploration
                );

                deltaCVDPhase1Configs.forEach((config, index) => {
                    configurations.push({
                        id: `deltacvd_phase1_${index}`,
                        detectorType,
                        config: {
                            ...config,
                            // Set default values for minor parameters
                            minTradesPerSec: 0.5,
                            minVolPerSec: 20,
                        },
                        description: `Phase 1 DeltaCVD: minZ=${String(config.minZ)}, divergence=${String(config.divergenceThreshold)}`,
                        profile: "custom",
                    });
                });
                break;

            case "hiddenOrderDetector":
                const hiddenMajorParams = {
                    minHiddenVolume: [5, 10, 20, 50],
                    minConfidence: [0.6, 0.7, 0.8, 0.9],
                };

                const hiddenPhase1Configs = this.generateParameterGrid(
                    hiddenMajorParams,
                    50
                );

                hiddenPhase1Configs.forEach((config, index) => {
                    configurations.push({
                        id: `hidden_phase1_${index}`,
                        detectorType,
                        config: {
                            ...config,
                            priceTolerance: 0.001,
                            minTradeSize: 5,
                            maxDepthAgeMs: 1000,
                        },
                        description: `Phase 1 Hidden Order: vol=${String(config.minHiddenVolume)}, conf=${String(config.minConfidence)}`,
                        profile: "custom",
                    });
                });
                break;

            default:
                // For other detectors, use simplified major parameter testing
                configurations.push({
                    id: `${detectorType}_phase1_default`,
                    detectorType,
                    config: {},
                    description: `Phase 1 default configuration for ${detectorType}`,
                    profile: "custom",
                });
        }

        return configurations;
    }

    /**
     * Generate Phase 2 configurations - Minor parameter optimization around best Phase 1 results
     */
    private generatePhase2Configurations(
        detectorType: keyof ConfigurationMatrix
    ): TestConfiguration[] {
        const configurations: TestConfiguration[] = [];

        if (
            !this.options.phase1Results ||
            this.options.phase1Results.length === 0
        ) {
            throw new Error("Phase 2 requires phase1Results to be provided");
        }

        // Take top 5 performing configurations from Phase 1
        const topConfigs = this.options.phase1Results.slice(0, 5);

        switch (detectorType) {
            case "deltaCVDDetector":
                topConfigs.forEach((baseConfig, baseIndex) => {
                    const baseMinTradesPerSec =
                        (baseConfig.config.minTradesPerSec as number) || 0.5;
                    const baseMinVolPerSec =
                        (baseConfig.config.minVolPerSec as number) || 20;

                    // Generate variations around the base parameters
                    const minorParams = {
                        minTradesPerSec: [
                            baseMinTradesPerSec * 0.8,
                            baseMinTradesPerSec * 0.9,
                            baseMinTradesPerSec,
                            baseMinTradesPerSec * 1.1,
                            baseMinTradesPerSec * 1.2,
                        ],
                        minVolPerSec: [
                            baseMinVolPerSec * 0.7,
                            baseMinVolPerSec * 0.85,
                            baseMinVolPerSec,
                            baseMinVolPerSec * 1.15,
                            baseMinVolPerSec * 1.3,
                        ],
                    };

                    const phase2Configs = this.generateParameterGrid(
                        minorParams,
                        25
                    );

                    phase2Configs.forEach((minorConfig, index) => {
                        configurations.push({
                            id: `deltacvd_phase2_${baseIndex}_${index}`,
                            detectorType,
                            config: {
                                ...baseConfig.config,
                                ...minorConfig,
                            },
                            description: `Phase 2 DeltaCVD from ${baseConfig.id}: trades=${String(minorConfig.minTradesPerSec)}, vol=${String(minorConfig.minVolPerSec)}`,
                            profile: "custom",
                        });
                    });
                });
                break;

            default:
                // For other detectors, just return the top configs as-is
                topConfigs.forEach((config, index) => {
                    configurations.push({
                        ...config,
                        id: `${config.detectorType}_phase2_${index}`,
                        description: `Phase 2 optimization of ${config.id}`,
                    });
                });
        }

        return configurations;
    }

    /**
     * Generate parameter grid combinations
     */
    private generateParameterGrid(
        parameters: Record<string, unknown[]>,
        maxCombinations: number
    ): Record<string, unknown>[] {
        const keys = Object.keys(parameters);
        const values = Object.values(parameters);
        const combinations: Record<string, unknown>[] = [];

        // Generate all possible combinations
        const totalCombinations = values.reduce(
            (acc, arr) => acc * arr.length,
            1
        );

        if (totalCombinations <= maxCombinations) {
            // Generate all combinations if within limit
            this.generateAllCombinations(keys, values, [], combinations);
        } else {
            // Generate random sample if too many combinations
            this.generateRandomSample(
                keys,
                values,
                maxCombinations,
                combinations
            );
        }

        return combinations;
    }

    /**
     * Generate all parameter combinations recursively
     */
    private generateAllCombinations(
        keys: string[],
        values: unknown[][],
        current: unknown[],
        results: Record<string, unknown>[]
    ): void {
        if (current.length === keys.length) {
            const config: Record<string, unknown> = {};
            keys.forEach((key, index) => {
                config[key] = current[index];
            });
            results.push(config);
            return;
        }

        const currentIndex = current.length;
        for (const value of values[currentIndex]) {
            this.generateAllCombinations(
                keys,
                values,
                [...current, value],
                results
            );
        }
    }

    /**
     * Generate random sample of parameter combinations
     */
    private generateRandomSample(
        keys: string[],
        values: unknown[][],
        sampleSize: number,
        results: Record<string, unknown>[]
    ): void {
        const seenCombinations = new Set<string>();

        while (
            results.length < sampleSize &&
            seenCombinations.size < sampleSize * 10
        ) {
            const config: Record<string, unknown> = {};
            const combination: string[] = [];

            keys.forEach((key, index) => {
                const randomValue =
                    values[index][
                        Math.floor(Math.random() * values[index].length)
                    ];
                config[key] = randomValue;
                combination.push(`${key}:${String(randomValue)}`);
            });

            const combinationKey = combination.join("|");
            if (!seenCombinations.has(combinationKey)) {
                seenCombinations.add(combinationKey);
                results.push(config);
            }
        }
    }

    /**
     * Validate configuration for mathematical consistency
     */
    public validateConfiguration(config: TestConfiguration): boolean {
        try {
            switch (config.detectorType) {
                case "hiddenOrderDetector":
                    const hiddenConfig =
                        config.config as Partial<HiddenOrderDetectorConfig>;
                    if (
                        hiddenConfig.minConfidence &&
                        (hiddenConfig.minConfidence < 0 ||
                            hiddenConfig.minConfidence > 1)
                    ) {
                        return false;
                    }
                    if (
                        hiddenConfig.priceTolerance &&
                        hiddenConfig.priceTolerance < 0
                    ) {
                        return false;
                    }
                    break;

                case "icebergDetector":
                    const icebergConfig =
                        config.config as Partial<IcebergDetectorConfig>;
                    if (
                        icebergConfig.maxSizeVariation &&
                        (icebergConfig.maxSizeVariation < 0 ||
                            icebergConfig.maxSizeVariation > 1)
                    ) {
                        return false;
                    }
                    if (
                        icebergConfig.minRefillCount &&
                        icebergConfig.minRefillCount < 1
                    ) {
                        return false;
                    }
                    break;

                case "spoofingDetector":
                    const spoofingConfig =
                        config.config as Partial<SpoofingDetectorConfig>;
                    if (
                        spoofingConfig.maxCancellationRatio &&
                        (spoofingConfig.maxCancellationRatio < 0 ||
                            spoofingConfig.maxCancellationRatio > 1)
                    ) {
                        return false;
                    }
                    break;
            }

            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get configuration summary statistics
     */
    public getConfigurationStats(configurations: TestConfiguration[]): {
        totalConfigurations: number;
        byDetector: Record<string, number>;
        byProfile: Record<string, number>;
    } {
        const stats = {
            totalConfigurations: configurations.length,
            byDetector: {} as Record<string, number>,
            byProfile: {} as Record<string, number>,
        };

        configurations.forEach((config) => {
            stats.byDetector[config.detectorType] =
                (stats.byDetector[config.detectorType] || 0) + 1;
            stats.byProfile[config.profile] =
                (stats.byProfile[config.profile] || 0) + 1;
        });

        return stats;
    }
}
