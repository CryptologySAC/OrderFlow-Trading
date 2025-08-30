#!/usr/bin/env node
import * as fs from "fs/promises";
import * as path from "path";

interface SignalRecord {
    timestamp: number;
    detectorType: string;
    signalSide: "buy" | "sell";
    price: number;
    TP_SL?: string;
    subsequentMovement5min?: number;
    subsequentMovement15min?: number;
    subsequentMovement1hr?: number;
    wasValidSignal?: boolean;
    rejectionReason?: string;
}

interface AnalysisResult {
    detectorType: string;
    timestamp: number;
    limaTime: string;
    signalSide: "buy" | "sell";
    entryPrice: number;
    targetPrice: number;
    movement5min: number;
    movement15min: number;
    movement1hr: number;
    max1hrMovementPercent: number;
    actuallySuccessful: boolean;
    csvMarkedAs: string;
    fileType: "successful" | "rejected_missed";
}

const TARGET_PERCENT = 0.007; // 0.7% target

async function readCSVFile(filePath: string): Promise<SignalRecord[]> {
    try {
        const content = await fs.readFile(filePath, "utf-8");
        const lines = content.trim().split("\n");
        if (lines.length < 2) return [];

        const headers = lines[0].split(",");
        const records: SignalRecord[] = [];

        // Find column indices
        const timestampIdx = headers.indexOf("timestamp");
        const detectorIdx = headers.indexOf("detectorType");
        const sideIdx = headers.indexOf("signalSide");
        const priceIdx = headers.indexOf("price");
        const tpSlIdx = headers.indexOf("TP_SL");
        const move5Idx = headers.indexOf("subsequentMovement5min");
        const move15Idx = headers.indexOf("subsequentMovement15min");
        const move1hrIdx = headers.indexOf("subsequentMovement1hr");
        const validIdx = headers.indexOf("wasValidSignal");
        const reasonIdx = headers.indexOf("rejectionReason");

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(",");
            if (values.length < 4) continue;

            const record: SignalRecord = {
                timestamp: parseInt(values[timestampIdx]),
                detectorType: values[detectorIdx],
                signalSide: values[sideIdx] as "buy" | "sell",
                price: parseFloat(values[priceIdx]),
                TP_SL: tpSlIdx >= 0 ? values[tpSlIdx] : undefined,
                subsequentMovement5min:
                    move5Idx >= 0 && values[move5Idx]
                        ? parseFloat(values[move5Idx])
                        : undefined,
                subsequentMovement15min:
                    move15Idx >= 0 && values[move15Idx]
                        ? parseFloat(values[move15Idx])
                        : undefined,
                subsequentMovement1hr:
                    move1hrIdx >= 0 && values[move1hrIdx]
                        ? parseFloat(values[move1hrIdx])
                        : undefined,
                wasValidSignal:
                    validIdx >= 0 ? values[validIdx] === "true" : undefined,
                rejectionReason: reasonIdx >= 0 ? values[reasonIdx] : undefined,
            };

            // Skip if no movement data
            if (record.subsequentMovement1hr === undefined) continue;

            records.push(record);
        }

        return records;
    } catch (error) {
        console.log(`Could not read file ${filePath}: ${error}`);
        return [];
    }
}

function convertToLimaTime(timestamp: number): string {
    // Lima is UTC-5
    const date = new Date(timestamp);
    const options: Intl.DateTimeFormatOptions = {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: "America/Lima",
    };

    return date.toLocaleString("en-US", options);
}

async function analyzeSignals(): Promise<AnalysisResult[]> {
    const results: AnalysisResult[] = [];

    // Read all signal files (both successful and rejected_missed)
    const signalFiles = [
        {
            path: "logs/signal_validation/absorption_successful_2025-08-12.csv",
            type: "successful",
        },
        {
            path: "logs/signal_validation/exhaustion_successful_2025-08-12.csv",
            type: "successful",
        },
        {
            path: "logs/signal_validation/deltacvd_successful_2025-08-12.csv",
            type: "successful",
        },
        {
            path: "logs/signal_validation/absorption_rejected_missed_2025-08-12.csv",
            type: "rejected_missed",
        },
        {
            path: "logs/signal_validation/exhaustion_rejected_missed_2025-08-12.csv",
            type: "rejected_missed",
        },
    ];

    for (const fileInfo of signalFiles) {
        const signals = await readCSVFile(fileInfo.path);
        console.log(
            `\nAnalyzing ${signals.length} signals from ${path.basename(fileInfo.path)}`
        );

        for (const signal of signals) {
            // Calculate target price based on signal side
            const targetPrice =
                signal.signalSide === "buy"
                    ? signal.price * (1 + TARGET_PERCENT)
                    : signal.price * (1 - TARGET_PERCENT);

            // Determine max favorable movement from the recorded movements
            let maxMovement = 0;
            if (signal.subsequentMovement5min !== undefined) {
                const move5 =
                    signal.signalSide === "buy"
                        ? signal.subsequentMovement5min
                        : -signal.subsequentMovement5min;
                maxMovement = Math.max(maxMovement, move5);
            }
            if (signal.subsequentMovement15min !== undefined) {
                const move15 =
                    signal.signalSide === "buy"
                        ? signal.subsequentMovement15min
                        : -signal.subsequentMovement15min;
                maxMovement = Math.max(maxMovement, move15);
            }
            if (signal.subsequentMovement1hr !== undefined) {
                const move1hr =
                    signal.signalSide === "buy"
                        ? signal.subsequentMovement1hr
                        : -signal.subsequentMovement1hr;
                maxMovement = Math.max(maxMovement, move1hr);
            }

            // Check if target was actually reached
            const actuallySuccessful = maxMovement >= TARGET_PERCENT;

            results.push({
                detectorType: signal.detectorType,
                timestamp: signal.timestamp,
                limaTime: convertToLimaTime(signal.timestamp),
                signalSide: signal.signalSide,
                entryPrice: signal.price,
                targetPrice: targetPrice,
                movement5min: signal.subsequentMovement5min || 0,
                movement15min: signal.subsequentMovement15min || 0,
                movement1hr: signal.subsequentMovement1hr || 0,
                max1hrMovementPercent: maxMovement,
                actuallySuccessful: actuallySuccessful,
                csvMarkedAs:
                    signal.TP_SL || (signal.wasValidSignal ? "TP" : "MISSED"),
                fileType: fileInfo.type as "successful" | "rejected_missed",
            });
        }
    }

    // Generate HTML report
    await generateHTMLReport(results);

    // Print summary statistics
    printSummary(results);

    return results;
}

