import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock dependencies before imports - MANDATORY per CLAUDE.md
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");
vi.mock("../src/services/spoofingDetector");

import { DeltaCVDDetectorEnhanced } from "../src/indicators/deltaCVDDetectorEnhanced";
import { WorkerLogger } from "../src/multithreading/workerLogger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";
import { SpoofingDetector } from "../src/services/spoofingDetector";
import type { IOrderflowPreprocessor } from "../src/market/orderFlowPreprocessor.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents";

// Import mock config for complete settings
import mockConfig from "../__mocks__/config.json";

const createMockPreprocessor = (): IOrderflowPreprocessor => ({
    handleDepth: vi.fn(),
    handleAggTrade: vi.fn(),
    getStats: vi.fn(() => ({
        processedTrades: 0,
        processedDepthUpdates: 0,
        bookMetrics: {} as any,
    })),
    findZonesNearPrice: vi.fn(() => []),
    calculateZoneRelevanceScore: vi.fn(() => 0.5),
    findMostRelevantZone: vi.fn(() => null),
});

/**
 * MINIMAL Z-SCORE BUG REPRODUCTION
 *
 * Issue: Simulation shows z-score alignment works (zScoreAlignment: 1),
 * but actual validation rejects with "no_sign_alignment".
 *
 * This test isolates the z-score calculation bug.
 */

