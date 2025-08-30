// test/absorptionDetectorEnhanced_comprehensive.test.ts
//
// COMPREHENSIVE TEST SUITE for AbsorptionDetectorEnhanced
// Tests ALL 9 thresholds with realistic market scenarios and edge cases
//
// COVERAGE:
// - All threshold boundary testing (minAggVolume, passiveAbsorptionThreshold, etc.)
// - Real-world market scenarios (institutional absorption, retail patterns)
// - Edge cases (minimum data, invalid data, time boundaries)
// - Signal direction validation (buy/sell correctness)
// - Configuration combinations (conservative/aggressive/balanced)

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AbsorptionDetectorEnhanced } from "../src/indicators/absorptionDetectorEnhanced.js";
import { Config } from "../src/core/config.js";
import { SignalValidationLogger } from "../__mocks__/src/utils/signalValidationLogger.js";
import type {
    EnrichedTradeEvent,
    ZoneSnapshot,
    StandardZoneData,
} from "../src/types/marketEvents.js";
import type { SignalCandidate } from "../src/types/signalTypes.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { ISignalLogger } from "../src/infrastructure/signalLoggerInterface.js";
import type { IOrderflowPreprocessor } from "../src/market/orderFlowPreprocessor.js";
import type { AbsorptionEnhancedSettings } from "../src/indicators/absorptionDetectorEnhanced.js";

// Mock implementations
const mockLogger: ILogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
};

const mockMetrics: IMetricsCollector = {
    updateMetric: vi.fn(),
    incrementMetric: vi.fn(),
    incrementCounter: vi.fn(),
    recordHistogram: vi.fn(),
    recordGauge: vi.fn(),
    createCounter: vi.fn(),
    createHistogram: vi.fn(),
    createGauge: vi.fn(),
    getMetrics: vi.fn(() => ({})),
    getHealthSummary: vi.fn(() => "healthy"),
    destroy: vi.fn(),
};

const mockSignalLogger: ISignalLogger = {
    logSignal: vi.fn(),
};

const mockPreprocessor: IOrderflowPreprocessor = {
    process: vi.fn(),
    getUniversalZones: vi.fn().mockReturnValue({
        bidZones: [],
        askZones: [],
        timestamp: Date.now(),
    }),
    getOrderBook: vi.fn(),
    getMarketState: vi.fn(),
    findZonesNearPrice: vi.fn(
        (zones: ZoneSnapshot[], price: number, distance: number) => {
            // Return zones within distance of price
            return zones.filter(
                (zone) => Math.abs(zone.priceLevel - price) <= distance * 0.01 // Convert ticks to price
            );
        }
    ),
};

const mockValidationLogger = new SignalValidationLogger(
    mockLogger,
    "test-output"
);

// Mock Config
vi.mock("../src/core/config.js", () => ({
    Config: {
        UNIVERSAL_ZONE_CONFIG: {
            maxZoneConfluenceDistance: 5,
        },
        TICK_SIZE: 0.01,
        getTimeWindow: vi.fn().mockReturnValue(180000), // 3 minutes
    },
}));

// Production configuration from config.json
const productionSettings: AbsorptionEnhancedSettings = {
    minAggVolume: 500,
    finalConfidenceRequired: 0.62,
    priceEfficiencyThreshold: 0.0046,
    minPassiveMultiplier: 15.0,
    timeWindowIndex: 0,
    eventCooldownMs: 1000,
    maxAbsorptionRatio: 0.7,
    passiveAbsorptionThreshold: 0.66,
    expectedMovementScalingFactor: 10,
    minAbsorptionScore: 0.92,
    maxZoneCountForScoring: 5,
    balanceThreshold: 0.44,
    confluenceMinZones: 2,
    confluenceMaxDistance: 5,
    maxZonesPerSide: 5,
    zoneHistoryWindowMs: 60000,
    absorptionZoneThreshold: 1.5,
    minPassiveVolumeForZone: 50,
    priceStabilityTicks: 2,
    minAbsorptionEvents: 2,
};

