# SRC DEVELOPMENT GUIDELINES

**Production trading system development standards for the `src/` directory with ZERO TOLERANCE for trading operation errors.**

## 🚨 CRITICAL FOUNDATION

**Do not guess, NEVER guess; all your answers are based and calculated; if you need more data to calculate you ask for it; no guessing, no estimations, no general answers, no bullshit. Math and logic above everything, request clarification when you are unsure.**

**Reference**: For project-wide context and architecture overview, see `/CLAUDE.md` in project root.

## 🏦 INSTITUTIONAL DEVELOPMENT STANDARDS (NON-NEGOTIABLE)

### 🚨 CRITICAL PROTECTION PROTOCOLS

**🔒 PRODUCTION-CRITICAL FILES (NO MODIFICATIONS WITHOUT APPROVAL):**

- `src/trading/dataStreamManager.ts` - Market data connectivity
- `src/market/orderFlowPreprocessor.ts` - Core trade processing
- `src/indicators/*/` - Pattern detection algorithms
- `src/services/signalCoordinator.ts` - Signal processing pipeline
- `src/trading/signalManager.ts` - Trading signal validation
- `src/multithreading/threadManager.ts` - Worker orchestration
- `src/multithreading/workers/*` - All worker implementations
- `src/multithreading/workerLogger.ts` - Worker logging

**⚠️ BUSINESS-CRITICAL FILES (REQUIRES VALIDATION):**

- `src/infrastructure/db.ts` - Database operations
- `src/infrastructure/migrate.ts` - Data migrations
- `src/websocket/websocketManager.ts` - Client connections
- `src/core/config.ts` - Configuration management

### TypeScript Standards (ZERO TOLERANCE)

- **ZERO `any` types** - Use precise typing or interfaces
- **NEVER `unknown`** without type guards and validation
- **ALL functions must have explicit return types**
- **ALL parameters must have explicit types**
- **Strict null checking enabled**
- **No implicit returns**
- **KEEP CODE SIMPLE** - Avoid complex casting, prefer interface compatibility

### 🚫 MAGIC NUMBERS PROHIBITION (ZERO TOLERANCE)

**CRITICAL RULE**: Magic numbers **STRICTLY FORBIDDEN**. All threshold/limit/calculation values MUST be configurable.

```typescript
// ❌ NEVER: Hardcoded thresholds
if (priceEfficiency < 0.7) return null;
if (imbalance > 0.8) return "high";
const spreadThreshold = 0.005; // FORBIDDEN

// ✅ CORRECT: All values configurable
if (priceEfficiency < this.priceEfficiencyThreshold) return null;
if (imbalance > this.imbalanceHighThreshold) return "high";
const spreadThreshold = this.spreadHighThreshold;
```

**WHY THIS MATTERS:**

- **Signal Blocking Prevention**: Hardcoded values can block signals
- **Backtesting Flexibility**: Different values tested systematically
- **Production Optimization**: Optimal values deployed from testing
- **Configuration Auditability**: All parameters visible in config.json

### 🚫 NUCLEAR CLEANUP: ZERO TOLERANCE CONFIGURATION

**MANDATORY**: All enhanced detectors follow "NO DEFAULTS, NO FALLBACKS, NO BULLSHIT" philosophy.

**ARCHITECTURE PRINCIPLES:**

1. **🚫 ZERO DEFAULT METHODS**: No `getDefault*()` methods in enhanced detectors
2. **🚫 ZERO FALLBACK OPERATORS**: No `??` fallback operators
3. **🚫 ZERO HARDCODED VALUES**: All values configurable via settings
4. **✅ MANDATORY ZOD VALIDATION**: All settings validated with `process.exit(1)` on missing config
5. **✅ PURE WRAPPER ARCHITECTURE**: Enhanced detectors as pure config-driven wrappers

```typescript
// ✅ REQUIRED: Zod schemas for enhanced detectors
export const AbsorptionDetectorSchema = z.object({
    minAggVolume: z.number().int().min(1).max(1000),
    absorptionThreshold: z.number().min(0.1).max(1.0),
    windowMs: z.number().int().min(5000).max(300000),
    // ALL properties required - no .optional()
});

// ✅ REQUIRED: Config getters with Zod validation
export class Config {
    static get ABSORPTION_DETECTOR() {
        return AbsorptionDetectorSchema.parse(SYMBOL_CFG.absorption);
        // Zod .parse() throws on missing/invalid config → process.exit(1)
    }
}
```

