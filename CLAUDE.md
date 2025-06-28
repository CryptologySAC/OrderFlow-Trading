# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🏛️ INSTITUTIONAL GRADE DEVELOPMENT STANDARDS

This is a **PRODUCTION TRADING SYSTEM** handling real financial data and trading decisions. All code changes must meet institutional-grade standards with zero tolerance for errors that could impact trading operations.

### 🚨 CRITICAL PROTECTION PROTOCOLS

#### Change Management Hierarchy (STRICT ENFORCEMENT)

**🔒 PRODUCTION-CRITICAL FILES (NO MODIFICATIONS WITHOUT EXPLICIT APPROVAL):**

- `src/trading/dataStreamManager.ts` - Market data connectivity
- `src/market/orderFlowPreprocessor.ts` - Core trade processing
- `src/indicators/*/` - All pattern detection algorithms
- `src/services/signalCoordinator.ts` - Signal processing pipeline
- `src/trading/signalManager.ts` - Trading signal validation
- `src/multithreading/threadManager.ts` - Worker thread orchestration
- `src/multithreading/workers/*` - All worker thread implementations
- `src/multithreading/workerLogger.ts` - Worker logging delegation
- `/public/scripts/dashboard.js` - Production WebSocket URLs
- `config.json` - Production configuration parameters
- `.env` - **CRITICAL: Contains production API keys and secrets - NEVER MODIFY**

**⚠️ BUSINESS-CRITICAL FILES (REQUIRES VALIDATION):**

- `src/infrastructure/db.ts` - Database operations
- `src/infrastructure/migrate.ts` - Data migrations
- `src/websocket/websocketManager.ts` - Client connections
- `src/core/config.ts` - Configuration management

**✅ DEVELOPMENT-SAFE FILES:**

- Test files (`test/**/*.test.ts`)
- Documentation (`docs/**/*.md`)
- Build scripts (`package.json`, `tsconfig.json`)
- Development utilities

#### Mandatory Change Validation Protocol

**BEFORE ANY CODE MODIFICATION:**

1. **Risk Assessment**: Evaluate potential impact on trading operations
2. **Worker Thread Isolation Check**: Ensure no fallback/duplicate implementations
3. **Dependency Analysis**: Identify all affected components
4. **Test Coverage**: Ensure comprehensive test coverage exists
5. **Rollback Plan**: Define immediate rollback procedure
6. **User Approval**: Get explicit approval for business-critical changes

#### 🚫 STRICTLY FORBIDDEN: LIVE DATA CACHING

**CRITICAL PROHIBITION**: Caching of live market data is **STRICTLY FORBIDDEN** in this production trading system.

**RATIONALE:**

- **Financial Risk**: Stale cached data can lead to incorrect trading signals
- **Market Impact**: Outdated prices/volumes cause wrong signal timing
- **Real-time Requirement**: Trading algorithms depend on millisecond-fresh data
- **Data Integrity**: Cache invalidation failures create systematic trading errors

**PROHIBITED PATTERNS:**

```typescript
// ❌ NEVER: Cache live market data
const cachedOrderBookState = this.cache.get('orderbook');
const cachedBestBid = this.priceCache[symbol];
const cachedTradeData = this.memoize(getTrade);

// ❌ NEVER: Store live data in variables for reuse
private lastBestBid: number; // DON'T cache live quotes
private cachedSpread: number; // DON'T cache live calculations
private bufferedTrades: Trade[]; // DON'T cache live trades
```

**ALLOWED PATTERNS:**

```typescript
// ✅ CORRECT: Always fetch fresh data
const bestBid = this.orderBook.getBestBid();
const spread = this.orderBook.getSpread();
const trade = this.getCurrentTrade();

// ✅ CORRECT: Single-use calculation within method scope
const bestBid = this.orderBook.getBestBid();
const bestAsk = this.orderBook.getBestAsk();
const spread = bestAsk - bestBid; // Only within same method call
```

**VIOLATIONS DETECTION:**
Any implementation of caching mechanisms on live market data will be **IMMEDIATELY REJECTED** and flagged as a critical trading system violation.

## Development Commands

### Core Development

- `yarn build` - Build the TypeScript project
- `yarn start:dev` - Run in development mode with hot reload
- `yarn start` - Start the production build
- `yarn test` - Run all tests with Vitest
- `yarn test:coverage` - Run tests with coverage report (MUST be >95%)
- `yarn lint` - Run ESLint (MUST pass with zero warnings)

### Institutional Testing Requirements

- `yarn test:integration` - Full integration test suite
- `yarn test:stress` - Performance and stress testing
- `yarn test:security` - Security vulnerability scanning
- `yarn test:compliance` - Regulatory compliance validation

