#!/bin/bash

# start_absorption_optimization.sh
#
# 🎯 ABSORPTION DETECTOR OPTIMIZATION STARTER SCRIPT
# 
# This script runs the recommended optimization sequence for the AbsorptionDetector
# to find the best parameter settings for LTCUSDT trading.

set -e  # Exit on any error

echo "🎯 ABSORPTION DETECTOR OPTIMIZATION SEQUENCE"
echo "=============================================="
echo ""

# Check if backtest data exists
if [ ! -d "./backtesting_data" ]; then
    echo "❌ Error: ./backtesting_data directory not found!"
    echo "   Please ensure market data is available for backtesting."
    exit 1
fi

echo "📊 Data directory found: ./backtesting_data"
echo ""

# Create results directory
mkdir -p backtest_results/absorption_optimization
echo "📁 Results will be saved to: backtest_results/absorption_optimization/"
echo ""

# =================================================================
# STEP 1: QUICK BASELINE TEST
# =================================================================
echo "🚀 STEP 1: Quick Baseline Test (Current Production Settings)"
echo "-----------------------------------------------------------"
echo "Testing current production configuration for baseline performance..."

node run_hierarchical_backtest.js \
    --detector absorptionDetector \
    --speed 200 \
    --verbose \
    2>&1 | tee backtest_results/absorption_optimization/step1_baseline.log

echo "✅ Step 1 completed. Results in step1_baseline.log"
echo ""

# =================================================================
# STEP 2: TEST RECOMMENDED OPTIMIZATION PROFILES
# =================================================================
echo "🎯 STEP 2: Test Optimized Configurations"
echo "----------------------------------------"
echo "Testing 3 optimized configurations: sensitive, balanced, high-precision..."

# Test the main optimization profiles
echo "Testing balanced precision configuration..."
npx ts-node scripts/runBacktest.ts \
    --detectors absorptionDetector \
    --profiles balanced \
    --speed 150 \
    --verbose \
    2>&1 | tee backtest_results/absorption_optimization/step2_balanced.log

echo "Testing aggressive configuration..."
npx ts-node scripts/runBacktest.ts \
    --detectors absorptionDetector \
    --profiles aggressive \
    --speed 150 \
    --verbose \
    2>&1 | tee backtest_results/absorption_optimization/step2_aggressive.log

echo "Testing conservative configuration..."
npx ts-node scripts/runBacktest.ts \
    --detectors absorptionDetector \
    --profiles conservative \
    --speed 150 \
    --verbose \
    2>&1 | tee backtest_results/absorption_optimization/step2_conservative.log

echo "✅ Step 2 completed. Results in step2_*.log files"
echo ""

# =================================================================
# STEP 3: GRID SEARCH OPTIMIZATION
# =================================================================
echo "🔬 STEP 3: Grid Search Parameter Optimization"
echo "---------------------------------------------"
echo "Running comprehensive grid search to find optimal parameter combinations..."

npx ts-node scripts/runBacktest.ts \
    --detectors absorptionDetector \
    --grid-points 4 \
    --speed 100 \
    --parallel 1 \
    --verbose \
    2>&1 | tee backtest_results/absorption_optimization/step3_grid_search.log

echo "✅ Step 3 completed. Results in step3_grid_search.log"
echo ""

# =================================================================
# STEP 4: HIERARCHICAL REFINEMENT
# =================================================================
echo "🎯 STEP 4: Hierarchical Parameter Refinement"
echo "---------------------------------------------"
echo "Running 2-phase hierarchical optimization..."

echo "Phase 1: Testing major parameter ranges..."
node run_hierarchical_backtest.js \
    --detector absorptionDetector \
    --hierarchical \
    --phase 1 \
    --verbose \
    2>&1 | tee backtest_results/absorption_optimization/step4_phase1.log

echo "Phase 2: Fine-tuning based on Phase 1 results..."
node run_hierarchical_backtest.js \
    --detector absorptionDetector \
    --hierarchical \
    --phase 2 \
    --verbose \
    2>&1 | tee backtest_results/absorption_optimization/step4_phase2.log

echo "✅ Step 4 completed. Results in step4_phase*.log files"
echo ""

# =================================================================
# RESULTS SUMMARY
# =================================================================
echo "🏆 OPTIMIZATION COMPLETED!"
echo "=========================="
echo ""
echo "📊 Results Location:"
echo "  - All logs: backtest_results/absorption_optimization/"
echo "  - HTML Dashboard: backtest_results/backtesting_results.html"
echo "  - Performance CSV: backtest_results/performance_results.csv"
echo "  - Optimal Configs: backtest_results/optimal_configurations.json"
echo ""
echo "📈 Next Steps:"
echo "  1. Open backtest_results/backtesting_results.html in your browser"
echo "  2. Review performance metrics (Precision, Recall, F1-Score)"
echo "  3. Check optimal_configurations.json for best settings"
echo "  4. Update config.json with optimal parameters"
echo ""
echo "🎯 Key Metrics to Look For:"
echo "  - Precision: >70% (signal accuracy)"
echo "  - Recall: >60% (opportunity capture)"
echo "  - F1-Score: >65% (balanced performance)"
echo "  - Direction Accuracy: >65% (profitable signals)"
echo ""
echo "✅ Absorption Detector optimization sequence complete!"

# Optional: Open results in browser (macOS)
if command -v open &> /dev/null && [ -f "backtest_results/backtesting_results.html" ]; then
    echo ""
    echo "🌐 Opening results dashboard in browser..."
    open backtest_results/backtesting_results.html
fi