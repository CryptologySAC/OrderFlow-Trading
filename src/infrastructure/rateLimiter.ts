export interface RateLimiter {
    isAllowed(clientId: string): boolean;
}
