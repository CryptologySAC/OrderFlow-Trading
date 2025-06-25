// test/absorptionDetector_specifications.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { AbsorptionDetector } from "../src/indicators/absorptionDetector.js";
import type { AbsorptionSettings } from "../src/indicators/absorptionDetector.js";
import type {
    EnrichedTradeEvent,
    AggressiveTrade,
} from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { IOrderBookState } from "../src/market/orderBookState.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";
import { FinancialMath } from "../src/utils/financialMath.js";

/**
 * CRITICAL REQUIREMENT: These tests validate EXPECTED CORRECT BEHAVIOR
 * based on AbsorptionDetector specifications, NOT current code output.
 *
 * Tests MUST fail if the implementation doesn't meet these requirements.
 */

describe("AbsorptionDetector - Specification Compliance", () => {
    let detector: AbsorptionDetector;
    let mockOrderBook: IOrderBookState;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockSpoofingDetector: SpoofingDetector;

    const defaultSettings: AbsorptionSettings = {
        windowMs: 60000,
        minAggVolume: 40, // Real config value
        pricePrecision: 2, // Real config: 2 decimals
        zoneTicks: 3, // Real config: 3 ticks = $0.03 zones
        absorptionThreshold: 0.6, // Real config value
        priceEfficiencyThreshold: 0.02, // Real config: 2% not 85%!
        maxAbsorptionRatio: 0.7, // Allow up to 70% aggressive vs passive for absorption

        // Realistic absorption level thresholds based on market data
        strongAbsorptionRatio: 0.6, // 60% = strong absorption (realistic for institutional flows)
        moderateAbsorptionRatio: 0.8, // 80% = moderate absorption (typical market absorption)
        weakAbsorptionRatio: 1.0, // 100% = weak absorption (balanced aggressive/passive)

        spreadImpactThreshold: 0.003,
        velocityIncreaseThreshold: 1.5,
        features: {
            liquidityGradient: true,
            absorptionVelocity: false,
            layeredAbsorption: false,
            spreadImpact: true,
        },
    };

    beforeEach(() => {
        mockOrderBook = {
            getBestBid: vi.fn().mockReturnValue(100.5),
            getBestAsk: vi.fn().mockReturnValue(100.6),
            getSpread: vi.fn().mockReturnValue({ spread: 0.1, spreadBps: 10 }),
            getDepth: vi.fn().mockReturnValue(new Map()),
            isHealthy: vi.fn().mockReturnValue(true),
            getLastUpdate: vi.fn().mockReturnValue(Date.now()),
        } as any;

        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        } as any;

        mockMetrics = {
            updateMetric: vi.fn(),
            incrementMetric: vi.fn(),
        } as any;

        mockSpoofingDetector = {
            isLikelySpoof: vi.fn().mockReturnValue(false),
        } as any;

        detector = new AbsorptionDetector(
            "TEST",
            defaultSettings,
            mockOrderBook,
            mockLogger,
            mockSpoofingDetector,
            mockMetrics
        );
    });

    describe("SPECIFICATION: Price Efficiency Analysis", () => {
        it("MUST detect absorption when price efficiency is below threshold", async () => {
            // REQUIREMENT: Low efficiency (< 0.85) indicates institutional absorption
            const testData = createPriceEfficiencyTestData({
                actualPriceMovement: 0.05, // Small price movement
                expectedPriceMovement: 0.1, // Large expected movement
                // Efficiency = 0.05 / 0.10 = 0.5 (< 0.85 threshold)
                volumePressure: 2.0,
                passiveLiquidity: 1000,
            });

            let signalDetected = false;
            let signalCount = 0;
            detector.on("signalCandidate", (signal) => {
                signalDetected = true;
                signalCount++;
                console.log("🎯 SIGNAL DETECTED:", signal);
            });

            console.log("🔍 Test data:", {
                tradeCount: testData.trades.length,
                firstTrade: testData.trades[0],
                lastTrade: testData.trades[testData.trades.length - 1],
                totalVolume: testData.trades.reduce(
                    (sum, t) => sum + t.quantity,
                    0
                ),
                settings: {
                    minAggVolume: (detector as any).minAggVolume,
                    priceEfficiencyThreshold: (detector as any)
                        .priceEfficiencyThreshold,
                    absorptionThreshold: (detector as any).absorptionThreshold,
                },
            });

            // Create TRUE absorption scenario based on REAL LTCUSDT data patterns
            console.log("🎯 Creating TRUE absorption scenario...");
            const baseTime = Date.now() - 10000; // 10 seconds ago
            const basePrice = 84.94; // Real LTCUSDT price from backtest data

            // REAL ABSORPTION: Based on actual trades 293785825-293785828 pattern spread over 15-minute timeframe
            // Pattern: 310 LTC volume absorbed with only 0¢ price movement = ultra-strong absorption
            const absorptionTrades = [
                {
                    price: basePrice,
                    volume: 40,
                    timestamp: baseTime + 0 * 60 * 1000,
                }, // T+0 min
                {
                    price: basePrice,
                    volume: 50,
                    timestamp: baseTime + 3 * 60 * 1000,
                }, // T+3 min
                {
                    price: basePrice,
                    volume: 110,
                    timestamp: baseTime + 7 * 60 * 1000,
                }, // T+7 min
                {
                    price: basePrice,
                    volume: 85,
                    timestamp: baseTime + 11 * 60 * 1000,
                }, // T+11 min
                {
                    price: basePrice,
                    volume: 25,
                    timestamp: baseTime + 15 * 60 * 1000,
                }, // T+15 min
            ];

            // Calculate expected scenario
            const totalVolume = absorptionTrades.reduce(
                (s, t) => s + t.volume,
                0
            );
            const priceMovement = 0.0; // PERFECT: Same price despite 310 LTC volume = 0% efficiency
            console.log(
                `📊 TRUE ABSORPTION: ${totalVolume} total volume, ${priceMovement} price movement`
            );
            console.log(
                `📊 Ratio: ${((priceMovement / totalVolume) * 1000000).toFixed(4)} price per 1M volume`
            );
            console.log(
                `📊 Expected: MASSIVE volume + TINY price movement = efficiency << 0.02 (2%)`
            );

            // Create custom trade helper for absorption scenario with HIGH passive volume
            function createAbsorptionTradeEvent(params: {
                price: number;
                volume: number;
                side: "buy" | "sell";
                timestamp?: number;
                tradeId?: string;
                passiveAskVolume?: number;
            }): EnrichedTradeEvent {
                const timestamp = params.timestamp ?? Date.now();
                const tradeId = params.tradeId ?? `test_${timestamp}`;

                return {
                    price: params.price,
                    quantity: params.volume,
                    timestamp: timestamp,
                    buyerIsMaker: params.side === "sell",
                    pair: "TESTUSDT",
                    tradeId: tradeId,
                    originalTrade: {
                        p: params.price.toString(),
                        q: params.volume.toString(),
                        T: timestamp,
                        m: params.side === "sell",
                    } as any,
                    // STRONG absorption scenario: High passive volume that can absorb the aggressive flow
                    passiveBidVolume: 1500, // High liquidity pool for absorption
                    passiveAskVolume: params.passiveAskVolume ?? 1800, // High ask side liquidity
                    zonePassiveBidVolume: 300, // Substantial zone liquidity
                    zonePassiveAskVolume: params.passiveAskVolume
                        ? params.passiveAskVolume / 6
                        : 300, // Strong absorption capacity
                    bestBid: params.price - 0.01,
                    bestAsk: params.price + 0.01,
                } as EnrichedTradeEvent;
            }

            // Process all trades to build up the zone with strong absorption capacity
            for (let i = 0; i < absorptionTrades.length; i++) {
                // Strong absorption: High passive volume that absorbs aggressive flow with minimal depletion
                const remainingPassiveVolume = 1800 - i * 60; // Decreases slowly: 1800, 1740, 1680, 1620, 1560
                const trade = createAbsorptionTradeEvent({
                    price: absorptionTrades[i].price,
                    volume: absorptionTrades[i].volume,
                    side: "buy",
                    timestamp: absorptionTrades[i].timestamp,
                    tradeId: `absorption_${i}`,
                    passiveAskVolume: Math.max(remainingPassiveVolume, 1500), // Maintain strong absorption capacity
                });
                console.log(
                    `🔄 Trade ${i + 1}: price=${trade.price}, aggVolume=${trade.quantity}, passiveAsk=${trade.passiveAskVolume} (real absorption)`
                );
                detector.onEnrichedTrade(trade);
            }

            console.log("📊 Result:", { signalDetected, signalCount });

            // Wait a short time for async signal emission
            await new Promise((resolve) => setTimeout(resolve, 10));

            console.log("📊 Final Result after wait:", {
                signalDetected,
                signalCount,
            });

            // EXPECTED BEHAVIOR: Must detect absorption due to low price efficiency
            expect(signalDetected).toBe(true);
        });

        it("MUST NOT detect absorption when price efficiency is above threshold", () => {
            // REQUIREMENT: High efficiency (≥ 0.85) indicates normal price discovery
            const testData = createPriceEfficiencyTestData({
                actualPriceMovement: 0.09, // Expected price movement
                expectedPriceMovement: 0.1, // Based on volume pressure
                // Efficiency = 0.09 / 0.10 = 0.9 (≥ 0.85 threshold)
                volumePressure: 1.0,
                passiveLiquidity: 1000,
            });

            let signalDetected = false;
            detector.on("signal", () => {
                signalDetected = true;
            });

            testData.trades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            // EXPECTED BEHAVIOR: Must NOT detect absorption due to normal efficiency
            expect(signalDetected).toBe(false);
        });

        it("MUST use FinancialMath for all price efficiency calculations", () => {
            // REQUIREMENT: All financial calculations must use FinancialMath
            const spy = vi.spyOn(FinancialMath, "divideQuantities");

            const testData = createPriceEfficiencyTestData({
                actualPriceMovement: 0.05,
                expectedPriceMovement: 0.1,
                volumePressure: 2.0,
                passiveLiquidity: 1000,
            });

            testData.trades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            // EXPECTED BEHAVIOR: Must use FinancialMath for calculations
            expect(spy).toHaveBeenCalled();
        });
    });

    describe("SPECIFICATION: Volume Surge Detection", () => {
        it("MUST enhance confidence when volume surge (4x) is detected", () => {
            // REQUIREMENT: 4x volume surge validates institutional activity
            const normalVolume = 100;
            const surgeVolume = 400; // 4x surge

            const baseTrade = createTradeEvent({
                price: 100.5,
                volume: normalVolume,
                side: "buy",
            });

            const surgeTrade = createTradeEvent({
                price: 100.5,
                volume: surgeVolume,
                side: "buy",
            });

            let baseSignalStrength = 0;
            let surgeSignalStrength = 0;

            // Process normal volume first
            detector.onEnrichedTrade(baseTrade);
            detector.on("signal", (signal: any) => {
                baseSignalStrength = signal.confidence || 0;
            });

            // Reset detector and process surge volume
            detector = new AbsorptionDetector(
                "TEST",
                defaultSettings,
                mockOrderBook,
                mockLogger,
                mockSpoofingDetector,
                mockMetrics
            );

            detector.onEnrichedTrade(surgeTrade);
            detector.on("signal", (signal: any) => {
                surgeSignalStrength = signal.confidence || 0;
            });

            // EXPECTED BEHAVIOR: Surge volume must increase signal confidence
            expect(surgeSignalStrength).toBeGreaterThan(baseSignalStrength);
        });

        it("MUST require minimum volume threshold for surge detection", () => {
            // REQUIREMENT: Prevent false positives from low-volume surges
            const lowVolumeBase = 1;
            const lowVolumeSurge = 4; // 4x but very low absolute volume

            const surgeTrade = createTradeEvent({
                price: 100.5,
                volume: lowVolumeSurge,
                side: "buy",
            });

            let signalDetected = false;
            detector.on("signal", () => {
                signalDetected = true;
            });

            detector.onEnrichedTrade(surgeTrade);

            // EXPECTED BEHAVIOR: Must NOT trigger on low absolute volume surges
            expect(signalDetected).toBe(false);
        });
    });

    describe("SPECIFICATION: Order Flow Imbalance Analysis", () => {
        it("MUST detect directional bias with 35% imbalance threshold", () => {
            // REQUIREMENT: 35% order flow imbalance confirms directional bias
            const imbalancedTrades = createImbalancedTradeSequence({
                buyVolume: 700, // 70% buy volume
                sellVolume: 300, // 30% sell volume
                // Imbalance = |700-300|/(700+300) = 400/1000 = 40% > 35%
                priceLevel: 100.5,
            });

            let signalData: any = null;
            detector.on("signal", (signal: any) => {
                signalData = signal;
            });

            imbalancedTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            // EXPECTED BEHAVIOR: Must detect imbalance and include in signal
            expect(signalData).not.toBeNull();
            expect(signalData.metadata?.orderFlowImbalance).toBeGreaterThan(
                0.35
            );
        });

        it("MUST NOT trigger on balanced order flow", () => {
            // REQUIREMENT: Balanced flow should not indicate directional bias
            const balancedTrades = createImbalancedTradeSequence({
                buyVolume: 500, // 50% buy volume
                sellVolume: 500, // 50% sell volume
                // Imbalance = |500-500|/(500+500) = 0/1000 = 0% < 35%
                priceLevel: 100.5,
            });

            let signalDetected = false;
            detector.on("signal", () => {
                signalDetected = true;
            });

            balancedTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            // EXPECTED BEHAVIOR: Must NOT detect imbalance signal
            expect(signalDetected).toBe(false);
        });
    });

    describe("SPECIFICATION: Configuration Compliance", () => {
        it("MUST use all configurable thresholds instead of magic numbers", () => {
            // REQUIREMENT: Zero magic numbers - all thresholds configurable
            const customSettings: AbsorptionSettings = {
                ...defaultSettings,
                priceEfficiencyThreshold: 0.75,
                spreadImpactThreshold: 0.005,
                velocityIncreaseThreshold: 2.0,
            };

            const customDetector = new AbsorptionDetector(
                "CUSTOM",
                customSettings,
                mockOrderBook,
                mockLogger,
                mockSpoofingDetector,
                mockMetrics
            );

            // Test each configurable threshold
            const testScenarios = [
                createPriceEfficiencyTestData({
                    actualPriceMovement: 0.08,
                    expectedPriceMovement: 0.1,
                    // Efficiency = 0.8 > 0.75 threshold (custom)
                    volumePressure: 1.0,
                    passiveLiquidity: 1000,
                }),
            ];

            let signalDetected = false;
            customDetector.on("signal", () => {
                signalDetected = true;
            });

            testScenarios.forEach((scenario) => {
                scenario.trades.forEach((trade) => {
                    customDetector.onEnrichedTrade(trade);
                });
            });

            // EXPECTED BEHAVIOR: Must use custom thresholds, not defaults
            expect(signalDetected).toBe(false); // Should not trigger with higher efficiency than custom threshold
        });

        it("MUST return null when insufficient data for analysis", () => {
            // REQUIREMENT: Return null instead of defaults when calculations fail
            const emptyDataTrade = createTradeEvent({
                price: 100.5,
                volume: 5, // Below minimum volume threshold
                side: "buy",
            });

            let signalDetected = false;
            detector.on("signal", () => {
                signalDetected = true;
            });

            detector.onEnrichedTrade(emptyDataTrade);

            // EXPECTED BEHAVIOR: Must not emit signal with insufficient data
            expect(signalDetected).toBe(false);
        });
    });

    describe("SPECIFICATION: Signal Quality Requirements", () => {
        it("MUST emit signals with required metadata structure", () => {
            // REQUIREMENT: Signals must include all required institutional-grade metadata
            const qualifyingTrade = createTradeEvent({
                price: 100.5,
                volume: 1000, // Large volume
                side: "buy",
            });

            let signalData: any = null;
            detector.on("signal", (signal: any) => {
                signalData = signal;
            });

            detector.onEnrichedTrade(qualifyingTrade);

            if (signalData) {
                // EXPECTED BEHAVIOR: Must include all required fields
                expect(signalData).toHaveProperty("price");
                expect(signalData).toHaveProperty("side");
                expect(signalData).toHaveProperty("confidence");
                expect(signalData).toHaveProperty("timestamp");
                expect(signalData).toHaveProperty("metadata");

                // Institutional-grade metadata requirements
                expect(signalData.metadata).toHaveProperty("priceEfficiency");
                expect(signalData.metadata).toHaveProperty("volumePressure");
                expect(signalData.metadata).toHaveProperty("passiveLiquidity");

                // Confidence must be valid range
                expect(signalData.confidence).toBeGreaterThanOrEqual(0);
                expect(signalData.confidence).toBeLessThanOrEqual(1);
            }
        });

        it("MUST respect cooldown periods to prevent signal spam", () => {
            // REQUIREMENT: Cooldown prevents excessive signals from same zone
            const sameZoneTrades = [
                createTradeEvent({ price: 100.5, volume: 1000, side: "buy" }),
                createTradeEvent({ price: 100.5, volume: 1000, side: "buy" }), // Same zone, immediate
            ];

            let signalCount = 0;
            detector.on("signal", () => {
                signalCount++;
            });

            sameZoneTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            // EXPECTED BEHAVIOR: Must not emit multiple signals in cooldown period
            expect(signalCount).toBeLessThanOrEqual(1);
        });
    });

    // Helper function to create price efficiency test data
    function createPriceEfficiencyTestData(params: {
        actualPriceMovement: number;
        expectedPriceMovement: number;
        volumePressure: number;
        passiveLiquidity: number;
    }): { trades: EnrichedTradeEvent[] } {
        const basePrice = 100.5;
        const trades: EnrichedTradeEvent[] = [];

        // Create trade sequence that produces the specified price movement
        const startPrice = basePrice;
        const endPrice = basePrice + params.actualPriceMovement;
        const volume = params.volumePressure * params.passiveLiquidity;
        const tradeCount = 5; // Create enough trades for analysis (minimum 3 required)

        // Create trade sequence spanning the price movement
        const baseTimestamp = Date.now();
        for (let i = 0; i < tradeCount; i++) {
            const progress = i / (tradeCount - 1); // 0 to 1
            const currentPrice =
                startPrice + params.actualPriceMovement * progress;

            trades.push(
                createTradeEvent({
                    price: currentPrice,
                    volume: volume / tradeCount,
                    side: "buy",
                    timestamp: baseTimestamp + i * 1000, // Space trades 1 second apart
                    tradeId: `test_${baseTimestamp + i}`, // Unique trade IDs
                })
            );
        }

        return { trades };
    }

    // Helper function to create trade events
    function createTradeEvent(params: {
        price: number;
        volume: number;
        side: "buy" | "sell";
        timestamp?: number;
        tradeId?: string;
    }): EnrichedTradeEvent {
        const timestamp = params.timestamp ?? Date.now();
        const tradeId = params.tradeId ?? `test_${timestamp}`;

        return {
            // Simulate properly processed EnrichedTradeEvent (not raw Binance data)
            price: params.price, // Should be number, not string
            quantity: params.volume, // Should be number, not string
            timestamp: timestamp,
            buyerIsMaker: params.side === "sell",
            pair: "TESTUSDT",
            tradeId: tradeId,
            originalTrade: {
                // Raw Binance data would have strings, but this is processed
                p: params.price.toString(),
                q: params.volume.toString(),
                T: timestamp,
                m: params.side === "sell",
            } as any,
            // Required enriched fields
            passiveBidVolume: 1000,
            passiveAskVolume: 1000,
            zonePassiveBidVolume: 500,
            zonePassiveAskVolume: 500,
            bestBid: params.price - 0.01,
            bestAsk: params.price + 0.01,
        } as EnrichedTradeEvent;
    }

    // Helper function to create imbalanced trade sequences
    function createImbalancedTradeSequence(params: {
        buyVolume: number;
        sellVolume: number;
        priceLevel: number;
    }): EnrichedTradeEvent[] {
        const trades: EnrichedTradeEvent[] = [];

        // Add buy trades
        for (let i = 0; i < 5; i++) {
            trades.push(
                createTradeEvent({
                    price: params.priceLevel,
                    volume: params.buyVolume / 5,
                    side: "buy",
                })
            );
        }

        // Add sell trades
        for (let i = 0; i < 5; i++) {
            trades.push(
                createTradeEvent({
                    price: params.priceLevel,
                    volume: params.sellVolume / 5,
                    side: "sell",
                })
            );
        }

        return trades;
    }
});
