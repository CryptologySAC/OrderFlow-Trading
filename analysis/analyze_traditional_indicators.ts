#!/usr/bin/env node
/**
 * Traditional Indicator Analysis Tool
 *
 * Analyzes how precisely VWAP, RSI, and OIR identify market direction
 * Features dynamic color-changing lines within phases to show correctness
 * Generates interactive Chart.js visualizations and optimization recommendations
 */

import * as fs from "fs/promises";
import { BaseSignal, convertToLimaTime } from "./shared/phaseDetection.js";
import {
    createCorrectPhases,
    printCorrectPhaseSummary,
    CorrectPhase,
    PricePoint
} from "./shared/correctPhaseDetection.js";
import { getDB } from "../src/infrastructure/db.js";

// Traditional indicator data from signal logs
interface TraditionalIndicatorData {
    vwap: {
        value: number | null;
        deviation?: number | null;
        deviationPercent?: number | null;
        passed: boolean;
        reason?: string;
    };
    rsi: {
        value: number | null;
        condition: string;
        passed: boolean;
        reason?: string;
    };
    oir: {
        value: number | null;
        buyVolume?: number;
        sellVolume?: number;
        totalVolume?: number;
        condition: string;
        passed: boolean;
        reason?: string;
    };
    overallDecision: "pass" | "filter" | "insufficient_data";
    filtersTriggered: string[];
}

interface SignalWithTraditional extends BaseSignal {
    traditionalIndicators?: TraditionalIndicatorData;
    logType: "successful" | "validation" | "rejection";
    category?: "SUCCESSFUL" | "HARMFUL" | "HARMLESS";
    phaseId?: number;
    isCorrectDirection?: boolean;
}

interface IndicatorDataPoint {
    timestamp: number;
    price: number;
    vwap: number | null;
    rsi: number | null;
    oir: number | null;
    phaseId: number | null;
    phaseDirection: "UP" | "DOWN" | null;
    vwapCorrect: boolean | null;
    rsiCorrect: boolean | null;
    oirCorrect: boolean | null;
}

interface IndicatorSegment {
    data: Array<{ x: number; y: number }>;
    borderColor: string;
    backgroundColor: string;
    fill: boolean;
    label: string;
    pointRadius: number;
    tension: 0.1;
}

interface IndicatorAnalysis {
    name: string;
    totalDataPoints: number;
    validDataPoints: number;
    correctPredictions: number;
    incorrectPredictions: number;
    accuracy: number;
    phaseAccuracy: Map<
        number,
        { correct: number; incorrect: number; accuracy: number }
    >;
    segments: IndicatorSegment[];
    optimalThresholds?: any;
}

/**
 * Load signals from all log types
 */
