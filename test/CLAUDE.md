# CLAUDE.md - Testing Standards & Integrity

Production trading system testing standards with **ZERO TOLERANCE** for test integrity violations.

## 🚨 CRITICAL FOUNDATION

**Do not guess, NEVER guess; all test validations are based on mathematical logic and real market data; if you need more data to validate you ask for it; no guessing, no estimations, no general answers, no bullshit. Test integrity above everything, request clarification when you are unsure.**

## 🏛️ INSTITUTIONAL TESTING STANDARDS

### 📋 TEST INTEGRITY PRINCIPLES (NON-NEGOTIABLE)

#### Core Testing Requirements

- **MANDATORY: >95% coverage requirement** - All tests MUST pass, coverage MUST be >95%
- **Tests MUST detect signal generation errors** - Never adjust tests to pass buggy detector logic
- **Tests MUST validate real market scenarios** - Test with realistic market data patterns
- **Tests MUST fail when detector logic is wrong** - Bad signal logic should fail tests
- **NO adjusting expectations to match buggy code** - Fix detector, not tests
- **NO lowering signal quality standards** - Tests guide proper detector implementation

#### Test Quality Standards

- **ALL async operations MUST have proper await patterns**
- **ALL mock dependencies MUST use `__mocks__/` directory**
- **ALL test data MUST be realistic market data**
- **ALL edge cases MUST be tested**
- **ALL error conditions MUST be validated**

### 🚫 ABSOLUTE PROHIBITIONS (ZERO TOLERANCE)

**NEVER in test code:**

- **Adjust test expectations to match buggy implementation** - Fix the code, not the tests
- **Use inline mocks** - ALL mocks MUST be in `__mocks__/` directory
- **Skip edge case testing** - ALL edge cases must be covered
- **Lower coverage requirements** - Maintain >95% coverage at all times
- **Use hardcoded test data** - Use realistic market data patterns
- **Skip error condition testing** - ALL error paths must be tested

### 🧪 TESTING FRAMEWORK REQUIREMENTS

#### Vitest Configuration Standards

```typescript
// ✅ REQUIRED: vitest.config.ts structure
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        setupFiles: ["./test/vitest.setup.ts"],
        coverage: {
            reporter: ["text", "lcov", "html"],
            exclude: [
                "node_modules/",
                "dist/",
                "test/",
                "**/*.d.ts",
                "**/*.config.ts",
            ],
            thresholds: {
                global: {
                    branches: 95,
                    functions: 95,
                    lines: 95,
                    statements: 95,
                },
            },
        },
        testTimeout: 10000,
        // MANDATORY: Fail on first test failure in CI
        bail: process.env.CI === "true" ? 1 : 0,
    },
});
```

#### Test Setup Standards

```typescript
// ✅ REQUIRED: test/vitest.setup.ts
import { beforeAll, afterAll } from "vitest";

// Global test setup
beforeAll(() => {
    // Mock all external dependencies
    mockAllDependencies();

    // Set up test environment
    process.env.NODE_ENV = "test";
    process.env.TZ = "UTC";
});

// Clean up after all tests
afterAll(() => {
    // Clean up test data
    cleanupTestData();

    // Reset all mocks
    resetAllMocks();
});
```

### 🎯 DETECTOR TESTING PATTERNS

#### Signal Quality Testing

```typescript
describe("AbsorptionDetector", () => {
    // ✅ REQUIRED: Test null returns for insufficient data
    it("should return null for insufficient trade data", () => {
        const insufficientTrades = generateTrades(2); // Less than minimum
        const result = detector.detect(insufficientTrades);
        expect(result).toBeNull();
    });

    // ✅ REQUIRED: Test realistic market scenarios
    it("should generate valid signals for strong absorption patterns", () => {
        const strongPattern = generateStrongAbsorptionPattern();
        const result = detector.detect(strongPattern);

        expect(result).not.toBeNull();
        expect(result!.confidence).toBeGreaterThan(0.7);
        expect(result!.price).toBeCloseTo(expectedPrice, 2);
    });

    // ✅ REQUIRED: Test edge cases
    it("should handle extreme market conditions", () => {
        const extremeVolatility = generateExtremeVolatilityTrades();
        const result = detector.detect(extremeVolatility);

        // Should not crash, should return valid result or null
        expect(() => detector.detect(extremeVolatility)).not.toThrow();
    });
});
```

