#!/usr/bin/env node
/**
 * Binary Threshold Optimization with Cross-Detector Coverage
 *
 * Requirements:
 * 1. MANDATORY: Keep ≥1 successful signal per successful phase
 * 2. Cross-detector coverage: Phase can lose coverage from one detector if another covers it
 * 3. Harmful signals are wrong-sided relative to phase direction
 * 4. Binary approach: No scoring, just categorize and optimize
 *
 * Phase Categories:
 * - Successful: Has successful signals → MUST maintain coverage
 * - Harmful: Only harmful (wrong-sided) signals → Eliminate as many as possible
 * - Harmless: Only harmless signals → Just report
 */

import * as fs from "fs/promises";
import {
    BaseSignal,
    SignalCluster,
    TradingPhase,
    PricePhase,
    createSignalClusters,
    createTradingPhases,
    createCompletePricePhases,
    printPhaseSummary,
    convertToLimaTime,
    PHASE_DETECTION_CONFIG,
} from "./shared/phaseDetection.js";

// Configuration
const TARGET_TP = 0.007; // 0.7% profit target
const STOP_LOSS = 0.0035; // 0.35% stop loss (updated from your message)
const BREAK_EVEN_THRESHOLD = 0.002; // 0.2% for break-even
const SMALL_TP_THRESHOLD = 0.004; // 0.4% for small TP

interface Signal extends BaseSignal {
    logType: "successful" | "validation";

    // Threshold values extracted from JSON
    thresholds: Map<string, number>; // The calculated values from the signal
    thresholdOps: Map<string, "EQL" | "EQS" | "NONE">; // The operators used
    actualThresholds: Map<string, number>; // The actual threshold values that were checked against

    // Price movements (for validation signals)
    maxFavorableMove?: number;
    maxAdverseMove?: number;

    // Signal categorization
    category: "SUCCESSFUL" | "HARMLESS" | "HARMFUL";
    categoryReason?: string;

    // Phase assignment
    phaseId?: number;
    isWrongSided?: boolean; // Signal direction vs phase direction mismatch

    // Traditional indicators (if present)
    traditionalIndicators?: {
        vwap: {
            value: number | null;
            passed: boolean;
            reason?: string;
        };
        rsi: {
            value: number | null;
            condition: string;
            passed: boolean;
            reason?: string;
        };
        oir: {
            value: number | null;
            condition: string;
            passed: boolean;
            reason?: string;
        };
        overallDecision: "pass" | "filter" | "insufficient_data";
        filtersTriggered: string[];
    };
}

interface PhaseInfo {
    id: number;
    direction: "UP" | "DOWN";
    startTime: number;
    endTime: number;
    startPrice: number;
    endPrice: number;
    sizePercent: number;

    // Signal breakdown by detector
    detectorCoverage: Map<
        string,
        {
            successfulSignals: Signal[];
            harmfulSignals: Signal[];
            harmlessSignals: Signal[];
        }
    >;

    // Phase classification
    phaseType: "SUCCESSFUL" | "HARMFUL" | "HARMLESS" | "MIXED";
}

interface DetectorOptimization {
    detector: string;
    originalSignals: {
        successful: Signal[];
        harmful: Signal[];
        harmless: Signal[];
    };

    // Phase coverage analysis
    successfulPhases: number[]; // Phases this detector covers with successful signals
    harmfulOnlyPhases: number[]; // Phases this detector only has harmful signals
    harmlessOnlyPhases: number[]; // Phases this detector only has harmless signals

    // Cross-detector coverage protection
    protectedPhases: number[]; // Phases that must maintain coverage from this detector
    dispensablePhases: number[]; // Phases covered by other detectors too

    // Optimization results
    optimalThresholds: Map<string, number>;
    allThresholds: Map<string, { value: number; optimized: boolean }>; // All thresholds including non-optimized
    remainingSignals: {
        successful: Signal[];
        harmful: Signal[];
        harmless: Signal[];
    };

    // Elimination statistics
    eliminationStats: {
        harmfulEliminated: number;
        harmfulKept: number;
        successfulKept: number;
        harmlessKept: number;
    };
}

// Threshold field mappings for extracting from JSON records
const THRESHOLD_FIELD_MAP = {
    absorption: {
        minAggVolume: "thresholdChecks.minAggVolume.calculated",
        passiveAbsorptionThreshold:
            "thresholdChecks.passiveAbsorptionThreshold.calculated",
        priceEfficiencyThreshold:
            "thresholdChecks.priceEfficiencyThreshold.calculated",
        maxPriceImpactRatio: "thresholdChecks.maxPriceImpactRatio.calculated",
        minPassiveMultiplier: "thresholdChecks.minPassiveMultiplier.calculated",
        maxVolumeMultiplierRatio:
            "thresholdChecks.maxVolumeMultiplierRatio.calculated",
        balanceThreshold: "thresholdChecks.balanceThreshold.calculated",
        priceStabilityTicks: "thresholdChecks.priceStabilityTicks.calculated",
    },
    exhaustion: {
        minAggVolume: "thresholdChecks.minAggVolume.calculated",
        exhaustionThreshold: "thresholdChecks.exhaustionThreshold.calculated",
        passiveRatioBalanceThreshold:
            "thresholdChecks.passiveRatioBalanceThreshold.calculated",
    },
    deltacvd: {
        minTradesPerSec: "thresholdChecks.minTradesPerSec.calculated",
        minVolPerSec: "thresholdChecks.minVolPerSec.calculated",
        signalThreshold: "thresholdChecks.signalThreshold.calculated",
        cvdImbalanceThreshold:
            "thresholdChecks.cvdImbalanceThreshold.calculated",
        institutionalThreshold:
            "thresholdChecks.institutionalThreshold.calculated",
        volumeEfficiencyThreshold:
            "thresholdChecks.volumeEfficiencyThreshold.calculated",
    },
};

// Traditional indicator fields for extraction
const TRADITIONAL_INDICATOR_FIELDS = {
    vwapValue: "traditionalIndicators.vwap.value",
    vwapPassed: "traditionalIndicators.vwap.passed",
    rsiValue: "traditionalIndicators.rsi.value",
    rsiPassed: "traditionalIndicators.rsi.passed",
    oirValue: "traditionalIndicators.oir.value",
    oirPassed: "traditionalIndicators.oir.passed",
    traditionalDecision: "traditionalIndicators.overallDecision",
    traditionalFiltersTriggered: "traditionalIndicators.filtersTriggered",
};

