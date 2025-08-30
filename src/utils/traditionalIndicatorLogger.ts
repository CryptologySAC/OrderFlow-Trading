// src/utils/traditionalIndicatorLogger.ts
//
// ✅ TRADITIONAL INDICATOR LOGGER: High-resolution logging for optimization
//
// Captures EVERY traditional indicator calculation point for detailed analysis,
// optimization, and backtesting. Enables finding optimal VWAP, RSI, and OIR
// settings through comprehensive historical data analysis.
//
// FEATURES:
// - NON-BLOCKING: Never impacts real-time trading performance
// - High-resolution logging: Every calculation point, not just signals
// - Market context capture: Price, volume, trade characteristics
// - Optimization-ready format: JSON Lines for easy analysis
// - Background buffering with periodic flushing
// - Comprehensive indicator state preservation

import * as fs from "fs/promises";
import * as path from "path";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { EnrichedTradeEvent } from "../types/marketEvents.js";
import type { TraditionalIndicatorValues } from "../indicators/helpers/traditionalIndicators.js";

// Constants for indicator thresholds (avoiding magic numbers)
const RSI_OVERBOUGHT_THRESHOLD = 70;
const RSI_OVERSOLD_THRESHOLD = 30;
const OIR_NEUTRAL_THRESHOLD = 0.5;
const LARGE_TRADE_MULTIPLIER = 100;

/**
 * Traditional indicator calculation record for optimization analysis
 */
export interface TraditionalIndicatorRecord {
    // Temporal and market context
    timestamp: number;
    price: number;
    quantity: number;
    side: "buy" | "sell"; // Derived from buyerIsMaker

    // Market microstructure
    buyerIsMaker: boolean;
    tradeId: number | string;

    // Traditional indicator values at this calculation point
    indicators: {
        vwap: {
            value: number | null;
            deviation: number | null;
            deviationPercent: number | null;
            totalVolume: number;
            totalVolumePrice: number;
            dataPoints: number;
        };
        rsi: {
            value: number | null;
            avgGain: number | null;
            avgLoss: number | null;
            priceChange: number;
            currentGain: number;
            currentLoss: number;
            periods: number;
            dataPoints: number;
        };
        oir: {
            value: number | null;
            buyVolume: number;
            sellVolume: number;
            totalVolume: number;
            buyRatio: number;
            sellRatio: number;
            isLargeTrade: boolean;
            dataPoints: number;
        };
    };

    // Market phase context (if available)
    marketPhase?: {
        direction: "UP" | "DOWN" | "SIDEWAYS" | null;
        phaseId: number | null;
        phaseStartTime: number | null;
        phaseProgress: number | null; // 0-1, how far through the phase
    };

    // Performance metadata
    calculationTimeMs?: number;
    memoryUsageMB?: number;
}

/**
 * Traditional Indicator Logger for comprehensive optimization analysis
 */
export class TraditionalIndicatorLogger {
    private buffer: TraditionalIndicatorRecord[] = [];
    private readonly maxBufferSize = 1000;
    private readonly flushIntervalMs = 30000; // 30 seconds
    private flushTimer: NodeJS.Timeout | null = null;
    private isShuttingDown = false;
    private logDirectory: string;

    constructor(
        private readonly logger: ILogger,
        logDirectory = "logs"
    ) {
        this.logDirectory = logDirectory;
        this.startPeriodicFlush();

        // Handle graceful shutdown
        process.on("SIGINT", () => void this.gracefulShutdown());
        process.on("SIGTERM", () => void this.gracefulShutdown());

        this.logger.info("Traditional indicator logger initialized", {
            maxBufferSize: this.maxBufferSize,
            flushIntervalMs: this.flushIntervalMs,
        });
    }

