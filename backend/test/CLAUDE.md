# TEST/CLAUDE.md

Test-specific guidance for OrderFlow Trading System with **ZERO TOLERANCE** for testing failures or compromised test integrity.

## 🚨 CRITICAL TESTING PRINCIPLES

Do not guess, NEVER guess; all test assertions are based and calculated; if you need more data to validate behavior you request it; no guessing, no estimations, no general expectations, no bullshit. Math and logic above everything in test validation.

**Reference**: All project-wide standards in `/Users/marcschot/Projects/OrderFlow Trading/CLAUDE.md` apply to test code unless explicitly overridden below.

## 🧪 UNIT TESTING STANDARDS (ZERO TOLERANCE)

### Test Integrity Requirements (NON-NEGOTIABLE)

- **Tests MUST detect errors in code** - Never adjust tests to pass buggy implementations
- **Tests MUST validate real-world logic** - Test correct behavior, not broken code
- **Tests MUST fail when bugs are present** - Wrong logic should fail tests
- **NO adjusting expectations to match buggy code** - Fix code, not tests
- **NO lowering test standards** - Tests guide proper implementation
- **Tests MUST be deterministic** - No randomness that masks real failures
- **ALL test scenarios MUST be realistic** - No impossible market conditions

### Prohibited Test Practices (IMMEDIATE VIOLATIONS)

- ❌ Adjusting expectations to match broken code
- ❌ Adding randomness workarounds to mask detection failures
- ❌ Lowering validation thresholds to hide logic bugs
- ❌ Using hardcoded defaults instead of validating real calculations
- ❌ Writing tests that validate current behavior vs correct behavior
- ❌ Creating tests that pass regardless of implementation correctness
- ❌ Mocking away the logic being tested
- ❌ Writing tests that cannot detect regressions

### 🎯 MAGIC NUMBERS EXCEPTION (TESTS ONLY)

**SPECIAL TESTING EXCEPTION**: Unlike production code, **magic numbers ARE ALLOWED in test files**. Tests need concrete, hardcoded values for validation.

```typescript
// ✅ ALLOWED IN TESTS: Hardcoded test values
expect(detector.calculate(trades)).toBeCloseTo(0.75); // OK in tests
const testPrice = 89.42; // OK in tests
const expectedThreshold = 0.003; // OK in tests

// ✅ STILL REQUIRED: Use realistic market values
const validTick = 0.01; // Realistic for $10-$100 price range
const invalidTick = 0.0005; // Would be invalid for that range

// ❌ STILL FORBIDDEN: Values that break market realism
const impossiblePrice = -10.5; // Negative prices don't exist
const subTickMovement = 0.0001; // Sub-tick for wrong price range
```

**Why This Exception Exists:**

- **Test Clarity**: Explicit values make test expectations clear
- **Determinism**: Hardcoded values ensure consistent test results
- **Debugging**: Known values easier to debug when tests fail
- **Validation**: Specific values required to verify calculations

## 🏛️ INSTITUTIONAL TESTING STANDARDS

### Test Suite Requirements (MANDATORY)

- **>95% code coverage** - All critical paths must be tested
- **100% test pass rate** - ZERO failing tests permitted
- **Sub-100ms execution time** per test - Maintain fast feedback loops
- **Deterministic results** - Tests must pass consistently
- **Comprehensive edge cases** - Test boundary conditions thoroughly

### Mock Architecture (CRITICAL)

- **MANDATORY: ALL tests MUST use proper mocks from `__mocks__/`**
- **NEVER create inline mocks - always use `__mocks__/` structure**
- **Mock files MUST mirror exact directory structure of `src/`**
- **All mocks MUST use `vi.fn()` for proper vitest integration**
- **Mocks MUST provide realistic behavior** - No fake responses that hide bugs

#### Correct Mock Structure

```typescript
// ✅ CORRECT: Use structured mocks
import { mockLogger } from "../__mocks__/infrastructure/logger.js";
import { mockStorage } from "../__mocks__/storage/storage.js";

// ❌ WRONG: Inline mocks
const mockLogger = vi.fn();
```