async function generateHTMLReport(results: AnalysisResult[]): Promise<void> {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Signal Success Verification Report - From Log Files</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }
        h1 {
            color: #333;
            border-bottom: 3px solid #4CAF50;
            padding-bottom: 10px;
        }
        h2 {
            color: #666;
            margin-top: 30px;
        }
        table {
            border-collapse: collapse;
            width: 100%;
            background-color: white;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 30px;
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
            border-bottom: 1px solid #ddd;
        }
        tr:hover {
            background-color: #f5f5f5;
        }
        .success {
            background-color: #d4edda;
            color: #155724;
            font-weight: bold;
        }
        .failure {
            background-color: #f8d7da;
            color: #721c24;
            font-weight: bold;
        }
        .buy {
            color: #28a745;
            font-weight: bold;
        }
        .sell {
            color: #dc3545;
            font-weight: bold;
        }
        .summary {
            background-color: white;
            padding: 20px;
            border-radius: 5px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 30px;
        }
        .detector-section {
            margin-top: 40px;
        }
        .price {
            font-family: 'Courier New', monospace;
        }
        .percent {
            font-weight: bold;
        }
        .positive {
            color: #28a745;
        }
        .negative {
            color: #dc3545;
        }
        .match {
            color: #28a745;
        }
        .mismatch {
            color: #dc3545;
            font-weight: bold;
        }
        .rejected {
            opacity: 0.7;
            font-style: italic;
        }
    </style>
</head>
<body>
    <h1>Signal Success Verification Report - From Log Files</h1>
    <p>Target Movement: <strong>0.7%</strong> | Analysis Period: <strong>1 hour</strong> | Timezone: <strong>Lima (UTC-5)</strong></p>
    <p>Data Source: <strong>Signal validation CSV files with embedded price movements</strong></p>
    
    ${generateSummaryHTML(results)}
    
    ${generateDetectorTablesHTML(results)}
    
    <p style="margin-top: 40px; color: #666; font-size: 12px;">
        Generated: ${new Date().toISOString()}<br>
        Data Source: Signal validation log files (with subsequentMovement data)
    </p>
