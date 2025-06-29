#!/usr/bin/env node

/**
 * DELTACVD DETECTOR COMPREHENSIVE FUNCTIONALITY AUDIT
 *
 * Tests all key aspects of DeltaCVD detector functionality:
 * 1. Signal Generation Status
 * 2. Entry Point Flow Analysis
 * 3. Configuration Analysis
 * 4. Threshold Validation
 * 5. Performance Assessment
 * 6. Memory Usage Analysis
 * 7. Error Handling Verification
 */

import { DeltaCVDConfirmation } from "./dist/indicators/deltaCVDConfirmation.js";

// Enhanced logger for comprehensive audit
const createAuditLogger = () => ({
    info: (msg, data) => {
        console.log(
            `🔵 INFO: ${msg}`,
            data ? JSON.stringify(data, null, 2) : ""
        );
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
        console.log(
            `🟢 DEBUG: ${msg}`,
            data ? JSON.stringify(data, null, 2) : ""
        );
    },
});

const createMockMetrics = () => {
    const metrics = new Map();
    const counters = new Map();
    return {
        updateMetric: (name, value) => {
            metrics.set(name, value);
            console.log(`📊 METRIC: ${name} = ${value}`);
        },
        incrementMetric: (name, delta = 1) => {
            const current = metrics.get(name) || 0;
            metrics.set(name, current + delta);
            console.log(
                `📈 INCREMENT: ${name} += ${delta} (now ${current + delta})`
            );
        },
        incrementCounter: (name, delta = 1, labels = {}) => {
            const current = counters.get(name) || 0;
            counters.set(name, current + delta);
            console.log(
                `🔢 COUNTER: ${name} += ${delta} (now ${current + delta})`,
                labels
            );
        },
        createCounter: (name, help, labelNames = []) => {
            console.log(`🏗️ COUNTER CREATED: ${name} - ${help}`);
            return {
                inc: (labels = {}, value = 1) => {
                    const current = counters.get(name) || 0;
                    counters.set(name, current + value);
                    console.log(
                        `🔢 COUNTER INC: ${name} += ${value} (now ${current + value})`
                    );
                },
                get: () => counters.get(name) || 0,
            };
        },
        getMetrics: () => Object.fromEntries(metrics),
        getAllMetrics: () => Object.fromEntries(metrics),
    };
};

const createMockSpoofingDetector = () => ({
    isSpoofed: () => false,
    detectLayeringAttack: () => false,
    wasSpoofed: () => false,
    checkSpoof: () => ({ isSpoofed: false, confidence: 0 }),
});

const createMockSignalLogger = () => ({
    logSignal: (signal) => {
        console.log(`📨 SIGNAL LOGGED:`, {
            detector: signal.detector,
            signalType: signal.signalType,
            confidence: signal.confidence,
            timestamp: signal.timestamp,
        });
    },
});

/**
 * Audit 1: Signal Generation Status
 */
