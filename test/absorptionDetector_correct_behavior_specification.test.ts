// test/absorptionDetector_correct_behavior_specification.test.ts
// 🎯 COMPREHENSIVE TEST SUITE: AbsorptionDetector CORRECT Behavior Specification
//
// This test suite validates what the AbsorptionDetector SHOULD do according to:
// - CLAUDE.md institutional trading requirements
// - BuyerIsMaker-field.md documentation  
// - Market microstructure theory
//
// ✅ CRITICAL: These tests validate CORRECT behavior, NOT current implementation
// ❌ NEVER adjust these tests to pass buggy code - they guide proper implementation

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AbsorptionDetector, type AbsorptionSettings } from "../src/indicators/absorptionDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";

// ✅ CLAUDE.md COMPLIANT: Use proper mocks from __mocks__/ directory
const createMockLogger = (): ILogger => ({
    info: vi.fn((msg, data) => {
        if (msg.includes("CORRECTED ABSORPTION SIGNAL")) {
            console.log(`[SIGNAL] ${msg}`, JSON.stringify(data, null, 2));
        }
    }),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
});

const createMockSpoofingDetector = (): SpoofingDetector =>
    ({
        isSpoofed: vi.fn(() => false),
        detectLayeringAttack: vi.fn(() => false),
    }) as unknown as SpoofingDetector;

/**
 * ✅ CORRECT: Create test event with precise buyerIsMaker control per BuyerIsMaker-field.md
 */
function createSpecificationTestEvent(
    price: number,
    quantity: number,
    timestamp: number,
    buyerIsMaker: boolean, // Direct control per documentation
    passiveBidVolume: number = 1000,
    passiveAskVolume: number = 1000,
    tradeId?: string
): EnrichedTradeEvent {
    return {
        tradeId: tradeId ?? `spec_${timestamp}_${Math.random()}`,
        price,
        quantity,
        timestamp,
        buyerIsMaker, // ✅ CORRECT: Direct control per BuyerIsMaker docs
        side: buyerIsMaker ? "sell" : "buy", // Derived correctly
        aggression: 0.8,
        enriched: true,
        zonePassiveBidVolume: passiveBidVolume,
        zonePassiveAskVolume: passiveAskVolume,
    };
}

/**
 * Test scenario specification with expected CORRECT behavior
 */
interface AbsorptionTestScenario {
    name: string;
    description: string;
    marketContext: "market_bottom" | "market_top" | "sideways" | "balanced";
    expectedSignal: "BUY" | "SELL" | null;
    expectedLogic: string;
    mathProof: string;
    trades: Array<{
        buyerIsMaker: boolean;
        quantity: number;
        timestampOffset: number;
        price?: number;
        passiveBidVol?: number;
        passiveAskVol?: number;
    }>;
}

