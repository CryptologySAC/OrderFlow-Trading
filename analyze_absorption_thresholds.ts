#!/usr/bin/env node
import * as fs from "fs/promises";

interface AbsorptionSignal {
    timestamp: number;
    price: number;
    signalSide: "buy" | "sell";

    // Configuration parameters at signal time
    minAggVolume: number;
    timeWindowIndex: number;
    eventCooldownMs: number;
    priceEfficiencyThreshold: number;
    maxAbsorptionRatio: number;
    minPassiveMultiplier: number;
    passiveAbsorptionThreshold: number;
    expectedMovementScalingFactor: number;
    liquidityGradientRange: number;
    institutionalVolumeThreshold: number;
    institutionalVolumeRatioThreshold: number;
    enableInstitutionalVolumeFilter: boolean;
    minAbsorptionScore: number;
    finalConfidenceRequired: number;
    maxZoneCountForScoring: number;
    minEnhancedConfidenceThreshold: number;
    useStandardizedZones: boolean;
    enhancementMode: string;
    balanceThreshold: number;
    confluenceMinZones: number;
    confluenceMaxDistance: number;
    confidence: number;

    // Outcomes
    wasValidSignal?: boolean;
    TP_SL?: string;
}

interface ThresholdAnalysis {
    parameter: string;
    successfulMin: number;
    successfulMax: number;
    successfulAvg: number;
    validatedMin: number;
    validatedMax: number;
    validatedAvg: number;
    optimalThreshold: number;
    accuracyWithThreshold: number;
    signalsPassingThreshold: number;
    falsePositivesWithThreshold: number;
}

async function readAbsorptionSignals(
    filePath: string
): Promise<AbsorptionSignal[]> {
    try {
        const content = await fs.readFile(filePath, "utf-8");
        const lines = content.trim().split("\n");
        if (lines.length < 2) return [];

        const headers = lines[0].split(",");
        const signals: AbsorptionSignal[] = [];

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(",");
            if (values.length < headers.length) continue;

            const signal: any = {};
            headers.forEach((header, idx) => {
                const value = values[idx];
                if (
                    header === "enableInstitutionalVolumeFilter" ||
                    header === "useStandardizedZones"
                ) {
                    signal[header] = value === "true";
                } else if (
                    header === "enhancementMode" ||
                    header === "detectorType" ||
                    header === "signalSide" ||
                    header === "TP_SL"
                ) {
                    signal[header] = value;
                } else if (header === "wasValidSignal") {
                    signal[header] = value === "true";
                } else if (value && !isNaN(parseFloat(value))) {
                    signal[header] = parseFloat(value);
                } else if (value && !isNaN(parseInt(value))) {
                    signal[header] = parseInt(value);
                }
            });

            if (signal.timestamp && signal.price) {
                signals.push(signal as AbsorptionSignal);
            }
        }

        return signals;
    } catch (error) {
        console.log(`Could not read file ${filePath}: ${error}`);
        return [];
    }
}

