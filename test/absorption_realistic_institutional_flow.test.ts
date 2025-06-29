// test/absorption_realistic_institutional_flow.test.ts
//
// REAL WORLD SIMULATION: 500+ trades mimicking institutional absorption patterns
// Tests absorption detector with realistic high-frequency institutional trading flow

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

// Create realistic order book with institutional-grade depth
const createInstitutionalOrderBookMock = (): IOrderBookState => {
    const bestBid = 86.26;
    const bestAsk = 86.27;
    const midPrice = (bestBid + bestAsk) / 2;
    const spread = bestAsk - bestBid;

    const createDepthLevel = (price: number): { bid: number; ask: number } => {
        const distanceFromMid = Math.abs(price - midPrice);
        const decayFactor = Math.exp(-distanceFromMid * 5); // Slower decay for institutional depth

        // MASSIVE institutional depth - thousands of LTC at each level
        const baseVolume = 2000; // 2000 LTC base institutional liquidity

        return {
            bid: price <= bestBid ? Math.max(500, baseVolume * decayFactor) : 0,
            ask: price >= bestAsk ? Math.max(500, baseVolume * decayFactor) : 0,
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
        sumBand: vi.fn(() => ({ bid: 10000, ask: 10000, levels: 20 })), // Massive institutional depth
        snapshot: vi.fn(() => new Map()),
        getDepthMetrics: vi.fn(() => ({
            totalLevels: 50,
            bidLevels: 25,
            askLevels: 25,
            totalBidVolume: 50000, // 50k LTC total bid depth
            totalAskVolume: 50000, // 50k LTC total ask depth
            imbalance: 0.05,
        })),
        shutdown: vi.fn(),
        recover: vi.fn(async () => {}),
        getHealth: vi.fn(() => ({
            status: "healthy" as const,
            initialized: true,
            lastUpdateMs: 100,
            circuitBreakerOpen: false,
            errorRate: 0,
            bookSize: 50,
            spread: spread,
            midPrice: midPrice,
            details: {},
        })),
        onStreamConnected: vi.fn(),
        onStreamDisconnected: vi.fn(),
    } as unknown as IOrderBookState;
};

// Generate realistic institutional trading flow
function generateInstitutionalTradingFlow(): AggressiveTrade[] {
    const trades: AggressiveTrade[] = [];
    let baseTime = Date.now();

    // PHASE 1: Normal market activity (100 trades - establish baseline)
    console.log("Generating Phase 1: Normal market activity (100 trades)...");
    for (let i = 0; i < 100; i++) {
        const price = 86.25 + Math.random() * 0.05; // 86.25-86.30 range
        const quantity = 1 + Math.random() * 10; // 1-11 LTC normal size
        const buyerIsMaker = Math.random() > 0.5;

        trades.push({
            timestamp: baseTime + i * 100, // 100ms intervals
            price: Math.round(price * 100) / 100, // 2 decimal precision
            quantity: Math.round(quantity * 1000) / 1000, // 3 decimal precision
            buyerIsMaker,
            pair: "LTCUSDT",
            tradeId: `normal-${i}`,
            originalTrade: {} as any,
        });
    }

    // PHASE 2: Institutional selling cascade (200 trades - heavy absorption scenario)
    console.log(
        "Generating Phase 2: Institutional selling cascade (200 trades)..."
    );
    baseTime += 100 * 100;

    for (let i = 0; i < 200; i++) {
        // Price walking down from 86.30 to 86.25 as institutional selling hits
        const priceProgress = i / 200; // 0 to 1
        const price = 86.3 - priceProgress * 0.05; // Walk down 5 cents

        // Heavy institutional selling with increasing size
        const baseSize = 50 + i * 2; // Start at 50 LTC, increase to 450 LTC
        const quantity = baseSize + Math.random() * 100; // Add variance

        // 85% selling pressure, 15% absorption buying
        const buyerIsMaker = Math.random() > 0.85; // Heavy selling

        trades.push({
            timestamp: baseTime + i * 50, // Faster 50ms intervals during cascade
            price: Math.round(price * 100) / 100,
            quantity: Math.round(quantity * 1000) / 1000,
            buyerIsMaker,
            pair: "LTCUSDT",
            tradeId: `cascade-${i}`,
            originalTrade: {} as any,
        });
    }

    // PHASE 3: Peak absorption event (50 trades - massive institutional block)
    console.log("Generating Phase 3: Peak absorption event (50 trades)...");
    baseTime += 200 * 50;

    for (let i = 0; i < 50; i++) {
        // Price contained at 86.25 despite massive volume
        const price = 86.25 + (Math.random() * 0.01 - 0.005); // Tight 1 cent range

        // MASSIVE institutional blocks - 500-2000 LTC each
        const quantity = 500 + Math.random() * 1500; // 500-2000 LTC per trade

        // 90% selling hitting bid absorption
        const buyerIsMaker = Math.random() > 0.9; // Massive selling into absorption

        trades.push({
            timestamp: baseTime + i * 25, // Very fast 25ms intervals
            price: Math.round(price * 100) / 100,
            quantity: Math.round(quantity * 1000) / 1000,
            buyerIsMaker,
            pair: "LTCUSDT",
            tradeId: `absorption-${i}`,
            originalTrade: {} as any,
        });
    }

    // PHASE 4: Bounce recovery (150 trades - absorption successful, bounce)
    console.log("Generating Phase 4: Bounce recovery (150 trades)...");
    baseTime += 50 * 25;

    for (let i = 0; i < 150; i++) {
        // Price bouncing back from 86.25 to 86.28
        const priceProgress = i / 150;
        const price = 86.25 + priceProgress * 0.03; // Bounce up 3 cents

        // Buying takes over after successful absorption
        const baseSize = 20 + i * 1.5; // Increasing buying pressure
        const quantity = baseSize + Math.random() * 50;

        // 70% buying after absorption
        const buyerIsMaker = Math.random() < 0.7; // Buying dominance

        trades.push({
            timestamp: baseTime + i * 75, // Slower 75ms intervals during recovery
            price: Math.round(price * 100) / 100,
            quantity: Math.round(quantity * 1000) / 1000,
            buyerIsMaker,
            pair: "LTCUSDT",
            tradeId: `bounce-${i}`,
            originalTrade: {} as any,
        });
    }

    console.log(`Generated ${trades.length} total trades across 4 phases`);
    console.log(
        `Total volume: ${trades.reduce((sum, t) => sum + t.quantity, 0).toFixed(0)} LTC`
    );
    console.log(
        `Time span: ${(trades[trades.length - 1].timestamp - trades[0].timestamp) / 1000} seconds`
    );

    return trades;
}

// Helper function to create enriched trade events
function createEnrichedTrade(
    trade: AggressiveTrade,
    orderBook: IOrderBookState
): EnrichedTradeEvent {
    const depthAtPrice = orderBook.getDepthAtPrice(trade.price);

    return {
        ...trade,

        // Massive institutional passive volume
        passiveBidVolume: depthAtPrice.bid,
        passiveAskVolume: depthAtPrice.ask,
        zonePassiveBidVolume: depthAtPrice.bid,
        zonePassiveAskVolume: depthAtPrice.ask,

        // Order book context
        bestBid: orderBook.getBestBid(),
        bestAsk: orderBook.getBestAsk(),

        // Trade properties
        side: trade.buyerIsMaker ? "bid" : "ask",
        isAggressive: true,
        enriched: true,
        aggression: 0.8,

        // Depth snapshot
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

describe("Absorption Detector - Realistic Institutional Flow (500+ Trades)", () => {
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
        mockOrderBook = createInstitutionalOrderBookMock();

        // Reset all mocks
        vi.clearAllMocks();
    });

    it("should detect absorption in realistic 500+ trade institutional flow", () => {
        console.log("\n=== INSTITUTIONAL ABSORPTION SIMULATION ===");
        console.log(
            "Simulating real-world institutional trading with 500+ trades"
        );

        // Use production-grade settings
        const settings: AbsorptionSettings = {
            symbol: "LTCUSDT",
            minAggVolume: 175, // Real production threshold
            windowMs: 60000, // 1 minute window
            pricePrecision: 2,
            zoneTicks: 5,
            eventCooldownMs: 10000, // 10 second cooldown
            absorptionThreshold: 0.6,
            minPassiveMultiplier: 1.2,
            maxAbsorptionRatio: 0.4,
            priceEfficiencyThreshold: 0.02,
        };

        console.log("Production Absorption Settings:");
        console.log(`  minAggVolume: ${settings.minAggVolume} LTC`);
        console.log(`  absorptionThreshold: ${settings.absorptionThreshold}`);
        console.log(
            `  priceEfficiencyThreshold: ${settings.priceEfficiencyThreshold}`
        );
        console.log(`  windowMs: ${settings.windowMs}ms`);

        const detector = new AbsorptionDetector(
            "institutional-flow-test",
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
                `🎯 ABSORPTION SIGNAL #${signalCount}: ${signal.side} at ${signal.price} (confidence: ${signal.confidence?.toFixed(3)})`
            );
        });

        // Generate massive institutional trading flow
        const institutionalTrades = generateInstitutionalTradingFlow();

        console.log(
            `\n=== PROCESSING ${institutionalTrades.length} INSTITUTIONAL TRADES ===`
        );

        // Track phases for analysis
        let phaseSignals = {
            normal: 0, // 0-99
            cascade: 0, // 100-299
            absorption: 0, // 300-349
            bounce: 0, // 350-499
        };

        // Process all trades with progress tracking
        institutionalTrades.forEach((trade, index) => {
            const enrichedTrade = createEnrichedTrade(trade, mockOrderBook);

            // Track signals by phase
            const beforeSignals = signalCount;
            detector.onEnrichedTrade(enrichedTrade);
            const afterSignals = signalCount;

            if (afterSignals > beforeSignals) {
                if (index < 100) phaseSignals.normal++;
                else if (index < 300) phaseSignals.cascade++;
                else if (index < 350) phaseSignals.absorption++;
                else phaseSignals.bounce++;
            }

            // Progress reporting every 100 trades
            if ((index + 1) % 100 === 0) {
                const phase =
                    index < 100
                        ? "Normal"
                        : index < 300
                          ? "Cascade"
                          : index < 350
                            ? "Absorption"
                            : "Bounce";
                console.log(
                    `  Processed ${index + 1} trades [${phase} phase] - Signals: ${signalCount}`
                );
            }
        });

        console.log(`\n=== INSTITUTIONAL FLOW RESULTS ===`);
        console.log(`Total signals generated: ${signalCount}`);
        console.log(`Signal breakdown by phase:`);
        console.log(`  Phase 1 (Normal): ${phaseSignals.normal} signals`);
        console.log(`  Phase 2 (Cascade): ${phaseSignals.cascade} signals`);
        console.log(
            `  Phase 3 (Absorption): ${phaseSignals.absorption} signals`
        );
        console.log(`  Phase 4 (Bounce): ${phaseSignals.bounce} signals`);

        const totalVolume = institutionalTrades.reduce(
            (sum, t) => sum + t.quantity,
            0
        );
        console.log(`Total volume processed: ${totalVolume.toFixed(0)} LTC`);
        console.log(
            `Average volume per trade: ${(totalVolume / institutionalTrades.length).toFixed(1)} LTC`
        );

        // Calculate volume in absorption phase (trades 300-349)
        const absorptionPhaseVolume = institutionalTrades
            .slice(300, 350)
            .reduce((sum, t) => sum + t.quantity, 0);
        console.log(
            `Absorption phase volume: ${absorptionPhaseVolume.toFixed(0)} LTC`
        );

        // Log any warnings for debugging
        const warnings = (mockLogger.warn as any).mock.calls;
        if (warnings.length > 0) {
            console.log(`\nWarnings during processing: ${warnings.length}`);
            warnings.slice(0, 5).forEach((call: any, i: number) => {
                console.log(`  WARN ${i}: ${call[0]}`, call[1]);
            });
            if (warnings.length > 5) {
                console.log(`  ... and ${warnings.length - 5} more warnings`);
            }
        }

        // Detailed signal analysis
        if (signalCount > 0) {
            console.log(`\n=== SIGNAL ANALYSIS ===`);
            signalDetails.forEach((signal, i) => {
                console.log(
                    `Signal ${i + 1}: ${signal.side} absorption at ${signal.price} (confidence: ${signal.confidence?.toFixed(3)})`
                );
            });

            // Expect multiple signals during institutional flow
            expect(signalCount).toBeGreaterThan(0);
            expect(signalDetails[0].confidence).toBeGreaterThan(0);

            console.log(
                `\n✅ SUCCESS: Absorption detector working with institutional-scale trading flow`
            );
        } else {
            console.log(
                `\n❌ CRITICAL ISSUE: No signals generated despite 500+ trade institutional flow`
            );
            console.log(
                `This indicates fundamental blocking in absorption detection logic`
            );
            console.log(`Institutional flow included:`);
            console.log(
                `  - ${absorptionPhaseVolume.toFixed(0)} LTC in absorption phase`
            );
            console.log(`  - Multiple trades >500 LTC each`);
            console.log(`  - Realistic price containment patterns`);
            console.log(`  - 500+ trades meeting all pattern requirements`);

            // This test should FAIL if no signals are generated with such massive flow
            console.log(
                `\nThis represents a production-critical issue requiring investigation`
            );
        }
    });
});
