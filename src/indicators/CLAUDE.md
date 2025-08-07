# CLAUDE.md - Pattern Detection & Indicators Development

Production trading system guidance for detector/indicator development with **ZERO TOLERANCE** for signal processing errors.

## 🚨 CRITICAL PRINCIPLES

Do not guess, NEVER guess; all calculations are based on mathematical logic; if you need more data to calculate you ask for it; no guessing, no estimations, no general answers, no bullshit. Math and logic above everything, request clarification when you are unsure.

## 🏛️ INSTITUTIONAL STANDARDS FOR DETECTORS

### 🚨 PRODUCTION-CRITICAL DETECTOR PROTECTION

**🔒 ABSOLUTELY NO MODIFICATIONS WITHOUT APPROVAL:**

All files in `src/indicators/*/` are **PRODUCTION-CRITICAL** pattern detection algorithms that directly impact trading decisions. Any modification requires:

1. **Risk Assessment**: Evaluate trading operation impact
2. **Signal Quality Analysis**: Impact on false positive/negative rates  
3. **Performance Benchmarking**: Sub-millisecond latency maintenance
4. **Comprehensive Testing**: >95% coverage, all tests MUST pass
5. **User Approval**: Explicit approval for any detector changes

### 🚫 NUCLEAR CLEANUP: ZERO TOLERANCE CONFIGURATION

**MANDATORY**: All enhanced detectors follow "NO DEFAULTS, NO FALLBACKS, NO BULLSHIT" philosophy.

#### ARCHITECTURE PRINCIPLES (NON-NEGOTIABLE):

1. **🚫 ZERO DEFAULT METHODS**: No `getDefault*()` methods in enhanced detectors
2. **🚫 ZERO FALLBACK OPERATORS**: No `??` fallback operators
3. **🚫 ZERO HARDCODED VALUES**: All values configurable via `config.json`
4. **✅ MANDATORY ZOD VALIDATION**: All settings validated with `process.exit(1)` on missing config
5. **✅ PURE WRAPPER ARCHITECTURE**: Enhanced detectors as pure config-driven wrappers

```typescript
// ✅ REQUIRED: Zod schemas for enhanced detectors
export const AbsorptionDetectorSchema = z.object({
    minAggVolume: z.number().int().min(1).max(1000),
    absorptionThreshold: z.number().min(0.1).max(1.0),
    windowMs: z.number().int().min(5000).max(300000),
    priceEfficiencyThreshold: z.number().min(0.01).max(0.1),
    velocityIncreaseThreshold: z.number().min(1.1).max(3.0),
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

#### PROHIBITED PATTERNS (ZERO TOLERANCE):

```typescript
// ❌ NEVER: Default methods, fallback operators, optional Zod properties
private getDefaultMinAggVolume(): number { return 20; }
const threshold = this.settings.threshold ?? 0.5;
minAggVolume: z.number().optional(), // FORBIDDEN
const defaultZoneTicks = 3; // HARDCODED - FORBIDDEN
```

### 🚫 MAGIC NUMBERS PROHIBITION (ZERO TOLERANCE)

**CRITICAL RULE**: Magic numbers **STRICTLY FORBIDDEN** in all detector implementations. All threshold/limit/calculation values MUST be configurable via `config.json`.

```typescript
// ❌ NEVER: Hardcoded thresholds in detectors
if (priceEfficiency < 0.7) return null;
if (imbalance > 0.8) return "high";
const spreadThreshold = 0.005; // FORBIDDEN
const zoneTicks = 3; // FORBIDDEN
const windowMs = 60000; // FORBIDDEN

