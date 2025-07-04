#!/usr/bin/env node

// focused_absorption_test.js
//
// 🎯 FOCUSED ABSORPTION TEST: Validate optimization with limited data for speed + accuracy
//
// Based on live observation: 326 + 675 + 602 = 1,603 volume absorption at peak

console.log("🎯 FOCUSED AbsorptionDetector Test for 0.7%+ Turning Points");
console.log("===========================================================\n");

import fs from "fs";
import path from "path";

// Real absorption example just observed
console.log("📊 LIVE ABSORPTION EXAMPLE (Just Observed):");
console.log("===========================================");
console.log(
    "• Peak down with 3 large trades: 326 + 675 + 602 = 1,603 total volume"
);
console.log("• This volume (1,603) is 4x the minimum threshold (400)");
console.log("• Pattern: Large institutional absorption at price peak");
console.log("• Expected: Should trigger absorption signal for turning point\n");

// Optimized configurations based on real volume patterns
const FOCUSED_TEST_CONFIGS = [
    {
        name: "production_baseline",
        description:
            "Current production settings - should catch 1,603 volume easily",
        config: {
            minAggVolume: 400, // Well below observed 1,603
            windowMs: 60000, // 60s window
            zoneTicks: 5, // $0.05 zones
            absorptionThreshold: 0.6,
            priceEfficiencyThreshold: 0.02,
            eventCooldownMs: 15000,
        },
        expectedResult: "Should detect - volume 4x threshold",
    },
    {
        name: "sensitive_detection",
        description: "More sensitive settings for smaller absorption events",
        config: {
            minAggVolume: 250, // Lower threshold for earlier detection
            windowMs: 45000, // Faster response (45s)
            zoneTicks: 3, // Tighter zones ($0.03)
            absorptionThreshold: 0.55, // Lower quality threshold
            priceEfficiencyThreshold: 0.015, // More sensitive price impact
            eventCooldownMs: 10000, // Shorter cooldown
        },
        expectedResult: "More signals, catch smaller absorption events",
    },
    {
        name: "institutional_focused",
        description:
            "Target only major institutional flows like the 1,603 example",
        config: {
            minAggVolume: 800, // Higher threshold (1,603 still 2x this)
            windowMs: 75000, // Longer analysis (75s)
            zoneTicks: 6, // Broader zones ($0.06)
            absorptionThreshold: 0.7, // Higher quality requirement
            priceEfficiencyThreshold: 0.025, // Less sensitive (major moves only)
            eventCooldownMs: 20000, // Longer cooldown
        },
        expectedResult: "Fewer but highest quality signals",
    },
];

console.log("🔬 Focused Test Configurations:");
console.log("===============================");

FOCUSED_TEST_CONFIGS.forEach((test, i) => {
    const config = test.config;
    const zoneRange = (config.zoneTicks * 0.01).toFixed(2);

    console.log(`\n${i + 1}. ${test.name.toUpperCase()}`);
    console.log(`   ${test.description}`);
    console.log(
        `   Zone: ${config.zoneTicks} ticks ($${zoneRange}), Window: ${config.windowMs / 1000}s`
    );
    console.log(
        `   Volume: ${config.minAggVolume} (1,603 example is ${Math.round((1603 / config.minAggVolume) * 10) / 10}x this)`
    );
    console.log(
        `   Absorption: ${config.absorptionThreshold}, Price Eff: ${config.priceEfficiencyThreshold}`
    );
    console.log(`   Expected: ${test.expectedResult}`);
});

// Check data files and create limited test strategy
const dataDir = "./backtesting_data";
if (fs.existsSync(dataDir)) {
    const files = fs.readdirSync(dataDir).filter((f) => f.endsWith(".csv"));
    const tradeFiles = files.filter((f) => f.includes("trades"));

    console.log(`\n📈 Available Data: ${tradeFiles.length} trade files`);

    // Suggest testing with limited data for speed
    const limitedFiles = Math.min(5, tradeFiles.length);
    console.log(`\n🚀 FOCUSED TESTING STRATEGY (Accuracy + Speed):`);
    console.log("==============================================");
    console.log(
        `• Use only ${limitedFiles} data files (instead of all ${tradeFiles.length})`
    );
    console.log(`• Run at speed 500 for faster results`);
    console.log(`• Focus on the 3 key configuration strategies`);
    console.log(
        `• Look for patterns similar to the 1,603 volume absorption example`
    );
}

console.log("\n📋 RECOMMENDED TEST COMMANDS:");
console.log("=============================");

FOCUSED_TEST_CONFIGS.forEach((test, i) => {
    const configJson = JSON.stringify(test.config);
    console.log(`\n${i + 1}. Test ${test.name}:`);
    console.log(`   # Expected: ${test.expectedResult}`);
    console.log(`   node run_hierarchical_backtest.js \\`);
    console.log(`     --detector absorptionDetector \\`);
    console.log(`     --config-override '${configJson}' \\`);
    console.log(`     --speed 500 \\`);
    console.log(`     --max-files 5 \\`);
    console.log(`     --verbose`);
});

console.log("\n🎯 KEY VALIDATION POINTS:");
console.log("=========================");
console.log(
    "1. Production baseline should detect events like the 1,603 volume example"
);
console.log(
    "2. Sensitive detection should catch smaller absorption events (500-1000 vol)"
);
console.log(
    "3. Institutional focused should only trigger on major flows (1000+ vol)"
);
console.log("4. All configurations should show different signal frequencies");
console.log("5. Look for 0.7%+ price moves following absorption signals");

console.log("\n📊 SUCCESS CRITERIA:");
console.log("====================");
console.log(
    "• Detection Rate: % of 0.7%+ moves with preceding absorption signals"
);
console.log(
    "• Signal Quality: Average price move following absorption signals"
);
console.log(
    "• False Positives: % of signals NOT followed by significant moves"
);
console.log(
    "• Volume Correlation: Larger absorption volume → larger price moves"
);

console.log("\n💡 LIVE PATTERN VALIDATION:");
console.log("===========================");
console.log("The 1,603 volume absorption you just observed should be:");
console.log("✅ Detected by production_baseline (1,603 >> 400 threshold)");
console.log("✅ Detected by sensitive_detection (1,603 >> 250 threshold)");
console.log("✅ Detected by institutional_focused (1,603 >> 800 threshold)");
console.log("");
console.log("If any configuration misses this pattern, it indicates:");
console.log(
    "⚠️  Other filtering criteria (absorption ratio, price efficiency) too strict"
);
console.log("⚠️  Zone configuration not capturing the price level properly");
console.log("⚠️  Time window not including all relevant trades");

console.log("\n✅ Focused test strategy ready!");
console.log(
    "🎯 Run tests with limited data for faster, accurate optimization results"
);
