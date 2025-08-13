# Threshold Optimization Results - 2025-08-13

## Executive Summary

Two threshold optimization scripts were analyzed to find optimal detector settings:
1. **`analyze_optimal_thresholds.ts`** - Focuses on swing coverage and signal categorization
2. **`analyze_threshold_combinations.ts`** - Uses phase-based clustering for more advanced analysis

Both scripts confirmed similar findings, showing that current thresholds are too lenient and need significant tightening.

## Key Findings

### 🔴 Critical Issue: Thresholds Too Low

All detectors are showing minimum threshold values of nearly 0, indicating:
- The CSVs contain POST-filter values (signals that already passed thresholds)
- Current production thresholds are TOO LOW
- We're getting too many false positives that later fail

### 📊 Signal Quality Breakdown

#### Absorption Detector
- **Total Signals**: 17,935
- **Successful (0.7%+ TP)**: 13,396 (74.7%)
- **Harmless (BE/Redundant)**: 4,470 (24.9%)
- **Harmful (Would SL)**: 69 (0.4%)
- **Coverage**: 100% of all swings/phases

**Key Issue**: The minimum values for all thresholds are near 0, meaning production thresholds need to be RAISED significantly.

#### Exhaustion Detector
- **Total Signals**: 18,602
- **Successful**: 13,633 (73.3%)
- **Harmless**: 4,640 (24.9%)
- **Harmful**: 329 (1.8%)
- **Coverage**: 100% of all swings/phases

**Key Issue**: Higher harmful rate than absorption, needs tighter thresholds.

#### DeltaCVD Detector
- **Total Signals**: 45
- **Successful**: 17 (37.8%)
- **Harmless**: 9 (20.0%)
- **Harmful**: 19 (42.2%)
- **Coverage**: 100% of clusters

**Critical Issue**: Very poor performance with 42% harmful signals!

## Recommended Actions

### 1. Immediate Threshold Adjustments

Since the CSV data shows POST-filter values and the minimum values are near 0, we need to SIGNIFICANTLY RAISE thresholds:

#### Absorption Detector
```typescript
// Current production thresholds are allowing signals with values as low as:
minAggVolume: 1.616  // Should be at least 1000+
minPassiveMultiplier: 0.496  // Should be at least 5+
passiveAbsorptionThreshold: 0.332  // Should be at least 0.5+
```

#### Exhaustion Detector
```typescript
// Need much higher volume requirements
minAggVolume: 0.076  // Should be at least 1000+
```

#### DeltaCVD Detector
```typescript
// Needs complete overhaul - 42% harmful rate is unacceptable
minTradesPerSec: 3.0  // Should be at least 5+
signalThreshold: 0.51  // Should be at least 0.8+
```

### 2. Understanding the Data

The analysis reveals that:
1. **CSV values are POST-filter**: The thresholds shown in CSVs are the actual calculated values AFTER passing production filters
2. **Production thresholds are too low**: If minimum values in successful signals are near 0, production is letting everything through
3. **Need to analyze CONFIG.JSON**: We must check actual production thresholds vs. these findings

### 3. Phase-Based Analysis Insights

The combination analysis using phases showed:
- **Clustering works**: Signals naturally group into 5-minute clusters
- **Phases are distinct**: 15-minute gaps separate major movements
- **Position management matters**: Redundant same-side signals are harmless when position is active

## Script Comparison

### `analyze_optimal_thresholds.ts`
- ✅ Uses swing-based grouping (30-minute windows)
- ✅ Properly categorizes signals (Successful/Harmless/Harmful)
- ✅ Tests threshold percentiles
- ⚠️ Simpler clustering logic

### `analyze_threshold_combinations.ts`
- ✅ Advanced phase-based clustering
- ✅ Tests threshold combinations (not just individual)
- ✅ More detailed categorization (includes Small TP)
- ✅ Better quality scoring algorithm
- ⚠️ More complex, slower execution

## Recommendations

1. **Use `analyze_threshold_combinations.ts`** for production threshold optimization (more accurate)
2. **Check config.json** to see actual production thresholds
3. **Raise ALL thresholds** significantly based on these findings
4. **Focus on DeltaCVD** - needs complete reconfiguration with 42% harmful rate
5. **Add pre-filter logging** to capture what's being rejected in production

## Next Steps

1. Review `config.json` for actual production thresholds
2. Compare production thresholds to the minimum values found in CSVs
3. Implement new threshold recommendations
4. Add logging BEFORE filtering to understand rejection patterns
5. Re-run analysis after threshold adjustments

---

**Generated**: 2025-08-13
**Scripts Used**: 
- `analyze_optimal_thresholds.ts`
- `analyze_threshold_combinations.ts`