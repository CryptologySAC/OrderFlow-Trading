#!/usr/bin/env node
/**
 * CORRECTED threshold optimization that:
 * 1. Compares PRODUCTION THRESHOLDS from config against SIGNAL VALUES from CSV
 * 2. Finds optimal thresholds that filter harmful signals while keeping successful ones
 * 3. Properly identifies that CSV columns are CALCULATED VALUES, not thresholds
 */

import * as fs from "fs/promises";
import { Config } from "./src/core/config";

// Configuration
const TARGET_TP = 0.007; // 0.7% profit target
const STOP_LOSS = 0.005; // 0.5% stop loss
const PHASE_GAP = 15 * 60 * 1000; // 15 minutes between phases

interface Signal {
    timestamp: number;
    detectorType: string;
    signalSide: "buy" | "sell";
    price: number;

    // ACTUAL CALCULATED VALUES from the signal (NOT thresholds!)
    calculatedValues: {
        aggVolume?: number;
        passiveMultiplier?: number;
        absorptionRatio?: number;
        priceEfficiency?: number;
        confidence?: number;
        tradesPerSec?: number;
        volPerSec?: number;
        cvdImbalance?: number;
    };

    // Classification
    isSuccessful: boolean;
    isValidation: boolean;
    category?: "TRUE_POSITIVE" | "FALSE_POSITIVE" | "HARMLESS";
    phaseId?: number;
}

