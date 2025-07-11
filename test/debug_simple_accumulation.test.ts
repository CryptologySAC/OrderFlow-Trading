// debug_simple_accumulation.test.ts - Simple test to debug accumulation detector

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AccumulationZoneDetectorEnhanced } from "../src/indicators/accumulationZoneDetectorEnhanced.js";
import { OrderflowPreprocessor } from "../src/market/orderFlowPreprocessor.js";
import { OrderBookState } from "../src/market/orderBookState.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { SpotWebsocketStreams } from "@binance/spot";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import "../test/vitest.setup.ts";

const TICK_SIZE = 0.01;
const BASE_PRICE = 85.0;

// Ultra-low thresholds for debugging - COMPLETE CONFIG
const ACCUMULATION_CONFIG = {
    useStandardizedZones: true,
    eventCooldownMs: 1000, // 1 second cooldown for debugging
    confidenceThreshold: 0.01, // Extremely low for debugging
    confluenceMinZones: 1,
    confluenceMaxDistance: 0.5, // Larger distance
    confluenceConfidenceBoost: 0.1,
    crossTimeframeConfidenceBoost: 0.15,
    accumulationVolumeThreshold: 1, // Just 1 LTC
    accumulationRatioThreshold: 0.1, // Just 10% buy ratio
    alignmentScoreThreshold: 0.1,
    defaultDurationMs: 120000,
    tickSize: TICK_SIZE,
    enhancementMode: "production" as const,

    // MISSING REQUIRED PROPERTIES - Found in AccumulationDetectorSchema
    maxPriceSupport: 2.0,
    priceSupportMultiplier: 1.5,
    minPassiveVolumeForEfficiency: 1,
    defaultVolatility: 0.05,
    defaultBaselineVolatility: 0.03,
    confluenceStrengthDivisor: 2,
    passiveToAggressiveRatio: 1.0,
    varianceReductionFactor: 1.0,
    aggressiveBuyingRatioThreshold: 0.5,
    aggressiveBuyingReductionFactor: 0.5,
    buyingPressureConfidenceBoost: 0.1,
    enableZoneConfluenceFilter: true,
    enableBuyingPressureAnalysis: true,
    enableCrossTimeframeAnalysis: true,
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
        zoneTicks: 10,
        timeWindows: [300000, 900000, 1800000, 3600000, 5400000],
        adaptiveMode: false,
        volumeThresholds: {
            aggressive: 1.0, // Very low
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
    maxTradesPerZone: 1500, // CRITICAL FIX: Required for CircularBuffer capacity in zone creation
};

function createBinanceTrade(
    price: number,
    quantity: number,
    buyerIsMaker: boolean,
    timestamp: number = Date.now()
): SpotWebsocketStreams.AggTradeResponse {
    return {
        e: "aggTrade",
        E: timestamp,
        s: "LTCUSDT",
        a: Math.floor(Math.random() * 1000000),
        p: price.toFixed(2),
        q: quantity.toFixed(8),
        f: Math.floor(Math.random() * 1000000),
        l: Math.floor(Math.random() * 1000000),
        T: timestamp,
        m: buyerIsMaker,
        M: true,
    };
}

describe("Accumulation Detector DEBUG", () => {
    let detector: AccumulationZoneDetectorEnhanced;
    let preprocessor: OrderflowPreprocessor;
    let orderBook: OrderBookState;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let detectedSignals: any[];

    beforeEach(async () => {
        detectedSignals = [];

        // Debug logger that prints everything
        mockLogger = {
            debug: vi.fn((msg, data) => console.log("DEBUG:", msg, data)),
            info: vi.fn((msg, data) => console.log("INFO:", msg, data)),
            warn: vi.fn((msg, data) => console.log("WARN:", msg, data)),
            error: vi.fn((msg, data) => console.log("ERROR:", msg, data)),
            isDebugEnabled: vi.fn().mockReturnValue(true),
            setCorrelationId: vi.fn(),
            removeCorrelationId: vi.fn(),
        };

        mockMetrics = {
            updateMetric: vi.fn(),
            incrementMetric: vi.fn(),
            incrementCounter: vi.fn(),
            recordGauge: vi.fn(),
            recordHistogram: vi.fn(),
            getMetrics: vi.fn(() => ({}) as any),
        };

        const mockThreadManager = {
            callStorage: vi.fn().mockResolvedValue(undefined),
            broadcast: vi.fn(),
            shutdown: vi.fn(),
            isStarted: vi.fn().mockReturnValue(true),
            startWorkers: vi.fn().mockResolvedValue(undefined),
            requestDepthSnapshot: vi.fn().mockResolvedValue({
                lastUpdateId: 1000,
                bids: [],
                asks: [],
            }),
        };

        orderBook = new OrderBookState(
            ORDERBOOK_CONFIG,
            mockLogger,
            mockMetrics,
            mockThreadManager
        );

        preprocessor = new OrderflowPreprocessor(
            PREPROCESSOR_CONFIG,
            orderBook,
            mockLogger,
            mockMetrics
        );

        detector = new AccumulationZoneDetectorEnhanced(
            "debug-accumulation",
            "LTCUSDT",
            ACCUMULATION_CONFIG,
            preprocessor,
            mockLogger,
            mockMetrics
        );

        await orderBook.recover();

        // Capture signals
        detector.on("signalCandidate", (signal) => {
            console.log("🎯 SIGNAL CAPTURED:", signal);
            detectedSignals.push(signal);
        });

        // Initialize order book
        const midPrice = BASE_PRICE;
        const spread = 0.01;
        orderBook.updateDepth({
            s: "LTCUSDT",
            U: 1,
            u: 1,
            b: [[String(midPrice - spread / 2), String(1000)]],
            a: [[String(midPrice + spread / 2), String(1000)]],
        });
    });

    it("should debug accumulation signal generation with minimal data", async () => {
        const zonePrice = BASE_PRICE;

        console.log("🔧 Testing with ultra-low thresholds:");
        console.log(
            "- confidenceThreshold:",
            ACCUMULATION_CONFIG.confidenceThreshold
        );
        console.log(
            "- accumulationVolumeThreshold:",
            ACCUMULATION_CONFIG.accumulationVolumeThreshold
        );
        console.log(
            "- accumulationRatioThreshold:",
            ACCUMULATION_CONFIG.accumulationRatioThreshold
        );

        // Single large buy trade that should easily trigger accumulation
        const trade = createBinanceTrade(zonePrice, 10.0, false); // 10 LTC buy

        let lastEvent: EnrichedTradeEvent | null = null;

        preprocessor.on("enriched_trade", (event: EnrichedTradeEvent) => {
            console.log("📊 Enriched trade received:", {
                price: event.price,
                quantity: event.quantity,
                hasZoneData: !!event.zoneData,
            });

            if (event.zoneData) {
                console.log("📍 Zone counts:", {
                    zonesTick: event.zoneData.zones.length,
                });

                if (event.zoneData.zones.length > 0) {
                    const zone = event.zoneData.zones[0];
                    console.log("📈 First zone data:", {
                        priceLevel: zone.priceLevel,
                        aggressiveVolume: zone.aggressiveVolume,
                        aggressiveBuyVolume: zone.aggressiveBuyVolume,
                        aggressiveSellVolume: zone.aggressiveSellVolume,
                        passiveVolume: zone.passiveVolume,
                        tradeCount: zone.tradeCount,
                    });
                }
            }

            lastEvent = event;
            detector.onEnrichedTrade(event);
        });

        await preprocessor.handleAggTrade(trade);

        // Verify we have data
        expect(lastEvent).toBeDefined();
        expect(lastEvent!.zoneData).toBeDefined();

        console.log("🔍 Final signal count:", detectedSignals.length);

        if (detectedSignals.length === 0) {
            console.log("❌ NO SIGNALS - Check detector logic");

            // Print debug info
            const zones = lastEvent!.zoneData!.zones;
            if (zones.length > 0) {
                const targetZone = zones.find(
                    (z) => Math.abs(z.priceLevel - zonePrice) < TICK_SIZE / 2
                );
                if (targetZone) {
                    console.log("🎯 Target zone found:", {
                        priceLevel: targetZone.priceLevel,
                        aggressiveVolume: targetZone.aggressiveVolume,
                        aggressiveBuyVolume: targetZone.aggressiveBuyVolume,
                        totalVolume:
                            targetZone.aggressiveVolume +
                            targetZone.passiveVolume,
                        buyRatio:
                            targetZone.aggressiveBuyVolume /
                            (targetZone.aggressiveVolume || 1),
                        meetsVolumeThreshold:
                            targetZone.aggressiveVolume +
                                targetZone.passiveVolume >=
                            ACCUMULATION_CONFIG.accumulationVolumeThreshold,
                        meetsBuyRatio:
                            targetZone.aggressiveBuyVolume /
                                (targetZone.aggressiveVolume || 1) >=
                            ACCUMULATION_CONFIG.accumulationRatioThreshold,
                    });
                } else {
                    console.log(
                        "❌ No target zone found near price",
                        zonePrice
                    );
                }
            }
        } else {
            console.log("✅ SUCCESS - Signal generated:", detectedSignals[0]);
        }

        // For debugging, let's not assert yet - just observe
        console.log("Debug test completed");
    });
});