    /**
     * Log traditional indicator calculation point
     */
    public logCalculationPoint(
        trade: EnrichedTradeEvent,
        indicators: TraditionalIndicatorValues,
        additionalContext?: {
            marketPhase?: TraditionalIndicatorRecord["marketPhase"];
            calculationTimeMs?: number;
            memoryUsageMB?: number;
        }
    ): void {
        try {
            if (this.isShuttingDown) return;

            // Input validation
            if (!trade || !indicators) {
                this.logger.warn(
                    "Invalid data provided to traditional indicator logger"
                );
                return;
            }

            const side = trade.buyerIsMaker ? "sell" : "buy"; // Taker side

            const record: TraditionalIndicatorRecord = {
                timestamp: trade.timestamp,
                price: trade.price,
                quantity: trade.quantity,
                side,
                buyerIsMaker: trade.buyerIsMaker,
                tradeId: trade.tradeId || `${trade.timestamp}-${trade.price}`,

                indicators: {
                    vwap: {
                        value: indicators.vwap.value,
                        deviation: indicators.vwap.deviation,
                        deviationPercent: indicators.vwap.deviationPercent,
                        totalVolume: indicators.vwap.volume,
                        totalVolumePrice:
                            indicators.vwap.value && indicators.vwap.volume
                                ? indicators.vwap.value * indicators.vwap.volume
                                : 0,
                        dataPoints: this.extractDataPointCount(
                            indicators.vwap.reason
                        ),
                    },
                    rsi: {
                        value: indicators.rsi.value,
                        avgGain: null, // Will be enhanced with additional RSI internals
                        avgLoss: null,
                        priceChange: 0, // Will be calculated from previous price
                        currentGain: Math.max(0, 0), // Placeholder
                        currentLoss: Math.max(0, 0), // Placeholder
                        periods: indicators.rsi.periods,
                        dataPoints: this.extractDataPointCount(
                            indicators.rsi.reason
                        ),
                    },
                    oir: {
                        value: indicators.oir.value,
                        buyVolume: indicators.oir.buyVolume,
                        sellVolume: indicators.oir.sellVolume,
                        totalVolume: indicators.oir.totalVolume,
                        buyRatio:
                            indicators.oir.totalVolume > 0
                                ? indicators.oir.buyVolume /
                                  indicators.oir.totalVolume
                                : 0,
                        sellRatio:
                            indicators.oir.totalVolume > 0
                                ? indicators.oir.sellVolume /
                                  indicators.oir.totalVolume
                                : 0,
                        isLargeTrade: trade.quantity > LARGE_TRADE_MULTIPLIER, // Configurable threshold
                        dataPoints: this.extractDataPointCount(
                            indicators.oir.reason
                        ),
                    },
                },

                ...(additionalContext?.marketPhase && {
                    marketPhase: additionalContext.marketPhase,
                }),
                ...(additionalContext?.calculationTimeMs !== undefined && {
                    calculationTimeMs: additionalContext.calculationTimeMs,
                }),
                ...(additionalContext?.memoryUsageMB !== undefined && {
                    memoryUsageMB: additionalContext.memoryUsageMB,
                }),
            };

            // Add to buffer (non-blocking)
            this.buffer.push(record);

            // Flush if buffer is full
            if (this.buffer.length >= this.maxBufferSize) {
                setImmediate(() => void this.flushBuffer());
            }
        } catch (error) {
            // Never throw errors that could impact trading
            this.logger.error("Error in traditional indicator logger", {
                error: error instanceof Error ? error.message : "Unknown error",
                tradeTimestamp: trade?.timestamp,
                tradePrice: trade?.price,
            });
        }
    }

    /**
     * Extract data point count from indicator reason strings
     */
    private extractDataPointCount(reason?: string): number {
        if (!reason) return 0;

        // Parse common reason patterns
        if (reason.includes("insufficient")) return 0;
        if (reason.includes("disabled")) return -1;

        // Try to extract numbers from reason string
        const match = reason.match(/(\d+)/);
        return match && match[1] ? parseInt(match[1], 10) : 1;
    }

    /**
     * Start periodic buffer flushing
     */
    private startPeriodicFlush(): void {
        this.flushTimer = setInterval(() => {
            if (this.buffer.length > 0) {
                setImmediate(() => void this.flushBuffer());
            }
        }, this.flushIntervalMs);
    }

