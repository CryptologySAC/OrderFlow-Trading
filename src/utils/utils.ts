/**
 * Utility to parse boolean-like environment strings.
 */
export function parseBool(
    val: string | undefined,
    defaultValue = false
): boolean {
    if (val === undefined) return defaultValue;
    return val.toLowerCase() === "true";
}

/**
 * Type guard for backlog request shape.
 */
export function isValidBacklogRequest(
    obj: unknown
): obj is { type: "backlog"; data?: { amount?: string | number } } {
    return (
        typeof obj === "object" &&
        obj !== null &&
        "type" in obj &&
        (obj as { type: unknown }).type === "backlog"
    );
}

export const getAggressiveSide = (buyerIsMaker: boolean) =>
    buyerIsMaker ? "sell" : "buy";
