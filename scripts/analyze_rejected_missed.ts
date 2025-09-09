#!/usr/bin/env node
/**
 * Analyze rejected_missed logs to find optimal thresholds
 * Uses actual price movements from rejected signals to determine what would have worked
 */

import * as fs from "fs/promises";
import * as path from "path";

interface RejectedMissedRecord {
    timestamp: number;
    detectorType: "absorption" | "exhaustion";
    signalSide: "buy" | "sell";
    rejectionReason: string;
    price: number;
    thresholdType: string;
    thresholdValue: number;
    actualValue: number;
    actualTPPrice: number;
    actualSLPrice: number;
    maxFavorableMove: number;
    timeToTP: number;
    wasValidSignal: boolean;
    tpSlStatus: "TP" | "SL" | "NEITHER";
    thresholdChecks: any;
}

async function loadRejectedMissedData(
    date: string
): Promise<RejectedMissedRecord[]> {
    const records: RejectedMissedRecord[] = [];

    for (const detector of ["absorption", "exhaustion"]) {
        const filePath = `logs/signal_validation/${detector}_rejected_missed_${date}.jsonl`;

        try {
            const content = await fs.readFile(filePath, "utf-8");
            const lines = content.trim().split("\n");

            for (const line of lines) {
                if (!line.trim()) continue;

                try {
                    const record = JSON.parse(line) as RejectedMissedRecord;
                    records.push(record);
                } catch (parseError) {
                    console.warn(`Failed to parse line in ${filePath}`);
                }
            }
        } catch (error) {
            console.log(
                `No ${detector} rejected_missed file found for ${date}`
            );
        }
    }

    return records;
}

async function main() {
    const date = process.argv[2] || new Date().toISOString().split("T")[0];

    console.log(`🔍 Analyzing rejected_missed signals for ${date}`);
    console.log("==========================================");

    // Load rejected missed data
    const records = await loadRejectedMissedData(date);
    console.log(`📊 Loaded ${records.length} rejected signals`);

    if (records.length === 0) {
        console.log("❌ No rejected_missed data found");
        return;
    }

    // Group by detector
    const byDetector = records.reduce(
        (acc, record) => {
            if (!acc[record.detectorType]) {
                acc[record.detectorType] = [];
            }
            acc[record.detectorType].push(record);
            return acc;
        },
        {} as Record<string, RejectedMissedRecord[]>
    );

    // Analyze each detector
    for (const [detector, detectorRecords] of Object.entries(byDetector)) {
        console.log(`\n🎯 ${detector.toUpperCase()} DETECTOR ANALYSIS`);
        console.log(`   Total rejected signals: ${detectorRecords.length}`);

        const tpSignals = detectorRecords.filter(
            (r) => r.tpSlStatus === "TP"
        ).length;
        const slSignals = detectorRecords.filter(
            (r) => r.tpSlStatus === "SL"
        ).length;

        console.log(`   Would have been TP: ${tpSignals}`);
        console.log(`   Would have been SL: ${slSignals}`);
        console.log(`   Net benefit: ${tpSignals - slSignals}`);

        // Analyze key thresholds
        const firstRecord = detectorRecords[0];
        if (firstRecord && firstRecord.thresholdChecks) {
            const thresholdNames = Object.keys(firstRecord.thresholdChecks);

            for (const thresholdName of thresholdNames.slice(0, 3)) {
                // Analyze first 3 thresholds
                console.log(`\n   📈 ${thresholdName} Analysis:`);

                // Get current config value
                const configPath = path.join(process.cwd(), "config.json");
                const config = JSON.parse(
                    await fs.readFile(configPath, "utf-8")
                );
                const currentValue =
                    config.symbols?.LTCUSDT?.[
                        detector as keyof typeof config.symbols.LTCUSDT
                    ]?.[thresholdName];

                if (currentValue !== undefined) {
                    console.log(`      Current config: ${currentValue}`);

                    // Find records that would pass current threshold
                    const wouldPassCurrent = detectorRecords.filter((r) => {
                        const thresholdCheck =
                            r.thresholdChecks?.[thresholdName];
                        if (!thresholdCheck) return false;

                        const operator = thresholdCheck.op;
                        const calculated = thresholdCheck.calculated;

                        if (operator === "EQL") {
                            return calculated >= currentValue;
                        } else if (operator === "EQS") {
                            return calculated <= currentValue;
                        }
                        return false;
                    });

                    const tpIfCurrent = wouldPassCurrent.filter(
                        (r) => r.tpSlStatus === "TP"
                    ).length;
                    const slIfCurrent = wouldPassCurrent.filter(
                        (r) => r.tpSlStatus === "SL"
                    ).length;

                    console.log(
                        `      Would pass current threshold: ${wouldPassCurrent.length}`
                    );
                    console.log(`      TP if kept: ${tpIfCurrent}`);
                    console.log(`      SL if kept: ${slIfCurrent}`);
                    console.log(
                        `      Net benefit: ${tpIfCurrent - slIfCurrent}`
                    );
                }
            }
        }
    }

    console.log("\n✅ Analysis complete");
}

main().catch(console.error);