</body>
</html>`;

    await fs.writeFile("signal_verification_report_from_logs.html", html);
    console.log(
        "\n✅ HTML report saved to: signal_verification_report_from_logs.html"
    );
}

function generateSummaryHTML(results: AnalysisResult[]): string {
    const detectors = ["absorption", "exhaustion", "deltacvd"];
    let summaryHTML = '<div class="summary"><h2>Summary Statistics</h2><table>';
    summaryHTML +=
        "<tr><th>Detector</th><th>Total Signals</th><th>Successful</th><th>Rejected but Would Work</th><th>Success Rate</th><th>False Positive Rate</th></tr>";

    for (const detector of detectors) {
        const detectorResults = results.filter(
            (r) => r.detectorType === detector
        );
        const successful = detectorResults.filter(
            (r) => r.fileType === "successful"
        );
        const rejected = detectorResults.filter(
            (r) => r.fileType === "rejected_missed"
        );
        const actuallyWorking = detectorResults.filter(
            (r) => r.actuallySuccessful
        );
        const rejectedButWorking = rejected.filter((r) => r.actuallySuccessful);
        const successfulButFailed = successful.filter(
            (r) => !r.actuallySuccessful
        );

        if (detectorResults.length > 0) {
            summaryHTML += `<tr>
                <td><strong>${detector.toUpperCase()}</strong></td>
                <td>${detectorResults.length}</td>
                <td>${successful.length}</td>
                <td class="${rejectedButWorking.length > 0 ? "mismatch" : ""}">${rejectedButWorking.length}</td>
                <td>${((actuallyWorking.length / detectorResults.length) * 100).toFixed(1)}%</td>
                <td class="${successfulButFailed.length > 0 ? "mismatch" : ""}">${successfulButFailed.length} (${successful.length > 0 ? ((successfulButFailed.length / successful.length) * 100).toFixed(1) : 0}%)</td>
            </tr>`;
        }
    }

    summaryHTML += "</table></div>";
    return summaryHTML;
}

function generateDetectorTablesHTML(results: AnalysisResult[]): string {
    const detectors = ["absorption", "exhaustion", "deltacvd"];
    let tablesHTML = "";

    for (const detector of detectors) {
        const detectorResults = results.filter(
            (r) => r.detectorType === detector
        );
        if (detectorResults.length === 0) continue;

        tablesHTML += `<div class="detector-section">
            <h2>${detector.toUpperCase()} Detector Signals</h2>
            <table>
                <tr>
                    <th>Lima Time</th>
                    <th>Type</th>
                    <th>Side</th>
                    <th>Entry Price</th>
                    <th>Target (0.7%)</th>
                    <th>Move 5min</th>
                    <th>Move 15min</th>
                    <th>Move 1hr</th>
                    <th>Max Move %</th>
                    <th>Success?</th>
                    <th>CSV Status</th>
                </tr>`;

        for (const result of detectorResults.sort(
            (a, b) => a.timestamp - b.timestamp
        )) {
            const rowClass =
                result.fileType === "rejected_missed" ? "rejected" : "";

            tablesHTML += `<tr class="${rowClass}">
                <td>${result.limaTime}</td>
                <td>${result.fileType === "successful" ? "✅ LOGGED" : "❌ REJECTED"}</td>
                <td class="${result.signalSide}">${result.signalSide.toUpperCase()}</td>
                <td class="price">${result.entryPrice.toFixed(2)}</td>
                <td class="price">${result.targetPrice.toFixed(2)}</td>
                <td class="percent ${result.movement5min >= 0 ? "positive" : "negative"}">
                    ${(result.movement5min * 100).toFixed(3)}%
                </td>
                <td class="percent ${result.movement15min >= 0 ? "positive" : "negative"}">
                    ${(result.movement15min * 100).toFixed(3)}%
                </td>
                <td class="percent ${result.movement1hr >= 0 ? "positive" : "negative"}">
                    ${(result.movement1hr * 100).toFixed(3)}%
                </td>
                <td class="percent ${result.max1hrMovementPercent >= TARGET_PERCENT ? "success" : "failure"}">
                    ${(result.max1hrMovementPercent * 100).toFixed(3)}%
                </td>
                <td class="${result.actuallySuccessful ? "success" : "failure"}">
                    ${result.actuallySuccessful ? "YES" : "NO"}
                </td>
                <td>${result.csvMarkedAs}</td>
            </tr>`;
        }

        tablesHTML += "</table></div>";
    }

    return tablesHTML;
}

function printSummary(results: AnalysisResult[]): void {
    console.log("\n" + "=".repeat(80));
    console.log("SIGNAL SUCCESS VERIFICATION SUMMARY (FROM LOG FILES)");
    console.log("=".repeat(80));

    const detectors = ["absorption", "exhaustion", "deltacvd"];

    for (const detector of detectors) {
        const detectorResults = results.filter(
            (r) => r.detectorType === detector
        );
        if (detectorResults.length === 0) continue;

        const successful = detectorResults.filter(
            (r) => r.fileType === "successful"
        );
        const rejected = detectorResults.filter(
            (r) => r.fileType === "rejected_missed"
        );
        const actuallyWorking = detectorResults.filter(
            (r) => r.actuallySuccessful
        );
        const rejectedButWorking = rejected.filter((r) => r.actuallySuccessful);
        const successfulButFailed = successful.filter(
            (r) => !r.actuallySuccessful
        );

        console.log(`\n${detector.toUpperCase()} DETECTOR:`);
        console.log(`  Total Signals Analyzed: ${detectorResults.length}`);
        console.log(`  Logged as Successful: ${successful.length}`);
        console.log(
            `  Rejected but Would Have Worked: ${rejectedButWorking.length}`
        );
        console.log(
            `  Actually Reached 0.7% Target: ${actuallyWorking.length} (${((actuallyWorking.length / detectorResults.length) * 100).toFixed(1)}%)`
        );

        if (successfulButFailed.length > 0) {
            console.log(
                `  ⚠️  FALSE POSITIVES: ${successfulButFailed.length} signals marked successful but didn't reach target`
            );
        }

        if (rejectedButWorking.length > 0) {
            console.log(
                `  ⚠️  MISSED OPPORTUNITIES: ${rejectedButWorking.length} signals rejected but would have worked`
            );
        }
    }

    console.log("\n" + "=".repeat(80));
}

// Run the analysis
analyzeSignals().catch(console.error);
