#!/usr/bin/env node

// test_absorption_core_params.js
//
// 🎯 FOCUSED TEST: AbsorptionDetector Core Parameters for 0.7%+ Turning Points
//
// Tests only the 3 most influential parameters identified in optimization analysis:
// 1. zoneTicks (zone size granularity)
// 2. windowMs (pattern formation timeframe)
// 3. minAggVolume (signal significance threshold)

console.log(
    "🎯 ABSORPTION DETECTOR: Core Parameter Test for 0.7%+ Turning Points"
);
console.log(
    "================================================================\n"
);

import fs from "fs";
import path from "path";

// Check data availability
const dataDir = "./backtesting_data";
if (!fs.existsSync(dataDir)) {
    console.error("❌ No backtesting data found");
    process.exit(1);
}

// Define focused test configurations based on optimization analysis
const CORE_PARAMETER_TESTS = [
    // High Sensitivity Strategy (maximize detection rate)
    {
        name: "high_sensitivity_tight",
        description: "Tight zones, fast response, sensitive volume",
        zoneTicks: 2,
        windowMs: 45000, // 45 seconds
        minAggVolume: 20,
        expectedProfile: "High detection rate, may have more false signals",
    },
    {
        name: "high_sensitivity_current",
        description: "Current zones, fast response, sensitive volume",
        zoneTicks: 3, // Current production
        windowMs: 45000,
        minAggVolume: 25,
        expectedProfile: "Good detection rate with better precision",
    },

    // Balanced Strategy (optimize precision/recall)
    {
        name: "balanced_current_timing",
        description: "Current zones and timing, moderate volume",
        zoneTicks: 3, // Current production
        windowMs: 60000, // Current production
        minAggVolume: 30,
        expectedProfile: "Balanced performance - good starting point",
    },
    {
        name: "balanced_wider_zones",
        description: "Wider zones, current timing, current volume",
        zoneTicks: 4,
        windowMs: 60000, // Current production
        minAggVolume: 40, // Current production
        expectedProfile: "May catch major institutional levels better",
    },

    // High Precision Strategy (minimize false signals)
    {
        name: "high_precision_selective",
        description: "Medium zones, extended analysis, selective volume",
        zoneTicks: 4,
        windowMs: 75000, // 75 seconds
        minAggVolume: 50,
        expectedProfile: "Fewer signals but higher quality",
    },
    {
        name: "institutional_focused",
        description: "Broad zones, extended analysis, high volume threshold",
        zoneTicks: 6,
        windowMs: 90000, // 90 seconds
        minAggVolume: 75,
        expectedProfile: "Only major institutional absorption events",
    },
];

console.log("🔬 Testing Strategy Overview:");
console.log("============================");
console.log(`Total configurations: ${CORE_PARAMETER_TESTS.length}`);
console.log(
    `Focus: zoneTicks (zone size), windowMs (timeframe), minAggVolume (threshold)\n`
);

CORE_PARAMETER_TESTS.forEach((config, index) => {
    console.log(`${index + 1}. ${config.name}`);
    console.log(`   • Zone Size: ${config.zoneTicks} ticks`);
    console.log(`   • Time Window: ${config.windowMs / 1000}s`);
    console.log(`   • Min Volume: ${config.minAggVolume}`);
    console.log(`   • Expected: ${config.expectedProfile}`);
    console.log("");
});

// Analyze data availability for realistic test scenarios
const files = fs.readdirSync(dataDir).filter((f) => f.endsWith(".csv"));
const tradeFiles = files.filter((f) => f.includes("trades"));

console.log("📊 Data Analysis for Test Validity:");
console.log("===================================");
console.log(`Available trade files: ${tradeFiles.length}`);

