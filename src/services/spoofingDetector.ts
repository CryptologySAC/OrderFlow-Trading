// src/indicators/SpoofingDetector.ts
// TODO If you want to score spoofing events, modify your SpoofingDetector to return the actual SpoofingEvent object (not just boolean).
// TODO You could then emit a severity/confidence level proportional to the size and cancel/execution ratio.
import { TimeAwareCache } from "../utils/utils.js";

export interface SpoofingDetectorConfig {
    tickSize: number; // 0.01 for LTCUSDT
    wallTicks: number; // e.g. 10
    minWallSize: number; // e.g. 20 (LTC) or 2 * wallTicks (dynamic)
    dynamicWallWidth?: boolean; // enable auto-scaling band width
    testLogMinSpoof?: number; // log all spoof cancels above this size (e.g. 50 for test)
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
}

export class SpoofingDetector {
    private passiveChangeHistory = new TimeAwareCache<
        number,
        { time: number; bid: number; ask: number }[]
    >(300000); // 5 minutes TTL

    private config: SpoofingDetectorConfig;

    constructor(config: SpoofingDetectorConfig) {
        this.config = config;
    }

    /**
     * Normalize price keys to prevent excessive cache entries due to floating-point precision variations.
     * This ensures consistent price keys and prevents memory bloat from slight precision differences.
     */
    private normalizePrice(price: number): number {
        return Number(price.toFixed(8));
    }

    /**
     * Track changes in passive (limit) orderbook at price level.
     */
    public trackPassiveChange(price: number, bid: number, ask: number): void {
        const now = Date.now();
        const normalizedPrice = this.normalizePrice(price);
        let history = this.passiveChangeHistory.get(normalizedPrice) || [];
        history.push({ time: now, bid, ask });
        if (history.length > 10) {
            history.shift(); // Remove oldest item instead of creating new array
        }
        this.passiveChangeHistory.set(normalizedPrice, history);
    }

    /**
     * Detect spoofing (fake wall pull) at band around price/side.
     * Returns true if spoofed; logs event if size >= testLogMinSpoof.
     */
    public wasSpoofed(
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
        // Optionally determine wall width dynamically
        const wallBand = dynamicWallWidth
            ? this.getDynamicWallTicks(price, side)
            : wallTicks;

        let spoofDetected = false;
        let maxSpoofEvent: SpoofingEvent | null = null;

        // Performance optimization: Pre-calculate all band prices to avoid repeated floating-point operations in hot path
        const scaledPrice = Math.round(price * 100000000); // 8 decimal places
        const scaledTickSize = Math.round(tickSize * 100000000);
        const bandPrices: number[] = [];
        for (
            let offset = -Math.floor(wallBand / 2);
            offset <= Math.floor(wallBand / 2);
            offset++
        ) {
            const bandPrice =
                (scaledPrice + offset * scaledTickSize) / 100000000;
            bandPrices.push(this.normalizePrice(bandPrice));
        }

        // Check all pre-calculated normalized band prices
        for (const bandPrice of bandPrices) {
            const hist = this.passiveChangeHistory.get(bandPrice);
            if (!hist || hist.length < 2) continue;

            // Scan history from newest back, looking for rapid drops
            for (let i = hist.length - 2; i >= 0; i--) {
                const curr = hist[i + 1];
                const prev = hist[i];
                if (curr.time > tradeTime) continue;
                const prevQty = side === "buy" ? prev.ask : prev.bid;
                const currQty = side === "buy" ? curr.ask : curr.bid;
                const delta = prevQty - currQty;
                if (prevQty < minWallSize) continue; // ignore small walls
                if (
                    prevQty > 0 &&
                    delta / prevQty > 0.6 &&
                    curr.time - prev.time < 1200
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
                        console.log(
                            "[SpoofingDetector][TEST] Large spoofed wall:",
                            {
                                priceStart: bandPrice,
                                priceEnd: bandPrice,
                                side,
                                wallBefore: prevQty,
                                wallAfter: currQty,
                                canceled,
                                executed,
                                timestamp: curr.time,
                                spoofedSide: side === "buy" ? "ask" : "bid",
                            }
                        );
                    }

                    // Only count as spoof if most was canceled, not executed
                    // Fix: Add zero check to prevent division by zero
                    if (
                        delta > 0 &&
                        canceled / delta > 0.7 &&
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
                                spoofedSide: side === "buy" ? "ask" : "bid",
                            };
                        }
                    }
                }
                if (curr.time < tradeTime - 2000) break;
            }
        }

        // Optionally, if wallTicks > 1, summarize the entire wall band
        if (spoofDetected && maxSpoofEvent && wallBand > 1) {
            // Summarize all spoofed prices in the band (for logging)
            // Optional: extend logic here to merge contiguous spoofed prices
            console.log("[SpoofingDetector] Spoofing detected in band:", {
                band: [maxSpoofEvent.priceStart, maxSpoofEvent.priceEnd],
                ...maxSpoofEvent,
            });
        }
        return spoofDetected;
    }

    /**
     * Example dynamic band width calculation.
     * For now, just returns config.wallTicks; can use volatility, liquidity, etc.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private getDynamicWallTicks(price: number, side: "buy" | "sell"): number {
        // TODO: Use recent liquidity, volatility, or order book stats for adaptive width
        // For now: just return wallTicks from config
        return this.config.wallTicks;
    }
}
