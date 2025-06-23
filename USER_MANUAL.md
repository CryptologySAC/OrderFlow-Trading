# 📖 Smart Hierarchical Backtesting Framework - User Manual

## 🎯 **Overview**

This advanced backtesting framework uses **smart hierarchical parameter optimization** to find the best detector settings for predicting 0.7%+ price movements. Instead of testing just a few configurations, it systematically explores the parameter space using a two-phase approach.

### 🚀 **Key Features**

- **🧠 Smart 2-Phase Testing**: Test major parameters first, then optimize minor parameters around best results
- **🎯 Single Detector Focus**: Test one detector thoroughly instead of many superficially
- **📊 Real-time Progress**: Live terminal feedback with ETA and completion status
- **📈 Comprehensive Analytics**: HTML dashboards, CSV exports, performance rankings
- **⚡ 42→167 Configuration Coverage**: Dramatically expanded parameter testing vs. basic 3 configs

---

## 🚀 **Quick Start Guide**

### 1. **Check Your Data**

```bash
# Ensure historical data exists
ls backtesting_data/
# Should show: LTCUSDT_*_trades.csv and LTCUSDT_*_depth.csv files
```

### 2. **Basic Test (3 configurations)**

```bash
npx ts-node scripts/runBacktest.ts --detector deltaCVDDetector
```

### 3. **Smart Hierarchical Test (42 configurations)**

```bash
# Use increased memory limit and garbage collection for large tests
node --max-old-space-size=8192 --expose-gc node_modules/.bin/ts-node scripts/runBacktest.ts --detector deltaCVDDetector --hierarchical --phase 1 --verbose
```

### 4. **View Results**

```bash
open backtest_results/backtesting_results.html
```

---

## 🧠 **Smart Hierarchical Testing**

### **What Makes It "Smart"?**

Traditional approaches test parameters randomly or use basic profiles. Our hierarchical approach:

1. **Phase 1**: Tests major parameters that have the biggest impact (e.g., `minZ`, `divergenceThreshold`)
2. **Phase 2**: Takes the best Phase 1 results and optimizes minor parameters around those optimal points

### **Why This Works Better**

- **Focused Search**: Concentrates computational resources on most promising parameter regions
- **Higher Success Rate**: Much more likely to find optimal settings than random search
- **Efficient**: Tests 167 total configurations vs. infinite random combinations
- **Scientific**: Based on parameter sensitivity analysis and optimization theory

---

## 🎛️ **Command Examples**

### **Phase 1: Major Parameter Exploration**

```bash
# Test 42 combinations of major DeltaCVD parameters
node --max-old-space-size=8192 --expose-gc node_modules/.bin/ts-node scripts/runBacktest.ts --detector deltaCVDDetector --hierarchical --phase 1 --verbose

# Test with maximum speed and real-time progress
node --max-old-space-size=8192 --expose-gc node_modules/.bin/ts-node scripts/runBacktest.ts --detector deltaCVDDetector --hierarchical --phase 1 --verbose --speed 1000

# Test Hidden Order detector with hierarchical approach
node --max-old-space-size=8192 --expose-gc node_modules/.bin/ts-node scripts/runBacktest.ts --detector hiddenOrderDetector --hierarchical --phase 1 --verbose
```

### **Phase 2: Minor Parameter Optimization**

```bash
# Optimize minor parameters around best Phase 1 results
node --max-old-space-size=8192 --expose-gc node_modules/.bin/ts-node scripts/runBacktest.ts --detector deltaCVDDetector --hierarchical --phase 2 --phase1-results ./backtest_results/rankings.csv --verbose

# Use specific Phase 1 results file
node --max-old-space-size=8192 --expose-gc node_modules/.bin/ts-node scripts/runBacktest.ts --detector deltaCVDDetector --hierarchical --phase 2 --phase1-results ./custom_phase1_results.csv
```

### **Standard Testing (Legacy Mode)**

