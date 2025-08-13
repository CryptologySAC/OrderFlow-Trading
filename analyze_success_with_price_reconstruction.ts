#!/usr/bin/env node
/**
 * Analyzes successful signals and reconstructs actual price movements
 * to verify if they truly reached their profit targets within 90 minutes.
 *
 * Usage:
 *   npx tsx analyze_success_with_price_reconstruction.ts [YYYY-MM-DD]
 *
 * Examples:
 *   npx tsx analyze_success_with_price_reconstruction.ts              # Uses today's date
 *   npx tsx analyze_success_with_price_reconstruction.ts 2025-08-12   # Specific date
 */
import * as fs from "fs/promises";
import { getAnalysisDate } from "./utils/getAnalysisDate";

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

interface SwingData {
    id: number;
    direction: "UP" | "DOWN";
    startPrice: number;
    endPrice: number;
    startTime: number;
    endTime: number;
    sizePercent: number;
    signals: SignalAnalysis[];
}

function identifySwings(allPrices: Map<number, number>, signals: SignalAnalysis[]): SwingData[] {
    if (allPrices.size === 0) return [];
    
    // Convert to sorted array
    const prices = Array.from(allPrices.entries())
        .sort(([a], [b]) => a - b)
        .map(([timestamp, price]) => ({ timestamp, price }));
    
    const swings: SwingData[] = [];
    let swingId = 1;
    
    // Find initial direction
    let currentHigh = prices[0];
    let currentLow = prices[0];
    let lastSwingLow = prices[0];
    let lastSwingHigh = prices[0];
    let currentDirection: "UP" | "DOWN" = "UP";
    
    for (let i = 1; i < prices.length; i++) {
        const point = prices[i];
        
        // Track current high/low
        if (point.price > currentHigh.price) {
            currentHigh = point;
        }
        if (point.price < currentLow.price) {
            currentLow = point;
        }
        
        if (currentDirection === "UP") {
            // In uptrend, look for lower low to end swing
            if (point.price < lastSwingLow.price) {
                // Swing ended - create UP swing from last low to high
                const sizePercent = (currentHigh.price - lastSwingLow.price) / lastSwingLow.price;
                
                swings.push({
                    id: swingId++,
                    direction: "UP",
                    startPrice: lastSwingLow.price,
                    endPrice: currentHigh.price,
                    startTime: lastSwingLow.timestamp,
                    endTime: currentHigh.timestamp,
                    sizePercent: sizePercent,
                    signals: []
                });
                
                // Start new DOWN swing
                currentDirection = "DOWN";
                lastSwingHigh = currentHigh;
                currentLow = point;
                lastSwingLow = point;
            }
        } else {
            // In downtrend, look for higher high to end swing
            if (point.price > lastSwingHigh.price) {
                // Swing ended - create DOWN swing from last high to low
                const sizePercent = (lastSwingHigh.price - currentLow.price) / lastSwingHigh.price;
                
                swings.push({
                    id: swingId++,
                    direction: "DOWN",
                    startPrice: lastSwingHigh.price,
                    endPrice: currentLow.price,
                    startTime: lastSwingHigh.timestamp,
                    endTime: currentLow.timestamp,
                    sizePercent: sizePercent,
                    signals: []
                });
                
                // Start new UP swing
                currentDirection = "UP";
                lastSwingLow = currentLow;
                currentHigh = point;
                lastSwingHigh = point;
            }
        }
    }
    
    // Add final swing
    if (currentDirection === "UP" && currentHigh.timestamp > lastSwingLow.timestamp) {
        const sizePercent = (currentHigh.price - lastSwingLow.price) / lastSwingLow.price;
        swings.push({
            id: swingId++,
            direction: "UP",
            startPrice: lastSwingLow.price,
            endPrice: currentHigh.price,
            startTime: lastSwingLow.timestamp,
            endTime: currentHigh.timestamp,
            sizePercent: sizePercent,
            signals: []
        });
    } else if (currentDirection === "DOWN" && currentLow.timestamp > lastSwingHigh.timestamp) {
        const sizePercent = (lastSwingHigh.price - currentLow.price) / lastSwingHigh.price;
        swings.push({
            id: swingId++,
            direction: "DOWN",
            startPrice: lastSwingHigh.price,
            endPrice: currentLow.price,
            startTime: lastSwingHigh.timestamp,
            endTime: currentLow.timestamp,
            sizePercent: sizePercent,
            signals: []
        });
    }
    
    // Assign signals to swings
    for (const signal of signals) {
        const swing = swings.find(s => 
            signal.signalTimestamp >= s.startTime && 
            signal.signalTimestamp <= s.endTime
        );
        if (swing) {
            swing.signals.push(signal);
        }
    }
    
    return swings.filter(s => s.signals.length > 0); // Only return swings with signals
}

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
    // Get date from command line or use today
    const dateStr = getAnalysisDate();
    console.log(`Analyzing signals for date: ${dateStr}`);

    // Load all price data from rejected logs
    console.log("Loading price data from rejected logs...");
    const absorptionPrices = await extractPriceData(
        `logs/signal_validation/absorption_rejected_missed_${dateStr}.csv`
    );
    const exhaustionPrices = await extractPriceData(
        `logs/signal_validation/exhaustion_rejected_missed_${dateStr}.csv`
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
        `logs/signal_validation/absorption_successful_${dateStr}.csv`,
        `logs/signal_validation/exhaustion_successful_${dateStr}.csv`,
        `logs/signal_validation/deltacvd_successful_${dateStr}.csv`,
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

            // Calculate target price (what system uses for validation)
            const targetPrice =
                signal.signalSide === "buy"
                    ? signal.price * (1 + TARGET_PERCENT)
                    : signal.price * (1 - TARGET_PERCENT);

            // Check if target was actually HIT (system logic)
            let targetWasHit = false;
            let actualTPPrice = bestPrice;
            
            for (const point of windowPrices) {
                if (signal.signalSide === "buy" && point.price >= targetPrice) {
                    targetWasHit = true;
                    actualTPPrice = point.price;
                    break; // First time target was hit
                }
                if (signal.signalSide === "sell" && point.price <= targetPrice) {
                    targetWasHit = true;
                    actualTPPrice = point.price;
                    break; // First time target was hit
                }
            }

            // Calculate the actual TP percentage ONLY if target was hit
            const actualTPPercent = targetWasHit 
                ? (signal.signalSide === "buy"
                    ? (actualTPPrice - signal.price) / signal.price
                    : (signal.price - actualTPPrice) / signal.price)
                : (signal.signalSide === "buy"
                    ? (bestPrice - signal.price) / signal.price
                    : (signal.price - bestPrice) / signal.price);

            // Calculate max adverse movement (drawdown)
            const maxAdversePercent =
                signal.signalSide === "buy"
                    ? (signal.price - worstPriceBeforeTP) / signal.price
                    : (worstPriceBeforeTP - signal.price) / signal.price;

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
                reachedTarget: targetWasHit, // Use system validation logic
                maxAdversePrice: worstPriceBeforeTP,
                maxAdversePercent: maxAdversePercent,
            });
        }
    }

    // Identify swings and group signals
    const swings = identifySwings(allPrices, results);
    
    // Generate HTML report with swing grouping
    await generateHTMLReport(results, swings);

    // Print swing-grouped summary
    printSwingSummary(swings);
}

