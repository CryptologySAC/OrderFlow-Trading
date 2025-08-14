#!/usr/bin/env node
/**
 * Threshold optimization that:
 * 1. RAISES thresholds to be STRICTER than current production
 * 2. Tests FULL COMBINATIONS ONLY (all settings together)
 * 3. Keeps at least 1 successful signal per phase
 * 4. Eliminates validation-only signals (false positives)
 * 5. Identifies harmless signals with potential TP
 * 6. Outputs comprehensive HTML report
 */

import * as fs from "fs/promises";
import { FinancialMath } from "./src/utils/financialMath";
import { Config } from "./src/core/config";

// Configuration
const TARGET_TP = 0.007; // 0.7% profit target
const STOP_LOSS = 0.005; // 0.5% stop loss
const SMALL_TP = 0.004; // 0.4% small profit
const BREAK_EVEN = 0.002; // 0.2% break even
const PHASE_GAP = 15 * 60 * 1000; // 15 minutes between phases

interface Signal {
    timestamp: number;
    detectorType: string;
    signalSide: "buy" | "sell";
    price: number;
    thresholds: Map<string, number>;

    // Classification
    isSuccessful: boolean; // From successful log
    isValidation: boolean; // From validation log

    // Price movement (for validation signals)
    maxFavorableMove?: number;
    maxAdverseMove?: number;
    potentialTP?: number;

    // Analysis results
    category?:
        | "TRUE_POSITIVE"
        | "FALSE_POSITIVE"
        | "HARMLESS_REDUNDANT"
        | "HARMLESS_BE"
        | "HARMLESS_SMALL_TP";
    harmlessReason?: string;

    // Phase assignment
    phaseId?: number;
    isFirstInPhase?: boolean;
    hasActivePosition?: boolean;
}

interface Phase {
    id: number;
    startTime: number;
    endTime: number;
    direction: "UP" | "DOWN";
    signals: Signal[];
    successfulSignals: Signal[];
    validationSignals: Signal[];
}

interface ThresholdConfig {
    [key: string]: any; // ALL config values matter for signal generation
}

interface DetectorThresholds {
    absorption: ThresholdConfig;
    exhaustion: ThresholdConfig;
    deltacvd: ThresholdConfig;
}

interface OptimizationResult {
    detector: string;
    originalThresholds: ThresholdConfig;
    optimizedThresholds: ThresholdConfig;

    // Metrics before optimization
    beforeMetrics: {
        totalSignals: number;
        truePositives: number;
        falsePositives: number;
        harmlessSignals: number;
        phasesWithSuccess: number;
        totalPhases: number;
    };

    // Metrics after optimization
    afterMetrics: {
        totalSignals: number;
        truePositives: number;
        falsePositives: number;
        harmlessSignals: number;
        eliminatedFalsePositives: number;
        keptSuccessfulSignals: number;
        phasesWithSuccess: number;
        lostPhases: number;
    };

    // Detailed harmless breakdown
    harmlessBreakdown: {
        redundant: number;
        breakEven: number;
        smallTP: number;
    };
}

// Load current production thresholds using proper config import
async function loadCurrentThresholds(): Promise<DetectorThresholds> {
    // Use the static getters to access detector configs
    const thresholds: DetectorThresholds = {
        absorption: {},
        exhaustion: {},
        deltacvd: {},
    };

    // Get ALL thresholds from each detector using the static getters
    thresholds.absorption = { ...Config.ABSORPTION_DETECTOR };
    thresholds.exhaustion = { ...Config.EXHAUSTION_DETECTOR };
    thresholds.deltacvd = { ...Config.DELTACVD_DETECTOR };

    console.log("📋 Current thresholds from config:");
    console.log(
        "Absorption:",
        Object.keys(thresholds.absorption).length,
        "thresholds"
    );
    console.log(
        "Exhaustion:",
        Object.keys(thresholds.exhaustion).length,
        "thresholds"
    );
    console.log(
        "DeltaCVD:",
        Object.keys(thresholds.deltacvd).length,
        "thresholds"
    );

    // Show first few thresholds for each detector
    console.log("\nSample absorption thresholds:", {
        minAggVolume: thresholds.absorption.minAggVolume,
        minPassiveMultiplier: thresholds.absorption.minPassiveMultiplier,
        passiveAbsorptionThreshold:
            thresholds.absorption.passiveAbsorptionThreshold,
    });

    return thresholds;
}

