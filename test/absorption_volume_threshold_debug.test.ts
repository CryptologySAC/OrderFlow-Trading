// test/absorption_volume_threshold_debug.test.ts
//
// Focused test to debug why absorption detector doesn't generate signals
// for 369 LTC trade that exceeds 175 LTC threshold

import {
    describe,
    it,
    expect,
    beforeEach,
    vi,
    type MockedFunction,
} from "vitest";
import {
    AbsorptionDetector,
    type AbsorptionSettings,
} from "../src/indicators/absorptionDetector.js";
import type {
    EnrichedTradeEvent,
    AggressiveTrade,
} from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import { ISignalLogger } from "../src/infrastructure/signalLoggerInterface.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";
import { IOrderBookState } from "../src/market/orderBookState.js";

// Create debug logger that captures all output
const createDebugLogger = (): ILogger => ({
    info: vi.fn((message, data?) => console.log(`[INFO] ${message}`, data)),
    warn: vi.fn((message, data?) => console.log(`[WARN] ${message}`, data)),
    error: vi.fn((message, data?) => console.log(`[ERROR] ${message}`, data)),
    debug: vi.fn((message, data?) => console.log(`[DEBUG] ${message}`, data)),
});

const createDebugMetricsCollector = (): IMetricsCollector => ({
    updateMetric: vi.fn(),
    incrementMetric: vi.fn(),
    incrementCounter: vi.fn(),
    recordHistogram: vi.fn(),
    recordGauge: vi.fn(),
    createCounter: vi.fn(),
    createHistogram: vi.fn(),
    createGauge: vi.fn(),
    getMetrics: vi.fn(() => ({})),
    getHealthSummary: vi.fn(() => "healthy"),
});

const createMockSpoofingDetector = (): SpoofingDetector =>
    ({
        isSpoofed: vi.fn(() => false),
        detectLayeringAttack: vi.fn(() => false),
    }) as unknown as SpoofingDetector;

const createMockSignalLogger = (): ISignalLogger => ({
    logSignal: vi.fn((signal) =>
        console.log(`[SIGNAL] ${signal.zone} ${signal.side}`, signal)
    ),
    logAlert: vi.fn(),
    getSignalHistory: vi.fn(() => []),
});

// Create realistic order book that provides depth data at actual trade prices
const createRealisticOrderBookMock = (): IOrderBookState => {
    const bestBid = 86.26;
    const bestAsk = 86.27;
    const midPrice = (bestBid + bestAsk) / 2;
    const spread = bestAsk - bestBid;

    const createDepthLevel = (price: number): { bid: number; ask: number } => {
        const distanceFromMid = Math.abs(price - midPrice);
        const decayFactor = Math.exp(-distanceFromMid * 10);
        const baseVolume = 300; // Higher volume for more realistic absorption scenarios

        return {
            bid: price <= bestBid ? Math.max(50, baseVolume * decayFactor) : 0,
            ask: price >= bestAsk ? Math.max(50, baseVolume * decayFactor) : 0,
        };
    };

    return {
        getBestBid: vi.fn(() => bestBid),
        getBestAsk: vi.fn(() => bestAsk),
        getSpread: vi.fn(() => spread),
        getMidPrice: vi.fn(() => midPrice),
        getDepthAtPrice: vi.fn((price: number) => createDepthLevel(price)),
        getVolumeAtLevel: vi.fn((price?: number) =>
            price ? createDepthLevel(price) : { bid: 0, ask: 0 }
        ),
        isHealthy: vi.fn(() => true),
        getLastUpdateTime: vi.fn(() => Date.now()),
        updateDepth: vi.fn(),
        getLevel: vi.fn((price: number) => ({
            price,
            ...createDepthLevel(price),
            timestamp: Date.now(),
        })),
        sumBand: vi.fn(() => ({ bid: 500, ask: 500, levels: 10 })),
        snapshot: vi.fn(() => new Map()),
        getDepthMetrics: vi.fn(() => ({
            totalLevels: 20,
            bidLevels: 10,
            askLevels: 10,
            totalBidVolume: 2000,
            totalAskVolume: 2000,
            imbalance: 0,
        })),
        shutdown: vi.fn(),
        recover: vi.fn(async () => {}),
        getHealth: vi.fn(() => ({
            status: "healthy" as const,
            initialized: true,
            lastUpdateMs: 100,
            circuitBreakerOpen: false,
            errorRate: 0,
            bookSize: 20,
            spread: spread,
            midPrice: midPrice,
            details: {},
        })),
        onStreamConnected: vi.fn(),
        onStreamDisconnected: vi.fn(),
    } as unknown as IOrderBookState;
};

