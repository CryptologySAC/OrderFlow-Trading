// test/signal_route_tracing.test.ts
//
// CRITICAL UNIT TESTS: Trace DeltaCVD signal routing to prove where tracking breaks
//
// This test file traces the exact signal flow from DeltaCVD detector to stats API
// to identify where the signalTypeStats tracking is failing

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DeltaCVDDetectorEnhanced } from "../src/indicators/deltaCVDDetectorEnhanced.js";
import { SignalCoordinator } from "../src/services/signalCoordinator.js";
import { SignalManager } from "../src/trading/signalManager.js";
import type {
    EnrichedTradeEvent,
    SignalCandidate,
    ProcessedSignal,
} from "../src/types/signalTypes.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import { SignalValidationLogger } from "../src/utils/signalValidationLogger.js";

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

const mockSignalValidationLogger = {
    logSignalRejection: vi.fn(),
    logSuccessfulSignal: vi.fn(),
    destroy: vi.fn(),
} as unknown as SignalValidationLogger;

const mockPreprocessor = {
    getAverageSpread: vi.fn(() => 0.01),
    getTradeVelocity: vi.fn(() => 10),
} as any;

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

describe("Signal Counting Fix Verification", () => {
    let signalManager: SignalManager;

    beforeEach(() => {
        vi.clearAllMocks();

        // Create SignalManager
        signalManager = new SignalManager(
            mockAnomalyDetector,
            mockAlertManager,
            mockLogger,
            mockMetrics,
            mockThreadManager
        );
    });

    it("should test signal counting fix - candidates should not equal confirmed AND rejected", () => {
        // Test the core issue: impossible statistics where candidates=confirmed=rejected

        // STEP 1: Verify initial state
        const initialStats = signalManager.getSignalTypeBreakdown();
        const initialTotals = signalManager.getSignalTotals();

        console.log("🔍 INITIAL STATE:");
        console.log("SignalTypeBreakdown:", initialStats);
        console.log("SignalTotals:", initialTotals);

        expect(initialStats.deltacvd.candidates).toBe(0);
        expect(initialStats.deltacvd.confirmed).toBe(0);
        expect(initialStats.deltacvd.rejected).toBe(0);
        expect(initialTotals.candidates).toBe(0);
        expect(initialTotals.confirmed).toBe(0);
        expect(initialTotals.rejected).toBe(0);

        // STEP 2: Simulate processing 4 signals that get confirmed
        for (let i = 1; i <= 4; i++) {
            const processedSignal: ProcessedSignal = {
                id: `test-signal-${i}`,
                type: "deltacvd",
                detectorId: "test-deltacvd",
                confidence: 0.8, // High confidence - should be confirmed
                price: 106.26,
                side: "BUY",
                timestamp: new Date(),
                data: {},
                anomalyData: { marketHealthy: true, anomalyScore: 0.1 },
            };

            const result = signalManager.handleProcessedSignal(processedSignal);
            console.log(`🔍 Signal ${i} processed:`, { confirmed: !!result });
        }

        // STEP 3: Check final state - this should show the fix
        const finalStats = signalManager.getSignalTypeBreakdown();
        const finalTotals = signalManager.getSignalTotals();

        console.log("🔍 FINAL STATE:");
        console.log("SignalTypeBreakdown:", finalStats);
        console.log("SignalTotals:", finalTotals);

        // CRITICAL TEST: These numbers should make mathematical sense
        // Before fix: candidates=4, confirmed=4, rejected=4 (IMPOSSIBLE)
        // After fix: candidates=4, confirmed=4, rejected=0 (CORRECT)

        expect(finalStats.deltacvd.candidates).toBe(4);
        expect(finalStats.deltacvd.confirmed).toBe(4);
        expect(finalStats.deltacvd.rejected).toBe(0);

        expect(finalTotals.candidates).toBe(4);
        expect(finalTotals.confirmed).toBe(4);
        expect(finalTotals.rejected).toBe(0);

        // The fix ensures: candidates = confirmed + rejected
        expect(finalTotals.candidates).toBe(
            finalTotals.confirmed + finalTotals.rejected
        );

        console.log(
            "✅ SIGNAL COUNTING FIX VERIFIED: Mathematically consistent statistics"
        );
    });

    it("should test mixed signal outcomes - some confirmed, some rejected", () => {
        // Test more realistic scenario with mixed outcomes

        // Process 2 high-confidence signals (should be confirmed)
        for (let i = 1; i <= 2; i++) {
            const highConfidenceSignal: ProcessedSignal = {
                id: `high-conf-${i}`,
                type: "deltacvd",
                detectorId: "test-deltacvd",
                confidence: 0.8, // High confidence
                price: 106.26,
                side: "BUY",
                timestamp: new Date(),
                data: {},
                anomalyData: { marketHealthy: true, anomalyScore: 0.1 },
            };

            const result =
                signalManager.handleProcessedSignal(highConfidenceSignal);
            console.log(`🔍 High confidence signal ${i}:`, {
                confirmed: !!result,
            });
        }

        // Process 3 low-confidence signals (should be rejected)
        for (let i = 1; i <= 3; i++) {
            const lowConfidenceSignal: ProcessedSignal = {
                id: `low-conf-${i}`,
                type: "deltacvd",
                detectorId: "test-deltacvd",
                confidence: 0.3, // Low confidence
                price: 106.26,
                side: "BUY",
                timestamp: new Date(),
                data: {},
                anomalyData: { marketHealthy: true, anomalyScore: 0.1 },
            };

            const result =
                signalManager.handleProcessedSignal(lowConfidenceSignal);
            console.log(`🔍 Low confidence signal ${i}:`, {
                confirmed: !!result,
            });
        }

        // Check final state
        const finalStats = signalManager.getSignalTypeBreakdown();
        const finalTotals = signalManager.getSignalTotals();

        console.log("🔍 MIXED OUTCOMES FINAL STATE:");
        console.log("SignalTypeBreakdown:", finalStats);
        console.log("SignalTotals:", finalTotals);

        // Expected: 5 candidates, 2 confirmed, 3 rejected
        expect(finalStats.deltacvd.candidates).toBe(5);
        expect(finalStats.deltacvd.confirmed).toBe(2);
        expect(finalStats.deltacvd.rejected).toBe(3);

        expect(finalTotals.candidates).toBe(5);
        expect(finalTotals.confirmed).toBe(2);
        expect(finalTotals.rejected).toBe(3);

        // Mathematical consistency: candidates = confirmed + rejected
        expect(finalTotals.candidates).toBe(
            finalTotals.confirmed + finalTotals.rejected
        );

        console.log("✅ MIXED OUTCOMES FIX VERIFIED: 5 = 2 + 3");
    });
});
