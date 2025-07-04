#!/usr/bin/env node

// absorption_zone_analysis.js
//
// 🎯 ZONE-BASED ABSORPTION ANALYSIS for 0.7%+ Turning Point Detection
//
// Focus: Zone aggregation parameters - zoneTicks, windowMs, minAggVolume (zone total)

console.log("🎯 ABSORPTION DETECTOR: Zone-Based Parameter Analysis");
console.log("====================================================\n");

import fs from "fs";
import path from "path";

// Current production configuration from config.json
const PRODUCTION_CONFIG = {
    minAggVolume: 400, // Zone aggregate volume threshold
    windowMs: 60000, // 60s time window
    zoneTicks: 5, // 5 tick zones ($0.05 for LTCUSDT)
    absorptionThreshold: 0.6,
    priceEfficiencyThreshold: 0.02,
    eventCooldownMs: 15000,
};

console.log("📊 Current Production Configuration:");
console.log("===================================");
console.log(
    `• Zone Size: ${PRODUCTION_CONFIG.zoneTicks} ticks ($${(PRODUCTION_CONFIG.zoneTicks * 0.01).toFixed(2)} range)`
);
console.log(`• Time Window: ${PRODUCTION_CONFIG.windowMs / 1000}s`);
console.log(`• Min Zone Volume: ${PRODUCTION_CONFIG.minAggVolume} (aggregate)`);
console.log(`• Absorption Threshold: ${PRODUCTION_CONFIG.absorptionThreshold}`);
console.log(
    `• Price Efficiency: ${PRODUCTION_CONFIG.priceEfficiencyThreshold}`
);
console.log("");

// Zone-based optimization strategies for 0.7%+ turning points
const ZONE_OPTIMIZATION_STRATEGIES = [
    {
        name: "sensitive_zones",
        description:
            "Smaller zones, lower volume threshold for early detection",
        configs: [
            { zoneTicks: 2, windowMs: 45000, minAggVolume: 250 }, // Tight zones, fast detection
            { zoneTicks: 3, windowMs: 45000, minAggVolume: 300 }, // Balanced size, fast detection
            { zoneTicks: 3, windowMs: 60000, minAggVolume: 250 }, // Current size, lower threshold
        ],
        rationale:
            "Catch absorption at smaller price levels, detect institutional activity sooner",
    },
    {
        name: "balanced_precision",
        description:
            "Optimize balance between detection rate and false signals",
        configs: [
            { zoneTicks: 3, windowMs: 50000, minAggVolume: 350 }, // Slightly tighter than production
            { zoneTicks: 4, windowMs: 55000, minAggVolume: 375 }, // Wider zones, moderate threshold
            { zoneTicks: 4, windowMs: 45000, minAggVolume: 300 }, // Wider zones, faster/lower threshold
        ],
        rationale:
            "Balance zone granularity with volume significance for optimal turning points",
    },
    {
        name: "institutional_focus",
        description:
            "Target major absorption events that drive significant moves",
        configs: [
            { zoneTicks: 5, windowMs: 75000, minAggVolume: 500 }, // Current zones, higher threshold
            { zoneTicks: 6, windowMs: 90000, minAggVolume: 600 }, // Broader zones, institutional volume
            { zoneTicks: 4, windowMs: 60000, minAggVolume: 450 }, // Balanced zones, higher threshold
        ],
        rationale:
            "Focus on large institutional flows that create major turning points",
    },
    {
        name: "rapid_response",
        description: "Faster detection with maintained quality thresholds",
        configs: [
            { zoneTicks: 3, windowMs: 30000, minAggVolume: 200 }, // Fast window, lower threshold
            { zoneTicks: 4, windowMs: 40000, minAggVolume: 300 }, // Medium window, moderate threshold
            { zoneTicks: 5, windowMs: 45000, minAggVolume: 350 }, // Current zones, faster timing
        ],
        rationale:
            "Quick reaction to absorption patterns for catching reversals early",
    },
];

console.log("🔬 Zone Optimization Strategies for 0.7%+ Turning Points:");
console.log("=========================================================");

