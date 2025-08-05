// src/data/microstructureAnalyzer.ts

import type {
    IndividualTrade,
    MicrostructureMetrics,
    CoordinationSignal,
} from "../types/marketEvents.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { IWorkerMetricsCollector } from "../multithreading/shared/workerInterfaces.js";

export interface MicrostructureAnalyzerConfig {
    // Timing analysis thresholds
    burstThresholdMs: number; // 100ms - consider coordinated if trades within this time
    uniformityThreshold: number; // 0.2 - coefficient of variation threshold for uniform timing

    // Fragmentation analysis
    sizingConsistencyThreshold: number; // 0.15 - CV threshold for consistent sizing

    // Toxicity analysis
    persistenceWindowSize: number; // 5 - number of trades to look at for persistence

    // Algorithmic pattern detection
    marketMakingSpreadThreshold: number; // 0.01 - price spread threshold for market making detection
    icebergSizeRatio: number; // 0.8 - ratio threshold for iceberg detection
    arbitrageTimeThreshold: number; // 50ms - max time for arbitrage detection
}

export class MicrostructureAnalyzer {
    private readonly logger: ILogger;
    private readonly metricsCollector: IWorkerMetricsCollector;
    private readonly config: MicrostructureAnalyzerConfig;

    constructor(
        config: MicrostructureAnalyzerConfig,
        logger: ILogger,
        metricsCollector: IWorkerMetricsCollector
    ) {
        this.config = config;
        this.logger = logger;
        this.metricsCollector = metricsCollector;

        this.logger.info("[MicrostructureAnalyzer] Initialized", {
            burstThresholdMs: config.burstThresholdMs,
            sizingConsistencyThreshold: config.sizingConsistencyThreshold,
            persistenceWindowSize: config.persistenceWindowSize,
        });
    }

    /**
     * Analyze individual trades for microstructure patterns
     */
    public analyze(trades: IndividualTrade[]): MicrostructureMetrics {
        if (trades.length === 0) {
            return this.createEmptyMetrics();
        }

        const startTime = Date.now();

        try {
            // Order trades by timestamp for analysis
            const sortedTrades = [...trades].sort(
                (a, b) => a.timestamp - b.timestamp
            );

            // Perform various analyses
            const fragmentationAnalysis =
                this.analyzeFragmentation(sortedTrades);
            const timingAnalysis = this.analyzeTimingPatterns(sortedTrades);
            const flowAnalysis = this.analyzeFlow(sortedTrades);
            const algorithmicAnalysis =
                this.analyzeAlgorithmicPatterns(sortedTrades);
            const coordinationAnalysis = this.analyzeCoordination(sortedTrades);

            const metrics: MicrostructureMetrics = {
                // Fragmentation metrics
                fragmentationScore: fragmentationAnalysis.fragmentationScore,
                avgTradeSize: fragmentationAnalysis.avgTradeSize,
                tradeSizeVariance: fragmentationAnalysis.tradeSizeVariance,

                // Timing metrics
                timingPattern: timingAnalysis.timingPattern,
                avgTimeBetweenTrades: timingAnalysis.avgTimeBetweenTrades,

                // Flow metrics
                toxicityScore: flowAnalysis.toxicityScore,
                directionalPersistence: flowAnalysis.directionalPersistence,

                // Algorithmic detection
                suspectedAlgoType: algorithmicAnalysis.suspectedAlgoType,
                coordinationIndicators:
                    coordinationAnalysis.coordinationIndicators,

                // Statistical properties
                sizingPattern: fragmentationAnalysis.sizingPattern,
                executionEfficiency:
                    this.calculateExecutionEfficiency(sortedTrades),
            };

            this.metricsCollector.updateMetric(
                "microstructure.analysisTimeMs",
                Date.now() - startTime
            );
            this.metricsCollector.incrementMetric(
                "microstructure.analysisCount"
            );

            return metrics;
        } catch (error) {
            this.logger.error("[MicrostructureAnalyzer] Analysis failed", {
                error: (error as Error).message,
                tradeCount: trades.length,
            });

            this.metricsCollector.incrementMetric(
                "microstructure.analysisErrors"
            );
            return this.createEmptyMetrics();
        }
    }

