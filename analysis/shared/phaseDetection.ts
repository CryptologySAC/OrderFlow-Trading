/**
 * Shared phase detection and consolidation logic for analysis scripts
 * Ensures both tools use exactly the same phase detection algorithms
 */

import { FinancialMath } from "../../src/utils/financialMath.js";

// Configuration constants
export const PHASE_DETECTION_CONFIG = {
    CLUSTER_TIME_WINDOW: 5 * 60 * 1000, // 5 minutes
    CLUSTER_PRICE_PROXIMITY: 0.002, // 0.2% price range
    PHASE_GAP_THRESHOLD: 15 * 60 * 1000, // 15 minutes between phases
    RETRACEMENT_THRESHOLD: 0.003, // 0.3% retracement starts new phase
    TARGET_PERCENT: 0.007, // 0.7% target
    MIN_PHASE_SIZE: 0.0035, // 0.35% - phases smaller than this will be merged
};

// Base signal interface that both analysis scripts can extend
export interface BaseSignal {
    timestamp: number;
    detectorType: string;
    signalSide: "buy" | "sell";
    price: number;

    // Grouping
    clusterId?: number;
    phaseId?: number;
    isFirstInCluster?: boolean;
    isFirstInPhase?: boolean;
}

export interface SignalCluster<T extends BaseSignal = BaseSignal> {
    id: number;
    signals: T[];
    avgPrice: number;
    priceRange: number;
    startTime: number;
    endTime: number;
    detector: string;
    side: "buy" | "sell";
}

export interface TradingPhase<T extends BaseSignal = BaseSignal> {
    id: number;
    clusters: SignalCluster<T>[];
    direction: "UP" | "DOWN";
    startPrice: number;
    endPrice: number;
    startTime: number;
    endTime: number;
    sizePercent: number;
    hasSuccessfulSignal?: boolean;
    hasActivePosition?: boolean;
}

/**
 * Create signal clusters from a list of signals
 */
export function createSignalClusters<T extends BaseSignal>(
    signals: T[]
): SignalCluster<T>[] {
    if (signals.length === 0) return [];

    const sortedSignals = [...signals].sort(
        (a, b) => a.timestamp - b.timestamp
    );
    const clusters: SignalCluster<T>[] = [];
    let clusterId = 1;

    let currentCluster: T[] = [sortedSignals[0]];

    for (let i = 1; i < sortedSignals.length; i++) {
        const current = sortedSignals[i];
        const lastInCluster = currentCluster[currentCluster.length - 1];

        const timeDiff = current.timestamp - lastInCluster.timestamp;
        const priceDiff =
            Math.abs(current.price - lastInCluster.price) / lastInCluster.price;

        // Check if signal belongs to current cluster
        if (
            timeDiff <= PHASE_DETECTION_CONFIG.CLUSTER_TIME_WINDOW &&
            priceDiff <= PHASE_DETECTION_CONFIG.CLUSTER_PRICE_PROXIMITY &&
            current.signalSide === lastInCluster.signalSide &&
            current.detectorType === lastInCluster.detectorType
        ) {
            currentCluster.push(current);
        } else {
            // Finalize current cluster and start new one
            if (currentCluster.length > 0) {
                clusters.push(
                    createClusterFromSignals(currentCluster, clusterId++)
                );
            }
            currentCluster = [current];
        }
    }

    // Add final cluster
    if (currentCluster.length > 0) {
        clusters.push(createClusterFromSignals(currentCluster, clusterId++));
    }

    return clusters;
}

/**
 * Create a cluster from a list of signals
 */
export function createClusterFromSignals<T extends BaseSignal>(
    signals: T[],
    id: number
): SignalCluster<T> {
    const prices = signals.map((s) => s.price);
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const priceRange = Math.max(...prices) - Math.min(...prices);

    // Mark signals with cluster info
    for (let i = 0; i < signals.length; i++) {
        signals[i].clusterId = id;
        signals[i].isFirstInCluster = i === 0;
    }

    return {
        id,
        signals,
        avgPrice,
        priceRange,
        startTime: Math.min(...signals.map((s) => s.timestamp)),
        endTime: Math.max(...signals.map((s) => s.timestamp)),
        detector: signals[0].detectorType,
        side: signals[0].signalSide,
    };
}