// ✅ CORRECT: All values configurable
if (priceEfficiency < this.config.priceEfficiencyThreshold) return null;
if (imbalance > this.config.imbalanceHighThreshold) return "high";
const spreadThreshold = this.config.spreadHighThreshold;
const zoneTicks = this.config.zoneTicks;
const windowMs = this.config.windowMs;
```

**WHY THIS MATTERS FOR DETECTORS:**

- **Signal Blocking Prevention**: Hardcoded values can block valid signals
- **Optimization Flexibility**: Different parameters tested systematically via backtesting
- **Production Deployment**: Optimal values deployed from extensive testing
- **Configuration Auditability**: All detection parameters visible in config.json
- **Market Adaptability**: Parameters adjusted for different market conditions

## 🔢 FINANCIALMATH - MISSION CRITICAL (MANDATORY)

**CRITICAL REQUIREMENT**: ALL financial calculations in detectors MUST use `src/utils/financialMath.ts`.

### Why FinancialMath is Required for Detectors

- **Signal Accuracy**: Eliminates floating-point errors in price/volume calculations
- **Trading Precision**: Ensures accurate signal threshold calculations  
- **Regulatory Compliance**: Meets institutional-grade calculation precision
- **Data Integrity**: Prevents calculation error accumulation in real-time processing
- **Signal Reliability**: Consistent calculations across all detector implementations

### Mandatory Usage Patterns in Detectors

```typescript
// ✅ REQUIRED: Use FinancialMath for all detector calculations
const midPrice = FinancialMath.calculateMidPrice(bid, ask, this.precision);
const spread = FinancialMath.calculateSpread(ask, bid, this.precision);
const volumeRatio = FinancialMath.calculateRatio(aggressiveVol, passiveVol, this.precision);
const priceEfficiency = FinancialMath.calculateRatio(priceMove, expectedMove, this.precision);
const imbalanceMetric = FinancialMath.calculateMean(imbalanceValues);
const confidence = FinancialMath.calculateStdDev(confidenceValues);

// ❌ PROHIBITED: Direct floating-point arithmetic in detectors
const midPrice = (bid + ask) / 2; // PRECISION LOSS
const ratio = aggressiveVol / passiveVol; // ROUNDING ERRORS
const efficiency = priceMove / expectedMove; // CALCULATION DRIFT
const mean = values.reduce((a, b) => a + b) / values.length; // ACCUMULATION ERRORS
```

### 📏 TICK SIZE COMPLIANCE (MANDATORY)

**CRITICAL REQUIREMENT**: ALL price movements in detector logic MUST respect minimum tick sizes.

**TICK SIZE RULES FOR DETECTORS:**

- **Price < $1**: Minimum tick = 0.0001
- **$1 ≤ Price < $10**: Minimum tick = 0.001  
- **$10 ≤ Price < $100**: Minimum tick = 0.01
- **$100 ≤ Price < $1000**: Minimum tick = 0.1
- **Price ≥ $1000**: Minimum tick = 1.0

```typescript
// ✅ CORRECT: Tick-compliant detector logic
const basePrice = 89.0; // Price ~$89
const tickSize = 0.01; // Correct tick for $10-$100 range
const priceLevel = basePrice + (tickSize * this.config.zoneTicks); // Valid level
const supportLevel = FinancialMath.roundToTickSize(calculatedLevel, tickSize);

// ❌ PROHIBITED: Sub-tick movements in detector calculations
const invalidLevel = basePrice + 0.0005; // FORBIDDEN - half-cent on 1-cent tick
const zone = calculatedPrice + 0.0025; // INVALID - quarter-cent movement
```

**WHY TICK SIZE MATTERS FOR DETECTORS:**

- **Market Realism**: Detectors must work with realistic price movements
- **Signal Validity**: Signals at invalid price levels are meaningless
- **Backtesting Accuracy**: Invalid movements corrupt historical analysis
- **Production Reliability**: Real markets reject sub-tick orders

## 🎯 DETECTOR ARCHITECTURE PATTERNS

### Event-Based Detectors (Traditional Pattern)

For point-in-time signal generation at specific price levels:

```typescript
export class ExampleEventDetector extends BaseDetector {
    constructor(
        private readonly config: ExampleDetectorConfig,
        private readonly logger: ILogger,
        private readonly metrics: IWorkerMetricsCollector
    ) {
        super();
        // NO fallback values - config must provide everything
        this.validateConfig();
    }

    private validateConfig(): void {
        // Use Zod validation - throws on invalid config
        ExampleDetectorSchema.parse(this.config);
    }

    public detect(trade: EnrichedTradeEvent): DetectionResult | null {
        // ✅ CORRECT: Early return for insufficient data
        if (!this.hasMinimumData()) {
            return null; // Honest: cannot detect without sufficient data
        }

        // ✅ CORRECT: All calculations use FinancialMath
        const priceMove = FinancialMath.calculateSpread(
            trade.price, 
            this.previousPrice, 
            this.precision
        );

        // ✅ CORRECT: All thresholds from config
        if (priceMove < this.config.minPriceMove) {
            return null;
        }

        // ✅ CORRECT: Tick-compliant price calculations
        const signalLevel = FinancialMath.roundToTickSize(
            trade.price, 
            this.tickSize
        );

        return {
            type: 'example_signal',
            price: signalLevel,
            confidence: this.calculateConfidence(trade),
            timestamp: trade.timestamp
        };
    }

