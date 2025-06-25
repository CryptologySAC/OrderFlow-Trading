# Backtest Real Values Update

## Issue Discovered

The backtesting framework was using unrealistic values that didn't match production configuration, leading to invalid optimization results.

## Configuration Comparison

### ❌ **OLD Backtest Values (Incorrect)**

```typescript
// Conservative profile
minAggVolume: 1000; // 2.5x production!
absorptionThreshold: 0.85; // 42% higher than production
minPassiveMultiplier: 3.0; // 2.5x production

// Grid search ranges
minAggVolume: [10, 25, 50, 100, 300, 600]; // Started at 10, production is 400!
priceEfficiencyThreshold: [0.75, 0.8, 0.85, 0.9, 0.95]; // Production is 0.02!
```

### ✅ **NEW Backtest Values (Realistic)**

```typescript
// Production profile (NEW)
minAggVolume: 400; // Exact production value
absorptionThreshold: 0.6; // Exact production value
minPassiveMultiplier: 1.2; // Exact production value
zoneTicks: 5; // Exact production value
windowMs: 60000; // Exact production value
priceEfficiencyThreshold: 0.02; // Exact production value

// Grid search ranges (centered around production)
minAggVolume: [250, 300, 350, 400, 500, 600];
absorptionThreshold: [0.5, 0.55, 0.6, 0.65, 0.7];
priceEfficiencyThreshold: [0.015, 0.018, 0.02, 0.025, 0.03];
zoneTicks: [3, 4, 5, 6];
windowMs: [45000, 50000, 60000, 75000];
```

## Profile Updates

### 1. **Production Profile** (New)

- Uses exact values from config.json
- Includes all parameters including new time-based analysis settings
- Serves as baseline for comparison

### 2. **Conservative Profile**

- Now uses realistic increases (50% higher volume, not 250%)
- All thresholds based on production values

### 3. **Balanced Profile**

- Slightly more sensitive than production
- Realistic parameter ranges

### 4. **Aggressive Profile**

- Lower thresholds for more signals
- Still maintains realistic values

## Impact on Backtesting

### Before Fix

- Backtests would show very few signals (thresholds too high)
- Optimization would suggest unrealistic parameter values
- Results wouldn't match live trading performance

### After Fix

- Backtests now use production-realistic values
- Optimization explores reasonable parameter ranges
- Results should closely match live trading behavior

## Grid Search Improvements

The grid search now explores realistic ranges:

- **Volume**: 250-600 (centered on 400 production value)
- **Thresholds**: Small variations around production values
- **Zone sizes**: 3-6 ticks (production is 5)
- **Time windows**: 45-75 seconds (production is 60)

## Usage

To test with real production values:

```bash
# Test current production configuration
node run_hierarchical_backtest.js --detector absorptionDetector --profile balanced

# Run grid search with realistic values
npx ts-node scripts/runBacktest.ts --detectors absorptionDetector --grid-points 4
```

## Summary

This update ensures the backtesting framework uses realistic values that match production configuration, making optimization results valid and actionable for live trading.