/**
 * Create trading phases from clusters
 */
export function createTradingPhases<T extends BaseSignal>(
    clusters: SignalCluster<T>[],
    allPrices?: Map<number, number>
): TradingPhase<T>[] {
    if (clusters.length === 0) return [];

    const phases: TradingPhase<T>[] = [];
    let phaseId = 1;
    let currentPhaseClusters: SignalCluster<T>[] = [clusters[0]];

    for (let i = 1; i < clusters.length; i++) {
        const current = clusters[i];
        const lastPhase = currentPhaseClusters[currentPhaseClusters.length - 1];

        // Check if current cluster starts a new phase
        if (shouldStartNewPhase(current, lastPhase, allPrices)) {
            // Finalize current phase
            phases.push(
                createPhaseFromClusters(
                    currentPhaseClusters,
                    phaseId++,
                    allPrices
                )
            );
            currentPhaseClusters = [current];
        } else {
            currentPhaseClusters.push(current);
        }
    }

    // Add final phase
    if (currentPhaseClusters.length > 0) {
        phases.push(
            createPhaseFromClusters(currentPhaseClusters, phaseId++, allPrices)
        );
    }

    // Consolidate small phases with adjacent phases
    const consolidatedPhases = consolidateSmallPhases(phases);

    // Renumber phase IDs after consolidation
    consolidatedPhases.forEach((phase: TradingPhase<T>, index: number) => {
        phase.id = index + 1;
        // Update signal phase IDs
        for (const cluster of phase.clusters) {
            for (const signal of cluster.signals) {
                signal.phaseId = index + 1;
            }
        }
    });

    return consolidatedPhases;
}

/**
 * Check if a new phase should be started
 */
function shouldStartNewPhase<T extends BaseSignal>(
    currentCluster: SignalCluster<T>,
    lastCluster: SignalCluster<T>,
    allPrices?: Map<number, number>
): boolean {
    // Time gap check
    const timeGap = currentCluster.startTime - lastCluster.endTime;
    if (timeGap > PHASE_DETECTION_CONFIG.PHASE_GAP_THRESHOLD) {
        return true;
    }

    // Side change (direction change)
    if (currentCluster.side !== lastCluster.side) {
        return true;
    }

    // Price retracement check (if price data available)
    if (allPrices && allPrices.size > 0) {
        const retracement = calculateRetracementBetweenClusters(
            lastCluster,
            currentCluster,
            allPrices
        );
        if (retracement > PHASE_DETECTION_CONFIG.RETRACEMENT_THRESHOLD) {
            return true;
        }
    }

    // Detector type change with significant price difference
    const priceDiff =
        Math.abs(currentCluster.avgPrice - lastCluster.avgPrice) /
        lastCluster.avgPrice;
    if (
        currentCluster.detector !== lastCluster.detector &&
        priceDiff > PHASE_DETECTION_CONFIG.CLUSTER_PRICE_PROXIMITY * 2
    ) {
        return true;
    }

    return false;
}

/**
 * Calculate retracement between clusters
 */
function calculateRetracementBetweenClusters<T extends BaseSignal>(
    cluster1: SignalCluster<T>,
    cluster2: SignalCluster<T>,
    allPrices: Map<number, number>
): number {
    // Find price extremes between clusters
    const startTime = cluster1.endTime;
    const endTime = cluster2.startTime;

    // If no price data available, use simple price difference
    if (allPrices.size === 0) {
        return (
            Math.abs(cluster2.avgPrice - cluster1.avgPrice) / cluster1.avgPrice
        );
    }

    let extremePrice = cluster1.avgPrice;
    for (const [timestamp, price] of allPrices) {
        if (timestamp > startTime && timestamp < endTime) {
            if (cluster1.side === "sell") {
                // For sell signals, look for bounce (higher prices)
                extremePrice = Math.max(extremePrice, price);
            } else {
                // For buy signals, look for dip (lower prices)
                extremePrice = Math.min(extremePrice, price);
            }
        }
    }

    // Calculate retracement percentage
    const retracement =
        Math.abs(extremePrice - cluster1.avgPrice) / cluster1.avgPrice;
    return retracement;
}

