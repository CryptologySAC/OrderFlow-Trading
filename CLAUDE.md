# CLAUDE.md

Production trading system guidance for Claude Code with **ZERO TOLERANCE** for trading operation errors.

## 🚨 CRITICAL

Do not guess, NEVER guess; all your answers are based and calculated; if you need more data to calculate you ask for it; no guessing, no estimations, no general answers, no bullshit. Math and logic above everything, request clarification when you are unsure.

## 🏛️ INSTITUTIONAL STANDARDS

### 🚨 CRITICAL PROTECTION PROTOCOLS

#### Change Management Hierarchy

**🔒 PRODUCTION-CRITICAL (NO MODIFICATIONS):**

- `src/trading/dataStreamManager.ts` - Market data connectivity
- `src/market/orderFlowPreprocessor.ts` - Core trade processing
- `src/indicators/*/` - Pattern detection algorithms
- `src/services/signalCoordinator.ts` - Signal processing pipeline
- `src/trading/signalManager.ts` - Trading signal validation
- `src/multithreading/threadManager.ts` - Worker orchestration
- `src/multithreading/workers/*` - All worker implementations
- `src/multithreading/workerLogger.ts` - Worker logging
- `/public/scripts/dashboard.js` - Production WebSocket URLs
- `config.json` - Production configuration
- `.env` - **CRITICAL: Production API keys - NEVER MODIFY**

**⚠️ BUSINESS-CRITICAL (REQUIRES VALIDATION):**

- `src/infrastructure/db.ts` - Database operations
- `src/infrastructure/migrate.ts` - Data migrations
- `src/websocket/websocketManager.ts` - Client connections
- `src/core/config.ts` - Configuration management

**✅ DEVELOPMENT-SAFE:**

- Test files (`test/**/*.test.ts`)
- Documentation (`docs/**/*.md`)
- Build scripts (`package.json`, `tsconfig.json`)

#### Mandatory Change Validation

1. **Risk Assessment**: Evaluate trading operation impact
2. **Worker Thread Isolation Check**: No fallback/duplicate implementations
3. **Dependency Analysis**: Identify affected components
4. **Test Coverage**: Ensure comprehensive testing
5. **Rollback Plan**: Define immediate rollback
6. **User Approval**: Get explicit approval for business-critical changes

#### 🚫 LIVE DATA CACHING PROHIBITION

**STRICTLY FORBIDDEN**: Caching live market data causes financial risk through stale data.

```typescript
// ❌ NEVER: Cache live market data
const cachedOrderBookState = this.cache.get("orderbook");
const cachedBestBid = this.priceCache[symbol];

// ✅ CORRECT: Always fetch fresh data
const bestBid = this.orderBook.getBestBid();
const spread = this.orderBook.getSpread();
```

#### 🚫 NUCLEAR CLEANUP: ZERO TOLERANCE CONFIGURATION

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

## Development Commands

### Core Development

- `yarn build` - Build TypeScript project
- `yarn start:dev` - Development mode with hot reload
- `yarn start` - Start production build
- `yarn test` - Run all tests with Vitest
- `yarn test:coverage` - Coverage report (MUST be >95%, all tests MUST pass)
- `yarn lint` - ESLint (MUST pass with zero warnings)

### Institutional Testing

- `yarn test:integration` - Full integration test suite
- `yarn test:stress` - Performance and stress testing
- `yarn test:security` - Security vulnerability scanning
- `yarn test:compliance` - Regulatory compliance validation

## Architecture Overview

Real-time cryptocurrency trading system analyzing Binance order flow for trading signals.

### Core Data Flow

```
Binance WebSocket → OrderFlowPreprocessor → Pattern Detectors → SignalCoordinator → TradingSignals
```

### 🚨 CRITICAL ARCHITECTURE INSIGHTS

#### Parallel Data Paths (MANDATORY)

**TWO PATHS MUST RUN SIMULTANEOUSLY:**

1. **BinanceWorker (WebSocket Stream)**: Real-time live data

    - Processes live trade/depth data from WebSocket API
    - **MUST store stream data to database** to prevent gaps
    - Runs in dedicated worker thread

2. **Smart ID-Based Backlog Fill**: 100 minutes historical data via REST
    - Uses Smart ID-based approach via `TradesProcessor.fillBacklog()`
    - **Eliminates data gaps** using trade ID sequences
    - **MUST run in parallel with WebSocket** to prevent gaps

