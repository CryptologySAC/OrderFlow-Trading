#!/usr/bin/env node
import Database from "better-sqlite3";
import * as fs from "fs/promises";
import * as path from "path";

interface SignalRecord {
    timestamp: number;
    detectorType: string;
    signalSide: "buy" | "sell";
    price: number;
    TP_SL: string;
    subsequentMovement1hr?: number;
}

interface PriceData {
    timestamp: number;
    price: number;
}

interface AnalysisResult {
    detectorType: string;
    timestamp: number;
    limaTime: string;
    signalSide: "buy" | "sell";
    entryPrice: number;
    targetPrice: number;
    maxPriceReached: number;
    maxMovementPercent: number;
    actuallySuccessful: boolean;
    csvMarkedAs: string;
    timeToMax: number; // minutes
}

const TARGET_PERCENT = 0.007; // 0.7% target

async function readCSVFile(filePath: string): Promise<SignalRecord[]> {
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.trim().split("\n");
    if (lines.length < 2) return [];

    const headers = lines[0].split(",");
    const records: SignalRecord[] = [];

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(",");
        if (values.length < 3) continue;

        const record: SignalRecord = {
            timestamp: parseInt(values[0]),
            detectorType: values[1],
            signalSide: values[2] as "buy" | "sell",
            price: parseFloat(values[3]),
            TP_SL: values[headers.indexOf("TP_SL")] || "",
            subsequentMovement1hr: values[
                headers.indexOf("subsequentMovement1hr")
            ]
                ? parseFloat(values[headers.indexOf("subsequentMovement1hr")])
                : undefined,
        };
        records.push(record);
    }

    return records;
}