/**
 * Create a phase from clusters
 */
function createPhaseFromClusters<T extends BaseSignal>(
    clusters: SignalCluster<T>[],
    id: number,
    allPrices?: Map<number, number>
): TradingPhase<T> {
    const allSignals = clusters.flatMap((c) => c.signals);
    if (allSignals.length === 0) {
        throw new Error("Cannot create phase from empty signal clusters");
    }

    // Get the time range of all signals
    const startTime = Math.min(...clusters.map((c) => c.startTime));
    const endTime = Math.max(...clusters.map((c) => c.endTime));

    // Mark first signal in phase
    const firstSignal = allSignals[0];
    firstSignal.isFirstInPhase = true;

    // For phase start price: Use the signal entry prices to determine range
    const signalPrices = allSignals.map((s) => s.price);

    let startPrice: number;
    let endPrice: number;

    if (firstSignal.signalSide === "sell") {
        // For sell signals: phase starts at highest entry, ends at lowest reached
        startPrice = Math.max(...signalPrices);

        // Try to get actual lowest price reached from signals with movement data
        const signalsWithMovement = allSignals.filter(
            (s: any) => s.actualMaxPrice !== undefined
        );
        if (signalsWithMovement.length > 0) {
            endPrice = Math.min(
                ...signalsWithMovement.map((s: any) => s.actualMaxPrice)
            );
        } else {
            endPrice = Math.min(...signalPrices);
        }
    } else {
        // For buy signals: phase starts at lowest entry, ends at highest reached
        startPrice = Math.min(...signalPrices);

        // Try to get actual highest price reached from signals with movement data
        const signalsWithMovement = allSignals.filter(
            (s: any) => s.actualMaxPrice !== undefined
        );
        if (signalsWithMovement.length > 0) {
            endPrice = Math.max(
                ...signalsWithMovement.map((s: any) => s.actualMaxPrice)
            );
        } else {
            endPrice = Math.max(...signalPrices);
        }
    }

    // Use FinancialMath for accurate percentage calculation
    const sizePercent =
        Math.abs(
            FinancialMath.calculatePercentageChange(startPrice, endPrice, 0)
        ) / 100;

    const direction = firstSignal.signalSide === "buy" ? "UP" : "DOWN";

    // Check if phase has successful signals (if the signal type supports it)
    const hasSuccessfulSignal = allSignals.some(
        (s: any) => s.category === "SUCCESSFUL" || s.reachedTarget === true
    );

    // Mark all signals with phase ID
    for (const signal of allSignals) {
        signal.phaseId = id;
    }

    return {
        id,
        clusters,
        direction,
        startPrice,
        endPrice,
        startTime,
        endTime,
        sizePercent,
        hasSuccessfulSignal,
    };
}

/**
 * Consolidate small phases with adjacent phases
 */
