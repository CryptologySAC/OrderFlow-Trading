#!/usr/bin/env node
/**
 * Analyzes signals to find optimal threshold combinations that:
 * 1. Keep at least one signal per cluster/swing
 * 2. Filter out harmful false positives
 * 3. Allow harmless redundant signals
 *
 * Signal Categories:
 * - SUCCESSFUL: Reaches 0.7% TP
 * - HARMLESS: Same-side redundant signals or break-even signals
 * - HARMFUL: Hit SL and cause losses
 */

import * as fs from "fs/promises";
import { FinancialMath } from "./src/utils/financialMath";

// Configuration
const TARGET_TP = 0.007; // 0.7% profit target
const STOP_LOSS = 0.005; // 0.5% stop loss
const BREAK_EVEN_THRESHOLD = 0.001; // 0.1% for break-even
const SWING_TIME_WINDOW = 30 * 60 * 1000; // 30 minutes for swing grouping

interface Signal {
    timestamp: number;
    detectorType: string;
    signalSide: "buy" | "sell";
    price: number;

    // Detector-specific thresholds from CSV
    thresholds: Map<string, number>;

    // Outcome
    maxFavorableMove?: number;
    maxAdverseMove?: number;
    outcome?: "TP" | "SL" | "BE" | "NONE";

    // Categorization
    category?: "SUCCESSFUL" | "HARMLESS" | "HARMFUL";

    // Swing/cluster assignment
    swingId?: number;
    isFirstInSwing?: boolean;
}

interface Swing {
    id: number;
    startTime: number;
    endTime: number;
    direction: "UP" | "DOWN";
    signals: Signal[];
    hasActivePosition?: boolean;
}

interface ThresholdCombination {
    detector: string;
    thresholds: Map<string, number>;

    // Metrics
    totalSignals: number;
    successfulSignals: number;
    harmlessSignals: number;
    harmfulSignals: number;

    // Swing coverage
    swingsCovered: number;
    swingsTotal: number;

    // Quality score
    score: number;
}

async function loadSignals(date: string): Promise<Signal[]> {
    const signals: Signal[] = [];

    // Load from successful, validation, and rejected_missed logs
    const detectors = [
        "absorption",
        "exhaustion",
        "deltacvd",
        "accumulation",
        "distribution",
    ];
    const logTypes = ["successful", "validation", "rejected_missed"];

    for (const detector of detectors) {
        for (const logType of logTypes) {
            const filePath = `logs/signal_validation/${detector}_${logType}_${date}.csv`;
            try {
                const content = await fs.readFile(filePath, "utf-8");
                const lines = content.trim().split("\n");
                if (lines.length < 2) continue;

                const headers = lines[0].split(",");

                for (let i = 1; i < lines.length; i++) {
                    const values = lines[i].split(",");
                    if (values.length < 4) continue;

                    const signal: Signal = {
                        timestamp: parseInt(
                            values[headers.indexOf("timestamp")]
                        ),
                        detectorType: detector,
                        signalSide: values[headers.indexOf("signalSide")] as
                            | "buy"
                            | "sell",
                        price: parseFloat(values[headers.indexOf("price")]),
                        thresholds: new Map(),
                        outcome: logType === "successful" ? "TP" : undefined,
                    };

                    // Extract all threshold values from CSV
                    extractThresholds(headers, values, signal.thresholds);

                    signals.push(signal);
                }
            } catch (error) {
                // File might not exist
                continue;
            }
        }
    }

    return signals.sort((a, b) => a.timestamp - b.timestamp);
}

function extractThresholds(
    headers: string[],
    values: string[],
    thresholds: Map<string, number>
): void {
    // Common threshold column names
    const thresholdColumns = [
        "minAggVolume",
        "priceEfficiencyThreshold",
        "maxAbsorptionRatio",
        "minPassiveMultiplier",
        "passiveAbsorptionThreshold",
        "finalConfidenceRequired",
        "minTradesPerSec",
        "minVolPerSec",
        "signalThreshold",
        "cvdImbalanceThreshold",
        "institutionalThreshold",
    ];

    for (const col of thresholdColumns) {
        const idx = headers.indexOf(col);
        if (idx >= 0 && values[idx]) {
            const value = parseFloat(values[idx]);
            if (!isNaN(value)) {
                thresholds.set(col, value);
            }
        }
    }
}

async function loadPriceData(date: string): Promise<Map<number, number>> {
    const priceMap = new Map<number, number>();

    // Load from rejected_missed logs which contain all price points
    const detectors = ["absorption", "exhaustion"];

    for (const detector of detectors) {
        const filePath = `logs/signal_validation/${detector}_rejected_missed_${date}.csv`;
        try {
            const content = await fs.readFile(filePath, "utf-8");
            const lines = content.trim().split("\n");
            if (lines.length < 2) continue;

            const headers = lines[0].split(",");
            const timestampIdx = headers.indexOf("timestamp");
            const priceIdx = headers.indexOf("price");

            for (let i = 1; i < lines.length; i++) {
                const values = lines[i].split(",");
                const timestamp = parseInt(values[timestampIdx]);
                const price = parseFloat(values[priceIdx]);

                if (!isNaN(timestamp) && !isNaN(price)) {
                    priceMap.set(timestamp, price);
                }
            }
        } catch (error) {
            continue;
        }
    }

    return priceMap;
}

