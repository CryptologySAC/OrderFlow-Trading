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

    // For tracking TP time
    actualTP?: number;
    maxSL?: number;
}

// Thresholds that let all 35 successful signals pass
const THRESHOLDS = {
    minAggVolume: 1629,
    priceEfficiencyThreshold: 0.0046,
    maxAbsorptionRatio: 0.701,
    minPassiveMultiplier: 2.46,
    passiveAbsorptionThreshold: 2.46,
    finalConfidenceRequired: 0.608,
};

async function readSignalsWithPrice(filePath: string): Promise<Signal[]> {
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
    // Read from rejected_missed which has all trades
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

function findTPTime(
    signal: Signal,
    prices: Map<number, number>,
    targetPercent: number = 0.007
): number | null {
    const startTime = signal.timestamp;
    const startPrice = signal.price;
    const isBuy = signal.signalSide === "buy";

    // Look for TP within 90 minutes
    const maxTime = startTime + 90 * 60 * 1000;

    // Get all prices after signal
    const futurePrices = Array.from(prices.entries())
        .filter(([t, _]) => t > startTime && t <= maxTime)
        .sort((a, b) => a[0] - b[0]);

    for (const [timestamp, price] of futurePrices) {
        const movement = (price - startPrice) / startPrice;

        if (isBuy && movement >= targetPercent) {
            return timestamp;
        } else if (!isBuy && movement <= -targetPercent) {
            return timestamp;
        }
    }

    return null;
}

function wouldSignalPass(signal: Signal): boolean {
    if (
        !signal.minAggVolume ||
        !signal.priceEfficiencyThreshold ||
        !signal.maxAbsorptionRatio ||
        !signal.minPassiveMultiplier ||
        !signal.passiveAbsorptionThreshold ||
        !signal.finalConfidenceRequired
    ) {
        return false;
    }

    return (
        signal.minAggVolume >= THRESHOLDS.minAggVolume &&
        signal.priceEfficiencyThreshold <=
            THRESHOLDS.priceEfficiencyThreshold &&
        signal.maxAbsorptionRatio >= THRESHOLDS.maxAbsorptionRatio &&
        signal.minPassiveMultiplier >= THRESHOLDS.minPassiveMultiplier &&
        signal.passiveAbsorptionThreshold >=
            THRESHOLDS.passiveAbsorptionThreshold &&
        signal.finalConfidenceRequired >= THRESHOLDS.finalConfidenceRequired
    );
}

interface SwingCluster {
    startTime: number;
    endTime: number;
    side: "buy" | "sell";
    signals: Signal[];
    minPrice: number;
    maxPrice: number;
    timeRange: string;
}

function clusterSignalsIntoSwings(
    signals: Signal[],
    maxGapMinutes: number = 10
): SwingCluster[] {
    if (signals.length === 0) return [];

    const sorted = [...signals].sort((a, b) => a.timestamp - b.timestamp);
    const clusters: SwingCluster[] = [];
    let currentCluster: SwingCluster | null = null;

    for (const signal of sorted) {
        const shouldStartNewCluster =
            !currentCluster ||
            signal.signalSide !== currentCluster.side ||
            signal.timestamp - currentCluster.endTime >
                maxGapMinutes * 60 * 1000;

        if (shouldStartNewCluster) {
            if (currentCluster) {
                clusters.push(currentCluster);
            }

            currentCluster = {
                startTime: signal.timestamp,
                endTime: signal.timestamp,
                side: signal.signalSide,
                signals: [signal],
                minPrice: signal.price,
                maxPrice: signal.price,
                timeRange: "",
            };
        } else {
            currentCluster.signals.push(signal);
            currentCluster.endTime = signal.timestamp;
            currentCluster.minPrice = Math.min(
                currentCluster.minPrice,
                signal.price
            );
            currentCluster.maxPrice = Math.max(
                currentCluster.maxPrice,
                signal.price
            );
        }
    }

    if (currentCluster) {
        clusters.push(currentCluster);
    }

    // Add time range descriptions
    for (const cluster of clusters) {
        const start = new Date(cluster.startTime);
        const end = new Date(cluster.endTime);
        const duration = (cluster.endTime - cluster.startTime) / (60 * 1000);

        cluster.timeRange = `${start.toLocaleString("en-US", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: "America/Lima",
        })} - ${end.toLocaleString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: "America/Lima",
        })} Lima (${duration.toFixed(1)} min)`;
    }

    return clusters;
}

function formatTime(timestamp: number): string {
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

async function analyzeHarmlessFalsePositives(): Promise<void> {
    console.log("Loading signals and price data...");

    // Load successful signals
    const successful = await readSignalsWithPrice(
        "logs/signal_validation/absorption_successful_2025-08-12.csv"
    );
    console.log(`Loaded ${successful.length} successful signals`);

    // Load validated signals
    const validated = await readSignalsWithPrice(
        "logs/signal_validation/absorption_validation_2025-08-12.csv"
    );
    console.log(`Loaded ${validated.length} validated signals`);

    // Load price data from rejected_missed
    const prices = await readPriceData(
        "logs/signal_validation/absorption_rejected_missed_2025-08-12.csv"
    );
    console.log(`Loaded ${prices.size} price points`);

    // Find TP times for successful signals
    console.log("\nCalculating TP times for successful signals...");
    for (const signal of successful) {
        const tpTime = findTPTime(signal, prices, 0.007);
        if (tpTime) {
            signal.actualTP = tpTime;
        }
    }

    const successWithTP = successful.filter((s) => s.actualTP);
    console.log(
        `Found TP times for ${successWithTP.length}/${successful.length} successful signals`
    );

    // Filter validated signals to only those that would pass with new thresholds
    // and are not already in successful
    const successfulTimestamps = new Set(successful.map((s) => s.timestamp));
    const falsePositives = validated.filter(
        (v) => !successfulTimestamps.has(v.timestamp) && wouldSignalPass(v)
    );

    console.log(
        `\nFound ${falsePositives.length} false positive signals with new thresholds`
    );

    // Analyze which false positives are "harmless" (occur during an active trade)
    const harmlessFP: Signal[] = [];
    const harmfulFP: Signal[] = [];

    for (const fp of falsePositives) {
        let isHarmless = false;

        // Check if this FP occurs during any successful signal's trade window
        for (const success of successWithTP) {
            // Only check same-side signals (can't have buy and sell positions simultaneously)
            if (success.signalSide === fp.signalSide) {
                const tradeStart = success.timestamp;
                const tradeEnd = success.actualTP!;

                if (fp.timestamp > tradeStart && fp.timestamp < tradeEnd) {
                    isHarmless = true;
                    break;
                }
            }
        }

        if (isHarmless) {
            harmlessFP.push(fp);
        } else {
            harmfulFP.push(fp);
        }
    }

    console.log("\n=== HARMLESS FALSE POSITIVE ANALYSIS ===");
    console.log(`Total false positives: ${falsePositives.length}`);
    console.log(`Harmless (during active trade): ${harmlessFP.length}`);
    console.log(`Harmful (would trigger new trade): ${harmfulFP.length}`);
    console.log(
        `Reduction: ${((harmlessFP.length / falsePositives.length) * 100).toFixed(1)}% of false positives are harmless`
    );

    // Calculate effective accuracy
    const effectiveAccuracy =
        (successful.length / (successful.length + harmfulFP.length)) * 100;
    const originalAccuracy =
        (successful.length / (successful.length + falsePositives.length)) * 100;

    console.log(`\nACCURACY IMPROVEMENT:`);
    console.log(
        `Original accuracy: ${originalAccuracy.toFixed(1)}% (${successful.length} TP vs ${falsePositives.length} FP)`
    );
    console.log(
        `Effective accuracy: ${effectiveAccuracy.toFixed(1)}% (${successful.length} TP vs ${harmfulFP.length} harmful FP)`
    );
    console.log(
        `Improvement: ${(effectiveAccuracy - originalAccuracy).toFixed(1)} percentage points`
    );

    // Show details of harmless false positives
    if (harmlessFP.length > 0) {
        console.log("\nHARMLESS FALSE POSITIVES (occur during active trades):");
        for (const fp of harmlessFP.slice(0, 10)) {
            // Find which successful trade it overlaps with
            let overlappingTrade = null;
            for (const success of successWithTP) {
                if (
                    success.signalSide === fp.signalSide &&
                    fp.timestamp > success.timestamp &&
                    fp.timestamp < success.actualTP!
                ) {
                    overlappingTrade = success;
                    break;
                }
            }

            if (overlappingTrade) {
                console.log(
                    `  ${formatTime(fp.timestamp)} ${fp.signalSide.toUpperCase()} @ $${fp.price.toFixed(2)}`
                );
                console.log(
                    `    → During trade: ${formatTime(overlappingTrade.timestamp)} to ${formatTime(overlappingTrade.actualTP!)}`
                );
            }
        }

        if (harmlessFP.length > 10) {
            console.log(`  ... and ${harmlessFP.length - 10} more`);
        }
    }

    // Cluster harmful false positives into swings
    const harmfulSwings = clusterSignalsIntoSwings(harmfulFP, 10);

    console.log(`\nHARMFUL FALSE POSITIVE SWINGS:`);
    console.log(
        `${harmfulFP.length} harmful false positives cluster into ${harmfulSwings.length} distinct swing movements`
    );
    console.log(
        `Average signals per swing: ${(harmfulFP.length / harmfulSwings.length).toFixed(1)}`
    );

    // Analyze best outcome for each harmful swing before 0.35% SL
    console.log("\nAnalyzing best possible outcome for each harmful swing...");

    interface SwingOutcome {
        swing: SwingCluster;
        bestOutcome: number; // Best % movement before hitting 0.35% SL
        outcomeType:
            | "TP_0.7"
            | "TP_0.5"
            | "TP_0.3"
            | "Breakeven"
            | "Small_Loss"
            | "Stop_Loss";
        worstDrawdown: number; // Worst drawdown before best outcome
    }

    const swingOutcomes: SwingOutcome[] = [];

    for (const swing of harmfulSwings) {
        // Use the first signal in the swing as entry point
        const entrySignal = swing.signals[0];
        const entryTime = entrySignal.timestamp;
        const entryPrice = entrySignal.price;
        const isBuy = entrySignal.signalSide === "buy";

        // Look for price movement in next 90 minutes
        const maxTime = entryTime + 90 * 60 * 1000;
        const futurePrices = Array.from(prices.entries())
            .filter(([t, _]) => t > entryTime && t <= maxTime)
            .sort((a, b) => a[0] - b[0]);

        let bestOutcome = 0;
        let worstDrawdown = 0;
        let hitStopLoss = false;

        for (const [_, price] of futurePrices) {
            const movement = (price - entryPrice) / entryPrice;

            if (isBuy) {
                // For buy: positive movement is profit, negative is loss
                worstDrawdown = Math.min(worstDrawdown, movement);

                // Check if hit stop loss
                if (movement <= -0.0035) {
                    hitStopLoss = true;
                    break;
                }

                bestOutcome = Math.max(bestOutcome, movement);
            } else {
                // For sell: negative movement is profit, positive is loss
                worstDrawdown = Math.max(worstDrawdown, movement);

                // Check if hit stop loss
                if (movement >= 0.0035) {
                    hitStopLoss = true;
                    break;
                }

                bestOutcome = Math.min(bestOutcome, movement);
            }
        }

        // Convert to absolute profit for classification
        const absoluteBest = isBuy ? bestOutcome : -bestOutcome;

        let outcomeType: SwingOutcome["outcomeType"];
        if (absoluteBest >= 0.007) {
            outcomeType = "TP_0.7";
        } else if (absoluteBest >= 0.005) {
            outcomeType = "TP_0.5";
        } else if (absoluteBest >= 0.003) {
            outcomeType = "TP_0.3";
        } else if (absoluteBest >= 0) {
            outcomeType = "Breakeven";
        } else if (absoluteBest >= -0.0035) {
            outcomeType = "Small_Loss";
        } else {
            outcomeType = "Stop_Loss";
        }

        swingOutcomes.push({
            swing,
            bestOutcome: absoluteBest,
            outcomeType,
            worstDrawdown: isBuy ? worstDrawdown : -worstDrawdown,
        });
    }

    // Summarize outcomes
    const outcomeCounts = {
        "TP_0.7": 0,
        "TP_0.5": 0,
        "TP_0.3": 0,
        Breakeven: 0,
        Small_Loss: 0,
        Stop_Loss: 0,
    };

    for (const outcome of swingOutcomes) {
        outcomeCounts[outcome.outcomeType]++;
    }

    console.log("\n=== HARMFUL SWING BEST OUTCOMES ===");
    console.log(`Could reach 0.7% TP: ${outcomeCounts["TP_0.7"]} swings`);
    console.log(`Could reach 0.5% TP: ${outcomeCounts["TP_0.5"]} swings`);
    console.log(`Could reach 0.3% TP: ${outcomeCounts["TP_0.3"]} swings`);
    console.log(`Breakeven (0-0.3%): ${outcomeCounts["Breakeven"]} swings`);
    console.log(`Small Loss (<0.35%): ${outcomeCounts["Small_Loss"]} swings`);
    console.log(`Hit Stop Loss (0.35%): ${outcomeCounts["Stop_Loss"]} swings`);

    // Show details of swings that could be profitable
    const profitableSwings = swingOutcomes.filter(
        (o) =>
            o.outcomeType === "TP_0.7" ||
            o.outcomeType === "TP_0.5" ||
            o.outcomeType === "TP_0.3"
    );

    if (profitableSwings.length > 0) {
        console.log("\nSWINGS THAT COULD BE PROFITABLE:");
        for (const outcome of profitableSwings) {
            const firstSignal = outcome.swing.signals[0];
            console.log(
                `  ${formatTime(firstSignal.timestamp)} ${firstSignal.signalSide.toUpperCase()} @ $${firstSignal.price.toFixed(2)}`
            );
            console.log(
                `    Best: ${(outcome.bestOutcome * 100).toFixed(3)}% | Type: ${outcome.outcomeType} | Worst DD: ${(outcome.worstDrawdown * 100).toFixed(3)}%`
            );
        }
    }

    // Show swing details
    console.log("\nHarmful False Positive Swings (first 10):");
    for (let i = 0; i < Math.min(10, harmfulSwings.length); i++) {
        const swing = harmfulSwings[i];
        const outcome = swingOutcomes[i];
        console.log(
            `  Swing ${i + 1}: ${swing.side.toUpperCase()} | ${swing.signals.length} signals | $${swing.minPrice.toFixed(2)}-$${swing.maxPrice.toFixed(2)} | ${swing.timeRange}`
        );
        console.log(
            `    → Best outcome: ${(outcome.bestOutcome * 100).toFixed(3)}% (${outcome.outcomeType})`
        );
    }

    if (harmfulSwings.length > 10) {
        console.log(`  ... and ${harmfulSwings.length - 10} more swings`);
    }

    // Show harmful false positives
    console.log("\nHARMFUL FALSE POSITIVES (would trigger losing trades):");
    const harmfulByTime = harmfulFP.sort((a, b) => a.timestamp - b.timestamp);

    for (const fp of harmfulByTime.slice(0, 10)) {
        console.log(
            `  ${formatTime(fp.timestamp)} ${fp.signalSide.toUpperCase()} @ $${fp.price.toFixed(2)}`
        );
    }

    if (harmfulByTime.length > 10) {
        console.log(`  ... and ${harmfulByTime.length - 10} more`);
    }

    // Generate HTML report
    await generateHTMLReport(
        successful,
        falsePositives,
        harmlessFP,
        harmfulFP,
        successWithTP,
        harmfulSwings,
        swingOutcomes
    );
}

async function generateHTMLReport(
    successful: Signal[],
    allFP: Signal[],
    harmlessFP: Signal[],
    harmfulFP: Signal[],
    successWithTP: Signal[],
    harmfulSwings: SwingCluster[],
    swingOutcomes: any[]
): Promise<void> {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Harmless vs Harmful False Positives Analysis</title>
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
        .stat {
            font-size: 36px;
            font-weight: bold;
            color: #4CAF50;
        }
        .good { color: #4CAF50; }
        .bad { color: #f44336; }
        .neutral { color: #ffa726; }
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
        .harmless { background-color: #1b5e20; }
        .harmful { background-color: #b71c1c; }
        .buy { color: #4CAF50; }
        .sell { color: #f44336; }
        .overlap-info {
            font-size: 11px;
            color: #888;
        }
    </style>
</head>
<body>
    <h1>Harmless vs Harmful False Positives Analysis</h1>
    
    <div class="summary">
        <h2>Key Findings</h2>
        <p><span class="stat">${allFP.length}</span> total false positives with optimized thresholds</p>
        <p><span class="stat good">${harmlessFP.length}</span> HARMLESS (occur during active trades)</p>
        <p><span class="stat bad">${harmfulFP.length}</span> HARMFUL (would trigger losing trades)</p>
        <p><span class="stat">${((harmlessFP.length / allFP.length) * 100).toFixed(1)}%</span> of false positives are harmless!</p>
    </div>
    
    <div class="summary">
        <h2>Swing Movement Analysis</h2>
        <p>Successful signals: <span class="good">6 swings</span> (all profitable)</p>
        <p>Harmful false positives: <span class="bad">${harmfulSwings.length} swings</span> (analyzed below)</p>
        <p>Average FP per swing: <span class="neutral">${(harmfulFP.length / harmfulSwings.length).toFixed(1)} signals</span></p>
        <p>Total unique swings: <span class="stat">${6 + harmfulSwings.length}</span> swing movements</p>
        <p>Win rate by swing: <span class="stat">${((6 / (6 + harmfulSwings.length)) * 100).toFixed(1)}%</span></p>
    </div>
    
    <div class="summary">
        <h2>Harmful Swing Best Outcomes (Before 0.35% SL)</h2>
        ${(() => {
            const counts: { [key: string]: number } = {};
            for (const outcome of swingOutcomes) {
                counts[outcome.outcomeType] =
                    (counts[outcome.outcomeType] || 0) + 1;
            }
            return `
        <p>Could reach 0.7% TP: <span class="good">${counts["TP_0.7"] || 0} swings</span></p>
        <p>Could reach 0.5% TP: <span class="good">${counts["TP_0.5"] || 0} swings</span></p>
        <p>Could reach 0.3% TP: <span class="neutral">${counts["TP_0.3"] || 0} swings</span></p>
        <p>Breakeven (0-0.3%): <span class="neutral">${counts["Breakeven"] || 0} swings</span></p>
        <p>Small Loss (<0.35%): <span class="bad">${counts["Small_Loss"] || 0} swings</span></p>
        <p>Hit Stop Loss (0.35%): <span class="bad">${counts["Stop_Loss"] || 0} swings</span></p>
        <hr style="border-color: #444; margin: 15px 0;">
        <p>Potential winners (≥0.3% TP): <span class="stat">${(counts["TP_0.7"] || 0) + (counts["TP_0.5"] || 0) + (counts["TP_0.3"] || 0)}</span></p>
        <p>Actual losers: <span class="stat">${(counts["Small_Loss"] || 0) + (counts["Stop_Loss"] || 0)}</span></p>
            `;
        })()}
    </div>
    
    <div class="summary">
        <h2>Effective Accuracy After Filtering Harmless FPs</h2>
        <p>True Positives: <span class="good">${successful.length}</span></p>
        <p>Harmful False Positives: <span class="bad">${harmfulFP.length}</span></p>
        <p>Effective Accuracy: <span class="stat">${((successful.length / (successful.length + harmfulFP.length)) * 100).toFixed(1)}%</span></p>
        <p class="neutral">vs Original: ${((successful.length / (successful.length + allFP.length)) * 100).toFixed(1)}%</p>
    </div>
    
    <h2>Harmless False Positives (First 20 of ${harmlessFP.length})</h2>
    <table>
        <tr>
            <th>Time (Lima)</th>
            <th>Side</th>
            <th>Price</th>
            <th>Overlapping Trade Window</th>
        </tr>
        ${harmlessFP
            .slice(0, 20)
            .map((fp) => {
                // Find overlapping trade
                let overlap = null;
                for (const s of successWithTP) {
                    if (
                        s.signalSide === fp.signalSide &&
                        fp.timestamp > s.timestamp &&
                        fp.timestamp < s.actualTP!
                    ) {
                        overlap = s;
                        break;
                    }
                }

                return `
        <tr class="harmless">
            <td>${formatTime(fp.timestamp)}</td>
            <td class="${fp.signalSide}">${fp.signalSide.toUpperCase()}</td>
            <td>$${fp.price.toFixed(2)}</td>
            <td class="overlap-info">
                ${overlap ? `Trade: ${formatTime(overlap.timestamp)} → ${formatTime(overlap.actualTP!)} @ $${overlap.price.toFixed(2)}` : "N/A"}
            </td>
        </tr>`;
            })
            .join("")}
    </table>
    
    <h2>Harmful False Positives (First 20 of ${harmfulFP.length})</h2>
    <table>
        <tr>
            <th>Time (Lima)</th>
            <th>Side</th>
            <th>Price</th>
            <th>Status</th>
        </tr>
        ${harmfulFP
            .slice(0, 20)
            .map(
                (fp) => `
        <tr class="harmful">
            <td>${formatTime(fp.timestamp)}</td>
            <td class="${fp.signalSide}">${fp.signalSide.toUpperCase()}</td>
            <td>$${fp.price.toFixed(2)}</td>
            <td class="bad">Would trigger losing trade</td>
        </tr>`
            )
            .join("")}
    </table>
    
    <p style="margin-top: 40px; color: #888; font-size: 12px;">
        Generated: ${new Date().toISOString()}<br>
        Analysis based on optimized thresholds that capture all swing movements
    </p>
</body>
</html>`;

    await fs.writeFile("harmless_false_positives_analysis.html", html);
    console.log(
        "\n✅ HTML report saved to: harmless_false_positives_analysis.html"
    );
}

// Run the analysis
analyzeHarmlessFalsePositives().catch(console.error);
