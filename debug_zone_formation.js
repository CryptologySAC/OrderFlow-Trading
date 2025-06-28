// Quick debug script to understand zone formation requirements

import { AccumulationZoneDetector } from "./src/indicators/accumulationZoneDetector.ts";

const mockLogger = {
    info: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.log,
    trace: console.log,
};

const mockMetrics = {
    updateMetric: () => {},
    incrementMetric: () => {},
    recordDuration: () => {},
    getMetrics: () => ({}),
    resetMetrics: () => {},
};

// Ultra permissive config
const config = {
    minCandidateDuration: 10000, // 10 seconds
    minZoneVolume: 50, // Very low
    minTradeCount: 2, // Very low
    maxPriceDeviation: 0.1, // 10%
    minZoneStrength: 0.01, // Almost nothing
    strengthChangeThreshold: 0.15,
    minSellRatio: 0.3, // 30%
};

console.log("Creating detector with ultra permissive config:", config);

const detector = new AccumulationZoneDetector(
    "debug-test",
    "BTCUSDT",
    config,
    mockLogger,
    mockMetrics
);

const baseTime = Date.now();
const basePrice = 50000;

// Create simple trades
const trades = [];
for (let i = 0; i < 5; i++) {
    trades.push({
        price: basePrice,
        quantity: 100,
        timestamp: baseTime + i * 1000,
        buyerIsMaker: true, // All sells for accumulation
        pair: "BTCUSDT",
        tradeId: `debug-${i}`,
        originalTrade: {},
        passiveBidVolume: 0,
        passiveAskVolume: 0,
        zonePassiveBidVolume: 0,
        zonePassiveAskVolume: 0,
    });
}

console.log("\nProcessing", trades.length, "trades...");
trades.forEach((trade, i) => {
    console.log(`Trade ${i}:`, trade.price, trade.quantity, trade.buyerIsMaker);
    const result = detector.analyze(trade);
    console.log(
        `  Candidates: ${detector.getCandidateCount()}, Active zones: ${detector.getActiveZones().length}`
    );
});

// Try to trigger zone formation after waiting
console.log("\nTrying to trigger zone formation after 15 seconds...");
const triggerTrade = {
    price: basePrice,
    quantity: 100,
    timestamp: baseTime + 15000, // 15 seconds later
    buyerIsMaker: true,
    pair: "BTCUSDT",
    tradeId: "trigger",
    originalTrade: {},
    passiveBidVolume: 0,
    passiveAskVolume: 0,
    zonePassiveBidVolume: 0,
    zonePassiveAskVolume: 0,
};

const finalResult = detector.analyze(triggerTrade);
console.log("Final result:");
console.log("  Updates:", finalResult.updates.length);
console.log("  Signals:", finalResult.signals.length);
console.log("  Active zones:", finalResult.activeZones.length);
console.log("  Candidates:", detector.getCandidateCount());

if (finalResult.updates.length === 0) {
    console.log(
        "\n❌ NO ZONE FORMED - Something is still blocking zone creation"
    );
    console.log("   This suggests the issue is deeper than just configuration");
} else {
    console.log("\n✅ Zone formed successfully with ultra permissive config");
}
