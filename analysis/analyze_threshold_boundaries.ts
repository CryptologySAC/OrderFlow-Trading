#!/usr/bin/env node
/**
 * Analyzes threshold boundaries to find the critical values that separate
 * harmful from harmless signals. This shows you EXACTLY which threshold
 * values act as decision boundaries.
 */

import * as fs from "fs/promises";

// Configuration
const TARGET_TP = 0.007; // 0.7% profit target
const STOP_LOSS = 0.005; // 0.5% stop loss

interface Signal {
    timestamp: number;
    detectorType: string;
    signalSide: "buy" | "sell";
    price: number;
    thresholds: Map<string, number>;
    outcome?: "TP" | "SMALL_TP" | "BE" | "SL" | "NONE";
    category?: "SUCCESSFUL" | "HARMLESS" | "HARMFUL";
}

interface ThresholdCombination {
    thresholds: Map<string, number>;
    // Results when ALL thresholds are applied together
    total: number;
    successful: number;
    harmless: number;
    harmful: number;
    successRate: number;
    harmfulRate: number;
    harmlessRate: number;
    // Quality score
    qualityScore: number;
}

interface ThresholdBoundary {
    thresholdName: string;
    criticalValue: number;
    direction: "below" | "above";
    belowBoundary: {
        total: number;
        successful: number;
        harmless: number;
        harmful: number;
        successRate: number;
        harmfulRate: number;
        harmlessRate: number;
    };
    aboveBoundary: {
        total: number;
        successful: number;
        harmless: number;
        harmful: number;
        successRate: number;
        harmfulRate: number;
        harmlessRate: number;
    };
    separation: number;
}

// Threshold field mappings
const THRESHOLD_FIELD_MAP = {
    absorption: {
        minAggVolume: "thresholdChecks.minAggVolume.calculated",
        priceEfficiencyThreshold:
            "thresholdChecks.priceEfficiencyThreshold.calculated",
        minPassiveMultiplier: "thresholdChecks.minPassiveMultiplier.calculated",
        passiveAbsorptionThreshold:
            "thresholdChecks.passiveAbsorptionThreshold.calculated",
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
    },
};

function getNestedValue(obj: any, path: string): any {
    return path.split(".").reduce((current, key) => {
        return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
}

async function loadSignals(date: string): Promise<Signal[]> {
    const signals: Signal[] = [];
    const detectors = ["absorption", "exhaustion", "deltacvd"];
    const logTypes = ["successful", "validation"]; // ONLY analyze validated and successful signals

    for (const detector of detectors) {
        for (const logType of logTypes) {
            const filePath = `logs/signal_validation/${detector}_${logType}_${date}.jsonl`;
            try {
                const content = await fs.readFile(filePath, "utf-8");
                const lines = content.trim().split("\n");

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

                        // Extract calculated values (what the signal actually had)
                        const thresholdFields =
                            THRESHOLD_FIELD_MAP[
                                detector as keyof typeof THRESHOLD_FIELD_MAP
                            ];
                        if (thresholdFields) {
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
                            }
                        }

                        // Determine outcome based on log type and price movements
                        if (logType === "successful") {
                            signal.outcome = "TP";
                            signal.category = "SUCCESSFUL";
                        } else if (logType === "validation") {
                            // For validation signals, check price movements
                            const favorableMove =
                                jsonRecord.maxFavorableMove || 0;
                            const adverseMove = jsonRecord.maxAdverseMove || 0;

                            if (favorableMove >= TARGET_TP) {
                                signal.outcome = "TP";
                                signal.category = "SUCCESSFUL";
                            } else if (adverseMove >= STOP_LOSS) {
                                signal.outcome = "SL";
                                signal.category = "HARMFUL";
                            } else if (favorableMove >= 0.004) {
                                signal.outcome = "SMALL_TP";
                                signal.category = "HARMLESS";
                            } else if (favorableMove >= 0.002) {
                                signal.outcome = "BE";
                                signal.category = "HARMLESS";
                            } else {
                                signal.outcome = "NONE";
                                signal.category = "HARMFUL";
                            }
                        }

                        signals.push(signal);
                    } catch (parseError) {
                        continue;
                    }
                }
            } catch (error) {
                continue;
            }
        }
    }

    return signals;
}

