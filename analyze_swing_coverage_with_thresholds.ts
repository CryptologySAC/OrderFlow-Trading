#!/usr/bin/env node
import * as fs from "fs/promises";

interface Signal {
    timestamp: number;
    signalSide: "buy" | "sell";
    price: number;

    // Threshold parameters
    minAggVolume: number;
    priceEfficiencyThreshold: number;
    maxAbsorptionRatio: number;
    minPassiveMultiplier: number;
    passiveAbsorptionThreshold: number;
    finalConfidenceRequired: number;
}

interface SwingCluster {
    startTime: number;
    endTime: number;
    side: "buy" | "sell";
    signals: Signal[];
    minPrice: number;
    maxPrice: number;
    timeRange: string;
}

// Test thresholds
const THRESHOLDS = {
    minAggVolume: 3500,
    priceEfficiencyThreshold: 0.0035,
    maxAbsorptionRatio: 0.85,
    minPassiveMultiplier: 8.0,
    passiveAbsorptionThreshold: 8.0,
    finalConfidenceRequired: 0.75,
};

async function readAbsorptionSignals(filePath: string): Promise<Signal[]> {
    try {
        const content = await fs.readFile(filePath, "utf-8");
        const lines = content.trim().split("\n");
        if (lines.length < 2) return [];

        const headers = lines[0].split(",");
        const signals: Signal[] = [];

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(",");
            if (values.length < headers.length) continue;

            const signal: any = {};
            headers.forEach((header, idx) => {
                const value = values[idx];
                if (header === "signalSide" || header === "TP_SL") {
                    signal[header] = value;
                } else if (header === "wasValidSignal") {
                    signal[header] = value === "true";
                } else if (value && !isNaN(parseFloat(value))) {
                    signal[header] = parseFloat(value);
                }
            });

            if (signal.timestamp && signal.price) {
                signals.push(signal as Signal);
            }
        }

        return signals;
    } catch (error) {
        console.log(`Could not read file ${filePath}: ${error}`);
        return [];
    }
}

function wouldSignalPass(
    signal: Signal,
    thresholds: typeof THRESHOLDS
): boolean {
    return (
        signal.minAggVolume >= thresholds.minAggVolume &&
        signal.priceEfficiencyThreshold <=
            thresholds.priceEfficiencyThreshold &&
        signal.maxAbsorptionRatio >= thresholds.maxAbsorptionRatio &&
        signal.minPassiveMultiplier >= thresholds.minPassiveMultiplier &&
        signal.passiveAbsorptionThreshold >=
            thresholds.passiveAbsorptionThreshold &&
        signal.finalConfidenceRequired >= thresholds.finalConfidenceRequired
    );
}

function clusterSignalsIntoSwings(
    signals: Signal[],
    maxGapMinutes: number = 10
): SwingCluster[] {
    if (signals.length === 0) return [];

    const sorted = [...signals].sort((a, b) => a.timestamp - b.timestamp);
    const clusters: SwingCluster[] = [];
    let currentCluster: SwingCluster | null = null;

    for (const signal of sorted) {
        const shouldStartNewCluster =
            !currentCluster ||
            signal.signalSide !== currentCluster.side ||
            signal.timestamp - currentCluster.endTime >
                maxGapMinutes * 60 * 1000;

        if (shouldStartNewCluster) {
            if (currentCluster) {
                clusters.push(currentCluster);
            }

            currentCluster = {
                startTime: signal.timestamp,
                endTime: signal.timestamp,
                side: signal.signalSide,
                signals: [signal],
                minPrice: signal.price,
                maxPrice: signal.price,
                timeRange: "",
            };
        } else {
            currentCluster.signals.push(signal);
            currentCluster.endTime = signal.timestamp;
            currentCluster.minPrice = Math.min(
                currentCluster.minPrice,
                signal.price
            );
            currentCluster.maxPrice = Math.max(
                currentCluster.maxPrice,
                signal.price
            );
        }
    }

    if (currentCluster) {
        clusters.push(currentCluster);
    }

    // Add time range descriptions
    for (const cluster of clusters) {
        const start = new Date(cluster.startTime);
        const end = new Date(cluster.endTime);
        const duration = (cluster.endTime - cluster.startTime) / (60 * 1000);

        cluster.timeRange = `${start.toLocaleString("en-US", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: "America/Lima",
        })} - ${end.toLocaleString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: "America/Lima",
        })} Lima (${duration.toFixed(1)} min)`;
    }

    return clusters;
}