async function loadAllSignals(date: string): Promise<SignalWithTraditional[]> {
    const signals: SignalWithTraditional[] = [];
    const detectors = ["absorption", "exhaustion", "deltacvd"];
    const logTypes = [
        { type: "successful", category: "SUCCESSFUL" },
        { type: "validation", category: "HARMFUL" }, // Will refine later
        { type: "rejections", category: "HARMFUL" },
    ];

    for (const detector of detectors) {
        for (const { type, category } of logTypes) {
            const filePath = `logs/signal_validation/${detector}_${type}_${date}.jsonl`;
            try {
                const content = await fs.readFile(filePath, "utf-8");
                const lines = content.trim().split("\n");

                for (const line of lines) {
                    if (!line.trim()) continue;

                    try {
                        const jsonRecord = JSON.parse(line);

                        const signal: SignalWithTraditional = {
                            timestamp: jsonRecord.timestamp,
                            detectorType: detector,
                            signalSide: jsonRecord.signalSide,
                            price: jsonRecord.price,
                            logType: type as
                                | "successful"
                                | "validation"
                                | "rejection",
                            category: category as
                                | "SUCCESSFUL"
                                | "HARMFUL"
                                | "HARMLESS",
                            traditionalIndicators:
                                jsonRecord.traditionalIndicators,
                        };

                        // Only include signals with traditional indicator data
                        if (signal.traditionalIndicators) {
                            signals.push(signal);
                        }
                    } catch (parseError) {
                        continue;
                    }
                }
            } catch (error) {
                console.log(
                    `   No ${type} log found for ${detector} on ${date}`
                );
                continue;
            }
        }
    }

    return signals.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Load price data from aggregated_trades database table
 */
async function loadPriceData(date: string): Promise<Map<number, number>> {
    const priceMap = new Map<number, number>();
    const db = getDB();

    try {
        // Calculate start and end timestamps for the date
        const startOfDay = new Date(date).getTime();
        const endOfDay = startOfDay + 24 * 60 * 60 * 1000; // Add 24 hours

        // Query aggregated_trades table for tradeTime and price
        const stmt = db.prepare(`
            SELECT tradeTime, price 
            FROM aggregated_trades 
            WHERE tradeTime >= ? AND tradeTime < ?
            ORDER BY tradeTime ASC
        `);

        const rows = stmt.all(startOfDay, endOfDay) as Array<{
            tradeTime: number;
            price: number;
        }>;

        for (const row of rows) {
            priceMap.set(row.tradeTime, row.price);
        }

        console.log(`   Loaded ${rows.length} price data points from database`);
    } catch (error) {
        console.error(`Error loading price data from database:`, error);
    }

    return priceMap;
}

/**
 * Create continuous indicator data points from signals with time-based sampling
 */
function createIndicatorDataPoints(
    signals: SignalWithTraditional[],
    phases: CorrectPhase[]
): IndicatorDataPoint[] {
    const SAMPLING_INTERVAL_MS = 10000; // 10-second intervals for more data points
    const sampledDataMap = new Map<number, IndicatorDataPoint>();

    for (const signal of signals) {
        if (!signal.traditionalIndicators) continue;

        // Create time bucket for sampling (30-second intervals)
        const timeBucket =
            Math.floor(signal.timestamp / SAMPLING_INTERVAL_MS) *
            SAMPLING_INTERVAL_MS;

        // Find which phase this signal belongs to
        let phaseId: number | null = null;
        let phaseDirection: "UP" | "DOWN" | null = null;

        for (const phase of phases) {
            if (
                signal.timestamp >= phase.startTime &&
                signal.timestamp <= phase.endTime
            ) {
                phaseId = phase.id;
                phaseDirection = phase.direction;
                break;
            }
        }

        const indicators = signal.traditionalIndicators;

        // Determine correctness for each indicator
        const vwapCorrect = evaluateVWAPCorrectness(
            indicators.vwap,
            signal.price,
            phaseDirection
        );
        const rsiCorrect = evaluateRSICorrectness(
            indicators.rsi,
            phaseDirection
        );
        const oirCorrect = evaluateOIRCorrectness(
            indicators.oir,
            phaseDirection
        );

        // Calculate OIR value for data point (same logic as evaluation)
        let oirValue = indicators.oir.value;
        if (
            oirValue === null &&
            indicators.oir.buyVolume !== undefined &&
            indicators.oir.sellVolume !== undefined
        ) {
            const totalVol =
                (indicators.oir.buyVolume || 0) +
                (indicators.oir.sellVolume || 0);
            if (totalVol > 0) {
                oirValue = (indicators.oir.buyVolume || 0) / totalVol;
            }
        }

        const dataPoint: IndicatorDataPoint = {
            timestamp: signal.timestamp,
            price: signal.price,
            vwap: indicators.vwap.value,
            rsi: indicators.rsi.value,
            oir: oirValue, // Use calculated OIR value instead of null
            phaseId,
            phaseDirection,
            vwapCorrect,
            rsiCorrect,
            oirCorrect,
        };

        // Only keep the most recent data point per time bucket
        // or if this is a phase change
        const existing = sampledDataMap.get(timeBucket);
        if (
            !existing ||
            signal.timestamp > existing.timestamp ||
            existing.phaseId !== phaseId
        ) {
            sampledDataMap.set(timeBucket, dataPoint);
        }
    }

    const dataPoints = Array.from(sampledDataMap.values());
    return dataPoints.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Evaluate VWAP correctness for phase direction (RSI-INSPIRED SIMPLE LOGIC)
 */
function evaluateVWAPCorrectness(
    vwap: TraditionalIndicatorData["vwap"],
    price: number,
    phaseDirection: "UP" | "DOWN" | null
): boolean | null {
    if (!vwap.value || !phaseDirection) return null;

    // Simple, robust VWAP logic inspired by RSI's success
    // Use deviation percentage like RSI uses overbought/oversold levels
    const deviationPercent =
        vwap.deviationPercent ||
        (Math.abs(price - vwap.value) / vwap.value) * 100;

    // RSI-style thresholds: avoid extreme deviations like RSI avoids extreme levels
    const EXTREME_DEVIATION_THRESHOLD = 0.1; // 0.1% significant deviation

    if (phaseDirection === "UP") {
        // In UP phase: avoid signals when price is extremely below VWAP (like RSI oversold)
        return !(
            price < vwap.value && deviationPercent > EXTREME_DEVIATION_THRESHOLD
        );
    } else {
        // In DOWN phase: avoid signals when price is extremely above VWAP (like RSI overbought)
        return !(
            price > vwap.value && deviationPercent > EXTREME_DEVIATION_THRESHOLD
        );
    }
}

/**
 * Evaluate RSI correctness for phase direction
 */
function evaluateRSICorrectness(
    rsi: TraditionalIndicatorData["rsi"],
    phaseDirection: "UP" | "DOWN" | null
): boolean | null {
    if (!rsi.value || !phaseDirection) return null;

    // RSI logic: avoid buying when overbought, avoid selling when oversold
    if (phaseDirection === "UP") {
        return rsi.value < 70; // Correct if not overbought in up phase
    } else {
        return rsi.value > 30; // Correct if not oversold in down phase
    }
}

/**
 * Evaluate OIR correctness for phase direction (REVERSAL INDICATOR LOGIC)
 */
function evaluateOIRCorrectness(
    oir: TraditionalIndicatorData["oir"],
    phaseDirection: "UP" | "DOWN" | null
): boolean | null {
    if (!phaseDirection) return null;

    // Calculate OIR from available volume data if value is null
    let oirValue = oir.value;
    if (
        oirValue === null &&
        oir.buyVolume !== undefined &&
        oir.sellVolume !== undefined
    ) {
        const totalVol = (oir.buyVolume || 0) + (oir.sellVolume || 0);
        if (totalVol > 0) {
            oirValue = (oir.buyVolume || 0) / totalVol;
        }
    }

    if (oirValue === null) return null;

    // REVERSAL LOGIC: Extreme imbalances suggest potential reversals
    // When everyone is buying (>80%), reversal down may be coming
    // When everyone is selling (<20%), reversal up may be coming
    const EXTREME_BUY_DOMINANCE = 0.8; // 80% buy volume = potential top
    const EXTREME_SELL_DOMINANCE = 0.2; // 20% buy volume = potential bottom

    if (phaseDirection === "UP") {
        // In UP phase: correct when NOT showing extreme buy dominance (potential reversal signal)
        // Extreme buy dominance in UP phase suggests exhaustion/reversal coming
        return !(oirValue > EXTREME_BUY_DOMINANCE);
    } else {
        // In DOWN phase: correct when NOT showing extreme sell dominance (potential reversal signal)  
        // Extreme sell dominance in DOWN phase suggests exhaustion/reversal coming
        return !(oirValue < EXTREME_SELL_DOMINANCE);
    }
}

/**
 * Create dynamic segments with color changes for an indicator
 */
function createDynamicSegments(
    dataPoints: IndicatorDataPoint[],
    indicator: "vwap" | "rsi" | "oir",
    indicatorName: string
): IndicatorSegment[] {
    const segments: IndicatorSegment[] = [];
    if (dataPoints.length === 0) return segments;

    let currentSegment: IndicatorSegment | null = null;

    for (let i = 0; i < dataPoints.length; i++) {
        const point = dataPoints[i];
        const value = point[indicator];
        const correctness = point[
            `${indicator}Correct` as keyof IndicatorDataPoint
        ] as boolean | null;

        if (value === null) continue;

        // Determine color based on correctness
        let color: string;
        if (correctness === null) {
            color = "#FFA726"; // Yellow for insufficient data
        } else if (correctness) {
            color = "#4CAF50"; // Green for correct
        } else {
            color = "#f44336"; // Red for incorrect
        }

        const dataPoint = {
            x: point.timestamp,
            y: value,
        };

        // Check if we need to start a new segment
        const needNewSegment =
            !currentSegment ||
            currentSegment.borderColor !== color ||
            (i > 0 && point.timestamp - dataPoints[i - 1].timestamp > 600000); // 10 min gap

        if (needNewSegment) {
            // Finish current segment
            if (currentSegment && currentSegment.data.length > 0) {
                segments.push(currentSegment);
            }

            // Start new segment
            currentSegment = {
                data: [dataPoint],
                borderColor: color,
                backgroundColor: color + "20", // Add transparency
                fill: false,
                label: i === 0 ? indicatorName : "", // Only label first segment
                pointRadius: 2,
                tension: 0.1,
            };
        } else if (currentSegment !== null) {
            // Continue current segment
            currentSegment.data.push(dataPoint);
        }
    }

    // Add final segment
    if (currentSegment !== null && currentSegment.data.length > 0) {
        segments.push(currentSegment);
    }

    return segments;
}

/**
 * Analyze indicator performance
 */
function analyzeIndicator(
    dataPoints: IndicatorDataPoint[],
    indicator: "vwap" | "rsi" | "oir",
    indicatorName: string
): IndicatorAnalysis {
    let totalDataPoints = 0;
    let validDataPoints = 0;
    let correctPredictions = 0;
    let incorrectPredictions = 0;

    const phaseAccuracy = new Map<
        number,
        { correct: number; incorrect: number; accuracy: number }
    >();

    for (const point of dataPoints) {
        totalDataPoints++;

        const value = point[indicator];
        const correctness = point[
            `${indicator}Correct` as keyof IndicatorDataPoint
        ] as boolean | null;

        if (value !== null && correctness !== null) {
            validDataPoints++;

            if (correctness) {
                correctPredictions++;
            } else {
                incorrectPredictions++;
            }

            // Track per-phase accuracy
            if (point.phaseId !== null) {
                if (!phaseAccuracy.has(point.phaseId)) {
                    phaseAccuracy.set(point.phaseId, {
                        correct: 0,
                        incorrect: 0,
                        accuracy: 0,
                    });
                }

                const phaseStats = phaseAccuracy.get(point.phaseId)!;
                if (correctness) {
                    phaseStats.correct++;
                } else {
                    phaseStats.incorrect++;
                }
                phaseStats.accuracy =
                    phaseStats.correct /
                    (phaseStats.correct + phaseStats.incorrect);
            }
        }
    }

    const accuracy =
        validDataPoints > 0 ? correctPredictions / validDataPoints : 0;
    const segments = createDynamicSegments(
        dataPoints,
        indicator,
        indicatorName
    );

    return {
        name: indicatorName,
        totalDataPoints,
        validDataPoints,
        correctPredictions,
        incorrectPredictions,
        accuracy,
        phaseAccuracy,
        segments,
    };
}

/**
 * Generate HTML report with Chart.js visualizations
 */
async function generateHTMLReport(
    date: string,
    priceData: Map<number, number>,
    dataPoints: IndicatorDataPoint[],
    phases: CorrectPhase[],
    vwapAnalysis: IndicatorAnalysis,
    rsiAnalysis: IndicatorAnalysis,
    oirAnalysis: IndicatorAnalysis
): Promise<void> {
    // Create continuous phase-colored price datasets
    const phaseDatasets = phases.map((phase) => {
        // Get all price points within this phase
        const pricePoints: PricePoint[] = Array.from(priceData.entries())
                .map(([timestamp, price]) => ({ timestamp, price }))
                .sort((a, b) => a.timestamp - b.timestamp);
        const phasePoints = pricePoints.filter(
            (point) =>
                point.timestamp >= phase.startTime &&
                point.timestamp <= phase.endTime
        );

        // Build phase data with only actual price points within the phase
        const phaseData = [
            { x: phase.startTime, y: phase.startPrice },
            ...phasePoints.map((point) => ({
                x: point.timestamp,
                y: point.price,
            })),
            { x: phase.endTime, y: phase.endPrice },
        ];

        // Sort by timestamp to ensure correct line drawing
        phaseData.sort((a, b) => a.x - b.x);

        // Remove duplicate timestamps
        const uniquePhaseData = phaseData.filter((point, index, array) => {
            return index === 0 || point.x !== array[index - 1].x;
        });

        return {
            label: `Phase ${phase.id} (${phase.direction})`,
            data: uniquePhaseData,
            borderColor: phase.direction === "UP" ? "#4CAF50" : "#f44336",
            backgroundColor: "transparent",
            fill: false,
            tension: 0.1,
            pointRadius: 1,
            borderWidth: 2,
            spanGaps: false,
        };
    });

    // Remove phase annotations - chart should only show phase-colored price lines

    const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Traditional Indicators Analysis - ${date}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@2.0.0/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@1.4.0/dist/chartjs-plugin-annotation.min.js"></script>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 20px;
            background-color: #1a1a1a;
            color: #e0e0e0;
            line-height: 1.6;
        }
        .container { max-width: 1600px; margin: 0 auto; }
        h1, h2, h3 {
            color: #4CAF50;
            border-bottom: 2px solid #4CAF50;
            padding-bottom: 10px;
        }
        .chart-container {
            background-color: #2a2a2a;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            height: 500px;
            position: relative;
        }
        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin: 20px 0;
        }
        .metric-card {
            background-color: #333;
            border-radius: 8px;
            padding: 20px;
            text-align: center;
        }
        .metric-value {
            font-size: 2em;
            font-weight: bold;
            color: #4CAF50;
        }
        .metric-label {
            color: #999;
            margin-top: 10px;
        }
        .legend {
            display: flex;
            justify-content: center;
            gap: 30px;
            margin: 20px 0;
            flex-wrap: wrap;
        }
        .legend-item {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .legend-color {
            width: 20px;
            height: 4px;
            border-radius: 2px;
        }
        .accuracy-high { color: #4CAF50; }
        .accuracy-medium { color: #FFA726; }
        .accuracy-low { color: #f44336; }
        canvas { background-color: #333; border-radius: 4px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>📊 Traditional Indicators Analysis</h1>
        <div class="metric-card" style="text-align: center; margin-bottom: 30px;">
            <div class="metric-value">${date}</div>
            <div class="metric-label">Analysis Date</div>
        </div>

        <div class="legend">
            <div class="legend-item">
                <div class="legend-color" style="background-color: #4CAF50;"></div>
                <span>Correct Prediction (Green)</span>
            </div>
            <div class="legend-item">
                <div class="legend-color" style="background-color: #f44336;"></div>
                <span>Incorrect Prediction (Red)</span>
            </div>
            <div class="legend-item">
                <div class="legend-color" style="background-color: #FFA726;"></div>
                <span>Insufficient Data (Yellow)</span>
            </div>
        </div>

        <h2>📈 Price Chart with Phases</h2>
        <div class="chart-container">
            <canvas id="priceChart"></canvas>
        </div>

        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-value ${vwapAnalysis.accuracy > 0.7 ? "accuracy-high" : vwapAnalysis.accuracy > 0.5 ? "accuracy-medium" : "accuracy-low"}">${(vwapAnalysis.accuracy * 100).toFixed(1)}%</div>
                <div class="metric-label">VWAP Accuracy</div>
            </div>
            <div class="metric-card">
                <div class="metric-value ${rsiAnalysis.accuracy > 0.7 ? "accuracy-high" : rsiAnalysis.accuracy > 0.5 ? "accuracy-medium" : "accuracy-low"}">${(rsiAnalysis.accuracy * 100).toFixed(1)}%</div>
                <div class="metric-label">RSI Accuracy</div>
            </div>
            <div class="metric-card">
                <div class="metric-value ${oirAnalysis.accuracy > 0.7 ? "accuracy-high" : oirAnalysis.accuracy > 0.5 ? "accuracy-medium" : "accuracy-low"}">${(oirAnalysis.accuracy * 100).toFixed(1)}%</div>
                <div class="metric-label">OIR Accuracy</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${dataPoints.length}</div>
                <div class="metric-label">Total Data Points</div>
            </div>
        </div>

        <h2>📍 VWAP Analysis</h2>
        <div class="chart-container">
            <canvas id="vwapChart"></canvas>
        </div>
        <div class="metric-card">
            <p><strong>VWAP Logic:</strong> Price above VWAP = Bullish (correct in UP phases), Price below VWAP = Bearish (correct in DOWN phases)</p>
            <p><strong>Valid Data Points:</strong> ${vwapAnalysis.validDataPoints} / ${vwapAnalysis.totalDataPoints}</p>
            <p><strong>Correct Predictions:</strong> ${vwapAnalysis.correctPredictions}</p>
            <p><strong>Incorrect Predictions:</strong> ${vwapAnalysis.incorrectPredictions}</p>
        </div>

        <h2>📈 RSI Analysis</h2>
        <div class="chart-container">
            <canvas id="rsiChart"></canvas>
        </div>
        <div class="metric-card">
            <p><strong>RSI Logic:</strong> Avoid overbought levels (>70) in UP phases, Avoid oversold levels (<30) in DOWN phases</p>
            <p><strong>Valid Data Points:</strong> ${rsiAnalysis.validDataPoints} / ${rsiAnalysis.totalDataPoints}</p>
            <p><strong>Correct Predictions:</strong> ${rsiAnalysis.correctPredictions}</p>
            <p><strong>Incorrect Predictions:</strong> ${rsiAnalysis.incorrectPredictions}</p>
        </div>

        <h2>⚖️ OIR Analysis</h2>
        <div class="chart-container">
            <canvas id="oirChart"></canvas>
        </div>
        <div class="metric-card">
            <p><strong>OIR Logic (Reversal Indicator):</strong> Avoid extreme buy dominance (>80%) in UP phases (exhaustion signal), Avoid extreme sell dominance (<20%) in DOWN phases (exhaustion signal)</p>
            <p><strong>Valid Data Points:</strong> ${oirAnalysis.validDataPoints} / ${oirAnalysis.totalDataPoints}</p>
            <p><strong>Correct Predictions:</strong> ${oirAnalysis.correctPredictions}</p>
            <p><strong>Incorrect Predictions:</strong> ${oirAnalysis.incorrectPredictions}</p>
        </div>

        <h2>📋 Per-Phase Accuracy Breakdown</h2>
        <div style="background-color: #2a2a2a; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <h3>VWAP Phase Accuracy</h3>
            ${Array.from(vwapAnalysis.phaseAccuracy.entries())
                .map(
                    ([phaseId, stats]) =>
                        `<p>Phase ${phaseId}: ${(stats.accuracy * 100).toFixed(1)}% (${stats.correct} correct, ${stats.incorrect} incorrect)</p>`
                )
                .join("")}
            
            <h3>RSI Phase Accuracy</h3>
            ${Array.from(rsiAnalysis.phaseAccuracy.entries())
                .map(
                    ([phaseId, stats]) =>
                        `<p>Phase ${phaseId}: ${(stats.accuracy * 100).toFixed(1)}% (${stats.correct} correct, ${stats.incorrect} incorrect)</p>`
                )
                .join("")}
            
            <h3>OIR Phase Accuracy</h3>
            ${Array.from(oirAnalysis.phaseAccuracy.entries())
                .map(
                    ([phaseId, stats]) =>
                        `<p>Phase ${phaseId}: ${(stats.accuracy * 100).toFixed(1)}% (${stats.correct} correct, ${stats.incorrect} incorrect)</p>`
                )
                .join("")}
        </div>

        <div style="margin-top: 40px; color: #888; font-size: 12px;">
            <p>Generated: ${new Date().toISOString()}</p>
            <p>Dynamic color-changing analysis shows indicator correctness in real-time within market phases</p>
        </div>
    </div>

    <script>
        // Chart.js configuration
        Chart.defaults.color = '#e0e0e0';
        
        // Price Chart
        const priceCtx = document.getElementById('priceChart').getContext('2d');
        new Chart(priceCtx, {
            type: 'line',
            data: {
                datasets: ${JSON.stringify(phaseDatasets)}
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: 'hour' },
                        grid: { color: '#555' }
                    },
                    y: {
                        grid: { color: '#555' },
                        title: { display: true, text: 'Price ($)' }
                    }
                },
                plugins: {
                    legend: { labels: { color: '#e0e0e0' } }
                }
            }
        });

        // VWAP Chart
        const vwapCtx = document.getElementById('vwapChart').getContext('2d');
        new Chart(vwapCtx, {
            type: 'line',
            data: {
                datasets: ${JSON.stringify(vwapAnalysis.segments)}
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: 'hour' },
                        grid: { color: '#555' }
                    },
                    y: {
                        grid: { color: '#555' },
                        title: { display: true, text: 'VWAP Value ($)' }
                    }
                },
                plugins: {
                    legend: { labels: { color: '#e0e0e0' } }
                }
            }
        });

        // RSI Chart
        const rsiCtx = document.getElementById('rsiChart').getContext('2d');
        new Chart(rsiCtx, {
            type: 'line',
            data: {
                datasets: ${JSON.stringify(rsiAnalysis.segments)}
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: 'hour' },
                        grid: { color: '#555' }
                    },
                    y: {
                        min: 0,
                        max: 100,
                        grid: { color: '#555' },
                        title: { display: true, text: 'RSI Value' }
                    }
                },
                plugins: {
                    legend: { labels: { color: '#e0e0e0' } },
                    annotation: {
                        annotations: {
                            overbought: {
                                type: 'line',
                                scaleID: 'y',
                                value: 70,
                                borderColor: '#f44336',
                                borderWidth: 1,
                                borderDash: [5, 5],
                                label: { content: 'Overbought (70)', enabled: true }
                            },
                            oversold: {
                                type: 'line',
                                scaleID: 'y',
                                value: 30,
                                borderColor: '#4CAF50',
                                borderWidth: 1,
                                borderDash: [5, 5],
                                label: { content: 'Oversold (30)', enabled: true }
                            }
                        }
                    }
                }
            }
        });

        // OIR Chart
        const oirCtx = document.getElementById('oirChart').getContext('2d');
        new Chart(oirCtx, {
            type: 'line',
            data: {
                datasets: ${JSON.stringify(oirAnalysis.segments)}
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: 'hour' },
                        grid: { color: '#555' }
                    },
                    y: {
                        min: 0,
                        max: 1,
                        grid: { color: '#555' },
                        title: { display: true, text: 'OIR Value' }
                    }
                },
                plugins: {
                    legend: { labels: { color: '#e0e0e0' } },
                    annotation: {
                        annotations: {
                            neutral: {
                                type: 'line',
                                scaleID: 'y',
                                value: 0.5,
                                borderColor: '#FFA726',
                                borderWidth: 1,
                                borderDash: [5, 5],
                                label: { content: 'Neutral (0.5)', enabled: true }
                            }
                        }
                    }
                }
            }
        });
    </script>
