// src/infrastructure/sqliteUtils.ts
/** Utility helpers for dealing with SQLite busy errors */

/**
 * Sleep synchronously using Atomics.wait. This avoids blocking the event loop
 * with a busy-wait loop.
 */
export function sleepSync(ms: number): void {
    const sab = new SharedArrayBuffer(4);
    const int = new Int32Array(sab);
    Atomics.wait(int, 0, 0, ms);
}

/**
 * Execute the provided function, retrying when a SQLITE_BUSY error occurs.
 * A simple exponential backoff is used between attempts.
 */
export function withBusyRetries<T>(
    fn: () => T,
    attempts = 5,
    initialDelay = 50
): T {
    let delay = initialDelay;
    for (let i = 0; ; i++) {
        try {
            return fn();
        } catch (err) {
            if ((err as any)?.code === "SQLITE_BUSY" && i < attempts) {
                sleepSync(delay);
                delay *= 2;
                continue;
            }
            throw err;
        }
    }
}
