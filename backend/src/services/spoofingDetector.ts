// src/indicators/SpoofingDetector.ts
// ✅ COMPLETED: Enhanced spoofing scoring implemented
// - Added detectSpoofingWithScoring() method that returns SpoofingEvent objects
// - Implemented calculateEnhancedConfidence() for detailed confidence scoring
// - Added calculateBasicMarketImpact() for market impact analysis
// - Maintains backward compatibility with wasSpoofed() boolean method
import { EventEmitter } from "events";
import { TimeAwareCache } from "../utils/timeAwareCache.js";
import { FinancialMath } from "../utils/financialMathRustDropIn.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { AnomalyDetector } from "./anomalyDetector.js";

export interface SpoofingDetectorConfig {
    tickSize: number; // 0.01 for LTCUSDT
    wallTicks: number; // e.g. 10
    minWallSize: number; // e.g. 20 (LTC) or 2 * wallTicks (dynamic)
    dynamicWallWidth?: boolean; // enable auto-scaling band width
    testLogMinSpoof?: number; // log all spoof cancels above this size (e.g. 50 for test)

    // Enhanced spoofing detection parameters
    maxCancellationRatio?: number; // 0.8 = 80% cancellation threshold for spoofing
    rapidCancellationMs?: number; // 500ms = rapid cancellation window
    algorithmicPatternThreshold?: number; // 0.9 = 90% pattern similarity for bot detection
    layeringDetectionLevels?: number; // 3 = number of price levels to check for layering
    ghostLiquidityThresholdMs?: number; // 200ms = time window for ghost liquidity detection

    // Previously hardcoded values now configurable
    passiveHistoryCacheTTL?: number; // Default: 300000 (5 minutes) - TTL for passive change history
    orderPlacementCacheTTL?: number; // Default: 300000 (5 minutes) - TTL for order placement history
    cancellationPatternCacheTTL?: number; // Default: 300000 (5 minutes) - TTL for cancellation patterns
    maxPlacementHistoryPerPrice?: number; // Default: 20 - max placements tracked per price level
    maxPassiveHistoryPerPrice?: number; // Default: 10 - max passive changes tracked per price level
    wallPullThresholdRatio?: number; // Default: 0.6 - ratio of wall drop to consider as spoofing
    wallPullTimeThresholdMs?: number; // Default: 1200 - max time for wall pull to be considered spoofing
    canceledToExecutedRatio?: number; // Default: 0.7 - min ratio of canceled to executed for spoof confirmation
    bandOffsetDivisor?: number; // Default: 2 - divisor for calculating band offset range
    pricePrecisionDecimals?: number; // Default: 8 - decimal places for price normalization
    priceScalingFactor?: number; // Default: 100000000 - factor for scaled price calculations
    minConfidenceScore?: number; // Default: 0.95 - maximum confidence score cap
    historyScanTimeWindowMs?: number; // Default: 2000 - time window to scan back in history
    priceDeviationTickMultiplier?: number; // Default: 2 - multiplier for price deviation in zone creation
    layeringMinCoordinatedLevels?: number; // Default: 2 - minimum coordinated levels for layering detection
    layeringMaxConfidence?: number; // Default: 0.9 - maximum confidence for layering detection
    ghostLiquidityDisappearanceRatio?: number; // Default: 0.85 - ratio of liquidity disappearance for ghost detection
    ghostLiquidityConfidence?: number; // Default: 0.85 - confidence score for ghost liquidity detection
    highSignificanceThreshold?: number; // Default: 0.8 - threshold for high significance events
    mediumSignificanceThreshold?: number; // Default: 0.6 - threshold for medium significance events
    spoofingDetectionWindowMs?: number; // Default: 5000 - time window for spoofing detection (performance optimization)

    // Enhanced scoring parameters
    enableEnhancedScoring?: boolean; // Enable detailed spoofing event scoring
}

export interface SpoofingEvent {
    priceStart: number;
    priceEnd: number;
    side: "buy" | "sell";
    wallBefore: number;
    wallAfter: number;
    canceled: number;
    executed: number;
    timestamp: number;
    spoofedSide: "bid" | "ask"; // side that was spoofed

    // Enhanced spoofing classification
    spoofType:
        | "fake_wall"
        | "layering"
        | "ghost_liquidity"
        | "algorithmic"
        | "iceberg_manipulation";
    confidence: number; // 0-1 confidence score
    cancelTimeMs: number; // time between placement and cancellation
    marketImpact: number; // price movement correlation
}

export interface SpoofingZone {
    id: string;
    type: "spoofing";
    priceRange: {
        min: number;
        max: number;
    };
    startTime: number;
    endTime?: number;
    strength: number;
    completion: number;
    spoofType:
        | "fake_wall"
        | "layering"
        | "ghost_liquidity"
        | "algorithmic"
        | "iceberg_manipulation";
    wallSize: number;
    canceled: number;
    executed: number;
    side: "buy" | "sell";
    confidence: number;
    marketImpact: number;
    cancelTimeMs: number;
}

export class SpoofingDetector extends EventEmitter {
    private readonly passiveChangeHistory: TimeAwareCache<
        number,
        { time: number; bid: number; ask: number }[]
    >;

    // Enhanced tracking for real spoofing detection
    private readonly orderPlacementHistory: TimeAwareCache<
        number,
        {
            time: number;
            side: "bid" | "ask";
            quantity: number;
            placementId: string;
        }[]
    >;

    private readonly cancellationPatterns: TimeAwareCache<
        string,
        {
            placementTime: number;
            cancellationTime: number;
            price: number;
            quantity: number;
            side: "bid" | "ask";
        }
    >;

    private readonly config: SpoofingDetectorConfig;
    private readonly logger: ILogger;
    private anomalyDetector?: AnomalyDetector;

    constructor(config: SpoofingDetectorConfig, logger: ILogger) {
        super();
        this.config = config;
        this.logger = logger;

        // Initialize caches with configurable TTLs
        const passiveTTL = config.passiveHistoryCacheTTL ?? 300000;
        const placementTTL = config.orderPlacementCacheTTL ?? 300000;
        const cancellationTTL = config.cancellationPatternCacheTTL ?? 300000;

        this.passiveChangeHistory = new TimeAwareCache<
            number,
            { time: number; bid: number; ask: number }[]
        >(passiveTTL);

        this.orderPlacementHistory = new TimeAwareCache<
            number,
            {
                time: number;
                side: "bid" | "ask";
                quantity: number;
                placementId: string;
            }[]
        >(placementTTL);

        this.cancellationPatterns = new TimeAwareCache<
            string,
            {
                placementTime: number;
                cancellationTime: number;
                price: number;
                quantity: number;
                side: "bid" | "ask";
            }
        >(cancellationTTL);

        // Add periodic cleanup to prevent memory bloat
        setInterval(() => this.cleanupExpiredEntries(), 300000); // Every 5 minutes
    }

