#!/usr/bin/env node
import * as fs from "fs/promises";

interface Signal {
    timestamp: number;
    signalSide: "buy" | "sell";
    price: number;

    // Threshold parameters
    minAggVolume?: number;
    priceEfficiencyThreshold?: number;
    maxAbsorptionRatio?: number;
    minPassiveMultiplier?: number;
    passiveAbsorptionThreshold?: number;
    finalConfidenceRequired?: number;
    confidence?: number;
}

interface PricePoint {
    timestamp: number;
    price: number;
}

interface SwingAnalysis {
    signal: Signal;
    outcomeType: "TP_0.7" | "TP_0.5" | "TP_0.3" | "Breakeven";

    // Timing metrics
    timeToMaxProfit: number; // Minutes to reach max profit
    maxProfit: number; // Maximum profit %

    // Price action characteristics
    volatilityDuringTrade: number; // Standard deviation of price during trade
    numberOfReversals: number; // Times price reversed direction
    avgReversalSize: number; // Average size of reversals

    // Exit timing analysis
    timeAt03Percent: number | null; // When reached 0.3%
    timeAt05Percent: number | null; // When reached 0.5%
    timeAt07Percent: number | null; // When reached 0.7%

    // Momentum metrics
    initialMomentum: number; // Price change in first 5 minutes
    momentum10min: number; // Price change in first 10 minutes
    momentum30min: number; // Price change in first 30 minutes

    // Signal strength parameters
    confidence: number;
    absorptionRatio: number;
    passiveMultiplier: number;

    // Market context
    priceRange90min: number; // Total price range in 90 minutes
    trendStrength: number; // Linear regression slope
}

async function readSignalData(filePath: string): Promise<Signal[]> {
    try {
        const content = await fs.readFile(filePath, "utf-8");
        const lines = content.trim().split("\n");
        if (lines.length < 2) return [];

        const headers = lines[0].split(",");
        const signals: Signal[] = [];

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(",");
            if (values.length < headers.length) continue;

            const signal: any = {};
            headers.forEach((header, idx) => {
                const value = values[idx];
                if (header === "signalSide") {
                    signal[header] = value;
                } else if (value && !isNaN(parseFloat(value))) {
                    signal[header] = parseFloat(value);
                }
            });

            if (signal.timestamp && signal.price) {
                signals.push(signal as Signal);
            }
        }

        return signals;
    } catch (error) {
        console.log(`Could not read file ${filePath}: ${error}`);
        return [];
    }
}

async function readPriceData(filePath: string): Promise<Map<number, number>> {
    const prices = new Map<number, number>();

    try {
        const content = await fs.readFile(filePath, "utf-8");
        const lines = content.trim().split("\n");
        if (lines.length < 2) return prices;

        const headers = lines[0].split(",");
        const timestampIdx = headers.indexOf("timestamp");
        const priceIdx = headers.indexOf("price");

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(",");
            const timestamp = parseInt(values[timestampIdx]);
            const price = parseFloat(values[priceIdx]);

            if (!isNaN(timestamp) && !isNaN(price)) {
                prices.set(timestamp, price);
            }
        }
    } catch (error) {
        console.log(`Could not read price data: ${error}`);
    }

    return prices;
}