```typescript
// ✅ CORRECT: Parallel execution
await Promise.all([
    this.preloadHistoricalData(), // Smart ID-based calls
    this.startStreamConnection(), // WebSocket stream
]);

// ❌ WRONG: Sequential execution creates gaps
await this.preloadHistoricalData();
await this.startStreamConnection(); // Creates gap!
```

#### Smart ID-Based Backlog Implementation

**BREAKTHROUGH SOLUTION**: Eliminates data gaps completely using trade IDs vs time-based queries.

**Process:**

1. Fetch recent 1000 trades (`fromId=undefined`)
2. Calculate starting point (`oldestId - 1000`)
3. Fetch backwards in 1000-trade chunks
4. Continue until 100 minutes coverage achieved

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

### Pattern Detection System

#### Event-Based Detectors (Traditional)

- AbsorptionDetector - Large order absorption at key levels
- ExhaustionDetector - Liquidity exhaustion patterns
- DeltaCVDConfirmation - Volume delta confirmation
- SupportResistanceDetector - Key price levels

#### Zone-Based Detectors (Advanced)

- **AccumulationZoneDetector** - Evolving accumulation zones
- **DistributionZoneDetector** - Evolving distribution zones

**Key Differences:**

- Event-based: Point-in-time signals at specific prices
- Zone-based: Evolving processes across price ranges and time

### 🎯 DETECTOR OPTIMIZATION GOALS

#### AbsorptionDetector Turning Point Optimization

**PRIMARY OBJECTIVE**: Detect local tops/bottoms leading to **0.7%+ movement**.

**2-Phase Hierarchical Optimization:**

##### Phase 1: Core Parameters (Most Influential)

```javascript
// High sensitivity for 0.7%+ detection
zoneTicks: [2, 3, 4],           // Tight to medium zones
windowMs: [45000, 60000],       // 45-60s responsive timing
minAggVolume: [20, 30, 40],     // Sensitive to moderate volume
```

##### Phase 2: Refinement Parameters (False Signal Filtering)

- **Absorption Quality**: `absorptionThreshold` (0.45-0.75), `minPassiveMultiplier` (1.1-1.8)
- **Price Movement**: `priceEfficiencyThreshold` (0.01-0.025), `velocityIncreaseThreshold` (1.2-2.0)
- **Signal Timing**: `eventCooldownMs` (5000-20000), `spreadImpactThreshold` (0.002-0.005)

#### 🎯 Zone Volume Aggregation Architecture (MANDATORY)

**SOLUTION**: Expanded zone boundaries by 50% to ensure proper trade capture.

```typescript
// BEFORE (BROKEN): Too restrictive boundaries
const zoneSize = zoneTicks * this.tickSize;
const minPrice = zoneCenter - zoneSize / 2; // 5-tick zone: ±0.025

// AFTER (FIXED): Expanded boundaries for trade capture
const baseZoneSize = zoneTicks * this.tickSize;
const expandedZoneSize = baseZoneSize * 1.5; // 50% expansion
const minPrice = zoneCenter - expandedZoneSize / 2; // 5-tick zone: ±0.0375
```

**VALIDATION METRICS:**

- **Before**: `"aggressiveVolume":0,"tradeCount":0` (100% zones empty)
- **After**: `"aggressiveVolume":3,"aggressiveBuyVolume":3,"tradeCount":1` (accumulating volume)

### Signal Processing Pipeline

1. **SignalCoordinator** - Manages detector registration and signal queuing
2. **SignalManager** - Validates, correlates, and filters signals
3. **AnomalyDetector** - Integrates market anomaly detection
4. **AlertManager** - Handles webhook notifications

### Configuration

- Main config in `config.json` with symbol-specific settings
- Environment variables override config values
- Use `src/core/config.ts` for configuration management

#### 🎯 DeltaCVD Detector Configuration (Updated 2025-06-23)

**NEW A/B Testing Framework:** Three configurations for passive volume optimization:

```typescript
// No passive volume (pure CVD baseline)
{ usePassiveVolume: false, enableDepthAnalysis: false, detectionMode: "momentum", baseConfidenceRequired: 0.3, finalConfidenceRequired: 0.5 }

// With passive volume (enhanced CVD)
{ usePassiveVolume: true, enableDepthAnalysis: false, detectionMode: "momentum", baseConfidenceRequired: 0.3, finalConfidenceRequired: 0.5 }

// Complex configuration (full features)
{ usePassiveVolume: true, enableDepthAnalysis: true, detectionMode: "hybrid", baseConfidenceRequired: 0.4, finalConfidenceRequired: 0.6 }
```