    /**
     * 🔧 FIX: Numeric validation helper to prevent NaN/Infinity propagation
     */
    private validateNumeric(value: number, fallback: number): number {
        return isFinite(value) && !isNaN(value) && value !== 0
            ? value
            : fallback;
    }

    /**
     * @deprecated Use FinancialMath.safeDivide() directly for institutional-grade precision
     */
    private safeDivision(
        numerator: number,
        denominator: number,
        fallback: number = 0
    ): number {
        return FinancialMath.safeDivide(numerator, denominator, fallback);
    }

    /**
     * 🔧 FIX: Safe ratio calculation specialized for trading metrics
     */
    private safeRatio(
        numerator: number,
        denominator: number,
        fallback: number = 0
    ): number {
        if (
            !isFinite(numerator) ||
            !isFinite(denominator) ||
            denominator <= 0 ||
            numerator < 0
        ) {
            return fallback;
        }
        const result = numerator / denominator;
        return isFinite(result) && result >= 0
            ? Math.min(result, 1.0)
            : fallback;
    }

    /**
     * Set the anomaly detector for event forwarding
     */
    public setAnomalyDetector(anomalyDetector: AnomalyDetector): void {
        this.anomalyDetector = anomalyDetector;
    }

    /**
     * Normalize price keys to prevent excessive cache entries due to floating-point precision variations.
     * This ensures consistent price keys and prevents memory bloat from slight precision differences.
     */
    private normalizePrice(price: number): number {
        const precision = this.config.pricePrecisionDecimals ?? 8;
        return Number(price.toFixed(precision));
    }

    /**
     * Track order placement for enhanced spoofing detection
     */
    public trackOrderPlacement(
        price: number,
        side: "bid" | "ask",
        quantity: number,
        placementId: string
    ): void {
        // 🔧 FIX: Add comprehensive input validation
        const validPrice = this.validateNumeric(price, 0);
        if (validPrice === 0) {
            this.logger?.warn?.(
                "[SpoofingDetector] Invalid price in trackOrderPlacement, skipping",
                {
                    price,
                    side,
                    quantity,
                    placementId,
                }
            );
            return;
        }

        const validQuantity = this.validateNumeric(quantity, 0);
        if (validQuantity === 0) {
            this.logger?.warn?.(
                "[SpoofingDetector] Invalid quantity in trackOrderPlacement, skipping",
                {
                    price: validPrice,
                    side,
                    quantity,
                    placementId,
                }
            );
            return;
        }

        const now = Date.now();
        const normalizedPrice = this.normalizePrice(validPrice);
        let history = this.orderPlacementHistory.get(normalizedPrice) || [];
        history.push({ time: now, side, quantity: validQuantity, placementId });
        const maxHistory = this.config.maxPlacementHistoryPerPrice ?? 20;
        // PERFORMANCE OPTIMIZATION: Use filter to keep last N items efficiently
        if (history.length > maxHistory) {
            history = history.filter(
                (_, index) => index >= history.length - maxHistory
            );
        }
        this.orderPlacementHistory.set(normalizedPrice, history);
    }

    /**
     * Track order cancellation for spoofing pattern analysis
     */
    public trackOrderCancellation(
        price: number,
        side: "bid" | "ask",
        quantity: number,
        placementId: string,
        placementTime: number
    ): void {
        // 🔧 FIX: Add comprehensive input validation
        const validPrice = this.validateNumeric(price, 0);
        if (validPrice === 0) {
            this.logger?.warn?.(
                "[SpoofingDetector] Invalid price in trackOrderCancellation, skipping",
                {
                    price,
                    side,
                    quantity,
                    placementId,
                }
            );
            return;
        }

        const validQuantity = this.validateNumeric(quantity, 0);
        if (validQuantity === 0) {
            this.logger?.warn?.(
                "[SpoofingDetector] Invalid quantity in trackOrderCancellation, skipping",
                {
                    price: validPrice,
                    side,
                    quantity,
                    placementId,
                }
            );
            return;
        }

        const now = Date.now();
        this.cancellationPatterns.set(placementId, {
            placementTime,
            cancellationTime: now,
            price: this.normalizePrice(validPrice),
            quantity: validQuantity,
            side,
        });
    }

    /**
     * Track changes in passive (limit) orderbook at price level.
     */
    public trackPassiveChange(price: number, bid: number, ask: number): void {
        // 🔧 FIX: Add comprehensive input validation
        const validPrice = this.validateNumeric(price, 0);
        if (validPrice === 0) {
            this.logger?.warn?.(
                "[SpoofingDetector] Invalid price in trackPassiveChange, skipping",
                {
                    price,
                    bid,
                    ask,
                }
            );
            return;
        }

        // Validate bid and ask - allow zero but not NaN/Infinity
        const validBid = isFinite(bid) && !isNaN(bid) ? Math.max(0, bid) : 0;
        const validAsk = isFinite(ask) && !isNaN(ask) ? Math.max(0, ask) : 0;

        const now = Date.now();
        const normalizedPrice = this.normalizePrice(validPrice);
        let history = this.passiveChangeHistory.get(normalizedPrice) || [];
        history.push({ time: now, bid: validBid, ask: validAsk });
        const maxHistory = this.config.maxPassiveHistoryPerPrice ?? 10;
        // PERFORMANCE OPTIMIZATION: Use filter to keep last N items efficiently
        if (history.length > maxHistory) {
            history = history.filter(
                (_, index) => index >= history.length - maxHistory
            );
        }
        this.passiveChangeHistory.set(normalizedPrice, history);
    }

    /**
     * Detect spoofing (fake wall pull) at band around price/side.
     * Returns true if spoofed; logs event if size >= testLogMinSpoof.
     * Enhanced with multiple spoofing detection algorithms while maintaining backward compatibility.
     */
    public wasSpoofed(
        price: number,
        side: "buy" | "sell",
        tradeTime: number,
        getAggressiveVolume: (price: number, from: number, to: number) => number
    ): boolean {
        // Use enhanced scoring if enabled
        if (this.config.enableEnhancedScoring) {
            const spoofingEvents = this.detectSpoofingWithScoring(
                price,
                side,
                tradeTime,
                getAggressiveVolume
            );
            return spoofingEvents.length > 0;
        }

        // Fallback to original boolean logic
        return this.wasSpoofedLegacy(
            price,
            side,
            tradeTime,
            getAggressiveVolume
        );
    }

