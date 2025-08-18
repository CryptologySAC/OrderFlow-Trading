#!/usr/bin/env node
import * as fs from "fs/promises";

interface Signal {
    timestamp: number;
    detectorType: string;
    signalSide: "buy" | "sell";
    price: number;
    subsequentMovement1hr?: number;
    wasValidSignal?: boolean;
    TP_SL?: string;
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

async function readSignalFile(filePath: string): Promise<Signal[]> {
    try {
        const content = await fs.readFile(filePath, "utf-8");
        const lines = content.trim().split("\n");
        if (lines.length < 2) return [];

        const headers = lines[0].split(",");
        const signals: Signal[] = [];

        const timestampIdx = headers.indexOf("timestamp");
        const detectorIdx = headers.indexOf("detectorType");
        const sideIdx = headers.indexOf("signalSide");
        const priceIdx = headers.indexOf("price");
        const move1hrIdx = headers.indexOf("subsequentMovement1hr");
        const validIdx = headers.indexOf("wasValidSignal");
        const tpSlIdx = headers.indexOf("TP_SL");

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(",");
            if (values.length < 4) continue;

            signals.push({
                timestamp: parseInt(values[timestampIdx]),
                detectorType: values[detectorIdx],
                signalSide: values[sideIdx] as "buy" | "sell",
                price: parseFloat(values[priceIdx]),
                subsequentMovement1hr:
                    move1hrIdx >= 0 && values[move1hrIdx]
                        ? parseFloat(values[move1hrIdx])
                        : undefined,
                wasValidSignal:
                    validIdx >= 0 ? values[validIdx] === "true" : undefined,
                TP_SL: tpSlIdx >= 0 ? values[tpSlIdx] : undefined,
            });
        }

        return signals;
    } catch (error) {
        console.log(`Could not read file ${filePath}: ${error}`);
        return [];
    }
}

