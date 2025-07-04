#!/usr/bin/env node

/**
 * BOOK LEVEL DEBUG SCRIPT
 *
 * Specifically debug the getBookLevel failure that's blocking signal generation
 */

import { ExhaustionDetector } from "./dist/indicators/exhaustionDetector.js";

// Enhanced logger to catch specific issues
const createTargetedLogger = () => ({
    info: (msg, data) => {
        if (
            msg.includes("book data available") ||
            msg.includes("ATTEMPTING SIGNAL")
        ) {
            console.log(
                `🔵 INFO: ${msg}`,
                data ? JSON.stringify(data, null, 2) : ""
            );
        }
    },
    warn: (msg, data) => {
        console.log(
            `🟡 WARN: ${msg}`,
            data ? JSON.stringify(data, null, 2) : ""
        );
    },
    error: (msg, data) => {
        console.log(
            `🔴 ERROR: ${msg}`,
            data ? JSON.stringify(data, null, 2) : ""
        );
    },
    debug: (msg, data) => {
        if (
            msg.includes("book") ||
            msg.includes("depth") ||
            msg.includes("zone") ||
            msg.includes("Signal")
        ) {
            console.log(
                `🟢 DEBUG: ${msg}`,
                data ? JSON.stringify(data, null, 2) : ""
            );
        }
    },
});

const createMockMetrics = () => ({
    updateMetric: () => {},
    incrementMetric: () => {},
    incrementCounter: () => {},
    recordHistogram: () => {},
    getMetrics: () => ({}),
    getHealthSummary: () => "healthy",
});

const createMockSpoofingDetector = () => ({
    isSpoofed: () => false,
    detectLayeringAttack: () => false,
    wasSpoofed: () => false,
});

/**
 * Test book level resolution with instrumentation
 */
function testBookLevelResolution() {
    console.log("🔍 === BOOK LEVEL RESOLUTION DEBUG ===\n");

    const detector = new ExhaustionDetector(
        "book-level-debug",
        {
            exhaustionThreshold: 0.2, // Very low to avoid threshold blocking
            maxPassiveRatio: 0.5,
            minDepletionFactor: 0.1,
            windowMs: 30000,
            minAggVolume: 10, // Very low
            features: {
                depletionTracking: true,
                spreadAdjustment: true,
                volumeVelocity: true,
                adaptiveZone: true,
                passiveHistory: true,
            },
        },
        createTargetedLogger(),
        createMockSpoofingDetector(),
        createMockMetrics()
    );

    // Instrument the detector to trace getBookLevel calls
    const originalGetBookLevel = detector.getBookLevel;
    if (originalGetBookLevel) {
        detector.getBookLevel = function (price, zone, side) {
            console.log(`\n📊 getBookLevel called:`, {
                price: price,
                zone: zone,
                side: side,
            });

            // Check depth map contents
            const depthKeys = Array.from(this.depth.keys());
            console.log(
                `   Depth map keys (${depthKeys.length}):`,
                depthKeys.slice(0, 5)
            );

            // Check zone history
            const hasZoneHistory = this.zonePassiveHistory.has(zone);
            console.log(`   Has zone history: ${hasZoneHistory}`);

            if (hasZoneHistory) {
                const zoneHistory = this.zonePassiveHistory.get(zone);
                const samples = zoneHistory.toArray();
                console.log(`   Zone history samples: ${samples.length}`);
                if (samples.length > 0) {
                    const latest = samples[samples.length - 1];
                    console.log(`   Latest sample:`, {
                        bid: latest.bid,
                        ask: latest.ask,
                        total: latest.total,
                        timestamp: latest.timestamp,
                    });
                }
            }

            const result = originalGetBookLevel.call(this, price, zone, side);
            console.log(`   getBookLevel result:`, result);

            return result;
        };
    }

    // Also instrument analyzeZoneForExhaustion to see where it stops
    const originalAnalyze = detector.analyzeZoneForExhaustion;
    if (originalAnalyze) {
        detector.analyzeZoneForExhaustion = function (
            zone,
            tradesAtZone,
            triggerTrade,
            zoneTicks
        ) {
            console.log(`\n🎯 analyzeZoneForExhaustion called:`, {
                zone: zone,
                tradesCount: tradesAtZone.length,
                zoneTicks: zoneTicks,
            });

            return originalAnalyze.call(
                this,
                zone,
                tradesAtZone,
                triggerTrade,
                zoneTicks
            );
        };
    }

    // Now create trades and watch the flow
    console.log("\n📈 Creating trades to trigger analysis...");

    const timestamp = Date.now();

    for (let i = 0; i < 5; i++) {
        const price = 89.0 - i * 0.01;
        const aggressiveVolume = 50 + i * 20;
        const bidVolume = 100 - i * 10;
        const askVolume = 100;

        const trade = {
            tradeId: `debug_${i}`,
            price: price,
            quantity: aggressiveVolume,
            timestamp: timestamp + i * 3000,
            buyerIsMaker: true,
            side: "sell",
            aggression: 0.8,
            enriched: true,
            zonePassiveBidVolume: bidVolume,
            zonePassiveAskVolume: askVolume,
            originalTrade: {
                tradeId: `debug_${i}`,
                price: price,
                quantity: aggressiveVolume,
                timestamp: timestamp + i * 3000,
                buyerIsMaker: true,
                side: "sell",
                aggression: 0.8,
            },
        };

        console.log(`\n🔄 Processing trade ${i + 1}:`, {
            price: price.toFixed(2),
            aggressive: aggressiveVolume,
            bidVolume: bidVolume,
            askVolume: askVolume,
        });

        detector.onEnrichedTrade(trade);
    }

    console.log("\n📊 === FINAL DETECTOR STATE ===");
    const stats = detector.getStats();
    console.log("Detector Stats:", stats);

    detector.cleanup();
}