### TypeScript Standards (ZERO TOLERANCE)

- **ZERO `any` types** - Use precise typing or interfaces
- **NEVER `unknown`** without type guards and validation
- **ALL test functions must have explicit return types**
- **ALL test parameters must have explicit types**
- **Strict null checking enabled**
- **No implicit returns**
- **KEEP TEST CODE SIMPLE** - Avoid complex casting, prefer interface compatibility

### Error Handling in Tests (MANDATORY)

- **ALL async test operations MUST have proper error handling**
- **ALL database test operations MUST handle connection failures**
- **ALL mock failures MUST be tested explicitly**
- **NO silent test failures** - All errors must be visible and logged

## 🔢 FINANCIAL MATH TESTING (MISSION CRITICAL)

### FinancialMath Test Requirements

- **ALL financial calculations in tests MUST use `src/utils/financialMath.ts`**
- **Test data MUST use realistic financial precision**
- **Price movements MUST respect tick size rules**
- **NO floating-point arithmetic in test calculations**

```typescript
// ✅ REQUIRED: Use FinancialMath in tests
const expectedMidPrice = FinancialMath.calculateMidPrice(89.42, 89.44, 2);
const expectedSpread = FinancialMath.calculateSpread(89.44, 89.42, 2);

// ❌ PROHIBITED: Direct floating-point in tests
const expectedMidPrice = (89.42 + 89.44) / 2; // Can cause precision errors
```

### 📏 Tick Size Compliance in Tests

**CRITICAL**: Test data MUST respect real market tick sizes to maintain test validity.

```typescript
// ✅ CORRECT: Tick-compliant test data
const basePrice = 89.0; // Price ~$89 (in $10-$100 range)
const validTick = 0.01; // Correct tick size
const testPrices = [89.0, 89.01, 89.02]; // Valid price sequence

// ❌ PROHIBITED: Invalid tick movements in tests
const invalidPrices = [89.0, 89.0005, 89.001]; // Sub-tick movements
```

## 🧵 WORKER THREAD TESTING (CRITICAL)

### Worker Thread Mock Requirements

- **ALL worker thread functionality MUST use proxy mocks**
- **NO direct infrastructure mocks in worker tests**
- **Interface compliance MUST be validated in tests**
- **Message passing patterns MUST be tested**

```typescript
// ✅ CORRECT: Test worker thread isolation
const mockLogger: ILogger = new MockWorkerProxyLogger();
const mockMetrics: IWorkerMetricsCollector = new MockWorkerMetricsProxy();

// ❌ WRONG: Direct infrastructure mocks
const mockLogger = vi.mocked(Logger);
```

### Worker Thread Test Patterns

- **Test proxy class behavior** - Ensure messages pass correctly
- **Validate interface contracts** - Confirm proper TypeScript interfaces
- **Test error handling** - Verify proper error propagation
- **Test correlation IDs** - Ensure request tracing works

## 🎯 DETECTOR TESTING STANDARDS

### Pattern Detection Test Requirements

- **Test with realistic market data** - Use actual price/volume ranges
- **Validate signal accuracy** - Test true/false positive rates
- **Test edge cases** - Boundary conditions and limit cases
- **Performance testing** - Ensure sub-millisecond latency maintained

### Signal Validation Testing

- **Test signal correlation** - Multiple detectors working together
- **Test signal timing** - Proper timestamp precision
- **Test signal deduplication** - No duplicate signals generated
- **Test signal priority** - Correct signal ordering

### Zone-Based Detector Testing

- **Test zone formation** - Proper zone candidate handling
- **Test zone evolution** - Dynamic zone boundary updates
- **Test memory management** - No memory leaks in zone state
- **Test concurrent access** - Thread-safe zone operations

## 🌐 WEBSOCKET TESTING GUIDELINES

### WebSocket Message Testing