function consolidateSmallPhases<T extends BaseSignal>(
    phases: TradingPhase<T>[]
): TradingPhase<T>[] {
    if (phases.length <= 1) return phases;

    const consolidatedPhases: TradingPhase<T>[] = [];
    let i = 0;

    while (i < phases.length) {
        const currentPhase = phases[i];

        // Check if current phase is small
        if (currentPhase.sizePercent < PHASE_DETECTION_CONFIG.MIN_PHASE_SIZE) {
            // Look at previous and next phases
            const prevPhase =
                i > 0
                    ? consolidatedPhases[consolidatedPhases.length - 1]
                    : null;
            const nextPhase = i < phases.length - 1 ? phases[i + 1] : null;

            // Case 1: Small phase between two phases of the same direction - merge all three
            if (
                prevPhase &&
                nextPhase &&
                prevPhase.direction === nextPhase.direction
            ) {
                // Remove the previous phase from consolidated list
                consolidatedPhases.pop();

                // Merge all three phases
                const mergedPhase = mergeTradingPhases([
                    prevPhase,
                    currentPhase,
                    nextPhase,
                ]);
                consolidatedPhases.push(mergedPhase);

                // Skip the next phase as we've already processed it
                i += 2;
            }
            // Case 2: Small phase at the beginning or end, or between opposite directions
            else {
                // Merge with the adjacent phase that has the same direction
                // or with the larger adjacent phase if directions differ
                if (
                    prevPhase &&
                    (!nextPhase ||
                        prevPhase.sizePercent > nextPhase.sizePercent)
                ) {
                    // Merge with previous phase
                    consolidatedPhases.pop();
                    const mergedPhase = mergeTradingPhases([
                        prevPhase,
                        currentPhase,
                    ]);
                    consolidatedPhases.push(mergedPhase);
                } else if (nextPhase) {
                    // Merge with next phase
                    const mergedPhase = mergeTradingPhases([
                        currentPhase,
                        nextPhase,
                    ]);
                    consolidatedPhases.push(mergedPhase);
                    i++; // Skip the next phase as we've already processed it
                } else {
                    // No adjacent phases to merge with (shouldn't happen normally)
                    consolidatedPhases.push(currentPhase);
                }
                i++;
            }
        } else {
            // Phase is large enough, keep it as is
            consolidatedPhases.push(currentPhase);
            i++;
        }
    }

    return consolidatedPhases;
}

/**
 * Merge multiple trading phases into one
 */
function mergeTradingPhases<T extends BaseSignal>(
    phases: TradingPhase<T>[]
): TradingPhase<T> {
    // Merge multiple phases into a single phase
    const allClusters = phases.flatMap((p) => p.clusters);
    const allSignals = allClusters.flatMap((c) => c.signals);

    // Get overall time range
    const startTime = Math.min(...phases.map((p) => p.startTime));
    const endTime = Math.max(...phases.map((p) => p.endTime));

    // Determine the dominant direction (by total movement or signal count)
    const buySignals = allSignals.filter((s) => s.signalSide === "buy").length;
    const sellSignals = allSignals.filter(
        (s) => s.signalSide === "sell"
    ).length;
    const direction = buySignals >= sellSignals ? "UP" : "DOWN";

    // Calculate start and end prices based on actual price movement
    let startPrice: number;
    let endPrice: number;

    if (direction === "DOWN") {
        // For DOWN phase: start at highest signal price, end at lowest reached
        startPrice = Math.max(...allSignals.map((s) => s.price));

        // Try to get actual movement data
        const signalsWithMovement = allSignals.filter(
            (s: any) => s.actualMaxPrice !== undefined
        );
        if (signalsWithMovement.length > 0) {
            endPrice = Math.min(
                ...signalsWithMovement.map((s: any) => s.actualMaxPrice)
            );
        } else {
            endPrice = Math.min(...allSignals.map((s) => s.price));
        }
    } else {
        // For UP phase: start at lowest signal price, end at highest reached
        startPrice = Math.min(...allSignals.map((s) => s.price));

        // Try to get actual movement data
        const signalsWithMovement = allSignals.filter(
            (s: any) => s.actualMaxPrice !== undefined
        );
        if (signalsWithMovement.length > 0) {
            endPrice = Math.max(
                ...signalsWithMovement.map((s: any) => s.actualMaxPrice)
            );
        } else {
            endPrice = Math.max(...allSignals.map((s) => s.price));
        }
    }

    const sizePercent =
        Math.abs(
            FinancialMath.calculatePercentageChange(startPrice, endPrice, 0)
        ) / 100;

    const hasSuccessfulSignal = allSignals.some(
        (s: any) => s.category === "SUCCESSFUL" || s.reachedTarget === true
    );

    return {
        id: phases[0].id, // Will be renumbered later
        clusters: allClusters,
        direction,
        startPrice,
        endPrice,
        startTime,
        endTime,
        sizePercent,
        hasSuccessfulSignal,
        hasActivePosition: phases.some((p) => p.hasActivePosition),
    };
}