    private calculateConfidence(trade: EnrichedTradeEvent): number | null {
        // ✅ CORRECT: Return null if calculation cannot be performed
        if (this.historicalData.length < this.config.minHistoricalBars) {
            return null;
        }

        // Use FinancialMath for all calculations
        return FinancialMath.calculateMean(this.confidenceFactors);
    }
}
```

#### Event-Based Detector Requirements:

1. **Extend `BaseDetector` class**
2. **Implement `detect(trade: EnrichedTradeEvent)` method**
3. **Register in `DetectorFactory`**
4. **Add configuration schema with Zod validation**
5. **Include comprehensive tests (>95% coverage)**
6. **Performance benchmark (<1ms processing time)**
7. **False positive/negative rate analysis**

### Zone-Based Detectors (Advanced Pattern)

For evolving processes across price ranges and time:

```typescript
export class ExampleZoneDetector extends EventEmitter {
    private readonly zoneManager: ZoneManager;
    
    constructor(
        private readonly config: ExampleZoneDetectorConfig,
        private readonly logger: ILogger,
        private readonly metrics: IWorkerMetricsCollector
    ) {
        super();
        this.zoneManager = new ZoneManager(this.config.zoneLifetime);
        this.validateConfig();
    }

    public analyze(trade: EnrichedTradeEvent): ZoneAnalysisResult | null {
        // ✅ CORRECT: All zone calculations use expanded boundaries
        const baseZoneSize = this.config.zoneTicks * this.tickSize;
        const expandedZoneSize = baseZoneSize * 1.5; // 50% expansion for trade capture
        
        const zoneBounds = {
            minPrice: trade.price - expandedZoneSize / 2,
            maxPrice: trade.price + expandedZoneSize / 2
        };

        // ✅ CORRECT: Use FinancialMath for volume calculations
        const volumeMetrics = this.calculateZoneVolume(trade, zoneBounds);
        
        if (volumeMetrics === null) {
            return null; // Cannot analyze without valid volume data
        }

        return {
            zoneId: this.generateZoneId(trade.price),
            bounds: zoneBounds,
            metrics: volumeMetrics,
            evolution: this.trackZoneEvolution(trade)
        };
    }

    private calculateZoneVolume(
        trade: EnrichedTradeEvent, 
        bounds: ZoneBounds
    ): ZoneVolumeMetrics | null {
        // Filter trades within expanded zone boundaries
        const zoneTrades = this.getTradesInZone(bounds);
        
        if (zoneTrades.length === 0) {
            return null; // No trades in zone
        }

        // ✅ CORRECT: All volume calculations use FinancialMath
        const totalVolume = FinancialMath.sum(zoneTrades.map(t => t.volume));
        const avgPrice = FinancialMath.calculateMean(zoneTrades.map(t => t.price));
        
        return {
            totalVolume,
            avgPrice,
            tradeCount: zoneTrades.length,
            aggressiveRatio: this.calculateAggressiveRatio(zoneTrades)
        };
    }
}
```

#### Zone-Based Detector Requirements:

1. **Extend `EventEmitter` for zone event handling**
2. **Implement `analyze(trade: EnrichedTradeEvent): ZoneAnalysisResult` method**
3. **Use `ZoneManager` for lifecycle management**
4. **Handle zone candidates and zone formation logic**
5. **Emit zone updates and signals via WebSocket broadcasting**
6. **Memory usage analysis for zone state management**
7. **Concurrent access pattern validation**

## 🎯 DETECTOR OPTIMIZATION GOALS

### AbsorptionDetector Turning Point Optimization

**PRIMARY OBJECTIVE**: Detect local tops/bottoms leading to **0.7%+ price movement**.

#### 2-Phase Hierarchical Optimization:

**Phase 1: Core Parameters (Most Influential)**
```javascript
// High sensitivity configuration for 0.7%+ detection
{
    zoneTicks: [2, 3, 4],           // Tight to medium zones
    windowMs: [45000, 60000],       // 45-60s responsive timing
    minAggVolume: [20, 30, 40],     // Sensitive to moderate volume
}
```

**Phase 2: Refinement Parameters (False Signal Filtering)**
- **Absorption Quality**: `absorptionThreshold` (0.45-0.75), `minPassiveMultiplier` (1.1-1.8)
- **Price Movement**: `priceEfficiencyThreshold` (0.01-0.025), `velocityIncreaseThreshold` (1.2-2.0)  
- **Signal Timing**: `eventCooldownMs` (5000-20000), `spreadImpactThreshold` (0.002-0.005)

### Zone Volume Aggregation Architecture (MANDATORY)

**SOLUTION**: Expanded zone boundaries by 50% to ensure proper trade capture.

```typescript
// ✅ REQUIRED: Expanded boundaries for accurate volume aggregation
const baseZoneSize = this.config.zoneTicks * this.tickSize;
const expandedZoneSize = baseZoneSize * 1.5; // 50% expansion
const minPrice = zoneCenter - expandedZoneSize / 2;
const maxPrice = zoneCenter + expandedZoneSize / 2;

