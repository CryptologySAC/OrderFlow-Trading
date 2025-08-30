#!/usr/bin/env node
/**
 * Setup and run A/B testing for Absorption Detector optimization
 *
 * This script creates and starts an A/B test comparing different threshold
 * combinations for the absorption detector to find the optimal settings
 * for maximal profitability.
 *
 * Usage:
 *   npx tsx scripts/setupAbsorptionABTest.ts
 */

import { AbsorptionABTestManager } from "../src/services/absorptionABTestManager.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";

// Simple console-based logger for scripts
class ConsoleLogger implements ILogger {
    private correlationIds: Map<string, string> = new Map();

    constructor(private prefix: string = "") {}

    info(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        console.log(
            `ℹ️  ${this.prefix}${message}`,
            context ? JSON.stringify(context, null, 2) : ""
        );
    }

    error(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        console.error(
            `❌ ${this.prefix}${message}`,
            context ? JSON.stringify(context, null, 2) : ""
        );
    }

    warn(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        console.warn(
            `⚠️  ${this.prefix}${message}`,
            context ? JSON.stringify(context, null, 2) : ""
        );
    }

    debug(
        message: string,
        context?: Record<string, unknown>,
        correlationId?: string
    ): void {
        console.log(
            `🔍 ${this.prefix}${message}`,
            context ? JSON.stringify(context, null, 2) : ""
        );
    }

    isDebugEnabled(): boolean {
        return true; // Always enable debug for scripts
    }

    setCorrelationId(id: string, context: string): void {
        this.correlationIds.set(id, context);
    }

    removeCorrelationId(id: string): void {
        this.correlationIds.delete(id);
    }
}

// Create dependencies
const logger = new ConsoleLogger("[A/B Test] ");
const metrics = new MetricsCollector();

// Create A/B test manager
const abTestManager = new AbsorptionABTestManager(logger, metrics);

/**
 * Setup and start the absorption detector A/B test
 */
async function setupAbsorptionABTest(): Promise<void> {
    console.log("🚀 Setting up Absorption Detector A/B Test");
    console.log("==========================================");

    // Create default test configuration
    const testConfig = abTestManager.createDefaultTest();

    console.log(`📊 Test Configuration:`);
    console.log(`   Test ID: ${testConfig.testId}`);
    console.log(`   Name: ${testConfig.name}`);
    console.log(`   Duration: ${testConfig.durationHours} hours`);
    console.log(
        `   Min Samples per Variant: ${testConfig.minSamplesPerVariant}`
    );
    console.log(`   Success Metric: ${testConfig.successMetric}`);
    console.log("");

    console.log(`🎯 Test Variants:`);
    testConfig.variants.forEach((variant, index) => {
        const trafficSplit = testConfig.trafficSplit[index];
        console.log(`   ${index + 1}. ${variant.name} (${trafficSplit}%)`);
        console.log(
            `      - Passive Threshold: ${variant.thresholds.passiveAbsorptionThreshold}`
        );
        console.log(
            `      - Min Passive Multiplier: ${variant.thresholds.minPassiveMultiplier}`
        );
        console.log(
            `      - Price Efficiency: ${variant.thresholds.priceEfficiencyThreshold}`
        );
        console.log(
            `      - Max Distance from Extreme: ${(variant.phaseTiming.maxDistanceFromExtreme * 100).toFixed(2)}%`
        );
        console.log("");
    });

    // Start the test
    try {
        abTestManager.startTest(testConfig);
        console.log("✅ A/B Test started successfully!");
        console.log("");
        console.log("📈 Monitoring Instructions:");
        console.log("   - Test will run for 24 hours");
        console.log("   - Monitor logs for variant assignments");
        console.log("   - Check signal validation logs for results");
        console.log("   - Use analysis scripts to evaluate performance");
        console.log("");
        console.log("🔧 To stop the test early:");
        console.log(`   abTestManager.stopTest("${testConfig.testId}")`);
        console.log("");
        console.log("📊 Expected Results:");
        console.log("   - 5+ signals per detector per day");
        console.log("   - 7-8 signals during working hours");
        console.log("   - Balanced BUY/SELL distribution");
        console.log("   - Improved profitability with 0.7% TP / 0.35% SL");
    } catch (error) {
        console.error("❌ Failed to start A/B test:", error);
        process.exit(1);
    }
}

/**
 * Display current test status
 */
function displayTestStatus(): void {
    const activeTests = abTestManager.getActiveTests();

    if (activeTests.length === 0) {
        console.log("📊 No active A/B tests");
        return;
    }

    console.log("📊 Active A/B Tests:");
    activeTests.forEach((test) => {
        console.log(`   - ${test.name} (${test.testId})`);
        console.log(
            `     Duration: ${test.durationHours}h | Variants: ${test.variants.length}`
        );
        console.log(`     Traffic Split: ${test.trafficSplit.join("% / ")}%`);
    });
}

/**
 * Example of how to integrate A/B testing with absorption detector
 */
function showIntegrationExample(): void {
    console.log("");
    console.log("🔧 Integration Example:");
    console.log("======================");
    console.log(`
// In your absorption detector constructor:
const abTestManager = new AbsorptionABTestManager(logger, metrics);
const testConfig = abTestManager.createDefaultTest();
abTestManager.startTest(testConfig);

// When processing signals:
const variant = abTestManager.assignVariant(detectorId, testConfig.testId);
if (variant) {
    // Apply variant-specific thresholds
    this.settings.passiveAbsorptionThreshold = variant.thresholds.passiveAbsorptionThreshold;
    this.settings.minPassiveMultiplier = variant.thresholds.minPassiveMultiplier;
    // ... apply other variant settings
}

// When signal completes:
abTestManager.recordSignalResult(detectorId, testConfig.testId, variant.variantId, {
    signalId: signal.id,
    side: signal.side,
    price: signal.price,
    reachedTP: reachedTarget,
    profit: profit,
    timeToTP: timeToTP,
    maxDrawdown: maxDrawdown,
    riskReason: riskReason
});
    `);
}

// Run the setup
setupAbsorptionABTest()
    .then(() => {
        displayTestStatus();
        showIntegrationExample();
    })
    .catch(console.error);