    /**
     * Analyze order fragmentation patterns
     */
    private analyzeFragmentation(trades: IndividualTrade[]) {
        const sizes = trades.map((t) => t.quantity);
        const avgSize =
            sizes.reduce((sum, size) => sum + size, 0) / sizes.length;

        // Calculate size variance
        const variance =
            sizes.reduce((sum, size) => sum + Math.pow(size - avgSize, 2), 0) /
            sizes.length;
        const stdDev = Math.sqrt(variance);
        const coefficientOfVariation = avgSize > 0 ? stdDev / avgSize : 0;

        // Fragmentation score (0-1, higher = more fragmented)
        const fragmentationScore = Math.min(
            1,
            coefficientOfVariation + (trades.length - 1) * 0.1
        );

        // Determine sizing pattern
        let sizingPattern: "consistent" | "random" | "structured";
        if (coefficientOfVariation < this.config.sizingConsistencyThreshold) {
            sizingPattern = "consistent";
        } else if (this.detectStructuredSizing(sizes)) {
            sizingPattern = "structured";
        } else {
            sizingPattern = "random";
        }

        return {
            fragmentationScore,
            avgTradeSize: avgSize,
            tradeSizeVariance: variance,
            sizingPattern,
        };
    }

    /**
     * Analyze timing patterns between trades
     */
    private analyzeTimingPatterns(trades: IndividualTrade[]) {
        if (trades.length < 2) {
            return {
                timingPattern: "uniform" as const,
                avgTimeBetweenTrades: 0,
            };
        }

        // Calculate time gaps between trades
        const timeGaps = [];
        for (let i = 1; i < trades.length; i++) {
            timeGaps.push(trades[i].timestamp - trades[i - 1].timestamp);
        }

        const avgTimeBetween =
            timeGaps.reduce((sum, gap) => sum + gap, 0) / timeGaps.length;

        // Analyze timing pattern
        let timingPattern: "uniform" | "burst" | "coordinated";

        // Check for burst pattern (many trades in short time)
        const burstTrades = timeGaps.filter(
            (gap) => gap < this.config.burstThresholdMs
        ).length;
        if (burstTrades / timeGaps.length > 0.7) {
            timingPattern = "burst";
        } else if (this.detectCoordinatedTiming(timeGaps)) {
            timingPattern = "coordinated";
        } else {
            timingPattern = "uniform";
        }

        return {
            timingPattern,
            avgTimeBetweenTrades: avgTimeBetween,
        };
    }

    /**
     * Analyze flow characteristics and toxicity
     */
    private analyzeFlow(trades: IndividualTrade[]) {
        // Calculate directional persistence
        const directions = trades.map((t) => (t.isBuyerMaker ? -1 : 1)); // -1 for sell, 1 for buy
        let persistenceScore = 0;

        if (directions.length >= this.config.persistenceWindowSize) {
            const windowSize = Math.min(
                this.config.persistenceWindowSize,
                directions.length
            );

            for (let i = 0; i <= directions.length - windowSize; i++) {
                const window = directions.slice(i, i + windowSize);
                const sum = window.reduce((acc, dir) => acc + dir, 0);
                const persistence = Math.abs(sum) / windowSize;
                persistenceScore = Math.max(persistenceScore, persistence);
            }
        }

        // Calculate toxicity score based on multiple factors
        const sizeWeightedDirection =
            this.calculateSizeWeightedDirection(trades);
        const priceImpact = this.calculatePriceImpact(trades);
        const executionSpeed = this.calculateExecutionSpeed(trades);

        // Combine factors for toxicity score (0-1, higher = more toxic/informed)
        const toxicityScore = Math.min(
            1,
            persistenceScore * 0.4 +
                Math.abs(sizeWeightedDirection) * 0.3 +
                priceImpact * 0.2 +
                executionSpeed * 0.1
        );

        return {
            toxicityScore,
            directionalPersistence: persistenceScore,
        };
    }

    /**
     * Detect algorithmic trading patterns
     */
    private analyzeAlgorithmicPatterns(trades: IndividualTrade[]) {
        let suspectedAlgoType:
            | "market_making"
            | "iceberg"
            | "splitting"
            | "arbitrage"
            | "unknown" = "unknown";

        // Market making detection
        if (this.detectMarketMaking(trades)) {
            suspectedAlgoType = "market_making";
        }
        // Iceberg detection
        else if (this.detectIceberg(trades)) {
            suspectedAlgoType = "iceberg";
        }
        // Order splitting detection
        else if (this.detectOrderSplitting(trades)) {
            suspectedAlgoType = "splitting";
        }
        // Arbitrage detection
        else if (this.detectArbitrage(trades)) {
            suspectedAlgoType = "arbitrage";
        }

        return { suspectedAlgoType };
    }