**Benefits:** 60%+ memory reduction, 40-60% faster processing, proper passive volume implementation.

### Testing Setup

- Uses Vitest with setup file at `test/vitest.setup.ts`
- Extensive mocking in `__mocks__/` directory
- **MANDATORY: ALL tests MUST use proper mocks from `__mocks__/`**
- **NEVER create inline mocks - always use `__mocks__/` structure**
- **Mock files MUST mirror exact directory structure of `src/`**
- **All mocks MUST use `vi.fn()` for proper vitest integration**

### 🧪 UNIT TESTING STANDARDS (ZERO TOLERANCE)

#### Test Integrity Requirements

- **Tests MUST detect errors in code** - Never adjust tests to pass buggy implementations
- **Tests MUST validate real-world logic** - Test correct behavior, not broken code
- **Tests MUST fail when bugs are present** - Wrong logic should fail tests
- **NO adjusting expectations to match buggy code** - Fix code, not tests
- **NO lowering test standards** - Tests guide proper implementation

#### Prohibited Test Practices

- ❌ Adjusting expectations to match broken code
- ❌ Adding randomness workarounds to mask detection failures
- ❌ Lowering validation thresholds to hide logic bugs
- ❌ Using hardcoded defaults instead of validating real calculations
- ❌ Writing tests that validate current behavior vs correct behavior

### Database

- SQLite database with migrations in `src/infrastructure/migrate.ts`
- Database abstraction in `src/infrastructure/db.ts`

### Error Handling

- Custom error types in `src/core/errors.ts`
- Circuit breaker pattern for external API calls
- Correlation IDs for request tracing

## 🏦 INSTITUTIONAL DEVELOPMENT STANDARDS

### Code Quality Requirements (NON-NEGOTIABLE)

#### TypeScript Standards

- **ZERO `any` types** - Use precise typing or interfaces
- **NEVER `unknown`** without type guards and validation
- **ALL functions must have explicit return types**
- **ALL parameters must have explicit types**
- **Strict null checking enabled**
- **No implicit returns**
- **KEEP CODE SIMPLE** - Avoid complex casting, prefer interface compatibility

#### 🚫 MAGIC NUMBERS PROHIBITION (ZERO TOLERANCE)

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

#### Error Handling Standards

- **ALL async operations MUST have try-catch blocks**
- **ALL database operations MUST handle connection failures**
- **ALL external API calls MUST have circuit breaker protection**
- **ALL errors MUST include correlation IDs**
- **NO silent failures - ALL errors must be logged**

#### Performance Standards

- **Sub-millisecond latency for trade processing**
- **Memory usage must remain stable under load**
- **CPU usage optimized for real-time processing**
- **Database queries must be indexed and optimized**
- **WebSocket connections must handle 1000+ concurrent clients**

#### Security Standards

- **NO hardcoded secrets or API keys**
- **NEVER modify `.env` - Contains irreplaceable production credentials**
- **NEVER copy `example.env` over `.env` - Destroys production keys**
- **ALL inputs must be validated and sanitized**
- **Rate limiting on ALL external endpoints**
- **Proper correlation ID propagation**

#### Logging Standards (MANDATORY)

- **ALL logging MUST use ILogger interface** (`src/infrastructure/loggerInterface.ts`)
- **NEVER import concrete Logger implementations**
- **ALWAYS use dependency injection for ILogger**
- **NO console.log/info/warn/debug** - use ILogger methods
- **ONLY console.error for system panic** with documented POLICY OVERRIDE
- **Worker threads MUST use WorkerProxyLogger through ILogger interface**

### 🔢 FINANCIALMATH - MISSION CRITICAL (MANDATORY)

**CRITICAL REQUIREMENT**: ALL financial calculations MUST use `src/utils/financialMath.ts`.

#### Why FinancialMath is Required

- **Floating Point Precision**: Eliminates arithmetic errors
- **Trading Accuracy**: Ensures precise price/quantity calculations
- **Regulatory Compliance**: Meets institutional-grade precision
- **Data Integrity**: Prevents rounding error accumulation

#### Mandatory Usage Patterns

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