**PROHIBITED PATTERNS:**

```typescript
// ❌ NEVER: Default methods, fallback operators, optional Zod properties
private getDefaultMinAggVolume(): number { return 20; }
const threshold = this.settings.threshold ?? 0.5;
minAggVolume: z.number().optional(), // FORBIDDEN
```

### 🚫 LIVE DATA CACHING PROHIBITION

**STRICTLY FORBIDDEN**: Caching live market data causes financial risk through stale data.

```typescript
// ❌ NEVER: Cache live market data
const cachedOrderBookState = this.cache.get("orderbook");
const cachedBestBid = this.priceCache[symbol];

// ✅ CORRECT: Always fetch fresh data
const bestBid = this.orderBook.getBestBid();
const spread = this.orderBook.getSpread();
```

### 🚫 CALCULATION INTEGRITY (ZERO TOLERANCE)

**CRITICAL RULE**: When calculations cannot be performed with valid data, return `null` - NEVER use default numbers, fallbacks, or arbitrary values.

```typescript
// ❌ NEVER: Default numbers when calculation is invalid
const efficiency = calculateEfficiency(data) ?? 0.5; // FORBIDDEN
const confidence = priceData.length < 3 ? 0.7 : calculate(priceData); // FORBIDDEN

// ✅ CORRECT: Return null for invalid calculations
const efficiency = calculateEfficiency(data); // returns number | null
if (efficiency === null) {
    return; // Cannot proceed without valid calculation
}

// ✅ CORRECT: Early return when insufficient data
if (trades.length < 3) {
    return null; // Honest: cannot calculate with insufficient data
}
```

**WHY THIS MATTERS:**

- **Trading Integrity**: Fake numbers cause wrong trading decisions
- **Data Honesty**: Better to admit insufficient data than guess
- **System Reliability**: Null values force proper error handling
- **Debugging**: Real issues visible, not masked by defaults

## 🔢 FINANCIALMATH - MISSION CRITICAL (MANDATORY)

**CRITICAL REQUIREMENT**: ALL financial calculations MUST use `src/utils/financialMath.ts`.

### Why FinancialMath is Required

- **Floating Point Precision**: Eliminates arithmetic errors
- **Trading Accuracy**: Ensures precise price/quantity calculations
- **Regulatory Compliance**: Meets institutional-grade precision
- **Data Integrity**: Prevents rounding error accumulation

### Mandatory Usage Patterns

```typescript
// ✅ REQUIRED: Use FinancialMath for all calculations
const midPrice = FinancialMath.calculateMidPrice(bid, ask, precision);
const spread = FinancialMath.calculateSpread(ask, bid, precision);
const mean = FinancialMath.calculateMean(values);
const stdDev = FinancialMath.calculateStdDev(values);

// ❌ PROHIBITED: Direct floating-point arithmetic
const midPrice = (bid + ask) / 2;
const ratio = volume1 / volume2;
const mean = values.reduce((a, b) => a + b) / values.length;
```

### 📏 TICK SIZE COMPLIANCE (MANDATORY)

**CRITICAL REQUIREMENT**: ALL price movements MUST respect minimum tick sizes.

**TICK SIZE RULES:**

- **Price < $1**: Minimum tick = 0.0001
- **$1 ≤ Price < $10**: Minimum tick = 0.001
- **$10 ≤ Price < $100**: Minimum tick = 0.01
- **$100 ≤ Price < $1000**: Minimum tick = 0.1
- **Price ≥ $1000**: Minimum tick = 1.0

```typescript
// ✅ CORRECT: Tick-compliant movements
const basePrice = 89.0; // Price ~$89
const tickSize = 0.01; // Correct tick for $10-$100 range
const newPrice = basePrice + tickSize; // 89.01 - valid

// ❌ PROHIBITED: Sub-tick movements
const invalidPrice = basePrice + 0.0005; // FORBIDDEN - half-cent on 1-cent tick
```

**WHY THIS MATTERS:**

