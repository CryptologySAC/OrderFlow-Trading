// test/framework/performanceBenchmark.ts

/**
 * Performance Benchmarking Framework
 * 
 * Provides comprehensive performance testing and validation for detector systems.
 * Measures latency, throughput, memory usage, and signal quality metrics.
 */

import { EventEmitter } from 'events';
import type { EnrichedTradeEvent } from '../../src/types/marketEvents.js';
import type { SignalCandidate } from '../../src/types/signalTypes.js';
import type { ILogger } from '../../src/infrastructure/loggerInterface.js';

export interface PerformanceMetrics {
    // Latency metrics (milliseconds)
    latency: {
        min: number;
        max: number;
        average: number;
        p50: number;
        p95: number;
        p99: number;
        samples: number[];
    };
    
    // Throughput metrics
    throughput: {
        tradesPerSecond: number;
        signalsPerSecond: number;
        eventsPerSecond: number;
        totalTrades: number;
        totalSignals: number;
        duration: number;
    };
    
    // Memory metrics (bytes)
    memory: {
        initial: number;
        peak: number;
        final: number;
        growth: number;
        growthPercentage: number;
        samples: Array<{ timestamp: number; usage: number }>;
    };
    
    // Signal quality metrics
    signalQuality: {
        totalSignals: number;
        confidenceDistribution: {
            low: number;    // 0.0-0.4
            medium: number; // 0.4-0.7
            high: number;   // 0.7-1.0
        };
        averageConfidence: number;
        validSignals: number; // Non-NaN, finite confidence
        invalidSignals: number;
    };
    
    // CPU and resource metrics
    resources: {
        cpuUsagePercent: number;
        gcPressure: number; // Allocation rate MB/s
        gcCollections: number;
    };
}

export interface BenchmarkConfig {
    // Test duration and samples
    maxDuration: number; // Maximum test duration in milliseconds
    sampleInterval: number; // Memory sampling interval in milliseconds
    
    // Performance thresholds (for validation)
    thresholds: {
        maxLatencyMs: number; // Maximum acceptable latency
        minThroughputTps: number; // Minimum trades per second
        maxMemoryGrowthMB: number; // Maximum memory growth
        maxMemoryGrowthPercent: number; // Maximum memory growth percentage
        minSignalConfidence: number; // Minimum expected signal confidence
    };
    
    // Warmup configuration
    warmupTrades: number; // Number of trades for warmup (excluded from metrics)
    collectGCStats: boolean; // Whether to collect GC statistics
}

export interface DetectorBenchmark {
    detectorName: string;
    detectorId: string;
    config: any; // Detector configuration
    instance: any; // Detector instance
}

/**
 * Performance Benchmark Engine
 */
export class PerformanceBenchmark extends EventEmitter {
    private benchmarkConfig: BenchmarkConfig;
    private logger: ILogger;
    private startTime = 0;
    private endTime = 0;
    private isRunning = false;
    
    // Metric collection
    private latencySamples: number[] = [];
    private memorySamples: Array<{ timestamp: number; usage: number }> = [];
    private signalSamples: SignalCandidate[] = [];
    private tradeCount = 0;
    private warmupComplete = false;
    
    // Memory tracking
    private initialMemory = 0;
    private peakMemory = 0;
    
    // GC tracking
    private initialGCStats: any = null;
    private gcCollections = 0;

    constructor(config: BenchmarkConfig, logger: ILogger) {
        super();
        this.benchmarkConfig = config;
        this.logger = logger;
    }

    /**
     * Run performance benchmark for a single detector
     */
    public async benchmarkDetector(
        detector: DetectorBenchmark,
        trades: EnrichedTradeEvent[]
    ): Promise<PerformanceMetrics> {
        this.logger.info('Starting detector performance benchmark', {
            component: 'PerformanceBenchmark',
            detectorName: detector.detectorName,
            totalTrades: trades.length,
            config: this.benchmarkConfig
        });

        await this.initializeBenchmark();
        
        try {
            return await this.runDetectorBenchmark(detector, trades);
        } finally {
            this.cleanup();
        }
    }

