// absorption_turning_point_optimization.js
//
// 🎯 ABSORPTION DETECTOR TURNING POINT OPTIMIZATION
//
// Optimized for detecting local tops/bottoms that lead to 0.7%+ movements
// Focus: Maximum detection rate with minimum false signals

const TURNING_POINT_OPTIMIZATION = {
    // =================================================================
    // 🎯 PHASE 1: CORE PARAMETERS (Most Influential)
    // =================================================================

    /**
     * PHASE 1 FOCUS: Zone Size, Time Window, Min Aggressive Volume
     * These are the most influential parameters for turning point detection
     */
    phase1_core_parameters: {
        description:
            "Phase 1: Core parameters that most influence turning point detection",

        // Zone Size (zoneTicks) - Critical for absorption detection granularity
        zoneTicks_ranges: {
            // Smaller zones = more granular detection, larger zones = broader patterns
            micro_zones: [1, 2], // Very tight zones for precise turning points
            tight_zones: [3, 4], // Current production (3) + slightly wider
            medium_zones: [5, 6], // Medium granularity for major levels
            broad_zones: [8, 10], // Broad zones for major institutional levels

            reasoning: `
            - 1-2 ticks: Catch micro-reversals, high sensitivity
            - 3-4 ticks: Balanced (current=3), good for 0.7%+ moves  
            - 5-6 ticks: Major support/resistance levels
            - 8-10 ticks: Institutional-level absorption zones
            `,
        },

        // Time Window (windowMs) - Critical for pattern formation timeframe
        windowMs_ranges: {
            // Shorter windows = faster signals, longer windows = more context
            fast_response: [30000, 45000], // 30-45s: Quick turning points
            balanced: [60000, 75000], // 60-75s: Current production (60s) + extended
            comprehensive: [90000, 120000], // 90-120s: Full pattern development
            extended: [150000, 180000], // 150-180s: Major trend analysis

            reasoning: `
            - 30-45s: Fast reaction to absorption, catch quick reversals
            - 60-75s: Balanced timeframe for 0.7%+ moves (current=60s)
            - 90-120s: Allow full absorption patterns to develop
            - 150-180s: Major institutional absorption timeframes
            `,
        },

        // Min Aggressive Volume (minAggVolume) - Critical for signal significance
        minAggVolume_ranges: {
            // Lower volume = more signals, higher volume = higher quality
            sensitive: [15, 25], // Very sensitive, catch smaller absorption
            moderate: [30, 40], // Current production (40) and slightly lower
            selective: [50, 75], // More selective, higher quality signals
            institutional: [100, 150], // Large volume, institutional-level absorption

            reasoning: `
            - 15-25: Catch smaller absorption events, more signals
            - 30-40: Balanced sensitivity (current=40)
            - 50-75: Higher quality, fewer false signals
            - 100-150: Only major institutional absorption events
            `,
        },
    },

    // =================================================================
    // 📊 PHASE 1 GRID COMBINATIONS (Strategic Testing)
    // =================================================================

    phase1_strategic_grids: [
        // Strategy 1: High Sensitivity for 0.7%+ Moves
        {
            name: "high_sensitivity_07_percent",
            description:
                "Optimized to catch 0.7%+ turning points with high detection rate",
            zoneTicks: [2, 3, 4], // Tight to medium zones
            windowMs: [45000, 60000], // Fast to balanced response
            minAggVolume: [20, 30, 40], // Sensitive to moderate volume
            priority: "maximize_detection_rate",
        },

        // Strategy 2: Balanced Quality vs Quantity
        {
            name: "balanced_quality_07_percent",
            description:
                "Balance between detection rate and false signal reduction",
            zoneTicks: [3, 4, 5], // Balanced zone sizes
            windowMs: [60000, 75000], // Balanced to comprehensive
            minAggVolume: [30, 40, 50], // Moderate to selective
            priority: "optimize_precision_recall",
        },

        // Strategy 3: High Precision (Fewer False Signals)
        {
            name: "high_precision_07_percent",
            description:
                "Minimize false signals while maintaining 0.7%+ detection",
            zoneTicks: [4, 5, 6], // Medium to broad zones
            windowMs: [75000, 90000], // Comprehensive analysis
            minAggVolume: [40, 60, 80], // Selective to institutional
            priority: "minimize_false_signals",
        },

        // Strategy 4: Institutional Level Detection
        {
            name: "institutional_07_percent",
            description:
                "Focus on major institutional absorption for significant moves",
            zoneTicks: [6, 8, 10], // Broad institutional zones
            windowMs: [90000, 120000], // Extended pattern analysis
            minAggVolume: [75, 100, 150], // Large institutional volume
            priority: "major_turning_points_only",
        },
    ],

    // =================================================================
    // 🔬 PHASE 2: REFINEMENT PARAMETERS (False Signal Filtering)
    // =================================================================

    /**
     * PHASE 2: Fine-tune based on Phase 1 winners
     * Focus on filtering false signals while maintaining detection rate
     */
    phase2_refinement_parameters: {
        description:
            "Phase 2: Refine best Phase 1 configs to filter false signals",

        // Absorption Quality Filters
        absorption_quality: {
            absorptionThreshold: [0.45, 0.55, 0.65, 0.75], // Lower = more signals
            minPassiveMultiplier: [1.1, 1.3, 1.5, 1.8], // Higher = stricter absorption
            maxAbsorptionRatio: [0.4, 0.5, 0.6, 0.7], // Higher = allow more aggressive
        },

        // Price Movement Validation
        price_efficiency: {
            priceEfficiencyThreshold: [0.01, 0.015, 0.02, 0.025], // Lower = more sensitive to price impact
            velocityIncreaseThreshold: [1.2, 1.5, 1.8, 2.0], // Higher = require stronger acceleration
        },

        // Signal Timing & Filtering
        signal_filtering: {
            eventCooldownMs: [5000, 10000, 15000, 20000], // Longer = fewer duplicate signals
            spreadImpactThreshold: [0.002, 0.003, 0.004, 0.005], // Market impact sensitivity
        },

        // Absorption Classification (for signal strength)
        absorption_levels: {
            strongAbsorptionRatio: [0.4, 0.5, 0.6, 0.7],
            moderateAbsorptionRatio: [0.6, 0.7, 0.8, 0.9],
            weakAbsorptionRatio: [0.8, 0.9, 1.0, 1.1],
        },
    },

    // =================================================================
    // 🚀 RECOMMENDED START CONFIGURATIONS
    // =================================================================

    recommended_start_configs: {
        // Best starting point based on 0.7%+ movement goal
        turning_point_optimized: {
            description:
                "Optimized specifically for 0.7%+ turning point detection",
            config: {
                // Phase 1 core parameters (estimated optimal)
                zoneTicks: 3, // Balanced granularity (current production)
                windowMs: 45000, // Faster response than production (60s)
                minAggVolume: 25, // More sensitive than production (40)

                // Phase 2 refinement (estimated optimal for false signal reduction)
                absorptionThreshold: 0.55, // Slightly lower than production (0.6)
                minPassiveMultiplier: 1.4, // Higher than production (1.2) for quality
                maxAbsorptionRatio: 0.5, // Higher than production (0.4) for more signals
                priceEfficiencyThreshold: 0.015, // More sensitive than production (0.02)
                eventCooldownMs: 10000, // Shorter than production (15s) for more signals

                // Keep production values for other parameters
                pricePrecision: 2,
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

        // Alternative: Higher precision, fewer signals
        precision_focused: {
            description:
                "Higher precision for 0.7%+ moves, fewer false signals",
            config: {
                zoneTicks: 4, // Slightly broader zones
                windowMs: 60000, // Current production timing
                minAggVolume: 40, // Current production volume

                absorptionThreshold: 0.65, // Higher quality threshold
                minPassiveMultiplier: 1.6, // Stricter absorption requirement
                maxAbsorptionRatio: 0.4, // Current production ratio
                priceEfficiencyThreshold: 0.02, // Current production sensitivity
                eventCooldownMs: 15000, // Current production cooldown
            },
        },

        // Alternative: Maximum sensitivity for catching more opportunities
        sensitivity_focused: {
            description:
                "Maximum sensitivity to catch more 0.7%+ opportunities",
            config: {
                zoneTicks: 2, // Tighter zones for precision
                windowMs: 30000, // Faster response
                minAggVolume: 20, // Lower volume threshold

                absorptionThreshold: 0.45, // Lower threshold for more signals
                minPassiveMultiplier: 1.2, // Current production requirement
                maxAbsorptionRatio: 0.6, // Allow more aggressive absorption
                priceEfficiencyThreshold: 0.01, // Very sensitive to price impact
                eventCooldownMs: 8000, // Shorter cooldown
            },
        },
    },
};

// =================================================================
// 🎯 BACKTESTING COMMANDS FOR TURNING POINT OPTIMIZATION
// =================================================================

const TURNING_POINT_COMMANDS = {
    // Phase 1: Test core parameter combinations
    phase1_commands: [
        {
            name: "Phase 1: High Sensitivity Grid",
            command: `npx ts-node scripts/runBacktest.ts --detectors absorptionDetector --custom-grid '{"zoneTicks":[2,3,4],"windowMs":[45000,60000],"minAggVolume":[20,30,40]}' --speed 100 --verbose`,
        },
        {
            name: "Phase 1: Balanced Quality Grid",
            command: `npx ts-node scripts/runBacktest.ts --detectors absorptionDetector --custom-grid '{"zoneTicks":[3,4,5],"windowMs":[60000,75000],"minAggVolume":[30,40,50]}' --speed 100 --verbose`,
        },
        {
            name: "Phase 1: High Precision Grid",
            command: `npx ts-node scripts/runBacktest.ts --detectors absorptionDetector --custom-grid '{"zoneTicks":[4,5,6],"windowMs":[75000,90000],"minAggVolume":[40,60,80]}' --speed 100 --verbose`,
        },
    ],

    // Phase 2: Refine best Phase 1 results
    phase2_commands: [
        {
            name: "Phase 2: Absorption Quality Refinement",
            command: `npx ts-node scripts/runBacktest.ts --detectors absorptionDetector --custom-grid '{"absorptionThreshold":[0.45,0.55,0.65],"minPassiveMultiplier":[1.1,1.3,1.5],"maxAbsorptionRatio":[0.4,0.5,0.6]}' --speed 100 --verbose`,
        },
        {
            name: "Phase 2: Price Efficiency Refinement",
            command: `npx ts-node scripts/runBacktest.ts --detectors absorptionDetector --custom-grid '{"priceEfficiencyThreshold":[0.01,0.015,0.02],"velocityIncreaseThreshold":[1.2,1.5,1.8],"eventCooldownMs":[8000,12000,16000]}' --speed 100 --verbose`,
        },
    ],

    // Quick test of recommended configurations
    recommended_tests: [
        {
            name: "Test Turning Point Optimized Config",
            command: `node run_hierarchical_backtest.js --detector absorptionDetector --config turning_point_optimized --speed 200 --verbose`,
        },
        {
            name: "Test Precision Focused Config",
            command: `node run_hierarchical_backtest.js --detector absorptionDetector --config precision_focused --speed 200 --verbose`,
        },
        {
            name: "Test Sensitivity Focused Config",
            command: `node run_hierarchical_backtest.js --detector absorptionDetector --config sensitivity_focused --speed 200 --verbose`,
        },
    ],
};

module.exports = {
    TURNING_POINT_OPTIMIZATION,
    TURNING_POINT_COMMANDS,
};

// =================================================================
// 📋 USAGE GUIDE FOR 0.7%+ TURNING POINT DETECTION
// =================================================================

console.log(`
🎯 ABSORPTION DETECTOR: 0.7%+ TURNING POINT OPTIMIZATION

📊 OPTIMIZATION STRATEGY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔸 GOAL: Detect local tops/bottoms → 0.7%+ movement to next top/bottom
🔸 PRIORITY: Maximize detection rate + Minimize false signals
🔸 APPROACH: 2-Phase hierarchical optimization

📈 PHASE 1 - CORE PARAMETERS (Most Influential):
   1️⃣ zoneTicks (1-10): Zone size granularity
   2️⃣ windowMs (30-180s): Pattern formation timeframe  
   3️⃣ minAggVolume (15-150): Signal significance threshold

🔬 PHASE 2 - REFINEMENT (False Signal Filtering):
   4️⃣ absorptionThreshold: Quality filtering
   5️⃣ minPassiveMultiplier: Absorption strength
   6️⃣ priceEfficiencyThreshold: Price impact sensitivity
   7️⃣ eventCooldownMs: Duplicate signal prevention

🚀 QUICK START COMMANDS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# 1. Test recommended turning point configuration
node run_hierarchical_backtest.js --detector absorptionDetector --config turning_point_optimized --speed 200 --verbose

# 2. Phase 1: Core parameter grid search (most important)
npx ts-node scripts/runBacktest.ts --detectors absorptionDetector \\
  --custom-grid '{"zoneTicks":[2,3,4],"windowMs":[45000,60000],"minAggVolume":[20,30,40]}' \\
  --speed 100 --verbose

# 3. Phase 2: Refine based on Phase 1 winners (after reviewing results)
npx ts-node scripts/runBacktest.ts --detectors absorptionDetector \\
  --custom-grid '{"absorptionThreshold":[0.45,0.55,0.65],"minPassiveMultiplier":[1.1,1.3,1.5]}' \\
  --speed 100 --verbose

📊 EVALUATION METRICS FOR 0.7%+ MOVES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 PRIMARY: 
   • Detection Rate: % of 0.7%+ moves caught
   • False Signal Rate: % of signals NOT followed by 0.7%+ move

📈 SECONDARY:
   • Precision: Signals that lead to profitable moves
   • Timing: Average delay from actual turning point
   • Magnitude: Average % move after signal

🔧 PARAMETER IMPACT GUIDE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

zoneTicks ↓     → More granular, catch smaller reversals
zoneTicks ↑     → Broader zones, major institutional levels

windowMs ↓      → Faster signals, catch quick reversals  
windowMs ↑      → More context, stronger patterns

minAggVolume ↓  → More signals, include smaller absorption
minAggVolume ↑  → Fewer signals, only major volume

absorptionThreshold ↓ → More signals, lower quality filter
absorptionThreshold ↑ → Fewer signals, higher quality

🎯 EXPECTED OPTIMAL RANGES FOR 0.7%+ MOVES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

zoneTicks: 2-4 (tight zones for precise turning points)
windowMs: 30-60s (responsive to pattern formation)
minAggVolume: 20-40 (balance sensitivity vs noise)
absorptionThreshold: 0.45-0.65 (moderate quality filter)
`);