/**
 * Convert date to Lima time string
 */
export function convertToLimaTime(timestamp: number): string {
    const date = new Date(timestamp);
    const options: Intl.DateTimeFormatOptions = {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: "America/Lima",
    };

    return date.toLocaleString("en-US", options);
}

/**
 * Print phase summary to console
 */
export function printPhaseSummary<T extends BaseSignal>(
    phases: TradingPhase<T>[]
): void {
    console.log("\n📊 PHASE SUMMARY:");
    for (const phase of phases) {
        console.log(
            `   Phase #${phase.id}: ${phase.direction} ${phase.direction === "UP" ? "↑" : "↓"} $${phase.startPrice.toFixed(2)} → $${phase.endPrice.toFixed(2)} (${(phase.sizePercent * 100).toFixed(2)}%) | ${phase.clusters.length} clusters, ${phase.clusters.flatMap((c) => c.signals).length} signals`
        );
    }
}

/**
 * Swing point for price-based phase detection
 */
export interface SwingPoint {
    timestamp: number;
    price: number;
    type: "HIGH" | "LOW";
    strength: number; // How significant the swing is
}

/**
 * Price-based phase that may or may not have signal coverage
 */
export interface PricePhase<T extends BaseSignal = BaseSignal> {
    id: number;
    direction: "UP" | "DOWN";
    startTime: number;
    endTime: number;
    startPrice: number;
    endPrice: number;
    sizePercent: number;

    // Signal coverage
    detectionStatus: "DETECTED" | "PARTIALLY_DETECTED" | "UNDETECTED";
    detectedClusters: SignalCluster<T>[];
    detectedSignals: T[];
    detectionStartPrice?: number; // Where detection began (for partial)
    detectionCoverage: number; // 0-1 percentage of phase covered by signals

    // Detector breakdown
    detectorCoverage: Map<
        string,
        {
            clusters: SignalCluster<T>[];
            signals: T[];
            coverage: number;
        }
    >;
}

/**
 * Identify swing points from price data using efficient peak/trough detection
 * Memory-optimized version that processes data in a single pass
 */
export function identifySwingPoints(
    priceData: Map<number, number>,
    minSwingSize: number = PHASE_DETECTION_CONFIG.MIN_PHASE_SIZE
): SwingPoint[] {
    if (priceData.size < 5) return [];

    const sortedEntries = Array.from(priceData.entries()).sort(
        (a, b) => a[0] - b[0]
    );
    const swings: SwingPoint[] = [];

    // Use a simple moving window approach - much more memory efficient
    const windowSize = 10; // Small window for local peak/trough detection

    for (let i = windowSize; i < sortedEntries.length - windowSize; i++) {
        const [currentTime, currentPrice] = sortedEntries[i];

        // Check if current point is a local high or low
        let isHigh = true;
        let isLow = true;

        // Check surrounding points in window
        for (let j = i - windowSize; j <= i + windowSize; j++) {
            if (j === i) continue;

            const [, price] = sortedEntries[j];
            if (price >= currentPrice) isHigh = false;
            if (price <= currentPrice) isLow = false;
        }

        // If it's a local extreme, check if the swing is significant enough
        if (isHigh || isLow) {
            // Find the size of the swing by looking at nearby opposite extremes
            let swingSize = 0;

            // Look backwards and forwards for significant price difference
            const searchRange = Math.min(50, sortedEntries.length / 10); // Limit search range

            for (
                let k = Math.max(0, i - searchRange);
                k < Math.min(sortedEntries.length, i + searchRange);
                k++
            ) {
                const [, price] = sortedEntries[k];
                const pctDiff = Math.abs((price - currentPrice) / currentPrice);
                swingSize = Math.max(swingSize, pctDiff);
            }

            // Only include if swing size meets minimum threshold
            if (swingSize >= minSwingSize) {
                swings.push({
                    timestamp: currentTime,
                    price: currentPrice,
                    type: isHigh ? "HIGH" : "LOW",
                    strength: swingSize,
                });
            }
        }
    }

    // Remove duplicate consecutive swings of same type
    const filteredSwings: SwingPoint[] = [];
    for (const swing of swings) {
        const lastSwing = filteredSwings[filteredSwings.length - 1];
        if (!lastSwing || lastSwing.type !== swing.type) {
            filteredSwings.push(swing);
        } else if (swing.strength > lastSwing.strength) {
            // Replace with stronger swing of same type
            filteredSwings[filteredSwings.length - 1] = swing;
        }
    }

    return filteredSwings;
}

