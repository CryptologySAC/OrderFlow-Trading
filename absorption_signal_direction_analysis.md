# AbsorptionDetector Signal Direction Analysis

## 🚨 ISSUE REPORTED: 3 SELL signals at local low

**Observation**: 3 absorption detections in same zone at local low, all signaling SELL
**Expected**: At local low with absorption, expect BUY signals (bullish absorption)

## 📋 Current Logic Trace

### Step 1: Determine Dominant Aggressive Side

```typescript
// getDominantAggressiveSide() - lines 810-829
for (const trade of recentTrades) {
    if (trade.buyerIsMaker) {
        // buyerIsMaker = true → aggressive sell hitting bid
        sellVolume += trade.quantity;
    } else {
        // buyerIsMaker = false → aggressive buy hitting ask
        buyVolume += trade.quantity;
    }
}
return buyVolume > sellVolume ? "buy" : "sell";
```

### Step 2: Determine Absorbing Side

```typescript
// getAbsorbingSideForZone() - line 866
const absorbingSide = dominantAggressiveSide === "buy" ? "ask" : "bid";
```

### Step 3: Convert to Signal Direction

```typescript
// Signal emission - line 1492
side: side === "bid" ? "buy" : "sell";
```

## 🔍 Logic Analysis

### At Local Low with Absorption (Expected):

1. **Market Context**: Price hits local low, selling pressure exhausted
2. **Dominant Aggressive**: Should be **"sell"** (selling drove price down)
3. **Absorbing Side**: Should be **"bid"** (buyers absorbing the selling)
4. **Expected Signal**: Should be **"buy"** (bullish - sellers absorbed)

### Current Logic Result:

- **dominantAggressiveSide = "sell"** ✅
- **absorbingSide = "bid"** ✅ (line 866: "sell" → "bid")
- **signal = "buy"** ✅ (line 1492: "bid" → "buy")

**The logic appears CORRECT!**

## 🎯 Potential Issues

### Issue 1: Incorrect Dominant Side Detection

If seeing SELL signals at local low, the `getDominantAggressiveSide()` might be returning **"buy"** instead of **"sell"**.

**Possible causes:**

- More recent **buy volume** than **sell volume** in the last 10 trades
- **buyerIsMaker field interpretation** might be incorrect
- **Trade timing** - analyzing trades after the reversal started

### Issue 2: Signal Interpretation Confusion

The signal might be correct but misinterpreted:

- **"sell" signal** = "ask side is absorbing buy pressure" = resistance formed
- **"buy" signal** = "bid side is absorbing sell pressure" = support formed

### Issue 3: Zone Timing Issue

Multiple signals in same zone might indicate:

- **Overlapping analysis windows**
- **Insufficient cooldown** between signals
- **Zone boundary issues** - same price level analyzed multiple times

## 🔬 Debugging Strategy

### 1. Check buyerIsMaker Field Interpretation

```typescript
// Verify trade direction interpretation
console.log("Trade analysis:");
for (const trade of tradesAtZone.slice(-10)) {
    console.log({
        price: trade.price,
        quantity: trade.quantity,
        buyerIsMaker: trade.buyerIsMaker,
        interpretation: trade.buyerIsMaker
            ? "aggressive_sell"
            : "aggressive_buy",
        timestamp: trade.timestamp,
    });
}
```

### 2. Check Dominant Side Calculation

```typescript
// In getDominantAggressiveSide()
console.log("Volume analysis:", {
    buyVolume,
    sellVolume,
    dominantSide: buyVolume > sellVolume ? "buy" : "sell",
    ratio: buyVolume / (sellVolume || 1),
});
```

### 3. Check Price Context

```typescript
// Verify local low context
console.log("Price context:", {
    currentPrice: price,
    recentPrices: tradesAtZone.slice(-10).map(t => t.price),
    isAtLocalLow: /* determine if truly at local low */
});
```

## 🚫 Likely Root Causes

### Most Likely: Wrong Dominant Side Detection

**Scenario**: At local low, recent trades (last 10) might show more buying than selling due to:

1. **Absorption already happening** - buyers stepped in
2. **Analysis window too short** - missing the selling that drove to the low
3. **Trade sequence timing** - analyzing after reversal started

### Solution: Extend Analysis Window

```typescript
// Instead of last 10 trades, use longer window
const recentTrades = trades.slice(-20); // or time-based window
```

### Alternative: Volume-Weighted Analysis

```typescript
// Weight recent trades less heavily
const buyVolume = recentTrades.reduce((sum, trade, index) => {
    const weight = 1 - (index / recentTrades.length) * 0.5; // Decay recent trades
    return sum + (trade.buyerIsMaker ? 0 : trade.quantity * weight);
}, 0);
```

## 🎯 Immediate Debug Actions

### 1. Log Signal Details

Add logging in signal emission to see:

```typescript
console.log("Absorption signal debug:", {
    zone,
    price,
    dominantAggressiveSide,
    absorbingSide: side,
    finalSignal: side === "bid" ? "buy" : "sell",
    buyVolume,
    sellVolume,
    recentTrades: tradesAtZone.slice(-10).map((t) => ({
        price: t.price,
        buyerIsMaker: t.buyerIsMaker,
        quantity: t.quantity,
    })),
});
```

### 2. Verify Against Live Data

When you see the next absorption at local low:

1. **Check dominant aggressive side** - should be "sell"
2. **Check trade sequence** - should show heavy selling followed by absorption
3. **Check signal timing** - should emit after absorption, not during selling

### 3. Test Signal Inversion

Temporarily test inverted logic:

```typescript
// Test inversion
side: side === "bid" ? "sell" : "buy", // INVERTED for testing
```

## 💡 Recommended Fix

Based on the analysis, the most likely issue is **analysis window timing**. The detector might be analyzing trades after buyers have already stepped in, making it appear that buying is dominant when it should detect the original selling pressure.

**Suggested fix**: Extend analysis window or use time-based analysis instead of fixed trade count for determining dominant aggressive side.
