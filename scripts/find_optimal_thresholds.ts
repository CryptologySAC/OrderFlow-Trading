#!/usr/bin/env node
/**
 * Find optimal thresholds by combining rejected_missed (profitable rejections)
 * and validation logs (SL signals) to maximize net benefit
 */

import * as fs from "fs/promises";

interface SignalRecord {
    timestamp: number;
    detectorType: "absorption" | "exhaustion" | "deltacvd";
    signalSide: "buy" | "sell";
    price: number;
    tpSlStatus: "TP" | "SL" | "NEITHER";
    thresholdChecks: any;
    source: "rejected_missed" | "validation";
}

async function loadAllSignals(date: string): Promise<SignalRecord[]> {
    const records: SignalRecord[] = [];

    // Load rejected_missed signals (would have been TP if not rejected)
    for (const detector of ["absorption", "exhaustion"]) {
        const filePath = `logs/signal_validation/${detector}_rejected_missed_${date}.jsonl`;

        try {
            const content = await fs.readFile(filePath, "utf-8");
            const lines = content.trim().split("\n");

            for (const line of lines) {
                if (!line.trim()) continue;

                try {
                    const record = JSON.parse(line) as any;
                    records.push({
                        timestamp: record.timestamp,
                        detectorType: record.detectorType,
                        signalSide: record.signalSide,
                        price: record.price,
                        tpSlStatus: "TP", // These would have been TP
                        thresholdChecks: record.thresholdChecks,
                        source: "rejected_missed",
                    });
                } catch (parseError) {
                    // Skip parse errors
                }
            }
        } catch (error) {
            // File doesn't exist
        }
    }

    // Load validation signals (actual outcomes)
    for (const detector of ["absorption", "exhaustion", "deltacvd"]) {
        const filePath = `logs/signal_validation/${detector}_validation_${date}.jsonl`;

        try {
            const content = await fs.readFile(filePath, "utf-8");
            const lines = content.trim().split("\n");

            for (const line of lines) {
                if (!line.trim()) continue;

                try {
                    const record = JSON.parse(line) as any;
                    records.push({
                        timestamp: record.timestamp,
                        detectorType: record.detectorType,
                        signalSide: record.signalSide,
                        price: record.price,
                        tpSlStatus: record.tpSlStatus,
                        thresholdChecks: record.thresholdChecks,
                        source: "validation",
                    });
                } catch (parseError) {
                    // Skip parse errors
                }
            }
        } catch (error) {
            // File doesn't exist
        }
    }

    return records;
}

function findOptimalThreshold(
    signals: SignalRecord[],
    thresholdName: string,
    detector: string
): {
    threshold: number;
    netBenefit: number;
    tpKept: number;
    slEliminated: number;
} {
    const detectorSignals = signals.filter((s) => s.detectorType === detector);
    const signalsWithThreshold = detectorSignals.filter(
        (s) => s.thresholdChecks?.[thresholdName]
    );

    if (signalsWithThreshold.length === 0) {
        return { threshold: 0, netBenefit: 0, tpKept: 0, slEliminated: 0 };
    }

    // Get all unique threshold values that would be tested
    const thresholdValues = signalsWithThreshold
        .map((s) => s.thresholdChecks[thresholdName].calculated)
        .filter((v) => typeof v === "number" && !isNaN(v))
        .sort((a, b) => a - b);

    // Remove duplicates and get unique values
    const uniqueThresholds = [...new Set(thresholdValues)];

    let bestThreshold = uniqueThresholds[0];
    let bestNetBenefit = -Infinity;
    let bestTpKept = 0;
    let bestSlEliminated = 0;

    // Test each potential threshold
    for (const testThreshold of uniqueThresholds) {
        const tpSignals = signalsWithThreshold.filter((s) => {
            const check = s.thresholdChecks[thresholdName];
            const operator = check.op;
            const calculated = check.calculated;

            if (operator === "EQL") {
                return calculated >= testThreshold;
            } else if (operator === "EQS") {
                return calculated <= testThreshold;
            }
            return false;
        });

        const tpKept = tpSignals.filter((s) => s.tpSlStatus === "TP").length;
        const slEliminated = tpSignals.filter(
            (s) => s.tpSlStatus === "SL"
        ).length;

        // Net benefit: TP signals kept minus SL signals that would still pass
        const netBenefit =
            tpKept -
            (signalsWithThreshold.filter((s) => s.tpSlStatus === "SL").length -
                slEliminated);

        if (netBenefit > bestNetBenefit) {
            bestNetBenefit = netBenefit;
            bestThreshold = testThreshold;
            bestTpKept = tpKept;
            bestSlEliminated = slEliminated;
        }
    }

    return {
        threshold: bestThreshold,
        netBenefit: bestNetBenefit,
        tpKept: bestTpKept,
        slEliminated: bestSlEliminated,
    };
}

async function main() {
    const date = process.argv[2] || new Date().toISOString().split("T")[0];

    console.log(`🎯 Finding optimal thresholds for ${date}`);
    console.log("==========================================");

    // Load all signals
    const allSignals = await loadAllSignals(date);
    console.log(`📊 Loaded ${allSignals.length} total signals`);

    const rejectedMissed = allSignals.filter(
        (s) => s.source === "rejected_missed"
    );
    const validation = allSignals.filter((s) => s.source === "validation");

    console.log(`   Rejected missed (would be TP): ${rejectedMissed.length}`);
    console.log(`   Validation signals: ${validation.length}`);

    const slSignals = validation.filter((s) => s.tpSlStatus === "SL");
    console.log(`   SL signals to eliminate: ${slSignals.length}`);

    // Analyze each detector
    const detectors = ["absorption", "exhaustion", "deltacvd"];

    for (const detector of detectors) {
        console.log(`\n🎯 ${detector.toUpperCase()} DETECTOR OPTIMIZATION`);

        const detectorSignals = allSignals.filter(
            (s) => s.detectorType === detector
        );
        const detectorRejected = rejectedMissed.filter(
            (s) => s.detectorType === detector
        );
        const detectorValidation = validation.filter(
            (s) => s.detectorType === detector
        );
        const detectorSL = slSignals.filter((s) => s.detectorType === detector);

        console.log(`   Signals: ${detectorSignals.length} total`);
        console.log(`   Rejected profitable: ${detectorRejected.length}`);
        console.log(`   Validation: ${detectorValidation.length}`);
        console.log(`   SL to eliminate: ${detectorSL.length}`);

        if (detectorSignals.length === 0) continue;

        // Get threshold names from first signal
        const firstSignal = detectorSignals.find((s) => s.thresholdChecks);
        if (!firstSignal) continue;

        const thresholdNames = Object.keys(firstSignal.thresholdChecks);

        console.log(`\n   📈 Optimal Thresholds:`);

        for (const thresholdName of thresholdNames.slice(0, 5)) {
            // Analyze first 5 thresholds
            const optimal = findOptimalThreshold(
                detectorSignals,
                thresholdName,
                detector
            );

            console.log(`      ${thresholdName}:`);
            console.log(
                `         Optimal value: ${optimal.threshold.toFixed(6)}`
            );
            console.log(`         Net benefit: ${optimal.netBenefit}`);
            console.log(`         TP kept: ${optimal.tpKept}`);
            console.log(`         SL eliminated: ${optimal.slEliminated}`);
        }
    }

    console.log("\n✅ Optimization complete");
}

main().catch(console.error);
