// scripts/analyzeVolumeEfficiency.ts

import * as fs from "fs";
import * as path from "path";
import { FinancialMath } from "../src/utils/financialMath.js";
import type {
    AggressiveTrade,
    PassiveLevel,
} from "../src/types/marketEvents.js";

/**
 * Analyze real market data to determine optimal price efficiency scaling factor
 */

interface CSVTradeData {
    timestamp: number;
    price: number;
    quantity: number;
    side: "buy" | "sell";
    tradeId: string;
}

interface CSVDepthData {
    timestamp: number;
    side: "bid" | "ask";
    level: number;
    price: number;
    quantity: number;
}

interface VolumeEfficiencyData {
    timestamp: number;
    price: number;
    quantity: number;
    volumePressure: number;
    priceMovement: number;
    actualEfficiency: number;
    avgPassive: number;
}

interface EfficiencyAnalysis {
    optimalScalingFactor: number;
    averageEfficiency: number;
    medianEfficiency: number;
    percentile95: number;
    percentile5: number;
    dataPoints: number;
    absorptionCandidates: VolumeEfficiencyData[];
    normalMarketSamples: VolumeEfficiencyData[];
}

class VolumeEfficiencyAnalyzer {
    private readonly TICK_SIZE = 0.01; // LTCUSDT tick size
    private readonly ANALYSIS_WINDOW = 60000; // 1 minute windows
    private readonly MIN_TRADES_PER_WINDOW = 5; // Minimum trades to analyze
    private readonly DATA_DIR = "./backtesting_data";

    constructor() {
        // No constructor needed for CSV-based analysis
    }

    async analyzeMarketData(): Promise<EfficiencyAnalysis> {
        console.log(
            "🔍 Analyzing real market data for optimal scaling factor..."
        );

        // Load CSV files
        const { trades, depthSnapshots } = await this.loadCSVData();

        console.log(
            `📊 Loaded ${trades.length} trades and ${depthSnapshots.length} depth snapshots`
        );

        if (trades.length < 100) {
            throw new Error("Insufficient trade data for analysis");
        }

        // Group trades into time windows and analyze volume-price relationships
        const windowData = this.groupTradesIntoWindows(trades);
        const efficiencyData = await this.calculateVolumeEfficiencies(
            windowData,
            depthSnapshots
        );

        // Statistical analysis to find optimal scaling factor
        const analysis = this.analyzeEfficiencyDistribution(efficiencyData);

        console.log("📈 Analysis Results:");
        console.log(`   Data Points: ${analysis.dataPoints}`);
        console.log(
            `   Average Efficiency: ${analysis.averageEfficiency.toFixed(3)}`
        );
        console.log(
            `   Median Efficiency: ${analysis.medianEfficiency.toFixed(3)}`
        );
        console.log(`   95th Percentile: ${analysis.percentile95.toFixed(3)}`);
        console.log(`   5th Percentile: ${analysis.percentile5.toFixed(3)}`);
        console.log(
            `   🎯 Optimal Scaling Factor: ${analysis.optimalScalingFactor}`
        );

        return analysis;
    }

    private async loadCSVData(): Promise<{
        trades: CSVTradeData[];
        depthSnapshots: CSVDepthData[];
    }> {
        const trades: CSVTradeData[] = [];
        const depthSnapshots: CSVDepthData[] = [];

        // Get all CSV files in the data directory
        const files = fs.readdirSync(this.DATA_DIR);
        const tradeFiles = files
            .filter((f) => f.includes("trades.csv"))
            .slice(0, 5); // Use first 5 files
        const depthFiles = files
            .filter((f) => f.includes("depth.csv"))
            .slice(0, 5);

        console.log(
            `📁 Processing ${tradeFiles.length} trade files and ${depthFiles.length} depth files`
        );

        // Load trade data (CSV format: timestamp,price,quantity,side,tradeId)
        for (const file of tradeFiles) {
            const filePath = path.join(this.DATA_DIR, file);
            const content = fs.readFileSync(filePath, "utf-8");
            const lines = content.split("\n").slice(1); // Skip header

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
        }

        // Load depth data (CSV format: timestamp,side,level,price,quantity)
        for (const file of depthFiles) {
            const filePath = path.join(this.DATA_DIR, file);
            const content = fs.readFileSync(filePath, "utf-8");
            const lines = content.split("\n").slice(1); // Skip header

            for (const line of lines.slice(0, 1000)) {
                // Sample first 1000 per file
                if (line.trim()) {
                    const [timestamp, side, level, price, quantity] =
                        line.split(",");
                    depthSnapshots.push({
                        timestamp: parseInt(timestamp),
                        side: side as "bid" | "ask",
                        level: parseInt(level),
                        price: parseFloat(price),
                        quantity: parseFloat(quantity),
                    });
                }
            }
        }

        // Sort by timestamp
        trades.sort((a, b) => a.timestamp - b.timestamp);
        depthSnapshots.sort((a, b) => a.timestamp - b.timestamp);

        return { trades, depthSnapshots };
    }