    /**
     * Analyze coordination between multiple parties
     */
    private analyzeCoordination(trades: IndividualTrade[]) {
        const coordinationIndicators: CoordinationSignal[] = [];

        // Time-based coordination
        const timeCoordination = this.detectTimeCoordination(trades);
        if (timeCoordination) {
            coordinationIndicators.push(timeCoordination);
        }

        // Size-based coordination
        const sizeCoordination = this.detectSizeCoordination(trades);
        if (sizeCoordination) {
            coordinationIndicators.push(sizeCoordination);
        }

        // Price-based coordination
        const priceCoordination = this.detectPriceCoordination(trades);
        if (priceCoordination) {
            coordinationIndicators.push(priceCoordination);
        }

        return { coordinationIndicators };
    }

    // Helper methods for pattern detection

    private detectStructuredSizing(sizes: number[]): boolean {
        // Check for patterns like doubling, halving, or arithmetic progression
        if (sizes.length < 3) return false;

        // Check for arithmetic progression
        const diffs = [];
        for (let i = 1; i < sizes.length; i++) {
            diffs.push(sizes[i] - sizes[i - 1]);
        }

        const avgDiff =
            diffs.reduce((sum, diff) => sum + diff, 0) / diffs.length;
        const diffVariance =
            diffs.reduce((sum, diff) => sum + Math.pow(diff - avgDiff, 2), 0) /
            diffs.length;

        return Math.sqrt(diffVariance) < avgDiff * 0.1; // Low variance in differences
    }

    private detectCoordinatedTiming(timeGaps: number[]): boolean {
        // Look for suspicious timing patterns (e.g., exact intervals)
        const filteredGaps = timeGaps.filter((gap) => gap < 1000); // Focus on sub-second gaps
        if (filteredGaps.length === 0) return false; // No sub-second gaps to analyze

        const uniqueGaps = new Set(filteredGaps);
        return uniqueGaps.size < filteredGaps.length * 0.3; // Many repeated timing intervals
    }

    private detectMarketMaking(trades: IndividualTrade[]): boolean {
        // Market makers typically have alternating buy/sell and tight price ranges
        if (trades.length < 4) return false;

        const directions = trades.map((t) => t.isBuyerMaker);
        let alternations = 0;

        for (let i = 1; i < directions.length; i++) {
            if (directions[i] !== directions[i - 1]) {
                alternations++;
            }
        }

        const alternationRatio = alternations / (directions.length - 1);
        const priceRange =
            Math.max(...trades.map((t) => t.price)) -
            Math.min(...trades.map((t) => t.price));
        const avgPrice =
            trades.reduce((sum, t) => sum + t.price, 0) / trades.length;
        const relativeRange = priceRange / avgPrice;

        return (
            alternationRatio > 0.6 &&
            relativeRange < this.config.marketMakingSpreadThreshold
        );
    }

    private detectIceberg(trades: IndividualTrade[]): boolean {
        // Iceberg orders show consistent sizing with same direction
        if (trades.length < 3) return false;

        const sizes = trades.map((t) => t.quantity);
        const directions = trades.map((t) => t.isBuyerMaker);

        // Check for size consistency
        const avgSize =
            sizes.reduce((sum, size) => sum + size, 0) / sizes.length;
        const sizeConsistency =
            sizes.filter((size) => Math.abs(size - avgSize) / avgSize < 0.1)
                .length / sizes.length;

        // Check for directional consistency
        const buyCount = directions.filter((d) => !d).length;
        const directionalConsistency =
            Math.max(buyCount, directions.length - buyCount) /
            directions.length;

        return (
            sizeConsistency > this.config.icebergSizeRatio &&
            directionalConsistency > 0.8
        );
    }

    private detectOrderSplitting(trades: IndividualTrade[]): boolean {
        // Order splitting shows decreasing sizes or structured progression
        if (trades.length < 3) return false;

        const sizes = trades.map((t) => t.quantity);

        // Check for decreasing pattern
        let decreasingCount = 0;
        for (let i = 1; i < sizes.length; i++) {
            if (sizes[i] <= sizes[i - 1]) {
                decreasingCount++;
            }
        }

        return decreasingCount / (sizes.length - 1) > 0.7;
    }

    private detectArbitrage(trades: IndividualTrade[]): boolean {
        // Arbitrage typically shows rapid execution across different price levels
        if (trades.length < 2) return false;

        const timeRange =
            trades[trades.length - 1].timestamp - trades[0].timestamp;
        const priceRange =
            Math.max(...trades.map((t) => t.price)) -
            Math.min(...trades.map((t) => t.price));

        return timeRange < this.config.arbitrageTimeThreshold && priceRange > 0;
    }