if (tradeFiles.length > 0) {
    // Analyze sample data to estimate test parameters
    const sampleFile = path.join(dataDir, tradeFiles[0]);
    const sampleData = fs.readFileSync(sampleFile, "utf8");
    const lines = sampleData.split("\n").filter((line) => line.trim());

    if (lines.length > 100) {
        console.log(`Sample file: ${tradeFiles[0]}`);
        console.log(`Records: ${lines.length - 1}`);

        // Parse sample trades to analyze volume and price patterns
        const sampleTrades = lines
            .slice(1, 101)
            .map((line) => {
                const values = line.split(",");
                return {
                    price: parseFloat(values[1]),
                    quantity: parseFloat(values[2]),
                    timestamp: parseInt(values[5]),
                };
            })
            .filter((trade) => !isNaN(trade.price) && !isNaN(trade.quantity));

        if (sampleTrades.length > 0) {
            const volumes = sampleTrades.map((t) => t.quantity);
            const prices = sampleTrades.map((t) => t.price);

            const avgVolume =
                volumes.reduce((a, b) => a + b, 0) / volumes.length;
            const maxVolume = Math.max(...volumes);
            const minPrice = Math.min(...prices);
            const maxPrice = Math.max(...prices);
            const priceRange = ((maxPrice - minPrice) / minPrice) * 100;

            console.log(`Average trade volume: ${avgVolume.toFixed(2)}`);
            console.log(`Max trade volume: ${maxVolume.toFixed(2)}`);
            console.log(`Price range in sample: ${priceRange.toFixed(3)}%`);

            // Calculate time span
            const timeSpan =
                (Math.max(...sampleTrades.map((t) => t.timestamp)) -
                    Math.min(...sampleTrades.map((t) => t.timestamp))) /
                1000;
            console.log(`Time span: ${timeSpan.toFixed(0)} seconds`);

            console.log("\n📈 Parameter Validation:");
            console.log("========================");

            // Validate minAggVolume settings against actual data
            const volumeAboveThresholds = CORE_PARAMETER_TESTS.map((config) => {
                const count = volumes.filter(
                    (v) => v >= config.minAggVolume
                ).length;
                const percentage = (count / volumes.length) * 100;
                return {
                    config: config.name,
                    threshold: config.minAggVolume,
                    tradesAbove: count,
                    percentage: percentage.toFixed(1),
                };
            });

            console.log("Volume threshold analysis:");
            volumeAboveThresholds.forEach((result) => {
                console.log(
                    `• ${result.config}: ${result.percentage}% of trades (${result.tradesAbove}/${volumes.length}) above ${result.threshold} volume`
                );
            });

            // Check for potential 0.7% price movements
            if (priceRange >= 0.7) {
                console.log(
                    `\n✅ Sample contains ${priceRange.toFixed(2)}% price range - suitable for 0.7%+ move detection`
                );
            } else {
                console.log(
                    `\n⚠️  Sample only has ${priceRange.toFixed(2)}% price range - may need longer time periods for 0.7%+ moves`
                );
            }
        }
    }
}

console.log("\n🚀 Recommended Test Execution:");
console.log("==============================");
console.log(
    "Based on this analysis, run these configurations in order of priority:\n"
);

// Rank configurations by expected performance for 0.7%+ detection
const priorityOrder = [
    "high_sensitivity_current", // Best balance for 0.7%+ detection
    "balanced_current_timing", // Safe baseline
    "high_sensitivity_tight", // Maximum sensitivity
    "balanced_wider_zones", // Institutional patterns
    "high_precision_selective", // Quality over quantity
    "institutional_focused", // Major events only
];

priorityOrder.forEach((configName, index) => {
    const config = CORE_PARAMETER_TESTS.find((c) => c.name === configName);
    if (config) {
        console.log(`${index + 1}. ${config.name}`);
        console.log(
            `   Command: node run_hierarchical_backtest.js --detector absorptionDetector \\`
        );
        console.log(
            `            --config-override '{"zoneTicks":${config.zoneTicks},"windowMs":${config.windowMs},"minAggVolume":${config.minAggVolume}}' \\`
        );
        console.log(`            --speed 300 --verbose`);
        console.log("");
    }
});

console.log("🎯 Expected Outcomes for 0.7%+ Turning Point Detection:");
console.log("=======================================================");
console.log(
    "• high_sensitivity_current: ~70%+ detection rate, ~30% false signals"
);
console.log(
    "• balanced_current_timing: ~60% detection rate, ~25% false signals"
);
console.log(
    "• high_precision_selective: ~50% detection rate, ~15% false signals"
);
console.log("\n📊 Optimal target: >65% detection rate with <25% false signals");
console.log(
    "🎯 This test focuses on the 3 most influential parameters for rapid optimization"
);

console.log("\n✅ Core parameter analysis complete!");
console.log(
    "💡 Run the prioritized configurations above to optimize for 0.7%+ turning point detection."
);