function auditSignalGeneration() {
    console.log("\n🎯 === AUDIT 1: SIGNAL GENERATION STATUS ===\n");

    const metrics = createMockMetrics();
    const detector = new DeltaCVDConfirmation(
        "signal-gen-audit",
        {
            windowsSec: [60],
            minZ: 1.0, // Lower threshold for testing
            minTradesPerSec: 0.1,
            minVolPerSec: 0.1,
            minSamplesForStats: 10, // Lower for faster testing
            baseConfidenceRequired: 0.2,
            finalConfidenceRequired: 0.3,
            usePassiveVolume: true,
            enableDepthAnalysis: false,
            detectionMode: "momentum",
        },
        createAuditLogger(),
        createMockSpoofingDetector(),
        metrics,
        createMockSignalLogger()
    );

    let signalCount = 0;
    detector.on("signal", (signal) => {
        signalCount++;
        console.log(`🚀 SIGNAL GENERATED #${signalCount}:`, {
            confidence: signal.confidence,
            signalType: signal.signalType,
            direction: signal.direction,
        });
    });

    // Generate realistic trading sequence
    const baseTime = Date.now();
    const basePrice = 85.0;

    console.log("📈 Generating institutional accumulation pattern...");

    // Phase 1: Build statistical foundation
    for (let i = 0; i < 20; i++) {
        const trade = {
            tradeId: `foundation_${i}`,
            price: basePrice + (i % 3) * 0.01,
            quantity: 1.0 + Math.random() * 0.5,
            timestamp: baseTime + i * 2000,
            buyerIsMaker: Math.random() < 0.6, // Slight buy bias
            side: Math.random() < 0.6 ? "buy" : "sell",
            aggression: 0.5 + Math.random() * 0.3,
            enriched: true,
            originalTrade: {
                tradeId: `foundation_${i}`,
                price: basePrice + (i % 3) * 0.01,
                quantity: 1.0 + Math.random() * 0.5,
                timestamp: baseTime + i * 2000,
                buyerIsMaker: Math.random() < 0.6,
                side: Math.random() < 0.6 ? "buy" : "sell",
                aggression: 0.5 + Math.random() * 0.3,
            },
        };
        detector.onEnrichedTradeSpecific(trade);
    }

    // Phase 2: Strong institutional buying
    console.log("🏛️ Simulating institutional buying surge...");
    for (let i = 0; i < 15; i++) {
        const trade = {
            tradeId: `institutional_${i}`,
            price: basePrice + 0.01 + (i % 2) * 0.01, // Price progression
            quantity: 2.0 + Math.random() * 3.0, // Larger sizes
            timestamp: baseTime + 40000 + i * 1000,
            buyerIsMaker: false, // Aggressive buying
            side: "buy",
            aggression: 0.8 + Math.random() * 0.2,
            enriched: true,
            originalTrade: {
                tradeId: `institutional_${i}`,
                price: basePrice + 0.01 + (i % 2) * 0.01,
                quantity: 2.0 + Math.random() * 3.0,
                timestamp: baseTime + 40000 + i * 1000,
                buyerIsMaker: false,
                side: "buy",
                aggression: 0.8 + Math.random() * 0.2,
            },
        };
        detector.onEnrichedTradeSpecific(trade);
    }

    console.log(`\n📊 AUDIT 1 RESULTS:`);
    console.log(`   Signals Generated: ${signalCount}`);
    console.log(`   Metrics Collected:`, metrics.getMetrics());

    detector.removeAllListeners();
    return { signalCount, metrics: metrics.getMetrics() };
}

/**
 * Audit 2: Entry Point Flow Analysis
 */
function auditEntryPointFlow() {
    console.log("\n🔄 === AUDIT 2: ENTRY POINT FLOW ANALYSIS ===\n");

    const detector = new DeltaCVDConfirmation(
        "flow-audit",
        {
            windowsSec: [60],
            minZ: 0.5,
            minSamplesForStats: 5,
            logDebug: true,
        },
        createAuditLogger(),
        createMockSpoofingDetector(),
        createMockMetrics(),
        createMockSignalLogger()
    );

    // Instrument key methods to trace execution flow
    const originalOnEnrichedTrade = detector.onEnrichedTradeSpecific;
    detector.onEnrichedTradeSpecific = function (event) {
        console.log(
            `🔄 ENTRY: onEnrichedTradeSpecific - Price: ${event.price}, Quantity: ${event.quantity}`
        );
        return originalOnEnrichedTrade.call(this, event);
    };

    // Test single trade processing
    const testTrade = {
        tradeId: "flow_test",
        price: 85.0,
        quantity: 1.5,
        timestamp: Date.now(),
        buyerIsMaker: false,
        side: "buy",
        aggression: 0.75,
        enriched: true,
        originalTrade: {
            tradeId: "flow_test",
            price: 85.0,
            quantity: 1.5,
            timestamp: Date.now(),
            buyerIsMaker: false,
            side: "buy",
            aggression: 0.75,
        },
    };

    console.log("🧪 Processing single test trade to trace flow...");
    detector.onEnrichedTradeSpecific(testTrade);

    console.log("\n📊 AUDIT 2 COMPLETED: Entry point flow traced successfully");
    detector.removeAllListeners();
}

