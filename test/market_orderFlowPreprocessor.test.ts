import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the WorkerLogger before importing
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");

import { OrderflowPreprocessor } from "../src/market/orderFlowPreprocessor";
import { WorkerLogger } from "../src/multithreading/workerLogger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";

describe("market/OrderflowPreprocessor", () => {
    let pre: OrderflowPreprocessor;
    let book: any;
    beforeEach(() => {
        const logger = new WorkerLogger();
        const metrics = new MetricsCollector();
        book = {
            updateDepth: vi.fn(),
            getLevel: vi.fn().mockReturnValue({ bid: 1, ask: 2 }),
            getBestBid: vi.fn().mockReturnValue(100),
            getBestAsk: vi.fn().mockReturnValue(101),
            getSpread: vi.fn().mockReturnValue(1),
            sumBand: vi.fn().mockReturnValue({ bid: 2, ask: 3, levels: 1 }),
            snapshot: vi.fn().mockReturnValue(new Map()),
            getDepthMetrics: vi.fn().mockReturnValue({
                totalLevels: 1,
                bidLevels: 1,
                askLevels: 1,
                totalBidVolume: 1,
                totalAskVolume: 1,
                imbalance: 0,
            }),
        };
        pre = new OrderflowPreprocessor(
            {
                pricePrecision: 2,
                quantityPrecision: 8,
                bandTicks: 5,
                tickSize: 0.01,
                symbol: "LTCUSDT",
                enableIndividualTrades: false,
                largeTradeThreshold: 100,
                maxEventListeners: 50,
                dashboardUpdateInterval: 200,
                maxDashboardInterval: 1000,
                significantChangeThreshold: 0.001,
                enableStandardizedZones: true,
                standardZoneConfig: {
                    baseTicks: 5,
                    zoneMultipliers: [1, 2, 4],
                    timeWindows: [30000, 60000, 300000], // 30s, 60s, 5min
                    adaptiveMode: false,
                    volumeThresholds: {
                        aggressive: 10.0,
                        passive: 5.0,
                        institutional: 50.0,
                    },
                    priceThresholds: {
                        significantMove: 0.001, // 0.1%
                        majorMove: 0.005, // 0.5%
                    },
                    maxZones: 100,
                    zoneTimeoutMs: 300000,
                },
                maxZoneCacheAgeMs: 5400000,
                adaptiveZoneLookbackTrades: 500,
                zoneCalculationRange: 12,
                zoneCacheSize: 375,
                defaultZoneMultipliers: [1, 2, 4],
                defaultTimeWindows: [300000, 900000, 1800000, 3600000, 5400000],
                defaultMinZoneWidthMultiplier: 2,
                defaultMaxZoneWidthMultiplier: 10,
                defaultMaxZoneHistory: 2000,
                defaultMaxMemoryMB: 50,
                defaultAggressiveVolumeAbsolute: 10.0,
                defaultPassiveVolumeAbsolute: 5.0,
                defaultInstitutionalVolumeAbsolute: 50.0,
            },
            book,
            logger,
            metrics
        );
    });

    it("emits enriched trade", (done) => {
        pre.on("enriched_trade", (t) => {
            expect(t.bestBid).toBe(100);
            done();
        });
        pre.handleAggTrade({
            e: "aggTrade",
            T: Date.now(),
            p: "100",
            q: "1",
            s: "TST",
            m: false,
            a: 1,
        } as any);
    });
});