## Architecture Overview

This is a real-time cryptocurrency trading system that analyzes Binance order flow to generate trading signals. The system uses an event-driven architecture with the following key components:

### Core Data Flow

```
Binance WebSocket → OrderFlowPreprocessor → Pattern Detectors → SignalCoordinator → TradingSignals
```

### 🚨 CRITICAL ARCHITECTURE INSIGHTS

#### Data Storage and Stream Management

**CRITICAL UNDERSTANDING**: The system has TWO parallel data paths that MUST run simultaneously:

1. **BinanceWorker (WebSocket Stream)**: Handles real-time live data from WebSocket

    - Processes live trade/depth data from Binance WebSocket API
    - **MUST store stream data to database** to prevent gaps on client reload
    - Runs in dedicated worker thread for isolation

2. **Smart ID-Based Backlog Fill**: Dynamically fetches 100 minutes of historical data via REST API
    - Uses Smart ID-based approach via `TradesProcessor.fillBacklog()`
    - **Eliminates data gaps** by using trade ID sequences instead of time-based queries
    - **Dynamically determines** required data volume for 100-minute coverage
    - **MUST run in parallel with WebSocket stream** to prevent gaps

#### Parallel Execution Requirements

**WHY PARALLEL EXECUTION IS CRITICAL:**

- Stream data provides real-time processing for signals
- API data provides historical context for pattern detection
- Any gap between historical data end and live stream start causes data loss
- Client reloads require complete data continuity from storage

**IMPLEMENTATION PATTERN:**

```typescript
// ✅ CORRECT: Parallel execution
await Promise.all([
    this.preloadHistoricalData(), // Smart ID-based calls for 100 minutes
    this.startStreamConnection(), // WebSocket stream in parallel
]);

// ❌ WRONG: Sequential execution creates gaps
await this.preloadHistoricalData();
await this.startStreamConnection(); // Creates gap!
```

#### Stream Data Storage

**CRITICAL**: All stream data from BinanceWorker MUST be stored via:

```typescript
// In processTrade() method:
this.dependencies.storage.saveAggregatedTrade(data, symbol);
```

**WHY STORAGE IS REQUIRED:**

- WebSocket data is real-time and cannot be re-fetched
- Client reloads depend on stored data for backlog
- Missing storage creates permanent data gaps
- Trading signals require complete historical context

#### Smart ID-Based Backlog Implementation

**BREAKTHROUGH SOLUTION**: The system now uses a Smart ID-based approach that **eliminates data gaps** completely.

**How It Works:**

1. **Step 1**: Fetch most recent 1000 trades (`fromId=undefined`) to establish baseline
2. **Step 2**: Calculate starting point for historical data (`oldestId - 1000`)
3. **Step 3**: Fetch older trades in 1000-trade chunks, jumping backwards by trade IDs
4. **Step 4**: Continue until 100 minutes of time coverage is achieved

**Key Advantages:**

- **Zero Data Gaps**: ID-based queries are 100% reliable vs time-based queries
- **Dynamic Coverage**: Automatically adjusts to market activity levels
- **Precise Control**: Always gets exactly 100 minutes of coverage
- **Performance**: Faster and more predictable than time-based approaches

**Implementation:**

```typescript
// Smart ID-based backlog in TradesProcessor.fillBacklog()
const targetCoverageMs = this.storageTime + 10 * 60 * 1000; // 100 minutes
const recentTrades = await this.binanceFeed.tradesAggregate(
    symbol,
    1000,
    undefined
);
let currentFromId = Math.min(...recentTrades.map((t) => t.a!)) - 1000;

// Continue fetching backwards until target coverage achieved
while (currentCoverageMs < targetCoverageMs) {
    const trades = await this.binanceFeed.tradesAggregate(
        symbol,
        1000,
        currentFromId
    );
    currentFromId = Math.min(...trades.map((t) => t.a!)) - 1000;
}
```

### Key Directories

- `src/core/` - Configuration management and error handling
- `src/infrastructure/` - Cross-cutting concerns (logging, metrics, circuit breakers, database)
- `src/market/` - Order book state management and data preprocessing
- `src/indicators/` - Pattern detection algorithms (absorption, exhaustion, accumulation, etc.)
- `src/services/` - Signal coordination, anomaly detection, and alert management
- `src/trading/` - Signal processing and trading logic
- `src/storage/` - Data persistence layer
- `src/websocket/` - WebSocket connection management
- `src/multithreading/` - Worker thread management for high-performance processing

### Main Entry Point

- `src/index.ts` exports the main `OrderFlowDashboard` class
- The dashboard orchestrates all components and manages the application lifecycle