```bash
# Test multiple detectors with basic configurations
npx ts-node scripts/runBacktest.ts --detectors deltaCVDDetector,hiddenOrderDetector

# Test with specific profiles
npx ts-node scripts/runBacktest.ts --profiles conservative --sort-by precision

# High-speed testing
npx ts-node scripts/runBacktest.ts --speed 1000 --parallel 5 --verbose
```

---

## 🔧 **Command Line Options**

### **🆕 Hierarchical Testing Options**

```
--detector <name>        Single detector to test (default: deltaCVDDetector)
                        Options: deltaCVDDetector, hiddenOrderDetector, icebergDetector,
                                spoofingDetector, absorptionDetector, exhaustionDetector

--hierarchical          Enable smart hierarchical testing (Phase 1 → Phase 2)
--phase <1|2>           Phase for hierarchical testing (default: 1)
--phase1-results <file> JSON file with Phase 1 results (required for Phase 2)
--verbose, -v           Show detailed real-time progress in terminal
```

### **📊 Standard Options**

```
--data-dir <path>        Data directory (default: ./backtesting_data)
--output-dir <path>      Output directory (default: ./backtest_results)
--symbol <symbol>        Trading symbol (default: LTCUSDT)
--speed <multiplier>     Speed multiplier 1-1000 (default: 100)
--parallel <count>       Parallel tests 1-10 (default: 3)
--start-date <date>      Start date YYYY-MM-DD (optional)
--end-date <date>        End date YYYY-MM-DD (optional)
--min-signals <count>    Minimum signals for analysis (optional)
--sort-by <metric>       Sort by: precision,recall,f1Score,accuracy,directionAccuracy
```

### **🔧 Legacy Options**

```
--detectors <list>       Comma-separated detector types (legacy multi-detector mode)
--profiles <list>        Comma-separated profiles: conservative,balanced,aggressive
--no-grid-search         Disable grid search (profile tests only)
--grid-points <count>    Grid search points (default: 4)
```

---

## 📊 **Parameter Coverage Comparison**

| Mode                | DeltaCVD Configs | Total Configs | Parameter Coverage               |
| ------------------- | ---------------- | ------------- | -------------------------------- |
| **Basic**           | 3                | 3             | ❌ Limited (predefined only)     |
| **Legacy Grid**     | 4                | ~30           | ⚠️ Random sampling               |
| **🆕 Hierarchical** | 42 + 125         | **167**       | ✅ **Smart systematic coverage** |

### **DeltaCVD Parameter Coverage**

**Phase 1 (Major Parameters):**

- `minZ`: [1.5, 2, 2.5, 3, 3.5, 4, 4.5] (7 values)
- `divergenceThreshold`: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6] (6 values)
- **Total**: 7 × 6 = **42 combinations**

**Phase 2 (Minor Parameters):**

- Takes top 5 Phase 1 results
- Tests 5×5 variations of `minTradesPerSec` and `minVolPerSec` around optimal points
- **Total**: 5 × 25 = **125 combinations**

**🎯 Result**: **167 total configurations** vs. previous **3 basic configs**

---

## 📈 **Understanding Results**

### **Performance Metrics (Per Configuration)**

```
True Positives:   Movements correctly predicted (signal → movement in right direction)
False Positives:  False signals (signal → no movement or wrong direction)
False Negatives:  Movements missed (movement → no preceding signal)

Precision:        True Positives / (True Positives + False Positives)
                 → "How accurate are the signals?"

Recall:          True Positives / (True Positives + False Negatives)
                 → "How many movements did we catch?"

F1-Score:        2 × (Precision × Recall) / (Precision + Recall)
                 → "Overall balanced performance"

Direction Accuracy: % of signals with correct direction (buy→up, sell→down)
```

### **Performance Benchmarks**