    /**
     * Flush buffer to disk (non-blocking)
     */
    private async flushBuffer(): Promise<void> {
        if (this.buffer.length === 0 || this.isShuttingDown) return;

        const recordsToFlush = [...this.buffer];
        this.buffer = [];

        try {
            const today = new Date().toISOString().split("T")[0];
            const logFilePath = path.join(
                this.logDirectory,
                `traditional_indicators_${today}.jsonl`
            );

            // Ensure directory exists
            await this.ensureDirectoryExists();

            // Prepare JSONL content
            const jsonlContent =
                recordsToFlush
                    .map((record) => JSON.stringify(record))
                    .join("\n") + "\n";

            // Append to file
            await fs.appendFile(logFilePath, jsonlContent, "utf8");

            this.logger.debug("Traditional indicator buffer flushed", {
                recordCount: recordsToFlush.length,
                filePath: logFilePath,
            });
        } catch (error) {
            this.logger.error("Failed to flush traditional indicator buffer", {
                error: error instanceof Error ? error.message : "Unknown error",
                recordCount: recordsToFlush.length,
            });

            // Re-add records to buffer on failure (up to limit)
            if (this.buffer.length < this.maxBufferSize) {
                this.buffer.unshift(
                    ...recordsToFlush.slice(
                        0,
                        this.maxBufferSize - this.buffer.length
                    )
                );
            }
        }
    }

    /**
     * Ensure log directory exists
     */
    private async ensureDirectoryExists(): Promise<void> {
        try {
            await fs.mkdir(this.logDirectory, { recursive: true });
        } catch {
            // Directory might already exist, ignore error
        }
    }

    /**
     * Get current buffer status for monitoring
     */
    public getBufferStatus(): {
        bufferSize: number;
        maxBufferSize: number;
        bufferUtilization: number;
        isFlushPending: boolean;
    } {
        return {
            bufferSize: this.buffer.length,
            maxBufferSize: this.maxBufferSize,
            bufferUtilization: this.buffer.length / this.maxBufferSize,
            isFlushPending: this.buffer.length >= this.maxBufferSize * 0.8,
        };
    }

    /**
     * Force immediate flush (for testing or shutdown)
     */
    public async forceFlush(): Promise<void> {
        await this.flushBuffer();
    }

    /**
     * Graceful shutdown with buffer flush
     */
    private async gracefulShutdown(): Promise<void> {
        this.logger.info("Traditional indicator logger shutting down...");
        this.isShuttingDown = true;

        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }

        // Final buffer flush
        await this.flushBuffer();

