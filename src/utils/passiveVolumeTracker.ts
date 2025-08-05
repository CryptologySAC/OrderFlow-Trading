import { TimeAwareCache } from "./timeAwareCache.js";
import { DepthLevel } from "./interfaces.js";
import { FinancialMath } from "./financialMath.js";

/**
 * Tracks passive orderbook volume over time for refill logic.
 */
export class PassiveVolumeTracker {
    private passiveVolumeHistory = new TimeAwareCache<
        number,
        { time: number; bid: number; ask: number }[]
    >(900000); // 15 minutes TTL
    private lastSeenPassive = new TimeAwareCache<number, DepthLevel>(300000); // 5 minutes TTL

    /**
     * Update historical passive volume at price level.
     */
    updatePassiveVolume(price: number, bid: number, ask: number): void {
        let history = this.passiveVolumeHistory.get(price) || [];
        history.push({ time: Date.now(), bid, ask });
        if (history.length > 30) {
            history.shift(); // Remove oldest item instead of creating new array
        }
        this.passiveVolumeHistory.set(price, history);
        this.lastSeenPassive.set(price, { bid, ask });
    }

    /**
     * Detects sustained refill of passive volume (iceberg/hiding).
     */
    hasPassiveRefilled(
        price: number,
        side: "buy" | "sell",
        windowMs = 15000
    ): boolean {
        const history = this.passiveVolumeHistory.get(price);
        if (!history || history.length < 3) return false;
        let refills = 0;
        let prev = side === "buy" ? history[0]!.ask : history[0]!.bid;
        for (const snap of history) {
            const qty = side === "buy" ? snap.ask : snap.bid;
            if (qty > prev * 1.15) refills++;
            prev = qty;
        }
        const now = Date.now();
        return refills >= 3 && now - history[0]!.time < windowMs;
    }

    /**
     * Checks if passive liquidity was refilled vs last seen.
     */
    checkRefillStatus(
        price: number,
        side: "buy" | "sell",
        currentPassive: number
    ): boolean {
        const lastLevel = this.lastSeenPassive.get(price);
        if (!lastLevel) return false;
        const previousQty = side === "buy" ? lastLevel.ask : lastLevel.bid;
        return currentPassive >= previousQty * 0.9;
    }

    /**
     * Get average passive volume at a price level over a time window
     */
    public getAveragePassive(price: number, windowMs: number): number {
        const history = this.passiveVolumeHistory.get(price);
        if (!history || history.length === 0) {
            // No history, return current value
            const current = this.lastSeenPassive.get(price);
            return current ? current.bid + current.ask : 0;
        }

        const now = Date.now();
        const cutoff = now - windowMs;
        const recentHistory = history.filter((h) => h.time >= cutoff);

        if (recentHistory.length === 0) {
            return 0;
        }

        const totalBid = recentHistory.reduce((sum, h) => sum + h.bid, 0);
        const totalAsk = recentHistory.reduce((sum, h) => sum + h.ask, 0);

        return FinancialMath.safeDivide(
            totalBid + totalAsk,
            recentHistory.length,
            0
        );
    }

    /**
     * Get average passive volume for a specific side
     */
    public getAveragePassiveBySide(
        price: number,
        side: "buy" | "sell",
        windowMs: number
    ): number {
        const history = this.passiveVolumeHistory.get(price);
        if (!history || history.length === 0) {
            const current = this.lastSeenPassive.get(price);
            if (!current) return 0;
            return side === "buy" ? current.ask : current.bid;
        }

        const now = Date.now();
        const cutoff = now - windowMs;
        const recentHistory = history.filter((h) => h.time >= cutoff);

        if (recentHistory.length === 0) {
            return 0;
        }

        if (side === "buy") {
            return FinancialMath.safeDivide(
                recentHistory.reduce((sum, h) => sum + h.ask, 0),
                recentHistory.length,
                0
            );
        } else {
            return FinancialMath.safeDivide(
                recentHistory.reduce((sum, h) => sum + h.bid, 0),
                recentHistory.length,
                0
            );
        }
    }
}
