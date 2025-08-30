#!/usr/bin/env node
import * as fs from "fs/promises";

interface AbsorptionSignal {
    timestamp: number;
    price: number;
    signalSide: "buy" | "sell";

    // Key parameters we identified as most discriminating
    minAggVolume: number;
    priceEfficiencyThreshold: number;
    maxAbsorptionRatio: number;
    minPassiveMultiplier: number;
    passiveAbsorptionThreshold: number;
    finalConfidenceRequired: number;
    confidence: number;

    // Outcome
    wasValidSignal?: boolean;
    TP_SL?: string;
    subsequentMovement1hr?: number;
}

interface RecommendedThresholds {
    minAggVolume: number;
    priceEfficiencyThreshold: number;
    maxAbsorptionRatio: number;
    minPassiveMultiplier: number;
    passiveAbsorptionThreshold: number;
    finalConfidenceRequired: number;
}

// Thresholds from corrected analysis that should give 1 false positive
const RECOMMENDED_THRESHOLDS: RecommendedThresholds = {
    minAggVolume: 1628.8766, // From corrected analysis
    priceEfficiencyThreshold: 0.0046, // From corrected analysis
    maxAbsorptionRatio: 0.7009, // From corrected analysis
    minPassiveMultiplier: 2.4608, // From corrected analysis
    passiveAbsorptionThreshold: 2.4608, // From corrected analysis
    finalConfidenceRequired: 0.6084, // From corrected analysis
};

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
                if (header === "signalSide" || header === "TP_SL") {
                    signal[header] = value;
                } else if (header === "wasValidSignal") {
                    signal[header] = value === "true";
                } else if (value && !isNaN(parseFloat(value))) {
                    signal[header] = parseFloat(value);
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

function wouldSignalPass(
    signal: AbsorptionSignal,
    thresholds: RecommendedThresholds
): boolean {
    // Check each threshold
    const checks = {
        minAggVolume: signal.minAggVolume >= thresholds.minAggVolume,
        priceEfficiency:
            signal.priceEfficiencyThreshold <=
            thresholds.priceEfficiencyThreshold,
        maxAbsorptionRatio:
            signal.maxAbsorptionRatio >= thresholds.maxAbsorptionRatio,
        minPassiveMultiplier:
            signal.minPassiveMultiplier >= thresholds.minPassiveMultiplier,
        passiveAbsorptionThreshold:
            signal.passiveAbsorptionThreshold >=
            thresholds.passiveAbsorptionThreshold,
        finalConfidence:
            signal.finalConfidenceRequired >=
            thresholds.finalConfidenceRequired,
    };

    // All checks must pass
    return Object.values(checks).every((check) => check === true);
}

function getFailedChecks(
    signal: AbsorptionSignal,
    thresholds: RecommendedThresholds
): string[] {
    const failed: string[] = [];

    if (signal.minAggVolume < thresholds.minAggVolume) {
        failed.push(
            `minAggVolume: ${signal.minAggVolume.toFixed(2)} < ${thresholds.minAggVolume.toFixed(2)}`
        );
    }
    if (signal.priceEfficiencyThreshold > thresholds.priceEfficiencyThreshold) {
        failed.push(
            `priceEfficiency: ${signal.priceEfficiencyThreshold.toFixed(6)} > ${thresholds.priceEfficiencyThreshold.toFixed(6)}`
        );
    }
    if (signal.maxAbsorptionRatio < thresholds.maxAbsorptionRatio) {
        failed.push(
            `maxAbsorptionRatio: ${signal.maxAbsorptionRatio.toFixed(4)} < ${thresholds.maxAbsorptionRatio.toFixed(4)}`
        );
    }
    if (signal.minPassiveMultiplier < thresholds.minPassiveMultiplier) {
        failed.push(
            `minPassiveMultiplier: ${signal.minPassiveMultiplier.toFixed(2)} < ${thresholds.minPassiveMultiplier.toFixed(2)}`
        );
    }
    if (
        signal.passiveAbsorptionThreshold <
        thresholds.passiveAbsorptionThreshold
    ) {
        failed.push(
            `passiveAbsorptionThreshold: ${signal.passiveAbsorptionThreshold.toFixed(2)} < ${thresholds.passiveAbsorptionThreshold.toFixed(2)}`
        );
    }
    if (signal.finalConfidenceRequired < thresholds.finalConfidenceRequired) {
        failed.push(
            `finalConfidence: ${signal.finalConfidenceRequired.toFixed(4)} < ${thresholds.finalConfidenceRequired.toFixed(4)}`
        );
    }

    return failed;
}

function formatTimestamp(timestamp: number): string {
    return new Date(timestamp).toLocaleString("en-US", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: "America/Lima",
    });
}