### Pattern Detection System

The system uses both event-based and zone-based detection architectures:

#### Event-Based Detectors (Traditional)

- AbsorptionDetector - Large order absorption at key levels
- ExhaustionDetector - Liquidity exhaustion patterns
- DeltaCVDConfirmation - Volume delta confirmation
- SupportResistanceDetector - Key price levels

#### Zone-Based Detectors (Advanced)

- **AccumulationZoneDetector** - Evolving accumulation zones over time and price ranges
- **DistributionZoneDetector** - Evolving distribution zones over time and price ranges

**Key Differences:**

- Event-based: Point-in-time signals at specific prices
- Zone-based: Evolving processes tracked across price ranges and time periods

See [Zone-Based Architecture Documentation](docs/Zone-Based-Architecture.md) for comprehensive details.

All detectors extend `BaseDetector` and process `EnrichedTradeEvent` objects.

### 🎯 DETECTOR OPTIMIZATION GOALS

#### AbsorptionDetector Turning Point Optimization

**PRIMARY OBJECTIVE**: Detect local tops and bottoms that lead to **0.7%+ movement** until the next local top or bottom.

**OPTIMIZATION CRITERIA**:

- **Maximize detection rate** of significant turning points (0.7%+ moves)
- **Minimize false signals** that don't lead to substantial movement
- **Balance sensitivity vs precision** for optimal signal quality

**STRATEGIC APPROACH**: 2-Phase Hierarchical Optimization

##### Phase 1: Core Parameters (Most Influential)

Focus on the parameters with highest impact on turning point detection:

1. **Zone Size (`zoneTicks`)**:

    - Range: 1-10 ticks
    - Impact: Granularity of absorption detection
    - Smaller zones = more precise, larger zones = broader institutional patterns

2. **Time Window (`windowMs`)**:

    - Range: 30-180 seconds
    - Impact: Pattern formation timeframe
    - Shorter windows = faster signals, longer windows = more context

3. **Min Aggressive Volume (`minAggVolume`)**:
    - Range: 15-150
    - Impact: Signal significance threshold
    - Lower volume = more signals, higher volume = higher quality

**Phase 1 Expected Optimal Ranges** (for 0.7%+ moves):

```javascript
// High sensitivity for 0.7%+ detection
zoneTicks: [2, 3, 4],           // Tight to medium zones
windowMs: [45000, 60000],       // 45-60s responsive timing
minAggVolume: [20, 30, 40],     // Sensitive to moderate volume
```

##### Phase 2: Refinement Parameters (False Signal Filtering)

After identifying best Phase 1 combinations, refine with quality filters:

1. **Absorption Quality**:

    - `absorptionThreshold`: 0.45-0.75 (lower = more signals)
    - `minPassiveMultiplier`: 1.1-1.8 (higher = stricter absorption)
    - `maxAbsorptionRatio`: 0.4-0.7 (higher = allow more aggressive)

2. **Price Movement Validation**:

    - `priceEfficiencyThreshold`: 0.01-0.025 (lower = more price impact sensitive)
    - `velocityIncreaseThreshold`: 1.2-2.0 (higher = require stronger acceleration)

3. **Signal Timing & Filtering**:
    - `eventCooldownMs`: 5000-20000 (longer = fewer duplicate signals)
    - `spreadImpactThreshold`: 0.002-0.005 (market impact sensitivity)

**EVALUATION METRICS FOR 0.7%+ MOVES**:

- **Primary**: Detection Rate (% of 0.7%+ moves caught), False Signal Rate
- **Secondary**: Precision, Timing accuracy, Average movement magnitude

**BACKTESTING COMMANDS**:

```bash
# Phase 1: Core parameter optimization
npx ts-node scripts/runBacktest.ts --detectors absorptionDetector \
  --custom-grid '{"zoneTicks":[2,3,4],"windowMs":[45000,60000],"minAggVolume":[20,30,40]}' \
  --speed 100 --verbose

# Phase 2: Refinement based on Phase 1 winners
npx ts-node scripts/runBacktest.ts --detectors absorptionDetector \
  --custom-grid '{"absorptionThreshold":[0.45,0.55,0.65],"minPassiveMultiplier":[1.1,1.3,1.5]}' \
  --speed 100 --verbose
```

**OPTIMIZATION FILES**:

- `absorption_turning_point_optimization.js` - Detailed optimization strategies
- `start_absorption_optimization.sh` - Automated optimization sequence

### Signal Processing Pipeline

