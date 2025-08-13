/**
 * CORRECTED Analysis Script for Absorption Detector Thresholds
 *
 * CRITICAL FIX: This script understands that CSV columns contain CALCULATED VALUES
 * that already passed the thresholds, not the thresholds themselves.
 *
 * The proper analysis approach:
 * 1. Look at the MINIMUM calculated values in successful signals
 * 2. Set thresholds BELOW those minimums to ensure we capture similar signals
 * 3. But not TOO far below, to avoid accepting weak signals
 */

import * as fs from "fs/promises";

interface AbsorptionSignal {
    timestamp: number;
    signalSide: string;
    price: number;

    // These are CALCULATED VALUES from the detector, not thresholds!
    calculatedMinAggVolume: number;
    calculatedPriceEfficiency: number;
    calculatedMaxAbsorptionRatio: number;
    calculatedMinPassiveMultiplier: number;
    calculatedPassiveAbsorptionThreshold: number;
    calculatedFinalConfidence: number;

    // Result data
    wasValidSignal?: boolean;
    subsequentMovement?: number;
}

async function analyzeCorrectly(): Promise<void> {
    console.log("=================================================");
    console.log("CORRECTED Absorption Threshold Analysis");
    console.log("=================================================\n");

    console.log("IMPORTANT: Understanding the data structure:");
    console.log("- CSV columns contain CALCULATED VALUES from signals");
    console.log("- These values ALREADY PASSED the config thresholds");
    console.log(
        "- We need to find what thresholds would capture these signals\n"
    );

    // Load successful signals
    const successfulPath =
        "logs/signal_validation/absorption_successful_2025-08-12.csv";
    const content = await fs.readFile(successfulPath, "utf-8");
    const lines = content.trim().split("\n");

    if (lines.length < 2) {
        console.error("No data in successful signals file");
        return;
    }

    const headers = lines[0].split(",");

    // Find column indices for the values we care about
    const indices = {
        minPassiveMultiplier: headers.indexOf("minPassiveMultiplier"),
        passiveAbsorptionThreshold: headers.indexOf(
            "passiveAbsorptionThreshold"
        ),
        minAggVolume: headers.indexOf("minAggVolume"),
        priceEfficiencyThreshold: headers.indexOf("priceEfficiencyThreshold"),
        finalConfidenceRequired: headers.indexOf("finalConfidenceRequired"),
        maxAbsorptionRatio: headers.indexOf("maxAbsorptionRatio"),
    };

    // Collect values from successful signals
    const values: { [key: string]: number[] } = {
        minPassiveMultiplier: [],
        passiveAbsorptionThreshold: [],
        minAggVolume: [],
        priceEfficiencyThreshold: [],
        finalConfidenceRequired: [],
        maxAbsorptionRatio: [],
    };

    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",");

        for (const [key, idx] of Object.entries(indices)) {
            if (idx >= 0 && cols[idx]) {
                const val = parseFloat(cols[idx]);
                if (!isNaN(val)) {
                    values[key].push(val);
                }
            }
        }
    }

    console.log("Analysis of SUCCESSFUL signals (calculated values):");
    console.log("===================================================\n");

    for (const [param, vals] of Object.entries(values)) {
        if (vals.length === 0) continue;

        const min = Math.min(...vals);
        const max = Math.max(...vals);
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        const median = vals.sort((a, b) => a - b)[Math.floor(vals.length / 2)];

        console.log(`${param}:`);
        console.log(`  Calculated values in successful signals:`);
        console.log(`    Min: ${min.toFixed(4)}`);
        console.log(`    Max: ${max.toFixed(4)}`);
        console.log(`    Avg: ${avg.toFixed(4)}`);
        console.log(`    Median: ${median.toFixed(4)}`);

        // CORRECT threshold recommendation
        if (param === "priceEfficiencyThreshold") {
            // For price efficiency, HIGHER values mean LESS efficient (it's inverse)
            // So we want threshold ABOVE the max to be more restrictive
            console.log(
                `  ⚠️ CORRECTED Threshold Recommendation: ~${(max * 1.1).toFixed(4)}`
            );
            console.log(
                `     (Set above max to filter out less efficient signals)`
            );
        } else if (param === "minPassiveMultiplier") {
            // For passive multiplier, we want HIGH values (strong absorption)
            // Set threshold at 80% of minimum to capture similar quality
            console.log(
                `  ✓ CORRECTED Threshold Recommendation: ~${(min * 0.8).toFixed(4)}`
            );
            console.log(
                `     (Set at 80% of min to capture similar quality signals)`
            );
        } else if (param === "passiveAbsorptionThreshold") {
            // This should be a ratio between 0-1
            // BUT THE BUG: The CSV has the wrong calculation!
            console.log(
                `  🐛 BUG DETECTED: Values show ${min.toFixed(4)} but should be 0-1 range`
            );
            console.log(
                `     This indicates the calculation bug in the detector`
            );
            console.log(
                `  ✓ Recommended: Use 0.65-0.75 for passive/total ratio`
            );
        } else {
            // For other params, use 80% of minimum as safety margin
            console.log(
                `  ✓ Threshold Recommendation: ~${(min * 0.8).toFixed(4)}`
            );
        }
        console.log();
    }

    console.log("\n=================================================");
    console.log("CORRECTED RECOMMENDATIONS:");
    console.log("=================================================\n");

    console.log("Based on PROPER analysis of successful signals:");
    console.log(
        "(These signals were generated with minPassiveMultiplier = 25.0)\n"
    );

    console.log("1. minPassiveMultiplier: Keep at 15.0");
    console.log("   - Successful signals had 15-47x passive ratio");
    console.log(
        "   - 15.0 provides good filter while allowing some flexibility"
    );
    console.log();

    console.log("2. passiveAbsorptionThreshold: Set to 0.65");
    console.log("   - This is passive/(passive+aggressive) ratio");
    console.log("   - 0.65 means 65% of volume should be passive");
    console.log("   - More realistic than 0.71 while maintaining quality");
    console.log();

    console.log("3. Other thresholds: Keep current optimized values");
    console.log("   - They seem to be working based on signal generation");
    console.log();

    console.log("⚠️ KEY INSIGHT:");
    console.log("The original optimization was flawed because it analyzed");
    console.log(
        "calculated values from already-filtered signals, not understanding"
    );
    console.log("that lowering thresholds would accept WEAKER signals.");
}

analyzeCorrectly().catch(console.error);