/**
 * Create price-based phases from swing points
 */
export function createPricePhasesFromSwings(
    swingPoints: SwingPoint[]
): Omit<
    PricePhase,
    | "detectionStatus"
    | "detectedClusters"
    | "detectedSignals"
    | "detectionCoverage"
    | "detectorCoverage"
>[] {
    if (swingPoints.length < 2) return [];

    const phases: Omit<
        PricePhase,
        | "detectionStatus"
        | "detectedClusters"
        | "detectedSignals"
        | "detectionCoverage"
        | "detectorCoverage"
    >[] = [];

    for (let i = 0; i < swingPoints.length - 1; i++) {
        const startSwing = swingPoints[i];
        const endSwing = swingPoints[i + 1];

        // Determine direction
        const direction = endSwing.price > startSwing.price ? "UP" : "DOWN";

        // Calculate size
        const sizePercent =
            Math.abs(
                FinancialMath.calculatePercentageChange(
                    startSwing.price,
                    endSwing.price,
                    0
                )
            ) / 100;

        // Only include phases above minimum size
        if (sizePercent >= PHASE_DETECTION_CONFIG.MIN_PHASE_SIZE) {
            phases.push({
                id: i + 1,
                direction,
                startTime: startSwing.timestamp,
                endTime: endSwing.timestamp,
                startPrice: startSwing.price,
                endPrice: endSwing.price,
                sizePercent,
            });
        }
    }

    return phases;
}

/**
 * Map signal clusters to price-based phases and determine detection coverage
 */