async function analyzeThresholds(): Promise<void> {
    console.log("Loading absorption signals...");

    // Load successful and validated signals
    const successful = await readAbsorptionSignals(
        "logs/signal_validation/absorption_successful_2025-08-12.csv"
    );
    const validated = await readAbsorptionSignals(
        "logs/signal_validation/absorption_validation_2025-08-12.csv"
    );

    console.log(`Loaded ${successful.length} successful signals`);
    console.log(`Loaded ${validated.length} validated signals`);

    // The validated file contains signals that passed validation but haven't been promoted to successful yet
    // We need to exclude the successful signals from validated to get the true "not successful" ones
    const successfulTimestamps = new Set(successful.map((s) => s.timestamp));
    const validatedNotSuccessful = validated.filter(
        (v) => !successfulTimestamps.has(v.timestamp)
    );

    console.log(
        `Validated but not successful: ${validatedNotSuccessful.length} signals`
    );

    // For this analysis, treat all validated-but-not-successful as false positives
    // (since they didn't make it to the successful file after 90 minutes)
    const validatedFailed = validatedNotSuccessful;

    // Key parameters to analyze together
    const keyParams = [
        "minAggVolume",
        "priceEfficiencyThreshold",
        "maxAbsorptionRatio",
        "minPassiveMultiplier",
        "passiveAbsorptionThreshold",
        "finalConfidenceRequired",
    ];

    // Helper function to check if a signal passes ALL thresholds
    function signalPassesThresholds(
        signal: any,
        thresholds: { [key: string]: number }
    ): boolean {
        // Check each threshold
        for (const param of keyParams) {
            const value = signal[param];
            const threshold = thresholds[param];

            if (value === undefined || value === null) return false;

            // Special handling for inverse parameters (lower is better)
            const isInverseParam = param === "priceEfficiencyThreshold";

            if (isInverseParam) {
                if (value > threshold) return false;
            } else {
                if (value < threshold) return false;
            }
        }
        return true;
    }

    // Find the combination of thresholds that maximizes success while minimizing false positives
    console.log("\nSearching for optimal COMBINATION of thresholds...");

    // Start with the boundary values from successful signals
    const successfulBoundaries: {
        [key: string]: { min: number; max: number };
    } = {};
    for (const param of keyParams) {
        const values = successful
            .map((s) => (s as any)[param])
            .filter((v) => v !== undefined && v !== null);
        if (values.length > 0) {
            successfulBoundaries[param] = {
                min: Math.min(...values),
                max: Math.max(...values),
            };
        }
    }

    // Create initial thresholds based on successful signal boundaries
    const optimalThresholds: { [key: string]: number } = {};
    for (const param of keyParams) {
        const isInverseParam = param === "priceEfficiencyThreshold";
        // Use slightly relaxed boundaries to ensure all successful signals pass
        if (isInverseParam) {
            optimalThresholds[param] = successfulBoundaries[param].max * 1.02; // 2% above max
        } else {
            optimalThresholds[param] = successfulBoundaries[param].min * 0.98; // 2% below min
        }
    }

    // Test these thresholds
    let successfulPassing = successful.filter((s) =>
        signalPassesThresholds(s, optimalThresholds)
    ).length;
    let validatedPassing = validated.filter((s) =>
        signalPassesThresholds(s, optimalThresholds)
    ).length;
    let falsePositives = validatedFailed.filter((s) =>
        signalPassesThresholds(s, optimalThresholds)
    ).length;

    console.log("\nOptimal Combined Thresholds:");
    console.log("============================");
    for (const param of keyParams) {
        console.log(`${param}: ${optimalThresholds[param].toFixed(4)}`);
    }
    console.log(`\nResults with combined thresholds:`);
    console.log(
        `Successful signals passing: ${successfulPassing}/${successful.length}`
    );
    console.log(
        `Total validated passing: ${validatedPassing}/${validated.length}`
    );
    console.log(`False positives: ${falsePositives}`);
    console.log(
        `Accuracy: ${((successfulPassing / (successfulPassing + falsePositives)) * 100).toFixed(1)}%`
    );

    // Try to find better thresholds by testing variations
    console.log("\nTrying to optimize further...");

    let bestThresholds = { ...optimalThresholds };
    let bestScore = successfulPassing - falsePositives * 2; // Penalize false positives

    // Test making each threshold more restrictive
    for (const param of keyParams) {
        const testThresholds = { ...bestThresholds };
        const isInverseParam = param === "priceEfficiencyThreshold";

        // Try different multipliers
        const multipliers = [0.5, 0.7, 0.9, 1.1, 1.3, 1.5, 2.0, 3.0];

        for (const mult of multipliers) {
            if (isInverseParam) {
                // For inverse params, lower is more restrictive
                testThresholds[param] =
                    successfulBoundaries[param].max * (2 - mult);
            } else {
                // For normal params, higher is more restrictive
                testThresholds[param] = successfulBoundaries[param].min * mult;
            }

            const testSuccessful = successful.filter((s) =>
                signalPassesThresholds(s, testThresholds)
            ).length;
            const testFalsePositives = validatedFailed.filter((s) =>
                signalPassesThresholds(s, testThresholds)
            ).length;

            // Only consider if we keep most successful signals
            if (testSuccessful >= successful.length * 0.9) {
                const score = testSuccessful - testFalsePositives * 2;
                if (score > bestScore) {
                    bestScore = score;
                    bestThresholds[param] = testThresholds[param];
                }
            }
        }
    }

    // Final results with optimized thresholds
    successfulPassing = successful.filter((s) =>
        signalPassesThresholds(s, bestThresholds)
    ).length;
    falsePositives = validatedFailed.filter((s) =>
        signalPassesThresholds(s, bestThresholds)
    ).length;

    console.log("\n=== FINAL OPTIMIZED COMBINATION ===");
    for (const param of keyParams) {
        console.log(`${param}: ${bestThresholds[param].toFixed(4)}`);
    }
    console.log(`\nFinal Results:`);
    console.log(
        `Successful signals passing: ${successfulPassing}/${successful.length}`
    );
    console.log(`False positives: ${falsePositives}`);
    console.log(
        `Accuracy: ${((successfulPassing / (successfulPassing + falsePositives)) * 100).toFixed(1)}%`
    );

    // Create analysis for each parameter (for the HTML report)
    const analyses: ThresholdAnalysis[] = [];

    for (const param of keyParams) {
        const successValues = successful
            .map((s) => (s as any)[param])
            .filter((v) => v !== undefined && v !== null);
        const validatedValues = validated
            .map((s) => (s as any)[param])
            .filter((v) => v !== undefined && v !== null);

        if (successValues.length === 0) continue;

        analyses.push({
            parameter: param,
            successfulMin: Math.min(...successValues),
            successfulMax: Math.max(...successValues),
            successfulAvg:
                successValues.reduce((a, b) => a + b, 0) / successValues.length,
            validatedMin:
                validatedValues.length > 0 ? Math.min(...validatedValues) : 0,
            validatedMax:
                validatedValues.length > 0 ? Math.max(...validatedValues) : 0,
            validatedAvg:
                validatedValues.length > 0
                    ? validatedValues.reduce((a, b) => a + b, 0) /
                      validatedValues.length
                    : 0,
            optimalThreshold: bestThresholds[param],
            accuracyWithThreshold:
                successfulPassing / (successfulPassing + falsePositives),
            signalsPassingThreshold: successfulPassing,
            falsePositivesWithThreshold: falsePositives,
        });
    }

    // Generate HTML report
    await generateHTMLReport(analyses, successful, validated);

    // Print key findings
    printKeyFindings(analyses, successful.length);
}