1. **SignalCoordinator** (`src/services/signalCoordinator.ts`) - Manages detector registration and signal queuing
2. **SignalManager** (`src/trading/signalManager.ts`) - Validates, correlates, and filters signals
3. **AnomalyDetector** (`src/services/anomalyDetector.ts`) - Integrates market anomaly detection
4. **AlertManager** (`src/alerts/alertManager.ts`) - Handles webhook notifications

### Configuration

- Main config in `config.json` with symbol-specific settings
- Environment variables override config values
- Use `src/core/config.ts` for configuration management

### Testing Setup

- Uses Vitest with setup file at `test/vitest.setup.ts`
- Extensive mocking in `__mocks__/` directory
- Tests follow pattern: `componentName.test.ts` in `test/` directory
- **MANDATORY: ALL tests MUST use proper mocks from `__mocks__/` directory**
- **NEVER create inline mocks in test files - always use `__mocks__/` structure**
- **Mock files MUST mirror the exact directory structure of `src/`**
- **All mocks MUST use `vi.fn()` for proper vitest integration**

### 🧪 UNIT TESTING STANDARDS (MANDATORY - ZERO TOLERANCE)

#### Test Integrity Requirements

- **Tests MUST detect errors in code** - Never adjust tests to pass buggy implementations
- **Tests MUST validate real-world logic** - Test against correct behavior, not current broken code
- **Tests MUST fail when bugs are present** - If logic is wrong, tests should fail
- **NO adjusting expectations to match buggy code** - Fix the code, not the tests
- **NO lowering test standards to make tests pass** - Tests guide proper implementation

#### Error Detection Validation

- Every test must validate the CORRECT implementation of the feature
- Tests must be written based on requirements/specifications, not current code behavior
- When tests fail due to bugs, fix the bugs, never lower the test standards
- Tests that pass buggy code are worse than no tests at all
- **CRITICAL: If a test passes when it should fail, the test is broken, not the code**

#### Prohibited Test Practices

- ❌ Adjusting expectations to match broken code (`expect(0).toBeGreaterThan(0)` → `expect(0).toBeGreaterThanOrEqual(0)`)
- ❌ Adding randomness workarounds to mask detection failures
- ❌ Lowering validation thresholds to hide logic bugs
- ❌ Using hardcoded defaults in tests instead of validating real calculations
- ❌ Writing tests that validate current behavior instead of correct behavior

#### Required Test Practices

- ✅ Test the CORRECT logic implementation based on specifications
- ✅ Validate exact method behavior against requirements
- ✅ Ensure tests fail when known bugs are present
- ✅ Write tests that guide proper bug fixes
- ✅ Use deterministic test data to ensure reliable error detection

### 🔢 FINANCIALMATH - MISSION CRITICAL CALCULATIONS (MANDATORY)

**CRITICAL REQUIREMENT**: ALL financial calculations MUST use `src/utils/financialMath.ts` for precision and accuracy.

#### Why FinancialMath is Required

- **Floating Point Precision**: Eliminates floating-point arithmetic errors in financial calculations
- **Trading Accuracy**: Ensures precise price/quantity calculations for live trading
- **Regulatory Compliance**: Meets institutional-grade numerical precision requirements
- **Data Integrity**: Prevents accumulation of rounding errors in high-frequency operations

#### Mandatory Usage Patterns

**✅ REQUIRED: Use FinancialMath for all calculations**

```typescript
// Price calculations
const midPrice = FinancialMath.calculateMidPrice(bid, ask, precision);
const spread = FinancialMath.calculateSpread(ask, bid, precision);

// Quantity operations
const ratio = FinancialMath.divideQuantities(volume1, volume2);
const product = FinancialMath.multiplyQuantities(price, quantity);

// Statistical calculations (NEW)
const mean = FinancialMath.calculateMean(values);
const stdDev = FinancialMath.calculateStdDev(values);
const percentile = FinancialMath.calculatePercentile(values, 95);
```

**❌ PROHIBITED: Direct floating-point arithmetic**

```typescript
// NEVER DO THIS - causes precision errors
const midPrice = (bid + ask) / 2;
const ratio = volume1 / volume2;
const mean = values.reduce((a, b) => a + b) / values.length;
```

#### Implementation Requirements

- **ALL detectors**: Must use FinancialMath for price/quantity operations
- **Statistical Analysis**: Must use FinancialMath statistical methods (not DetectorUtils)
- **Zone Calculations**: Must use FinancialMath for zone-based computations
- **Risk Calculations**: Must use FinancialMath for precision-critical risk metrics

#### Migration Priority

**HIGH PRIORITY**: Replace any DetectorUtils usage with FinancialMath equivalents

- **DetectorUtils.calculateMean()** → **FinancialMath.calculateMean()**
- **DetectorUtils.calculateStdDev()** → **FinancialMath.calculateStdDev()**
- **DetectorUtils.calculatePercentile()** → **FinancialMath.calculatePercentile()**