function getNestedValue(obj: any, path: string): any {
    return path.split(".").reduce((current, key) => {
        return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
}

/**
 * Load current thresholds from config.json
 */
async function loadCurrentConfig(): Promise<Map<string, Map<string, number>>> {
    const configMap = new Map<string, Map<string, number>>();

    try {
        const configContent = await fs.readFile("config.json", "utf-8");
        const config = JSON.parse(configContent);

        // Extract thresholds for each detector
        const detectorConfigs = {
            absorption: config.symbols?.LTCUSDT?.absorption,
            exhaustion: config.symbols?.LTCUSDT?.exhaustion,
            deltacvd: config.symbols?.LTCUSDT?.deltaCVD,
        };

        // Map config fields to our threshold names
        const configFieldMap = {
            absorption: {
                minAggVolume: "minAggVolume",
                passiveAbsorptionThreshold: "passiveAbsorptionThreshold",
                priceEfficiencyThreshold: "priceEfficiencyThreshold",
                maxPriceImpactRatio: "maxPriceImpactRatio",
                minPassiveMultiplier: "minPassiveMultiplier",
                maxVolumeMultiplierRatio: "maxVolumeMultiplierRatio",
                balanceThreshold: "balanceThreshold",
                priceStabilityTicks: "priceStabilityTicks",
            },
            exhaustion: {
                minAggVolume: "minAggVolume",
                exhaustionThreshold: "exhaustionThreshold",
            },
            deltacvd: {
                minTradesPerSec: "minTradesPerSec",
                minVolPerSec: "minVolPerSec",
                signalThreshold: "signalThreshold",
                cvdImbalanceThreshold: "cvdImbalanceThreshold",
                institutionalThreshold: "institutionalThreshold",
                volumeEfficiencyThreshold: "volumeEfficiencyThreshold",
            },
        };

        for (const [detector, fieldMap] of Object.entries(configFieldMap)) {
            const detectorConfig =
                detectorConfigs[detector as keyof typeof detectorConfigs];
            if (!detectorConfig) continue;

            const thresholds = new Map<string, number>();
            for (const [thresholdName, configField] of Object.entries(
                fieldMap
            )) {
                const value = detectorConfig[configField];
                if (typeof value === "number") {
                    thresholds.set(thresholdName, value);
                }
            }

            if (thresholds.size > 0) {
                configMap.set(detector, thresholds);
            }
        }

        console.log("\n📋 Loaded current config.json thresholds:");
        for (const [detector, thresholds] of configMap) {
            console.log(`   ${detector}:`);
            for (const [name, value] of thresholds) {
                console.log(`     ${name}: ${value}`);
            }
        }
    } catch (error) {
        console.log(
            "\n⚠️ Could not load config.json - will use optimized values only"
        );
    }

    return configMap;
}

/**
 * Load signals from JSON Lines format files
 */
async function loadSignals(date: string): Promise<Signal[]> {
    const signals: Signal[] = [];
    const detectors = ["absorption", "exhaustion", "deltacvd"];
    const logTypes: ("successful" | "validation")[] = [
        "successful",
        "validation",
    ];

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
                            actualThresholds: new Map(),
                            logType: logType,
                            category:
                                logType === "successful"
                                    ? "SUCCESSFUL"
                                    : "HARMFUL", // Will refine later
                        };

                        // Extract threshold values and operators
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

                                // Extract operator
                                const opPath = jsonPath.replace(
                                    ".calculated",
                                    ".op"
                                );
                                const op = getNestedValue(jsonRecord, opPath);
                                if (op && ["EQL", "EQS", "NONE"].includes(op)) {
                                    signal.thresholdOps.set(thresholdName, op);
                                }

                                // Extract actual threshold value that was used
                                const thresholdPath = jsonPath.replace(
                                    ".calculated",
                                    ".threshold"
                                );
                                const thresholdValue = getNestedValue(
                                    jsonRecord,
                                    thresholdPath
                                );
                                if (
                                    typeof thresholdValue === "number" &&
                                    !isNaN(thresholdValue)
                                ) {
                                    signal.actualThresholds.set(
                                        thresholdName,
                                        thresholdValue
                                    );
                                }
                            }
                        }

                        // Extract traditional indicators if present
                        if (jsonRecord.traditionalIndicators) {
                            signal.traditionalIndicators =
                                jsonRecord.traditionalIndicators;

                            // Add traditional indicator values to thresholds map for optimization
                            // This allows us to analyze their distribution alongside other thresholds
                            if (
                                jsonRecord.traditionalIndicators.vwap?.value !==
                                    null &&
                                jsonRecord.traditionalIndicators.vwap?.value !==
                                    undefined
                            ) {
                                signal.thresholds.set(
                                    "vwap",
                                    jsonRecord.traditionalIndicators.vwap.value
                                );
                            }
                            if (
                                jsonRecord.traditionalIndicators.rsi?.value !==
                                    null &&
                                jsonRecord.traditionalIndicators.rsi?.value !==
                                    undefined
                            ) {
                                signal.thresholds.set(
                                    "rsi",
                                    jsonRecord.traditionalIndicators.rsi.value
                                );
                            }
                            if (
                                jsonRecord.traditionalIndicators.oir?.value !==
                                    null &&
                                jsonRecord.traditionalIndicators.oir?.value !==
                                    undefined
                            ) {
                                signal.thresholds.set(
                                    "oir",
                                    jsonRecord.traditionalIndicators.oir.value
                                );
                            }
                        }

                        signals.push(signal);
                    } catch (parseError) {
                        console.warn(`Failed to parse line in ${filePath}`);
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
 * Calculate price movements for validation signals
 */
async function enrichSignalsWithPriceMovements(
    signals: Signal[],
    date: string
): Promise<void> {
    // Load price data from rejection logs
    const priceMap = new Map<number, number>();

    for (const detector of ["absorption", "exhaustion"]) {
        const filePath = `logs/signal_validation/${detector}_rejected_missed_${date}.jsonl`;
        try {
            const content = await fs.readFile(filePath, "utf-8");
            const lines = content.trim().split("\n");

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

    // Calculate movements for validation signals
    for (const signal of signals) {
        if (signal.logType === "successful") {
            signal.maxFavorableMove = TARGET_TP;
            continue;
        }

        const endTime = signal.timestamp + 90 * 60 * 1000; // 90 minutes
        let bestPrice = signal.price;
        let worstPrice = signal.price;

        for (const [timestamp, price] of priceMap) {
            if (timestamp < signal.timestamp || timestamp > endTime) continue;

            if (signal.signalSide === "buy") {
                bestPrice = Math.max(bestPrice, price);
                worstPrice = Math.min(worstPrice, price);
            } else {
                bestPrice = Math.min(bestPrice, price);
                worstPrice = Math.max(worstPrice, price);
            }
        }

        // Calculate movements
        signal.maxFavorableMove =
            Math.abs(bestPrice - signal.price) / signal.price;
        signal.maxAdverseMove =
            Math.abs(worstPrice - signal.price) / signal.price;
    }
}

/**
 * Assign signals to phases and validate directional alignment
 */
function assignSignalsToPhases(
    signals: Signal[],
    pricePhases: PricePhase<Signal>[]
): void {
    let assignedCount = 0;

    for (const signal of signals) {
        // Find the phase this signal belongs to
        for (const phase of pricePhases) {
            if (
                signal.timestamp >= phase.startTime &&
                signal.timestamp <= phase.endTime
            ) {
                signal.phaseId = phase.id;
                assignedCount++;

                // Check if signal is wrong-sided relative to phase direction
                const isWrongSided =
                    (phase.direction === "UP" &&
                        signal.signalSide === "sell") ||
                    (phase.direction === "DOWN" && signal.signalSide === "buy");

                signal.isWrongSided = isWrongSided;
                break;
            }
        }
    }

    console.log(
        `   Assigned ${assignedCount}/${signals.length} signals to phases`
    );

    // Debug: Show phase time ranges and signal timestamps
    console.log(`   Phase time ranges:`);
    for (const phase of pricePhases.slice(0, 3)) {
        const phaseStart = new Date(phase.startTime).toISOString();
        const phaseEnd = new Date(phase.endTime).toISOString();
        console.log(
            `     Phase ${phase.id}: ${phaseStart} → ${phaseEnd} (${phase.direction})`
        );
    }

    // Show some signal timestamps
    const signalTimes = signals.slice(0, 3).map((s) => ({
        detector: s.detectorType,
        time: new Date(s.timestamp).toISOString(),
        phaseId: s.phaseId,
    }));
    console.log(`   Sample signal timestamps:`, signalTimes);
}

interface ClusterAnalysisResult {
    processedSignals: Signal[];
    statistics: {
        totalClusters: number;
        mixedClusters: number;
        reclassifiedSignals: number;
        largestClusterSize: number;
    };
}

/**
 * Analyze signal clusters and select best direction based on quality consensus
 * Handles mixed-direction clusters by comparing quality scores
 */
function analyzeSignalClusters(signals: Signal[]): ClusterAnalysisResult {
    const CLUSTER_WINDOW = 10000; // 10 seconds in milliseconds
    const processedSignals: Signal[] = [];
    const clusters: Signal[][] = [];

    console.log(
        `\n🔍 Analyzing signal clusters (${CLUSTER_WINDOW}ms window)...`
    );

    // Group signals into clusters by time proximity
    signals.sort((a, b) => a.timestamp - b.timestamp);

    for (const signal of signals) {
        // Find existing cluster within time window
        let cluster = clusters.find(
            (c) =>
                c.length > 0 &&
                signal.timestamp - c[c.length - 1].timestamp < CLUSTER_WINDOW
        );

        if (!cluster) {
            cluster = [];
            clusters.push(cluster);
        }
        cluster.push(signal);
    }

    console.log(`   Found ${clusters.length} signal clusters`);

    let mixedClusters = 0;
    let reclassifiedSignals = 0;
    let largestClusterSize = 0;

    // Process each cluster
    for (const cluster of clusters) {
        largestClusterSize = Math.max(largestClusterSize, cluster.length);

        if (cluster.length === 1) {
            // Single signal cluster - keep as-is
            processedSignals.push(cluster[0]);
            continue;
        }

        // Check for mixed directions
        const buySignals = cluster.filter((s) => s.signalSide === "buy");
        const sellSignals = cluster.filter((s) => s.signalSide === "sell");

        if (buySignals.length > 0 && sellSignals.length > 0) {
            // Mixed cluster - resolve using quality consensus
            mixedClusters++;

            // Calculate quality scores for each direction
            const buyQuality = calculateDirectionQuality(buySignals);
            const sellQuality = calculateDirectionQuality(sellSignals);

            console.log(
                `   Mixed cluster at ${new Date(cluster[0].timestamp).toISOString()}: buy(${buySignals.length}, quality=${buyQuality.toFixed(3)}) vs sell(${sellSignals.length}, quality=${sellQuality.toFixed(3)})`
            );

            // Select winning direction
            const winningSide = buyQuality > sellQuality ? "buy" : "sell";
            const winningSignals = cluster.filter(
                (s) => s.signalSide === winningSide
            );
            const losingSignals = cluster.filter(
                (s) => s.signalSide !== winningSide
            );

            // Keep first winning signal, mark rest as harmless duplicates
            if (winningSignals.length > 0) {
                processedSignals.push(winningSignals[0]);

                for (let i = 1; i < winningSignals.length; i++) {
                    winningSignals[i].category = "HARMLESS";
                    winningSignals[i].categoryReason =
                        "Duplicate direction in cluster";
                    processedSignals.push(winningSignals[i]);
                    reclassifiedSignals++;
                }
            }

            // Mark losing direction signals as harmful
            for (const signal of losingSignals) {
                signal.category = "HARMFUL";
                signal.categoryReason = "Lost cluster consensus";
                processedSignals.push(signal);
                reclassifiedSignals++;
            }
        } else {
            // Single direction cluster - keep first, mark rest as harmless
            processedSignals.push(cluster[0]);

            for (let i = 1; i < cluster.length; i++) {
                cluster[i].category = "HARMLESS";
                cluster[i].categoryReason = "Duplicate signal in cluster";
                processedSignals.push(cluster[i]);
                reclassifiedSignals++;
            }
        }
    }

    console.log(`   Resolved ${mixedClusters} mixed-direction clusters`);
    console.log(
        `   Reclassified ${reclassifiedSignals} signals due to clustering`
    );

    return {
        processedSignals,
        statistics: {
            totalClusters: clusters.length,
            mixedClusters,
            reclassifiedSignals,
            largestClusterSize,
        },
    };
}

/**
 * Calculate quality score for a direction within a cluster
 * Uses volume/multiplier ratio for absorption signals
 */
function calculateDirectionQuality(signals: Signal[]): number {
    let totalQuality = 0;

    for (const signal of signals) {
        let quality = 1; // Default quality

        if (signal.detectorType === "absorption") {
            // Use volume/multiplier ratio as quality metric
            const minAggVolume = signal.thresholds.get("minAggVolume");
            const minPassiveMultiplier = signal.thresholds.get(
                "minPassiveMultiplier"
            );

            if (
                minAggVolume &&
                minPassiveMultiplier &&
                minPassiveMultiplier > 0
            ) {
                const ratio = minAggVolume / minPassiveMultiplier;
                // Lower ratio = higher quality (successful signals have ratios 3.5-7.3)
                quality = 1 / Math.max(ratio, 0.1); // Prevent division by zero
            }
        } else {
            // For other detectors, use confidence or default
            // Could be enhanced with detector-specific quality metrics
            quality = 1;
        }

        totalQuality += quality;
    }

    return totalQuality;
}

/**
 * Categorize signals based on their outcomes and phase alignment
 */
function categorizeSignals(signals: Signal[]): void {
    for (const signal of signals) {
        if (signal.logType === "successful") {
            signal.category = "SUCCESSFUL";
            signal.categoryReason = "Reached 0.7%+ profit target";
            continue;
        }

        // For validation signals, determine if harmful or harmless
        const maxAdverse = signal.maxAdverseMove || 0;
        const maxFavorable = signal.maxFavorableMove || 0;

        if (maxAdverse >= STOP_LOSS) {
            signal.category = "HARMFUL";
            signal.categoryReason = `Hit stop loss: ${(maxAdverse * 100).toFixed(2)}%`;

            // Validate that harmful signals are indeed wrong-sided
            if (!signal.isWrongSided && signal.phaseId !== undefined) {
                // Find phase direction for better warning message
                const phaseInfo = `phase ${signal.phaseId} (direction unknown)`;
                console.warn(
                    `WARNING: Harmful signal is not wrong-sided! Signal: ${signal.signalSide} in ${phaseInfo}`
                );
            }
        } else if (maxFavorable >= SMALL_TP_THRESHOLD) {
            signal.category = "HARMLESS";
            signal.categoryReason = `Small profit potential: ${(maxFavorable * 100).toFixed(2)}%`;
        } else if (maxFavorable >= BREAK_EVEN_THRESHOLD) {
            signal.category = "HARMLESS";
            signal.categoryReason = `Break-even potential: ${(maxFavorable * 100).toFixed(2)}%`;
        } else {
            signal.category = "HARMLESS";
            signal.categoryReason = "No significant adverse movement";
        }
    }
}

/**
 * Identify critical signals considering trade flow (1 active trade at a time)
 * Returns set of signal timestamps that are critical for maintaining trading flow
 */
function identifyCriticalSignals(
    signals: Signal[],
    phases: PhaseInfo[]
): Set<number> {
    const criticalSignals = new Set<number>();

    // For each phase, find the first successful signal across all detectors
    for (const phase of phases) {
        let earliestSuccessful: Signal | null = null;
        let earliestTimestamp = Infinity;

        // Check all detectors for this phase
        for (const [detector, coverage] of phase.detectorCoverage) {
            for (const signal of coverage.successfulSignals) {
                if (signal.timestamp < earliestTimestamp) {
                    earliestTimestamp = signal.timestamp;
                    earliestSuccessful = signal;
                }
            }
        }

        // Mark the earliest successful signal as critical
        if (earliestSuccessful) {
            criticalSignals.add(earliestSuccessful.timestamp);
            console.log(
                `   Critical signal in Phase ${phase.id}: ${earliestSuccessful.detectorType} at ${convertToLimaTime(earliestSuccessful.timestamp)}`
            );
        }
    }

    // Also consider trade overlap - if trades are 90 minutes long,
    // we can't take another signal within that window
    const sortedSignals = [...signals]
        .filter((s) => s.category === "SUCCESSFUL")
        .sort((a, b) => a.timestamp - b.timestamp);

    let lastTradeEnd = 0;
    for (const signal of sortedSignals) {
        if (signal.timestamp >= lastTradeEnd) {
            // This signal could be taken (no overlap)
            criticalSignals.add(signal.timestamp);
            lastTradeEnd = signal.timestamp + 90 * 60 * 1000; // 90 minutes trade duration
        }
    }

    console.log(
        `   Identified ${criticalSignals.size} critical signals considering trade flow`
    );
    return criticalSignals;
}

/**
 * Create phase information with detector coverage analysis
 */
function createPhaseInfo(
    signals: Signal[],
    pricePhases: PricePhase<Signal>[]
): PhaseInfo[] {
    const phases: PhaseInfo[] = [];

    for (const pricePhase of pricePhases) {
        const phaseInfo: PhaseInfo = {
            id: pricePhase.id,
            direction: pricePhase.direction,
            startTime: pricePhase.startTime,
            endTime: pricePhase.endTime,
            startPrice: pricePhase.startPrice,
            endPrice: pricePhase.endPrice,
            sizePercent: pricePhase.sizePercent,
            detectorCoverage: new Map(),
            phaseType: "HARMLESS", // Will determine below
        };

        // Get signals in this phase
        const phaseSignals = signals.filter((s) => s.phaseId === pricePhase.id);

        // Group by detector
        const detectors = ["absorption", "exhaustion", "deltacvd"];
        for (const detector of detectors) {
            const detectorSignals = phaseSignals.filter(
                (s) => s.detectorType === detector
            );

            if (detectorSignals.length > 0) {
                phaseInfo.detectorCoverage.set(detector, {
                    successfulSignals: detectorSignals.filter(
                        (s) => s.category === "SUCCESSFUL"
                    ),
                    harmfulSignals: detectorSignals.filter(
                        (s) => s.category === "HARMFUL"
                    ),
                    harmlessSignals: detectorSignals.filter(
                        (s) => s.category === "HARMLESS"
                    ),
                });
            }
        }

        // Determine phase type
        const hasSuccessful = phaseSignals.some(
            (s) => s.category === "SUCCESSFUL"
        );
        const hasHarmful = phaseSignals.some((s) => s.category === "HARMFUL");
        const hasHarmless = phaseSignals.some((s) => s.category === "HARMLESS");

        if (hasSuccessful) {
            phaseInfo.phaseType =
                hasHarmful || hasHarmless ? "MIXED" : "SUCCESSFUL";
        } else if (hasHarmful) {
            phaseInfo.phaseType = hasHarmless ? "MIXED" : "HARMFUL";
        } else if (hasHarmless) {
            phaseInfo.phaseType = "HARMLESS";
        }

        phases.push(phaseInfo);
    }

    return phases;
}

/**
 * Build cross-detector coverage matrix
 */
function buildCoverageMatrix(phases: PhaseInfo[]): Map<number, Set<string>> {
    const coverage = new Map<number, Set<string>>();

    for (const phase of phases) {
        if (phase.phaseType === "SUCCESSFUL" || phase.phaseType === "MIXED") {
            const detectorsWithSuccess = new Set<string>();

            for (const [detector, signals] of phase.detectorCoverage) {
                if (signals.successfulSignals.length > 0) {
                    detectorsWithSuccess.add(detector);
                }
            }

            if (detectorsWithSuccess.size > 0) {
                coverage.set(phase.id, detectorsWithSuccess);
            }
        }
    }

    return coverage;
}

/**
 * Test if a threshold combination preserves required coverage
 */
function testThresholdCombination(
    detector: string,
    thresholds: Map<string, number>,
    signals: Signal[],
    coverageMatrix: Map<number, Set<string>>
): { kept: Signal[]; eliminated: Signal[] } {
    const kept: Signal[] = [];
    const eliminated: Signal[] = [];

    const detectorSignals = signals.filter((s) => s.detectorType === detector);

    for (const signal of detectorSignals) {
        let passes = true;

        // Check if signal passes all thresholds
        for (const [name, requiredValue] of thresholds) {
            const signalValue = signal.thresholds.get(name);
            const operator = signal.thresholdOps.get(name);

            if (signalValue === undefined || operator === "NONE") continue;

            if (operator === "EQL" && signalValue < requiredValue) {
                passes = false;
                break;
            } else if (operator === "EQS" && signalValue > requiredValue) {
                passes = false;
                break;
            }
        }

        if (passes) {
            kept.push(signal);
        } else {
            eliminated.push(signal);
        }
    }

    // Validate that we maintain required coverage
    const keptSuccessful = kept.filter((s) => s.category === "SUCCESSFUL");
    const lostPhases = new Set<number>();

    for (const signal of eliminated) {
        if (signal.category === "SUCCESSFUL" && signal.phaseId) {
            // Check if this phase loses all coverage from this detector
            const remainingSuccessInPhase = keptSuccessful.some(
                (s) => s.phaseId === signal.phaseId
            );
            if (!remainingSuccessInPhase) {
                lostPhases.add(signal.phaseId);
            }
        }
    }

    // Check if lost phases are covered by other detectors
    for (const phaseId of lostPhases) {
        const phaseCoverage = coverageMatrix.get(phaseId);
        if (!phaseCoverage || phaseCoverage.size <= 1) {
            // This phase would lose all coverage - combination is invalid
            return { kept: [], eliminated: [] }; // Invalid combination
        }
    }

    return { kept, eliminated };
}

/**
 * Generate all possible threshold combinations for optimization
 */
function generateThresholdCombinations(
    detector: string,
    signals: Signal[]
): Map<string, number>[] {
    const detectorSignals = signals.filter((s) => s.detectorType === detector);
    const successfulSignals = detectorSignals.filter(
        (s) => s.category === "SUCCESSFUL"
    );
    const harmfulSignals = detectorSignals.filter(
        (s) => s.category === "HARMFUL"
    );

    console.log(
        `     Detector ${detector}: ${successfulSignals.length} successful, ${harmfulSignals.length} harmful signals`
    );

    if (successfulSignals.length === 0 || harmfulSignals.length === 0) {
        console.log(
            `     Skipping ${detector} - need both successful and harmful signals`
        );
        return [];
    }

    const thresholdFields =
        THRESHOLD_FIELD_MAP[detector as keyof typeof THRESHOLD_FIELD_MAP];
    const thresholdNames = Object.keys(thresholdFields);
    const combinations: Map<string, number>[] = [];

    // For each threshold, find values that separate successful from harmful
    const thresholdRanges = new Map<string, number[]>();

    for (const thresholdName of thresholdNames) {
        // Get calculated values (what the signals had)
        const successfulValues = successfulSignals
            .map((s) => s.thresholds.get(thresholdName))
            .filter((v) => v !== undefined) as number[];

        const harmfulValues = harmfulSignals
            .map((s) => s.thresholds.get(thresholdName))
            .filter((v) => v !== undefined) as number[];

        // Get actual threshold values that were used
        const actualThresholdValues = [...successfulSignals, ...harmfulSignals]
            .map((s) => s.actualThresholds.get(thresholdName))
            .filter((v) => v !== undefined) as number[];

        if (successfulValues.length === 0 || harmfulValues.length === 0) {
            console.log(
                `       ${thresholdName}: Skipping - no data (success: ${successfulValues.length}, harmful: ${harmfulValues.length})`
            );
            continue;
        }

        const operator = successfulSignals[0].thresholdOps.get(thresholdName);
        if (operator === "NONE") {
            console.log(`       ${thresholdName}: Skipping - NONE operator`);
            continue;
        }

        // Get the max threshold that was actually used (all signals passed this)
        const maxUsedThreshold =
            actualThresholdValues.length > 0
                ? Math.max(...actualThresholdValues)
                : 0;

        const separatingValues: number[] = [];

        if (operator === "EQL") {
            // For EQL: signal passes if calculated >= threshold
            // All signals in logs have calculated >= threshold
            // To filter harmful: need threshold > some harmful calculated values
            const minSuccessful = Math.min(...successfulValues);
            const maxSuccessful = Math.max(...successfulValues);
            const minHarmful = Math.min(...harmfulValues);
            const maxHarmful = Math.max(...harmfulValues);

            console.log(
                `       ${thresholdName} (EQL): successful range [${minSuccessful.toFixed(4)} - ${maxSuccessful.toFixed(4)}], harmful range [${minHarmful.toFixed(4)} - ${maxHarmful.toFixed(4)}]`
            );
            console.log(
                `       Original threshold used: ${maxUsedThreshold.toFixed(4)}`
            );

            // Generate STRICTER thresholds (higher values for EQL)
            // Start from above the minimum harmful value
            if (minHarmful > minSuccessful) {
                // There's separation - we can filter some harmful without losing successful
                separatingValues.push(
                    minHarmful, // Filter all harmful below this
                    (minSuccessful + minHarmful) / 2, // Middle ground
                    minHarmful * 1.1, // Even stricter
                    minHarmful * 1.25 // More strict
                );
            } else {
                // No clear separation - need to sacrifice some signals
                // Try percentiles of harmful distribution
                const harmfulSorted = [...harmfulValues].sort((a, b) => a - b);
                separatingValues.push(
                    harmfulSorted[Math.floor(harmfulSorted.length * 0.25)], // Filter bottom 25% of harmful
                    harmfulSorted[Math.floor(harmfulSorted.length * 0.5)], // Filter bottom 50% of harmful
                    harmfulSorted[Math.floor(harmfulSorted.length * 0.75)], // Filter bottom 75% of harmful
                    maxHarmful * 1.01 // Filter almost none (baseline)
                );
            }

            // Ensure all values are stricter than what was used
            separatingValues.forEach((val, idx) => {
                if (val <= maxUsedThreshold) {
                    separatingValues[idx] = maxUsedThreshold * 1.01; // At least 1% stricter
                }
            });
        } else if (operator === "EQS") {
            // For EQS: signal passes if calculated <= threshold
            // All signals in logs have calculated <= threshold
            // To filter harmful: need threshold < some harmful calculated values
            const minSuccessful = Math.min(...successfulValues);
            const maxSuccessful = Math.max(...successfulValues);
            const minHarmful = Math.min(...harmfulValues);
            const maxHarmful = Math.max(...harmfulValues);

            console.log(
                `       ${thresholdName} (EQS): successful range [${minSuccessful.toFixed(4)} - ${maxSuccessful.toFixed(4)}], harmful range [${minHarmful.toFixed(4)} - ${maxHarmful.toFixed(4)}]`
            );
            console.log(
                `       Original threshold used: ${maxUsedThreshold.toFixed(4)}`
            );

            // Generate STRICTER thresholds (lower values for EQS)
            // Start from below the maximum harmful value
            if (maxHarmful < maxSuccessful) {
                // There's separation - we can filter some harmful without losing successful
                separatingValues.push(
                    maxHarmful, // Filter all harmful above this
                    (maxSuccessful + maxHarmful) / 2, // Middle ground
                    maxHarmful * 0.9, // Even stricter
                    maxHarmful * 0.75 // More strict
                );
            } else {
                // No clear separation - need to sacrifice some signals
                // Try percentiles of harmful distribution
                const harmfulSorted = [...harmfulValues].sort((a, b) => b - a);
                separatingValues.push(
                    harmfulSorted[Math.floor(harmfulSorted.length * 0.25)], // Filter top 25% of harmful
                    harmfulSorted[Math.floor(harmfulSorted.length * 0.5)], // Filter top 50% of harmful
                    harmfulSorted[Math.floor(harmfulSorted.length * 0.75)], // Filter top 75% of harmful
                    minHarmful * 0.99 // Filter almost none (baseline)
                );
            }

            // Ensure all values are stricter than what was used (for EQS, stricter means lower)
            const minUsedThreshold =
                actualThresholdValues.length > 0
                    ? Math.min(...actualThresholdValues)
                    : Infinity;
            separatingValues.forEach((val, idx) => {
                if (val >= minUsedThreshold) {
                    separatingValues[idx] = minUsedThreshold * 0.99; // At least 1% stricter
                }
            });
        }

        if (separatingValues.length > 0) {
            thresholdRanges.set(thresholdName, separatingValues);
        }
    }

    // Generate combinations of all thresholds that have separating values
    const availableThresholds = Array.from(thresholdRanges.keys());
    if (availableThresholds.length === 0) return [];

    // Generate comprehensive combinations
    console.log(
        `     Available thresholds for combinations: ${availableThresholds.join(", ")}`
    );

    function generateCombinations(
        index: number,
        current: Map<string, number>
    ): void {
        if (index === availableThresholds.length) {
            if (current.size > 0) {
                combinations.push(new Map(current));
            }
            return;
        }

        const thresholdName = availableThresholds[index];
        const values = thresholdRanges.get(thresholdName) || [];

        // Test with each value for this threshold
        for (const value of values) {
            current.set(thresholdName, value);
            generateCombinations(index + 1, current);
            current.delete(thresholdName);
        }

        // Also test without this threshold
        generateCombinations(index + 1, current);
    }

    generateCombinations(0, new Map());

    console.log(
        `     Generated ${combinations.length} threshold combinations to test`
    );
    return combinations;
}

/**
 * Optimize thresholds for a single detector
 */
function optimizeDetector(
    detector: string,
    signals: Signal[],
    phases: PhaseInfo[],
    coverageMatrix: Map<number, Set<string>>,
    currentConfigThresholds?: Map<string, number>
): DetectorOptimization {
    const detectorSignals = signals.filter((s) => s.detectorType === detector);

    const originalSignals = {
        successful: detectorSignals.filter((s) => s.category === "SUCCESSFUL"),
        harmful: detectorSignals.filter((s) => s.category === "HARMFUL"),
        harmless: detectorSignals.filter((s) => s.category === "HARMLESS"),
    };

    // Identify phase types for this detector
    const successfulPhases: number[] = [];
    const harmfulOnlyPhases: number[] = [];
    const harmlessOnlyPhases: number[] = [];

    for (const phase of phases) {
        const coverage = phase.detectorCoverage.get(detector);
        if (!coverage) continue;

        const hasSuccessful = coverage.successfulSignals.length > 0;
        const hasHarmful = coverage.harmfulSignals.length > 0;
        const hasHarmless = coverage.harmlessSignals.length > 0;

        if (hasSuccessful) {
            successfulPhases.push(phase.id);
        } else if (hasHarmful && !hasHarmless) {
            harmfulOnlyPhases.push(phase.id);
        } else if (hasHarmless && !hasHarmful) {
            harmlessOnlyPhases.push(phase.id);
        }
    }

    // Determine protected vs dispensable phases
    const protectedPhases: number[] = [];
    const dispensablePhases: number[] = [];

    for (const phaseId of successfulPhases) {
        const phaseCoverage = coverageMatrix.get(phaseId);
        if (phaseCoverage && phaseCoverage.size > 1) {
            dispensablePhases.push(phaseId); // Other detectors also cover this
        } else {
            protectedPhases.push(phaseId); // Only this detector covers it
        }
    }

    // Generate and test threshold combinations
    const combinations = generateThresholdCombinations(detector, signals);

    let bestCombination = new Map<string, number>();
    let bestHarmfulEliminated = 0;
    let bestRemainingSignals = originalSignals;

    console.log(`\n🎯 ${detector.toUpperCase()} Detector Optimization:`);
    console.log(
        `   Successful phases: ${successfulPhases.join(", ")} (${protectedPhases.length} protected, ${dispensablePhases.length} dispensable)`
    );
    console.log(`   Harmful-only phases: ${harmfulOnlyPhases.join(", ")}`);
    console.log(`   Harmless-only phases: ${harmlessOnlyPhases.join(", ")}`);
    console.log(`   Testing ${combinations.length} threshold combinations...`);

    for (const combination of combinations) {
        const result = testThresholdCombination(
            detector,
            combination,
            signals,
            coverageMatrix
        );

        // Check if combination is valid (returns empty if invalid)
        if (result.kept.length === 0 && result.eliminated.length === 0) {
            continue; // Invalid combination that loses protected phases
        }

        const remainingSuccessful = result.kept.filter(
            (s) => s.category === "SUCCESSFUL"
        );
        const remainingHarmful = result.kept.filter(
            (s) => s.category === "HARMFUL"
        );
        const remainingHarmless = result.kept.filter(
            (s) => s.category === "HARMLESS"
        );
        const eliminatedHarmful = result.eliminated.filter(
            (s) => s.category === "HARMFUL"
        );

        // Check if we maintain at least one successful signal in each protected phase
        const protectedPhasesCovered = protectedPhases.every((phaseId) =>
            remainingSuccessful.some((s) => s.phaseId === phaseId)
        );

        if (!protectedPhasesCovered) continue; // Invalid - loses protected phase

        if (eliminatedHarmful.length > bestHarmfulEliminated) {
            bestHarmfulEliminated = eliminatedHarmful.length;
            bestCombination = combination;
            bestRemainingSignals = {
                successful: remainingSuccessful,
                harmful: remainingHarmful,
                harmless: remainingHarmless,
            };
        }
    }

    console.log(
        `   ✅ Best combination eliminates ${bestHarmfulEliminated}/${originalSignals.harmful.length} harmful signals`
    );

    // Compare with current config and use stricter values
    const finalThresholds = new Map<string, number>(bestCombination);

    if (currentConfigThresholds && currentConfigThresholds.size > 0) {
        console.log(`   📋 Comparing with current config.json thresholds:`);

        for (const [name, optimizedValue] of bestCombination) {
            const currentValue = currentConfigThresholds.get(name);
            if (currentValue !== undefined) {
                const operator = detectorSignals[0]?.thresholdOps.get(name);
                let finalValue = optimizedValue;

                if (operator === "EQL") {
                    // For EQL (>=): stricter means HIGHER value
                    finalValue = Math.max(optimizedValue, currentValue);
                    if (finalValue !== optimizedValue) {
                        console.log(
                            `     ${name}: ${optimizedValue.toFixed(6)} → ${finalValue.toFixed(6)} (using stricter config value)`
                        );
                    }
                } else if (operator === "EQS") {
                    // For EQS (<=): stricter means LOWER value
                    finalValue = Math.min(optimizedValue, currentValue);
                    if (finalValue !== optimizedValue) {
                        console.log(
                            `     ${name}: ${optimizedValue.toFixed(6)} → ${finalValue.toFixed(6)} (using stricter config value)`
                        );
                    }
                }

                finalThresholds.set(name, finalValue);
            }
        }
    }

    if (finalThresholds.size > 0) {
        console.log(
            `   📋 Final thresholds (stricter of optimized and current):`
        );
        for (const [name, value] of finalThresholds) {
            const currentValue = currentConfigThresholds?.get(name);
            const marker = currentValue && value !== currentValue ? " ⚡" : "";
            console.log(`     ${name}: ${value.toFixed(6)}${marker}`);
        }
    } else {
        console.log(
            `   ⚠️ No threshold combination found that preserves protected phases`
        );
    }

    // Re-test with final thresholds if they changed
    let finalRemainingSignals = bestRemainingSignals;
    if (
        finalThresholds.size > 0 &&
        [...finalThresholds.entries()].some(
            ([k, v]) => v !== bestCombination.get(k)
        )
    ) {
        console.log(`   🔄 Re-testing with final stricter thresholds...`);
        const result = testThresholdCombination(
            detector,
            finalThresholds,
            signals,
            coverageMatrix
        );

        finalRemainingSignals = {
            successful: result.kept.filter((s) => s.category === "SUCCESSFUL"),
            harmful: result.kept.filter((s) => s.category === "HARMFUL"),
            harmless: result.kept.filter((s) => s.category === "HARMLESS"),
        };

        console.log(
            `   📊 Final results: ${finalRemainingSignals.harmful.length} harmful kept (eliminated ${originalSignals.harmful.length - finalRemainingSignals.harmful.length})`
        );
    }

    // Create complete threshold map including non-optimized values
    const allThresholds = new Map<
        string,
        { value: number; optimized: boolean }
    >();
    const thresholdFields =
        THRESHOLD_FIELD_MAP[detector as keyof typeof THRESHOLD_FIELD_MAP];

    if (thresholdFields && currentConfigThresholds) {
        // Add all thresholds from config, marking which ones were optimized
        for (const [thresholdName] of Object.entries(thresholdFields)) {
            const optimizedValue = finalThresholds.get(thresholdName);
            const configValue = currentConfigThresholds.get(thresholdName);

            if (optimizedValue !== undefined) {
                // This threshold was optimized
                allThresholds.set(thresholdName, {
                    value: optimizedValue,
                    optimized: true,
                });
            } else if (configValue !== undefined) {
                // Use config value for non-optimized threshold
                allThresholds.set(thresholdName, {
                    value: configValue,
                    optimized: false,
                });
            }
        }
    } else {
        // Just use optimized values if no config available
        for (const [name, value] of finalThresholds) {
            allThresholds.set(name, { value, optimized: true });
        }
    }

    return {
        detector,
        originalSignals,
        successfulPhases,
        harmfulOnlyPhases,
        harmlessOnlyPhases,
        protectedPhases,
        dispensablePhases,
        optimalThresholds: finalThresholds,
        allThresholds,
        remainingSignals: finalRemainingSignals,
        eliminationStats: {
            harmfulEliminated:
                originalSignals.harmful.length -
                finalRemainingSignals.harmful.length,
            harmfulKept: finalRemainingSignals.harmful.length,
            successfulKept: finalRemainingSignals.successful.length,
            harmlessKept: finalRemainingSignals.harmless.length,
        },
    };
}

/**
 * Analyze traditional indicators impact
 */
function analyzeTraditionalIndicators(signals: Signal[]): {
    totalSignals: number;
    withTraditional: number;
    filteredByTraditional: number;
    filterBreakdown: Map<string, number>;
    successfulWithTraditional: number;
    harmfulWithTraditional: number;
    harmlessWithTraditional: number;
    potentialHarmfulFiltered: number;
    potentialSuccessfulLost: number;
} {
    let totalSignals = 0;
    let withTraditional = 0;
    let filteredByTraditional = 0;
    const filterBreakdown = new Map<string, number>();
    let successfulWithTraditional = 0;
    let harmfulWithTraditional = 0;
    let harmlessWithTraditional = 0;
    let potentialHarmfulFiltered = 0;
    let potentialSuccessfulLost = 0;

    for (const signal of signals) {
        totalSignals++;

        if (signal.traditionalIndicators) {
            withTraditional++;

            if (signal.traditionalIndicators.overallDecision === "filter") {
                filteredByTraditional++;

                // Track which filters triggered
                for (const filter of signal.traditionalIndicators
                    .filtersTriggered || []) {
                    filterBreakdown.set(
                        filter,
                        (filterBreakdown.get(filter) || 0) + 1
                    );
                }

                // Track what type of signal would be filtered
                if (signal.category === "HARMFUL") {
                    potentialHarmfulFiltered++;
                } else if (signal.category === "SUCCESSFUL") {
                    potentialSuccessfulLost++;
                }
            } else {
                // Signal passed traditional indicators
                if (signal.category === "SUCCESSFUL") {
                    successfulWithTraditional++;
                } else if (signal.category === "HARMFUL") {
                    harmfulWithTraditional++;
                } else if (signal.category === "HARMLESS") {
                    harmlessWithTraditional++;
                }
            }
        }
    }

    return {
        totalSignals,
        withTraditional,
        filteredByTraditional,
        filterBreakdown,
        successfulWithTraditional,
        harmfulWithTraditional,
        harmlessWithTraditional,
        potentialHarmfulFiltered,
        potentialSuccessfulLost,
    };
}

/**
 * Generate detailed HTML report
 */
async function generateHTMLReport(
    date: string,
    phases: PhaseInfo[],
    optimizations: DetectorOptimization[],
    coverageMatrix: Map<number, Set<string>>,
    clusterStats?: {
        totalClusters: number;
        mixedClusters: number;
        reclassifiedSignals: number;
        largestClusterSize: number;
    },
    signals?: Signal[]
): Promise<void> {
    // Analyze traditional indicators if signals provided
    const traditionalAnalysis = signals
        ? analyzeTraditionalIndicators(signals)
        : null;

    const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Binary Threshold Optimization Report - ${date}</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 20px;
            background-color: #1a1a1a;
            color: #e0e0e0;
            line-height: 1.6;
        }
        .container { max-width: 1400px; margin: 0 auto; }
        h1, h2, h3 {
            color: #4CAF50;
            border-bottom: 2px solid #4CAF50;
            padding-bottom: 10px;
        }
        .phase-section {
            background-color: #2a2a2a;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            border-left: 4px solid #4CAF50;
        }
        .successful { border-left-color: #4CAF50; background-color: #1a4a1a; }
        .harmful { border-left-color: #f44336; background-color: #4a1a1a; }
        .harmless { border-left-color: #FFA726; background-color: #4a4a1a; }
        .mixed { border-left-color: #2196F3; background-color: #1a2a4a; }
        
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 15px 0;
            background-color: #333;
        }
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #555;
        }
        th {
            background-color: #4CAF50;
            color: white;
            font-weight: bold;
        }
        tr:hover { background-color: #444; }
        
        .metric {
            display: inline-block;
            margin: 10px 20px 10px 0;
            padding: 10px 15px;
            background-color: #333;
            border-radius: 5px;
        }
        .metric-label { color: #999; font-size: 0.9em; }
        .metric-value { font-size: 1.3em; font-weight: bold; color: #4CAF50; }
        
        .threshold-config {
            background-color: #333;
            padding: 15px;
            border-radius: 5px;
            margin: 10px 0;
            font-family: 'Courier New', monospace;
        }
        
        .signal-detail {
            font-size: 0.9em;
            background-color: #444;
            padding: 10px;
            margin: 5px 0;
            border-radius: 3px;
        }
        
        .pass { color: #4CAF50; }
        .fail { color: #f44336; }
        .na { color: #999; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎯 Binary Threshold Optimization Report</h1>
        <div class="metric">
            <div class="metric-label">Analysis Date</div>
            <div class="metric-value">${date}</div>
        </div>
        <div class="metric">
            <div class="metric-label">Total Phases</div>
            <div class="metric-value">${phases.length}</div>
        </div>
        <div class="metric">
            <div class="metric-label">Cross-Detector Coverage</div>
            <div class="metric-value">${coverageMatrix.size} phases</div>
        </div>
        ${
            clusterStats
                ? `
        <div class="metric">
            <div class="metric-label">Signal Clusters</div>
            <div class="metric-value">${clusterStats.totalClusters}</div>
        </div>
        <div class="metric">
            <div class="metric-label">Mixed Clusters Resolved</div>
            <div class="metric-value">${clusterStats.mixedClusters}</div>
        </div>
        <div class="metric">
            <div class="metric-label">Signals Reclassified</div>
            <div class="metric-value">${clusterStats.reclassifiedSignals}</div>
        </div>
        <div class="metric">
            <div class="metric-label">Largest Cluster</div>
            <div class="metric-value">${clusterStats.largestClusterSize} signals</div>
        </div>`
                : ""
        }

        ${
            traditionalAnalysis
                ? `
        <h2>📈 Traditional Indicators Analysis</h2>
        <div class="phase-section">
            <div class="metric">
                <div class="metric-label">Total Signals</div>
                <div class="metric-value">${traditionalAnalysis.totalSignals}</div>
            </div>
            <div class="metric">
                <div class="metric-label">With Traditional Indicators</div>
                <div class="metric-value">${traditionalAnalysis.withTraditional} (${Math.round((traditionalAnalysis.withTraditional / traditionalAnalysis.totalSignals) * 100)}%)</div>
            </div>
            <div class="metric">
                <div class="metric-label">Filtered by Traditional</div>
                <div class="metric-value">${traditionalAnalysis.filteredByTraditional} (${Math.round((traditionalAnalysis.filteredByTraditional / (traditionalAnalysis.withTraditional || 1)) * 100)}%)</div>
            </div>
            
            <h4>Filter Breakdown</h4>
            ${
                traditionalAnalysis.filterBreakdown.size > 0
                    ? `<ul>
                ${Array.from(traditionalAnalysis.filterBreakdown.entries())
                    .map(
                        ([filter, count]) =>
                            `<li>${filter}: ${count} signals</li>`
                    )
                    .join("")}
                </ul>`
                    : "<p>No filters triggered</p>"
            }
            
            <h4>Signal Categories (After Traditional Filter)</h4>
            <div class="metric">
                <div class="metric-label">Successful Signals</div>
                <div class="metric-value">${traditionalAnalysis.successfulWithTraditional}</div>
            </div>
            <div class="metric">
                <div class="metric-label">Harmful Signals</div>
                <div class="metric-value">${traditionalAnalysis.harmfulWithTraditional}</div>
            </div>
            <div class="metric">
                <div class="metric-label">Harmless Signals</div>
                <div class="metric-value">${traditionalAnalysis.harmlessWithTraditional}</div>
            </div>
            
            <h4>Traditional Indicators Impact on Optimization</h4>
            ${
                traditionalAnalysis.filteredByTraditional > 0
                    ? `
            <div class="metric">
                <div class="metric-label">Harmful Signals Filtered</div>
                <div class="metric-value">${traditionalAnalysis.potentialHarmfulFiltered} 🎯</div>
            </div>
            <div class="metric">
                <div class="metric-label">Successful Signals Lost</div>
                <div class="metric-value">${traditionalAnalysis.potentialSuccessfulLost} ⚠️</div>
            </div>
            <p><strong>Impact:</strong> Traditional indicators would filter ${traditionalAnalysis.potentialHarmfulFiltered} harmful signals 
            (${Math.round((traditionalAnalysis.potentialHarmfulFiltered / (traditionalAnalysis.harmfulWithTraditional + traditionalAnalysis.potentialHarmfulFiltered)) * 100)}% reduction)
            at the cost of ${traditionalAnalysis.potentialSuccessfulLost} successful signals.</p>
            `
                    : `
            <p><em>Traditional indicators currently not filtering any signals. All signals passing traditional indicator checks.</em></p>
            `
            }
        </div>
        `
                : ""
        }

        <h2>📊 Phase Categorization</h2>
        
        ${phases
            .map((phase) => {
                const coverage = Array.from(
                    phase.detectorCoverage.entries()
                ).filter(
                    ([_, signals]) =>
                        signals.successfulSignals.length > 0 ||
                        signals.harmfulSignals.length > 0 ||
                        signals.harmlessSignals.length > 0
                );

                return `
            <div class="phase-section ${phase.phaseType.toLowerCase()}">
                <h3>Phase ${phase.id} - ${phase.phaseType} (${phase.direction})</h3>
                <div class="metric">
                    <div class="metric-label">Time Range (Lima)</div>
                    <div class="metric-value">${convertToLimaTime(phase.startTime)} → ${convertToLimaTime(phase.endTime)}</div>
                </div>
                <div class="metric">
                    <div class="metric-label">Price Movement</div>
                    <div class="metric-value">$${phase.startPrice.toFixed(2)} → $${phase.endPrice.toFixed(2)} (${(phase.sizePercent * 100).toFixed(2)}%)</div>
                </div>
                
                ${
                    coverage.length > 0
                        ? `
                <table>
                    <tr>
                        <th>Detector</th>
                        <th>Successful</th>
                        <th>Harmful</th>
                        <th>Harmless</th>
                        <th>Wrong-Sided</th>
                    </tr>
                    ${coverage
                        .map(
                            ([detector, signals]) => `
                    <tr>
                        <td><strong>${detector.toUpperCase()}</strong></td>
                        <td class="pass">${signals.successfulSignals.length}</td>
                        <td class="fail">${signals.harmfulSignals.length}</td>
                        <td style="color: #FFA726">${signals.harmlessSignals.length}</td>
                        <td class="fail">${[...signals.harmfulSignals, ...signals.harmlessSignals].filter((s) => s.isWrongSided).length}</td>
                    </tr>
                    `
                        )
                        .join("")}
                </table>
                `
                        : "<p>No signals detected in this phase</p>"
                }
                
                ${
                    coverageMatrix.has(phase.id)
                        ? `
                <p><strong>Cross-detector coverage:</strong> ${Array.from(coverageMatrix.get(phase.id)!).join(", ")}</p>
                `
                        : ""
                }
            </div>
            `;
            })
            .join("")}

        <h2>⚙️ Detector Optimizations</h2>
        
        ${optimizations
            .map(
                (opt) => `
        <div class="phase-section">
            <h3>${opt.detector.toUpperCase()} Detector</h3>
            
            <div class="metric">
                <div class="metric-label">Harmful Eliminated</div>
                <div class="metric-value">${opt.eliminationStats.harmfulEliminated}/${opt.eliminationStats.harmfulEliminated + opt.eliminationStats.harmfulKept} (${Math.round((opt.eliminationStats.harmfulEliminated / (opt.eliminationStats.harmfulEliminated + opt.eliminationStats.harmfulKept || 1)) * 100)}%)</div>
            </div>
            <div class="metric">
                <div class="metric-label">Successful Kept</div>
                <div class="metric-value">${opt.eliminationStats.successfulKept}</div>
            </div>
            <div class="metric">
                <div class="metric-label">Harmless Kept</div>
                <div class="metric-value">${opt.eliminationStats.harmlessKept}</div>
            </div>
            
            <h4>Complete Threshold Configuration</h4>
            <div class="threshold-config">
${Array.from(opt.allThresholds?.entries() || opt.optimalThresholds.entries())
    .map(([name, data]) => {
        if (typeof data === "object" && "value" in data) {
            const marker = data.optimized ? " ⚡" : "";
            return `${name}: ${data.value.toFixed(6)}${marker}`;
        }
    })
    .join("<br>")}
            </div>
            
            <h4>Phase Analysis</h4>
            <p><strong>Protected Phases:</strong> ${opt.protectedPhases.join(", ") || "None"} (must maintain coverage)</p>
            <p><strong>Dispensable Phases:</strong> ${opt.dispensablePhases.join(", ") || "None"} (covered by other detectors)</p>
            <p><strong>Harmful-Only Phases:</strong> ${opt.harmfulOnlyPhases.join(", ") || "None"} (eliminate signals)</p>
            <p><strong>Harmless-Only Phases:</strong> ${opt.harmlessOnlyPhases.join(", ") || "None"} (report only)</p>
            
            <h4>Remaining Signals Detail</h4>
            ${
                opt.remainingSignals.successful.length > 0
                    ? `
            <h5>✅ Successful Signals (${opt.remainingSignals.successful.length})</h5>
            ${opt.remainingSignals.successful
                .slice(0, 10)
                .map(
                    (signal) => `
            <div class="signal-detail">
                <strong>Phase ${signal.phaseId}:</strong> ${new Date(signal.timestamp).toISOString()} | 
                ${signal.signalSide} @ $${signal.price.toFixed(4)} | 
                ${signal.categoryReason}<br>
                <small>Thresholds: ${Array.from(signal.thresholds.entries())
                    .map(([k, v]) => `${k}=${v.toFixed(4)}`)
                    .join(", ")}</small>
            </div>
            `
                )
                .join("")}
            ${opt.remainingSignals.successful.length > 10 ? `<p>... and ${opt.remainingSignals.successful.length - 10} more</p>` : ""}
            `
                    : ""
            }
            
            ${
                opt.remainingSignals.harmful.length > 0
                    ? `
            <h5>🔴 Harmful Signals Remaining (${opt.remainingSignals.harmful.length})</h5>
            ${opt.remainingSignals.harmful
                .slice(0, 5)
                .map(
                    (signal) => `
            <div class="signal-detail">
                <strong>Phase ${signal.phaseId}:</strong> ${new Date(signal.timestamp).toISOString()} | 
                ${signal.signalSide} @ $${signal.price.toFixed(4)} | 
                ${signal.isWrongSided ? "⚠️ Wrong-sided" : ""} | ${signal.categoryReason}<br>
                <small>Thresholds: ${Array.from(signal.thresholds.entries())
                    .map(([k, v]) => `${k}=${v.toFixed(4)}`)
                    .join(", ")}</small>
            </div>
            `
                )
                .join("")}
            ${opt.remainingSignals.harmful.length > 5 ? `<p>... and ${opt.remainingSignals.harmful.length - 5} more</p>` : ""}
            `
                    : ""
            }
            
            ${
                opt.remainingSignals.harmless.length > 0
                    ? `
            <h5>🟡 Harmless Signals (${opt.remainingSignals.harmless.length})</h5>
            <p>Signals that don't hit SL but also don't reach full TP target</p>
            `
                    : ""
            }
        </div>
        `
            )
            .join("")}

        <div style="margin-top: 40px; color: #888; font-size: 12px;">
            <p>Generated: ${new Date().toISOString()}</p>
            <p>Binary optimization: Phase preservation over scoring</p>
            <p>Cross-detector coverage protection enabled</p>
        </div>
    </div>
</body>
</html>`;

    const outputPath = "analysis/reports/threshold_optimization_binary.html";
    await fs.writeFile(outputPath, html, "utf8");
    console.log(`📊 HTML report generated: ${outputPath}`);
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
    const date = process.argv[2] || new Date().toISOString().split("T")[0];

    console.log(`🔍 Binary Threshold Optimization for ${date}`);
    console.log("=".repeat(80));
    console.log("Phase-first approach with cross-detector coverage protection");

    // Load current config.json thresholds
    const currentConfig = await loadCurrentConfig();

    // Load and process signals
    console.log("\n📊 Loading signals...");
    const signals = await loadSignals(date);
    console.log(`   Loaded ${signals.length} signals`);

    // Load price data and create phases
    const priceData = new Map<number, number>();
    // Load price data from rejection logs as before...
    for (const detector of ["absorption", "exhaustion"]) {
        const filePath = `logs/signal_validation/${detector}_rejected_missed_${date}.jsonl`;
        try {
            const content = await fs.readFile(filePath, "utf-8");
            const lines = content.trim().split("\n");

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const jsonRecord = JSON.parse(line);
                    if (jsonRecord.timestamp && jsonRecord.price) {
                        priceData.set(jsonRecord.timestamp, jsonRecord.price);
                    }
                } catch (e) {
                    continue;
                }
            }
        } catch (e) {
            continue;
        }
    }

    const pricePhases = createCompletePricePhases(priceData, signals);
    console.log(`   Created ${pricePhases.length} price phases`);

    // Process signals
    await enrichSignalsWithPriceMovements(signals, date);
    assignSignalsToPhases(signals, pricePhases);

    // Analyze signal clusters and resolve mixed directions
    const clusterResult = analyzeSignalClusters(signals);
    const processedSignals = clusterResult.processedSignals;
    categorizeSignals(processedSignals);

    console.log(
        `   Categorized signals: ${processedSignals.filter((s) => s.category === "SUCCESSFUL").length} successful, ${processedSignals.filter((s) => s.category === "HARMFUL").length} harmful, ${processedSignals.filter((s) => s.category === "HARMLESS").length} harmless`
    );

    // Create phase information and coverage matrix
    const phases = createPhaseInfo(processedSignals, pricePhases);
    const coverageMatrix = buildCoverageMatrix(phases);

    console.log(`\n🎯 Phase Analysis:`);
    console.log(
        `   Successful phases: ${phases.filter((p) => p.phaseType === "SUCCESSFUL" || p.phaseType === "MIXED").length}`
    );
    console.log(
        `   Harmful-only phases: ${phases.filter((p) => p.phaseType === "HARMFUL").length}`
    );
    console.log(
        `   Harmless-only phases: ${phases.filter((p) => p.phaseType === "HARMLESS").length}`
    );
    console.log(`   Cross-detector coverage: ${coverageMatrix.size} phases`);

    // Optimize each detector
    const detectors = ["absorption", "exhaustion", "deltacvd"];
    const optimizations: DetectorOptimization[] = [];

    for (const detector of detectors) {
        const detectorSignals = processedSignals.filter(
            (s) => s.detectorType === detector
        );
        if (detectorSignals.length === 0) continue;

        const optimization = optimizeDetector(
            detector,
            processedSignals,
            phases,
            coverageMatrix,
            currentConfig.get(detector)
        );
        optimizations.push(optimization);
    }

    // Generate HTML report
    console.log("\n📄 Generating detailed HTML report...");
    await generateHTMLReport(
        date,
        phases,
        optimizations,
        coverageMatrix,
        clusterResult.statistics,
        processedSignals // Pass signals for traditional indicator analysis
    );

    console.log("\n" + "=".repeat(80));
    console.log("✅ Binary threshold optimization complete!");
    console.log(
        `📊 Report: analysis/reports/threshold_optimization_binary.html`
    );
}

// Execute
main().catch(console.error);
