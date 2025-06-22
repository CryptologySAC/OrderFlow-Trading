#!/usr/bin/env node

// example_backtest.js - Quick example of running the backtesting framework

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("🎯 Detector Backtesting Framework Example");
console.log("==========================================\n");

// Check if data directory exists
const dataDir = "./backtesting_data";
if (!fs.existsSync(dataDir)) {
    console.error("❌ Backtesting data directory not found at:", dataDir);
    console.log(
        "Please ensure you have historical data files in the backtesting_data directory."
    );
    process.exit(1);
}

// List available data files
const dataFiles = fs.readdirSync(dataDir).filter((f) => f.endsWith(".csv"));
console.log("📁 Found data files:");
dataFiles.forEach((file) => console.log(`   • ${file}`));
console.log("");

if (dataFiles.length === 0) {
    console.error("❌ No CSV data files found in backtesting_data directory");
    process.exit(1);
}

// Create output directory
const outputDir = "./backtest_results";
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log("📁 Created output directory:", outputDir);
}

console.log("🚀 Starting backtesting...");
console.log(
    "This will test all detector configurations against historical data"
);
console.log(
    "to measure their performance in predicting 0.7%+ price movements.\n"
);

try {
    // For a quick example, let's run with limited detectors and fast speed
    const command = `npx ts-node scripts/runBacktest.ts --detectors hiddenOrderDetector,icebergDetector,spoofingDetector --speed 500 --parallel 2 --no-grid-search`;

    console.log("📊 Running command:", command);
    console.log("⏱️  This may take a few minutes...\n");

    execSync(command, {
        stdio: "inherit",
        cwd: __dirname,
    });

    console.log("\n✅ Backtesting completed successfully!");
    console.log("\n📋 Generated files:");

    const outputFiles = fs.readdirSync(outputDir);
    outputFiles.forEach((file) => {
        const filePath = path.join(outputDir, file);
        const stats = fs.statSync(filePath);
        console.log(`   • ${file} (${(stats.size / 1024).toFixed(1)} KB)`);
    });

    console.log("\n🌐 Open the HTML dashboard to view results:");
    console.log(
        `   file://${path.resolve(outputDir, "backtesting_results.html")}`
    );

    // Display quick summary from optimal configurations
    const optimalConfigPath = path.join(
        outputDir,
        "optimal_configurations.json"
    );
    if (fs.existsSync(optimalConfigPath)) {
        const optimal = JSON.parse(fs.readFileSync(optimalConfigPath, "utf8"));
        console.log("\n🏆 Best performing configuration:");
        console.log(`   • Config: ${optimal.bestOverall.configId}`);
        console.log(`   • Detector: ${optimal.bestOverall.detectorType}`);
        console.log(`   • F1 Score: ${optimal.bestOverall.score.toFixed(3)}`);
        console.log(
            `   • Precision: ${optimal.bestOverall.metrics.precision.toFixed(3)}`
        );
        console.log(
            `   • Recall: ${optimal.bestOverall.metrics.recall.toFixed(3)}`
        );
    }
} catch (error) {
    console.error("\n❌ Backtesting failed:", error.message);
    console.log("\nTroubleshooting tips:");
    console.log("• Ensure all dependencies are installed: yarn install");
    console.log("• Check that historical data files are properly formatted");
    console.log("• Try reducing --parallel parameter if running out of memory");
    console.log("• Increase --speed parameter for faster testing");
    process.exit(1);
}

console.log("\n🎉 Backtesting framework example completed!");
console.log("You can now run with different options:");
console.log("");
console.log("Examples:");
console.log("• Test all detectors: npx ts-node scripts/runBacktest.ts");
console.log(
    "• Conservative only: npx ts-node scripts/runBacktest.ts --profiles conservative"
);
console.log(
    "• Specific date range: npx ts-node scripts/runBacktest.ts --start-date 2025-06-21 --end-date 2025-06-22"
);
console.log(
    "• Sort by precision: npx ts-node scripts/runBacktest.ts --sort-by precision"
);
console.log("• Help: npx ts-node scripts/runBacktest.ts --help");