function calculateSignalOutcomes(
    signals: Signal[],
    priceData: Map<number, number>
): void {
    for (const signal of signals) {
        // Get price data for 90 minutes after signal
        const endTime = signal.timestamp + 90 * 60 * 1000;
        let maxPrice = signal.price;
        let minPrice = signal.price;

        for (const [timestamp, price] of priceData) {
            if (timestamp < signal.timestamp) continue;
            if (timestamp > endTime) break;

            maxPrice = Math.max(maxPrice, price);
            minPrice = Math.min(minPrice, price);
        }

        // Calculate moves
        if (signal.signalSide === "buy") {
            signal.maxFavorableMove = (maxPrice - signal.price) / signal.price;
            signal.maxAdverseMove = (signal.price - minPrice) / signal.price;
        } else {
            signal.maxFavorableMove = (signal.price - minPrice) / signal.price;
            signal.maxAdverseMove = (maxPrice - signal.price) / signal.price;
        }

        // Determine outcome
        if (signal.maxFavorableMove >= TARGET_TP) {
            signal.outcome = "TP";
        } else if (signal.maxAdverseMove >= STOP_LOSS) {
            signal.outcome = "SL";
        } else if (signal.maxFavorableMove >= BREAK_EVEN_THRESHOLD) {
            signal.outcome = "BE";
        } else {
            signal.outcome = "NONE";
        }
    }
}

function identifySwings(signals: Signal[]): Swing[] {
    const swings: Swing[] = [];
    let currentSwing: Swing | null = null;
    let swingId = 1;

    for (const signal of signals) {
        // Check if we need to start a new swing
        if (
            !currentSwing ||
            signal.timestamp - currentSwing.endTime > SWING_TIME_WINDOW ||
            (currentSwing.direction === "UP" && signal.signalSide === "sell") ||
            (currentSwing.direction === "DOWN" && signal.signalSide === "buy")
        ) {
            // Create new swing
            currentSwing = {
                id: swingId++,
                startTime: signal.timestamp,
                endTime: signal.timestamp,
                direction: signal.signalSide === "buy" ? "UP" : "DOWN",
                signals: [],
            };
            swings.push(currentSwing);
        }

        // Add signal to current swing
        signal.swingId = currentSwing.id;
        signal.isFirstInSwing = currentSwing.signals.length === 0;
        currentSwing.signals.push(signal);
        currentSwing.endTime = signal.timestamp;
    }

    return swings;
}

function categorizeSignals(swings: Swing[]): void {
    for (const swing of swings) {
        let hasActivePosition = false;

        for (const signal of swing.signals) {
            if (signal.outcome === "TP") {
                // Successful signal
                signal.category = "SUCCESSFUL";
                if (!hasActivePosition) {
                    hasActivePosition = true;
                }
            } else if (signal.outcome === "SL") {
                // Harmful - would cause loss
                signal.category = "HARMFUL";
                if (!hasActivePosition) {
                    hasActivePosition = true;
                }
            } else if (
                hasActivePosition &&
                ((swing.direction === "UP" && signal.signalSide === "buy") ||
                    (swing.direction === "DOWN" &&
                        signal.signalSide === "sell"))
            ) {
                // Same-side signal with active position - harmless redundant
                signal.category = "HARMLESS";
            } else if (signal.outcome === "BE" || signal.isFirstInSwing) {
                // Break-even or first in swing - harmless
                signal.category = "HARMLESS";
            } else {
                // Would cause loss
                signal.category = "HARMFUL";
            }
        }

        swing.hasActivePosition = hasActivePosition;
    }
}

function evaluateThresholds(
    detector: string,
    signals: Signal[],
    swings: Swing[],
    thresholdName: string,
    thresholdValue: number
): ThresholdCombination {
    // Filter signals that would pass this threshold
    const filteredSignals = signals.filter((s) => {
        if (s.detectorType !== detector) return false;
        const signalThreshold = s.thresholds.get(thresholdName);
        return (
            signalThreshold !== undefined && signalThreshold >= thresholdValue
        );
    });

    // Count categories
    const successful = filteredSignals.filter(
        (s) => s.category === "SUCCESSFUL"
    ).length;
    const harmless = filteredSignals.filter(
        (s) => s.category === "HARMLESS"
    ).length;
    const harmful = filteredSignals.filter(
        (s) => s.category === "HARMFUL"
    ).length;

    // Count swing coverage
    const swingsCovered = new Set(filteredSignals.map((s) => s.swingId)).size;
    const relevantSwings = swings.filter((sw) =>
        sw.signals.some((s) => s.detectorType === detector)
    ).length;

    // Calculate quality score
    // Prioritize: successful signals, swing coverage, minimize harmful
    const score =
        successful * 10 +
        harmless * 1 +
        harmful * -20 +
        (swingsCovered / Math.max(1, relevantSwings)) * 5;

    return {
        detector,
        thresholds: new Map([[thresholdName, thresholdValue]]),
        totalSignals: filteredSignals.length,
        successfulSignals: successful,
        harmlessSignals: harmless,
        harmfulSignals: harmful,
        swingsCovered,
        swingsTotal: relevantSwings,
        score,
    };
}

