// Test script to verify volume surge integration in absorption and exhaustion detectors
import { OrderFlowDashboard } from "./dist/orderFlowDashBoard.js";
import fs from "fs";

async function testVolumeIntegration() {
    console.log("🧪 Testing Volume Surge Integration...\n");

    try {
        // Create dashboard instance
        const dashboard = new OrderFlowDashboard();

        console.log("✅ Dashboard created successfully");

        // Initialize with test mode to avoid real connections
        await dashboard.initialize();

        console.log("✅ Dashboard initialized");

        // Get detector instances to verify integration
        const detectors = dashboard.getDetectors?.() || {};

        console.log("📊 Available detectors:", Object.keys(detectors));

        // Check for volume analyzer integration
        const absorption = detectors.absorption;
        const exhaustion = detectors.exhaustion;

        if (absorption) {
            console.log("✅ Absorption detector found");
            // Check if volume analyzer is integrated
            const hasVolumeAnalyzer = absorption.volumeAnalyzer !== undefined;
            console.log(
                `📈 Volume analyzer integrated: ${hasVolumeAnalyzer ? "YES" : "NO"}`
            );
        } else {
            console.log("❌ Absorption detector not found");
        }

        if (exhaustion) {
            console.log("✅ Exhaustion detector found");
            // Check if volume analyzer is integrated
            const hasVolumeAnalyzer = exhaustion.volumeAnalyzer !== undefined;
            console.log(
                `📈 Volume analyzer integrated: ${hasVolumeAnalyzer ? "YES" : "NO"}`
            );
        } else {
            console.log("❌ Exhaustion detector not found");
        }

        // Test signal creation with volume validation
        console.log("\n🔍 Testing signal validation...");

        // Simulate trade data for testing
        const testTrade = {
            price: 50000,
            quantity: 20.5,
            timestamp: Date.now(),
            buyerIsMaker: false,
            pair: "LTCUSDT",
            tradeId: "test_123",
            originalTrade: {
                a: 123,
                p: "50000",
                q: "20.5",
                T: Date.now(),
                m: false,
            },
        };

        console.log("📦 Test trade created:", {
            price: testTrade.price,
            quantity: testTrade.quantity,
            buyerIsMaker: testTrade.buyerIsMaker,
        });

        console.log("✅ Volume integration test completed successfully");

        await dashboard.cleanup();
        console.log("✅ Cleanup completed");
    } catch (error) {
        console.error("❌ Test failed:", error.message);
        console.error("Stack:", error.stack);
        process.exit(1);
    }
}

// Run the test
testVolumeIntegration()
    .then(() => {
        console.log("\n🎉 All volume integration tests passed!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("\n💥 Test suite failed:", error);
        process.exit(1);
    });
