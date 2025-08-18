#!/usr/bin/env node
/**
 * Advanced threshold optimization that tests COMBINATIONS of thresholds
 * to find optimal settings that maximize successful signals while
 * filtering harmful ones and maintaining swing coverage.
 *
 * Updated to work with JSON Lines format (.jsonl) instead of CSV
 */

import * as fs from "fs/promises";
import { FinancialMath } from "../src/utils/financialMath.js";
import {
    BaseSignal,
    SignalCluster,
    TradingPhase,
    PricePhase,
    createSignalClusters,
    createTradingPhases,
    createCompletePricePhases,
    printPhaseSummary,
    PHASE_DETECTION_CONFIG,
} from "./shared/phaseDetection.js";

// Configuration
const TARGET_TP = 0.007; // 0.7% profit target
const STOP_LOSS = 0.005; // 0.5% stop loss
const BREAK_EVEN_THRESHOLD = 0.002; // 0.2% for break-even
const SMALL_TP_THRESHOLD = 0.004; // 0.4% for small TP

interface Signal extends BaseSignal {
    logType?: string; // validation, successful, or rejected_missed

    // All threshold values extracted from JSON
    thresholds: Map<string, number>;
    // Operators for each threshold (EQL = >=, EQS = <=, NONE = ignore)
    thresholdOps: Map<string, string>;

    // Price movements
    maxFavorableMove?: number;
    maxAdverseMove?: number;
    timeToMax?: number; // minutes

    // Outcomes
    outcome?: "TP" | "SMALL_TP" | "BE" | "SL" | "NONE";
    category?: "SUCCESSFUL" | "HARMLESS" | "HARMFUL";

    // Phase assignment for breakdown analysis
    phaseId?: number;
}

// Type aliases for this analysis
type ThresholdCluster = SignalCluster<Signal>;
type ThresholdPhase = TradingPhase<Signal> & {
    hasActivePosition?: boolean;
};

interface ThresholdCombination {
    detector: string;
    thresholds: Map<string, number>;
    allThresholds?: Map<string, number>; // All 8 threshold values (optimized + actual values from successful signals)

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

    // Phase distribution
    phaseDistribution?: Map<
        number,
        {
            signals: number;
            successful: number;
            harmful: number;
            clusters: number;
        }
    >;
}

// Threshold field mappings for extracting from JSON records
// Based on ACTUAL validation log fields - includes ALL thresholds that are not NONE
const THRESHOLD_FIELD_MAP = {
    absorption: {
        // All 8 threshold fields found in validation logs
        minAggVolume: "thresholdChecks.minAggVolume.calculated",
        passiveAbsorptionThreshold:
            "thresholdChecks.passiveAbsorptionThreshold.calculated",
        priceEfficiencyThreshold:
            "thresholdChecks.priceEfficiencyThreshold.calculated",
        maxPriceImpactRatio: "thresholdChecks.maxPriceImpactRatio.calculated",
        minPassiveMultiplier: "thresholdChecks.minPassiveMultiplier.calculated",
        minAbsorptionScore: "thresholdChecks.minAbsorptionScore.calculated",
        balanceThreshold: "thresholdChecks.balanceThreshold.calculated",
        priceStabilityTicks: "thresholdChecks.priceStabilityTicks.calculated",
    },
    exhaustion: {
        // Note: exhaustion validation logs appear to be empty for this date
        minAggVolume: "thresholdChecks.minAggVolume.calculated",
        exhaustionThreshold: "thresholdChecks.exhaustionThreshold.calculated",
        passiveRatioBalanceThreshold:
            "thresholdChecks.passiveRatioBalanceThreshold.calculated",
    },
    deltacvd: {
        // Note: delta not currently logging validation data
        minTradesPerSec: "thresholdChecks.minTradesPerSec.calculated",
        minVolPerSec: "thresholdChecks.minVolPerSec.calculated",
        signalThreshold: "thresholdChecks.signalThreshold.calculated",
        cvdImbalanceThreshold:
            "thresholdChecks.cvdImbalanceThreshold.calculated",
    },
};

