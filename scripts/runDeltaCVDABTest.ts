#!/usr/bin/env node
// scripts/runDeltaCVDABTest.ts

import { Command } from "commander";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import { WorkerProxyLogger } from "../src/multithreading/shared/workerProxyLogger.js";
import { WorkerMetricsProxy } from "../src/multithreading/shared/workerMetricsProxy.js";
import { MarketSimulator } from "../src/backtesting/marketSimulator.js";
import {
    DeltaCVDABTestFramework,
    DeltaCVDTestProfile,
} from "../src/backtesting/deltaCVDABTestFramework.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const program = new Command();

program
    .name("deltacvd-ab-test")
    .description("Run A/B testing for DeltaCVD passive volume configurations")
    .version("1.0.0");

program
    .option("-s, --symbol <symbol>", "Trading symbol", "BTCUSDT")
    .option("-d, --data <path>", "Path to historical data file")
    .option(
        "-o, --output <path>",
        "Output directory for results",
        "./ab_test_results"
    )
    .option(
        "-p, --profile <profile>",
        "Specific profile to test (or 'all' for comparison)",
        "all"
    )
    .option("--start-date <date>", "Start date (YYYY-MM-DD)")
    .option("--end-date <date>", "End date (YYYY-MM-DD)")
    .option("--parallel", "Run tests in parallel", false)
    .option("--verbose", "Enable verbose logging", false)
    .parse(process.argv);

const options = program.opts();

async function main() {
    console.log("🧪 DeltaCVD A/B Testing Framework");
    console.log("=================================\n");

    const logger: ILogger = new WorkerProxyLogger("DeltaCVD-AB-Test");
    const metricsCollector: IMetricsCollector = new WorkerMetricsProxy(
        "DeltaCVD-AB-Test"
    );

    // Create output directory
    if (!existsSync(options.output)) {
        mkdirSync(options.output, { recursive: true });
    }

    // Initialize test framework
    const testFramework = new DeltaCVDABTestFramework(logger, metricsCollector);

    // Load or generate test data
    let trades: EnrichedTradeEvent[] = [];

    if (options.data && existsSync(options.data)) {
        console.log(`📊 Loading historical data from: ${options.data}`);
        const rawData = readFileSync(options.data, "utf-8");
        trades = JSON.parse(rawData);
        console.log(`✅ Loaded ${trades.length} trades\n`);
    } else {
        console.log("📊 Generating simulated market data...");
        const simulator = new MarketSimulator(
            {
                basePrice: 50000,
                volatility: 0.02,
                trendBias: 0,
                volumeRange: { min: 0.1, max: 10 },
                depthRange: { min: 10, max: 100 },
                spoofingProbability: 0.1,
                icebergProbability: 0.05,
                hiddenOrderProbability: 0.03,
            },
            logger
        );

        // Generate 1 hour of data
        const duration = 60 * 60 * 1000; // 1 hour
        const interval = 100; // 100ms intervals

        for (let i = 0; i < duration / interval; i++) {
            const trade = simulator.generateTrade();
            trades.push(trade as EnrichedTradeEvent);

            if (i % 1000 === 0) {
                process.stdout.write(
                    `\rGenerating trades: ${((i / (duration / interval)) * 100).toFixed(1)}%`
                );
            }
        }
        console.log("\n✅ Generated test data\n");
    }

    // Note: OrderBook not needed for A/B testing framework

    // Determine which profiles to test
    const profilesToTest =
        options.profile === "all"
            ? Object.values(DeltaCVDTestProfile)
            : [options.profile as DeltaCVDTestProfile];

    console.log(`🔬 Testing profiles: ${profilesToTest.join(", ")}\n`);

    // Run tests
    const testResults = new Map();

    if (options.parallel && options.profile === "all") {
        console.log("⚡ Running tests in parallel...\n");
        const results = await testFramework.runParallelTests(
            trades,
            options.symbol
        );
        results.forEach((result, profile) => testResults.set(profile, result));
    } else {
        console.log("📋 Running tests sequentially...\n");
        for (const profile of profilesToTest) {
            console.log(`\n🧪 Testing profile: ${profile}`);
            console.log("─".repeat(40));

            const startTime = Date.now();

            // Progress tracking
            let processedTrades = 0;
            testFramework.on("progress", (progress: { processed: number }) => {
                processedTrades = progress.processed;
                process.stdout.write(
                    `\rProcessing: ${((processedTrades / trades.length) * 100).toFixed(1)}%`
                );
            });

            const result = await testFramework.runTestProfile(
                profile,
                testFramework.createTradeIterator(trades),
                options.symbol
            );

            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            console.log(`\n✅ Completed in ${duration}s`);

            // Display key metrics
            console.log("\n📊 Key Metrics:");
            console.log(`   • Total Signals: ${result.metrics.totalSignals}`);
            console.log(
                `   • Signal Accuracy: ${(result.metrics.signalAccuracy * 100).toFixed(1)}%`
            );
            console.log(
                `   • Avg Processing Time: ${result.metrics.avgProcessingTimeMs.toFixed(2)}ms`
            );
            console.log(
                `   • Memory Usage: ${result.metrics.memoryUsageMB.toFixed(1)}MB`
            );
            console.log(
                `   • Signal/Noise Ratio: ${result.metrics.signalToNoiseRatio.toFixed(3)}`
            );

            testResults.set(profile, result);
        }
    }

    // Compare results if testing all profiles
    if (options.profile === "all" && testResults.size > 1) {
        console.log("\n\n🔍 Comparing Results");
        console.log("═".repeat(50));

        const comparison = testFramework.compareResults(testResults);

        console.log(`\n🏆 Winner: ${comparison.winner || "No clear winner"}`);
        console.log(
            `📊 Statistical Confidence: ${(comparison.confidenceLevel * 100).toFixed(1)}%`
        );
        console.log(
            `🚀 Performance Gain: ${comparison.performanceGain.toFixed(1)}%`
        );
        console.log(
            `💾 Memory Reduction: ${comparison.memoryReduction.toFixed(1)}%`
        );
        console.log(
            `⚡ Speed Improvement: ${comparison.processingSpeedGain.toFixed(1)}%`
        );

        console.log("\n💡 Recommendations:");
        comparison.recommendations.forEach((rec) => console.log(`   • ${rec}`));

        // Generate detailed report
        const report = testFramework.generateReport(comparison);
        const reportPath = join(
            options.output,
            `ab_test_report_${Date.now()}.md`
        );
        writeFileSync(reportPath, report);
        console.log(`\n📄 Detailed report saved to: ${reportPath}`);
    }

    // Save raw results
    const resultsPath = join(
        options.output,
        `ab_test_results_${Date.now()}.json`
    );
    writeFileSync(
        resultsPath,
        JSON.stringify(
            {
                symbol: options.symbol,
                timestamp: new Date().toISOString(),
                totalTrades: trades.length,
                profiles: Array.from(testResults.keys()),
                results: Array.from(testResults.entries()).map(
                    ([profile, result]) => ({
                        profile,
                        ...result,
                    })
                ),
            },
            null,
            2
        )
    );

    console.log(`\n📊 Raw results saved to: ${resultsPath}`);
    console.log("\n✨ A/B testing complete!");
}

// Run the test
main().catch((error) => {
    console.error("\n❌ Error running A/B test:", error);
    process.exit(1);
});