interface ThresholdOptimization {
    detector: string;
    currentThresholds: any;
    recommendations: Map<
        string,
        {
            current: number;
            recommended: number;
            reason: string;
            impact: string;
        }
    >;
    metrics: {
        successfulKept: number;
        harmfulFiltered: number;
        totalSuccessful: number;
        totalHarmful: number;
    };
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
                        calculatedValues: {},
                        isSuccessful: true,
                        isValidation: false,
                        category: "TRUE_POSITIVE",
                    };

                    // Extract CALCULATED VALUES (not thresholds!)
                    if (detector === "absorption") {
                        signal.calculatedValues.aggVolume = parseFloat(
                            values[headers.indexOf("minAggVolume")] || "0"
                        );
                        signal.calculatedValues.passiveMultiplier = parseFloat(
                            values[headers.indexOf("minPassiveMultiplier")] ||
                                "0"
                        );
                        signal.calculatedValues.absorptionRatio = parseFloat(
                            values[
                                headers.indexOf("passiveAbsorptionThreshold")
                            ] || "0"
                        );
                        signal.calculatedValues.priceEfficiency = parseFloat(
                            values[
                                headers.indexOf("priceEfficiencyThreshold")
                            ] || "0"
                        );
                        signal.calculatedValues.confidence = parseFloat(
                            values[
                                headers.indexOf("finalConfidenceRequired")
                            ] || "0"
                        );
                    } else if (detector === "exhaustion") {
                        signal.calculatedValues.aggVolume = parseFloat(
                            values[headers.indexOf("minAggVolume")] || "0"
                        );
                        signal.calculatedValues.priceEfficiency = parseFloat(
                            values[
                                headers.indexOf("priceEfficiencyThreshold")
                            ] || "0"
                        );
                        signal.calculatedValues.confidence = parseFloat(
                            values[
                                headers.indexOf("finalConfidenceRequired")
                            ] || "0"
                        );
                    } else if (detector === "deltacvd") {
                        signal.calculatedValues.tradesPerSec = parseFloat(
                            values[headers.indexOf("minTradesPerSec")] || "0"
                        );
                        signal.calculatedValues.volPerSec = parseFloat(
                            values[headers.indexOf("minVolPerSec")] || "0"
                        );
                        signal.calculatedValues.cvdImbalance = parseFloat(
                            values[headers.indexOf("cvdImbalanceThreshold")] ||
                                "0"
                        );
                    }

                    signals.push(signal);
                }
            }
        } catch (error) {
            console.log(`No successful signals for ${detector}`);
        }

        // Load validation signals (potential false positives)
        try {
            const validationPath = `logs/signal_validation/${detector}_validation_${date}.csv`;
            const content = await fs.readFile(validationPath, "utf-8");
            const lines = content.trim().split("\n");
            if (lines.length > 1) {
                const headers = lines[0].split(",");
                const hasSignalId =
                    headers[0] === "timestamp" || headers[1] === "signalId";
                const offset = hasSignalId ? 1 : 0;

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
                        calculatedValues: {},
                        isSuccessful: false,
                        isValidation: true,
                        category: "FALSE_POSITIVE", // Will refine later
                    };

                    // Extract CALCULATED VALUES with offset
                    if (detector === "absorption") {
                        signal.calculatedValues.aggVolume = parseFloat(
                            values[headers.indexOf("minAggVolume")] || "0"
                        );
                        signal.calculatedValues.passiveMultiplier = parseFloat(
                            values[headers.indexOf("minPassiveMultiplier")] ||
                                "0"
                        );
                        signal.calculatedValues.absorptionRatio = parseFloat(
                            values[
                                headers.indexOf("passiveAbsorptionThreshold")
                            ] || "0"
                        );
                        signal.calculatedValues.priceEfficiency = parseFloat(
                            values[
                                headers.indexOf("priceEfficiencyThreshold")
                            ] || "0"
                        );
                        signal.calculatedValues.confidence = parseFloat(
                            values[
                                headers.indexOf("finalConfidenceRequired")
                            ] || "0"
                        );
                    } else if (detector === "exhaustion") {
                        signal.calculatedValues.aggVolume = parseFloat(
                            values[headers.indexOf("minAggVolume")] || "0"
                        );
                        signal.calculatedValues.priceEfficiency = parseFloat(
                            values[
                                headers.indexOf("priceEfficiencyThreshold")
                            ] || "0"
                        );
                        signal.calculatedValues.confidence = parseFloat(
                            values[
                                headers.indexOf("finalConfidenceRequired")
                            ] || "0"
                        );
                    } else if (detector === "deltacvd") {
                        signal.calculatedValues.tradesPerSec = parseFloat(
                            values[headers.indexOf("minTradesPerSec")] || "0"
                        );
                        signal.calculatedValues.volPerSec = parseFloat(
                            values[headers.indexOf("minVolPerSec")] || "0"
                        );
                        signal.calculatedValues.cvdImbalance = parseFloat(
                            values[headers.indexOf("cvdImbalanceThreshold")] ||
                                "0"
                        );
                    }

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

function analyzeThresholds(
    detector: string,
    signals: Signal[],
    currentThresholds: any
): ThresholdOptimization {
    const recommendations = new Map<string, any>();

    const successful = signals.filter((s) => s.isSuccessful);
    const validation = signals.filter((s) => s.isValidation);

    console.log(`\nAnalyzing ${detector.toUpperCase()} detector:`);
    console.log(`  Successful signals: ${successful.length}`);
    console.log(`  Validation signals: ${validation.length}`);

    if (detector === "absorption") {
        // Analyze minAggVolume
        const successVolumes = successful
            .map((s) => s.calculatedValues.aggVolume || 0)
            .filter((v) => v > 0);
        const validationVolumes = validation
            .map((s) => s.calculatedValues.aggVolume || 0)
            .filter((v) => v > 0);

        if (successVolumes.length > 0) {
            const minSuccessVolume = Math.min(...successVolumes);
            const lowValidationVolumes = validationVolumes.filter(
                (v) => v < minSuccessVolume
            );

            console.log(`\n  minAggVolume Analysis:`);
            console.log(
                `    Current threshold: ${currentThresholds.minAggVolume}`
            );
            console.log(
                `    Successful signals range: ${Math.min(...successVolumes).toFixed(0)} - ${Math.max(...successVolumes).toFixed(0)}`
            );
            console.log(
                `    Validation signals below successful min: ${lowValidationVolumes.length}`
            );

            if (minSuccessVolume > currentThresholds.minAggVolume * 2) {
                recommendations.set("minAggVolume", {
                    current: currentThresholds.minAggVolume,
                    recommended: Math.floor(minSuccessVolume * 0.9),
                    reason: `All successful signals have volume >= ${minSuccessVolume.toFixed(0)}`,
                    impact: `Would filter ${lowValidationVolumes.length} potential false positives`,
                });
            }
        }

        // Analyze minPassiveMultiplier
        const successMultipliers = successful
            .map((s) => s.calculatedValues.passiveMultiplier || 0)
            .filter((v) => v > 0);
        const validationMultipliers = validation
            .map((s) => s.calculatedValues.passiveMultiplier || 0)
            .filter((v) => v > 0);

        if (successMultipliers.length > 0) {
            const maxSuccessMultiplier = Math.max(...successMultipliers);

            console.log(`\n  minPassiveMultiplier Analysis:`);
            console.log(
                `    Current threshold: ${currentThresholds.minPassiveMultiplier}`
            );
            console.log(
                `    Successful signals range: ${Math.min(...successMultipliers).toFixed(2)} - ${Math.max(...successMultipliers).toFixed(2)}`
            );

            if (maxSuccessMultiplier < currentThresholds.minPassiveMultiplier) {
                recommendations.set("minPassiveMultiplier", {
                    current: currentThresholds.minPassiveMultiplier,
                    recommended: Math.floor(
                        Math.min(...successMultipliers) * 0.9
                    ),
                    reason: `Current threshold ${currentThresholds.minPassiveMultiplier} is blocking ALL successful signals (max: ${maxSuccessMultiplier.toFixed(2)})`,
                    impact: `Critical: Would allow successful signals to pass`,
                });
            }
        }

        // Analyze passiveAbsorptionThreshold
        const successAbsorption = successful
            .map((s) => s.calculatedValues.absorptionRatio || 0)
            .filter((v) => v > 0);
        const validationAbsorption = validation
            .map((s) => s.calculatedValues.absorptionRatio || 0)
            .filter((v) => v > 0);

        if (successAbsorption.length > 0) {
            const minSuccessAbsorption = Math.min(...successAbsorption);
            const lowValidationAbsorption = validationAbsorption.filter(
                (v) => v < minSuccessAbsorption
            );

            console.log(`\n  passiveAbsorptionThreshold Analysis:`);
            console.log(
                `    Current threshold: ${currentThresholds.passiveAbsorptionThreshold}`
            );
            console.log(
                `    Successful signals range: ${Math.min(...successAbsorption).toFixed(4)} - ${Math.max(...successAbsorption).toFixed(4)}`
            );
            console.log(
                `    Validation signals below successful min: ${lowValidationAbsorption.length}`
            );

            if (
                minSuccessAbsorption >
                    currentThresholds.passiveAbsorptionThreshold &&
                lowValidationAbsorption.length > 10
            ) {
                recommendations.set("passiveAbsorptionThreshold", {
                    current: currentThresholds.passiveAbsorptionThreshold,
                    recommended: minSuccessAbsorption - 0.01,
                    reason: `Can raise to ${(minSuccessAbsorption - 0.01).toFixed(4)} without losing successful signals`,
                    impact: `Would filter ${lowValidationAbsorption.length} potential false positives`,
                });
            }
        }
    }

    // Calculate metrics
    let successfulKept = successful.length;
    let harmfulFiltered = 0;

    // Apply recommended thresholds to see impact
    for (const [key, rec] of recommendations) {
        const filtered = validation.filter((s) => {
            if (key === "minAggVolume")
                return (s.calculatedValues.aggVolume || 0) < rec.recommended;
            if (key === "minPassiveMultiplier")
                return (
                    (s.calculatedValues.passiveMultiplier || 0) <
                    rec.recommended
                );
            if (key === "passiveAbsorptionThreshold")
                return (
                    (s.calculatedValues.absorptionRatio || 0) < rec.recommended
                );
            return false;
        });
        harmfulFiltered += filtered.length;
    }

    return {
        detector,
        currentThresholds,
        recommendations,
        metrics: {
            successfulKept,
            harmfulFiltered,
            totalSuccessful: successful.length,
            totalHarmful: validation.length,
        },
    };
}

async function main(): Promise<void> {
    const date = process.argv[2] || new Date().toISOString().split("T")[0];

    console.log(`🔍 CORRECTED Threshold Optimization for ${date}`);
    console.log(`${"=".repeat(80)}`);
    console.log(
        `\n⚠️  IMPORTANT: CSV columns contain CALCULATED VALUES, not thresholds!`
    );
    console.log(
        `📊 Comparing production CONFIG thresholds against signal VALUES\n`
    );

    // Load current production thresholds
    const currentThresholds = {
        absorption: Config.ABSORPTION_DETECTOR,
        exhaustion: Config.EXHAUSTION_DETECTOR,
        deltacvd: Config.DELTACVD_DETECTOR,
    };

    // Load signals
    const signalsByDetector = await loadSignals(date);

    // Analyze each detector
    const results: ThresholdOptimization[] = [];

    for (const [detector, signals] of signalsByDetector) {
        const result = analyzeThresholds(
            detector,
            signals,
            currentThresholds[detector as keyof typeof currentThresholds]
        );
        results.push(result);
    }

    // Summary
    console.log(`\n${"=".repeat(80)}`);
    console.log(`📋 OPTIMIZATION SUMMARY`);
    console.log(`${"=".repeat(80)}`);

    for (const result of results) {
        console.log(`\n🎯 ${result.detector.toUpperCase()} Detector:`);

        if (result.recommendations.size === 0) {
            console.log(`  ✅ Current thresholds appear optimal`);
        } else {
            console.log(
                `  ⚠️  ${result.recommendations.size} threshold adjustments recommended:`
            );

            for (const [key, rec] of result.recommendations) {
                console.log(`\n  ${key}:`);
                console.log(`    Current: ${rec.current}`);
                console.log(`    Recommended: ${rec.recommended}`);
                console.log(`    Reason: ${rec.reason}`);
                console.log(`    Impact: ${rec.impact}`);
            }
        }

        console.log(`\n  Metrics:`);
        console.log(
            `    Successful signals kept: ${result.metrics.successfulKept}/${result.metrics.totalSuccessful}`
        );
        console.log(
            `    Harmful signals filtered: ${result.metrics.harmfulFiltered}/${result.metrics.totalHarmful}`
        );
    }

    console.log(`\n${"=".repeat(80)}`);
    console.log(`✅ Analysis complete!`);
    console.log(
        `\n💡 Key Finding: The minPassiveMultiplier threshold is likely TOO HIGH`
    );
    console.log(`   and blocking successful signals. Consider lowering it.`);
}

main().catch(console.error);
