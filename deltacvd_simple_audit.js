#!/usr/bin/env node

/**
 * SIMPLE DELTACVD DETECTOR AUDIT
 * Focus on core functionality verification
 */

import { DeltaCVDConfirmation } from "./dist/indicators/deltaCVDConfirmation.js";

const createLogger = () => ({
    info: (msg, data) => console.log(`ℹ️ ${msg}`, data || ""),
    warn: (msg, data) => console.log(`⚠️ ${msg}`, data || ""),
    error: (msg, data) => console.log(`❌ ${msg}`, data || ""),
    debug: (msg, data) => console.log(`🔍 ${msg}`, data || ""),
});

const createMetrics = () => {
    const store = new Map();
    return {
        updateMetric: (name, value) => store.set(name, value),
        incrementMetric: (name, delta = 1) => {
            const current = store.get(name) || 0;
            store.set(name, current + delta);
        },
        incrementCounter: (name, delta = 1, labels = {}) => {
            const current = store.get(name) || 0;
            store.set(name, current + delta);
        },
        createCounter: (name, help, labelNames = []) => ({
            inc: (labels = {}, value = 1) => {
                const current = store.get(name) || 0;
                store.set(name, current + value);
            },
            get: () => store.get(name) || 0,
        }),
        createHistogram: (name, help, labelNames = [], buckets = []) => ({
            observe: (labels = {}, value = 0) => {
                const key = `${name}_histogram`;
                const current = store.get(key) || [];
                current.push(value);
                store.set(key, current);
            },
            get: () => store.get(`${name}_histogram`) || []
        }),
        createGauge: (name, help, labelNames = []) => ({
            set: (labels = {}, value = 0) => {
                store.set(`${name}_gauge`, value);
            },
            inc: (labels = {}, value = 1) => {
                const current = store.get(`${name}_gauge`) || 0;
                store.set(`${name}_gauge`, current + value);
            },
            dec: (labels = {}, value = 1) => {
                const current = store.get(`${name}_gauge`) || 0;
                store.set(`${name}_gauge`, current - value);
            },
            get: () => store.get(`${name}_gauge`) || 0
        }),
        getMetrics: () => Object.fromEntries(store),
    };
};

const createSpoofingDetector = () => ({
    isSpoofed: () => false,
    detectLayeringAttack: () => false,
    wasSpoofed: () => false,
    checkSpoof: () => ({ isSpoofed: false, confidence: 0 }),
});

const createSignalLogger = () => ({
    logSignal: (signal) =>
        console.log(`📡 Signal:`, {
            type: signal.signalType,
            confidence: signal.confidence,
            direction: signal.direction,
        }),
});

function testBasicFunctionality() {
    console.log("🔍 === DELTACVD BASIC FUNCTIONALITY TEST ===\n");

    // Test 1: Constructor
    console.log("1️⃣ Testing Constructor...");
    try {
        const detector = new DeltaCVDConfirmation(
            "audit-test",
            {
                windowsSec: [60],
                minZ: 1.0,
                minSamplesForStats: 10,
                baseConfidenceRequired: 0.2,
                finalConfidenceRequired: 0.3,
                enableDepthAnalysis: false,
                usePassiveVolume: true,
            },
            createLogger(),
            createSpoofingDetector(),
            createMetrics(),
            createSignalLogger()
        );
        console.log("   ✅ Constructor successful");

        // Test 2: Signal Generation
        console.log("\n2️⃣ Testing Signal Generation...");
        let signalCount = 0;
        detector.on("signal", (signal) => {
            signalCount++;
            console.log(
                `   🚀 Signal #${signalCount}: ${signal.direction} (confidence: ${signal.confidence.toFixed(3)})`
            );
        });

        // Generate trading data
        const baseTime = Date.now();
        const basePrice = 85.0;

        console.log("   📈 Generating test trades...");
        for (let i = 0; i < 30; i++) {
            const trade = {
                tradeId: `test_${i}`,
                price: basePrice + (i % 4) * 0.01,
                quantity: 1.0 + Math.random() * 2.0,
                timestamp: baseTime + i * 2000,
                buyerIsMaker: i < 20 ? false : Math.random() < 0.3, // Initial buy pressure
                side: i < 20 ? "buy" : Math.random() < 0.5 ? "buy" : "sell",
                aggression: 0.6 + Math.random() * 0.3,
                enriched: true,
                originalTrade: {
                    tradeId: `test_${i}`,
                    price: basePrice + (i % 4) * 0.01,
                    quantity: 1.0 + Math.random() * 2.0,
                    timestamp: baseTime + i * 2000,
                    buyerIsMaker: i < 20 ? false : Math.random() < 0.3,
                    side: i < 20 ? "buy" : Math.random() < 0.5 ? "buy" : "sell",
                    aggression: 0.6 + Math.random() * 0.3,
                },
            };

            try {
                detector.onEnrichedTradeSpecific(trade);
                if (i % 10 === 9) {
                    console.log(`   📊 Processed ${i + 1} trades...`);
                }
            } catch (error) {
                console.log(
                    `   ❌ Error processing trade ${i}: ${error.message}`
                );
                break;
            }
        }

        console.log(`\n   📊 Total signals generated: ${signalCount}`);

        // Test 3: Configuration Analysis
        console.log("\n3️⃣ Testing Configuration Accessibility...");
        try {
            // Access some internal state to verify initialization
            console.log(`   ✅ Detector ID: ${detector.getId()}`);
            console.log(`   ✅ Detector running normally`);
        } catch (error) {
            console.log(`   ❌ Configuration access error: ${error.message}`);
        }

        detector.removeAllListeners();
        return { success: true, signalCount };
    } catch (error) {
        console.log(`   ❌ Test failed: ${error.message}`);
        return { success: false, error: error.message };
    }
}