    private detectTimeCoordination(
        trades: IndividualTrade[]
    ): CoordinationSignal | null {
        // Look for trades happening at suspiciously similar times
        const timeGroups = new Map<number, number>();

        for (const trade of trades) {
            const roundedTime = Math.floor(trade.timestamp / 1000) * 1000; // Round to nearest second
            timeGroups.set(roundedTime, (timeGroups.get(roundedTime) || 0) + 1);
        }

        const maxGroupSize = Math.max(...timeGroups.values());
        if (maxGroupSize > trades.length * 0.6) {
            return {
                type: "time_coordination",
                strength: maxGroupSize / trades.length,
                details: `${maxGroupSize} trades in same second window`,
            };
        }

        return null;
    }

    private detectSizeCoordination(
        trades: IndividualTrade[]
    ): CoordinationSignal | null {
        // Look for suspiciously similar trade sizes
        const sizeGroups = new Map<string, number>();

        for (const trade of trades) {
            const roundedSize = Math.round(trade.quantity * 100) / 100; // Round to 2 decimal places
            const sizeKey = roundedSize.toString();
            sizeGroups.set(sizeKey, (sizeGroups.get(sizeKey) || 0) + 1);
        }

        const maxGroupSize = Math.max(...sizeGroups.values());
        if (maxGroupSize > trades.length * 0.7) {
            return {
                type: "size_coordination",
                strength: maxGroupSize / trades.length,
                details: `${maxGroupSize} trades with identical size`,
            };
        }

        return null;
    }

    private detectPriceCoordination(
        trades: IndividualTrade[]
    ): CoordinationSignal | null {
        // Look for trades at identical prices (potential wash trading)
        const priceGroups = new Map<string, number>();

        for (const trade of trades) {
            const priceKey = trade.price.toFixed(2);
            priceGroups.set(priceKey, (priceGroups.get(priceKey) || 0) + 1);
        }

        const maxGroupSize = Math.max(...priceGroups.values());
        if (maxGroupSize > trades.length * 0.8 && trades.length > 2) {
            return {
                type: "price_coordination",
                strength: maxGroupSize / trades.length,
                details: `${maxGroupSize} trades at identical price`,
            };
        }

        return null;
    }

    private calculateSizeWeightedDirection(trades: IndividualTrade[]): number {
        let weightedSum = 0;
        let totalSize = 0;

        for (const trade of trades) {
            const direction = trade.isBuyerMaker ? -1 : 1; // -1 for sell, 1 for buy
            weightedSum += direction * trade.quantity;
            totalSize += trade.quantity;
        }

        return totalSize > 0 ? weightedSum / totalSize : 0;
    }

    private calculatePriceImpact(trades: IndividualTrade[]): number {
        if (trades.length < 2) return 0;

        const firstPrice = trades[0].price;
        const lastPrice = trades[trades.length - 1].price;
        const priceChange = Math.abs(lastPrice - firstPrice) / firstPrice;

        // Normalize price impact (0-1 scale)
        return Math.min(1, priceChange * 1000); // Multiply by 1000 to scale for typical crypto price changes
    }

    private calculateExecutionSpeed(trades: IndividualTrade[]): number {
        if (trades.length < 2) return 0;

        const timeRange =
            trades[trades.length - 1].timestamp - trades[0].timestamp;
        const avgTradeSize =
            trades.reduce((sum, t) => sum + t.quantity, 0) / trades.length;

        // Speed = size / time (normalized)
        const speed = avgTradeSize / Math.max(timeRange, 1);

        // Normalize to 0-1 scale
        return Math.min(1, speed / 100); // Adjust divisor based on typical values
    }

    private calculateExecutionEfficiency(trades: IndividualTrade[]): number {
        if (trades.length <= 1) return 1;

        // Efficiency = (ideal execution) / (actual execution complexity)
        const priceRange =
            Math.max(...trades.map((t) => t.price)) -
            Math.min(...trades.map((t) => t.price));
        const timeRange =
            trades[trades.length - 1].timestamp - trades[0].timestamp;

        // Lower fragmentation and shorter time = higher efficiency
        const fragmentationPenalty = trades.length / 10; // Penalty for too many pieces
        const timePenalty = timeRange / 10000; // Penalty for slow execution
        const pricePenalty = priceRange / trades[0].price; // Penalty for wide price range

        const efficiency =
            1 / (1 + fragmentationPenalty + timePenalty + pricePenalty);

        return Math.max(0, Math.min(1, efficiency));
    }

    private createEmptyMetrics(): MicrostructureMetrics {
        return {
            fragmentationScore: 0,
            avgTradeSize: 0,
            tradeSizeVariance: 0,
            timingPattern: "uniform",
            avgTimeBetweenTrades: 0,
            toxicityScore: 0,
            directionalPersistence: 0,
            suspectedAlgoType: "unknown",
            coordinationIndicators: [],
            sizingPattern: "consistent",
            executionEfficiency: 0,
        };
    }
}