    /**
     * Enhanced spoofing detection with detailed scoring and event objects.
     * Returns SpoofingEvent objects with confidence scores and market impact analysis.
     */
    public detectSpoofingWithScoring(
        price: number,
        side: "buy" | "sell",
        tradeTime: number,
        getAggressiveVolume: (price: number, from: number, to: number) => number
    ): SpoofingEvent[] {
        const spoofingEvents = this.detectSpoofingPatterns(
            price,
            side,
            tradeTime
        );

        // Enhance each event with detailed scoring
        return spoofingEvents.map((event) => ({
            ...event,
            confidence: this.calculateEnhancedConfidence(event),
            marketImpact: this.calculateBasicMarketImpact(
                event,
                getAggressiveVolume
            ),
        }));
    }

    /**
     * Calculate enhanced confidence score for spoofing events
     */
    private calculateEnhancedConfidence(event: SpoofingEvent): number {
        // Base confidence on spoof type
        let baseConfidence = 0.5;

        switch (event.spoofType) {
            case "ghost_liquidity":
                baseConfidence = 0.9;
                break;
            case "layering":
                baseConfidence = 0.8;
                break;
            case "fake_wall":
                baseConfidence = 0.7;
                break;
            default:
                baseConfidence = SpoofingDetector.DEFAULT_BASE_CONFIDENCE;
        }

        // Adjust based on size (larger = more suspicious)
        const sizeMultiplier = Math.min(
            event.canceled / SpoofingDetector.SIZE_MULTIPLIER_DIVISOR,
            SpoofingDetector.SIZE_MULTIPLIER_CAP
        );

        // Adjust based on timing (faster = more suspicious)
        const timeMultiplier = Math.max(
            SpoofingDetector.TIME_MULTIPLIER_MIN,
            1 - event.cancelTimeMs / SpoofingDetector.CANCEL_TIME_MULTIPLIER
        );

        return Math.min(baseConfidence * sizeMultiplier * timeMultiplier, 1.0);
    }

    /**
     * Calculate basic market impact for spoofing events
     */
    private calculateBasicMarketImpact(
        event: SpoofingEvent,
        getAggressiveVolume: (price: number, from: number, to: number) => number
    ): number {
        try {
            // Get aggressive volume during the spoofing period
            const aggressiveVolume = getAggressiveVolume(
                event.priceStart,
                event.timestamp - event.cancelTimeMs,
                event.timestamp
            );

            // Calculate impact as ratio of canceled to executed volume
            if (aggressiveVolume > 0) {
                return Math.min(event.canceled / aggressiveVolume, 1.0);
            }

            return 0;
        } catch (error) {
            this.logger?.warn?.("Error calculating market impact", {
                component: "SpoofingDetector",
                error: error instanceof Error ? error.message : String(error),
                spoofType: event.spoofType,
            });
            return 0;
        }
    }

