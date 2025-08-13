#!/usr/bin/env node
import * as fs from "fs/promises";

interface SuccessfulSignal {
    timestamp: number;
    detectorType: string;
    signalSide: "buy" | "sell";
    price: number;
}

interface PricePoint {
    timestamp: number;
    price: number;
}

interface SignalAnalysis {
    detectorType: string;
    signalTimestamp: number;
    signalTimeLima: string;
    signalPrice: number;
    signalSide: "buy" | "sell";
    targetTPPrice: number; // 0.7% target
    actualMaxPrice: number; // actual max/min reached
    actualTPPercent: number;
    minutesToTP: number;
    reachedTarget: boolean;
    maxAdversePrice: number; // worst price before TP
    maxAdversePercent: number; // max drawdown before TP
}

const TARGET_PERCENT = 0.007; // 0.7%

async function readSuccessfulSignals(
    filePath: string
): Promise<SuccessfulSignal[]> {
    try {
        const content = await fs.readFile(filePath, "utf-8");
        const lines = content.trim().split("\n");
        if (lines.length < 2) return [];

        const signals: SuccessfulSignal[] = [];

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(",");
            if (values.length < 4) continue;

            signals.push({
                timestamp: parseInt(values[0]),
                detectorType: values[1],
                signalSide: values[2] as "buy" | "sell",
                price: parseFloat(values[3]),
            });
        }

        return signals;
    } catch (error) {
        console.log(`Could not read file ${filePath}`);
        return [];
    }
}

async function extractPriceData(
    rejectedFilePath: string
): Promise<Map<number, number>> {
    // Extract all price points from rejected logs
    // Key: timestamp, Value: price
    const priceMap = new Map<number, number>();

    try {
        const content = await fs.readFile(rejectedFilePath, "utf-8");
        const lines = content.trim().split("\n");
        if (lines.length < 2) return priceMap;

        // Find column indices
        const headers = lines[0].split(",");
        const timestampIdx = headers.indexOf("timestamp");
        const priceIdx = headers.indexOf("price");

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(",");
            if (values.length <= Math.max(timestampIdx, priceIdx)) continue;

            const timestamp = parseInt(values[timestampIdx]);
            const price = parseFloat(values[priceIdx]);

            if (!isNaN(timestamp) && !isNaN(price)) {
                priceMap.set(timestamp, price);
            }
        }

        console.log(
            `Extracted ${priceMap.size} price points from ${rejectedFilePath}`
        );
    } catch (error) {
        console.log(`Could not extract prices from ${rejectedFilePath}`);
    }

    return priceMap;
}