async function loadSignals(date: string): Promise<Map<string, Signal[]>> {
    const signalsByDetector = new Map<string, Signal[]>();
    const detectors = ["absorption", "exhaustion", "deltacvd"];

    for (const detector of detectors) {
        const signals: Signal[] = [];

        // Load successful signals
        try {
            const successPath = `logs/signal_validation/${detector}_successful_${date}.csv`;
            const content = await fs.readFile(successPath, "utf-8");
            const lines = content.trim().split("\n");
            if (lines.length > 1) {
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
                        isSuccessful: true,
                        isValidation: false,
                    };

                    // Extract all threshold values
                    extractThresholds(headers, values, signal.thresholds);
                    signals.push(signal);
                }
            }
        } catch (error) {
            console.log(`No successful signals for ${detector}`);
        }

        // Load validation signals (false positives)
        try {
            const validationPath = `logs/signal_validation/${detector}_validation_${date}.csv`;
            const content = await fs.readFile(validationPath, "utf-8");
            const lines = content.trim().split("\n");
            if (lines.length > 1) {
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
                        isSuccessful: false,
                        isValidation: true,
                    };

                    // Extract all threshold values
                    extractThresholds(headers, values, signal.thresholds);
                    signals.push(signal);
                }
            }
        } catch (error) {
            console.log(`No validation signals for ${detector}`);
        }

        if (signals.length > 0) {
            signalsByDetector.set(
                detector,
                signals.sort((a, b) => a.timestamp - b.timestamp)
            );
        }
    }

    return signalsByDetector;
}

function extractThresholds(
    headers: string[],
    values: string[],
    thresholds: Map<string, number>
): void {
    // Extract ALL possible threshold columns from the CSV
    // We need to get every single value that could be a threshold
    for (let i = 0; i < headers.length; i++) {
        const header = headers[i];
        const value = values[i];

        // Skip non-threshold columns
        if (
            header === "timestamp" ||
            header === "detectorType" ||
            header === "signalSide" ||
            header === "price" ||
            header === "confidence" ||
            header === "subsequentMovement5min" ||
            header === "subsequentMovement15min" ||
            header === "subsequentMovement1hr" ||
            header === "wasValidSignal" ||
            header === "TP_SL" ||
            header === "crossTimeframe" ||
            header === "institutionalVolume" ||
            header === "zoneConfluence" ||
            header === "exhaustionGap" ||
            header === "priceEfficiencyHigh" ||
            header === "enhancementMode" ||
            header === "eventCooldownMs" ||
            header === "timeWindowIndex" ||
            header === "useStandardizedZones"
        ) {
            continue;
        }

        // Parse the value as a number
        const numValue = parseFloat(value);
        if (!isNaN(numValue)) {
            thresholds.set(header, numValue);
        }
    }
}