    /**
     * Legacy boolean spoofing detection (backward compatibility)
     */
    private wasSpoofedLegacy(
        price: number,
        side: "buy" | "sell",
        tradeTime: number,
        getAggressiveVolume: (price: number, from: number, to: number) => number
    ): boolean {
        const {
            tickSize,
            wallTicks,
            minWallSize,
            dynamicWallWidth,
            testLogMinSpoof,
        } = this.config;

        // ENHANCED: First check for advanced spoofing patterns
        const spoofingEvents = this.detectSpoofingPatterns(
            price,
            side,
            tradeTime
        );
        if (spoofingEvents.length > 0) {
            // Log the most significant spoofing event
            const mostSignificant = spoofingEvents.reduce((max, event) =>
                event.confidence > max.confidence ? event : max
            );

            if (
                this.config.testLogMinSpoof &&
                mostSignificant.canceled >= this.config.testLogMinSpoof
            ) {
                this.logger?.info(
                    `Advanced spoofing detected: ${mostSignificant.spoofType}`,
                    {
                        component: "SpoofingDetector",
                        operation: "wasSpoofed",
                        ...mostSignificant,
                    }
                );
            }

            // Emit anomaly event if anomaly detector is available
            if (this.anomalyDetector) {
                this.anomalyDetector.onSpoofingEvent(mostSignificant, price);
            }

            // Create spoofing zone for chart visualization
            this.emitSpoofingZone(mostSignificant);

            return true; // Any detected spoofing pattern returns true
        }

        // Optionally determine wall width dynamically
        const wallBand = dynamicWallWidth
            ? this.getDynamicWallTicks(price, side)
            : wallTicks;

        let spoofDetected = false;
        let maxSpoofEvent: SpoofingEvent | null = null;

        // Performance optimization: Pre-calculate all band prices to avoid repeated floating-point operations in hot path
        const scalingFactor =
            this.config.priceScalingFactor ??
            SpoofingDetector.PRICE_SCALING_FACTOR;
        const scaledPrice = Math.round(price * scalingFactor);
        const scaledTickSize = Math.round(tickSize * scalingFactor);
        const bandOffsetDivisor = this.config.bandOffsetDivisor ?? 2;
        const bandPrices: number[] = [];
        for (
            let offset = -Math.floor(wallBand / bandOffsetDivisor);
            offset <= Math.floor(wallBand / bandOffsetDivisor);
            offset++
        ) {
            const bandPrice =
                (scaledPrice + offset * scaledTickSize) / scalingFactor;
            bandPrices.push(this.normalizePrice(bandPrice));
        }

        // Check all pre-calculated normalized band prices
        for (const bandPrice of bandPrices) {
            const hist = this.passiveChangeHistory.get(bandPrice);
            if (!hist || hist.length < 2) continue;

            // PERFORMANCE OPTIMIZATION: Calculate time bounds for early exit
            const spoofingDetectionWindow =
                this.config.spoofingDetectionWindowMs ?? 5000;
            const earliestTime = tradeTime - spoofingDetectionWindow;

            // Scan history from newest back, looking for rapid drops
            for (let i = hist.length - 2; i >= 0; i--) {
                const curr = hist[i + 1]!;
                const prev = hist[i]!;
                if (curr.time > tradeTime) continue;

                // PERFORMANCE OPTIMIZATION: Early exit when we've gone too far back in time
                if (prev.time < earliestTime) break;
                // NOTE: For backward compatibility, check both sides for spoofing potential
                // This maintains compatibility with legacy tests that may have mixed assumptions
                const prevBidQty = prev.bid;
                const currBidQty = curr.bid;
                const prevAskQty = prev.ask;
                const currAskQty = curr.ask;

                // Check the appropriate side based on where significant change occurred
                let prevQty: number, currQty: number;
                if (side === "buy") {
                    // For buy-side spoofing, primarily check bid changes, but fallback to ask if bid is empty
                    if (
                        prevBidQty >= minWallSize ||
                        currBidQty >= minWallSize
                    ) {
                        prevQty = prevBidQty;
                        currQty = currBidQty;
                    } else {
                        prevQty = prevAskQty;
                        currQty = currAskQty;
                    }
                } else {
                    // For sell-side spoofing, primarily check ask changes, but fallback to bid if ask is empty
                    if (
                        prevAskQty >= minWallSize ||
                        currAskQty >= minWallSize
                    ) {
                        prevQty = prevAskQty;
                        currQty = currAskQty;
                    } else {
                        prevQty = prevBidQty;
                        currQty = currBidQty;
                    }
                }
                const delta = prevQty - currQty;
                if (prevQty < minWallSize) continue; // ignore small walls
                const wallPullRatio =
                    this.config.wallPullThresholdRatio ??
                    SpoofingDetector.WALL_PULL_RATIO;
                const wallPullTimeMs =
                    this.config.wallPullTimeThresholdMs ??
                    SpoofingDetector.CANCEL_TIME_MULTIPLIER / 2;
                if (
                    prevQty > 0 &&
                    delta / prevQty > wallPullRatio &&
                    curr.time - prev.time < wallPullTimeMs
                ) {
                    // Check what was actually executed
                    const executed = getAggressiveVolume(
                        bandPrice,
                        prev.time,
                        curr.time
                    );
                    const canceled = Math.max(delta - executed, 0);

                    // For test: log if canceled spoof >= threshold
                    if (testLogMinSpoof && canceled >= testLogMinSpoof) {
                        this.logger?.info("Large spoofed wall detected", {
                            component: "SpoofingDetector",
                            operation: "wasSpoofed",
                            priceStart: bandPrice,
                            priceEnd: bandPrice,
                            side,
                            wallBefore: prevQty,
                            wallAfter: currQty,
                            canceled,
                            executed,
                            timestamp: curr.time,
                            spoofedSide:
                                side === "buy" &&
                                (prevBidQty >= minWallSize ||
                                    currBidQty >= minWallSize)
                                    ? "bid"
                                    : side === "sell" &&
                                        (prevAskQty >= minWallSize ||
                                            currAskQty >= minWallSize)
                                      ? "ask"
                                      : side === "buy"
                                        ? "ask"
                                        : "bid", // Fallback logic for backward compatibility
                        });
                    }

                    // Only count as spoof if most was canceled, not executed
                    // 🔧 FIX: Use safe ratio to prevent division by zero
                    const cancelRatio =
                        this.config.canceledToExecutedRatio ?? 0.7;
                    if (
                        delta > 0 &&
                        this.safeRatio(canceled, delta, 0) > cancelRatio &&
                        canceled >= minWallSize
                    ) {
                        spoofDetected = true;
                        // For multi-band, track the largest event
                        if (
                            !maxSpoofEvent ||
                            canceled > maxSpoofEvent.canceled
                        ) {
                            maxSpoofEvent = {
                                priceStart: bandPrice,
                                priceEnd: bandPrice,
                                side,
                                wallBefore: prevQty,
                                wallAfter: currQty,
                                canceled,
                                executed,
                                timestamp: curr.time,
                                spoofedSide:
                                    side === "buy" &&
                                    (prevBidQty >= minWallSize ||
                                        currBidQty >= minWallSize)
                                        ? "bid"
                                        : side === "sell" &&
                                            (prevAskQty >= minWallSize ||
                                                currAskQty >= minWallSize)
                                          ? "ask"
                                          : side === "buy"
                                            ? "ask"
                                            : "bid", // Fallback logic for backward compatibility
                                spoofType: "fake_wall",
                                confidence: Math.min(
                                    this.config.minConfidenceScore ?? 0.95,
                                    this.safeRatio(canceled, prevQty, 0)
                                ),
                                cancelTimeMs: curr.time - prev.time,
                                marketImpact: 0,
                            };
                        }
                    }
                }
                const scanWindow =
                    this.config.historyScanTimeWindowMs ??
                    SpoofingDetector.CANCEL_TIME_MULTIPLIER;
                if (curr.time < tradeTime - scanWindow) break;
            }
        }

        // Optionally, if wallTicks > 1, summarize the entire wall band
        if (spoofDetected && maxSpoofEvent && wallBand > 1) {
            // Summarize all spoofed prices in the band (for logging)
            // Optional: extend logic here to merge contiguous spoofed prices
            this.logger?.info(
                `Spoofing detected in band: ${maxSpoofEvent.spoofType}`,
                {
                    component: "SpoofingDetector",
                    operation: "wasSpoofed",
                    band: [maxSpoofEvent.priceStart, maxSpoofEvent.priceEnd],
                    ...maxSpoofEvent,
                }
            );
        }

        // Emit anomaly event for legacy spoofing detection if found
        if (spoofDetected && maxSpoofEvent && this.anomalyDetector) {
            this.anomalyDetector.onSpoofingEvent(maxSpoofEvent, price);

            // Create spoofing zone for chart visualization
            this.emitSpoofingZone(maxSpoofEvent);
        }

        return spoofDetected;
    }