    private groupTradesIntoWindows(trades: CSVTradeData[]): CSVTradeData[][] {
        const windows: CSVTradeData[][] = [];
        let currentWindow: CSVTradeData[] = [];
        let windowStart = trades[0]?.timestamp || Date.now();

        for (const trade of trades) {
            if (trade.timestamp - windowStart > this.ANALYSIS_WINDOW) {
                if (currentWindow.length >= this.MIN_TRADES_PER_WINDOW) {
                    windows.push([...currentWindow]);
                }
                currentWindow = [];
                windowStart = trade.timestamp;
            }
            currentWindow.push(trade);
        }

        // Add final window
        if (currentWindow.length >= this.MIN_TRADES_PER_WINDOW) {
            windows.push(currentWindow);
        }

        console.log(`📦 Created ${windows.length} analysis windows`);
        return windows;
    }

    private async calculateVolumeEfficiencies(
        windows: CSVTradeData[][],
        depthSnapshots: CSVDepthData[]
    ): Promise<VolumeEfficiencyData[]> {
        const efficiencyData: VolumeEfficiencyData[] = [];

        for (const window of windows) {
            try {
                const analysis = await this.analyzeWindow(window);
                if (analysis) {
                    efficiencyData.push(analysis);
                }
            } catch (error) {
                console.warn("⚠️ Error analyzing window:", error);
            }
        }

        console.log(`✅ Analyzed ${efficiencyData.length} valid windows`);
        return efficiencyData;
    }

    private async analyzeWindow(
        trades: CSVTradeData[]
    ): Promise<VolumeEfficiencyData | null> {
        if (trades.length < this.MIN_TRADES_PER_WINDOW) {
            return null;
        }

        // Calculate price movement in window
        const prices = trades.map((t) => t.price);
        const priceMovement = Math.max(...prices) - Math.min(...prices);

        if (priceMovement === 0) {
            return null; // Skip windows with no price movement
        }

        // Calculate total volume
        const totalVolume = trades.reduce((sum, t) => sum + t.quantity, 0);

        // Estimate average passive liquidity (simplified)
        // In real implementation, this would come from order book snapshots
        const avgPassive = totalVolume * 1.5; // Rough estimate: passive is typically 1.5x aggressive

        // Calculate volume pressure
        const volumePressure = FinancialMath.safeDivide(
            totalVolume,
            avgPassive,
            1.0
        );

        // Calculate actual efficiency (without scaling factor)
        const actualEfficiency =
            priceMovement / (volumePressure * this.TICK_SIZE);

        return {
            timestamp: trades[0].timestamp,
            price: prices[0],
            quantity: totalVolume,
            volumePressure,
            priceMovement,
            actualEfficiency,
            avgPassive,
        };
    }

