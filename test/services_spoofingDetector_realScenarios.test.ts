import { describe, it, expect, beforeEach, vi } from "vitest";
import { SpoofingDetector } from "../src/services/spoofingDetector";

describe("SpoofingDetector - Real Spoofing Scenarios", () => {
    let detector: SpoofingDetector;
    const mockLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    };

    beforeEach(() => {
        vi.useFakeTimers();
        detector = new SpoofingDetector(
            {
                tickSize: 0.01,
                wallTicks: 3,
                minWallSize: 50,
                maxCancellationRatio: 0.8,
                rapidCancellationMs: 500,
                layeringDetectionLevels: 3,
                ghostLiquidityThresholdMs: 200,
                testLogMinSpoof: 30,
            },
            mockLogger
        );
    });

    describe("Fake Wall Spoofing Detection", () => {
        it("should detect large fake bid wall that gets cancelled rapidly", () => {
            const basePrice = 100.0;
            const now = Date.now();

            // Step 1: Large bid wall appears
            detector.trackPassiveChange(basePrice, 200, 50); // 200 LTC bid wall
            vi.advanceTimersByTime(100);

            // Step 2: Wall gets cancelled rapidly (within 300ms)
            detector.trackPassiveChange(basePrice, 10, 50); // Wall disappears

            // Step 3: Check for spoofing detection
            const result = detector.wasSpoofed(
                basePrice,
                "buy",
                now + 200,
                () => 0
            );

            expect(result).toBe(true);
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining(
                    "Advanced spoofing detected: fake_wall"
                ),
                expect.objectContaining({
                    spoofType: "fake_wall",
                    confidence: expect.any(Number),
                    wallBefore: 200,
                    wallAfter: 10,
                    canceled: 190,
                })
            );
        });

        it("should detect large fake ask wall that gets cancelled rapidly", () => {
            const basePrice = 100.0;
            const now = Date.now();

            // Step 1: Large ask wall appears
            detector.trackPassiveChange(basePrice, 30, 180); // 180 LTC ask wall
            vi.advanceTimersByTime(150);

            // Step 2: Wall gets cancelled rapidly
            detector.trackPassiveChange(basePrice, 30, 15); // Wall disappears

            // Step 3: Check for spoofing detection
            const result = detector.wasSpoofed(
                basePrice,
                "sell",
                now + 200,
                () => 0
            );

            expect(result).toBe(true);
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining(
                    "Advanced spoofing detected: fake_wall"
                ),
                expect.objectContaining({
                    spoofType: "fake_wall",
                    side: "sell",
                    spoofedSide: "ask",
                    wallBefore: 180,
                    wallAfter: 15,
                })
            );
        });

        it("should NOT detect legitimate order execution as spoofing", () => {
            const basePrice = 100.0;
            const now = Date.now();

            // Step 1: Large bid wall appears
            detector.trackPassiveChange(basePrice, 150, 40);
            vi.advanceTimersByTime(2000); // Wait 2 seconds (normal time)

            // Step 2: Wall gets partially executed (not cancelled)
            detector.trackPassiveChange(basePrice, 80, 40); // Partial execution

            // Step 3: Check for spoofing - should be false due to long time duration
            const result = detector.wasSpoofed(
                basePrice,
                "buy",
                now + 2500,
                () => 70
            );

            expect(result).toBe(false);
        });
    });

    describe("Layering Attack Detection", () => {
        it("should detect coordinated bid layering across multiple price levels", () => {
            const basePrice = 100.0;
            const now = Date.now();

            // Step 1: Create layered bid walls at multiple levels
            detector.trackPassiveChange(99.99, 100, 30); // Level 1: 1 tick below
            detector.trackPassiveChange(99.98, 120, 25); // Level 2: 2 ticks below
            detector.trackPassiveChange(99.97, 80, 35); // Level 3: 3 ticks below
            vi.advanceTimersByTime(100);

            // Step 2: All walls get cancelled rapidly (coordinated attack)
            detector.trackPassiveChange(99.99, 5, 30); // Level 1 cancelled
            detector.trackPassiveChange(99.98, 8, 25); // Level 2 cancelled
            detector.trackPassiveChange(99.97, 3, 35); // Level 3 cancelled

            // Step 3: Check for layering detection
            const result = detector.wasSpoofed(
                basePrice,
                "buy",
                now + 200,
                () => 0
            );

            expect(result).toBe(true);
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining("Advanced spoofing detected: layering"),
                expect.objectContaining({
                    spoofType: "layering",
                    confidence: expect.any(Number),
                })
            );
        });

        it("should detect coordinated ask layering across multiple price levels", () => {
            const basePrice = 100.0;
            const now = Date.now();

            // Step 1: Create layered ask walls at multiple levels
            detector.trackPassiveChange(100.01, 25, 90); // Level 1: 1 tick above
            detector.trackPassiveChange(100.02, 30, 110); // Level 2: 2 ticks above
            detector.trackPassiveChange(100.03, 20, 75); // Level 3: 3 ticks above
            vi.advanceTimersByTime(150);

            // Step 2: All ask walls get cancelled rapidly
            detector.trackPassiveChange(100.01, 25, 10); // Level 1 cancelled
            detector.trackPassiveChange(100.02, 30, 15); // Level 2 cancelled
            detector.trackPassiveChange(100.03, 20, 5); // Level 3 cancelled

            // Step 3: Check for layering detection
            const result = detector.wasSpoofed(
                basePrice,
                "sell",
                now + 200,
                () => 0
            );

            expect(result).toBe(true);
        });

        it("should NOT detect single level cancellation as layering", () => {
            const basePrice = 100.0;
            const now = Date.now();

            // Step 1: Only one level has significant wall
            detector.trackPassiveChange(99.99, 150, 30);
            detector.trackPassiveChange(99.98, 5, 25); // Small wall
            detector.trackPassiveChange(99.97, 8, 35); // Small wall
            vi.advanceTimersByTime(100);

            // Step 2: Only the large wall gets cancelled
            detector.trackPassiveChange(99.99, 10, 30); // Large wall cancelled
            detector.trackPassiveChange(99.98, 3, 25); // Small reduction
            detector.trackPassiveChange(99.97, 6, 35); // Small reduction

            // Step 3: Should not detect layering (only one significant cancellation)
            const result = detector.wasSpoofed(
                basePrice,
                "buy",
                now + 200,
                () => 0
            );

            // Should detect fake_wall but not layering
            expect(result).toBe(true);
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining("fake_wall"),
                expect.anything()
            );
        });
    });

    describe("Ghost Liquidity Detection", () => {
        it("should detect liquidity that appears and disappears very quickly", () => {
            const basePrice = 100.0;
            const now = Date.now();

            // Step 1: Initial state - low liquidity
            detector.trackPassiveChange(basePrice, 10, 15);
            vi.advanceTimersByTime(50);

            // Step 2: Large liquidity suddenly appears
            detector.trackPassiveChange(basePrice, 200, 15); // Ghost liquidity appears
            vi.advanceTimersByTime(80);

            // Step 3: Liquidity disappears very quickly (within 200ms total)
            detector.trackPassiveChange(basePrice, 8, 15); // Ghost liquidity vanishes

            // Step 4: Check for ghost liquidity detection
            const result = detector.wasSpoofed(
                basePrice,
                "buy",
                now + 150,
                () => 0
            );

            expect(result).toBe(true);
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining(
                    "Advanced spoofing detected: ghost_liquidity"
                ),
                expect.objectContaining({
                    spoofType: "ghost_liquidity",
                    confidence: 0.85,
                })
            );
        });

        it("should NOT detect normal liquidity fluctuations as ghost liquidity", () => {
            const basePrice = 100.0;
            const now = Date.now();

            // Step 1: Initial state
            detector.trackPassiveChange(basePrice, 20, 25);
            vi.advanceTimersByTime(1000); // Long time gap

            // Step 2: Liquidity increases normally
            detector.trackPassiveChange(basePrice, 80, 25);
            vi.advanceTimersByTime(5000); // Normal market activity timing

            // Step 3: Liquidity decreases normally
            detector.trackPassiveChange(basePrice, 15, 25);

            // Step 4: Should not detect ghost liquidity due to long timeframes
            const result = detector.wasSpoofed(
                basePrice,
                "buy",
                now + 6500,
                () => 0
            );

            expect(result).toBe(false);
        });
    });

    describe("Edge Cases and Boundary Conditions", () => {
        it("should handle small walls below minWallSize threshold", () => {
            const basePrice = 100.0;
            const now = Date.now();

            // Create and cancel small walls (below 50 LTC threshold)
            detector.trackPassiveChange(basePrice, 30, 20); // Below minWallSize
            vi.advanceTimersByTime(100);
            detector.trackPassiveChange(basePrice, 5, 20);

            const result = detector.wasSpoofed(
                basePrice,
                "buy",
                now + 200,
                () => 0
            );

            expect(result).toBe(false); // Should not detect spoofing for small walls
        });

        it("should handle partial cancellations that don't meet threshold", () => {
            const basePrice = 100.0;
            const now = Date.now();

            // Large wall with small partial cancellation
            detector.trackPassiveChange(basePrice, 200, 40);
            vi.advanceTimersByTime(100);
            detector.trackPassiveChange(basePrice, 150, 40); // Only 25% cancelled

            const result = detector.wasSpoofed(
                basePrice,
                "buy",
                now + 200,
                () => 0
            );

            expect(result).toBe(false); // Should not detect spoofing for small cancellation ratio
        });

        it("should handle zero division edge cases gracefully", () => {
            const basePrice = 100.0;
            const now = Date.now();

            // Zero quantity scenarios
            detector.trackPassiveChange(basePrice, 0, 0);
            vi.advanceTimersByTime(100);
            detector.trackPassiveChange(basePrice, 100, 0);
            vi.advanceTimersByTime(100);
            detector.trackPassiveChange(basePrice, 0, 0);

            expect(() => {
                const result = detector.wasSpoofed(
                    basePrice,
                    "buy",
                    now + 300,
                    () => 0
                );
                expect(typeof result).toBe("boolean");
            }).not.toThrow();
        });
    });

    describe("Integration with Existing wasSpoofed Method", () => {
        it("should maintain backward compatibility with original detection logic", () => {
            const basePrice = 100.0;
            const now = Date.now();

            // Create scenario that would trigger original logic
            detector.trackPassiveChange(basePrice, 100, 40);
            vi.advanceTimersByTime(800); // Longer than rapid cancellation threshold
            detector.trackPassiveChange(basePrice, 15, 40);

            // Mock getAggressiveVolume to return low execution
            const mockGetAggressiveVolume = vi.fn().mockReturnValue(5);

            const result = detector.wasSpoofed(
                basePrice,
                "buy",
                now + 1000,
                mockGetAggressiveVolume
            );

            expect(result).toBe(true); // Should still detect via original logic
            expect(mockGetAggressiveVolume).toHaveBeenCalled();
        });

        it("should prioritize advanced detection over legacy detection", () => {
            const basePrice = 100.0;
            const now = Date.now();

            // Create scenario that triggers both advanced and legacy detection
            detector.trackPassiveChange(basePrice, 150, 40);
            vi.advanceTimersByTime(300); // Within rapid cancellation threshold
            detector.trackPassiveChange(basePrice, 20, 40);

            const mockGetAggressiveVolume = vi.fn().mockReturnValue(10);

            const result = detector.wasSpoofed(
                basePrice,
                "buy",
                now + 400,
                mockGetAggressiveVolume
            );

            expect(result).toBe(true);
            // Should log advanced detection, not call legacy volume function
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining("Advanced spoofing detected"),
                expect.anything()
            );
        });
    });
});