#### 📏 TICK SIZE COMPLIANCE (MANDATORY)

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

## Important Development Notes

### 🚨 CRITICAL: WebSocket URL Protection

**NEVER modify WebSocket URL in `/public/scripts/dashboard.js`:**

- URL `const TRADE_WEBSOCKET_URL = "wss://api.cryptology.pe/ltcusdt_trades";` is PRODUCTION-CRITICAL
- Changing this URL is BREAKING ERROR disconnecting dashboard from live data
- External WebSocket provides real-time market data system depends on
- Any modification requires explicit user approval

### 🛡️ MANDATORY CHANGE CONTROL PROCESS

#### For ANY modification to production-critical files:

1. **STOP** - Identify change impact level
2. **ASSESS** - Document all affected components
3. **PLAN** - Create implementation and rollback plan
4. **REQUEST** - Get explicit user approval with risk assessment
5. **IMPLEMENT** - Make changes with comprehensive logging
6. **VALIDATE** - Run full test suite and performance benchmarks
7. **MONITOR** - Track system behavior post-change

#### Change Categories:

**🔴 HIGH RISK (Requires Approval + Testing + Monitoring):**

- Trading algorithm modifications
- Data processing pipeline changes
- WebSocket connection logic
- Signal generation algorithms
- Database schema changes

**🟡 MEDIUM RISK (Requires Testing + Validation):**

- Configuration parameter changes
- UI/Dashboard modifications
- Logging and monitoring updates
- Performance optimizations

**🟢 LOW RISK (Standard Development):**

- Test file additions/modifications
- Documentation updates
- Code comments and formatting
- Development tool configurations

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

### Database Changes

- Always create migrations in `src/infrastructure/migrate.ts`
- Update version number and add migration logic
- Test both forward and rollback scenarios
- Validate data integrity during migration
- Performance test with production-size datasets
- Backup strategy for migration failures

### Configuration Changes

- Update TypeScript interfaces in `src/types/configTypes.ts`
- Validate new config options in `src/core/config.ts`
- Document parameter ranges and effects
- Every class with configurable options needs to use /config.json
- Backward compatibility validation
- Default value safety analysis

### WebSocket Management

- **DataStreamManager** (`src/trading/dataStreamManager.ts`) - Primary WebSocket connection manager for Binance streams
    - Handles trade and depth data streams with robust reconnection logic
    - Exponential backoff with jitter for reconnection attempts
    - Stream health monitoring and automatic recovery
    - Connection state management with proper event emission
- **WebSocketManager** (`src/websocket/websocketManager.ts`) - Manages server-side WebSocket connections for dashboard clients
- **Integration**: OrderFlowDashboard listens to DataStreamManager connection events and notifies dependent components
- Rate limiting applied to prevent API violations

### Important Connection Recovery Notes

- TradesProcessor and OrderBookState adjust health monitoring based on stream connection status
- When stream disconnects: health timeouts extended to avoid false unhealthy states
- When stream reconnects: OrderBookState automatically triggers recovery to rebuild order book
- All components properly handle reconnection events to maintain system consistency

### 🧵 WORKER THREAD ARCHITECTURE (CRITICAL)

**STRICT ISOLATION PRINCIPLE:** Dedicated worker thread architecture with absolute separation. **NO EXCEPTIONS.**

#### Worker Thread Responsibilities (EXCLUSIVE):

- **Logger Worker**: ALL logging operations (no console.log in main thread)
- **Binance Worker**: ALL upstream API communication (no direct API calls in main thread)
- **Communication Worker**: ALL downstream WebSocket/MQTT (no direct client communication in main thread)
- **Storage Worker**: ALL database operations (no direct SQLite access in main thread)

#### MANDATORY RULES:

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

**✅ SHARED PROXY SYSTEM:**
All workers MUST use shared proxy implementations from `src/multithreading/shared/`:

- `WorkerProxyLogger` - Logging via IPC message passing
- `WorkerMetricsProxy` - Metrics collection with 100ms batching
- `WorkerCircuitBreakerProxy` - Circuit breaker with BigInt support
- `WorkerRateLimiterProxy` - Rate limiting with request tracking
- `WorkerMessageRouter` - Message routing with 10ms queue flushing

**✅ WORKER THREAD COMMUNICATION:**