ZONE_OPTIMIZATION_STRATEGIES.forEach((strategy, i) => {
    console.log(`\n${i + 1}. ${strategy.name.toUpperCase()}`);
    console.log(`   ${strategy.description}`);
    console.log(`   Rationale: ${strategy.rationale}\n`);

    strategy.configs.forEach((config, j) => {
        const zoneRangeUSD = (config.zoneTicks * 0.01).toFixed(2);
        const timeMinutes = (config.windowMs / 60000).toFixed(1);

        console.log(
            `   Config ${j + 1}: ${config.zoneTicks} ticks ($${zoneRangeUSD}), ${timeMinutes}min window, ${config.minAggVolume} vol`
        );
    });
});

// Analyze data to estimate zone volume accumulation
const dataDir = "./backtesting_data";
if (fs.existsSync(dataDir)) {
    const files = fs
        .readdirSync(dataDir)
        .filter((f) => f.includes("trades") && f.endsWith(".csv"));

    if (files.length > 0) {
        console.log("\n📈 Zone Volume Analysis from Sample Data:");
        console.log("==========================================");

        const sampleFile = path.join(dataDir, files[0]);
        const sampleData = fs.readFileSync(sampleFile, "utf8");
        const lines = sampleData.split("\n").filter((line) => line.trim());

        if (lines.length > 200) {
            console.log(`Sample file: ${files[0]}`);

            // Parse 200 trades to analyze zone accumulation patterns
            const trades = lines
                .slice(1, 201)
                .map((line) => {
                    const values = line.split(",");
                    return {
                        price: parseFloat(values[1]),
                        quantity: parseFloat(values[2]),
                        timestamp: parseInt(values[5]) || parseInt(values[0]),
                        side: values[4] === "true" ? "buy" : "sell",
                    };
                })
                .filter(
                    (trade) =>
                        !isNaN(trade.price) &&
                        !isNaN(trade.quantity) &&
                        trade.quantity > 0
                );

            if (trades.length > 50) {
                // Simulate zone volume accumulation for different zone sizes
                const zoneSizes = [2, 3, 4, 5, 6]; // tick sizes to test
                const timeWindows = [30000, 45000, 60000, 75000]; // time windows to test

                console.log(`Analyzing ${trades.length} trades...`);

                zoneSizes.forEach((zoneTicks) => {
                    const tickSize = 0.01;
                    const zoneSize = zoneTicks * tickSize;

                    // Group trades into price zones
                    const zones = {};
                    trades.forEach((trade) => {
                        const zonePrice =
                            Math.floor(trade.price / zoneSize) * zoneSize;
                        if (!zones[zonePrice]) {
                            zones[zonePrice] = {
                                volume: 0,
                                trades: [],
                                buyVolume: 0,
                                sellVolume: 0,
                            };
                        }
                        zones[zonePrice].volume += trade.quantity;
                        zones[zonePrice].trades.push(trade);
                        if (trade.side === "buy") {
                            zones[zonePrice].buyVolume += trade.quantity;
                        } else {
                            zones[zonePrice].sellVolume += trade.quantity;
                        }
                    });

                    // Analyze zone volumes
                    const zoneVolumes = Object.values(zones).map(
                        (zone) => zone.volume
                    );
                    const maxZoneVolume = Math.max(...zoneVolumes);
                    const avgZoneVolume =
                        zoneVolumes.reduce((a, b) => a + b, 0) /
                        zoneVolumes.length;
                    const zonesAbove250 = zoneVolumes.filter(
                        (v) => v >= 250
                    ).length;
                    const zonesAbove400 = zoneVolumes.filter(
                        (v) => v >= 400
                    ).length;
                    const zonesAbove500 = zoneVolumes.filter(
                        (v) => v >= 500
                    ).length;

                    console.log(
                        `\n${zoneTicks}-tick zones ($${zoneSize.toFixed(2)} range):`
                    );
                    console.log(
                        `  • Total zones: ${Object.keys(zones).length}`
                    );
                    console.log(
                        `  • Avg zone volume: ${avgZoneVolume.toFixed(1)}`
                    );
                    console.log(
                        `  • Max zone volume: ${maxZoneVolume.toFixed(1)}`
                    );
                    console.log(
                        `  • Zones ≥250 vol: ${zonesAbove250}/${Object.keys(zones).length} (${((zonesAbove250 / Object.keys(zones).length) * 100).toFixed(1)}%)`
                    );
                    console.log(
                        `  • Zones ≥400 vol: ${zonesAbove400}/${Object.keys(zones).length} (${((zonesAbove400 / Object.keys(zones).length) * 100).toFixed(1)}%)`
                    );
                    console.log(
                        `  • Zones ≥500 vol: ${zonesAbove500}/${Object.keys(zones).length} (${((zonesAbove500 / Object.keys(zones).length) * 100).toFixed(1)}%)`
                    );
                });

                console.log("\n💡 Zone Volume Insights:");
                console.log("========================");
                console.log(
                    "• Smaller zones (2-3 ticks) = more zones, lower average volume per zone"
                );
                console.log(
                    "• Larger zones (5-6 ticks) = fewer zones, higher volume concentration"
                );
                console.log(
                    "• For 0.7%+ moves: Need zones with sufficient volume to indicate institutional interest"
                );
                console.log(
                    "• Current 400 volume threshold may be appropriate for 5-tick zones"
                );
                console.log(
                    "• Consider 250-350 volume threshold for 2-4 tick zones"
                );
            }
        }
    }
}

