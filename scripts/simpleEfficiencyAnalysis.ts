// scripts/simpleEfficiencyAnalysis.ts

import * as fs from "fs";
import * as path from "path";
import { FinancialMath } from "../src/utils/financialMath.js";

/**
 * Simple analysis of real market data to determine optimal price efficiency scaling factor
 */

interface CSVTradeData {
    timestamp: number;
    price: number;
    quantity: number;
    side: "buy" | "sell";
    tradeId: string;
}

interface VolumeEfficiencyAnalysis {
    timestamp: number;
    priceMovement: number;
    totalVolume: number;
    volumePressure: number;
    actualEfficiency: number;
}

class SimpleEfficiencyAnalyzer {
    private readonly TICK_SIZE = 0.01; // LTCUSDT tick size
    private readonly ANALYSIS_WINDOW = 60000; // 1 minute windows
    private readonly DATA_DIR = "./backtesting_data";

    async analyzeMarketEfficiency(): Promise<number> {
        console.log(
            "🔍 Analyzing real market data for optimal scaling factor..."
        );

        // Load one file for analysis
        const files = fs.readdirSync(this.DATA_DIR);
        const tradeFile = files.find((f) => f.includes("trades.csv"));

        if (!tradeFile) {
            throw new Error("No trade files found");
        }

        const trades = this.loadTradeFile(tradeFile);
        console.log(`📊 Loaded ${trades.length} trades from ${tradeFile}`);

        // Analyze in 1-minute windows
        const analyses = this.analyzeTradeWindows(trades);
        console.log(`📈 Analyzed ${analyses.length} windows`);

        // Calculate optimal scaling factor
        const optimalFactor = this.calculateOptimalScalingFactor(analyses);

        console.log("\n🎯 RESULTS:");
        console.log(`   Current scaling factor: 10`);
        console.log(`   Optimal scaling factor: ${optimalFactor}`);
        console.log(`   Improvement: ${(optimalFactor / 10).toFixed(1)}x`);

        return optimalFactor;
    }

    private loadTradeFile(filename: string): CSVTradeData[] {
        const filePath = path.join(this.DATA_DIR, filename);
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n").slice(1, 1001); // First 1000 trades

        const trades: CSVTradeData[] = [];

        for (const line of lines) {
            if (line.trim()) {
                const [timestamp, price, quantity, side, tradeId] =
                    line.split(",");
                trades.push({
                    timestamp: parseInt(timestamp),
                    price: parseFloat(price),
                    quantity: parseFloat(quantity),
                    side: side as "buy" | "sell",
                    tradeId: tradeId,
                });
            }
        }

        return trades.sort((a, b) => a.timestamp - b.timestamp);
    }

    private analyzeTradeWindows(
        trades: CSVTradeData[]
    ): VolumeEfficiencyAnalysis[] {
        const analyses: VolumeEfficiencyAnalysis[] = [];

        let windowStart = 0;
        let currentWindow: CSVTradeData[] = [];

        for (const trade of trades) {
            if (windowStart === 0) {
                windowStart = trade.timestamp;
            }

            if (trade.timestamp - windowStart > this.ANALYSIS_WINDOW) {
                // Analyze current window
                if (currentWindow.length >= 3) {
                    const analysis = this.analyzeWindow(currentWindow);
                    if (analysis) {
                        analyses.push(analysis);
                    }
                }

                // Start new window
                currentWindow = [trade];
                windowStart = trade.timestamp;
            } else {
                currentWindow.push(trade);
            }
        }

        // Analyze final window
        if (currentWindow.length >= 3) {
            const analysis = this.analyzeWindow(currentWindow);
            if (analysis) {
                analyses.push(analysis);
            }
        }

        return analyses;
    }