    private analyzeEfficiencyDistribution(
        data: VolumeEfficiencyData[]
    ): EfficiencyAnalysis {
        if (data.length === 0) {
            throw new Error("No efficiency data to analyze");
        }

        // Sort by efficiency for percentile calculations
        const sortedEfficiencies = data
            .map((d) => d.actualEfficiency)
            .sort((a, b) => a - b);

        const averageEfficiency =
            FinancialMath.calculateMean(sortedEfficiencies);
        const medianEfficiency = this.calculatePercentile(
            sortedEfficiencies,
            50
        );
        const percentile95 = this.calculatePercentile(sortedEfficiencies, 95);
        const percentile5 = this.calculatePercentile(sortedEfficiencies, 5);

        // Optimal scaling factor: set it so that 85th percentile efficiency = 0.85
        // This means 85% of normal market movements will have efficiency < 0.85
        // Only the top 15% (likely absorption scenarios) will have efficiency > 0.85
        const percentile85 = this.calculatePercentile(sortedEfficiencies, 85);
        const optimalScalingFactor = Math.round(percentile85 / 0.85);

        // Identify absorption candidates (bottom 10% efficiency)
        const absorptionThreshold = this.calculatePercentile(
            sortedEfficiencies,
            10
        );
        const absorptionCandidates = data.filter(
            (d) => d.actualEfficiency <= absorptionThreshold
        );

        // Normal market samples (middle 50%)
        const p25 = this.calculatePercentile(sortedEfficiencies, 25);
        const p75 = this.calculatePercentile(sortedEfficiencies, 75);
        const normalMarketSamples = data.filter(
            (d) => d.actualEfficiency >= p25 && d.actualEfficiency <= p75
        );

        console.log("\n📊 Efficiency Distribution Analysis:");
        console.log(
            `   85th Percentile Efficiency: ${percentile85.toFixed(3)}`
        );
        console.log(
            `   Absorption Candidates (≤10th percentile): ${absorptionCandidates.length}`
        );
        console.log(
            `   Normal Market Samples (25th-75th percentile): ${normalMarketSamples.length}`
        );

        return {
            optimalScalingFactor,
            averageEfficiency,
            medianEfficiency,
            percentile95,
            percentile5,
            dataPoints: data.length,
            absorptionCandidates,
            normalMarketSamples,
        };
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

    async validateScalingFactor(scalingFactor: number): Promise<void> {
        console.log(`\n🧪 Validating scaling factor: ${scalingFactor}`);

        // Re-run analysis with proposed scaling factor
        // Use CSV data for validation instead of storage
        const { trades } = await this.loadCSVData();
        const windowData = this.groupTradesIntoWindows(trades);

        let absorptionDetected = 0;
        let totalWindows = 0;

        for (const window of windowData.slice(0, 100)) {
            // Test first 100 windows
            const analysis = await this.analyzeWindow(window);
            if (analysis) {
                totalWindows++;

                // Calculate efficiency with scaling factor
                const expectedMovement =
                    analysis.volumePressure * this.TICK_SIZE * scalingFactor;
                const efficiency = analysis.priceMovement / expectedMovement;

                if (efficiency < 0.85) {
                    absorptionDetected++;
                }
            }
        }

        const absorptionRate = (absorptionDetected / totalWindows) * 100;
        console.log(
            `   Absorption Detection Rate: ${absorptionRate.toFixed(1)}% (${absorptionDetected}/${totalWindows})`
        );
        console.log(`   Expected Rate: ~15-20% for healthy detection`);

        if (absorptionRate < 5) {
            console.log(
                "   ⚠️  Too conservative - very few absorptions detected"
            );
        } else if (absorptionRate > 30) {
            console.log("   ⚠️  Too aggressive - too many false positives");
        } else {
            console.log("   ✅ Good balance for absorption detection");
        }
    }

    async cleanup(): Promise<void> {
        // No cleanup needed for CSV analysis
    }
}

// Main execution
async function main() {
    const analyzer = new VolumeEfficiencyAnalyzer();

    try {
        const analysis = await analyzer.analyzeMarketData();

        // Validate the proposed scaling factor
        await analyzer.validateScalingFactor(analysis.optimalScalingFactor);

        console.log("\n🎯 RECOMMENDATION:");
        console.log(
            `   Update priceEfficiencyScalingFactor from 10 to ${analysis.optimalScalingFactor}`
        );
        console.log(
            `   This will align efficiency calculations with real market behavior`
        );
    } catch (error) {
        console.error("❌ Analysis failed:", error);
        process.exit(1);
    } finally {
        await analyzer.cleanup();
    }
}

if (require.main === module) {
    main().catch(console.error);
}

export { VolumeEfficiencyAnalyzer };