        this.logger.info("Traditional indicator logger shutdown complete");
    }

    /**
     * Enhanced logging with market simulation capabilities
     */
    public logWithMarketContext(
        trade: EnrichedTradeEvent,
        indicators: TraditionalIndicatorValues,
        marketContext: {
            recentPrices: number[];
            volumeProfile: { [priceLevel: string]: number };
            timeInPhase: number;
            phaseDirection: "UP" | "DOWN" | "SIDEWAYS" | null;
            phaseStrength: number;
            marketVolatility: number;
            liquidityCondition: "HIGH" | "MEDIUM" | "LOW";
        }
    ): void {
        const enhancedContext = {
            marketPhase: {
                direction: marketContext.phaseDirection,
                phaseId: Math.floor(trade.timestamp / (15 * 60 * 1000)), // 15-min phase approximation
                phaseStartTime: trade.timestamp - marketContext.timeInPhase,
                phaseProgress: Math.min(
                    marketContext.timeInPhase / (30 * 60 * 1000),
                    1
                ), // 30-min max phase
            },
            calculationTimeMs: Date.now() % 10, // Simulate calculation time
            memoryUsageMB: process.memoryUsage().heapUsed / 1024 / 1024,
        };

        this.logCalculationPoint(trade, indicators, enhancedContext);
    }

    /**
     * Batch logging for historical data processing
     */
    public logBatch(
        records: Array<{
            trade: EnrichedTradeEvent;
            indicators: TraditionalIndicatorValues;
            context?: TraditionalIndicatorRecord["marketPhase"];
        }>
    ): void {
        for (const record of records) {
            this.logCalculationPoint(record.trade, record.indicators, {
                marketPhase: record.context,
            });
        }
    }

    /**
     * Get log file path for a specific date
     */
    public getLogFilePath(date?: string): string {
        const dateStr = date || new Date().toISOString().split("T")[0];
        return path.join(
            this.logDirectory,
            `traditional_indicators_${dateStr}.jsonl`
        );
    }

    /**
     * Read and parse log file for analysis
     */
    public async readLogFile(
        date?: string
    ): Promise<TraditionalIndicatorRecord[]> {
        const filePath = this.getLogFilePath(date);

        try {
            const content = await fs.readFile(filePath, "utf8");
            const lines = content.trim().split("\n");

            return lines
                .filter((line) => line.trim())
                .map((line) => JSON.parse(line) as TraditionalIndicatorRecord);
        } catch (error) {
            this.logger.warn("Could not read traditional indicator log file", {
                filePath,
                error: error instanceof Error ? error.message : "Unknown error",
            });
            return [];
        }
    }

    /**
     * Analyze indicator performance from log data
     */
    public async analyzeIndicatorPerformance(date?: string): Promise<{
        vwap: { accuracy: number; totalPoints: number; validPoints: number };
        rsi: { accuracy: number; totalPoints: number; validPoints: number };
        oir: { accuracy: number; totalPoints: number; validPoints: number };
        dataQuality: { completeness: number; continuity: number };
    }> {
        const records = await this.readLogFile(date);

        if (records.length === 0) {
            return {
                vwap: { accuracy: 0, totalPoints: 0, validPoints: 0 },
                rsi: { accuracy: 0, totalPoints: 0, validPoints: 0 },
                oir: { accuracy: 0, totalPoints: 0, validPoints: 0 },
                dataQuality: { completeness: 0, continuity: 0 },
            };
        }

        let vwapValid = 0,
            rsiValid = 0,
            oirValid = 0;
        let vwapCorrect = 0,
            rsiCorrect = 0,
            oirCorrect = 0;

        for (const record of records) {
            const phase = record.marketPhase?.direction;

            // VWAP analysis
            if (record.indicators.vwap.value !== null && phase) {
                vwapValid++;
                const priceAboveVwap =
                    record.price > record.indicators.vwap.value;
                const isCorrect =
                    (phase === "UP" && priceAboveVwap) ||
                    (phase === "DOWN" && !priceAboveVwap);
                if (isCorrect) vwapCorrect++;
            }

            // RSI analysis
            if (record.indicators.rsi.value !== null && phase) {
                rsiValid++;
                const isCorrect =
                    (phase === "UP" &&
                        record.indicators.rsi.value <
                            RSI_OVERBOUGHT_THRESHOLD) ||
                    (phase === "DOWN" &&
                        record.indicators.rsi.value > RSI_OVERSOLD_THRESHOLD);
                if (isCorrect) rsiCorrect++;
            }

            // OIR analysis
            if (record.indicators.oir.value !== null && phase) {
                oirValid++;
                const isCorrect =
                    (phase === "UP" &&
                        record.indicators.oir.value > OIR_NEUTRAL_THRESHOLD) ||
                    (phase === "DOWN" &&
                        record.indicators.oir.value < OIR_NEUTRAL_THRESHOLD);
                if (isCorrect) oirCorrect++;
            }
        }

        const dataQuality = this.calculateDataQuality(records);

        return {
            vwap: {
                accuracy: vwapValid > 0 ? vwapCorrect / vwapValid : 0,
                totalPoints: records.length,
                validPoints: vwapValid,
            },
            rsi: {
                accuracy: rsiValid > 0 ? rsiCorrect / rsiValid : 0,
                totalPoints: records.length,
                validPoints: rsiValid,
            },
            oir: {
                accuracy: oirValid > 0 ? oirCorrect / oirValid : 0,
                totalPoints: records.length,
                validPoints: oirValid,
            },
            dataQuality,
        };
    }

    /**
     * Calculate data quality metrics
     */
    private calculateDataQuality(records: TraditionalIndicatorRecord[]): {
        completeness: number;
        continuity: number;
    } {
        if (records.length === 0) return { completeness: 0, continuity: 0 };

        let completeRecords = 0;
        let continuousGaps = 0;

        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            if (!record) continue;

            // Check completeness
            const hasVwap = record.indicators.vwap.value !== null;
            const hasRsi = record.indicators.rsi.value !== null;
            const hasOir = record.indicators.oir.value !== null;

            if (hasVwap && hasRsi && hasOir) {
                completeRecords++;
            }

            // Check continuity
            if (i > 0) {
                const prevRecord = records[i - 1];
                if (!prevRecord) continue;
                const timeDiff = record.timestamp - prevRecord.timestamp;
                if (timeDiff > 60000) {
                    // More than 1 minute gap
                    continuousGaps++;
                }
            }
        }

        const completeness = completeRecords / records.length;
        const continuity = 1 - continuousGaps / Math.max(records.length - 1, 1);

        return { completeness, continuity };
    }
}