async function findOptimalThresholds(date: string): Promise<void> {
    console.log(`Analyzing signals for ${date}...`);

    // Load data
    const signals = await loadSignals(date);
    const priceData = await loadPriceData(date);

    console.log(
        `Loaded ${signals.length} signals and ${priceData.size} price points`
    );

    // Calculate outcomes
    calculateSignalOutcomes(signals, priceData);

    // Identify swings
    const swings = identifySwings(signals);
    console.log(`Identified ${swings.length} swings`);

    // Categorize signals
    categorizeSignals(swings);

    // Analyze by detector
    const detectors = ["absorption", "exhaustion", "deltacvd"];

    for (const detector of detectors) {
        const detectorSignals = signals.filter(
            (s) => s.detectorType === detector
        );
        if (detectorSignals.length === 0) continue;

        console.log(`\n${"=".repeat(80)}`);
        console.log(`${detector.toUpperCase()} DETECTOR ANALYSIS`);
        console.log(`${"=".repeat(80)}`);

        // Get all threshold names for this detector
        const thresholdNames = new Set<string>();
        for (const signal of detectorSignals) {
            for (const [name] of signal.thresholds) {
                thresholdNames.add(name);
            }
        }

        // Test different threshold values
        const results: ThresholdCombination[] = [];

        for (const thresholdName of thresholdNames) {
            // Get range of values
            const values = detectorSignals
                .map((s) => s.thresholds.get(thresholdName))
                .filter((v) => v !== undefined) as number[];

            if (values.length === 0) continue;

            const minVal = Math.min(...values);
            const maxVal = Math.max(...values);

            // Test different percentiles
            const testValues = [
                minVal,
                minVal + (maxVal - minVal) * 0.25,
                minVal + (maxVal - minVal) * 0.5,
                minVal + (maxVal - minVal) * 0.75,
                maxVal * 0.9,
            ];

            for (const testValue of testValues) {
                const result = evaluateThresholds(
                    detector,
                    detectorSignals,
                    swings,
                    thresholdName,
                    testValue
                );
                results.push(result);
            }
        }

        // Find best combinations
        results.sort((a, b) => b.score - a.score);

        console.log("\nTop Threshold Recommendations:");
        for (let i = 0; i < Math.min(5, results.length); i++) {
            const r = results[i];
            const [name, value] = Array.from(r.thresholds.entries())[0];

            console.log(`\n${i + 1}. ${name} = ${value.toFixed(4)}`);
            console.log(`   Score: ${r.score.toFixed(2)}`);
            console.log(`   Signals: ${r.totalSignals} total`);
            console.log(
                `   - Successful: ${r.successfulSignals} (${((r.successfulSignals / Math.max(1, r.totalSignals)) * 100).toFixed(1)}%)`
            );
            console.log(
                `   - Harmless: ${r.harmlessSignals} (${((r.harmlessSignals / Math.max(1, r.totalSignals)) * 100).toFixed(1)}%)`
            );
            console.log(
                `   - Harmful: ${r.harmfulSignals} (${((r.harmfulSignals / Math.max(1, r.totalSignals)) * 100).toFixed(1)}%)`
            );
            console.log(
                `   Swing Coverage: ${r.swingsCovered}/${r.swingsTotal} (${((r.swingsCovered / Math.max(1, r.swingsTotal)) * 100).toFixed(1)}%)`
            );
        }

        // Summary stats
        const allSuccessful = detectorSignals.filter(
            (s) => s.category === "SUCCESSFUL"
        ).length;
        const allHarmless = detectorSignals.filter(
            (s) => s.category === "HARMLESS"
        ).length;
        const allHarmful = detectorSignals.filter(
            (s) => s.category === "HARMFUL"
        ).length;

        console.log(`\n${detector.toUpperCase()} SUMMARY:`);
        console.log(`Total signals: ${detectorSignals.length}`);
        console.log(
            `- Successful: ${allSuccessful} (${((allSuccessful / detectorSignals.length) * 100).toFixed(1)}%)`
        );
        console.log(
            `- Harmless: ${allHarmless} (${((allHarmless / detectorSignals.length) * 100).toFixed(1)}%)`
        );
        console.log(
            `- Harmful: ${allHarmful} (${((allHarmful / detectorSignals.length) * 100).toFixed(1)}%)`
        );
    }
}

// Main execution
const date = process.argv[2] || new Date().toISOString().split("T")[0];
findOptimalThresholds(date).catch(console.error);
