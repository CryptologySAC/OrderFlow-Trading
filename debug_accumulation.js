// debug_accumulation.js - Debug accumulation detector signal generation

import { AccumulationZoneDetectorEnhanced } from "./src/indicators/accumulationZoneDetectorEnhanced.js";
import { OrderflowPreprocessor } from "./src/market/orderFlowPreprocessor.js";
import { OrderBookState } from "./src/market/orderBookState.js";

const TICK_SIZE = 0.01;
const BASE_PRICE = 85.0;

// Simple test configuration with very low thresholds
const ACCUMULATION_CONFIG = {
    useStandardizedZones: true,
    confidenceThreshold: 0.1, // Very low for debugging
    confluenceMinZones: 1,
    confluenceMaxDistance: 0.1,
    confluenceConfidenceBoost: 0.1,
    crossTimeframeConfidenceBoost: 0.15,
    accumulationVolumeThreshold: 1, // Very low - just 1 LTC
    accumulationRatioThreshold: 0.1, // Very low - just 10% buy ratio
    alignmentScoreThreshold: 0.1,
    defaultDurationMs: 120000,
    tickSize: TICK_SIZE,
    enhancementMode: "production",
};

const ORDERBOOK_CONFIG = {
    maxLevels: 150,
    snapshotIntervalMs: 1000,
    maxPriceDistance: 10.0,
    pruneIntervalMs: 30000,
    maxErrorRate: 0.05,
    staleThresholdMs: 5000,
};

const PREPROCESSOR_CONFIG = {
    pricePrecision: 2,
    quantityPrecision: 8,
    bandTicks: 5,
    tickSize: TICK_SIZE,
    symbol: "LTCUSDT",
    enableIndividualTrades: false,
    largeTradeThreshold: 100,
    maxEventListeners: 50,
    dashboardUpdateInterval: 500,
    maxDashboardInterval: 1000,
    significantChangeThreshold: 0.001,
    standardZoneConfig: {
        baseTicks: 5,
        zoneMultipliers: [1, 2, 4],
        timeWindows: [300000, 900000, 1800000, 3600000, 5400000],
        adaptiveMode: false,
        volumeThresholds: {
            aggressive: 1.0, // Very low thresholds
            passive: 1.0,
            institutional: 10.0,
        },
        priceThresholds: {
            tickValue: TICK_SIZE,
            minZoneWidth: 0.02,
            maxZoneWidth: 0.1,
        },
        performanceConfig: {
            maxZoneHistory: 2000,
            cleanupInterval: 5400000,
            maxMemoryMB: 50,
        },
    },
    maxZoneCacheAgeMs: 5400000,
    adaptiveZoneLookbackTrades: 500,
    zoneCalculationRange: 12,
    zoneCacheSize: 100,
    defaultZoneMultipliers: [1, 2, 4],
    defaultTimeWindows: [300000, 900000, 1800000, 3600000, 5400000],
    defaultMinZoneWidthMultiplier: 2,
    defaultMaxZoneWidthMultiplier: 10,
    defaultMaxZoneHistory: 2000,
    defaultMaxMemoryMB: 50,
    defaultAggressiveVolumeAbsolute: 1,
    defaultPassiveVolumeAbsolute: 1,
    defaultInstitutionalVolumeAbsolute: 10,
};

// Mock logger with console output
const mockLogger = {
    debug: (msg, data) =>
        console.log("DEBUG:", msg, JSON.stringify(data, null, 2)),
    info: (msg, data) =>
        console.log("INFO:", msg, JSON.stringify(data, null, 2)),
    warn: (msg, data) =>
        console.log("WARN:", msg, JSON.stringify(data, null, 2)),
    error: (msg, data) =>
        console.log("ERROR:", msg, JSON.stringify(data, null, 2)),
    isDebugEnabled: () => true,
    setCorrelationId: () => {},
    removeCorrelationId: () => {},
};

// Mock metrics
const mockMetrics = {
    updateMetric: () => {},
    incrementMetric: () => {},
    incrementCounter: () => {},
    decrementMetric: () => {},
    recordGauge: () => {},
    recordHistogram: () => {},
    recordTimer: () => ({ stop: () => {} }),
    startTimer: () => ({ stop: () => {} }),
    getMetrics: () => ({}),
    shutdown: () => {},
};