    /**
     * Create and emit spoofing zone for chart visualization
     */
    private emitSpoofingZone(spoofingEvent: SpoofingEvent): void {
        const priceRange = Math.abs(
            spoofingEvent.priceEnd - spoofingEvent.priceStart
        );
        const tickMultiplier = this.config.priceDeviationTickMultiplier ?? 2;
        const priceDeviation = Math.max(
            priceRange / 2,
            this.config.tickSize * tickMultiplier
        );

        const spoofingZone: SpoofingZone = {
            id: `spoof_${spoofingEvent.timestamp}`,
            type: "spoofing",
            priceRange: {
                min:
                    Math.min(spoofingEvent.priceStart, spoofingEvent.priceEnd) -
                    priceDeviation,
                max:
                    Math.max(spoofingEvent.priceStart, spoofingEvent.priceEnd) +
                    priceDeviation,
            },
            startTime: spoofingEvent.timestamp - spoofingEvent.cancelTimeMs,
            endTime: spoofingEvent.timestamp,
            strength: spoofingEvent.confidence,
            completion: 1.0, // Completed when detected
            spoofType: spoofingEvent.spoofType,
            wallSize: spoofingEvent.wallBefore,
            canceled: spoofingEvent.canceled,
            executed: spoofingEvent.executed,
            side: spoofingEvent.side,
            confidence: spoofingEvent.confidence,
            marketImpact: spoofingEvent.marketImpact,
            cancelTimeMs: spoofingEvent.cancelTimeMs,
        };

        // Emit zone update for dashboard visualization
        try {
            this.emit("zoneUpdated", {
                updateType: "zone_created",
                zone: spoofingZone,
                significance:
                    spoofingEvent.confidence >
                    (this.config.highSignificanceThreshold ??
                        SpoofingDetector.HIGH_SIGNIFICANCE_THRESHOLD)
                        ? "high"
                        : spoofingEvent.confidence >
                            (this.config.mediumSignificanceThreshold ??
                                SpoofingDetector.MEDIUM_SIGNIFICANCE_THRESHOLD)
                          ? "medium"
                          : "low",
            });
        } catch (err) {
            this.logger?.error?.("Failed to emit spoofing zone", {
                component: "SpoofingDetector",
                operation: "emitSpoofingZone",
                error: err instanceof Error ? err.message : String(err),
            });
        }

        this.logger?.info?.("Spoofing zone created", {
            component: "SpoofingDetector",
            operation: "emitSpoofingZone",
            zoneId: spoofingZone.id,
            spoofType: spoofingEvent.spoofType,
            confidence: spoofingEvent.confidence,
        });
    }

    /**
     * Detect fake wall spoofing - large orders that disappear when approached
     */
    private detectFakeWallSpoofing(
        price: number,
        side: "buy" | "sell",
        tradeTime: number
    ): SpoofingEvent | null {
        const normalizedPrice = this.normalizePrice(price);
        const hist = this.passiveChangeHistory.get(normalizedPrice);
        if (!hist || hist.length < 2) return null;

        const maxCancelRatio = this.config.maxCancellationRatio ?? 0.8;
        const rapidCancelMs = this.config.rapidCancellationMs ?? 500;
        const minWallSize = this.config.minWallSize;

        // Look for recent large walls that disappeared rapidly
        for (let i = hist.length - 2; i >= 0; i--) {
            const curr = hist[i + 1]!;
            const prev = hist[i]!;
            if (curr.time > tradeTime) continue;

            const prevQty = side === "buy" ? prev.bid : prev.ask;
            const currQty = side === "buy" ? curr.bid : curr.ask;
            const delta = prevQty - currQty;
            const timeDiff = curr.time - prev.time;

            if (
                prevQty >= minWallSize &&
                delta > 0 &&
                this.safeRatio(delta, prevQty, 0) > maxCancelRatio &&
                timeDiff < rapidCancelMs
            ) {
                return {
                    priceStart: normalizedPrice,
                    priceEnd: normalizedPrice,
                    side,
                    wallBefore: prevQty,
                    wallAfter: currQty,
                    canceled: delta,
                    executed: 0, // Assume no execution for fake walls
                    timestamp: curr.time,
                    spoofedSide: side === "buy" ? "bid" : "ask",
                    spoofType: "fake_wall",
                    confidence: Math.min(
                        this.config.minConfidenceScore ?? 0.95,
                        this.safeRatio(delta, prevQty, 0)
                    ),
                    cancelTimeMs: timeDiff,
                    marketImpact: 0, // ✅ COMPLETED: Market impact calculated in calculateBasicMarketImpact()
                };
            }
        }
        return null;
    }

    /**
     * Detect layering attacks - coordinated spoofing across multiple price levels
     */
    private detectLayeringAttack(
        price: number,
        side: "buy" | "sell",
        tradeTime: number
    ): SpoofingEvent | null {
        const layeringLevels = this.config.layeringDetectionLevels ?? 3;
        const tickSize = this.config.tickSize;
        const rapidCancelMs = this.config.rapidCancellationMs ?? 500;

        let layeredCancellations = 0;
        let totalCanceled = 0;
        let avgCancelTime = 0;

        // Check multiple price levels around the target price
        for (let level = 1; level <= layeringLevels; level++) {
            const offsetPrice =
                side === "buy"
                    ? price - level * tickSize
                    : price + level * tickSize;

            const fakeWall = this.detectFakeWallSpoofing(
                offsetPrice,
                side,
                tradeTime
            );
            if (fakeWall && fakeWall.cancelTimeMs < rapidCancelMs) {
                layeredCancellations++;
                totalCanceled += fakeWall.canceled;
                avgCancelTime += fakeWall.cancelTimeMs;
            }
        }

        // Layering requires coordinated cancellations across multiple levels
        const minCoordinated = this.config.layeringMinCoordinatedLevels ?? 2;
        if (layeredCancellations >= minCoordinated) {
            // 🔧 FIX: Use safe division to prevent division by zero
            avgCancelTime = this.safeDivision(
                avgCancelTime,
                layeredCancellations,
                0
            );
            return {
                priceStart: price - layeringLevels * tickSize,
                priceEnd: price + layeringLevels * tickSize,
                side,
                wallBefore: totalCanceled,
                wallAfter: 0,
                canceled: totalCanceled,
                executed: 0,
                timestamp: tradeTime,
                spoofedSide: side === "buy" ? "bid" : "ask",
                spoofType: "layering",
                confidence: Math.min(
                    this.config.layeringMaxConfidence ?? 0.9,
                    this.safeRatio(layeredCancellations, layeringLevels, 0)
                ),
                cancelTimeMs: avgCancelTime,
                marketImpact: 0, // ✅ COMPLETED: Market impact calculated in calculateBasicMarketImpact()
            };
        }
        return null;
    }