export function mapSignalsToPricePhases<T extends BaseSignal>(
    pricePhases: Omit<
        PricePhase<T>,
        | "detectionStatus"
        | "detectedClusters"
        | "detectedSignals"
        | "detectionCoverage"
        | "detectorCoverage"
    >[],
    signalClusters: SignalCluster<T>[]
): PricePhase<T>[] {
    return pricePhases.map((phase) => {
        // Find clusters that overlap with this phase
        const overlappingClusters = signalClusters.filter((cluster) => {
            // Check if cluster overlaps with phase time window
            return (
                cluster.startTime <= phase.endTime &&
                cluster.endTime >= phase.startTime
            );
        });

        const allSignals = overlappingClusters.flatMap((c) => c.signals);

        // Filter signals that match phase direction (buy for UP, sell for DOWN)
        const matchingSignals = allSignals.filter((signal) => {
            return (
                (phase.direction === "UP" && signal.signalSide === "buy") ||
                (phase.direction === "DOWN" && signal.signalSide === "sell")
            );
        });

        const matchingClusters = overlappingClusters.filter((cluster) =>
            cluster.signals.some((signal) => matchingSignals.includes(signal))
        );

        // Calculate detection coverage
        let detectionCoverage = 0;
        let detectionStartPrice: number | undefined;
        let detectionStatus: "DETECTED" | "PARTIALLY_DETECTED" | "UNDETECTED" =
            "UNDETECTED";

        if (matchingSignals.length > 0) {
            // Find earliest and latest matching signals
            const signalPrices = matchingSignals.map((s) => s.price);

            if (phase.direction === "UP") {
                detectionStartPrice = Math.min(...signalPrices);
                const detectedMove = Math.abs(
                    (phase.endPrice - detectionStartPrice) / detectionStartPrice
                );
                const totalMove = Math.abs(
                    (phase.endPrice - phase.startPrice) / phase.startPrice
                );
                detectionCoverage = detectedMove / totalMove;
            } else {
                detectionStartPrice = Math.max(...signalPrices);
                const detectedMove = Math.abs(
                    (detectionStartPrice - phase.endPrice) / detectionStartPrice
                );
                const totalMove = Math.abs(
                    (phase.startPrice - phase.endPrice) / phase.startPrice
                );
                detectionCoverage = detectedMove / totalMove;
            }

            detectionCoverage = Math.min(1, Math.max(0, detectionCoverage));

            if (detectionCoverage >= 0.9) {
                detectionStatus = "DETECTED";
            } else if (detectionCoverage > 0.1) {
                detectionStatus = "PARTIALLY_DETECTED";
            } else {
                detectionStatus = "UNDETECTED";
            }
        }

        // Create detector coverage breakdown
        const detectorCoverage = new Map<
            string,
            {
                clusters: SignalCluster<T>[];
                signals: T[];
                coverage: number;
            }
        >();

        // Group by detector type
        const detectorTypes = new Set(allSignals.map((s) => s.detectorType));
        for (const detectorType of detectorTypes) {
            const detectorSignals = matchingSignals.filter(
                (s) => s.detectorType === detectorType
            );
            const detectorClusters = matchingClusters.filter((c) =>
                c.signals.some((s) => s.detectorType === detectorType)
            );

            let detectorCoverage_val = 0;
            if (detectorSignals.length > 0) {
                const detectorPrices = detectorSignals.map((s) => s.price);
                if (phase.direction === "UP") {
                    const detectorStartPrice = Math.min(...detectorPrices);
                    const detectorMove = Math.abs(
                        (phase.endPrice - detectorStartPrice) /
                            detectorStartPrice
                    );
                    const totalMove = Math.abs(
                        (phase.endPrice - phase.startPrice) / phase.startPrice
                    );
                    detectorCoverage_val = detectorMove / totalMove;
                } else {
                    const detectorStartPrice = Math.max(...detectorPrices);
                    const detectorMove = Math.abs(
                        (detectorStartPrice - phase.endPrice) /
                            detectorStartPrice
                    );
                    const totalMove = Math.abs(
                        (phase.startPrice - phase.endPrice) / phase.startPrice
                    );
                    detectorCoverage_val = detectorMove / totalMove;
                }
                detectorCoverage_val = Math.min(
                    1,
                    Math.max(0, detectorCoverage_val)
                );
            }

            detectorCoverage.set(detectorType, {
                clusters: detectorClusters,
                signals: detectorSignals,
                coverage: detectorCoverage_val,
            });
        }

        return {
            ...phase,
            detectionStatus,
            detectedClusters: matchingClusters,
            detectedSignals: matchingSignals,
            detectionStartPrice,
            detectionCoverage,
            detectorCoverage,
        };
    });
}

/**
 * Create complete price-based phase analysis
 */
export function createCompletePricePhases<T extends BaseSignal>(
    priceData: Map<number, number>,
    signals: T[]
): PricePhase<T>[] {
    // Step 1: Identify swing points from price data
    const swingPoints = identifySwingPoints(priceData);

    // Step 2: Create phases from swing points
    const basePricePhases = createPricePhasesFromSwings(swingPoints);

    // Step 3: Create signal clusters
    const signalClusters = createSignalClusters(signals);

    // Step 4: Map signals to price phases with proper type casting
    const completePricePhases = mapSignalsToPricePhases<T>(
        basePricePhases,
        signalClusters
    );

    return completePricePhases;
}
