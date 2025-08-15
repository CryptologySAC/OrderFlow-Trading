#!/usr/bin/env node
/**
 * Analyzes successful signals and reconstructs actual price movements
 * to verify if they truly reached their profit targets within 90 minutes.
 *
 * Updated to work with JSON Lines format (.jsonl) instead of CSV
 *
 * Usage:
 *   npx tsx analysis/analyze_success_with_price_reconstruction.ts [YYYY-MM-DD]
 *
 * Examples:
 *   npx tsx analysis/analyze_success_with_price_reconstruction.ts              # Uses today's date
 *   npx tsx analysis/analyze_success_with_price_reconstruction.ts 2025-08-12   # Specific date
 */
import * as fs from "fs/promises";
import { getAnalysisDate } from "../utils/getAnalysisDate";
import { FinancialMath } from "../src/utils/financialMath";

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

interface SignalCluster {
    id: number;
    signals: SignalAnalysis[];
    avgPrice: number;
    priceRange: number;
    startTime: number;
    endTime: number;
    detector: string;
    side: "buy" | "sell";
}

interface TradingPhase {
    id: number;
    clusters: SignalCluster[];
    direction: "UP" | "DOWN";
    startPrice: number;
    endPrice: number;
    startTime: number;
    endTime: number;
    sizePercent: number;
    tpLevel: number;
    allSignalsSuccessful: boolean;
    consolidationAfter?: {
        startPrice: number;
        endPrice: number;
        duration: number;
    };
}

// Legacy interface for backwards compatibility
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

// Constants for phase detection
const PHASE_DETECTION_CONFIG = {
    CLUSTER_TIME_WINDOW: 5 * 60 * 1000, // 5 minutes
    CLUSTER_PRICE_PROXIMITY: 0.002, // 0.2% price range
    PHASE_GAP_THRESHOLD: 15 * 60 * 1000, // 15 minutes between phases
    RETRACEMENT_THRESHOLD: 0.003, // 0.3% retracement starts new phase
    TARGET_PERCENT: 0.007, // 0.7% target
};

function identifySignalClusters(signals: SignalAnalysis[]): SignalCluster[] {
    if (signals.length === 0) return [];

    const sortedSignals = [...signals].sort(
        (a, b) => a.signalTimestamp - b.signalTimestamp
    );
    const clusters: SignalCluster[] = [];
    let clusterId = 1;

    let currentCluster: SignalAnalysis[] = [sortedSignals[0]];

    for (let i = 1; i < sortedSignals.length; i++) {
        const current = sortedSignals[i];
        const lastInCluster = currentCluster[currentCluster.length - 1];

        const timeDiff =
            current.signalTimestamp - lastInCluster.signalTimestamp;
        const priceDiff =
            Math.abs(current.signalPrice - lastInCluster.signalPrice) /
            lastInCluster.signalPrice;

        // Check if signal belongs to current cluster
        if (
            timeDiff <= PHASE_DETECTION_CONFIG.CLUSTER_TIME_WINDOW &&
            priceDiff <= PHASE_DETECTION_CONFIG.CLUSTER_PRICE_PROXIMITY &&
            current.signalSide === lastInCluster.signalSide
        ) {
            currentCluster.push(current);
        } else {
            // Finalize current cluster and start new one
            if (currentCluster.length > 0) {
                clusters.push(
                    createClusterFromSignals(currentCluster, clusterId++)
                );
            }
            currentCluster = [current];
        }
    }

    // Add final cluster
    if (currentCluster.length > 0) {
        clusters.push(createClusterFromSignals(currentCluster, clusterId++));
    }

    return clusters;
}

function createClusterFromSignals(
    signals: SignalAnalysis[],
    id: number
): SignalCluster {
    const prices = signals.map((s) => s.signalPrice);
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const priceRange = Math.max(...prices) - Math.min(...prices);

    return {
        id,
        signals,
        avgPrice,
        priceRange,
        startTime: Math.min(...signals.map((s) => s.signalTimestamp)),
        endTime: Math.max(...signals.map((s) => s.signalTimestamp)),
        detector: signals[0].detectorType,
        side: signals[0].signalSide,
    };
}

