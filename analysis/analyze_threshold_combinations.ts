#!/usr/bin/env node
/**
 * Advanced threshold optimization that tests COMBINATIONS of thresholds
 * to find optimal settings that maximize successful signals while
 * filtering harmful ones and maintaining swing coverage.
 * 
 * Updated to work with JSON Lines format (.jsonl) instead of CSV
 */

import * as fs from "fs/promises";
import { FinancialMath } from "../src/utils/financialMath";

// Configuration
const TARGET_TP = 0.007; // 0.7% profit target
const STOP_LOSS = 0.005; // 0.5% stop loss
const BREAK_EVEN_THRESHOLD = 0.002; // 0.2% for break-even
const SMALL_TP_THRESHOLD = 0.004; // 0.4% for small TP
const CLUSTER_TIME_WINDOW = 5 * 60 * 1000; // 5 minutes for cluster grouping
const PHASE_GAP_THRESHOLD = 15 * 60 * 1000; // 15 minutes between phases

interface Signal {
    timestamp: number;
    detectorType: string;
    signalSide: "buy" | "sell";
    price: number;

    // All threshold values extracted from JSON
    thresholds: Map<string, number>;

    // Price movements
    maxFavorableMove?: number;
    maxAdverseMove?: number;
    timeToMax?: number; // minutes

    // Outcomes
    outcome?: "TP" | "SMALL_TP" | "BE" | "SL" | "NONE";
    category?: "SUCCESSFUL" | "HARMLESS" | "HARMFUL";

    // Grouping
    clusterId?: number;
    phaseId?: number;
    isFirstInCluster?: boolean;
    isFirstInPhase?: boolean;
}

interface Cluster {
    id: number;
    signals: Signal[];
    avgPrice: number;
    priceRange: number;
    startTime: number;
    endTime: number;
    detector: string;
    side: "buy" | "sell";
}

interface Phase {
    id: number;
    clusters: Cluster[];
    direction: "UP" | "DOWN";
    startPrice: number;
    endPrice: number;
    startTime: number;
    endTime: number;
    hasSuccessfulSignal: boolean;
    hasActivePosition?: boolean;
}

interface ThresholdCombination {
    detector: string;
    thresholds: Map<string, number>;

    // Signal counts
    totalSignals: number;
    successfulSignals: number;
    smallTPSignals: number;
    harmlessSignals: number;
    harmfulSignals: number;

    // Coverage metrics
    clustersWithSignals: number;
    totalClusters: number;
    phasesWithSignals: number;
    totalPhases: number;

    // Quality metrics
    successRate: number;
    harmfulRate: number;
    coverageRate: number;
    qualityScore: number;
}

// Threshold field mappings for extracting from JSON records
const THRESHOLD_FIELD_MAP = {
    absorption: {
        minAggVolume: "thresholdChecks.minAggVolume.threshold",
        priceEfficiencyThreshold: "thresholdChecks.priceEfficiencyThreshold.threshold", 
        minPassiveMultiplier: "thresholdChecks.minPassiveMultiplier.threshold",
        passiveAbsorptionThreshold: "thresholdChecks.passiveAbsorptionThreshold.threshold",
        finalConfidenceRequired: "thresholdChecks.finalConfidenceRequired.threshold",
    },
    exhaustion: {
        minAggVolume: "thresholdChecks.minAggVolume.threshold",
        exhaustionThreshold: "thresholdChecks.exhaustionThreshold.threshold",
        passiveRatioBalanceThreshold: "thresholdChecks.passiveRatioBalanceThreshold.threshold",
    },
    deltacvd: {
        minTradesPerSec: "thresholdChecks.minTradesPerSec.threshold",
        minVolPerSec: "thresholdChecks.minVolPerSec.threshold", 
        signalThreshold: "thresholdChecks.signalThreshold.threshold",
        cvdImbalanceThreshold: "thresholdChecks.cvdImbalanceThreshold.threshold",
    }
};

// Helper function to extract nested values from JSON object
function getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => {
        return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
}

/**
 * Load signals from JSON Lines format files
 */
