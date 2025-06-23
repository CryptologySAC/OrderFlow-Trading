#!/usr/bin/env ts-node

// scripts/runBacktest.ts

import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { MarketSimulator } from "../src/backtesting/marketSimulator.js";
import { ConfigMatrix } from "../src/backtesting/configMatrix.js";
import {
    PerformanceAnalyzer,
    type PerformanceMetrics,
} from "../src/backtesting/performanceAnalyzer.js";
import {
    DetectorTestRunner,
    type TestResult,
} from "../src/backtesting/detectorTestRunner.js";
import { ResultsDashboard } from "../src/backtesting/resultsDashboard.js";

// Simple logger implementation for the script
class ScriptLogger {
    info(message: string, meta?: unknown): void {
        console.log(
            `[INFO] ${message}`,
            meta ? JSON.stringify(meta, null, 2) : ""
        );
    }

    warn(message: string, meta?: unknown): void {
        console.warn(
            `[WARN] ${message}`,
            meta ? JSON.stringify(meta, null, 2) : ""
        );
    }

    error(message: string, meta?: unknown): void {
        console.error(
            `[ERROR] ${message}`,
            meta ? JSON.stringify(meta, null, 2) : ""
        );
    }

    debug(message: string, meta?: unknown): void {
        if (process.env.DEBUG) {
            console.log(
                `[DEBUG] ${message}`,
                meta ? JSON.stringify(meta, null, 2) : ""
            );
        }
    }
}

// Simple metrics collector implementation
class ScriptMetricsCollector {
    updateMetric(): void {}
    incrementMetric(): void {}
    getMetrics(): {
        legacy: Record<string, unknown>;
        enhanced: Record<string, unknown>;
    } {
        return { legacy: {}, enhanced: {} };
    }
    getHealthSummary(): string {
        return "Healthy";
    }
    getAverageLatency(): number {
        return 0;
    }
    createCounter(): { increment: () => void; get: () => number } {
        return { increment: () => {}, get: () => 0 };
    }
    createHistogram(): { observe: (value: number) => void; get: () => Record<string, unknown> } {
        return { observe: () => {}, get: () => ({}) };
    }
    createGauge(): { set: (value: number) => void; get: () => number } {
        return { set: () => {}, get: () => 0 };
    }
}

interface BacktestConfig {
    dataDirectory: string;
    outputDirectory: string;
    symbol: string;
    speedMultiplier: number;
    parallelTests: number;
    startDate?: string;
    endDate?: string;
    detectorTypes?: string[];
    profiles?: string[];
    minSignals?: number;
    sortBy:
        | "precision"
        | "recall"
        | "f1Score"
        | "accuracy"
        | "directionAccuracy";
    includeGridSearch: boolean;
    gridSearchPoints: number;
    singleDetector?: string;
    hierarchicalTesting?: boolean;
    phase?: 1 | 2;
    verbose?: boolean;
    phase1ResultsFile?: string;
}

class BacktestRunner {
    private config: BacktestConfig;
    private logger: ScriptLogger;
    private metricsCollector: ScriptMetricsCollector;

    constructor(config: BacktestConfig) {
        this.config = config;
        this.logger = new ScriptLogger();
        this.metricsCollector = new ScriptMetricsCollector();
    }

