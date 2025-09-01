import { tradesChart, orderBookChart, rsiChart, trades, PADDING_TIME, FIFTEEN_MINUTES, } from "./state.js";
let chartUpdateScheduled = false;
export function scheduleTradesChartUpdate() {
    if (!chartUpdateScheduled) {
        chartUpdateScheduled = true;
        requestAnimationFrame(() => {
            if (tradesChart) {
                tradesChart.update("none");
            }
            chartUpdateScheduled = false;
        });
    }
}
export function scheduleOrderBookUpdate() {
    if (!orderBookChart)
        return;
    orderBookChart.update();
}
export function updateYAxisBounds() {
    if (!tradesChart || trades.length === 0)
        return;
    const xMin = tradesChart.options.scales.x.min;
    const xMax = tradesChart.options.scales.x.max;
    if (xMin === undefined || xMax === undefined)
        return;
    let yMin = Infinity;
    let yMax = -Infinity;
    let visibleCount = 0;
    for (let i = trades.length - 1; i >= 0; i--) {
        const trade = trades[i];
        if (trade && trade.time >= xMin && trade.time <= xMax) {
            const price = trade.price;
            if (price < yMin)
                yMin = price;
            if (price > yMax)
                yMax = price;
            visibleCount++;
            if (visibleCount >= 1000)
                break;
        }
    }
    if (visibleCount === 0)
        return;
    const padding = (yMax - yMin) * 0.05;
    tradesChart.options.scales.y.suggestedMin = yMin - padding;
    tradesChart.options.scales.y.suggestedMax = yMax + padding;
    delete tradesChart.options.scales.y.min;
    delete tradesChart.options.scales.y.max;
}
export function updateTimeAnnotations(latestTime, activeRange) {
    if (!tradesChart)
        return;
    const annotations = tradesChart.options.plugins?.annotation?.annotations || {};
    const min = latestTime - activeRange;
    const max = latestTime + PADDING_TIME;
    Object.keys(annotations).forEach((key) => {
        const keyNum = parseFloat(key);
        if (!isNaN(keyNum) && (keyNum < min || keyNum > max)) {
            delete annotations[key];
        }
    });
    let time = Math.ceil(min / FIFTEEN_MINUTES) * FIFTEEN_MINUTES;
    while (time <= max) {
        if (!annotations[time.toString()]) {
            annotations[time.toString()] = {
                type: "line",
                xMin: time,
                xMax: time,
                borderColor: "rgba(102, 102, 102, 0.4)",
                borderWidth: 2,
            };
        }
        time += FIFTEEN_MINUTES;
    }
}
export function updateRSITimeAnnotations(latestTime, activeRange) {
    if (!rsiChart)
        return;
    const annotations = rsiChart.options.plugins?.annotation?.annotations || {};
    const newAnnotations = {};
    if (annotations["overboughtLine"]) {
        newAnnotations["overboughtLine"] = { ...annotations["overboughtLine"] };
    }
    if (annotations["oversoldLine"]) {
        newAnnotations["oversoldLine"] = { ...annotations["oversoldLine"] };
    }
    const min = latestTime - activeRange;
    const max = latestTime + PADDING_TIME;
    let time = Math.ceil(min / FIFTEEN_MINUTES) * FIFTEEN_MINUTES;
    while (time <= max) {
        newAnnotations[time.toString()] = {
            type: "line",
            xMin: time,
            xMax: time,
            borderColor: "rgba(102, 102, 102, 0.4)",
            borderWidth: 2,
        };
        time += FIFTEEN_MINUTES;
    }
    if (rsiChart.options.plugins?.annotation) {
        rsiChart.options.plugins.annotation.annotations = newAnnotations;
    }
}
export function createTrade(x, y, quantity, orderType) {
    return { x, y, quantity, orderType };
}
