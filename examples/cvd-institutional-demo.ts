#!/usr/bin/env ts-node

/**
 * CVD Confirmation Institutional Activity Demo
 *
 * This script demonstrates the enhanced CVD Confirmation detector with
 * institutional activity tracking capabilities.
 */

import { DeltaCVDConfirmation } from "../src/indicators/deltaCVDConfirmation.js";
import { Logger } from "../src/infrastructure/logger.js";
import { MetricsCollector } from "../src/infrastructure/metricsCollector.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { DeltaCVDConfirmationResult } from "../src/types/signalTypes.js";

// Mock dependencies
const logger = new Logger();
const metricsCollector = new MetricsCollector();
const spoofingDetector = new SpoofingDetector({}, logger, metricsCollector);

// Enhanced CVD detector with institutional tracking
const cvdDetector = new DeltaCVDConfirmation(
    "demo-cvd",
    (signal: DeltaCVDConfirmationResult) => {
        console.log("\n🎯 CVD CONFIRMATION SIGNAL DETECTED");
        console.log("═══════════════════════════════════════");
        console.log(`Price: $${signal.price.toFixed(2)}`);
        console.log(`Side: ${signal.side.toUpperCase()}`);
        console.log(`Confidence: ${(signal.confidence * 100).toFixed(1)}%`);
        console.log(
            `Rate of Change: ${signal.rateOfChange.toFixed(2)} qty/sec`
        );

        if (signal.metadata?.institutionalZones) {
            console.log("\n📊 INSTITUTIONAL ACTIVITY ANALYSIS");
            console.log("─────────────────────────────────────");
            console.log(
                `Dominant Side: ${signal.metadata.dominantInstitutionalSide?.toUpperCase() || "NEUTRAL"}`
            );
            console.log(
                `CVD-Weighted Price: $${signal.metadata.cvdWeightedPrice?.toFixed(2) || "N/A"}`
            );
            console.log(
                `Flow Strength: ${((signal.metadata.institutionalFlowStrength || 0) * 100).toFixed(1)}%`
            );

            const activeZones =
                signal.metadata.institutionalZones?.filter((z) => z.isActive) ||
                [];
            if (activeZones.length > 0) {
                console.log(
                    `\n🏛️  Active Institutional Zones (${activeZones.length}):`
                );
                activeZones.slice(0, 3).forEach((zone, i) => {
                    console.log(
                        `  ${i + 1}. $${zone.priceLevel.toFixed(2)} - ` +
                            `CVD: ${zone.netCVD.toFixed(0)}, ` +
                            `Strength: ${(zone.strength * 100).toFixed(1)}%`
                    );
                });
            }
        }

        console.log(`\n📈 CVD Analysis:`);
        Object.entries(signal.zScores).forEach(([window, zScore]) => {
            console.log(`  ${window}s window: z-score ${zScore.toFixed(2)}`);
        });

        console.log("═══════════════════════════════════════\n");
    },
    {
        windowsSec: [60, 300, 900], // 1min, 5min, 15min
        minZ: 2.5,
        minTradesPerSec: 0.3,
        minVolPerSec: 100,
        priceCorrelationWeight: 0.25,
        volumeConcentrationWeight: 0.15,
        adaptiveThresholdMultiplier: 1.2,
    },
    logger,
    spoofingDetector,
    metricsCollector
);

// Start the detector
cvdDetector.start();

console.log("🚀 CVD Confirmation Detector with Institutional Tracking Started");
console.log("================================================================");
console.log(
    "Simulating high-frequency trading data with institutional patterns...\n"
);

// Simulate realistic trading data with institutional activity patterns
function simulateInstitutionalTradingSession() {
    const basePrice = 50000; // $50,000 starting price
    let currentPrice = basePrice;
    let timestamp = Date.now();

    // Simulate 30 minutes of trading with institutional accumulation
    const sessionDuration = 30 * 60 * 1000; // 30 minutes
    const tradeInterval = 500; // Trade every 500ms

    let institutionalAccumulation = true; // Start with buy-side accumulation
    let accumulationZone = basePrice - 50; // Accumulation around $49,950

    const interval = setInterval(() => {
        // Generate 1-3 trades per interval
        const tradesCount = Math.floor(Math.random() * 3) + 1;

        for (let i = 0; i < tradesCount; i++) {
            // Create institutional pattern
            let price = currentPrice;
            let quantity = 0;
            let buyerIsMaker = false;

            if (Math.random() < 0.3) {
                // 30% chance of institutional activity
                // Institutional trade pattern
                if (institutionalAccumulation) {
                    // Smart money accumulating near support
                    price = accumulationZone + (Math.random() - 0.5) * 20;
                    quantity = 50 + Math.random() * 200; // Larger size
                    buyerIsMaker = false; // Buy aggression
                } else {
                    // Distribution pattern
                    price = currentPrice + (Math.random() - 0.3) * 30;
                    quantity = 30 + Math.random() * 150;
                    buyerIsMaker = true; // Sell aggression
                }
            } else {
                // Regular retail trading
                price = currentPrice + (Math.random() - 0.5) * 10;
                quantity = 1 + Math.random() * 20;
                buyerIsMaker = Math.random() < 0.5;
            }

            // Create enriched trade event
            const trade: EnrichedTradeEvent = {
                symbol: "BTCUSDT",
                price: Math.max(price, 1),
                quantity,
                timestamp: timestamp + i * 50,
                buyerIsMaker,
                tradeId: `trade_${timestamp}_${i}`,

                // Mock order book data
                zonePassiveBidVolume: 100 + Math.random() * 300,
                zonePassiveAskVolume: 100 + Math.random() * 300,

                // Mock enrichment data
                tradeSide: buyerIsMaker ? "sell" : "buy",
                aggressiveVolume: quantity,
                passiveVolume: 150 + Math.random() * 200,
                zone: Math.round(price / 10) * 10,
            };

            // Process the trade
            cvdDetector.onEnrichedTrade(trade);

            // Update current price
            currentPrice = price;
        }

        timestamp += tradeInterval;

        // Switch institutional behavior periodically
        if (Math.random() < 0.05) {
            // 5% chance per interval
            institutionalAccumulation = !institutionalAccumulation;
            accumulationZone = currentPrice + (Math.random() - 0.5) * 100;

            console.log(
                `🔄 Institutional behavior switch: ${
                    institutionalAccumulation ? "ACCUMULATION" : "DISTRIBUTION"
                } around $${accumulationZone.toFixed(2)}`
            );
        }

        // End simulation after session duration
        if (timestamp - Date.now() > sessionDuration) {
            clearInterval(interval);
            console.log(
                "\n✅ Simulation completed. Institutional activity patterns demonstrated."
            );
            console.log("\nKey Features Demonstrated:");
            console.log("• CVD-weighted price level tracking");
            console.log("• Institutional zone identification");
            console.log("• Buy/sell flow profiling by price level");
            console.log(
                "• Adaptive confidence scoring with institutional metrics"
            );
            console.log(
                "• Volume profile insights without separate system complexity"
            );

            // Show final detector state
            const state = cvdDetector.getDetailedState();
            console.log(
                `\n📊 Final State: ${state.states.length} windows tracked`
            );
            console.log(
                `Market Volatility: ${(state.marketRegime.volatility * 100).toFixed(3)}%`
            );
            console.log(
                `Adaptive Threshold: ${state.configuration.adaptiveThreshold.toFixed(2)}`
            );

            process.exit(0);
        }
    }, tradeInterval);
}

// Start the simulation
setTimeout(simulateInstitutionalTradingSession, 1000);