    async run(): Promise<void> {
        try {
            this.logger.info("🚀 Starting Detector Backtesting", {
                dataDirectory: this.config.dataDirectory,
                outputDirectory: this.config.outputDirectory,
                symbol: this.config.symbol,
                speedMultiplier: this.config.speedMultiplier,
                parallelTests: this.config.parallelTests,
            });

            // Validate inputs
            this.validateConfig();

            // Ensure output directory exists
            this.ensureOutputDirectory();

            // Generate test configurations
            this.logger.info("📋 Generating test configurations...");

            // Load Phase 1 results if needed for Phase 2
            let phase1Results = undefined;
            if (
                this.config.hierarchicalTesting &&
                this.config.phase === 2 &&
                this.config.phase1ResultsFile
            ) {
                try {
                    const fs = await import("fs");
                    const resultsJson = fs.readFileSync(
                        this.config.phase1ResultsFile,
                        "utf8"
                    );
                    phase1Results = JSON.parse(resultsJson);
                    this.logger.info(
                        `📊 Loaded ${phase1Results.length} Phase 1 results for optimization`
                    );
                } catch (error) {
                    throw new Error(`Failed to load Phase 1 results: ${error}`);
                }
            }

            const configMatrix = new ConfigMatrix({
                includeProfiles: !this.config.hierarchicalTesting,
                includeGridSearch:
                    this.config.includeGridSearch &&
                    !this.config.hierarchicalTesting,
                gridSearchPoints: this.config.gridSearchPoints,
                singleDetector: this.config.singleDetector as
                    | "deltaCVDDetector"
                    | "hiddenOrderDetector"
                    | "icebergDetector"
                    | "spoofingDetector"
                    | "absorptionDetector"
                    | "exhaustionDetector",
                hierarchicalTesting: this.config.hierarchicalTesting,
                phase: this.config.phase,
                phase1Results,
            });

            let configurations = configMatrix.generateAllConfigurations();

            // Filter configurations if specified
            if (
                this.config.detectorTypes &&
                this.config.detectorTypes.length > 0
            ) {
                configurations = configurations.filter((config) =>
                    this.config.detectorTypes!.includes(config.detectorType)
                );
            }

            if (this.config.profiles && this.config.profiles.length > 0) {
                configurations = configurations.filter((config) =>
                    this.config.profiles!.includes(config.profile)
                );
            }

            // Validate configurations
            configurations = configurations.filter((config) =>
                configMatrix.validateConfiguration(config)
            );

            this.logger.info(
                `✅ Generated ${configurations.length} valid configurations`,
                {
                    byDetector: configurations.reduce(
                        (acc, config) => {
                            acc[config.detectorType] =
                                (acc[config.detectorType] || 0) + 1;
                            return acc;
                        },
                        {} as Record<string, number>
                    ),
                    byProfile: configurations.reduce(
                        (acc, config) => {
                            acc[config.profile] =
                                (acc[config.profile] || 0) + 1;
                            return acc;
                        },
                        {} as Record<string, number>
                    ),
                }
            );

            // Run tests
            this.logger.info("🧪 Starting test execution...");
            const testRunner = new DetectorTestRunner(
                {
                    dataDirectory: this.config.dataDirectory,
                    symbol: this.config.symbol,
                    speedMultiplier: this.config.speedMultiplier,
                    startDate: this.config.startDate,
                    endDate: this.config.endDate,
                    parallelTests: this.config.parallelTests,
                    logLevel: "info",
                },
                this.logger,
                this.metricsCollector
            );

            // Set up progress monitoring
            let lastProgressUpdate = 0;
            const progressUpdateInterval = this.config.verbose ? 1000 : 5000; // 1s if verbose, 5s otherwise

            testRunner.on("progress", (progress) => {
                const now = Date.now();
                if (
                    now - lastProgressUpdate < progressUpdateInterval &&
                    progress.progress < 100
                ) {
                    return; // Rate limit progress updates
                }
                lastProgressUpdate = now;

                const eta = new Date(
                    Date.now() + progress.estimatedTimeRemaining
                );

                if (this.config.verbose) {
                    // Detailed terminal progress
                    process.stdout.write("\r\x1b[K"); // Clear line
                    process.stdout.write(
                        `📊 Progress: ${progress.progress.toFixed(1)}% (${progress.completedTests}/${progress.totalTests}) - ETA: ${eta.toLocaleTimeString()}`
                    );
                    if (progress.progress === 100) {
                        process.stdout.write("\n");
                    }
                } else {
                    this.logger.info(
                        `📊 Progress: ${progress.progress.toFixed(1)}% (${progress.completedTests}/${progress.totalTests}) - ETA: ${eta.toLocaleTimeString()}`
                    );
                }
            });

            testRunner.on("testCompleted", (event) => {
                if (this.config.verbose) {
                    this.logger.info(
                        `✅ Test completed: ${event.testId} (${event.duration}ms)`
                    );
                }
            });

            testRunner.on("testFailed", (event) => {
                this.logger.error(
                    `❌ Test failed: ${event.testId} - ${event.error}`
                );
            });

            // Execute all tests
            const testResults = await testRunner.runTests(configurations);
            const performanceResults = testRunner.getPerformanceResults();

            this.logger.info("📈 Generating results dashboard...");

            // Generate dashboard and exports
            const dashboard = new ResultsDashboard({
                outputDirectory: this.config.outputDirectory,
                includeCharts: true,
                sortBy: this.config.sortBy,
                minSignals: this.config.minSignals,
            });

            dashboard.generateDashboard(testResults, performanceResults);

            // Display summary
            this.displaySummary(testResults, performanceResults);

            this.logger.info("🎉 Backtesting completed successfully!", {
                totalTests: testResults.size,
                successfulTests: Array.from(testResults.values()).filter(
                    (r) => r.success
                ).length,
                outputDirectory: this.config.outputDirectory,
            });
        } catch (error) {
            this.logger.error("💥 Backtesting failed", {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            });
            process.exit(1);
        }
    }