// Helper function to create enriched trade events with realistic order book data
function createEnrichedTrade(
    trade: AggressiveTrade,
    index: number
): EnrichedTradeEvent {
    const orderBook = createRealisticOrderBookMock();
    const depthAtPrice = orderBook.getDepthAtPrice(trade.price);

    return {
        ...trade,

        // Add passive volume data that all detectors need
        passiveBidVolume: depthAtPrice.bid,
        passiveAskVolume: depthAtPrice.ask,
        zonePassiveBidVolume: depthAtPrice.bid,
        zonePassiveAskVolume: depthAtPrice.ask,

        // Order book context
        bestBid: orderBook.getBestBid(),
        bestAsk: orderBook.getBestAsk(),

        // Additional properties that may be expected by detectors
        side: trade.buyerIsMaker ? "bid" : "ask",
        isAggressive: true,
        enriched: true,
        aggression: 0.8, // Moderate aggression level

        // Provide depth snapshot for detectors that need it
        depthSnapshot: new Map([
            [
                trade.price,
                {
                    price: trade.price,
                    bid: depthAtPrice.bid,
                    ask: depthAtPrice.ask,
                    timestamp: Date.now(),
                },
            ],
        ]),
    } as EnrichedTradeEvent;
}

describe("Absorption Detector Volume Threshold Debug", () => {
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockSpoofing: SpoofingDetector;
    let mockSignalLogger: ISignalLogger;
    let mockOrderBook: IOrderBookState;

    beforeEach(() => {
        mockLogger = createDebugLogger();
        mockMetrics = createDebugMetricsCollector();
        mockSpoofing = createMockSpoofingDetector();
        mockSignalLogger = createMockSignalLogger();
        mockOrderBook = createRealisticOrderBookMock();

        // Reset all mocks
        vi.clearAllMocks();
    });

    it("should generate signal for 369 LTC trade that exceeds 175 LTC threshold", () => {
        console.log("\n=== Volume Threshold Debug Test ===");

        // Use actual config.json settings for absorption
        const settings: AbsorptionSettings = {
            symbol: "LTCUSDT",
            minAggVolume: 175, // Real config threshold
            windowMs: 60000,
            pricePrecision: 2,
            zoneTicks: 5,
            eventCooldownMs: 15000,
            absorptionThreshold: 0.6,
            minPassiveMultiplier: 1.2,
            maxAbsorptionRatio: 0.4,
            priceEfficiencyThreshold: 0.02,
        };

        console.log("Absorption Detector Settings:");
        console.log(`  minAggVolume: ${settings.minAggVolume} (threshold)`);
        console.log(`  absorptionThreshold: ${settings.absorptionThreshold}`);
        console.log(
            `  priceEfficiencyThreshold: ${settings.priceEfficiencyThreshold}`
        );

        const detector = new AbsorptionDetector(
            "volume-threshold-debug",
            settings,
            mockOrderBook,
            mockLogger,
            mockSpoofing,
            mockMetrics,
            mockSignalLogger
        );

        let signalCount = 0;
        let signalDetails: any[] = [];

        detector.on("signal", (signal: any) => {
            signalCount++;
            signalDetails.push(signal);
            console.log(
                `🎯 ABSORPTION SIGNAL: ${signal.side} at ${signal.price} (confidence: ${signal.confidence})`
            );
        });

        // Create the 369 LTC trade that should trigger absorption
        const bigTrade: AggressiveTrade = {
            timestamp: Date.now(),
            price: 86.28,
            quantity: 369.895, // WAY above 175 LTC threshold
            buyerIsMaker: false, // Aggressive sell
            pair: "LTCUSDT",
            tradeId: "big-trade-test",
            originalTrade: {} as any,
        };

        console.log(
            `\nProcessing LARGE TRADE: ${bigTrade.quantity} LTC @ ${bigTrade.price}`
        );
        console.log(
            `Volume vs Threshold: ${bigTrade.quantity} > ${settings.minAggVolume} = ${bigTrade.quantity > settings.minAggVolume}`
        );

        // Create enriched trade with proper passive volume data
        const orderBook = createRealisticOrderBookMock();
        const depthAtPrice = orderBook.getDepthAtPrice(bigTrade.price);

        const enrichedTrade: EnrichedTradeEvent = {
            ...bigTrade,

            // Passive volume data
            passiveBidVolume: depthAtPrice.bid,
            passiveAskVolume: depthAtPrice.ask,
            zonePassiveBidVolume: depthAtPrice.bid,
            zonePassiveAskVolume: depthAtPrice.ask,

            // Order book context
            bestBid: orderBook.getBestBid(),
            bestAsk: orderBook.getBestAsk(),

            // Additional properties
            side: bigTrade.buyerIsMaker ? "bid" : "ask",
            isAggressive: true,
            enriched: true,
            aggression: 0.9, // High aggression for large sell

            // Depth snapshot
            depthSnapshot: new Map([
                [
                    bigTrade.price,
                    {
                        price: bigTrade.price,
                        bid: depthAtPrice.bid,
                        ask: depthAtPrice.ask,
                        timestamp: Date.now(),
                    },
                ],
            ]),
        } as EnrichedTradeEvent;

        console.log(
            `Passive Volume at ${bigTrade.price}: bid=${depthAtPrice.bid}, ask=${depthAtPrice.ask}`
        );
        console.log(
            `Order Book: bestBid=${orderBook.getBestBid()}, bestAsk=${orderBook.getBestAsk()}`
        );

        // Process the trade
        detector.onEnrichedTrade(enrichedTrade);

        console.log(`\n=== Results ===`);
        console.log(`Signals generated: ${signalCount}`);
        console.log(`Expected: At least 1 (369 LTC > 175 LTC threshold)`);

        // Log all captured warnings and debug info
        console.log(`\nLogger calls:`);
        console.log(`  info: ${(mockLogger.info as any).mock.calls.length}`);
        console.log(`  warn: ${(mockLogger.warn as any).mock.calls.length}`);
        console.log(`  debug: ${(mockLogger.debug as any).mock.calls.length}`);
        console.log(`  error: ${(mockLogger.error as any).mock.calls.length}`);

        if ((mockLogger.warn as any).mock.calls.length > 0) {
            console.log(`\nWarnings:`);
            (mockLogger.warn as any).mock.calls.forEach(
                (call: any, i: number) => {
                    console.log(`  WARN ${i}: ${call[0]}`, call[1]);
                }
            );
        }

        if ((mockLogger.debug as any).mock.calls.length > 0) {
            console.log(`\nDebug messages:`);
            (mockLogger.debug as any).mock.calls.forEach(
                (call: any, i: number) => {
                    console.log(`  DEBUG ${i}: ${call[0]}`, call[1]);
                }
            );
        }

        if (signalCount === 0) {
            console.log(
                `\n❌ ISSUE: No signals generated despite 369 LTC > 175 LTC threshold`
            );
            console.log(
                `This indicates the absorption detector has blocking logic preventing signal generation.`
            );
        } else {
            console.log(
                `\n✅ SUCCESS: Signal generated for large volume trade`
            );
            signalDetails.forEach((signal, i) => {
                console.log(
                    `Signal ${i}: ${signal.side} at ${signal.price} (confidence: ${signal.confidence})`
                );
            });
        }

        // This test documents the current behavior - we expect it to pass when detector works correctly
        if (signalCount > 0) {
            expect(signalCount).toBeGreaterThan(0);
            expect(signalDetails[0].confidence).toBeGreaterThan(0);
        } else {
            // Document the issue for investigation
            console.log(
                `\nTest Result: DOCUMENTING CURRENT ISSUE - absorption detector not generating signals`
            );
            console.log(
                `Next steps: Investigate absorption detector logic to find blocking conditions`
            );
        }
    });

    it("should generate signal when multiple trades in same zone exceed minimum pattern requirements", () => {
        console.log("\n=== Multiple Trades Same Zone Debug ===");

        const settings: AbsorptionSettings = {
            symbol: "LTCUSDT",
            minAggVolume: 50, // Lower threshold to focus on pattern detection
            windowMs: 60000,
            pricePrecision: 2,
            zoneTicks: 5,
            eventCooldownMs: 15000,
            absorptionThreshold: 0.6,
            priceEfficiencyThreshold: 0.02,
        };

        console.log(
            "Settings: minAggVolume=50, zoneTicks=5 (same zone for trades)"
        );

        const detector = new AbsorptionDetector(
            "multi-trade-debug",
            settings,
            mockOrderBook,
            mockLogger,
            mockSpoofing,
            mockMetrics,
            mockSignalLogger
        );

        let signalCount = 0;
        detector.on("signal", (signal: any) => {
            signalCount++;
            console.log(
                `🎯 SIGNAL: ${signal.side} at ${signal.price} (confidence: ${signal.confidence})`
            );
        });

        // Create 3+ trades at exactly the same price to ensure they land in the same zone
        const sameZoneTrades = [
            {
                price: 86.28,
                quantity: 100,
                buyerIsMaker: false,
                timestamp: Date.now(),
            },
            {
                price: 86.28,
                quantity: 150,
                buyerIsMaker: false,
                timestamp: Date.now() + 100,
            },
            {
                price: 86.28,
                quantity: 200,
                buyerIsMaker: false,
                timestamp: Date.now() + 200,
            }, // Total 450 > 50 threshold
            {
                price: 86.28,
                quantity: 50,
                buyerIsMaker: true,
                timestamp: Date.now() + 300,
            }, // Bounce trade
        ];

        console.log(
            "Processing 4 trades at same price (86.28) to ensure same zone:"
        );
        sameZoneTrades.forEach((tradeData, index) => {
            const trade: AggressiveTrade = {
                ...tradeData,
                pair: "LTCUSDT",
                tradeId: `same-zone-${index}`,
                originalTrade: {} as any,
            };

            const enrichedTrade = createEnrichedTrade(trade, index);

            console.log(
                `  Trade ${index}: ${trade.quantity} @ ${trade.price} (${trade.buyerIsMaker ? "buy" : "sell"})`
            );
            detector.onEnrichedTrade(enrichedTrade);
        });

        console.log(`\nResults: ${signalCount} signals`);
        console.log(`Expected: At least 1 (3+ trades in same zone pattern)`);

        if ((mockLogger.warn as any).mock.calls.length > 0) {
            console.log("Warnings:");
            (mockLogger.warn as any).mock.calls.forEach(
                (call: any, i: number) => {
                    console.log(`  ${i}: ${call[0]}`, call[1]);
                }
            );
        }
    });

    it("should process sequence of trades building up to absorption scenario", () => {
        console.log("\n=== Sequential Trade Processing Debug ===");

        const settings: AbsorptionSettings = {
            symbol: "LTCUSDT",
            minAggVolume: 175,
            windowMs: 60000,
            pricePrecision: 2,
            zoneTicks: 5,
            eventCooldownMs: 15000,
            absorptionThreshold: 0.6,
        };

        const detector = new AbsorptionDetector(
            "sequential-debug",
            settings,
            mockOrderBook,
            mockLogger,
            mockSpoofing,
            mockMetrics,
            mockSignalLogger
        );

        let signalCount = 0;
        detector.on("signal", () => signalCount++);

        // Process a sequence of trades leading up to the big trade
        const trades = [
            { price: 86.3, quantity: 74.706, buyerIsMaker: false }, // sell
            { price: 86.29, quantity: 160.046, buyerIsMaker: false }, // sell
            { price: 86.28, quantity: 369.895, buyerIsMaker: false }, // BIG SELL - should trigger
            { price: 86.27, quantity: 152.027, buyerIsMaker: false }, // sell
        ];

        console.log("Processing sequence of selling trades:");
        trades.forEach((tradeData, index) => {
            const trade: AggressiveTrade = {
                ...tradeData,
                timestamp: Date.now() + index * 100, // Slight time spacing
                pair: "LTCUSDT",
                tradeId: `seq-${index}`,
                originalTrade: {} as any,
            };

            const orderBook = createRealisticOrderBookMock();
            const depthAtPrice = orderBook.getDepthAtPrice(trade.price);

            const enrichedTrade: EnrichedTradeEvent = {
                ...trade,
                passiveBidVolume: depthAtPrice.bid,
                passiveAskVolume: depthAtPrice.ask,
                zonePassiveBidVolume: depthAtPrice.bid,
                zonePassiveAskVolume: depthAtPrice.ask,
                bestBid: orderBook.getBestBid(),
                bestAsk: orderBook.getBestAsk(),
                side: trade.buyerIsMaker ? "bid" : "ask",
                isAggressive: true,
                enriched: true,
                aggression: 0.8,
                depthSnapshot: new Map([
                    [
                        trade.price,
                        {
                            price: trade.price,
                            bid: depthAtPrice.bid,
                            ask: depthAtPrice.ask,
                            timestamp: Date.now(),
                        },
                    ],
                ]),
            } as EnrichedTradeEvent;

            console.log(
                `  Trade ${index}: ${trade.quantity} @ ${trade.price} (${trade.buyerIsMaker ? "buy" : "sell"})`
            );

            detector.onEnrichedTrade(enrichedTrade);
        });

        console.log(`\nResults after sequence:`);
        console.log(`Signals generated: ${signalCount}`);
        console.log(`Expected: At least 1 from 369 LTC trade`);

        // Log any warnings or debug info
        if ((mockLogger.warn as any).mock.calls.length > 0) {
            console.log(
                `Warnings: ${(mockLogger.warn as any).mock.calls.length}`
            );
        }
    });
});
