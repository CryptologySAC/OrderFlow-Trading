// absorption_optimization_configs.js
//
// 🎯 OPTIMAL ABSORPTION DETECTOR CONFIGURATIONS FOR BACKTESTING
//
// Based on analysis of current config.json, CLAUDE.md compliance, and
// backtesting framework capabilities. These configurations are optimized
// for LTCUSDT trading with institutional-grade parameters.

const ABSORPTION_OPTIMIZATION_CONFIGS = {
    // =================================================================
    // 🚀 RECOMMENDED START CONFIGURATIONS (Best Performance Expected)
    // =================================================================

    /**
     * PRODUCTION BASELINE - Current live configuration
     * Use this as baseline for comparison with optimizations
     */
    production_baseline: {
        description: "Current production configuration from config.json",
        config: {
            minAggVolume: 40,
            windowMs: 60000,
            pricePrecision: 2,
            zoneTicks: 3,
            eventCooldownMs: 15000,

            absorptionThreshold: 0.6,
            minPassiveMultiplier: 1.2,
            maxAbsorptionRatio: 0.4,

            strongAbsorptionRatio: 0.6,
            moderateAbsorptionRatio: 0.8,
            weakAbsorptionRatio: 1.0,

            priceEfficiencyThreshold: 0.02,
            spreadImpactThreshold: 0.003,
            velocityIncreaseThreshold: 1.5,
            significantChangeThreshold: 0.1,

            features: {
                adaptiveZone: true,
                passiveHistory: true,
                multiZone: false,
                liquidityGradient: true,
                absorptionVelocity: false,
                layeredAbsorption: false,
                spreadImpact: true,
            },
        },
    },

    /**
     * SENSITIVE DETECTION - Optimized for early signal detection
     * Lower thresholds for catching more absorption events
     */
    sensitive_optimized: {
        description: "Sensitive detection for early absorption signals",
        config: {
            minAggVolume: 25, // Lower than production (40) for more signals
            windowMs: 45000, // Shorter window for faster response
            absorptionThreshold: 0.45, // Much lower than production (0.6)
            minPassiveMultiplier: 1.1, // Lower than production (1.2)
            maxAbsorptionRatio: 0.6, // Higher than production (0.4)

            // More sensitive absorption levels
            strongAbsorptionRatio: 0.4,
            moderateAbsorptionRatio: 0.6,
            weakAbsorptionRatio: 0.8,

            priceEfficiencyThreshold: 0.015, // Lower than production (0.02)
            spreadImpactThreshold: 0.002, // Lower sensitivity
            velocityIncreaseThreshold: 1.2, // Lower than production (1.5)

            eventCooldownMs: 8000, // Shorter cooldown for more signals
        },
    },

    /**
     * BALANCED PRECISION - Optimized balance of sensitivity and accuracy
     * Best starting point for most scenarios
     */
    balanced_precision: {
        description: "Balanced precision for optimal signal quality",
        config: {
            minAggVolume: 35, // Slightly lower than production
            windowMs: 50000, // Optimized window size
            absorptionThreshold: 0.55, // Slightly lower than production
            minPassiveMultiplier: 1.3, // Slightly higher for quality
            maxAbsorptionRatio: 0.5, // Balanced ratio

            // Balanced absorption levels
            strongAbsorptionRatio: 0.5,
            moderateAbsorptionRatio: 0.7,
            weakAbsorptionRatio: 0.9,

            priceEfficiencyThreshold: 0.018,
            spreadImpactThreshold: 0.0025,
            velocityIncreaseThreshold: 1.3,

            eventCooldownMs: 12000,
        },
    },

    /**
     * HIGH PRECISION - Conservative settings for high-quality signals
     * Lower false positives but may miss some opportunities
     */
    high_precision: {
        description: "High precision for institutional-grade signal quality",
        config: {
            minAggVolume: 60, // Higher than production for quality
            windowMs: 75000, // Longer analysis window
            absorptionThreshold: 0.75, // Higher than production for quality
            minPassiveMultiplier: 1.8, // Much higher for strong absorption
            maxAbsorptionRatio: 0.3, // Lower for stricter criteria

            // Conservative absorption levels
            strongAbsorptionRatio: 0.7,
            moderateAbsorptionRatio: 0.85,
            weakAbsorptionRatio: 1.0,

            priceEfficiencyThreshold: 0.025,
            spreadImpactThreshold: 0.004,
            velocityIncreaseThreshold: 1.8,

            eventCooldownMs: 20000, // Longer cooldown for quality
        },
    },

    // =================================================================
    // 🔬 EXPERIMENTAL CONFIGURATIONS (Advanced Testing)
    // =================================================================

    /**
     * VELOCITY FOCUSED - Emphasizes absorption velocity detection
     */
    velocity_focused: {
        description: "Velocity-focused absorption detection",
        config: {
            minAggVolume: 30,
            absorptionThreshold: 0.5,
            minPassiveMultiplier: 1.4,
            velocityIncreaseThreshold: 1.1, // Very sensitive to velocity

            features: {
                adaptiveZone: true,
                passiveHistory: true,
                absorptionVelocity: true, // Enable velocity feature
                liquidityGradient: true,
                spreadImpact: false, // Focus on velocity
            },
        },
    },

    /**
     * LIQUIDITY GRADIENT - Emphasizes liquidity analysis
     */
    liquidity_focused: {
        description: "Liquidity gradient focused detection",
        config: {
            minAggVolume: 40,
            absorptionThreshold: 0.6,
            minPassiveMultiplier: 1.5,

            features: {
                adaptiveZone: true,
                passiveHistory: true,
                liquidityGradient: true,
                layeredAbsorption: true, // Enable layered analysis
                spreadImpact: true,
                absorptionVelocity: false,
            },
        },
    },

    /**
     * MULTI-ZONE - Enable multi-zone analysis
     */
    multi_zone: {
        description: "Multi-zone absorption analysis",
        config: {
            minAggVolume: 35,
            absorptionThreshold: 0.55,
            minPassiveMultiplier: 1.3,

            features: {
                adaptiveZone: true,
                passiveHistory: true,
                multiZone: true, // Enable multi-zone
                liquidityGradient: true,
                spreadImpact: true,
                absorptionVelocity: false,
                layeredAbsorption: false,
            },
        },
    },
};