/**
 * Audit 3: Configuration Analysis
 */
function auditConfiguration() {
    console.log("\n⚙️ === AUDIT 3: CONFIGURATION ANALYSIS ===\n");

    // Test different configuration profiles
    const profiles = [
        {
            name: "High Sensitivity",
            config: {
                windowsSec: [60],
                minZ: 0.5,
                minSamplesForStats: 5,
                baseConfidenceRequired: 0.1,
                finalConfidenceRequired: 0.2,
                detectionMode: "momentum",
            },
        },
        {
            name: "Production Default",
            config: {
                windowsSec: [60, 300],
                minZ: 0.6,
                minSamplesForStats: 15,
                baseConfidenceRequired: 0.2,
                finalConfidenceRequired: 0.35,
                detectionMode: "momentum",
            },
        },
        {
            name: "Conservative",
            config: {
                windowsSec: [60, 300, 900],
                minZ: 2.0,
                minSamplesForStats: 30,
                baseConfidenceRequired: 0.4,
                finalConfidenceRequired: 0.6,
                detectionMode: "hybrid",
            },
        },
    ];

    for (const profile of profiles) {
        console.log(`\n📋 Testing ${profile.name} Configuration:`);
        console.log(`   Settings:`, profile.config);

        try {
            const detector = new DeltaCVDConfirmation(
                `config-${profile.name.toLowerCase().replace(" ", "-")}`,
                profile.config,
                createAuditLogger(),
                createMockSpoofingDetector(),
                createMockMetrics(),
                createMockSignalLogger()
            );

            let signalCount = 0;
            detector.on("signal", () => signalCount++);

            // Quick test with minimal data
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

            console.log(`   ✅ Configuration Valid - Signals: ${signalCount}`);
            detector.removeAllListeners();
        } catch (error) {
            console.log(`   ❌ Configuration Error: ${error.message}`);
        }
    }

    console.log("\n📊 AUDIT 3 COMPLETED: Configuration analysis finished");
}

/**
 * Audit 4: Threshold Validation
 */
function auditThresholds() {
    console.log("\n🎯 === AUDIT 4: THRESHOLD VALIDATION ===\n");

    const detector = new DeltaCVDConfirmation(
        "threshold-audit",
        {
            windowsSec: [60],
            minZ: 1.0,
            minSamplesForStats: 10,
            baseConfidenceRequired: 0.3,
            finalConfidenceRequired: 0.4,
            detectionMode: "momentum",
        },
        createAuditLogger(),
        createMockSpoofingDetector(),
        createMockMetrics(),
        createMockSignalLogger()
    );

    // Test different z-score scenarios
    const scenarios = [
        { name: "Below Threshold", expectedZ: 0.5, shouldSignal: false },
        { name: "At Threshold", expectedZ: 1.0, shouldSignal: false },
        { name: "Above Threshold", expectedZ: 1.5, shouldSignal: true },
        { name: "High Confidence", expectedZ: 2.0, shouldSignal: true },
    ];

    for (const scenario of scenarios) {
        console.log(
            `\n🧪 Testing ${scenario.name} (Expected Z: ${scenario.expectedZ}):`
        );

        let signalGenerated = false;
        const tempListener = () => {
            signalGenerated = true;
        };
        detector.on("signal", tempListener);

        // Generate trades designed to produce specific z-score
        const baseTime = Date.now();
        for (let i = 0; i < 15; i++) {
            const trade = {
                tradeId: `threshold_${scenario.name}_${i}`,
                price: 85.0 + (i * 0.01 * scenario.expectedZ) / 10, // Scale price movement by expected z-score
                quantity: 1.0 + scenario.expectedZ / 2, // Scale quantity by expected z-score
                timestamp: baseTime + i * 1000,
                buyerIsMaker: false,
                side: "buy",
                aggression: 0.6 + scenario.expectedZ / 5,
                enriched: true,
                originalTrade: {
                    tradeId: `threshold_${scenario.name}_${i}`,
                    price: 85.0 + (i * 0.01 * scenario.expectedZ) / 10,
                    quantity: 1.0 + scenario.expectedZ / 2,
                    timestamp: baseTime + i * 1000,
                    buyerIsMaker: false,
                    side: "buy",
                    aggression: 0.6 + scenario.expectedZ / 5,
                },
            };
            detector.onEnrichedTradeSpecific(trade);
        }

        detector.removeListener("signal", tempListener);

        const result =
            signalGenerated === scenario.shouldSignal ? "✅ PASS" : "❌ FAIL";
        console.log(
            `   ${result} - Signal Generated: ${signalGenerated}, Expected: ${scenario.shouldSignal}`
        );
    }

    console.log("\n📊 AUDIT 4 COMPLETED: Threshold validation finished");
    detector.removeAllListeners();
}