async function generateHTMLReport(
    analyses: ThresholdAnalysis[],
    successful: AbsorptionSignal[],
    validated: AbsorptionSignal[]
): Promise<void> {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Absorption Detector - Optimal Threshold Analysis</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 20px;
            background-color: #1a1a1a;
            color: #e0e0e0;
        }
        h1 {
            color: #4CAF50;
            border-bottom: 3px solid #4CAF50;
            padding-bottom: 10px;
        }
        h2 {
            color: #4CAF50;
            margin-top: 30px;
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
            position: sticky;
            top: 0;
        }
        td {
            padding: 10px;
            border-bottom: 1px solid #444;
        }
        tr:hover {
            background-color: #333;
        }
        .good {
            color: #4CAF50;
            font-weight: bold;
        }
        .bad {
            color: #f44336;
            font-weight: bold;
        }
        .neutral {
            color: #ffa726;
        }
        .summary {
            background-color: #2a2a2a;
            padding: 20px;
            border-radius: 5px;
            margin: 20px 0;
            border: 1px solid #444;
        }
        .highlight {
            background-color: #3a3a3a;
            padding: 2px 6px;
            border-radius: 3px;
            font-weight: bold;
        }
        .critical {
            background-color: #4CAF50;
            color: black;
            padding: 2px 6px;
            border-radius: 3px;
            font-weight: bold;
        }
    </style>
</head>
<body>
    <h1>Absorption Detector - Optimal Threshold Analysis</h1>
    
    <div class="summary">
        <h2>Overview</h2>
        <p>Analyzing <strong>${successful.length}</strong> successful signals vs <strong>${validated.length}</strong> validated signals</p>
        <p>Goal: Find optimal thresholds that maximize successful signals while minimizing false positives</p>
    </div>
    
    <h2>Parameter Threshold Analysis</h2>
    <table>
        <tr>
            <th>Parameter</th>
            <th>Successful Range</th>
            <th>Successful Avg</th>
            <th>All Validated Range</th>
            <th>Optimal Threshold</th>
            <th>Accuracy</th>
            <th>Signals Passing</th>
            <th>False Positives</th>
        </tr>
        ${analyses
            .map(
                (a) => `
        <tr>
            <td><strong>${a.parameter}</strong></td>
            <td>${a.successfulMin.toFixed(4)} - ${a.successfulMax.toFixed(4)}</td>
            <td>${a.successfulAvg.toFixed(4)}</td>
            <td>${a.validatedMin.toFixed(4)} - ${a.validatedMax.toFixed(4)}</td>
            <td class="highlight">${a.optimalThreshold.toFixed(4)}</td>
            <td class="${a.accuracyWithThreshold > 0.8 ? "good" : a.accuracyWithThreshold > 0.5 ? "neutral" : "bad"}">
                ${(a.accuracyWithThreshold * 100).toFixed(1)}%
            </td>
            <td class="${a.signalsPassingThreshold === successful.length ? "good" : "neutral"}">
                ${a.signalsPassingThreshold}/${successful.length}
            </td>
            <td class="${a.falsePositivesWithThreshold === 0 ? "good" : a.falsePositivesWithThreshold < 5 ? "neutral" : "bad"}">
                ${a.falsePositivesWithThreshold}
            </td>
        </tr>`
            )
            .join("")}
    </table>
    
    <div class="summary">
        <h2>Key Findings - Best Discriminating Parameters</h2>
        ${generateKeyFindings(analyses, successful.length)}
    </div>
    
    <div class="summary">
        <h2>Recommended Configuration Changes</h2>
        ${generateRecommendations(analyses, successful.length)}
    </div>
    
    <p style="margin-top: 40px; color: #888; font-size: 12px;">
        Generated: ${new Date().toISOString()}<br>
        Data source: absorption_successful and absorption_validation CSV files
    </p>