    private analyzeWindow(
        trades: CSVTradeData[]
    ): VolumeEfficiencyAnalysis | null {
        if (trades.length < 3) return null;

        // Calculate price movement
        const prices = trades.map((t) => t.price);
        const priceMovement = Math.max(...prices) - Math.min(...prices);

        if (priceMovement === 0) return null;

        // Calculate total volume
        const totalVolume = trades.reduce((sum, t) => sum + t.quantity, 0);

        // Estimate passive liquidity (simplified: 2x aggressive volume)
        const avgPassive = totalVolume * 2.0;

        // Calculate volume pressure
        const volumePressure = totalVolume / avgPassive;

        // Calculate efficiency (without scaling factor)
        const actualEfficiency =
            priceMovement / (volumePressure * this.TICK_SIZE);

        return {
            timestamp: trades[0].timestamp,
            priceMovement,
            totalVolume,
            volumePressure,
            actualEfficiency,
        };
    }

    private calculateOptimalScalingFactor(
        analyses: VolumeEfficiencyAnalysis[]
    ): number {
        if (analyses.length === 0) {
            throw new Error("No analysis data available");
        }

        // Sort efficiencies
        const efficiencies = analyses
            .map((a) => a.actualEfficiency)
            .sort((a, b) => a - b);

        // Calculate percentiles
        const p50 = this.calculatePercentile(efficiencies, 50);
        const p85 = this.calculatePercentile(efficiencies, 85);

        console.log("\n📊 Efficiency Distribution:");
        console.log(`   Median efficiency: ${p50.toFixed(2)}`);
        console.log(`   85th percentile: ${p85.toFixed(2)}`);

        // Set scaling factor so 85th percentile efficiency = 0.85
        // This means 85% of market movements will show efficiency < 0.85 (absorption candidates)
        const optimalScalingFactor = Math.round(p85 / 0.85);

        // Validate the scaling factor
        this.validateScalingFactor(optimalScalingFactor, analyses);

        return optimalScalingFactor;
    }

    private calculatePercentile(
        sortedArray: number[],
        percentile: number
    ): number {
        const index = (percentile / 100) * (sortedArray.length - 1);
        const lower = Math.floor(index);
        const upper = Math.ceil(index);
        const weight = index - lower;

        if (upper >= sortedArray.length)
            return sortedArray[sortedArray.length - 1];
        if (lower < 0) return sortedArray[0];

        return sortedArray[lower] * (1 - weight) + sortedArray[upper] * weight;
    }

    private validateScalingFactor(
        scalingFactor: number,
        analyses: VolumeEfficiencyAnalysis[]
    ): void {
        console.log(`\n🧪 Validating scaling factor: ${scalingFactor}`);

        let absorptionCount = 0;

        for (const analysis of analyses) {
            const expectedMovement =
                analysis.volumePressure * this.TICK_SIZE * scalingFactor;
            const efficiency = analysis.priceMovement / expectedMovement;

            if (efficiency < 0.85) {
                absorptionCount++;
            }
        }

        const absorptionRate = (absorptionCount / analyses.length) * 100;

        console.log(
            `   Absorption detection rate: ${absorptionRate.toFixed(1)}%`
        );
        console.log(`   Expected optimal rate: ~15-20%`);

        if (absorptionRate < 10) {
            console.log("   ⚠️  May be too conservative");
        } else if (absorptionRate > 25) {
            console.log("   ⚠️  May be too aggressive");
        } else {
            console.log("   ✅ Good balance for absorption detection");
        }
    }
}

// Main execution
async function main(): Promise<void> {
    const analyzer = new SimpleEfficiencyAnalyzer();

    try {
        const optimalFactor = await analyzer.analyzeMarketEfficiency();

        console.log("\n🎯 RECOMMENDATION:");
        console.log(
            `   Update priceEfficiencyScalingFactor from 10 to ${optimalFactor}`
        );
        console.log(
            `   This aligns efficiency calculations with real market behavior`
        );
    } catch (error) {
        console.error("❌ Analysis failed:", error);
        process.exit(1);
    }
}

// Run main if this is the entry point
main().catch(console.error);

export { SimpleEfficiencyAnalyzer };
