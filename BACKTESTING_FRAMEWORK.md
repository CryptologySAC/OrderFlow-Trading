# 🎯 Comprehensive Detector Backtesting Framework

## Overview

This framework provides scientific validation of detector effectiveness by testing all detectors against historical market data to measure their ability to predict significant price movements (≥0.7%).

**Key Features:**

- ✅ **Scientific Validation**: Measures precision, recall, F1-score, and direction accuracy
- ✅ **Comprehensive Testing**: Tests multiple parameter configurations per detector
- ✅ **Performance Scoring**: Shows exactly how many movements each detector predicts, misses, and false signals generated
- ✅ **Parameter Optimization**: Finds optimal settings for maximum predictive accuracy
- ✅ **Interactive Dashboard**: Beautiful HTML dashboard with performance rankings and analysis
- ✅ **Parallel Processing**: Tests multiple configurations simultaneously for speed
- ✅ **Real Market Data**: Uses actual historical trades and order book data

## 📊 Scoring Methodology

For each detector configuration, the framework measures:

### Core Metrics (Per Detector, Per Setting)

- **True Positives**: Movements correctly predicted (signal → movement in predicted direction)
- **False Positives**: False signals generated (signal → no significant movement or wrong direction)
- **False Negatives**: Movements missed (significant movement → no preceding signal)
- **Precision**: `True Positives / (True Positives + False Positives)` - How many signals were correct
- **Recall**: `True Positives / (True Positives + False Negatives)` - How many movements were predicted
- **F1-Score**: `2 × (Precision × Recall) / (Precision + Recall)` - Balanced performance metric
- **Direction Accuracy**: Percentage of signals with correct direction (buy→up, sell→down)

### Movement Detection

- **Movement Threshold**: 0.7% minimum price change (configurable)
- **Signal-to-Movement Window**: 30 minutes maximum delay (configurable)
- **Direction Mapping**: Buy signals predict upward movements, sell signals predict downward movements

## 🚀 Quick Start

### 1. Ensure Data Availability

```bash
# Check available historical data
ls backtesting_data/
# Should show files like: LTCUSDT_2025-06-21_06h_trades.csv, LTCUSDT_2025-06-21_06h_depth.csv
```

### 2. Run Quick Example

```bash
# Run example with limited detectors for quick results
node example_backtest.js
```

### 3. View Results

```bash
# Open the generated HTML dashboard
open backtest_results/backtesting_results.html
```

## 🛠️ Advanced Usage

### Full Backtesting Suite

```bash
# Test all detectors with all configurations (may take 30-60 minutes)
npx ts-node scripts/runBacktest.ts

# Test specific detectors only
npx ts-node scripts/runBacktest.ts --detectors hiddenOrderDetector,icebergDetector,spoofingDetector

# Test conservative profiles only (higher precision, lower recall)
npx ts-node scripts/runBacktest.ts --profiles conservative

# Test aggressive profiles only (higher recall, lower precision)
npx ts-node scripts/runBacktest.ts --profiles aggressive

# Sort results by precision instead of F1-score
npx ts-node scripts/runBacktest.ts --sort-by precision

# Test specific date range
npx ts-node scripts/runBacktest.ts --start-date 2025-06-21 --end-date 2025-06-22

# Fast testing with high speed multiplier
npx ts-node scripts/runBacktest.ts --speed 1000 --parallel 5

# Only analyze configurations with minimum signal count
npx ts-node scripts/runBacktest.ts --min-signals 50
```

### Command Line Options

```
--data-dir <path>        Data directory (default: ./backtesting_data)
--output-dir <path>      Output directory (default: ./backtest_results)
--symbol <symbol>        Trading symbol (default: LTCUSDT)
--speed <multiplier>     Speed multiplier 1-1000 (default: 100)
--parallel <count>       Parallel tests 1-10 (default: 3)
--start-date <date>      Start date YYYY-MM-DD (optional)
--end-date <date>        End date YYYY-MM-DD (optional)
--detectors <list>       Comma-separated detector types (optional)
--profiles <list>        Comma-separated profiles: conservative,balanced,aggressive (optional)
--min-signals <count>    Minimum signals for analysis (optional)
--sort-by <metric>       Sort by: precision,recall,f1Score,accuracy,directionAccuracy (default: f1Score)
--no-grid-search         Disable grid search (profile tests only)
--grid-points <count>    Grid search points (default: 4)
```

## 📋 Available Detectors

### Market Manipulation Detectors

- **`hiddenOrderDetector`**: Detects market orders executing against invisible liquidity
- **`icebergDetector`**: Identifies large orders broken into consistent smaller pieces
- **`spoofingDetector`**: Finds fake walls and ghost liquidity manipulation

### Order Flow Detectors

- **`absorptionDetector`**: Detects large order absorption at key levels
- **`exhaustionDetector`**: Identifies liquidity exhaustion patterns
- **`deltaCVDDetector`**: Cumulative volume delta confirmation signals

### Zone-Based Detectors

- **`accumulationDetector`**: Smart money accumulation zones
- **`distributionDetector`**: Institutional distribution patterns
- **`supportResistanceDetector`**: Key price level detection

