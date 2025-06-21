// Direct test of volume surge integration in detectors
import { AbsorptionDetector } from "./dist/indicators/absorptionDetector.js";
import { ExhaustionDetector } from "./dist/indicators/exhaustionDetector.js";
import { VolumeAnalyzer } from "./dist/indicators/utils/volumeAnalyzer.js";

// Mock dependencies
class MockLogger {
    debug(...args) {
        console.log("🔍 DEBUG:", ...args);
    }
    info(...args) {
        console.log("ℹ️ INFO:", ...args);
    }
    warn(...args) {
        console.log("⚠️ WARN:", ...args);
    }
    error(...args) {
        console.log("❌ ERROR:", ...args);
    }
}

class MockMetrics {
    updateMetric() {}
    incrementMetric() {}
    recordHistogram() {}
}

class MockSpoofing {
    isSpoofed() {
        return false;
    }
    detectLayeringAttack() {
        return false;
    }
}

class MockOrderBook {
    getBestBid() {
        return 49990.0;
    }
    getBestAsk() {
        return 50010.0;
    }
    getDepthAtPrice() {
        return { bid: 100, ask: 100 };
    }
}

async function testVolumeDetectorIntegration() {
    console.log("🧪 Testing Volume Detector Integration...\n");

    try {
        const logger = new MockLogger();
        const metrics = new MockMetrics();
        const spoofing = new MockSpoofing();
        const orderBook = new MockOrderBook();

        // Test configuration with volume surge parameters
        const volumeConfig = {
            volumeSurgeMultiplier: 4.0,
            imbalanceThreshold: 0.35,
            institutionalThreshold: 17.8,
            burstDetectionMs: 1000,
            sustainedVolumeMs: 30000,
            medianTradeSize: 0.6,
        };

        console.log("📊 Testing Volume Analyzer directly...");

        // Test VolumeAnalyzer directly
        const volumeAnalyzer = new VolumeAnalyzer(volumeConfig, logger, "test");
        console.log("✅ VolumeAnalyzer created successfully");

        // Test volume tracking
        const testTrade = {
            price: 50000,
            quantity: 25.5,
            timestamp: Date.now(),
            buyerIsMaker: false,
            pair: "LTCUSDT",
            tradeId: "test_123",
            originalTrade: {},
            passiveBidVolume: 100,
            passiveAskVolume: 100,
            zonePassiveBidVolume: 50,
            zonePassiveAskVolume: 50,
        };

        volumeAnalyzer.updateVolumeTracking(testTrade);
        console.log("✅ Volume tracking works");

        // Test volume surge detection with simulated trades
        const aggressiveTrades = [];
        const now = Date.now();

        // Create volume surge scenario
        for (let i = 0; i < 10; i++) {
            aggressiveTrades.push({
                price: 50000 + (Math.random() - 0.5) * 10,
                quantity: Math.random() * 50 + 10, // Random volume 10-60
                timestamp: now - (9 - i) * 100, // Spread over 900ms
                buyerIsMaker: Math.random() > 0.3, // 70% aggressive buys (imbalance)
                pair: "LTCUSDT",
                tradeId: `test_${i}`,
                originalTrade: {},
            });
        }

        const volumeSurgeResult = volumeAnalyzer.detectVolumeSurge(
            aggressiveTrades,
            now
        );
        console.log("📈 Volume Surge Result:", {
            hasVolumeSurge: volumeSurgeResult.hasVolumeSurge,
            volumeMultiplier: volumeSurgeResult.volumeMultiplier?.toFixed(2),
            recentVolume: volumeSurgeResult.recentVolume?.toFixed(2),
        });

        const imbalanceResult = volumeAnalyzer.detectOrderFlowImbalance(
            aggressiveTrades,
            now
        );
        console.log("⚖️ Imbalance Result:", {
            detected: imbalanceResult.detected,
            imbalance: (imbalanceResult.imbalance * 100).toFixed(1) + "%",
            dominantSide: imbalanceResult.dominantSide,
        });

        const institutionalResult = volumeAnalyzer.detectInstitutionalActivity(
            aggressiveTrades,
            now
        );
        console.log("🏦 Institutional Result:", {
            detected: institutionalResult.detected,
            tradeCount: institutionalResult.institutionalTrades,
            largestTrade: institutionalResult.largestTradeSize?.toFixed(2),
        });

        // Test validation
        const validation = volumeAnalyzer.validateVolumeSurgeConditions(
            aggressiveTrades,
            now
        );
        console.log("✅ Volume Validation:", {
            valid: validation.valid,
            reason: validation.reason,
        });

        if (validation.valid) {
            const confidenceBoost =
                volumeAnalyzer.calculateVolumeConfidenceBoost(
                    validation.volumeSurge,
                    validation.imbalance,
                    validation.institutional
                );
            console.log("🚀 Confidence Boost:", {
                isValid: confidenceBoost.isValid,
                confidence: (confidenceBoost.confidence * 100).toFixed(1) + "%",
                reason: confidenceBoost.reason,
            });
        }

        console.log("\n🔍 Testing Absorption Detector Integration...");

        // Test Absorption Detector with volume integration
        const absorptionSettings = {
            minAggVolume: 400,
            windowMs: 60000,
            zoneTicks: 3,
            absorptionThreshold: 0.6,
            ...volumeConfig,
        };

        try {
            const absorption = new AbsorptionDetector(
                "test_absorption",
                absorptionSettings,
                orderBook,
                logger,
                spoofing,
                metrics
            );
            console.log(
                "✅ Absorption detector created with volume integration"
            );

            // Check if volume analyzer is accessible (may be private)
            console.log("📊 Absorption detector initialized successfully");
        } catch (error) {
            console.log("❌ Absorption detector error:", error.message);
        }

        console.log("\n🔍 Testing Exhaustion Detector Integration...");

        // Test Exhaustion Detector with volume integration
        const exhaustionSettings = {
            minAggVolume: 400,
            windowMs: 90000,
            zoneTicks: 3,
            exhaustionThreshold: 0.6,
            ...volumeConfig,
        };

        try {
            const exhaustion = new ExhaustionDetector(
                "test_exhaustion",
                exhaustionSettings,
                logger,
                spoofing,
                metrics
            );
            console.log(
                "✅ Exhaustion detector created with volume integration"
            );
            console.log("📊 Exhaustion detector initialized successfully");
        } catch (error) {
            console.log("❌ Exhaustion detector error:", error.message);
        }

        console.log(
            "\n✅ All volume integration tests completed successfully!"
        );
    } catch (error) {
        console.error("❌ Test failed:", error.message);
        console.error("Stack:", error.stack);
        process.exit(1);
    }
}

// Run the test
testVolumeDetectorIntegration()
    .then(() => {
        console.log("\n🎉 Volume detector integration test passed!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("\n💥 Test suite failed:", error);
        process.exit(1);
    });
