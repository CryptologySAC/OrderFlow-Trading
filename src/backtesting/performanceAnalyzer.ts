// src/backtesting/performanceAnalyzer.ts

export interface PriceMovement {
    timestamp: number;
    price: number;
    percentChange: number;
    direction: "up" | "down";
}

export interface DetectorSignal {
    timestamp: number;
    detectorType: string;
    configId: string;
    side: "buy" | "sell";
    confidence: number;
    price: number;
    data: Record<string, unknown>;
}

export interface SignalPerformance {
    configId: string;
    detectorType: string;

    // Core metrics
    totalSignals: number;
    truePositives: number;
    falsePositives: number;
    missedMovements: number;

    // Calculated metrics
    precision: number; // TP / (TP + FP)
    recall: number; // TP / (TP + FN)
    f1Score: number; // 2 * (precision * recall) / (precision + recall)
    accuracy: number; // (TP + TN) / (TP + TN + FP + FN)

    // Direction accuracy
    correctDirection: number;
    wrongDirection: number;
    directionAccuracy: number; // Percentage of signals with correct direction

    // Timing analysis
    avgSignalToMovementDelay: number; // Average time from signal to movement
    medianSignalToMovementDelay: number;
    avgSignalConfidence: number;

    // Performance breakdown
    performanceByDirection: {
        up: { signals: number; correct: number; accuracy: number };
        down: { signals: number; correct: number; accuracy: number };
    };

    // Signal quality
    signalFrequency: number; // Signals per hour
    duplicateSignals: number; // Signals too close to each other

    // Movement correlation
    correlatedMovements: Array<{
        signalTimestamp: number;
        movementTimestamp: number;
        delay: number;
        signalPrice: number;
        movementPrice: number;
        signalDirection: "buy" | "sell";
        movementDirection: "up" | "down";
        correct: boolean;
    }>;
}

export interface PerformanceAnalyzerConfig {
    movementThreshold: number; // Minimum % change to consider a movement (default: 0.7)
    maxSignalToMovementDelay: number; // Max time between signal and movement (default: 30 minutes)
    signalCooldown: number; // Minimum time between duplicate signals (default: 5 minutes)
    lookAheadWindows: number[]; // Time windows to check for movements (default: [5, 15, 30] minutes)
}

/**
 * Performance Analyzer for Detector Backtesting
 *
 * Analyzes detector signals against actual price movements to measure:
 * - How many movements they predict correctly (true positives)
 * - How many movements they miss (false negatives)
 * - How many false signals they generate (false positives)
 * - Direction accuracy and timing precision
 */
export class PerformanceAnalyzer {
    private config: PerformanceAnalyzerConfig;
    private priceMovements: PriceMovement[] = [];
    private signals: DetectorSignal[] = [];
    private performanceResults = new Map<string, SignalPerformance>();

    constructor(config: Partial<PerformanceAnalyzerConfig> = {}) {
        this.config = {
            movementThreshold: 0.7,
            maxSignalToMovementDelay: 30 * 60 * 1000, // 30 minutes
            signalCooldown: 5 * 60 * 1000, // 5 minutes
            lookAheadWindows: [5 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000], // 5, 15, 30 minutes
            ...config,
        };
    }