describe("DeltaCVD Z-Score Bug Reproduction", () => {
    let detector: DeltaCVDDetectorEnhanced;
    let mockLogger: WorkerLogger;
    let mockMetrics: MetricsCollector;
    let mockSpoofing: SpoofingDetector;
    let mockPreprocessor: IOrderflowPreprocessor;

    const createTradeEvent = (
        price: number,
        quantity: number,
        buyerIsMaker: boolean,
        timestamp: number,
        passiveBidVol: number = 50,
        passiveAskVol: number = 50
    ): EnrichedTradeEvent => ({
        symbol: "LTCUSDT",
        price,
        quantity,
        buyerIsMaker,
        timestamp,
        tradeId: Math.floor(Math.random() * 1000000),
        isBuyerMaker: buyerIsMaker,
        quoteQty: price * quantity,
        passiveBidVolume: passiveBidVol,
        passiveAskVolume: passiveAskVol,
        zonePassiveBidVolume: passiveBidVol * 2,
        zonePassiveAskVolume: passiveAskVol * 2,
        depthSnapshot: new Map(),
        bestBid: price - 0.01,
        bestAsk: price + 0.01,
        pair: "LTCUSDT",
        originalTrade: {} as any,
    });

    beforeEach(() => {
        mockLogger = new WorkerLogger();
        mockMetrics = new MetricsCollector();
        mockSpoofing = new SpoofingDetector({
            tickSize: 0.01,
            wallTicks: 10,
            minWallSize: 100,
            dynamicWallWidth: true,
            testLogMinSpoof: 50,
        });
        mockPreprocessor = createMockPreprocessor();

        detector = new DeltaCVDDetectorEnhanced(
            "zscore_bug_test",
            {
                ...mockConfig.symbols.LTCUSDT.deltaCvdConfirmation,
                windowsSec: [60],
                minZ: 1.0,
                detectionMode: "momentum",
                baseConfidenceRequired: 0.2,
                finalConfidenceRequired: 0.3,
                usePassiveVolume: true,
                enableDepthAnalysis: true,
                volumeSurgeMultiplier: 1.5,
                imbalanceThreshold: 0.05, // Very low threshold for testing
            },
            mockPreprocessor,
            mockLogger,
            mockSpoofing,
            mockMetrics
        );
    });

    it("should identify the z-score calculation bug", () => {
        const baseTime = Date.now();
        const basePrice = 85.0;

        // Track emitted signals for this specific test
        const emittedSignals: any[] = [];
        detector.on("signalCandidate", (signal) => {
            emittedSignals.push(signal);
        });

        // Create proper volume surge pattern that should work:
        // - 30+ trades for MIN_SAMPLES_FOR_STATS
        // - Strong directional bias for CVD
        // - REAL volume surge in passive volume data
        const trades: EnrichedTradeEvent[] = [];

        // Phase 1: Build statistical baseline with 50+ trades over 45 seconds
        // This creates the diverse CVD slopes needed for statistical accumulation
        for (let i = 0; i < 50; i++) {
            const timeOffset = baseTime - 45000 + i * 900; // 45 seconds, 900ms apart
            const priceVariation =
                basePrice + Math.round(Math.sin(i * 0.2) * 100) * 0.01; // Small price variation (tick-aligned)
            const isBuy = i % 3 !== 0; // 67% buy, 33% sell for slight positive CVD
            const quantity = 1.0 + Math.random() * 0.5; // 1.0-1.5 baseline size

            const trade = createTradeEvent(
                priceVariation,
                quantity,
                !isBuy, // buyerIsMaker = !isBuy for correct CVD calculation
                timeOffset,
                15 + Math.random() * 5, // 15-20 baseline passive volume
                15 + Math.random() * 5
            );
            trades.push(trade);
        }

        // Phase 2: Build strong directional CVD over 10 seconds (create slope pattern)
        for (let i = 50; i < 70; i++) {
            const timeOffset = baseTime - 10000 + (i - 50) * 500; // Last 10 seconds
            const priceIncrement = basePrice + (i - 50) * 0.01; // Gradual price rise (tick-aligned)
            const quantity = 2.0 + (i - 50) * 0.1; // Increasing trade sizes

            const trade = createTradeEvent(
                priceIncrement,
                quantity,
                false, // All aggressive buys for strong positive CVD
                timeOffset,
                20, // Normal passive volume
                20
            );
            trades.push(trade);
        }

        // Phase 3: Volume surge pattern (5 large trades in last 2 seconds)
        for (let i = 70; i < 75; i++) {
            const trade = createTradeEvent(
                basePrice + (i - 65) * 0.01, // Continuing price rise (tick-aligned)
                20.0, // Large aggressive trades (10x baseline)
                false, // All market buys (strong buy pressure)
                baseTime - 2000 + (i - 70) * 400, // Last 2 seconds
                25, // Normal passive volume (makes aggressive trades stand out)
                25
            );
            trades.push(trade);
        }

        console.log("\\n=== Z-SCORE BUG REPRODUCTION ===");
        console.log(
            `Processing ${trades.length} trades with statistical foundation + volume surge...`
        );

        // Process all trades
        trades.forEach((trade) => detector.onEnrichedTrade(trade));

        // TEST 1: Simulation with fake z-scores should work
        console.log("\\n--- Test 1: Simulation with fake z-scores ---");
        const fakeSimulation = detector.simulateConfidence(
            { 60: 3.0 },
            { 60: 0.7 }
        );
        console.log("Fake simulation result:", {
            zScoreAlignment: fakeSimulation.factors.zScoreAlignment,
            finalConfidence: fakeSimulation.finalConfidence,
            success: fakeSimulation.finalConfidence > 0.3,
        });

        // TEST 2: Check what actual z-scores are calculated
        console.log("\\n--- Test 2: Actual z-score investigation ---");
        const detectorInternal = detector as any;
        const windowState = detectorInternal.states?.get(60);

        console.log("Window state exists:", !!windowState);
        console.log("Trade count:", windowState?.trades?.length || 0);

        // The bug is likely in tryEmitSignal -> validateMomentumConditions
        // Let's check rejection metrics
        const rejectionCalls = (
            mockMetrics.incrementCounter as any
        ).mock.calls.filter(
            (call: any) => call[0] === "cvd_signals_rejected_total"
        );

        console.log("\\n--- Test 3: Rejection analysis ---");
        console.log("Rejection calls:", rejectionCalls.length);
        rejectionCalls.forEach((call: any, i: number) => {
            console.log(`  ${i + 1}: reason = ${call[2]?.reason}`);
        });

        // Check if we reach z-score validation with proper timing
        const hasNoSignAlignment = rejectionCalls.some(
            (call: any) => call[2]?.reason === "no_sign_alignment"
        );
        const hasVolumeSurge = rejectionCalls.some(
            (call: any) => call[2]?.reason === "no_volume_surge"
        );
        const hasImbalance = rejectionCalls.some(
            (call: any) => call[2]?.reason === "insufficient_imbalance"
        );

        // Check for actual signal generation
        const hasSignalGenerated = emittedSignals.length > 0;

        console.log("\\n=== BUG ANALYSIS ===");
        console.log(
            "✅ Fake z-scores work: zScoreAlignment =",
            fakeSimulation.factors.zScoreAlignment
        );
        console.log("❌ Volume surge issues:", hasVolumeSurge);
        console.log("❌ Imbalance issues:", hasImbalance);
        console.log("❌ Z-score alignment issues:", hasNoSignAlignment);
        console.log(
            "🎯 Actual signals generated:",
            hasSignalGenerated,
            `(${emittedSignals.length} signals)`
        );

        if (hasSignalGenerated) {
            console.log("🎉 SUCCESS: Detector working correctly!");
            emittedSignals.forEach((signal, i) => {
                console.log(`  Signal ${i + 1}:`, {
                    side: signal.side,
                    confidence: signal.confidence,
                    price: signal.price,
                });
            });
        } else if (hasNoSignAlignment) {
            console.log("🐛 CONFIRMED: Z-score calculation bug exists");
        } else {
            console.log(
                "🔍 Z-score validation not reached - earlier validation failures"
            );
        }

        // Document the current state - expect fake values to work
        expect(fakeSimulation.factors.zScoreAlignment).toBe(1);

        // This test successfully reproduces the validation pipeline issues
        expect(rejectionCalls.length).toBeGreaterThan(0); // Some rejections should occur
    });
});