describe("AbsorptionDetector - CORRECT Behavior Specification", () => {
    let detector: AbsorptionDetector;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockSpoofingDetector: SpoofingDetector;
    let mockOrderBook: any;

    // ✅ Settings that allow signal generation (from working mathematical tests)
    const specificationSettings: AbsorptionSettings = {
        windowMs: 60000,
        minAggVolume: 40,
        pricePrecision: 2,
        zoneTicks: 3,
        absorptionThreshold: 0.3,
        priceEfficiencyThreshold: 0.02,
        maxAbsorptionRatio: 0.7,
        strongAbsorptionRatio: 0.6,
        moderateAbsorptionRatio: 0.8,
        weakAbsorptionRatio: 1.0,
        spreadImpactThreshold: 0.003,
        velocityIncreaseThreshold: 1.5,
        features: {
            liquidityGradient: true,
            absorptionVelocity: false,
            layeredAbsorption: false,
            spreadImpact: true,
        },
    };

    beforeEach(async () => {
        mockLogger = createMockLogger();
        
        // ✅ CLAUDE.md COMPLIANT: Use proper mock from __mocks__/ directory
        const { MetricsCollector: MockMetricsCollector } = await import("../__mocks__/src/infrastructure/metricsCollector.js");
        mockMetrics = new MockMetricsCollector() as any;
        
        mockSpoofingDetector = createMockSpoofingDetector();
        
        mockOrderBook = {
            getBestBid: vi.fn().mockReturnValue(50000),
            getBestAsk: vi.fn().mockReturnValue(50001),
            getSpread: vi.fn().mockReturnValue({ spread: 1, spreadBps: 2 }),
            getDepth: vi.fn().mockReturnValue(new Map()),
            isHealthy: vi.fn().mockReturnValue(true),
            getLastUpdate: vi.fn().mockReturnValue(Date.now()),
        };

        detector = new AbsorptionDetector(
            "specification-test",
            specificationSettings,
            mockOrderBook,
            mockLogger,
            mockSpoofingDetector,
            mockMetrics
        );
    });

    describe("🚨 Phase 1: Market Extremes (Critical Bug Detection)", () => {
        
        const marketExtremeScenarios: AbsorptionTestScenario[] = [
            
            // 🔴 THE IMPOSSIBLE SCENARIO: Your SELL signal at market bottom
            {
                name: "Market Bottom Heavy Selling Pressure",
                description: "Heavy selling pressure at market bottom - institutions absorbing on bid side",
                marketContext: "market_bottom",
                expectedSignal: "BUY", // ✅ CORRECT: Institutions buying, should signal BUY
                expectedLogic: "Heavy selling pressure → bid side absorbing → institutions buying → BUY signal",
                mathProof: "90% buyerIsMaker=true → 90% sellVolume → dominantSide='sell' → absorbingSide='bid' → signal='BUY'",
                trades: [
                    // 9 aggressive sells: buyerIsMaker=true (sellers hitting bids)
                    { buyerIsMaker: true, quantity: 70, timestampOffset: 0 },
                    { buyerIsMaker: true, quantity: 75, timestampOffset: 3000 },
                    { buyerIsMaker: true, quantity: 80, timestampOffset: 6000 },
                    { buyerIsMaker: true, quantity: 85, timestampOffset: 9000 },
                    { buyerIsMaker: true, quantity: 90, timestampOffset: 12000 },
                    { buyerIsMaker: true, quantity: 95, timestampOffset: 15000 },
                    { buyerIsMaker: true, quantity: 100, timestampOffset: 18000 },
                    { buyerIsMaker: true, quantity: 105, timestampOffset: 21000 },
                    { buyerIsMaker: true, quantity: 110, timestampOffset: 24000 },
                    // 1 aggressive buy: buyerIsMaker=false (minimal buying pressure)
                    { buyerIsMaker: false, quantity: 50, timestampOffset: 27000 },
                ],
            },

            {
                name: "Market Top Heavy Buying Pressure", 
                description: "Heavy buying pressure at market top - institutions absorbing on ask side",
                marketContext: "market_top",
                expectedSignal: "SELL", // ✅ CORRECT: Institutions selling, should signal SELL
                expectedLogic: "Heavy buying pressure → ask side absorbing → institutions selling → SELL signal",
                mathProof: "90% buyerIsMaker=false → 90% buyVolume → dominantSide='buy' → absorbingSide='ask' → signal='SELL'",
                trades: [
                    // 9 aggressive buys: buyerIsMaker=false (buyers hitting asks)  
                    { buyerIsMaker: false, quantity: 65, timestampOffset: 0 },
                    { buyerIsMaker: false, quantity: 70, timestampOffset: 3000 },
                    { buyerIsMaker: false, quantity: 75, timestampOffset: 6000 },
                    { buyerIsMaker: false, quantity: 80, timestampOffset: 9000 },
                    { buyerIsMaker: false, quantity: 85, timestampOffset: 12000 },
                    { buyerIsMaker: false, quantity: 90, timestampOffset: 15000 },
                    { buyerIsMaker: false, quantity: 95, timestampOffset: 18000 },
                    { buyerIsMaker: false, quantity: 100, timestampOffset: 21000 },
                    { buyerIsMaker: false, quantity: 105, timestampOffset: 24000 },
                    // 1 aggressive sell: buyerIsMaker=true (minimal selling pressure)
                    { buyerIsMaker: true, quantity: 45, timestampOffset: 27000 },
                ],
            },

            {
                name: "Extreme Selling Capitulation",
                description: "Panic selling absorbed by institutional buying (your exact scenario)",
                marketContext: "market_bottom", 
                expectedSignal: "BUY", // ✅ NEVER SELL at market bottom!
                expectedLogic: "Panic selling → institutional bid absorption → BUY signal",
                mathProof: "95% sellVolume → dominantSide='sell' → absorbingSide='bid' → signal='BUY'",
                trades: [
                    // 19 panic sells
                    ...Array.from({ length: 19 }, (_, i) => ({
                        buyerIsMaker: true,
                        quantity: 60 + i * 5,
                        timestampOffset: i * 2000,
                    })),
                    // 1 token buy
                    { buyerIsMaker: false, quantity: 30, timestampOffset: 40000 },
                ],
            },

            {
                name: "Extreme Buying FOMO",
                description: "Retail FOMO buying absorbed by institutional selling",
                marketContext: "market_top",
                expectedSignal: "SELL", // ✅ NEVER BUY at market top!
                expectedLogic: "FOMO buying → institutional ask absorption → SELL signal", 
                mathProof: "95% buyVolume → dominantSide='buy' → absorbingSide='ask' → signal='SELL'",
                trades: [
                    // 19 FOMO buys
                    ...Array.from({ length: 19 }, (_, i) => ({
                        buyerIsMaker: false,
                        quantity: 55 + i * 4,
                        timestampOffset: i * 2000,
                    })),
                    // 1 token sell
                    { buyerIsMaker: true, quantity: 25, timestampOffset: 40000 },
                ],
            },
        ];

        marketExtremeScenarios.forEach((scenario) => {
            it(`should handle "${scenario.name}" correctly`, { timeout: 15000 }, () => {
                console.log(`\n🔬 ===== TESTING SPECIFICATION: ${scenario.name} =====`);
                console.log(`📊 Market Context: ${scenario.marketContext.toUpperCase()}`);
                console.log(`🎯 Expected Signal: ${scenario.expectedSignal || "None"}`);
                console.log(`🧠 Logic: ${scenario.expectedLogic}`);
                console.log(`🧮 Math Proof: ${scenario.mathProof}`);
                
                let signalEmitted = false;
                let actualSignal: string | undefined;
                let signalData: any = null;
                let signalCount = 0;

                detector.on("signalCandidate", (data) => {
                    signalEmitted = true;
                    actualSignal = data.side;
                    signalData = data;
                    signalCount++;
                    
                    console.log(`\n🎯 SIGNAL DETECTED:`);
                    console.log(`  Side: ${data.side}`);
                    console.log(`  Confidence: ${data.confidence}`);
                    console.log(`  Price: ${data.price}`);
                    console.log(`  Absorbing Side: ${data.data?.metrics?.absorbingSide}`);
                    console.log(`  Aggressive Side: ${data.data?.metrics?.aggressiveSide}`);
                });

                // Execute scenario trades
                const baseTime = Date.now() - 60000;
                const basePrice = 50000;
                
                console.log(`\n📊 EXECUTING ${scenario.trades.length} TRADES:`);
                let totalSellVolume = 0;
                let totalBuyVolume = 0;
                
                scenario.trades.forEach((trade, i) => {
                    const event = createSpecificationTestEvent(
                        trade.price || basePrice,
                        trade.quantity,
                        baseTime + trade.timestampOffset,
                        trade.buyerIsMaker,
                        trade.passiveBidVol,
                        trade.passiveAskVol
                    );
                    
                    // ✅ CORRECT: Volume attribution per BuyerIsMaker docs
                    if (trade.buyerIsMaker) {
                        totalSellVolume += trade.quantity; // Seller was aggressive
                        console.log(`  ${i + 1}. SELL ${trade.quantity} (aggressive seller, buyerIsMaker=true)`);
                    } else {
                        totalBuyVolume += trade.quantity; // Buyer was aggressive  
                        console.log(`  ${i + 1}. BUY ${trade.quantity} (aggressive buyer, buyerIsMaker=false)`);
                    }
                    
                    detector.onEnrichedTrade(event);
                });

                console.log(`\n📈 VOLUME ANALYSIS:`);
                console.log(`  Total Sell Volume (aggressive sellers): ${totalSellVolume}`);
                console.log(`  Total Buy Volume (aggressive buyers): ${totalBuyVolume}`);
                console.log(`  Dominant Side: ${totalSellVolume > totalBuyVolume ? "SELL" : "BUY"}`);
                console.log(`  Sell Ratio: ${(totalSellVolume / (totalSellVolume + totalBuyVolume) * 100).toFixed(1)}%`);
                console.log(`  Buy Ratio: ${(totalBuyVolume / (totalSellVolume + totalBuyVolume) * 100).toFixed(1)}%`);

                // Wait for signal processing
                return new Promise<void>((resolve) => {
                    setTimeout(() => {
                        console.log(`\n🎯 SPECIFICATION VALIDATION:`);
                        console.log(`  Expected: ${scenario.expectedSignal || "No Signal"}`);
                        console.log(`  Actual: ${actualSignal || "No Signal"}`);
                        console.log(`  Signals Count: ${signalCount}`);
                        
                        if (scenario.expectedSignal === null) {
                            // Should NOT generate signals
                            if (signalEmitted) {
                                console.log(`❌ SPECIFICATION VIOLATION: Expected no signal but got ${actualSignal}`);
                                console.log(`   This indicates incorrect threshold or filtering logic`);
                            } else {
                                console.log(`✅ SPECIFICATION COMPLIANT: Correctly generated no signal`);
                            }
                        } else {
                            // Should generate expected signal
                            if (signalEmitted) {
                                const isCorrect = actualSignal?.toUpperCase() === scenario.expectedSignal;
                                if (isCorrect) {
                                    console.log(`✅ SPECIFICATION COMPLIANT: ${actualSignal} matches expected ${scenario.expectedSignal}`);
                                } else {
                                    console.log(`❌ SPECIFICATION VIOLATION: Expected ${scenario.expectedSignal}, got ${actualSignal}`);
                                    console.log(`   🚨 CRITICAL BUG: Signal direction logic is WRONG`);
                                    console.log(`   Market Context: ${scenario.marketContext}`);
                                    console.log(`   This violates institutional trading principles!`);
                                    
                                    if (scenario.marketContext === "market_bottom" && actualSignal === "sell") {
                                        console.log(`   🎯 SMOKING GUN: SELL signal at market bottom is IMPOSSIBLE!`);
                                    }
                                    if (scenario.marketContext === "market_top" && actualSignal === "buy") {
                                        console.log(`   🎯 SMOKING GUN: BUY signal at market top is IMPOSSIBLE!`);
                                    }
                                }
                                
                                // ✅ CLAUDE.md COMPLIANT: Tests detect bugs, never adjust to pass buggy code
                                expect(actualSignal?.toUpperCase()).toBe(scenario.expectedSignal);
                                
                            } else {
                                console.log(`⚠️ SPECIFICATION ISSUE: Expected ${scenario.expectedSignal} but no signal generated`);
                                console.log(`   This may indicate threshold/detection logic issues`);
                                
                                // Expected signal but got none - this should fail the test
                                expect(signalEmitted).toBe(true);
                            }
                        }
                        
                        console.log(`🔬 ====================================================\n`);
                        resolve();
                    }, 100);
                });
            });
        });
    });

    describe("📊 Phase 2: Mixed Ratio Scenarios", () => {
        
        const mixedRatioScenarios: AbsorptionTestScenario[] = [
            
            {
                name: "70/30 Selling Pressure (Strong Absorption)",
                description: "70% selling pressure absorbed by institutional bids",
                marketContext: "sideways",
                expectedSignal: "BUY",
                expectedLogic: "Dominant selling pressure → bid absorption → BUY signal",
                mathProof: "70% sellVolume → dominantSide='sell' → absorbingSide='bid' → signal='BUY'",
                trades: [
                    // 7 sells
                    ...Array.from({ length: 7 }, (_, i) => ({
                        buyerIsMaker: true,
                        quantity: 60,
                        timestampOffset: i * 3000,
                    })),
                    // 3 buys  
                    ...Array.from({ length: 3 }, (_, i) => ({
                        buyerIsMaker: false,
                        quantity: 60,
                        timestampOffset: (7 + i) * 3000,
                    })),
                ],
            },

            {
                name: "70/30 Buying Pressure (Strong Absorption)",
                description: "70% buying pressure absorbed by institutional asks",
                marketContext: "sideways",
                expectedSignal: "SELL",
                expectedLogic: "Dominant buying pressure → ask absorption → SELL signal",
                mathProof: "70% buyVolume → dominantSide='buy' → absorbingSide='ask' → signal='SELL'",
                trades: [
                    // 7 buys
                    ...Array.from({ length: 7 }, (_, i) => ({
                        buyerIsMaker: false,
                        quantity: 60,
                        timestampOffset: i * 3000,
                    })),
                    // 3 sells
                    ...Array.from({ length: 3 }, (_, i) => ({
                        buyerIsMaker: true,
                        quantity: 60,
                        timestampOffset: (7 + i) * 3000,
                    })),
                ],
            },

            {
                name: "60/40 Selling Pressure (Threshold Edge)",
                description: "Moderate selling pressure - test detection threshold",
                marketContext: "sideways",
                expectedSignal: "BUY",
                expectedLogic: "Moderate selling pressure → bid absorption → BUY signal",
                mathProof: "60% sellVolume → dominantSide='sell' → absorbingSide='bid' → signal='BUY'",
                trades: [
                    // 6 sells
                    ...Array.from({ length: 6 }, (_, i) => ({
                        buyerIsMaker: true,
                        quantity: 65,
                        timestampOffset: i * 3000,
                    })),
                    // 4 buys
                    ...Array.from({ length: 4 }, (_, i) => ({
                        buyerIsMaker: false,
                        quantity: 65,
                        timestampOffset: (6 + i) * 3000,
                    })),
                ],
            },

            {
                name: "50/50 Balanced Pressure",
                description: "Balanced buying and selling pressure",
                marketContext: "balanced",
                expectedSignal: null, // No clear direction
                expectedLogic: "Balanced pressure → no clear absorption → no signal", 
                mathProof: "50% each → no dominant side → no absorption detected",
                trades: [
                    // 5 sells, 5 buys alternating
                    ...Array.from({ length: 10 }, (_, i) => ({
                        buyerIsMaker: i % 2 === 0, // Alternate between buy and sell
                        quantity: 70,
                        timestampOffset: i * 2000,
                    })),
                ],
            },
        ];

        mixedRatioScenarios.forEach((scenario) => {
            it(`should handle "${scenario.name}" correctly`, { timeout: 10000 }, () => {
                console.log(`\n📊 ===== TESTING MIXED RATIO: ${scenario.name} =====`);
                console.log(`🎯 Expected: ${scenario.expectedSignal || "No Signal"}`);
                console.log(`🧮 Math: ${scenario.mathProof}`);
                
                let signalEmitted = false;
                let actualSignal: string | undefined;

                detector.on("signalCandidate", (data) => {
                    signalEmitted = true;
                    actualSignal = data.side;
                    console.log(`  Signal: ${data.side} (confidence: ${data.confidence})`);
                });

                const baseTime = Date.now() - 60000;
                const basePrice = 50000;
                
                let sellCount = 0, buyCount = 0;
                scenario.trades.forEach((trade) => {
                    const event = createSpecificationTestEvent(
                        basePrice,
                        trade.quantity, 
                        baseTime + trade.timestampOffset,
                        trade.buyerIsMaker
                    );
                    
                    if (trade.buyerIsMaker) sellCount++; else buyCount++;
                    detector.onEnrichedTrade(event);
                });

                console.log(`  Executed: ${sellCount} sells, ${buyCount} buys`);

                return new Promise<void>((resolve) => {
                    setTimeout(() => {
                        const result = actualSignal || "No Signal";
                        const expected = scenario.expectedSignal || "No Signal";
                        console.log(`  Result: ${result} (Expected: ${expected})`);
                        
                        if (scenario.expectedSignal) {
                            expect(actualSignal?.toUpperCase()).toBe(scenario.expectedSignal);
                        } else {
                            expect(signalEmitted).toBe(false);
                        }
                        
                        console.log(`📊 ===============================================\n`);
                        resolve();
                    }, 50);
                });
            });
        });
    });

    describe("⚡ Phase 3: Volume Intensity & Edge Cases", () => {
        
        it("should handle high volume absorption correctly", { timeout: 10000 }, () => {
            console.log(`\n⚡ ===== TESTING HIGH VOLUME ABSORPTION =====`);
            
            let signalEmitted = false;
            let actualSignal: string | undefined;

            detector.on("signalCandidate", (data) => {
                signalEmitted = true;
                actualSignal = data.side;
                console.log(`  High Volume Signal: ${data.side}`);
            });

            const baseTime = Date.now() - 60000;
            const basePrice = 50000;
            
            // High volume selling pressure
            const highVolumeTrades = [
                { buyerIsMaker: true, quantity: 200 },
                { buyerIsMaker: true, quantity: 250 },
                { buyerIsMaker: true, quantity: 300 },
                { buyerIsMaker: true, quantity: 280 },
                { buyerIsMaker: true, quantity: 220 },
                { buyerIsMaker: false, quantity: 50 }, // Token buying
            ];

            highVolumeTrades.forEach((trade, i) => {
                const event = createSpecificationTestEvent(
                    basePrice,
                    trade.quantity,
                    baseTime + i * 3000,
                    trade.buyerIsMaker
                );
                detector.onEnrichedTrade(event);
            });

            return new Promise<void>((resolve) => {
                setTimeout(() => {
                    console.log(`  High volume result: ${actualSignal || "No Signal"}`);
                    
                    // High selling volume should generate BUY signal
                    expect(actualSignal?.toUpperCase()).toBe("BUY");
                    
                    console.log(`⚡ ========================================\n`);
                    resolve();
                }, 50);
            });
        });

        it("should reject low volume scenarios correctly", { timeout: 10000 }, () => {
            console.log(`\n⚡ ===== TESTING LOW VOLUME REJECTION =====`);
            
            let signalEmitted = false;

            detector.on("signalCandidate", () => {
                signalEmitted = true;
            });

            const baseTime = Date.now() - 60000;
            const basePrice = 50000;
            
            // Low volume trades (below minAggVolume threshold)
            const lowVolumeTrades = [
                { buyerIsMaker: true, quantity: 10 },  // Below 40 threshold
                { buyerIsMaker: true, quantity: 15 },
                { buyerIsMaker: true, quantity: 12 },
                { buyerIsMaker: false, quantity: 8 },
            ];

            lowVolumeTrades.forEach((trade, i) => {
                const event = createSpecificationTestEvent(
                    basePrice,
                    trade.quantity,
                    baseTime + i * 3000,
                    trade.buyerIsMaker
                );
                detector.onEnrichedTrade(event);
            });

            return new Promise<void>((resolve) => {
                setTimeout(() => {
                    console.log(`  Low volume result: ${signalEmitted ? "Signal Generated" : "No Signal"}`);
                    
                    // Low volume should NOT generate signals
                    expect(signalEmitted).toBe(false);
                    
                    console.log(`⚡ ========================================\n`);
                    resolve();
                }, 50);
            });
        });
    });

    describe("🎯 Phase 4: Critical Bug Validation", () => {
        
        it("should NEVER generate SELL signal at market bottom", { timeout: 10000 }, () => {
            console.log(`\n🎯 ===== CRITICAL: No SELL at Market Bottom =====`);
            
            let sellSignalEmitted = false;
            let actualSignal: string | undefined;

            detector.on("signalCandidate", (data) => {
                actualSignal = data.side;
                if (data.side.toLowerCase() === "sell") {
                    sellSignalEmitted = true;
                    console.log(`🚨 CRITICAL BUG: SELL signal at market bottom!`);
                }
            });

            const baseTime = Date.now() - 60000;
            const basePrice = 50000; // Simulating market bottom
            
            // Extreme selling pressure (panic selling at bottom)
            const panicSelling = Array.from({ length: 15 }, (_, i) => ({
                buyerIsMaker: true, // Sellers hitting bids
                quantity: 80 + i * 5,
                timestampOffset: i * 2000,
            }));

            panicSelling.forEach((trade) => {
                const event = createSpecificationTestEvent(
                    basePrice,
                    trade.quantity,
                    baseTime + trade.timestampOffset,
                    trade.buyerIsMaker
                );
                detector.onEnrichedTrade(event);
            });

            return new Promise<void>((resolve) => {
                setTimeout(() => {
                    console.log(`  Market bottom result: ${actualSignal || "No Signal"}`);
                    
                    // ✅ CRITICAL: NEVER SELL at market bottom
                    expect(sellSignalEmitted).toBe(false);
                    
                    // If signal generated, it MUST be BUY
                    if (actualSignal) {
                        expect(actualSignal.toUpperCase()).toBe("BUY");
                    }
                    
                    console.log(`🎯 ========================================\n`);
                    resolve();
                }, 50);
            });
        });

        it("should NEVER generate BUY signal at market top", { timeout: 10000 }, () => {
            console.log(`\n🎯 ===== CRITICAL: No BUY at Market Top =====`);
            
            let buySignalEmitted = false;
            let actualSignal: string | undefined;

            detector.on("signalCandidate", (data) => {
                actualSignal = data.side;
                if (data.side.toLowerCase() === "buy") {
                    buySignalEmitted = true;
                    console.log(`🚨 CRITICAL BUG: BUY signal at market top!`);
                }
            });

            const baseTime = Date.now() - 60000;
            const basePrice = 60000; // Simulating market top
            
            // Extreme buying pressure (FOMO buying at top)
            const fomoBuying = Array.from({ length: 15 }, (_, i) => ({
                buyerIsMaker: false, // Buyers hitting asks
                quantity: 75 + i * 4,
                timestampOffset: i * 2000,
            }));

            fomoBuying.forEach((trade) => {
                const event = createSpecificationTestEvent(
                    basePrice,
                    trade.quantity,
                    baseTime + trade.timestampOffset,
                    trade.buyerIsMaker
                );
                detector.onEnrichedTrade(event);
            });

            return new Promise<void>((resolve) => {
                setTimeout(() => {
                    console.log(`  Market top result: ${actualSignal || "No Signal"}`);
                    
                    // ✅ CRITICAL: NEVER BUY at market top
                    expect(buySignalEmitted).toBe(false);
                    
                    // If signal generated, it MUST be SELL
                    if (actualSignal) {
                        expect(actualSignal.toUpperCase()).toBe("SELL");
                    }
                    
                    console.log(`🎯 ========================================\n`);
                    resolve();
                }, 50);
            });
        });
    });
});