// =================================================================
// 🎯 BACKTESTING COMMAND GENERATOR
// =================================================================

/**
 * Generate backtest commands for all configurations
 */
function generateBacktestCommands() {
    const commands = [];

    // Basic single configuration tests
    Object.keys(ABSORPTION_OPTIMIZATION_CONFIGS).forEach((configName) => {
        commands.push({
            name: `Test ${configName}`,
            command: `node run_hierarchical_backtest.js --detector absorptionDetector --config-profile ${configName} --verbose`,
        });
    });

    // Comprehensive grid search
    commands.push({
        name: "Comprehensive Grid Search",
        command: `npx ts-node scripts/runBacktest.ts --detectors absorptionDetector --grid-points 6 --speed 100 --verbose`,
    });

    // Hierarchical testing (Phase 1 & 2)
    commands.push({
        name: "Hierarchical Phase 1",
        command: `node run_hierarchical_backtest.js --detector absorptionDetector --hierarchical --phase 1 --verbose`,
    });

    commands.push({
        name: "Hierarchical Phase 2",
        command: `node run_hierarchical_backtest.js --detector absorptionDetector --hierarchical --phase 2 --verbose`,
    });

    // Profile-based testing
    commands.push({
        name: "All Profile Tests",
        command: `npx ts-node scripts/runBacktest.ts --detectors absorptionDetector --profiles conservative,balanced,aggressive,custom --verbose`,
    });

    return commands;
}

// =================================================================
// 🏆 RECOMMENDED TESTING SEQUENCE
// =================================================================

