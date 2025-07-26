import { vi } from "vitest";

export class RateLimiter {
    isAllowed = vi.fn<(clientId: string) => boolean>().mockReturnValue(true);
    getRequestCount = vi.fn<(clientId: string) => number>().mockReturnValue(0);
    clear = vi.fn<() => void>();
    destroy = vi.fn<() => void>();
}
export default { RateLimiter };
export const __esModule = true;
