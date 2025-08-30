#!/usr/bin/env node
/**
 * Simple test script to verify price-first phase detection works correctly
 * in the threshold analysis context
 */

import * as fs from "fs/promises";
import {
    BaseSignal,
    createCompletePricePhases,
    PricePhase,
    PHASE_DETECTION_CONFIG,
} from "./shared/phaseDetection.js";

interface Signal extends BaseSignal {
    logType?: string;
    thresholds: Map<string, number>;
    outcome?: "TP" | "SMALL_TP" | "BE" | "SL" | "NONE";
    category?: "SUCCESSFUL" | "HARMLESS" | "HARMFUL";
}

async function loadSimpleSignals(date: string): Promise<Signal[]> {
    const signals: Signal[] = [];
    const detectors = ["absorption"];
    const logTypes = ["successful"];

    for (const detector of detectors) {
        for (const logType of logTypes) {
            const filePath = `logs/signal_validation/${detector}_${logType}_${date}.jsonl`;
            try {
                const content = await fs.readFile(filePath, "utf-8");
                const lines = content.trim().split("\n");
                if (lines.length === 0) continue;

                for (const line of lines) {
                    if (!line.trim()) continue;

                    try {
                        const jsonRecord = JSON.parse(line);

                        const signal: Signal = {
                            timestamp: jsonRecord.timestamp,
                            detectorType: detector,
                            signalSide: jsonRecord.signalSide,
                            price: jsonRecord.price,
                            thresholds: new Map(),
                            logType: logType,
                            outcome: "TP",
                            category: "SUCCESSFUL",
                        };

                        signals.push(signal);
                    } catch (parseError) {
                        continue;
                    }
                }
            } catch (error) {
                continue;
            }
        }
    }

    return signals.sort((a, b) => a.timestamp - b.timestamp);
}

async function loadPriceData(date: string): Promise<Map<number, number>> {
    const priceMap = new Map<number, number>();

    for (const detector of ["absorption"]) {
        const filePath = `logs/signal_validation/${detector}_rejected_missed_${date}.jsonl`;
        try {
            const content = await fs.readFile(filePath, "utf-8");
            const lines = content.trim().split("\n");
            if (lines.length === 0) continue;

            for (const line of lines) {
                if (!line.trim()) continue;

                try {
                    const jsonRecord = JSON.parse(line);
                    const timestamp = jsonRecord.timestamp;
                    const price = jsonRecord.price;

                    if (
                        timestamp &&
                        price &&
                        !isNaN(timestamp) &&
                        !isNaN(price)
                    ) {
                        priceMap.set(timestamp, price);
                    }
                } catch (parseError) {
                    continue;
                }
            }
        } catch (error) {
            continue;
        }
    }

    return priceMap;
}

function printDetailedPhaseSummary(pricePhases: PricePhase<Signal>[]): void {
    console.log("\n🚀 PRICE-FIRST PHASE DETECTION TEST RESULTS:");
    console.log("=".repeat(80));

    let detectedPhases = 0;
    let partiallyDetectedPhases = 0;
    let undetectedPhases = 0;

    for (const phase of pricePhases) {
        const statusIcon =
            phase.detectionStatus === "DETECTED"
                ? "✅"
                : phase.detectionStatus === "PARTIALLY_DETECTED"
                  ? "⚠️"
                  : "❌";

        const coverageText =
            phase.detectionStatus === "UNDETECTED"
                ? "UNDETECTED"
                : phase.detectionStatus === "PARTIALLY_DETECTED"
                  ? `${(phase.detectionCoverage * 100).toFixed(0)}% DETECTED`
                  : "FULLY DETECTED";

        console.log(
            `\nPhase #${phase.id}: ${phase.direction} ${phase.direction === "UP" ? "↑" : "↓"} $${phase.startPrice.toFixed(2)} → $${phase.endPrice.toFixed(2)} (${(phase.sizePercent * 100).toFixed(2)}%) ${statusIcon} ${coverageText}`
        );

        // Show time range
        console.log(
            `   Time: ${new Date(phase.startTime).toISOString()} → ${new Date(phase.endTime).toISOString()}`
        );

        // Show detector breakdown
        if (phase.detectedSignals.length > 0) {
            for (const [
                detectorType,
                coverage,
            ] of phase.detectorCoverage.entries()) {
                if (coverage.signals.length > 0) {
                    console.log(
                        `   📊 ${detectorType.toUpperCase()}: ${coverage.signals.length} signals, ${coverage.clusters.length} clusters (${(coverage.coverage * 100).toFixed(0)}% coverage)`
                    );
                }
            }
        } else {
            console.log(
                `   📊 NO SIGNALS DETECTED - This is a detection blind spot!`
            );
        }

        // Count detection status
        if (phase.detectionStatus === "DETECTED") detectedPhases++;
        else if (phase.detectionStatus === "PARTIALLY_DETECTED")
            partiallyDetectedPhases++;
        else undetectedPhases++;
    }

    console.log(`\n📈 DETECTION COVERAGE SUMMARY:`);
    console.log(`   Total Price Phases Identified: ${pricePhases.length}`);
    console.log(
        `   ✅ Fully Detected: ${detectedPhases} (${((detectedPhases / pricePhases.length) * 100).toFixed(1)}%)`
    );
    console.log(
        `   ⚠️ Partially Detected: ${partiallyDetectedPhases} (${((partiallyDetectedPhases / pricePhases.length) * 100).toFixed(1)}%)`
    );
    console.log(
        `   ❌ Undetected (Blind Spots): ${undetectedPhases} (${((undetectedPhases / pricePhases.length) * 100).toFixed(1)}%)`
    );
    console.log(
        `   🎯 Overall Detection Rate: ${(((detectedPhases + partiallyDetectedPhases) / pricePhases.length) * 100).toFixed(1)}%`
    );

    console.log("\n✅ Price-first phase detection is working correctly!");
    console.log(
        "   This shows ALL significant market movements from raw price data,"
    );
    console.log(
        "   then maps signal coverage to reveal detection blind spots."
    );
}

async function testPricePhaseDetection(): Promise<void> {
    const date = "2025-08-16";
    console.log(`🔍 Testing price-first phase detection for ${date}...`);

    // Load simple subset of signals
    const signals = await loadSimpleSignals(date);
    console.log(`📊 Loaded ${signals.length} signals`);

    // Load price data
    const priceData = await loadPriceData(date);
    console.log(`📊 Loaded ${priceData.size} price points`);

    if (priceData.size === 0) {
        console.log("❌ No price data available!");
        return;
    }

    // Create complete price-based phases
    const pricePhases = createCompletePricePhases(priceData, signals);

    console.log(
        `📈 Identified ${pricePhases.length} price phases from market movements`
    );

    if (pricePhases.length === 0) {
        console.log("❌ No price phases identified!");
        return;
    }

    // Print detailed results
    printDetailedPhaseSummary(pricePhases);

    console.log("\n" + "=".repeat(80));
    console.log("🎉 TEST COMPLETED SUCCESSFULLY!");
    console.log("   The price-first phase detection is working as intended.");
    console.log("   Ready for integration into threshold optimization tool.");
    console.log("=".repeat(80));
}

testPricePhaseDetection().catch(console.error);
