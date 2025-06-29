// test/detectors_signal_generation_debug.test.ts
//
// Debug why detectors don't generate signals with real config and market data

import {
    describe,
    it,
    expect,
    beforeEach,
    vi,
    type MockedFunction,
} from "vitest";
import fs from "fs";
import path from "path";
import {
    ExhaustionDetector,
    type ExhaustionSettings,
} from "../src/indicators/exhaustionDetector.js";
import {
    AbsorptionDetector,
    type AbsorptionSettings,
} from "../src/indicators/absorptionDetector.js";
import {
    DeltaCVDConfirmation,
    type DeltaCVDConfirmationSettings,
} from "../src/indicators/deltaCVDConfirmation.js";
import type {
    EnrichedTradeEvent,
    AggressiveTrade,
} from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import { ISignalLogger } from "../src/infrastructure/signalLoggerInterface.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";
import { IOrderBookState } from "../src/market/orderBookState.js";

// Create realistic mocks that capture all calls for debugging
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

// Create realistic order book mock that matches test data price range (86.25-86.30)
const createRealisticOrderBookMock = (): IOrderBookState => {
    // Test data trades occur in 86.25-86.30 range, so center order book around that
    const bestBid = 86.26;
    const bestAsk = 86.27;
    const midPrice = (bestBid + bestAsk) / 2; // 86.265
    const spread = bestAsk - bestBid; // 0.01

    // Create realistic depth structure with decreasing volume away from spread
    const createDepthLevel = (price: number): { bid: number; ask: number } => {
        const distanceFromMid = Math.abs(price - midPrice);
        const decayFactor = Math.exp(-distanceFromMid * 10); // Exponential decay

        // Higher volume closer to mid price, realistic institutional patterns
        const baseVolume = 200;
        const bidVolume = price <= bestBid ? baseVolume * decayFactor : 0;
        const askVolume = price >= bestAsk ? baseVolume * decayFactor : 0;

        return {
            bid: Math.max(0, bidVolume),
            ask: Math.max(0, askVolume),
        };
    };

    return {
        getBestBid: vi.fn(() => bestBid),
        getBestAsk: vi.fn(() => bestAsk),
        getSpread: vi.fn(() => spread),
        getMidPrice: vi.fn(() => midPrice),

        // Enhanced depth data - provides data at actual trade price levels
        getDepthAtPrice: vi.fn((price: number) => {
            if (typeof price !== "number" || !isFinite(price)) {
                return { bid: 0, ask: 0 };
            }
            return createDepthLevel(price);
        }),

        // Volume at price level - for exhaustion detector fallback logic
        getVolumeAtLevel: vi.fn((price?: number) => {
            if (!price || typeof price !== "number" || !isFinite(price)) {
                return { bid: 0, ask: 0 };
            }
            return createDepthLevel(price);
        }),

        // Health and status methods
        isHealthy: vi.fn(() => true),
        getLastUpdateTime: vi.fn(() => Date.now()),

        // Additional IOrderBookState methods that may be called
        updateDepth: vi.fn(),
        getLevel: vi.fn((price: number) => {
            const depth = createDepthLevel(price);
            return {
                price,
                bid: depth.bid,
                ask: depth.ask,
                timestamp: Date.now(),
            };
        }),
        sumBand: vi.fn(() => ({ bid: 300, ask: 300, levels: 5 })),
        snapshot: vi.fn(() => new Map()),
        getDepthMetrics: vi.fn(() => ({
            totalLevels: 20,
            bidLevels: 10,
            askLevels: 10,
            totalBidVolume: 1000,
            totalAskVolume: 1000,
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

// Backward compatibility alias
const createMockOrderBookState = createRealisticOrderBookMock;

// Load actual config.json
function loadRealConfig() {
    const configPath = path.join(process.cwd(), "config.json");
    const configContent = fs.readFileSync(configPath, "utf8");
    return JSON.parse(configContent);
}

// Create real market data from backtesting files
function createRealMarketData(): AggressiveTrade[] {
    // Base trade template with required AggressiveTrade fields
    const createTrade = (
        props: {
            timestamp: number;
            price: number;
            quantity: number;
            buyerIsMaker: boolean;
        },
        index: number
    ): AggressiveTrade => ({
        ...props,
        pair: "LTCUSDT",
        tradeId: `test-trade-${index}`,
        originalTrade: {} as any, // Mock for testing
    });

    // These are real trades from the market data analysis
    const tradeData = [
        // Heavy selling cascade from market data (lines 147-156)
        {
            timestamp: 1751141037537,
            price: 86.3,
            quantity: 74.706,
            buyerIsMaker: false,
        }, // sell
        {
            timestamp: 1751141037537,
            price: 86.29,
            quantity: 160.046,
            buyerIsMaker: false,
        }, // sell
        {
            timestamp: 1751141037537,
            price: 86.28,
            quantity: 369.895,
            buyerIsMaker: false,
        }, // sell
        {
            timestamp: 1751141037537,
            price: 86.27,
            quantity: 152.027,
            buyerIsMaker: false,
        }, // sell
        {
            timestamp: 1751141037537,
            price: 86.27,
            quantity: 87.256,
            buyerIsMaker: false,
        }, // sell

        // Bounce buying (absorption response)
        {
            timestamp: 1751141037539,
            price: 86.27,
            quantity: 14.175,
            buyerIsMaker: true,
        }, // buy
        {
            timestamp: 1751141037540,
            price: 86.27,
            quantity: 73.148,
            buyerIsMaker: true,
        }, // buy
        {
            timestamp: 1751141037540,
            price: 86.28,
            quantity: 1.0,
            buyerIsMaker: true,
        }, // buy
        {
            timestamp: 1751141037541,
            price: 86.27,
            quantity: 1.67,
            buyerIsMaker: true,
        }, // buy
        {
            timestamp: 1751141037541,
            price: 86.28,
            quantity: 0.317,
            buyerIsMaker: true,
        }, // buy

        // Another selling cascade (lines 184-192)
        {
            timestamp: 1751141072796,
            price: 86.28,
            quantity: 55.743,
            buyerIsMaker: false,
        }, // sell
        {
            timestamp: 1751141072796,
            price: 86.27,
            quantity: 85.829,
            buyerIsMaker: false,
        }, // sell
        {
            timestamp: 1751141075526,
            price: 86.26,
            quantity: 3.308,
            buyerIsMaker: false,
        }, // sell
        {
            timestamp: 1751141075526,
            price: 86.26,
            quantity: 7.516,
            buyerIsMaker: false,
        }, // sell
        {
            timestamp: 1751141075526,
            price: 86.25,
            quantity: 22.958,
            buyerIsMaker: false,
        }, // sell

        // Small normal trades
        {
            timestamp: 1751141076045,
            price: 86.25,
            quantity: 0.187,
            buyerIsMaker: true,
        }, // buy
        {
            timestamp: 1751141076087,
            price: 86.25,
            quantity: 0.317,
            buyerIsMaker: true,
        }, // buy
        {
            timestamp: 1751141076304,
            price: 86.25,
            quantity: 0.248,
            buyerIsMaker: true,
        }, // buy
    ];

    return tradeData.map((data, index) => createTrade(data, index));
}

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

describe("Detector Signal Generation Debug - Real Config & Market Data", () => {
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockSpoofing: SpoofingDetector;
    let mockSignalLogger: ISignalLogger;
    let mockOrderBook: IOrderBookState;
    let realConfig: any;
    let realMarketData: AggressiveTrade[];

    beforeEach(() => {
        mockLogger = createDebugLogger();
        mockMetrics = createDebugMetricsCollector();
        mockSpoofing = createMockSpoofingDetector();
        mockSignalLogger = createMockSignalLogger();
        mockOrderBook = createMockOrderBookState();
        realConfig = loadRealConfig();
        realMarketData = createRealMarketData();

        // Reset all mocks
        vi.clearAllMocks();
    });

    describe("Exhaustion Detector with Real Config", () => {
        it("should use actual config.json parameters", () => {
            const exhaustionConfig = realConfig.symbols.LTCUSDT.exhaustion;

            console.log("Real Exhaustion Config:", exhaustionConfig);

            const settings: ExhaustionSettings = {
                symbol: "LTCUSDT",
                ...exhaustionConfig,
            };

            const detector = new ExhaustionDetector(
                "debug-exhaustion",
                settings,
                mockLogger,
                mockSpoofing,
                mockMetrics,
                mockSignalLogger
            );

            // Verify actual parameters match config
            expect((detector as any).exhaustionThreshold).toBe(
                exhaustionConfig.exhaustionThreshold
            );
            expect((detector as any).minAggVolume).toBe(
                exhaustionConfig.minAggVolume
            );
            expect((detector as any).maxPassiveRatio).toBe(
                exhaustionConfig.maxPassiveRatio
            );

            console.log("Exhaustion Detector Parameters:");
            console.log(
                "  exhaustionThreshold:",
                (detector as any).exhaustionThreshold
            );
            console.log("  minAggVolume:", (detector as any).minAggVolume);
            console.log(
                "  maxPassiveRatio:",
                (detector as any).maxPassiveRatio
            );
        });

        it("should process real market data and show blocking reasons", () => {
            const exhaustionConfig = realConfig.symbols.LTCUSDT.exhaustion;

            const settings: ExhaustionSettings = {
                symbol: "LTCUSDT",
                ...exhaustionConfig,
            };

            const detector = new ExhaustionDetector(
                "debug-exhaustion",
                settings,
                mockLogger,
                mockSpoofing,
                mockMetrics,
                mockSignalLogger
            );

            let signalCount = 0;
            detector.on("signal", () => {
                signalCount++;
                console.log(
                    `🎯 EXHAUSTION SIGNAL GENERATED! (Total: ${signalCount})`
                );
            });

            console.log("\n=== Processing Real Market Data ===");
            console.log(
                `Processing ${realMarketData.length} trades with heavy selling cascades...`
            );

            // Process the heavy selling that should trigger exhaustion
            realMarketData.forEach((trade, index) => {
                const enrichedTrade = createEnrichedTrade(trade, index);

                console.log(
                    `Processing trade ${index}: ${trade.quantity} @ ${trade.price} (${trade.buyerIsMaker ? "buy" : "sell"}) - Passive: bid=${enrichedTrade.passiveBidVolume}, ask=${enrichedTrade.passiveAskVolume}`
                );
                detector.onEnrichedTrade(enrichedTrade);
            });

            console.log(`\n=== Results ===`);
            console.log(`Signals generated: ${signalCount}`);
            console.log(
                `Logger calls: info=${(mockLogger.info as any).mock.calls.length}, warn=${(mockLogger.warn as any).mock.calls.length}`
            );

            // Log all warn messages to see blocking reasons
            (mockLogger.warn as any).mock.calls.forEach(
                (call: any, i: number) => {
                    console.log(`WARN ${i}: ${call[0]}`, call[1]);
                }
            );
        });
    });

    describe("Absorption Detector with Real Config", () => {
        it("should use actual config.json parameters", () => {
            const absorptionConfig = realConfig.symbols.LTCUSDT.absorption;

            console.log("Real Absorption Config:", absorptionConfig);

            const settings: AbsorptionSettings = {
                symbol: "LTCUSDT",
                ...absorptionConfig,
            };

            const detector = new AbsorptionDetector(
                "debug-absorption",
                settings,
                mockOrderBook,
                mockLogger,
                mockSpoofing,
                mockMetrics,
                mockSignalLogger
            );

            // Verify actual parameters match config
            expect((detector as any).absorptionThreshold).toBe(
                absorptionConfig.absorptionThreshold
            );
            expect((detector as any).minAggVolume).toBe(
                absorptionConfig.minAggVolume
            );

            console.log("Absorption Detector Parameters:");
            console.log(
                "  absorptionThreshold:",
                (detector as any).absorptionThreshold
            );
            console.log("  minAggVolume:", (detector as any).minAggVolume);
            console.log(
                "  priceEfficiencyThreshold:",
                (detector as any).priceEfficiencyThreshold
            );
        });

        it("should process real market data and analyze signal direction", () => {
            const absorptionConfig = realConfig.symbols.LTCUSDT.absorption;

            const settings: AbsorptionSettings = {
                symbol: "LTCUSDT",
                ...absorptionConfig,
            };

            const detector = new AbsorptionDetector(
                "debug-absorption",
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

            console.log(
                "\n=== Processing Heavy Selling Cascade (Should Show Institutional Selling) ==="
            );

            // Process the heavy selling cascade - this should show institutional selling
            realMarketData.forEach((trade, index) => {
                const enrichedTrade = createEnrichedTrade(trade, index);
                detector.onEnrichedTrade(enrichedTrade);
            });

            console.log(`\n=== Absorption Results ===`);
            console.log(`Signals generated: ${signalCount}`);

            signalDetails.forEach((signal, i) => {
                console.log(`Signal ${i}: ${signal.side} at ${signal.price}`);
                console.log(
                    `  Expected: SELL (institutional selling during heavy cascade)`
                );
                console.log(`  Actual: ${signal.side}`);
                console.log(`  Direction Correct: ${signal.side === "sell"}`);
            });
        });
    });

    describe("DeltaCVD Detector with Real Config", () => {
        it("should use actual config.json parameters", () => {
            const deltaCVDConfig =
                realConfig.symbols.LTCUSDT.deltaCvdConfirmation;

            console.log("Real DeltaCVD Config:", deltaCVDConfig);

            const settings: DeltaCVDConfirmationSettings = {
                symbol: "LTCUSDT",
                ...deltaCVDConfig,
            };

            const detector = new DeltaCVDConfirmation(
                "debug-deltacvd",
                settings,
                mockLogger,
                mockSpoofing,
                mockMetrics,
                mockSignalLogger
            );

            // Verify actual parameters match config
            expect((detector as any).baseConfidenceRequired).toBe(
                deltaCVDConfig.baseConfidenceRequired
            );
            expect((detector as any).finalConfidenceRequired).toBe(
                deltaCVDConfig.finalConfidenceRequired
            );

            console.log("DeltaCVD Detector Parameters:");
            console.log(
                "  baseConfidenceRequired:",
                (detector as any).baseConfidenceRequired
            );
            console.log(
                "  finalConfidenceRequired:",
                (detector as any).finalConfidenceRequired
            );
            console.log(
                "  usePassiveVolume:",
                (detector as any).usePassiveVolume
            );
        });

        it("should process real market data and show why no signals are generated", () => {
            const deltaCVDConfig =
                realConfig.symbols.LTCUSDT.deltaCvdConfirmation;

            const settings: DeltaCVDConfirmationSettings = {
                symbol: "LTCUSDT",
                ...deltaCVDConfig,
            };

            const detector = new DeltaCVDConfirmation(
                "debug-deltacvd",
                settings,
                mockLogger,
                mockSpoofing,
                mockMetrics,
                mockSignalLogger
            );

            let signalCount = 0;
            detector.on("signal", () => {
                signalCount++;
                console.log(
                    `🎯 DELTACVD SIGNAL GENERATED! (Total: ${signalCount})`
                );
            });

            console.log("\n=== Processing Volume Surge Data ===");

            // Process the volume surge that should trigger CVD
            realMarketData.forEach((trade, index) => {
                const enrichedTrade = createEnrichedTrade(trade, index);
                detector.onEnrichedTrade(enrichedTrade);
            });

            console.log(`\n=== DeltaCVD Results ===`);
            console.log(`Signals generated: ${signalCount}`);
            console.log(
                `Debug calls: ${(mockLogger.debug as any).mock.calls.length}`
            );

            // Show debug info to understand blocking
            (mockLogger.debug as any).mock.calls
                .slice(-10)
                .forEach((call: any, i: number) => {
                    console.log(`DEBUG: ${call[0]}`, call[1]);
                });
        });
    });

    describe("Cross-Detector Comparison", () => {
        it("should compare signal generation across all detectors with same data", () => {
            const config = realConfig.symbols.LTCUSDT;

            // Create all detectors with real config
            const exhaustionDetector = new ExhaustionDetector(
                "compare-exhaustion",
                { symbol: "LTCUSDT", ...config.exhaustion },
                mockLogger,
                mockSpoofing,
                mockMetrics,
                mockSignalLogger
            );

            const absorptionDetector = new AbsorptionDetector(
                "compare-absorption",
                { symbol: "LTCUSDT", ...config.absorption },
                mockOrderBook,
                mockLogger,
                mockSpoofing,
                mockMetrics,
                mockSignalLogger
            );

            const deltaCVDDetector = new DeltaCVDConfirmation(
                "compare-deltacvd",
                { symbol: "LTCUSDT", ...config.deltaCvdConfirmation },
                mockLogger,
                mockSpoofing,
                mockMetrics,
                mockSignalLogger
            );

            const results = {
                exhaustion: 0,
                absorption: 0,
                deltaCVD: 0,
            };

            exhaustionDetector.on("signal", () => results.exhaustion++);
            absorptionDetector.on("signal", () => results.absorption++);
            deltaCVDDetector.on("signal", () => results.deltaCVD++);

            console.log("\n=== Cross-Detector Signal Generation Test ===");
            console.log(
                "Processing identical market data through all detectors..."
            );

            // Process same data through all detectors
            realMarketData.forEach((trade, index) => {
                const enrichedTrade = createEnrichedTrade(trade, index);

                exhaustionDetector.onEnrichedTrade(enrichedTrade);
                absorptionDetector.onEnrichedTrade(enrichedTrade);
                deltaCVDDetector.onEnrichedTrade(enrichedTrade);
            });

            console.log("\n=== Final Signal Count Comparison ===");
            console.log(`Exhaustion signals: ${results.exhaustion}`);
            console.log(`Absorption signals: ${results.absorption}`);
            console.log(`DeltaCVD signals: ${results.deltaCVD}`);
            console.log(
                `Total signals: ${results.exhaustion + results.absorption + results.deltaCVD}`
            );

            // Log which detectors are not working
            if (results.exhaustion === 0)
                console.log("❌ Exhaustion detector: NO SIGNALS");
            if (results.absorption === 0)
                console.log("❌ Absorption detector: NO SIGNALS");
            if (results.deltaCVD === 0)
                console.log("❌ DeltaCVD detector: NO SIGNALS");
        });
    });
});
