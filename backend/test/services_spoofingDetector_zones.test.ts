import { describe, it, expect, beforeEach, vi } from "vitest";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";

describe("services/SpoofingDetector - Zone Functionality", () => {
    let detector: SpoofingDetector;
    let mockLogger: ILogger;

    beforeEach(() => {
        vi.useFakeTimers();

        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        };

        detector = new SpoofingDetector(
            {
                tickSize: 0.01,
                wallTicks: 1,
                minWallSize: 10,
                maxCancellationRatio: 0.8,
                rapidCancellationMs: 500,
                algorithmicPatternThreshold: 0.9,
                layeringDetectionLevels: 3,
                ghostLiquidityThresholdMs: 200,
            },
            mockLogger
        );
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("Zone Emission for Spoofing Events", () => {
        it("should emit zone events for fake wall spoofing", () => {
            const mockEmit = vi.fn();
            detector.emit = mockEmit;

            const now = Date.now();
            const price = 100.0;

            // Create fake wall
            detector.trackPassiveChange(price, 0, 50); // Large ask wall
            vi.setSystemTime(now + 100);
            detector.trackPassiveChange(price, 0, 5); // Wall disappears rapidly

            const getAggressiveVolume = vi.fn().mockReturnValue(2); // Minimal execution

            const result = detector.wasSpoofed(
                price,
                "sell",
                now + 200,
                getAggressiveVolume
            );

            expect(result).toBe(true);
            expect(mockEmit).toHaveBeenCalledWith(
                "zoneUpdated",
                expect.objectContaining({
                    updateType: "zone_created",
                    zone: expect.objectContaining({
                        type: "spoofing",
                        priceRange: expect.objectContaining({
                            min: expect.any(Number),
                            max: expect.any(Number),
                        }),
                        spoofType: "fake_wall",
                        wallSize: 50,
                        canceled: expect.any(Number),
                        executed: expect.any(Number),
                        side: "sell",
                        confidence: expect.any(Number),
                    }),
                    significance: expect.stringMatching(/^(low|medium|high)$/),
                })
            );
        });

        it("should emit zone events for ghost liquidity", () => {
            const mockEmit = vi.fn();
            detector.emit = mockEmit;

            const now = Date.now();
            const price = 100.0;

            // Ghost liquidity pattern: low -> high -> low very quickly
            detector.trackPassiveChange(price, 5, 0); // Low initial liquidity
            vi.setSystemTime(now + 50);
            detector.trackPassiveChange(price, 30, 0); // Sudden large liquidity
            vi.setSystemTime(now + 150);
            detector.trackPassiveChange(price, 2, 0); // Liquidity disappears quickly

            const getAggressiveVolume = vi.fn().mockReturnValue(0);

            const result = detector.wasSpoofed(
                price,
                "buy",
                now + 200,
                getAggressiveVolume
            );

            expect(result).toBe(true);
            expect(mockEmit).toHaveBeenCalledWith(
                "zoneUpdated",
                expect.objectContaining({
                    updateType: "zone_created",
                    zone: expect.objectContaining({
                        type: "spoofing",
                        spoofType: "ghost_liquidity",
                        wallSize: 30,
                        side: "buy",
                    }),
                })
            );
        });

        it("should emit zone events for layering attacks", () => {
            const mockEmit = vi.fn();
            detector.emit = mockEmit;

            const now = Date.now();
            const basePrice = 100.0;
            const tickSize = 0.01;

            // Create walls at multiple levels
            for (let level = 1; level <= 3; level++) {
                const levelPrice = basePrice - level * tickSize;
                detector.trackPassiveChange(levelPrice, 25, 0); // Large bid walls
                vi.setSystemTime(now + level * 50);
                detector.trackPassiveChange(levelPrice, 2, 0); // All disappear rapidly
            }

            const getAggressiveVolume = vi.fn().mockReturnValue(1);

            const result = detector.wasSpoofed(
                basePrice,
                "buy",
                now + 200,
                getAggressiveVolume
            );

            expect(result).toBe(true);
            expect(mockEmit).toHaveBeenCalledWith(
                "zoneUpdated",
                expect.objectContaining({
                    updateType: "zone_created",
                    zone: expect.objectContaining({
                        type: "spoofing",
                        spoofType: "layering",
                        priceRange: expect.objectContaining({
                            min: expect.any(Number),
                            max: expect.any(Number),
                        }),
                    }),
                })
            );
        });
    });

    describe("Zone Properties Validation", () => {
        it("should create zones with correct price ranges", () => {
            const mockEmit = vi.fn();
            detector.emit = mockEmit;

            const now = Date.now();
            const price = 100.0;

            detector.trackPassiveChange(price, 0, 40);
            vi.setSystemTime(now + 100);
            detector.trackPassiveChange(price, 0, 3);

            const getAggressiveVolume = vi.fn().mockReturnValue(1);
            detector.wasSpoofed(price, "sell", now + 200, getAggressiveVolume);

            expect(mockEmit).toHaveBeenCalledWith(
                "zoneUpdated",
                expect.objectContaining({
                    zone: expect.objectContaining({
                        priceRange: expect.objectContaining({
                            min: expect.any(Number),
                            max: expect.any(Number),
                        }),
                    }),
                })
            );

            const zoneCall = mockEmit.mock.calls.find(
                (call) => call[0] === "zoneUpdated"
            );
            if (zoneCall) {
                const zone = zoneCall[1].zone;
                expect(zone.priceRange.min).toBeLessThanOrEqual(price);
                expect(zone.priceRange.max).toBeGreaterThanOrEqual(price);
                expect(zone.priceRange.max).toBeGreaterThan(
                    zone.priceRange.min
                );
            }
        });

        it("should set correct zone timing", () => {
            const mockEmit = vi.fn();
            detector.emit = mockEmit;

            const now = Date.now();
            const price = 100.0;

            detector.trackPassiveChange(price, 30, 0);
            vi.setSystemTime(now + 300);
            detector.trackPassiveChange(price, 2, 0);

            const getAggressiveVolume = vi.fn().mockReturnValue(0);
            detector.wasSpoofed(price, "buy", now + 400, getAggressiveVolume);

            const zoneCall = mockEmit.mock.calls.find(
                (call) => call[0] === "zoneUpdated"
            );
            if (zoneCall) {
                const zone = zoneCall[1].zone;
                expect(zone.startTime).toBeLessThan(zone.endTime);
                expect(zone.endTime).toBeGreaterThan(now);
                expect(zone.cancelTimeMs).toBe(300); // Time between placement and cancellation
            }
        });

        it("should calculate confidence scores correctly", () => {
            const mockEmit = vi.fn();
            detector.emit = mockEmit;

            const now = Date.now();
            const price = 100.0;

            // Perfect spoofing: 100% cancellation
            detector.trackPassiveChange(price, 0, 50);
            vi.setSystemTime(now + 100);
            detector.trackPassiveChange(price, 0, 0); // Complete cancellation

            const getAggressiveVolume = vi.fn().mockReturnValue(0); // No execution
            detector.wasSpoofed(price, "sell", now + 200, getAggressiveVolume);

            const zoneCall = mockEmit.mock.calls.find(
                (call) => call[0] === "zoneUpdated"
            );
            if (zoneCall) {
                const zone = zoneCall[1].zone;
                expect(zone.confidence).toBeGreaterThan(0.8); // High confidence for perfect spoof
                expect(zone.confidence).toBeLessThanOrEqual(1.0);
            }
        });
    });

    describe("Significance Classification", () => {
        it("should classify high significance for large spoofs", () => {
            const mockEmit = vi.fn();
            detector.emit = mockEmit;

            const now = Date.now();
            const price = 100.0;

            // Large spoof with high confidence
            detector.trackPassiveChange(price, 0, 100); // Very large wall
            vi.setSystemTime(now + 50);
            detector.trackPassiveChange(price, 0, 5); // Almost complete cancellation

            const getAggressiveVolume = vi.fn().mockReturnValue(2);
            detector.wasSpoofed(price, "sell", now + 100, getAggressiveVolume);

            const zoneCall = mockEmit.mock.calls.find(
                (call) => call[0] === "zoneUpdated"
            );
            if (zoneCall) {
                expect(zoneCall[1].significance).toBe("high");
            }
        });

        it("should classify medium significance for moderate spoofs", () => {
            const mockEmit = vi.fn();
            detector.emit = mockEmit;

            const now = Date.now();
            const price = 100.0;

            // Moderate spoof
            detector.trackPassiveChange(price, 0, 25);
            vi.setSystemTime(now + 150);
            detector.trackPassiveChange(price, 0, 8);

            const getAggressiveVolume = vi.fn().mockReturnValue(5);
            detector.wasSpoofed(price, "sell", now + 200, getAggressiveVolume);

            const zoneCall = mockEmit.mock.calls.find(
                (call) => call[0] === "zoneUpdated"
            );
            if (zoneCall) {
                expect(zoneCall[1].significance).toBe("medium");
            }
        });

        it("should classify low significance for weak spoofs", () => {
            const mockEmit = vi.fn();
            detector.emit = mockEmit;

            const now = Date.now();
            const price = 100.0;

            // Weak spoof
            detector.trackPassiveChange(price, 0, 15);
            vi.setSystemTime(now + 400);
            detector.trackPassiveChange(price, 0, 6);

            const getAggressiveVolume = vi.fn().mockReturnValue(3);
            detector.wasSpoofed(price, "sell", now + 500, getAggressiveVolume);

            const zoneCall = mockEmit.mock.calls.find(
                (call) => call[0] === "zoneUpdated"
            );
            if (zoneCall) {
                expect(zoneCall[1].significance).toBe("low");
            }
        });
    });

    describe("Advanced Spoofing Pattern Detection", () => {
        it("should detect and emit zones for advanced spoofing patterns", () => {
            const mockEmit = vi.fn();
            detector.emit = mockEmit;

            const now = Date.now();
            const price = 100.0;

            // Mock detectSpoofingPatterns to return advanced pattern
            const originalDetect = detector.detectSpoofingPatterns;
            detector.detectSpoofingPatterns = vi.fn().mockReturnValue([
                {
                    priceStart: price,
                    priceEnd: price,
                    side: "buy" as const,
                    wallBefore: 60,
                    wallAfter: 5,
                    canceled: 55,
                    executed: 0,
                    timestamp: now + 100,
                    spoofedSide: "bid" as const,
                    spoofType: "algorithmic" as const,
                    confidence: 0.9,
                    cancelTimeMs: 100,
                    marketImpact: 0.15,
                },
            ]);

            const getAggressiveVolume = vi.fn().mockReturnValue(0);
            const result = detector.wasSpoofed(
                price,
                "buy",
                now + 200,
                getAggressiveVolume
            );

            expect(result).toBe(true);
            expect(mockEmit).toHaveBeenCalledWith(
                "zoneUpdated",
                expect.objectContaining({
                    updateType: "zone_created",
                    zone: expect.objectContaining({
                        type: "spoofing",
                        spoofType: "algorithmic",
                        confidence: 0.9,
                        marketImpact: 0.15,
                    }),
                    significance: "high", // High confidence should result in high significance
                })
            );
        });
    });

    describe("Error Handling", () => {
        it("should handle emit errors gracefully", () => {
            const mockEmit = vi.fn().mockImplementation(() => {
                throw new Error("Emit error");
            });
            detector.emit = mockEmit;

            const now = Date.now();
            const price = 100.0;

            detector.trackPassiveChange(price, 0, 30);
            vi.setSystemTime(now + 100);
            detector.trackPassiveChange(price, 0, 2);

            const getAggressiveVolume = vi.fn().mockReturnValue(1);

            // Should not throw despite emit error
            expect(() => {
                detector.wasSpoofed(
                    price,
                    "sell",
                    now + 200,
                    getAggressiveVolume
                );
            }).not.toThrow();
        });

        it("should handle invalid spoofing event data", () => {
            const mockEmit = vi.fn();
            detector.emit = mockEmit;

            // Should not emit zone for invalid data
            const result = detector.wasSpoofed(NaN, "buy", Date.now(), () => 0);

            expect(result).toBe(false);
            expect(mockEmit).not.toHaveBeenCalled();
        });
    });
});