- Main thread communicates with workers via ThreadManager ONLY
- Workers communicate with main thread via parentPort.postMessage() ONLY
- Inter-worker communication via main thread message forwarding ONLY
- NO direct worker-to-worker communication channels
- ALL messages include correlation IDs for request tracing

**✅ INTERFACE CONTRACTS:**

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

#### PERFORMANCE OPTIMIZATIONS:

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

#### 🚫 CALCULATION INTEGRITY (ZERO TOLERANCE)

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

### Absolute Prohibitions (ZERO TOLERANCE)

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

### Required Approvals Matrix

| Change Type     | Approval Required | Testing Required           | Monitoring Period |
| --------------- | ----------------- | -------------------------- | ----------------- |
| Algorithm Logic | YES               | Full Suite + Performance   | 48 hours          |
| Data Processing | YES               | Integration + Stress       | 24 hours          |
| Configuration   | YES               | Validation + Compatibility | 12 hours          |
| UI/Dashboard    | NO                | Unit + E2E                 | 4 hours           |
| Documentation   | NO                | None                       | None              |
| Tests           | NO                | Self-validation            | None              |

### Emergency Override Protocol

**ONLY in system-down scenarios:**

1. Document the emergency situation
2. Make minimal necessary changes
3. Log all modifications with timestamps
4. Schedule immediate post-emergency review
5. Create comprehensive rollback plan

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

## 🧵 ENHANCED WORKER THREAD GUIDELINES

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

### Worker Thread Debugging Techniques

**Silent Failure Symptoms:**

- WebSocket messages not reaching handlers
- No error logs but functionality doesn't work
- Handlers exist but are never called

**Debugging Steps:**

1. **Add temporary logging** at message entry points
2. **Check proxy class usage** - no direct infrastructure imports
3. **Verify interface contracts** - ensure dependencies use interfaces
4. **Test message flow** - trace from WebSocket to handler

### Common Worker Thread Patterns

**Message Handling in Workers:**

```typescript
// ✅ CORRECT - Worker thread message handling
parentPort?.on("message", (msg: WorkerMessage) => {
    const logger: ILogger = new WorkerProxyLogger("worker-name");
    const metrics: IWorkerMetricsCollector = new WorkerMetricsProxy(
        "worker-name"
    );
    // Process message using only proxy classes
    handleMessage(msg, logger, metrics);
});
```

### Worker Thread Troubleshooting

**If worker thread communication fails:**

1. **Check imports**: No direct infrastructure imports in worker files
2. **Verify proxy usage**: All infrastructure accessed via proxy classes
3. **Interface compliance**: All dependencies use proper TypeScript interfaces
4. **Message validation**: Ensure proper message schema validation
5. **Correlation IDs**: Include correlation IDs for request tracing

## 🎯 CLAUDE CODE OPERATIONAL GUIDELINES

### When Asked to Make Changes:

1. **ASSESS FIRST**: "This change affects [X] components and has [Y] risk level"
2. **CHECK WORKER ISOLATION**: "This maintains/violates worker thread isolation because [reason]"
3. **ASK APPROVAL**: "This requires approval due to [specific reasons]"
4. **PROVIDE ALTERNATIVES**: "Safer approaches include [alternatives]"
5. **ESTIMATE IMPACT**: "Expected performance/reliability impact: [analysis]"
6. **REQUEST VALIDATION**: "Please confirm you want to proceed with these risks"

### 🧵 WORKER THREAD DEVELOPMENT GUIDELINES

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

**Performance Considerations:**

- **Metrics Batching**: Changes affecting metrics should maintain 100ms batching interval
- **Message Queue**: Keep queue flush interval at 10ms for low latency
- **Correlation IDs**: Always include correlation IDs for tracing
- **Error Handling**: Implement circuit breaker patterns for external operations

**For Worker Thread Violations:**

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

**For Protected Files:**

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

# Important Instruction Reminders

Do what has been asked; nothing more, nothing less.
NEVER create files unless absolutely necessary for achieving your goal.
ALWAYS prefer editing existing file to creating new one.
NEVER proactively create documentation files (\*.md) or README files. Only create documentation files if explicitly requested by User.

**FOR INSTITUTIONAL TRADING SYSTEMS:**

- ALWAYS assess financial impact of changes
- NEVER compromise data integrity or processing accuracy
- ALWAYS maintain audit trail of modifications
- NEVER deploy changes without comprehensive testing
- ALWAYS have rollback plans ready