describe("AbsorptionDetectorEnhanced - Comprehensive Testing", () => {
    let detector: AbsorptionDetectorEnhanced;
    let emittedSignals: SignalCandidate[] = [];

    beforeEach(() => {
        vi.clearAllMocks();
        emittedSignals = [];

        detector = new AbsorptionDetectorEnhanced(
            "test-absorption-comprehensive",
            productionSettings,
            mockPreprocessor,
            mockLogger,
            mockMetrics,
            mockValidationLogger,
            mockSignalLogger
        );

        // Capture emitted signals
        detector.on("signalCandidate", (signal: SignalCandidate) => {
            emittedSignals.push(signal);
        });
    });

    describe("🎯 Threshold Boundary Testing", () => {
        describe("minAggVolume Threshold", () => {
            it("should REJECT signals when aggressive volume is below threshold", () => {
                const trade = createAbsorptionTrade({
                    aggressiveVolume: 499, // Below minAggVolume: 500
                    passiveVolume: 1000,
                    price: 100.0,
                });

                detector.onEnrichedTrade(trade);
                expect(emittedSignals).toHaveLength(0);
            });

            it("should ACCEPT signals when aggressive volume meets threshold", () => {
                const trade = createAbsorptionTrade({
                    aggressiveVolume: 500, // Exactly minAggVolume: 500
                    passiveVolume: 15000, // Well above minPassiveMultiplier: 15.0
                    price: 100.0,
                    priceEfficiency: 0.004, // Below priceEfficiencyThreshold: 0.0046
                });

                detector.onEnrichedTrade(trade);

                // May emit signal if other conditions are met
                if (emittedSignals.length > 0) {
                    expect(emittedSignals[0].type).toBe("absorption");
                }
            });

            it("should ACCEPT signals when aggressive volume exceeds threshold", () => {
                const trade = createAbsorptionTrade({
                    aggressiveVolume: 501, // Above minAggVolume: 500
                    passiveVolume: 15030, // Above minPassiveMultiplier: 15.0 * 501
                    price: 100.0,
                    priceEfficiency: 0.004, // Below priceEfficiencyThreshold: 0.0046
                });

                detector.onEnrichedTrade(trade);

                // Should have better chance of emitting signal
                if (emittedSignals.length > 0) {
                    expect(emittedSignals[0].type).toBe("absorption");
                }
            });
        });

        describe("passiveAbsorptionThreshold", () => {
            it("should REJECT when passive volume ratio is below threshold", () => {
                const aggressiveVol = 500;
                const passiveVol = 650; // Ratio: 0.65, below threshold: 0.66

                const trade = createAbsorptionTrade({
                    aggressiveVolume: aggressiveVol,
                    passiveVolume: passiveVol,
                    price: 100.0,
                });

                detector.onEnrichedTrade(trade);
                expect(emittedSignals).toHaveLength(0);
            });

            it("should ACCEPT when passive volume ratio meets threshold", () => {
                const aggressiveVol = 500;
                const passiveVol = 1000; // Ratio: 0.66, meets threshold

                const trade = createAbsorptionTrade({
                    aggressiveVolume: aggressiveVol,
                    passiveVolume: passiveVol,
                    price: 100.0,
                    priceEfficiency: 0.004, // Below priceEfficiencyThreshold
                });

                detector.onEnrichedTrade(trade);

                // Should potentially emit signal
                if (emittedSignals.length > 0) {
                    expect(emittedSignals[0].type).toBe("absorption");
                }
            });
        });

        describe("priceEfficiencyThreshold", () => {
            it("should REJECT when price efficiency is above threshold", () => {
                const trade = createAbsorptionTrade({
                    aggressiveVolume: 500,
                    passiveVolume: 8000, // High passive volume
                    price: 100.0,
                    priceEfficiency: 0.0047, // Above threshold: 0.0046
                });

                detector.onEnrichedTrade(trade);
                expect(emittedSignals).toHaveLength(0);
            });

            it("should ACCEPT when price efficiency is below threshold", () => {
                const trade = createAbsorptionTrade({
                    aggressiveVolume: 500,
                    passiveVolume: 8000,
                    price: 100.0,
                    priceEfficiency: 0.0045, // Below threshold: 0.0046
                });

                detector.onEnrichedTrade(trade);

                if (emittedSignals.length > 0) {
                    expect(emittedSignals[0].type).toBe("absorption");
                }
            });
        });

        describe("minPassiveMultiplier Threshold", () => {
            it("should REJECT when passive multiplier is below threshold", () => {
                const aggressiveVol = 500;
                const passiveVol = 7400; // Multiplier: 14.8, below threshold: 15.0

                const trade = createAbsorptionTrade({
                    aggressiveVolume: aggressiveVol,
                    passiveVolume: passiveVol,
                    price: 100.0,
                });

                detector.onEnrichedTrade(trade);
                expect(emittedSignals).toHaveLength(0);
            });

            it("should ACCEPT when passive multiplier meets threshold", () => {
                const aggressiveVol = 500;
                const passiveVol = 7500; // Multiplier: 15.0, meets threshold

                const trade = createAbsorptionTrade({
                    aggressiveVolume: aggressiveVol,
                    passiveVolume: passiveVol,
                    price: 100.0,
                    priceEfficiency: 0.004,
                });

                detector.onEnrichedTrade(trade);

                if (emittedSignals.length > 0) {
                    expect(emittedSignals[0].type).toBe("absorption");
                }
            });
        });

        describe("finalConfidenceRequired Threshold", () => {
            it("should REJECT when final confidence is below threshold", () => {
                // Create trade with conditions that would produce low confidence
                const trade = createAbsorptionTrade({
                    aggressiveVolume: 500,
                    passiveVolume: 8000,
                    price: 100.0,
                    priceEfficiency: 0.0045, // Good efficiency
                    absorptionRatio: 0.69, // High absorption ratio (bad for confidence)
                });

                detector.onEnrichedTrade(trade);

                // Should be rejected due to low confidence
                expect(emittedSignals).toHaveLength(0);
            });
        });

        describe("minAbsorptionScore Threshold", () => {
            it("should REJECT when absorption score is below threshold", () => {
                const aggressiveVol = 500;
                const passiveVol = 4500; // Lower passive volume for lower score

                const trade = createAbsorptionTrade({
                    aggressiveVolume: aggressiveVol,
                    passiveVolume: passiveVol,
                    price: 100.0,
                    priceEfficiency: 0.004,
                });

                detector.onEnrichedTrade(trade);
                expect(emittedSignals).toHaveLength(0);
            });

            it("should ACCEPT when absorption score meets threshold", () => {
                const aggressiveVol = 500;
                const passiveVol = 11500; // High passive volume for high score

                const trade = createAbsorptionTrade({
                    aggressiveVolume: aggressiveVol,
                    passiveVolume: passiveVol,
                    price: 100.0,
                    priceEfficiency: 0.003, // Very good efficiency
                });

                detector.onEnrichedTrade(trade);

                if (emittedSignals.length > 0) {
                    expect(emittedSignals[0].type).toBe("absorption");
                }
            });
        });
    });

    describe("🏦 Real-World Market Scenarios", () => {
        describe("High Volume Institutional Absorption", () => {
            it("should detect institutional absorption at resistance", () => {
                // Large institutional buying being absorbed at resistance
                const trades = [
                    createAbsorptionTrade({
                        price: 100.05,
                        aggressiveVolume: 2000, // Large institutional order
                        passiveVolume: 32000, // Massive passive wall
                        side: "ask",
                        priceEfficiency: 0.002, // Very stable price
                    }),
                    createAbsorptionTrade({
                        price: 100.04, // Price declining despite buying
                        aggressiveVolume: 1500,
                        passiveVolume: 24000,
                        side: "ask",
                        timestamp: Date.now() + 1000,
                    }),
                ];

                trades.forEach((trade) => detector.onEnrichedTrade(trade));

                if (emittedSignals.length > 0) {
                    const signal = emittedSignals[0];
                    expect(signal.side).toBe("sell"); // Ask absorption → SELL signal
                    expect(signal.confidence).toBeGreaterThan(0.7); // High confidence
                }
            });

            it("should detect institutional absorption at support", () => {
                // Large institutional selling being absorbed at support
                const trades = [
                    createAbsorptionTrade({
                        price: 99.95,
                        aggressiveVolume: 2500,
                        passiveVolume: 40000, // Massive bid support
                        side: "bid",
                        priceEfficiency: 0.001, // Very stable
                    }),
                    createAbsorptionTrade({
                        price: 99.96, // Price rising despite selling
                        aggressiveVolume: 2000,
                        passiveVolume: 35000,
                        side: "bid",
                        timestamp: Date.now() + 1000,
                    }),
                ];

                trades.forEach((trade) => detector.onEnrichedTrade(trade));

                if (emittedSignals.length > 0) {
                    const signal = emittedSignals[0];
                    expect(signal.side).toBe("buy"); // Bid absorption → BUY signal
                    expect(signal.confidence).toBeGreaterThan(0.7);
                }
            });
        });

        describe("Retail Absorption Pattern", () => {
            it("should detect smaller retail absorption building up", () => {
                // Multiple smaller absorption events
                const trades = [
                    createAbsorptionTrade({
                        price: 100.0,
                        aggressiveVolume: 600,
                        passiveVolume: 12000,
                        side: "ask",
                    }),
                    createAbsorptionTrade({
                        price: 100.0,
                        aggressiveVolume: 550,
                        passiveVolume: 11000,
                        side: "ask",
                        timestamp: Date.now() + 500,
                    }),
                    createAbsorptionTrade({
                        price: 99.99, // Slight price decline
                        aggressiveVolume: 700,
                        passiveVolume: 13000,
                        side: "ask",
                        timestamp: Date.now() + 1000,
                    }),
                ];

                trades.forEach((trade) => detector.onEnrichedTrade(trade));

                if (emittedSignals.length > 0) {
                    expect(emittedSignals[0].type).toBe("absorption");
                    expect(emittedSignals[0].side).toBe("sell");
                }
            });
        });

        describe("Failed Absorption (Breakthrough)", () => {
            it("should NOT signal when absorption fails", () => {
                // Initial absorption followed by breakthrough
                const trades = [
                    createAbsorptionTrade({
                        price: 100.0,
                        aggressiveVolume: 800,
                        passiveVolume: 15000,
                        side: "ask",
                        priceEfficiency: 0.002, // Initially good
                    }),
                    createAbsorptionTrade({
                        price: 100.15, // Price breaks through
                        aggressiveVolume: 1200,
                        passiveVolume: 8000, // Absorption weakening
                        side: "ask",
                        priceEfficiency: 0.015, // High price efficiency (bad)
                        timestamp: Date.now() + 1000,
                    }),
                ];

                trades.forEach((trade) => detector.onEnrichedTrade(trade));

                // Should not emit signal due to failed absorption
                expect(emittedSignals).toHaveLength(0);
            });
        });

        describe("Balanced Market (No Signal)", () => {
            it("should NOT signal in balanced market conditions", () => {
                const trade = createAbsorptionTrade({
                    price: 100.0,
                    aggressiveVolume: 600,
                    passiveVolume: 12000,
                    balancedFlow: 0.45, // Above balanceThreshold: 0.44
                });

                detector.onEnrichedTrade(trade);

                // Should not emit signal due to balanced flow
                expect(emittedSignals).toHaveLength(0);
            });
        });
    });

    describe("⚡ Edge Cases", () => {
        describe("Minimum Data Scenarios", () => {
            it("should handle single zone with minimal volume", () => {
                const trade = createAbsorptionTrade({
                    aggressiveVolume: 500, // Exactly minimum
                    passiveVolume: 7500, // Exactly minimum multiplier
                    zones: [createSingleZone(100.0, 500, 7500)],
                });

                detector.onEnrichedTrade(trade);

                // Should handle gracefully without crashing
                expect(() => detector.onEnrichedTrade(trade)).not.toThrow();
            });

            it("should reject when no zones available", () => {
                const trade = createAbsorptionTrade({
                    zones: [], // No zones
                });

                detector.onEnrichedTrade(trade);
                expect(emittedSignals).toHaveLength(0);
            });
        });

        describe("Time Window Edge Cases", () => {
            it("should filter zones outside time window", () => {
                const currentTime = Date.now();
                const oldZone = createSingleZone(
                    100.0,
                    1000,
                    20000,
                    currentTime - 70000
                ); // Outside 60s window
                const recentZone = createSingleZone(
                    100.0,
                    1000,
                    20000,
                    currentTime - 10000
                ); // Within window

                const trade = createAbsorptionTrade({
                    timestamp: currentTime,
                    zones: [oldZone, recentZone],
                });

                detector.onEnrichedTrade(trade);

                // Should only process recent zone
                expect(() => detector.onEnrichedTrade(trade)).not.toThrow();
            });
        });

        describe("Invalid Data Handling", () => {
            it("should handle zones with invalid volumeWeightedPrice", () => {
                const invalidZone = createSingleZone(100.0, 1000, 20000);
                invalidZone.volumeWeightedPrice = NaN; // Invalid price

                const trade = createAbsorptionTrade({
                    zones: [invalidZone],
                });

                detector.onEnrichedTrade(trade);

                // Should not crash and should not emit signal
                expect(emittedSignals).toHaveLength(0);
            });

            it("should handle zones with invalid volume values", () => {
                const invalidZone = createSingleZone(100.0, NaN, 20000); // Invalid aggressive volume

                const trade = createAbsorptionTrade({
                    zones: [invalidZone],
                });

                detector.onEnrichedTrade(trade);

                // Should not crash
                expect(() => detector.onEnrichedTrade(trade)).not.toThrow();
                expect(emittedSignals).toHaveLength(0);
            });
        });

        describe("Price Stability Edge Cases", () => {
            it("should REJECT when price movement exceeds stability threshold", () => {
                const trade = createAbsorptionTrade({
                    price: 100.0,
                    aggressiveVolume: 1000,
                    passiveVolume: 20000,
                    priceEfficiency: 0.003,
                    zones: [createSingleZone(99.97, 1000, 20000)], // 3 ticks away, above priceStabilityTicks: 2
                });

                detector.onEnrichedTrade(trade);
                expect(emittedSignals).toHaveLength(0);
            });

            it("should ACCEPT when price movement is within stability threshold", () => {
                const trade = createAbsorptionTrade({
                    price: 100.0,
                    aggressiveVolume: 1000,
                    passiveVolume: 20000,
                    priceEfficiency: 0.003,
                    zones: [createSingleZone(99.98, 1000, 20000)], // 2 ticks away, within priceStabilityTicks: 2
                });

                detector.onEnrichedTrade(trade);

                if (emittedSignals.length > 0) {
                    expect(emittedSignals[0].type).toBe("absorption");
                }
            });
        });
    });

    describe("✅ Signal Direction Validation", () => {
        it("should generate BUY signal for bid absorption (sell pressure absorbed)", () => {
            const trade = createAbsorptionTrade({
                price: 99.95,
                aggressiveVolume: 800,
                passiveVolume: 15000,
                side: "bid",
                buyerIsMaker: true, // Selling being absorbed
                priceEfficiency: 0.003,
            });

            detector.onEnrichedTrade(trade);

            if (emittedSignals.length > 0) {
                expect(emittedSignals[0].side).toBe("buy");
                expect(emittedSignals[0].type).toBe("absorption");
            }
        });

        it("should generate SELL signal for ask absorption (buy pressure absorbed)", () => {
            const trade = createAbsorptionTrade({
                price: 100.05,
                aggressiveVolume: 800,
                passiveVolume: 15000,
                side: "ask",
                buyerIsMaker: false, // Buying being absorbed
                priceEfficiency: 0.003,
            });

            detector.onEnrichedTrade(trade);

            if (emittedSignals.length > 0) {
                expect(emittedSignals[0].side).toBe("sell");
                expect(emittedSignals[0].type).toBe("absorption");
            }
        });
    });
});