**RATIONALE**: FinancialMath provides institutional-grade precision while DetectorUtils may have floating-point precision issues affecting live trading.

#### 📏 TICK SIZE COMPLIANCE (MANDATORY)

**CRITICAL REQUIREMENT**: ALL price movements in tests and calculations MUST respect minimum tick sizes for realistic market behavior.

**TICK SIZE RULES:**

- **Price < $1**: Minimum tick = 0.0001
- **$1 ≤ Price < $10**: Minimum tick = 0.001
- **$10 ≤ Price < $100**: Minimum tick = 0.01
- **$100 ≤ Price < $1000**: Minimum tick = 0.1
- **Price ≥ $1000**: Minimum tick = 1.0

**✅ REQUIRED: Tick-compliant price movements**

```typescript
// ✅ CORRECT: Use proper tick sizes
const basePrice = 89.0; // Price ~$89
const tickSize = 0.01; // Correct tick for $10-$100 range
const newPrice = basePrice + tickSize; // 89.01 - valid

// ✅ CORRECT: Multiple tick movements
const priceChange = basePrice + i * 0.01; // Valid 1-cent increments
```

**❌ PROHIBITED: Sub-tick price movements**

```typescript
// ❌ NEVER: Sub-tick movements create invalid market data
const basePrice = 89.0;
const invalidPrice = basePrice + 0.0005; // FORBIDDEN - half-cent on 1-cent tick
const wrongPrice = basePrice + 0.001; // FORBIDDEN - tenth-cent on 1-cent tick
```

**WHY THIS MATTERS:**

- **Market Realism**: Sub-tick movements cannot occur in real markets
- **Correlation Accuracy**: Invalid price movements corrupt price/volume correlation calculations
- **Test Validity**: Tests with sub-tick movements provide false results
- **Signal Quality**: Detectors trained on invalid data produce unreliable signals

**ENFORCEMENT**: Any test or calculation using sub-tick price movements will be **IMMEDIATELY REJECTED** as creating unrealistic market conditions.

### Database

- SQLite database with migrations in `src/infrastructure/migrate.ts`
- Database abstraction in `src/infrastructure/db.ts`

### Error Handling

- Custom error types in `src/core/errors.ts`
- Circuit breaker pattern for external API calls
- Correlation IDs for request tracing across components

## 🏦 INSTITUTIONAL DEVELOPMENT STANDARDS

### Code Quality Requirements (NON-NEGOTIABLE)

#### TypeScript Standards

- **ZERO `any` types** - Use precise typing or well-defined interfaces
- **NEVER `unknown`** without proper type guards and validation
- **ALL functions must have explicit return types**
- **ALL parameters must have explicit types**
- **Strict null checking enabled**
- **No implicit returns**
- **KEEP CODE SIMPLE** - Avoid complex casting patterns, prefer interface compatibility

#### 🚫 MAGIC NUMBERS PROHIBITION (ZERO TOLERANCE)

**CRITICAL RULE**: Magic numbers are **STRICTLY FORBIDDEN** in all detector implementations. All threshold, limit, and calculation values MUST be configurable via settings interfaces.

**PROHIBITED PATTERNS:**

```typescript
// ❌ NEVER: Hardcoded thresholds in detector logic
if (priceEfficiency < 0.7) return null;
if (imbalance > 0.8) return "high";
if (correlation < 0.4) return false;
const spreadThreshold = 0.005; // FORBIDDEN

// ❌ NEVER: Magic numbers in calculations
const confidence = volume * 0.85; // FORBIDDEN
const score = Math.min(ratio, 0.95); // FORBIDDEN
if (trades.length > 100) return; // FORBIDDEN
```

**REQUIRED PATTERNS:**

```typescript
// ✅ CORRECT: All values configurable via settings
if (priceEfficiency < this.priceEfficiencyThreshold) return null;
if (imbalance > this.imbalanceHighThreshold) return "high";
if (correlation < this.weakCorrelationThreshold) return false;
const spreadThreshold = this.spreadHighThreshold;

// ✅ CORRECT: Settings interface with defaults
export interface DetectorSettings extends BaseDetectorSettings {
    priceEfficiencyThreshold?: number; // Default 0.85
    imbalanceHighThreshold?: number;    // Default 0.8
    weakCorrelationThreshold?: number;  // Default 0.4
    spreadHighThreshold?: number;       // Default 0.005
}

// ✅ CORRECT: Constructor reads from settings
constructor(settings: DetectorSettings) {
    this.priceEfficiencyThreshold = settings.priceEfficiencyThreshold ?? 0.85;
    this.imbalanceHighThreshold = settings.imbalanceHighThreshold ?? 0.8;
}
```