    /**
     * Record a price movement for analysis
     */
    public recordPriceMovement(movement: PriceMovement): void {
        this.priceMovements.push(movement);

        // Keep movements sorted by timestamp for efficient processing
        this.priceMovements.sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Record a detector signal for analysis
     */
    public recordSignal(signal: DetectorSignal): void {
        this.signals.push(signal);

        // Keep signals sorted by timestamp for efficient processing
        this.signals.sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Analyze performance for all recorded signals and movements
     */
    public analyzePerformance(): Map<string, SignalPerformance> {
        this.performanceResults.clear();

        // Group signals by configuration
        const signalsByConfig = this.groupSignalsByConfig();

        // Analyze each configuration
        for (const [configId, configSignals] of signalsByConfig) {
            const performance = this.analyzeConfigurationPerformance(
                configId,
                configSignals
            );
            this.performanceResults.set(configId, performance);
        }

        return new Map(this.performanceResults);
    }

    /**
     * Group signals by configuration ID
     */
    private groupSignalsByConfig(): Map<string, DetectorSignal[]> {
        const grouped = new Map<string, DetectorSignal[]>();

        for (const signal of this.signals) {
            if (!grouped.has(signal.configId)) {
                grouped.set(signal.configId, []);
            }
            grouped.get(signal.configId)!.push(signal);
        }

        return grouped;
    }

    /**
     * Analyze performance for a specific configuration
     */
    private analyzeConfigurationPerformance(
        configId: string,
        signals: DetectorSignal[]
    ): SignalPerformance {
        // Filter out duplicate signals (within cooldown period)
        const filteredSignals = this.filterDuplicateSignals(signals);
        const duplicateCount = signals.length - filteredSignals.length;

        // Find correlations between signals and movements
        const correlations =
            this.findSignalMovementCorrelations(filteredSignals);

        // Calculate metrics
        const truePositives = correlations.filter((c) => c.correct).length;
        const falsePositives = filteredSignals.length - truePositives;

        // Find missed movements (movements without preceding signals)
        const missedMovements = this.findMissedMovements(filteredSignals);

        // Calculate performance metrics
        const precision =
            truePositives > 0
                ? truePositives / (truePositives + falsePositives)
                : 0;
        const recall =
            truePositives > 0
                ? truePositives / (truePositives + missedMovements)
                : 0;
        const f1Score =
            precision + recall > 0
                ? (2 * (precision * recall)) / (precision + recall)
                : 0;

        // Direction accuracy
        const correctDirection = correlations.filter((c) => c.correct).length;
        const wrongDirection = correlations.filter((c) => !c.correct).length;
        const directionAccuracy =
            correlations.length > 0
                ? correctDirection / correlations.length
                : 0;

        // Timing analysis
        const delays = correlations.map((c) => c.delay);
        const avgDelay =
            delays.length > 0
                ? delays.reduce((sum, d) => sum + d, 0) / delays.length
                : 0;
        const medianDelay =
            delays.length > 0 ? this.calculateMedian(delays) : 0;

        // Confidence analysis
        const avgConfidence =
            filteredSignals.length > 0
                ? filteredSignals.reduce((sum, s) => sum + s.confidence, 0) /
                  filteredSignals.length
                : 0;

        // Performance by direction
        const buySignals = filteredSignals.filter((s) => s.side === "buy");
        const sellSignals = filteredSignals.filter((s) => s.side === "sell");

        const buyCorrelations = correlations.filter(
            (c) => c.signalDirection === "buy"
        );
        const sellCorrelations = correlations.filter(
            (c) => c.signalDirection === "sell"
        );

        const performanceByDirection = {
            up: {
                signals: buySignals.length,
                correct: buyCorrelations.filter((c) => c.correct).length,
                accuracy:
                    buySignals.length > 0
                        ? buyCorrelations.filter((c) => c.correct).length /
                          buySignals.length
                        : 0,
            },
            down: {
                signals: sellSignals.length,
                correct: sellCorrelations.filter((c) => c.correct).length,
                accuracy:
                    sellSignals.length > 0
                        ? sellCorrelations.filter((c) => c.correct).length /
                          sellSignals.length
                        : 0,
            },
        };

        // Signal frequency (signals per hour)
        const timeSpan =
            filteredSignals.length > 0
                ? (filteredSignals[filteredSignals.length - 1].timestamp -
                      filteredSignals[0].timestamp) /
                  (1000 * 60 * 60)
                : 1;
        const signalFrequency = filteredSignals.length / timeSpan;

        // Accuracy calculation (considering true negatives)
        const totalMovements = this.priceMovements.length;
        const trueNegatives = Math.max(
            0,
            totalMovements - truePositives - falsePositives - missedMovements
        );
        const accuracy =
            totalMovements > 0
                ? (truePositives + trueNegatives) /
                  (truePositives +
                      trueNegatives +
                      falsePositives +
                      missedMovements)
                : 0;

        return {
            configId,
            detectorType: filteredSignals[0]?.detectorType || "unknown",
            totalSignals: filteredSignals.length,
            truePositives,
            falsePositives,
            missedMovements,
            precision,
            recall,
            f1Score,
            accuracy,
            correctDirection,
            wrongDirection,
            directionAccuracy,
            avgSignalToMovementDelay: avgDelay,
            medianSignalToMovementDelay: medianDelay,
            avgSignalConfidence: avgConfidence,
            performanceByDirection,
            signalFrequency,
            duplicateSignals: duplicateCount,
            correlatedMovements: correlations,
        };
    }

    /**
     * Filter out duplicate signals within cooldown period
     */
    private filterDuplicateSignals(
        signals: DetectorSignal[]
    ): DetectorSignal[] {
        const filtered: DetectorSignal[] = [];

        for (const signal of signals) {
            const lastSignal = filtered[filtered.length - 1];
            if (
                !lastSignal ||
                signal.timestamp - lastSignal.timestamp >=
                    this.config.signalCooldown
            ) {
                filtered.push(signal);
            }
        }

        return filtered;
    }

    /**
     * Find correlations between signals and subsequent movements
     */
    private findSignalMovementCorrelations(signals: DetectorSignal[]): Array<{
        signalTimestamp: number;
        movementTimestamp: number;
        delay: number;
        signalPrice: number;
        movementPrice: number;
        signalDirection: "buy" | "sell";
        movementDirection: "up" | "down";
        correct: boolean;
    }> {
        const correlations: Array<{
            signalTimestamp: number;
            movementTimestamp: number;
            delay: number;
            signalPrice: number;
            movementPrice: number;
            signalDirection: "buy" | "sell";
            movementDirection: "up" | "down";
            correct: boolean;
        }> = [];

        for (const signal of signals) {
            // Find the next significant movement after this signal
            const subsequentMovement = this.findNextMovement(signal.timestamp);

            if (
                subsequentMovement &&
                subsequentMovement.timestamp - signal.timestamp <=
                    this.config.maxSignalToMovementDelay
            ) {
                const delay = subsequentMovement.timestamp - signal.timestamp;
                const correct = this.isSignalCorrect(
                    signal.side,
                    subsequentMovement.direction
                );

                correlations.push({
                    signalTimestamp: signal.timestamp,
                    movementTimestamp: subsequentMovement.timestamp,
                    delay,
                    signalPrice: signal.price,
                    movementPrice: subsequentMovement.price,
                    signalDirection: signal.side,
                    movementDirection: subsequentMovement.direction,
                    correct,
                });
            }
        }

        return correlations;
    }

    /**
     * Find the next significant price movement after a given timestamp
     */
    private findNextMovement(timestamp: number): PriceMovement | null {
        for (const movement of this.priceMovements) {
            if (
                movement.timestamp > timestamp &&
                Math.abs(movement.percentChange) >=
                    this.config.movementThreshold
            ) {
                return movement;
            }
        }
        return null;
    }

    /**
     * Check if signal direction matches movement direction
     */
    private isSignalCorrect(
        signalDirection: "buy" | "sell",
        movementDirection: "up" | "down"
    ): boolean {
        return (
            (signalDirection === "buy" && movementDirection === "up") ||
            (signalDirection === "sell" && movementDirection === "down")
        );
    }

    /**
     * Find movements that were missed (no preceding signal)
     */
    private findMissedMovements(signals: DetectorSignal[]): number {
        let missedCount = 0;

        for (const movement of this.priceMovements) {
            if (
                Math.abs(movement.percentChange) < this.config.movementThreshold
            ) {
                continue;
            }

            // Check if there was a signal before this movement
            const precedingSignal = this.findPrecedingSignal(
                movement.timestamp,
                signals
            );

            if (!precedingSignal) {
                missedCount++;
            }
        }

        return missedCount;
    }

    /**
     * Find a signal that precedes a movement within the allowed time window
     */
    private findPrecedingSignal(
        movementTimestamp: number,
        signals: DetectorSignal[]
    ): DetectorSignal | null {
        for (let i = signals.length - 1; i >= 0; i--) {
            const signal = signals[i];
            const timeDiff = movementTimestamp - signal.timestamp;

            if (
                timeDiff >= 0 &&
                timeDiff <= this.config.maxSignalToMovementDelay
            ) {
                return signal;
            }

            if (
                signal.timestamp <
                movementTimestamp - this.config.maxSignalToMovementDelay
            ) {
                break; // No point checking earlier signals
            }
        }

        return null;
    }

    /**
     * Calculate median of an array
     */
    private calculateMedian(values: number[]): number {
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);

        if (sorted.length % 2 === 0) {
            return (sorted[mid - 1] + sorted[mid]) / 2;
        } else {
            return sorted[mid];
        }
    }

    /**
     * Get performance summary for all configurations
     */
    public getPerformanceSummary(): {
        totalConfigurations: number;
        bestByMetric: {
            precision: SignalPerformance;
            recall: SignalPerformance;
            f1Score: SignalPerformance;
            accuracy: SignalPerformance;
            directionAccuracy: SignalPerformance;
        };
        averageMetrics: {
            precision: number;
            recall: number;
            f1Score: number;
            accuracy: number;
            directionAccuracy: number;
        };
    } {
        const performances = Array.from(this.performanceResults.values());

        if (performances.length === 0) {
            throw new Error(
                "No performance results available. Call analyzePerformance() first."
            );
        }

        // Find best performers by each metric
        const bestByMetric = {
            precision: performances.reduce((best, current) =>
                current.precision > best.precision ? current : best
            ),
            recall: performances.reduce((best, current) =>
                current.recall > best.recall ? current : best
            ),
            f1Score: performances.reduce((best, current) =>
                current.f1Score > best.f1Score ? current : best
            ),
            accuracy: performances.reduce((best, current) =>
                current.accuracy > best.accuracy ? current : best
            ),
            directionAccuracy: performances.reduce((best, current) =>
                current.directionAccuracy > best.directionAccuracy
                    ? current
                    : best
            ),
        };

        // Calculate average metrics
        const averageMetrics = {
            precision:
                performances.reduce((sum, p) => sum + p.precision, 0) /
                performances.length,
            recall:
                performances.reduce((sum, p) => sum + p.recall, 0) /
                performances.length,
            f1Score:
                performances.reduce((sum, p) => sum + p.f1Score, 0) /
                performances.length,
            accuracy:
                performances.reduce((sum, p) => sum + p.accuracy, 0) /
                performances.length,
            directionAccuracy:
                performances.reduce((sum, p) => sum + p.directionAccuracy, 0) /
                performances.length,
        };

        return {
            totalConfigurations: performances.length,
            bestByMetric,
            averageMetrics,
        };
    }

    /**
     * Get performance results for a specific configuration
     */
    public getConfigurationPerformance(
        configId: string
    ): SignalPerformance | null {
        return this.performanceResults.get(configId) || null;
    }

    /**
     * Get all performance results
     */
    public getAllPerformanceResults(): Map<string, SignalPerformance> {
        return new Map(this.performanceResults);
    }

    /**
     * Clear all recorded data
     */
    public clear(): void {
        this.priceMovements = [];
        this.signals = [];
        this.performanceResults.clear();
    }

    /**
     * Export performance results to CSV format
     */
    public exportToCSV(): string {
        const performances = Array.from(this.performanceResults.values());

        const headers = [
            "configId",
            "detectorType",
            "totalSignals",
            "truePositives",
            "falsePositives",
            "missedMovements",
            "precision",
            "recall",
            "f1Score",
            "accuracy",
            "directionAccuracy",
            "avgSignalToMovementDelay",
            "medianSignalToMovementDelay",
            "avgSignalConfidence",
            "signalFrequency",
            "duplicateSignals",
        ];

        const rows = performances.map((p) => [
            p.configId,
            p.detectorType,
            p.totalSignals,
            p.truePositives,
            p.falsePositives,
            p.missedMovements,
            p.precision.toFixed(4),
            p.recall.toFixed(4),
            p.f1Score.toFixed(4),
            p.accuracy.toFixed(4),
            p.directionAccuracy.toFixed(4),
            Math.round(p.avgSignalToMovementDelay),
            Math.round(p.medianSignalToMovementDelay),
            p.avgSignalConfidence.toFixed(4),
            p.signalFrequency.toFixed(4),
            p.duplicateSignals,
        ]);

        return [headers.join(","), ...rows.map((row) => row.join(","))].join(
            "\n"
        );
    }
}