function analyzeCombination(
    signals: Signal[],
    thresholds: Map<string, number>,
    thresholdComparison: "calculated" | "threshold" = "calculated"
): ThresholdCombination {
    // Filter signals that pass ALL thresholds
    const passing = signals.filter((signal) => {
        for (const [name, requiredValue] of thresholds) {
            const signalValue = signal.thresholds.get(name);
            if (signalValue === undefined) return false;

            // Check if signal meets threshold requirement
            if (name.includes("min") || name.includes("Min")) {
                // For minimum thresholds, signal value must be >= required
                if (signalValue < requiredValue) return false;
            } else if (name.includes("max") || name.includes("Max")) {
                // For maximum thresholds, signal value must be <= required
                if (signalValue > requiredValue) return false;
            } else if (name === "priceEfficiencyThreshold") {
                // For price efficiency, LOWER is better (more efficient)
                // Signal passes if its efficiency <= threshold
                if (signalValue > requiredValue) return false;
            } else {
                // For other thresholds (ratios, etc), signal value must be >= required
                if (signalValue < requiredValue) return false;
            }
        }
        return true;
    });

    const successful = passing.filter(
        (s) => s.category === "SUCCESSFUL"
    ).length;
    const harmless = passing.filter((s) => s.category === "HARMLESS").length;
    const harmful = passing.filter((s) => s.category === "HARMFUL").length;
    const total = passing.length;

    const successRate = total > 0 ? successful / total : 0;
    const harmfulRate = total > 0 ? harmful / total : 0;
    const harmlessRate = total > 0 ? harmless / total : 0;

    // Quality score: High success rate, low harmful rate, with some signals
    const qualityScore =
        successRate * 100 - harmfulRate * 50 + Math.min(total, 50) * 0.5;

    return {
        thresholds,
        total,
        successful,
        harmless,
        harmful,
        successRate,
        harmfulRate,
        harmlessRate,
        qualityScore,
    };
}

function findOptimalCombinations(
    signals: Signal[],
    detectorType: string
): ThresholdCombination[] {
    const results: ThresholdCombination[] = [];

    // Get threshold fields for this detector
    const thresholdFields =
        THRESHOLD_FIELD_MAP[detectorType as keyof typeof THRESHOLD_FIELD_MAP];
    if (!thresholdFields) return results;

    const thresholdNames = Object.keys(thresholdFields);

    // Collect ranges for each threshold
    const thresholdRanges = new Map<string, number[]>();
    for (const name of thresholdNames) {
        const values = signals
            .map((s) => s.thresholds.get(name))
            .filter((v) => v !== undefined) as number[];

        if (values.length > 0) {
            const sorted = [...new Set(values)].sort((a, b) => a - b);
            // Take percentiles: min, 25%, 50%, 75%, max
            const indices = [
                0,
                Math.floor(sorted.length * 0.25),
                Math.floor(sorted.length * 0.5),
                Math.floor(sorted.length * 0.75),
                sorted.length - 1,
            ];
            thresholdRanges.set(
                name,
                indices.map((i) => sorted[i])
            );
        }
    }

    // Generate combinations
    const combinations = generateCombinations(thresholdNames, thresholdRanges);

    // Test each combination
    for (const combo of combinations) {
        const result = analyzeCombination(signals, combo);
        results.push(result);
    }

    // Sort by quality score
    results.sort((a, b) => b.qualityScore - a.qualityScore);

    // Return top 10 combinations
    return results.slice(0, 10);
}

function generateCombinations(
    names: string[],
    ranges: Map<string, number[]>
): Map<string, number>[] {
    const results: Map<string, number>[] = [];

    // Helper to generate all combinations recursively
    function generate(index: number, current: Map<string, number>): void {
        if (index === names.length) {
            if (current.size > 0) {
                results.push(new Map(current));
            }
            return;
        }

        const name = names[index];
        const values = ranges.get(name) || [];

        for (const value of values) {
            current.set(name, value);
            generate(index + 1, current);
        }
    }

    generate(0, new Map());
    return results;
}

