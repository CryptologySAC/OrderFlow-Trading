# CLAUDE.md - General Development Standards

Production trading system development standards for Claude Code with **ZERO TOLERANCE** for trading operation errors.

## 🚨 CRITICAL FOUNDATION

**Do not guess, NEVER guess; all your answers are based and calculated; if you need more data to calculate you ask for it; no guessing, no estimations, no general answers, no bullshit. Math and logic above everything, request clarification when you are unsure.**

## 🏛️ INSTITUTIONAL STANDARDS FOR DEVELOPMENT

### 📋 DEVELOPMENT PRINCIPLES (NON-NEGOTIABLE)

#### Code Quality Standards

- **ZERO `any` types** - Use precise TypeScript interfaces and types
- **NEVER `unknown`** without proper type guards and validation
- **ALL async operations MUST have try-catch blocks**
- **ALL error handling MUST include correlation IDs**
- **STRICT null checking enabled** - embrace `| null` return types
- **No implicit returns** - always explicit return statements

#### Financial Precision Requirements

- **ALL financial calculations MUST use `FinancialMath` utilities**
- **ALL price operations MUST respect minimum tick sizes**
- **ALL calculations MUST handle edge cases (division by zero, empty arrays)**
- **Data integrity validation** before any calculation
- **Return `null` when calculations cannot be performed validly**

### 🚫 ABSOLUTE PROHIBITIONS (ZERO TOLERANCE)

**NEVER in any code:**

- **Use magic numbers or hardcoded thresholds** - All values configurable via `config.json`
- **Cache live market data** - Always use fresh data for signal generation
- **Return arbitrary default values** - Return `null` when calculations cannot be performed
- **Skip input validation** - All inputs must be validated before processing
- **Use direct floating-point arithmetic** - Always use `FinancialMath` utilities
- **Ignore tick size constraints** - All price calculations must be tick-compliant
- **Create fallback signal logic** - Signal generation must be deterministic and configurable

### 🔢 FINANCIALMATH - MISSION CRITICAL (MANDATORY)

**CRITICAL REQUIREMENT**: ALL financial calculations in the codebase MUST use `src/utils/financialMath.ts`.

#### Mandatory Usage Patterns

```typescript
// ✅ CORRECT: Use FinancialMath for all financial calculations
const midPrice = FinancialMath.calculateMidPrice(bid, ask, precision);
const spread = FinancialMath.calculateSpread(ask, bid, precision);
const volumeRatio = FinancialMath.calculateRatio(
    aggressiveVol,
    passiveVol,
    precision
);
const priceEfficiency = FinancialMath.calculateRatio(
    priceMove,
    expectedMove,
    precision
);
const confidence = FinancialMath.calculateMean(confidenceFactors);

// ❌ PROHIBITED: Direct floating-point arithmetic
const midPrice = (bid + ask) / 2; // PRECISION LOSS
const ratio = aggressiveVol / passiveVol; // ROUNDING ERRORS
const efficiency = priceMove / expectedMove; // CALCULATION DRIFT
```

#### Tick Size Compliance (MANDATORY)

**ALL price movements MUST respect minimum tick sizes:**

```typescript
// ✅ CORRECT: Tick-compliant calculations
const tickSize = 0.01; // For $10-$100 price range
const priceLevel = FinancialMath.roundToTickSize(calculatedLevel, tickSize);
const zoneWidth = tickSize * config.zoneTicks;

// ❌ PROHIBITED: Sub-tick movements
const invalidLevel = basePrice + 0.0005; // FORBIDDEN - half-cent on 1-cent tick
```

### 🏗️ ARCHITECTURE PATTERNS

#### Error Handling Standards

```typescript
// ✅ CORRECT: Comprehensive error handling
public async processTrade(trade: EnrichedTradeEvent): Promise<void> {
    try {
        // Validate input
        if (!this.isValidTrade(trade)) {
            this.logger.warn('Invalid trade data', { tradeId: trade.id });
            return;
        }

        // Process with error handling
        const result = await this.processTradeData(trade);
        if (result === null) {
            this.logger.info('Trade processing returned null - insufficient data');
            return;
        }

        // Success handling
        this.metrics.incrementMetric('trades_processed');
    } catch (error) {
        this.logger.error('Trade processing failed', {
            error: error.message,
            tradeId: trade.id,
            correlationId: generateCorrelationId()
        });
        this.metrics.incrementMetric('processing_errors');
    }
}
```

#### Configuration Management

```typescript
// ✅ CORRECT: Zod validation with process.exit(1) on invalid config
export const SystemConfigSchema = z.object({
    httpPort: z.number().int().min(1000).max(65535),
    wsPort: z.number().int().min(1000).max(65535),
    symbol: z.string().min(1),
    // ALL properties required - no .optional()
});

export class ConfigManager {
    public static get SYSTEM() {
        return SystemConfigSchema.parse(CONFIG);
        // Zod .parse() throws on missing/invalid config → process.exit(1)
    }
}
```