- **Market Realism**: Sub-tick movements cannot occur in real markets
- **Correlation Accuracy**: Invalid movements corrupt calculations
- **Test Validity**: Tests with sub-tick movements provide false results
- **Signal Quality**: Detectors trained on invalid data produce unreliable signals

## 🧵 WORKER THREAD ARCHITECTURE (CRITICAL)

**STRICT ISOLATION PRINCIPLE**: Dedicated worker thread architecture with absolute separation. **NO EXCEPTIONS.**

### Worker Thread Responsibilities (EXCLUSIVE)

- **Logger Worker**: ALL logging operations (no console.log in main thread)
- **Binance Worker**: ALL upstream API communication (no direct API calls in main thread)
- **Communication Worker**: ALL downstream WebSocket/MQTT (no direct client communication in main thread)
- **Storage Worker**: ALL database operations (no direct SQLite access in main thread)

### MANDATORY RULES

**🚫 NEVER CREATE FALLBACK IMPLEMENTATIONS:**

- If functionality handled by worker thread, MUST ONLY be handled by that worker
- NO "backup" implementations in main thread
- NO "emergency" direct implementations
- NO duplicate code paths for same functionality

**🚫 NEVER MIX MAIN THREAD AND WORKER IMPLEMENTATIONS:**

- Logging: Use `WorkerProxyLogger` ONLY in workers, never direct Logger instantiation
- API Calls: Use worker thread communication ONLY, never direct HTTP clients
- WebSocket: Use ThreadManager broadcast ONLY, never direct socket.send()
- Database: Use ThreadManager.callStorage() ONLY, never direct Storage instantiation

**✅ CORRECT PATTERN:**

```typescript
// ❌ WRONG - Creates fallback/duplicate functionality
const logger = useWorkerLogger ? new WorkerProxyLogger() : new Logger();

// ✅ CORRECT - Single source of truth
const logger = new WorkerProxyLogger("worker-name");
const metrics: IWorkerMetricsCollector = new WorkerMetricsProxy("worker-name");
const circuitBreaker: IWorkerCircuitBreaker = new WorkerCircuitBreakerProxy(
    5,
    60000,
    "worker-name"
);
```

### SHARED PROXY SYSTEM

All workers MUST use shared proxy implementations from `src/multithreading/shared/`:

- `WorkerProxyLogger` - Logging via IPC message passing
- `WorkerMetricsProxy` - Metrics collection with 100ms batching
- `WorkerCircuitBreakerProxy` - Circuit breaker with BigInt support
- `WorkerRateLimiterProxy` - Rate limiting with request tracking
- `WorkerMessageRouter` - Message routing with 10ms queue flushing

### WORKER THREAD COMMUNICATION

- Main thread communicates with workers via ThreadManager ONLY
- Workers communicate with main thread via parentPort.postMessage() ONLY
- Inter-worker communication via main thread message forwarding ONLY
- NO direct worker-to-worker communication channels
- ALL messages include correlation IDs for request tracing

### INTERFACE CONTRACTS

```typescript
interface IWorkerMetricsCollector {
    updateMetric(name: string, value: number): void;
    incrementMetric(name: string): void;
    getMetrics(): EnhancedMetrics;
    getHealthSummary(): string;
    destroy?(): void | Promise<void>;
}

interface IWorkerCircuitBreaker {
    canExecute(): boolean;
    recordError(): void;
    recordSuccess(): void;
    execute<T>(operation: () => Promise<T>): Promise<T>;
    isTripped(): boolean;
    getStats(): { errorCount: number; isOpen: boolean; lastTripTime: number };
}
```

### PERFORMANCE OPTIMIZATIONS

**Batched Metrics Collection:**

- 100ms batching reduces IPC overhead by ~60%
- Maintains sub-millisecond latency for critical operations
- Automatic correlation ID generation for request tracing

**Message Queue Management:**

- 10ms flush intervals for low-latency message routing
- Maximum queue size of 1000 messages to prevent memory issues
- Automatic queue cleanup and overflow handling

**Enhanced Monitoring:**

- Worker uptime, error rates, and processing metrics tracked
- Circuit breaker state monitoring with failure thresholds
- Connection health monitoring across all workers

## 🛠️ ERROR HANDLING & LOGGING STANDARDS

### Logging Standards (MANDATORY)

