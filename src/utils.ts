export function parseBool(
    val: string | undefined,
    defaultValue = false
): boolean {
    if (val === undefined) return defaultValue;
    return val.toLowerCase() === "true";
}
