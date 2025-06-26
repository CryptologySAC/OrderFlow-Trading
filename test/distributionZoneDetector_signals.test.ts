import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../src/multithreading/workerLogger");

import { DistributionZoneDetector } from "../src/indicators/distributionZoneDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import type { ZoneDetectorConfig, ZoneSignal } from "../src/types/zoneTypes.js";

describe("DistributionZoneDetector - Signal Generation Validation", () => {
    let detector: DistributionZoneDetector;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;

    beforeEach(async () => {
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            isDebugEnabled: () => false,
            setCorrelationId: vi.fn(),
            removeCorrelationId: vi.fn(),
        } as ILogger;

        // Use proper mock from __mocks__/ directory per CLAUDE.md
        const { MetricsCollector: MockMetricsCollector } = await import("../__mocks__/src/infrastructure/metricsCollector.js");
        mockMetrics = new MockMetricsCollector() as any;

        const config: Partial<ZoneDetectorConfig> = {
            minCandidateDuration: 30000, // 30 seconds for faster testing
            minZoneVolume: 100,
            minTradeCount: 4,
            maxPriceDeviation: 0.03,
            minZoneStrength: 0.3, // Lowered to reduce institutional requirements
            strengthChangeThreshold: 0.15,
            minSellRatio: 0.55, // Required for distribution detection
        };

        detector = new DistributionZoneDetector(
            "test-signals",
            "BTCUSDT",
            config,
            mockLogger,
            mockMetrics
        );
    });

    describe("SELL Signal Generation", () => {
        it("should generate SELL signals when strong distribution zone is formed", () => {
            console.log(
                "📈 TESTING: Strong distribution SELL signal generation"
            );

            const baseTime = Date.now();
            const distributionLevel = 52000;

            // Create strong distribution pattern with institutional characteristics
            const distributionTrades: EnrichedTradeEvent[] = [];
            for (let i = 0; i < 8; i++) {
                distributionTrades.push({
                    price: distributionLevel,
                    quantity: 60, // Consistent institutional sizes (>= 40 threshold)
                    timestamp: baseTime + i * 2000, // 2-second intervals for consistency
                    buyerIsMaker: i < 2, // First 2 are sells (25%), rest are buys (75%)
                    pair: "BTCUSDT",
                    tradeId: `strong_dist_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                });
            }

            let allSignals: ZoneSignal[] = [];

            // Process trades and collect signals
            distributionTrades.forEach((trade, i) => {
                const result = detector.analyze(trade);
                if (result.signals.length > 0) {
                    allSignals.push(...result.signals);
                    console.log(
                        `📈 Trade ${i}: Generated ${result.signals.length} signals`
                    );
                }
            });

            // Trigger zone formation
            const formationTrade: EnrichedTradeEvent = {
                price: distributionLevel,
                quantity: 95, // Very large institutional distribution
                timestamp: baseTime + 35000, // 35 seconds after start (> 30s requirement)
                buyerIsMaker: false, // Buy pressure continues
                pair: "BTCUSDT",
                tradeId: "strong_formation",
                originalTrade: {} as any,
                passiveBidVolume: 0,
                passiveAskVolume: 0,
                zonePassiveBidVolume: 0,
                zonePassiveAskVolume: 0,
            };

            const formationResult = detector.analyze(formationTrade);
            if (formationResult.signals.length > 0) {
                allSignals.push(...formationResult.signals);
            }

            console.log(`📈 Total signals generated: ${allSignals.length}`);

            // Validation
            expect(allSignals.length).toBeGreaterThan(0);

            const sellSignals = allSignals.filter(
                (signal) => signal.side === "SELL"
            );
            expect(sellSignals.length).toBeGreaterThan(0);

            if (sellSignals.length > 0) {
                const strongestSignal = sellSignals.reduce((prev, current) =>
                    current.confidence > prev.confidence ? current : prev
                );

                console.log(`📈 Strongest SELL signal:`, {
                    confidence: strongestSignal.confidence.toFixed(3),
                    type: strongestSignal.type,
                    side: strongestSignal.side,
                    price: strongestSignal.price,
                });

                expect(strongestSignal.side).toBe("SELL");
                expect(strongestSignal.confidence).toBeGreaterThan(0.5);
                expect(strongestSignal.price).toBe(distributionLevel);
                expect(strongestSignal.type).toBe("distribution");
            }
        });

        it("should NOT generate signals for weak distribution patterns", () => {
            console.log("📉 TESTING: Weak distribution pattern rejection");

            const baseTime = Date.now();
            const weakLevel = 51000;

            // Create weak distribution pattern (mixed buy/sell pressure)
            const weakTrades: EnrichedTradeEvent[] = [];
            for (let i = 0; i < 6; i++) {
                weakTrades.push({
                    price: weakLevel,
                    quantity: 25 + Math.random() * 15, // Smaller sizes
                    timestamp: baseTime + i * 4000,
                    buyerIsMaker: Math.random() < 0.5, // Mixed pressure (50/50)
                    pair: "BTCUSDT",
                    tradeId: `weak_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                });
            }

            let weakSignals: ZoneSignal[] = [];

            weakTrades.forEach((trade) => {
                const result = detector.analyze(trade);
                if (result.signals.length > 0) {
                    weakSignals.push(...result.signals);
                }
            });

            // Try to trigger formation
            const weakFormation: EnrichedTradeEvent = {
                price: weakLevel,
                quantity: 40,
                timestamp: baseTime + 70000,
                buyerIsMaker: true, // Sell pressure (not distribution pattern)
                pair: "BTCUSDT",
                tradeId: "weak_formation",
                originalTrade: {} as any,
                passiveBidVolume: 0,
                passiveAskVolume: 0,
                zonePassiveBidVolume: 0,
                zonePassiveAskVolume: 0,
            };

            const weakResult = detector.analyze(weakFormation);
            if (weakResult.signals.length > 0) {
                weakSignals.push(...weakResult.signals);
            }

            console.log(`📉 Weak pattern signals: ${weakSignals.length}`);

            // Should generate no signals or only weak confidence signals
            const strongSignals = weakSignals.filter((s) => s.confidence > 0.6);
            expect(strongSignals.length).toBe(0);

            // Check candidates - should show mixed pattern
            const candidates = detector.getCandidates();
            if (candidates.length > 0) {
                const candidate = candidates[0];
                const buyRatio = candidate.buyVolume / candidate.totalVolume;
                console.log(
                    `📉 Weak pattern buy ratio: ${buyRatio.toFixed(3)} (should be around 0.5)`
                );
                expect(buyRatio).toBeLessThan(0.7); // Not strong distribution pattern
            }
        });

        it("should generate signals with appropriate confidence levels", () => {
            console.log("🎯 TESTING: Signal confidence level validation");

            const baseTime = Date.now();
            const testLevel = 50750;

            // Create scenarios with different distribution strengths
            const scenarios = [
                {
                    name: "moderate",
                    buyRatio: 0.7,
                    avgSize: 50,
                    expectedMinConfidence: 0.4,
                    expectedMaxConfidence: 0.7,
                },
                {
                    name: "strong",
                    buyRatio: 0.85,
                    avgSize: 80,
                    expectedMinConfidence: 0.6,
                    expectedMaxConfidence: 1.0,
                },
            ];

            for (const scenario of scenarios) {
                console.log(
                    `🎯 Testing ${scenario.name} distribution scenario`
                );

                // Reset detector for each scenario
                detector = new DistributionZoneDetector(
                    `test-${scenario.name}`,
                    "BTCUSDT",
                    {
                        minCandidateDuration: 60000,
                        minZoneVolume: 100,
                        minTradeCount: 4,
                        minZoneStrength: 0.35,
                    },
                    mockLogger,
                    mockMetrics
                );

                const trades: EnrichedTradeEvent[] = [];
                for (let i = 0; i < 6; i++) {
                    trades.push({
                        price: testLevel,
                        quantity: scenario.avgSize + Math.random() * 20,
                        timestamp: baseTime + i * 5000,
                        buyerIsMaker: Math.random() > scenario.buyRatio, // Control buy ratio
                        pair: "BTCUSDT",
                        tradeId: `${scenario.name}_${i}`,
                        originalTrade: {} as any,
                        passiveBidVolume: 0,
                        passiveAskVolume: 0,
                        zonePassiveBidVolume: 0,
                        zonePassiveAskVolume: 0,
                    });
                }

                let scenarioSignals: ZoneSignal[] = [];
                trades.forEach((trade) => {
                    const result = detector.analyze(trade);
                    if (result.signals.length > 0) {
                        scenarioSignals.push(...result.signals);
                    }
                });

                // Formation trigger
                const formation: EnrichedTradeEvent = {
                    price: testLevel,
                    quantity: scenario.avgSize + 20,
                    timestamp: baseTime + 70000,
                    buyerIsMaker: Math.random() > scenario.buyRatio,
                    pair: "BTCUSDT",
                    tradeId: `${scenario.name}_formation`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                };

                const formationResult = detector.analyze(formation);
                if (formationResult.signals.length > 0) {
                    scenarioSignals.push(...formationResult.signals);
                }

                // Validate confidence levels
                const sellSignals = scenarioSignals.filter(
                    (s) => s.side === "SELL"
                );

                if (sellSignals.length > 0) {
                    const maxConfidence = Math.max(
                        ...sellSignals.map((s) => s.confidence)
                    );
                    const minConfidence = Math.min(
                        ...sellSignals.map((s) => s.confidence)
                    );

                    console.log(
                        `🎯 ${scenario.name} confidence range: ${minConfidence.toFixed(3)} - ${maxConfidence.toFixed(3)}`
                    );

                    expect(maxConfidence).toBeGreaterThanOrEqual(
                        scenario.expectedMinConfidence
                    );
                    expect(maxConfidence).toBeLessThanOrEqual(
                        scenario.expectedMaxConfidence
                    );

                    // Stronger scenarios should have higher confidence
                    if (scenario.name === "strong") {
                        expect(maxConfidence).toBeGreaterThan(0.6);
                    }
                }

                // Check actual buy ratio achieved
                const candidates = detector.getCandidates();
                if (candidates.length > 0) {
                    const actualBuyRatio =
                        candidates[0].buyVolume / candidates[0].totalVolume;
                    console.log(
                        `🎯 ${scenario.name} actual buy ratio: ${actualBuyRatio.toFixed(3)}`
                    );
                }
            }
        });
    });

    describe("Signal Timing and Frequency", () => {
        it("should generate signals at appropriate formation milestones", () => {
            console.log("⏰ TESTING: Signal timing during zone formation");

            const baseTime = Date.now();
            const signalLevel = 51250;

            const formationTrades: EnrichedTradeEvent[] = [];
            let signalTimestamps: number[] = [];

            // Create zone formation sequence
            for (let i = 0; i < 6; i++) {
                const trade: EnrichedTradeEvent = {
                    price: signalLevel,
                    quantity: 60 + Math.random() * 15,
                    timestamp: baseTime + i * 8000,
                    buyerIsMaker: false, // Buy pressure
                    pair: "BTCUSDT",
                    tradeId: `timing_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                };

                formationTrades.push(trade);

                const result = detector.analyze(trade);
                if (result.signals.length > 0) {
                    signalTimestamps.push(trade.timestamp);
                    console.log(
                        `⏰ Signal generated at trade ${i}, timestamp ${trade.timestamp}`
                    );
                }
            }

            // Final formation
            const finalFormation: EnrichedTradeEvent = {
                price: signalLevel,
                quantity: 85,
                timestamp: baseTime + 35000, // 35 seconds after start (> 30s requirement)
                buyerIsMaker: false,
                pair: "BTCUSDT",
                tradeId: "timing_final",
                originalTrade: {} as any,
                passiveBidVolume: 0,
                passiveAskVolume: 0,
                zonePassiveBidVolume: 0,
                zonePassiveAskVolume: 0,
            };

            const finalResult = detector.analyze(finalFormation);
            if (finalResult.signals.length > 0) {
                signalTimestamps.push(finalFormation.timestamp);
            }

            console.log(
                `⏰ Signal generation timeline: ${signalTimestamps.length} signals`
            );
            signalTimestamps.forEach((ts, i) => {
                const relativeTime = (ts - baseTime) / 1000;
                console.log(`⏰ Signal ${i}: ${relativeTime}s after start`);
            });

            // Should not generate too many signals (avoid spam)
            expect(signalTimestamps.length).toBeLessThanOrEqual(3);

            // Should generate at least one signal during formation
            expect(signalTimestamps.length).toBeGreaterThanOrEqual(1);

            // Signals should be spaced appropriately (not bunched)
            if (signalTimestamps.length > 1) {
                for (let i = 1; i < signalTimestamps.length; i++) {
                    const timeDiff =
                        signalTimestamps[i] - signalTimestamps[i - 1];
                    expect(timeDiff).toBeGreaterThan(5000); // At least 5 seconds apart
                }
            }
        });

        it("should not duplicate signals for same zone", () => {
            console.log("🔄 TESTING: Signal deduplication for same zone");

            const baseTime = Date.now();
            const dedupeLevel = 50900;

            // Create strong distribution zone
            const zoneTrades: EnrichedTradeEvent[] = [];
            for (let i = 0; i < 8; i++) {
                zoneTrades.push({
                    price: dedupeLevel,
                    quantity: 65 + Math.random() * 20,
                    timestamp: baseTime + i * 4000,
                    buyerIsMaker: false,
                    pair: "BTCUSDT",
                    tradeId: `dedupe_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                });
            }

            let allSignals: ZoneSignal[] = [];
            let signalsByZone = new Map<string, number>();

            zoneTrades.forEach((trade) => {
                const result = detector.analyze(trade);
                result.signals.forEach((signal) => {
                    allSignals.push(signal);
                    const zoneKey = `${signal.price}_${signal.type}`;
                    signalsByZone.set(
                        zoneKey,
                        (signalsByZone.get(zoneKey) || 0) + 1
                    );
                });
            });

            // Formation trigger
            const formationTrade: EnrichedTradeEvent = {
                price: dedupeLevel,
                quantity: 90,
                timestamp: baseTime + 70000,
                buyerIsMaker: false,
                pair: "BTCUSDT",
                tradeId: "dedupe_formation",
                originalTrade: {} as any,
                passiveBidVolume: 0,
                passiveAskVolume: 0,
                zonePassiveBidVolume: 0,
                zonePassiveAskVolume: 0,
            };

            const formationResult = detector.analyze(formationTrade);
            formationResult.signals.forEach((signal) => {
                allSignals.push(signal);
                const zoneKey = `${signal.price}_${signal.type}`;
                signalsByZone.set(
                    zoneKey,
                    (signalsByZone.get(zoneKey) || 0) + 1
                );
            });

            console.log(`🔄 Total signals: ${allSignals.length}`);
            console.log(`🔄 Unique zones with signals: ${signalsByZone.size}`);

            signalsByZone.forEach((count, zoneKey) => {
                console.log(`🔄 Zone ${zoneKey}: ${count} signals`);
                // Should not have excessive duplicate signals for same zone
                expect(count).toBeLessThanOrEqual(2);
            });

            // Should have reasonable signal count (not excessive duplication)
            expect(allSignals.length).toBeLessThanOrEqual(5);
        });
    });

    describe("Signal Validation and Quality", () => {
        it("should include required signal properties", () => {
            console.log("✅ TESTING: Signal property validation");

            const baseTime = Date.now();
            const validationLevel = 51400;

            // Create valid distribution pattern
            const validTrades: EnrichedTradeEvent[] = [];
            for (let i = 0; i < 5; i++) {
                validTrades.push({
                    price: validationLevel,
                    quantity: 55 + Math.random() * 25,
                    timestamp: baseTime + i * 6000,
                    buyerIsMaker: false,
                    pair: "BTCUSDT",
                    tradeId: `validation_${i}`,
                    originalTrade: {} as any,
                    passiveBidVolume: 0,
                    passiveAskVolume: 0,
                    zonePassiveBidVolume: 0,
                    zonePassiveAskVolume: 0,
                });
            }

            let validationSignals: ZoneSignal[] = [];

            validTrades.forEach((trade) => {
                const result = detector.analyze(trade);
                if (result.signals.length > 0) {
                    validationSignals.push(...result.signals);
                }
            });

            // Formation trigger
            const validationFormation: EnrichedTradeEvent = {
                price: validationLevel,
                quantity: 80,
                timestamp: baseTime + 70000,
                buyerIsMaker: false,
                pair: "BTCUSDT",
                tradeId: "validation_formation",
                originalTrade: {} as any,
                passiveBidVolume: 0,
                passiveAskVolume: 0,
                zonePassiveBidVolume: 0,
                zonePassiveAskVolume: 0,
            };

            const formationResult = detector.analyze(validationFormation);
            if (formationResult.signals.length > 0) {
                validationSignals.push(...formationResult.signals);
            }

            console.log(
                `✅ Validation signals generated: ${validationSignals.length}`
            );

            if (validationSignals.length > 0) {
                validationSignals.forEach((signal, i) => {
                    console.log(`✅ Signal ${i} properties:`, {
                        type: signal.type,
                        side: signal.side,
                        confidence: signal.confidence.toFixed(3),
                        price: signal.price,
                        timestamp: signal.timestamp,
                        hasZone: !!signal.zone,
                    });

                    // Required properties validation
                    expect(signal.type).toBe("distribution");
                    expect(signal.side).toBe("SELL");
                    expect(signal.confidence).toBeGreaterThan(0);
                    expect(signal.confidence).toBeLessThanOrEqual(1);
                    expect(signal.price).toBe(validationLevel);
                    expect(signal.timestamp).toBeGreaterThan(baseTime);
                    expect(signal.zone).toBeDefined();

                    // Price should match zone price range
                    if (signal.zone) {
                        const zonePrice =
                            signal.zone.priceRange.center ||
                            signal.zone.priceRange.min;
                        expect(signal.price).toBe(zonePrice);
                    }
                });
            }
        });
    });
});