- **Test Buffer-to-string conversion** - Proper message parsing
- **Test message validation** - Zod schema compliance
- **Test rate limiting** - Per-client limits enforced
- **Test security patterns** - Reject malformed messages

```typescript
// ✅ CORRECT: Test Buffer message handling
const testMessage = Buffer.from(JSON.stringify({ type: "test" }), "utf8");
await websocketHandler.handleMessage(mockWs, testMessage);
```

## 🏦 INSTITUTIONAL COMPLIANCE TESTING

### Data Integrity Testing

- **Test trade data immutability** - No modifications after processing
- **Test timestamp precision** - Microsecond-level accuracy
- **Test order book consistency** - Atomic state updates
- **Test ACID compliance** - Database transaction integrity

### Performance Testing Standards

- **Sub-millisecond latency** - Trade processing speed requirements
- **Memory stability** - No memory leaks under load
- **CPU optimization** - Efficient real-time processing
- **Concurrent connections** - 1000+ WebSocket clients supported

### Security Testing Requirements

- **Input validation testing** - All inputs properly sanitized
- **Rate limiting testing** - External endpoint protection
- **Authentication testing** - Proper access controls
- **Correlation ID testing** - Request tracing functionality

## 📊 TEST DATA STANDARDS

### Realistic Test Data Requirements

- **Use actual cryptocurrency price ranges** - BTC ~$30K-$70K, ETH ~$1K-$5K
- **Respect market hours** - Consider 24/7 crypto trading
- **Use realistic volumes** - Match typical exchange volumes
- **Follow market microstructure** - Bid/ask spreads, order sizes

### Test Data Generation Patterns

```typescript
// ✅ CORRECT: Realistic test trade data
const createTestTrade = (price: number, quantity: number): TradeEvent => ({
    id: generateTradeId(),
    symbol: "BTCUSDT",
    price: FinancialMath.roundToTick(price, 0.01),
    quantity: FinancialMath.roundToTick(quantity, 0.001),
    timestamp: Date.now(),
    isBuyerMaker: Math.random() > 0.5,
});
```

## 🚫 TESTING PROHIBITIONS (ZERO TOLERANCE)

**NEVER in test code:**

- Modify production configuration files during tests
- Use real API keys or external services
- Create tests that depend on external network access
- Write tests that modify global state without cleanup
- Create flaky tests that pass/fail randomly
- Test implementation details instead of behavior
- Write tests that cannot detect regressions
- Use production database connections
- Create tests with hardcoded sleeps or timeouts
- Write tests that validate wrong behavior as correct

## 🎯 TEST DEVELOPMENT WORKFLOW

### Before Writing Tests

1. **Understand the behavior** - Know what correct behavior looks like
2. **Identify edge cases** - Boundary conditions and error states
3. **Plan test scenarios** - Happy path, error path, boundary conditions
4. **Design test data** - Realistic, comprehensive test datasets
5. **Consider performance** - Fast execution, minimal resource usage

### During Test Development

1. **Write failing tests first** - Red-Green-Refactor cycle
2. **Test behavior, not implementation** - Focus on what, not how
3. **Use descriptive test names** - Clear expectation statements
4. **Keep tests isolated** - No dependencies between tests
5. **Validate thoroughly** - Comprehensive assertions

### After Writing Tests

1. **Run full test suite** - Ensure no regressions introduced
2. **Check coverage** - Maintain >95% coverage requirement
3. **Performance validation** - Tests execute under time limits
4. **Documentation** - Comment complex test scenarios
5. **Review test quality** - Can tests detect future bugs?

## 🔧 TEST DEBUGGING GUIDELINES

### Common Test Failure Patterns

1. **Flaky tests** - Usually timing or state issues
2. **Mock misconfigurations** - Incorrect mock return values
3. **Async/await issues** - Improper async test handling
4. **State pollution** - Tests affecting each other
5. **Precision errors** - Floating-point calculation issues

### Debugging Techniques