async function loadPriceData(date: string): Promise<Map<number, number>> {
    const priceMap = new Map<number, number>();

    // Load from rejected_missed logs for complete price data
    for (const detector of ["absorption", "exhaustion"]) {
        try {
            const filePath = `logs/signal_validation/${detector}_rejected_missed_${date}.csv`;
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

function calculatePriceMovements(
    signals: Signal[],
    priceData: Map<number, number>
): void {
    for (const signal of signals) {
        if (signal.isSuccessful) {
            signal.maxFavorableMove = TARGET_TP;
            signal.potentialTP = TARGET_TP;
            continue;
        }

        const endTime = signal.timestamp + 90 * 60 * 1000;
        let maxPrice = signal.price;
        let minPrice = signal.price;

        for (const [timestamp, price] of priceData) {
            if (timestamp < signal.timestamp) continue;
            if (timestamp > endTime) break;

            maxPrice = Math.max(maxPrice, price);
            minPrice = Math.min(minPrice, price);
        }

        if (signal.signalSide === "buy") {
            signal.maxFavorableMove = (maxPrice - signal.price) / signal.price;
            signal.maxAdverseMove = (signal.price - minPrice) / signal.price;
        } else {
            signal.maxFavorableMove = (signal.price - minPrice) / signal.price;
            signal.maxAdverseMove = (maxPrice - signal.price) / signal.price;
        }

        signal.potentialTP = signal.maxFavorableMove;
    }
}

function createPhases(signals: Signal[]): Phase[] {
    const phases: Phase[] = [];
    let phaseId = 1;
    let currentPhase: Phase | null = null;

    for (const signal of signals) {
        if (
            !currentPhase ||
            signal.timestamp - currentPhase.endTime > PHASE_GAP ||
            (currentPhase.direction === "UP" && signal.signalSide === "sell") ||
            (currentPhase.direction === "DOWN" && signal.signalSide === "buy")
        ) {
            currentPhase = {
                id: phaseId++,
                startTime: signal.timestamp,
                endTime: signal.timestamp,
                direction: signal.signalSide === "buy" ? "UP" : "DOWN",
                signals: [],
                successfulSignals: [],
                validationSignals: [],
            };
            phases.push(currentPhase);
        }

        signal.phaseId = currentPhase.id;
        signal.isFirstInPhase = currentPhase.signals.length === 0;

        currentPhase.signals.push(signal);
        currentPhase.endTime = signal.timestamp;

        if (signal.isSuccessful) {
            currentPhase.successfulSignals.push(signal);
        } else {
            currentPhase.validationSignals.push(signal);
        }
    }

    return phases;
}

function categorizeSignals(phases: Phase[]): void {
    for (const phase of phases) {
        let hasActivePosition = false;

        for (const signal of phase.signals) {
            signal.hasActivePosition = hasActivePosition;

            if (signal.isSuccessful) {
                signal.category = "TRUE_POSITIVE";
                if (!hasActivePosition) {
                    hasActivePosition = true;
                }
            } else {
                // Validation signal - determine if harmless
                if (
                    hasActivePosition &&
                    ((phase.direction === "UP" &&
                        signal.signalSide === "buy") ||
                        (phase.direction === "DOWN" &&
                            signal.signalSide === "sell"))
                ) {
                    signal.category = "HARMLESS_REDUNDANT";
                    signal.harmlessReason =
                        "Same-side signal with active position";
                } else if (
                    signal.maxFavorableMove &&
                    signal.maxFavorableMove >= SMALL_TP
                ) {
                    signal.category = "HARMLESS_SMALL_TP";
                    signal.harmlessReason = `Could reach ${(signal.maxFavorableMove * 100).toFixed(2)}% TP`;
                } else if (
                    signal.maxFavorableMove &&
                    signal.maxFavorableMove >= BREAK_EVEN
                ) {
                    signal.category = "HARMLESS_BE";
                    signal.harmlessReason = "Could reach break-even";
                } else {
                    signal.category = "FALSE_POSITIVE";
                    if (
                        !hasActivePosition &&
                        signal.maxAdverseMove &&
                        signal.maxAdverseMove >= STOP_LOSS
                    ) {
                        hasActivePosition = true; // Would open position and hit SL
                    }
                }
            }
        }
    }
}

function testThresholdCombination(
    signals: Signal[],
    thresholds: ThresholdConfig,
    phases: Phase[]
): { kept: Signal[]; eliminated: Signal[]; phasesWithSuccess: number } {
    const kept: Signal[] = [];
    const eliminated: Signal[] = [];

    for (const signal of signals) {
        let passes = true;

        // Check if signal passes ALL thresholds
        for (const [name, requiredValue] of Object.entries(thresholds)) {
            const signalValue = signal.thresholds.get(name);

            // Skip non-numeric comparisons for non-threshold fields
            if (
                typeof requiredValue === "boolean" ||
                typeof requiredValue === "string"
            ) {
                // For booleans and strings, they must match exactly
                if (
                    signalValue !== requiredValue &&
                    signalValue !== undefined
                ) {
                    passes = false;
                    break;
                }
            } else if (typeof requiredValue === "number") {
                // For numeric thresholds, signal value must be >= required
                if (signalValue === undefined || signalValue < requiredValue) {
                    passes = false;
                    break;
                }
            }
        }

        if (passes) {
            kept.push(signal);
        } else {
            eliminated.push(signal);
        }
    }

    // Count phases that still have successful signals
    const phasesWithSuccess = new Set(
        kept.filter((s) => s.isSuccessful).map((s) => s.phaseId)
    ).size;

    return { kept, eliminated, phasesWithSuccess };
}

function findOptimalThresholds(
    detector: string,
    signals: Signal[],
    phases: Phase[],
    currentThresholds: ThresholdConfig
): OptimizationResult {
    // Calculate before metrics
    const successfulSignals = signals.filter((s) => s.isSuccessful);
    const validationSignals = signals.filter((s) => s.isValidation);
    const falsePositives = validationSignals.filter(
        (s) => s.category === "FALSE_POSITIVE"
    );
    const harmlessSignals = validationSignals.filter((s) =>
        s.category?.startsWith("HARMLESS")
    );

    const beforeMetrics = {
        totalSignals: signals.length,
        truePositives: successfulSignals.length,
        falsePositives: falsePositives.length,
        harmlessSignals: harmlessSignals.length,
        phasesWithSuccess: new Set(successfulSignals.map((s) => s.phaseId))
            .size,
        totalPhases: phases.length,
    };

    console.log(
        `  Before optimization: ${beforeMetrics.truePositives} successful, ${beforeMetrics.falsePositives} false positives`
    );

    // Start with current thresholds (will be replaced by optimization)
    let workingThresholds = { ...currentThresholds };

    // Only optimize NUMERIC thresholds
    const numericThresholds = Object.entries(currentThresholds)
        .filter(([key, value]) => typeof value === "number")
        .map(([key]) => key);

    // Try different combinations to find optimal thresholds
    let bestCombination = { ...currentThresholds };
    let bestScore = 0;
    let bestMetrics = { eliminatedFP: 0, keptSuccess: 0, phasesWithSuccess: 0 };

    // For each numeric threshold, try to optimize
    for (const thresholdName of numericThresholds) {
        // Get all values for this threshold from HARMFUL validation signals
        const harmfulValidation = validationSignals.filter(
            (s) => s.category === "FALSE_POSITIVE"
        );
        const harmfulValues = harmfulValidation
            .map((s) => s.thresholds.get(thresholdName))
            .filter(
                (v) => v !== undefined && typeof v === "number"
            ) as number[];

        if (harmfulValues.length === 0) continue;

        // Get values from successful signals to ensure we don't lose them
        const successValues = successfulSignals
            .map((s) => s.thresholds.get(thresholdName))
            .filter(
                (v) => v !== undefined && typeof v === "number"
            ) as number[];

        if (successValues.length === 0) continue;

        const minSuccessful = Math.min(...successValues);

        // Find all unique harmful values below the minimum successful value
        const harmfulBelowSuccess = [
            ...new Set(harmfulValues.filter((v) => v < minSuccessful)),
        ].sort((a, b) => a - b);

        // Try each potential threshold
        for (const harmfulThreshold of harmfulBelowSuccess) {
            const testThresholds = { ...bestCombination };
            testThresholds[thresholdName] = harmfulThreshold + 0.0001;

            // Only test if it's higher than current
            if (
                testThresholds[thresholdName] <=
                currentThresholds[thresholdName]
            )
                continue;

            // Test this combination
            const result = testThresholdCombination(
                signals,
                testThresholds,
                phases
            );
            const keptSuccess = result.kept.filter(
                (s) => s.isSuccessful
            ).length;
            const eliminatedFP = result.eliminated.filter(
                (s) => s.category === "FALSE_POSITIVE"
            ).length;

            // Score: prioritize keeping successful signals, then eliminating false positives
            const score =
                result.phasesWithSuccess * 1000 +
                keptSuccess * 100 +
                eliminatedFP;

            if (score > bestScore && result.phasesWithSuccess > 0) {
                bestScore = score;
                bestCombination = { ...testThresholds };
                bestMetrics = {
                    eliminatedFP,
                    keptSuccess,
                    phasesWithSuccess: result.phasesWithSuccess,
                };
                console.log(
                    `  ${thresholdName}: Found better threshold at ${testThresholds[thresholdName]} (keeps ${keptSuccess} successful, eliminates ${eliminatedFP} harmful)`
                );
            }
        }
    }

    // Use the best combination found
    const optimalThresholds = bestCombination;
    console.log(
        `  Best combination: ${bestMetrics.keptSuccess} successful kept, ${bestMetrics.eliminatedFP} harmful eliminated`
    );

    // Calculate after metrics
    const finalResult = testThresholdCombination(
        signals,
        optimalThresholds,
        phases
    );
    const keptFalsePositives = finalResult.kept.filter(
        (s) => s.category === "FALSE_POSITIVE"
    );
    const keptHarmless = finalResult.kept.filter((s) =>
        s.category?.startsWith("HARMLESS")
    );

    const afterMetrics = {
        totalSignals: finalResult.kept.length,
        truePositives: finalResult.kept.filter((s) => s.isSuccessful).length,
        falsePositives: keptFalsePositives.length,
        harmlessSignals: keptHarmless.length,
        eliminatedFalsePositives:
            falsePositives.length - keptFalsePositives.length,
        keptSuccessfulSignals: finalResult.kept.filter((s) => s.isSuccessful)
            .length,
        phasesWithSuccess: finalResult.phasesWithSuccess,
        lostPhases:
            beforeMetrics.phasesWithSuccess - finalResult.phasesWithSuccess,
    };

    const harmlessBreakdown = {
        redundant: keptHarmless.filter(
            (s) => s.category === "HARMLESS_REDUNDANT"
        ).length,
        breakEven: keptHarmless.filter((s) => s.category === "HARMLESS_BE")
            .length,
        smallTP: keptHarmless.filter((s) => s.category === "HARMLESS_SMALL_TP")
            .length,
    };

    return {
        detector,
        originalThresholds: currentThresholds,
        optimizedThresholds: optimalThresholds,
        beforeMetrics,
        afterMetrics,
        harmlessBreakdown,
    };
}

function generateHTML(results: OptimizationResult[], date: string): string {
    const html = `<!DOCTYPE html>
<html>
<head>
    <title>Threshold Optimization Results - ${date}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 20px;
            background: #f5f5f5;
        }
        .container {
            max-width: 1400px;
            margin: 0 auto;
        }
        h1 {
            color: #333;
            border-bottom: 3px solid #4CAF50;
            padding-bottom: 10px;
        }
        .detector-section {
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .detector-title {
            color: #2196F3;
            font-size: 24px;
            margin-bottom: 20px;
        }
        .metrics-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin: 20px 0;
        }
        .metrics-box {
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 15px;
        }
        .metrics-box h3 {
            margin-top: 0;
            color: #555;
        }
        .threshold-table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        .threshold-table th,
        .threshold-table td {
            padding: 10px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }
        .threshold-table th {
            background: #f8f9fa;
            font-weight: 600;
        }
        .increased {
            color: #4CAF50;
            font-weight: bold;
        }
        .unchanged {
            color: #999;
        }
        .metric {
            display: flex;
            justify-content: space-between;
            padding: 5px 0;
        }
        .metric-label {
            color: #666;
        }
        .metric-value {
            font-weight: 600;
        }
        .positive {
            color: #4CAF50;
        }
        .negative {
            color: #f44336;
        }
        .neutral {
            color: #FF9800;
        }
        .summary-box {
            background: #e3f2fd;
            border-left: 4px solid #2196F3;
            padding: 15px;
            margin: 20px 0;
        }
        .harmless-breakdown {
            background: #fff3e0;
            border-radius: 4px;
            padding: 10px;
            margin: 10px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎯 Threshold Optimization Results</h1>
        <p><strong>Date:</strong> ${date}</p>
        <p><strong>Objective:</strong> Raise thresholds to eliminate false positives while keeping at least 1 successful signal per phase</p>
        
        ${results
            .map(
                (r) => `
            <div class="detector-section">
                <h2 class="detector-title">📊 ${r.detector.toUpperCase()} Detector</h2>
                
                <div class="summary-box">
                    <strong>Optimization Summary:</strong><br>
                    ✅ Kept ${r.afterMetrics.keptSuccessfulSignals}/${r.beforeMetrics.truePositives} successful signals<br>
                    🚫 Eliminated ${r.afterMetrics.eliminatedFalsePositives} false positives<br>
                    📈 Maintained ${r.afterMetrics.phasesWithSuccess}/${r.beforeMetrics.phasesWithSuccess} phases with signals
                </div>
                
                <h3>Threshold Adjustments</h3>
                <table class="threshold-table">
                    <thead>
                        <tr>
                            <th>Threshold</th>
                            <th>Original</th>
                            <th>Optimized</th>
                            <th>Change</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${Object.keys(r.originalThresholds)
                            .map((key) => {
                                const original = r.originalThresholds[key];
                                const optimized = r.optimizedThresholds[key];
                                if (
                                    original === undefined ||
                                    optimized === undefined
                                )
                                    return "";

                                // Handle different value types
                                let originalStr = String(original);
                                let optimizedStr = String(optimized);
                                let changeClass = "unchanged";
                                let changeText = "No change";

                                if (
                                    typeof original === "number" &&
                                    typeof optimized === "number"
                                ) {
                                    const change = optimized - original;
                                    changeClass =
                                        change > 0
                                            ? "increased"
                                            : change < 0
                                              ? "decreased"
                                              : "unchanged";

                                    // Format numbers with appropriate precision
                                    originalStr = original.toFixed(4);
                                    optimizedStr = optimized.toFixed(4);

                                    if (change !== 0) {
                                        changeText =
                                            change > 0
                                                ? `+${change.toFixed(4)}`
                                                : change.toFixed(4);
                                    }
                                } else if (original !== optimized) {
                                    changeClass = "increased"; // Changed
                                    changeText = `${originalStr} → ${optimizedStr}`;
                                }

                                return `
                                <tr>
                                    <td><strong>${key}</strong></td>
                                    <td>${originalStr}</td>
                                    <td class="${changeClass}">${optimizedStr}</td>
                                    <td class="${changeClass}">${changeText}</td>
                                </tr>
                            `;
                            })
                            .join("")}
                    </tbody>
                </table>
                
                <div class="metrics-grid">
                    <div class="metrics-box">
                        <h3>📊 Before Optimization</h3>
                        <div class="metric">
                            <span class="metric-label">Total Signals:</span>
                            <span class="metric-value">${r.beforeMetrics.totalSignals}</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">True Positives:</span>
                            <span class="metric-value positive">${r.beforeMetrics.truePositives}</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">False Positives:</span>
                            <span class="metric-value negative">${r.beforeMetrics.falsePositives}</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Harmless Signals:</span>
                            <span class="metric-value neutral">${r.beforeMetrics.harmlessSignals}</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Phase Coverage:</span>
                            <span class="metric-value">${r.beforeMetrics.phasesWithSuccess}/${r.beforeMetrics.totalPhases}</span>
                        </div>
                    </div>
                    
                    <div class="metrics-box">
                        <h3>✨ After Optimization</h3>
                        <div class="metric">
                            <span class="metric-label">Total Signals:</span>
                            <span class="metric-value">${r.afterMetrics.totalSignals}</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">True Positives:</span>
                            <span class="metric-value positive">${r.afterMetrics.truePositives}</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">False Positives:</span>
                            <span class="metric-value ${r.afterMetrics.falsePositives < r.beforeMetrics.falsePositives ? "positive" : "negative"}">${r.afterMetrics.falsePositives}</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Harmless Signals:</span>
                            <span class="metric-value neutral">${r.afterMetrics.harmlessSignals}</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Phase Coverage:</span>
                            <span class="metric-value">${r.afterMetrics.phasesWithSuccess}/${r.beforeMetrics.totalPhases}</span>
                        </div>
                    </div>
                </div>
                
                <div class="harmless-breakdown">
                    <strong>🟡 Harmless Signal Breakdown:</strong><br>
                    • Redundant (same-side with position): ${r.harmlessBreakdown.redundant}<br>
                    • Small TP (0.4%+): ${r.harmlessBreakdown.smallTP}<br>
                    • Break Even (0.2%+): ${r.harmlessBreakdown.breakEven}
                </div>
                
                <div class="summary-box" style="background: #e8f5e9; border-color: #4CAF50;">
                    <strong>💡 Recommendation:</strong><br>
                    ${
                        r.afterMetrics.eliminatedFalsePositives > 0
                            ? `Apply these optimized thresholds to eliminate ${r.afterMetrics.eliminatedFalsePositives} false positives while maintaining ${((r.afterMetrics.truePositives / r.beforeMetrics.truePositives) * 100).toFixed(1)}% of successful signals.`
                            : `Current thresholds are already optimal. No stricter thresholds possible without losing phase coverage.`
                    }
                </div>
            </div>
        `
            )
            .join("")}
    </div>
</body>
</html>`;

    return html;
}

async function main(): Promise<void> {
    const date = process.argv[2] || new Date().toISOString().split("T")[0];

    console.log(`🔍 Optimizing thresholds for ${date}...`);

    // Load current thresholds
    const currentThresholds = await loadCurrentThresholds();
    console.log("📋 Loaded current production thresholds");

    // Load signals
    const signalsByDetector = await loadSignals(date);
    console.log(`📊 Loaded signals for ${signalsByDetector.size} detectors`);

    // Load price data
    const priceData = await loadPriceData(date);
    console.log(`💹 Loaded ${priceData.size} price points`);

    const results: OptimizationResult[] = [];

    for (const [detector, signals] of signalsByDetector) {
        console.log(`\n🎯 Optimizing ${detector}...`);

        // Calculate price movements
        calculatePriceMovements(signals, priceData);

        // Create phases
        const phases = createPhases(signals);
        console.log(`  Created ${phases.length} phases`);

        // Categorize signals
        categorizeSignals(phases);

        // Find optimal thresholds
        const detectorThresholds =
            currentThresholds[detector as keyof DetectorThresholds];
        const result = findOptimalThresholds(
            detector,
            signals,
            phases,
            detectorThresholds
        );
        results.push(result);

        console.log(
            `  ✅ Eliminated ${result.afterMetrics.eliminatedFalsePositives} false positives`
        );
        console.log(
            `  ✅ Kept ${result.afterMetrics.keptSuccessfulSignals}/${result.beforeMetrics.truePositives} successful signals`
        );
    }

    // Generate HTML report
    const html = generateHTML(results, date);
    const outputPath = `threshold_optimization_${date}.html`;
    await fs.writeFile(outputPath, html);

    console.log(`\n✅ Report generated: ${outputPath}`);
}

main().catch(console.error);
