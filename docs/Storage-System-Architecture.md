# Storage System Architecture

## 🏛️ Overview

The OrderFlow Trading System employs a production-grade storage architecture designed for high-frequency financial data processing. The system implements institutional standards for data integrity, type safety, and resource management.

## 🏗️ Architecture Components

### Core Storage Classes

```
┌─────────────────────────────────────────────────────────────────┐
│                    Storage System Architecture                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐    ┌─────────────────────────────────────┐ │
│  │   StorageWorker  │◄───┤        ThreadManager               │ │
│  │   (Worker Thread)│    │     (Main Thread)                  │ │
│  └──────────────────┘    └─────────────────────────────────────┘ │
│           │                              │                      │
│           ▼                              ▼                      │
│  ┌──────────────────┐    ┌─────────────────────────────────────┐ │
│  │   Storage        │    │        PipelineStorage             │ │
│  │   (Main)         │◄───┤     (Signal Processing)            │ │
│  └──────────────────┘    └─────────────────────────────────────┘ │
│           │                              │                      │
│           ▼                              ▼                      │
│  ┌──────────────────┐    ┌─────────────────────────────────────┐ │
│  │ StorageResource  │    │    StorageHealthMonitor            │ │
│  │    Manager       │    │      (Circuit Breaker)             │ │
│  └──────────────────┘    └─────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 📂 File Structure

### Core Storage Files

| File                                                  | Status                  | Purpose                                           |
| ----------------------------------------------------- | ----------------------- | ------------------------------------------------- |
| `backend/src/multithreading/storage.ts`               | ✅ **PRODUCTION READY** | Main storage class with institutional-grade fixes |
| `backend/src/storage/pipelineStorage.ts`              | ✅ **PRODUCTION READY** | Signal processing storage with memory limits      |
| `backend/src/multithreading/workers/storageWorker.ts` | ✅ **PRODUCTION READY** | Worker thread with enhanced type safety           |
| `backend/src/storage/storageResourceManager.ts`       | ✅ **PRODUCTION READY** | Centralized resource cleanup manager              |
| `backend/src/storage/storageHealthMonitor.ts`         | ✅ **PRODUCTION READY** | Health monitoring with circuit breaker            |
| `backend/src/storage/typeGuards.ts`                   | ✅ **PRODUCTION READY** | Runtime type validation utilities                 |

### Database Schema

```sql
-- Main aggregated trades table
CREATE TABLE aggregated_trades (
    aggregatedTradeId INTEGER PRIMARY KEY,
    firstTradeId INTEGER NOT NULL,
    lastTradeId INTEGER NOT NULL,
    tradeTime INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    price REAL NOT NULL,
    quantity REAL NOT NULL,
    isBuyerMaker INTEGER NOT NULL,
    orderType TEXT NOT NULL,
    bestMatch INTEGER NOT NULL
);

-- Performance indexes
CREATE INDEX idx_aggregated_trades_tradeTime ON aggregated_trades (tradeTime);
CREATE INDEX idx_aggregated_trades_symbol ON aggregated_trades (symbol);
CREATE INDEX idx_aggregated_trades_symbol_time ON aggregated_trades (symbol, tradeTime DESC);
CREATE INDEX idx_aggregated_trades_agg_id ON aggregated_trades (aggregatedTradeId);

-- Signal processing tables (managed by PipelineStorage)
CREATE TABLE coordinator_queue (...);
CREATE TABLE coordinator_active (...);
CREATE TABLE signal_active_anomalies (...);
CREATE TABLE signal_history (...);
CREATE TABLE confirmed_signals (...);
CREATE TABLE signal_outcomes (...);
CREATE TABLE market_contexts (...);
CREATE TABLE failed_signal_analyses (...);
```

## 🔧 Recent Critical Fixes (2024)

### ✅ Phase 1: Worker Thread Type Safety

- **Fixed**: Type signatures use `unknown` instead of `any`
- **Added**: ParentPort validation for worker context
- **Enhanced**: Message validation with proper error handling

### ✅ Phase 2: Connection Management

- **Removed**: Duplicate signal handlers
- **Added**: Direct database health check method `isHealthy()`
- **Integrated**: StorageResourceManager for unified cleanup

### ✅ Phase 3: Transaction Integrity

- **Enhanced**: Bulk insert error handling with detailed reporting
- **Added**: Individual trade validation with skip logic

### ✅ Phase 4: Memory Management

- **Fixed**: Prepared statement cleanup via resource manager
- **Added**: Result set limits (default 1000) with overflow warnings
- **Implemented**: Automatic statement finalization

### ✅ Phase 5: Data Integrity

- **Added**: Audit logging for dropped records
- **Implemented**: Duplicate trade tracking with periodic reporting
- **Enhanced**: Structured error logging with context

### ✅ Phase 6: Communication Robustness

- **Added**: Message structure validation in worker threads
- **Enhanced**: Type checking for required fields
- **Improved**: Error response handling

### ✅ Phase 7: Performance Optimization

- **Added**: Missing database indexes for query optimization
- **Optimized**: Symbol + timestamp composite index
- **Enhanced**: Aggregated trade ID index for faster lookups

## 💾 Data Flow

### Trade Data Processing

```
Binance WebSocket → BinanceWorker → StorageWorker → Storage.saveAggregatedTrade()
                                                      ↓
                                                Database (SQLite + WAL)
                                                      ↓
                                           Validation & Audit Logging
```

### Signal Processing

```
Signal Detection → SignalCoordinator → PipelineStorage.saveSignalHistory()
                                               ↓
                                      Signal Processing Tables
                                               ↓
                                    Analysis & Market Context
