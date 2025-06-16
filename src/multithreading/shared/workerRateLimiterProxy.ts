// src/multithreading/shared/workerRateLimiterProxy.ts
import type { IWorkerRateLimiter } from "./workerInterfaces.js";

/**
 * Enhanced worker-side proxy for RateLimiter with client-specific tracking
 * Supports both global and per-client rate limiting for WebSocket compatibility
 * Replaces direct infrastructure imports in worker threads
 */
export class WorkerRateLimiterProxy implements IWorkerRateLimiter {
    private globalRequests: number[] = [];
    private clientRequests = new Map<string, number[]>();
    private readonly windowMs: number;
    private readonly maxRequests: number;
    private readonly MAX_REQUESTS_HISTORY = 10000; // Memory leak prevention
    private readonly MAX_CLIENTS = 1000; // Prevent memory leaks from client tracking

    constructor(windowMs: number, maxRequests: number) {
        this.windowMs = windowMs;
        this.maxRequests = maxRequests;
    }

    /**
     * Overloaded method: supports both global and client-specific rate limiting
     */
    isAllowed(): boolean;
    isAllowed(clientId: string): boolean;
    isAllowed(clientId?: string): boolean {
        if (clientId === undefined) {
            return this.isGlobalAllowed();
        }
        return this.isClientAllowed(clientId);
    }

    /**
     * Global rate limiting (backward compatibility)
     */
    private isGlobalAllowed(): boolean {
        const now = Date.now();

        // Efficient cleanup with size limit to prevent memory leaks
        if (this.globalRequests.length > this.MAX_REQUESTS_HISTORY) {
            this.globalRequests = this.globalRequests.slice(
                -this.MAX_REQUESTS_HISTORY
            );
        }

        this.globalRequests = this.globalRequests.filter(
            (time) => now - time < this.windowMs
        );

        if (this.globalRequests.length >= this.maxRequests) {
            return false;
        }

        this.globalRequests.push(now);
        return true;
    }

    /**
     * Client-specific rate limiting (WebSocketManager compatibility)
     */
    private isClientAllowed(clientId: string): boolean {
        const now = Date.now();

        // Get or create client request history
        let clientHistory = this.clientRequests.get(clientId);
        if (!clientHistory) {
            clientHistory = [];
            this.clientRequests.set(clientId, clientHistory);
        }

        // Cleanup old requests for this client
        const validRequests = clientHistory.filter(
            (time) => now - time < this.windowMs
        );
        this.clientRequests.set(clientId, validRequests);

        if (validRequests.length >= this.maxRequests) {
            return false;
        }

        validRequests.push(now);
        this.clientRequests.set(clientId, validRequests);
        return true;
    }

    /**
     * Add a client for tracking (explicit registration)
     */
    addClient(clientId: string): void {
        if (!this.clientRequests.has(clientId)) {
            this.clientRequests.set(clientId, []);
        }

        // Prevent memory leaks by limiting client count
        if (this.clientRequests.size > this.MAX_CLIENTS) {
            this.cleanup();
        }
    }

    /**
     * Remove a client from tracking
     */
    removeClient(clientId: string): void {
        this.clientRequests.delete(clientId);
    }

    /**
     * Get remaining requests for global or specific client
     */
    getRemainingRequests(): number;
    getRemainingRequests(clientId: string): number;
    getRemainingRequests(clientId?: string): number {
        if (clientId === undefined) {
            return this.getGlobalRemainingRequests();
        }
        return this.getClientRemainingRequests(clientId);
    }

    /**
     * Global remaining requests
     */
    private getGlobalRemainingRequests(): number {
        const now = Date.now();

        // Cleanup old requests
        if (this.globalRequests.length > this.MAX_REQUESTS_HISTORY) {
            this.globalRequests = this.globalRequests.slice(
                -this.MAX_REQUESTS_HISTORY
            );
        }

        this.globalRequests = this.globalRequests.filter(
            (time) => now - time < this.windowMs
        );
        return Math.max(0, this.maxRequests - this.globalRequests.length);
    }

    /**
     * Client-specific remaining requests
     */
    private getClientRemainingRequests(clientId: string): number {
        const now = Date.now();
        const clientHistory = this.clientRequests.get(clientId) || [];

        const validRequests = clientHistory.filter(
            (time) => now - time < this.windowMs
        );

        return Math.max(0, this.maxRequests - validRequests.length);
    }

    /**
     * Cleanup inactive clients and old requests
     */
    cleanup(): void {
        const now = Date.now();
        const clientsToRemove: string[] = [];

        // Remove clients with no recent activity
        for (const [clientId, requests] of this.clientRequests) {
            const validRequests = requests.filter(
                (time) => now - time < this.windowMs
            );

            if (validRequests.length === 0) {
                // No recent activity, mark for removal
                clientsToRemove.push(clientId);
            } else {
                // Update with cleaned requests
                this.clientRequests.set(clientId, validRequests);
            }
        }

        // Remove inactive clients
        for (const clientId of clientsToRemove) {
            this.clientRequests.delete(clientId);
        }

        // Cleanup global requests
        if (this.globalRequests.length > this.MAX_REQUESTS_HISTORY) {
            this.globalRequests = this.globalRequests.slice(
                -this.MAX_REQUESTS_HISTORY
            );
        }
        this.globalRequests = this.globalRequests.filter(
            (time) => now - time < this.windowMs
        );
    }
}
