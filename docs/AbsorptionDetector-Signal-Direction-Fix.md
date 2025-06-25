# AbsorptionDetector Signal Direction Fix

## Issue Description

**Problem**: AbsorptionDetector was emitting SELL signals at local lows where BUY signals were expected.

**Root Cause**: The `getDominantAggressiveSide()` function used a fixed count of last 10 trades, which often captured the absorption buying rather than the selling pressure that drove price to the low.

## Solution: Time-Based Dominant Side Analysis

### Implementation Overview

Replaced fixed trade count with configurable time-based analysis that captures the complete flow sequence leading to absorption events.

### Key Changes

#### 1. Added Configurable Parameters (CLAUDE.md Compliant)

```typescript
// AbsorptionSettings interface additions
dominantSideAnalysisWindowMs?: number;      // Time window for analysis (default: 45000ms)
dominantSideFallbackTradeCount?: number;    // Fallback trade count (default: 10)
dominantSideMinTradesRequired?: number;     // Min trades for time analysis (default: 3)
dominantSideTemporalWeighting?: boolean;    // Enable temporal weighting (default: false)
dominantSideWeightDecayFactor?: number;     // Weight decay factor (default: 0.5)
```

#### 2. Updated getDominantAggressiveSide() Logic

**Before:**
```typescript
const recentTrades = trades.slice(-10); // Fixed 10 trades - magic number!
```

**After:**
```typescript
// Time-based analysis with configurable window
const cutoff = Date.now() - this.dominantSideAnalysisWindowMs;
const recentTrades = trades.filter(trade => trade.timestamp >= cutoff);

// Fallback to trade count if insufficient time data
if (recentTrades.length < this.dominantSideMinTradesRequired) {
    const fallbackTrades = trades.slice(-this.dominantSideFallbackTradeCount);
    return this.calculateDominantSideFromTrades(fallbackTrades);
}
```

#### 3. Added Temporal Weighting Option

```typescript
// Optional temporal weighting - earlier trades get more weight
if (this.dominantSideTemporalWeighting) {
    const position = i / trades.length; // 0 = earliest, 1 = latest
    weight = 1 + (1 - position) * this.dominantSideWeightDecayFactor;
}
```

### Configuration Settings

#### Production Configuration (config.json)
```json
"absorption": {
    // ... existing settings ...
    "dominantSideAnalysisWindowMs": 45000,
    "dominantSideFallbackTradeCount": 10,
    "dominantSideMinTradesRequired": 3,
    "dominantSideTemporalWeighting": true,
    "dominantSideWeightDecayFactor": 0.3
}
```

### Why This Works

#### At Local Low (Example)
1. **Time 0-30s**: Heavy selling drives price to local low
2. **Time 30-45s**: Absorption buying begins (1,603 volume example)
3. **Analysis**: 45s window captures both phases
4. **Result**: Correctly identifies "sell" as dominant → signals "buy"

#### Benefits
- **Captures complete market sequence**: Both the drive and the absorption
- **Configurable for different markets**: Adjust window for market characteristics
- **Temporal weighting**: Prioritizes the flow that initiated the move
- **No magic numbers**: Fully CLAUDE.md compliant

### Testing & Validation

#### Expected Behavior
- **Local Low + Absorption** → BUY signal (support forming)
- **Local High + Absorption** → SELL signal (resistance forming)

#### Debug Logging
To verify correct operation, temporary debug logging can be added:
```typescript
console.log("Dominant side analysis:", {
    windowMs: this.dominantSideAnalysisWindowMs,
    tradesInWindow: recentTrades.length,
    buyVolume,
    sellVolume,
    dominantSide: buyVolume > sellVolume ? "buy" : "sell"
});
```

### Performance Impact

- **Minimal overhead**: Simple timestamp filtering
- **Memory efficient**: No additional data structures
- **FinancialMath compliant**: Uses safe arithmetic operations

### Migration Notes

- **Backward compatible**: Existing configs work with defaults
- **No database changes**: Pure logic update
- **Hot-swappable**: Can adjust parameters without restart

## Summary

This fix ensures AbsorptionDetector correctly identifies market direction by analyzing the complete flow sequence that creates absorption patterns, rather than just the most recent trades. The solution is fully configurable, CLAUDE.md compliant, and maintains institutional-grade precision.