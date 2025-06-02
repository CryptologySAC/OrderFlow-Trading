// New file: backtestEngine.ts
/*
export interface BacktestResult {
    totalTrades: number;
    winRate: number;
    avgWinPercent: number;
    avgLossPercent: number;
    totalLTCAccumulated: number;
    maxDrawdownPercent: number;
    sharpeRatio: number;
}

export class BacktestEngine {
    private readonly commissionRate = 0.001; // 0.1% per side
    private readonly targetPercent = 0.015; // 1.5% target

    async backtest(
        historicalTrades: TradeData[],
        strategy: (trades: TradeData[]) => Signal | null
    ): Promise<BacktestResult> {
        const results: Array<{
            entry: number;
            exit: number;
            profit: number;
            ltcGained: number;
        }> = [];

        let position: {
            entry: number;
            size: number;
            side: "buy" | "sell";
        } | null = null;

        // Sliding window approach
        const windowSize = 1000; // Last 1000 trades

        for (let i = windowSize; i < historicalTrades.length; i++) {
            const window = historicalTrades.slice(i - windowSize, i);
            const signal = strategy(window);

            if (signal && !position) {
                // Enter position
                position = {
                    entry: signal.price,
                    size: 100, // Start with 100 USDT
                    side: signal.type === "absorption" ? "buy" : "sell",
                };
            } else if (position) {
                const currentPrice = historicalTrades[i].price;
                const priceChange =
                    (currentPrice - position.entry) / position.entry;

                // Check exit conditions
                const shouldExit =
                    (position.side === "buy" &&
                        priceChange >= this.targetPercent) ||
                    (position.side === "sell" &&
                        priceChange <= -this.targetPercent) ||
                    Math.abs(priceChange) >= 0.03; // 3% stop loss

                if (shouldExit) {
                    const grossProfit = position.size * priceChange;
                    const commission = position.size * this.commissionRate * 2;
                    const netProfit = grossProfit - commission;

                    // Calculate LTC accumulated
                    const ltcGained =
                        position.side === "buy"
                            ? netProfit / currentPrice
                            : -netProfit / position.entry;

                    results.push({
                        entry: position.entry,
                        exit: currentPrice,
                        profit: netProfit,
                        ltcGained,
                    });

                    position = null;
                }
            }
        }

        return this.calculateMetrics(results);
    }

    private calculateMetrics(
        results: Array<{
            profit: number;
            ltcGained: number;
        }>
    ): BacktestResult {
        const wins = results.filter((r) => r.profit > 0);
        const losses = results.filter((r) => r.profit <= 0);

        return {
            totalTrades: results.length,
            winRate: wins.length / results.length,
            avgWinPercent:
                wins.reduce((sum, w) => sum + w.profit, 0) / wins.length / 100,
            avgLossPercent:
                losses.reduce((sum, l) => sum + l.profit, 0) /
                losses.length /
                100,
            totalLTCAccumulated: results.reduce(
                (sum, r) => sum + r.ltcGained,
                0
            ),
            maxDrawdownPercent: this.calculateMaxDrawdown(results),
            sharpeRatio: this.calculateSharpe(results),
        };
    }

    private calculateMaxDrawdown(results: Array<{ profit: number }>): number {
        let peak = 0;
        let maxDrawdown = 0;
        let cumulative = 0;

        for (const result of results) {
            cumulative += result.profit;
            if (cumulative > peak) peak = cumulative;
            const drawdown = (peak - cumulative) / peak;
            if (drawdown > maxDrawdown) maxDrawdown = drawdown;
        }

        return maxDrawdown;
    }

    private calculateSharpe(results: Array<{ profit: number }>): number {
        const returns = results.map((r) => r.profit / 100); // Convert to percentage
        const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        const stdDev = Math.sqrt(
            returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
                returns.length
        );

        // Assuming 96 trades per day (4 per hour, 24 hours)
        const annualizationFactor = Math.sqrt(365 * 96);

        return stdDev === 0 ? 0 : (avgReturn / stdDev) * annualizationFactor;
    }
}

*/