**WHY THIS MATTERS:**

- **Signal Blocking Prevention**: Hardcoded values can block signal generation
- **Backtesting Flexibility**: Different values can be tested systematically
- **Production Optimization**: Optimal values can be deployed from testing results
- **Configuration Auditability**: All parameters visible in config.json
- **Institutional Compliance**: Full repeatability and parameter transparency

**ENFORCEMENT:**

- Any magic number in detector code is an **IMMEDIATE REJECTION**
- All threshold/limit values MUST be in settings interfaces
- All calculations MUST use configurable parameters
- Constructor MUST read ALL numeric values from settings
- Unit tests MUST verify configurability of ALL parameters

**VIOLATION DETECTION:**

Code review will reject any occurrence of:

- Hardcoded decimals (0.7, 0.85, 0.005) in detector logic
- Hardcoded integers (100, 50, 1000) as thresholds or limits
- Mathematical operations with literal numbers as thresholds
- Conditional statements with hardcoded comparison values

#### Error Handling Standards

- **ALL async operations MUST have try-catch blocks**
- **ALL database operations MUST handle connection failures**
- **ALL external API calls MUST have circuit breaker protection**
- **ALL errors MUST include correlation IDs for tracing**
- **NO silent failures - ALL errors must be logged**

#### Performance Standards

- **Sub-millisecond latency for trade processing**
- **Memory usage must remain stable under load**
- **CPU usage optimized for real-time processing**
- **Database queries must be indexed and optimized**
- **WebSocket connections must handle 1000+ concurrent clients**

#### Security Standards

- **NO hardcoded secrets or API keys**
- **NEVER modify `.env` file - Contains irreplaceable production API credentials**
- **NEVER copy `exmple.env` over `.env` - This destroys production API keys**
- **ALL inputs must be validated and sanitized**
- **Rate limiting on ALL external endpoints**
- **Proper correlation ID propagation**
- **Secure WebSocket connections only**

#### Logging Standards (MANDATORY)

- **ALL logging MUST use ILogger interface** (`src/infrastructure/loggerInterface.ts`)
- **NEVER import concrete Logger implementations** (Logger, WorkerLogger, etc.)
- **ALWAYS use dependency injection for ILogger**
- **NO console.log, console.info, console.warn, console.debug** - use ILogger methods
- **ONLY console.error for system panic** with documented POLICY OVERRIDE
- **ALL components accepting logger MUST use ILogger interface**
- **Worker threads MUST use WorkerProxyLogger through ILogger interface**

### Financial System Compliance

#### Data Integrity

- **ALL trade data must be immutable once processed**
- **Signal timestamps must be precise to microseconds**
- **Order book state must be atomic and consistent**
- **Database transactions must be ACID compliant**

#### Monitoring & Observability

- **ALL critical paths must emit metrics**
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

**NEVER modify the WebSocket URL in `/public/scripts/dashboard.js`:**

- The URL `const TRADE_WEBSOCKET_URL = "wss://api.cryptology.pe/ltcusdt_trades";` is PRODUCTION-CRITICAL
- Changing this URL is a BREAKING ERROR that will disconnect the dashboard from live data
- This external WebSocket provides real-time market data that the system depends on
- Any modification to this URL must be explicitly approved by the user

### 🛡️ MANDATORY CHANGE CONTROL PROCESS

#### For ANY modification to production-critical files:

1. **STOP** - Identify the change impact level
2. **ASSESS** - Document all affected components
3. **PLAN** - Create detailed implementation and rollback plan
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
2. Implement the `detect(trade: EnrichedTradeEvent)` method
3. Register in `DetectorFactory`
4. Add configuration options to symbol config
5. Include comprehensive tests (>95% coverage)
6. Performance benchmark against existing detectors
7. Risk assessment for false positive/negative rates

#### Zone-Based Detectors (Advanced)

1. Extend `EventEmitter` for zone event handling
2. Implement `analyze(trade: EnrichedTradeEvent): ZoneAnalysisResult` method
3. Use `ZoneManager` for lifecycle management
4. Handle zone candidates and zone formation logic
5. Emit zone updates and signals via WebSocket broadcasting
6. See [Zone-Based Architecture Documentation](docs/Zone-Based-Architecture.md) for implementation details
7. Memory usage analysis for zone state management
8. Concurrent access pattern validation

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
- Document parameter ranges and effects in configuration comments
- Every class that has configurable options need to use /config.json
- Backward compatibility validation
- Default value safety analysis

#### 🎯 DeltaCVD Detector Configuration (Updated 2025-06-23)