```typescript
// ✅ CORRECT: Add debugging information
test("should calculate absorption correctly", () => {
    const trades = createTestTrades();
    const result = detector.calculate(trades);

    // Add debugging context
    console.log("Test trades:", trades.length);
    console.log("Calculated result:", result);
    console.log("Expected result:", expectedResult);

    expect(result).toBeCloseTo(expectedResult, 6);
});
```

## 🚨 TEST EMERGENCY PROTOCOLS

### When Tests Fail in Production

1. **STOP all deployments** - No code changes until tests pass
2. **Identify root cause** - Bug in code or test?
3. **Fix the actual issue** - Never adjust tests to pass broken code
4. **Validate fix** - Ensure proper behavior restored
5. **Post-incident review** - Prevent similar failures

### Test Suite Recovery

1. **Run tests in isolation** - Identify specific failures
2. **Check mock integrity** - Verify mock behavior matches real systems
3. **Validate test data** - Ensure realistic test scenarios
4. **Review recent changes** - Identify potential causes
5. **Full system validation** - Integration testing after fixes

## 📈 PERFORMANCE TESTING STANDARDS

### Critical Path Testing

- **Trade processing latency** - Sub-millisecond requirements
- **Signal generation speed** - Real-time processing validation
- **Memory usage patterns** - No memory leaks or excessive allocation
- **Database query performance** - Optimized query execution
- **WebSocket throughput** - High-frequency message handling

### Load Testing Requirements

- **Concurrent user simulation** - 1000+ WebSocket connections
- **High-frequency data** - Realistic market data volumes
- **Stress testing** - System behavior under extreme load
- **Recovery testing** - Graceful degradation and recovery

## 🎯 CLAUDE CODE TEST OPERATIONAL GUIDELINES

### When Asked to Write Tests

1. **ASSESS REQUIREMENTS**: "Testing [X] behavior with [Y] test scenarios"
2. **VALIDATE TEST APPROACH**: "Tests will verify correct behavior by [method]"
3. **CHECK MOCK USAGE**: "Using structured mocks from **mocks**/ directory"
4. **CONFIRM COVERAGE**: "Tests cover [scenarios] with >95% coverage"
5. **VERIFY REALISM**: "Test data uses realistic market conditions"

### Test Quality Checklist

- [ ] Tests detect bugs in implementation
- [ ] Test data is realistic and market-compliant
- [ ] Mocks are properly structured in **mocks**/
- [ ] All async operations properly handled
- [ ] Performance requirements met (<100ms per test)
- [ ] No flaky or non-deterministic behavior
- [ ] Comprehensive edge case coverage
- [ ] Clear, descriptive test names and assertions

### When Tests Fail

```
🧪 TEST FAILURE DETECTED 🧪

Failed test: [test name]
Failure type: [assertion failure/timeout/error]
Expected: [expected value]
Actual: [actual value]

Analysis required:
1. Is the test expectation correct?
2. Is the implementation buggy?
3. Are mocks configured properly?
4. Is test data realistic?

Action: Fix the underlying issue, not the test.
```

## 📋 TEST MAINTENANCE STANDARDS

### Regular Test Maintenance

- **Weekly test suite health check** - All tests passing, good performance
- **Monthly mock validation** - Ensure mocks match real system behavior
- **Quarterly test data refresh** - Update with current market conditions
- **Annual test architecture review** - Optimize test patterns and coverage

### Test Documentation Requirements

- **Document complex test scenarios** - Why specific test cases exist
- **Maintain test data documentation** - What test data represents
- **Document mock behavior** - How mocks simulate real systems
- **Keep test instructions current** - Setup and execution procedures

---

**REMEMBER**: Tests are the first line of defense against bugs in production trading systems. Never compromise test integrity for convenience. Always fix the code, never the tests (unless the test itself is wrong).

For all other institutional standards, architecture patterns, and development guidelines, refer to the main `/Users/marcschot/Projects/OrderFlow Trading/CLAUDE.md` file.
