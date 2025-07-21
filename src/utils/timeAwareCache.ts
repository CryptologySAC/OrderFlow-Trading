/**
 * Time-aware cache for automatic cleanup.
 */
export class TimeAwareCache<K, V> {
    private cache = new Map<K, { value: V; timestamp: number }>();
    private lastCleanup = Date.now();
    private readonly cleanupInterval = 60000; // 1 minute

    constructor(private ttl: number) {}

    set(key: K, value: V): void {
        this.cache.set(key, { value, timestamp: Date.now() });
        this.maybeCleanup();
    }

    get(key: K): V | undefined {
        const entry = this.cache.get(key);
        if (!entry) return undefined;
        if (Date.now() - entry.timestamp > this.ttl) {
            this.cache.delete(key);
            return undefined;
        }
        return entry.value;
    }

    has(key: K): boolean {
        return this.get(key) !== undefined;
    }

    delete(key: K): void {
        this.cache.delete(key);
    }

    clear(): void {
        this.cache.clear();
        this.lastCleanup = Date.now();
    }

    /**
     * Manual cleanup for explicit testing/maintenance.
     */
    forceCleanup(): void {
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > this.ttl) {
                this.cache.delete(key);
            }
        }
        this.lastCleanup = now;
    }

    private maybeCleanup(): void {
        const now = Date.now();
        if (now - this.lastCleanup < this.cleanupInterval) return;
        this.forceCleanup();
    }

    size(): number {
        return this.cache.size;
    }

    keys(): K[] {
        return Array.from(this.cache.keys());
    }
}