function analyzeSwingCharacteristics(
    signal: Signal,
    prices: Map<number, number>
): SwingAnalysis | null {
    const entryTime = signal.timestamp;
    const entryPrice = signal.price;
    const isBuy = signal.signalSide === "buy";

    // Get price data for next 90 minutes
    const maxTime = entryTime + 90 * 60 * 1000;
    const priceData: PricePoint[] = [];

    for (const [timestamp, price] of prices) {
        if (timestamp > entryTime && timestamp <= maxTime) {
            priceData.push({ timestamp, price });
        }
    }

    if (priceData.length === 0) return null;

    // Sort by timestamp
    priceData.sort((a, b) => a.timestamp - b.timestamp);

    // Calculate key metrics
    let maxProfit = 0;
    let timeToMaxProfit = 0;
    let timeAt03Percent: number | null = null;
    let timeAt05Percent: number | null = null;
    let timeAt07Percent: number | null = null;

    let reversals = 0;
    let lastDirection = 0;
    let reversalSizes: number[] = [];
    let lastPrice = entryPrice;

    const priceMovements: number[] = [];

    for (const point of priceData) {
        const movement = (point.price - entryPrice) / entryPrice;
        const absoluteMovement = isBuy ? movement : -movement;

        priceMovements.push(point.price);

        // Track max profit
        if (absoluteMovement > maxProfit) {
            maxProfit = absoluteMovement;
            timeToMaxProfit = (point.timestamp - entryTime) / (60 * 1000);
        }

        // Track when we hit various targets
        if (timeAt03Percent === null && absoluteMovement >= 0.003) {
            timeAt03Percent = (point.timestamp - entryTime) / (60 * 1000);
        }
        if (timeAt05Percent === null && absoluteMovement >= 0.005) {
            timeAt05Percent = (point.timestamp - entryTime) / (60 * 1000);
        }
        if (timeAt07Percent === null && absoluteMovement >= 0.007) {
            timeAt07Percent = (point.timestamp - entryTime) / (60 * 1000);
        }

        // Track reversals
        const currentDirection = point.price > lastPrice ? 1 : -1;
        if (lastDirection !== 0 && currentDirection !== lastDirection) {
            reversals++;
            reversalSizes.push(Math.abs(point.price - lastPrice) / lastPrice);
        }
        lastDirection = currentDirection;
        lastPrice = point.price;

        // Stop if we hit stop loss
        if (absoluteMovement <= -0.0035) {
            break;
        }
    }

    // Calculate volatility
    const mean =
        priceMovements.reduce((a, b) => a + b, 0) / priceMovements.length;
    const variance =
        priceMovements.reduce(
            (sum, price) => sum + Math.pow(price - mean, 2),
            0
        ) / priceMovements.length;
    const volatility = Math.sqrt(variance) / entryPrice;

    // Calculate momentum at different intervals
    const getMovementAt = (minutes: number): number => {
        const targetTime = entryTime + minutes * 60 * 1000;
        const point = priceData.find((p) => p.timestamp >= targetTime);
        if (!point) return 0;
        const movement = (point.price - entryPrice) / entryPrice;
        return isBuy ? movement : -movement;
    };

    const initialMomentum = getMovementAt(5);
    const momentum10min = getMovementAt(10);
    const momentum30min = getMovementAt(30);

    // Calculate trend strength (linear regression slope)
    const n = priceData.length;
    const sumX = priceData.reduce((sum, _, i) => sum + i, 0);
    const sumY = priceData.reduce((sum, p) => sum + p.price, 0);
    const sumXY = priceData.reduce((sum, p, i) => sum + i * p.price, 0);
    const sumX2 = priceData.reduce((sum, _, i) => sum + i * i, 0);

    const trendStrength = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

    // Determine outcome type
    let outcomeType: SwingAnalysis["outcomeType"];
    if (maxProfit >= 0.007) {
        outcomeType = "TP_0.7";
    } else if (maxProfit >= 0.005) {
        outcomeType = "TP_0.5";
    } else if (maxProfit >= 0.003) {
        outcomeType = "TP_0.3";
    } else {
        outcomeType = "Breakeven";
    }

    // Price range
    const minPrice = Math.min(...priceMovements);
    const maxPrice = Math.max(...priceMovements);
    const priceRange90min = (maxPrice - minPrice) / entryPrice;

    return {
        signal,
        outcomeType,
        timeToMaxProfit,
        maxProfit,
        volatilityDuringTrade: volatility,
        numberOfReversals: reversals,
        avgReversalSize:
            reversalSizes.length > 0
                ? reversalSizes.reduce((a, b) => a + b, 0) /
                  reversalSizes.length
                : 0,
        timeAt03Percent,
        timeAt05Percent,
        timeAt07Percent,
        initialMomentum,
        momentum10min,
        momentum30min,
        confidence: signal.confidence || 0,
        absorptionRatio: signal.maxAbsorptionRatio || 0,
        passiveMultiplier: signal.minPassiveMultiplier || 0,
        priceRange90min,
        trendStrength: trendStrength * (isBuy ? 1 : -1),
    };
}

function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleString("en-US", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "America/Lima",
    });
}

