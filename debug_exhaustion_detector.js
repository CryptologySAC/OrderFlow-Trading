#!/usr/bin/env node

/**
 * COMPREHENSIVE EXHAUSTION DETECTOR AUDIT SCRIPT
 *
 * This script traces the execution flow through the exhaustion detector
 * to identify why signals are not being generated.
 */

import { ExhaustionDetector } from "./dist/indicators/exhaustionDetector.js";
import { SpoofingDetector } from "./dist/services/spoofingDetector.js";

// Create enhanced mock logger that captures all logging levels
const createDebugLogger = () => ({
    info: (msg, data) =>
        console.log(
            `🔵 INFO: ${msg}`,
            data ? JSON.stringify(data, null, 2) : ""
        ),
    warn: (msg, data) =>
        console.log(
            `🟡 WARN: ${msg}`,
            data ? JSON.stringify(data, null, 2) : ""
        ),
    error: (msg, data) =>
        console.log(
            `🔴 ERROR: ${msg}`,
            data ? JSON.stringify(data, null, 2) : ""
        ),
    debug: (msg, data) =>
        console.log(
            `🟢 DEBUG: ${msg}`,
            data ? JSON.stringify(data, null, 2) : ""
        ),
});

// Mock metrics collector
const createDebugMetrics = () => ({
    updateMetric: (name, value) =>
        console.log(`📊 METRIC UPDATE: ${name} = ${value}`),
    incrementMetric: (name) => console.log(`📊 METRIC INCREMENT: ${name}`),
    incrementCounter: (name) => console.log(`📊 COUNTER INCREMENT: ${name}`),
    recordHistogram: (name, value) =>
        console.log(`📊 HISTOGRAM: ${name} = ${value}`),
    getMetrics: () => ({}),
    getHealthSummary: () => "healthy",
});

// Mock spoofing detector
const createDebugSpoofingDetector = () => ({
    isSpoofed: () => false,
    detectLayeringAttack: () => false,
    wasSpoofed: () => false,
});

/**
 * Create realistic exhaustion scenario with detailed logging
 */
function createExhaustionScenario(detector, basePrice = 89.0) {
    console.log("\n🎯 === STARTING EXHAUSTION SCENARIO SIMULATION ===");
    console.log(`Base Price: $${basePrice}`);

    let signalGenerated = false;
    let signalDetails = null;

    // Intercept signal emissions
    const originalEmit = detector.emit;
    detector.emit = function (event, data) {
        if (event === "signal") {
            signalGenerated = true;
            signalDetails = data;
            console.log(`🚨 SIGNAL GENERATED!`, {
                type: data.side,
                price: data.price,
                confidence: data.confidence,
                aggressive: data.aggressive,
                opposite: data.oppositeQty,
            });
        } else {
            console.log(
                `📡 EVENT EMITTED: ${event}`,
                data ? JSON.stringify(data, null, 2) : ""
            );
        }
        return originalEmit.call(this, event, data);
    };

    // Create systematic liquidity exhaustion scenario
    const timestamp = Date.now();
    const trades = [];

    console.log("\n📈 Creating systematic bid exhaustion scenario...");

    for (let i = 0; i < 12; i++) {
        // Progressive price decline with increasing aggressive volume
        const price = basePrice - i * 0.01; // 1 cent ticks (valid for price ~$89)
        const aggressiveVolume = 60 + i * 15; // Increasing selling pressure
        const bidVolume = Math.max(10, 150 - i * 12); // Depleting bid liquidity
        const askVolume = 140; // Stable ask liquidity

        const trade = {
            tradeId: `trade_${i}`,
            price: price,
            quantity: aggressiveVolume,
            timestamp: timestamp + i * 2000, // 2 second intervals
            buyerIsMaker: true, // Aggressive selling (buyer is NOT maker)
            side: "sell",
            aggression: 0.85,
            enriched: true,
            zonePassiveBidVolume: bidVolume,
            zonePassiveAskVolume: askVolume,
            // Required for AggressiveTrade interface
            originalTrade: {
                tradeId: `trade_${i}`,
                price: price,
                quantity: aggressiveVolume,
                timestamp: timestamp + i * 2000,
                buyerIsMaker: true,
                side: "sell",
                aggression: 0.85,
            },
        };

        trades.push(trade);

        console.log(`\n🔄 Processing trade ${i + 1}/12:`);
        console.log(`   Price: $${price.toFixed(2)}`);
        console.log(`   Aggressive Volume: ${aggressiveVolume}`);
        console.log(`   Bid Liquidity: ${bidVolume} (depleting)`);
        console.log(`   Ask Liquidity: ${askVolume} (stable)`);

        try {
            // This is the main entry point that should trigger signal detection
            detector.onEnrichedTrade(trade);

            // Check detector state after each trade
            const stats = detector.getStats();
            console.log(`   Detector Stats:`, {
                tradesInBuffer: stats.tradesInBuffer,
                status: stats.status,
                adaptiveZoneTicks: stats.adaptiveZoneTicks,
            });
        } catch (error) {
            console.error(`❌ ERROR processing trade ${i}:`, error.message);
            console.error(`   Stack:`, error.stack);
        }
    }

    console.log("\n📊 === FINAL ANALYSIS ===");
    console.log(`Signal Generated: ${signalGenerated}`);
    if (signalDetails) {
        console.log(`Signal Details:`, signalDetails);
    }

    const finalStats = detector.getStats();
    console.log(`Final Detector Stats:`, finalStats);

    return {
        signalGenerated,
        signalDetails,
        trades,
        finalStats,
    };
}