console.log("\n🎯 Recommended Testing Sequence for 0.7%+ Turning Points:");
console.log("==========================================================");

// Generate specific test configurations with reasoning
const RECOMMENDED_TESTS = [
    {
        name: "baseline_current",
        config: PRODUCTION_CONFIG,
        reasoning: "Current production - establish baseline performance",
    },
    {
        name: "sensitive_balanced",
        config: { zoneTicks: 3, windowMs: 45000, minAggVolume: 300 },
        reasoning:
            "Current zone size, faster response, lower threshold for more signals",
    },
    {
        name: "precision_focused",
        config: { zoneTicks: 4, windowMs: 60000, minAggVolume: 450 },
        reasoning:
            "Wider zones for institutional patterns, higher threshold for quality",
    },
    {
        name: "rapid_detection",
        config: { zoneTicks: 3, windowMs: 30000, minAggVolume: 250 },
        reasoning: "Fast window for early turning point detection",
    },
    {
        name: "institutional_absorption",
        config: { zoneTicks: 6, windowMs: 75000, minAggVolume: 600 },
        reasoning:
            "Large zones and high threshold for major institutional flows only",
    },
];

RECOMMENDED_TESTS.forEach((test, i) => {
    const config = test.config;
    const zoneRangeUSD = (config.zoneTicks * 0.01).toFixed(2);

    console.log(`\n${i + 1}. ${test.name}`);
    console.log(
        `   Zone: ${config.zoneTicks} ticks ($${zoneRangeUSD}), Window: ${config.windowMs / 1000}s, Volume: ${config.minAggVolume}`
    );
    console.log(`   Reasoning: ${test.reasoning}`);
    console.log(
        `   Command: node run_hierarchical_backtest.js --detector absorptionDetector \\`
    );
    console.log(
        `            --config-override '${JSON.stringify(config)}' --speed 200 --verbose`
    );
});

console.log("\n📊 Expected Performance for 0.7%+ Turning Point Detection:");
console.log("==========================================================");
console.log(
    "• baseline_current: Establish current detection rate and false signal rate"
);
console.log(
    "• sensitive_balanced: ~15-25% more signals than baseline, may increase false positives"
);
console.log(
    "• precision_focused: ~20-30% fewer signals than baseline, should reduce false positives"
);
console.log(
    "• rapid_detection: Fastest signal generation, highest sensitivity to early reversals"
);
console.log(
    "• institutional_absorption: Lowest signal count, highest quality/confidence"
);

console.log("\n🎯 Success Metrics for 0.7%+ Moves:");
console.log("====================================");
console.log(
    "• Detection Rate: % of actual 0.7%+ price moves that had preceding absorption signals"
);
console.log(
    "• False Signal Rate: % of absorption signals NOT followed by 0.7%+ moves"
);
console.log(
    "• Signal Timing: Average time between signal and actual turning point"
);
console.log("• Direction Accuracy: % of signals with correct directional bias");
console.log("");
console.log(
    "🏆 Target Performance: >60% detection rate with <30% false signals"
);

console.log("\n✅ Zone-based analysis complete!");
console.log(
    "💡 Focus on zone aggregation parameters for institutional-grade turning point detection"
);