async function loadSignalsWithDetails(date: string): Promise<Signal[]> {
    const signals: Signal[] = [];
    const detectors = ["absorption", "exhaustion", "deltacvd"];
    const logTypes = ["successful", "validation", "rejected_missed"];

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
                        };

                        // Extract threshold values based on detector type
                        const thresholdFields = THRESHOLD_FIELD_MAP[detector as keyof typeof THRESHOLD_FIELD_MAP];
                        if (thresholdFields) {
                            for (const [thresholdName, jsonPath] of Object.entries(thresholdFields)) {
                                const value = getNestedValue(jsonRecord, jsonPath);
                                if (typeof value === 'number' && !isNaN(value)) {
                                    signal.thresholds.set(thresholdName, value);
                                }
                            }
                        }

                        // Mark known outcomes from successful logs
                        if (logType === "successful") {
                            signal.outcome = "TP";
                            signal.category = "SUCCESSFUL";
                        }

                        signals.push(signal);
                    } catch (parseError) {
                        console.warn(`Failed to parse line in ${filePath}: ${line.substring(0, 100)}...`);
                        continue;
                    }
                }
            } catch (error) {
                // File doesn't exist or can't be read - skip silently
                continue;
            }
        }
    }

    return signals.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Enrich signals with price movements from rejection logs
 */