- **ALL logging MUST use ILogger interface** (`src/infrastructure/loggerInterface.ts`)
- **NEVER import concrete Logger implementations**
- **ALWAYS use dependency injection for ILogger**
- **NO console.log/info/warn/debug** - use ILogger methods
- **ONLY console.error for system panic** with documented POLICY OVERRIDE
- **Worker threads MUST use WorkerProxyLogger through ILogger interface**

### Error Handling Standards

- **ALL async operations MUST have try-catch blocks**
- **ALL database operations MUST handle connection failures**
- **ALL external API calls MUST have circuit breaker protection**
- **ALL errors MUST include correlation IDs**
- **NO silent failures - ALL errors must be logged**

## 🚀 PERFORMANCE STANDARDS

- **Sub-millisecond latency for trade processing**
- **Memory usage must remain stable under load**
- **CPU usage optimized for real-time processing**
- **Database queries must be indexed and optimized**
- **WebSocket connections must handle 1000+ concurrent clients**

## 🔐 SECURITY STANDARDS

- **NO hardcoded secrets or API keys**
- **NEVER modify `.env` - Contains irreplaceable production credentials**
- **NEVER copy `example.env` over `.env` - Destroys production keys**
- **ALL inputs must be validated and sanitized**
- **Rate limiting on ALL external endpoints**
- **Proper correlation ID propagation**

## 🌐 WEBSOCKET DEVELOPMENT GUIDELINES

### Critical WebSocket Message Handling

**IMPORTANT**: Node.js `ws` library delivers WebSocket messages as `Buffer` objects, NOT strings, even when clients send JSON strings.

#### Correct Buffer-to-String Pattern

```typescript
private handleMessage(ws: WebSocket, message: RawData): void {
    // Convert Buffer to string safely
    let messageStr: string;
    if (typeof message === "string") {
        messageStr = message;
    } else if (Buffer.isBuffer(message)) {
        messageStr = message.toString("utf8");
    } else {
        return; // Discard non-string, non-Buffer as potential attack
    }

    // Now parse and validate
    try {
        const parsed = JSON.parse(messageStr);
        const validationResult = MessageSchema.safeParse(parsed);
        // ... continue with validation
    } catch (error) {
        // Handle parsing errors
    }
}
```

#### WebSocket Security Patterns

- **Always validate message types**: Use Zod or similar schema validation
- **Reject unknown types**: Non-string, non-Buffer messages are potential attacks
- **Rate limit clients**: Implement per-client rate limiting with cleanup
- **UTF-8 encoding**: Always specify encoding when converting Buffers

### WebSocket Debugging Checklist

When WebSocket handlers aren't being called:

1. **Check message type**: Are messages arriving as Buffers instead of strings?
2. **Validate handler registration**: Are handlers properly registered in handler map?
3. **Message structure**: Does message match expected schema?
4. **Rate limiting**: Is client being rate-limited?
5. **Worker thread isolation**: Are proper proxy classes being used?

## 🧪 UNIT TESTING STANDARDS (ZERO TOLERANCE)

### Test Integrity Requirements

- **Tests MUST detect errors in code** - Never adjust tests to pass buggy implementations
- **Tests MUST validate real-world logic** - Test correct behavior, not broken code
- **Tests MUST fail when bugs are present** - Wrong logic should fail tests
- **NO adjusting expectations to match buggy code** - Fix code, not tests
- **NO lowering test standards** - Tests guide proper implementation

### Testing Setup Requirements

- Uses Vitest with setup file at `test/vitest.setup.ts`
- Extensive mocking in `__mocks__/` directory
- **MANDATORY: ALL tests MUST use proper mocks from `__mocks__/`**
- **NEVER create inline mocks - always use `__mocks__/` structure**
- **Mock files MUST mirror exact directory structure of `src/`**
- **All mocks MUST use `vi.fn()` for proper vitest integration**

### Prohibited Test Practices

- ❌ Adjusting expectations to match broken code
- ❌ Adding randomness workarounds to mask detection failures
- ❌ Lowering validation thresholds to hide logic bugs
- ❌ Using hardcoded defaults instead of validating real calculations
- ❌ Writing tests that validate current behavior vs correct behavior

## 📁 SRC DIRECTORY STRUCTURE & GUIDELINES