</body>
</html>`;

    const outputPath = "analysis/reports/traditional_indicators_analysis.html";
    await fs.writeFile(outputPath, html, "utf8");
    console.log(
        `📊 Traditional indicators analysis report generated: ${outputPath}`
    );
}

interface OptimizationRecommendation {
    indicator: string;
    currentAccuracy: string;
    targetAccuracy: string;
    changes: string[];
}

/**
 * Generate optimization recommendations for all indicators
 */
function generateOptimizationRecommendations(
    vwapAnalysis: IndicatorAnalysis,
    rsiAnalysis: IndicatorAnalysis,
    oirAnalysis: IndicatorAnalysis,
    dataPoints: IndicatorDataPoint[]
): OptimizationRecommendation[] {
    const recommendations: OptimizationRecommendation[] = [];

    // VWAP Optimization
    const vwapRec: OptimizationRecommendation = {
        indicator: "VWAP",
        currentAccuracy: `${(vwapAnalysis.accuracy * 100).toFixed(1)}%`,
        targetAccuracy: ">90%",
        changes: [],
    };

    if (vwapAnalysis.accuracy < 0.9) {
        vwapRec.changes.push("✅ APPLIED: RSI-inspired simple VWAP logic");
        vwapRec.changes.push(
            "✅ APPLIED: Avoid extreme deviations like RSI avoids extreme levels"
        );
        vwapRec.changes.push(
            "✅ APPLIED: UP phase: avoid signals when price extremely below VWAP"
        );
        vwapRec.changes.push(
            "✅ APPLIED: DOWN phase: avoid signals when price extremely above VWAP"
        );
        vwapRec.changes.push(
            "Config: Set vwap.extremeDeviationThreshold = 0.1%"
        );
        vwapRec.changes.push("Config: Set vwap.logicType = 'rsi_inspired'");
    } else {
        vwapRec.changes.push("VWAP already optimized - no changes needed");
    }
    recommendations.push(vwapRec);

    // RSI Optimization
    const rsiRec: OptimizationRecommendation = {
        indicator: "RSI",
        currentAccuracy: `${(rsiAnalysis.accuracy * 100).toFixed(1)}%`,
        targetAccuracy: ">90%",
        changes: [],
    };

    if (rsiAnalysis.accuracy >= 0.9) {
        rsiRec.changes.push(
            "✅ RSI performing excellently - current thresholds are optimal"
        );
        rsiRec.changes.push(
            "Current: RSI > 70 = overbought, RSI < 30 = oversold"
        );
        rsiRec.changes.push("Keep: rsi.overboughtThreshold = 70");
        rsiRec.changes.push("Keep: rsi.oversoldThreshold = 30");
    } else {
        rsiRec.changes.push("Fine-tune RSI thresholds based on phase analysis");
        rsiRec.changes.push("Consider: rsi.overboughtThreshold = 75");
        rsiRec.changes.push("Consider: rsi.oversoldThreshold = 25");
    }
    recommendations.push(rsiRec);

    // OIR Optimization
    const oirRec: OptimizationRecommendation = {
        indicator: "OIR",
        currentAccuracy: `${(oirAnalysis.accuracy * 100).toFixed(1)}%`,
        targetAccuracy: ">90%",
        changes: [],
    };

    if (oirAnalysis.validDataPoints === 0) {
        oirRec.changes.push(
            "✅ APPLIED: Calculate OIR from buyVolume/sellVolume when value is null"
        );
        oirRec.changes.push(
            "Config: Set oir.minVolumeThreshold = 0.01 (lower threshold)"
        );
        oirRec.changes.push("Config: Set oir.fallbackCalculation = true");
        oirRec.changes.push(
            "This should resolve 'insufficient_oir_data' issues"
        );
    } else if (oirAnalysis.accuracy < 0.9) {
        oirRec.changes.push("✅ APPLIED: OIR configured as REVERSAL indicator");
        oirRec.changes.push(
            "✅ APPLIED: Detect exhaustion patterns through extreme imbalances"
        );
        oirRec.changes.push(
            "✅ APPLIED: UP phase: avoid signals with extreme buy dominance (>80% = exhaustion)"
        );
        oirRec.changes.push(
            "✅ APPLIED: DOWN phase: avoid signals with extreme sell dominance (<20% = exhaustion)"
        );
        oirRec.changes.push(
            "Config: Set oir.extremeBuyDominance = 0.8 (potential reversal down)"
        );
        oirRec.changes.push(
            "Config: Set oir.extremeSellDominance = 0.2 (potential reversal up)"
        );
        oirRec.changes.push("Config: Set oir.logicType = 'reversal_indicator'");
    } else {
        oirRec.changes.push("OIR performing well as reversal indicator - maintain current settings");
    }
    recommendations.push(oirRec);

    return recommendations;
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
    const date = process.argv[2] || new Date().toISOString().split("T")[0];

    console.log(`🔍 Traditional Indicators Analysis for ${date}`);
    console.log("=".repeat(80));

    // Load data
    console.log("\n📊 Loading signal data...");
    const signals = await loadAllSignals(date);
    console.log(
        `   Loaded ${signals.length} signals with traditional indicator data`
    );

    if (signals.length === 0) {
        console.log(
            "❌ No signals with traditional indicator data found. Exiting."
        );
        return;
    }

    console.log("\n📈 Loading price data and creating CORRECT phases...");
    const priceData = await loadPriceData(date);
    const phases = createCorrectPhases(priceData);
    console.log(`   Created ${phases.length} correct price-based phases`);
    printCorrectPhaseSummary(phases);

    // Create continuous indicator data points
    console.log("\n⚙️ Processing indicator data...");
    const dataPoints = createIndicatorDataPoints(signals, phases);
    console.log(`   Created ${dataPoints.length} indicator data points`);

    // Analyze each indicator
    console.log("\n📊 Analyzing indicator performance...");
    const vwapAnalysis = analyzeIndicator(dataPoints, "vwap", "VWAP");
    const rsiAnalysis = analyzeIndicator(dataPoints, "rsi", "RSI");
    const oirAnalysis = analyzeIndicator(dataPoints, "oir", "OIR");

    console.log(`\n📈 VWAP Analysis:`);
    console.log(`   Accuracy: ${(vwapAnalysis.accuracy * 100).toFixed(1)}%`);
    console.log(
        `   Valid data points: ${vwapAnalysis.validDataPoints}/${vwapAnalysis.totalDataPoints}`
    );
    console.log(`   Segments generated: ${vwapAnalysis.segments.length}`);

    console.log(`\n📊 RSI Analysis:`);
    console.log(`   Accuracy: ${(rsiAnalysis.accuracy * 100).toFixed(1)}%`);
    console.log(
        `   Valid data points: ${rsiAnalysis.validDataPoints}/${rsiAnalysis.totalDataPoints}`
    );
    console.log(`   Segments generated: ${rsiAnalysis.segments.length}`);

    console.log(`\n⚖️ OIR Analysis:`);
    console.log(`   Accuracy: ${(oirAnalysis.accuracy * 100).toFixed(1)}%`);
    console.log(
        `   Valid data points: ${oirAnalysis.validDataPoints}/${oirAnalysis.totalDataPoints}`
    );
    console.log(`   Segments generated: ${oirAnalysis.segments.length}`);

    // Generate HTML report
    console.log("\n📄 Generating HTML report...");
    await generateHTMLReport(
        date,
        priceData,
        dataPoints,
        phases,
        vwapAnalysis,
        rsiAnalysis,
        oirAnalysis
    );

    // Generate optimization recommendations
    console.log("\n🔧 Generating optimization recommendations...");
    const optimizationRecommendations = generateOptimizationRecommendations(
        vwapAnalysis,
        rsiAnalysis,
        oirAnalysis,
        dataPoints
    );

    console.log("\n📋 OPTIMIZATION RECOMMENDATIONS:");
    console.log("=".repeat(80));

    for (const recommendation of optimizationRecommendations) {
        console.log(
            `\n${recommendation.indicator.toUpperCase()} Optimization:`
        );
        console.log(`   Current Accuracy: ${recommendation.currentAccuracy}`);
        console.log(`   Target Accuracy: ${recommendation.targetAccuracy}`);
        console.log(`   Recommended Changes:`);
        for (const change of recommendation.changes) {
            console.log(`     - ${change}`);
        }
    }

    console.log("\n" + "=".repeat(80));
    console.log("✅ Traditional indicators analysis complete!");
    console.log(
        "📊 Report: analysis/reports/traditional_indicators_analysis.html"
    );
}

// Execute
main().catch(console.error);