function identifyTradingPhases(
    clusters: SignalCluster[],
    allPrices: Map<number, number>
): TradingPhase[] {
    if (clusters.length === 0) return [];

    const phases: TradingPhase[] = [];
    let phaseId = 1;
    let currentPhaseClusters: SignalCluster[] = [clusters[0]];

    for (let i = 1; i < clusters.length; i++) {
        const current = clusters[i];
        const lastPhase = currentPhaseClusters[currentPhaseClusters.length - 1];

        // Check if current cluster starts a new phase
        if (shouldStartNewPhase(current, lastPhase, allPrices)) {
            // Finalize current phase
            phases.push(
                createPhaseFromClusters(
                    currentPhaseClusters,
                    phaseId++,
                    allPrices
                )
            );
            currentPhaseClusters = [current];
        } else {
            currentPhaseClusters.push(current);
        }
    }

    // Add final phase
    if (currentPhaseClusters.length > 0) {
        phases.push(
            createPhaseFromClusters(currentPhaseClusters, phaseId++, allPrices)
        );
    }

    return phases;
}

function shouldStartNewPhase(
    currentCluster: SignalCluster,
    lastCluster: SignalCluster,
    allPrices: Map<number, number>
): boolean {
    // Time gap check
    const timeGap = currentCluster.startTime - lastCluster.endTime;
    if (timeGap > PHASE_DETECTION_CONFIG.PHASE_GAP_THRESHOLD) {
        return true;
    }

    // Price retracement check
    const retracement = calculateRetracementBetweenClusters(
        lastCluster,
        currentCluster,
        allPrices
    );
    if (retracement > PHASE_DETECTION_CONFIG.RETRACEMENT_THRESHOLD) {
        return true;
    }

    // Detector type change with significant price difference
    const priceDiff =
        Math.abs(currentCluster.avgPrice - lastCluster.avgPrice) /
        lastCluster.avgPrice;
    if (
        currentCluster.detector !== lastCluster.detector &&
        priceDiff > PHASE_DETECTION_CONFIG.CLUSTER_PRICE_PROXIMITY * 2
    ) {
        return true;
    }

    return false;
}

function calculateRetracementBetweenClusters(
    cluster1: SignalCluster,
    cluster2: SignalCluster,
    allPrices: Map<number, number>
): number {
    // Find price extremes between clusters
    const startTime = cluster1.endTime;
    const endTime = cluster2.startTime;

    // If no price data available, use simple price difference
    if (allPrices.size === 0) {
        return (
            Math.abs(cluster2.avgPrice - cluster1.avgPrice) / cluster1.avgPrice
        );
    }

    let extremePrice = cluster1.avgPrice;
    for (const [timestamp, price] of allPrices) {
        if (timestamp > startTime && timestamp < endTime) {
            if (cluster1.side === "sell") {
                // For sell signals, look for bounce (higher prices)
                extremePrice = Math.max(extremePrice, price);
            } else {
                // For buy signals, look for dip (lower prices)
                extremePrice = Math.min(extremePrice, price);
            }
        }
    }

    // Calculate retracement percentage
    const retracement =
        Math.abs(extremePrice - cluster1.avgPrice) / cluster1.avgPrice;
    return retracement;
}

function createPhaseFromClusters(
    clusters: SignalCluster[],
    id: number,
    allPrices: Map<number, number>
): TradingPhase {
    const allSignals = clusters.flatMap((c) => c.signals);
    if (allSignals.length === 0) {
        throw new Error("Cannot create phase from empty signal clusters");
    }

    // Get the time range of all signals
    const startTime = Math.min(...clusters.map((c) => c.startTime));
    const endTime = Math.max(...clusters.map((c) => c.endTime));

    // For phase start price: Use the HIGHEST signal entry price (where market was when signals fired)
    const signalPrices = allSignals.map((s) => s.signalPrice);
    const firstSignal = allSignals[0];

    let startPrice: number;
    let endPrice: number;

    if (firstSignal.signalSide === "sell") {
        // For sell signals: phase starts at highest entry, ends at lowest reached
        startPrice = Math.max(...signalPrices); // Highest entry price
        endPrice = Math.min(...allSignals.map((s) => s.actualMaxPrice)); // Lowest price reached
    } else {
        // For buy signals: phase starts at lowest entry, ends at highest reached
        startPrice = Math.min(...signalPrices); // Lowest entry price
        endPrice = Math.max(...allSignals.map((s) => s.actualMaxPrice)); // Highest price reached
    }

    // Use FinancialMath for accurate percentage calculation
    const sizePercent =
        Math.abs(
            FinancialMath.calculatePercentageChange(startPrice, endPrice, 0)
        ) / 100;

    // Calculate TP level based on first signal
    const tpLevel =
        firstSignal.signalSide === "buy"
            ? firstSignal.signalPrice *
              (1 + PHASE_DETECTION_CONFIG.TARGET_PERCENT)
            : firstSignal.signalPrice *
              (1 - PHASE_DETECTION_CONFIG.TARGET_PERCENT);

    const direction = firstSignal.signalSide === "buy" ? "UP" : "DOWN";
    const allSuccessful = allSignals.every((s) => s.reachedTarget);

    return {
        id,
        clusters,
        direction,
        startPrice,
        endPrice,
        startTime,
        endTime,
        sizePercent,
        tpLevel,
        allSignalsSuccessful: allSuccessful,
    };
}