// ✅ VALIDATION: Zone must capture trades effectively
const tradesInZone = this.filterTradesByPrice(trades, minPrice, maxPrice);
if (tradesInZone.length === 0) {
    this.logger.warn(`Zone at ${zoneCenter} captured no trades - boundaries may be too restrictive`);
    return null;
}
```

**VALIDATION METRICS:**
- **Target**: `aggressiveVolume > 0, tradeCount > 0` (zone capturing trades)
- **Anti-Pattern**: `aggressiveVolume: 0, tradeCount: 0` (empty zones indicate boundary issues)

## 🚫 CALCULATION INTEGRITY (ZERO TOLERANCE)

**CRITICAL RULE**: When calculations cannot be performed with valid data, return `null` - NEVER use default numbers, fallbacks, or arbitrary values.

```typescript
// ❌ NEVER: Default numbers when calculation is invalid in detectors
const efficiency = this.calculateEfficiency(data) ?? 0.5; // FORBIDDEN
const confidence = priceData.length < 3 ? 0.7 : this.calculate(priceData); // FORBIDDEN
const imbalance = trades.length === 0 ? 0.5 : this.calculateImbalance(trades); // FORBIDDEN

// ✅ CORRECT: Return null for invalid calculations
const efficiency = this.calculateEfficiency(data); // returns number | null
if (efficiency === null) {
    return null; // Cannot proceed without valid calculation
}

// ✅ CORRECT: Early return when insufficient data  
if (trades.length < this.config.minTradeCount) {
    return null; // Honest: cannot calculate with insufficient data
}

// ✅ CORRECT: Validate data quality before calculation
if (!this.isDataQualitySufficient(marketData)) {
    return null; // Data quality insufficient for reliable detection
}
```

**WHY THIS MATTERS FOR DETECTORS:**

- **Signal Integrity**: Fake confidence values cause wrong trading decisions
- **Data Honesty**: Better to admit insufficient data than generate false signals
- **System Reliability**: Null values force proper error handling upstream
- **Debugging**: Real data issues visible, not masked by arbitrary defaults
- **Signal Quality**: Only emit signals when calculations are mathematically valid

## 🏦 DETECTOR DEVELOPMENT STANDARDS

### TypeScript Standards for Detectors

- **ZERO `any` types** - Use precise detector-specific interfaces
- **NEVER `unknown`** without type guards and validation
- **ALL detector methods must have explicit return types** 
- **ALL parameters must have explicit types**
- **Strict null checking enabled** - embrace `| null` return types
- **No implicit returns** - always explicit signal/null returns
- **KEEP DETECTOR LOGIC SIMPLE** - Avoid complex casting, prefer interface compatibility

### Error Handling Standards for Detectors

- **ALL async operations MUST have try-catch blocks**
- **ALL market data access MUST handle stale data scenarios**
- **ALL calculations MUST handle edge cases (division by zero, empty arrays)**
- **ALL errors MUST include correlation IDs for signal tracing**
- **NO silent failures - ALL detector errors must be logged with context**

### Performance Standards for Detectors

- **Sub-millisecond latency for trade processing** - detectors are in critical path
- **Memory usage must remain stable under high-frequency data**
- **CPU usage optimized for real-time signal generation**
- **Detector state management optimized for concurrent access**
- **Signal emission rate must not exceed downstream capacity**

### Configuration Standards for Detectors

```typescript
// ✅ REQUIRED: Complete detector configuration interface
interface DetectorConfig {
    // Core detection parameters
    readonly minAggVolume: number;
    readonly absorptionThreshold: number;
    readonly windowMs: number;
    
