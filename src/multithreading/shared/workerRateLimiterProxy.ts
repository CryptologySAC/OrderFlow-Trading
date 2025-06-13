// src/multithreading/shared/workerRateLimiterProxy.ts
import type { IWorkerRateLimiter } from "./workerInterfaces.js";

/**
 * Worker-side proxy for RateLimiter that implements local rate limiting
 * Replaces direct infrastructure imports in worker threads
 */
export class WorkerRateLimiterProxy implements IWorkerRateLimiter {
    private requests: number[] = [];
    private readonly windowMs: number;
    private readonly maxRequests: number;

    constructor(windowMs: number, maxRequests: number) {
        this.windowMs = windowMs;
        this.maxRequests = maxRequests;
    }

    isAllowed(): boolean {
        const now = Date.now();
        this.requests = this.requests.filter(
            (time) => now - time < this.windowMs
        );

        if (this.requests.length >= this.maxRequests) {
            return false;
        }

        this.requests.push(now);
        return true;
    }

    getRemainingRequests(): number {
        const now = Date.now();
        this.requests = this.requests.filter(
            (time) => now - time < this.windowMs
        );
        return Math.max(0, this.maxRequests - this.requests.length);
    }
}