/**
 * Test threshold sensitivity
 */
function testThresholdSensitivity() {
    console.log("\n🔬 === THRESHOLD SENSITIVITY ANALYSIS ===");

    const thresholdTests = [
        { exhaustionThreshold: 0.1, name: "Very Permissive" },
        { exhaustionThreshold: 0.3, name: "Permissive" },
        { exhaustionThreshold: 0.4, name: "Current Config" },
        { exhaustionThreshold: 0.7, name: "Restrictive" },
    ];

    thresholdTests.forEach((test) => {
        console.log(
            `\n🧪 Testing ${test.name} (threshold: ${test.exhaustionThreshold})`
        );

        const settings = {
            exhaustionThreshold: test.exhaustionThreshold,
            maxPassiveRatio: 0.35,
            minDepletionFactor: 0.3,
            windowMs: 30000,
            minAggVolume: 20, // Very low for testing
            features: {
                depletionTracking: true,
                spreadAdjustment: true,
                volumeVelocity: true,
                adaptiveZone: true,
                passiveHistory: true,
            },
        };

        const detector = new ExhaustionDetector(
            `test-${test.name.toLowerCase().replace(" ", "-")}`,
            settings,
            createDebugLogger(),
            createDebugSpoofingDetector(),
            createDebugMetrics()
        );

        const result = createExhaustionScenario(detector);
        console.log(
            `${test.name} Result: ${result.signalGenerated ? "✅ SIGNAL" : "❌ NO SIGNAL"}`
        );

        detector.cleanup();
    });
}

/**
 * Test data quality requirements
 */
function testDataQualityRequirements() {
    console.log("\n📋 === DATA QUALITY REQUIREMENTS TEST ===");

    const logger = createDebugLogger();
    const detector = new ExhaustionDetector(
        "data-quality-test",
        {
            exhaustionThreshold: 0.3, // Lower threshold for testing
            maxPassiveRatio: 0.4,
            minDepletionFactor: 0.2,
            windowMs: 30000,
            minAggVolume: 20,
            features: {
                depletionTracking: true,
                spreadAdjustment: true,
                volumeVelocity: true,
                adaptiveZone: true,
                passiveHistory: true,
            },
        },
        logger,
        createDebugSpoofingDetector(),
        createDebugMetrics()
    );

    // Test with insufficient data first
    console.log("\n🔍 Testing with minimal data...");
    const minimalTrade = {
        tradeId: "minimal",
        price: 89.0,
        quantity: 50,
        timestamp: Date.now(),
        buyerIsMaker: true,
        side: "sell",
        aggression: 0.8,
        enriched: true,
        zonePassiveBidVolume: 100,
        zonePassiveAskVolume: 100,
        originalTrade: {
            tradeId: "minimal",
            price: 89.0,
            quantity: 50,
            timestamp: Date.now(),
            buyerIsMaker: true,
            side: "sell",
            aggression: 0.8,
        },
    };

    detector.onEnrichedTrade(minimalTrade);

    // Now test with sufficient data
    console.log("\n🔍 Testing with sufficient data...");
    createExhaustionScenario(detector);

    detector.cleanup();
}

/**
 * Main audit execution
 */
async function runAudit() {
    console.log("🔍 EXHAUSTION DETECTOR COMPREHENSIVE AUDIT");
    console.log("==========================================\n");

    try {
        // Test 1: Basic scenario with current settings
        console.log("📋 TEST 1: Basic Scenario with Current Settings");
        const logger = createDebugLogger();
        const detector = new ExhaustionDetector(
            "audit-basic",
            {
                // Use current production settings from config.json
                exhaustionThreshold: 0.4,
                maxPassiveRatio: 0.35,
                minDepletionFactor: 0.3,
                windowMs: 45000,
                minAggVolume: 20,
                features: {
                    depletionTracking: true,
                    spreadAdjustment: true,
                    volumeVelocity: true,
                    adaptiveZone: true,
                    passiveHistory: true,
                },
            },
            logger,
            createDebugSpoofingDetector(),
            createDebugMetrics()
        );

        const basicResult = createExhaustionScenario(detector);
        console.log(
            `Basic Test Result: ${basicResult.signalGenerated ? "✅ SIGNAL" : "❌ NO SIGNAL"}`
        );

        detector.cleanup();

        // Test 2: Threshold sensitivity
        testThresholdSensitivity();

        // Test 3: Data quality requirements
        testDataQualityRequirements();

        console.log("\n🎯 === AUDIT SUMMARY ===");
        console.log(
            "The audit reveals specific conditions that prevent signal generation."
        );
        console.log(
            "Review the detailed logs above to identify the blocking conditions."
        );
    } catch (error) {
        console.error("❌ AUDIT FAILED:", error);
        console.error("Stack:", error.stack);
    }
}

// Run the audit
runAudit().catch(console.error);