#### FinancialMath Usage Testing

```typescript
describe("FinancialMath Integration", () => {
    // ✅ REQUIRED: Verify FinancialMath usage
    it("should use FinancialMath for all price calculations", () => {
        const spy = jest.spyOn(FinancialMath, "calculateMidPrice");

        detector.detect(testTrades);

        expect(spy).toHaveBeenCalledWith(
            expect.any(Number),
            expect.any(Number),
            expect.any(Number)
        );
    });

    // ✅ REQUIRED: Test tick size compliance
    it("should respect tick size constraints", () => {
        const result = detector.detect(tickSizeTestTrades);

        if (result !== null) {
            const tickSize = 0.01; // For $10-$100 range
            const tickCompliant = result.price % tickSize === 0;
            expect(tickCompliant).toBe(true);
        }
    });
});
```

### 🧪 MOCKING STANDARDS

#### Mock Directory Structure

```
__mocks__/
├── binance.ts          # Binance API mocks
├── websocket.ts        # WebSocket connection mocks
├── database.ts         # Database operation mocks
├── logger.ts          # Logging system mocks
├── config.ts          # Configuration mocks
└── marketData.ts      # Market data generation mocks
```

#### Mock Implementation Standards

```typescript
// ✅ REQUIRED: __mocks__/binance.ts
export const mockBinanceClient = {
    trades: jest.fn(),
    depth: jest.fn(),
    // All methods return realistic data
};

export const mockWebSocket = {
    on: jest.fn(),
    send: jest.fn(),
    close: jest.fn(),
    // Proper event emission simulation
};

// ✅ REQUIRED: Mock data generators
export const generateRealisticTrades = (
    count: number
): EnrichedTradeEvent[] => {
    return Array.from({ length: count }, (_, i) => ({
        id: `trade_${i}`,
        symbol: "LTCUSDT",
        price: 65.0 + (Math.random() - 0.5) * 2, // Realistic price range
        quantity: 1 + Math.random() * 10, // Realistic volume
        timestamp: Date.now() + i * 1000,
        buyerIsMaker: Math.random() > 0.5,
        // All required fields with realistic values
    }));
};
```

### 📊 PERFORMANCE TESTING

#### Latency Testing Standards

```typescript
describe("Performance Requirements", () => {
    // ✅ REQUIRED: Sub-millisecond latency testing
    it("should process trades under 1ms", () => {
        const trades = generateTrades(100);

        const start = performance.now();
        for (const trade of trades) {
            detector.detect(trade);
        }
        const end = performance.now();

        const avgLatency = (end - start) / trades.length;
        expect(avgLatency).toBeLessThan(1); // Sub-millisecond requirement
    });

    // ✅ REQUIRED: Memory leak testing
    it("should not have memory leaks under load", () => {
        const initialMemory = process.memoryUsage().heapUsed;
        const trades = generateTrades(1000);

        for (const trade of trades) {
            detector.detect(trade);
        }

        const finalMemory = process.memoryUsage().heapUsed;
        const memoryIncrease = finalMemory - initialMemory;

        // Allow reasonable memory increase, but detect leaks
        expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024); // 10MB limit
    });
});
```

### 🎯 INTEGRATION TESTING

#### End-to-End Testing Standards

```typescript
describe("Signal Processing Pipeline", () => {
    // ✅ REQUIRED: Full pipeline testing
    it("should process trades through complete signal pipeline", async () => {
        const trades = generateRealisticTradeSequence();

        // Process through preprocessor
        const enrichedTrades = await preprocessor.process(trades);

        // Process through detectors
        const signals = await Promise.all(
            enrichedTrades.map((trade) =>
                Promise.all(detectors.map((detector) => detector.detect(trade)))
            )
        );

        // Process through signal manager
        const processedSignals = await signalManager.process(signals.flat());

        // Validate signal quality
        expect(processedSignals.length).toBeGreaterThan(0);
        processedSignals.forEach((signal) => {
            expect(signal.confidence).toBeGreaterThan(0.5);
        });
    });

    // ✅ REQUIRED: Error handling testing
    it("should handle detector failures gracefully", async () => {
        // Simulate detector failure
        jest.spyOn(absorptionDetector, "detect").mockRejectedValue(
            new Error("Test error")
        );

        const result = await signalCoordinator.processTrade(testTrade);

        // Should not crash the system
        expect(result).toBeDefined();
        // Should log the error
        expect(logger.error).toHaveBeenCalled();
    });
});
```