    private validateConfig(): void {
        if (!existsSync(this.config.dataDirectory)) {
            throw new Error(
                `Data directory does not exist: ${this.config.dataDirectory}`
            );
        }

        if (this.config.parallelTests < 1 || this.config.parallelTests > 10) {
            throw new Error("Parallel tests must be between 1 and 10");
        }

        if (
            this.config.speedMultiplier < 1 ||
            this.config.speedMultiplier > 1000
        ) {
            throw new Error("Speed multiplier must be between 1 and 1000");
        }
    }

    private ensureOutputDirectory(): void {
        if (!existsSync(this.config.outputDirectory)) {
            mkdirSync(this.config.outputDirectory, { recursive: true });
            this.logger.info(
                `📁 Created output directory: ${this.config.outputDirectory}`
            );
        }
    }

    private displaySummary(
        testResults: Map<string, TestResult>,
        performanceResults: Map<string, PerformanceMetrics>
    ): void {
        const successfulTests = Array.from(testResults.values()).filter(
            (r) => r.success
        );
        const avgDuration =
            successfulTests.reduce((sum: number, r) => sum + r.duration, 0) /
            successfulTests.length;

        // Get top 5 performers
        const rankings = Array.from(performanceResults.values())
            .sort((a, b) => b[this.config.sortBy] - a[this.config.sortBy])
            .slice(0, 5);

        console.log("\n" + "=".repeat(80));
        console.log("🏆 BACKTESTING RESULTS SUMMARY");
        console.log("=".repeat(80));
        console.log(`📊 Tests Executed: ${testResults.size}`);
        console.log(`✅ Successful: ${successfulTests.length}`);
        console.log(`❌ Failed: ${testResults.size - successfulTests.length}`);
        console.log(
            `⏱️  Avg Duration: ${(avgDuration / 1000).toFixed(1)}s per test`
        );
        console.log(
            `📈 Performance Configurations: ${performanceResults.size}`
        );

        console.log("\n🥇 TOP 5 PERFORMERS (by " + this.config.sortBy + "):");
        console.log("-".repeat(80));
        rankings.forEach((perf, index: number) => {
            console.log(
                `${index + 1}. ${perf.configId} (${perf.detectorType})`
            );
            console.log(
                `   📏 ${this.config.sortBy}: ${perf[this.config.sortBy].toFixed(3)}`
            );
            console.log(
                `   🎯 Precision: ${perf.precision.toFixed(3)} | Recall: ${perf.recall.toFixed(3)} | F1: ${perf.f1Score.toFixed(3)}`
            );
            console.log(
                `   📊 Signals: ${perf.totalSignals} | True Pos: ${perf.truePositives} | False Pos: ${perf.falsePositives}`
            );
            console.log("");
        });

        console.log("📁 Output Files:");
        console.log(
            `   • HTML Dashboard: ${join(this.config.outputDirectory, "backtesting_results.html")}`
        );
        console.log(
            `   • Performance CSV: ${join(this.config.outputDirectory, "performance_results.csv")}`
        );
        console.log(
            `   • Rankings CSV: ${join(this.config.outputDirectory, "rankings.csv")}`
        );
        console.log(
            `   • Optimal Config: ${join(this.config.outputDirectory, "optimal_configurations.json")}`
        );
        console.log(
            `   • Summary Report: ${join(this.config.outputDirectory, "performance_summary.md")}`
        );
        console.log("=".repeat(80));
    }
}

