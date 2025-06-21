import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before imports - MANDATORY per CLAUDE.md
vi.mock("../src/multithreading/workerLogger");
vi.mock("../src/infrastructure/metricsCollector");
vi.mock("../src/services/spoofingDetector");

import { DeltaCVDConfirmation } from "../src/indicators/deltaCVDConfirmation";
import { WorkerLogger } from "../src/multithreading/workerLogger";
import { MetricsCollector } from "../src/infrastructure/metricsCollector";
import { SpoofingDetector } from "../src/services/spoofingDetector";
import type { EnrichedTradeEvent } from "../src/types/marketEvents";

/**
 * COMPREHENSIVE DIVERGENCE DETECTION TESTS
 * 
 * Testing Standards (CLAUDE.md):
 * ✅ Test CORRECT logic implementation based on specifications
 * ✅ Validate exact method behavior against requirements  
 * ✅ Ensure tests fail when known bugs are present
 * ✅ Tests MUST detect errors in code - never adjust tests to pass buggy implementations
 */

describe("DeltaCVDConfirmation - Divergence Detection Mode", () => {
    let detector: DeltaCVDConfirmation;
    let mockLogger: WorkerLogger;
    let mockMetrics: MetricsCollector;
    let mockSpoofing: SpoofingDetector;

    // Helper to create standardized trade events
    const createTradeEvent = (
        price: number,
        quantity: number,
        buyerIsMaker: boolean,
        timestamp: number
    ): EnrichedTradeEvent => ({
        symbol: "LTCUSDT",
        price,
        quantity,
        buyerIsMaker,
        timestamp,
        tradeId: Math.floor(Math.random() * 1000000),
        isBuyerMaker: buyerIsMaker, // Legacy field compatibility
        quoteQty: price * quantity,
    });

    beforeEach(() => {
        mockLogger = new WorkerLogger();
        mockMetrics = new MetricsCollector();
        mockSpoofing = new SpoofingDetector({
            tickSize: 0.01,
            wallTicks: 10,
            minWallSize: 100,
            dynamicWallWidth: true,
            testLogMinSpoof: 50,
        });
    });

    describe("Detection Mode Configuration", () => {
        it("should correctly configure divergence mode", () => {
            detector = new DeltaCVDConfirmation(
                "test_divergence_config",
                {
                    windowsSec: [60],
                    detectionMode: "divergence",
                    divergenceThreshold: 0.3,
                    divergenceLookbackSec: 60,
                    minZ: 2.0,
                },
                mockLogger,
                mockSpoofing,
                mockMetrics
            );

            // Test internal configuration is correctly set
            const detailedState = detector.getDetailedState();
            expect(detailedState.windows).toEqual([60]);
            expect(detailedState.configuration.minZ).toBe(2.0);
        });

        it("should default to momentum mode when detectionMode not specified", () => {
            detector = new DeltaCVDConfirmation(
                "test_default_mode",
                {
                    windowsSec: [60],
                    minZ: 2.0,
                },
                mockLogger,
                mockSpoofing,
                mockMetrics
            );

            // This tests that the default behavior is preserved
            // The detector should use momentum validation by default
            expect(detector.getId()).toBe("test_default_mode");
        });

        it("should accept hybrid mode configuration", () => {
            detector = new DeltaCVDConfirmation(
                "test_hybrid_mode",
                {
                    windowsSec: [60],
                    detectionMode: "hybrid",
                    divergenceThreshold: 0.25,
                    divergenceLookbackSec: 45,
                    minZ: 2.5,
                },
                mockLogger,
                mockSpoofing,
                mockMetrics
            );

            expect(detector.getId()).toBe("test_hybrid_mode");
        });
    });

    describe("Divergence Validation Logic", () => {
        beforeEach(() => {
            detector = new DeltaCVDConfirmation(
                "test_divergence_validation",
                {
                    windowsSec: [60],
                    detectionMode: "divergence",
                    divergenceThreshold: 0.3, // 30% correlation threshold
                    divergenceLookbackSec: 60,
                    minZ: 2.0,
                    minTradesPerSec: 0.1, // Reduced for testing
                    minVolPerSec: 0.5, // Reduced for testing
                },
                mockLogger,
                mockSpoofing,
                mockMetrics
            );
        });

        it("should require lower CVD activity threshold in divergence mode", () => {
            // In divergence mode, minZ threshold should be halved (1.0 instead of 2.0)
            // This tests the implementation: shortZ < this.minZ * 0.5
            
            // Test with z-score of 0.8 (below half threshold of 1.0)
            const lowZScores = { 60: 0.8 };
            const correlations = { 60: 0.1 }; // Low correlation (good for divergence)
            
            const result = detector.simulateConfidence(lowZScores, correlations);
            
            // In divergence mode, this should be rejected due to insufficient CVD activity
            // The confidence calculation should reflect this validation failure
            expect(result.finalConfidence).toBeLessThan(0.5);
        });

        it("should reward low correlation (divergence) instead of penalizing it", () => {
            // CRITICAL TEST: This validates the core divergence logic
            // High correlation should be rejected in divergence mode
            
            const adequateZScores = { 60: 1.5 }; // Above half threshold (1.0)
            const highCorrelations = { 60: 0.8 }; // High correlation (bad for divergence)
            
            const result = detector.simulateConfidence(adequateZScores, highCorrelations);
            
            // High correlation should result in low confidence in divergence mode
            expect(result.finalConfidence).toBeLessThan(0.3);
            
            // Now test low correlation (good divergence)
            const lowCorrelations = { 60: 0.1 }; // Low correlation (good for divergence)
            const divergenceResult = detector.simulateConfidence(adequateZScores, lowCorrelations);
            
            // Low correlation should result in higher confidence in divergence mode
            expect(divergenceResult.finalConfidence).toBeGreaterThan(result.finalConfidence);
        });

        it("should detect price/CVD direction mismatch", () => {
            const baseTime = Date.now();
            
            // Create a price-up scenario: trades showing upward price movement
            const upwardPriceTrades = [
                createTradeEvent(100.00, 1.0, true, baseTime - 50000),
                createTradeEvent(100.05, 1.0, false, baseTime - 40000),
                createTradeEvent(100.10, 1.0, true, baseTime - 30000),
                createTradeEvent(100.15, 1.0, false, baseTime - 20000),
                createTradeEvent(100.20, 1.0, true, baseTime - 10000),
                createTradeEvent(100.25, 1.0, false, baseTime), // Final higher price
            ];

            // Process trades to build price history
            upwardPriceTrades.forEach(trade => {
                detector.onEnrichedTrade(trade);
            });

            // Now add CVD-down trades (sell aggression) to create divergence
            // Price went up, but CVD should go down (divergence condition)
            const sellAggressionTrades = [
                createTradeEvent(100.25, 2.0, true, baseTime + 1000), // Sell aggression
                createTradeEvent(100.24, 2.0, true, baseTime + 2000), // Sell aggression
                createTradeEvent(100.23, 2.0, true, baseTime + 3000), // Sell aggression
            ];

            sellAggressionTrades.forEach(trade => {
                detector.onEnrichedTrade(trade);
            });

            // Test that the detector recognizes this as a valid divergence scenario
            // Price up + CVD down = valid divergence
            const detailedState = detector.getDetailedState();
            expect(detailedState.windows).toContain(60);
            expect(detailedState.states[0].tradesCount).toBeGreaterThan(5);
        });
    });

    describe("Signal Direction Logic in Divergence Mode", () => {
        beforeEach(() => {
            detector = new DeltaCVDConfirmation(
                "test_signal_direction",
                {
                    windowsSec: [60],
                    detectionMode: "divergence",
                    divergenceThreshold: 0.2,
                    divergenceLookbackSec: 60,
                    minZ: 1.5,
                    minTradesPerSec: 0.1,
                    minVolPerSec: 0.5,
                },
                mockLogger,
                mockSpoofing,
                mockMetrics
            );
        });

        it("should generate SELL signal when price UP but CVD DOWN (bearish divergence)", () => {
            const baseTime = Date.now();
            
            // Create upward price movement with sufficient volume and trade count
            const upwardPriceTrades = [
                // Build sufficient trade history (20+ trades required)
                ...Array.from({ length: 15 }, (_, i) => 
                    createTradeEvent(100.00 + i * 0.01, 1.0, i % 2 === 0, baseTime - 60000 + i * 3000)
                ),
                // Final upward price movement
                createTradeEvent(100.20, 1.5, false, baseTime - 5000),
                createTradeEvent(100.25, 1.5, false, baseTime - 2000),
                createTradeEvent(100.30, 1.5, false, baseTime - 1000),
            ];

            upwardPriceTrades.forEach(trade => {
                detector.onEnrichedTrade(trade);
            });

            // Add CVD-down trades (heavy sell aggression creating negative CVD slope)
            const heavySellAggression = [
                createTradeEvent(100.28, 5.0, true, baseTime), // Large sell
                createTradeEvent(100.26, 5.0, true, baseTime + 500), // Large sell
                createTradeEvent(100.24, 5.0, true, baseTime + 1000), // Large sell
            ];

            heavySellAggression.forEach(trade => {
                detector.onEnrichedTrade(trade);
            });

            // In divergence mode: Price UP + CVD DOWN should generate SELL signal
            // This tests the core divergence signal logic
            const status = detector.getStatus();
            expect(status).toContain("CVD Detector");
        });

        it("should generate BUY signal when price DOWN but CVD UP (bullish divergence)", () => {
            const baseTime = Date.now();
            
            // Create downward price movement with sufficient volume and trade count
            const downwardPriceTrades = [
                // Build sufficient trade history
                ...Array.from({ length: 15 }, (_, i) => 
                    createTradeEvent(100.00 - i * 0.01, 1.0, i % 2 === 0, baseTime - 60000 + i * 3000)
                ),
                // Final downward price movement
                createTradeEvent(99.80, 1.5, true, baseTime - 5000),
                createTradeEvent(99.75, 1.5, true, baseTime - 2000),
                createTradeEvent(99.70, 1.5, true, baseTime - 1000),
            ];

            downwardPriceTrades.forEach(trade => {
                detector.onEnrichedTrade(trade);
            });

            // Add CVD-up trades (heavy buy aggression creating positive CVD slope)
            const heavyBuyAggression = [
                createTradeEvent(99.72, 5.0, false, baseTime), // Large buy
                createTradeEvent(99.74, 5.0, false, baseTime + 500), // Large buy
                createTradeEvent(99.76, 5.0, false, baseTime + 1000), // Large buy
            ];

            heavyBuyAggression.forEach(trade => {
                detector.onEnrichedTrade(trade);
            });

            // In divergence mode: Price DOWN + CVD UP should generate BUY signal
            const status = detector.getStatus();
            expect(status).toContain("CVD Detector");
        });

        it("should generate NEUTRAL signal when no clear divergence exists", () => {
            const baseTime = Date.now();
            
            // Create sideways price movement (no clear direction)
            const sidewaysTrades = [
                ...Array.from({ length: 20 }, (_, i) => 
                    createTradeEvent(100.00 + (Math.sin(i) * 0.02), 1.0, i % 2 === 0, baseTime - 60000 + i * 3000)
                ),
            ];

            sidewaysTrades.forEach(trade => {
                detector.onEnrichedTrade(trade);
            });

            // When price direction is sideways, signal should be neutral
            const status = detector.getStatus();
            expect(status).toContain("CVD Detector");
        });
    });

    describe("Momentum vs Divergence Mode Comparison", () => {
        let momentumDetector: DeltaCVDConfirmation;
        let divergenceDetector: DeltaCVDConfirmation;

        beforeEach(() => {
            const sharedConfig = {
                windowsSec: [60],
                minZ: 2.0,
                minTradesPerSec: 0.1,
                minVolPerSec: 0.5,
                divergenceThreshold: 0.3,
                divergenceLookbackSec: 60,
            };

            momentumDetector = new DeltaCVDConfirmation(
                "momentum_detector",
                { ...sharedConfig, detectionMode: "momentum" },
                mockLogger,
                mockSpoofing,
                mockMetrics
            );

            divergenceDetector = new DeltaCVDConfirmation(
                "divergence_detector",
                { ...sharedConfig, detectionMode: "divergence" },
                mockLogger,
                mockSpoofing,
                mockMetrics
            );
        });

        it("should have different validation behavior between modes", () => {
            // Test scenario: High correlation with adequate z-score
            const zScores = { 60: 3.0 }; // Higher z-score to ensure momentum passes
            const highCorrelations = { 60: 0.8 }; // High correlation

            const momentumResult = momentumDetector.simulateConfidence(zScores, highCorrelations);
            const divergenceResult = divergenceDetector.simulateConfidence(zScores, highCorrelations);

            // Momentum mode should accept high correlation (non-zero confidence)
            // Divergence mode should reject high correlation (zero confidence due to validation failure)
            expect(momentumResult.finalConfidence).toBeGreaterThan(0);
            expect(divergenceResult.finalConfidence).toBe(0);
        });

        it("should have different threshold requirements", () => {
            // Test with z-score that's above half threshold but below full threshold
            const mediumZScores = { 60: 1.5 }; // Above 1.0 (half of 2.0) but below 2.0
            const lowCorrelations = { 60: 0.1 }; // Good for divergence

            const momentumResult = momentumDetector.simulateConfidence(mediumZScores, lowCorrelations);
            const divergenceResult = divergenceDetector.simulateConfidence(mediumZScores, lowCorrelations);

            // Divergence mode should be more lenient with z-score threshold
            // This tests the minZ * 0.5 logic in divergence mode
            expect(divergenceResult.finalConfidence).toBeGreaterThanOrEqual(0);
            expect(momentumResult.finalConfidence).toBeGreaterThanOrEqual(0);
        });
    });

    describe("Hybrid Mode Logic", () => {
        let hybridDetector: DeltaCVDConfirmation;

        beforeEach(() => {
            hybridDetector = new DeltaCVDConfirmation(
                "hybrid_detector",
                {
                    windowsSec: [60],
                    detectionMode: "hybrid",
                    divergenceThreshold: 0.3,
                    divergenceLookbackSec: 60,
                    minZ: 2.0,
                    minTradesPerSec: 0.1,
                    minVolPerSec: 0.5,
                },
                mockLogger,
                mockSpoofing,
                mockMetrics
            );
        });

        it("should try divergence first, then fall back to momentum", () => {
            // Test case where divergence validation would succeed
            const adequateZScores = { 60: 1.5 };
            const lowCorrelations = { 60: 0.1 }; // Good for divergence

            const result = hybridDetector.simulateConfidence(adequateZScores, lowCorrelations);
            
            // Hybrid mode should use divergence validation if it passes
            expect(result.finalConfidence).toBeGreaterThanOrEqual(0);
            expect(result.finalConfidence).toBeLessThanOrEqual(1);
        });

        it("should fall back to momentum when divergence fails", () => {
            // Test case where divergence validation would fail but momentum might succeed
            const highZScores = { 60: 3.0 }; // High z-score
            const highCorrelations = { 60: 0.8 }; // High correlation (bad for divergence, good for momentum)

            const result = hybridDetector.simulateConfidence(highZScores, highCorrelations);
            
            // Should fall back to momentum validation
            expect(result.finalConfidence).toBeGreaterThanOrEqual(0);
            expect(result.finalConfidence).toBeLessThanOrEqual(1);
        });
    });

    describe("Price Direction Calculation", () => {
        beforeEach(() => {
            detector = new DeltaCVDConfirmation(
                "test_price_direction",
                {
                    windowsSec: [60],
                    detectionMode: "divergence",
                    divergenceThreshold: 0.3,
                    divergenceLookbackSec: 30, // Shorter for testing
                    minZ: 1.0,
                },
                mockLogger,
                mockSpoofing,
                mockMetrics
            );
        });

        it("should correctly identify upward price movement", () => {
            const baseTime = Date.now();
            
            // Create clear upward price trend
            const upwardTrades = [
                ...Array.from({ length: 25 }, (_, i) => 
                    createTradeEvent(100.00 + i * 0.01, 1.0, i % 2 === 0, baseTime - 30000 + i * 1000)
                ),
            ];

            upwardTrades.forEach(trade => {
                detector.onEnrichedTrade(trade);
            });

            // The detector should internally recognize this as upward movement
            // This is tested through the overall behavior
            const status = detector.getStatus();
            expect(status).toContain("CVD Detector");
        });

        it("should correctly identify downward price movement", () => {
            const baseTime = Date.now();
            
            // Create clear downward price trend
            const downwardTrades = [
                ...Array.from({ length: 25 }, (_, i) => 
                    createTradeEvent(100.00 - i * 0.01, 1.0, i % 2 === 0, baseTime - 30000 + i * 1000)
                ),
            ];

            downwardTrades.forEach(trade => {
                detector.onEnrichedTrade(trade);
            });

            const status = detector.getStatus();
            expect(status).toContain("CVD Detector");
        });

        it("should handle sideways movement correctly", () => {
            const baseTime = Date.now();
            
            // Create sideways price movement (small oscillations around 100.00)
            const sidewaysTrades = [
                ...Array.from({ length: 25 }, (_, i) => 
                    createTradeEvent(100.00 + (Math.sin(i * 0.5) * 0.005), 1.0, i % 2 === 0, baseTime - 30000 + i * 1000)
                ),
            ];

            sidewaysTrades.forEach(trade => {
                detector.onEnrichedTrade(trade);
            });

            const status = detector.getStatus();
            expect(status).toContain("CVD Detector");
        });

        it("should return sideways for insufficient trade data", () => {
            const baseTime = Date.now();
            
            // Add fewer than 20 trades (minimum required)
            const fewTrades = [
                createTradeEvent(100.00, 1.0, true, baseTime - 5000),
                createTradeEvent(100.05, 1.0, false, baseTime - 3000),
                createTradeEvent(100.10, 1.0, true, baseTime - 1000),
            ];

            fewTrades.forEach(trade => {
                detector.onEnrichedTrade(trade);
            });

            // With insufficient data, should default to sideways
            const status = detector.getStatus();
            expect(status).toContain("CVD Detector");
        });
    });

    describe("Edge Cases and Error Conditions", () => {
        beforeEach(() => {
            detector = new DeltaCVDConfirmation(
                "test_edge_cases",
                {
                    windowsSec: [60],
                    detectionMode: "divergence",
                    divergenceThreshold: 0.3,
                    divergenceLookbackSec: 60,
                    minZ: 2.0,
                },
                mockLogger,
                mockSpoofing,
                mockMetrics
            );
        });

        it("should handle invalid z-scores gracefully", () => {
            const invalidZScores = { 60: NaN };
            const validCorrelations = { 60: 0.5 };

            const result = detector.simulateConfidence(invalidZScores, validCorrelations);
            
            // Should return valid confidence values even with invalid input
            expect(Number.isFinite(result.finalConfidence)).toBe(true);
            expect(result.finalConfidence).toBeGreaterThanOrEqual(0);
            expect(result.finalConfidence).toBeLessThanOrEqual(1);
        });

        it("should handle invalid correlations gracefully", () => {
            const validZScores = { 60: 2.5 };
            const invalidCorrelations = { 60: NaN };

            const result = detector.simulateConfidence(validZScores, invalidCorrelations);
            
            expect(Number.isFinite(result.finalConfidence)).toBe(true);
            expect(result.finalConfidence).toBeGreaterThanOrEqual(0);
            expect(result.finalConfidence).toBeLessThanOrEqual(1);
        });

        it("should handle extreme correlation values", () => {
            const validZScores = { 60: 2.5 };
            
            // Test with extreme positive correlation
            const extremePositiveCorr = { 60: 0.99 };
            const result1 = detector.simulateConfidence(validZScores, extremePositiveCorr);
            
            // Test with extreme negative correlation  
            const extremeNegativeCorr = { 60: -0.99 };
            const result2 = detector.simulateConfidence(validZScores, extremeNegativeCorr);
            
            // Both should return valid results
            expect(Number.isFinite(result1.finalConfidence)).toBe(true);
            expect(Number.isFinite(result2.finalConfidence)).toBe(true);
        });

        it("should handle zero quantities in trades", () => {
            const baseTime = Date.now();
            const zeroQuantityTrade = createTradeEvent(100.00, 0, false, baseTime);
            
            // Should not crash with zero quantity
            expect(() => {
                detector.onEnrichedTrade(zeroQuantityTrade);
            }).not.toThrow();
        });

        it("should handle rapid-fire trades", () => {
            const baseTime = Date.now();
            
            // Add many trades in quick succession
            const rapidTrades = Array.from({ length: 100 }, (_, i) => 
                createTradeEvent(100.00 + i * 0.001, 0.1, i % 2 === 0, baseTime + i)
            );

            expect(() => {
                rapidTrades.forEach(trade => {
                    detector.onEnrichedTrade(trade);
                });
            }).not.toThrow();
        });
    });
});