// test/baseDetector_zoneAPI.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { BaseDetector } from "../src/indicators/base/baseDetector.js";
import type {
    EnrichedTradeEvent,
    StandardZoneData,
    ZoneSnapshot,
} from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";
import type { SignalType } from "../src/types/signalTypes.js";

// Test implementation of BaseDetector
class TestDetector extends BaseDetector {
    protected readonly detectorType: SignalType = "absorption";

    protected onEnrichedTradeSpecific(): void {
        // Test implementation
    }

    protected getSignalType(): SignalType {
        return "absorption";
    }

    // Expose protected methods for testing
    public testGetStandardizedZones(event: EnrichedTradeEvent) {
        return this.getStandardizedZones(event);
    }

    public testGet5TickZones(event: EnrichedTradeEvent) {
        return this.get5TickZones(event);
    }

    public testGet10TickZones(event: EnrichedTradeEvent) {
        return this.get10TickZones(event);
    }

    public testGet20TickZones(event: EnrichedTradeEvent) {
        return this.get20TickZones(event);
    }

    public testGetAdaptiveZones(event: EnrichedTradeEvent) {
        return this.getAdaptiveZones(event);
    }

    public testFindZoneContainingPrice(zones: ZoneSnapshot[], price: number) {
        return this.findZoneContainingPrice(zones, price);
    }

    public testGetZonesNearPrice(
        zones: ZoneSnapshot[],
        centerPrice: number,
        maxDistance: number
    ) {
        return this.getZonesNearPrice(zones, centerPrice, maxDistance);
    }

    public testGetZonesByVolume(
        zones: ZoneSnapshot[],
        minVolume: number,
        volumeType?: "aggressive" | "passive" | "total"
    ) {
        return this.getZonesByVolume(zones, minVolume, volumeType);
    }

    public testCalculateZoneImbalance(zone: ZoneSnapshot) {
        return this.calculateZoneImbalance(zone);
    }

    public testCalculateZoneBuyRatio(zone: ZoneSnapshot) {
        return this.calculateZoneBuyRatio(zone);
    }

    public testGetZoneConfig(event: EnrichedTradeEvent) {
        return this.getZoneConfig(event);
    }

    public testHasStandardizedZones(event: EnrichedTradeEvent) {
        return this.hasStandardizedZones(event);
    }

    public testGetPreferredZones(event: EnrichedTradeEvent) {
        return this.getPreferredZones(event);
    }
}

