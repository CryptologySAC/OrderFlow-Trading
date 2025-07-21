import { vi } from "vitest";

export class WorkerLogger {
    info =
        vi.fn<
            (
                message: string,
                context?: Record<string, unknown>,
                correlationId?: string
            ) => void
        >();
    error =
        vi.fn<
            (
                message: string,
                context?: Record<string, unknown>,
                correlationId?: string
            ) => void
        >();
    warn =
        vi.fn<
            (
                message: string,
                context?: Record<string, unknown>,
                correlationId?: string
            ) => void
        >();
    debug =
        vi.fn<
            (
                message: string,
                context?: Record<string, unknown>,
                correlationId?: string
            ) => void
        >();
    isDebugEnabled = vi.fn<() => boolean>().mockReturnValue(false);
    setCorrelationId = vi.fn<(id: string, context: string) => void>();
    removeCorrelationId = vi.fn<(id: string) => void>();
}
export default { WorkerLogger };
export const __esModule = true;
