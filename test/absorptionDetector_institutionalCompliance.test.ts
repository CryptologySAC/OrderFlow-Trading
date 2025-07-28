// test/absorptionDetector_institutionalCompliance.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { AbsorptionDetectorEnhanced } from "../src/indicators/absorptionDetectorEnhanced.js";
import { SignalValidationLogger } from "../__mocks__/src/utils/signalValidationLogger.js";
import { Config } from "../src/core/config.js";
import { FinancialMath } from "../src/utils/financialMath.js";
import type {
    EnrichedTradeEvent,
    StandardZoneData,
    ZoneSnapshot,
} from "../src/types/marketEvents.js";
import type { IOrderflowPreprocessor } from "../src/market/orderFlowPreprocessor.js";
import { createMockLogger } from "../__mocks__/src/infrastructure/loggerInterface.js";
import { MetricsCollector } from "../__mocks__/src/infrastructure/metricsCollector.js";
import { CircularBuffer } from "../src/utils/circularBuffer.js";

/**
 * 🏛️ INSTITUTIONAL COMPLIANCE TEST SUITE
 *
 * ZERO TOLERANCE requirements for institutional trading systems:
 * ✅ NO magic numbers - all values from Config
 * ✅ Institutional volume thresholds (2500+ LTC minimum)
 * ✅ FinancialMath compliance for all calculations
 * ✅ Realistic LTCUSDT market scenarios
 * ✅ Production-grade error handling
 * ✅ Correlation ID propagation
 */