| Level             | Precision | Recall | F1-Score | Direction Accuracy |
| ----------------- | --------- | ------ | -------- | ------------------ |
| **🏆 Excellent**  | ≥85%      | ≥75%   | ≥80%     | ≥85%               |
| **✅ Good**       | ≥70%      | ≥60%   | ≥65%     | ≥75%               |
| **⚠️ Needs Work** | <60%      | <50%   | <55%     | <65%               |

---

## 📁 **Output Files**

### **🎨 Interactive Dashboard**

- **`backtesting_results.html`**: Beautiful interactive dashboard with charts and rankings

### **📊 CSV Exports**

- **`performance_results.csv`**: Detailed metrics for every configuration tested
- **`rankings.csv`**: Performance rankings sorted by F1-score (or chosen metric)
- **`test_results.csv`**: Test execution details and timing information

### **⚙️ Configuration Files**

- **`optimal_configurations.json`**: Best performing parameters for each detector
- **`performance_summary.md`**: Markdown report with insights and recommendations

---

## 🔍 **Available Detectors**

### **📊 Order Flow Analysis**

```
deltaCVDDetector         Cumulative volume delta confirmation signals
absorptionDetector       Large order absorption at key levels
exhaustionDetector       Liquidity exhaustion patterns
```

### **🕵️ Market Manipulation Detection**

```
hiddenOrderDetector      Market orders vs. invisible liquidity
icebergDetector         Large orders broken into smaller pieces
spoofingDetector        Fake walls and ghost liquidity manipulation
```

### **🎯 Zone-Based Analysis**

```
accumulationDetector     Smart money accumulation zones
distributionDetector     Institutional distribution patterns
supportResistanceDetector Key price level detection
```

---

## 🛠️ **Troubleshooting**

### **Common Issues**

**❌ "Cannot read properties of undefined"**

```bash
# Framework initialization issue - this is now fixed
# Use --no-check flag if TypeScript issues persist
npx ts-node --transpile-only scripts/runBacktest.ts
```

**❌ "No data found"**

```bash
# Check data directory
ls backtesting_data/*.csv
# Ensure both trades and depth files exist
```

**❌ "Speed multiplier must be between 1 and 1000"**

```bash
# Use valid speed range
npx ts-node scripts/runBacktest.ts --speed 1000  # Maximum allowed
```

**❌ "Out of memory" or slow performance**

```bash
# Use increased memory limit (8GB) with garbage collection
node --max-old-space-size=8192 --expose-gc node_modules/.bin/ts-node scripts/runBacktest.ts --detector deltaCVDDetector --hierarchical --phase 1 --verbose

# Alternative: Use smaller memory footprint (reduce parallel testing)
node --max-old-space-size=4096 --expose-gc node_modules/.bin/ts-node scripts/runBacktest.ts --parallel 1

# Increase speed for faster processing
node --max-old-space-size=8192 --expose-gc node_modules/.bin/ts-node scripts/runBacktest.ts --speed 1000

# Test smaller date range
node --max-old-space-size=8192 --expose-gc node_modules/.bin/ts-node scripts/runBacktest.ts --start-date 2025-06-22 --end-date 2025-06-22
```

### **Performance Optimization**

**⚡ For Faster Testing:**

- Use `--speed 1000` (maximum)
- Use `--parallel 1` (reduces memory usage)
- Use `node --max-old-space-size=8192 --expose-gc` for memory management
- Use `--verbose` to see real-time progress
- Focus on single detector with `--detector`

**🎯 For Better Results:**

- Use lower speed `--speed 100` for realistic timing
- Test full Phase 1 then Phase 2 sequence
- Use longer date ranges when available
- Allow tests to complete fully (they can take time)

---

## 📚 **Workflow Examples**

### **🎯 Complete DeltaCVD Optimization Workflow**