async function generateHTMLReport(results: SignalAnalysis[], swings: SwingData[]): Promise<void> {
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
    <h1>Successful Signals - Grouped By Market Swings</h1>
    <div class="summary">
        <p><strong>Target Movement:</strong> 0.7% | <strong>Time Window:</strong> 90 minutes | <strong>Timezone:</strong> Lima (UTC-5)</p>
        <p><strong>Analysis:</strong> Signals grouped by market structure swings, showing which signals captured the same price movement</p>
    </div>
    
    ${swings.length > 0 ? swings.map(swing => `
    <h2>Swing #${swing.id}: ${swing.direction} ${swing.direction === 'UP' ? '↑' : '↓'} $${swing.startPrice.toFixed(2)} → $${swing.endPrice.toFixed(2)} (${(swing.sizePercent * 100).toFixed(2)}%)</h2>
    <p><strong>Duration:</strong> ${convertToLimaTime(swing.startTime)} → ${convertToLimaTime(swing.endTime)} | <strong>Signals:</strong> ${swing.signals.length}</p>
    
    <table>
        <tr>
            <th>Signal Type</th>
            <th>Signal Time</th>
            <th>Signal Price</th>
            <th>Side</th>
            <th>Target TP</th>
            <th>Max Price</th>
            <th>Actual TP %</th>
            <th>Minutes to TP</th>
            <th>Reached 0.7%?</th>
        </tr>
        ${swing.signals
            .sort((a, b) => a.signalTimestamp - b.signalTimestamp)
            .map(signal => `
        <tr>
            <td>${signal.detectorType.toUpperCase()}</td>
            <td>${signal.signalTimeLima}</td>
            <td class="price">$${signal.signalPrice.toFixed(2)}</td>
            <td class="${signal.signalSide}">${signal.signalSide.toUpperCase()}</td>
            <td class="price">$${signal.targetTPPrice.toFixed(2)}</td>
            <td class="price">$${signal.actualMaxPrice.toFixed(2)}</td>
            <td class="percent ${signal.reachedTarget ? "success" : "failure"}">${(signal.actualTPPercent * 100).toFixed(3)}%</td>
            <td>${signal.minutesToTP.toFixed(1)} min</td>
            <td class="${signal.reachedTarget ? "success" : "failure"}">${signal.reachedTarget ? "✅ YES" : "❌ NO"}</td>
        </tr>`)
            .join("")}
    </table>
    <p><strong>Swing Result:</strong> ${swing.signals.filter(s => s.reachedTarget).length}/${swing.signals.length} signals successful (${((swing.signals.filter(s => s.reachedTarget).length / swing.signals.length) * 100).toFixed(1)}%)</p>
    `).join('') : '<p>No swings identified with signals.</p>'}
    
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

function printSwingSummary(swings: SwingData[]): void {
    console.log("\n" + "=".repeat(80));
    console.log("SUCCESSFUL SIGNALS - GROUPED BY MARKET SWINGS");
    console.log("=".repeat(80));

    if (swings.length === 0) {
        console.log("No swings identified with signals.");
        return;
    }

    for (const swing of swings) {
        const successful = swing.signals.filter(s => s.reachedTarget);
        const successRate = ((successful.length / swing.signals.length) * 100).toFixed(1);
        
        console.log(`\nSWING #${swing.id}: ${swing.direction} ${swing.direction === 'UP' ? '↑' : '↓'} $${swing.startPrice.toFixed(2)} → $${swing.endPrice.toFixed(2)} (${(swing.sizePercent * 100).toFixed(2)}%)`);
        console.log(`Duration: ${convertToLimaTime(swing.startTime)} → ${convertToLimaTime(swing.endTime)}`);
        console.log(`Signals: ${swing.signals.length} | Successful: ${successful.length} (${successRate}%)`);
        
        // Sort signals by timestamp
        const sortedSignals = swing.signals.sort((a, b) => a.signalTimestamp - b.signalTimestamp);
        
        for (const signal of sortedSignals) {
            const result = signal.reachedTarget ? "✅ TP" : "❌ Failed";
            console.log(`  [${signal.detectorType.toUpperCase()}] ${signal.signalTimeLima} ${signal.signalSide.toUpperCase()} @ $${signal.signalPrice.toFixed(2)} → ${result} (${(signal.actualTPPercent * 100).toFixed(3)}%)`);
        }
    }

    console.log("\n" + "=".repeat(80));
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