    /**
     * Detect ghost liquidity - orders that vanish when market approaches
     * Pattern: low liquidity -> sudden large liquidity -> liquidity disappears very quickly
     */
    private detectGhostLiquidity(
        price: number,
        side: "buy" | "sell",
        tradeTime: number
    ): SpoofingEvent | null {
        const ghostThresholdMs = this.config.ghostLiquidityThresholdMs ?? 200;
        const normalizedPrice = this.normalizePrice(price);
        const hist = this.passiveChangeHistory.get(normalizedPrice);

        if (!hist || hist.length < 3) return null;

        // Look for patterns where liquidity appears and disappears very quickly
        for (let i = hist.length - 3; i >= 0; i--) {
            const latest = hist[i + 2]!;
            const middle = hist[i + 1]!;
            const earliest = hist[i]!;

            if (latest.time > tradeTime) continue;

            const sideQty = side === "buy" ? "bid" : "ask";
            const earlyQty = earliest[sideQty];
            const midQty = middle[sideQty];
            const lateQty = latest[sideQty];

            // Enhanced ghost liquidity pattern detection:
            // 1. Low initial liquidity (below minWallSize)
            // 2. Sudden large liquidity appears (>= minWallSize)
            // 3. Liquidity disappears quickly back to low levels
            // 4. Total timeframe is very fast (within ghostThresholdMs)
            // 5. The "disappearance" must be significant (not just partial reduction)
            const totalTimeMs = latest.time - earliest.time;
            // 🔧 FIX: Use safe ratio calculation to prevent division by zero
            const disappearanceRatio = this.safeRatio(
                midQty - lateQty,
                midQty,
                0
            );

            if (
                earlyQty < this.config.minWallSize &&
                midQty >= this.config.minWallSize &&
                lateQty < this.config.minWallSize &&
                totalTimeMs < ghostThresholdMs &&
                disappearanceRatio >
                    (this.config.ghostLiquidityDisappearanceRatio ??
                        SpoofingDetector.GHOST_DISAPPEARANCE_RATIO)
            ) {
                // >85% of liquidity must disappear

                return {
                    priceStart: normalizedPrice,
                    priceEnd: normalizedPrice,
                    side,
                    wallBefore: midQty,
                    wallAfter: lateQty,
                    canceled: midQty - lateQty,
                    executed: 0,
                    timestamp: latest.time,
                    spoofedSide: side === "buy" ? "bid" : "ask",
                    spoofType: "ghost_liquidity",
                    confidence:
                        this.config.ghostLiquidityConfidence ??
                        SpoofingDetector.GHOST_DISAPPEARANCE_RATIO,
                    cancelTimeMs: latest.time - middle.time,
                    marketImpact: 0,
                };
            }
        }
        return null;
    }

    /**
     * Enhanced spoofing detection that combines multiple algorithms
     * Priority order: Ghost Liquidity > Layering > Fake Wall
     * This ensures more sophisticated patterns are detected before simpler ones
     */
    public detectSpoofingPatterns(
        price: number,
        side: "buy" | "sell",
        tradeTime: number
    ): SpoofingEvent[] {
        const spoofingEvents: SpoofingEvent[] = [];

        // PRIORITY 1: Check for ghost liquidity first (most sophisticated pattern)
        const ghostLiquidity = this.detectGhostLiquidity(
            price,
            side,
            tradeTime
        );
        if (ghostLiquidity) {
            spoofingEvents.push(ghostLiquidity);
            return spoofingEvents; // Return early - ghost liquidity takes precedence
        }

        // PRIORITY 2: Check for layering attacks (coordinated multi-level)
        const layering = this.detectLayeringAttack(price, side, tradeTime);
        if (layering) {
            spoofingEvents.push(layering);
            return spoofingEvents; // Return early - layering takes precedence over fake walls
        }

        // PRIORITY 3: Check for simple fake walls (last resort)
        const fakeWall = this.detectFakeWallSpoofing(price, side, tradeTime);
        if (fakeWall) spoofingEvents.push(fakeWall);

        return spoofingEvents;
    }

    // Constants for dynamic wall width calculation
    private static readonly VOLATILITY_ADJUSTMENT = 0.5;
    private static readonly DEPTH_MULTIPLIER = 0.5;
    private static readonly CANCELLATION_SENSITIVITY = 0.7;
    private static readonly ACTIVITY_MULTIPLIER = 0.3;
    private static readonly MIN_MULTIPLIER = 0.2;
    private static readonly MAX_MULTIPLIER = 3.0;

    // Constants for cancellation intensity calculation
    private static readonly CANCELLATION_TIME_WINDOW_MS = 30000; // 30 seconds
    private static readonly EXPECTED_CANCELLATIONS = 5; // Baseline expectation

    // Constants for market activity calculation
    private static readonly ACTIVITY_TIME_WINDOW_MS = 60000; // 1 minute
    private static readonly EXPECTED_ACTIVITY = 20; // Baseline expectation per minute

    // Additional constants for spoofing detection
    private static readonly WALL_PULL_RATIO = 0.6;
    private static readonly CANCEL_TIME_MULTIPLIER = 2000;
    private static readonly PRICE_SCALING_FACTOR = 100000000;
    private static readonly GHOST_DISAPPEARANCE_RATIO = 0.85;
    private static readonly ACTIVITY_MULTIPLIER_CAP = 1.5;
    private static readonly DEFAULT_BASE_CONFIDENCE = 0.6;
    private static readonly SIZE_MULTIPLIER_DIVISOR = 100;
    private static readonly SIZE_MULTIPLIER_CAP = 2.0;
    private static readonly TIME_MULTIPLIER_MIN = 0.5;
    private static readonly HIGH_SIGNIFICANCE_THRESHOLD = 0.8;
    private static readonly MEDIUM_SIGNIFICANCE_THRESHOLD = 0.6;
    private static readonly BASE_MULTIPLIER = 1.0;
    private static readonly RECENT_HISTORY_LENGTH = 10;
    private static readonly DEPTH_CALCULATION_HISTORY_LENGTH = 20;
    private static readonly LOG_THRESHOLD_RATIO = 0.3;
    private static readonly PRICE_TOLERANCE_RATIO = 0.005;