function convertToLimaTime(timestamp: number): string {
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

async function analyzeSignals(): Promise<void> {
    // Load all price data from rejected logs
    console.log("Loading price data from rejected logs...");
    const absorptionPrices = await extractPriceData(
        "logs/signal_validation/absorption_rejected_missed_2025-08-12.csv"
    );
    const exhaustionPrices = await extractPriceData(
        "logs/signal_validation/exhaustion_rejected_missed_2025-08-12.csv"
    );

    // Combine all price data
    const allPrices = new Map<number, number>();
    for (const [ts, price] of absorptionPrices) {
        allPrices.set(ts, price);
    }
    for (const [ts, price] of exhaustionPrices) {
        if (!allPrices.has(ts)) {
            allPrices.set(ts, price);
        }
    }

    // Sort timestamps for efficient searching
    const sortedTimestamps = Array.from(allPrices.keys()).sort((a, b) => a - b);
    console.log(`Total price points available: ${sortedTimestamps.length}`);

    if (sortedTimestamps.length === 0) {
        console.log("No price data available!");
        return;
    }

    // Analyze each successful signal
    const results: SignalAnalysis[] = [];

    const signalFiles = [
        "logs/signal_validation/absorption_successful_2025-08-12.csv",
        "logs/signal_validation/exhaustion_successful_2025-08-12.csv",
        "logs/signal_validation/deltacvd_successful_2025-08-12.csv",
    ];

    for (const filePath of signalFiles) {
        const signals = await readSuccessfulSignals(filePath);
        console.log(
            `\nAnalyzing ${signals.length} successful signals from ${filePath}`
        );

        for (const signal of signals) {
            const endTime = signal.timestamp + 90 * 60 * 1000; // 90 minutes later

            // Find all prices within the 90-minute window
            const windowPrices: PricePoint[] = [];
            for (const ts of sortedTimestamps) {
                if (ts < signal.timestamp) continue;
                if (ts > endTime) break;

                const price = allPrices.get(ts);
                if (price !== undefined) {
                    windowPrices.push({ timestamp: ts, price });
                }
            }

            if (windowPrices.length === 0) {
                console.log(
                    `No price data found for signal at ${signal.timestamp}`
                );
                continue;
            }

            // Find the maximum favorable movement AND worst adverse movement before TP
            let bestPrice = signal.price;
            let bestTimestamp = signal.timestamp;
            let worstPriceBeforeTP = signal.price;

            for (const point of windowPrices) {
                if (signal.signalSide === "buy") {
                    // For buy signals, we want the highest price
                    if (point.price > bestPrice) {
                        bestPrice = point.price;
                        bestTimestamp = point.timestamp;
                    }
                } else {
                    // For sell signals, we want the lowest price
                    if (point.price < bestPrice) {
                        bestPrice = point.price;
                        bestTimestamp = point.timestamp;
                    }
                }
            }

            // Now find the worst price BEFORE the best price was reached
            for (const point of windowPrices) {
                if (point.timestamp > bestTimestamp) break; // Stop at TP time

                if (signal.signalSide === "buy") {
                    // For buy signals, worst is the lowest price (max drawdown)
                    if (point.price < worstPriceBeforeTP) {
                        worstPriceBeforeTP = point.price;
                    }
                } else {
                    // For sell signals, worst is the highest price
                    if (point.price > worstPriceBeforeTP) {
                        worstPriceBeforeTP = point.price;
                    }
                }
            }

            // Calculate the actual TP percentage
            const actualTPPercent =
                signal.signalSide === "buy"
                    ? (bestPrice - signal.price) / signal.price
                    : (signal.price - bestPrice) / signal.price;

            // Calculate max adverse movement (drawdown)
            const maxAdversePercent =
                signal.signalSide === "buy"
                    ? (signal.price - worstPriceBeforeTP) / signal.price
                    : (worstPriceBeforeTP - signal.price) / signal.price;

            // Calculate target price
            const targetPrice =
                signal.signalSide === "buy"
                    ? signal.price * (1 + TARGET_PERCENT)
                    : signal.price * (1 - TARGET_PERCENT);

            // Calculate minutes to best price
            const minutesToTP =
                (bestTimestamp - signal.timestamp) / (60 * 1000);

            results.push({
                detectorType: signal.detectorType,
                signalTimestamp: signal.timestamp,
                signalTimeLima: convertToLimaTime(signal.timestamp),
                signalPrice: signal.price,
                signalSide: signal.signalSide,
                targetTPPrice: targetPrice,
                actualMaxPrice: bestPrice,
                actualTPPercent: actualTPPercent,
                minutesToTP: minutesToTP,
                reachedTarget: actualTPPercent >= TARGET_PERCENT,
                maxAdversePrice: worstPriceBeforeTP,
                maxAdversePercent: maxAdversePercent,
            });
        }
    }

    // Generate HTML report
    await generateHTMLReport(results);

    // Print summary
    printSummary(results);
}

async function generateHTMLReport(results: SignalAnalysis[]): Promise<void> {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Successful Signals - Actual Price Movement Analysis</title>
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
        .success {
            color: #4CAF50;
            font-weight: bold;
        }
        .failure {
            color: #f44336;
            font-weight: bold;
        }
        .buy {
            color: #4CAF50;
        }
        .sell {
            color: #f44336;
        }
        .price {
            font-family: 'Courier New', monospace;
            color: #ffa726;
        }
        .percent {
            font-weight: bold;
        }
        .summary {
            background-color: #2a2a2a;
            padding: 20px;
            border-radius: 5px;
            margin-bottom: 30px;
            border: 1px solid #444;
        }
    </style>
</head>
<body>
    <h1>Successful Signals - Actual Maximum Price Movement Within 90 Minutes</h1>
    <div class="summary">
        <p><strong>Target Movement:</strong> 0.7% | <strong>Time Window:</strong> 90 minutes | <strong>Timezone:</strong> Lima (UTC-5)</p>
        <p><strong>Analysis:</strong> For each signal marked as "successful", showing the ACTUAL maximum favorable price reached within 90 minutes</p>
    </div>
    
    <table>
        <tr>
            <th>Signal Type</th>
            <th>Signal Timestamp</th>
            <th>Signal Time (Lima)</th>
            <th>Signal Price</th>
            <th>Signal Side</th>
            <th>Target TP Price (0.7%)</th>
            <th>Actual Max/Min Price</th>
            <th>Actual TP %</th>
            <th>Max SL Price Before TP</th>
            <th>Max SL % Before TP</th>
            <th>Minutes to Max/Min</th>
            <th>Reached 0.7%?</th>
        </tr>
        ${results
            .map(
                (r) => `
        <tr>
            <td>${r.detectorType.toUpperCase()}</td>
            <td>${r.signalTimestamp}</td>
            <td>${r.signalTimeLima}</td>
            <td class="price">$${r.signalPrice.toFixed(2)}</td>
            <td class="${r.signalSide}">${r.signalSide.toUpperCase()}</td>
            <td class="price">$${r.targetTPPrice.toFixed(2)}</td>
            <td class="price">$${r.actualMaxPrice.toFixed(2)}</td>
            <td class="percent ${r.reachedTarget ? "success" : "failure"}">${(r.actualTPPercent * 100).toFixed(3)}%</td>
            <td class="price">$${r.maxAdversePrice.toFixed(2)}</td>
            <td class="percent ${r.maxAdversePercent > 0.007 ? "failure" : ""}">${(r.maxAdversePercent * 100).toFixed(3)}%</td>
            <td>${r.minutesToTP.toFixed(1)} min</td>
            <td class="${r.reachedTarget ? "success" : "failure"}">${r.reachedTarget ? "✅ YES" : "❌ NO"}</td>
        </tr>`
            )
            .join("")}
    </table>
    
    <div class="summary">
        <h2>Summary</h2>
        <p>Total Signals in "Successful" Logs: <strong>${results.length}</strong></p>
        <p>Actually Reached 0.7% Target: <strong>${results.filter((r) => r.reachedTarget).length}</strong></p>
        <p>Failed to Reach Target: <strong>${results.filter((r) => !r.reachedTarget).length}</strong></p>
        <p>Success Rate: <strong>${results.length > 0 ? ((results.filter((r) => r.reachedTarget).length / results.length) * 100).toFixed(1) : 0}%</strong></p>
    </div>
    
    <p style="margin-top: 40px; color: #888; font-size: 12px;">
        Generated: ${new Date().toISOString()}<br>
        Price data source: Reconstructed from rejected_missed log files
    </p>
</body>
</html>`;

    await fs.writeFile("successful_signals_actual_tp_analysis.html", html);
    console.log(
        "\n✅ HTML report saved to: successful_signals_actual_tp_analysis.html"
    );
}

function printSummary(results: SignalAnalysis[]): void {
    console.log("\n" + "=".repeat(80));
    console.log("SUCCESSFUL SIGNALS - ACTUAL TP ANALYSIS");
    console.log("=".repeat(80));

    const byDetector = new Map<string, SignalAnalysis[]>();
    for (const result of results) {
        if (!byDetector.has(result.detectorType)) {
            byDetector.set(result.detectorType, []);
        }
        byDetector.get(result.detectorType)!.push(result);
    }

    for (const [detector, signals] of byDetector) {
        const successful = signals.filter((s) => s.reachedTarget);
        console.log(`\n${detector.toUpperCase()} DETECTOR:`);
        console.log(`  Signals in "successful" log: ${signals.length}`);
        console.log(
            `  Actually reached 0.7% TP: ${successful.length} (${((successful.length / signals.length) * 100).toFixed(1)}%)`
        );
        console.log(
            `  Failed to reach TP: ${signals.length - successful.length}`
        );

        if (signals.length - successful.length > 0) {
            console.log("\n  Failed signals details:");
            for (const signal of signals.filter((s) => !s.reachedTarget)) {
                console.log(
                    `    ${signal.signalTimeLima}: ${signal.signalSide.toUpperCase()} @ $${signal.signalPrice.toFixed(2)}`
                );
                console.log(
                    `      Max movement: ${(signal.actualTPPercent * 100).toFixed(3)}% at ${signal.minutesToTP.toFixed(1)} min`
                );
            }
        }
    }

    console.log("\n" + "=".repeat(80));
}

// Run the analysis
analyzeSignals().catch(console.error);