## 📊 Output Files

The framework generates comprehensive results in multiple formats:

### Interactive Dashboard

- **`backtesting_results.html`**: Beautiful interactive dashboard with charts and rankings

### CSV Exports

- **`performance_results.csv`**: Detailed performance metrics for every configuration
- **`test_results.csv`**: Test execution details and timing information
- **`rankings.csv`**: Performance rankings sorted by selected metric

### Configuration Files

- **`optimal_configurations.json`**: Best performing parameters for each detector
- **`performance_summary.md`**: Markdown report with key insights and recommendations

## 🏆 Performance Rankings Example

```
Rank | Config ID                    | Detector         | F1 Score | Precision | Recall | Dir. Accuracy
-----|------------------------------|------------------|----------|-----------|--------|--------------
1    | hidden_balanced              | hiddenOrder      | 0.847    | 0.923     | 0.781  | 0.892
2    | iceberg_conservative         | iceberg          | 0.823    | 0.945     | 0.725  | 0.876
3    | spoofing_grid_12            | spoofing         | 0.801    | 0.887     | 0.731  | 0.854
4    | absorption_balanced          | absorption       | 0.789    | 0.834     | 0.749  | 0.823
5    | exhaustion_aggressive        | exhaustion       | 0.756    | 0.798     | 0.718  | 0.797
```

## 🔬 Analysis Features

### Parameter Sensitivity Analysis

- Shows how different parameter values affect performance
- Identifies optimal ranges for each detector setting
- Reveals which parameters have the most impact

### Profile Comparison

- **Conservative**: Higher precision, fewer false positives, may miss some movements
- **Balanced**: Optimal F1-scores, good precision/recall balance
- **Aggressive**: Higher recall, catches more movements, more false positives

### Market Condition Analysis

- Performance breakdown by volatility periods
- Signal frequency and timing analysis
- Direction accuracy by market trend

## 🎛️ Configuration Profiles

### Conservative Profiles

```json
{
    "hiddenOrderDetector": {
        "minHiddenVolume": 20,
        "minConfidence": 0.9,
        "minTradeSize": 10
    }
}
```

### Balanced Profiles

```json
{
    "hiddenOrderDetector": {
        "minHiddenVolume": 10,
        "minConfidence": 0.8,
        "minTradeSize": 5
    }
}
```

### Aggressive Profiles

```json
{
    "hiddenOrderDetector": {
        "minHiddenVolume": 5,
        "minConfidence": 0.6,
        "minTradeSize": 2
    }
}
```

## 🚦 Performance Benchmarks

### Excellent Performance (Target Goals)

- **Precision**: ≥ 0.85 (85%+ of signals are correct)
- **Recall**: ≥ 0.75 (Captures 75%+ of significant movements)
- **F1-Score**: ≥ 0.80 (Balanced performance)
- **Direction Accuracy**: ≥ 0.85 (85%+ correct direction prediction)

### Good Performance (Acceptable)

- **Precision**: ≥ 0.70
- **Recall**: ≥ 0.60
- **F1-Score**: ≥ 0.65
- **Direction Accuracy**: ≥ 0.75

### Poor Performance (Needs Optimization)

- **Precision**: < 0.60 (Too many false signals)
- **Recall**: < 0.50 (Missing too many movements)
- **F1-Score**: < 0.55 (Overall poor performance)

## 🔧 Troubleshooting

### Common Issues

**No data found error:**

```bash
# Ensure data files exist
ls backtesting_data/*.csv
# Should show both trades and depth files
```

**Out of memory error:**

```bash
# Reduce parallel tests
npx ts-node scripts/runBacktest.ts --parallel 1

# Increase speed multiplier
npx ts-node scripts/runBacktest.ts --speed 500
```

**TypeScript compilation errors:**

```bash
# Ensure dependencies are installed
yarn install

# Try building first
yarn build
```

**Test timeout errors:**

```bash
# Increase speed for faster testing
npx ts-node scripts/runBacktest.ts --speed 1000

# Test smaller date range
npx ts-node scripts/runBacktest.ts --start-date 2025-06-22 --end-date 2025-06-22
```

### Performance Optimization

**For Faster Testing:**

- Use `--speed 500` or higher
- Increase `--parallel 5` (if you have sufficient RAM)
- Use `--no-grid-search` for profile tests only
- Test specific `--detectors` instead of all

**For More Accurate Results:**

- Use lower `--speed 10-50` for realistic timing
- Include both profile and grid search configurations
- Test longer date ranges for statistical significance
- Use `--min-signals 25` to filter low-activity configs

## 📈 Interpreting Results

### High Precision, Low Recall

- **Meaning**: Detector is very selective, signals are usually correct but misses many opportunities
- **Use Case**: Conservative trading, avoid false entries
- **Optimization**: Lower thresholds to increase sensitivity

### High Recall, Low Precision

- **Meaning**: Detector catches most movements but generates many false signals
- **Use Case**: Don't want to miss any opportunities, can filter false signals
- **Optimization**: Raise thresholds to reduce noise

