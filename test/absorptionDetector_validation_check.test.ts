// test/absorptionDetector_validation_check.test.ts
// 🔬 VALIDATION CHECK: Test if FinancialMath validation is blocking execution

import { describe, it, beforeEach, vi } from "vitest";
import { AbsorptionDetector, type AbsorptionSettings } from "../src/indicators/absorptionDetector.js";
import type { EnrichedTradeEvent } from "../src/types/marketEvents.js";
import type { ILogger } from "../src/infrastructure/loggerInterface.js";
import type { IMetricsCollector } from "../src/infrastructure/metricsCollectorInterface.js";
import { SpoofingDetector } from "../src/services/spoofingDetector.js";
import { FinancialMath } from "../src/utils/financialMath.js";

// Logger that captures validation errors
const createValidationLogger = (): ILogger => ({
    info: vi.fn((msg, data) => {
        console.log(`[INFO] ${msg}`, data ? JSON.stringify(data, null, 2) : '');
    }),
    warn: vi.fn((msg, data) => {
        console.log(`[WARN] ${msg}`, data ? JSON.stringify(data, null, 2) : '');
    }),
    error: vi.fn((msg, data) => {
        if (msg.includes("Invalid price") || msg.includes("Invalid quantity")) {
            console.log(`🚨 [VALIDATION ERROR] ${msg}`, data ? JSON.stringify(data, null, 2) : '');
        } else {
            console.log(`[ERROR] ${msg}`, data ? JSON.stringify(data, null, 2) : '');
        }
    }),
    debug: vi.fn((msg, data) => {
        console.log(`[DEBUG] ${msg}`, data ? JSON.stringify(data, null, 2) : '');
    }),
});

const createMockSpoofingDetector = (): SpoofingDetector =>
    ({
        isSpoofed: vi.fn(() => false),
        detectLayeringAttack: vi.fn(() => false),
    }) as unknown as SpoofingDetector;

function createValidationTestEvent(
    price: number,
    quantity: number,
    timestamp: number,
    buyerIsMaker: boolean
): EnrichedTradeEvent {
    return {
        tradeId: `validation_${timestamp}_${Math.random()}`,
        price,
        quantity,
        timestamp,
        buyerIsMaker,
        side: buyerIsMaker ? "sell" : "buy",
        aggression: 0.8,
        enriched: true,
        zonePassiveBidVolume: 1000,
        zonePassiveAskVolume: 1000,
    };
}

describe("AbsorptionDetector - Validation Check", () => {
    let detector: AbsorptionDetector;
    let mockLogger: ILogger;
    let mockMetrics: IMetricsCollector;
    let mockSpoofingDetector: SpoofingDetector;
    let mockOrderBook: any;

    it("should check if FinancialMath validation is blocking execution", { timeout: 10000 }, async () => {
        console.log(`\n🔬 ===== VALIDATION CHECK: FinancialMath Validation =====`);
        
        // First, test FinancialMath validation directly
        const testPrice = 50000;
        const testQuantity = 100;
        
        console.log(`\n📊 Step 1: Direct FinancialMath validation test`);
        console.log(`  Testing price: ${testPrice}`);
        console.log(`  Testing quantity: ${testQuantity}`);
        
        const priceValid = FinancialMath.isValidPrice(testPrice);
        const quantityValid = FinancialMath.isValidQuantity(testQuantity);
        
        console.log(`  Price valid: ${priceValid}`);
        console.log(`  Quantity valid: ${quantityValid}`);
        
        if (!priceValid || !quantityValid) {
            console.log(`🚨 VALIDATION FAILURE: FinancialMath validation blocking!`);
            return;
        }
        
        console.log(`✅ FinancialMath validation passes - issue is elsewhere`);
        
        // Now test with detector
        console.log(`\n📊 Step 2: AbsorptionDetector validation test`);
        
        mockLogger = createValidationLogger();
        
        const { MetricsCollector: MockMetricsCollector } = await import("../__mocks__/src/infrastructure/metricsCollector.js");
        mockMetrics = new MockMetricsCollector() as any;
        
        mockSpoofingDetector = createMockSpoofingDetector();
        
        const mockDepthMap = new Map();
        mockDepthMap.set(50000, { bid: 2000, ask: 2000 });
        
        mockOrderBook = {
            getBestBid: vi.fn().mockReturnValue(50000),
            getBestAsk: vi.fn().mockReturnValue(50001),
            getSpread: vi.fn().mockReturnValue({ spread: 1, spreadBps: 2 }),
            getDepth: vi.fn().mockReturnValue(mockDepthMap),
            isHealthy: vi.fn().mockReturnValue(true),
            getLastUpdate: vi.fn().mockReturnValue(Date.now()),
        };

        const validationSettings: AbsorptionSettings = {
            windowMs: 60000,
            minAggVolume: 1,
            pricePrecision: 2,
            zoneTicks: 3,
            absorptionThreshold: 0.01,
            priceEfficiencyThreshold: 0.99,
            maxAbsorptionRatio: 0.99,
            strongAbsorptionRatio: 0.01,
            moderateAbsorptionRatio: 0.01,
            weakAbsorptionRatio: 1.0,
            spreadImpactThreshold: 0.1,
            velocityIncreaseThreshold: 0.1,
            features: {
                liquidityGradient: false,
                absorptionVelocity: false,
                layeredAbsorption: false,
                spreadImpact: false,
            },
        };

        detector = new AbsorptionDetector(
            "validation-check",
            validationSettings,
            mockOrderBook,
            mockLogger,
            mockSpoofingDetector,
            mockMetrics
        );

        console.log(`\n📊 Step 3: Send test event to detector`);
        const baseTime = Date.now() - 60000;
        const testEvent = createValidationTestEvent(testPrice, testQuantity, baseTime, true);
        
        console.log(`  Event data:`, {
            price: testEvent.price,
            quantity: testEvent.quantity,
            timestamp: testEvent.timestamp,
            buyerIsMaker: testEvent.buyerIsMaker,
            tradeId: testEvent.tradeId
        });
        
        console.log(`  Calling detector.onEnrichedTrade()...`);
        detector.onEnrichedTrade(testEvent);
        
        console.log(`\n📊 Step 4: Check for validation errors`);
        
        return new Promise<void>((resolve) => {
            setTimeout(() => {
                const errorCalls = (mockLogger.error as any).mock.calls;
                console.log(`  Error calls: ${errorCalls.length}`);
                
                if (errorCalls.length > 0) {
                    console.log(`🚨 VALIDATION ERRORS FOUND:`);
                    errorCalls.forEach((call: any, i: number) => {
                        console.log(`    Error ${i + 1}: ${call[0]}`);
                        if (call[1]) console.log(`      Data:`, call[1]);
                    });
                } else {
                    console.log(`✅ No validation errors - execution should proceed`);
                    console.log(`  This suggests the blocking issue is in the parent class flow`);
                }
                
                console.log(`\n🔬 Next Step: Need to trace BaseDetector.onEnrichedTrade() execution`);
                console.log(`🔬 =======================================================\n`);
                resolve();
            }, 100);
        });
    });
});