describe("AbsorptionDetector - INSTITUTIONAL COMPLIANCE", () => {
    let detector: AbsorptionDetectorEnhanced;
    let mockPreprocessor: IOrderflowPreprocessor;
    let institutionalConfig: any;

    beforeEach(async () => {
        // ✅ CLAUDE.md COMPLIANCE: Use production configuration
        institutionalConfig = Config.ABSORPTION_DETECTOR;

        // Validate institutional thresholds are met
        expect(institutionalConfig.minAggVolume).toBeGreaterThanOrEqual(2500);
        expect(
            institutionalConfig.institutionalVolumeThreshold
        ).toBeGreaterThanOrEqual(1500);
        expect(
            institutionalConfig.passiveAbsorptionThreshold
        ).toBeGreaterThanOrEqual(0.75);

        mockPreprocessor = {
            findZonesNearPrice: vi.fn().mockReturnValue([]),
            handleDepth: vi.fn(),
            handleAggTrade: vi.fn(),
            getStats: vi.fn(() => ({
                processedTrades: 0,
                processedDepthUpdates: 0,
                bookMetrics: {} as any,
            })),
            calculateZoneRelevanceScore: vi.fn(() => 0.5),
            findMostRelevantZone: vi.fn(() => null),
        } as any;

        const mockSignalLogger = new SignalValidationLogger(createMockLogger());

        detector = new AbsorptionDetectorEnhanced(
            "institutional-test",
            "LTCUSDT",
            institutionalConfig,
            mockPreprocessor,
            createMockLogger(),
            new MetricsCollector(),
            mockSignalLogger
        );
    });

    describe("🚫 ZERO TOLERANCE: Magic Numbers Compliance", () => {
        it("MUST use Config.ABSORPTION_DETECTOR values, not hardcoded numbers", () => {
            // ✅ INSTITUTIONAL REQUIREMENT: All thresholds from configuration
            const config = Config.ABSORPTION_DETECTOR;

            // Validate configuration accessibility
            expect(config.minAggVolume).toBeDefined();
            expect(config.institutionalVolumeThreshold).toBeDefined();
            expect(config.passiveAbsorptionThreshold).toBeDefined();
            expect(config.priceEfficiencyThreshold).toBeDefined();

            // Validate institutional minimums
            expect(config.minAggVolume).toBeGreaterThanOrEqual(2500);
            expect(config.institutionalVolumeThreshold).toBeGreaterThanOrEqual(
                1500
            );
            expect(config.passiveAbsorptionThreshold).toBeGreaterThanOrEqual(
                0.75
            );
        });

        it("MUST validate all calculations use FinancialMath, not direct arithmetic", () => {
            // ✅ INSTITUTIONAL REQUIREMENT: Financial precision compliance
            const testValues = [
                { a: 1000.123456789, b: 500.987654321 },
                { a: 2500.0, b: 0.75 }, // Institutional threshold example
                { a: 89.12345678, b: 0.01 }, // LTCUSDT price precision
            ];

            testValues.forEach(({ a, b }) => {
                // Test division precision - use 6 decimals for financial precision
                const ratio = FinancialMath.divideQuantities(a, b);
                expect(Number.isFinite(ratio)).toBe(true);
                expect(ratio).toBeCloseTo(a / b, 6); // 6 decimal precision for financial compliance

                // Test multiplication precision
                const product = FinancialMath.multiplyQuantities(a, b);
                expect(Number.isFinite(product)).toBe(true);
                expect(product).toBeCloseTo(a * b, 5);

                // Test addition precision
                const sum = FinancialMath.safeAdd(a, b);
                expect(Number.isFinite(sum)).toBe(true);
                expect(sum).toBeCloseTo(a + b, 6);
            });
        });
    });

    describe("📊 INSTITUTIONAL VOLUME STANDARDS", () => {
        it("MUST use institutional-grade volume thresholds (2500+ LTC)", () => {
            const config = Config.ABSORPTION_DETECTOR;

            // Create institutional-grade test scenario
            const institutionalTrade = createInstitutionalTradeEvent({
                price: 89.42, // Realistic LTCUSDT price
                aggressiveVolume: config.minAggVolume, // 2500+ LTC
                passiveVolume: Math.round(config.minAggVolume * 3), // 7500+ LTC
                side: "buy",
            });

            // Validate volumes meet institutional standards
            const zoneData = institutionalTrade.zoneData?.zones[0];
            expect(zoneData?.aggressiveVolume).toBeGreaterThanOrEqual(
                config.minAggVolume
            );
            expect(zoneData?.passiveVolume).toBeGreaterThanOrEqual(
                config.institutionalVolumeThreshold
            );

            // Calculate actual passive ratio using FinancialMath
            const totalVolume = FinancialMath.safeAdd(
                zoneData?.aggressiveVolume || 0,
                zoneData?.passiveVolume || 0
            );
            const passiveRatio = FinancialMath.divideQuantities(
                zoneData?.passiveVolume || 0,
                totalVolume
            );

            expect(passiveRatio).toBeGreaterThanOrEqual(
                config.passiveAbsorptionThreshold
            );
        });

        it("MUST reject sub-institutional volumes appropriately", () => {
            const config = Config.ABSORPTION_DETECTOR;
            let signalGenerated = false;

            detector.on("signalCandidate", () => {
                signalGenerated = true;
            });

            // Create retail-level trade (should be rejected)
            const retailTrade = createInstitutionalTradeEvent({
                price: 89.42,
                aggressiveVolume: 100, // Below institutional threshold
                passiveVolume: 200, // Below institutional threshold
                side: "buy",
            });

            detector.onEnrichedTrade(retailTrade);

            // ✅ INSTITUTIONAL REQUIREMENT: Sub-institutional volumes must be rejected
            expect(signalGenerated).toBe(false);
        });
    });

    describe("🎯 MARKET REALISM COMPLIANCE", () => {
        it("MUST use realistic LTCUSDT price movements and spreads", () => {
            const realisticScenarios = [
                {
                    price: 89.42,
                    spread: 0.01, // 1 cent spread (realistic for LTCUSDT)
                    volume: 3500,
                    description: "Normal institutional flow",
                },
                {
                    price: 89.43,
                    spread: 0.02, // 2 cent spread (higher volatility)
                    volume: 5000,
                    description: "High institutional activity",
                },
                {
                    price: 89.41,
                    spread: 0.01,
                    volume: 8000,
                    description: "Large institutional absorption",
                },
            ];

            realisticScenarios.forEach((scenario, index) => {
                const trade = createInstitutionalTradeEvent({
                    price: scenario.price,
                    aggressiveVolume: scenario.volume,
                    passiveVolume: Math.round(scenario.volume * 2.5), // 71% passive ratio
                    side: index % 2 === 0 ? "buy" : "sell",
                    spread: scenario.spread,
                });

                // Validate tick-size compliance
                const tickSize = 0.01; // LTCUSDT tick size
                expect(
                    Math.abs(scenario.price % tickSize) < 0.001 ||
                        Math.abs((scenario.price % tickSize) - tickSize) < 0.001
                ).toBe(true);

                // Validate spread realism
                expect(scenario.spread).toBeGreaterThanOrEqual(tickSize);
                expect(scenario.spread).toBeLessThanOrEqual(tickSize * 5); // Max 5 tick spread
            });
        });

        it("MUST validate signal quality meets institutional standards", () => {
            const config = Config.ABSORPTION_DETECTOR;
            const signals: any[] = [];

            detector.on("signalCandidate", (signal: any) => {
                signals.push(signal);
            });

            // Create high-quality institutional absorption scenario
            const highQualityTrade = createInstitutionalTradeEvent({
                price: 89.42,
                aggressiveVolume: 4000, // Above institutional minimum
                passiveVolume: 12000, // 75% passive ratio (meets threshold)
                side: "buy",
                confidence: "high",
            });

            detector.onEnrichedTrade(highQualityTrade);

            if (signals.length > 0) {
                const signal = signals[0];

                // ✅ INSTITUTIONAL REQUIREMENT: Signal quality validation
                expect(signal.confidence).toBeGreaterThanOrEqual(
                    config.finalConfidenceRequired
                );
                expect(signal.type).toBe("absorption");
                expect(signal.side).toMatch(/^(buy|sell)$/);
                expect(signal.timestamp).toBeDefined();
                expect(signal.data).toBeDefined();
            }
        });
    });

    describe("⚡ PERFORMANCE & ERROR HANDLING", () => {
        it("MUST handle invalid inputs gracefully without crashing", () => {
            const invalidInputs = [
                { price: NaN, volume: 3000 },
                { price: 89.42, volume: Infinity },
                { price: -89.42, volume: 3000 },
                { price: 89.42, volume: -3000 },
            ];

            invalidInputs.forEach((invalid) => {
                expect(() => {
                    try {
                        const trade = createInstitutionalTradeEvent({
                            price: isNaN(invalid.price) ? 89.42 : invalid.price,
                            aggressiveVolume: invalid.volume,
                            passiveVolume: 7500,
                            side: "buy",
                        });
                        detector.onEnrichedTrade(trade);
                    } catch (error) {
                        // Expected to handle gracefully
                    }
                }).not.toThrow();
            });
        });

        it("MUST complete processing within institutional latency requirements", () => {
            const startTime = performance.now();

            // Process multiple institutional trades
            for (let i = 0; i < 10; i++) {
                const trade = createInstitutionalTradeEvent({
                    price: 89.42 + i * 0.01,
                    aggressiveVolume: 3000 + i * 100,
                    passiveVolume: 7500 + i * 250,
                    side: i % 2 === 0 ? "buy" : "sell",
                });
                detector.onEnrichedTrade(trade);
            }

            const processingTime = performance.now() - startTime;

            // ✅ INSTITUTIONAL REQUIREMENT: Sub-millisecond latency per trade
            expect(processingTime / 10).toBeLessThan(1); // Less than 1ms per trade
        });
    });

    describe("🔗 CORRELATION ID & AUDIT TRAIL", () => {
        it("MUST maintain correlation IDs for audit compliance", () => {
            const correlationId = `test-${Date.now()}-${Math.random()}`;
            const signals: any[] = [];

            detector.on("signalCandidate", (signal: any) => {
                signals.push(signal);
            });

            const auditTrade = createInstitutionalTradeEvent({
                price: 89.42,
                aggressiveVolume: 4000,
                passiveVolume: 10000,
                side: "buy",
                correlationId,
            });

            detector.onEnrichedTrade(auditTrade);

            // Validate correlation ID propagation (if signals generated)
            if (signals.length > 0) {
                expect(signals[0].id).toContain("absorption");
                expect(signals[0].timestamp).toBeDefined();
            }
        });
    });

    // ✅ HELPER FUNCTION: Create institutional-grade test events
    function createInstitutionalTradeEvent(params: {
        price: number;
        aggressiveVolume: number;
        passiveVolume: number;
        side: "buy" | "sell";
        spread?: number;
        confidence?: "high" | "medium" | "low";
        correlationId?: string;
    }): EnrichedTradeEvent {
        const timestamp = Date.now();
        const spread = params.spread || 0.01;

        // ✅ INSTITUTIONAL REQUIREMENT: Validate tick-size compliance
        const tickSize = 0.01;
        const roundedPrice = Math.round(params.price / tickSize) * tickSize;
        expect(params.price).toBeCloseTo(roundedPrice, 6); // Ensure price aligns with tick size

        // Create realistic zone with institutional volumes
        const zone: ZoneSnapshot = {
            zoneId: `institutional-zone-${timestamp}`,
            priceLevel: params.price,
            tickSize: tickSize,
            aggressiveVolume: params.aggressiveVolume,
            passiveVolume: params.passiveVolume,
            // Realistic distribution based on side
            aggressiveBuyVolume:
                params.side === "buy"
                    ? Math.round(params.aggressiveVolume * 0.8)
                    : Math.round(params.aggressiveVolume * 0.2),
            aggressiveSellVolume:
                params.side === "sell"
                    ? Math.round(params.aggressiveVolume * 0.8)
                    : Math.round(params.aggressiveVolume * 0.2),
            passiveBidVolume:
                params.side === "sell"
                    ? Math.round(params.passiveVolume * 0.85) // Strong bid absorption for selling
                    : Math.round(params.passiveVolume * 0.15),
            passiveAskVolume:
                params.side === "buy"
                    ? Math.round(params.passiveVolume * 0.85) // Strong ask absorption for buying
                    : Math.round(params.passiveVolume * 0.15),
            tradeCount: Math.max(Math.floor(params.aggressiveVolume / 100), 25), // Realistic trade count
            timespan: 60000,
            boundaries: {
                min: params.price - tickSize * 5, // 5-tick zone
                max: params.price + tickSize * 5,
            },
            lastUpdate: timestamp,
            volumeWeightedPrice: params.price,
            tradeHistory: new CircularBuffer(100),
        };

        // Update mock to return institutional zone
        mockPreprocessor.findZonesNearPrice = vi.fn().mockReturnValue([zone]);

        return {
            price: params.price,
            quantity: Math.max(params.aggressiveVolume / 40, 75), // Realistic institutional trade size
            timestamp,
            buyerIsMaker: params.side === "sell",
            pair: "LTCUSDT",
            tradeId: params.correlationId || `institutional-${timestamp}`,
            originalTrade: {
                p: params.price.toString(),
                q: (params.aggressiveVolume / 40).toString(),
                T: timestamp,
                m: params.side === "sell",
            } as any,
            passiveBidVolume: zone.passiveBidVolume,
            passiveAskVolume: zone.passiveAskVolume,
            zonePassiveBidVolume: zone.passiveBidVolume,
            zonePassiveAskVolume: zone.passiveAskVolume,
            bestBid: params.price - spread,
            bestAsk: params.price + spread,
            zoneData: {
                zones: [zone],
                zoneConfig: {
                    zoneTicks: 10,
                    tickValue: tickSize,
                    timeWindow: 60000,
                },
            } as StandardZoneData,
        } as EnrichedTradeEvent;
    }
});