async function verifyThresholds(): Promise<void> {
    console.log("Loading absorption signals...");

    const successful = await readAbsorptionSignals(
        "logs/signal_validation/absorption_successful_2025-08-12.csv"
    );
    const validated = await readAbsorptionSignals(
        "logs/signal_validation/absorption_validation_2025-08-12.csv"
    );

    console.log(`Loaded ${successful.length} successful signals`);
    console.log(`Loaded ${validated.length} validated signals`);

    // Check which successful signals would pass
    const successfulPassing: AbsorptionSignal[] = [];
    const successfulFailing: AbsorptionSignal[] = [];

    for (const signal of successful) {
        if (wouldSignalPass(signal, RECOMMENDED_THRESHOLDS)) {
            successfulPassing.push(signal);
        } else {
            successfulFailing.push(signal);
        }
    }

    // Check validated signals (excluding those already in successful)
    const successfulTimestamps = new Set(successful.map((s) => s.timestamp));
    const validatedNotInSuccess = validated.filter(
        (v) => !successfulTimestamps.has(v.timestamp)
    );

    const validatedPassing: AbsorptionSignal[] = [];
    const validatedFailing: AbsorptionSignal[] = [];

    for (const signal of validatedNotInSuccess) {
        if (wouldSignalPass(signal, RECOMMENDED_THRESHOLDS)) {
            validatedPassing.push(signal);
        } else {
            validatedFailing.push(signal);
        }
    }

    // Debug: Show the range of values in validated signals that are passing
    if (validatedPassing.length > 0) {
        console.log("\nValidated signals that pass - parameter ranges:");
        const params = [
            "minAggVolume",
            "priceEfficiencyThreshold",
            "maxAbsorptionRatio",
            "minPassiveMultiplier",
            "passiveAbsorptionThreshold",
            "finalConfidenceRequired",
        ];
        for (const param of params) {
            const values = validatedPassing
                .map((s) => (s as any)[param])
                .filter((v) => v !== undefined);
            if (values.length > 0) {
                const min = Math.min(...values);
                const max = Math.max(...values);
                console.log(
                    `  ${param}: ${min.toFixed(4)} - ${max.toFixed(4)}`
                );
            }
        }
    }

    // Separate validated passing into those that reached TP and those that didn't
    const validatedPassingTP = validatedPassing.filter(
        (s) => s.wasValidSignal === true || s.TP_SL === "TP"
    );
    const validatedPassingNoTP = validatedPassing.filter(
        (s) => s.wasValidSignal !== true && s.TP_SL !== "TP"
    );

    console.log("\n=== VERIFICATION RESULTS ===");
    console.log(
        `Successful signals passing: ${successfulPassing.length}/${successful.length}`
    );
    console.log(`Successful signals failing: ${successfulFailing.length}`);
    console.log(
        `Validated (not in success) passing: ${validatedPassing.length}/${validatedNotInSuccess.length}`
    );
    console.log(`  - Would reach TP: ${validatedPassingTP.length}`);
    console.log(`  - Would NOT reach TP: ${validatedPassingNoTP.length}`);

    if (successfulFailing.length > 0) {
        console.log(
            "\n⚠️ WARNING: Some successful signals would NOT pass with recommended thresholds!"
        );
        for (const signal of successfulFailing) {
            console.log(
                `  ${formatTimestamp(signal.timestamp)}: ${getFailedChecks(signal, RECOMMENDED_THRESHOLDS).join(", ")}`
            );
        }
    }

    // Generate HTML report
    await generateHTMLReport(
        successfulPassing,
        successfulFailing,
        validatedPassingTP,
        validatedPassingNoTP,
        validatedNotInSuccess
    );
}

