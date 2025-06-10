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

2. **API Backlog Fill**: Fetches 90 minutes of historical data via REST API
    - Uses Binance REST API to fill historical aggregated trades
    - Runs in main thread via `TradesProcessor.fillBacklog()`
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
    this.preloadHistoricalData(), // API calls for 90 minutes
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
- **ALL inputs must be validated and sanitized**
- **Rate limiting on ALL external endpoints**
- **Proper correlation ID propagation**
- **Secure WebSocket connections only**

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

#### Worker Thread Responsibilities (EXCLUSIVE):

- **Logger Worker**: ALL logging operations (no console.log in main thread)
- **Binance Worker**: ALL upstream API communication (no direct API calls in main thread)
- **Communication Worker**: ALL downstream WebSocket/MQTT (no direct client communication in main thread)

#### MANDATORY RULES:

**🚫 NEVER CREATE FALLBACK IMPLEMENTATIONS:**

- If functionality is handled by a worker thread, it MUST ONLY be handled by that worker
- NO "backup" implementations in main thread
- NO "emergency" direct implementations
- NO duplicate code paths for same functionality

**🚫 NEVER MIX MAIN THREAD AND WORKER IMPLEMENTATIONS:**

- Logging: Use WorkerProxyLogger ONLY, never direct Logger instantiation in workers
- API Calls: Use worker thread communication ONLY, never direct HTTP clients
- WebSocket: Use ThreadManager broadcast ONLY, never direct socket.send()

**✅ CORRECT PATTERN:**

```typescript
// ❌ WRONG - Creates fallback/duplicate functionality
const logger = useWorkerLogger ? new WorkerProxyLogger() : new Logger();

// ✅ CORRECT - Single source of truth
const logger = new WorkerProxyLogger("worker-name");
```

**✅ WORKER THREAD COMMUNICATION:**

- Main thread communicates with workers via ThreadManager ONLY
- Workers communicate with main thread via parentPort.postMessage() ONLY
- Inter-worker communication via main thread message forwarding ONLY
- NO direct worker-to-worker communication channels

#### Violation Detection:

**Immediate red flags requiring approval:**

- `new Logger()` in worker files (use WorkerProxyLogger)
- Direct HTTP/WebSocket clients in main thread
- `console.log()` anywhere except fallback error scenarios
- Multiple implementations of same functionality
- Conditional logic choosing between worker/non-worker paths

#### Architecture Benefits (Why This Matters):

- **Performance**: Dedicated threads for I/O operations
- **Reliability**: Isolated failure domains
- **Scalability**: Independent thread scaling
- **Maintainability**: Single responsibility per thread
- **Debugging**: Clear thread ownership of functionality

**⚠️ BREAKING THIS ISOLATION CAN CAUSE:**

- Race conditions between threads
- Inconsistent logging/data
- Performance degradation
- Memory leaks from duplicate connections
- Unpredictable system behavior under load

### Absolute Prohibitions (ZERO TOLERANCE)

**NEVER:**

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

## 🎯 CLAUDE CODE OPERATIONAL GUIDELINES

### When Asked to Make Changes:

1. **ASSESS FIRST**: "This change affects [X] components and has [Y] risk level"
2. **CHECK WORKER ISOLATION**: "This maintains/violates worker thread isolation because [reason]"
3. **ASK APPROVAL**: "This requires approval due to [specific reasons]"
4. **PROVIDE ALTERNATIVES**: "Safer approaches include [alternatives]"
5. **ESTIMATE IMPACT**: "Expected performance/reliability impact: [analysis]"
6. **REQUEST VALIDATION**: "Please confirm you want to proceed with these risks"

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
