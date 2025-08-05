// src/infrastructure/rateLimiter.ts

/**
 * Rate limiter for API protection
 */
export class RateLimiter {
    private readonly requests = new Map<string, number[]>();
    private readonly cleanupInterval: NodeJS.Timeout;

    constructor(
        private readonly windowMs: number = 60000,
        private readonly maxRequests: number = 100
    ) {
        // Cleanup old entries every minute
        this.cleanupInterval = setInterval(() => this.cleanup(), this.windowMs);
    }

    /**
     * Check if a client is allowed to make a request
     */
    public isAllowed(clientId: string): boolean {
        const now = Date.now();
        const clientRequests = this.requests.get(clientId) || [];

        // Remove old requests outside the window
        const validRequests = clientRequests.filter(
            (time) => now - time < this.windowMs
        );

        if (validRequests.length >= this.maxRequests) {
            return false;
        }

        validRequests.push(now);
        this.requests.set(clientId, validRequests);
        return true;
    }

    /**
     * Cleanup old request records
     */
    private cleanup(): void {
        const now = Date.now();
        for (const [clientId, requests] of this.requests.entries()) {
            const validRequests = requests.filter(
                (time) => now - time < this.windowMs
            );
            if (validRequests.length === 0) {
                this.requests.delete(clientId);
            } else {
                this.requests.set(clientId, validRequests);
            }
        }
    }

    /**
     * Get current request count for a client
     */
    public getRequestCount(clientId: string): number {
        const now = Date.now();
        const clientRequests = this.requests.get(clientId) || [];
        return clientRequests.filter((time) => now - time < this.windowMs)
            .length;
    }

    /**
     * Clear rate limiter data
     */
    public clear(): void {
        this.requests.clear();
    }

    /**
     * Destroy the rate limiter
     */
    public destroy(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.clear();
    }
}