```bash
# Step 1: Phase 1 - Test major parameters (42 configs)
node --max-old-space-size=8192 --expose-gc node_modules/.bin/ts-node scripts/runBacktest.ts --detector deltaCVDDetector --hierarchical --phase 1 --verbose --speed 1000

# Step 2: Review Phase 1 results
open backtest_results/backtesting_results.html

# Step 3: Phase 2 - Optimize minor parameters around best results (125 configs)
node --max-old-space-size=8192 --expose-gc node_modules/.bin/ts-node scripts/runBacktest.ts --detector deltaCVDDetector --hierarchical --phase 2 --phase1-results ./backtest_results/rankings.csv --verbose

# Step 4: Review final optimized results
open backtest_results/backtesting_results.html
cat backtest_results/optimal_configurations.json
```

### **🔍 Multi-Detector Comparison Workflow**

```bash
# Test each detector's best hierarchical configuration
node --max-old-space-size=8192 --expose-gc node_modules/.bin/ts-node scripts/runBacktest.ts --detector deltaCVDDetector --hierarchical --phase 1 --verbose
node --max-old-space-size=8192 --expose-gc node_modules/.bin/ts-node scripts/runBacktest.ts --detector hiddenOrderDetector --hierarchical --phase 1 --verbose
node --max-old-space-size=8192 --expose-gc node_modules/.bin/ts-node scripts/runBacktest.ts --detector icebergDetector --hierarchical --phase 1 --verbose

# Compare results across detectors
# (Results are in separate runs - compare optimal_configurations.json files)
```

### **⚡ Quick Testing Workflow**

```bash
# Fast basic test to validate framework
node --max-old-space-size=4096 --expose-gc node_modules/.bin/ts-node scripts/runBacktest.ts --detector deltaCVDDetector --speed 1000 --parallel 1

# View results quickly
open backtest_results/backtesting_results.html
```

---

## 🎯 **Best Practices**

### **🔬 Testing Strategy**

1. **Start with Phase 1** to identify promising parameter regions
2. **Always use --verbose** to monitor progress and catch issues early
3. **Use single detector focus** for thorough optimization
4. **Complete full Phase 1 → Phase 2 cycle** for each detector of interest
5. **Test with realistic speed** (100-500) for final validation

### **📊 Results Analysis**

1. **Focus on F1-Score** for balanced performance ranking
2. **Check direction accuracy** for signal quality assessment
3. **Review precision vs. recall trade-offs** based on trading strategy
4. **Use optimal configurations** from `optimal_configurations.json`
5. **Validate with out-of-sample data** when possible

### **⚙️ Performance Tips**

1. **Use Phase 2 only after Phase 1** - it requires Phase 1 results
2. **Monitor memory usage** - reduce parallel tests if needed
3. **Let tests complete fully** - interrupting loses all progress
4. **Save Phase 1 results** before running Phase 2
5. **Use descriptive output directories** for organized testing

---

## 🎉 **Success Metrics**

You'll know the framework is working well when you see:

✅ **Framework Execution**: Tests complete without errors, progress updates show real-time status  
✅ **Data Processing**: 279K+ market events processed successfully  
✅ **Parameter Coverage**: 42 Phase 1 + 125 Phase 2 = 167 total configurations tested  
✅ **Results Generation**: HTML dashboard, CSV files, and performance rankings created  
✅ **Optimization Success**: Clear performance differences between configurations, optimal parameters identified

---

## 🚀 **Next Steps**

1. **✅ Run Your First Test**: Start with basic DeltaCVD test to validate setup
2. **📊 Explore Hierarchical Testing**: Try Phase 1 testing with verbose output
3. **🎯 Optimize Parameters**: Complete Phase 1 → Phase 2 cycle
4. **📈 Analyze Results**: Review performance rankings and optimal configurations
5. **🔧 Deploy Best Configs**: Update your trading system with optimized parameters
6. **📊 Monitor Live Performance**: Compare backtesting results with live trading performance

The smart hierarchical backtesting framework gives you dramatically better chances of finding optimal detector parameters for predicting 0.7%+ price movements! 🎯

---

_Generated with Claude Code - Smart Trading System Optimization_ 🤖