    /**
     * Compare performance across multiple detectors
     */
    public async comparativeeBenchmark(
        detectors: DetectorBenchmark[],
        trades: EnrichedTradeEvent[]
    ): Promise<Map<string, PerformanceMetrics>> {
        const results = new Map<string, PerformanceMetrics>();

        this.logger.info('Starting comparative benchmark', {
            component: 'PerformanceBenchmark',
            detectorCount: detectors.length,
            totalTrades: trades.length
        });

        for (const detector of detectors) {
            const metrics = await this.benchmarkDetector(detector, trades);
            results.set(detector.detectorName, metrics);
            
            // Allow GC between tests
            if (global.gc) {
                global.gc();
                await this.sleep(100);
            }
        }

        this.logComparativeResults(results);
        return results;
    }

    /**
     * Stress test with increasing load
     */
    public async stressTest(
        detector: DetectorBenchmark,
        baseTrades: EnrichedTradeEvent[],
        loadMultipliers: number[] = [1, 2, 5, 10]
    ): Promise<Map<number, PerformanceMetrics>> {
        const results = new Map<number, PerformanceMetrics>();

        this.logger.info('Starting stress test', {
            component: 'PerformanceBenchmark',
            detectorName: detector.detectorName,
            baseTradeCount: baseTrades.length,
            loadMultipliers
        });

        for (const multiplier of loadMultipliers) {
            // Create stress test data by duplicating and time-shifting trades
            const stressTrades = this.createStressTestData(baseTrades, multiplier);
            
            this.logger.info(`Running stress test - ${multiplier}x load`, {
                tradeCount: stressTrades.length,
                estimatedTps: stressTrades.length / (this.benchmarkConfig.maxDuration / 1000)
            });

            const metrics = await this.benchmarkDetector(detector, stressTrades);
            results.set(multiplier, metrics);

            // Check if system is degrading significantly
            if (multiplier > 1) {
                const baselineMetrics = results.get(1)!;
                const degradationRatio = metrics.latency.average / baselineMetrics.latency.average;
                
                if (degradationRatio > 5.0) {
                    this.logger.warn('Performance degradation detected, stopping stress test', {
                        multiplier,
                        degradationRatio,
                        currentLatency: metrics.latency.average,
                        baselineLatency: baselineMetrics.latency.average
                    });
                    break;
                }
            }

            // Allow system recovery between stress levels
            await this.sleep(1000);
            if (global.gc) {
                global.gc();
            }
        }

        return results;
    }

    /**
     * Initialize benchmark environment
     */
    private async initializeBenchmark(): Promise<void> {
        this.isRunning = true;
        this.startTime = Date.now();
        this.tradeCount = 0;
        this.warmupComplete = false;
        
        // Reset collections
        this.latencySamples = [];
        this.memorySamples = [];
        this.signalSamples = [];
        
        // Initialize memory tracking
        if (global.gc) {
            global.gc(); // Force GC to get clean baseline
            await this.sleep(100);
        }
        
        this.initialMemory = process.memoryUsage().heapUsed;
        this.peakMemory = this.initialMemory;
        
        // Initialize GC tracking
        if (this.benchmarkConfig.collectGCStats && (process as any).getHeapStatistics) {
            this.initialGCStats = (process as any).getHeapStatistics();
        }
        
        // Start memory sampling
        this.startMemorySampling();
    }