// Helper function to extract nested values from JSON object
function getNestedValue(obj: any, path: string): any {
    return path.split(".").reduce((current, key) => {
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
                            thresholdOps: new Map(),
                            logType: logType,
                        };

                        // Extract threshold values AND operators based on detector type
                        const thresholdFields =
                            THRESHOLD_FIELD_MAP[
                                detector as keyof typeof THRESHOLD_FIELD_MAP
                            ];
                        if (thresholdFields && jsonRecord.thresholdChecks) {
                            for (const [
                                thresholdName,
                                jsonPath,
                            ] of Object.entries(thresholdFields)) {
                                const value = getNestedValue(
                                    jsonRecord,
                                    jsonPath
                                );
                                if (
                                    typeof value === "number" &&
                                    !isNaN(value)
                                ) {
                                    signal.thresholds.set(thresholdName, value);
                                }

                                // Extract operator (EQL, EQS, NONE)
                                const opPath = jsonPath.replace(
                                    ".calculated",
                                    ".op"
                                );
                                const op = getNestedValue(jsonRecord, opPath);
                                if (op) {
                                    signal.thresholdOps.set(thresholdName, op);
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
                        console.warn(
                            `Failed to parse line in ${filePath}: ${line.substring(0, 100)}...`
                        );
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

        // Calculate movements using simple percentage calculation
        signal.maxFavorableMove =
            Math.abs(((bestPrice - signal.price) / signal.price) * 100) / 100;
        signal.maxAdverseMove =
            Math.abs(((worstPrice - signal.price) / signal.price) * 100) / 100;
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

/**
 * Load price data from rejection logs (contains all price movements)
 */
async function loadPriceData(date: string): Promise<Map<number, number>> {
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

/**
 * Print complete phase summary with detection status
 */
function printCompletePhaseSummary(pricePhases: PricePhase<Signal>[]): void {
    console.log("\n📊 COMPLETE PHASE ANALYSIS:");

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
            `   Phase #${phase.id}: ${phase.direction} ${phase.direction === "UP" ? "↑" : "↓"} $${phase.startPrice.toFixed(2)} → $${phase.endPrice.toFixed(2)} (${(phase.sizePercent * 100).toFixed(2)}%) ${statusIcon} ${coverageText}`
        );

        // Show detector breakdown
        if (phase.detectedSignals.length > 0) {
            for (const [
                detectorType,
                coverage,
            ] of phase.detectorCoverage.entries()) {
                if (coverage.signals.length > 0) {
                    console.log(
                        `     📊 ${detectorType.toUpperCase()}: ${coverage.signals.length} signals (${(coverage.coverage * 100).toFixed(0)}% coverage)`
                    );
                }
            }
        } else {
            console.log(`     📊 NO SIGNALS DETECTED - Detection blind spot!`);
        }

        // Count detection status
        if (phase.detectionStatus === "DETECTED") detectedPhases++;
        else if (phase.detectionStatus === "PARTIALLY_DETECTED")
            partiallyDetectedPhases++;
        else undetectedPhases++;
    }

    console.log(`\n📈 DETECTION COVERAGE SUMMARY:`);
    console.log(`   Total Phases: ${pricePhases.length}`);
    console.log(
        `   ✅ Fully Detected: ${detectedPhases} (${((detectedPhases / pricePhases.length) * 100).toFixed(1)}%)`
    );
    console.log(
        `   ⚠️ Partially Detected: ${partiallyDetectedPhases} (${((partiallyDetectedPhases / pricePhases.length) * 100).toFixed(1)}%)`
    );
    console.log(
        `   ❌ Undetected: ${undetectedPhases} (${((undetectedPhases / pricePhases.length) * 100).toFixed(1)}%)`
    );
    console.log(
        `   🎯 Overall Detection Rate: ${(((detectedPhases + partiallyDetectedPhases) / pricePhases.length) * 100).toFixed(1)}%`
    );
}

function refineSignalCategories(pricePhases: PricePhase<Signal>[]): void {
    for (const phase of pricePhases) {
        let hasActivePosition = false;

        for (const signal of phase.detectedSignals) {
            // First successful signal opens position
            if (signal.category === "SUCCESSFUL" && !hasActivePosition) {
                hasActivePosition = true;
                continue;
            }

            // Same-side signals with active position are harmless
            if (
                hasActivePosition &&
                ((phase.direction === "UP" && signal.signalSide === "buy") ||
                    (phase.direction === "DOWN" &&
                        signal.signalSide === "sell"))
            ) {
                if (signal.category === "HARMFUL") {
                    signal.category = "HARMLESS"; // Redundant signal
                }
            }
        }
    }
}

function evaluateCombination(
    detector: string,
    thresholds: Map<string, number>,
    signals: Signal[],
    pricePhases: PricePhase<Signal>[],
    thresholdSourceSignals?: Signal[]
): ThresholdCombination {
    // Filter signals based on new threshold values and their operators
    const filteredSignals = signals.filter((signal) => {
        if (signal.detectorType !== detector) return false;

        for (const [name, requiredValue] of thresholds) {
            const signalValue = signal.thresholds.get(name);
            const operator = signal.thresholdOps.get(name);

            if (signalValue === undefined) return false;
            if (operator === "NONE") continue; // Skip NONE operators

            // Apply the correct operator logic
            // EQL means signal value must be >= threshold to PASS
            // EQS means signal value must be <= threshold to PASS
            // We're INVERTING this for filtering: we want to BLOCK signals

            if (operator === "EQL") {
                // Original: signal passes if value >= threshold
                // For filtering: block if value < new threshold
                if (signalValue < requiredValue) return false;
            } else if (operator === "EQS") {
                // Original: signal passes if value <= threshold
                // For filtering: block if value > new threshold
                if (signalValue > requiredValue) return false;
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

    // Coverage metrics based on price phases
    const phasesWithSignals = new Set();
    let totalDetectorClusters = 0;
    let clustersWithSignals = 0;

    for (const phase of pricePhases) {
        const detectorCoverage = phase.detectorCoverage.get(detector);
        if (detectorCoverage && detectorCoverage.signals.length > 0) {
            phasesWithSignals.add(phase.id);
            clustersWithSignals += detectorCoverage.clusters.length;
        }
        // Count total clusters for this detector across all phases
        if (detectorCoverage) {
            totalDetectorClusters += detectorCoverage.clusters.length;
        }
    }

    const relevantPhases = pricePhases.filter((p) =>
        p.detectorCoverage.has(detector)
    ).length;

    // Calculate phase distribution with cluster counts
    const phaseDistribution = new Map<
        number,
        {
            signals: number;
            successful: number;
            harmful: number;
            clusters: number;
        }
    >();
    const phaseClusters = new Map<number, Set<number>>();

    for (const signal of filteredSignals) {
        if (signal.phaseId !== undefined) {
            if (!phaseDistribution.has(signal.phaseId)) {
                phaseDistribution.set(signal.phaseId, {
                    signals: 0,
                    successful: 0,
                    harmful: 0,
                    clusters: 0,
                });
                phaseClusters.set(signal.phaseId, new Set());
            }
            const phaseDist = phaseDistribution.get(signal.phaseId)!;
            const clusterSet = phaseClusters.get(signal.phaseId)!;

            phaseDist.signals++;
            if (signal.category === "SUCCESSFUL") phaseDist.successful++;
            if (signal.category === "HARMFUL") phaseDist.harmful++;

            // Track unique clusters in this phase
            if (signal.clusterId !== undefined) {
                clusterSet.add(signal.clusterId);
            }
        }
    }

    // Update cluster counts
    for (const [phaseId, clusterSet] of phaseClusters) {
        const phaseDist = phaseDistribution.get(phaseId)!;
        phaseDist.clusters = clusterSet.size;
    }

    // Create complete threshold map showing ALL parameters (optimized + actual values from successful signals)
    let allThresholds: Map<string, number> | undefined;
    if (thresholdSourceSignals && thresholdSourceSignals.length > 0) {
        allThresholds = new Map();
        const allThresholdFields = Object.keys(
            THRESHOLD_FIELD_MAP[detector as keyof typeof THRESHOLD_FIELD_MAP]
        );

        for (const thresholdName of allThresholdFields) {
            if (thresholds.has(thresholdName)) {
                // Use optimized value
                allThresholds.set(
                    thresholdName,
                    thresholds.get(thresholdName)!
                );
            } else {
                // FIXED: Use proper boundary finding based on operators instead of calculated values
                const successfulSignals = thresholdSourceSignals.filter(
                    (s) => s.category === "SUCCESSFUL"
                );
                const harmfulSignals = thresholdSourceSignals.filter(
                    (s) => s.category === "HARMFUL"
                );
                
                const successValues = successfulSignals
                    .map((s) => ({
                        val: s.thresholds.get(thresholdName),
                        op: s.thresholdOps.get(thresholdName),
                    }))
                    .filter((v) => v.val !== undefined) as { val: number; op?: string }[];
                
                const harmfulValues = harmfulSignals
                    .map((s) => ({
                        val: s.thresholds.get(thresholdName),
                        op: s.thresholdOps.get(thresholdName),
                    }))
                    .filter((v) => v.val !== undefined) as { val: number; op?: string }[];

                if (successValues.length > 0) {
                    const operator = successValues[0].op || "EQL";
                    
                    if (operator === "NONE") {
                        // Skip thresholds with NONE operator
                        continue;
                    }
                    
                    const successVals = successValues.map((v) => v.val);
                    
                    if (operator === "EQL") {
                        // EQL: signal passes if value >= threshold
                        // Set threshold just below minimum successful to keep all successful signals
                        const minSuccessful = Math.min(...successVals);
                        const boundaryThreshold = minSuccessful * 0.99;
                        allThresholds.set(thresholdName, boundaryThreshold);
                    } else if (operator === "EQS") {
                        // EQS: signal passes if value <= threshold  
                        // Set threshold just above maximum successful to keep all successful signals
                        const maxSuccessful = Math.max(...successVals);
                        const boundaryThreshold = maxSuccessful * 1.01;
                        allThresholds.set(thresholdName, boundaryThreshold);
                    }
                }
            }
        }
    }

    // CLUSTER-BASED METRICS (prioritize cluster elimination over individual signals)
    const allClusters = createSignalClusters(
        signals.filter((s) => s.detectorType === detector)
    );
    const filteredClusters = createSignalClusters(filteredSignals);

    // Count harmful and successful clusters
    const harmfulClusters = filteredClusters.filter((c) =>
        c.signals.some((s) => s.category === "HARMFUL")
    ).length;

    const successfulClusters = filteredClusters.filter((c) =>
        c.signals.some((s) => s.category === "SUCCESSFUL")
    ).length;

    const clustersWithOnlyHarmful = filteredClusters.filter((c) =>
        c.signals.every((s) => s.category === "HARMFUL")
    ).length;

    // Calculate rates
    const total = filteredSignals.length;
    const successRate = total > 0 ? successful / total : 0;
    const harmfulRate = total > 0 ? harmful / total : 0;
    const harmfulClusterRate =
        filteredClusters.length > 0
            ? harmfulClusters / filteredClusters.length
            : 0;
    const coverageRate =
        relevantPhases > 0 ? phasesWithSignals.size / relevantPhases : 0;

    // Check phases that originally had successful signals
    const phasesWithOriginalSuccess = new Set<number>();
    const originalSuccessfulSignals = signals.filter(
        (s) => s.detectorType === detector && s.category === "SUCCESSFUL"
    );
    for (const sig of originalSuccessfulSignals) {
        if (sig.phaseId !== undefined) {
            phasesWithOriginalSuccess.add(sig.phaseId);
        }
    }

    // Count how many success phases we still cover
    const successPhasesStillCovered = new Set<number>();
    for (const sig of filteredSignals) {
        if (sig.category === "SUCCESSFUL" && sig.phaseId !== undefined) {
            successPhasesStillCovered.add(sig.phaseId);
        }
    }

    const missedSuccessPhases =
        phasesWithOriginalSuccess.size - successPhasesStillCovered.size;

    // Quality score prioritizes:
    // 1. MUST keep at least 1 successful signal in EACH phase that had success
    // 2. Eliminate harmful clusters
    // 3. Maintain good success rate
    const harmfulClusterPenalty =
        clustersWithOnlyHarmful > 0 ? -2000 * clustersWithOnlyHarmful : 0; // Massive penalty for harmful-only clusters
    const harmfulSignalPenalty = harmful > 0 ? -500 * harmfulRate : 0; // Secondary penalty for harmful signals
    const missedPhasePenalty =
        missedSuccessPhases > 0 ? -5000 * missedSuccessPhases : 0; // HUGE penalty for missing success phases
    const coverageBonus =
        successPhasesStillCovered.size >= phasesWithOriginalSuccess.size
            ? 200
            : 0; // Big bonus for maintaining all success phases
    const successBonus = successRate * 300; // High weight for success rate
    const signalCountPenalty =
        total < 10
            ? -1000 // Penalty for too few signals
            : total < 100
              ? -100
              : 0;

    const qualityScore =
        successBonus +
        coverageBonus +
        harmfulClusterPenalty +
        harmfulSignalPenalty +
        missedPhasePenalty +
        signalCountPenalty;

    return {
        detector,
        thresholds,
        allThresholds,
        totalSignals: total,
        successfulSignals: successful,
        smallTPSignals: smallTP,
        harmlessSignals: harmless,
        harmfulSignals: harmful,
        clustersWithSignals,
        totalClusters: totalDetectorClusters,
        phasesWithSignals: phasesWithSignals.size,
        totalPhases: relevantPhases,
        successRate,
        harmfulRate,
        coverageRate,
        qualityScore,
        phaseDistribution,
    };
}

async function optimizeThresholds(date: string): Promise<void> {
    console.log(`🔍 Analyzing threshold combinations for ${date}...\n`);

    // Load and process signals from JSON Lines files
    const signals = await loadSignalsWithDetails(date);
    console.log(`📊 Loaded ${signals.length} signals`);

    await enrichSignalsWithPriceMovements(signals, date);

    // Load price data for price-first phase detection
    const priceData = await loadPriceData(date);
    console.log(`📊 Loaded ${priceData.size} price points`);

    // Create complete price-based phases (includes all significant moves)
    const pricePhases = createCompletePricePhases(priceData, signals);

    console.log(
        `📈 Identified ${pricePhases.length} complete phases from price movements`
    );

    // Print complete phase summary with detection status
    printCompletePhaseSummary(pricePhases);

    // Refine categories based on position management
    refineSignalCategories(pricePhases);

    // Save analysis report
    const reportPath = "analysis/reports/threshold_optimization_report.json";
    const reportData = {
        date,
        totalSignals: signals.length,
        totalClusters: pricePhases.reduce(
            (sum, p) => sum + p.detectedClusters.length,
            0
        ),
        totalPhases: pricePhases.length,
        pricePhasesCoverage: {
            detected: pricePhases.filter(
                (p) => p.detectionStatus === "DETECTED"
            ).length,
            partiallyDetected: pricePhases.filter(
                (p) => p.detectionStatus === "PARTIALLY_DETECTED"
            ).length,
            undetected: pricePhases.filter(
                (p) => p.detectionStatus === "UNDETECTED"
            ).length,
        },
        generatedAt: new Date().toISOString(),
        format: "JSON Lines (.jsonl) with price-first phase detection",
        optimizationResults: {} as Record<string, any>,
    };

    // Assign signals to phases for breakdown analysis
    console.log(`\n🔗 Assigning signals to phases for detailed breakdown...`);
    for (const signal of signals) {
        // Find which phase this signal belongs to based on timestamp
        for (const phase of pricePhases) {
            if (
                signal.timestamp >= phase.startTime &&
                signal.timestamp <= phase.endTime
            ) {
                signal.phaseId = phase.id;
                break;
            }
        }
    }

    const signalsWithPhases = signals.filter((s) => s.phaseId !== undefined);
    console.log(
        `✅ Assigned ${signalsWithPhases.length}/${signals.length} signals to phases`
    );

    // Analyze each detector
    const detectors = ["absorption", "exhaustion", "deltacvd"];

    for (const detector of detectors) {
        const detectorSignals = signals.filter(
            (s) => s.detectorType === detector
        );
        if (detectorSignals.length === 0) continue;

        // Separate signals by outcome for finding SEPARATING thresholds
        const successfulSignals = detectorSignals.filter(
            (s) => s.category === "SUCCESSFUL"
        );
        const harmfulSignals = detectorSignals.filter(
            (s) => s.category === "HARMFUL"
        );
        const harmlessSignals = detectorSignals.filter(
            (s) => s.category === "HARMLESS"
        );

        console.log(
            `   Signals: ${successfulSignals.length} successful, ${harmfulSignals.length} harmful, ${harmlessSignals.length} harmless`
        );

        if (successfulSignals.length === 0 || harmfulSignals.length === 0) {
            console.log(
                `❌ Cannot optimize ${detector.toUpperCase()} - need both successful and harmful signals`
            );
            continue;
        }

        // Group signals by cluster to ensure we keep at least 1 successful per cluster
        const signalClusters = createSignalClusters(detectorSignals);
        const clustersWithSuccess = signalClusters.filter((c) =>
            c.signals.some((s) => s.category === "SUCCESSFUL")
        );
        const clustersOnlyHarmful = signalClusters.filter((c) =>
            c.signals.every((s) => s.category === "HARMFUL")
        );

        console.log(
            `   Clusters: ${clustersWithSuccess.length} with success, ${clustersOnlyHarmful.length} only harmful`
        );

        const thresholdSourceSignals = detectorSignals.filter(
            (s) => s.thresholds.size > 0
        );

        console.log(`\n${"=".repeat(80)}`);
        console.log(`🎯 ${detector.toUpperCase()} DETECTOR OPTIMIZATION`);
        console.log(`${"=".repeat(80)}`);

        // Get threshold ranges from actual signal data
        const thresholdFields = Object.keys(
            THRESHOLD_FIELD_MAP[detector as keyof typeof THRESHOLD_FIELD_MAP]
        );
        const thresholdRanges = new Map<string, number[]>();

        // Find SEPARATING threshold values between successful and harmful signals
        for (const threshold of thresholdFields) {
            // Get values and operators from signals
            const successValues = successfulSignals
                .map((s) => ({
                    val: s.thresholds.get(threshold),
                    op: s.thresholdOps.get(threshold),
                }))
                .filter((v) => v.val !== undefined) as {
                val: number;
                op?: string;
            }[];

            const harmfulValues = harmfulSignals
                .map((s) => ({
                    val: s.thresholds.get(threshold),
                    op: s.thresholdOps.get(threshold),
                }))
                .filter((v) => v.val !== undefined) as {
                val: number;
                op?: string;
            }[];

            if (successValues.length === 0 || harmfulValues.length === 0) {
                console.log(`     ${threshold}: Skipping - insufficient data`);
                continue;
            }

            // Get the operator (should be consistent across signals)
            const operator = successValues[0].op || "EQL";
            if (operator === "NONE") {
                console.log(`     ${threshold}: Skipping - NONE operator`);
                continue;
            }

            // Extract just the values
            const successVals = successValues.map((v) => v.val);
            const harmfulVals = harmfulValues.map((v) => v.val);

            // Find separating values based on operator type
            const separatingValues: number[] = [];

            if (operator === "EQL") {
                // EQL: signal passes if value >= threshold
                // To block harmful: set threshold ABOVE harmful values
                // To keep successful: set threshold AT OR BELOW successful values

                const harmfulMax = Math.max(...harmfulVals);
                const successMin = Math.min(...successVals);
                const success25 = successVals.sort((a, b) => a - b)[
                    Math.floor(successVals.length * 0.25)
                ];
                const harmful75 = harmfulVals.sort((a, b) => a - b)[
                    Math.floor(harmfulVals.length * 0.75)
                ];

                // Test strategic separation points
                separatingValues.push(
                    harmfulMax * 1.01, // Just above max harmful
                    harmful75, // Block 25% of harmful
                    (harmfulMax + successMin) / 2, // Midpoint
                    success25, // Keep 75% of successful
                    successMin * 0.99 // Just below min successful
                );

                // For exhaustion, add lower thresholds to catch phases 2,4,5
                if (detector === "exhaustion" && threshold === "minAggVolume") {
                    // Add lower volume thresholds that might catch UP phases
                    const success10 = successVals.sort((a, b) => a - b)[
                        Math.floor(successVals.length * 0.1)
                    ];
                    const harmful10 = harmfulVals.sort((a, b) => a - b)[
                        Math.floor(harmfulVals.length * 0.1)
                    ];
                    separatingValues.push(
                        harmful10, // Allow bottom 10% harmful for coverage
                        success10, // Keep 90% of successful
                        50, // Low threshold for UP phases
                        100, // Medium-low threshold
                        200 // Moderate threshold
                    );
                }
            } else if (operator === "EQS") {
                // EQS: signal passes if value <= threshold
                // To block harmful: set threshold BELOW harmful values
                // To keep successful: set threshold AT OR ABOVE successful values

                const harmfulMin = Math.min(...harmfulVals);
                const successMax = Math.max(...successVals);
                const success75 = successVals.sort((a, b) => b - a)[
                    Math.floor(successVals.length * 0.25)
                ];
                const harmful25 = harmfulVals.sort((a, b) => b - a)[
                    Math.floor(harmfulVals.length * 0.75)
                ];

                separatingValues.push(
                    harmfulMin * 0.99, // Just below min harmful
                    harmful25, // Block 75% of harmful
                    (harmfulMin + successMax) / 2, // Midpoint
                    success75, // Keep 75% of successful
                    successMax * 1.01 // Just above max successful
                );
            }

            // Use unique positive values
            const uniqueValues = Array.from(new Set(separatingValues))
                .filter((v) => v > 0 && !isNaN(v))
                .sort((a, b) => a - b)
                .slice(0, 5);

            if (uniqueValues.length > 0) {
                thresholdRanges.set(threshold, uniqueValues);
                console.log(
                    `     ${threshold} (${operator}): Testing ${uniqueValues.length} separation points: ${uniqueValues.map((v) => v.toFixed(4)).join(", ")}`
                );
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
            // Test with each value at percentiles: min, 50%, 80%
            const valuesToTest = arrays[index].slice(0, 3); // Limited to 3 values to prevent memory issues

            for (const value of valuesToTest) {
                current.push(value);
                results.push(
                    ...generateCombinations(arrays, index + 1, current)
                );
                current.pop();
            }

            return results;
        }

        // Test calculated value combinations that eliminate harmful signals
        console.log(
            `   Testing calculated value combinations to eliminate harmful signals...`
        );

        const availableThresholds = Array.from(thresholdRanges.keys());
        console.log(
            `   Available thresholds: ${availableThresholds.join(", ")}`
        );

        // Test all single thresholds first to find the most effective ones
        for (const [thresholdName, values] of thresholdRanges) {
            for (const value of values) {
                const result = evaluateCombination(
                    detector,
                    new Map([[thresholdName, value]]),
                    detectorSignals,
                    pricePhases,
                    thresholdSourceSignals
                );
                results.push(result);
            }
        }

        // Test comprehensive multi-threshold combinations
        // Test 3-threshold combinations with key thresholds
        const keyThresholds = [
            "balanceThreshold",
            "minAbsorptionScore",
            "passiveAbsorptionThreshold",
            "minPassiveMultiplier",
        ];
        const availableKeyThresholds = keyThresholds.filter((t) =>
            thresholdRanges.has(t)
        );

        if (availableKeyThresholds.length >= 3) {
            console.log(
                `   Testing 3-threshold combinations with key thresholds: ${availableKeyThresholds.join(", ")}`
            );

            // Test combinations of 3 key thresholds
            for (let i = 0; i < availableKeyThresholds.length - 2; i++) {
                for (
                    let j = i + 1;
                    j < availableKeyThresholds.length - 1;
                    j++
                ) {
                    for (
                        let k = j + 1;
                        k < availableKeyThresholds.length;
                        k++
                    ) {
                        const t1 = availableKeyThresholds[i];
                        const t2 = availableKeyThresholds[j];
                        const t3 = availableKeyThresholds[k];

                        const values1 = thresholdRanges.get(t1) || [];
                        const values2 = thresholdRanges.get(t2) || [];
                        const values3 = thresholdRanges.get(t3) || [];

                        // Test top 2 values for each to limit combinations
                        for (const val1 of values1.slice(0, 2)) {
                            for (const val2 of values2.slice(0, 2)) {
                                for (const val3 of values3.slice(0, 2)) {
                                    const thresholdMap = new Map([
                                        [t1, val1],
                                        [t2, val2],
                                        [t3, val3],
                                    ]);
                                    const result = evaluateCombination(
                                        detector,
                                        thresholdMap,
                                        detectorSignals,
                                        pricePhases,
                                        thresholdSourceSignals
                                    );
                                    results.push(result);
                                }
                            }
                        }
                    }
                }
            }
        }

        // Test 2-threshold combinations
        if (availableThresholds.length >= 2) {
            for (let i = 0; i < availableThresholds.length - 1; i++) {
                for (let j = i + 1; j < availableThresholds.length; j++) {
                    const threshold1 = availableThresholds[i];
                    const threshold2 = availableThresholds[j];
                    const values1 = thresholdRanges.get(threshold1) || [];
                    const values2 = thresholdRanges.get(threshold2) || [];

                    // Test combinations of actual calculated values
                    for (const val1 of values1.slice(0, 3)) {
                        for (const val2 of values2.slice(0, 3)) {
                            const thresholdMap = new Map([
                                [threshold1, val1],
                                [threshold2, val2],
                            ]);
                            const result = evaluateCombination(
                                detector,
                                thresholdMap,
                                detectorSignals,
                                pricePhases,
                                thresholdSourceSignals
                            );
                            results.push(result);
                        }
                    }
                }
            }
        }

        console.log(
            `   Tested ${results.length} threshold combinations using calculated values from validation logs`
        );

        // Sort by quality score
        results.sort((a, b) => b.qualityScore - a.qualityScore);

        // Display top recommendations
        console.log(
            "\n🏆 TOP THRESHOLD COMBINATIONS (HARMFUL SIGNAL ELIMINATION):\n"
        );

        // Find combinations that eliminate harmful signals first
        const zeroHarmfulResults = results.filter(
            (r) => r.harmfulSignals === 0
        );
        const someHarmfulResults = results.filter((r) => r.harmfulSignals > 0);

        console.log(
            `   DEBUG: Found ${zeroHarmfulResults.length} zero-harmful and ${someHarmfulResults.length} some-harmful results`
        );
        console.log(
            `   DEBUG: Top 5 results signal counts: ${results
                .slice(0, 5)
                .map(
                    (r) =>
                        `${r.totalSignals} (${Array.from(r.thresholds.entries())
                            .map(([k, v]) => `${k}=${v.toFixed(3)}`)
                            .join(",")})`
                )
                .join(" | ")}`
        );

        // For exhaustion detector, show phase coverage for finding complementary settings
        if (detector === "exhaustion" && zeroHarmfulResults.length > 0) {
            console.log(
                `\n   🔍 EXHAUSTION PHASE COVERAGE ANALYSIS (for complementing absorption):`
            );
            console.log(`   Need to cover phases: 2 (UP), 4 (DOWN), 5 (UP)`);
            for (const r of zeroHarmfulResults.slice(0, 10)) {
                const phases: number[] = [];
                if (r.phaseDistribution) {
                    for (const [phaseId, data] of r.phaseDistribution) {
                        if (data.successful > 0) phases.push(phaseId);
                    }
                }
                const coversNeeded = phases.filter((p) =>
                    [2, 4, 5].includes(p)
                );
                if (coversNeeded.length > 0) {
                    console.log(
                        `   ✅ Covers phases ${phases.join(",")} - COVERS NEEDED: ${coversNeeded.join(",")} | ${r.totalSignals} signals`
                    );
                } else {
                    console.log(
                        `   ❌ Covers phases ${phases.join(",")} - misses 2,4,5 | ${r.totalSignals} signals`
                    );
                }
            }
        }

        console.log(
            `🎯 ZERO HARMFUL SIGNAL COMBINATIONS (${zeroHarmfulResults.length} found):`
        );
        for (let i = 0; i < Math.min(5, zeroHarmfulResults.length); i++) {
            const r = zeroHarmfulResults[i];

            console.log(
                `\n${i + 1}. 🎯 PERFECT - ZERO HARMFUL SIGNALS | Score: ${r.qualityScore.toFixed(1)} [${r.thresholds.size} calculated thresholds]`
            );
            console.log("   📋 COMPLETE THRESHOLD CONFIGURATION:");

            // Show ALL threshold values - optimized ones and current config for others
            const allThresholdFields = Object.keys(
                THRESHOLD_FIELD_MAP[
                    detector as keyof typeof THRESHOLD_FIELD_MAP
                ]
            );
            for (const thresholdName of allThresholdFields) {
                if (r.thresholds.has(thresholdName)) {
                    console.log(
                        `     ${thresholdName}: ${r.thresholds.get(thresholdName)?.toFixed(6)} ← OPTIMIZED`
                    );
                } else {
                    // Show boundary threshold derived from successful signals with operator awareness
                    const successfulSignals = thresholdSourceSignals.filter(
                        (s) => s.category === "SUCCESSFUL"
                    );
                    const successValues = successfulSignals
                        .map((s) => ({
                            val: s.thresholds.get(thresholdName),
                            op: s.thresholdOps.get(thresholdName),
                        }))
                        .filter((v) => v.val !== undefined) as { val: number; op?: string }[];
                    
                    if (successValues.length > 0) {
                        const operator = successValues[0].op || "EQL";
                        const successVals = successValues.map((v) => v.val);
                        
                        if (operator === "NONE") {
                            console.log(
                                `     ${thresholdName}: SKIPPED (NONE operator)`
                            );
                        } else if (operator === "EQL") {
                            const minSuccessful = Math.min(...successVals);
                            const boundaryThreshold = minSuccessful * 0.99;
                            console.log(
                                `     ${thresholdName}: ${boundaryThreshold.toFixed(6)} (EQL boundary from successful min: ${minSuccessful.toFixed(6)})`
                            );
                        } else if (operator === "EQS") {
                            const maxSuccessful = Math.max(...successVals);
                            const boundaryThreshold = maxSuccessful * 1.01;
                            console.log(
                                `     ${thresholdName}: ${boundaryThreshold.toFixed(6)} (EQS boundary from successful max: ${maxSuccessful.toFixed(6)})`
                            );
                        }
                    }
                }
            }

            // VALIDATION: Check for illogical threshold recommendations
            console.log(`   🔍 VALIDATION CHECKS:`);
            const allThresholds = r.allThresholds;
            if (allThresholds) {
                // Check priceEfficiencyThreshold should be > 0
                const priceEfficiency = allThresholds.get("priceEfficiencyThreshold");
                if (priceEfficiency !== undefined) {
                    if (priceEfficiency <= 0) {
                        console.log(`     ⚠️  WARNING: priceEfficiencyThreshold=${priceEfficiency} will reject ALL signals (should be > 0)`);
                    } else if (priceEfficiency < 0.0001) {
                        console.log(`     ✓ priceEfficiencyThreshold=${priceEfficiency.toFixed(6)} looks reasonable`);
                    } else {
                        console.log(`     ⚠️  WARNING: priceEfficiencyThreshold=${priceEfficiency} might be too high (typical range 0.0001-0.01)`);
                    }
                }

                // Check maxPriceImpactRatio should be > 0
                const maxImpact = allThresholds.get("maxPriceImpactRatio");
                if (maxImpact !== undefined) {
                    if (maxImpact <= 0) {
                        console.log(`     ⚠️  WARNING: maxPriceImpactRatio=${maxImpact} will reject ALL signals (should be > 0)`);
                    } else if (maxImpact < 0.1) {
                        console.log(`     ✓ maxPriceImpactRatio=${maxImpact.toFixed(6)} looks reasonable`);
                    } else {
                        console.log(`     ⚠️  WARNING: maxPriceImpactRatio=${maxImpact} might be too high (typical range 0.001-0.05)`);
                    }
                }

                // Check passiveAbsorptionThreshold vs minAbsorptionScore should be different
                const passiveAbsorption = allThresholds.get("passiveAbsorptionThreshold");
                const minAbsorption = allThresholds.get("minAbsorptionScore");
                if (passiveAbsorption !== undefined && minAbsorption !== undefined) {
                    if (Math.abs(passiveAbsorption - minAbsorption) < 0.001) {
                        console.log(`     ⚠️  WARNING: passiveAbsorptionThreshold=${passiveAbsorption.toFixed(6)} and minAbsorptionScore=${minAbsorption.toFixed(6)} are nearly identical (should be different thresholds)`);
                    } else {
                        console.log(`     ✓ passiveAbsorptionThreshold and minAbsorptionScore are properly differentiated`);
                    }
                }

                // Check minAggVolume should be reasonable
                const minAggVol = allThresholds.get("minAggVolume");
                if (minAggVol !== undefined) {
                    if (minAggVol < 1) {
                        console.log(`     ⚠️  WARNING: minAggVolume=${minAggVol} is too low (should be >= 1)`);
                    } else if (minAggVol > 10000) {
                        console.log(`     ⚠️  WARNING: minAggVolume=${minAggVol} might be too high (typical range 50-1000)`);
                    } else {
                        console.log(`     ✓ minAggVolume=${minAggVol.toFixed(1)} looks reasonable`);
                    }
                }
            }

            console.log(`   📊 Performance:`);
            console.log(`     Signals: ${r.totalSignals} total`);
            console.log(
                `     ✅ Successful: ${r.successfulSignals} (${(r.successRate * 100).toFixed(1)}%)`
            );
            console.log(`     🟡 Small TP: ${r.smallTPSignals}`);
            console.log(`     🟢 Harmless: ${r.harmlessSignals}`);
            console.log(
                `     🔴 Harmful: ${r.harmfulSignals} (${(r.harmfulRate * 100).toFixed(1)}%) ← ELIMINATED!`
            );
            console.log(
                `   Coverage: ${r.phasesWithSignals}/${r.totalPhases} phases covered`
            );
        }

        if (zeroHarmfulResults.length === 0) {
            console.log(
                "❌ NO COMBINATIONS FOUND THAT ELIMINATE ALL HARMFUL SIGNALS"
            );
            console.log(
                "\n🔥 BEST AVAILABLE COMBINATIONS (still have some harmful signals):"
            );
            for (let i = 0; i < Math.min(3, someHarmfulResults.length); i++) {
                const r = someHarmfulResults[i];
                console.log(
                    `\n${i + 1}. Score: ${r.qualityScore.toFixed(1)} | Harmful: ${r.harmfulSignals} (${(r.harmfulRate * 100).toFixed(1)}%)`
                );
                console.log("   📋 COMPLETE THRESHOLD CONFIGURATION:");

                // Show ALL threshold values
                const allThresholdFields = Object.keys(
                    THRESHOLD_FIELD_MAP[
                        detector as keyof typeof THRESHOLD_FIELD_MAP
                    ]
                );
                for (const thresholdName of allThresholdFields) {
                    if (r.thresholds.has(thresholdName)) {
                        console.log(
                            `     ${thresholdName}: ${r.thresholds.get(thresholdName)?.toFixed(6)} ← OPTIMIZED`
                        );
                    } else {
                        // Show median calculated value for non-optimized thresholds
                        const allValues = thresholdSourceSignals
                            .map((s) => s.thresholds.get(thresholdName))
                            .filter((v) => v !== undefined) as number[];
                        if (allValues.length > 0) {
                            const medianValue = allValues.sort((a, b) => a - b)[
                                Math.floor(allValues.length / 2)
                            ];
                            console.log(
                                `     ${thresholdName}: ${medianValue.toFixed(6)} (current median)`
                            );
                        }
                    }
                }
                console.log(
                    `   📊 Success: ${r.successfulSignals} (${(r.successRate * 100).toFixed(1)}%) | Phases: ${r.phasesWithSignals}/${r.totalPhases}`
                );

                // DETAILED PHASE-BY-PHASE BREAKDOWN
                console.log(`   📋 PHASE-BY-PHASE SIGNAL BREAKDOWN:`);
                if (r.phaseDistribution && r.phaseDistribution.size > 0) {
                    for (const [
                        phaseId,
                        data,
                    ] of r.phaseDistribution.entries()) {
                        const harmlessCount =
                            data.signals - data.successful - data.harmful;
                        console.log(
                            `     Phase ${phaseId}: ${data.clusters} (${data.signals}) total | ✅ ${data.successful} successful | 🟢 ${harmlessCount} harmless | 🔴 ${data.harmful} harmful`
                        );
                    }
                } else {
                    console.log(`     No phase distribution data available`);
                }

                // DETAILED PHASE-BY-PHASE BREAKDOWN
                console.log(`   📋 PHASE-BY-PHASE SIGNAL BREAKDOWN:`);
                if (r.phaseDistribution && r.phaseDistribution.size > 0) {
                    for (const [
                        phaseId,
                        data,
                    ] of r.phaseDistribution.entries()) {
                        const harmlessCount =
                            data.signals - data.successful - data.harmful;
                        console.log(
                            `     Phase ${phaseId}: ${data.clusters} (${data.signals}) total | ✅ ${data.successful} successful | 🟢 ${harmlessCount} harmless | 🔴 ${data.harmful} harmful`
                        );
                    }
                } else {
                    console.log(`     No phase distribution data available`);
                }
            }
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
            topCombinations:
                zeroHarmfulResults.length > 0
                    ? zeroHarmfulResults.slice(0, 3).map((r) => ({
                          qualityScore: r.qualityScore,
                          thresholds: Object.fromEntries(r.thresholds),
                          allThresholds: r.allThresholds
                              ? Object.fromEntries(r.allThresholds)
                              : Object.fromEntries(r.thresholds),
                          performance: {
                              totalSignals: r.totalSignals,
                              successfulSignals: r.successfulSignals,
                              successRate: r.successRate,
                              harmfulRate: r.harmfulRate,
                              coverageRate: r.coverageRate,
                              phasesWithSignals: r.phasesWithSignals,
                              totalPhases: r.totalPhases,
                          },
                          phaseDistribution: r.phaseDistribution
                              ? Array.from(r.phaseDistribution.entries()).map(
                                    ([phaseId, data]) => ({
                                        phaseId,
                                        signals: data.signals,
                                        successful: data.successful,
                                        harmful: data.harmful,
                                        clusters: data.clusters,
                                    })
                                )
                              : [],
                      }))
                    : someHarmfulResults.slice(0, 3).map((r) => ({
                          qualityScore: r.qualityScore,
                          thresholds: Object.fromEntries(r.thresholds),
                          allThresholds: r.allThresholds
                              ? Object.fromEntries(r.allThresholds)
                              : Object.fromEntries(r.thresholds),
                          performance: {
                              totalSignals: r.totalSignals,
                              successfulSignals: r.successfulSignals,
                              successRate: r.successRate,
                              harmfulRate: r.harmfulRate,
                              coverageRate: r.coverageRate,
                              phasesWithSignals: r.phasesWithSignals,
                              totalPhases: r.totalPhases,
                          },
                          phaseDistribution: r.phaseDistribution
                              ? Array.from(r.phaseDistribution.entries()).map(
                                    ([phaseId, data]) => ({
                                        phaseId,
                                        signals: data.signals,
                                        successful: data.successful,
                                        harmful: data.harmful,
                                        clusters: data.clusters,
                                    })
                                )
                              : [],
                      })),
        };
    }

    // Save comprehensive report
    await fs.writeFile(reportPath, JSON.stringify(reportData, null, 2));
    console.log(`\n📄 Optimization report saved to: ${reportPath}`);

    // Generate HTML report with price phases
    await generateHTMLReport(reportData, date, pricePhases);

    console.log("\n" + "=".repeat(80));
    console.log("💡 OPTIMIZATION COMPLETE");
    console.log("=".repeat(80));
    console.log(
        "📊 Updated to use JSON Lines format for improved data integrity"
    );
    console.log("📁 Reports saved to analysis/reports/ directory");
}

async function generateHTMLReport(
    reportData: any,
    date: string,
    pricePhases?: PricePhase<Signal>[]
): Promise<void> {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Threshold Optimization Report - ${date}</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 20px;
            background-color: #1a1a1a;
            color: #e0e0e0;
        }
        h1, h2 {
            color: #4CAF50;
            border-bottom: 2px solid #4CAF50;
            padding-bottom: 10px;
        }
        table {
            border-collapse: collapse;
            width: 100%;
            background-color: #2a2a2a;
            box-shadow: 0 4px 8px rgba(0,0,0,0.3);
            margin: 20px 0;
        }
        th {
            background-color: #4CAF50;
            color: white;
            padding: 12px;
            text-align: left;
            font-weight: bold;
        }
        td {
            padding: 10px;
            border-bottom: 1px solid #444;
        }
        tr:hover {
            background-color: #333;
        }
        .success { color: #4CAF50; font-weight: bold; }
        .warning { color: #FFA726; font-weight: bold; }
        .danger { color: #f44336; font-weight: bold; }
        .score { 
            font-size: 1.2em;
            font-weight: bold;
            color: #00BCD4;
        }
        .summary-box {
            background-color: #2a2a2a;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
            border: 1px solid #444;
        }
        .metric {
            display: inline-block;
            margin: 10px 20px 10px 0;
        }
        .metric-label {
            color: #999;
            font-size: 0.9em;
        }
        .metric-value {
            font-size: 1.3em;
            font-weight: bold;
        }
    </style>
</head>
<body>
    <h1>🎯 Threshold Optimization Report</h1>
    <div class="summary-box">
        <div class="metric">
            <div class="metric-label">Analysis Date</div>
            <div class="metric-value">${date}</div>
        </div>
        <div class="metric">
            <div class="metric-label">Total Signals</div>
            <div class="metric-value">${reportData.totalSignals}</div>
        </div>
        <div class="metric">
            <div class="metric-label">Total Clusters</div>
            <div class="metric-value">${reportData.totalClusters}</div>
        </div>
        <div class="metric">
            <div class="metric-label">Total Phases</div>
            <div class="metric-value">${reportData.totalPhases}</div>
        </div>
        <div class="metric">
            <div class="metric-label">Price Phases Coverage</div>
            <div class="metric-value">
                ✅ ${reportData.pricePhasesCoverage.detected} 
                ⚠️ ${reportData.pricePhasesCoverage.partiallyDetected} 
                ❌ ${reportData.pricePhasesCoverage.undetected}
            </div>
        </div>
    </div>

    ${
        pricePhases
            ? `
    <h2>📊 Complete Phase Coverage Matrix</h2>
    <div class="summary-box">
        <p><strong>Price-First Phase Detection:</strong> All significant market movements (>0.35%) identified from raw price data, then mapped to signal coverage</p>
    </div>
    
    <table>
        <tr>
            <th>Phase</th>
            <th>Direction & Size</th>
            <th>Price Range</th>
            <th>Detection Status</th>
            <th>Coverage</th>
            <th>Absorption</th>
            <th>Exhaustion</th>
            <th>DeltaCVD</th>
        </tr>
        ${pricePhases
            .map(
                (phase) => `
        <tr style="${
            phase.detectionStatus === "UNDETECTED"
                ? "background-color: #4a1a1a;"
                : phase.detectionStatus === "PARTIALLY_DETECTED"
                  ? "background-color: #4a4a1a;"
                  : "background-color: #1a4a1a;"
        }">
            <td><strong>Phase ${phase.id}</strong></td>
            <td>
                ${phase.direction === "UP" ? "📈" : "📉"} ${phase.direction}<br>
                <span style="font-size: 1.1em; font-weight: bold;">${(phase.sizePercent * 100).toFixed(2)}%</span>
            </td>
            <td>
                $${phase.startPrice.toFixed(2)} →<br>
                $${phase.endPrice.toFixed(2)}
            </td>
            <td>
                ${
                    phase.detectionStatus === "DETECTED"
                        ? "✅ DETECTED"
                        : phase.detectionStatus === "PARTIALLY_DETECTED"
                          ? "⚠️ PARTIAL"
                          : "❌ UNDETECTED"
                }
            </td>
            <td>
                ${
                    phase.detectionStatus === "UNDETECTED"
                        ? "0%"
                        : (phase.detectionCoverage * 100).toFixed(0) + "%"
                }
            </td>
            <td>
                ${
                    phase.detectorCoverage.has("absorption") &&
                    phase.detectorCoverage.get("absorption")!.signals.length > 0
                        ? `✅ ${phase.detectorCoverage.get("absorption")!.signals.length} signals<br><small>(${(phase.detectorCoverage.get("absorption")!.coverage * 100).toFixed(0)}% coverage)</small>`
                        : "❌ None"
                }
            </td>
            <td>
                ${
                    phase.detectorCoverage.has("exhaustion") &&
                    phase.detectorCoverage.get("exhaustion")!.signals.length > 0
                        ? `✅ ${phase.detectorCoverage.get("exhaustion")!.signals.length} signals<br><small>(${(phase.detectorCoverage.get("exhaustion")!.coverage * 100).toFixed(0)}% coverage)</small>`
                        : "❌ None"
                }
            </td>
            <td>
                ${
                    phase.detectorCoverage.has("deltacvd") &&
                    phase.detectorCoverage.get("deltacvd")!.signals.length > 0
                        ? `✅ ${phase.detectorCoverage.get("deltacvd")!.signals.length} signals<br><small>(${(phase.detectorCoverage.get("deltacvd")!.coverage * 100).toFixed(0)}% coverage)</small>`
                        : "❌ None"
                }
            </td>
        </tr>
        `
            )
            .join("")}
    </table>
    
    <div class="summary-box">
        <h3>🎯 Detection Performance Summary</h3>
        <div class="metric">
            <div class="metric-label">Fully Detected Phases</div>
            <div class="metric-value success">${pricePhases.filter((p) => p.detectionStatus === "DETECTED").length}/${pricePhases.length} (${((pricePhases.filter((p) => p.detectionStatus === "DETECTED").length / pricePhases.length) * 100).toFixed(1)}%)</div>
        </div>
        <div class="metric">
            <div class="metric-label">Partially Detected Phases</div>
            <div class="metric-value warning">${pricePhases.filter((p) => p.detectionStatus === "PARTIALLY_DETECTED").length}/${pricePhases.length} (${((pricePhases.filter((p) => p.detectionStatus === "PARTIALLY_DETECTED").length / pricePhases.length) * 100).toFixed(1)}%)</div>
        </div>
        <div class="metric">
            <div class="metric-label">Undetected Phases (Blind Spots)</div>
            <div class="metric-value danger">${pricePhases.filter((p) => p.detectionStatus === "UNDETECTED").length}/${pricePhases.length} (${((pricePhases.filter((p) => p.detectionStatus === "UNDETECTED").length / pricePhases.length) * 100).toFixed(1)}%)</div>
        </div>
        <div class="metric">
            <div class="metric-label">Overall Detection Rate</div>
            <div class="metric-value">${(((pricePhases.filter((p) => p.detectionStatus === "DETECTED").length + pricePhases.filter((p) => p.detectionStatus === "PARTIALLY_DETECTED").length) / pricePhases.length) * 100).toFixed(1)}%</div>
        </div>
    </div>
    `
            : ""
    }

    ${Object.entries(reportData.optimizationResults)
        .map(
            ([detector, data]: [string, any]) => `
    <h2>${detector.toUpperCase()} Detector Optimization</h2>
    
    <div class="summary-box">
        <div class="metric">
            <div class="metric-label">Total Signals</div>
            <div class="metric-value">${data.totalSignals}</div>
        </div>
        <div class="metric">
            <div class="metric-label">Successful</div>
            <div class="metric-value class="success">${data.statistics.successful} (${((data.statistics.successful / data.totalSignals) * 100).toFixed(1)}%)</div>
        </div>
        <div class="metric">
            <div class="metric-label">Harmless</div>
            <div class="metric-value class="warning">${data.statistics.harmless} (${((data.statistics.harmless / data.totalSignals) * 100).toFixed(1)}%)</div>
        </div>
        <div class="metric">
            <div class="metric-label">Harmful</div>
            <div class="metric-value class="danger">${data.statistics.harmful} (${((data.statistics.harmful / data.totalSignals) * 100).toFixed(1)}%)</div>
        </div>
    </div>

    <h3>Top Threshold Combinations</h3>
    <table>
        <tr>
            <th>Rank</th>
            <th>Quality Score</th>
            <th>Thresholds & Phase Breakdown</th>
            <th>Success Rate</th>
            <th>Coverage</th>
            <th>Harmful Rate</th>
            <th>Total Signals</th>
        </tr>
        ${data.topCombinations
            .map(
                (combo: any, idx: number) => `
        <tr>
            <td>#${idx + 1}</td>
            <td class="score">${combo.qualityScore.toFixed(1)}</td>
            <td>
                ${
                    combo.allThresholds
                        ? Object.entries(combo.allThresholds)
                              .map(([key, val]) => {
                                  const isOptimized =
                                      combo.thresholds.hasOwnProperty(key);
                                  return `<div><strong>${key}:</strong> ${typeof val === "number" ? val.toFixed(6) : val}${isOptimized ? " ← OPTIMIZED" : " (from successful)"}</div>`;
                              })
                              .join("")
                        : Object.entries(combo.thresholds)
                              .map(
                                  ([key, val]) =>
                                      `<div><strong>${key}:</strong> ${val}</div>`
                              )
                              .join("")
                }
                ${
                    combo.allThresholds
                        ? (() => {
                              const warnings = [];
                              // Check for validation issues
                              const priceEff = combo.allThresholds.priceEfficiencyThreshold;
                              if (priceEff !== undefined && priceEff <= 0) {
                                  warnings.push(`⚠️ priceEfficiencyThreshold=${priceEff} will reject ALL signals`);
                              }
                              const maxImpact = combo.allThresholds.maxPriceImpactRatio;
                              if (maxImpact !== undefined && maxImpact <= 0) {
                                  warnings.push(`⚠️ maxPriceImpactRatio=${maxImpact} will reject ALL signals`);
                              }
                              const passiveAbs = combo.allThresholds.passiveAbsorptionThreshold;
                              const minAbs = combo.allThresholds.minAbsorptionScore;
                              if (passiveAbs !== undefined && minAbs !== undefined && Math.abs(passiveAbs - minAbs) < 0.001) {
                                  warnings.push(`⚠️ passiveAbsorptionThreshold and minAbsorptionScore are identical (${passiveAbs.toFixed(6)})`);
                              }
                              return warnings.length > 0 ? `<div style="margin-top: 8px; color: #FFA726; font-size: 0.9em;">🔍 VALIDATION:<br>${warnings.join('<br>')}</div>` : '';
                          })()
                        : ''
                }
            </td>
            <td class="success">${(combo.performance.successRate * 100).toFixed(1)}%</td>
            <td>${(combo.performance.coverageRate * 100).toFixed(1)}%</td>
            <td class="danger">${(combo.performance.harmfulRate * 100).toFixed(1)}%</td>
            <td>${combo.performance.totalSignals}</td>
        </tr>
        ${
            combo.phaseDistribution && combo.phaseDistribution.length > 0
                ? `
        <tr>
            <td colspan="7" style="padding: 20px; background-color: #1a1a1a;">
                <div style="margin-bottom: 10px;"><strong>📋 PHASE-BY-PHASE SIGNAL BREAKDOWN:</strong></div>
                <table style="width: 100%; margin: 0; font-size: 0.9em;">
                    <tr style="background-color: #2a2a2a;">
                        <th style="padding: 8px;">Phase</th>
                        <th style="padding: 8px;">Clusters (Signals)</th>
                        <th style="padding: 8px; color: #4CAF50;">✅ Successful</th>
                        <th style="padding: 8px; color: #FFA726;">🟢 Harmless</th>
                        <th style="padding: 8px; color: #f44336;">🔴 Harmful</th>
                    </tr>
                    ${combo.phaseDistribution
                        .map((data) => {
                            const harmlessCount =
                                data.signals - data.successful - data.harmful;
                            return `
                        <tr>
                            <td style="padding: 6px;">${data.phaseId}</td>
                            <td style="padding: 6px;">${data.clusters} (${data.signals})</td>
                            <td style="padding: 6px; color: #4CAF50;">${data.successful}</td>
                            <td style="padding: 6px; color: #FFA726;">${harmlessCount}</td>
                            <td style="padding: 6px; color: #f44336;">${data.harmful}</td>
                        </tr>`;
                        })
                        .join("")}
                </table>
                <div style="margin-top: 10px; font-size: 0.85em; color: #999;"><em>Coverage: ${combo.performance.phasesWithSignals}/${combo.performance.totalPhases} phases</em></div>
            </td>
        </tr>
        `
                : ""
        }
        `
            )
            .join("")}
    </table>
    `
        )
        .join("")}

    <div style="margin-top: 40px; color: #888; font-size: 12px;">
        <p>Generated: ${new Date().toISOString()}</p>
        <p>Data Format: JSON Lines (.jsonl) with price-first phase detection</p>
        <p>Phase Detection: Price movements identified first, then signal coverage mapped</p>
        <p>Quality Score = Success Rate × 100 + Coverage × 50 + (1 - Harmful Rate) × 30 + Signal Count Bonus</p>
    </div>
</body>
</html>`;

    const htmlPath = "analysis/reports/threshold_optimization_report.html";
    await fs.writeFile(htmlPath, html);
    console.log(`📊 HTML report saved to: ${htmlPath}`);
}

// Main execution
const date = process.argv[2] || new Date().toISOString().split("T")[0];
optimizeThresholds(date).catch(console.error);