function findOptimalBoundaries(
    signals: Signal[],
    thresholdName: string
): ThresholdBoundary {
    // Get all unique values for this threshold
    const values = signals
        .map((s) => s.thresholds.get(thresholdName))
        .filter((v) => v !== undefined) as number[];

    if (values.length === 0) {
        return {
            thresholdName,
            criticalValue: 0,
            direction: "above",
            belowBoundary: {
                total: 0,
                successful: 0,
                harmless: 0,
                harmful: 0,
                successRate: 0,
                harmfulRate: 0,
                harmlessRate: 0,
            },
            aboveBoundary: {
                total: 0,
                successful: 0,
                harmless: 0,
                harmful: 0,
                successRate: 0,
                harmfulRate: 0,
                harmlessRate: 0,
            },
            separation: 0,
        };
    }

    const sorted = [...new Set(values)].sort((a, b) => a - b);
    let bestBoundary: ThresholdBoundary | null = null;
    let bestSeparation = -1;

    // Try each unique value as a potential boundary
    for (const boundary of sorted) {
        const below = signals.filter((s) => {
            const value = s.thresholds.get(thresholdName);
            return value !== undefined && value < boundary;
        });

        const above = signals.filter((s) => {
            const value = s.thresholds.get(thresholdName);
            return value !== undefined && value >= boundary;
        });

        const belowStats = {
            total: below.length,
            successful: below.filter((s) => s.category === "SUCCESSFUL").length,
            harmless: below.filter((s) => s.category === "HARMLESS").length,
            harmful: below.filter((s) => s.category === "HARMFUL").length,
            successRate:
                below.length > 0
                    ? below.filter((s) => s.category === "SUCCESSFUL").length /
                      below.length
                    : 0,
            harmfulRate:
                below.length > 0
                    ? below.filter((s) => s.category === "HARMFUL").length /
                      below.length
                    : 0,
            harmlessRate:
                below.length > 0
                    ? below.filter((s) => s.category === "HARMLESS").length /
                      below.length
                    : 0,
        };

        const aboveStats = {
            total: above.length,
            successful: above.filter((s) => s.category === "SUCCESSFUL").length,
            harmless: above.filter((s) => s.category === "HARMLESS").length,
            harmful: above.filter((s) => s.category === "HARMFUL").length,
            successRate:
                above.length > 0
                    ? above.filter((s) => s.category === "SUCCESSFUL").length /
                      above.length
                    : 0,
            harmfulRate:
                above.length > 0
                    ? above.filter((s) => s.category === "HARMFUL").length /
                      above.length
                    : 0,
            harmlessRate:
                above.length > 0
                    ? above.filter((s) => s.category === "HARMLESS").length /
                      above.length
                    : 0,
        };

        // Calculate separation quality (difference in harmful rates)
        const separation = Math.abs(
            belowStats.harmfulRate - aboveStats.harmfulRate
        );

        // Find boundary that maximizes separation
        if (separation > bestSeparation) {
            bestSeparation = separation;
            const direction =
                belowStats.harmfulRate > aboveStats.harmfulRate
                    ? "below"
                    : "above";

            bestBoundary = {
                thresholdName,
                criticalValue: boundary,
                direction,
                belowBoundary: belowStats,
                aboveBoundary: aboveStats,
                separation,
            };
        }
    }

    return (
        bestBoundary || {
            thresholdName,
            criticalValue: sorted[Math.floor(sorted.length / 2)],
            direction: "above",
            belowBoundary: {
                total: 0,
                successful: 0,
                harmless: 0,
                harmful: 0,
                successRate: 0,
                harmfulRate: 0,
                harmlessRate: 0,
            },
            aboveBoundary: {
                total: signals.length,
                successful: signals.filter((s) => s.category === "SUCCESSFUL")
                    .length,
                harmless: signals.filter((s) => s.category === "HARMLESS")
                    .length,
                harmful: signals.filter((s) => s.category === "HARMFUL").length,
                successRate:
                    signals.filter((s) => s.category === "SUCCESSFUL").length /
                    signals.length,
                harmfulRate:
                    signals.filter((s) => s.category === "HARMFUL").length /
                    signals.length,
                harmlessRate:
                    signals.filter((s) => s.category === "HARMLESS").length /
                    signals.length,
            },
            separation: 0,
        }
    );
}