    // Performance parameters
    readonly maxProcessingTimeMs: number;
    readonly maxMemoryUsageMB: number;
    
    // Quality parameters
    readonly minConfidenceLevel: number;
    readonly maxFalsePositiveRate: number;
    
    // Market parameters
    readonly tickSize: number;
    readonly minSpreadBps: number;
}

// ✅ REQUIRED: Zod schema validation
const DetectorConfigSchema = z.object({
    minAggVolume: z.number().int().min(1).max(1000),
    absorptionThreshold: z.number().min(0.1).max(1.0),
    windowMs: z.number().int().min(1000).max(300000),
    // ... all parameters with proper validation ranges
});
```

### 🚫 LIVE DATA CACHING PROHIBITION FOR DETECTORS

**STRICTLY FORBIDDEN**: Caching live market data in detectors causes financial risk through stale signals.

```typescript
// ❌ NEVER: Cache live market data in detectors
const cachedOrderBookState = this.cache.get("orderbook");
const cachedLastPrice = this.priceCache[symbol];
const cachedVolumeData = this.volumeCache.get(timestamp);

// ✅ CORRECT: Always use fresh data for signal generation
const currentBid = this.orderBook.getBestBid();
const currentSpread = this.orderBook.getSpread(); 
const realtimeVolume = this.tradeStream.getCurrentVolume();
```

## 🧪 DETECTOR TESTING STANDARDS (ZERO TOLERANCE)

### Test Integrity Requirements for Detectors

- **Tests MUST detect signal generation errors** - Never adjust tests to pass buggy detector logic
- **Tests MUST validate real market scenarios** - Test with realistic market data patterns
- **Tests MUST fail when detector logic is wrong** - Bad signal logic should fail tests
- **NO adjusting expectations to match buggy detector code** - Fix detector, not tests
- **NO lowering signal quality standards** - Tests guide proper detector implementation

### Prohibited Detector Test Practices

- ❌ Adjusting signal expectations to match broken detector logic
- ❌ Adding randomness workarounds to mask detection failures  
- ❌ Lowering confidence thresholds to hide calculation bugs
- ❌ Using hardcoded test signals instead of validating real detector calculations
- ❌ Writing tests that validate current detector behavior vs correct detector behavior

### Required Detector Test Coverage

```typescript
describe('ExampleDetector', () => {
    // ✅ REQUIRED: Configuration validation tests
    it('should throw on invalid configuration', () => {
        expect(() => new ExampleDetector(invalidConfig)).toThrow();
    });

    // ✅ REQUIRED: Edge case handling tests  
    it('should return null for insufficient data', () => {
        const result = detector.detect(insufficientDataTrade);
        expect(result).toBeNull();
    });

    // ✅ REQUIRED: Signal quality tests
    it('should generate valid signals for strong patterns', () => {
        const result = detector.detect(strongPatternTrade);
        expect(result).not.toBeNull();
        expect(result.confidence).toBeGreaterThan(0.7);
    });

    // ✅ REQUIRED: Performance tests
    it('should process trades under 1ms', () => {
        const start = performance.now();
        detector.detect(testTrade);
        const duration = performance.now() - start;
        expect(duration).toBeLessThan(1);
    });

    // ✅ REQUIRED: FinancialMath usage tests
    it('should use FinancialMath for all calculations', () => {
        // Verify no direct floating-point arithmetic
        const spy = jest.spyOn(FinancialMath, 'calculateRatio');
        detector.detect(testTrade);
        expect(spy).toHaveBeenCalled();
    });
});
```

## 🧵 WORKER THREAD INTEGRATION FOR DETECTORS

### Detector Worker Thread Patterns

```typescript
// ✅ CORRECT: Detector in worker thread with proper proxy usage
export class DetectorWorker {
    private readonly detector: ExampleDetector;
    private readonly logger: ILogger;
    private readonly metrics: IWorkerMetricsCollector;

    constructor() {
        // Use proxy implementations - never direct infrastructure
        this.logger = new WorkerProxyLogger("detector-worker");
        this.metrics = new WorkerMetricsProxy("detector-worker");
        
        // Initialize detector with injected dependencies
        this.detector = new ExampleDetector(
            Config.EXAMPLE_DETECTOR,
            this.logger,
            this.metrics
        );
    }