const RECOMMENDED_SEQUENCE = {
    step1: {
        name: "Quick Baseline Test",
        command:
            "node run_hierarchical_backtest.js --detector absorptionDetector --speed 200 --verbose",
        purpose: "Establish baseline performance with current settings",
    },

    step2: {
        name: "Test Optimized Configs",
        configs: [
            "sensitive_optimized",
            "balanced_precision",
            "high_precision",
        ],
        purpose: "Test the three main optimization approaches",
    },

    step3: {
        name: "Grid Search Optimization",
        command:
            "npx ts-node scripts/runBacktest.ts --detectors absorptionDetector --grid-points 4 --speed 100",
        purpose: "Find optimal parameter combinations",
    },

    step4: {
        name: "Hierarchical Refinement",
        commands: [
            "node run_hierarchical_backtest.js --detector absorptionDetector --hierarchical --phase 1",
            "node run_hierarchical_backtest.js --detector absorptionDetector --hierarchical --phase 2",
        ],
        purpose: "Fine-tune based on Phase 1 results",
    },

    step5: {
        name: "Feature Testing",
        configs: ["velocity_focused", "liquidity_focused", "multi_zone"],
        purpose: "Test advanced feature combinations",
    },
};

// =================================================================
// 🎯 OPTIMAL STARTING PARAMETERS (RECOMMENDATION)
// =================================================================

const OPTIMAL_START_PARAMS = {
    // Based on analysis of production config and backtesting framework
    recommended: {
        minAggVolume: 30, // Lower than production for more opportunities
        absorptionThreshold: 0.55, // Slightly lower for better sensitivity
        minPassiveMultiplier: 1.3, // Balanced requirement for absorption
        maxAbsorptionRatio: 0.5, // Balanced ratio
        priceEfficiencyThreshold: 0.018, // Slightly more sensitive
        eventCooldownMs: 12000, // Balanced cooldown

        // Key parameter ranges for optimization
        optimization_ranges: {
            minAggVolume: [20, 25, 30, 35, 40, 50],
            absorptionThreshold: [0.45, 0.5, 0.55, 0.6, 0.65, 0.7],
            minPassiveMultiplier: [1.1, 1.2, 1.3, 1.4, 1.5, 1.8],
            eventCooldownMs: [8000, 10000, 12000, 15000, 20000],
            priceEfficiencyThreshold: [0.015, 0.018, 0.02, 0.025, 0.03],
        },
    },
};

module.exports = {
    ABSORPTION_OPTIMIZATION_CONFIGS,
    generateBacktestCommands,
    RECOMMENDED_SEQUENCE,
    OPTIMAL_START_PARAMS,
};

// =================================================================
// 📋 USAGE EXAMPLES
// =================================================================

console.log(`
🎯 ABSORPTION DETECTOR OPTIMIZATION GUIDE

📊 QUICK START (Recommended):
1. Baseline Test:
   node run_hierarchical_backtest.js --detector absorptionDetector --speed 200 --verbose

2. Test Best Configs:
   # Sensitive (more signals)
   node run_hierarchical_backtest.js --detector absorptionDetector --config balanced_precision
   
   # Balanced (recommended start)  
   node run_hierarchical_backtest.js --detector absorptionDetector --config balanced_precision
   
   # High Quality (fewer but better signals)
   node run_hierarchical_backtest.js --detector absorptionDetector --config high_precision

3. Full Optimization:
   npx ts-node scripts/runBacktest.ts --detectors absorptionDetector --grid-points 4 --verbose

📈 RESULTS ANALYSIS:
- Check: backtest_results/backtesting_results.html
- CSV Data: backtest_results/performance_results.csv  
- Optimal Settings: backtest_results/optimal_configurations.json

🎯 KEY METRICS TO WATCH:
- Precision: >70% for quality signals
- Recall: >60% for sufficient coverage  
- F1-Score: >65% for balanced performance
- Direction Accuracy: >65% for profitable signals

🔧 PARAMETER PRIORITIES:
1. absorptionThreshold: Most impact on signal frequency
2. minAggVolume: Controls minimum trade size requirements
3. minPassiveMultiplier: Quality of absorption detection
4. priceEfficiencyThreshold: Price movement sensitivity
5. eventCooldownMs: Signal frequency control
`);