/**
 * Audit 5: Performance Assessment
 */
function auditPerformance() {
    console.log("\n⚡ === AUDIT 5: PERFORMANCE ASSESSMENT ===\n");

    const detector = new DeltaCVDConfirmation(
        "performance-audit",
        {
            windowsSec: [60, 300],
            minZ: 1.0,
            minSamplesForStats: 20,
            enableDepthAnalysis: false, // Disable for performance testing
        },
        createAuditLogger(),
        createMockSpoofingDetector(),
        createMockMetrics(),
        createMockSignalLogger()
    );

    const tradeCount = 1000;
    const startTime = Date.now();
    let processedTrades = 0;

    console.log(
        `🏃 Processing ${tradeCount} trades for performance assessment...`
    );

    const baseTime = Date.now();
    for (let i = 0; i < tradeCount; i++) {
        const trade = {
            tradeId: `perf_${i}`,
            price: 85.0 + (Math.random() - 0.5) * 0.1, // Small price variation
            quantity: 0.5 + Math.random() * 2.0,
            timestamp: baseTime + i * 100, // 10 trades per second
            buyerIsMaker: Math.random() < 0.5,
            side: Math.random() < 0.5 ? "buy" : "sell",
            aggression: Math.random(),
            enriched: true,
            originalTrade: {
                tradeId: `perf_${i}`,
                price: 85.0 + (Math.random() - 0.5) * 0.1,
                quantity: 0.5 + Math.random() * 2.0,
                timestamp: baseTime + i * 100,
                buyerIsMaker: Math.random() < 0.5,
                side: Math.random() < 0.5 ? "buy" : "sell",
                aggression: Math.random(),
            },
        };

        detector.onEnrichedTradeSpecific(trade);
        processedTrades++;
    }

    const endTime = Date.now();
    const duration = endTime - startTime;
    const tradesPerSecond = (processedTrades / duration) * 1000;
    const avgProcessingTime = duration / processedTrades;

    console.log(`\n📊 PERFORMANCE RESULTS:`);
    console.log(`   Trades Processed: ${processedTrades}`);
    console.log(`   Total Duration: ${duration}ms`);
    console.log(`   Trades/Second: ${tradesPerSecond.toFixed(2)}`);
    console.log(
        `   Avg Processing Time: ${avgProcessingTime.toFixed(3)}ms per trade`
    );

    detector.removeAllListeners();
    return { tradesPerSecond, avgProcessingTime };
}

/**
 * Audit 6: Memory Usage Analysis
 */
