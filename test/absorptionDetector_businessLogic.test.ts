import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock dependencies
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");

import { AbsorptionDetector } from "../src/indicators/absorptionDetector.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";
import { OrderBookState } from "../src/market/orderBookState.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { AbsorptionSettings } from "../src/indicators/absorptionDetector.js";

/**
 * ✅ BUSINESS LOGIC VALIDATION TEST SUITE
 *
 * This test suite validates the CORRECT business logic implementation of price efficiency analysis,
 * NOT just what the current code does. Tests are written against requirements/specifications
 * to ensure the code implements absorption detection correctly.
 *
 * KEY PRINCIPLE: Tests must FAIL when bugs are present, guide proper implementation
 */
describe("AbsorptionDetector - Business Logic Validation", () => {
    let detector: AbsorptionDetector;
    let mockLogger: ILogger;
    let mockMetrics: MetricsCollector;
    let mockSpoofing: SpoofingDetector;
    let mockOrderBook: OrderBookState;

    const TICK_SIZE = 0.01;
    const BASE_PRICE = 50000;

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            isDebugEnabled: () => false,
            setCorrelationId: vi.fn(),
            removeCorrelationId: vi.fn(),
        } as ILogger;

        mockMetrics = new MetricsCollector();

        mockSpoofing = {
            wasSpoofed: vi.fn().mockReturnValue(false),
        } as any;

        mockOrderBook = {
            getLevel: vi.fn().mockReturnValue({
                bid: 100,
                ask: 100,
                addedBid: 0,
                consumedBid: 0,
                addedAsk: 0,
                consumedAsk: 0,
                bidCount: 1,
                askCount: 1,
            }),
            getCurrentSpread: vi.fn().mockReturnValue(0.01),
            getBestBid: vi.fn().mockReturnValue(BASE_PRICE - 0.005),
            getBestAsk: vi.fn().mockReturnValue(BASE_PRICE + 0.005),
        } as any;

        // Configuration for price efficiency analysis
        const config: AbsorptionSettings = {
            minAggVolume: 40,
            windowMs: 60000,
            pricePrecision: 2,
            zoneTicks: 3,
            eventCooldownMs: 15000,
            priceEfficiencyThreshold: 0.85, // Critical for efficiency analysis
            absorptionThreshold: 0.6,
            minPassiveMultiplier: 1.2,
            maxAbsorptionRatio: 0.4,
            // Volume surge settings for testing (minimal requirements)
            volumeSurgeMultiplier: 1.1, // Very low threshold for testing
            imbalanceThreshold: 0.1, // Very low threshold for testing
            institutionalThreshold: 1.0, // Very low threshold for testing
            burstDetectionMs: 1000,
            sustainedVolumeMs: 5000, // Short window for testing
            medianTradeSize: 1.0,
            priceEfficiencyScalingFactor: 10, // Explicit scaling factor for testing
        };

        detector = new AbsorptionDetector(
            "test-absorption-business",
            config,
            mockOrderBook,
            mockLogger,
            mockSpoofing,
            mockMetrics
        );
    });

    describe("Price Efficiency Analysis (Core Business Logic)", () => {
        it("should detect institutional absorption when price efficiency is below threshold", () => {
            console.log(
                "🎯 TESTING: Price efficiency analysis - core absorption detection"
            );

            // BUSINESS REQUIREMENT: When large volume doesn't move price proportionally,
            // institutional absorption should be detected

            const absorptionPrice = BASE_PRICE;
            let signalGenerated = false;

            detector.on("signalCandidate", (signal) => {
                signalGenerated = true;
                console.log("🎯 Signal generated:", signal);
            });

            // Create baseline volume history for volume analyzer
            const baselineTime = Date.now() - 10000; // 10 seconds ago
            const baselineTrades: EnrichedTradeEvent[] = [];

            for (let i = 0; i < 20; i++) {
                baselineTrades.push({
                    price: absorptionPrice + (Math.random() - 0.5) * 0.1,
                    quantity: 10, // Small baseline volume
                    timestamp: baselineTime + i * 200,
                    buyerIsMaker: Math.random() > 0.5,
                    pair: "BTCUSDT",
                    tradeId: `baseline_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 50,
                    passiveAskVolume: 50,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                });
            }

            // Scenario: 500 LTC volume with minimal price movement (institutional absorption)
            const highVolumeMinimalMovement: EnrichedTradeEvent[] = [];

            for (let i = 0; i < 10; i++) {
                const trade: EnrichedTradeEvent = {
                    price: absorptionPrice + (Math.random() - 0.5) * 0.02, // Very tight price range
                    quantity: 50, // Large institutional size
                    timestamp: Date.now() + i * 1000,
                    buyerIsMaker: false, // Aggressive buying
                    pair: "BTCUSDT",
                    tradeId: `efficiency_test_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 200, // High passive liquidity
                    passiveAskVolume: 200,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                };
                highVolumeMinimalMovement.push(trade);
            }

            // Process baseline trades first to establish volume history
            baselineTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            // Process trades to create absorption scenario
            highVolumeMinimalMovement.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            // BUSINESS VALIDATION: Price efficiency analysis should detect this pattern
            // 500 LTC volume with 0.02 range should have low price efficiency
            const totalVolume = highVolumeMinimalMovement.reduce(
                (sum, t) => sum + t.quantity,
                0
            );
            const priceRange =
                Math.max(...highVolumeMinimalMovement.map((t) => t.price)) -
                Math.min(...highVolumeMinimalMovement.map((t) => t.price));

            console.log(
                `🎯 Business scenario: ${totalVolume} volume, ${priceRange.toFixed(4)} price range`
            );

            // Expected: Volume pressure vs price movement should indicate absorption
            const avgPassive = 200; // From mock
            const volumePressure = totalVolume / avgPassive; // Should be ~2.5
            const expectedMovement = volumePressure * TICK_SIZE * 10; // Scaling factor 10
            const actualEfficiency = priceRange / expectedMovement;

            console.log(
                `🎯 Price efficiency: ${actualEfficiency.toFixed(3)} (threshold: 0.85)`
            );

            // CRITICAL: Price efficiency should be below threshold, triggering absorption detection
            expect(actualEfficiency).toBeLessThan(0.85);
            // Signal should be generated for this inefficient price movement
            expect(signalGenerated).toBe(true);
        });

        it("should NOT detect absorption when price efficiency is above threshold", () => {
            console.log("🎯 TESTING: Normal price efficiency - no absorption");

            // BUSINESS REQUIREMENT: When volume creates proportional price movement,
            // NO absorption should be detected (efficient market)

            const normalPrice = BASE_PRICE;
            let signalGenerated = false;

            detector.on("signalCandidate", () => {
                signalGenerated = true;
            });

            // Scenario: Normal volume with proportional price movement (efficient market)
            const normalEfficiencyTrades: EnrichedTradeEvent[] = [];

            for (let i = 0; i < 10; i++) {
                const trade: EnrichedTradeEvent = {
                    price: normalPrice + i * 0.05, // Significant price progression
                    quantity: 25, // Normal retail size
                    timestamp: Date.now() + i * 1000,
                    buyerIsMaker: false,
                    pair: "BTCUSDT",
                    tradeId: `normal_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 100,
                    passiveAskVolume: 100,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                };
                normalEfficiencyTrades.push(trade);
            }

            // Process normal market trades
            normalEfficiencyTrades.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            // BUSINESS VALIDATION: Normal price efficiency should NOT trigger absorption
            const totalVolume = normalEfficiencyTrades.reduce(
                (sum, t) => sum + t.quantity,
                0
            );
            const priceRange =
                Math.max(...normalEfficiencyTrades.map((t) => t.price)) -
                Math.min(...normalEfficiencyTrades.map((t) => t.price));

            const avgPassive = 100;
            const volumePressure = totalVolume / avgPassive;
            const expectedMovement = volumePressure * TICK_SIZE * 10;
            const actualEfficiency = priceRange / expectedMovement;

            console.log(
                `🎯 Normal efficiency: ${actualEfficiency.toFixed(3)} (should be > 0.85)`
            );

            // CRITICAL: Price efficiency should be above threshold, NO absorption
            expect(actualEfficiency).toBeGreaterThan(0.85);
            // NO signal should be generated for efficient price movement
            expect(signalGenerated).toBe(false);
        });

        it("should detect volume-price divergence indicating hidden institutional orders", () => {
            console.log("🎯 TESTING: Volume-price divergence detection");

            // BUSINESS REQUIREMENT: Hidden institutional orders create volume-price anomalies
            // that should be detected through efficiency analysis

            const institutionalLevel = BASE_PRICE;
            let absorptionSignals: any[] = [];

            detector.on("signalCandidate", (signal) => {
                absorptionSignals.push(signal);
            });

            // Scenario: Repeated large volume hits at same level with minimal price impact
            // (Institutional iceberg order absorbing market flow)
            const icebergAbsorption: EnrichedTradeEvent[] = [];

            // Phase 1: Initial testing trades - normal price movement
            for (let i = 0; i < 3; i++) {
                icebergAbsorption.push({
                    price: institutionalLevel + i * 0.01,
                    quantity: 20,
                    timestamp: Date.now() + i * 1000,
                    buyerIsMaker: false,
                    pair: "BTCUSDT",
                    tradeId: `iceberg_test_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 50,
                    passiveAskVolume: 50,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                });
            }

            // Phase 2: Hit the institutional level - large volume, minimal movement
            for (let i = 0; i < 8; i++) {
                icebergAbsorption.push({
                    price: institutionalLevel + (Math.random() - 0.5) * 0.005, // Tight range at level
                    quantity: 75, // Large institutional absorption
                    timestamp: Date.now() + 5000 + i * 1000,
                    buyerIsMaker: false, // Aggressive buying into absorption
                    pair: "BTCUSDT",
                    tradeId: `iceberg_absorption_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 300, // High passive liquidity (iceberg)
                    passiveAskVolume: 300,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                });
            }

            // Process iceberg absorption scenario
            icebergAbsorption.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            // BUSINESS VALIDATION: Institutional absorption should be detected
            // 600+ LTC hitting same level with minimal price movement
            const institutionalTrades = icebergAbsorption.slice(3); // Last 8 trades
            const institutionalVolume = institutionalTrades.reduce(
                (sum, t) => sum + t.quantity,
                0
            );
            const institutionalRange =
                Math.max(...institutionalTrades.map((t) => t.price)) -
                Math.min(...institutionalTrades.map((t) => t.price));

            console.log(
                `🎯 Institutional scenario: ${institutionalVolume} volume, ${institutionalRange.toFixed(4)} range`
            );

            // Expected: Massive volume with minimal price impact = absorption
            expect(institutionalVolume).toBeGreaterThan(500); // High volume
            expect(institutionalRange).toBeLessThan(0.01); // Minimal price impact
            expect(absorptionSignals.length).toBeGreaterThan(0); // Absorption detected
        });
    });

    describe("Volume Surge Integration with Price Efficiency", () => {
        it("should enhance absorption confidence when volume surge accompanies price inefficiency", () => {
            console.log(
                "🎯 TESTING: Volume surge enhancement of absorption detection"
            );

            // BUSINESS REQUIREMENT: Volume surges during price inefficiency should boost
            // absorption confidence (institutional activity confirmation)

            const surgeLevel = BASE_PRICE;
            let enhancedSignals: any[] = [];

            detector.on("signalCandidate", (signal) => {
                enhancedSignals.push(signal);
                console.log(
                    `🎯 Enhanced signal confidence: ${signal.confidence}`
                );
            });

            // Scenario: Volume surge during price inefficiency (institutional absorption event)
            const surgeAbsorption: EnrichedTradeEvent[] = [];

            // Create volume surge with price inefficiency
            for (let i = 0; i < 12; i++) {
                const trade: EnrichedTradeEvent = {
                    price: surgeLevel + (Math.random() - 0.5) * 0.015, // Tight price control
                    quantity: i < 4 ? 30 : 90, // Volume surge in later trades
                    timestamp: Date.now() + i * 800,
                    buyerIsMaker: false, // Aggressive buying
                    pair: "BTCUSDT",
                    tradeId: `surge_absorption_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 250, // High absorption capacity
                    passiveAskVolume: 250,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                };
                surgeAbsorption.push(trade);
            }

            // Process volume surge absorption
            surgeAbsorption.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            // BUSINESS VALIDATION: Volume surge should enhance absorption detection
            const totalVolume = surgeAbsorption.reduce(
                (sum, t) => sum + t.quantity,
                0
            );
            const surgeVolume = surgeAbsorption
                .slice(4)
                .reduce((sum, t) => sum + t.quantity, 0);
            const baselineVolume = surgeAbsorption
                .slice(0, 4)
                .reduce((sum, t) => sum + t.quantity, 0);

            const volumeMultiplier = surgeVolume / 8 / (baselineVolume / 4);

            console.log(
                `🎯 Volume analysis: baseline=${baselineVolume}, surge=${surgeVolume}, multiplier=${volumeMultiplier.toFixed(2)}`
            );

            // Expected: Volume surge (>2.5x) with price inefficiency should enhance confidence
            expect(volumeMultiplier).toBeGreaterThan(2.5); // Volume surge detected
            expect(enhancedSignals.length).toBeGreaterThan(0); // Enhanced signal generated

            if (enhancedSignals.length > 0) {
                expect(enhancedSignals[0].confidence).toBeGreaterThan(0.6); // Enhanced confidence
            }
        });
    });

    describe("Configuration Validation", () => {
        it("should respect priceEfficiencyThreshold configuration parameter", () => {
            console.log("🎯 TESTING: Configuration parameter validation");

            // BUSINESS REQUIREMENT: priceEfficiencyThreshold must be configurable
            // and directly control absorption detection sensitivity

            const strictConfig: AbsorptionSettings = {
                minAggVolume: 40,
                windowMs: 60000,
                pricePrecision: 2,
                zoneTicks: 3,
                eventCooldownMs: 15000,
                priceEfficiencyThreshold: 0.95, // Very strict threshold
                absorptionThreshold: 0.6,
                minPassiveMultiplier: 1.2,
                maxAbsorptionRatio: 0.4,
                priceEfficiencyScalingFactor: 10,
            };

            const strictDetector = new AbsorptionDetector(
                "test-strict-efficiency",
                strictConfig,
                mockOrderBook,
                mockLogger,
                mockSpoofing,
                mockMetrics
            );

            let strictSignals: any[] = [];
            strictDetector.on("signalCandidate", (signal) => {
                strictSignals.push(signal);
            });

            // Test with moderate inefficiency that should NOT trigger strict threshold
            const moderateInefficiency: EnrichedTradeEvent[] = [];
            for (let i = 0; i < 8; i++) {
                moderateInefficiency.push({
                    price: BASE_PRICE + i * 0.01, // Moderate price movement
                    quantity: 40,
                    timestamp: Date.now() + i * 1000,
                    buyerIsMaker: false,
                    pair: "BTCUSDT",
                    tradeId: `moderate_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 120,
                    passiveAskVolume: 120,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                });
            }

            moderateInefficiency.forEach((trade) => {
                strictDetector.onEnrichedTrade(trade);
            });

            // BUSINESS VALIDATION: Strict threshold should prevent signal generation
            const volume = moderateInefficiency.reduce(
                (sum, t) => sum + t.quantity,
                0
            );
            const range =
                Math.max(...moderateInefficiency.map((t) => t.price)) -
                Math.min(...moderateInefficiency.map((t) => t.price));

            const efficiency = range / ((volume / 120) * TICK_SIZE * 10);

            console.log(
                `🎯 Efficiency with strict threshold: ${efficiency.toFixed(3)} (threshold: 0.95)`
            );

            // Expected: Moderate efficiency should NOT trigger strict threshold
            expect(efficiency).toBeLessThan(0.95); // Below strict threshold
            expect(strictSignals.length).toBe(0); // No signals with strict config
        });
    });

    describe("Real Market Scenarios", () => {
        it("should detect institutional support level absorption", () => {
            console.log(
                "🎯 TESTING: Institutional support level absorption scenario"
            );

            // REAL SCENARIO: Large institutional buyer defending key support level
            // Creates price inefficiency as market sells into their absorption

            const supportLevel = 49950; // Key psychological support
            let supportSignals: any[] = [];

            detector.on("signalCandidate", (signal) => {
                supportSignals.push(signal);
            });

            // Market scenario: Panic selling into institutional support buying
            const supportDefense: EnrichedTradeEvent[] = [];

            // Initial selling pressure drives to support
            for (let i = 0; i < 4; i++) {
                supportDefense.push({
                    price: 50000 - i * 10, // Price declining to support
                    quantity: 35,
                    timestamp: Date.now() + i * 2000,
                    buyerIsMaker: true, // Aggressive selling
                    pair: "BTCUSDT",
                    tradeId: `decline_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 80,
                    passiveAskVolume: 80,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                });
            }

            // Institutional absorption at support - high volume, minimal price decline
            for (let i = 0; i < 8; i++) {
                supportDefense.push({
                    price: supportLevel + (Math.random() - 0.5) * 5, // Tight range at support
                    quantity: 85, // Large institutional absorption
                    timestamp: Date.now() + 10000 + i * 1500,
                    buyerIsMaker: true, // Continued selling pressure
                    pair: "BTCUSDT",
                    tradeId: `support_absorption_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 400, // Massive institutional buying
                    passiveAskVolume: 100,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                });
            }

            supportDefense.forEach((trade) => {
                detector.onEnrichedTrade(trade);
            });

            // BUSINESS VALIDATION: Support level absorption should be detected
            const supportTrades = supportDefense.slice(4); // Last 8 trades at support
            const supportVolume = supportTrades.reduce(
                (sum, t) => sum + t.quantity,
                0
            );
            const supportRange =
                Math.max(...supportTrades.map((t) => t.price)) -
                Math.min(...supportTrades.map((t) => t.price));

            console.log(
                `🎯 Support defense: ${supportVolume} volume, ${supportRange.toFixed(1)} range at ${supportLevel}`
            );

            // Expected: High volume with minimal price decline = institutional absorption
            expect(supportVolume).toBeGreaterThan(600); // Institutional volume
            expect(supportRange).toBeLessThan(15); // Price defended tightly
            expect(supportSignals.length).toBeGreaterThan(0); // Absorption detected
        });
    });
});