### Key Directories

- `src/core/` - Configuration and error handling
- `src/infrastructure/` - Logging, metrics, circuit breakers, database
- `src/market/` - Order book state and data preprocessing
- `src/indicators/` - Pattern detection algorithms
- `src/services/` - Signal coordination, anomaly detection, alerts
- `src/trading/` - Signal processing and trading logic
- `src/storage/` - Data persistence layer
- `src/websocket/` - WebSocket connection management
- `src/multithreading/` - Worker thread management
- `src/utils/` - Utility functions including FinancialMath

### Configuration Management

- **Every class with configurable options needs to use /config.json**
- Update TypeScript interfaces in `src/types/configTypes.ts`
- Validate new config options in `src/core/config.ts`
- Document parameter ranges and effects
- Backward compatibility validation
- Default value safety analysis

### Database Operations

- Always create migrations in `src/infrastructure/migrate.ts`
- Update version number and add migration logic
- Test both forward and rollback scenarios
- Validate data integrity during migration
- Performance test with production-size datasets
- Backup strategy for migration failures

### Financial System Compliance

#### Data Integrity

- **ALL trade data immutable once processed**
- **Signal timestamps precise to microseconds**
- **Order book state atomic and consistent**
- **Database transactions ACID compliant**

#### Monitoring & Observability

- **ALL critical paths emit metrics**
- **Component health checks mandatory**
- **Performance metrics collection required**
- **Alert thresholds for system anomalies**

#### Disaster Recovery

- **Graceful degradation under partial failures**
- **Automatic reconnection with exponential backoff**
- **Circuit breaker patterns for external dependencies**
- **Data backup and recovery procedures**

## 🔧 DEVELOPMENT PATTERNS

### When Adding New Detectors

#### Event-Based Detectors (Traditional)

1. Extend `BaseDetector` class
2. Implement `detect(trade: EnrichedTradeEvent)` method
3. Register in `DetectorFactory`
4. Add configuration options to symbol config
5. Include comprehensive tests (>95% coverage, all tests MUST pass)
6. Performance benchmark against existing detectors
7. Risk assessment for false positive/negative rates

#### Zone-Based Detectors (Advanced)

1. Extend `EventEmitter` for zone event handling
2. Implement `analyze(trade: EnrichedTradeEvent): ZoneAnalysisResult` method
3. Use `ZoneManager` for lifecycle management
4. Handle zone candidates and zone formation logic
5. Emit zone updates and signals via WebSocket broadcasting
6. Memory usage analysis for zone state management
7. Concurrent access pattern validation

### When Modifying Signal Processing

- Maintain correlation ID propagation for tracing
- Update anomaly integration if detector behavior changes
- Test signal priority queue behavior in `SignalCoordinator`
- Validate signal latency under load
- Ensure signal ordering consistency
- Test signal deduplication logic

### Worker Thread Development Guidelines

**Before Making Any Changes to Worker Files:**

1. **IDENTIFY WORKER SCOPE**: Determine which worker thread change affects
2. **CHECK PROXY USAGE**: Ensure only shared proxy classes used, never direct infrastructure
3. **VALIDATE INTERFACES**: Confirm interface contracts maintained
4. **ASSESS PERFORMANCE**: Consider impact on message batching and IPC overhead
5. **VERIFY ISOLATION**: Ensure no direct cross-thread communication introduced

**When Adding New Worker Functionality:**

```typescript
// ✅ CORRECT: Use shared proxy implementations
const logger = new WorkerProxyLogger("worker-name");
const metrics: IWorkerMetricsCollector = new WorkerMetricsProxy("worker-name");
const circuitBreaker: IWorkerCircuitBreaker = new WorkerCircuitBreakerProxy(
    5,
    60000,
    "worker-name"
);

// ✅ CORRECT: Message passing pattern
parentPort?.postMessage({
    type: "operation_result",
    data: result,
    worker: "worker-name",
    correlationId: generateCorrelationId(),
});

// ❌ WRONG: Direct infrastructure import
import { Logger } from "../../infrastructure/logger.js"; // VIOLATION!
```

**When Modifying Existing Infrastructure:**