// Mock ThreadManager
const mockThreadManager = {
    callStorage: () => Promise.resolve(),
    broadcast: () => {},
    shutdown: () => {},
    isStarted: () => true,
    startWorkers: () => Promise.resolve(),
    requestDepthSnapshot: () =>
        Promise.resolve({
            lastUpdateId: 1000,
            bids: [],
            asks: [],
        }),
};

async function debugAccumulation() {
    console.log("=== DEBUGGING ACCUMULATION DETECTOR ===");

    // Create real components
    const orderBook = new OrderBookState(
        ORDERBOOK_CONFIG,
        mockLogger,
        mockMetrics,
        mockThreadManager
    );

    const preprocessor = new OrderflowPreprocessor(
        PREPROCESSOR_CONFIG,
        orderBook,
        mockLogger,
        mockMetrics
    );

    const detector = new AccumulationZoneDetectorEnhanced(
        "debug-accumulation",
        "LTCUSDT",
        ACCUMULATION_CONFIG,
        preprocessor,
        mockLogger,
        mockMetrics
    );

    // Initialize orderbook
    await orderBook.recover();

    // Set up signal capture
    const signals = [];
    detector.on("signalCandidate", (signal) => {
        console.log("🎯 SIGNAL RECEIVED:", JSON.stringify(signal, null, 2));
        signals.push(signal);
    });

    // Set up order book
    const midPrice = BASE_PRICE;
    const spread = 0.01;
    orderBook.updateDepth({
        s: "LTCUSDT",
        U: 1,
        u: 1,
        b: [[String(midPrice - spread / 2), String(1000)]],
        a: [[String(midPrice + spread / 2), String(1000)]],
    });

    // Process trades
    const zonePrice = BASE_PRICE;
    const trades = [
        {
            e: "aggTrade",
            E: Date.now(),
            s: "LTCUSDT",
            a: 123,
            p: zonePrice.toFixed(2),
            q: "5.0",
            f: 456,
            l: 789,
            T: Date.now(),
            m: false, // Buy trade
            M: true,
        },
        {
            e: "aggTrade",
            E: Date.now(),
            s: "LTCUSDT",
            a: 124,
            p: zonePrice.toFixed(2),
            q: "3.0",
            f: 457,
            l: 790,
            T: Date.now(),
            m: false, // Buy trade
            M: true,
        },
    ];

    console.log("Processing trades...");

    for (const trade of trades) {
        console.log("📈 Processing trade:", JSON.stringify(trade, null, 2));

        // Set up event listener
        preprocessor.once("enriched_trade", (event) => {
            console.log("📊 Enriched trade event:", {
                price: event.price,
                quantity: event.quantity,
                hasZoneData: !!event.zoneData,
                zoneCount: event.zoneData
                    ? [
                          event.zoneData.zones5Tick.length,
                          event.zoneData.zones10Tick.length,
                          event.zoneData.zones20Tick.length,
                      ]
                    : null,
            });

            if (event.zoneData && event.zoneData.zones5Tick.length > 0) {
                const zone = event.zoneData.zones5Tick[0];
                console.log("📍 Zone data sample:", {
                    priceLevel: zone.priceLevel,
                    aggressiveVolume: zone.aggressiveVolume,
                    aggressiveBuyVolume: zone.aggressiveBuyVolume,
                    aggressiveSellVolume: zone.aggressiveSellVolume,
                    tradeCount: zone.tradeCount,
                });
            }

            console.log("🔄 Calling detector.onEnrichedTrade...");
            detector.onEnrichedTrade(event);
        });

        await preprocessor.handleAggTrade(trade);

        // Add small delay
        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.log("=== FINAL RESULTS ===");
    console.log("Signals generated:", signals.length);
    console.log("Detector status:", detector.getStatus());

    if (signals.length === 0) {
        console.log("❌ NO SIGNALS GENERATED - DEBUGGING NEEDED");
    } else {
        console.log("✅ SIGNALS GENERATED SUCCESSFULLY");
    }
}

// Run debug
debugAccumulation().catch(console.error);