### Balanced F1-Score

- **Meaning**: Good overall performance with reasonable precision and recall
- **Use Case**: General trading, good balance of signal quality and coverage
- **Optimization**: Fine-tune parameters for specific market conditions

### High Direction Accuracy

- **Meaning**: When detector signals, it usually predicts direction correctly
- **Use Case**: Direction-based strategies, trend following
- **Note**: Can still have poor timing or too many/few signals

## 🎯 Next Steps

1. **Run Initial Tests**: Start with `node example_backtest.js`
2. **Analyze Results**: Review HTML dashboard and CSV exports
3. **Optimize Parameters**: Use best performing configurations from optimal_configurations.json
4. **Validate Performance**: Test on out-of-sample data
5. **Deploy Best Configs**: Update config.json with optimal parameters
6. **Monitor Live Performance**: Compare backtesting results with live trading performance

## 📚 Advanced Features

### Custom Configuration Testing

```typescript
// Add custom configuration ranges in configMatrix.ts
const customRanges = {
    hiddenOrderDetector: [
        { minHiddenVolume: 15, minConfidence: 0.85 },
        { minHiddenVolume: 25, minConfidence: 0.75 },
    ],
    // NEW: Threshold parameter testing for all detectors
    absorptionDetector: [
        { priceEfficiencyThreshold: 0.75, absorptionThreshold: 0.6 },
        { priceEfficiencyThreshold: 0.85, absorptionThreshold: 0.7 },
        { priceEfficiencyThreshold: 0.95, absorptionThreshold: 0.8 },
    ],
    exhaustionDetector: [
        { imbalanceHighThreshold: 0.8, spreadHighThreshold: 0.005 },
        { imbalanceHighThreshold: 0.9, spreadHighThreshold: 0.008 },
    ],
};
```

### Performance Metrics Extension

```typescript
// Add custom metrics in performanceAnalyzer.ts
interface CustomMetrics {
    avgSignalToMovementDelay: number;
    signalFrequency: number;
    marketImpactCorrelation: number;
}
```

This framework provides the scientific foundation for optimizing detector performance and building confidence in trading signal quality! 🚀

## 🔧 Threshold Configuration Enhancement (2025-06-23)

### Problem Solved: "No Signals at All" Issue

**Root Cause**: Hardcoded thresholds in detector implementations were blocking signal generation during backtesting, particularly `priceEfficiency < 0.7` in AbsorptionDetector.

**Solution**: Made all detector thresholds fully configurable through `config.json`:

### New Configurable Thresholds

**AbsorptionDetector** (`priceEfficiencyThreshold`):

```json
{
    "absorption": {
        "priceEfficiencyThreshold": 0.85, // Was hardcoded at 0.7
        "absorptionThreshold": 0.6
    }
}
```

**ExhaustionDetector** (scoring thresholds):

```json
{
    "exhaustion": {
        "imbalanceHighThreshold": 0.8, // Was hardcoded
        "imbalanceMediumThreshold": 0.6, // Was hardcoded
        "spreadHighThreshold": 0.005, // Was hardcoded
        "spreadMediumThreshold": 0.002 // Was hardcoded
    }
}
```

**DeltaCVDConfirmation** (correlation thresholds):

```json
{
    "deltaCvdConfirmation": {
        "strongCorrelationThreshold": 0.8, // Was hardcoded
        "weakCorrelationThreshold": 0.4, // Was hardcoded
        "depthImbalanceThreshold": 0.7 // Was hardcoded
    }
}
```

**AccumulationZoneDetector** (zone thresholds):

```json
{
    "zoneDetectors": {
        "LTCUSDT": {
            "accumulation": {
                "priceStabilityThreshold": 0.002, // Now configurable
                "strongZoneThreshold": 0.8, // Now configurable
                "weakZoneThreshold": 0.6 // Now configurable
            }
        }
    }
}
```

### Backtesting Benefits

1. **Systematic Threshold Testing**: Backtesting can now test different threshold combinations to find optimal values
2. **Grid Search Enhancement**: ConfigMatrix includes threshold parameters for comprehensive testing
3. **Signal Generation Recovery**: Previously blocked signals are now generated based on configurable parameters
4. **Production Deployment**: Optimal thresholds from backtesting can be directly deployed to `config.json`

### Testing Threshold Configurations

```bash
# Test different priceEfficiencyThreshold values for AbsorptionDetector
node run_hierarchical_backtest.js --detector absorptionDetector \
    --custom-config '{"priceEfficiencyThreshold": 0.75}'

# Test ExhaustionDetector with lower imbalance thresholds
node run_hierarchical_backtest.js --detector exhaustionDetector \
    --custom-config '{"imbalanceHighThreshold": 0.7, "imbalanceMediumThreshold": 0.5}'

# Grid search across multiple threshold values
npx ts-node scripts/runBacktest.ts --detectors absorptionDetector,exhaustionDetector --grid-points 5
```

This enhancement ensures that backtesting can find optimal threshold configurations and eliminates the "No Signals at all" issue that was caused by hardcoded parameters.
