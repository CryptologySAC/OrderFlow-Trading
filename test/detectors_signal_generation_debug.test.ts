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
    ExhaustionDetectorEnhanced,
    type ExhaustionEnhancedSettings,
} from "../src/indicators/exhaustionDetectorEnhanced.js";
import type { IOrderflowPreprocessor } from "../src/market/orderFlowPreprocessor.js";
import { SignalValidationLogger } from "../__mocks__/src/utils/signalValidationLogger.js";
import {
    AbsorptionDetectorEnhanced,
    type AbsorptionEnhancedSettings,
} from "../src/indicators/absorptionDetectorEnhanced.js";
import {
    DeltaCVDDetectorEnhanced,
    type DeltaCVDEnhancedSettings,
} from "../src/indicators/deltaCVDDetectorEnhanced.js";
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
    let mockPreprocessor: IOrderflowPreprocessor;
    let mockSignalValidationLogger: SignalValidationLogger;
    let realConfig: any;
    let realMarketData: AggressiveTrade[];

    beforeEach(() => {
        mockLogger = createDebugLogger();
        mockMetrics = createDebugMetricsCollector();
        mockSpoofing = createMockSpoofingDetector();
        mockSignalLogger = createMockSignalLogger();
        mockOrderBook = createMockOrderBookState();
        mockPreprocessor = createMockPreprocessor();
        mockSignalValidationLogger = new SignalValidationLogger(
            mockLogger,
            "test-logs"
        );
        realConfig = loadRealConfig();
        realMarketData = createRealMarketData();

        // Reset all mocks
        vi.clearAllMocks();
    });

    describe("Exhaustion Detector with Real Config", () => {
        it("should use actual config.json parameters", () => {
            const exhaustionConfig = realConfig.symbols.LTCUSDT.exhaustion;

            console.log("Real Exhaustion Config:", exhaustionConfig);

            const settings: ExhaustionEnhancedSettings = {
                symbol: "LTCUSDT",
                ...exhaustionConfig,
            };

            const detector = new ExhaustionDetectorEnhanced(
                "debug-exhaustion",
                settings,
                mockPreprocessor,
                mockLogger,
                mockMetrics,
                mockSignalLogger,
                mockSignalValidationLogger
            );

            // Verify actual parameters match config
            expect(
                (detector as any).settings.exhaustionThreshold
            ).toBe(exhaustionConfig.exhaustionThreshold);
            expect((detector as any).settings.minAggVolume).toBe(
                exhaustionConfig.minAggVolume
            );
            expect((detector as any).settings.passiveRatioBalanceThreshold).toBe(
                exhaustionConfig.passiveRatioBalanceThreshold
            );

            console.log("Exhaustion Detector Parameters:");
            console.log(
                "  exhaustionThreshold:",
                (detector as any).settings.exhaustionThreshold
            );
            console.log(
                "  minAggVolume:",
                (detector as any).settings.minAggVolume
            );
            console.log(
                "  passiveRatioBalanceThreshold:",
                (detector as any).settings.passiveRatioBalanceThreshold
            );
        });

        it("should process real market data and show blocking reasons", () => {
            const exhaustionConfig = realConfig.symbols.LTCUSDT.exhaustion;

            const settings: ExhaustionEnhancedSettings = {
                symbol: "LTCUSDT",
                ...exhaustionConfig,
            };

            const detector = new ExhaustionDetectorEnhanced(
                "debug-exhaustion",
                settings,
                mockPreprocessor,
                mockLogger,
                mockMetrics,
                mockSignalLogger,
                mockSignalValidationLogger
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

            const settings: AbsorptionEnhancedSettings = {
                symbol: "LTCUSDT",
                ...absorptionConfig,
            };

            const detector = new AbsorptionDetectorEnhanced(
                "debug-absorption",
                settings,
                mockPreprocessor,
                mockLogger,
                mockMetrics,
                mockSignalValidationLogger,
                mockSignalLogger
            );

            // Verify actual parameters match config (from settings)
            expect(settings.absorptionThreshold).toBe(
                absorptionConfig.absorptionThreshold
            );
            expect(settings.minAggVolume).toBe(absorptionConfig.minAggVolume);

            console.log("Absorption Detector Parameters:");
            console.log("  absorptionThreshold:", settings.absorptionThreshold);
            console.log("  minAggVolume:", settings.minAggVolume);
            console.log(
                "  priceEfficiencyThreshold:",
                settings.priceEfficiencyThreshold
            );
        });

        it("should process real market data and analyze signal direction", () => {
            const absorptionConfig = realConfig.symbols.LTCUSDT.absorption;

            const settings: AbsorptionEnhancedSettings = {
                symbol: "LTCUSDT",
                ...absorptionConfig,
            };

            const detector = new AbsorptionDetectorEnhanced(
                "debug-absorption",
                settings,
                mockPreprocessor,
                mockLogger,
                mockMetrics,
                mockSignalValidationLogger,
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
            const deltaCVDConfig = realConfig.symbols.LTCUSDT.deltaCVD;

            console.log("Real DeltaCVD Config:", deltaCVDConfig);

            const completeDeltaCVDSettings: DeltaCVDEnhancedSettings = {
                // Core CVD analysis (12 properties)
                windowsSec: [60, 300],
                minZ: 0.4,
                priceCorrelationWeight: 0.3,
                volumeConcentrationWeight: 0.2,
                adaptiveThresholdMultiplier: 0.7,
                eventCooldownMs: 15000,
                minTradesPerSec: 0.1,
                minVolPerSec: 0.5,
                minSamplesForStats: 15,
                pricePrecision: 2,
                volatilityLookbackSec: 3600,
                maxDivergenceAllowed: 0.5,
                stateCleanupIntervalSec: 300,
                dynamicThresholds: true,
                logDebug: true,

                // Volume and detection parameters (15 properties)
                volumeSurgeMultiplier: 2.5,
                imbalanceThreshold: 0.15,
                institutionalThreshold: 17.8,
                burstDetectionMs: 1000,
                sustainedVolumeMs: 30000,
                medianTradeSize: 0.6,
                detectionMode: "momentum" as const,
                divergenceThreshold: 0.3,
                divergenceLookbackSec: 60,
                enableDepthAnalysis: false,
                usePassiveVolume: true,
                maxOrderbookAge: 5000,
                absorptionCVDThreshold: 75,
                absorptionPriceThreshold: 0.1,
                imbalanceWeight: 0.2,
                icebergMinRefills: 3,
                icebergMinSize: 20,
                baseConfidenceRequired: 0.2,
                finalConfidenceRequired: 0.35,
                strongCorrelationThreshold: 0.7,
                weakCorrelationThreshold: 0.3,
                depthImbalanceThreshold: 0.2,

                // Enhancement control (3 properties)
                useStandardizedZones: true,
                enhancementMode: "production" as const,
                minEnhancedConfidenceThreshold: 0.3,

                // Enhanced CVD analysis (6 properties)
                cvdDivergenceVolumeThreshold: 50,
                cvdDivergenceStrengthThreshold: 0.7,
                cvdSignificantImbalanceThreshold: 0.3,
                cvdDivergenceScoreMultiplier: 1.5,
                alignmentMinimumThreshold: 0.5,
                momentumScoreMultiplier: 2,
                enableCVDDivergenceAnalysis: true,
                enableMomentumAlignment: false,

                // ESSENTIAL CONFIGURABLE PARAMETERS - Trading Logic (8 mandatory parameters)
                minTradesForAnalysis: 20,
                minVolumeRatio: 0.1,
                maxVolumeRatio: 5.0,
                priceChangeThreshold: 0.001,
                minZScoreBound: -20,
                maxZScoreBound: 20,
                minCorrelationBound: -0.999,
                maxCorrelationBound: 0.999,

                // Override with actual config if available
                ...deltaCVDConfig,
            };

            const detector = new DeltaCVDDetectorEnhanced(
                "debug-deltacvd",
                completeDeltaCVDSettings,
                mockPreprocessor,
                mockLogger,
                mockMetrics,
                mockSignalValidationLogger,
                mockSignalLogger
            );

            // Verify actual parameters match config (simplified schema)
            expect((detector as any).enhancementConfig.signalThreshold).toBe(
                deltaCVDConfig.signalThreshold
            );
            expect(
                (detector as any).enhancementConfig.cvdImbalanceThreshold
            ).toBe(deltaCVDConfig.cvdImbalanceThreshold);

            console.log("DeltaCVD Detector Parameters:");
            console.log(
                "  signalThreshold:",
                (detector as any).enhancementConfig.signalThreshold
            );
            console.log(
                "  cvdImbalanceThreshold:",
                (detector as any).enhancementConfig.cvdImbalanceThreshold
            );
            console.log(
                "  enhancementMode:",
                (detector as any).enhancementConfig.enhancementMode
            );
        });

        it("should process real market data and show why no signals are generated", () => {
            const deltaCVDConfig = realConfig.symbols.LTCUSDT.deltaCVD;

            const completeDeltaCVDSettings: DeltaCVDEnhancedSettings = {
                // Core CVD analysis (12 properties)
                windowsSec: [60, 300],
                minZ: 0.4,
                priceCorrelationWeight: 0.3,
                volumeConcentrationWeight: 0.2,
                adaptiveThresholdMultiplier: 0.7,
                eventCooldownMs: 15000,
                minTradesPerSec: 0.1,
                minVolPerSec: 0.5,
                minSamplesForStats: 15,
                pricePrecision: 2,
                volatilityLookbackSec: 3600,
                maxDivergenceAllowed: 0.5,
                stateCleanupIntervalSec: 300,
                dynamicThresholds: true,
                logDebug: true,

                // Volume and detection parameters (15 properties)
                volumeSurgeMultiplier: 2.5,
                imbalanceThreshold: 0.15,
                institutionalThreshold: 17.8,
                burstDetectionMs: 1000,
                sustainedVolumeMs: 30000,
                medianTradeSize: 0.6,
                detectionMode: "momentum" as const,
                divergenceThreshold: 0.3,
                divergenceLookbackSec: 60,
                enableDepthAnalysis: false,
                usePassiveVolume: true,
                maxOrderbookAge: 5000,
                absorptionCVDThreshold: 75,
                absorptionPriceThreshold: 0.1,
                imbalanceWeight: 0.2,
                icebergMinRefills: 3,
                icebergMinSize: 20,
                baseConfidenceRequired: 0.2,
                finalConfidenceRequired: 0.35,
                strongCorrelationThreshold: 0.7,
                weakCorrelationThreshold: 0.3,
                depthImbalanceThreshold: 0.2,

                // Enhancement control (3 properties)
                useStandardizedZones: true,
                enhancementMode: "production" as const,
                minEnhancedConfidenceThreshold: 0.3,

                // Enhanced CVD analysis (6 properties)
                cvdDivergenceVolumeThreshold: 50,
                cvdDivergenceStrengthThreshold: 0.7,
                cvdSignificantImbalanceThreshold: 0.3,
                cvdDivergenceScoreMultiplier: 1.5,
                alignmentMinimumThreshold: 0.5,
                momentumScoreMultiplier: 2,
                enableCVDDivergenceAnalysis: true,
                enableMomentumAlignment: false,

                // ESSENTIAL CONFIGURABLE PARAMETERS - Trading Logic (8 mandatory parameters)
                minTradesForAnalysis: 20,
                minVolumeRatio: 0.1,
                maxVolumeRatio: 5.0,
                priceChangeThreshold: 0.001,
                minZScoreBound: -20,
                maxZScoreBound: 20,
                minCorrelationBound: -0.999,
                maxCorrelationBound: 0.999,

                // Override with actual config if available
                ...deltaCVDConfig,
            };

            const detector = new DeltaCVDDetectorEnhanced(
                "debug-deltacvd",
                completeDeltaCVDSettings,
                mockPreprocessor,
                mockLogger,
                mockMetrics,
                mockSignalValidationLogger,
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
            const completeExhaustionSettings: ExhaustionEnhancedSettings = {
                // Base detector settings
                minAggVolume: 20,
                windowMs: 45000,
                pricePrecision: 2,
                zoneTicks: 3,
                eventCooldownMs: 10000,
                minInitialMoveTicks: 1,
                confirmationTimeoutMs: 40000,
                maxRevisitTicks: 8,

                // Exhaustion-specific thresholds
                volumeSurgeMultiplier: 2.0,
                imbalanceThreshold: 0.3,
                institutionalThreshold: 15,
                burstDetectionMs: 2000,
                sustainedVolumeMs: 20000,
                medianTradeSize: 0.8,
                exhaustionThreshold: 0.3,
                maxPassiveRatio: 0.35,
                minDepletionFactor: 0.2,
                imbalanceHighThreshold: 0.75,
                imbalanceMediumThreshold: 0.55,
                spreadHighThreshold: 0.004,
                spreadMediumThreshold: 0.0015,

                // Scoring weights
                scoringWeights: {
                    depletion: 0.45,
                    passive: 0.3,
                    continuity: 0.12,
                    imbalance: 0.08,
                    spread: 0.04,
                    velocity: 0.01,
                },

                // Quality and performance settings
                depletionThresholdRatio: 0.15,
                significantChangeThreshold: 0.08,
                highQualitySampleCount: 6,
                highQualityDataAge: 35000,
                mediumQualitySampleCount: 3,
                mediumQualityDataAge: 70000,
                circuitBreakerMaxErrors: 8,
                circuitBreakerWindowMs: 90000,

                // Confidence adjustments
                lowScoreConfidenceAdjustment: 0.7,
                lowVolumeConfidenceAdjustment: 0.8,
                invalidSurgeConfidenceAdjustment: 0.8,
                passiveConsistencyThreshold: 0.7,
                imbalanceNeutralThreshold: 0.1,
                velocityMinBound: 0.1,
                velocityMaxBound: 10,

                // Zone management
                maxZones: 75,
                zoneAgeLimit: 1200000,

                // Features configuration
                features: {
                    depletionTracking: true,
                    spreadAdjustment: true,
                    volumeVelocity: false,
                    spoofingDetection: true,
                    adaptiveZone: true,
                    multiZone: false,
                    passiveHistory: true,
                },

                // Enhancement control
                useStandardizedZones: true,
                enhancementMode: "production" as const,
                minEnhancedConfidenceThreshold: 0.3,

                // Enhanced depletion analysis
                depletionVolumeThreshold: 30,
                depletionRatioThreshold: 0.6,
                varianceReductionFactor: 1,
                alignmentNormalizationFactor: 1,
                distanceNormalizationDivisor: 2,
                passiveVolumeExhaustionRatio: 0.5,
                aggressiveVolumeExhaustionThreshold: 0.7,
                aggressiveVolumeReductionFactor: 0.5,
                enableDepletionAnalysis: true,

                // Override with actual config if available
                ...config.exhaustion,
            };

            const exhaustionDetector = new ExhaustionDetectorEnhanced(
                "compare-exhaustion",
                completeExhaustionSettings,
                mockPreprocessor,
                mockLogger,
                mockMetrics,
                mockSignalLogger,
                mockSignalValidationLogger
            );

            const absorptionDetector = new AbsorptionDetectorEnhanced(
                "compare-absorption",
                { symbol: "LTCUSDT", ...config.absorption },
                mockPreprocessor,
                mockLogger,
                mockMetrics,
                mockSignalValidationLogger,
                mockSignalLogger
            );

            const completeDeltaCVDSettings: DeltaCVDEnhancedSettings = {
                // Core CVD analysis (12 properties)
                windowsSec: [60, 300],
                minZ: 0.4,
                priceCorrelationWeight: 0.3,
                volumeConcentrationWeight: 0.2,
                adaptiveThresholdMultiplier: 0.7,
                eventCooldownMs: 15000,
                minTradesPerSec: 0.1,
                minVolPerSec: 0.5,
                minSamplesForStats: 15,
                pricePrecision: 2,
                volatilityLookbackSec: 3600,
                maxDivergenceAllowed: 0.5,
                stateCleanupIntervalSec: 300,
                dynamicThresholds: true,
                logDebug: true,

                // Volume and detection parameters (15 properties)
                volumeSurgeMultiplier: 2.5,
                imbalanceThreshold: 0.15,
                institutionalThreshold: 17.8,
                burstDetectionMs: 1000,
                sustainedVolumeMs: 30000,
                medianTradeSize: 0.6,
                detectionMode: "momentum" as const,
                divergenceThreshold: 0.3,
                divergenceLookbackSec: 60,
                enableDepthAnalysis: false,
                usePassiveVolume: true,
                maxOrderbookAge: 5000,
                absorptionCVDThreshold: 75,
                absorptionPriceThreshold: 0.1,
                imbalanceWeight: 0.2,
                icebergMinRefills: 3,
                icebergMinSize: 20,
                baseConfidenceRequired: 0.2,
                finalConfidenceRequired: 0.35,
                strongCorrelationThreshold: 0.7,
                weakCorrelationThreshold: 0.3,
                depthImbalanceThreshold: 0.2,

                // Enhancement control (3 properties)
                useStandardizedZones: true,
                enhancementMode: "production" as const,
                minEnhancedConfidenceThreshold: 0.3,

                // Enhanced CVD analysis (6 properties)
                cvdDivergenceVolumeThreshold: 50,
                cvdDivergenceStrengthThreshold: 0.7,
                cvdSignificantImbalanceThreshold: 0.3,
                cvdDivergenceScoreMultiplier: 1.5,
                alignmentMinimumThreshold: 0.5,
                momentumScoreMultiplier: 2,
                enableCVDDivergenceAnalysis: true,
                enableMomentumAlignment: false,

                // ESSENTIAL CONFIGURABLE PARAMETERS - Trading Logic (8 mandatory parameters)
                minTradesForAnalysis: 20,
                minVolumeRatio: 0.1,
                maxVolumeRatio: 5.0,
                priceChangeThreshold: 0.001,
                minZScoreBound: -20,
                maxZScoreBound: 20,
                minCorrelationBound: -0.999,
                maxCorrelationBound: 0.999,

                // Override with actual config if available
                ...config.deltaCVD,
            };

            const deltaCVDDetector = new DeltaCVDDetectorEnhanced(
                "compare-deltacvd",
                completeDeltaCVDSettings,
                mockPreprocessor,
                mockLogger,
                mockMetrics,
                mockSignalValidationLogger,
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