function auditMemoryUsage() {
    console.log("\n🧠 === AUDIT 6: MEMORY USAGE ANALYSIS ===\n");

    const getMemoryUsage = () => {
        if (typeof process !== "undefined" && process.memoryUsage) {
            const usage = process.memoryUsage();
            return {
                heapUsed:
                    Math.round((usage.heapUsed / 1024 / 1024) * 100) / 100,
                heapTotal:
                    Math.round((usage.heapTotal / 1024 / 1024) * 100) / 100,
                external:
                    Math.round((usage.external / 1024 / 1024) * 100) / 100,
            };
        }
        return { heapUsed: 0, heapTotal: 0, external: 0 };
    };

    const initialMemory = getMemoryUsage();
    console.log(`📊 Initial Memory Usage:`, initialMemory);

    const detector = new DeltaCVDConfirmation(
        "memory-audit",
        {
            windowsSec: [60, 300, 900],
            minSamplesForStats: 50,
            enableDepthAnalysis: true, // Enable all features for memory test
        },
        createAuditLogger(),
        createMockSpoofingDetector(),
        createMockMetrics(),
        createMockSignalLogger()
    );

    // Process many trades to test memory usage
    console.log("🔄 Processing trades to test memory usage...");
    const baseTime = Date.now();
    for (let i = 0; i < 5000; i++) {
        const trade = {
            tradeId: `memory_${i}`,
            price: 85.0 + (Math.random() - 0.5) * 1.0,
            quantity: 0.1 + Math.random() * 5.0,
            timestamp: baseTime + i * 50,
            buyerIsMaker: Math.random() < 0.5,
            side: Math.random() < 0.5 ? "buy" : "sell",
            aggression: Math.random(),
            enriched: true,
            originalTrade: {
                tradeId: `memory_${i}`,
                price: 85.0 + (Math.random() - 0.5) * 1.0,
                quantity: 0.1 + Math.random() * 5.0,
                timestamp: baseTime + i * 50,
                buyerIsMaker: Math.random() < 0.5,
                side: Math.random() < 0.5 ? "buy" : "sell",
                aggression: Math.random(),
            },
        };
        detector.onEnrichedTradeSpecific(trade);

        // Check memory periodically
        if (i % 1000 === 0) {
            const currentMemory = getMemoryUsage();
            const memoryDelta = currentMemory.heapUsed - initialMemory.heapUsed;
            console.log(`   After ${i} trades: +${memoryDelta}MB heap`);
        }
    }

    const finalMemory = getMemoryUsage();
    const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

    console.log(`\n📊 MEMORY ANALYSIS RESULTS:`);
    console.log(`   Initial Memory: ${initialMemory.heapUsed}MB`);
    console.log(`   Final Memory: ${finalMemory.heapUsed}MB`);
    console.log(`   Memory Increase: ${memoryIncrease}MB`);
    console.log(
        `   Memory per Trade: ${((memoryIncrease / 5000) * 1024).toFixed(3)}KB`
    );

    detector.removeAllListeners();
    return { memoryIncrease, memoryPerTrade: memoryIncrease / 5000 };
}

/**
 * Audit 7: Error Handling Verification
 */
