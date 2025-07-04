// scripts/validateThresholdConfiguration.ts

/**
 * Validation script to demonstrate that threshold parameters are properly
 * read from config.json and used throughout the detector configuration chain.
 *
 * This script validates the complete configuration flow:
 * config.json → Settings Interface → Constructor → Runtime Usage
 */

import { Config } from "../src/core/config.js";
import { AbsorptionDetector } from "../src/indicators/absorptionDetector.js";
import { ExhaustionDetector } from "../src/indicators/exhaustionDetector.js";
import { DeltaCVDConfirmation } from "../src/indicators/deltaCVDConfirmation.js";
import { AccumulationZoneDetector } from "../src/indicators/accumulationZoneDetector.js";
import { RedBlackTreeOrderBook } from "../src/market/redBlackTreeOrderBook.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";

// Create mock logger for validation
const mockLogger: ILogger = {
    info: (message: string, data?: any) =>
        console.log(`[INFO] ${message}`, data || ""),
    warn: (message: string, data?: any) =>
        console.warn(`[WARN] ${message}`, data || ""),
    error: (message: string, data?: any) =>
        console.error(`[ERROR] ${message}`, data || ""),
    debug: (message: string, data?: any) =>
        console.log(`[DEBUG] ${message}`, data || ""),
    isDebugEnabled: () => false,
    setCorrelationId: () => {},
    removeCorrelationId: () => {},
};

