#!/usr/bin/env node

// run_hierarchical_backtest.js - Smart hierarchical backtesting using compiled JavaScript

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

// Import compiled modules
import { ConfigMatrix } from "./dist/backtesting/configMatrix.js";
import { DetectorTestRunner } from "./dist/backtesting/detectorTestRunner.js";
import { ResultsDashboard } from "./dist/backtesting/resultsDashboard.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class HierarchicalBacktestRunner {
    constructor() {
        this.config = this.parseArgs();
        console.log("🎯 Smart Hierarchical Backtesting Framework");
        console.log("===========================================");
    }

    parseArgs() {
        const args = process.argv.slice(2);
        const config = {
            dataDirectory: "./backtesting_data",
            outputDirectory: "./backtest_results",
            symbol: "LTCUSDT",
            speedMultiplier: 100,
            parallelTests: 1, // Reduced for memory management
            sortBy: "f1Score",
            singleDetector: "deltaCVDDetector",
            hierarchicalTesting: false,
            phase: 1,
            verbose: false,
        };

        for (let i = 0; i < args.length; i++) {
            switch (args[i]) {
                case "--detector":
                    config.singleDetector = args[++i];
                    break;
                case "--hierarchical":
                    config.hierarchicalTesting = true;
                    break;
                case "--phase":
                    config.phase = parseInt(args[++i]);
                    break;
                case "--verbose":
                case "-v":
                    config.verbose = true;
                    break;
                case "--speed":
                    config.speedMultiplier = parseInt(args[++i]);
                    break;
                case "--parallel":
                    config.parallelTests = parseInt(args[++i]);
                    break;
                case "--help":
                    this.showHelp();
                    process.exit(0);
            }
        }

        return config;
    }

    showHelp() {
        console.log(`
🎯 Smart Hierarchical Backtesting Framework

Usage: node run_hierarchical_backtest.js [options]

Options:
  --detector <name>     Single detector to test (default: deltaCVDDetector)
  --hierarchical        Enable smart hierarchical testing (Phase 1 → Phase 2)
  --phase <1|2>         Phase for hierarchical testing (default: 1)
  --verbose, -v         Show detailed real-time progress in terminal
  --speed <multiplier>  Speed multiplier 1-1000 (default: 100)
  --parallel <count>    Parallel tests 1-10 (default: 1)
  --help               Show this help message

Examples:
  # Phase 1: Test 42 major parameter combinations
  node run_hierarchical_backtest.js --detector deltaCVDDetector --hierarchical --phase 1 --verbose

  # Phase 2: Optimize minor parameters around best Phase 1 results
  node run_hierarchical_backtest.js --detector deltaCVDDetector --hierarchical --phase 2 --verbose
        `);
    }

    async run() {
        try {
            // Check data directory
            if (!fs.existsSync(this.config.dataDirectory)) {
                console.error(
                    `❌ Data directory not found: ${this.config.dataDirectory}`
                );
                process.exit(1);
            }

            // Create output directory
            if (!fs.existsSync(this.config.outputDirectory)) {
                fs.mkdirSync(this.config.outputDirectory, { recursive: true });
            }

            // Generate configurations
            console.log(
                `📊 Generating ${this.config.hierarchicalTesting ? "hierarchical" : "standard"} test configurations...`
            );

            const configMatrix = new ConfigMatrix({
                singleDetector: this.config.singleDetector,
                hierarchicalTesting: this.config.hierarchicalTesting,
                phase: this.config.phase,
                includeProfiles: !this.config.hierarchicalTesting,
                includeGridSearch: !this.config.hierarchicalTesting,
            });
            
            const configurations = configMatrix.generateAllConfigurations();

            console.log(
                `🧪 Testing ${configurations.length} configurations for ${this.config.singleDetector}`
            );
            if (this.config.hierarchicalTesting) {
                console.log(
                    `📊 Hierarchical Phase ${this.config.phase} testing enabled`
                );
            }

            // Create mock logger and metrics collector
            const mockLogger = {
                info: (...args) =>
                    this.config.verbose && console.log("[INFO]", ...args),
                warn: (...args) => console.warn("[WARN]", ...args),
                error: (...args) => console.error("[ERROR]", ...args),
                debug: (...args) =>
                    this.config.verbose && console.log("[DEBUG]", ...args),
                isDebugEnabled: () => this.config.verbose,
                setCorrelationId: () => {},
                removeCorrelationId: () => {},
            };

            const mockMetrics = {
                updateMetric: () => {},
                incrementMetric: () => {},
                getMetrics: () => ({ legacy: {}, enhanced: {} }),
                getHealthSummary: () => "Healthy",
                getAverageLatency: () => 0,
            };

            // Create test runner
            const testRunnerConfig = {
                dataDirectory: this.config.dataDirectory,
                symbol: this.config.symbol,
                speedMultiplier: this.config.speedMultiplier,
                parallelTests: this.config.parallelTests,
                logLevel: "info",
            };

            const testRunner = new DetectorTestRunner(
                testRunnerConfig,
                mockLogger,
                mockMetrics
            );

            // Set up progress reporting
            if (this.config.verbose) {
                testRunner.on("progress", (progress) => {
                    const eta = new Date(
                        Date.now() + progress.estimatedTimeRemaining
                    );
                    process.stdout.write("\r\x1b[K"); // Clear line
                    process.stdout.write(
                        `📊 Progress: ${progress.progress.toFixed(1)}% (${progress.completedTests}/${progress.totalTests}) - ETA: ${eta.toLocaleTimeString()}`
                    );
                });

                testRunner.on("testCompleted", (event) => {
                    if (this.config.verbose) {
                        console.log(
                            `\n✅ Test completed: ${event.testId} (${event.duration}ms)`
                        );
                    }
                });

                testRunner.on("testFailed", (event) => {
                    console.log(
                        `\n❌ Test failed: ${event.testId} - ${event.error}`
                    );
                });
            }

            // Execute tests
            console.log("🚀 Starting detector backtesting...");
            const testResults = await testRunner.runTests(configurations);
            const performanceResults = testRunner.getPerformanceResults();

            if (this.config.verbose) {
                console.log("\n📈 Generating results dashboard...");
            }

            // Generate dashboard
            const dashboard = new ResultsDashboard({
                outputDirectory: this.config.outputDirectory,
                includeCharts: true,
                sortBy: this.config.sortBy,
                minSignals: 0,
            });

            dashboard.generateDashboard(testResults, performanceResults);

            // Show summary
            console.log("\n🎉 Backtesting completed successfully!");
            console.log(`📁 Results saved to: ${this.config.outputDirectory}`);
            console.log(`📊 Tested ${testResults.size} configurations`);
            console.log(
                `🏆 Top performer saved in optimal_configurations.json`
            );

            // Show top 3 results
            const sortedResults = Array.from(performanceResults.values())
                .sort((a, b) => b.f1Score - a.f1Score)
                .slice(0, 3);

            console.log("\n🏆 Top 3 Configurations:");
            sortedResults.forEach((result, index) => {
                console.log(`${index + 1}. ${result.configId}`);
                console.log(
                    `   F1-Score: ${result.f1Score.toFixed(3)} | Precision: ${result.precision.toFixed(3)} | Recall: ${result.recall.toFixed(3)}`
                );
                console.log(
                    `   Signals: ${result.totalSignals} | Direction Accuracy: ${result.directionAccuracy.toFixed(3)}`
                );
            });

            console.log(
                `\n🌐 Open dashboard: open ${this.config.outputDirectory}/backtesting_results.html`
            );
        } catch (error) {
            console.error("❌ Backtesting failed:", error.message);
            if (this.config.verbose) {
                console.error(error.stack);
            }
            process.exit(1);
        }
    }
}

// Run the backtest
const runner = new HierarchicalBacktestRunner();
runner.run().catch(console.error);