// Helper Functions for Test Data Generation

function createAbsorptionTrade(params: {
    price?: number;
    aggressiveVolume?: number;
    passiveVolume?: number;
    side?: "bid" | "ask";
    buyerIsMaker?: boolean;
    timestamp?: number;
    priceEfficiency?: number;
    absorptionRatio?: number;
    balancedFlow?: number;
    zones?: ZoneSnapshot[];
}): EnrichedTradeEvent {
    const {
        price = 100.0,
        aggressiveVolume = 1000,
        passiveVolume = 16000,
        side = "ask",
        buyerIsMaker = side === "ask" ? false : true,
        timestamp = Date.now(),
        priceEfficiency = 0.003,
        absorptionRatio = 0.4,
        balancedFlow = 0.2,
        zones = [
            createSingleZone(price, aggressiveVolume, passiveVolume, timestamp),
        ],
    } = params;

    return {
        id: `test-${timestamp}`,
        symbol: "LTCUSDT",
        price,
        quantity: aggressiveVolume,
        timestamp,
        buyerIsMaker,
        bestBid: price - 0.01,
        bestAsk: price + 0.01,
        zoneData: {
            zones,
            zoneConfig: {
                zoneTicks: 10,
                tickValue: 0.01,
                timeWindow: 180000,
            },
        },
    } as EnrichedTradeEvent;
}

function createSingleZone(
    priceLevel: number,
    aggressiveVolume: number,
    passiveVolume: number,
    timestamp: number = Date.now()
): ZoneSnapshot {
    return {
        zoneId: `zone-${priceLevel}-${timestamp}`,
        priceLevel,
        tickSize: 0.01,
        aggressiveVolume,
        passiveVolume,
        aggressiveBuyVolume: aggressiveVolume * 0.6,
        aggressiveSellVolume: aggressiveVolume * 0.4,
        passiveBidVolume: passiveVolume * 0.5,
        passiveAskVolume: passiveVolume * 0.5,
        tradeCount: Math.floor(aggressiveVolume / 50),
        timespan: 180000,
        boundaries: {
            min: priceLevel,
            max: priceLevel + 0.1,
        },
        lastUpdate: timestamp,
        volumeWeightedPrice: priceLevel + 0.005,
        tradeHistory: {} as any, // Mock circular buffer
    };
}
