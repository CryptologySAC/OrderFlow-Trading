import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before imports - MANDATORY per CLAUDE.md
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");

import { ExhaustionDetectorEnhanced } from "../src/indicators/exhaustionDetectorEnhanced.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";
import type { IOrderflowPreprocessor } from "../src/market/orderFlowPreprocessor.js";
import type {
    EnrichedTradeEvent,
    StandardZoneData,
    ZoneSnapshot,
} from "../src/types/marketEvents.js";

// Import mock config for complete settings
import mockConfig from "../__mocks__/config.json";

describe("ExhaustionDetector Debug", () => {
    let detector: ExhaustionDetectorEnhanced;
    let mockLogger: ILogger;
    let mockMetrics: MetricsCollector;
    let mockPreprocessor: IOrderflowPreprocessor;
    let signalSpy: vi.Mock;

    // Create mock preprocessor with detailed logging
    const createMockPreprocessor = (): IOrderflowPreprocessor => ({
        handleDepth: vi.fn(),
        handleAggTrade: vi.fn(),
        getStats: vi.fn(() => ({
            processedTrades: 0,
            processedDepthUpdates: 0,
            bookMetrics: {} as any,
        })),
        findZonesNearPrice: vi.fn((zones, price, maxDistance) => {
            console.log(`DEBUG: findZonesNearPrice called with:`);
            console.log(`  zones.length: ${zones.length}`);
            console.log(`  price: ${price}`);
            console.log(`  maxDistance: ${maxDistance}`);

            const filtered = zones.filter((zone: ZoneSnapshot) => {
                const distance = Math.abs(zone.priceLevel - price);
                const withinDistance = distance <= maxDistance;
                console.log(
                    `  zone at ${zone.priceLevel}, distance: ${distance}, within: ${withinDistance}`
                );
                return withinDistance;
            });

            console.log(`  returning ${filtered.length} zones`);
            return filtered;
        }),
        calculateZoneRelevanceScore: vi.fn(() => 0.8),
        findMostRelevantZone: vi.fn(() => null),
    });

    function createZoneSnapshot(
        priceLevel: number,
        aggressiveVolume: number,
        passiveVolume: number
    ): ZoneSnapshot {
        return {
            zoneId: `zone-${priceLevel}`,
            priceLevel,
            tickSize: 0.01,
            aggressiveVolume,
            passiveVolume,
            aggressiveBuyVolume: aggressiveVolume * 0.7, // 70% buy, 30% sell
            aggressiveSellVolume: aggressiveVolume * 0.3,
            passiveBidVolume: passiveVolume * 0.5,
            passiveAskVolume: passiveVolume * 0.5,
            tradeCount: Math.max(1, Math.floor(aggressiveVolume / 5)),
            timespan: 60000,
            boundaries: { min: priceLevel - 0.005, max: priceLevel + 0.005 },
            lastUpdate: Date.now(),
            volumeWeightedPrice: priceLevel,
        };
    }

    function createTradeEvent(
        price: number,
        quantity: number,
        isBuy: boolean,
        aggressiveVol: number = 50,
        passiveVol: number = 5
    ): EnrichedTradeEvent {
        const zoneData: StandardZoneData = {
            timestamp: Date.now(),
            zones: [createZoneSnapshot(price, aggressiveVol, passiveVol)],
            zoneConfig: {
                zoneTicks: 10,
                tickValue: 0.01,
                timeWindow: 60000,
            },
        };

        return {
            eventType: "aggTrade",
            symbol: "LTCUSDT",
            price,
            quantity,
            timestamp: Date.now(),
            tradeId: Date.now(),
            buyerOrderId: 1,
            sellerOrderId: 2,
            tradeTime: Date.now(),
            buyerIsMaker: !isBuy,
            marketPrice: price,
            zoneData,
            bookMetrics: {
                spread: 0.01,
                spreadBps: 1,
                midPrice: price,
                totalBidVolume: 100,
                totalAskVolume: 100,
                imbalance: 0,
                volatility: 0.02,
            },
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();

        // Create detailed mock logger that logs everything
        mockLogger = {
            debug: vi.fn((msg, data) => console.log(`DEBUG: ${msg}`, data)),
            info: vi.fn((msg, data) => console.log(`INFO: ${msg}`, data)),
            warn: vi.fn((msg, data) => console.log(`WARN: ${msg}`, data)),
            error: vi.fn((msg, data) => console.log(`ERROR: ${msg}`, data)),
        } as ILogger;

        mockMetrics = {
            updateMetric: vi.fn(),
            incrementMetric: vi.fn(),
            getMetrics: vi.fn(() => ({ test: 1 })),
        } as unknown as MetricsCollector;

        mockPreprocessor = createMockPreprocessor();

        const mockSignalLogger = {
            logSignal: vi.fn(),
            getSignalHistory: vi.fn(() => []),
        };

        const mockSpoofingDetector = {
            analyzeOrder: vi.fn(() => ({ isSpoof: false, confidence: 0 })),
        } as any;

        const exhaustionConfig = mockConfig.symbols.LTCUSDT.exhaustion;

        console.log("DEBUG: Exhaustion config being used:", exhaustionConfig);

        detector = new ExhaustionDetectorEnhanced(
            "test-exhaustion-debug",
            exhaustionConfig,
            mockPreprocessor,
            mockLogger,
            mockSpoofingDetector,
            mockMetrics,
            mockSignalLogger
        );

        signalSpy = vi.fn((signal) => console.log("SIGNAL EMITTED:", signal));
        detector.on("signalCandidate", signalSpy);
    });

    it("should debug exhaustion detection step by step", () => {
        console.log("\n=== DEBUG TEST START ===");

        // Create a very clear exhaustion scenario
        const trade = createTradeEvent(
            87.5, // price
            25, // quantity (above minAggVolume: 15)
            false, // aggressive buy
            50, // aggressive volume (above depletionVolumeThreshold: 15)
            5 // passive volume (ratio will be 50/(50+5) = 0.909 > depletionRatioThreshold: 0.4)
        );

        console.log("Trade event:", {
            price: trade.price,
            quantity: trade.quantity,
            aggressiveVol: trade.zoneData?.zones[0]?.aggressiveVolume,
            passiveVol: trade.zoneData?.zones[0]?.passiveVolume,
            ratio: trade.zoneData?.zones[0]
                ? trade.zoneData.zones[0].aggressiveVolume /
                  (trade.zoneData.zones[0].aggressiveVolume +
                      trade.zoneData.zones[0].passiveVolume)
                : 0,
        });

        detector.onEnrichedTrade(trade);

        console.log("\nTest results:");
        console.log("Signal spy called:", signalSpy.mock.calls.length);
        console.log("Logger debug calls:", mockLogger.debug.mock.calls.length);
        console.log("Logger warn calls:", mockLogger.warn.mock.calls.length);
        console.log("Logger error calls:", mockLogger.error.mock.calls.length);

        if (signalSpy.mock.calls.length > 0) {
            console.log("Signal emitted:", signalSpy.mock.calls[0][0]);
        } else {
            console.log("No signal emitted");
        }

        console.log("=== DEBUG TEST END ===\n");

        // The test should pass if we understand what's happening
        expect(true).toBe(true);
    });
});