function identifySwings(
    allPrices: Map<number, number>,
    signals: SignalAnalysis[]
): SwingData[] {
    // New phase-based approach
    const clusters = identifySignalClusters(signals);
    const phases = identifyTradingPhases(clusters, allPrices);

    // Convert phases to legacy SwingData format for compatibility
    return phases.map((phase) => ({
        id: phase.id,
        direction: phase.direction,
        startPrice: phase.startPrice,
        endPrice: phase.endPrice,
        startTime: phase.startTime,
        endTime: phase.endTime,
        sizePercent: phase.sizePercent,
        signals: phase.clusters.flatMap((c) => c.signals),
    }));
}

/**
 * Read successful signals from JSON Lines format
 */
async function readSuccessfulSignals(
    filePath: string
): Promise<SuccessfulSignal[]> {
    try {
        const content = await fs.readFile(filePath, "utf-8");
        const lines = content.trim().split("\n");
        if (lines.length === 0) return [];

        const signals: SuccessfulSignal[] = [];

        for (const line of lines) {
            if (!line.trim()) continue;

            try {
                const jsonRecord = JSON.parse(line);

                signals.push({
                    timestamp: jsonRecord.timestamp,
                    detectorType: jsonRecord.detectorType,
                    signalSide: jsonRecord.signalSide,
                    price: jsonRecord.price,
                });
            } catch (parseError) {
                console.warn(
                    `Failed to parse line in ${filePath}: ${line.substring(0, 100)}...`
                );
                continue;
            }
        }

        return signals;
    } catch (error) {
        console.log(`Could not read file ${filePath}`);
        return [];
    }
}

/**
 * Extract price data from JSON Lines rejection logs
 */
