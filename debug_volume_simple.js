// Minimal debug to understand volume aggregation issue
import { OrderflowPreprocessor } from "./dist/market/orderFlowPreprocessor.js";
import { OrderBookState } from "./dist/market/orderBookState.js";

const mockLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    isDebugEnabled: () => false,
    setCorrelationId: () => {},
    removeCorrelationId: () => {},
};

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

const mockThreadManager = {
    callStorage: () => Promise.resolve(undefined),
    broadcast: () => {},
    shutdown: () => {},
    isStarted: () => true,
    startWorkers: () => Promise.resolve(undefined),
    requestDepthSnapshot: () =>
        Promise.resolve({
            lastUpdateId: 1000,
            bids: [],
            asks: [],
        }),
};

async function debugVolumeAggregation() {
    console.log("🔬 Minimal Volume Aggregation Debug");

    const orderBook = new OrderBookState(
        {
            maxLevels: 150,
            snapshotIntervalMs: 1000,
            maxPriceDistance: 10.0,
            pruneIntervalMs: 30000,
            maxErrorRate: 0.05,
            staleThresholdMs: 5000,
        },
        mockLogger,
        mockMetrics,
        mockThreadManager
    );

    await orderBook.recover();

    const preprocessor = new OrderflowPreprocessor(
        {
            pricePrecision: 2,
            quantityPrecision: 8,
            bandTicks: 5,
            tickSize: 0.01,
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
                    aggressive: 10.0,
                    passive: 5.0,
                    institutional: 50.0,
                },
                priceThresholds: {
                    tickValue: 0.01,
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
            defaultAggressiveVolumeAbsolute: 10,
            defaultPassiveVolumeAbsolute: 5,
            defaultInstitutionalVolumeAbsolute: 50,
        },
        orderBook,
        mockLogger,
        mockMetrics
    );

    let enrichedEvents = [];
    preprocessor.on("enriched_trade", (event) => {
        enrichedEvents.push(event);
    });

    // Test the PASSING case first (3 trades, all buys, price 89.1)
    console.log("\n✅ Testing PASSING case (3 trades, all buys, price 89.1):");

    const passingTrades = [
        {
            e: "aggTrade",
            E: Date.now(),
            s: "LTCUSDT",
            a: 1,
            p: "89.10",
            q: "10.00000000",
            f: 1,
            l: 1,
            T: Date.now(),
            m: false,
            M: true,
        },
        {
            e: "aggTrade",
            E: Date.now(),
            s: "LTCUSDT",
            a: 2,
            p: "89.10",
            q: "15.25000000",
            f: 2,
            l: 2,
            T: Date.now(),
            m: false,
            M: true,
        },
        {
            e: "aggTrade",
            E: Date.now(),
            s: "LTCUSDT",
            a: 3,
            p: "89.10",
            q: "12.50000000",
            f: 3,
            l: 3,
            T: Date.now(),
            m: false,
            M: true,
        },
    ];

    enrichedEvents = [];
    for (const trade of passingTrades) {
        await preprocessor.handleAggTrade(trade);
    }

    const passingFinalTrade = enrichedEvents[enrichedEvents.length - 1];
    const passingTargetZone = passingFinalTrade?.zoneData?.zones?.find(
        (z) => Math.abs(z.priceLevel - 89.1) < 0.05
    );

    console.log("Passing case result:", {
        zonesCount: passingFinalTrade?.zoneData?.zones?.length || 0,
        targetZoneFound: !!passingTargetZone,
        aggressiveVolume: passingTargetZone?.aggressiveVolume || 0,
        tradeCount: passingTargetZone?.tradeCount || 0,
        expected: { volume: 37.75, trades: 3 },
    });

    // Test the FAILING case (4 trades, mixed buys/sells, price 89.15)
    console.log(
        "\n❌ Testing FAILING case (4 trades, mixed buys/sells, price 89.15):"
    );

    const failingTrades = [
        {
            e: "aggTrade",
            E: Date.now(),
            s: "LTCUSDT",
            a: 4,
            p: "89.15",
            q: "10.00000000",
            f: 4,
            l: 4,
            T: Date.now(),
            m: false,
            M: true,
        }, // Buy
        {
            e: "aggTrade",
            E: Date.now(),
            s: "LTCUSDT",
            a: 5,
            p: "89.15",
            q: "5.75000000",
            f: 5,
            l: 5,
            T: Date.now(),
            m: true,
            M: true,
        }, // Sell
        {
            e: "aggTrade",
            E: Date.now(),
            s: "LTCUSDT",
            a: 6,
            p: "89.15",
            q: "15.00000000",
            f: 6,
            l: 6,
            T: Date.now(),
            m: false,
            M: true,
        }, // Buy
        {
            e: "aggTrade",
            E: Date.now(),
            s: "LTCUSDT",
            a: 7,
            p: "89.15",
            q: "7.00000000",
            f: 7,
            l: 7,
            T: Date.now(),
            m: true,
            M: true,
        }, // Sell
    ];

    enrichedEvents = [];
    for (const trade of failingTrades) {
        await preprocessor.handleAggTrade(trade);
    }

    const failingFinalTrade = enrichedEvents[enrichedEvents.length - 1];
    const failingTargetZone = failingFinalTrade?.zoneData?.zones?.find(
        (z) => Math.abs(z.priceLevel - 89.15) < 0.05
    );

    console.log("Failing case result:", {
        zonesCount: failingFinalTrade?.zoneData?.zones?.length || 0,
        targetZoneFound: !!failingTargetZone,
        aggressiveVolume: failingTargetZone?.aggressiveVolume || 0,
        tradeCount: failingTargetZone?.tradeCount || 0,
        expected: { volume: 37.75, trades: 4 },
    });

    // Compare zone centers
    console.log("\n🎯 Zone Center Analysis:");
    console.log(
        "Price 89.1 maps to zone center:",
        passingTargetZone?.priceLevel
    );
    console.log(
        "Price 89.15 maps to zone center:",
        failingTargetZone?.priceLevel
    );

    // Check if they should be the same zone
    const shouldBeSameZone =
        Math.abs(
            (passingTargetZone?.priceLevel || 0) -
                (failingTargetZone?.priceLevel || 0)
        ) < 0.01;
    console.log("Should be same zone:", shouldBeSameZone);
}

debugVolumeAggregation().catch(console.error);
