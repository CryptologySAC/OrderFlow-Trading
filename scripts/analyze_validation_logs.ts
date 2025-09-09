#!/usr/bin/env node
/**
 * Analyze validation logs to find SL signals and combine with rejected_missed data
 */

import * as fs from "fs/promises";

interface ValidationRecord {
    timestamp: number;
    detectorType: string;
    signalSide: "buy" | "sell";
    price: number;
    tpSlStatus: "TP" | "SL" | "NEITHER";
    thresholdChecks: any;
}

async function loadValidationData(date: string): Promise<ValidationRecord[]> {
    const records: ValidationRecord[] = [];

    for (const detector of ["absorption", "exhaustion", "deltacvd"]) {
        const filePath = `logs/signal_validation/${detector}_validation_${date}.jsonl`;

        try {
            const content = await fs.readFile(filePath, "utf-8");
            const lines = content.trim().split("\n");

            for (const line of lines) {
                if (!line.trim()) continue;

                try {
                    const record = JSON.parse(line) as ValidationRecord;
                    records.push(record);
                } catch (parseError) {
                    console.warn(`Failed to parse line in ${filePath}`);
                }
            }
        } catch (error) {
            console.log(`No ${detector} validation file found for ${date}`);
        }
    }

    return records;
}

async function main() {
    const date = process.argv[2] || new Date().toISOString().split("T")[0];

    console.log(`🔍 Analyzing validation logs for ${date}`);
    console.log("==========================================");

    // Load validation data
    const records = await loadValidationData(date);
    console.log(`📊 Loaded ${records.length} validation signals`);

    if (records.length === 0) {
        console.log("❌ No validation data found");
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
        {} as Record<string, ValidationRecord[]>
    );

    // Analyze each detector
    for (const [detector, detectorRecords] of Object.entries(byDetector)) {
        console.log(`\n🎯 ${detector.toUpperCase()} DETECTOR ANALYSIS`);
        console.log(`   Total validation signals: ${detectorRecords.length}`);

        const tpSignals = detectorRecords.filter(
            (r) => r.tpSlStatus === "TP"
        ).length;
        const slSignals = detectorRecords.filter(
            (r) => r.tpSlStatus === "SL"
        ).length;
        const neitherSignals = detectorRecords.filter(
            (r) => r.tpSlStatus === "NEITHER"
        ).length;

        console.log(`   TP signals: ${tpSignals}`);
        console.log(`   SL signals: ${slSignals}`);
        console.log(`   Neither: ${neitherSignals}`);
        console.log(
            `   SL rate: ${((slSignals / detectorRecords.length) * 100).toFixed(1)}%`
        );

        // Show some SL signal details
        if (slSignals > 0) {
            console.log(`\n   📈 SL Signal Examples:`);
            const slExamples = detectorRecords
                .filter((r) => r.tpSlStatus === "SL")
                .slice(0, 3);

            for (const example of slExamples) {
                console.log(
                    `      ${new Date(example.timestamp).toISOString()} ${example.signalSide} @ ${example.price}`
                );

                if (example.thresholdChecks) {
                    const thresholdNames = Object.keys(
                        example.thresholdChecks
                    ).slice(0, 3);
                    for (const thresholdName of thresholdNames) {
                        const check = example.thresholdChecks[thresholdName];
                        if (check) {
                            console.log(
                                `         ${thresholdName}: ${check.calculated} (${check.op} ${check.threshold})`
                            );
                        }
                    }
                }
            }
        }
    }

    console.log("\n✅ Analysis complete");
}

main().catch(console.error);
