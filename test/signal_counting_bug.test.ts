// test/signal_counting_bug.test.ts
//
// UNIT TEST: Reproduce the impossible signal counting bug
// "Signal Candidates 4 | Signals Confirmed 4 | Signals Rejected 4"
//

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SignalManager } from "../src/trading/signalManager.js";
import type { ProcessedSignal } from "../src/types/signalTypes.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";

// Mock dependencies
const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
} as ILogger;

const mockMetrics = {
    incrementCounter: vi.fn(),
    recordHistogram: vi.fn(),
    setGauge: vi.fn(),
    getMetrics: vi.fn(() => ({})),
    getHealthSummary: vi.fn(() => "healthy"),
    createCounter: vi.fn(),
    createHistogram: vi.fn(),
    createGauge: vi.fn(),
} as IMetricsCollector;

const mockAnomalyDetector = {
    getMarketHealth: vi.fn(() => ({
        healthy: true,
        score: 0.8,
        metrics: {
            volatility: 0.02,
            spread: 0.01,
            volume: 1000,
        },
    })),
} as any;

const mockAlertManager = {
    sendAlert: vi.fn(),
} as any;

const mockThreadManager = {
    broadcast: vi.fn(),
    callStorage: vi.fn(),
} as any;

describe("Signal Counting Bug Reproduction", () => {
    let signalManager: SignalManager;

    beforeEach(() => {
        vi.clearAllMocks();
        signalManager = new SignalManager(
            mockAnomalyDetector,
            mockAlertManager,
            mockLogger,
            mockMetrics,
            mockThreadManager
        );
    });

    it("should show the impossible counting bug: candidates=confirmed=rejected", () => {
        console.log("🚨 REPRODUCING IMPOSSIBLE SIGNAL COUNTING BUG");

        // Process signals and force them through different paths
        const signals: ProcessedSignal[] = [
            {
                id: "signal-1",
                type: "deltacvd",
                detectorId: "test",
                confidence: 0.9,
                price: 100,
                side: "BUY",
                timestamp: new Date(),
                data: {},
                anomalyData: { marketHealthy: true, anomalyScore: 0.1 },
            },
            {
                id: "signal-2",
                type: "deltacvd",
                detectorId: "test",
                confidence: 0.8,
                price: 101,
                side: "SELL",
                timestamp: new Date(),
                data: {},
                anomalyData: { marketHealthy: true, anomalyScore: 0.1 },
            },
            {
                id: "signal-3",
                type: "deltacvd",
                detectorId: "test",
                confidence: 0.7,
                price: 102,
                side: "BUY",
                timestamp: new Date(),
                data: {},
                anomalyData: { marketHealthy: true, anomalyScore: 0.1 },
            },
            {
                id: "signal-4",
                type: "deltacvd",
                detectorId: "test",
                confidence: 0.6,
                price: 103,
                side: "SELL",
                timestamp: new Date(),
                data: {},
                anomalyData: { marketHealthy: true, anomalyScore: 0.1 },
            },
        ];

        // Process all signals with detailed tracking
        const results = signals.map((signal, i) => {
            console.log(`\n--- Processing Signal ${i + 1} ---`);

            // Check before processing
            const beforeStats = signalManager.getSignalTypeBreakdown();
            console.log(
                `Before: candidates=${beforeStats.deltacvd.candidates}, confirmed=${beforeStats.deltacvd.confirmed}, rejected=${beforeStats.deltacvd.rejected}`
            );

            const result = signalManager.handleProcessedSignal(signal);

            // Check after processing
            const afterStats = signalManager.getSignalTypeBreakdown();
            console.log(
                `After: candidates=${afterStats.deltacvd.candidates}, confirmed=${afterStats.deltacvd.confirmed}, rejected=${afterStats.deltacvd.rejected}`
            );
            console.log(`Signal ${i + 1}: processed=${!!result}`);

            return result;
        });

        // Get the stats that dashboard uses
        const breakdown = signalManager.getSignalTypeBreakdown();
        const totals = signalManager.getSignalTotals();

        console.log("📊 SIGNAL BREAKDOWN (signalTypeBreakdown):");
        console.log(`deltacvd candidates: ${breakdown.deltacvd.candidates}`);
        console.log(`deltacvd confirmed: ${breakdown.deltacvd.confirmed}`);
        console.log(`deltacvd rejected: ${breakdown.deltacvd.rejected}`);

        console.log("📊 SIGNAL TOTALS (signalTotals):");
        console.log(`Total candidates: ${totals.candidates}`);
        console.log(`Total confirmed: ${totals.confirmed}`);
        console.log(`Total rejected: ${totals.rejected}`);

        // Check if we reproduce the impossible bug
        const isBugPresent =
            totals.candidates === totals.confirmed &&
            totals.confirmed === totals.rejected &&
            totals.candidates > 0;

        if (isBugPresent) {
            console.log("🚨 BUG REPRODUCED: Impossible statistics detected!");
            console.log(
                `Candidates ${totals.candidates} = Confirmed ${totals.confirmed} = Rejected ${totals.rejected}`
            );
        } else {
            console.log(
                "✅ Bug not reproduced - statistics are mathematically consistent"
            );
            console.log(
                `Candidates ${totals.candidates} = Confirmed ${totals.confirmed} + Rejected ${totals.rejected}`
            );
        }

        // Document what we actually see
        console.log("🔍 ANALYSIS:");
        console.log(
            "- Are all signals being counted as candidates?",
            totals.candidates === 4
        );
        console.log("- Are signals being confirmed?", totals.confirmed > 0);
        console.log("- Are signals being rejected?", totals.rejected > 0);
        console.log(
            "- Is math consistent?",
            totals.candidates === totals.confirmed + totals.rejected
        );

        // The actual test - show the current behavior
        expect(totals.candidates).toBe(4); // Should count all processed signals

        // This will show us the actual bug or confirm it's fixed
        console.log(
            `📋 FINAL VERDICT: candidates=${totals.candidates}, confirmed=${totals.confirmed}, rejected=${totals.rejected}`
        );
    });
});