async function generateCombinationReport(
    combinations: Map<string, ThresholdCombination[]>,
    date: string
): Promise<void> {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Threshold Combination Analysis - ${date}</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 20px;
            background-color: #0d1117;
            color: #c9d1d9;
        }
        h1, h2, h3 {
            color: #58a6ff;
        }
        .detector-section {
            background-color: #161b22;
            border: 1px solid #30363d;
            border-radius: 6px;
            padding: 20px;
            margin: 20px 0;
        }
        .threshold-card {
            background-color: #0d1117;
            border: 1px solid #30363d;
            border-radius: 6px;
            padding: 15px;
            margin: 15px 0;
        }
        .critical-value {
            font-size: 2em;
            font-weight: bold;
            color: #f85149;
            margin: 10px 0;
        }
        .decision-rule {
            background-color: #1f2428;
            border-left: 4px solid #f85149;
            padding: 15px;
            margin: 15px 0;
            font-size: 1.1em;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin: 20px 0;
        }
        .stats-box {
            background-color: #1f2428;
            border: 1px solid #30363d;
            border-radius: 4px;
            padding: 15px;
        }
        .stats-box h4 {
            margin-top: 0;
            color: #8b949e;
        }
        .good { color: #3fb950; }
        .bad { color: #f85149; }
        .neutral { color: #f0883e; }
        .metric {
            display: flex;
            justify-content: space-between;
            margin: 8px 0;
        }
        .metric-label { color: #8b949e; }
        .metric-value { font-weight: bold; }
        .separation-bar {
            height: 30px;
            background: linear-gradient(to right, #f85149 0%, #f85149 var(--harmful-pct), #3fb950 var(--harmful-pct), #3fb950 100%);
            border-radius: 4px;
            margin: 10px 0;
            position: relative;
        }
        .boundary-line {
            position: absolute;
            top: 0;
            bottom: 0;
            width: 2px;
            background: white;
            left: var(--boundary-pos);
        }
        .recommendation {
            background-color: #1f6feb;
            color: white;
            padding: 15px;
            border-radius: 6px;
            margin: 20px 0;
            font-weight: bold;
        }
    </style>
</head>
<body>
    <h1>🎯 Threshold Combination Analysis</h1>
    <p style="color: #8b949e;">This report shows threshold COMBINATIONS and their results when ALL thresholds are applied together</p>
    
    ${Array.from(combinations.entries())
        .map(
            ([detector, combos]) => `
    <div class="detector-section">
        <h2>${detector.toUpperCase()} Detector - Top Threshold Combinations</h2>
        <p style="color: #8b949e;">Showing top ${Math.min(10, combos.length)} combinations when ALL thresholds are applied together</p>
        
        ${combos
            .slice(0, 10)
            .map(
                (combo, idx) => `
            <div class="threshold-card">
                <h3>Combination #${idx + 1} (Score: ${combo.qualityScore.toFixed(1)})</h3>
                
                <div class="decision-rule">
                    📌 <strong>THRESHOLD VALUES:</strong><br>
                    ${Array.from(combo.thresholds.entries())
                        .map(([name, value]) => `${name}: ${value.toFixed(4)}`)
                        .join("<br>")}
                </div>
                
                <div class="stats-grid">
                    <div class="stats-box">
                        <h4>Signals Passing ALL Thresholds</h4>
                        <div class="metric">
                            <span class="metric-label">Total Signals:</span>
                            <span class="metric-value">${combo.total}</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Successful:</span>
                            <span class="metric-value good">${combo.successful} (${(combo.successRate * 100).toFixed(1)}%)</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Harmless:</span>
                            <span class="metric-value neutral">${combo.harmless} (${(combo.harmlessRate * 100).toFixed(1)}%)</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Harmful:</span>
                            <span class="metric-value bad">${combo.harmful} (${(combo.harmfulRate * 100).toFixed(1)}%)</span>
                        </div>
                    </div>
                    
                    <div class="stats-box">
                        <h4>Quality Metrics</h4>
                        <div class="metric">
                            <span class="metric-label">Quality Score:</span>
                            <span class="metric-value score">${combo.qualityScore.toFixed(1)}</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Success Rate:</span>
                            <span class="metric-value ${combo.successRate > 0.5 ? "good" : combo.successRate > 0.25 ? "neutral" : "bad"}">${(combo.successRate * 100).toFixed(1)}%</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Harmful Rate:</span>
                            <span class="metric-value ${combo.harmfulRate < 0.1 ? "good" : combo.harmfulRate < 0.3 ? "neutral" : "bad"}">${(combo.harmfulRate * 100).toFixed(1)}%</span>
                        </div>
                    </div>
                </div>
            </div>
        `
            )
            .join("")}
        
        <div class="recommendation">
            💡 BEST COMBINATION: #1 with ${combos[0]?.successful || 0} successful signals and ${(combos[0]?.harmfulRate * 100 || 0).toFixed(1)}% harmful rate
        </div>
    </div>
    `
        )
        .join("")}
    
    <div style="margin-top: 40px; padding: 20px; background-color: #161b22; border-radius: 6px;">
        <h3>How to Use This Report</h3>
        <ol style="line-height: 1.8;">
            <li><strong>Look at the Critical Value</strong> - This is the threshold that best separates harmful from harmless</li>
            <li><strong>Follow the Decision Rule</strong> - Apply this rule in your config.json</li>
            <li><strong>Check Separation Quality</strong> - Higher % means better separation between harmful/harmless</li>
            <li><strong>Review the Statistics</strong> - See exactly how many signals fall on each side of the boundary</li>
        </ol>
    </div>
    
    <div style="margin-top: 20px; color: #8b949e; font-size: 0.9em;">
        Generated: ${new Date().toISOString()} | Date: ${date}
    </div>
</body>
</html>`;

    const htmlPath = "analysis/reports/threshold_boundary_analysis.html";
    await fs.writeFile(htmlPath, html);
    console.log(`\n📊 Boundary analysis report saved to: ${htmlPath}`);
}

async function analyzeBoundaries(date: string): Promise<void> {
    console.log(`\n🔍 Analyzing threshold combinations for ${date}...\n`);

    // Load signals
    const allSignals = await loadSignals(date);
    console.log(`📊 Loaded ${allSignals.length} signals`);

    const combinations = new Map<string, ThresholdCombination[]>();

    // Analyze each detector
    for (const detector of ["absorption", "exhaustion", "deltacvd"]) {
        const detectorSignals = allSignals.filter(
            (s) => s.detectorType === detector
        );
        if (detectorSignals.length === 0) continue;

        console.log(`\n${"=".repeat(60)}`);
        console.log(
            `📈 ${detector.toUpperCase()} DETECTOR - OPTIMAL COMBINATIONS`
        );
        console.log(`${"=".repeat(60)}`);

        const optimalCombos = findOptimalCombinations(
            detectorSignals,
            detector
        );
        combinations.set(detector, optimalCombos);

        // Display top 3 combinations
        for (let i = 0; i < Math.min(3, optimalCombos.length); i++) {
            const combo = optimalCombos[i];
            console.log(
                `\n🎯 Combination #${i + 1} (Score: ${combo.qualityScore.toFixed(1)}):`
            );
            console.log(`   Thresholds:`);
            for (const [name, value] of combo.thresholds) {
                console.log(`     ${name}: ${value.toFixed(4)}`);
            }
            console.log(`   Results: ${combo.total} signals`);
            console.log(
                `     Successful: ${combo.successful} (${(combo.successRate * 100).toFixed(1)}%)`
            );
            console.log(
                `     Harmless: ${combo.harmless} (${(combo.harmlessRate * 100).toFixed(1)}%)`
            );
            console.log(
                `     Harmful: ${combo.harmful} (${(combo.harmfulRate * 100).toFixed(1)}%)`
            );
        }
    }

    // Generate HTML report
    await generateCombinationReport(combinations, date);

    console.log("\n" + "=".repeat(60));
    console.log("✅ COMBINATION ANALYSIS COMPLETE");
    console.log("=".repeat(60));
    console.log(
        "📊 Report shows optimal threshold combinations for best signal quality"
    );
}

// Main execution
const date = process.argv[2] || new Date().toISOString().split("T")[0];
analyzeBoundaries(date).catch(console.error);