**NEW A/B Testing Framework:** Three configurations available for passive volume optimization:

**Simplified Configurations (Recommended):**

```typescript
// No passive volume (pure CVD baseline)
{
    usePassiveVolume: false,
    enableDepthAnalysis: false,
    detectionMode: "momentum",
    baseConfidenceRequired: 0.3,
    finalConfidenceRequired: 0.5
}

// With passive volume (enhanced CVD)
{
    usePassiveVolume: true,
    enableDepthAnalysis: false,
    detectionMode: "momentum",
    baseConfidenceRequired: 0.3,
    finalConfidenceRequired: 0.5
}
```

**Complex Configuration (Full Features):**

```typescript
{
    usePassiveVolume: true,
    enableDepthAnalysis: true,
    detectionMode: "hybrid",
    baseConfidenceRequired: 0.4,
    finalConfidenceRequired: 0.6
}
```

**Key Benefits:**

- 60%+ memory reduction with simplified configurations
- 40-60% faster processing with conditional enhancement phases
- Proper passive volume implementation (was previously minimal)
- Systematic A/B testing for optimal signal quality

**Usage:**

```bash
# Test configurations
node run_hierarchical_backtest.js --detector deltaCVDDetector --profile simplified_no_passive
node run_hierarchical_backtest.js --detector deltaCVDDetector --profile simplified_with_passive
node run_hierarchical_backtest.js --detector deltaCVDDetector --profile current_complex
```

📖 **[Complete Guide: DeltaCVD Simplification](./docs/DeltaCVD-Simplification-Guide.md)**

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

- TradesProcessor and OrderBookState adjust their health monitoring based on stream connection status
- When stream disconnects: health timeouts are extended to avoid false unhealthy states
- When stream reconnects: OrderBookState automatically triggers recovery to rebuild order book
- All components properly handle reconnection events to maintain system consistency

### 🧵 WORKER THREAD ARCHITECTURE (CRITICAL)

**STRICT ISOLATION PRINCIPLE:**
This system uses a dedicated worker thread architecture with absolute separation of concerns. **NO EXCEPTIONS.**

See comprehensive documentation: [Worker Thread Isolation Architecture](docs/Worker-Thread-Isolation-Architecture.md)

#### Worker Thread Responsibilities (EXCLUSIVE):

- **Logger Worker**: ALL logging operations (no console.log in main thread)
- **Binance Worker**: ALL upstream API communication (no direct API calls in main thread)
- **Communication Worker**: ALL downstream WebSocket/MQTT (no direct client communication in main thread)
- **Storage Worker**: ALL database operations (no direct SQLite access in main thread)

#### MANDATORY RULES:

**🚫 NEVER CREATE FALLBACK IMPLEMENTATIONS:**

- If functionality is handled by a worker thread, it MUST ONLY be handled by that worker
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
- `WorkerMetricsProxy` - Metrics collection with 100ms batching for performance
- `WorkerCircuitBreakerProxy` - Circuit breaker with BigInt support and failure tracking
- `WorkerRateLimiterProxy` - Rate limiting with request tracking
- `WorkerMessageRouter` - Message routing with 10ms queue flushing

**✅ WORKER THREAD COMMUNICATION:**

- Main thread communicates with workers via ThreadManager ONLY
- Workers communicate with main thread via parentPort.postMessage() ONLY
- Inter-worker communication via main thread message forwarding ONLY
- NO direct worker-to-worker communication channels
- ALL messages include correlation IDs for request tracing

**✅ INTERFACE CONTRACTS:**

Workers use strict interface contracts to ensure compatibility:

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

#### Violation Detection:

**Immediate red flags requiring approval:**

- `new Logger()` in worker files (use `WorkerProxyLogger`)
- `new MetricsCollector()` in worker files (use `WorkerMetricsProxy`)
- `new CircuitBreaker()` in worker files (use `WorkerCircuitBreakerProxy`)
- Direct HTTP/WebSocket clients in main thread
- `console.log()` anywhere except fallback error scenarios
- Multiple implementations of same functionality
- Conditional logic choosing between worker/non-worker paths
- Direct infrastructure imports in worker files (use shared proxies)
- non Financial Math in any financial calculation (using price or quantity)

#### 🚫 CALCULATION INTEGRITY (ZERO TOLERANCE)

**CRITICAL RULE**: When calculations cannot be performed with valid data, return `null` - NEVER use default numbers, fallbacks, or arbitrary values.

**PROHIBITED PATTERNS:**

