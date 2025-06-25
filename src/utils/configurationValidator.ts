// src/utils/configurationValidator.ts

// Mathematical proof framework not yet integrated

/**
 * Configuration validator for detector thresholds
 * Ensures configurations will generate signals and meet mathematical requirements
 */

export interface ValidationResult {
    isValid: boolean;
    issues: string[];
    recommendations: string[];
    expectedSignalsPerHour: number;
    compoundProbability: number;
}

export class ConfigurationValidator {
    /**
     * Validate detector configuration for signal generation capability
     */
    static validateDetectorConfig(
        detectorType: string,
        config: Record<string, number | string | boolean>
    ): ValidationResult {
        const issues: string[] = [];
        const recommendations: string[] = [];
        let isValid = true;

        // Extract threshold values
        const thresholds: Record<string, number> = {};

        switch (detectorType) {
            case "absorption":
                thresholds.absorptionThreshold =
                    typeof config.absorptionThreshold === "number"
                        ? config.absorptionThreshold
                        : 0.6;
                thresholds.priceEfficiencyThreshold =
                    typeof config.priceEfficiencyThreshold === "number"
                        ? config.priceEfficiencyThreshold
                        : 0.85;
                thresholds.detectorThreshold =
                    typeof config.detectorThreshold === "number"
                        ? config.detectorThreshold
                        : 0.85;
                break;
            case "exhaustion":
                thresholds.exhaustionThreshold =
                    typeof config.exhaustionThreshold === "number"
                        ? config.exhaustionThreshold
                        : 0.7;
                thresholds.imbalanceHighThreshold =
                    typeof config.imbalanceHighThreshold === "number"
                        ? config.imbalanceHighThreshold
                        : 0.8;
                thresholds.detectorThreshold =
                    typeof config.detectorThreshold === "number"
                        ? config.detectorThreshold
                        : 0.85;
                break;
            case "deltaCVD":
                thresholds.baseConfidenceRequired =
                    typeof config.baseConfidenceRequired === "number"
                        ? config.baseConfidenceRequired
                        : 0.3;
                thresholds.finalConfidenceRequired =
                    typeof config.finalConfidenceRequired === "number"
                        ? config.finalConfidenceRequired
                        : 0.5;
                thresholds.detectorThreshold =
                    typeof config.detectorThreshold === "number"
                        ? config.detectorThreshold
                        : 0.85;
                break;
        }

        // Validate using simplified logic (mathematical framework to be integrated)
        let expectedSignalsPerHour = 0;

        // Calculate compound probability
        const compoundProbability = Object.values(thresholds).reduce(
            (acc, val) => acc * val,
            1
        );

        if (compoundProbability < 0.01) {
            isValid = false;
            issues.push("Compound probability too low (<1%), signals unlikely");
            expectedSignalsPerHour = 0;
        } else {
            // Rough estimate: assume 1000 trade events per hour, multiply by compound probability
            expectedSignalsPerHour = 1000 * compoundProbability;
        }

        // Check for extreme thresholds
        for (const [key, value] of Object.entries(thresholds)) {
            if (value > 0.9) {
                isValid = false;
                issues.push(`${key} too high (${value}), should be < 0.9`);
                recommendations.push(`Reduce ${key} to 0.7-0.8 range`);
            }
            if (value < 0.1) {
                issues.push(`${key} too low (${value}), may generate noise`);
                recommendations.push(`Increase ${key} to 0.3-0.5 range`);
            }
        }

        // Check compound probability (renamed to avoid conflict)
        const finalCompoundProbability = Object.values(thresholds).reduce(
            (acc, val) => acc * val,
            1
        );

        if (finalCompoundProbability < 0.01) {
            isValid = false;
            issues.push("Compound probability too low (<1%), signals unlikely");
            recommendations.push("Reduce number of threshold layers");
        }

        return {
            isValid,
            issues,
            recommendations,
            expectedSignalsPerHour,
            compoundProbability: finalCompoundProbability,
        };
    }

    /**
     * Validate entire system configuration
     */
    static validateSystemConfig(
        config: Record<
            string,
            | number
            | string
            | boolean
            | Record<string, number | string | boolean>
        >
    ): ValidationResult {
        const allIssues: string[] = [];
        const allRecommendations: string[] = [];
        let systemValid = true;
        let totalExpectedSignals = 0;

        // Validate each detector
        const detectorTypes = ["absorption", "exhaustion", "deltaCVD"];

        for (const detectorType of detectorTypes) {
            const baseConfig = config[detectorType];
            const signalManager = config.signalManager;

            let detectorThreshold: number | undefined;

            if (typeof signalManager === "object" && signalManager !== null) {
                const smAny = signalManager as Record<
                    string,
                    Record<string, number> | number | string | boolean
                >;
                const detectorThresholds = smAny.detectorThresholds;
                if (
                    typeof detectorThresholds === "object" &&
                    detectorThresholds !== null
                ) {
                    const dtAny = detectorThresholds;
                    detectorThreshold = dtAny[detectorType];
                }
            }

            const detectorConfig: Record<string, number | string | boolean> = {
                ...(typeof baseConfig === "object" && baseConfig !== null
                    ? baseConfig
                    : {}),
            };

            if (detectorThreshold !== undefined) {
                detectorConfig.detectorThreshold = detectorThreshold;
            }

            const result = this.validateDetectorConfig(
                detectorType,
                detectorConfig
            );

            if (!result.isValid) {
                systemValid = false;
            }

            allIssues.push(
                ...result.issues.map((issue) => `${detectorType}: ${issue}`)
            );
            allRecommendations.push(
                ...result.recommendations.map(
                    (rec) => `${detectorType}: ${rec}`
                )
            );
            totalExpectedSignals += result.expectedSignalsPerHour;
        }

        // System-level validations
        if (totalExpectedSignals < 0.5) {
            systemValid = false;
            allIssues.push("System-wide signal generation too low (<0.5/hour)");
            allRecommendations.push(
                "Reduce threshold complexity across all detectors"
            );
        }

        return {
            isValid: systemValid,
            issues: allIssues,
            recommendations: allRecommendations,
            expectedSignalsPerHour: totalExpectedSignals,
            compoundProbability: 0, // Not applicable for system level
        };
    }

    /**
     * Generate optimized configuration recommendations
     */
    static generateOptimizedConfig(): Record<
        string,
        | Record<
              string,
              | number
              | string
              | boolean
              | { absorption: number; exhaustion: number; deltaCVD: number }
          >
        | number
        | string
        | boolean
    > {
        // Simplified optimized configuration (mathematical framework to be integrated)
        return {
            absorption: {
                absorptionThreshold: 0.6,
                priceEfficiencyThreshold: 0.7,
            },
            exhaustion: {
                exhaustionThreshold: 0.65,
                imbalanceHighThreshold: 0.75,
            },
            deltaCVD: {
                baseConfidenceRequired: 0.4,
                finalConfidenceRequired: 0.6,
            },
            signalManager: {
                detectorThresholds: {
                    absorption: 0.7,
                    exhaustion: 0.7,
                    deltaCVD: 0.7,
                },
            },
        };
    }
}