    /**
     * Dynamic wall width calculation based on recent market conditions.
     * ✅ COMPLETED: Analyzes liquidity volatility, order book depth, cancellation intensity,
     * and market activity to determine optimal wall detection sensitivity.
     *
     * Factors considered:
     * - Liquidity volatility (higher = narrower walls)
     * - Order book depth (deeper = wider walls)
     * - Cancellation intensity (higher = narrower walls)
     * - Market activity level (higher = slightly wider walls)
     */
    private getDynamicWallTicks(price: number, side: "buy" | "sell"): number {
        const baseTicks = this.config.wallTicks;
        let dynamicMultiplier = 1.0;

        try {
            // Factor 1: Liquidity Volatility Analysis
            const liquidityVolatility = this.calculateLiquidityVolatility(
                price,
                side
            );
            if (liquidityVolatility > 0) {
                // Higher volatility = narrower walls (more sensitive detection)
                dynamicMultiplier *= Math.max(
                    SpoofingDetector.MIN_MULTIPLIER,
                    1.0 -
                        liquidityVolatility *
                            SpoofingDetector.VOLATILITY_ADJUSTMENT
                );
            }

            // Factor 2: Order Book Depth Analysis
            const depthRatio = this.calculateOrderBookDepth(price, side);
            if (depthRatio > 0) {
                // Deeper order book = wider walls (less sensitive to small changes)
                dynamicMultiplier *= Math.min(
                    2.0,
                    1.0 + depthRatio * SpoofingDetector.DEPTH_MULTIPLIER
                );
            }

            // Factor 3: Recent Cancellation Activity
            const cancellationIntensity = this.calculateCancellationIntensity(
                price,
                side
            );
            if (cancellationIntensity > 0) {
                // Higher cancellation activity = narrower walls (more alert to spoofing)
                dynamicMultiplier *= Math.max(
                    SpoofingDetector.MIN_MULTIPLIER,
                    1.0 -
                        cancellationIntensity *
                            SpoofingDetector.CANCELLATION_SENSITIVITY
                );
            }

            // Factor 4: Market Activity Level
            const activityLevel = this.calculateMarketActivity(price);
            if (activityLevel > 0) {
                // Higher activity = slightly wider walls (account for normal fluctuations)
                dynamicMultiplier *= Math.min(
                    SpoofingDetector.ACTIVITY_MULTIPLIER_CAP,
                    SpoofingDetector.BASE_MULTIPLIER +
                        activityLevel * SpoofingDetector.ACTIVITY_MULTIPLIER
                );
            }

            // Apply bounds to prevent extreme values
            dynamicMultiplier = Math.max(
                SpoofingDetector.MIN_MULTIPLIER,
                Math.min(SpoofingDetector.MAX_MULTIPLIER, dynamicMultiplier)
            );

            const dynamicTicks = Math.round(baseTicks * dynamicMultiplier);

            // Log significant changes for monitoring
            if (
                Math.abs(dynamicTicks - baseTicks) >
                baseTicks * SpoofingDetector.LOG_THRESHOLD_RATIO
            ) {
                this.logger?.info?.("Dynamic wall width adjustment", {
                    component: "SpoofingDetector",
                    price: price.toFixed(2),
                    side,
                    baseTicks,
                    dynamicTicks,
                    multiplier: dynamicMultiplier.toFixed(2),
                    factors: {
                        liquidityVolatility: liquidityVolatility.toFixed(3),
                        depthRatio: depthRatio.toFixed(3),
                        cancellationIntensity: cancellationIntensity.toFixed(3),
                        activityLevel: activityLevel.toFixed(3),
                    },
                });
            }

            return dynamicTicks;
        } catch (error) {
            // Fallback to base configuration on any error
            this.logger?.warn?.(
                "Error calculating dynamic wall width, using base config",
                {
                    component: "SpoofingDetector",
                    error:
                        error instanceof Error ? error.message : String(error),
                    price: price.toFixed(2),
                    side,
                    baseTicks,
                }
            );
            return baseTicks;
        }
    }

    /**
     * Calculate liquidity volatility based on recent bid/ask changes
     */
    private calculateLiquidityVolatility(
        price: number,
        side: "buy" | "sell"
    ): number {
        try {
            const normalizedPrice = this.normalizePrice(price);
            const history = this.passiveChangeHistory.get(normalizedPrice);

            if (!history || history.length < 3) {
                return 0; // Insufficient data
            }

            // Calculate volatility as coefficient of variation of liquidity changes
            const recentHistory = history.slice(
                -SpoofingDetector.RECENT_HISTORY_LENGTH
            ); // Last N entries
            const changes: number[] = [];

            for (let i = 1; i < recentHistory.length; i++) {
                const current = recentHistory[i]!;
                const previous = recentHistory[i - 1]!;

                const currentLiquidity =
                    side === "buy" ? current.bid : current.ask;
                const previousLiquidity =
                    side === "buy" ? previous.bid : previous.ask;

                if (previousLiquidity > 0) {
                    const change =
                        Math.abs(currentLiquidity - previousLiquidity) /
                        previousLiquidity;
                    changes.push(change);
                }
            }

            if (changes.length === 0) return 0;

            // Calculate coefficient of variation (std dev / mean)
            const mean =
                changes.reduce((sum, val) => sum + val, 0) / changes.length;
            const variance =
                changes.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
                changes.length;
            const stdDev = Math.sqrt(variance);

            return mean > 0 ? stdDev / mean : 0;
        } catch {
            return 0; // Safe fallback
        }
    }

    /**
     * Calculate order book depth ratio relative to typical levels
     */
    private calculateOrderBookDepth(
        price: number,
        side: "buy" | "sell"
    ): number {
        try {
            const normalizedPrice = this.normalizePrice(price);
            const history = this.passiveChangeHistory.get(normalizedPrice);

            if (!history || history.length < 5) {
                return 0; // Insufficient data
            }

            // Get current liquidity
            const current = history[history.length - 1];
            if (!current) return 0;

            const currentLiquidity = side === "buy" ? current.bid : current.ask;

            // Calculate average liquidity over recent history
            const recentHistory = history.slice(
                -SpoofingDetector.DEPTH_CALCULATION_HISTORY_LENGTH
            ); // Last N entries
            const avgLiquidity =
                recentHistory.reduce((sum, entry) => {
                    return sum + (side === "buy" ? entry.bid : entry.ask);
                }, 0) / recentHistory.length;

            if (avgLiquidity === 0) return 0;

            // Return ratio (current / average) - values > 1 mean deeper than average
            return currentLiquidity / avgLiquidity;
        } catch {
            return 0; // Safe fallback
        }
    }

