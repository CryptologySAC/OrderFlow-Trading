# Analysis Scripts

This directory contains analysis tools for signal validation and optimization using the JSON Lines format.

## Scripts

### Signal Analysis

```bash
# Analyze successful signals with actual price reconstruction
yarn analyze:signals [YYYY-MM-DD]

# Example
yarn analyze:signals 2025-08-15
```

- **Input**: JSON Lines files from `logs/signal_validation/`
- **Output**: HTML report in `analysis/reports/successful_signals_actual_tp_analysis.html`
- **Purpose**: Verify if "successful" signals actually reached 0.7% profit targets

### Threshold Optimization

```bash
# Optimize detector threshold combinations
yarn analyze:thresholds [YYYY-MM-DD]

# Example
yarn analyze:thresholds 2025-08-15
```

- **Input**: JSON Lines files from `logs/signal_validation/`
- **Output**: Console analysis + JSON report in `analysis/reports/threshold_optimization_report.json`
- **Purpose**: Find optimal threshold combinations to maximize successful signals while minimizing harmful ones

## Data Format

**Updated Format**: JSON Lines (.jsonl) - each line is a complete JSON object

- **✅ Advantages**: No CSV parsing errors, preserves nested data, easy to analyze
- **📁 Location**: `logs/signal_validation/*.jsonl`

**Previous Format**: CSV (.csv) - deprecated due to JSON object comma conflicts

## Output Structure

```
analysis/
├── analyze_success_with_price_reconstruction.ts
├── analyze_threshold_combinations.ts
├── reports/
│   ├── successful_signals_actual_tp_analysis.html
│   └── threshold_optimization_report.json
└── README.md
```

## Examples

### Analyzing Today's Signals

```bash
yarn analyze:signals
```

### Analyzing Specific Date

```bash
yarn analyze:signals 2025-08-15
yarn analyze:thresholds 2025-08-15
```

## Required Files

The scripts expect these JSON Lines files in `logs/signal_validation/`:

- `{detector}_validation_{date}.jsonl` - All signals with validation data
- `{detector}_successful_{date}.jsonl` - Successfully completed signals
- `{detector}_rejections_{date}.jsonl` - Rejected signals with reasons
- `{detector}_rejected_missed_{date}.jsonl` - Rejected signals that would have been profitable

Where `{detector}` is: `absorption`, `exhaustion`, or `deltacvd`
