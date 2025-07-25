#!/usr/bin/env ts-node
// scripts/analyzeSignalPrediction.ts

/**
 * Signal Prediction Analysis Tool
 *
 * This script analyzes detector signals to understand:
 * 1. Are signals PREDICTING local tops/bottoms or REACTING to them?
 * 2. What parameter combinations minimize false signals?
 * 3. How can we optimize for prediction rather than reaction?
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Get the directory of this script
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface SignalRecord {
    timestamp: number;
    signalId: string;
    detectorType: "exhaustion" | "absorption";
    signalSide: "buy" | "sell";
    confidence: number;
    price: number;
    tradeQuantity: number;
    bestBid: number;
    bestAsk: number;
    spread: number;
    totalAggressiveVolume: number;
    totalPassiveVolume: number;
    aggressiveBuyVolume: number;
    aggressiveSellVolume: number;
    passiveBidVolume: number;
    passiveAskVolume: number;
    volumeImbalance: number;
    institutionalVolumeRatio: number;
    activeZones: number;
    zoneTotalVolume: number;
    priceEfficiency: number;
    absorptionRatio?: number;
    exhaustionRatio?: number;
    depletionRatio?: number;
    signalStrength: number;
    confluenceScore: number;
    institutionalFootprint: number;
    qualityGrade: string;
    // Future price columns (may be empty if signals are recent)
    priceAt5min?: number;
    priceAt15min?: number;
    priceAt1hr?: number;
    movementDirection5min?: string;
    movementDirection15min?: string;
    movementDirection1hr?: string;
    maxMovement5min?: number;
    maxMovement15min?: number;
    maxMovement1hr?: number;
    signalAccuracy5min?: number;
    signalAccuracy15min?: number;
    signalAccuracy1hr?: number;
}

interface DetectorSettings {
    exhaustion: {
        minAggVolume: number;
        exhaustionThreshold: number;
        timeWindowIndex: number;
        eventCooldownMs: number;
        depletionVolumeThreshold: number;
        depletionRatioThreshold: number;
        passiveVolumeExhaustionRatio: number;
        aggressiveVolumeExhaustionThreshold: number;
    };
    absorption: {
        minAggVolume: number;
        timeWindowIndex: number;
        eventCooldownMs: number;
        priceEfficiencyThreshold: number;
        maxAbsorptionRatio: number;
        minPassiveMultiplier: number;
        passiveAbsorptionThreshold: number;
        institutionalVolumeThreshold: number;
        institutionalVolumeRatioThreshold: number;
        finalConfidenceRequired: number;
        minEnhancedConfidenceThreshold: number;
    };
}

class SignalPredictionAnalyzer {
    private signals: SignalRecord[] = [];
    private settings: DetectorSettings;

    constructor(settings: DetectorSettings) {
        this.settings = settings;
    }

    /**
     * Load signal data from CSV file
     */
    loadSignalData(csvPath: string): void {
        if (!fs.existsSync(csvPath)) {
            console.warn(`⚠️  Signal file not found: ${csvPath}`);
            return;
        }

        const csvContent = fs.readFileSync(csvPath, "utf-8");
        const lines = csvContent.trim().split("\n");

        if (lines.length <= 1) {
            console.warn(`⚠️  No signal data found in ${csvPath}`);
            return;
        }

        const header = lines[0].split(",");
        console.log(`📊 Loading signals from ${csvPath}`);
        console.log(
            `📋 CSV columns (${header.length}):`,
            header.slice(0, 10).join(", "),
            "..."
        );

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(",");
            if (values.length < header.length / 2) continue; // Skip incomplete lines

            try {
                const signal: SignalRecord = {
                    timestamp: parseInt(values[0]) || 0,
                    signalId: values[1] || "",
                    detectorType: values[2] as "exhaustion" | "absorption",
                    signalSide: values[3] as "buy" | "sell",
                    confidence: parseFloat(values[4]) || 0,
                    price: parseFloat(values[5]) || 0,
                    tradeQuantity: parseFloat(values[6]) || 0,
                    bestBid: parseFloat(values[7]) || 0,
                    bestAsk: parseFloat(values[8]) || 0,
                    spread: parseFloat(values[9]) || 0,
                    totalAggressiveVolume: parseFloat(values[10]) || 0,
                    totalPassiveVolume: parseFloat(values[11]) || 0,
                    aggressiveBuyVolume: parseFloat(values[12]) || 0,
                    aggressiveSellVolume: parseFloat(values[13]) || 0,
                    passiveBidVolume: parseFloat(values[14]) || 0,
                    passiveAskVolume: parseFloat(values[15]) || 0,
                    volumeImbalance: parseFloat(values[16]) || 0,
                    institutionalVolumeRatio: parseFloat(values[17]) || 0,
                    activeZones: parseInt(values[18]) || 0,
                    zoneTotalVolume: parseFloat(values[19]) || 0,
                    priceEfficiency: parseFloat(values[20]) || 0,
                    absorptionRatio: values[21]
                        ? parseFloat(values[21])
                        : undefined,
                    exhaustionRatio: values[22]
                        ? parseFloat(values[22])
                        : undefined,
                    depletionRatio: values[23]
                        ? parseFloat(values[23])
                        : undefined,
                    signalStrength: parseFloat(values[24]) || 0,
                    confluenceScore: parseFloat(values[25]) || 0,
                    institutionalFootprint: parseFloat(values[26]) || 0,
                    qualityGrade: values[27] || "",
                    // Future price data (may be empty for recent signals)
                    priceAt5min: values[28]
                        ? parseFloat(values[28])
                        : undefined,
                    priceAt15min: values[29]
                        ? parseFloat(values[29])
                        : undefined,
                    priceAt1hr: values[30] ? parseFloat(values[30]) : undefined,
                    movementDirection5min: values[31] || undefined,
                    movementDirection15min: values[32] || undefined,
                    movementDirection1hr: values[33] || undefined,
                    maxMovement5min: values[34]
                        ? parseFloat(values[34])
                        : undefined,
                    maxMovement15min: values[35]
                        ? parseFloat(values[35])
                        : undefined,
                    maxMovement1hr: values[36]
                        ? parseFloat(values[36])
                        : undefined,
                    signalAccuracy5min: values[37]
                        ? parseFloat(values[37])
                        : undefined,
                    signalAccuracy15min: values[38]
                        ? parseFloat(values[38])
                        : undefined,
                    signalAccuracy1hr: values[39]
                        ? parseFloat(values[39])
                        : undefined,
                };

                this.signals.push(signal);
            } catch (error) {
                console.warn(`⚠️  Failed to parse line ${i}: ${error}`);
            }
        }

        console.log(`✅ Loaded ${this.signals.length} signals`);
    }

    /**
     * Analyze current detector settings for prediction vs reaction patterns
     */
    analyzeCurrentSettings(): void {
        console.log("\n🔍 CURRENT DETECTOR SETTINGS ANALYSIS\n");

        const exhaustionSignals = this.signals.filter(
            (s) => s.detectorType === "exhaustion"
        );
        const absorptionSignals = this.signals.filter(
            (s) => s.detectorType === "absorption"
        );

        console.log("📈 EXHAUSTION DETECTOR ANALYSIS");
        console.log("═══════════════════════════════");
        console.log(`Current Settings:`);
        console.log(
            `  • minAggVolume: ${this.settings.exhaustion.minAggVolume} LTC`
        );
        console.log(
            `  • exhaustionThreshold: ${this.settings.exhaustion.exhaustionThreshold}`
        );
        console.log(
            `  • depletionVolumeThreshold: ${this.settings.exhaustion.depletionVolumeThreshold} LTC`
        );
        console.log(
            `  • depletionRatioThreshold: ${this.settings.exhaustion.depletionRatioThreshold}`
        );
        console.log(
            `  • eventCooldownMs: ${this.settings.exhaustion.eventCooldownMs}ms`
        );
        console.log(`\nSignal Statistics:`);
        console.log(`  • Total signals: ${exhaustionSignals.length}`);
        console.log(
            `  • Buy signals: ${exhaustionSignals.filter((s) => s.signalSide === "buy").length}`
        );
        console.log(
            `  • Sell signals: ${exhaustionSignals.filter((s) => s.signalSide === "sell").length}`
        );
        if (exhaustionSignals.length > 0) {
            const avgConfidence =
                exhaustionSignals.reduce((sum, s) => sum + s.confidence, 0) /
                exhaustionSignals.length;
            const avgVolumeImbalance =
                exhaustionSignals.reduce(
                    (sum, s) => sum + s.volumeImbalance,
                    0
                ) / exhaustionSignals.length;
            console.log(`  • Average confidence: ${avgConfidence.toFixed(3)}`);
            console.log(
                `  • Average volume imbalance: ${avgVolumeImbalance.toFixed(3)}`
            );
        }

        console.log("\n📉 ABSORPTION DETECTOR ANALYSIS");
        console.log("═══════════════════════════════");
        console.log(`Current Settings:`);
        console.log(
            `  • minAggVolume: ${this.settings.absorption.minAggVolume} LTC`
        );
        console.log(
            `  • institutionalVolumeThreshold: ${this.settings.absorption.institutionalVolumeThreshold} LTC`
        );
        console.log(
            `  • priceEfficiencyThreshold: ${this.settings.absorption.priceEfficiencyThreshold}`
        );
        console.log(
            `  • maxAbsorptionRatio: ${this.settings.absorption.maxAbsorptionRatio}`
        );
        console.log(
            `  • finalConfidenceRequired: ${this.settings.absorption.finalConfidenceRequired}`
        );
        console.log(
            `  • eventCooldownMs: ${this.settings.absorption.eventCooldownMs}ms`
        );
        console.log(`\nSignal Statistics:`);
        console.log(`  • Total signals: ${absorptionSignals.length}`);
        console.log(
            `  • Buy signals: ${absorptionSignals.filter((s) => s.signalSide === "buy").length}`
        );
        console.log(
            `  • Sell signals: ${absorptionSignals.filter((s) => s.signalSide === "sell").length}`
        );
        if (absorptionSignals.length > 0) {
            const avgConfidence =
                absorptionSignals.reduce((sum, s) => sum + s.confidence, 0) /
                absorptionSignals.length;
            const avgEfficiency =
                absorptionSignals.reduce(
                    (sum, s) => sum + s.priceEfficiency,
                    0
                ) / absorptionSignals.length;
            console.log(`  • Average confidence: ${avgConfidence.toFixed(3)}`);
            console.log(
                `  • Average price efficiency: ${avgEfficiency.toFixed(6)}`
            );
        }
    }

    /**
     * Identify patterns that suggest prediction vs reaction
     */
    analyzePredictionPatterns(): void {
        console.log("\n🎯 PREDICTION VS REACTION ANALYSIS\n");

        // Group signals by detector type
        const exhaustionSignals = this.signals.filter(
            (s) => s.detectorType === "exhaustion"
        );
        const absorptionSignals = this.signals.filter(
            (s) => s.detectorType === "absorption"
        );

        console.log("🔍 EXHAUSTION SIGNAL PATTERNS:");
        console.log("══════════════════════════════");

        if (exhaustionSignals.length === 0) {
            console.log("❌ No exhaustion signals found in data");
        } else {
            // Analyze volume patterns
            const highVolumeSignals = exhaustionSignals.filter(
                (s) => s.totalAggressiveVolume > 100000
            );
            const lowVolumeSignals = exhaustionSignals.filter(
                (s) => s.totalAggressiveVolume < 50000
            );

            console.log(`📊 Volume Distribution:`);
            console.log(
                `  • High volume signals (>100k): ${highVolumeSignals.length}`
            );
            console.log(
                `  • Low volume signals (<50k): ${lowVolumeSignals.length}`
            );

            // Analyze confidence patterns
            const highConfidenceSignals = exhaustionSignals.filter(
                (s) => s.confidence > 0.8
            );
            const lowConfidenceSignals = exhaustionSignals.filter(
                (s) => s.confidence < 0.6
            );

            console.log(`🎯 Confidence Distribution:`);
            console.log(
                `  • High confidence signals (>0.8): ${highConfidenceSignals.length}`
            );
            console.log(
                `  • Low confidence signals (<0.6): ${lowConfidenceSignals.length}`
            );
        }

        console.log("\n🔍 ABSORPTION SIGNAL PATTERNS:");
        console.log("═════════════════════════════");

        if (absorptionSignals.length === 0) {
            console.log("❌ No absorption signals found in data");
        } else {
            // Analyze institutional footprint
            const institutionalSignals = absorptionSignals.filter(
                (s) => s.institutionalVolumeRatio > 0.6
            );
            const retailSignals = absorptionSignals.filter(
                (s) => s.institutionalVolumeRatio < 0.4
            );

            console.log(`🏦 Institutional Footprint:`);
            console.log(
                `  • Institutional signals (>0.6 ratio): ${institutionalSignals.length}`
            );
            console.log(
                `  • Retail signals (<0.4 ratio): ${retailSignals.length}`
            );

            // Analyze price efficiency
            const efficientSignals = absorptionSignals.filter(
                (s) => s.priceEfficiency > 0.01
            );
            const inefficientSignals = absorptionSignals.filter(
                (s) => s.priceEfficiency < 0.005
            );

            console.log(`⚡ Price Efficiency:`);
            console.log(
                `  • Efficient signals (>0.01): ${efficientSignals.length}`
            );
            console.log(
                `  • Inefficient signals (<0.005): ${inefficientSignals.length}`
            );
        }
    }

    /**
     * Generate optimization recommendations
     */
    generateOptimizationRecommendations(): void {
        console.log("\n🚀 OPTIMIZATION RECOMMENDATIONS\n");
        console.log("═══════════════════════════════════\n");

        console.log("📈 EXHAUSTION DETECTOR OPTIMIZATION:");
        console.log("═══════════════════════════════════");

        // Current settings analysis
        const currentMinAggVolume = this.settings.exhaustion.minAggVolume;
        const currentThreshold = this.settings.exhaustion.exhaustionThreshold;

        console.log(`\n🔧 Current Issues:`);
        console.log(
            `  • minAggVolume: ${currentMinAggVolume} LTC (may be too high - causing reaction instead of prediction)`
        );
        console.log(
            `  • exhaustionThreshold: ${currentThreshold} (very high - only triggers after exhaustion is obvious)`
        );
        console.log(
            `  • cooldown: ${this.settings.exhaustion.eventCooldownMs}ms (may miss quick reversals)`
        );

        console.log(`\n💡 Optimization Strategy for PREDICTION:`);
        console.log(
            `  1. LOWER volume threshold: Test 2000-5000 LTC (vs current ${currentMinAggVolume})`
        );
        console.log(`     → Catch exhaustion BEFORE it becomes massive`);
        console.log(
            `  2. LOWER exhaustion threshold: Test 0.3-0.6 (vs current ${currentThreshold})`
        );
        console.log(
            `     → Detect early signs of exhaustion, not late-stage reaction`
        );
        console.log(`  3. REDUCE cooldown: Test 5-15 seconds (vs current 30s)`);
        console.log(`     → Allow faster detection of reversal patterns`);
        console.log(
            `  4. ADD momentum filter: Only signal when price momentum opposes volume flow`
        );
        console.log(`     → Avoid signaling during strong directional moves`);

        console.log(`\n📉 ABSORPTION DETECTOR OPTIMIZATION:`);
        console.log("═══════════════════════════════════");

        const currentAbsMinVol = this.settings.absorption.minAggVolume;
        const currentInstThreshold =
            this.settings.absorption.institutionalVolumeThreshold;

        console.log(`\n🔧 Current Issues:`);
        console.log(
            `  • minAggVolume: ${currentAbsMinVol} LTC (may be too high for early detection)`
        );
        console.log(
            `  • institutionalVolumeThreshold: ${currentInstThreshold} LTC (very high institutional filter)`
        );
        console.log(
            `  • priceEfficiencyThreshold: ${this.settings.absorption.priceEfficiencyThreshold} (very low - everything passes)`
        );

        console.log(`\n💡 Optimization Strategy for PREDICTION:`);
        console.log(
            `  1. MODERATE volume threshold: Test 1000-3000 LTC (vs current ${currentAbsMinVol})`
        );
        console.log(`     → Balance early detection with noise filtering`);
        console.log(
            `  2. ADJUST institutional filter: Test 2000-5000 LTC (vs current ${currentInstThreshold})`
        );
        console.log(
            `     → Focus on meaningful institutional absorption, not mega-whale moves`
        );
        console.log(
            `  3. INCREASE price efficiency: Test 0.005-0.015 (vs current ${this.settings.absorption.priceEfficiencyThreshold})`
        );
        console.log(`     → Require actual price impact from absorption`);
        console.log(
            `  4. ADD divergence detection: Signal when absorption isn't moving price as expected`
        );
        console.log(
            `     → Classic absorption pattern: high volume, minimal price movement`
        );

        console.log(`\n🎯 PREDICTION-FOCUSED STRATEGY:`);
        console.log("═══════════════════════════════");
        console.log(`  • Focus on EARLY SIGNS rather than complete patterns`);
        console.log(
            `  • Use SMALLER volume thresholds to catch building pressure`
        );
        console.log(
            `  • Add MOMENTUM DIVERGENCE filters (volume vs price direction)`
        );
        console.log(
            `  • Implement MULTI-TIMEFRAME confirmation (5s + 30s signals)`
        );
        console.log(
            `  • Add VOLUME VELOCITY analysis (accelerating vs decelerating)`
        );

        console.log(`\n🧪 TESTING RECOMMENDATIONS:`);
        console.log("════════════════════════════");
        console.log(`  1. A/B test these ranges systematically:`);
        console.log(
            `     Exhaustion: minVol [2000,3000,5000], threshold [0.3,0.5,0.7]`
        );
        console.log(
            `     Absorption: minVol [1000,2000,3000], instThresh [2000,3000,5000]`
        );
        console.log(
            `  2. Measure prediction success: signals 30-60s BEFORE local tops/bottoms`
        );
        console.log(
            `  3. Minimize false signals: avoid signaling during strong trends`
        );
        console.log(
            `  4. Test time windows: current 3-minute might be too long for prediction`
        );
    }

    /**
     * Run complete analysis
     */
    run(): void {
        console.log("🚀 SIGNAL PREDICTION ANALYSIS");
        console.log("════════════════════════════════════════════════\n");

        // Load recent signal data
        const signalPath = path.join(
            __dirname,
            "..",
            "logs",
            "signal_validation",
            "signal_validation_2025-07-21.csv"
        );
        this.loadSignalData(signalPath);

        // Perform analysis
        this.analyzeCurrentSettings();
        this.analyzePredictionPatterns();
        this.generateOptimizationRecommendations();

        console.log("\n✨ ANALYSIS COMPLETE");
        console.log("═══════════════════");
        console.log(
            "Next steps: Implement systematic parameter testing to find optimal prediction settings."
        );
    }
}

// Main execution
async function main() {
    // Current settings from config.json
    const currentSettings: DetectorSettings = {
        exhaustion: {
            minAggVolume: 10000,
            exhaustionThreshold: 0.875,
            timeWindowIndex: 0,
            eventCooldownMs: 30000,
            depletionVolumeThreshold: 1000,
            depletionRatioThreshold: 0.25,
            passiveVolumeExhaustionRatio: 0.4,
            aggressiveVolumeExhaustionThreshold: 0.65,
        },
        absorption: {
            minAggVolume: 5000,
            timeWindowIndex: 0,
            eventCooldownMs: 30000,
            priceEfficiencyThreshold: 0.0002,
            maxAbsorptionRatio: 0.65,
            minPassiveMultiplier: 1.2,
            passiveAbsorptionThreshold: 0.35,
            institutionalVolumeThreshold: 10000,
            institutionalVolumeRatioThreshold: 0.75,
            finalConfidenceRequired: 0.8,
            minEnhancedConfidenceThreshold: 0.3,
        },
    };

    const analyzer = new SignalPredictionAnalyzer(currentSettings);
    analyzer.run();
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export { SignalPredictionAnalyzer, type SignalRecord, type DetectorSettings };