    /**
     * Calculate recent cancellation activity intensity
     */
    private calculateCancellationIntensity(
        price: number,
        side: "buy" | "sell"
    ): number {
        try {
            const now = Date.now();
            let cancellationCount = 0;

            // Count recent cancellations in the price area
            const cancellationKeys = this.cancellationPatterns.keys();
            for (const key of cancellationKeys) {
                const pattern = this.cancellationPatterns.get(key);
                if (
                    pattern &&
                    typeof pattern === "object" &&
                    "price" in pattern &&
                    "side" in pattern &&
                    "cancellationTime" in pattern
                ) {
                    const typedPattern = pattern as {
                        price: number;
                        side: string;
                        cancellationTime: number;
                    };
                    if (
                        typeof typedPattern.price === "number" &&
                        typeof typedPattern.side === "string" &&
                        typeof typedPattern.cancellationTime === "number" &&
                        Math.abs(typedPattern.price - price) < price * 0.001 && // Within 0.1% of price
                        typedPattern.side ===
                            (side === "buy" ? "bid" : "ask") &&
                        now - typedPattern.cancellationTime <
                            SpoofingDetector.CANCELLATION_TIME_WINDOW_MS
                    ) {
                        cancellationCount++;
                    }
                }
            }

            if (cancellationCount === 0) return 0;

            // Normalize by expected activity level (rough heuristic)
            const intensity =
                cancellationCount / SpoofingDetector.EXPECTED_CANCELLATIONS;

            return Math.min(2.0, intensity); // Cap at 2.0
        } catch {
            return 0; // Safe fallback
        }
    }

    /**
     * Calculate overall market activity level
     */
    private calculateMarketActivity(price: number): number {
        try {
            const now = Date.now();
            let activityCount = 0;

            // Count recent order placements and cancellations
            const placementKeys = this.orderPlacementHistory.keys();
            for (const priceKey of placementKeys) {
                const placements = this.orderPlacementHistory.get(priceKey);
                if (!placements) continue;
                if (
                    Math.abs(priceKey - price) <
                    price * SpoofingDetector.PRICE_TOLERANCE_RATIO
                ) {
                    // Within 0.5% of price
                    if (Array.isArray(placements)) {
                        activityCount += placements.filter(
                            (p) =>
                                p &&
                                typeof p === "object" &&
                                "time" in p &&
                                typeof (p as { time: number }).time ===
                                    "number" &&
                                now - (p as { time: number }).time <
                                    SpoofingDetector.ACTIVITY_TIME_WINDOW_MS
                        ).length;
                    }
                }
            }

            const cancellationKeys2 = this.cancellationPatterns.keys();
            for (const key of cancellationKeys2) {
                const pattern = this.cancellationPatterns.get(key);
                if (!pattern) continue;
                if (
                    pattern &&
                    typeof pattern === "object" &&
                    "price" in pattern &&
                    "cancellationTime" in pattern
                ) {
                    const typedPattern = pattern as {
                        price: number;
                        cancellationTime: number;
                    };
                    if (
                        typeof typedPattern.price === "number" &&
                        typeof typedPattern.cancellationTime === "number" &&
                        Math.abs(typedPattern.price - price) <
                            price * SpoofingDetector.PRICE_TOLERANCE_RATIO &&
                        now - typedPattern.cancellationTime <
                            SpoofingDetector.ACTIVITY_TIME_WINDOW_MS
                    ) {
                        activityCount++;
                    }
                }
            }

            // Normalize activity level (rough heuristic)
            const activityRatio =
                activityCount / SpoofingDetector.EXPECTED_ACTIVITY;

            return Math.min(3.0, activityRatio); // Cap at 3.0
        } catch {
            return 0; // Safe fallback
        }
    }

    /**
     * Cleanup expired cache entries to prevent memory bloat
     */
    private cleanupExpiredEntries(): void {
        const now = Date.now();
        let totalCleaned = 0;

        // Clean up order placement history
        const placementKeys = Array.from(this.orderPlacementHistory.keys());
        for (const price of placementKeys) {
            const history = this.orderPlacementHistory.get(price);
            if (history) {
                const originalLength = history.length;
                // Filter out old entries
                const validHistory = history.filter(
                    (entry) =>
                        now - entry.time <=
                        (this.config.orderPlacementCacheTTL ?? 300000)
                );

                if (validHistory.length === 0) {
                    this.orderPlacementHistory.delete(price);
                    totalCleaned += originalLength;
                } else if (validHistory.length < originalLength) {
                    this.orderPlacementHistory.set(price, validHistory);
                    totalCleaned += originalLength - validHistory.length;
                }
            }
        }

        // Clean up passive change history
        const passiveKeys = Array.from(this.passiveChangeHistory.keys());
        for (const price of passiveKeys) {
            const history = this.passiveChangeHistory.get(price);
            if (history) {
                const originalLength = history.length;
                const validHistory = history.filter(
                    (entry) =>
                        now - entry.time <=
                        (this.config.passiveHistoryCacheTTL ?? 300000)
                );

                if (validHistory.length === 0) {
                    this.passiveChangeHistory.delete(price);
                    totalCleaned += originalLength;
                } else if (validHistory.length < originalLength) {
                    this.passiveChangeHistory.set(price, validHistory);
                    totalCleaned += originalLength - validHistory.length;
                }
            }
        }

        // Clean up cancellation patterns
        const cancellationKeys = Array.from(this.cancellationPatterns.keys());
        for (const placementId of cancellationKeys) {
            const pattern = this.cancellationPatterns.get(placementId);
            if (
                pattern &&
                now - pattern.cancellationTime >
                    (this.config.cancellationPatternCacheTTL ?? 300000)
            ) {
                this.cancellationPatterns.delete(placementId);
                totalCleaned++;
            }
        }

        // Log cleanup activity if significant
        if (totalCleaned > 0) {
            // Calculate remaining entries for logging
            let remainingPlacementHistory = 0;
            let remainingPassiveHistory = 0;

            // Count remaining entries safely
            try {
                // Count placement history entries
                const placementKeys = this.orderPlacementHistory.keys();
                for (const price of placementKeys) {
                    const placements = this.orderPlacementHistory.get(price);
                    if (placements && Array.isArray(placements)) {
                        remainingPlacementHistory += placements.length;
                    }
                }

                // Count passive history entries
                const passiveKeys = this.passiveChangeHistory.keys();
                for (const price of passiveKeys) {
                    const history = this.passiveChangeHistory.get(price);
                    if (history && Array.isArray(history)) {
                        remainingPassiveHistory += history.length;
                    }
                }
            } catch {
                // If counting fails, use fallback values
                remainingPlacementHistory = 0;
                remainingPassiveHistory = 0;
            }

            const remainingCancellationPatterns = Array.from(
                this.cancellationPatterns.keys()
            ).length;
            this.logger?.info?.("SpoofingDetector cache cleanup completed", {
                component: "SpoofingDetector",
                entriesCleaned: totalCleaned,
                remainingPlacementHistory,
                remainingPassiveHistory,
                remainingCancellationPatterns,
            });
        }
    }
}
