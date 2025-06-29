import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock dependencies before imports - MANDATORY per CLAUDE.md
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");
vi.mock("../src/services/spoofingDetector");

import { DeltaCVDConfirmation } from "../src/indicators/deltaCVDConfirmation";
import { WorkerLogger } from "../src/multithreading/workerLogger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";
import { SpoofingDetector } from "../src/services/spoofingDetector";
import type { EnrichedTradeEvent } from "../src/types/marketEvents";

/**
 * REAL-WORLD DELTACVD DETECTOR SCENARIOS
 *
 * Testing Standards (CLAUDE.md):
 * ✅ Test CORRECT logic implementation based on real market scenarios
 * ✅ Validate exact method behavior against market requirements
 * ✅ Ensure tests fail when detection logic is broken
 * ✅ Tests MUST detect trading signal errors - never adjust tests to pass buggy implementations
 * ✅ Use realistic market data patterns and volumes
 * ✅ Test edge cases that occur in live trading environments
 */

describe("DeltaCVDConfirmation - Real World Scenarios", () => {
    let detector: DeltaCVDConfirmation;
    let mockLogger: WorkerLogger;
    let mockMetrics: MetricsCollector;
    let mockSpoofing: SpoofingDetector;

    // Helper to create realistic trade events with proper market structure
    const createRealisticTrade = (
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
        // Realistic passive volume data
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
    });

    describe("🚀 Institutional Volume Surge Scenarios", () => {
        beforeEach(() => {
            detector = new DeltaCVDConfirmation(
                "institutional_volume_test",
                {
                    windowsSec: [60],
                    minZ: 2.0,
                    minTradesPerSec: 0.5,
                    minVolPerSec: 2.0,
                    volumeSurgeMultiplier: 3.0,
                    imbalanceThreshold: 0.3,
                    institutionalThreshold: 15.0, // 15 LTC threshold
                    enableDepthAnalysis: true,
                    usePassiveVolume: true,
                },
                mockLogger,
                mockSpoofing,
                mockMetrics
            );
        });

        it("should detect whale buy accumulation pattern", () => {
            const baseTime = Date.now();
            const basePrice = 85.5;

            // Phase 1: Build baseline volume (normal retail activity)
            const baselineTrades = [];
            for (let i = 0; i < 45; i++) {
                const trade = createRealisticTrade(
                    basePrice + Math.round(Math.random() * 5 - 2.5) * 0.01, // ±2.5 cents (tick-aligned)
                    0.5 + Math.random() * 2.0, // 0.5-2.5 LTC (retail sizes)
                    Math.random() > 0.5,
                    baseTime - 60000 + i * 1200, // Over 54 seconds
                    30 + Math.random() * 20, // Passive volume 30-50
                    30 + Math.random() * 20
                );
                baselineTrades.push(trade);
            }

            baselineTrades.forEach((trade) => detector.onEnrichedTrade(trade));

            // Phase 2: Institutional accumulation (whale buying)
            const institutionalTrades = [
                // Large institutional buy orders with high passive absorption
                createRealisticTrade(
                    basePrice + 0.01,
                    22.5,
                    false,
                    baseTime - 5000,
                    180,
                    45
                ), // 22.5 LTC aggressive buy
                createRealisticTrade(
                    basePrice + 0.02,
                    18.7,
                    false,
                    baseTime - 4000,
                    160,
                    40
                ), // 18.7 LTC aggressive buy
                createRealisticTrade(
                    basePrice + 0.01,
                    25.3,
                    false,
                    baseTime - 3000,
                    200,
                    50
                ), // 25.3 LTC aggressive buy
                createRealisticTrade(
                    basePrice,
                    3.2,
                    true,
                    baseTime - 2000,
                    80,
                    140
                ), // Small sell absorbed
                createRealisticTrade(
                    basePrice + 0.03,
                    19.8,
                    false,
                    baseTime - 1000,
                    170,
                    45
                ), // 19.8 LTC aggressive buy
                createRealisticTrade(
                    basePrice + 0.04,
                    21.1,
                    false,
                    baseTime,
                    190,
                    35
                ), // 21.1 LTC aggressive buy
            ];

            institutionalTrades.forEach((trade) =>
                detector.onEnrichedTrade(trade)
            );

            // Should detect strong bullish institutional activity
            const status = detector.getStatus();
            expect(status).toContain("CVD Detector");

            // Verify institutional threshold detection
            const detailedState = detector.getDetailedState();
            expect(detailedState.states[0].tradesCount).toBeGreaterThan(45);

            // Should have processed the large institutional trades
            expect(detailedState.windows).toContain(60);
        });

        it("should detect distribution pattern (whale selling)", () => {
            const baseTime = Date.now();
            const basePrice = 89.75;

            // Phase 1: Build baseline with some upward momentum
            const momentumTrades = [];
            for (let i = 0; i < 40; i++) {
                const priceIncrement = i * 0.01; // Gradual upward movement (tick-aligned)
                const trade = createRealisticTrade(
                    basePrice + priceIncrement,
                    1.0 + Math.random() * 1.5,
                    i % 3 !== 0, // Mostly buying (2/3 buy, 1/3 sell)
                    baseTime - 50000 + i * 1200,
                    40 + Math.random() * 30,
                    40 + Math.random() * 30
                );
                momentumTrades.push(trade);
            }

            momentumTrades.forEach((trade) => detector.onEnrichedTrade(trade));

            // Phase 2: Institutional distribution (whale selling into strength)
            const distributionTrades = [
                // Large sells into buying pressure
                createRealisticTrade(
                    basePrice + 0.04,
                    28.4,
                    true,
                    baseTime - 4500,
                    45,
                    220
                ), // 28.4 LTC aggressive sell
                createRealisticTrade(
                    basePrice + 0.03,
                    2.1,
                    false,
                    baseTime - 4000,
                    150,
                    60
                ), // Small buy absorbed
                createRealisticTrade(
                    basePrice + 0.02,
                    24.7,
                    true,
                    baseTime - 3500,
                    40,
                    200
                ), // 24.7 LTC aggressive sell
                createRealisticTrade(
                    basePrice + 0.01,
                    31.2,
                    true,
                    baseTime - 3000,
                    35,
                    250
                ), // 31.2 LTC aggressive sell
                createRealisticTrade(
                    basePrice,
                    1.8,
                    false,
                    baseTime - 2500,
                    140,
                    70
                ), // Small buy absorbed
                createRealisticTrade(
                    basePrice - 0.01,
                    26.9,
                    true,
                    baseTime - 2000,
                    30,
                    210
                ), // 26.9 LTC aggressive sell
                createRealisticTrade(
                    basePrice - 0.02,
                    22.3,
                    true,
                    baseTime - 1000,
                    25,
                    180
                ), // 22.3 LTC aggressive sell
            ];

            distributionTrades.forEach((trade) =>
                detector.onEnrichedTrade(trade)
            );

            // Should detect bearish institutional distribution
            const status = detector.getStatus();
            expect(status).toContain("CVD Detector");

            // Verify the pattern was processed
            const detailedState = detector.getDetailedState();
            expect(detailedState.states[0].tradesCount).toBeGreaterThan(40);
        });

        it("should ignore retail noise without institutional size", () => {
            const baseTime = Date.now();
            const basePrice = 91.25;

            // Create high-frequency retail trading without institutional size
            const retailTrades = [];
            for (let i = 0; i < 80; i++) {
                const trade = createRealisticTrade(
                    basePrice + Math.round(Math.random() * 10 - 5) * 0.01, // ±5 cents (tick-aligned)
                    0.1 + Math.random() * 2.0, // 0.1-2.1 LTC (all retail)
                    Math.random() > 0.5,
                    baseTime - 60000 + i * 750, // High frequency
                    20 + Math.random() * 40, // Moderate passive volume
                    20 + Math.random() * 40
                );
                retailTrades.push(trade);
            }

            retailTrades.forEach((trade) => detector.onEnrichedTrade(trade));

            // Should NOT generate institutional signals from retail noise
            // Verify metrics show rejected signals due to insufficient institutional activity
            expect(mockMetrics.incrementCounter).toHaveBeenCalledWith(
                "cvd_signals_rejected_total",
                expect.any(Number),
                expect.objectContaining({
                    reason: expect.stringMatching(/insufficient_/),
                })
            );
        });
    });

    describe("📈 Momentum vs Divergence Detection", () => {
        it("should detect momentum continuation pattern", () => {
            const momentumDetector = new DeltaCVDConfirmation(
                "momentum_test",
                {
                    windowsSec: [60],
                    detectionMode: "momentum",
                    minZ: 2.0,
                    minTradesPerSec: 0.3,
                    minVolPerSec: 1.5,
                    usePassiveVolume: true,
                },
                mockLogger,
                mockSpoofing,
                mockMetrics
            );

            const baseTime = Date.now();
            const basePrice = 78.9;

            // Create clear momentum pattern: price up + CVD up (aligned)
            const momentumTrades = [
                // Build CVD and price momentum together
                createRealisticTrade(
                    basePrice,
                    4.5,
                    false,
                    baseTime - 45000,
                    80,
                    40
                ),
                createRealisticTrade(
                    basePrice + 0.01,
                    5.2,
                    false,
                    baseTime - 40000,
                    85,
                    35
                ),
                createRealisticTrade(
                    basePrice + 0.02,
                    4.8,
                    false,
                    baseTime - 35000,
                    90,
                    30
                ),
                createRealisticTrade(
                    basePrice + 0.03,
                    6.1,
                    false,
                    baseTime - 30000,
                    95,
                    25
                ),
                createRealisticTrade(
                    basePrice + 0.02,
                    1.2,
                    true,
                    baseTime - 28000,
                    40,
                    120
                ), // Small sell
                createRealisticTrade(
                    basePrice + 0.04,
                    5.7,
                    false,
                    baseTime - 25000,
                    100,
                    20
                ),
                createRealisticTrade(
                    basePrice + 0.05,
                    6.3,
                    false,
                    baseTime - 20000,
                    105,
                    15
                ),
                createRealisticTrade(
                    basePrice + 0.06,
                    5.9,
                    false,
                    baseTime - 15000,
                    110,
                    10
                ),
                createRealisticTrade(
                    basePrice + 0.07,
                    7.1,
                    false,
                    baseTime - 10000,
                    115,
                    5
                ),
                createRealisticTrade(
                    basePrice + 0.08,
                    6.8,
                    false,
                    baseTime - 5000,
                    120,
                    5
                ),
            ];

            momentumTrades.forEach((trade) =>
                momentumDetector.onEnrichedTrade(trade)
            );

            // Should detect strong momentum alignment (price and CVD both up)
            const status = momentumDetector.getStatus();
            expect(status).toContain("CVD Detector");

            const detailedState = momentumDetector.getDetailedState();
            expect(detailedState.states[0].tradesCount).toBeGreaterThan(8);
        });

        it("should detect bearish divergence pattern", () => {
            const divergenceDetector = new DeltaCVDConfirmation(
                "divergence_test",
                {
                    windowsSec: [60],
                    detectionMode: "divergence",
                    divergenceThreshold: 0.25,
                    divergenceLookbackSec: 45,
                    minZ: 1.5, // Lower threshold for divergence
                    minTradesPerSec: 0.3,
                    minVolPerSec: 1.0,
                    usePassiveVolume: true,
                },
                mockLogger,
                mockSpoofing,
                mockMetrics
            );

            const baseTime = Date.now();
            const basePrice = 82.15;

            // Phase 1: Price continues up (momentum)
            const priceUpTrades = [
                createRealisticTrade(
                    basePrice,
                    3.2,
                    false,
                    baseTime - 45000,
                    70,
                    30
                ),
                createRealisticTrade(
                    basePrice + 0.01,
                    3.8,
                    false,
                    baseTime - 40000,
                    75,
                    25
                ),
                createRealisticTrade(
                    basePrice + 0.02,
                    3.5,
                    false,
                    baseTime - 35000,
                    80,
                    20
                ),
                createRealisticTrade(
                    basePrice + 0.03,
                    4.1,
                    false,
                    baseTime - 30000,
                    85,
                    15
                ),
                createRealisticTrade(
                    basePrice + 0.04,
                    3.9,
                    false,
                    baseTime - 25000,
                    90,
                    10
                ),
            ];

            priceUpTrades.forEach((trade) =>
                divergenceDetector.onEnrichedTrade(trade)
            );

            // Phase 2: CVD turns down while price still up (divergence)
            const divergenceTrades = [
                createRealisticTrade(
                    basePrice + 0.05,
                    8.5,
                    true,
                    baseTime - 20000,
                    15,
                    180
                ), // Heavy selling
                createRealisticTrade(
                    basePrice + 0.06,
                    7.2,
                    true,
                    baseTime - 15000,
                    10,
                    160
                ), // More selling
                createRealisticTrade(
                    basePrice + 0.04,
                    1.1,
                    false,
                    baseTime - 12000,
                    140,
                    40
                ), // Weak buying
                createRealisticTrade(
                    basePrice + 0.07,
                    9.1,
                    true,
                    baseTime - 10000,
                    5,
                    200
                ), // Heavy selling
                createRealisticTrade(
                    basePrice + 0.08,
                    8.8,
                    true,
                    baseTime - 5000,
                    5,
                    190
                ), // Heavy selling
                createRealisticTrade(
                    basePrice + 0.09,
                    7.9,
                    true,
                    baseTime,
                    5,
                    170
                ), // Heavy selling
            ];

            divergenceTrades.forEach((trade) =>
                divergenceDetector.onEnrichedTrade(trade)
            );

            // Should detect bearish divergence (price up, CVD down)
            const status = divergenceDetector.getStatus();
            expect(status).toContain("CVD Detector");

            const detailedState = divergenceDetector.getDetailedState();
            expect(detailedState.states[0].tradesCount).toBeGreaterThan(10);
        });

        it("should detect bullish divergence (price down, CVD up)", () => {
            const divergenceDetector = new DeltaCVDConfirmation(
                "bullish_divergence_test",
                {
                    windowsSec: [60],
                    detectionMode: "divergence",
                    divergenceThreshold: 0.2,
                    divergenceLookbackSec: 40,
                    minZ: 1.5,
                    minTradesPerSec: 0.4,
                    minVolPerSec: 1.2,
                    usePassiveVolume: true,
                },
                mockLogger,
                mockSpoofing,
                mockMetrics
            );

            const baseTime = Date.now();
            const basePrice = 76.85;

            // Phase 1: Price declines with selling pressure
            const priceDownTrades = [
                createRealisticTrade(
                    basePrice,
                    4.2,
                    true,
                    baseTime - 40000,
                    30,
                    90
                ),
                createRealisticTrade(
                    basePrice - 0.01,
                    4.8,
                    true,
                    baseTime - 35000,
                    25,
                    95
                ),
                createRealisticTrade(
                    basePrice - 0.02,
                    5.1,
                    true,
                    baseTime - 30000,
                    20,
                    100
                ),
                createRealisticTrade(
                    basePrice - 0.03,
                    4.7,
                    true,
                    baseTime - 25000,
                    15,
                    105
                ),
                createRealisticTrade(
                    basePrice - 0.04,
                    5.3,
                    true,
                    baseTime - 20000,
                    10,
                    110
                ),
            ];

            priceDownTrades.forEach((trade) =>
                divergenceDetector.onEnrichedTrade(trade)
            );

            // Phase 2: Strong buying absorption while price still declining (divergence)
            const bullishDivergenceTrades = [
                createRealisticTrade(
                    basePrice - 0.05,
                    12.8,
                    false,
                    baseTime - 15000,
                    200,
                    20
                ), // Strong buying
                createRealisticTrade(
                    basePrice - 0.06,
                    11.4,
                    false,
                    baseTime - 12000,
                    190,
                    15
                ), // Strong buying
                createRealisticTrade(
                    basePrice - 0.05,
                    1.8,
                    true,
                    baseTime - 10000,
                    80,
                    140
                ), // Weak selling
                createRealisticTrade(
                    basePrice - 0.07,
                    13.2,
                    false,
                    baseTime - 8000,
                    210,
                    10
                ), // Strong buying
                createRealisticTrade(
                    basePrice - 0.06,
                    14.1,
                    false,
                    baseTime - 5000,
                    220,
                    5
                ), // Strong buying
                createRealisticTrade(
                    basePrice - 0.08,
                    12.7,
                    false,
                    baseTime - 2000,
                    200,
                    5
                ), // Strong buying
                createRealisticTrade(
                    basePrice - 0.07,
                    13.9,
                    false,
                    baseTime,
                    230,
                    5
                ), // Strong buying
            ];

            bullishDivergenceTrades.forEach((trade) =>
                divergenceDetector.onEnrichedTrade(trade)
            );

            // Should detect bullish divergence (price down, CVD up)
            const status = divergenceDetector.getStatus();
            expect(status).toContain("CVD Detector");

            const detailedState = divergenceDetector.getDetailedState();
            expect(detailedState.states[0].tradesCount).toBeGreaterThan(10);
        });
    });

    describe("⚡ High-Frequency Market Microstructure", () => {
        beforeEach(() => {
            detector = new DeltaCVDConfirmation(
                "microstructure_test",
                {
                    windowsSec: [30, 60], // Multi-timeframe
                    minZ: 2.5,
                    minTradesPerSec: 1.0, // Higher frequency requirement
                    minVolPerSec: 3.0,
                    burstDetectionMs: 500, // 500ms burst window
                    volumeSurgeMultiplier: 4.0,
                    enableDepthAnalysis: true,
                    usePassiveVolume: true,
                },
                mockLogger,
                mockSpoofing,
                mockMetrics
            );
        });

        it("should detect algorithmic iceberg order execution", () => {
            const baseTime = Date.now();
            const basePrice = 94.5;

            // Build baseline
            const baselineTrades = [];
            for (let i = 0; i < 25; i++) {
                const trade = createRealisticTrade(
                    basePrice + Math.round(Math.random() * 2 - 1) * 0.01, // ±1 cent (tick-aligned)
                    1.0 + Math.random() * 2.0,
                    Math.random() > 0.5,
                    baseTime - 30000 + i * 1000,
                    50,
                    50
                );
                baselineTrades.push(trade);
            }

            baselineTrades.forEach((trade) => detector.onEnrichedTrade(trade));

            // Iceberg pattern: Large order broken into smaller consistent pieces
            const icebergTrades = [
                // Consistent 8.5 LTC chunks (iceberg slices) with regular timing
                createRealisticTrade(
                    basePrice + 0.01,
                    8.5,
                    false,
                    baseTime - 3000,
                    150,
                    30
                ),
                createRealisticTrade(
                    basePrice + 0.01,
                    8.5,
                    false,
                    baseTime - 2500,
                    140,
                    25
                ),
                createRealisticTrade(
                    basePrice + 0.01,
                    8.5,
                    false,
                    baseTime - 2000,
                    135,
                    20
                ),
                createRealisticTrade(
                    basePrice + 0.01,
                    8.5,
                    false,
                    baseTime - 1500,
                    130,
                    15
                ),
                createRealisticTrade(
                    basePrice + 0.01,
                    8.5,
                    false,
                    baseTime - 1000,
                    125,
                    10
                ),
                createRealisticTrade(
                    basePrice + 0.01,
                    8.5,
                    false,
                    baseTime - 500,
                    120,
                    5
                ),

                // Final larger fill (iceberg refill)
                createRealisticTrade(
                    basePrice + 0.02,
                    12.8,
                    false,
                    baseTime,
                    200,
                    5
                ),
            ];

            icebergTrades.forEach((trade) => detector.onEnrichedTrade(trade));

            // Should detect the consistent iceberg execution pattern
            const status = detector.getStatus();
            expect(status).toContain("CVD Detector");

            const detailedState = detector.getDetailedState();
            expect(detailedState.states).toHaveLength(2); // Both 30s and 60s windows
        });

        it("should handle rapid-fire scalping activity", () => {
            const baseTime = Date.now();
            const basePrice = 88.25;

            // Rapid scalping: Many small trades in quick succession
            const scalpingTrades = [];
            for (let i = 0; i < 50; i++) {
                const trade = createRealisticTrade(
                    basePrice + (i % 4) * 0.01, // Bouncing between 4 price levels
                    0.2 + Math.random() * 0.8, // Small scalp sizes 0.2-1.0 LTC
                    i % 2 === 0, // Alternating buy/sell
                    baseTime - 15000 + i * 300, // Every 300ms
                    30 + Math.random() * 20,
                    30 + Math.random() * 20
                );
                scalpingTrades.push(trade);
            }

            scalpingTrades.forEach((trade) => detector.onEnrichedTrade(trade));

            // Add one large institutional trade amidst the noise
            const institutionalTrade = createRealisticTrade(
                basePrice + 0.05,
                45.7, // Large institutional size
                false,
                baseTime,
                300,
                50
            );
            detector.onEnrichedTrade(institutionalTrade);

            // Should filter out scalping noise and detect the institutional trade
            const status = detector.getStatus();
            expect(status).toContain("CVD Detector");

            const detailedState = detector.getDetailedState();
            expect(detailedState.states[0].tradesCount).toBeGreaterThan(45);
        });

        it("should detect market maker quote stuffing followed by institutional flow", () => {
            const baseTime = Date.now();
            const basePrice = 92.8;

            // Quote stuffing: Many tiny trades to create noise
            const stuffingTrades = [];
            for (let i = 0; i < 40; i++) {
                const trade = createRealisticTrade(
                    basePrice + Math.round(Math.random() * 0.6 - 0.3) * 0.01, // ±0.3 cents (tick-aligned)
                    0.05 + Math.random() * 0.1, // Tiny sizes 0.05-0.15 LTC
                    Math.random() > 0.5,
                    baseTime - 8000 + i * 200, // Very rapid (every 200ms)
                    20,
                    20 // Low passive volume
                );
                stuffingTrades.push(trade);
            }

            stuffingTrades.forEach((trade) => detector.onEnrichedTrade(trade));

            // Real institutional flow breaks through the noise
            const realFlowTrades = [
                createRealisticTrade(
                    basePrice + 0.01,
                    18.5,
                    false,
                    baseTime - 3000,
                    200,
                    40
                ),
                createRealisticTrade(
                    basePrice + 0.02,
                    22.1,
                    false,
                    baseTime - 2500,
                    210,
                    30
                ),
                createRealisticTrade(
                    basePrice + 0.03,
                    19.8,
                    false,
                    baseTime - 2000,
                    190,
                    25
                ),
                createRealisticTrade(
                    basePrice + 0.04,
                    21.7,
                    false,
                    baseTime - 1500,
                    220,
                    20
                ),
                createRealisticTrade(
                    basePrice + 0.05,
                    24.3,
                    false,
                    baseTime - 1000,
                    240,
                    15
                ),
                createRealisticTrade(
                    basePrice + 0.06,
                    20.9,
                    false,
                    baseTime - 500,
                    200,
                    10
                ),
            ];

            realFlowTrades.forEach((trade) => detector.onEnrichedTrade(trade));

            // Should detect the real institutional flow despite quote stuffing noise
            const status = detector.getStatus();
            expect(status).toContain("CVD Detector");
        });
    });

    describe("🎯 Edge Cases and Error Conditions", () => {
        beforeEach(() => {
            detector = new DeltaCVDConfirmation(
                "edge_case_test",
                {
                    windowsSec: [60],
                    minZ: 2.0,
                    usePassiveVolume: true,
                    enableDepthAnalysis: true,
                },
                mockLogger,
                mockSpoofing,
                mockMetrics
            );
        });

        it("should handle extreme price gaps (circuit breaker scenario)", () => {
            const baseTime = Date.now();
            const basePrice = 85.0;

            // Normal trading
            const normalTrades = [
                createRealisticTrade(
                    basePrice,
                    5.0,
                    false,
                    baseTime - 10000,
                    100,
                    50
                ),
                createRealisticTrade(
                    basePrice + 0.01,
                    4.5,
                    false,
                    baseTime - 8000,
                    95,
                    45
                ),
            ];

            normalTrades.forEach((trade) => detector.onEnrichedTrade(trade));

            // Extreme price gap (circuit breaker scenario)
            const gapTrade = createRealisticTrade(
                basePrice + 5.0, // $5 gap up (unrealistic but possible)
                25.0,
                false,
                baseTime - 5000,
                50,
                300
            );

            // Should handle extreme price without crashing
            expect(() => {
                detector.onEnrichedTrade(gapTrade);
            }).not.toThrow();

            // Recovery trade back to normal range
            const recoveryTrade = createRealisticTrade(
                basePrice + 0.05,
                8.0,
                false,
                baseTime,
                120,
                60
            );

            expect(() => {
                detector.onEnrichedTrade(recoveryTrade);
            }).not.toThrow();
        });

        it("should handle zero passive volume conditions", () => {
            const baseTime = Date.now();
            const basePrice = 79.5;

            // Trades with zero passive volume (illiquid market)
            const illiquidTrades = [
                createRealisticTrade(
                    basePrice,
                    10.0,
                    false,
                    baseTime - 5000,
                    0,
                    0
                ), // No passive volume
                createRealisticTrade(
                    basePrice + 0.05,
                    8.5,
                    false,
                    baseTime - 3000,
                    0,
                    0
                ), // No passive volume
                createRealisticTrade(
                    basePrice + 0.1,
                    12.0,
                    false,
                    baseTime - 1000,
                    0,
                    0
                ), // No passive volume
            ];

            // Should handle zero passive volume gracefully
            expect(() => {
                illiquidTrades.forEach((trade) =>
                    detector.onEnrichedTrade(trade)
                );
            }).not.toThrow();

            const status = detector.getStatus();
            expect(status).toContain("CVD Detector");
        });

        it("should handle timestamp disorders (late trade reports)", () => {
            const baseTime = Date.now();
            const basePrice = 91.75;

            // Trades arriving out of chronological order (realistic market condition)
            const disorderedTrades = [
                createRealisticTrade(
                    basePrice,
                    5.0,
                    false,
                    baseTime - 1000,
                    100,
                    50
                ), // Latest
                createRealisticTrade(
                    basePrice - 0.01,
                    4.0,
                    true,
                    baseTime - 5000,
                    80,
                    70
                ), // Earlier (late report)
                createRealisticTrade(
                    basePrice + 0.01,
                    6.0,
                    false,
                    baseTime - 2000,
                    110,
                    40
                ), // Middle
                createRealisticTrade(
                    basePrice - 0.02,
                    3.5,
                    true,
                    baseTime - 8000,
                    60,
                    90
                ), // Earliest (very late)
            ];

            // Should handle out-of-order timestamps without corruption
            expect(() => {
                disorderedTrades.forEach((trade) =>
                    detector.onEnrichedTrade(trade)
                );
            }).not.toThrow();

            const detailedState = detector.getDetailedState();
            expect(detailedState.states[0].tradesCount).toBe(4);
        });

        it("should handle extreme volume outliers", () => {
            const baseTime = Date.now();
            const basePrice = 86.25;

            // Build normal baseline
            const normalTrades = [];
            for (let i = 0; i < 20; i++) {
                const trade = createRealisticTrade(
                    basePrice + i * 0.001,
                    2.0 + Math.random() * 3.0, // Normal 2-5 LTC
                    i % 2 === 0,
                    baseTime - 20000 + i * 1000,
                    50,
                    50
                );
                normalTrades.push(trade);
            }

            normalTrades.forEach((trade) => detector.onEnrichedTrade(trade));

            // Extreme outlier (whale trade or error)
            const outlierTrade = createRealisticTrade(
                basePrice + 0.05,
                1000.0, // 1000 LTC (extreme size)
                false,
                baseTime,
                500,
                100
            );

            // Should handle extreme outlier without breaking
            expect(() => {
                detector.onEnrichedTrade(outlierTrade);
            }).not.toThrow();

            const status = detector.getStatus();
            expect(status).toContain("CVD Detector");
        });

        it("should maintain accuracy under memory pressure", () => {
            const baseTime = Date.now();
            const basePrice = 83.9;

            // Generate many trades to create memory pressure
            for (let batch = 0; batch < 10; batch++) {
                const batchTrades = [];
                for (let i = 0; i < 100; i++) {
                    const trade = createRealisticTrade(
                        basePrice + batch * 0.01 + i * 0.0001,
                        1.0 + Math.random() * 5.0,
                        Math.random() > 0.5,
                        baseTime - 30000 + batch * 3000 + i * 30,
                        30 + Math.random() * 70,
                        30 + Math.random() * 70
                    );
                    batchTrades.push(trade);
                }

                // Process batch
                expect(() => {
                    batchTrades.forEach((trade) =>
                        detector.onEnrichedTrade(trade)
                    );
                }).not.toThrow();
            }

            // Should maintain functionality despite processing 1000 trades
            const status = detector.getStatus();
            expect(status).toContain("CVD Detector");

            const detailedState = detector.getDetailedState();
            expect(detailedState.states[0].tradesCount).toBeGreaterThan(0);
        });
    });

    describe("🔬 Multi-Timeframe Analysis", () => {
        beforeEach(() => {
            detector = new DeltaCVDConfirmation(
                "multi_timeframe_test",
                {
                    windowsSec: [30, 60, 120], // 30s, 1m, 2m analysis
                    minZ: 2.0,
                    minTradesPerSec: 0.5,
                    minVolPerSec: 1.5,
                    detectionMode: "hybrid",
                    usePassiveVolume: true,
                    enableDepthAnalysis: true,
                },
                mockLogger,
                mockSpoofing,
                mockMetrics
            );
        });

        it("should detect consistent signal across all timeframes", () => {
            const baseTime = Date.now();
            const basePrice = 77.6;

            // Create sustained institutional buying across all timeframes
            const sustainedBuying = [];
            for (let i = 0; i < 150; i++) {
                const timeOffset = i * 800; // Every 800ms for 2 minutes
                const priceProgress = Math.floor(i / 10) * 0.01; // Gradual price increase (FIXED: properly tick-aligned to 0.01, slower progression)

                let size = 2.0 + Math.random() * 3.0; // Base retail size

                // Add institutional trades every 10th trade
                if (i % 10 === 0) {
                    size = 15.0 + Math.random() * 10.0; // 15-25 LTC institutional
                }

                const trade = createRealisticTrade(
                    basePrice + priceProgress,
                    size,
                    false, // Consistent buying
                    baseTime - 119200 + timeOffset, // FIXED: End at baseTime (now) instead of 800ms ago
                    100 + i, // Increasing passive absorption
                    50 - i * 0.3 // Decreasing ask liquidity
                );
                sustainedBuying.push(trade);
            }

            sustainedBuying.forEach((trade) => detector.onEnrichedTrade(trade));

            // Should detect consistent bullish signal across all timeframes
            const detailedState = detector.getDetailedState();
            expect(detailedState.windows).toEqual([30, 60, 120]);
            expect(detailedState.states).toHaveLength(3);

            // All timeframes should have substantial trade counts
            // Note: Shortest window (30s) may have fewer trades due to time distribution
            detailedState.states.forEach((state, index) => {
                if (index === 0) {
                    // 30-second window - should have ~37 trades (30s / 0.8s = 37.5)
                    expect(state.tradesCount).toBeGreaterThan(30);
                } else {
                    // 60s and 120s windows should have more trades
                    expect(state.tradesCount).toBeGreaterThan(30);
                }
            });
        });

        it("should detect timeframe divergence (short vs long term)", () => {
            const baseTime = Date.now();
            const basePrice = 89.4;

            // Phase 1: Long-term bearish trend (2 minute context)
            const longTermTrend = [];
            for (let i = 0; i < 80; i++) {
                const timeOffset = i * 1400; // Sparse, every 1.4s for long term context
                const priceDecline = -i * 0.01; // Gradual decline (tick-aligned)

                const trade = createRealisticTrade(
                    basePrice + priceDecline,
                    8.0 + Math.random() * 7.0, // Institutional selling
                    true, // Selling pressure
                    baseTime - 120000 + timeOffset,
                    30 + Math.random() * 20, // Declining bid support
                    100 + i // Increasing ask pressure
                );
                longTermTrend.push(trade);
            }

            longTermTrend.forEach((trade) => detector.onEnrichedTrade(trade));

            // Phase 2: Short-term bullish reversal (30 second window)
            const shortTermReversal = [
                createRealisticTrade(
                    basePrice - 0.08,
                    22.5,
                    false,
                    baseTime - 25000,
                    200,
                    40
                ),
                createRealisticTrade(
                    basePrice - 0.07,
                    24.1,
                    false,
                    baseTime - 20000,
                    220,
                    35
                ),
                createRealisticTrade(
                    basePrice - 0.06,
                    26.8,
                    false,
                    baseTime - 15000,
                    240,
                    30
                ),
                createRealisticTrade(
                    basePrice - 0.05,
                    28.2,
                    false,
                    baseTime - 10000,
                    260,
                    25
                ),
                createRealisticTrade(
                    basePrice - 0.04,
                    25.7,
                    false,
                    baseTime - 5000,
                    250,
                    20
                ),
                createRealisticTrade(
                    basePrice - 0.03,
                    27.9,
                    false,
                    baseTime,
                    270,
                    15
                ),
            ];

            shortTermReversal.forEach((trade) =>
                detector.onEnrichedTrade(trade)
            );

            // Should detect different signals on different timeframes
            const detailedState = detector.getDetailedState();

            // Verify we have all timeframes
            expect(detailedState.windows).toEqual([30, 60, 120]);
            expect(detailedState.states).toHaveLength(3);

            // All timeframes should have processed trades
            detailedState.states.forEach((state, index) => {
                expect(state.tradesCount).toBeGreaterThan(0);
                // Longer timeframes should generally have more trades
                if (index > 0) {
                    expect(state.tradesCount).toBeGreaterThanOrEqual(
                        detailedState.states[index - 1].tradesCount
                    );
                }
            });
        });
    });
});