async function analyzeExitPatterns(): Promise<void> {
    console.log("Loading signal and price data...");

    // Load all signals
    const successful = await readSignalData(
        "logs/signal_validation/absorption_successful_2025-08-12.csv"
    );
    const validated = await readSignalData(
        "logs/signal_validation/absorption_validation_2025-08-12.csv"
    );

    // Combine all signals
    const allSignals = [...successful, ...validated];
    console.log(`Analyzing ${allSignals.length} total signals`);

    // Load price data
    const prices = await readPriceData(
        "logs/signal_validation/absorption_rejected_missed_2025-08-12.csv"
    );
    console.log(`Loaded ${prices.size} price points`);

    // Analyze each signal
    const analyses: SwingAnalysis[] = [];

    for (const signal of allSignals) {
        const analysis = analyzeSwingCharacteristics(signal, prices);
        if (analysis) {
            analyses.push(analysis);
        }
    }

    console.log(`\nCompleted analysis of ${analyses.length} signals`);

    // Group by outcome type
    const byOutcome = {
        "TP_0.7": analyses.filter((a) => a.outcomeType === "TP_0.7"),
        "TP_0.5": analyses.filter((a) => a.outcomeType === "TP_0.5"),
        "TP_0.3": analyses.filter((a) => a.outcomeType === "TP_0.3"),
        Breakeven: analyses.filter((a) => a.outcomeType === "Breakeven"),
    };

    console.log("\n=== OUTCOME DISTRIBUTION ===");
    console.log(`0.7% TP reached: ${byOutcome["TP_0.7"].length} signals`);
    console.log(`0.5% TP reached: ${byOutcome["TP_0.5"].length} signals`);
    console.log(`0.3% TP reached: ${byOutcome["TP_0.3"].length} signals`);
    console.log(`Breakeven: ${byOutcome["Breakeven"].length} signals`);

    // Analyze patterns for each outcome type
    console.log("\n=== EXIT TIMING PATTERNS ===");

    for (const [outcome, signals] of Object.entries(byOutcome)) {
        if (signals.length === 0) continue;

        console.log(`\n${outcome} (${signals.length} signals):`);

        // Average timing metrics
        const avgTimeToMax =
            signals.reduce((sum, s) => sum + s.timeToMaxProfit, 0) /
            signals.length;
        const avgVolatility =
            signals.reduce((sum, s) => sum + s.volatilityDuringTrade, 0) /
            signals.length;
        const avgReversals =
            signals.reduce((sum, s) => sum + s.numberOfReversals, 0) /
            signals.length;

        console.log(
            `  Avg time to max profit: ${avgTimeToMax.toFixed(1)} minutes`
        );
        console.log(`  Avg volatility: ${(avgVolatility * 100).toFixed(4)}%`);
        console.log(`  Avg reversals: ${avgReversals.toFixed(1)}`);

        // Momentum analysis
        const avgInitialMomentum =
            signals.reduce((sum, s) => sum + s.initialMomentum, 0) /
            signals.length;
        const avg10minMomentum =
            signals.reduce((sum, s) => sum + s.momentum10min, 0) /
            signals.length;
        const avg30minMomentum =
            signals.reduce((sum, s) => sum + s.momentum30min, 0) /
            signals.length;

        console.log(
            `  Avg momentum (5 min): ${(avgInitialMomentum * 100).toFixed(3)}%`
        );
        console.log(
            `  Avg momentum (10 min): ${(avg10minMomentum * 100).toFixed(3)}%`
        );
        console.log(
            `  Avg momentum (30 min): ${(avg30minMomentum * 100).toFixed(3)}%`
        );

        // Signal strength metrics
        const avgConfidence =
            signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length;
        const avgAbsorption =
            signals.reduce((sum, s) => sum + s.absorptionRatio, 0) /
            signals.length;
        const avgPassive =
            signals.reduce((sum, s) => sum + s.passiveMultiplier, 0) /
            signals.length;

        console.log(`  Avg confidence: ${avgConfidence.toFixed(3)}`);
        console.log(`  Avg absorption ratio: ${avgAbsorption.toFixed(3)}`);
        console.log(`  Avg passive multiplier: ${avgPassive.toFixed(2)}`);
    }

    // Find distinguishing patterns
    console.log("\n=== KEY DISTINGUISHING PATTERNS ===");

    // Compare full TP vs early exit
    const fullTP = byOutcome["TP_0.7"];
    const earlyExit = [
        ...byOutcome["TP_0.5"],
        ...byOutcome["TP_0.3"],
        ...byOutcome["Breakeven"],
    ];

    if (fullTP.length > 0 && earlyExit.length > 0) {
        const fullTPAvg = {
            initialMomentum:
                fullTP.reduce((sum, s) => sum + s.initialMomentum, 0) /
                fullTP.length,
            momentum10min:
                fullTP.reduce((sum, s) => sum + s.momentum10min, 0) /
                fullTP.length,
            reversals:
                fullTP.reduce((sum, s) => sum + s.numberOfReversals, 0) /
                fullTP.length,
            confidence:
                fullTP.reduce((sum, s) => sum + s.confidence, 0) /
                fullTP.length,
            absorption:
                fullTP.reduce((sum, s) => sum + s.absorptionRatio, 0) /
                fullTP.length,
        };

        const earlyExitAvg = {
            initialMomentum:
                earlyExit.reduce((sum, s) => sum + s.initialMomentum, 0) /
                earlyExit.length,
            momentum10min:
                earlyExit.reduce((sum, s) => sum + s.momentum10min, 0) /
                earlyExit.length,
            reversals:
                earlyExit.reduce((sum, s) => sum + s.numberOfReversals, 0) /
                earlyExit.length,
            confidence:
                earlyExit.reduce((sum, s) => sum + s.confidence, 0) /
                earlyExit.length,
            absorption:
                earlyExit.reduce((sum, s) => sum + s.absorptionRatio, 0) /
                earlyExit.length,
        };

        console.log("\nFull TP (0.7%) vs Early Exit Comparison:");
        console.log(
            `  Initial momentum: ${(fullTPAvg.initialMomentum * 100).toFixed(3)}% vs ${(earlyExitAvg.initialMomentum * 100).toFixed(3)}%`
        );
        console.log(
            `  10-min momentum: ${(fullTPAvg.momentum10min * 100).toFixed(3)}% vs ${(earlyExitAvg.momentum10min * 100).toFixed(3)}%`
        );
        console.log(
            `  Reversals: ${fullTPAvg.reversals.toFixed(1)} vs ${earlyExitAvg.reversals.toFixed(1)}`
        );
        console.log(
            `  Confidence: ${fullTPAvg.confidence.toFixed(3)} vs ${earlyExitAvg.confidence.toFixed(3)}`
        );
        console.log(
            `  Absorption: ${fullTPAvg.absorption.toFixed(3)} vs ${earlyExitAvg.absorption.toFixed(3)}`
        );

        // Suggest exit rules
        console.log("\n=== SUGGESTED EXIT RULES ===");

        // Rule 1: Momentum-based exit
        if (fullTPAvg.momentum10min > earlyExitAvg.momentum10min * 1.5) {
            console.log(
                "1. Hold for full TP if 10-min momentum > " +
                    (fullTPAvg.momentum10min * 100 * 0.8).toFixed(3) +
                    "%"
            );
        }

        // Rule 2: Reversal-based exit
        if (earlyExitAvg.reversals > fullTPAvg.reversals * 1.5) {
            console.log(
                "2. Exit early if reversals > " +
                    Math.floor(fullTPAvg.reversals * 1.3)
            );
        }

        // Rule 3: Time-based trailing stop
        console.log("3. Implement trailing stop after reaching 0.3% profit");
        console.log(
            "4. Tighten stop to breakeven after 30 minutes if profit < 0.5%"
        );
    }

    // Generate HTML report
    await generateHTMLReport(analyses, byOutcome);
}