function clusterSignalsIntoSwings(
    signals: Signal[],
    maxGapMinutes: number = 10
): SwingCluster[] {
    if (signals.length === 0) return [];

    // Sort signals by timestamp
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

async function analyzeSwingCoverage(): Promise<void> {
    console.log("Loading signal files...");

    // Load successful signals
    const successful = await readSignalFile(
        "logs/signal_validation/absorption_successful_2025-08-12.csv"
    );
    console.log(`Loaded ${successful.length} successful signals`);

    // Load rejected but would have worked signals
    const rejectedMissed = await readSignalFile(
        "logs/signal_validation/absorption_rejected_missed_2025-08-12.csv"
    );
    const missedOpportunities = rejectedMissed.filter(
        (s) => s.wasValidSignal === true || s.TP_SL === "TP"
    );
    console.log(
        `Loaded ${missedOpportunities.length} missed opportunities (rejected but hit TP)`
    );

    // Cluster successful signals into swings
    const successfulSwings = clusterSignalsIntoSwings(successful, 10);
    console.log(
        `\nSuccessful signals cover ${successfulSwings.length} distinct swing movements:`
    );

    for (let i = 0; i < successfulSwings.length; i++) {
        const swing = successfulSwings[i];
        console.log(
            `  Swing ${i + 1}: ${swing.side.toUpperCase()} | ${swing.signals.length} signals | $${swing.minPrice.toFixed(2)}-$${swing.maxPrice.toFixed(2)} | ${swing.timeRange}`
        );
    }

    // Now analyze missed opportunities
    const allSignals = [...successful];
    const newSwingsCovered: SwingCluster[] = [];
    let additionalSignalsInExistingSwings = 0;

    // Check each missed opportunity
    for (const missed of missedOpportunities) {
        // Check if this signal falls within an existing successful swing
        let foundInExisting = false;

        for (const swing of successfulSwings) {
            const timeDiff = Math.abs(missed.timestamp - swing.startTime);
            const isNearSwing = timeDiff < 15 * 60 * 1000; // Within 15 minutes
            const isSameSide = missed.signalSide === swing.side;
            const isPriceNear =
                Math.abs(missed.price - swing.minPrice) / swing.minPrice < 0.02; // Within 2%

            if (isNearSwing && isSameSide && isPriceNear) {
                foundInExisting = true;
                additionalSignalsInExistingSwings++;
                break;
            }
        }

        if (!foundInExisting) {
            // Check if it's part of a new swing we're tracking
            let foundInNewSwing = false;

            for (const newSwing of newSwingsCovered) {
                const timeDiff = Math.abs(
                    missed.timestamp - newSwing.startTime
                );
                const isNearSwing = timeDiff < 15 * 60 * 1000;
                const isSameSide = missed.signalSide === newSwing.side;
                const isPriceNear =
                    Math.abs(missed.price - newSwing.minPrice) /
                        newSwing.minPrice <
                    0.02;

                if (isNearSwing && isSameSide && isPriceNear) {
                    newSwing.signals.push(missed);
                    newSwing.endTime = Math.max(
                        newSwing.endTime,
                        missed.timestamp
                    );
                    newSwing.minPrice = Math.min(
                        newSwing.minPrice,
                        missed.price
                    );
                    newSwing.maxPrice = Math.max(
                        newSwing.maxPrice,
                        missed.price
                    );
                    foundInNewSwing = true;
                    break;
                }
            }

            if (!foundInNewSwing) {
                // This is a completely new swing
                newSwingsCovered.push({
                    startTime: missed.timestamp,
                    endTime: missed.timestamp,
                    side: missed.signalSide,
                    signals: [missed],
                    minPrice: missed.price,
                    maxPrice: missed.price,
                    timeRange: "",
                });
            }
        }
    }

    // Update time ranges for new swings
    for (const swing of newSwingsCovered) {
        const start = new Date(swing.startTime);
        const duration = (swing.endTime - swing.startTime) / (60 * 1000);

        swing.timeRange = `${start.toLocaleString("en-US", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: "America/Lima",
        })} (${swing.signals.length} signals, ${duration.toFixed(1)} min)`;
    }

    // Sort new swings by timestamp
    newSwingsCovered.sort((a, b) => a.startTime - b.startTime);

    console.log(
        `\n${additionalSignalsInExistingSwings} missed opportunities are in the SAME swings as successful signals`
    );
    console.log(
        `${newSwingsCovered.reduce((sum, s) => sum + s.signals.length, 0)} missed opportunities cover ${newSwingsCovered.length} ADDITIONAL swing movements:`
    );

    for (let i = 0; i < Math.min(20, newSwingsCovered.length); i++) {
        const swing = newSwingsCovered[i];
        console.log(
            `  New Swing ${i + 1}: ${swing.side.toUpperCase()} | $${swing.minPrice.toFixed(2)}-$${swing.maxPrice.toFixed(2)} | ${swing.timeRange}`
        );
    }

    if (newSwingsCovered.length > 20) {
        console.log(`  ... and ${newSwingsCovered.length - 20} more swings`);
    }

    // Generate HTML report
    await generateHTMLReport(
        successfulSwings,
        newSwingsCovered,
        additionalSignalsInExistingSwings,
        missedOpportunities.length
    );
}

async function generateHTMLReport(
    successfulSwings: SwingCluster[],
    newSwings: SwingCluster[],
    additionalInExisting: number,
    totalMissed: number
): Promise<void> {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Swing Movement Coverage Analysis</title>
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
            font-size: 24px;
            font-weight: bold;
            color: #4CAF50;
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
            padding: 12px;
            text-align: left;
        }
        td {
            padding: 10px;
            border-bottom: 1px solid #444;
        }
        .buy { color: #4CAF50; }
        .sell { color: #f44336; }
        .highlight { background-color: #3a3a3a; }
    </style>
</head>
<body>
    <h1>Swing Movement Coverage Analysis</h1>
    
    <div class="summary">
        <h2>Key Findings</h2>
        <p><span class="stat">${successfulSwings.length}</span> swing movements covered by successful signals</p>
        <p><span class="stat">${newSwings.length}</span> ADDITIONAL swing movements in missed opportunities</p>
        <p><span class="stat">${additionalInExisting}</span> missed signals in SAME swings as successful</p>
        <p><span class="stat">${totalMissed}</span> total missed profitable opportunities</p>
        <p><span class="stat">${((newSwings.length / (successfulSwings.length + newSwings.length)) * 100).toFixed(1)}%</span> of swings are being completely MISSED</p>
    </div>
    
    <h2>Currently Captured Swings (${successfulSwings.length})</h2>
    <table>
        <tr>
            <th>#</th>
            <th>Direction</th>
            <th>Signals</th>
            <th>Price Range</th>
            <th>Time Range (Lima)</th>
        </tr>
        ${successfulSwings
            .map(
                (s, i) => `
        <tr>
            <td>${i + 1}</td>
            <td class="${s.side}">${s.side.toUpperCase()}</td>
            <td>${s.signals.length}</td>
            <td>$${s.minPrice.toFixed(2)} - $${s.maxPrice.toFixed(2)}</td>
            <td>${s.timeRange}</td>
        </tr>`
            )
            .join("")}
    </table>
    
    <h2>Missed Swing Movements (First 50 of ${newSwings.length})</h2>
    <table>
        <tr>
            <th>#</th>
            <th>Direction</th>
            <th>Signals</th>
            <th>Price Range</th>
            <th>Time (Lima)</th>
        </tr>
        ${newSwings
            .slice(0, 50)
            .map(
                (s, i) => `
        <tr class="highlight">
            <td>${i + 1}</td>
            <td class="${s.side}">${s.side.toUpperCase()}</td>
            <td>${s.signals.length}</td>
            <td>$${s.minPrice.toFixed(2)} - $${s.maxPrice.toFixed(2)}</td>
            <td>${s.timeRange}</td>
        </tr>`
            )
            .join("")}
    </table>
    
    <p style="margin-top: 40px; color: #888; font-size: 12px;">
        Generated: ${new Date().toISOString()}
    </p>
</body>
</html>`;

    await fs.writeFile("swing_coverage_analysis.html", html, "utf8");
    console.log("\n✅ HTML report saved to: swing_coverage_analysis.html");
}

// Run the analysis
analyzeSwingCoverage().catch(console.error);