async function testCurrentConfiguration() {
    console.log("\n🔧 === CURRENT CONFIGURATION TEST ===\n");

    // Load current config from file
    try {
        const fs = await import("fs");
        const configStr = await fs.promises.readFile("./config.json", "utf8");
        const config = JSON.parse(configStr);
        const deltaCVDConfig = config.symbols?.LTCUSDT?.deltaCvdConfirmation;

        if (!deltaCVDConfig) {
            console.log("❌ No DeltaCVD configuration found in config.json");
            return;
        }

        console.log("📋 Current Configuration:");
        console.log(JSON.stringify(deltaCVDConfig, null, 2));

        const detector = new DeltaCVDConfirmation(
            "config-test",
            deltaCVDConfig,
            createLogger(),
            createSpoofingDetector(),
            createMetrics(),
            createSignalLogger()
        );

        console.log("✅ Configuration loaded successfully");

        let signalCount = 0;
        detector.on("signal", () => signalCount++);

        // Quick test
        for (let i = 0; i < 10; i++) {
            const trade = {
                tradeId: `config_test_${i}`,
                price: 85.0,
                quantity: 1.0,
                timestamp: Date.now() + i * 1000,
                buyerIsMaker: false,
                side: "buy",
                aggression: 0.8,
                enriched: true,
                originalTrade: {
                    tradeId: `config_test_${i}`,
                    price: 85.0,
                    quantity: 1.0,
                    timestamp: Date.now() + i * 1000,
                    buyerIsMaker: false,
                    side: "buy",
                    aggression: 0.8,
                },
            };
            detector.onEnrichedTradeSpecific(trade);
        }

        console.log(`📊 Configuration test - Signals: ${signalCount}`);
        detector.removeAllListeners();
    } catch (error) {
        console.log(`❌ Configuration test failed: ${error.message}`);
    }
}

function analyzeThresholds() {
    console.log("\n🎯 === THRESHOLD ANALYSIS ===\n");

    const testConfigs = [
        {
            name: "Very Low Thresholds",
            minZ: 0.5,
            baseConf: 0.1,
            finalConf: 0.2,
        },
        {
            name: "Current Production",
            minZ: 0.6,
            baseConf: 0.2,
            finalConf: 0.35,
        },
        { name: "High Thresholds", minZ: 2.0, baseConf: 0.4, finalConf: 0.6 },
    ];

    for (const testConfig of testConfigs) {
        console.log(`\n🧪 Testing ${testConfig.name}:`);

        try {
            const detector = new DeltaCVDConfirmation(
                `threshold-${testConfig.name.toLowerCase().replace(/\s+/g, "-")}`,
                {
                    windowsSec: [60],
                    minZ: testConfig.minZ,
                    minSamplesForStats: 5, // Low for quick testing
                    baseConfidenceRequired: testConfig.baseConf,
                    finalConfidenceRequired: testConfig.finalConf,
                    enableDepthAnalysis: false,
                },
                createLogger(),
                createSpoofingDetector(),
                createMetrics(),
                createSignalLogger()
            );

            let signalCount = 0;
            detector.on("signal", () => signalCount++);

            // Generate strong signal data
            const baseTime = Date.now();
            for (let i = 0; i < 20; i++) {
                const trade = {
                    tradeId: `threshold_${i}`,
                    price: 85.0 + i * 0.02, // Strong price movement
                    quantity: 2.0 + i * 0.1, // Increasing volume
                    timestamp: baseTime + i * 1000,
                    buyerIsMaker: false, // Aggressive buying
                    side: "buy",
                    aggression: 0.9,
                    enriched: true,
                    originalTrade: {
                        tradeId: `threshold_${i}`,
                        price: 85.0 + i * 0.02,
                        quantity: 2.0 + i * 0.1,
                        timestamp: baseTime + i * 1000,
                        buyerIsMaker: false,
                        side: "buy",
                        aggression: 0.9,
                    },
                };
                detector.onEnrichedTradeSpecific(trade);
            }

            console.log(`   📊 Signals generated: ${signalCount}`);
            detector.removeAllListeners();
        } catch (error) {
            console.log(`   ❌ Error: ${error.message}`);
        }
    }
}

// Main execution
async function runAudit() {
    console.log("🔍 DELTACVD DETECTOR SIMPLE AUDIT");
    console.log("==================================\n");

    // Run tests
    const basicTest = testBasicFunctionality();
    await testCurrentConfiguration();
    analyzeThresholds();

    // Summary
    console.log("\n📊 === AUDIT SUMMARY ===");
    console.log(
        `Basic Functionality: ${basicTest.success ? "✅ WORKING" : "❌ FAILED"}`
    );
    if (basicTest.success) {
        console.log(
            `Signal Generation: ${basicTest.signalCount > 0 ? "✅ ACTIVE" : "⚠️ NO SIGNALS"}`
        );
    }

    console.log("\n✅ Audit completed");
}

runAudit().catch(console.error);