function convertToLimaTime(timestamp: number): string {
    // Lima is UTC-5
    const date = new Date(timestamp);
    const limaOffset = -5 * 60; // -5 hours in minutes
    const localOffset = date.getTimezoneOffset();
    const totalOffset = (limaOffset - localOffset) * 60 * 1000;

    const limaDate = new Date(date.getTime() + totalOffset);

    return limaDate.toLocaleString("en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
}

async function analyzeSignals(): Promise<AnalysisResult[]> {
    const db = new Database("storage/trades.db", { readonly: true });
    const results: AnalysisResult[] = [];

    try {
        // Read all successful signal files
        const signalFiles = [
            "logs/signal_validation/absorption_successful_2025-08-12.csv",
            "logs/signal_validation/exhaustion_successful_2025-08-12.csv",
            "logs/signal_validation/deltacvd_successful_2025-08-12.csv",
        ];

        for (const filePath of signalFiles) {
            try {
                const signals = await readCSVFile(filePath);
                console.log(
                    `\nAnalyzing ${signals.length} signals from ${path.basename(filePath)}`
                );

                for (const signal of signals) {
                    // Get price data for 90 minutes after signal
                    const endTime = signal.timestamp + 90 * 60 * 1000;

                    const priceQuery = db.prepare(`
                        SELECT tradeTime as timestamp, price 
                        FROM aggregated_trades 
                        WHERE tradeTime >= ? AND tradeTime <= ?
                        ORDER BY tradeTime ASC
                    `);

                    const prices = priceQuery.all(
                        signal.timestamp,
                        endTime
                    ) as PriceData[];

                    if (prices.length === 0) {
                        console.log(
                            `No price data found for signal at ${signal.timestamp}`
                        );
                        continue;
                    }

                    // Calculate target price based on signal side
                    const targetPrice =
                        signal.signalSide === "buy"
                            ? signal.price * (1 + TARGET_PERCENT)
                            : signal.price * (1 - TARGET_PERCENT);

                    // Find maximum favorable movement
                    let maxPrice = signal.price;
                    let minPrice = signal.price;
                    let maxFavorablePrice = signal.price;
                    let timeToMax = 0;

                    for (const pricePoint of prices) {
                        if (pricePoint.price > maxPrice)
                            maxPrice = pricePoint.price;
                        if (pricePoint.price < minPrice)
                            minPrice = pricePoint.price;

                        if (signal.signalSide === "buy") {
                            // For buy signals, we want price to go up
                            if (pricePoint.price > maxFavorablePrice) {
                                maxFavorablePrice = pricePoint.price;
                                timeToMax =
                                    (pricePoint.timestamp - signal.timestamp) /
                                    (60 * 1000);
                            }
                        } else {
                            // For sell signals, we want price to go down
                            if (pricePoint.price < maxFavorablePrice) {
                                maxFavorablePrice = pricePoint.price;
                                timeToMax =
                                    (pricePoint.timestamp - signal.timestamp) /
                                    (60 * 1000);
                            }
                        }
                    }

                    // Calculate actual movement percentage
                    const maxMovementPercent =
                        signal.signalSide === "buy"
                            ? (maxFavorablePrice - signal.price) / signal.price
                            : (signal.price - maxFavorablePrice) / signal.price;

                    // Check if target was actually reached
                    const actuallySuccessful =
                        maxMovementPercent >= TARGET_PERCENT;

                    results.push({
                        detectorType: signal.detectorType,
                        timestamp: signal.timestamp,
                        limaTime: convertToLimaTime(signal.timestamp),
                        signalSide: signal.signalSide,
                        entryPrice: signal.price,
                        targetPrice: targetPrice,
                        maxPriceReached: maxFavorablePrice,
                        maxMovementPercent: maxMovementPercent,
                        actuallySuccessful: actuallySuccessful,
                        csvMarkedAs: signal.TP_SL,
                        timeToMax: timeToMax,
                    });
                }
            } catch (error) {
                console.log(`Could not read file ${filePath}: ${error}`);
            }
        }

        // Generate HTML table
        generateHTMLReport(results);

        // Print summary statistics
        printSummary(results);
    } finally {
        db.close();
    }

    return results;
}

function generateHTMLReport(results: AnalysisResult[]): void {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Signal Success Verification Report</title>
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
        .match {
            color: #28a745;
        }
        .mismatch {
            color: #dc3545;
            font-weight: bold;
        }
    </style>
</head>
<body>
    <h1>Signal Success Verification Report</h1>
    <p>Target Movement: <strong>0.7%</strong> | Analysis Period: <strong>90 minutes</strong> | Timezone: <strong>Lima (UTC-5)</strong></p>
    
    ${generateSummaryHTML(results)}
    
    ${generateDetectorTablesHTML(results)}
    
    <p style="margin-top: 40px; color: #666; font-size: 12px;">
        Generated: ${new Date().toISOString()}<br>
        Data Source: storage/trades.db (aggregated_trades table)
    </p>
</body>
</html>`;

    fs.writeFile("signal_verification_report.html", html, "utf8");
    console.log("\n✅ HTML report saved to: signal_verification_report.html");
}

function generateSummaryHTML(results: AnalysisResult[]): string {
    const detectors = ["absorption", "exhaustion", "deltacvd"];
    let summaryHTML = '<div class="summary"><h2>Summary Statistics</h2><table>';
    summaryHTML +=
        "<tr><th>Detector</th><th>Total Signals</th><th>Actually Successful</th><th>Success Rate</th><th>CSV vs Reality Match</th></tr>";

    for (const detector of detectors) {
        const detectorResults = results.filter(
            (r) => r.detectorType === detector
        );
        const successful = detectorResults.filter((r) => r.actuallySuccessful);
        const matches = detectorResults.filter(
            (r) =>
                (r.actuallySuccessful && r.csvMarkedAs === "TP") ||
                (!r.actuallySuccessful && r.csvMarkedAs !== "TP")
        );

        if (detectorResults.length > 0) {
            summaryHTML += `<tr>
                <td><strong>${detector.toUpperCase()}</strong></td>
                <td>${detectorResults.length}</td>
                <td class="${successful.length === detectorResults.length ? "success" : ""}">${successful.length}</td>
                <td>${((successful.length / detectorResults.length) * 100).toFixed(1)}%</td>
                <td class="${matches.length === detectorResults.length ? "match" : "mismatch"}">
                    ${matches.length}/${detectorResults.length} 
                    (${((matches.length / detectorResults.length) * 100).toFixed(1)}%)
                </td>
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
                    <th>Side</th>
                    <th>Entry Price</th>
                    <th>Target Price (0.7%)</th>
                    <th>Max Price Reached</th>
                    <th>Max Movement %</th>
                    <th>Time to Max (min)</th>
                    <th>Actually Successful?</th>
                    <th>CSV Marked As</th>
                    <th>Match?</th>
                </tr>`;

        for (const result of detectorResults.sort(
            (a, b) => a.timestamp - b.timestamp
        )) {
            const isMatch =
                (result.actuallySuccessful && result.csvMarkedAs === "TP") ||
                (!result.actuallySuccessful && result.csvMarkedAs !== "TP");

            tablesHTML += `<tr>
                <td>${result.limaTime}</td>
                <td class="${result.signalSide}">${result.signalSide.toUpperCase()}</td>
                <td class="price">${result.entryPrice.toFixed(2)}</td>
                <td class="price">${result.targetPrice.toFixed(2)}</td>
                <td class="price">${result.maxPriceReached.toFixed(2)}</td>
                <td class="percent ${result.maxMovementPercent >= TARGET_PERCENT ? "success" : "failure"}">
                    ${(result.maxMovementPercent * 100).toFixed(3)}%
                </td>
                <td>${result.timeToMax.toFixed(1)}</td>
                <td class="${result.actuallySuccessful ? "success" : "failure"}">
                    ${result.actuallySuccessful ? "YES" : "NO"}
                </td>
                <td>${result.csvMarkedAs || "N/A"}</td>
                <td class="${isMatch ? "match" : "mismatch"}">
                    ${isMatch ? "✓" : "✗"}
                </td>
            </tr>`;
        }

        tablesHTML += "</table></div>";
    }

    return tablesHTML;
}

function printSummary(results: AnalysisResult[]): void {
    console.log("\n" + "=".repeat(80));
    console.log("SIGNAL SUCCESS VERIFICATION SUMMARY");
    console.log("=".repeat(80));

    const detectors = ["absorption", "exhaustion", "deltacvd"];

    for (const detector of detectors) {
        const detectorResults = results.filter(
            (r) => r.detectorType === detector
        );
        if (detectorResults.length === 0) continue;

        const successful = detectorResults.filter((r) => r.actuallySuccessful);
        const failed = detectorResults.filter((r) => !r.actuallySuccessful);

        console.log(`\n${detector.toUpperCase()} DETECTOR:`);
        console.log(`  Total Signals: ${detectorResults.length}`);
        console.log(
            `  Actually Successful (≥0.7% movement): ${successful.length} (${((successful.length / detectorResults.length) * 100).toFixed(1)}%)`
        );
        console.log(
            `  Failed to reach target: ${failed.length} (${((failed.length / detectorResults.length) * 100).toFixed(1)}%)`
        );

        if (failed.length > 0) {
            console.log("  Failed signals:");
            for (const fail of failed) {
                console.log(
                    `    - ${convertToLimaTime(fail.timestamp)}: ${fail.signalSide.toUpperCase()} @ ${fail.entryPrice.toFixed(2)}, max movement: ${(fail.maxMovementPercent * 100).toFixed(3)}%`
                );
            }
        }
    }

    console.log("\n" + "=".repeat(80));
}

// Run the analysis
analyzeSignals().catch(console.error);
