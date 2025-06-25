#!/bin/bash

# quick_test_absorption_turning_points.sh
#
# 🎯 QUICK TEST: AbsorptionDetector Turning Point Optimization
# 
# Tests the most promising configuration for detecting 0.7%+ turning points

echo "🎯 QUICK TEST: AbsorptionDetector Turning Point Detection"
echo "========================================================"
echo ""
echo "Goal: Detect local tops/bottoms → 0.7%+ movement"
echo "Strategy: Test optimized core parameters"
echo ""

# Check if backtest data exists
if [ ! -d "./backtesting_data" ]; then
    echo "❌ Error: ./backtesting_data directory not found!"
    echo "   Please ensure market data is available for backtesting."
    exit 1
fi

# Create results directory
mkdir -p backtest_results/turning_point_test
echo "📁 Results: backtest_results/turning_point_test/"
echo ""

# =================================================================
# QUICK TEST: Core Parameter Grid for 0.7%+ Moves
# =================================================================
echo "🔬 Testing Core Parameters for 0.7%+ Turning Point Detection"
echo "------------------------------------------------------------"
echo "Parameters:"
echo "  • zoneTicks: [2, 3, 4] (tight to medium zones)"
echo "  • windowMs: [45000, 60000] (45-60s response time)"  
echo "  • minAggVolume: [20, 30, 40] (sensitive to moderate volume)"
echo ""
echo "Expected: ~24 configurations (2×3×3)"
echo ""

# Try the compiled JS version first, fallback to ts-node
echo "Attempting to use compiled JavaScript version..."
if node run_hierarchical_backtest.js --detector absorptionDetector --speed 150 --verbose --dry-run >/dev/null 2>&1; then
    echo "✅ Using compiled JS version (faster)"
    node run_hierarchical_backtest.js \
        --detector absorptionDetector \
        --speed 150 \
        --verbose \
        2>&1 | tee backtest_results/turning_point_test/core_parameters.log
else
    echo "⚠️  Compiled version issue, building first..."
    echo "Building TypeScript..."
    yarn build
    
    echo "Running core parameter grid search..."
    npx ts-node scripts/runBacktest.ts \
        --detectors absorptionDetector \
        --custom-grid '{"zoneTicks":[2,3,4],"windowMs":[45000,60000],"minAggVolume":[20,30,40]}' \
        --speed 150 \
        --parallel 1 \
        --verbose \
        2>&1 | tee backtest_results/turning_point_test/core_parameters.log
fi

echo ""
echo "✅ Core parameter test completed!"
echo ""

# =================================================================
# RESULTS SUMMARY
# =================================================================
echo "📊 RESULTS ANALYSIS"
echo "==================="
echo ""
echo "📁 Log File: backtest_results/turning_point_test/core_parameters.log"
echo "🌐 Dashboard: backtest_results/backtesting_results.html"
echo "📈 CSV Data: backtest_results/performance_results.csv"
echo ""
echo "🎯 Look for configurations with:"
echo "  • High Detection Rate (>60% of 0.7%+ moves)"
echo "  • Low False Signal Rate (<40%)"
echo "  • Good Precision (>65%)"
echo "  • Balanced F1-Score (>60%)"
echo ""
echo "📝 Next Steps:"
echo "  1. Review results in HTML dashboard"
echo "  2. Identify top 3-5 performing configurations"  
echo "  3. Run Phase 2 refinement on winners"
echo "  4. Update config.json with optimal settings"
echo ""

# Optional: Open results in browser (macOS)
if command -v open &> /dev/null && [ -f "backtest_results/backtesting_results.html" ]; then
    echo "🌐 Opening results dashboard..."
    open backtest_results/backtesting_results.html
    echo ""
fi

echo "🎯 Quick turning point test complete!"
echo ""
echo "🔬 For comprehensive optimization, run:"
echo "   ./start_absorption_optimization.sh"