    /**
     * Run benchmark for a specific detector
     */
    private async runDetectorBenchmark(
        detector: DetectorBenchmark,
        trades: EnrichedTradeEvent[]
    ): Promise<PerformanceMetrics> {
        // Set up signal capture
        if (detector.instance.on) {
            detector.instance.on('signalCandidate', (signal: SignalCandidate) => {
                if (this.warmupComplete) {
                    this.signalSamples.push(signal);
                }
            });
        }

        const maxDuration = this.benchmarkConfig.maxDuration;
        const startTime = Date.now();

        // Process trades
        for (let i = 0; i < trades.length && this.isRunning; i++) {
            const trade = trades[i];
            
            // Check duration limit
            if (Date.now() - startTime > maxDuration) {
                this.logger.info('Benchmark duration limit reached', {
                    processedTrades: i,
                    totalTrades: trades.length,
                    duration: Date.now() - startTime
                });
                break;
            }

            // Process trade and measure latency
            const processingStart = performance.now();
            
            try {
                if (detector.instance.onEnrichedTrade) {
                    detector.instance.onEnrichedTrade(trade);
                } else if (detector.instance.detect) {
                    detector.instance.detect(trade);
                } else {
                    throw new Error(`Detector ${detector.detectorName} has no processable method`);
                }
            } catch (error) {
                this.logger.error('Error processing trade in benchmark', {
                    detectorName: detector.detectorName,
                    tradeIndex: i,
                    error: error instanceof Error ? error.message : String(error)
                });
                continue;
            }

            const processingTime = performance.now() - processingStart;
            
            // Track metrics after warmup
            this.tradeCount++;
            if (this.tradeCount >= this.benchmarkConfig.warmupTrades) {
                if (!this.warmupComplete) {
                    this.warmupComplete = true;
                    this.logger.debug('Warmup complete, starting metric collection');
                }
                this.latencySamples.push(processingTime);
            }

            // Update peak memory
            const currentMemory = process.memoryUsage().heapUsed;
            this.peakMemory = Math.max(this.peakMemory, currentMemory);

            // Periodic memory sample during test
            if (i % 100 === 0) {
                this.memorySamples.push({
                    timestamp: Date.now() - startTime,
                    usage: currentMemory
                });
            }
        }

        this.endTime = Date.now();
        return this.calculateMetrics();
    }

    /**
     * Calculate final performance metrics
     */
    private calculateMetrics(): PerformanceMetrics {
        const duration = this.endTime - this.startTime;
        const finalMemory = process.memoryUsage().heapUsed;
        
        // Calculate latency statistics
        const sortedLatencies = [...this.latencySamples].sort((a, b) => a - b);
        const latencyMetrics = {
            min: sortedLatencies[0] || 0,
            max: sortedLatencies[sortedLatencies.length - 1] || 0,
            average: this.latencySamples.reduce((a, b) => a + b, 0) / this.latencySamples.length || 0,
            p50: this.getPercentile(sortedLatencies, 0.5),
            p95: this.getPercentile(sortedLatencies, 0.95),
            p99: this.getPercentile(sortedLatencies, 0.99),
            samples: this.latencySamples
        };

        // Calculate throughput metrics
        const effectiveTrades = this.latencySamples.length; // Trades after warmup
        const throughputMetrics = {
            tradesPerSecond: effectiveTrades / (duration / 1000),
            signalsPerSecond: this.signalSamples.length / (duration / 1000),
            eventsPerSecond: (effectiveTrades + this.signalSamples.length) / (duration / 1000),
            totalTrades: effectiveTrades,
            totalSignals: this.signalSamples.length,
            duration
        };

        // Calculate memory metrics
        const memoryGrowth = finalMemory - this.initialMemory;
        const memoryMetrics = {
            initial: this.initialMemory,
            peak: this.peakMemory,
            final: finalMemory,
            growth: memoryGrowth,
            growthPercentage: (memoryGrowth / this.initialMemory) * 100,
            samples: this.memorySamples
        };

        // Calculate signal quality metrics
        const signalQualityMetrics = this.calculateSignalQuality();

        // Calculate resource metrics
        const resourceMetrics = this.calculateResourceMetrics(duration);

        return {
            latency: latencyMetrics,
            throughput: throughputMetrics,
            memory: memoryMetrics,
            signalQuality: signalQualityMetrics,
            resources: resourceMetrics
        };
    }