async function analyzeSwingCoverage(): Promise<void> {
    console.log("Loading successful absorption signals...");

    const successful = await readAbsorptionSignals(
        "logs/signal_validation/absorption_successful_2025-08-12.csv"
    );
    console.log(`Loaded ${successful.length} successful signals`);

    // Filter signals that would pass with restrictive thresholds
    const passingSignals = successful.filter((s) =>
        wouldSignalPass(s, THRESHOLDS)
    );
    console.log(
        `\nWith restrictive thresholds: ${passingSignals.length}/${successful.length} signals pass`
    );

    // Cluster all successful signals into swings
    const allSwings = clusterSignalsIntoSwings(successful, 10);
    console.log(
        `\nAll successful signals cover ${allSwings.length} swing movements`
    );

    // Cluster passing signals into swings
    const passingSwings = clusterSignalsIntoSwings(passingSignals, 10);
    console.log(
        `Passing signals cover ${passingSwings.length} swing movements`
    );

    // Analyze which swings are missed
    const missedSwings: SwingCluster[] = [];

    for (const swing of allSwings) {
        // Check if this swing is covered by any passing swing
        let isCovered = false;

        for (const passingSwing of passingSwings) {
            const timeDiff = Math.abs(swing.startTime - passingSwing.startTime);
            const isNearSwing = timeDiff < 15 * 60 * 1000; // Within 15 minutes
            const isSameSide = swing.side === passingSwing.side;
            const isPriceNear =
                Math.abs(swing.minPrice - passingSwing.minPrice) /
                    swing.minPrice <
                0.02; // Within 2%

            if (isNearSwing && isSameSide && isPriceNear) {
                isCovered = true;
                break;
            }
        }

        if (!isCovered) {
            missedSwings.push(swing);
        }
    }

    console.log(`\n=== SWING COVERAGE ANALYSIS ===`);
    console.log(
        `Total swings from all successful signals: ${allSwings.length}`
    );
    console.log(`Swings covered by passing signals: ${passingSwings.length}`);
    console.log(
        `Swings MISSED with restrictive thresholds: ${missedSwings.length}`
    );

    if (missedSwings.length > 0) {
        console.log("\nMISSED SWINGS:");
        for (const swing of missedSwings) {
            console.log(
                `  ${swing.side.toUpperCase()} | ${swing.signals.length} signals | $${swing.minPrice.toFixed(2)}-$${swing.maxPrice.toFixed(2)} | ${swing.timeRange}`
            );
        }
    }

    console.log("\nCOVERED SWINGS:");
    for (const swing of passingSwings) {
        console.log(
            `  ${swing.side.toUpperCase()} | ${swing.signals.length} signals | $${swing.minPrice.toFixed(2)}-$${swing.maxPrice.toFixed(2)} | ${swing.timeRange}`
        );
    }

    // Test with less restrictive thresholds
    console.log("\n\n=== TESTING LESS RESTRICTIVE THRESHOLDS ===");

    const lessRestrictive = {
        minAggVolume: 1660, // Just below minimum successful
        priceEfficiencyThreshold: 0.0046, // Just above maximum successful
        maxAbsorptionRatio: 0.714, // Just below minimum successful
        minPassiveMultiplier: 2.5, // Just below minimum successful
        passiveAbsorptionThreshold: 2.5, // Same as minPassiveMultiplier
        finalConfidenceRequired: 0.62, // Just below minimum successful
    };

    const passingWithLessRestrictive = successful.filter((s) =>
        wouldSignalPass(s, lessRestrictive)
    );
    const swingsWithLessRestrictive = clusterSignalsIntoSwings(
        passingWithLessRestrictive,
        10
    );

    console.log(
        `With less restrictive thresholds: ${passingWithLessRestrictive.length}/${successful.length} signals pass`
    );
    console.log(
        `Swings covered: ${swingsWithLessRestrictive.length}/${allSwings.length}`
    );

    // Check which swings are still missed
    const stillMissed: SwingCluster[] = [];
    for (const swing of allSwings) {
        let isCovered = false;
        for (const passingSwing of swingsWithLessRestrictive) {
            const timeDiff = Math.abs(swing.startTime - passingSwing.startTime);
            if (timeDiff < 15 * 60 * 1000 && swing.side === passingSwing.side) {
                isCovered = true;
                break;
            }
        }
        if (!isCovered) {
            stillMissed.push(swing);
        }
    }

    if (stillMissed.length > 0) {
        console.log(
            `\nStill missing ${stillMissed.length} swings with less restrictive thresholds`
        );
    } else {
        console.log(
            "\n✅ All swings covered with less restrictive thresholds!"
        );
    }
}

// Run the analysis
analyzeSwingCoverage().catch(console.error);
