import { vi } from "vitest";

export class ThreadManager {
    callStorage = vi.fn().mockResolvedValue(undefined);
    broadcast = vi.fn();
    shutdown = vi.fn();
    isStarted = vi.fn().mockReturnValue(true);
    startWorkers = vi.fn().mockResolvedValue(undefined);
}