    public async processTradeEvent(trade: EnrichedTradeEvent): Promise<void> {
        try {
            const signal = this.detector.detect(trade);
            
            if (signal !== null) {
                // Emit signal via worker message passing
                parentPort?.postMessage({
                    type: 'detector_signal',
                    data: signal,
                    worker: 'detector-worker',
                    correlationId: generateCorrelationId()
                });
                
                this.metrics.incrementMetric('signals_generated');
            }
            
            this.metrics.incrementMetric('trades_processed');
            
        } catch (error) {
            this.logger.error('Detector processing failed', { 
                error: error.message,
                trade: trade.id 
            });
            this.metrics.incrementMetric('processing_errors');
        }
    }
}

// ❌ WRONG: Direct infrastructure imports in detector worker
import { Logger } from "../../infrastructure/logger.js"; // VIOLATION!
import { MetricsCollector } from "../../infrastructure/metrics.js"; // VIOLATION!
```

### Detector Worker Thread Requirements

- **ALL detectors in worker threads MUST use proxy implementations**
- **NO direct infrastructure imports in detector worker files**
- **ALL detector signals MUST include correlation IDs**
- **Detector processing errors MUST be handled gracefully**
- **Detector performance metrics MUST be collected and batched**

## 🎯 SIGNAL PROCESSING INTEGRATION

### Signal Emission Standards

```typescript
// ✅ CORRECT: Proper signal emission from detector
interface DetectorSignal {
    readonly type: string;
    readonly price: number;
    readonly confidence: number;
    readonly timestamp: number;
    readonly metadata: SignalMetadata;
    readonly correlationId: string;
}

public emitSignal(signal: DetectorSignal): void {
    // Validate signal before emission
    if (!this.isSignalValid(signal)) {
        this.logger.warn('Invalid signal rejected', { signal });
        return;
    }

    // Include detector identification
    const enrichedSignal = {
        ...signal,
        detectorId: this.detectorId,
        detectorVersion: this.version,
        processingTime: this.getProcessingTime()
    };

    // Emit via proper signal coordinator
    this.signalCoordinator.queueSignal(enrichedSignal);
    this.metrics.incrementMetric('signals_emitted');
}
```

### Signal Quality Validation

- **ALL signals MUST include confidence levels**
- **ALL signals MUST be validated before emission**
- **Signal timestamps MUST be precise to microseconds**
- **Signal metadata MUST include detector identification**
- **Signal processing time MUST be tracked for performance monitoring**

## 🔧 DETECTOR CONFIGURATION MANAGEMENT

### Configuration Loading Pattern

```typescript
// ✅ REQUIRED: Configuration loading with validation
export class DetectorConfigManager {
    public static loadDetectorConfig<T>(
        detectorName: string, 
        schema: z.ZodSchema<T>
    ): T {
        const configPath = `symbols.LTCUSDT.detectors.${detectorName}`;
        const configData = get(CONFIG, configPath);
        
        if (!configData) {
            console.error(`Missing detector configuration: ${configPath}`);
            process.exit(1); // MANDATORY: Exit on missing config
        }

        try {
            return schema.parse(configData);
        } catch (error) {
            console.error(`Invalid detector configuration: ${configPath}`, error);
            process.exit(1); // MANDATORY: Exit on invalid config
        }
    }
}

// ✅ USAGE: Load configuration with mandatory validation
const config = DetectorConfigManager.loadDetectorConfig(
    'absorption',
    AbsorptionDetectorSchema
);
```

### Configuration Validation Requirements

- **ALL detector configs MUST use Zod schemas**
- **Missing configuration MUST cause `process.exit(1)`**
- **Invalid configuration MUST cause `process.exit(1)`**  
- **NO optional configuration parameters** - all must be explicitly provided
- **Configuration changes MUST be validated before deployment**

## 📊 DETECTOR PERFORMANCE MONITORING

### Performance Metrics Collection

```typescript
// ✅ REQUIRED: Comprehensive detector performance tracking
interface DetectorMetrics {
    readonly processingTimeMs: number;
    readonly signalsGenerated: number;
    readonly signalsRejected: number;
    readonly memoryUsageMB: number;
    readonly cpuUsagePercent: number;
    readonly errorCount: number;
    readonly falsePositiveRate: number;
    readonly signalLatencyMs: number;
}