```

## 🛡️ Data Integrity Features

### Input Validation

- **Numeric Values**: NaN/Infinity prevention with fallback values
- **Type Safety**: Runtime validation using type guards
- **Required Fields**: Validation of critical trade data
- **Symbol Validation**: String sanitization and validation

### Error Handling

- **Constraint Violations**: Duplicate trade detection and logging
- **Transaction Safety**: Atomic bulk operations with rollback
- **Circuit Breaker**: Automatic failure detection and recovery
- **Audit Trail**: Comprehensive logging of all data operations

### Resource Management

- **Connection Pooling**: Proper database connection lifecycle
- **Statement Cleanup**: Automatic prepared statement finalization
- **Memory Limits**: Result set size limits to prevent memory issues
- **Graceful Shutdown**: Coordinated cleanup on process termination

## 📊 Health Monitoring

### Health Check Methods

```typescript
// Quick connectivity test
storage.isHealthy(): boolean

// Detailed health status
storage.getHealthStatus(): {
    isHealthy: boolean;
    connectionState: string;
    circuitBreakerState: string;
    consecutiveFailures: number;
    recentFailureRate: number;
    averageResponseTime: number;
    timeSinceLastSuccess: number;
}
```

### Monitoring Features

- **Circuit Breaker**: Automatic failure detection with configurable thresholds
- **Performance Metrics**: Response time tracking and failure rate monitoring
- **Health Events**: Real-time health status updates
- **Recovery Management**: Automatic recovery attempts with exponential backoff

## 🔐 Security & Compliance

### Data Protection

- **Immutable Trades**: Trade data immutability after storage
- **Audit Logging**: Complete audit trail for regulatory compliance
- **Access Control**: Type-safe interfaces prevent unauthorized access
- **Input Sanitization**: Protection against injection attacks

### Production Standards

- **Zero Tolerance**: No `any` types in production code
- **Strict Validation**: All inputs validated before storage
- **Error Recovery**: Graceful degradation under failure conditions
- **Resource Limits**: Memory and connection limits enforced

## 📈 Performance Characteristics

### Throughput

- **Bulk Inserts**: Optimized transaction handling for high-frequency data
- **Index Usage**: Strategic indexing for common query patterns
- **Memory Efficiency**: Limited result sets prevent memory exhaustion
- **Connection Reuse**: Persistent connections with health monitoring

### Latency

- **Sub-millisecond**: Trade processing optimized for real-time requirements
- **Direct Access**: Health checks bypass complex validation for speed
- **Prepared Statements**: Pre-compiled queries for optimal performance
- **WAL Mode**: Write-Ahead Logging for concurrent read/write operations

## 🔧 Configuration

### Storage Configuration

```json
{
    "storage": {
        "maxHistoryRows": 100000,
        "maxHistoryAgeMin": 1440,
        "healthCheckIntervalMs": 30000,
        "failureThreshold": 3,
        "operationTimeoutMs": 5000
    }
}
```

### Resource Management

```typescript
// Database registration
registerDatabaseResource(db, "MainStorage", 10);

// Statement cleanup registration
registerStatementCleanup(statements, "PipelineStorage", 60);
```

## 🚨 Critical Guidelines

### Development Rules

1. **Never modify** production-critical storage files without approval
2. **Always validate** inputs using provided type guards
3. **Use resource manager** for all cleanup operations
4. **Test thoroughly** with production-size datasets
5. **Monitor health** status during development

### Deployment Checklist

- [ ] All tests pass with >95% coverage
- [ ] TypeScript compilation succeeds with zero warnings
- [ ] Health monitoring shows stable connections
- [ ] Audit logging captures all operations
- [ ] Memory usage remains stable under load
- [ ] Performance meets sub-millisecond requirements

## 📚 API Reference

### Main Storage Interface

```typescript
interface IStorage {
    // Trade data operations
    saveAggregatedTrade(trade: TradeData, symbol: string): void;
    saveAggregatedTradesBulk(trades: TradeData[], symbol: string): number;
    getLatestAggregatedTrades(n: number, symbol: string): TradeData[];

    // Utility operations
    isHealthy(): boolean;
    getHealthStatus(): HealthStatus;
    purgeOldEntries(correlationId: string, hours?: number): number;
    getLastTradeTimestamp(symbol: string): number | null;

    // Lifecycle
    close(): void;
}
```

### Pipeline Storage Interface

```typescript
interface IPipelineStorage {
    // Signal operations
    saveSignalHistory(signal: ProcessedSignal): void;
    getRecentSignals(
        since: number,
        symbol?: string,
        limit?: number
    ): ProcessedSignal[];

    // Queue operations
    enqueueJob(job: ProcessingJob): void;
    dequeueJobs(limit: number): ProcessingJob[];
    markJobCompleted(jobId: string): void;

    // Anomaly operations
    saveActiveAnomaly(anomaly: AnomalyEvent): void;
    removeActiveAnomaly(type: string): void;
    getActiveAnomalies(): AnomalyEvent[];
}
```

## 🔍 Troubleshooting

### Common Issues

**Type Errors in Worker Threads**

- Ensure all `any` types are replaced with `unknown`
- Use type guards for runtime validation
- Check parentPort availability in worker context

**Memory Growth**

- Verify result set limits are applied
- Check for prepared statement leaks
- Monitor resource manager cleanup

**Connection Issues**

- Use `isHealthy()` for quick connectivity tests
- Check circuit breaker state in health status
- Review connection cleanup in resource manager

**Performance Degradation**

- Verify database indexes are present
- Check bulk operation transaction sizes
- Monitor health metrics for bottlenecks

### Support Resources

- **Health Monitoring**: Use `getHealthStatus()` for detailed diagnostics
- **Audit Logs**: Review structured error logs for debugging
- **Resource Tracking**: Monitor resource manager for cleanup issues
- **Performance Metrics**: Use health monitor response time tracking