```typescript
// ❌ NEVER: Default numbers when calculation is invalid
const efficiency = calculateEfficiency(data) ?? 0.5; // FORBIDDEN
const confidence = priceData.length < 3 ? 0.7 : calculate(priceData); // FORBIDDEN
const result = isNaN(calculation) ? 1.0 : calculation; // FORBIDDEN

// ❌ NEVER: Arbitrary fallbacks for insufficient data
if (trades.length < 3) return 0.85; // FORBIDDEN - not based on real data
```

**REQUIRED PATTERNS:**

```typescript
// ✅ CORRECT: Return null for invalid calculations
const efficiency = calculateEfficiency(data); // returns number | null
if (efficiency === null) {
    return; // Cannot proceed without valid calculation
}

// ✅ CORRECT: Early return when insufficient data
if (trades.length < 3) {
    return null; // Honest: cannot calculate with insufficient data
}

// ✅ CORRECT: Null propagation through calculation chain
const priceEfficiency = this.calculatePriceEfficiency(trades, zone);
if (priceEfficiency === null) {
    return; // Cannot emit signal without valid efficiency
}
```

**WHY THIS MATTERS:**

- **Trading Integrity**: Fake numbers can cause wrong trading decisions
- **Data Honesty**: Better to admit insufficient data than guess
- **System Reliability**: Null values force proper error handling
- **Debugging**: Real issues are visible, not masked by defaults

**ENFORCEMENT:**

Any use of default numbers, fallback values, or arbitrary constants when calculations fail is an **IMMEDIATE REJECTION**. All calculation methods must return `null` when they cannot produce valid results.

#### Architecture Benefits (Why This Matters):

- **Performance**: Dedicated threads for I/O operations with batched communication
- **Reliability**: Isolated failure domains with circuit breaker protection
- **Scalability**: Independent thread scaling with queue management
- **Maintainability**: Single responsibility per thread with interface contracts
- **Debugging**: Clear thread ownership with correlation ID tracing
- **Monitoring**: Comprehensive metrics and health tracking per worker

**⚠️ BREAKING THIS ISOLATION CAN CAUSE:**

- Race conditions between threads
- Inconsistent logging/data
- Performance degradation from excessive IPC
- Memory leaks from duplicate connections
- Unpredictable system behavior under load
- Circuit breaker bypass leading to cascade failures
- Lost correlation context for debugging

### Absolute Prohibitions (ZERO TOLERANCE)

**NEVER:**

- **Modify, overwrite, or copy over the `.env` file - Contains irreplaceable production API keys**
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

**IMPORTANT**: The Node.js `ws` library delivers WebSocket messages as `Buffer` objects, NOT strings, even when clients send JSON strings. This is normal behavior due to network protocol handling.

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
2. **Validate handler registration**: Are handlers properly registered in the handler map?
3. **Message structure**: Does the message match the expected schema?
4. **Rate limiting**: Is the client being rate-limited?
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
3. **Verify interface contracts** - ensure all dependencies use interfaces
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

**WebSocket Management in Workers:**

```typescript
// ✅ CORRECT - Use worker-specific WebSocket manager
const wsManager = new WorkerWebSocketManager(
    port,
    logger, // WorkerProxyLogger
    rateLimiter, // WorkerRateLimiterProxy
    metrics, // WorkerMetricsProxy
    handlers
);
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

1. **IDENTIFY WORKER SCOPE**: Determine which worker thread the change affects
2. **CHECK PROXY USAGE**: Ensure only shared proxy classes are used, never direct infrastructure
3. **VALIDATE INTERFACES**: Confirm interface contracts are maintained (`IWorkerMetricsCollector`, `IWorkerCircuitBreaker`)
4. **ASSESS PERFORMANCE**: Consider impact on message batching and IPC overhead
5. **VERIFY ISOLATION**: Ensure no direct cross-thread communication is introduced

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
import { MetricsCollector } from "../../infrastructure/metricsCollector.js"; // VIOLATION!
```

**When Modifying Existing Infrastructure:**

1. **UPDATE INTERFACES**: If changing infrastructure classes, update corresponding interfaces
2. **MAINTAIN COMPATIBILITY**: Ensure proxy classes continue to work with changes
3. **TEST WORKER ISOLATION**: Verify no worker uses direct infrastructure after changes
4. **UPDATE DOCUMENTATION**: Update [Worker Thread Isolation Architecture](docs/Worker-Thread-Isolation-Architecture.md)

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

This violates the strict worker thread isolation principle:
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
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (\*.md) or README files. Only create documentation files if explicitly requested by the User.

**FOR INSTITUTIONAL TRADING SYSTEMS:**

- ALWAYS assess financial impact of changes
- NEVER compromise data integrity or processing accuracy
- ALWAYS maintain audit trail of modifications
- NEVER deploy changes without comprehensive testing
- ALWAYS have rollback plans ready