public collectPerformanceMetrics(): DetectorMetrics {
    return {
        processingTimeMs: this.avgProcessingTime,
        signalsGenerated: this.signalCount,
        signalsRejected: this.rejectedSignalCount,
        memoryUsageMB: process.memoryUsage().heapUsed / 1024 / 1024,
        cpuUsagePercent: this.calculateCpuUsage(),
        errorCount: this.errorCount,
        falsePositiveRate: this.calculateFalsePositiveRate(),
        signalLatencyMs: this.avgSignalLatency
    };
}
```

### Performance Monitoring Requirements

- **Processing time MUST be tracked per trade**
- **Memory usage MUST be monitored continuously**  
- **Signal quality metrics MUST be collected**
- **Error rates MUST be tracked and alerted**
- **Performance degradation MUST trigger alerts**

## 🚫 ABSOLUTE PROHIBITIONS FOR DETECTORS (ZERO TOLERANCE)

**NEVER in detector implementations:**

- **Use magic numbers or hardcoded thresholds** - All values must be configurable
- **Cache live market data** - Always use fresh data for signal generation
- **Return arbitrary default values** - Return `null` when calculations cannot be performed
- **Skip input validation** - All trade data must be validated before processing
- **Use direct floating-point arithmetic** - Always use FinancialMath utilities
- **Ignore tick size constraints** - All price calculations must be tick-compliant
- **Create fallback signal logic** - Signal generation must be deterministic and configurable
- **Bypass error handling** - All detector errors must be logged with context
- **Skip performance monitoring** - All detector metrics must be collected
- **Use synchronous I/O operations** - All external operations must be asynchronous

### Detector Change Control Matrix

| Change Type | Approval Required | Testing Required | Monitoring Period |
|-------------|-------------------|------------------|-------------------|
| Algorithm Logic | YES | Full Suite + Performance + Backtesting | 48 hours |
| Configuration Schema | YES | Validation + Compatibility + Integration | 24 hours |
| Signal Processing | YES | Unit + Integration + Stress | 24 hours |
| Performance Optimization | NO | Unit + Performance Benchmarks | 12 hours |
| Documentation | NO | None | None |
| Tests | NO | Self-validation | None |

## 🎯 DETECTOR DEVELOPMENT CHECKLIST

### New Detector Implementation Checklist

- [ ] **Configuration Schema**: Zod schema with all parameters required (no `.optional()`)
- [ ] **Config Loading**: Uses `DetectorConfigManager` with `process.exit(1)` on missing/invalid config
- [ ] **FinancialMath Usage**: All calculations use `FinancialMath` utilities
- [ ] **Tick Size Compliance**: All price operations respect minimum tick sizes
- [ ] **Null Return Logic**: Returns `null` when calculations cannot be performed validly
- [ ] **Performance Monitoring**: Collects processing time, memory usage, and signal quality metrics
- [ ] **Error Handling**: Comprehensive try-catch with correlation IDs
- [ ] **Worker Thread Integration**: Uses proxy implementations for infrastructure dependencies
- [ ] **Test Coverage**: >95% coverage with edge cases, performance tests, and signal quality validation
- [ ] **Signal Validation**: All emitted signals validated before emission
- [ ] **Documentation**: Implementation documented with configuration parameter explanations
- [ ] **Performance Benchmarking**: Sub-millisecond processing time validated
- [ ] **Backtesting Integration**: Compatible with backtesting framework for optimization

### Detector Modification Checklist

- [ ] **Impact Assessment**: Trading operation impact evaluated
- [ ] **Signal Quality Analysis**: False positive/negative rate impact assessed
- [ ] **Performance Impact**: Processing time impact measured
- [ ] **Configuration Validation**: All config changes validated with Zod schemas
- [ ] **Test Updates**: Tests updated to reflect new behavior (never lowered to pass bad code)
- [ ] **Monitoring**: Enhanced monitoring for changed behavior
- [ ] **Rollback Plan**: Immediate rollback plan prepared
- [ ] **User Approval**: Explicit approval obtained for production-critical changes

This specialized CLAUDE.md for the `src/indicators` directory provides comprehensive guidance for developing institutional-grade pattern detection algorithms while maintaining all critical trading system standards.