async function generateHTMLReport(
    analyses: SwingAnalysis[],
    byOutcome: { [key: string]: SwingAnalysis[] }
): Promise<void> {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Exit Timing Pattern Analysis</title>
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
        }
        td {
            padding: 8px;
            border-bottom: 1px solid #444;
        }
        .good { color: #4CAF50; }
        .neutral { color: #ffa726; }
        .bad { color: #f44336; }
        .stat { font-size: 24px; font-weight: bold; }
    </style>
</head>
<body>
    <h1>Exit Timing Pattern Analysis</h1>
    
    <div class="summary">
        <h2>Signal Distribution by Outcome</h2>
        <p>0.7% TP reached: <span class="good stat">${byOutcome["TP_0.7"].length}</span> signals</p>
        <p>0.5% TP reached: <span class="good">${byOutcome["TP_0.5"].length}</span> signals</p>
        <p>0.3% TP reached: <span class="neutral">${byOutcome["TP_0.3"].length}</span> signals</p>
        <p>Breakeven: <span class="neutral">${byOutcome["Breakeven"].length}</span> signals</p>
    </div>
    
    <h2>Detailed Signal Analysis</h2>
    <table>
        <tr>
            <th>Time</th>
            <th>Side</th>
            <th>Price</th>
            <th>Outcome</th>
            <th>Max Profit</th>
            <th>Time to Max</th>
            <th>5min Mom</th>
            <th>10min Mom</th>
            <th>Reversals</th>
            <th>Confidence</th>
        </tr>
        ${analyses
            .slice(0, 50)
            .map(
                (a) => `
        <tr>
            <td>${formatTime(a.signal.timestamp)}</td>
            <td class="${a.signal.signalSide === "buy" ? "good" : "bad"}">${a.signal.signalSide.toUpperCase()}</td>
            <td>$${a.signal.price.toFixed(2)}</td>
            <td class="${a.outcomeType === "TP_0.7" ? "good" : a.outcomeType === "Breakeven" ? "neutral" : ""}">${a.outcomeType}</td>
            <td>${(a.maxProfit * 100).toFixed(3)}%</td>
            <td>${a.timeToMaxProfit.toFixed(1)}m</td>
            <td>${(a.initialMomentum * 100).toFixed(3)}%</td>
            <td>${(a.momentum10min * 100).toFixed(3)}%</td>
            <td>${a.numberOfReversals}</td>
            <td>${a.confidence.toFixed(3)}</td>
        </tr>`
            )
            .join("")}
    </table>
    
    <p style="margin-top: 40px; color: #888; font-size: 12px;">
        Generated: ${new Date().toISOString()}
    </p>
</body>
</html>`;

    await fs.writeFile("exit_timing_patterns.html", html);
    console.log("\n✅ HTML report saved to: exit_timing_patterns.html");
}

// Run the analysis
analyzeExitPatterns().catch(console.error);
