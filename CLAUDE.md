# CLAUDE.md

Production trading system guidance for Claude Code with **ZERO TOLERANCE** for trading operation errors.

## 🚨 CRITICAL FOUNDATION

**Do not guess, NEVER guess; all your answers are based and calculated; if you need more data to calculate you ask for it; no guessing, no estimations, no general answers, no bullshit. Math and logic above everything, request clarification when you are unsure.**

## 🏛️ INSTITUTIONAL STANDARDS

### 📋 SPECIALIZED DOCUMENTATION STRUCTURE

**For specialized guidance, see:**
- **General Development Standards**: `src/CLAUDE.md` - Development patterns, coding standards, and architectural principles
- **Testing Standards**: `test/CLAUDE.md` - Test integrity, mock requirements, and validation standards  
- **Detector Development Standards**: `src/indicators/CLAUDE.md` - Pattern detection, signal processing, and optimization

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
- `/public/scripts/dashboard.js` - Production WebSocket URLs
- `config.json` - Production configuration
- `.env` - **CRITICAL: Production API keys - NEVER MODIFY**

**⚠️ BUSINESS-CRITICAL FILES (REQUIRES VALIDATION):**

- `src/infrastructure/db.ts` - Database operations
- `src/infrastructure/migrate.ts` - Data migrations
- `src/websocket/websocketManager.ts` - Client connections
- `src/core/config.ts` - Configuration management

**✅ DEVELOPMENT-SAFE FILES:**

- Test files (`test/**/*.test.ts`)
- Documentation (`docs/**/*.md`) 
- Build scripts (`package.json`, `tsconfig.json`)

### 🛡️ MANDATORY CHANGE CONTROL PROCESS

**For ANY modification to production-critical files:**

1. **STOP** - Identify change impact level
2. **ASSESS** - Document all affected components  
3. **PLAN** - Create implementation and rollback plan
4. **REQUEST** - Get explicit user approval with risk assessment
5. **IMPLEMENT** - Make changes with comprehensive logging
6. **VALIDATE** - Run full test suite and performance benchmarks
7. **MONITOR** - Track system behavior post-change

## 🔧 DEVELOPMENT COMMANDS

### Core Development

- `yarn build` - Build TypeScript project
- `yarn start:dev` - Development mode with hot reload
- `yarn start` - Start production build
- `yarn test` - Run all tests with Vitest
- `yarn test:coverage` - Coverage report (MUST be >95%, all tests MUST pass)
- `yarn lint` - ESLint (MUST pass with zero warnings)

### Additional Commands

- `yarn typecheck` - TypeScript type checking
- `yarn format` - Format and lint code
- `yarn prettier` - Format code with prettier
- `yarn build:watch` - Build with watch mode

## 🏗️ ARCHITECTURE OVERVIEW

**Real-time cryptocurrency trading system analyzing Binance order flow for trading signals.**

### Core Data Flow

```
Binance WebSocket → OrderFlowPreprocessor → Pattern Detectors → SignalCoordinator → TradingSignals
```

### 🚨 CRITICAL ARCHITECTURE PATTERNS

#### Real-Time Data Processing (MANDATORY)

**BinanceWorker (WebSocket Stream)**: Real-time live data processing
- Processes live trade/depth data from WebSocket API
- **MUST store stream data to database** to prevent data loss
- Runs in dedicated worker thread with proper isolation
- Handles reconnection and recovery automatically

### 📁 KEY DIRECTORIES

- `src/core/` - Configuration and error handling
- `src/infrastructure/` - Logging, metrics, circuit breakers, database
- `src/market/` - Order book state and data preprocessing
- `src/indicators/` - Pattern detection algorithms (see `src/indicators/CLAUDE.md`)
- `src/services/` - Signal coordination, anomaly detection, alerts
- `src/trading/` - Signal processing and trading logic
- `src/storage/` - Data persistence layer
- `src/websocket/` - WebSocket connection management
- `src/multithreading/` - Worker thread management
- `test/` - Test files and mocks (see `test/CLAUDE.md`)

### 🎯 PATTERN DETECTION SYSTEM

**For complete detector development standards, see `src/indicators/CLAUDE.md`**

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

### 🔄 SIGNAL PROCESSING PIPELINE

1. **SignalCoordinator** - Manages detector registration and signal queuing
2. **SignalManager** - Validates, correlates, and filters signals  
3. **AnomalyDetector** - Integrates market anomaly detection
4. **AlertManager** - Handles webhook notifications

### ⚙️ CONFIGURATION MANAGEMENT

- Main config in `config.json` with symbol-specific settings
- Environment variables override config values
- Use `src/core/config.ts` for configuration management
- **ALL detector configurations** documented in `src/indicators/CLAUDE.md`

### 🧪 TESTING FRAMEWORK

**For complete testing standards, see `test/CLAUDE.md`**

- Uses Vitest with setup file at `test/vitest.setup.ts`
- Extensive mocking in `__mocks__/` directory
- **MANDATORY: >95% coverage, 100% test pass rate**
- **Test integrity over convenience** - Fix code, never lower test standards

### 💾 DATABASE & INFRASTRUCTURE

- SQLite database with migrations in `src/infrastructure/migrate.ts`
- Database abstraction in `src/infrastructure/db.ts`
- Custom error types in `src/core/errors.ts`
- Circuit breaker pattern for external API calls
- Correlation IDs for request tracing