async function extractPriceData(
    rejectedFilePath: string
): Promise<Map<number, number>> {
    const priceMap = new Map<number, number>();

    try {
        const content = await fs.readFile(rejectedFilePath, "utf-8");
        const lines = content.trim().split("\n");
        if (lines.length === 0) return priceMap;

        for (const line of lines) {
            if (!line.trim()) continue;

            try {
                const jsonRecord = JSON.parse(line);

                const timestamp = jsonRecord.timestamp;
                const price = jsonRecord.price;

                if (timestamp && price && !isNaN(timestamp) && !isNaN(price)) {
                    priceMap.set(timestamp, price);
                }
            } catch (parseError) {
                // Skip malformed lines
                continue;
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

    // Load all price data from rejected logs (now JSON Lines)
    console.log("Loading price data from rejected logs...");
    const absorptionPrices = await extractPriceData(
        `logs/signal_validation/absorption_rejected_missed_${dateStr}.jsonl`
    );
    const exhaustionPrices = await extractPriceData(
        `logs/signal_validation/exhaustion_rejected_missed_${dateStr}.jsonl`
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
        `logs/signal_validation/absorption_successful_${dateStr}.jsonl`,
        `logs/signal_validation/exhaustion_successful_${dateStr}.jsonl`,
        `logs/signal_validation/deltacvd_successful_${dateStr}.jsonl`,
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

            // Check if target was actually HIT for validation
            let targetWasHit = false;
            for (const point of windowPrices) {
                if (signal.signalSide === "buy" && point.price >= targetPrice) {
                    targetWasHit = true;
                    break;
                }
                if (
                    signal.signalSide === "sell" &&
                    point.price <= targetPrice
                ) {
                    targetWasHit = true;
                    break;
                }
            }

            // Calculate the ACTUAL maximum movement achieved (not capped at 0.7%)
            // Use FinancialMath for accurate calculation
            const actualTPPercent =
                signal.signalSide === "buy"
                    ? Math.abs(
                          FinancialMath.calculatePercentageChange(
                              signal.price,
                              bestPrice,
                              0
                          )
                      ) / 100
                    : Math.abs(
                          FinancialMath.calculatePercentageChange(
                              signal.price,
                              bestPrice,
                              0
                          )
                      ) / 100;

            // Calculate max adverse movement (drawdown)
            // Use FinancialMath for accurate calculation
            const maxAdversePercent =
                signal.signalSide === "buy"
                    ? Math.abs(
                          FinancialMath.calculatePercentageChange(
                              signal.price,
                              worstPriceBeforeTP,
                              0
                          )
                      ) / 100
                    : Math.abs(
                          FinancialMath.calculatePercentageChange(
                              signal.price,
                              worstPriceBeforeTP,
                              0
                          )
                      ) / 100;

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

    // Generate HTML report with phase grouping
    await generateHTMLReport(results, swings);

    // Print phase-grouped summary
    printSwingSummary(swings);
}

async function generateHTMLReport(
    results: SignalAnalysis[],
    swings: SwingData[]
): Promise<void> {
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
    <h1>Successful Signals - Grouped By Trading Phases</h1>
    <div class="summary">
        <p><strong>Target Movement:</strong> 0.7% | <strong>Time Window:</strong> 90 minutes | <strong>Timezone:</strong> Lima (UTC-5)</p>
        <p><strong>Analysis:</strong> Signals grouped by trading phases with cluster detection. Phases separated by 15+ min gaps or 0.3%+ retracements.</p>
        <p><strong>Data Format:</strong> Updated to use JSON Lines (.jsonl) format for improved data integrity</p>
    </div>
    
    ${
        swings.length > 0
            ? swings
                  .map((swing) => {
                      const clusters = identifySignalClusters(swing.signals);
                      return `
    <h2>Phase #${swing.id}: ${swing.direction} ${swing.direction === "UP" ? "↑" : "↓"} $${swing.startPrice.toFixed(2)} → $${swing.endPrice.toFixed(2)} (${(swing.sizePercent * 100).toFixed(2)}%)</h2>
    <p><strong>Duration:</strong> ${convertToLimaTime(swing.startTime)} → ${convertToLimaTime(swing.endTime)} | <strong>Signals:</strong> ${swing.signals.length} | <strong>Clusters:</strong> ${clusters.length}</p>
    
    ${clusters
        .map(
            (cluster) => `
    <h3 style="color: #FFA726; margin-left: 20px;">📊 Cluster ${cluster.id}: ${cluster.detector.toUpperCase()} (${cluster.signals.length} signals)</h3>
    <p style="margin-left: 20px; color: #CCC;"><strong>Price Range:</strong> $${Math.min(...cluster.signals.map((s) => s.signalPrice)).toFixed(2)} - $${Math.max(...cluster.signals.map((s) => s.signalPrice)).toFixed(2)} | <strong>Time:</strong> ${convertToLimaTime(cluster.startTime)} → ${convertToLimaTime(cluster.endTime)}</p>`
        )
        .join("")}
    
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
            .map(
                (signal) => `
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
        </tr>`
            )
            .join("")}
    </table>
    <p><strong>Phase Result:</strong> ${swing.signals.filter((s) => s.reachedTarget).length}/${swing.signals.length} signals successful (${((swing.signals.filter((s) => s.reachedTarget).length / swing.signals.length) * 100).toFixed(1)}%) | <strong>Avg Cluster Size:</strong> ${(swing.signals.length / clusters.length).toFixed(1)} signals</p>
    `;
                  })
                  .join("")
            : "<p>No phases identified with signals.</p>"
    }
    
    <div class="summary">
        <h2>Summary</h2>
        <p>Total Signals in "Successful" Logs: <strong>${results.length}</strong></p>
        <p>Actually Reached 0.7% Target: <strong>${results.filter((r) => r.reachedTarget).length}</strong></p>
        <p>Failed to Reach Target: <strong>${results.filter((r) => !r.reachedTarget).length}</strong></p>
        <p>Success Rate: <strong>${results.length > 0 ? ((results.filter((r) => r.reachedTarget).length / results.length) * 100).toFixed(1) : 0}%</strong></p>
    </div>
    
    <p style="margin-top: 40px; color: #888; font-size: 12px;">
        Generated: ${new Date().toISOString()}<br>
        Price data source: Reconstructed from rejected_missed log files (JSON Lines format)<br>
        Output location: analysis/reports/
    </p>
</body>
</html>`;

    const reportPath =
        "analysis/reports/successful_signals_actual_tp_analysis.html";
    await fs.writeFile(reportPath, html);
    console.log(`\n✅ HTML report saved to: ${reportPath}`);
}

function printSwingSummary(phases: SwingData[]): void {
    console.log("\n" + "=".repeat(80));
    console.log("SUCCESSFUL SIGNALS - GROUPED BY TRADING PHASES");
    console.log("=".repeat(80));

    if (phases.length === 0) {
        console.log("No trading phases identified with signals.");
        return;
    }

    for (const phase of phases) {
        const clusters = identifySignalClusters(phase.signals);
        const successful = phase.signals.filter((s) => s.reachedTarget);
        const successRate = (
            (successful.length / phase.signals.length) *
            100
        ).toFixed(1);

        console.log(
            `\nPHASE #${phase.id}: ${phase.direction} ${phase.direction === "UP" ? "↑" : "↓"} $${phase.startPrice.toFixed(2)} → $${phase.endPrice.toFixed(2)} (${(phase.sizePercent * 100).toFixed(2)}%)`
        );
        console.log(
            `Duration: ${convertToLimaTime(phase.startTime)} → ${convertToLimaTime(phase.endTime)}`
        );
        console.log(
            `Signals: ${phase.signals.length} | Clusters: ${clusters.length} | Successful: ${successful.length} (${successRate}%)`
        );
        console.log(
            `Avg cluster size: ${(phase.signals.length / clusters.length).toFixed(1)} signals`
        );

        // Show clusters
        for (const cluster of clusters) {
            const clusterSuccess = cluster.signals.filter(
                (s) => s.reachedTarget
            ).length;
            const clusterRate = (
                (clusterSuccess / cluster.signals.length) *
                100
            ).toFixed(1);

            console.log(
                `\n  📊 CLUSTER ${cluster.id}: ${cluster.detector.toUpperCase()} (${cluster.signals.length} signals, ${clusterRate}% success)`
            );
            console.log(
                `     Price range: $${Math.min(...cluster.signals.map((s) => s.signalPrice)).toFixed(2)} - $${Math.max(...cluster.signals.map((s) => s.signalPrice)).toFixed(2)}`
            );
            console.log(
                `     Time: ${convertToLimaTime(cluster.startTime)} → ${convertToLimaTime(cluster.endTime)} (${Math.round((cluster.endTime - cluster.startTime) / (60 * 1000))} min)`
            );

            // Show first few signals in cluster
            const displaySignals = cluster.signals.slice(0, 3);
            for (const signal of displaySignals) {
                const result = signal.reachedTarget ? "✅ TP" : "❌ Failed";
                console.log(
                    `     [${signal.detectorType.toUpperCase()}] ${convertToLimaTime(signal.signalTimestamp).slice(-8)} @ $${signal.signalPrice.toFixed(2)} → ${result} (${(signal.actualTPPercent * 100).toFixed(3)}%)`
                );
            }
            if (cluster.signals.length > 3) {
                console.log(
                    `     ... and ${cluster.signals.length - 3} more signals`
                );
            }
        }

        console.log(""); // Add space between phases
    }

    console.log("\n" + "=".repeat(80));

    // Overall summary
    const totalSignals = phases.reduce((sum, p) => sum + p.signals.length, 0);
    const totalSuccessful = phases.reduce(
        (sum, p) => sum + p.signals.filter((s) => s.reachedTarget).length,
        0
    );
    const totalClusters = phases.reduce(
        (sum, p) => sum + identifySignalClusters(p.signals).length,
        0
    );
    const overallRate =
        totalSignals > 0
            ? ((totalSuccessful / totalSignals) * 100).toFixed(1)
            : "0";

    console.log(`\n📈 PHASE ANALYSIS SUMMARY:`);
    console.log(`   Total Phases: ${phases.length}`);
    console.log(`   Total Clusters: ${totalClusters}`);
    console.log(`   Total Signals: ${totalSignals}`);
    console.log(`   Successful Signals: ${totalSuccessful} (${overallRate}%)`);
    console.log(
        `   Avg Signals per Phase: ${(totalSignals / phases.length).toFixed(1)}`
    );
    console.log(
        `   Avg Clusters per Phase: ${(totalClusters / phases.length).toFixed(1)}`
    );
    console.log(
        `   Avg Signals per Cluster: ${(totalSignals / totalClusters).toFixed(1)}`
    );
}

// Run the analysis
analyzeSignals().catch(console.error);