</body>
</html>`;

    await fs.writeFile("absorption_threshold_analysis.html", html, 'utf8');
    console.log(
        "\n✅ HTML report saved to: absorption_threshold_analysis.html"
    );
}

function generateKeyFindings(
    analyses: ThresholdAnalysis[],
    totalSuccessful: number
): string {
    // Sort by best discriminating power (high accuracy + high signal count)
    const sorted = [...analyses].sort((a, b) => {
        const scoreA =
            a.accuracyWithThreshold *
            (a.signalsPassingThreshold / totalSuccessful);
        const scoreB =
            b.accuracyWithThreshold *
            (b.signalsPassingThreshold / totalSuccessful);
        return scoreB - scoreA;
    });

    const top5 = sorted.slice(0, 5);

    return `
        <h3>Top 5 Most Discriminating Parameters:</h3>
        <ol>
            ${top5
                .map(
                    (a) => `
            <li>
                <strong>${a.parameter}</strong>: 
                Threshold = <span class="critical">${a.optimalThreshold.toFixed(4)}</span>
                (${(a.accuracyWithThreshold * 100).toFixed(1)}% accuracy, 
                ${a.signalsPassingThreshold}/${totalSuccessful} signals pass,
                ${a.falsePositivesWithThreshold} false positives)
            </li>`
                )
                .join("")}
        </ol>
    `;
}

function generateRecommendations(
    analyses: ThresholdAnalysis[],
    totalSuccessful: number
): string {
    const recommendations: string[] = [];

    for (const analysis of analyses) {
        if (
            analysis.accuracyWithThreshold > 0.7 &&
            analysis.signalsPassingThreshold >= totalSuccessful * 0.8
        ) {
            const currentAvg = analysis.successfulAvg;
            const optimal = analysis.optimalThreshold;

            if (Math.abs(currentAvg - optimal) / currentAvg > 0.1) {
                const direction =
                    optimal > currentAvg ? "INCREASE" : "DECREASE";
                recommendations.push(
                    `<li><strong>${direction} ${analysis.parameter}</strong> from avg ${currentAvg.toFixed(4)} to <span class="critical">${optimal.toFixed(4)}</span> 
                    (improves accuracy to ${(analysis.accuracyWithThreshold * 100).toFixed(1)}%)</li>`
                );
            }
        }
    }

    if (recommendations.length === 0) {
        recommendations.push(
            "<li>Current thresholds are reasonably well optimized</li>"
        );
    }

    return `<ul>${recommendations.join("")}</ul>`;
}

function printKeyFindings(
    analyses: ThresholdAnalysis[],
    totalSuccessful: number
): void {
    console.log("\n" + "=".repeat(80));
    console.log("ABSORPTION THRESHOLD OPTIMIZATION ANALYSIS");
    console.log("=".repeat(80));

    // Find parameters with best discrimination
    const sorted = [...analyses].sort((a, b) => {
        const scoreA =
            a.accuracyWithThreshold *
            (a.signalsPassingThreshold / totalSuccessful);
        const scoreB =
            b.accuracyWithThreshold *
            (b.signalsPassingThreshold / totalSuccessful);
        return scoreB - scoreA;
    });

    console.log("\nTOP DISCRIMINATING PARAMETERS:");
    for (let i = 0; i < Math.min(5, sorted.length); i++) {
        const a = sorted[i];
        console.log(`\n${i + 1}. ${a.parameter}:`);
        console.log(`   Optimal Threshold: ${a.optimalThreshold.toFixed(4)}`);
        console.log(
            `   Current Avg in Successful: ${a.successfulAvg.toFixed(4)}`
        );
        console.log(
            `   Accuracy: ${(a.accuracyWithThreshold * 100).toFixed(1)}%`
        );
        console.log(
            `   Signals Passing: ${a.signalsPassingThreshold}/${totalSuccessful}`
        );
        console.log(`   False Positives: ${a.falsePositivesWithThreshold}`);
    }

    console.log("\n" + "=".repeat(80));
}

// Run the analysis
analyzeThresholds().catch(console.error);
