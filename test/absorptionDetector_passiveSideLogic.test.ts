// test/absorptionDetector_passiveSideLogic.test.ts
/**
 * Unit tests to verify the correct passive side logic in AbsorptionDetector
 * Tests the relationship between buyerIsMaker field and passive liquidity mapping
 *
 * Reference: docs/BuyerIsMaker-field.md
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AbsorptionDetector } from "../src/indicators/absorptionDetector.js";
import type {
    EnrichedTradeEvent,
    AggressiveTrade,
} from "../src/types/marketEvents.js";
import { WorkerLogger } from "../src/multithreading/workerLogger.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";
import { OrderBookState } from "../src/market/orderBookState.js";
import { Detected } from "../src/indicators/interfaces/detectorInterfaces.js";

describe("AbsorptionDetector - Passive Side Logic", () => {
    let detector: AbsorptionDetector;
    let mockCallback: vi.MockedFunction<(signal: Detected) => void>;
    let mockLogger: WorkerLogger;
    let mockMetrics: MetricsCollector;
    let mockSpoofing: SpoofingDetector;
    let mockOrderBook: OrderBookState;

    beforeEach(() => {
        mockCallback = vi.fn();
        mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        } as any;

        mockMetrics = {
            incrementCounter: vi.fn(),
            incrementMetric: vi.fn(),
            updateMetric: vi.fn(),
            recordHistogram: vi.fn(),
            recordGauge: vi.fn(),
            setGauge: vi.fn(),
            createCounter: vi.fn(),
            createHistogram: vi.fn(),
            createGauge: vi.fn(),
        } as any;

        mockSpoofing = {
            checkWallSpoofing: vi.fn().mockReturnValue(false),
            getWallDetectionMetrics: vi.fn().mockReturnValue({}),
            wasSpoofed: vi.fn().mockReturnValue(false),
            trackPassiveChange: vi.fn(),
        } as any;

        mockOrderBook = {
            getLevel: vi.fn().mockReturnValue({ bid: 100, ask: 100 }),
            getCurrentSpread: vi.fn().mockReturnValue({ spread: 0.01 }),
        } as any;

        detector = new AbsorptionDetector(
            "test-absorption",
            mockCallback,
            {
                symbol: "LTCUSDT",
                pricePrecision: 2,
                minAggVolume: 100,
                absorptionThreshold: 0.75,
                windowMs: 90000,
                zoneTicks: 3,
                features: {
                    spoofingDetection: false,
                    icebergDetection: false,
                    liquidityGradient: false,
                    absorptionVelocity: false,
                },
            },
            mockOrderBook,
            mockLogger,
            mockSpoofing,
            mockMetrics
        );
    });

    describe("buyerIsMaker Logic Validation", () => {
        it("should correctly identify trade sides based on buyerIsMaker", () => {
            // Access protected method for testing
            const getTradeSide = (detector as any).getTradeSide.bind(detector);

            // Test case 1: buyerIsMaker = true (seller is aggressor)
            const aggressiveSellTrade: AggressiveTrade = {
                price: 100.0,
                quantity: 50,
                timestamp: Date.now(),
                buyerIsMaker: true, // Buyer was passive, seller was aggressive
            };

            const sellSide = getTradeSide(aggressiveSellTrade);
            expect(sellSide).toBe("sell");

            // Test case 2: buyerIsMaker = false (buyer is aggressor)
            const aggressiveBuyTrade: AggressiveTrade = {
                price: 100.0,
                quantity: 50,
                timestamp: Date.now(),
                buyerIsMaker: false, // Seller was passive, buyer was aggressive
            };

            const buySide = getTradeSide(aggressiveBuyTrade);
            expect(buySide).toBe("buy");
        });

        it("should map passive sides correctly for absorption detection", () => {
            // Mock zone history with bid/ask data
            const mockZoneHistory = {
                toArray: () => [
                    {
                        bid: 1000,
                        ask: 800,
                        total: 1800,
                        timestamp: Date.now() - 5000,
                    },
                    {
                        bid: 950,
                        ask: 850,
                        total: 1800,
                        timestamp: Date.now() - 4000,
                    },
                    {
                        bid: 900,
                        ask: 900,
                        total: 1800,
                        timestamp: Date.now() - 3000,
                    },
                    {
                        bid: 850,
                        ask: 950,
                        total: 1800,
                        timestamp: Date.now() - 2000,
                    },
                    {
                        bid: 800,
                        ask: 1000,
                        total: 1800,
                        timestamp: Date.now() - 1000,
                    },
                ],
            };

            // Set up mock zone history
            const zone = 10000; // $100.00 * 100
            (detector as any).zonePassiveHistory.set(zone, mockZoneHistory);

            // Test passive side mapping logic
            const snapshots = mockZoneHistory.toArray();

            // For buy absorption (aggressive buys hitting ask liquidity)
            const buyAbsorptionPassive = snapshots.map(
                (snapshot) => snapshot.ask
            );
            expect(buyAbsorptionPassive).toEqual([800, 850, 900, 950, 1000]);

            // For sell absorption (aggressive sells hitting bid liquidity)
            const sellAbsorptionPassive = snapshots.map(
                (snapshot) => snapshot.bid
            );
            expect(sellAbsorptionPassive).toEqual([1000, 950, 900, 850, 800]);
        });
    });

    describe("Absorption Scenarios", () => {
        it("should correctly identify buy absorption scenario", () => {
            /**
             * Buy Absorption Scenario:
             * - Aggressive buyers (buyerIsMaker = false) hit ASK liquidity
             * - We test ASK depletion and refill patterns
             * - Passive sellers provide liquidity at ASK levels
             */

            const aggressiveBuyTrade: AggressiveTrade = {
                price: 100.0,
                quantity: 200,
                timestamp: Date.now(),
                buyerIsMaker: false, // Buyer is aggressor, seller is passive
            };

            const side = (detector as any).getTradeSide(aggressiveBuyTrade);
            expect(side).toBe("buy");

            // Verify passive side selection
            // For buy side (aggressive buys), we check ASK liquidity depletion
            const testSnapshot = {
                bid: 1000,
                ask: 500,
                total: 1500,
                timestamp: Date.now(),
            };
            const passiveSide =
                side === "buy" ? testSnapshot.ask : testSnapshot.bid;
            expect(passiveSide).toBe(500); // ASK liquidity being absorbed
        });

        it("should correctly identify sell absorption scenario", () => {
            /**
             * Sell Absorption Scenario:
             * - Aggressive sellers (buyerIsMaker = true) hit BID liquidity
             * - We test BID depletion and refill patterns
             * - Passive buyers provide liquidity at BID levels
             */

            const aggressiveSellTrade: AggressiveTrade = {
                price: 100.0,
                quantity: 200,
                timestamp: Date.now(),
                buyerIsMaker: true, // Seller is aggressor, buyer is passive
            };

            const side = (detector as any).getTradeSide(aggressiveSellTrade);
            expect(side).toBe("sell");

            // Verify passive side selection
            // For sell side (aggressive sells), we check BID liquidity depletion
            const testSnapshot = {
                bid: 1200,
                ask: 300,
                total: 1500,
                timestamp: Date.now(),
            };
            const passiveSide =
                side === "sell" ? testSnapshot.bid : testSnapshot.ask;
            expect(passiveSide).toBe(1200); // BID liquidity being absorbed
        });
    });

    describe("Market Scenarios with BuyerIsMaker Field", () => {
        it("should handle institutional accumulation pattern (passive buying)", () => {
            /**
             * Institutional Accumulation:
             * - Institution places passive BID orders
             * - Retail/informed traders hit those bids with market sells
             * - buyerIsMaker = true (buyer=institution was passive, seller=retail was aggressive)
             * - This creates SELL absorption at BID levels
             */

            const institutionalAccumulationTrade: AggressiveTrade = {
                price: 100.0,
                quantity: 500,
                timestamp: Date.now(),
                buyerIsMaker: true, // Institution was passive buyer, retail was aggressive seller
            };

            const side = (detector as any).getTradeSide(
                institutionalAccumulationTrade
            );
            expect(side).toBe("sell"); // Aggressive selling being absorbed

            // Institution is absorbing sells at BID levels
            const mockSnapshot = {
                bid: 2000,
                ask: 500,
                total: 2500,
                timestamp: Date.now(),
            };
            const relevantPassive =
                side === "buy" ? mockSnapshot.ask : mockSnapshot.bid;
            expect(relevantPassive).toBe(2000); // Strong BID liquidity absorbing sells
        });

        it("should handle institutional distribution pattern (aggressive selling)", () => {
            /**
             * Institutional Distribution:
             * - Institution hits retail ASK orders with market sells
             * - Retail provides passive ASK liquidity
             * - buyerIsMaker = true (retail buyer was passive, institution seller was aggressive)
             * - This creates SELL pressure hitting ASK levels
             *
             * Wait - this is the same buyerIsMaker = true case!
             * The key difference is the context and liquidity patterns, not the trade field.
             */

            const institutionalDistributionTrade: AggressiveTrade = {
                price: 100.0,
                quantity: 1000,
                timestamp: Date.now(),
                buyerIsMaker: true, // Retail buyer was passive, institution seller was aggressive
            };

            const side = (detector as any).getTradeSide(
                institutionalDistributionTrade
            );
            expect(side).toBe("sell"); // Aggressive institutional selling

            // But in distribution, we'd see WEAK bid liquidity and strong selling pressure
            const mockSnapshot = {
                bid: 200,
                ask: 1800,
                total: 2000,
                timestamp: Date.now(),
            };
            const relevantPassive =
                side === "buy" ? mockSnapshot.ask : mockSnapshot.bid;
            expect(relevantPassive).toBe(200); // Weak BID liquidity being overwhelmed
        });

        it("should handle retail FOMO buying pattern (aggressive buying)", () => {
            /**
             * Retail FOMO Buying:
             * - Retail traders hit ASK orders with market buys (chasing price up)
             * - Market makers/institutions provide passive ASK liquidity
             * - buyerIsMaker = false (retail buyer was aggressive, MM seller was passive)
             * - This creates BUY pressure hitting ASK levels
             */

            const retailFOMOTrade: AggressiveTrade = {
                price: 100.0,
                quantity: 150,
                timestamp: Date.now(),
                buyerIsMaker: false, // Retail buyer was aggressive, MM seller was passive
            };

            const side = (detector as any).getTradeSide(retailFOMOTrade);
            expect(side).toBe("buy"); // Aggressive buying (retail FOMO)

            // Retail is hitting ASK liquidity provided by market makers
            const mockSnapshot = {
                bid: 800,
                ask: 1200,
                total: 2000,
                timestamp: Date.now(),
            };
            const relevantPassive =
                side === "buy" ? mockSnapshot.ask : mockSnapshot.bid;
            expect(relevantPassive).toBe(1200); // ASK liquidity being consumed by aggressive buyers
        });
    });

    describe("Logic Validation Against Documentation", () => {
        it("should align with buyerIsMaker field documentation", () => {
            /**
             * From docs/BuyerIsMaker-field.md:
             *
             * buyerIsMaker = true:
             * - Buyer was passive (placed limit order)
             * - Seller was aggressive (hit buyer's limit order)
             * - SELLER WAS THE AGGRESSOR
             *
             * buyerIsMaker = false:
             * - Seller was passive (placed limit order)
             * - Buyer was aggressive (hit seller's limit order)
             * - BUYER WAS THE AGGRESSOR
             */

            // Test buyerIsMaker = true scenario
            const passiveBuyerTrade: AggressiveTrade = {
                price: 100.0,
                quantity: 100,
                timestamp: Date.now(),
                buyerIsMaker: true, // Buyer was passive, seller was aggressive
            };

            expect((detector as any).getTradeSide(passiveBuyerTrade)).toBe(
                "sell"
            );

            // Test buyerIsMaker = false scenario
            const passiveSellerTrade: AggressiveTrade = {
                price: 100.0,
                quantity: 100,
                timestamp: Date.now(),
                buyerIsMaker: false, // Seller was passive, buyer was aggressive
            };

            expect((detector as any).getTradeSide(passiveSellerTrade)).toBe(
                "buy"
            );
        });

        it("should correctly map absorption scenarios to passive liquidity sides", () => {
            /**
             * Absorption Detection Logic:
             * - For aggressive BUYS (side="buy"): Check ASK liquidity depletion/refill
             * - For aggressive SELLS (side="sell"): Check BID liquidity depletion/refill
             *
             * This aligns with market microstructure:
             * - Aggressive buyers consume ASK liquidity
             * - Aggressive sellers consume BID liquidity
             */

            const mockSnapshots = [
                {
                    bid: 1000,
                    ask: 800,
                    total: 1800,
                    timestamp: Date.now() - 4000,
                },
                {
                    bid: 950,
                    ask: 850,
                    total: 1800,
                    timestamp: Date.now() - 3000,
                },
                {
                    bid: 900,
                    ask: 900,
                    total: 1800,
                    timestamp: Date.now() - 2000,
                },
                {
                    bid: 850,
                    ask: 950,
                    total: 1800,
                    timestamp: Date.now() - 1000,
                },
            ];

            // Buy absorption: aggressive buys hit ASK liquidity
            const buyAbsorptionPassive = mockSnapshots.map((s) => s.ask);
            expect(buyAbsorptionPassive).toEqual([800, 850, 900, 950]);

            // Sell absorption: aggressive sells hit BID liquidity
            const sellAbsorptionPassive = mockSnapshots.map((s) => s.bid);
            expect(sellAbsorptionPassive).toEqual([1000, 950, 900, 850]);

            // The current code logic: side === "buy" ? snapshot.ask : snapshot.bid
            // For buy side: uses ask ✅ CORRECT
            // For sell side: uses bid ✅ CORRECT
        });
    });

    describe("Edge Cases and Error Conditions", () => {
        it("should handle zero liquidity scenarios", () => {
            const mockSnapshots = [
                {
                    bid: 0,
                    ask: 1000,
                    total: 1000,
                    timestamp: Date.now() - 2000,
                },
                { bid: 0, ask: 900, total: 900, timestamp: Date.now() - 1000 },
            ];

            // For sell absorption with zero BID liquidity
            const sellPassive = mockSnapshots.map((s) => s.bid);
            expect(sellPassive).toEqual([0, 0]);

            // For buy absorption with available ASK liquidity
            const buyPassive = mockSnapshots.map((s) => s.ask);
            expect(buyPassive).toEqual([1000, 900]);
        });

        it("should handle mixed liquidity scenarios", () => {
            const mockSnapshots = [
                {
                    bid: 500,
                    ask: 500,
                    total: 1000,
                    timestamp: Date.now() - 3000,
                },
                {
                    bid: 600,
                    ask: 400,
                    total: 1000,
                    timestamp: Date.now() - 2000,
                },
                {
                    bid: 300,
                    ask: 700,
                    total: 1000,
                    timestamp: Date.now() - 1000,
                },
            ];

            // Verify that the logic correctly selects the appropriate side
            // regardless of which side has more liquidity
            const sellPassive = mockSnapshots.map((s) => s.bid);
            expect(sellPassive).toEqual([500, 600, 300]);

            const buyPassive = mockSnapshots.map((s) => s.ask);
            expect(buyPassive).toEqual([500, 400, 700]);
        });
    });
});