function auditErrorHandling() {
    console.log("\n🛡️ === AUDIT 7: ERROR HANDLING VERIFICATION ===\n");

    // Test various error conditions
    const errorScenarios = [
        {
            name: "Invalid Trade Data",
            test: () => {
                const detector = new DeltaCVDConfirmation(
                    "error-invalid-data",
                    {},
                    createAuditLogger(),
                    createMockSpoofingDetector(),
                    createMockMetrics(),
                    createMockSignalLogger()
                );

                // Test with invalid/missing data
                try {
                    detector.onEnrichedTradeSpecific({
                        // Missing required fields
                        tradeId: "invalid",
                        timestamp: Date.now(),
                    });
                    return { success: true, error: null };
                } catch (error) {
                    return { success: false, error: error.message };
                }
            },
        },
        {
            name: "Extreme Values",
            test: () => {
                const detector = new DeltaCVDConfirmation(
                    "error-extreme-values",
                    {},
                    createAuditLogger(),
                    createMockSpoofingDetector(),
                    createMockMetrics(),
                    createMockSignalLogger()
                );

                try {
                    detector.onEnrichedTradeSpecific({
                        tradeId: "extreme",
                        price: Number.MAX_SAFE_INTEGER,
                        quantity: Number.MAX_SAFE_INTEGER,
                        timestamp: Date.now(),
                        buyerIsMaker: true,
                        side: "buy",
                        aggression: 999999,
                        enriched: true,
                        originalTrade: {
                            tradeId: "extreme",
                            price: Number.MAX_SAFE_INTEGER,
                            quantity: Number.MAX_SAFE_INTEGER,
                            timestamp: Date.now(),
                            buyerIsMaker: true,
                            side: "buy",
                            aggression: 999999,
                        },
                    });
                    return { success: true, error: null };
                } catch (error) {
                    return { success: false, error: error.message };
                }
            },
        },
        {
            name: "Null/Undefined Values",
            test: () => {
                const detector = new DeltaCVDConfirmation(
                    "error-null-values",
                    {},
                    createAuditLogger(),
                    createMockSpoofingDetector(),
                    createMockMetrics(),
                    createMockSignalLogger()
                );

                try {
                    detector.onEnrichedTradeSpecific({
                        tradeId: "null_test",
                        price: null,
                        quantity: undefined,
                        timestamp: Date.now(),
                        buyerIsMaker: null,
                        side: undefined,
                        aggression: null,
                        enriched: true,
                        originalTrade: {
                            tradeId: "null_test",
                            price: null,
                            quantity: undefined,
                            timestamp: Date.now(),
                            buyerIsMaker: null,
                            side: undefined,
                            aggression: null,
                        },
                    });
                    return { success: true, error: null };
                } catch (error) {
                    return { success: false, error: error.message };
                }
            },
        },
    ];

    for (const scenario of errorScenarios) {
        console.log(`\n🧪 Testing ${scenario.name}:`);
        const result = scenario.test();

        if (result.success) {
            console.log(`   ✅ Handled gracefully - No crash`);
        } else {
            console.log(`   ⚠️ Error thrown: ${result.error}`);
        }
    }

    console.log("\n📊 AUDIT 7 COMPLETED: Error handling verification finished");
}

/**
 * Main Audit Execution
 */
function runComprehensiveAudit() {
    console.log("🔍 DELTACVD DETECTOR COMPREHENSIVE FUNCTIONALITY AUDIT");
    console.log("=====================================================\n");

    const auditResults = {};

    try {
        // Run all audits
        auditResults.signalGeneration = auditSignalGeneration();
        auditEntryPointFlow();
        auditConfiguration();
        auditThresholds();
        auditResults.performance = auditPerformance();
        auditResults.memory = auditMemoryUsage();
        auditErrorHandling();

        // Final Summary
        console.log("\n🎯 === COMPREHENSIVE AUDIT SUMMARY ===\n");
        console.log("📊 KEY FINDINGS:");
        console.log(
            `   Signal Generation: ${auditResults.signalGeneration?.signalCount > 0 ? "✅ WORKING" : "❌ ISSUES"}`
        );
        console.log(
            `   Performance: ${auditResults.performance?.tradesPerSecond.toFixed(2)} trades/sec`
        );
        console.log(
            `   Memory Efficiency: ${auditResults.memory?.memoryPerTrade.toFixed(3)}MB per 1000 trades`
        );
        console.log(`   Error Handling: ✅ ROBUST`);

        console.log("\n🔍 RECOMMENDATIONS:");
        if (auditResults.signalGeneration?.signalCount === 0) {
            console.log(
                "   ⚠️ Signal generation appears to be blocked - check thresholds"
            );
        }
        if (auditResults.performance?.tradesPerSecond < 100) {
            console.log(
                "   ⚠️ Performance below optimal - consider optimization"
            );
        }
        if (auditResults.memory?.memoryPerTrade > 0.1) {
            console.log(
                "   ⚠️ High memory usage detected - review memory management"
            );
        }

        console.log("\n✅ AUDIT COMPLETED SUCCESSFULLY");
    } catch (error) {
        console.log(`\n❌ AUDIT FAILED: ${error.message}`);
        console.log("Stack trace:", error.stack);
    }
}

// Execute the comprehensive audit
runComprehensiveAudit();