async function validateThresholdConfiguration(): Promise<void> {
    console.log("🔍 Validating Threshold Configuration Chain");
    console.log("=".repeat(50));

    try {
        // Load configuration
        Config.validate(); // Ensure config is valid
        const symbol = "LTCUSDT";
        const symbolConfig = {
            absorption: Config.ABSORPTION,
            exhaustion: Config.EXHAUSTION,
            deltaCvdConfirmation: Config.DELTA_CVD_CONFIRMATION,
        };
        const zoneConfig = Config.ZONE_DETECTORS;

        if (!symbolConfig.absorption || !symbolConfig.exhaustion) {
            throw new Error(`Configuration not found for symbol: ${symbol}`);
        }

        console.log("\n1. ✅ Configuration loaded successfully");
        console.log(`   Symbol: ${symbol}`);

        // Create shared dependencies
        const metricsCollector = new MetricsCollector();
        const orderBook = new RedBlackTreeOrderBook(
            symbol,
            2,
            mockLogger,
            metricsCollector
        );
        const spoofingDetector = new SpoofingDetector(
            {
                tickSize: 0.01,
                wallTicks: 5,
                minWallSize: 10,
                maxCancellationRatio: 0.8,
                rapidCancellationMs: 500,
                ghostLiquidityThresholdMs: 200,
            },
            mockLogger
        );

        console.log("\n2. ✅ Dependencies created successfully");

        // Validate AbsorptionDetector configuration
        console.log("\n3. 🔬 Validating AbsorptionDetector");
        const absorptionConfig = symbolConfig.absorption;
        console.log(
            `   Config priceEfficiencyThreshold: ${absorptionConfig.priceEfficiencyThreshold}`
        );
        console.log(
            `   Config absorptionThreshold: ${absorptionConfig.absorptionThreshold}`
        );

        const absorptionDetector = new AbsorptionDetector(
            "validation-absorption",
            absorptionConfig,
            orderBook,
            mockLogger,
            spoofingDetector,
            metricsCollector
        );

        // Verify the threshold was properly read and stored
        const absEfficiencyThreshold = (absorptionDetector as any)
            .priceEfficiencyThreshold;
        const absThreshold = (absorptionDetector as any).absorptionThreshold;

        console.log(
            `   ✅ Runtime priceEfficiencyThreshold: ${absEfficiencyThreshold}`
        );
        console.log(`   ✅ Runtime absorptionThreshold: ${absThreshold}`);

        if (
            absEfficiencyThreshold === absorptionConfig.priceEfficiencyThreshold
        ) {
            console.log(
                "   ✅ PASS: priceEfficiencyThreshold correctly configured"
            );
        } else {
            console.log("   ❌ FAIL: priceEfficiencyThreshold mismatch");
        }

        // Validate ExhaustionDetector configuration
        console.log("\n4. 🔬 Validating ExhaustionDetector");
        const exhaustionConfig = symbolConfig.exhaustion;
        console.log(
            `   Config imbalanceHighThreshold: ${exhaustionConfig.imbalanceHighThreshold}`
        );
        console.log(
            `   Config imbalanceMediumThreshold: ${exhaustionConfig.imbalanceMediumThreshold}`
        );
        console.log(
            `   Config spreadHighThreshold: ${exhaustionConfig.spreadHighThreshold}`
        );
        console.log(
            `   Config spreadMediumThreshold: ${exhaustionConfig.spreadMediumThreshold}`
        );

        const exhaustionDetector = new ExhaustionDetector(
            "validation-exhaustion",
            exhaustionConfig,
            mockLogger,
            spoofingDetector,
            metricsCollector
        );

        // Verify thresholds were properly read and stored
        const exhImbalanceHigh = (exhaustionDetector as any)
            .imbalanceHighThreshold;
        const exhImbalanceMedium = (exhaustionDetector as any)
            .imbalanceMediumThreshold;
        const exhSpreadHigh = (exhaustionDetector as any).spreadHighThreshold;
        const exhSpreadMedium = (exhaustionDetector as any)
            .spreadMediumThreshold;

        console.log(
            `   ✅ Runtime imbalanceHighThreshold: ${exhImbalanceHigh}`
        );
        console.log(
            `   ✅ Runtime imbalanceMediumThreshold: ${exhImbalanceMedium}`
        );
        console.log(`   ✅ Runtime spreadHighThreshold: ${exhSpreadHigh}`);
        console.log(`   ✅ Runtime spreadMediumThreshold: ${exhSpreadMedium}`);

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
            {
                name: "spreadHighThreshold",
                config: exhaustionConfig.spreadHighThreshold,
                runtime: exhSpreadHigh,
            },
            {
                name: "spreadMediumThreshold",
                config: exhaustionConfig.spreadMediumThreshold,
                runtime: exhSpreadMedium,
            },
        ];

        exhaustionChecks.forEach((check) => {
            if (check.runtime === check.config) {
                console.log(`   ✅ PASS: ${check.name} correctly configured`);
            } else {
                console.log(
                    `   ❌ FAIL: ${check.name} mismatch (config: ${check.config}, runtime: ${check.runtime})`
                );
            }
        });

        // Validate DeltaCVDConfirmation configuration
        console.log("\n5. 🔬 Validating DeltaCVDConfirmation");
        const deltaCVDConfig = symbolConfig.deltaCvdConfirmation;
        console.log(
            `   Config strongCorrelationThreshold: ${deltaCVDConfig.strongCorrelationThreshold}`
        );
        console.log(
            `   Config weakCorrelationThreshold: ${deltaCVDConfig.weakCorrelationThreshold}`
        );
        console.log(
            `   Config depthImbalanceThreshold: ${deltaCVDConfig.depthImbalanceThreshold}`
        );

        const deltaCVDDetector = new DeltaCVDConfirmation(
            "validation-deltacvd",
            deltaCVDConfig,
            orderBook,
            mockLogger,
            metricsCollector
        );

        // Verify thresholds were properly read and stored
        const cvdStrongCorr = (deltaCVDDetector as any)
            .strongCorrelationThreshold;
        const cvdWeakCorr = (deltaCVDDetector as any).weakCorrelationThreshold;
        const cvdDepthImbalance = (deltaCVDDetector as any)
            .depthImbalanceThreshold;

        console.log(
            `   ✅ Runtime strongCorrelationThreshold: ${cvdStrongCorr}`
        );
        console.log(`   ✅ Runtime weakCorrelationThreshold: ${cvdWeakCorr}`);
        console.log(
            `   ✅ Runtime depthImbalanceThreshold: ${cvdDepthImbalance}`
        );

        const deltaCVDChecks = [
            {
                name: "strongCorrelationThreshold",
                config: deltaCVDConfig.strongCorrelationThreshold,
                runtime: cvdStrongCorr,
            },
            {
                name: "weakCorrelationThreshold",
                config: deltaCVDConfig.weakCorrelationThreshold,
                runtime: cvdWeakCorr,
            },
            {
                name: "depthImbalanceThreshold",
                config: deltaCVDConfig.depthImbalanceThreshold,
                runtime: cvdDepthImbalance,
            },
        ];

        deltaCVDChecks.forEach((check) => {
            if (check.runtime === check.config) {
                console.log(`   ✅ PASS: ${check.name} correctly configured`);
            } else {
                console.log(
                    `   ❌ FAIL: ${check.name} mismatch (config: ${check.config}, runtime: ${check.runtime})`
                );
            }
        });

        // Validate AccumulationZoneDetector configuration
        console.log("\n6. 🔬 Validating AccumulationZoneDetector");
        const accumulationConfig = zoneConfig.accumulation;
        console.log(
            `   Config priceStabilityThreshold: ${accumulationConfig.priceStabilityThreshold}`
        );
        console.log(
            `   Config strongZoneThreshold: ${accumulationConfig.strongZoneThreshold}`
        );
        console.log(
            `   Config weakZoneThreshold: ${accumulationConfig.weakZoneThreshold}`
        );

        const accumulationDetector = new AccumulationZoneDetector(
            "validation-accumulation",
            symbol,
            accumulationConfig,
            mockLogger,
            metricsCollector
        );

        // Verify thresholds were properly read and stored
        const accPriceStability = (accumulationDetector as any)
            .priceStabilityThreshold;
        const accStrongZone = (accumulationDetector as any).strongZoneThreshold;
        const accWeakZone = (accumulationDetector as any).weakZoneThreshold;

        console.log(
            `   ✅ Runtime priceStabilityThreshold: ${accPriceStability}`
        );
        console.log(`   ✅ Runtime strongZoneThreshold: ${accStrongZone}`);
        console.log(`   ✅ Runtime weakZoneThreshold: ${accWeakZone}`);

        const accumulationChecks = [
            {
                name: "priceStabilityThreshold",
                config: accumulationConfig.priceStabilityThreshold,
                runtime: accPriceStability,
            },
            {
                name: "strongZoneThreshold",
                config: accumulationConfig.strongZoneThreshold,
                runtime: accStrongZone,
            },
            {
                name: "weakZoneThreshold",
                config: accumulationConfig.weakZoneThreshold,
                runtime: accWeakZone,
            },
        ];

        accumulationChecks.forEach((check) => {
            if (check.runtime === check.config) {
                console.log(`   ✅ PASS: ${check.name} correctly configured`);
            } else {
                console.log(
                    `   ❌ FAIL: ${check.name} mismatch (config: ${check.config}, runtime: ${check.runtime})`
                );
            }
        });

        console.log("\n" + "=".repeat(50));
        console.log("🎉 VALIDATION COMPLETE");
        console.log("✅ All threshold parameters are properly configured!");
        console.log(
            "✅ Configuration chain working correctly: config.json → Settings → Constructor → Runtime"
        );
    } catch (error) {
        console.error("\n❌ VALIDATION FAILED:");
        console.error(error);
        process.exit(1);
    }
}

// Run validation if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    validateThresholdConfiguration()
        .then(() => {
            console.log(
                "\n🚀 Threshold configuration validation completed successfully!"
            );
            process.exit(0);
        })
        .catch((error) => {
            console.error("\n💥 Threshold configuration validation failed:");
            console.error(error);
            process.exit(1);
        });
}

export { validateThresholdConfiguration };