### 🧪 TESTING STANDARDS

#### Test Integrity Requirements

- **Tests MUST detect signal generation errors** - Never adjust tests to pass buggy logic
- **Tests MUST validate real market scenarios** - Test with realistic market data
- **Tests MUST fail when logic is wrong** - Bad logic should fail tests
- **NO adjusting expectations to match buggy code** - Fix code, not tests
- **NO lowering signal quality standards** - Tests guide proper implementation

#### Required Test Coverage

```typescript
describe("TradeProcessor", () => {
    // ✅ REQUIRED: Edge case testing
    it("should return null for insufficient data", () => {
        const result = processor.process(insufficientData);
        expect(result).toBeNull();
    });

    // ✅ REQUIRED: Error handling testing
    it("should handle invalid trade data gracefully", () => {
        expect(() => processor.process(invalidTrade)).not.toThrow();
    });

    // ✅ REQUIRED: FinancialMath usage verification
    it("should use FinancialMath for all calculations", () => {
        const spy = jest.spyOn(FinancialMath, "calculateRatio");
        processor.process(validTrade);
        expect(spy).toHaveBeenCalled();
    });
});
```

### 📊 PERFORMANCE STANDARDS

#### Latency Requirements

- **Sub-millisecond latency** for trade processing in critical path
- **Memory usage must remain stable** under high-frequency data
- **CPU usage optimized** for real-time signal generation
- **Error rates must be tracked** and alerted upon

#### Memory Management

```typescript
// ✅ CORRECT: Bounded data structures
export class TradeBuffer {
    private readonly maxSize: number;
    private trades: EnrichedTradeEvent[] = [];

    constructor(maxSize: number) {
        this.maxSize = maxSize;
    }

    public add(trade: EnrichedTradeEvent): void {
        this.trades.push(trade);
        if (this.trades.length > this.maxSize) {
            this.trades.shift(); // Remove oldest
        }
    }
}
```

### 🔗 SYSTEM INTEGRATION

#### WebSocket Standards

```typescript
// ✅ CORRECT: Node.js ws library message handling
wss.on("connection", (ws: WebSocket) => {
    ws.on("message", (data: Buffer) => {
        try {
            // Convert Buffer to string using UTF-8
            const message = data.toString("utf-8");

            // Validate with Zod schema
            const validatedMessage = MessageSchema.parse(JSON.parse(message));

            // Process validated message
            this.handleMessage(validatedMessage);
        } catch (error) {
            this.logger.error("WebSocket message processing failed", {
                error: error.message,
                correlationId: generateCorrelationId(),
            });
        }
    });
});
```

#### Database Operations

```typescript
// ✅ CORRECT: Database operation patterns
export class DatabaseManager {
    public async getTrades(
        symbol: string,
        limit: number
    ): Promise<TradeData[] | null> {
        try {
            const stmt = this.db.prepare(`
                SELECT * FROM trades
                WHERE symbol = ?
                ORDER BY timestamp DESC
                LIMIT ?
            `);

            const rows = stmt.all(symbol, limit);
            return rows.length > 0 ? rows : null;
        } catch (error) {
            this.logger.error("Database query failed", {
                error: error.message,
                symbol,
                limit,
                correlationId: generateCorrelationId(),
            });
            return null;
        }
    }
}
```

### 🎯 DEVELOPMENT WORKFLOW

#### Pre-commit Standards

- **ALL code MUST pass linting** with zero warnings
- **ALL code MUST pass TypeScript compilation**
- **ALL tests MUST pass** with >95% coverage
- **ALL financial calculations MUST use FinancialMath**
- **ALL configurations MUST be validated with Zod**

#### Code Review Requirements

- **ALL changes affecting trading logic** require senior review
- **ALL detector modifications** require testing validation
- **ALL configuration changes** require deployment verification
- **ALL performance changes** require benchmarking validation

### 🚨 VIOLATION DETECTION

```
🧵 DEVELOPMENT STANDARD VIOLATION DETECTED 🧵
Violation type: [specific violation]
File: [filename:line_number]
This violates institutional development standards.
Required corrections: [specific fixes needed]
This change is PROHIBITED without explicit architectural approval.
```

---

## 📚 SPECIALIZED GUIDANCE

**For specialized development standards, see:**

- **Detector Development**: `src/indicators/CLAUDE.md` - Pattern detection algorithms
- **Testing Standards**: `test/CLAUDE.md` - Test integrity and validation
- **Project Overview**: `/CLAUDE.md` - Complete system architecture

**Built for institutional trading with zero tolerance for errors.**