async function enrichSignalsWithPriceMovements(
    signals: Signal[],
    date: string
): Promise<void> {
    // Load price data from JSON Lines rejection files
    const priceMap = new Map<number, number>();

    for (const detector of ["absorption", "exhaustion"]) {
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

                    if (timestamp && price && !isNaN(timestamp) && !isNaN(price)) {
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

    // Calculate movements for each signal
    for (const signal of signals) {
        if (signal.outcome === "TP") {
            // Already know it's successful
            signal.maxFavorableMove = TARGET_TP;
            continue;
        }

        const endTime = signal.timestamp + 90 * 60 * 1000;
        let bestPrice = signal.price;
        let worstPrice = signal.price;
        let bestTime = signal.timestamp;

        for (const [timestamp, price] of priceMap) {
            if (timestamp < signal.timestamp) continue;
            if (timestamp > endTime) break;

            if (signal.signalSide === "buy") {
                if (price > bestPrice) {
                    bestPrice = price;
                    bestTime = timestamp;
                }
                if (price < worstPrice) {
                    worstPrice = price;
                }
            } else {
                if (price < bestPrice) {
                    bestPrice = price;
                    bestTime = timestamp;
                }
                if (price > worstPrice) {
                    worstPrice = price;
                }
            }
        }

        // Calculate movements using FinancialMath
        signal.maxFavorableMove =
            Math.abs(
                FinancialMath.calculatePercentageChange(
                    signal.price,
                    bestPrice,
                    0
                )
            ) / 100;
        signal.maxAdverseMove =
            Math.abs(
                FinancialMath.calculatePercentageChange(
                    signal.price,
                    worstPrice,
                    0
                )
            ) / 100;
        signal.timeToMax = (bestTime - signal.timestamp) / (60 * 1000);

        // Categorize outcome
        if (signal.maxFavorableMove >= TARGET_TP) {
            signal.outcome = "TP";
            signal.category = "SUCCESSFUL";
        } else if (signal.maxAdverseMove >= STOP_LOSS) {
            signal.outcome = "SL";
            signal.category = "HARMFUL";
        } else if (signal.maxFavorableMove >= SMALL_TP_THRESHOLD) {
            signal.outcome = "SMALL_TP";
            signal.category = "HARMLESS";
        } else if (signal.maxFavorableMove >= BREAK_EVEN_THRESHOLD) {
            signal.outcome = "BE";
            signal.category = "HARMLESS";
        } else {
            signal.outcome = "NONE";
            signal.category = "HARMFUL";
        }
    }
}

function createClusters(signals: Signal[]): Cluster[] {
    const clusters: Cluster[] = [];
    let clusterId = 1;

    // Group by detector first
    const byDetector = new Map<string, Signal[]>();
    for (const signal of signals) {
        if (!byDetector.has(signal.detectorType)) {
            byDetector.set(signal.detectorType, []);
        }
        byDetector.get(signal.detectorType)!.push(signal);
    }

    // Create clusters for each detector
    for (const [detector, detectorSignals] of byDetector) {
        let currentCluster: Signal[] = [];

        for (const signal of detectorSignals) {
            if (currentCluster.length === 0) {
                currentCluster = [signal];
            } else {
                const lastSignal = currentCluster[currentCluster.length - 1];
                const timeDiff = signal.timestamp - lastSignal.timestamp;
                const priceDiff =
                    Math.abs(signal.price - lastSignal.price) /
                    lastSignal.price;

                if (
                    timeDiff <= CLUSTER_TIME_WINDOW &&
                    priceDiff <= 0.002 &&
                    signal.signalSide === lastSignal.signalSide
                ) {
                    currentCluster.push(signal);
                } else {
                    // Finalize current cluster
                    if (currentCluster.length > 0) {
                        clusters.push(
                            createClusterFromSignals(
                                currentCluster,
                                clusterId++
                            )
                        );
                    }
                    currentCluster = [signal];
                }
            }
        }

        // Add final cluster
        if (currentCluster.length > 0) {
            clusters.push(
                createClusterFromSignals(currentCluster, clusterId++)
            );
        }
    }

    return clusters.sort((a, b) => a.startTime - b.startTime);
}

function createClusterFromSignals(signals: Signal[], id: number): Cluster {
    const prices = signals.map((s) => s.price);

    for (let i = 0; i < signals.length; i++) {
        signals[i].clusterId = id;
        signals[i].isFirstInCluster = i === 0;
    }

    return {
        id,
        signals,
        avgPrice: prices.reduce((a, b) => a + b, 0) / prices.length,
        priceRange: Math.max(...prices) - Math.min(...prices),
        startTime: Math.min(...signals.map((s) => s.timestamp)),
        endTime: Math.max(...signals.map((s) => s.timestamp)),
        detector: signals[0].detectorType,
        side: signals[0].signalSide,
    };
}

function createPhases(clusters: Cluster[]): Phase[] {
    const phases: Phase[] = [];
    let phaseId = 1;
    let currentClusters: Cluster[] = [];

    for (const cluster of clusters) {
        if (currentClusters.length === 0) {
            currentClusters = [cluster];
        } else {
            const lastCluster = currentClusters[currentClusters.length - 1];
            const timeGap = cluster.startTime - lastCluster.endTime;

            if (
                timeGap > PHASE_GAP_THRESHOLD ||
                cluster.side !== lastCluster.side
            ) {
                // Create phase from current clusters
                phases.push(
                    createPhaseFromClusters(currentClusters, phaseId++)
                );
                currentClusters = [cluster];
            } else {
                currentClusters.push(cluster);
            }
        }
    }

    // Add final phase
    if (currentClusters.length > 0) {
        phases.push(createPhaseFromClusters(currentClusters, phaseId++));
    }

    return phases;
}

function createPhaseFromClusters(clusters: Cluster[], id: number): Phase {
    const allSignals = clusters.flatMap((c) => c.signals);
    const firstSignal = allSignals[0];

    for (const signal of allSignals) {
        signal.phaseId = id;
        signal.isFirstInPhase = signal === firstSignal;
    }

    const prices = allSignals.map((s) => s.price);
    const startPrice =
        firstSignal.signalSide === "sell"
            ? Math.max(...prices)
            : Math.min(...prices);
    const endPrice =
        firstSignal.signalSide === "sell"
            ? Math.min(...prices)
            : Math.max(...prices);

    return {
        id,
        clusters,
        direction: firstSignal.signalSide === "buy" ? "UP" : "DOWN",
        startPrice,
        endPrice,
        startTime: Math.min(...clusters.map((c) => c.startTime)),
        endTime: Math.max(...clusters.map((c) => c.endTime)),
        hasSuccessfulSignal: allSignals.some(
            (s) => s.category === "SUCCESSFUL"
        ),
    };
}

function refineSignalCategories(phases: Phase[]): void {
    for (const phase of phases) {
        let hasActivePosition = false;

        for (const cluster of phase.clusters) {
            for (const signal of cluster.signals) {
                // First successful signal opens position
                if (signal.category === "SUCCESSFUL" && !hasActivePosition) {
                    hasActivePosition = true;
                    continue;
                }

                // Same-side signals with active position are harmless
                if (
                    hasActivePosition &&
                    ((phase.direction === "UP" &&
                        signal.signalSide === "buy") ||
                        (phase.direction === "DOWN" &&
                            signal.signalSide === "sell"))
                ) {
                    if (signal.category === "HARMFUL") {
                        signal.category = "HARMLESS"; // Redundant signal
                    }
                }
            }
        }

        phase.hasActivePosition = hasActivePosition;
    }
}

function evaluateCombination(
    detector: string,
    thresholds: Map<string, number>,
    signals: Signal[],
    clusters: Cluster[],
    phases: Phase[]
): ThresholdCombination {
    // Filter signals that pass ALL thresholds
    const filteredSignals = signals.filter((signal) => {
        if (signal.detectorType !== detector) return false;

        for (const [name, requiredValue] of thresholds) {
            const signalValue = signal.thresholds.get(name);
            if (signalValue === undefined) return false;

            // Different comparison based on threshold type
            if (name.includes("min") || name.includes("Min")) {
                if (signalValue < requiredValue) return false;
            } else if (name.includes("max") || name.includes("Max")) {
                if (signalValue > requiredValue) return false;
            } else {
                // For ratios/thresholds, signal should meet or exceed
                if (signalValue < requiredValue) return false;
            }
        }

        return true;
    });

    // Count categories
    const successful = filteredSignals.filter(
        (s) => s.category === "SUCCESSFUL"
    ).length;
    const smallTP = filteredSignals.filter(
        (s) => s.outcome === "SMALL_TP"
    ).length;
    const harmless = filteredSignals.filter(
        (s) => s.category === "HARMLESS"
    ).length;
    const harmful = filteredSignals.filter(
        (s) => s.category === "HARMFUL"
    ).length;

    // Coverage metrics
    const clustersWithSignals = new Set(
        filteredSignals.map((s) => s.clusterId).filter((id) => id !== undefined)
    ).size;
    const relevantClusters = clusters.filter(
        (c) => c.detector === detector
    ).length;

    const phasesWithSignals = new Set(
        filteredSignals.map((s) => s.phaseId).filter((id) => id !== undefined)
    ).size;
    const relevantPhases = phases.filter((p) =>
        p.clusters.some((c) => c.detector === detector)
    ).length;

    // Calculate rates
    const total = filteredSignals.length;
    const successRate = total > 0 ? successful / total : 0;
    const harmfulRate = total > 0 ? harmful / total : 0;
    const coverageRate =
        relevantClusters > 0 ? clustersWithSignals / relevantClusters : 0;

    // Quality score prioritizes:
    // 1. High success rate
    // 2. Good coverage
    // 3. Low harmful rate
    // 4. Some signals (not too restrictive)
    const qualityScore =
        successRate * 100 +
        coverageRate * 50 +
        (1 - harmfulRate) * 30 +
        Math.min(total, 20) * 0.5; // Bonus for having some signals

    return {
        detector,
        thresholds,
        totalSignals: total,
        successfulSignals: successful,
        smallTPSignals: smallTP,
        harmlessSignals: harmless,
        harmfulSignals: harmful,
        clustersWithSignals,
        totalClusters: relevantClusters,
        phasesWithSignals,
        totalPhases: relevantPhases,
        successRate,
        harmfulRate,
        coverageRate,
        qualityScore,
    };
}

async function optimizeThresholds(date: string): Promise<void> {
    console.log(`🔍 Analyzing threshold combinations for ${date}...\n`);

    // Load and process signals from JSON Lines files
    const signals = await loadSignalsWithDetails(date);
    console.log(`📊 Loaded ${signals.length} signals`);

    await enrichSignalsWithPriceMovements(signals, date);

    // Create clusters and phases
    const clusters = createClusters(signals);
    const phases = createPhases(clusters);

    console.log(
        `📈 Created ${clusters.length} clusters and ${phases.length} phases`
    );

    // Refine categories based on position management
    refineSignalCategories(phases);

    // Save analysis report
    const reportPath = "analysis/reports/threshold_optimization_report.json";
    const reportData = {
        date,
        totalSignals: signals.length,
        totalClusters: clusters.length,
        totalPhases: phases.length,
        generatedAt: new Date().toISOString(),
        format: "JSON Lines (.jsonl)",
        optimizationResults: {} as Record<string, any>,
    };

    // Analyze each detector
    const detectors = ["absorption", "exhaustion", "deltacvd"];

    for (const detector of detectors) {
        const detectorSignals = signals.filter(
            (s) => s.detectorType === detector
        );
        if (detectorSignals.length === 0) continue;

        console.log(`\n${"=".repeat(80)}`);
        console.log(`🎯 ${detector.toUpperCase()} DETECTOR OPTIMIZATION`);
        console.log(`${"=".repeat(80)}`);

        // Get threshold ranges from actual signal data
        const thresholdFields = Object.keys(THRESHOLD_FIELD_MAP[detector as keyof typeof THRESHOLD_FIELD_MAP]);
        const thresholdRanges = new Map<string, number[]>();

        for (const threshold of thresholdFields) {
            const values = detectorSignals
                .map((s) => s.thresholds.get(threshold))
                .filter((v) => v !== undefined) as number[];

            if (values.length > 0) {
                const min = Math.min(...values);
                const max = Math.max(...values);
                const p25 = min + (max - min) * 0.25;
                const p50 = min + (max - min) * 0.5;
                const p75 = min + (max - min) * 0.75;

                thresholdRanges.set(threshold, [min, p25, p50, p75, max * 0.9]);
            }
        }

        // Test combinations
        const results: ThresholdCombination[] = [];

        // Generate threshold combinations
        const thresholdNames = Array.from(thresholdRanges.keys());
        const thresholdValues = thresholdNames.map(
            (name) => thresholdRanges.get(name) || []
        );

        // Helper function to generate all combinations
        function generateCombinations(
            arrays: number[][],
            index: number = 0,
            current: number[] = []
        ): number[][] {
            if (index === arrays.length) {
                return current.length > 0 ? [current.slice()] : [];
            }

            const results: number[][] = [];
            // Test with each value at percentiles: min, 25%, 50%, 75%, 90%
            const valuesToTest = arrays[index].slice(0, 5); // Already limited to 5 values

            for (const value of valuesToTest) {
                current.push(value);
                results.push(
                    ...generateCombinations(arrays, index + 1, current)
                );
                current.pop();
            }

            return results;
        }

        // Generate all combinations (limit to reasonable number)
        const allCombinations = generateCombinations(thresholdValues);
        console.log(
            `   Testing ${allCombinations.length} threshold combinations...`
        );

        // Test each combination
        for (const combination of allCombinations) {
            const thresholdMap = new Map<string, number>();
            for (let i = 0; i < thresholdNames.length; i++) {
                thresholdMap.set(thresholdNames[i], combination[i]);
            }

            const result = evaluateCombination(
                detector,
                thresholdMap,
                detectorSignals,
                clusters,
                phases
            );
            results.push(result);
        }

        // Also test individual thresholds for comparison
        for (const [name, values] of thresholdRanges) {
            for (const value of values) {
                const result = evaluateCombination(
                    detector,
                    new Map([[name, value]]),
                    detectorSignals,
                    clusters,
                    phases
                );
                results.push(result);
            }
        }

        // Sort by quality score
        results.sort((a, b) => b.qualityScore - a.qualityScore);

        // Display top recommendations
        console.log("\n🏆 TOP THRESHOLD COMBINATIONS:\n");

        // Find best full combinations (multiple thresholds)
        const fullCombinations = results.filter((r) => r.thresholds.size > 1);
        const singleThresholds = results.filter((r) => r.thresholds.size === 1);

        console.log("🎯 BEST MULTI-THRESHOLD COMBINATIONS:");
        for (let i = 0; i < Math.min(3, fullCombinations.length); i++) {
            const r = fullCombinations[i];

            console.log(
                `\n${i + 1}. Score: ${r.qualityScore.toFixed(1)} [${r.thresholds.size} thresholds]`
            );
            console.log("   Thresholds:");
            for (const [name, value] of r.thresholds) {
                console.log(`     ${name}: ${value.toFixed(4)}`);
            }
            console.log(`   Performance:`);
            console.log(`     Signals: ${r.totalSignals} total`);
            console.log(
                `     ✅ Successful: ${r.successfulSignals} (${(r.successRate * 100).toFixed(1)}%)`
            );
            console.log(`     🟡 Small TP: ${r.smallTPSignals}`);
            console.log(`     🟢 Harmless: ${r.harmlessSignals}`);
            console.log(
                `     🔴 Harmful: ${r.harmfulSignals} (${(r.harmfulRate * 100).toFixed(1)}%)`
            );
            console.log(
                `   Coverage: ${r.clustersWithSignals}/${r.totalClusters} clusters (${(r.coverageRate * 100).toFixed(1)}%)`
            );
            console.log(
                `             ${r.phasesWithSignals}/${r.totalPhases} phases`
            );
        }

        console.log("\n📊 BEST INDIVIDUAL THRESHOLDS (for reference):");
        for (let i = 0; i < Math.min(2, singleThresholds.length); i++) {
            const r = singleThresholds[i];
            const [name, value] = Array.from(r.thresholds.entries())[0];
            console.log(
                `   ${name}: ${value.toFixed(4)} (Score: ${r.qualityScore.toFixed(1)})`
            );
        }

        // Overall statistics
        const categories = {
            successful: detectorSignals.filter(
                (s) => s.category === "SUCCESSFUL"
            ).length,
            harmless: detectorSignals.filter((s) => s.category === "HARMLESS")
                .length,
            harmful: detectorSignals.filter((s) => s.category === "HARMFUL")
                .length,
        };

        console.log(`\n📊 ${detector.toUpperCase()} OVERALL STATISTICS:`);
        console.log(`   Total signals analyzed: ${detectorSignals.length}`);
        console.log(
            `   ✅ Successful (0.7%+ TP): ${categories.successful} (${((categories.successful / detectorSignals.length) * 100).toFixed(1)}%)`
        );
        console.log(
            `   🟢 Harmless (BE/Small TP/Redundant): ${categories.harmless} (${((categories.harmless / detectorSignals.length) * 100).toFixed(1)}%)`
        );
        console.log(
            `   🔴 Harmful (Would SL): ${categories.harmful} (${((categories.harmful / detectorSignals.length) * 100).toFixed(1)}%)`
        );

        // Save detector results to report
        reportData.optimizationResults[detector] = {
            totalSignals: detectorSignals.length,
            statistics: categories,
            topCombinations: fullCombinations.slice(0, 3).map(r => ({
                qualityScore: r.qualityScore,
                thresholds: Object.fromEntries(r.thresholds),
                performance: {
                    totalSignals: r.totalSignals,
                    successfulSignals: r.successfulSignals,
                    successRate: r.successRate,
                    harmfulRate: r.harmfulRate,
                    coverageRate: r.coverageRate,
                }
            })),
        };
    }

    // Save comprehensive report
    await fs.writeFile(reportPath, JSON.stringify(reportData, null, 2));
    console.log(`\n📄 Optimization report saved to: ${reportPath}`);

    console.log("\n" + "=".repeat(80));
    console.log("💡 OPTIMIZATION COMPLETE");
    console.log("=".repeat(80));
    console.log("📊 Updated to use JSON Lines format for improved data integrity");
    console.log("📁 Reports saved to analysis/reports/ directory");
}

// Main execution
const date = process.argv[2] || new Date().toISOString().split("T")[0];
optimizeThresholds(date).catch(console.error);