/**
 * Test with pre-populated depth data to see if that resolves the issue
 */
function testWithDepthData() {
    console.log("\n🔬 === TESTING WITH DEPTH DATA ===\n");

    const detector = new ExhaustionDetector(
        "depth-test",
        {
            exhaustionThreshold: 0.2,
            maxPassiveRatio: 0.5,
            minDepletionFactor: 0.1,
            windowMs: 30000,
            minAggVolume: 10,
            features: {
                depletionTracking: true,
                spreadAdjustment: true,
                volumeVelocity: true,
                adaptiveZone: true,
                passiveHistory: true,
            },
        },
        createTargetedLogger(),
        createMockSpoofingDetector(),
        createMockMetrics()
    );

    // Manually populate depth data to simulate order book
    console.log("📚 Manually populating depth data...");

    // If depth map is accessible, populate it
    if (detector.depth && detector.depth.set) {
        for (let i = 0; i < 20; i++) {
            const price = 89.0 - i * 0.01;
            detector.depth.set(price, {
                bid: 100 - i * 2,
                ask: 100 - i * 2,
            });
        }
        console.log("✅ Depth data populated");
    } else {
        console.log("❌ Cannot access depth map");
    }

    // Now test signal generation
    const timestamp = Date.now();
    const trade = {
        tradeId: "depth_test",
        price: 89.0,
        quantity: 100,
        timestamp: timestamp,
        buyerIsMaker: true,
        side: "sell",
        aggression: 0.9,
        enriched: true,
        zonePassiveBidVolume: 50, // Low bid liquidity
        zonePassiveAskVolume: 150, // High ask liquidity
        originalTrade: {
            tradeId: "depth_test",
            price: 89.0,
            quantity: 100,
            timestamp: timestamp,
            buyerIsMaker: true,
            side: "sell",
            aggression: 0.9,
        },
    };

    console.log("\n🔄 Processing test trade with populated depth...");
    detector.onEnrichedTrade(trade);

    detector.cleanup();
}

// Run the debug tests
console.log("🔍 BOOK LEVEL FAILURE DEBUG");
console.log("==========================\n");

testBookLevelResolution();
testWithDepthData();

console.log("\n🎯 === DIAGNOSIS COMPLETE ===");
console.log("Check the output above to see exactly where getBookLevel fails.");