// Parse command line arguments
function parseArgs(): BacktestConfig {
    const args = process.argv.slice(2);
    const config: BacktestConfig = {
        dataDirectory: "./backtesting_data",
        outputDirectory: "./backtest_results",
        symbol: "LTCUSDT",
        speedMultiplier: 100,
        parallelTests: 1,
        sortBy: "f1Score",
        includeGridSearch: true,
        gridSearchPoints: 4,
        singleDetector: "deltaCVDDetector",
        hierarchicalTesting: false,
        phase: 1,
        verbose: false,
    };

    for (let i = 0; i < args.length; i++) {
        const key = args[i];

        switch (key) {
            case "--data-dir":
                config.dataDirectory = args[++i];
                break;
            case "--output-dir":
                config.outputDirectory = args[++i];
                break;
            case "--symbol":
                config.symbol = args[++i];
                break;
            case "--speed":
                config.speedMultiplier = parseInt(args[++i]);
                break;
            case "--parallel":
                config.parallelTests = parseInt(args[++i]);
                break;
            case "--start-date":
                config.startDate = args[++i];
                break;
            case "--end-date":
                config.endDate = args[++i];
                break;
            case "--detectors":
                config.detectorTypes = args[++i].split(",");
                break;
            case "--profiles":
                config.profiles = args[++i].split(",");
                break;
            case "--min-signals":
                config.minSignals = parseInt(args[++i]);
                break;
            case "--sort-by":
                config.sortBy = args[++i] as
                    | "precision"
                    | "recall"
                    | "f1Score"
                    | "accuracy"
                    | "directionAccuracy";
                break;
            case "--detector":
                config.singleDetector = args[++i];
                break;
            case "--hierarchical":
                config.hierarchicalTesting = true;
                break;
            case "--phase":
                config.phase = parseInt(args[++i]) as 1 | 2;
                break;
            case "--phase1-results":
                config.phase1ResultsFile = args[++i];
                break;
            case "--verbose":
            case "-v":
                config.verbose = true;
                break;
            case "--no-grid-search":
                config.includeGridSearch = false;
                break;
            case "--grid-points":
                config.gridSearchPoints = parseInt(args[++i]);
                break;
        }
    }

    return config;
}

// Display help
function displayHelp(): void {
    console.log(`
🎯 Smart Hierarchical Detector Backtesting Tool

Usage: ts-node scripts/runBacktest.ts [options]

🚀 NEW: Smart Hierarchical Testing
  --detector <name>        Single detector to test (default: deltaCVDDetector)
                          Options: deltaCVDDetector, hiddenOrderDetector, icebergDetector, 
                                  spoofingDetector, absorptionDetector, exhaustionDetector
  --hierarchical          Enable smart hierarchical testing (Phase 1 major params → Phase 2 minor params)
  --phase <1|2>           Phase for hierarchical testing (default: 1)
  --phase1-results <file> JSON file with Phase 1 results (required for Phase 2)
  --verbose, -v           Show detailed real-time progress in terminal

📊 Standard Options:
  --data-dir <path>        Data directory (default: ./backtesting_data)
  --output-dir <path>      Output directory (default: ./backtest_results)
  --symbol <symbol>        Trading symbol (default: LTCUSDT)
  --speed <multiplier>     Speed multiplier (default: 100)
  --parallel <count>       Parallel tests (default: 3)
  --start-date <date>      Start date YYYY-MM-DD (optional)
  --end-date <date>        End date YYYY-MM-DD (optional)
  --detectors <list>       Comma-separated detector types (legacy multi-detector mode)
  --profiles <list>        Comma-separated profiles: conservative,balanced,aggressive (optional)
  --min-signals <count>    Minimum signals for analysis (optional)
  --sort-by <metric>       Sort by: precision,recall,f1Score,accuracy,directionAccuracy (default: f1Score)
  --no-grid-search         Disable grid search (profile tests only)
  --grid-points <count>    Grid search points (default: 4)

🎯 Smart Testing Examples:
  # Phase 1: Test DeltaCVD major parameters (42 configurations)
  ts-node scripts/runBacktest.ts --detector deltaCVDDetector --hierarchical --phase 1 --verbose

  # Phase 2: Optimize minor parameters around best Phase 1 results
  ts-node scripts/runBacktest.ts --detector deltaCVDDetector --hierarchical --phase 2 --phase1-results ./backtest_results/rankings.csv --verbose

  # Test Hidden Order detector with smart parameter exploration
  ts-node scripts/runBacktest.ts --detector hiddenOrderDetector --hierarchical --verbose

📈 Legacy Examples:
  # Run all detectors with default settings (legacy mode)
  ts-node scripts/runBacktest.ts --detectors deltaCVDDetector,hiddenOrderDetector

  # Conservative profiles only, sorted by precision
  ts-node scripts/runBacktest.ts --profiles conservative --sort-by precision

  # Fast test with high speed multiplier
  ts-node scripts/runBacktest.ts --speed 1000 --parallel 5 --verbose
`);
}

// Main execution
async function main(): Promise<void> {
    const args = process.argv.slice(2);

    if (args.includes("--help") || args.includes("-h")) {
        displayHelp();
        return;
    }

    const config = parseArgs();
    const runner = new BacktestRunner(config);
    await runner.run();
}

// Handle unhandled errors
process.on("unhandledRejection", (reason, promise) => {
    console.error("💥 Unhandled Rejection at:", promise, "reason:", reason);
    process.exit(1);
});

process.on("uncaughtException", (error) => {
    console.error("💥 Uncaught Exception:", error);
    process.exit(1);
});

// Execute if run directly
main().catch(console.error);

export { BacktestRunner, type BacktestConfig };