1. **UPDATE INTERFACES**: If changing infrastructure classes, update corresponding interfaces
2. **MAINTAIN COMPATIBILITY**: Ensure proxy classes continue to work with changes
3. **TEST WORKER ISOLATION**: Verify no worker uses direct infrastructure after changes
4. **UPDATE DOCUMENTATION**: Update Worker Thread Isolation Architecture docs

### Type Casting Detection and Prevention

**RED FLAGS - Immediate Violations:**

```typescript
// ❌ NEVER DO THIS - Breaks worker thread isolation
const rateLimiter = workerRateLimiter as unknown as RateLimiter;
const logger = workerLogger as unknown as Logger;

// ✅ CORRECT - Use proper interfaces
const rateLimiter: IWorkerRateLimiter = new WorkerRateLimiterProxy();
const logger: ILogger = new WorkerProxyLogger("worker-name");
```

## 🚫 ABSOLUTE PROHIBITIONS (ZERO TOLERANCE)

**NEVER:**

- **Modify, overwrite, or copy over `.env` file - Contains irreplaceable production API keys**
- **Use magic numbers or hardcoded thresholds in detector implementations**
- Modify production-critical algorithms without explicit approval
- Change WebSocket URLs or connection parameters
- Alter signal processing logic without validation
- Modify database schemas without migration planning
- Change configuration defaults without impact analysis
- Use `any` types or unsafe type assertions
- Create silent failure conditions
- Bypass error handling or logging
- Make breaking changes to public interfaces
- **Create fallback implementations for worker thread functionality**
- **Duplicate worker thread logic in main thread**
- **Mix worker thread and main thread implementations for same functionality**

## 📋 CHANGE CONTROL MATRIX

| Change Type     | Approval Required | Testing Required           | Monitoring Period |
| --------------- | ----------------- | -------------------------- | ----------------- |
| Algorithm Logic | YES               | Full Suite + Performance   | 48 hours          |
| Data Processing | YES               | Integration + Stress       | 24 hours          |
| Configuration   | YES               | Validation + Compatibility | 12 hours          |
| UI/Dashboard    | NO                | Unit + E2E                 | 4 hours           |
| Documentation   | NO                | None                       | None              |
| Tests           | NO                | Self-validation            | None              |

## 🚨 VIOLATION DETECTION PATTERNS

### Worker Thread Isolation Violations

```
🧵 WORKER THREAD ISOLATION VIOLATION DETECTED 🧵

Violation type: [Fallback implementation/Duplicate functionality/Mixed threading]
File: [filename]
Issue: [specific violation description]

This violates strict worker thread isolation principle:
- Worker thread functionality MUST remain exclusive to workers
- NO fallback implementations permitted
- NO duplicate code paths allowed

Required corrections:
1. [specific fix needed]
2. [architectural principle to follow]

This change is PROHIBITED without explicit architectural approval.
```

### High Risk Changes

```
⚠️ HIGH RISK CHANGE DETECTED ⚠️

This modification affects: [list components]
Risk level: [HIGH/MEDIUM/LOW]
Potential impact: [describe risks]

Required before proceeding:
- [ ] User approval confirmation
- [ ] Test suite validation
- [ ] Performance impact assessment
- [ ] Rollback plan preparation

Do you want to proceed? Please confirm with explicit approval.
```

### Protected File Access

```
🔒 PRODUCTION-CRITICAL FILE DETECTED 🔒

File: [filename]
Protection level: [level]
Reason: [why it's protected]

This file requires special handling due to production dependencies.
Recommended alternatives:
1. [alternative approach 1]
2. [alternative approach 2]

Request explicit approval to modify this protected file.
```

## 📖 REFERENCE

**For complete project context including:**

- Architecture overview
- Core data flow patterns
- Signal processing pipeline
- Pattern detection systems
- WebSocket management details
- Testing setup specifics

**See**: `/CLAUDE.md` in project root

---

**INSTITUTIONAL TRADING SYSTEM REQUIREMENTS:**

- ALWAYS assess financial impact of changes
- NEVER compromise data integrity or processing accuracy
- ALWAYS maintain audit trail of modifications
- NEVER deploy changes without comprehensive testing
- ALWAYS have rollback plans ready

**This document establishes the institutional-grade development standards required for maintaining a production-critical financial trading system. All src/ development must adhere to these standards without exception.**