async function generateHTMLReport(
    successfulPassing: AbsorptionSignal[],
    successfulFailing: AbsorptionSignal[],
    validatedPassingTP: AbsorptionSignal[],
    validatedPassingNoTP: AbsorptionSignal[],
    allValidatedNotInSuccess: AbsorptionSignal[]
): Promise<void> {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Threshold Verification - Absorption Signals</title>
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
        .summary {
            background-color: #2a2a2a;
            padding: 20px;
            border-radius: 5px;
            margin: 20px 0;
            border: 1px solid #444;
        }
        .good { color: #4CAF50; font-weight: bold; }
        .bad { color: #f44336; font-weight: bold; }
        .warning { color: #ffa726; font-weight: bold; }
        table {
            border-collapse: collapse;
            width: 100%;
            background-color: #2a2a2a;
            margin: 20px 0;
        }
        th {
            background-color: #4CAF50;
            color: white;
            padding: 10px;
            text-align: left;
            font-size: 12px;
        }
        td {
            padding: 8px;
            border-bottom: 1px solid #444;
            font-size: 11px;
        }
        .buy { color: #4CAF50; }
        .sell { color: #f44336; }
        .price { font-family: monospace; }
        .small { font-size: 10px; color: #888; }
        .thresholds {
            background-color: #333;
            padding: 10px;
            margin: 10px 0;
            border-radius: 5px;
            font-family: monospace;
        }
    </style>
</head>
<body>
    <h1>Threshold Verification Report - Absorption Detector</h1>
    
    <div class="summary">
        <h2>Recommended Thresholds</h2>
        <div class="thresholds">
            minAggVolume ≥ ${RECOMMENDED_THRESHOLDS.minAggVolume.toFixed(2)}<br>
            priceEfficiencyThreshold ≤ ${RECOMMENDED_THRESHOLDS.priceEfficiencyThreshold.toFixed(6)}<br>
            maxAbsorptionRatio ≥ ${RECOMMENDED_THRESHOLDS.maxAbsorptionRatio.toFixed(4)}<br>
            minPassiveMultiplier ≥ ${RECOMMENDED_THRESHOLDS.minPassiveMultiplier.toFixed(3)}<br>
            passiveAbsorptionThreshold ≥ ${RECOMMENDED_THRESHOLDS.passiveAbsorptionThreshold.toFixed(3)}<br>
            finalConfidenceRequired ≥ ${RECOMMENDED_THRESHOLDS.finalConfidenceRequired.toFixed(3)}
        </div>
    </div>
    
    <div class="summary">
        <h2>Verification Results</h2>
        <p>✅ Successful signals that would PASS: <span class="good">${successfulPassing.length}/35</span></p>
        <p>❌ Successful signals that would FAIL: <span class="${successfulFailing.length > 0 ? "bad" : "good"}">${successfulFailing.length}</span></p>
        <p>📊 Validated (not in success) that would PASS: <span class="warning">${validatedPassingTP.length + validatedPassingNoTP.length}</span></p>
        <p>&nbsp;&nbsp;&nbsp;&nbsp;→ Would reach TP (false negatives fixed): <span class="good">${validatedPassingTP.length}</span></p>
        <p>&nbsp;&nbsp;&nbsp;&nbsp;→ Would NOT reach TP (false positives): <span class="bad">${validatedPassingNoTP.length}</span></p>
    </div>
    
    <h2>Validated Signals (NOT in Success) That Would Pass - ${validatedPassingTP.length + validatedPassingNoTP.length} signals</h2>
    <table>
        <tr>
            <th>Time (Lima)</th>
            <th>Side</th>
            <th>Price</th>
            <th>Would Hit TP?</th>
            <th>Movement 1hr</th>
            <th>minAggVol</th>
            <th>priceEff</th>
            <th>maxAbsRatio</th>
            <th>minPassMult</th>
            <th>passAbsThresh</th>
            <th>finalConf</th>
        </tr>
        ${[...validatedPassingTP, ...validatedPassingNoTP]
            .map(
                (s) => `
        <tr>
            <td>${formatTimestamp(s.timestamp)}</td>
            <td class="${s.signalSide}">${s.signalSide.toUpperCase()}</td>
            <td class="price">$${s.price.toFixed(2)}</td>
            <td class="${s.wasValidSignal || s.TP_SL === "TP" ? "good" : "bad"}">
                ${s.wasValidSignal || s.TP_SL === "TP" ? "✅ YES" : "❌ NO"}
            </td>
            <td>${s.subsequentMovement1hr ? (s.subsequentMovement1hr * 100).toFixed(3) + "%" : "N/A"}</td>
            <td>${s.minAggVolume.toFixed(0)}</td>
            <td>${s.priceEfficiencyThreshold.toFixed(6)}</td>
            <td>${s.maxAbsorptionRatio.toFixed(3)}</td>
            <td>${s.minPassiveMultiplier.toFixed(2)}</td>
            <td>${s.passiveAbsorptionThreshold.toFixed(2)}</td>
            <td>${s.finalConfidenceRequired.toFixed(3)}</td>
        </tr>`
            )
            .join("")}
    </table>
    
    <h2>Successful Signals That Would Pass - ${successfulPassing.length} signals</h2>
    <table>
        <tr>
            <th>Time (Lima)</th>
            <th>Side</th>
            <th>Price</th>
            <th>TP Status</th>
            <th>Movement 1hr</th>
            <th>minAggVol</th>
            <th>priceEff</th>
            <th>maxAbsRatio</th>
            <th>minPassMult</th>
            <th>passAbsThresh</th>
            <th>finalConf</th>
        </tr>
        ${successfulPassing
            .map(
                (s) => `
        <tr>
            <td>${formatTimestamp(s.timestamp)}</td>
            <td class="${s.signalSide}">${s.signalSide.toUpperCase()}</td>
            <td class="price">$${s.price.toFixed(2)}</td>
            <td class="good">✅ TP</td>
            <td>${s.subsequentMovement1hr ? (s.subsequentMovement1hr * 100).toFixed(3) + "%" : "N/A"}</td>
            <td>${s.minAggVolume.toFixed(0)}</td>
            <td>${s.priceEfficiencyThreshold.toFixed(6)}</td>
            <td>${s.maxAbsorptionRatio.toFixed(3)}</td>
            <td>${s.minPassiveMultiplier.toFixed(2)}</td>
            <td>${s.passiveAbsorptionThreshold.toFixed(2)}</td>
            <td>${s.finalConfidenceRequired.toFixed(3)}</td>
        </tr>`
            )
            .join("")}
    </table>
    
    ${
        successfulFailing.length > 0
            ? `
    <h2 class="bad">⚠️ Successful Signals That Would FAIL - ${successfulFailing.length} signals</h2>
    <table>
        <tr>
            <th>Time (Lima)</th>
            <th>Side</th>
            <th>Price</th>
            <th>Failed Checks</th>
            <th>minAggVol</th>
            <th>priceEff</th>
            <th>maxAbsRatio</th>
            <th>minPassMult</th>
            <th>passAbsThresh</th>
            <th>finalConf</th>
        </tr>
        ${successfulFailing
            .map(
                (s) => `
        <tr>
            <td>${formatTimestamp(s.timestamp)}</td>
            <td class="${s.signalSide}">${s.signalSide.toUpperCase()}</td>
            <td class="price">$${s.price.toFixed(2)}</td>
            <td class="small">${getFailedChecks(s, RECOMMENDED_THRESHOLDS).join("<br>")}</td>
            <td class="${s.minAggVolume < RECOMMENDED_THRESHOLDS.minAggVolume ? "bad" : ""}">${s.minAggVolume.toFixed(0)}</td>
            <td class="${s.priceEfficiencyThreshold > RECOMMENDED_THRESHOLDS.priceEfficiencyThreshold ? "bad" : ""}">${s.priceEfficiencyThreshold.toFixed(6)}</td>
            <td class="${s.maxAbsorptionRatio < RECOMMENDED_THRESHOLDS.maxAbsorptionRatio ? "bad" : ""}">${s.maxAbsorptionRatio.toFixed(3)}</td>
            <td class="${s.minPassiveMultiplier < RECOMMENDED_THRESHOLDS.minPassiveMultiplier ? "bad" : ""}">${s.minPassiveMultiplier.toFixed(2)}</td>
            <td class="${s.passiveAbsorptionThreshold < RECOMMENDED_THRESHOLDS.passiveAbsorptionThreshold ? "bad" : ""}">${s.passiveAbsorptionThreshold.toFixed(2)}</td>
            <td class="${s.finalConfidenceRequired < RECOMMENDED_THRESHOLDS.finalConfidenceRequired ? "bad" : ""}">${s.finalConfidenceRequired.toFixed(3)}</td>
        </tr>`
            )
            .join("")}
    </table>
    `
            : ""
    }
    
    <p style="margin-top: 40px; color: #888; font-size: 12px;">
        Generated: ${new Date().toISOString()}<br>
        Total validated signals analyzed: ${allValidatedNotInSuccess.length} (excluding ${35} already in success)
    </p>
</body>
</html>`;

    await fs.writeFile("threshold_verification_report.html", html);
    console.log(
        "\n✅ HTML report saved to: threshold_verification_report.html"
    );
}

// Run the verification
verifyThresholds().catch(console.error);
