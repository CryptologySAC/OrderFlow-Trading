import { vi } from "vitest";

export class AlertManager {
    sendAlert = vi.fn();
    isEnabled = vi.fn().mockReturnValue(true);
}