    /**
     * Calculate signal quality metrics
     */
    private calculateSignalQuality(): PerformanceMetrics['signalQuality'] {
        let validSignals = 0;
        let invalidSignals = 0;
        let confidenceSum = 0;
        const distribution = { low: 0, medium: 0, high: 0 };

        for (const signal of this.signalSamples) {
            if (Number.isFinite(signal.confidence) && !Number.isNaN(signal.confidence)) {
                validSignals++;
                confidenceSum += signal.confidence;
                
                if (signal.confidence < 0.4) {
                    distribution.low++;
                } else if (signal.confidence < 0.7) {
                    distribution.medium++;
                } else {
                    distribution.high++;
                }
            } else {
                invalidSignals++;
            }
        }

        return {
            totalSignals: this.signalSamples.length,
            confidenceDistribution: distribution,
            averageConfidence: validSignals > 0 ? confidenceSum / validSignals : 0,
            validSignals,
            invalidSignals
        };
    }

    /**
     * Calculate resource utilization metrics
     */
    private calculateResourceMetrics(duration: number): PerformanceMetrics['resources'] {
        // Simplified resource metrics (can be enhanced with actual CPU monitoring)
        const gcPressure = this.memorySamples.length > 1 
            ? (this.peakMemory - this.initialMemory) / (duration / 1000) / (1024 * 1024) // MB/s
            : 0;

        return {
            cpuUsagePercent: 0, // Would need external monitoring
            gcPressure,
            gcCollections: this.gcCollections
        };
    }

    /**
     * Start periodic memory sampling
     */
    private startMemorySampling(): void {
        const sampleInterval = setInterval(() => {
            if (!this.isRunning) {
                clearInterval(sampleInterval);
                return;
            }

            const currentMemory = process.memoryUsage().heapUsed;
            this.memorySamples.push({
                timestamp: Date.now() - this.startTime,
                usage: currentMemory
            });
            
            this.peakMemory = Math.max(this.peakMemory, currentMemory);
        }, this.benchmarkConfig.sampleInterval);
    }

