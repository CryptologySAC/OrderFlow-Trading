export function isValidWebSocketMessage(data) {
    if (!data || typeof data !== "object")
        return false;
    const msg = data;
    if (typeof msg["type"] !== "string")
        return false;
    if (typeof msg["now"] !== "number")
        return false;
    const validTypes = [
        "pong",
        "backlog",
        "signal_backlog",
        "rsi_backlog",
        "trade",
        "orderbook",
        "signal",
        "anomaly",
        "rsi",
        "supportResistanceLevel",
        "zoneUpdate",
        "zoneSignal",
        "error",
        "test",
        "stats",
        "connection_status",
    ];
    return validTypes.includes(msg["type"]);
}
export function isValidOrderBookData(data) {
    if (!data || typeof data !== "object")
        return false;
    const ob = data;
    if (!Array.isArray(ob["priceLevels"]))
        return false;
    return ob["priceLevels"].every((level) => {
        if (!level || typeof level !== "object")
            return false;
        const l = level;
        return (typeof l["price"] === "number" &&
            typeof l["bid"] === "number" &&
            typeof l["ask"] === "number");
    });
}
export function isValidSignalData(data) {
    if (!data || typeof data !== "object")
        return false;
    const signal = data;
    const validTypes = [
        "absorption",
        "exhaustion",
        "accumulation",
        "distribution",
        "deltacvd",
        "absorption_confirmed",
        "exhaustion_confirmed",
        "accumulation_confirmed",
        "distribution_confirmed",
        "deltacvd_confirmed",
        "generic",
    ];
    return (typeof signal["id"] === "string" &&
        typeof signal["type"] === "string" &&
        validTypes.includes(signal["type"]) &&
        typeof signal["time"] === "number" &&
        typeof signal["price"] === "number" &&
        (signal["side"] === "buy" || signal["side"] === "sell"));
}
export function isValidAnomalyData(data) {
    if (!data || typeof data !== "object")
        return false;
    const anomaly = data;
    const validSeverities = [
        "low",
        "medium",
        "high",
        "critical",
        "info",
    ];
    const validActions = [
        "pause",
        "reduce_size",
        "close_positions",
        "continue",
        "insufficient_data",
        "caution",
        "consider_long",
        "consider_short",
        "momentum_long",
        "momentum_short",
        "fade_rally",
        "fade_dip",
        "prepare_reversal",
        "join_buy_momentum",
        "join_sell_momentum",
        "avoid_selling",
        "avoid_buying",
        "monitor",
        "watch_support",
        "watch_resistance",
    ];
    return !!(typeof anomaly["type"] === "string" &&
        typeof anomaly["detectedAt"] === "number" &&
        !!validSeverities.includes(anomaly["severity"]) &&
        typeof anomaly["affectedPriceRange"] === "object" &&
        anomaly["affectedPriceRange"] &&
        typeof anomaly["affectedPriceRange"]
            .min === "number" &&
        typeof anomaly["affectedPriceRange"]
            .max === "number" &&
        !!validActions.includes(anomaly["recommendedAction"]) &&
        typeof anomaly["details"] === "object");
}
export function isValidRSIData(data) {
    if (!data || typeof data !== "object")
        return false;
    const rsi = data;
    return (typeof rsi["time"] === "number" &&
        typeof rsi["rsi"] === "number" &&
        rsi["rsi"] >= 0 &&
        rsi["rsi"] <= 100);
}
export function isValidZoneUpdateData(data) {
    if (!data || typeof data !== "object")
        return false;
    const update = data;
    const validTypes = [
        "zone_created",
        "zone_updated",
        "zone_strengthened",
        "zone_weakened",
        "zone_completed",
        "zone_invalidated",
    ];
    return !!(typeof update["updateType"] === "string" &&
        !!validTypes.includes(update["updateType"]) &&
        typeof update["zone"] === "object" &&
        update["zone"] &&
        typeof update["zone"].id === "string" &&
        typeof update["significance"] === "number" &&
        typeof update["detectorId"] === "string" &&
        typeof update["timestamp"] === "number");
}
export function isValidZoneSignalData(data) {
    if (!data || typeof data !== "object")
        return false;
    const signal = data;
    const validTypes = [
        "completion",
        "invalidation",
        "consumption",
    ];
    return !!(typeof signal["signalType"] === "string" &&
        !!validTypes.includes(signal["signalType"]) &&
        typeof signal["zone"] === "object" &&
        signal["zone"] &&
        typeof signal["actionType"] === "string" &&
        typeof signal["confidence"] === "number" &&
        (signal["expectedDirection"] === "up" ||
            signal["expectedDirection"] === "down") &&
        typeof signal["detectorId"] === "string" &&
        typeof signal["timestamp"] === "number");
}
export function isValidSupportResistanceData(data) {
    if (!data || typeof data !== "object")
        return false;
    const level = data;
    return (typeof level["id"] === "string" &&
        typeof level["price"] === "number" &&
        (level["type"] === "support" || level["type"] === "resistance") &&
        typeof level["strength"] === "number" &&
        typeof level["touchCount"] === "number" &&
        typeof level["firstDetected"] === "number" &&
        typeof level["lastTouched"] === "number" &&
        typeof level["volumeAtLevel"] === "number");
}
export function validateAndCastWebSocketMessage(data) {
    return isValidWebSocketMessage(data) ? data : null;
}
export function validateAndCastOrderBookData(data) {
    return isValidOrderBookData(data) ? data : null;
}
export function validateAndCastSignalData(data) {
    return isValidSignalData(data) ? data : null;
}
export function validateAndCastAnomalyData(data) {
    return isValidAnomalyData(data) ? data : null;
}
export function validateAndCastRSIData(data) {
    return isValidRSIData(data) ? data : null;
}
export function validateAndCastZoneUpdateData(data) {
    return isValidZoneUpdateData(data) ? data : null;
}
export function validateAndCastZoneSignalData(data) {
    return isValidZoneSignalData(data) ? data : null;
}
export function validateAndCastSupportResistanceData(data) {
    return isValidSupportResistanceData(data) ? data : null;
}
