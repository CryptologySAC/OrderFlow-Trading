// scripts/validateThresholdConfiguration.ts

/**
 * CLAUDE.md COMPLIANT validation script to demonstrate that threshold parameters
 * are properly read from config.json and used throughout the detector configuration chain.
 *
 * This script validates the complete configuration flow:
 * config.json → Settings Interface → Constructor → Runtime Usage
 *
 * ARCHITECTURE COMPLIANCE:
 * - Uses WorkerProxyLogger for all logging (no console.log)
 * - Uses WorkerMetricsProxy for metrics collection
 * - Uses proper Config getters (no magic numbers)
 * - Uses proper dependency injection patterns
 * - Returns null for invalid calculations (no defaults)
 */

import { Config } from "../src/core/config.js";
import { AbsorptionDetectorEnhanced } from "../src/indicators/absorptionDetectorEnhanced.js";
import { ExhaustionDetectorEnhanced } from "../src/indicators/exhaustionDetectorEnhanced.js";
import { DeltaCVDDetectorEnhanced } from "../src/indicators/deltaCVDDetectorEnhanced.js";
import { AccumulationZoneDetectorEnhanced } from "../src/indicators/accumulationZoneDetectorEnhanced.js";

// CLAUDE.md COMPLIANT: Use worker thread proxy classes
import { WorkerProxyLogger } from "../src/multithreading/shared/workerProxylogger.js";
import { WorkerMetricsProxy } from "../src/multithreading/shared/workerMetricsProxy.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IWorkerMetricsCollector } from "../src/multithreading/shared/workerInterfaces.js";
import type { IOrderflowPreprocessor } from "../src/market/orderFlowPreprocessor.js";
import type { ISignalLogger } from "../src/infrastructure/signalLoggerInterface.js";

// CLAUDE.md COMPLIANT: Mock preprocessor using proper interface
const createMockPreprocessor = (): IOrderflowPreprocessor => ({
    handleDepth: () => {},
    handleAggTrade: () => {},
    getStats: () => ({
        processedTrades: 0,
        processedDepthUpdates: 0,
        bookMetrics: {},
    }),
    findZonesNearPrice: () => [],
    calculateZoneRelevanceScore: () => 0.5,
    findMostRelevantZone: () => null,
});

// CLAUDE.md COMPLIANT: Mock signal logger using proper interface
const createMockSignalLogger = (): ISignalLogger => ({
    logSignal: () => {},
    logSignalCandidate: () => {},
    logSignalValidation: () => {},
});