    /**
     * Create stress test data by multiplying and time-shifting base trades
     */
    private createStressTestData(baseTrades: EnrichedTradeEvent[], multiplier: number): EnrichedTradeEvent[] {
        const stressTrades: EnrichedTradeEvent[] = [];
        const timeStep = 1000 / multiplier; // Compress time to increase throughput

        for (let mult = 0; mult < multiplier; mult++) {
            for (let i = 0; i < baseTrades.length; i++) {
                const baseTrade = baseTrades[i];
                const newTrade: EnrichedTradeEvent = {
                    ...baseTrade,
                    tradeId: `${baseTrade.tradeId}_${mult}`,
                    timestamp: baseTrade.timestamp + (mult * timeStep) + (i * timeStep / baseTrades.length)
                };
                stressTrades.push(newTrade);
            }
        }

        return stressTrades.sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Calculate percentile from sorted array
     */
    private getPercentile(sortedArray: number[], percentile: number): number {
        if (sortedArray.length === 0) return 0;
        
        const index = Math.floor(percentile * (sortedArray.length - 1));
        return sortedArray[index];
    }

    /**
     * Log comparative benchmark results
     */
    private logComparativeResults(results: Map<string, PerformanceMetrics>): void {
        this.logger.info('Comparative benchmark results', {
            component: 'PerformanceBenchmark',
            detectorCount: results.size,
            summary: Array.from(results.entries()).map(([name, metrics]) => ({
                detector: name,
                avgLatency: metrics.latency.average,
                throughput: metrics.throughput.tradesPerSecond,
                memoryGrowthMB: metrics.memory.growth / (1024 * 1024),
                signalCount: metrics.signalQuality.totalSignals,
                avgConfidence: metrics.signalQuality.averageConfidence
            }))
        });
    }

    /**
     * Cleanup benchmark resources
     */
    private cleanup(): void {
        this.isRunning = false;
    }

    /**
     * Sleep utility
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/**
 * Benchmark Results Validator
 */
export class BenchmarkValidator {
    /**
     * Validate performance metrics against thresholds
     */
    public static validateMetrics(
        metrics: PerformanceMetrics,
        thresholds: BenchmarkConfig['thresholds']
    ): { passed: boolean; violations: string[] } {
        const violations: string[] = [];

        // Latency validation
        if (metrics.latency.p99 > thresholds.maxLatencyMs) {
            violations.push(`P99 latency ${metrics.latency.p99.toFixed(2)}ms exceeds threshold ${thresholds.maxLatencyMs}ms`);
        }

        // Throughput validation
        if (metrics.throughput.tradesPerSecond < thresholds.minThroughputTps) {
            violations.push(`Throughput ${metrics.throughput.tradesPerSecond.toFixed(2)} TPS below threshold ${thresholds.minThroughputTps} TPS`);
        }

        // Memory validation
        const memoryGrowthMB = metrics.memory.growth / (1024 * 1024);
        if (memoryGrowthMB > thresholds.maxMemoryGrowthMB) {
            violations.push(`Memory growth ${memoryGrowthMB.toFixed(2)}MB exceeds threshold ${thresholds.maxMemoryGrowthMB}MB`);
        }

        if (metrics.memory.growthPercentage > thresholds.maxMemoryGrowthPercent) {
            violations.push(`Memory growth ${metrics.memory.growthPercentage.toFixed(2)}% exceeds threshold ${thresholds.maxMemoryGrowthPercent}%`);
        }

        // Signal quality validation
        if (metrics.signalQuality.averageConfidence < thresholds.minSignalConfidence) {
            violations.push(`Average signal confidence ${metrics.signalQuality.averageConfidence.toFixed(3)} below threshold ${thresholds.minSignalConfidence}`);
        }

        return {
            passed: violations.length === 0,
            violations
        };
    }

    /**
     * Generate performance report
     */
    public static generateReport(
        detectorName: string,
        metrics: PerformanceMetrics,
        thresholds: BenchmarkConfig['thresholds']
    ): string {
        const validation = this.validateMetrics(metrics, thresholds);
        
        const report = [
            `## Performance Report: ${detectorName}`,
            ``,
            `### Latency Metrics`,
            `- Average: ${metrics.latency.average.toFixed(2)}ms`,
            `- P95: ${metrics.latency.p95.toFixed(2)}ms`,
            `- P99: ${metrics.latency.p99.toFixed(2)}ms`,
            `- Max: ${metrics.latency.max.toFixed(2)}ms`,
            ``,
            `### Throughput Metrics`,
            `- Trades/Second: ${metrics.throughput.tradesPerSecond.toFixed(2)}`,
            `- Signals/Second: ${metrics.throughput.signalsPerSecond.toFixed(2)}`,
            `- Total Trades: ${metrics.throughput.totalTrades}`,
            `- Duration: ${(metrics.throughput.duration / 1000).toFixed(2)}s`,
            ``,
            `### Memory Metrics`,
            `- Growth: ${(metrics.memory.growth / (1024 * 1024)).toFixed(2)}MB (${metrics.memory.growthPercentage.toFixed(2)}%)`,
            `- Peak: ${(metrics.memory.peak / (1024 * 1024)).toFixed(2)}MB`,
            ``,
            `### Signal Quality`,
            `- Total Signals: ${metrics.signalQuality.totalSignals}`,
            `- Average Confidence: ${metrics.signalQuality.averageConfidence.toFixed(3)}`,
            `- High Confidence: ${metrics.signalQuality.confidenceDistribution.high}`,
            `- Invalid Signals: ${metrics.signalQuality.invalidSignals}`,
            ``,
            `### Validation`,
            validation.passed ? `✅ All thresholds passed` : `❌ ${validation.violations.length} violations:`
        ];

        if (!validation.passed) {
            report.push(...validation.violations.map(v => `- ${v}`));
        }

        return report.join('\n');
    }
}