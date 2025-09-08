function isObject(value) {
    return value !== null && typeof value === "object";
}
function isString(value) {
    return typeof value === "string";
}
function isNumber(value) {
    return typeof value === "number" && !isNaN(value);
}
function isBoolean(value) {
    return typeof value === "boolean";
}
export function isValidTradeData(data) {
    if (!isObject(data))
        return false;
    const trade = data;
    return (isNumber(trade["id"]) &&
        isString(trade["p"]) &&
        isString(trade["q"]) &&
        isNumber(trade["t"]) &&
        isBoolean(trade["m"]));
}
export function isValidTradeMessage(msg) {
    if (!isObject(msg))
        return false;
    const message = msg;
    return message["type"] === "trade" && isValidTradeData(message["data"]);
}
export function isValidSignalData(data) {
    if (!isObject(data))
        return false;
    const signal = data;
    return (isString(signal["id"]) &&
        isString(signal["type"]) &&
        isNumber(signal["strength"]) &&
        isNumber(signal["price"]) &&
        isNumber(signal["timestamp"]) &&
        (signal["aggressor"] === "buy" || signal["aggressor"] === "sell") &&
        isString(signal["detector"]));
}
export function isValidSignalMessage(msg) {
    if (!isObject(msg))
        return false;
    const message = msg;
    return message["type"] === "signal" && isValidSignalData(message["data"]);
}
export function isValidAnomalyData(data) {
    if (!isObject(data))
        return false;
    const anomaly = data;
    return (isString(anomaly["detector"]) &&
        isString(anomaly["message"]) &&
        isNumber(anomaly["timestamp"]));
}
export function isValidAnomalyMessage(msg) {
    if (!isObject(msg))
        return false;
    const message = msg;
    return message["type"] === "anomaly" && isValidAnomalyData(message["data"]);
}
export function isValidPriceLevel(level) {
    if (!isObject(level))
        return false;
    const priceLevel = level;
    return (isNumber(priceLevel["price"]) &&
        isNumber(priceLevel["bid"]) &&
        isNumber(priceLevel["ask"]));
}
export function isValidOrderBookData(data) {
    if (!isObject(data))
        return false;
    const orderBook = data;
    if (!Array.isArray(orderBook["priceLevels"]) ||
        !isNumber(orderBook["bestBid"]) ||
        !isNumber(orderBook["bestAsk"]) ||
        !isNumber(orderBook["spread"]) ||
        !isNumber(orderBook["midPrice"]) ||
        !isNumber(orderBook["totalBidVolume"]) ||
        !isNumber(orderBook["totalAskVolume"]) ||
        !isNumber(orderBook["imbalance"]) ||
        !isNumber(orderBook["timestamp"])) {
        return false;
    }
    return orderBook["priceLevels"].every(isValidPriceLevel);
}
export function isValidOrderbookMessage(msg) {
    if (!isObject(msg))
        return false;
    const message = msg;
    return (message["type"] === "orderbook" && isValidOrderBookData(message["data"]));
}
export function isValidRSIData(data) {
    if (!isObject(data))
        return false;
    const rsi = data;
    return (isNumber(rsi["time"]) &&
        isNumber(rsi["rsi"]) &&
        rsi["rsi"] >= 0 &&
        rsi["rsi"] <= 100);
}
export function isValidRsiMessage(msg) {
    if (!isObject(msg))
        return false;
    const message = msg;
    return message["type"] === "rsi" && isValidRSIData(message["data"]);
}
export function isValidRsiBacklogData(data) {
    return Array.isArray(data) && data.every(isValidRSIData);
}
export function isValidRsiBacklogMessage(msg) {
    if (!isObject(msg))
        return false;
    const message = msg;
    return (message["type"] === "rsi_backlog" &&
        isValidRsiBacklogData(message["data"]));
}
export function isValidSignalBacklogData(data) {
    return Array.isArray(data) && data.every(isValidSignalData);
}
export function isValidSignalBacklogMessage(msg) {
    if (!isObject(msg))
        return false;
    const message = msg;
    return (message["type"] === "signal_backlog" &&
        isValidSignalBacklogData(message["data"]));
}
export function isValidSignalBundleMessage(msg) {
    if (!isObject(msg))
        return false;
    const message = msg;
    return (message["type"] === "signal_bundle" &&
        isValidSignalBacklogData(message["data"]));
}
export function isValidRuntimeConfigMessage(msg) {
    if (!isObject(msg))
        return false;
    const message = msg;
    return message["type"] === "runtimeConfig";
}
export function isValidSupportResistanceLevelMessage(msg) {
    if (!isObject(msg))
        return false;
    const message = msg;
    return message["type"] === "supportResistanceLevel";
}
export function isValidZoneUpdateMessage(msg) {
    if (!isObject(msg))
        return false;
    const message = msg;
    return message["type"] === "zoneUpdate";
}
export function isValidZoneSignalMessage(msg) {
    if (!isObject(msg))
        return false;
    const message = msg;
    return message["type"] === "zoneSignal";
}
export function transformSignalData(wsData) {
    return {
        id: wsData["id"],
        type: wsData["type"],
        price: wsData["price"],
        time: wsData["time"],
        confidence: wsData["confidence"] ?? 0 / 100,
        signalData: {
            confidence: wsData["confidence"] ?? 0 / 100,
            meta: {
                detector: wsData["detector"],
            },
        },
    };
}
export function isValidWebSocketMessage(msg) {
    if (!isObject(msg))
        return false;
    const message = msg;
    if (!isString(message["type"]))
        return false;
    switch (message["type"]) {
        case "trade":
            return isValidTradeMessage(msg);
        case "signal":
            return isValidSignalMessage(msg);
        case "anomaly":
            return isValidAnomalyMessage(msg);
        case "orderbook":
            return isValidOrderbookMessage(msg);
        case "rsi":
            return isValidRsiMessage(msg);
        case "rsi_backlog":
            return isValidRsiBacklogMessage(msg);
        case "signal_backlog":
            return isValidSignalBacklogMessage(msg);
        case "signal_bundle":
            return isValidSignalBundleMessage(msg);
        case "runtimeConfig":
            return isValidRuntimeConfigMessage(msg);
        case "supportResistanceLevel":
            return isValidSupportResistanceLevelMessage(msg);
        case "zoneUpdate":
            return isValidZoneUpdateMessage(msg);
        case "zoneSignal":
            return isValidZoneSignalMessage(msg);
        default:
            return false;
    }
}
export function isValidChartDataPoint(point) {
    if (!isObject(point))
        return false;
    const p = point;
    return (isNumber(p["x"]) &&
        isNumber(p["y"]) &&
        (p["quantity"] === undefined || isNumber(p["quantity"])) &&
        (p["orderType"] === undefined ||
            p["orderType"] === "buy" ||
            p["orderType"] === "sell"));
}
export function isValidChartDataArray(data) {
    return Array.isArray(data) && data.every(isValidChartDataPoint);
}