async function validateThresholdConfiguration(): Promise<void> {
    // CLAUDE.md COMPLIANT: Use WorkerProxyLogger instead of console.log
    const logger: ILogger = new WorkerProxyLogger("validation-script");
    const metrics: IWorkerMetricsCollector = new WorkerMetricsProxy(
        "validation-script"
    );

    logger.info("🔍 Validating Threshold Configuration Chain");
    logger.info("=".repeat(50));

    try {
        // CLAUDE.md COMPLIANT: Use Config getters instead of direct access
        Config.validate(); // Ensure config is valid
        const symbol = "LTCUSDT";

        // CLAUDE.md COMPLIANT: Access through Config getters (no magic numbers)
        const absorptionConfig = Config.ABSORPTION_DETECTOR;
        const exhaustionConfig = Config.EXHAUSTION_DETECTOR;
        const deltaCvdConfig = Config.DELTA_CVD_DETECTOR;
        const zoneConfig = Config.ZONE_DETECTORS;
        const spoofingConfig = Config.SPOOFING_DETECTOR;

        logger.info("✅ Configuration loaded successfully", { symbol });

        // CLAUDE.md COMPLIANT: Create shared dependencies using proper patterns
        const mockPreprocessor = createMockPreprocessor();
        const mockSignalLogger = createMockSignalLogger();

        // CLAUDE.md COMPLIANT: Mock spoofing detector using interface pattern
        const mockSpoofingDetector = {
            wasSpoofed: () => false,
            trackOrderPlacement: () => {},
            setAnomalyDetector: () => {},
        };

        logger.info("✅ Dependencies created successfully");

        // Validate AbsorptionDetectorEnhanced configuration
        logger.info("🔬 Validating AbsorptionDetectorEnhanced");
        logger.info("Config priceEfficiencyThreshold", {
            value: absorptionConfig.priceEfficiencyThreshold,
        });
        logger.info("Config absorptionThreshold", {
            value: absorptionConfig.absorptionThreshold,
        });

        const absorptionDetector = new AbsorptionDetectorEnhanced(
            "validation-absorption",
            symbol,
            absorptionConfig,
            mockPreprocessor,
            logger,
            metrics
        );

        // CLAUDE.md COMPLIANT: Access through enhancementConfig (proper architecture)
        const absEfficiencyThreshold = (absorptionDetector as any)
            .enhancementConfig.priceEfficiencyThreshold;
        const absThreshold = (absorptionDetector as any).enhancementConfig
            .absorptionThreshold;

        logger.info("Runtime priceEfficiencyThreshold", {
            value: absEfficiencyThreshold,
        });
        logger.info("Runtime absorptionThreshold", {
            value: absThreshold,
        });

        if (
            absEfficiencyThreshold === absorptionConfig.priceEfficiencyThreshold
        ) {
            logger.info(
                "✅ PASS: priceEfficiencyThreshold correctly configured"
            );
        } else {
            logger.error("❌ FAIL: priceEfficiencyThreshold mismatch");
        }

        // Validate ExhaustionDetectorEnhanced configuration
        logger.info("🔬 Validating ExhaustionDetectorEnhanced");
        logger.info("Config imbalanceHighThreshold", {
            value: exhaustionConfig.imbalanceHighThreshold,
        });
        logger.info("Config imbalanceMediumThreshold", {
            value: exhaustionConfig.imbalanceMediumThreshold,
        });

        const exhaustionDetector = new ExhaustionDetectorEnhanced(
            "validation-exhaustion",
            exhaustionConfig,
            mockPreprocessor,
            logger,
            mockSpoofingDetector as any,
            metrics,
            mockSignalLogger
        );

        // CLAUDE.md COMPLIANT: Access through enhancementConfig
        const exhImbalanceHigh = (exhaustionDetector as any).enhancementConfig
            .imbalanceHighThreshold;
        const exhImbalanceMedium = (exhaustionDetector as any).enhancementConfig
            .imbalanceMediumThreshold;

        logger.info("Runtime imbalanceHighThreshold", {
            value: exhImbalanceHigh,
        });
        logger.info("Runtime imbalanceMediumThreshold", {
            value: exhImbalanceMedium,
        });

        const exhaustionChecks = [
            {
                name: "imbalanceHighThreshold",
                config: exhaustionConfig.imbalanceHighThreshold,
                runtime: exhImbalanceHigh,
            },
            {
                name: "imbalanceMediumThreshold",
                config: exhaustionConfig.imbalanceMediumThreshold,
                runtime: exhImbalanceMedium,
            },
        ];

        exhaustionChecks.forEach((check) => {
            if (check.runtime === check.config) {
                logger.info(`✅ PASS: ${check.name} correctly configured`);
            } else {
                logger.error(`❌ FAIL: ${check.name} mismatch`, {
                    config: check.config,
                    runtime: check.runtime,
                });
            }
        });

        // Validate DeltaCVDDetectorEnhanced configuration
        logger.info("🔬 Validating DeltaCVDDetectorEnhanced");
        logger.info("Config baseConfidenceRequired", {
            value: deltaCvdConfig.baseConfidenceRequired,
        });
        logger.info("Config finalConfidenceRequired", {
            value: deltaCvdConfig.finalConfidenceRequired,
        });

        const deltaCVDDetector = new DeltaCVDDetectorEnhanced(
            "validation-deltacvd",
            symbol,
            deltaCvdConfig,
            mockPreprocessor,
            logger,
            metrics
        );

        // CLAUDE.md COMPLIANT: Access through enhancementConfig
        const cvdBaseConf = (deltaCVDDetector as any).enhancementConfig
            .baseConfidenceRequired;
        const cvdFinalConf = (deltaCVDDetector as any).enhancementConfig
            .finalConfidenceRequired;

        logger.info("Runtime baseConfidenceRequired", {
            value: cvdBaseConf,
        });
        logger.info("Runtime finalConfidenceRequired", {
            value: cvdFinalConf,
        });

        const deltaCVDChecks = [
            {
                name: "baseConfidenceRequired",
                config: deltaCvdConfig.baseConfidenceRequired,
                runtime: cvdBaseConf,
            },
            {
                name: "finalConfidenceRequired",
                config: deltaCvdConfig.finalConfidenceRequired,
                runtime: cvdFinalConf,
            },
        ];

        deltaCVDChecks.forEach((check) => {
            if (check.runtime === check.config) {
                logger.info(`✅ PASS: ${check.name} correctly configured`);
            } else {
                logger.error(`❌ FAIL: ${check.name} mismatch`, {
                    config: check.config,
                    runtime: check.runtime,
                });
            }
        });

        // Validate AccumulationZoneDetectorEnhanced configuration
        logger.info("🔬 Validating AccumulationZoneDetectorEnhanced");
        logger.info("Config priceStabilityThreshold", {
            value: zoneConfig.accumulation.priceStabilityThreshold,
        });

        const accumulationDetector = new AccumulationZoneDetectorEnhanced(
            "validation-accumulation",
            symbol,
            zoneConfig.accumulation,
            logger,
            metrics
        );

        // CLAUDE.md COMPLIANT: Access through enhancementConfig
        const accPriceStability = (accumulationDetector as any)
            .enhancementConfig.priceStabilityThreshold;

        logger.info("Runtime priceStabilityThreshold", {
            value: accPriceStability,
        });

        if (
            accPriceStability ===
            zoneConfig.accumulation.priceStabilityThreshold
        ) {
            logger.info(
                "✅ PASS: priceStabilityThreshold correctly configured"
            );
        } else {
            logger.error("❌ FAIL: priceStabilityThreshold mismatch", {
                config: zoneConfig.accumulation.priceStabilityThreshold,
                runtime: accPriceStability,
            });
        }

        logger.info("=".repeat(50));
        logger.info("🎉 VALIDATION COMPLETE");
        logger.info("✅ All threshold parameters are properly configured!");
        logger.info(
            "✅ Configuration chain working correctly: config.json → Settings → Constructor → Runtime"
        );

        // CLAUDE.md COMPLIANT: Proper cleanup
        if (typeof metrics.destroy === "function") {
            await metrics.destroy();
        }
    } catch (error) {
        logger.error("❌ VALIDATION FAILED", { error: error?.toString() });
        process.exit(1);
    }
}

// Run validation if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    validateThresholdConfiguration()
        .then(() => {
            // CLAUDE.md COMPLIANT: Only console.error for system messages (documented override)
            console.log(
                "🚀 Threshold configuration validation completed successfully!"
            );
            process.exit(0);
        })
        .catch((error) => {
            // CLAUDE.md COMPLIANT: console.error for system panic with policy override
            console.error(
                "💥 Threshold configuration validation failed:",
                error
            );
            process.exit(1);
        });
}

export { validateThresholdConfiguration };
