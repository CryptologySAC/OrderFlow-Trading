#!/usr/bin/env node

/**
 * CONDITIONS ANALYSIS DEBUG SCRIPT
 *
 * Debug the analyzeExhaustionConditionsSafe method that's likely blocking signal generation
 */

import { ExhaustionDetector } from "./dist/indicators/exhaustionDetector.js";

const createLogger = () => ({
    info: (msg, data) => {
        if (
            msg.includes("ATTEMPTING SIGNAL") ||
            msg.includes("Circuit breaker") ||
            msg.includes("Invalid")
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
            msg.includes("Score below") ||
            msg.includes("Low aggressive") ||
            msg.includes("Volume surge")
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

function debugConditionsAnalysis() {
    console.log("🔍 === CONDITIONS ANALYSIS DEBUG ===\n");

    const detector = new ExhaustionDetector(
        "conditions-debug",
        {
            exhaustionThreshold: 0.1, // Very low
            maxPassiveRatio: 0.8,
            minDepletionFactor: 0.1,
            windowMs: 30000,
            minAggVolume: 5, // Very low
            features: {
                depletionTracking: true,
                spreadAdjustment: true,
                volumeVelocity: true,
                adaptiveZone: true,
                passiveHistory: true,
            },
        },
        createLogger(),
        createMockSpoofingDetector(),
        createMockMetrics()
    );

    // Instrument analyzeExhaustionConditionsSafe to see what's happening
    const originalAnalyzeConditions = detector.analyzeExhaustionConditionsSafe;
    if (originalAnalyzeConditions) {
        detector.analyzeExhaustionConditionsSafe = function (
            price,
            side,
            zone
        ) {
            console.log(`\n🧪 analyzeExhaustionConditionsSafe called:`, {
                price: price,
                side: side,
                zone: zone,
            });

            // Check circuit breaker state
            console.log(`   Circuit breaker state:`, {
                isOpen: this.circuitBreakerState?.isOpen || false,
                errorCount: this.circuitBreakerState?.errorCount || 0,
            });

            const result = originalAnalyzeConditions.call(
                this,
                price,
                side,
                zone
            );

            console.log(`   analyzeExhaustionConditionsSafe result:`, {
                success: result.success,
                error: result.success ? null : result.error?.message,
                fallbackSafe: result.success ? null : result.fallbackSafe,
            });

            if (result.success) {
                const data = result.data;
                console.log(`   Conditions data:`, {
                    aggressiveVolume: data.aggressiveVolume,
                    currentPassive: data.currentPassive,
                    avgPassive: data.avgPassive,
                    passiveRatio: data.passiveRatio,
                    depletionRatio: data.depletionRatio,
                    confidence: data.confidence,
                    dataQuality: data.dataQuality,
                    sampleCount: data.sampleCount,
                    isValid: data.isValid,
                });
            }

            return result;
        };
    }

    // Instrument calculateExhaustionScore to see if it's being called
    const originalCalculateScore = detector.calculateExhaustionScore;
    if (originalCalculateScore) {
        detector.calculateExhaustionScore = function (conditions) {
            console.log(
                `\n📊 calculateExhaustionScore called with conditions:`,
                {
                    depletionRatio: conditions.depletionRatio,
                    passiveRatio: conditions.passiveRatio,
                    confidence: conditions.confidence,
                    dataQuality: conditions.dataQuality,
                }
            );

            const score = originalCalculateScore.call(this, conditions);

            console.log(`   Score result: ${score}`);

            return score;
        };
    }

    // Also instrument the key method that should call the score calculation
    const originalAnalyzeZone = detector.analyzeZoneForExhaustion;
    if (originalAnalyzeZone) {
        detector.analyzeZoneForExhaustion = function (
            zone,
            tradesAtZone,
            triggerTrade,
            zoneTicks
        ) {
            console.log(`\n🎯 analyzeZoneForExhaustion ENTRY:`, {
                zone: zone,
                tradesCount: tradesAtZone.length,
                triggerPrice: triggerTrade.price,
            });

            try {
                const result = originalAnalyzeZone.call(
                    this,
                    zone,
                    tradesAtZone,
                    triggerTrade,
                    zoneTicks
                );
                console.log(`   analyzeZoneForExhaustion completed normally`);
                return result;
            } catch (error) {
                console.log(
                    `   ❌ analyzeZoneForExhaustion threw error:`,
                    error.message
                );
                throw error;
            }
        };
    }

    // Create a realistic exhaustion scenario
    console.log("\n📈 Creating exhaustion scenario...");

    const timestamp = Date.now();

    // Build up some history first
    for (let i = 0; i < 8; i++) {
        const price = 89.0 - i * 0.01;
        const aggressiveVolume = 30 + i * 10;
        const bidVolume = Math.max(20, 120 - i * 15); // Progressive depletion
        const askVolume = 110;

        const trade = {
            tradeId: `debug_${i}`,
            price: price,
            quantity: aggressiveVolume,
            timestamp: timestamp + i * 2000,
            buyerIsMaker: true,
            side: "sell",
            aggression: 0.8 + i * 0.01,
            enriched: true,
            zonePassiveBidVolume: bidVolume,
            zonePassiveAskVolume: askVolume,
            originalTrade: {
                tradeId: `debug_${i}`,
                price: price,
                quantity: aggressiveVolume,
                timestamp: timestamp + i * 2000,
                buyerIsMaker: true,
                side: "sell",
                aggression: 0.8 + i * 0.01,
            },
        };

        console.log(`\n🔄 Processing trade ${i + 1}:`, {
            price: price.toFixed(2),
            aggressive: aggressiveVolume,
            bidVolume: bidVolume,
            askVolume: askVolume,
            depletion: `${Math.round(((120 - bidVolume) / 120) * 100)}%`,
        });

        detector.onEnrichedTrade(trade);
    }

    console.log("\n📊 === ANALYSIS COMPLETE ===");
    console.log("Review the detailed trace above to see where the flow stops.");

    detector.cleanup();
}

// Run the debug
console.log("🔍 CONDITIONS ANALYSIS FAILURE DEBUG");
console.log("===================================\n");

debugConditionsAnalysis();
