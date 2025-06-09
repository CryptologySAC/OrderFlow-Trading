// src/infrastructure/rateLimiter.ts

/**
 * Rate limiter for API protection
 */
export class RateLimiter {
    private readonly buckets = new Map<
        string,
        { tokens: number; last: number }
    >();
    private readonly cleanupInterval: NodeJS.Timeout;

    constructor(
        private readonly capacity: number = 100,
        private readonly refillPerSec: number = 50
    ) {
        // Periodically cleanup idle buckets
        this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
    }

    /**
     * Check if a client is allowed to make a request using the token bucket
     * algorithm.
     */
    public isAllowed(clientId: string): boolean {
        const now = Date.now();
        const bucket = this.getBucket(clientId, now);
        this.refill(bucket, now);
        if (bucket.tokens < 1) {
            return false;
        }
        bucket.tokens -= 1;
        return true;
    }

    /**
     * Get current request count for a client within the active bucket.
     */
    public getRequestCount(clientId: string): number {
        const now = Date.now();
        const bucket = this.buckets.get(clientId);
        if (!bucket) {
            return 0;
        }
        this.refill(bucket, now);
        return Math.floor(this.capacity - bucket.tokens);
    }

    /** Clear all rate limiting data */
    public clear(): void {
        this.buckets.clear();
    }

    /** Stop timers and clear all state */
    public destroy(): void {
        clearInterval(this.cleanupInterval);
        this.clear();
    }

    /** Retrieve an existing bucket or create a new one */
    private getBucket(
        clientId: string,
        now: number
    ): {
        tokens: number;
        last: number;
    } {
        const existing = this.buckets.get(clientId);
        if (existing) {
            return existing;
        }
        const bucket = { tokens: this.capacity, last: now };
        this.buckets.set(clientId, bucket);
        return bucket;
    }

    /** Refill tokens in a bucket based on elapsed time */
    private refill(
        bucket: { tokens: number; last: number },
        now: number
    ): void {
        const elapsedSec = (now - bucket.last) / 1000;
        if (elapsedSec > 0) {
            bucket.tokens = Math.min(
                this.capacity,
                bucket.tokens + elapsedSec * this.refillPerSec
            );
            bucket.last = now;
        }
    }

    /** Remove buckets that have been idle long enough */
    private cleanup(): void {
        const now = Date.now();
        for (const [clientId, bucket] of this.buckets) {
            this.refill(bucket, now);
            if (bucket.tokens >= this.capacity) {
                this.buckets.delete(clientId);
            }
        }
    }
}