## 🏦 INSTITUTIONAL STANDARDS

### 🚫 CRITICAL PROHIBITIONS (ZERO TOLERANCE)

**NEVER:**
- **Modify `.env` file** - Contains irreplaceable production API keys
- **Cache live market data** - Causes financial risk through stale data
- **Use magic numbers** - All values configurable via `config.json`
- **Return fallback values** - Return `null` when calculations invalid
- **Skip input validation** - All inputs must be validated

### 🔢 REQUIRED STANDARDS

- **FinancialMath**: Use `src/utils/financialMath.ts` for ALL calculations
- **Tick Size Compliance**: Respect minimum tick sizes for price movements
- **Data Integrity**: Trade data immutable, microsecond timestamps
- **Performance**: Sub-millisecond latency, stable memory usage
- **Worker Thread Isolation**: Strict separation, no fallbacks

## 🔗 SYSTEM INTEGRATION

### 🚨 CRITICAL PROTECTIONS

**WebSocket URL Protection:**
- **NEVER modify** `/public/scripts/dashboard.js` WebSocket URL
- `wss://api.cryptology.pe/ltcusdt_trades` is PRODUCTION-CRITICAL
- Disconnects dashboard from live data - requires explicit approval

**Database Operations:**
- Create migrations in `src/infrastructure/migrate.ts`
- Test forward/rollback scenarios
- Validate data integrity during migrations

### 🧵 WORKER THREAD ARCHITECTURE

**For complete standards, see `src/CLAUDE.md`**

**STRICT ISOLATION**: Dedicated workers with absolute separation
- **Logger Worker**: ALL logging operations
- **Binance Worker**: ALL API communication
- **Communication Worker**: ALL WebSocket/MQTT
- **Storage Worker**: ALL database operations

**MANDATORY RULES:**
- NO fallback implementations
- Use WorkerProxy classes ONLY
- Message-based communication via ThreadManager
- Correlation IDs for all messages

### 📋 CHANGE CONTROL MATRIX

| Change Type | Approval Required | Testing Required | Monitoring Period |
|-------------|-------------------|------------------|-----------------|
| Algorithm Logic | YES | Full Suite + Performance | 48 hours |
| Data Processing | YES | Integration + Stress | 24 hours |
| Configuration | YES | Validation + Compatibility | 12 hours |
| UI/Dashboard | NO | Unit + E2E | 4 hours |
| Documentation | NO | None | None |
| Tests | NO | Self-validation | None |

### 🚨 EMERGENCY OVERRIDE PROTOCOL

**ONLY in system-down scenarios:**
1. Document the emergency situation
2. Make minimal necessary changes
3. Log all modifications with timestamps  
4. Schedule immediate post-emergency review
5. Create comprehensive rollback plan

## 🌐 WEBSOCKET GUIDELINES

**For complete patterns, see `src/CLAUDE.md`**

**Critical Message Handling:**
- Node.js `ws` delivers messages as `Buffer` objects, not strings
- Always validate with Zod schemas
- Rate limit clients with cleanup
- UTF-8 encoding when converting Buffers
- Ensure worker thread isolation

## 🎯 CLAUDE CODE OPERATIONAL GUIDELINES

### Change Assessment Process

1. **ASSESS FIRST** - Identify affected components and risk level
2. **CHECK ISOLATION** - Verify worker thread isolation maintained
3. **ASK APPROVAL** - Request approval for high-risk changes
4. **PROVIDE ALTERNATIVES** - Suggest safer approaches
5. **ESTIMATE IMPACT** - Analyze performance/reliability effects
6. **REQUEST VALIDATION** - Confirm user wants to proceed

### 🚨 VIOLATION DETECTION

```
🧵 WORKER THREAD ISOLATION VIOLATION DETECTED 🧵
Violation type: [specific violation]
File: [filename]
This violates strict worker thread isolation principle.
Required corrections: [specific fixes needed]
This change is PROHIBITED without explicit architectural approval.
```

```
⚠️ HIGH RISK CHANGE DETECTED ⚠️
This modification affects: [components]
Risk level: [HIGH/MEDIUM/LOW]
Required before proceeding:
- [ ] User approval confirmation
- [ ] Test suite validation  
- [ ] Performance impact assessment
- [ ] Rollback plan preparation
```

```
🔒 PRODUCTION-CRITICAL FILE DETECTED 🔒
File: [filename]
Protection level: [level]
This file requires special handling due to production dependencies.
Request explicit approval to modify this protected file.
```

---

## 📚 INSTITUTIONAL REQUIREMENTS

**TRADING SYSTEM STANDARDS:**
- Assess financial impact of all changes
- Never compromise data integrity
- Maintain comprehensive audit trails
- Never deploy without testing
- Always have rollback plans ready

**DEVELOPMENT PRINCIPLES:**
- Do what's asked - nothing more, nothing less
- Prefer editing existing files over creating new ones
- Never proactively create documentation unless requested

**SPECIALIZED GUIDANCE:**
- **General Development**: `src/CLAUDE.md`
- **Testing Standards**: `test/CLAUDE.md`
- **Detector Development**: `src/indicators/CLAUDE.md`