### 📈 COVERAGE REQUIREMENTS

#### Coverage Standards

```typescript
// ✅ REQUIRED: Coverage configuration
{
    coverage: {
        reporter: ['text', 'lcov', 'html'],
        exclude: [
            'node_modules/',
            'dist/',
            'test/',
            '**/*.d.ts',
            '**/*.config.ts',
            // Exclude generated files
            'src/generated/',
            // Exclude simple getters/setters
            '**/types/',
        ],
        thresholds: {
            global: {
                branches: 95,
                functions: 95,
                lines: 95,
                statements: 95
            },
            // Specific thresholds for critical files
            'src/indicators/*.ts': {
                branches: 98,
                functions: 98,
                lines: 98,
                statements: 98
            }
        }
    }
}
```

#### Coverage Analysis

```typescript
describe("Coverage Validation", () => {
    // ✅ REQUIRED: Test all code paths
    it("should test all detector states", () => {
        // Test initialization
        const detector = new AbsorptionDetector(config);

        // Test with various data conditions
        const emptyData = detector.detect([]);
        expect(emptyData).toBeNull();

        const minimalData = detector.detect(generateTrades(3));
        // Test minimal data handling

        const fullData = detector.detect(generateTrades(100));
        // Test full processing pipeline
    });

    // ✅ REQUIRED: Test error conditions
    it("should handle all error scenarios", () => {
        // Test invalid configuration
        expect(() => new AbsorptionDetector(invalidConfig)).toThrow();

        // Test network failures
        mockNetworkFailure();
        const result = detector.detect(testTrades);
        expect(result).toBeNull();

        // Test data corruption
        const corruptedData = corruptTradeData(testTrades);
        expect(() => detector.detect(corruptedData)).not.toThrow();
    });
});
```

### 🚨 TEST INTEGRITY VIOLATIONS

```
🧪 TEST INTEGRITY VIOLATION DETECTED 🧪
Violation type: [specific violation]
File: [test_filename]
Test: [test_name]
This violates institutional testing standards.
Required corrections: [specific fixes needed]
This change is PROHIBITED - fix the implementation, not the tests.
```

#### Common Violations

- **Adjusting test expectations** to match buggy detector logic
- **Using inline mocks** instead of `__mocks__/` directory
- **Skipping edge case testing** for complex algorithms
- **Lowering coverage requirements** for critical trading logic
- **Using unrealistic test data** that doesn't reflect market conditions

### 📋 TESTING CHECKLIST

#### Pre-commit Test Validation

- [ ] **ALL tests pass** with zero failures
- [ ] **Coverage >95%** for all metrics (branches, functions, lines, statements)
- [ ] **NO test integrity violations** - tests validate correct behavior
- [ ] **ALL edge cases tested** for critical trading logic
- [ ] **FinancialMath usage verified** in all detector tests
- [ ] **Tick size compliance tested** for all price calculations
- [ ] **Error handling validated** for all failure scenarios
- [ ] **Performance requirements met** for latency and memory usage

#### Test Quality Metrics

- [ ] **Realistic test data** - uses actual market data patterns
- [ ] **Comprehensive mocking** - all external dependencies mocked
- [ ] **Proper async handling** - all async operations properly tested
- [ ] **Memory leak detection** - tests run without memory growth
- [ ] **Cross-platform compatibility** - tests work in all environments

---

## 📚 SPECIALIZED GUIDANCE

**For specialized testing standards, see:**

- **General Development**: `src/CLAUDE.md` - Development patterns and coding standards
- **Detector Development**: `src/indicators/CLAUDE.md` - Pattern detection testing
- **Project Overview**: `/CLAUDE.md` - Complete system architecture

**Built for institutional trading with zero tolerance for test integrity violations.**