describe("BaseDetector Zone API", () => {
    let detector: TestDetector;
    let mockLogger: ILogger;
    let mockMetricsCollector: IMetricsCollector;
    let mockSpoofingDetector: SpoofingDetector;

    // Real-world LTCUSDT data patterns based on market analysis
    const LTCUSDT_BASE_PRICE = 89.45;
    const LTCUSDT_TICK_SIZE = 0.01;
    const LTCUSDT_TYPICAL_SPREAD = 0.02;

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        };

        mockMetricsCollector = {
            incrementCounter: vi.fn(),
            updateMetric: vi.fn(),
            incrementMetric: vi.fn(),
            getMetrics: vi.fn(),
            addLatencyMeasurement: vi.fn(),
            trackMemoryUsage: vi.fn(),
            resetMetrics: vi.fn(),
        };

        mockSpoofingDetector = {
            wasSpoofed: vi.fn().mockReturnValue(false),
        } as any;

        detector = new TestDetector(
            "test-detector",
            {
                windowMs: 90000,
                minAggVolume: 600,
                pricePrecision: 2,
                zoneTicks: 5,
                eventCooldownMs: 15000,
            },
            mockLogger,
            mockSpoofingDetector,
            mockMetricsCollector
        );
    });

    // Helper function to create realistic LTCUSDT zone snapshots
    function createLTCUSDTZoneSnapshot(
        centerPrice: number,
        zoneTicks: number,
        aggressiveVol: number = 25.5,
        passiveBidVol: number = 45.2,
        passiveAskVol: number = 38.7
    ): ZoneSnapshot {
        const zoneSize = zoneTicks * LTCUSDT_TICK_SIZE;
        return {
            zoneId: `LTCUSDT_${zoneTicks}T_${centerPrice.toFixed(2)}`,
            priceLevel: centerPrice,
            tickSize: LTCUSDT_TICK_SIZE,
            aggressiveVolume: aggressiveVol,
            passiveVolume: passiveBidVol + passiveAskVol,
            aggressiveBuyVolume: aggressiveVol * 0.6, // 60% buy aggressive (realistic LTCUSDT)
            aggressiveSellVolume: aggressiveVol * 0.4, // 40% sell aggressive
            passiveBidVolume: passiveBidVol,
            passiveAskVolume: passiveAskVol,
            tradeCount: Math.floor(aggressiveVol / 2.71), // Based on 2.71 LTC avg trade size
            timespan: 300000, // 5 minutes
            boundaries: {
                min: centerPrice - zoneSize / 2,
                max: centerPrice + zoneSize / 2,
            },
            lastUpdate: Date.now(),
            volumeWeightedPrice: centerPrice + (Math.random() - 0.5) * 0.001, // Small VWAP deviation
        };
    }

    // Helper function to create realistic LTCUSDT enriched trade event
    function createLTCUSDTTradeEvent(
        includeZoneData: boolean = true
    ): EnrichedTradeEvent {
        const standardZoneData: StandardZoneData | undefined = includeZoneData
            ? {
                  zones5Tick: [
                      createLTCUSDTZoneSnapshot(89.4, 5, 32.1, 52.3, 41.7),
                      createLTCUSDTZoneSnapshot(89.45, 5, 45.8, 67.2, 58.9),
                      createLTCUSDTZoneSnapshot(89.5, 5, 28.4, 39.6, 44.1),
                  ],
                  zones10Tick: [
                      createLTCUSDTZoneSnapshot(89.4, 10, 67.5, 98.7, 87.3),
                      createLTCUSDTZoneSnapshot(89.5, 10, 54.2, 78.9, 72.1),
                  ],
                  zones20Tick: [
                      createLTCUSDTZoneSnapshot(89.45, 20, 145.8, 187.6, 165.4),
                  ],
                  adaptiveZones: [
                      createLTCUSDTZoneSnapshot(89.43, 7, 89.2, 123.4, 108.7), // 7-tick adaptive
                  ],
                  zoneConfig: {
                      baseTicks: 5,
                      tickValue: LTCUSDT_TICK_SIZE,
                      timeWindow: 300000,
                  },
              }
            : undefined;

        return {
            price: LTCUSDT_BASE_PRICE,
            quantity: 2.71, // Typical LTCUSDT trade size
            timestamp: Date.now(),
            buyerIsMaker: false, // Aggressive buy
            pair: "LTCUSDT",
            tradeId: "12345678",
            originalTrade: {} as any,
            passiveBidVolume: 45.2,
            passiveAskVolume: 38.7,
            zonePassiveBidVolume: 52.3,
            zonePassiveAskVolume: 41.7,
            bestBid: LTCUSDT_BASE_PRICE - LTCUSDT_TYPICAL_SPREAD / 2,
            bestAsk: LTCUSDT_BASE_PRICE + LTCUSDT_TYPICAL_SPREAD / 2,
            zoneData: standardZoneData,
        };
    }

    describe("Zone Data Access Methods", () => {
        it("should access standardized zones from trade event", () => {
            const tradeEvent = createLTCUSDTTradeEvent(true);
            const zones = detector.testGetStandardizedZones(tradeEvent);

            expect(zones).not.toBeNull();
            expect(zones?.zones5Tick).toHaveLength(3);
            expect(zones?.zones10Tick).toHaveLength(2);
            expect(zones?.zones20Tick).toHaveLength(1);
            expect(zones?.adaptiveZones).toHaveLength(1);
        });

        it("should return null when no zone data available", () => {
            const tradeEvent = createLTCUSDTTradeEvent(false);
            const zones = detector.testGetStandardizedZones(tradeEvent);

            expect(zones).toBeNull();
        });

        it("should get 5-tick zones with realistic LTCUSDT data", () => {
            const tradeEvent = createLTCUSDTTradeEvent(true);
            const zones5Tick = detector.testGet5TickZones(tradeEvent);

            expect(zones5Tick).toHaveLength(3);
            zones5Tick.forEach((zone) => {
                expect(zone.tickSize).toBe(LTCUSDT_TICK_SIZE);
                expect(zone.zoneId).toContain("5T");
                expect(zone.aggressiveVolume).toBeGreaterThan(0);
                expect(zone.passiveVolume).toBeGreaterThan(0);
                // Verify realistic LTCUSDT trade counts (based on 2.71 LTC avg size)
                expect(zone.tradeCount).toBeGreaterThan(5);
                expect(zone.tradeCount).toBeLessThan(50);
            });
        });

        it("should get 10-tick zones with proper volume aggregation", () => {
            const tradeEvent = createLTCUSDTTradeEvent(true);
            const zones10Tick = detector.testGet10TickZones(tradeEvent);

            expect(zones10Tick).toHaveLength(2);
            zones10Tick.forEach((zone) => {
                expect(zone.zoneId).toContain("10T");
                // 10-tick zones should have higher volume than 5-tick zones
                expect(zone.aggressiveVolume).toBeGreaterThan(50);
                expect(zone.passiveVolume).toBeGreaterThan(80);
            });
        });

        it("should get 20-tick zones for broader analysis", () => {
            const tradeEvent = createLTCUSDTTradeEvent(true);
            const zones20Tick = detector.testGet20TickZones(tradeEvent);

            expect(zones20Tick).toHaveLength(1);
            const zone = zones20Tick[0];
            expect(zone.zoneId).toContain("20T");
            // 20-tick zones should have significantly higher volume
            expect(zone.aggressiveVolume).toBeGreaterThan(100);
            expect(zone.passiveVolume).toBeGreaterThan(300);
        });

        it("should get adaptive zones when available", () => {
            const tradeEvent = createLTCUSDTTradeEvent(true);
            const adaptiveZones = detector.testGetAdaptiveZones(tradeEvent);

            expect(adaptiveZones).toHaveLength(1);
            const zone = adaptiveZones[0];
            expect(zone.aggressiveVolume).toBeGreaterThan(0);
            expect(zone.passiveVolume).toBeGreaterThan(0);
        });

        it("should return empty arrays when zone data is missing", () => {
            const tradeEvent = createLTCUSDTTradeEvent(false);

            expect(detector.testGet5TickZones(tradeEvent)).toEqual([]);
            expect(detector.testGet10TickZones(tradeEvent)).toEqual([]);
            expect(detector.testGet20TickZones(tradeEvent)).toEqual([]);
            expect(detector.testGetAdaptiveZones(tradeEvent)).toEqual([]);
        });
    });

    describe("Zone Search and Filtering Methods", () => {
        let zones: ZoneSnapshot[];

        beforeEach(() => {
            zones = [
                createLTCUSDTZoneSnapshot(89.4, 5, 32.1, 52.3, 41.7),
                createLTCUSDTZoneSnapshot(89.45, 5, 45.8, 67.2, 58.9),
                createLTCUSDTZoneSnapshot(89.5, 5, 28.4, 39.6, 44.1),
                createLTCUSDTZoneSnapshot(89.55, 5, 67.3, 78.9, 65.4),
            ];
        });

        it("should find zone containing specific LTCUSDT price", () => {
            // Test price within zone boundaries
            const targetPrice = 89.44; // Should be in 89.45 zone (±0.025 for 5-tick)
            const foundZone = detector.testFindZoneContainingPrice(
                zones,
                targetPrice
            );

            expect(foundZone).not.toBeNull();
            expect(foundZone?.priceLevel).toBe(89.45);
            expect(targetPrice).toBeGreaterThanOrEqual(
                foundZone!.boundaries.min
            );
            expect(targetPrice).toBeLessThanOrEqual(foundZone!.boundaries.max);
        });

        it("should return null for price outside all zones", () => {
            const outsidePrice = 90.0; // Far outside zone range
            const foundZone = detector.testFindZoneContainingPrice(
                zones,
                outsidePrice
            );

            expect(foundZone).toBeNull();
        });

        it("should find zones near price with realistic LTCUSDT distances", () => {
            const centerPrice = 89.45;
            const maxDistance = 0.08; // 8 ticks for LTCUSDT

            const nearbyZones = detector.testGetZonesNearPrice(
                zones,
                centerPrice,
                maxDistance
            );

            expect(nearbyZones.length).toBeGreaterThan(1);
            nearbyZones.forEach((zone) => {
                const distance = Math.abs(zone.priceLevel - centerPrice);
                expect(distance).toBeLessThanOrEqual(maxDistance);
            });
        });

        it("should filter zones by aggressive volume threshold", () => {
            const minVolume = 40.0; // Realistic LTCUSDT threshold
            const highVolumeZones = detector.testGetZonesByVolume(
                zones,
                minVolume,
                "aggressive"
            );

            expect(highVolumeZones.length).toBeGreaterThan(0);
            highVolumeZones.forEach((zone) => {
                expect(zone.aggressiveVolume).toBeGreaterThanOrEqual(minVolume);
            });
        });

        it("should filter zones by passive volume threshold", () => {
            const minVolume = 90.0; // Higher threshold for passive volume
            const highPassiveZones = detector.testGetZonesByVolume(
                zones,
                minVolume,
                "passive"
            );

            highPassiveZones.forEach((zone) => {
                expect(zone.passiveVolume).toBeGreaterThanOrEqual(minVolume);
            });
        });

        it("should filter zones by total volume (default behavior)", () => {
            const minVolume = 120.0; // Total volume threshold
            const highTotalZones = detector.testGetZonesByVolume(
                zones,
                minVolume
            );

            highTotalZones.forEach((zone) => {
                const totalVolume = zone.aggressiveVolume + zone.passiveVolume;
                expect(totalVolume).toBeGreaterThanOrEqual(minVolume);
            });
        });
    });

    describe("Zone Analysis Methods", () => {
        it("should calculate realistic LTCUSDT zone imbalance", () => {
            // Create zone with bid-dominant imbalance (typical during accumulation)
            const bidDominantZone = createLTCUSDTZoneSnapshot(
                89.45,
                5,
                32.1,
                75.2,
                45.8
            );
            const imbalance =
                detector.testCalculateZoneImbalance(bidDominantZone);

            expect(imbalance).toBeGreaterThan(0); // Positive = bid dominant
            expect(imbalance).toBeLessThanOrEqual(1);
            expect(imbalance).toBeCloseTo(0.242, 2); // (75.2 - 45.8) / (75.2 + 45.8)
        });

        it("should calculate zone imbalance for ask-dominant scenario", () => {
            // Create zone with ask-dominant imbalance (typical during distribution)
            const askDominantZone = createLTCUSDTZoneSnapshot(
                89.45,
                5,
                32.1,
                35.4,
                78.6
            );
            const imbalance =
                detector.testCalculateZoneImbalance(askDominantZone);

            expect(imbalance).toBeLessThan(0); // Negative = ask dominant
            expect(imbalance).toBeGreaterThanOrEqual(-1);
            expect(imbalance).toBeCloseTo(-0.378, 2); // (35.4 - 78.6) / (35.4 + 78.6)
        });

        it("should return null when no passive volume data available", () => {
            const emptyZone = createLTCUSDTZoneSnapshot(89.45, 5, 32.1, 0, 0);
            const imbalance = detector.testCalculateZoneImbalance(emptyZone);

            expect(imbalance).toBeNull(); // Cannot calculate without passive volume data
        });

        it("should calculate realistic LTCUSDT buy ratio", () => {
            // Create zone with realistic aggressive buy/sell distribution
            const zone = createLTCUSDTZoneSnapshot(89.45, 5);
            zone.aggressiveBuyVolume = 28.5; // 65% buy aggressive
            zone.aggressiveSellVolume = 15.3; // 35% sell aggressive

            const buyRatio = detector.testCalculateZoneBuyRatio(zone);

            expect(buyRatio).toBeGreaterThan(0.5); // Buy dominant
            expect(buyRatio).toBeLessThanOrEqual(1);
            expect(buyRatio).toBeCloseTo(0.651, 2); // 28.5 / (28.5 + 15.3)
        });

        it("should return null when no aggressive volume data available", () => {
            const zone = createLTCUSDTZoneSnapshot(89.45, 5);
            zone.aggressiveBuyVolume = 0;
            zone.aggressiveSellVolume = 0;

            const buyRatio = detector.testCalculateZoneBuyRatio(zone);

            expect(buyRatio).toBeNull(); // Cannot calculate without aggressive volume data
        });
    });

    describe("Zone Configuration and Utilities", () => {
        it("should get zone configuration from trade event", () => {
            const tradeEvent = createLTCUSDTTradeEvent(true);
            const config = detector.testGetZoneConfig(tradeEvent);

            expect(config).not.toBeNull();
            expect(config?.baseTicks).toBe(5);
            expect(config?.tickValue).toBe(LTCUSDT_TICK_SIZE);
            expect(config?.timeWindow).toBe(300000);
        });

        it("should detect presence of standardized zones", () => {
            const tradeWithZones = createLTCUSDTTradeEvent(true);
            const tradeWithoutZones = createLTCUSDTTradeEvent(false);

            expect(detector.testHasStandardizedZones(tradeWithZones)).toBe(
                true
            );
            expect(detector.testHasStandardizedZones(tradeWithoutZones)).toBe(
                false
            );
        });

        it("should select preferred zones based on detector configuration", () => {
            const tradeEvent = createLTCUSDTTradeEvent(true);

            // Test with 5-tick detector configuration
            const preferredZones = detector.testGetPreferredZones(tradeEvent);

            // Should return 5-tick zones since detector has zoneTicks = 5
            expect(preferredZones).toHaveLength(3);
            preferredZones.forEach((zone) => {
                expect(zone.zoneId).toContain("5T");
            });
        });
    });

    describe("Real-World LTCUSDT Market Scenarios", () => {
        it("should handle institutional volume concentration scenario", () => {
            // Simulate institutional accumulation at key level
            const institutionalZones = [
                createLTCUSDTZoneSnapshot(89.45, 5, 125.6, 234.7, 187.3), // Heavy institutional zone
                createLTCUSDTZoneSnapshot(89.5, 5, 12.4, 23.8, 19.6), // Light retail zone
                createLTCUSDTZoneSnapshot(89.4, 5, 108.9, 145.2, 123.4), // Medium institutional zone (increased to 108.9)
            ];

            const institutionalThreshold = 100.0; // Institutional volume threshold
            const heavyZones = detector.testGetZonesByVolume(
                institutionalZones,
                institutionalThreshold,
                "aggressive"
            );

            expect(heavyZones).toHaveLength(2); // Should find the institutional zones
            heavyZones.forEach((zone) => {
                expect(zone.aggressiveVolume).toBeGreaterThan(100);
            });
        });

        it("should analyze order flow imbalance during market stress", () => {
            // Simulate high-stress market with significant imbalances
            const stressZone = createLTCUSDTZoneSnapshot(
                89.45,
                5,
                89.7,
                234.6,
                78.4
            );
            const imbalance = detector.testCalculateZoneImbalance(stressZone);

            expect(Math.abs(imbalance)).toBeGreaterThan(0.3); // Significant imbalance
            expect(imbalance).toBeGreaterThan(0); // Bid dominant during this stress scenario
        });

        it("should handle multiple zone sizes during volatile periods", () => {
            const tradeEvent = createLTCUSDTTradeEvent(true);

            const zones5Tick = detector.testGet5TickZones(tradeEvent);
            const zones10Tick = detector.testGet10TickZones(tradeEvent);
            const zones20Tick = detector.testGet20TickZones(tradeEvent);

            // Verify volume aggregation across zone sizes
            expect(zones5Tick.length).toBeGreaterThan(zones10Tick.length);
            expect(zones10Tick.length).toBeGreaterThanOrEqual(
                zones20Tick.length
            );

            // Verify that larger zones contain more volume
            if (zones20Tick.length > 0 && zones5Tick.length > 0) {
                expect(zones20Tick[0].passiveVolume).toBeGreaterThan(
                    zones5Tick[0].passiveVolume
                );
            }
        });

        it("should maintain zone boundary integrity with LTCUSDT tick precision", () => {
            const zones = [
                createLTCUSDTZoneSnapshot(89.45, 5, 32.1, 52.3, 41.7),
                createLTCUSDTZoneSnapshot(89.5, 5, 28.4, 39.6, 44.1),
            ];

            zones.forEach((zone) => {
                const zoneSize = 5 * LTCUSDT_TICK_SIZE; // 0.05 for 5-tick zone
                const expectedMin = zone.priceLevel - zoneSize / 2;
                const expectedMax = zone.priceLevel + zoneSize / 2;

                expect(zone.boundaries.min).toBeCloseTo(expectedMin, 3);
                expect(zone.boundaries.max).toBeCloseTo(expectedMax, 3);
                expect(zone.boundaries.max - zone.boundaries.min).toBeCloseTo(
                    zoneSize,
                    3
                );
            });
        });
    });
});
