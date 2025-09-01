import { tradesChart, orderBookChart, rsiChart, trades, rsiData, setActiveRange, PADDING_TIME, } from "./state.js";
export function setRange(duration) {
    setActiveRange(duration);
    const now = Date.now();
    if (duration !== null) {
        const minTime = now - duration;
        const maxTime = now + PADDING_TIME;
        console.log(`Setting IDENTICAL time range for both charts: ${new Date(minTime).toLocaleTimeString()} - ${new Date(maxTime).toLocaleTimeString()}`);
        if (tradesChart) {
            tradesChart.options.scales.x.min = minTime;
            tradesChart.options.scales.x.max = maxTime;
            tradesChart.update();
        }
        if (rsiChart) {
            rsiChart.options.scales.x.min = minTime;
            rsiChart.options.scales.x.max = maxTime;
            rsiChart.update();
        }
    }
    else {
        let minTime = Infinity;
        let maxTime = -Infinity;
        if (rsiData && rsiData.length > 0) {
            rsiData.forEach((rsiPoint) => {
                if (rsiPoint.time < minTime)
                    minTime = rsiPoint.time;
                if (rsiPoint.time > maxTime)
                    maxTime = rsiPoint.time;
            });
        }
        if (trades && trades.length > 0) {
            trades.forEach((trade) => {
                if (trade.time < minTime)
                    minTime = trade.time;
                if (trade.time > maxTime)
                    maxTime = trade.time;
            });
        }
        if (minTime !== Infinity && maxTime !== -Infinity) {
            const timeRange = maxTime - minTime;
            const padding = Math.max(PADDING_TIME, timeRange * 0.05);
            if (tradesChart) {
                if (tradesChart.options.scales.x) {
                    tradesChart.options.scales.x.min = minTime - padding;
                    tradesChart.options.scales.x.max = maxTime + padding;
                }
                tradesChart.update();
            }
            if (rsiChart) {
                if (rsiChart.options.scales.x) {
                    rsiChart.options.scales.x.min = minTime - padding;
                    rsiChart.options.scales.x.max = maxTime + padding;
                }
                rsiChart.update();
            }
        }
        else {
            if (tradesChart && tradesChart.options.scales.x) {
                delete tradesChart.options.scales.x.min;
                delete tradesChart.options.scales.x.max;
                tradesChart.update();
            }
            if (rsiChart && rsiChart.options.scales.x) {
                delete rsiChart.options.scales.x.min;
                delete rsiChart.options.scales.x.max;
                rsiChart.update();
            }
        }
    }
}
export function setupColumnResizing() {
    if (typeof window.interact === "undefined") {
        console.error("Interact.js not loaded");
        return;
    }
    window.interact(".resize-handle").draggable({
        axis: "x",
        listeners: {
            move(event) {
                const handle = event.target;
                const handleId = handle.id;
                const dashboard = document.querySelector(".dashboard");
                if (!dashboard)
                    return;
                const dashboardRect = dashboard.getBoundingClientRect();
                if (handleId === "resize1") {
                    const column1 = document.getElementById("column1");
                    if (!column1)
                        return;
                    const column1Rect = column1.getBoundingClientRect();
                    const newWidth = Math.min(Math.max(column1Rect.width + event.dx, 200), dashboardRect.width * 0.5);
                    const newPercent = (newWidth / dashboardRect.width) * 100;
                    column1.style.flex = `0 0 ${newPercent}%`;
                }
                else if (handleId === "resize2") {
                    const column3 = document.getElementById("column3");
                    if (!column3)
                        return;
                    const column3Rect = column3.getBoundingClientRect();
                    const newWidth = Math.min(Math.max(column3Rect.width - event.dx, 150), dashboardRect.width * 0.3);
                    const newPercent = (newWidth / dashboardRect.width) * 100;
                    column3.style.flex = `0 0 ${newPercent}%`;
                }
                clearTimeout(window.resizeTimeout);
                window.resizeTimeout = setTimeout(() => {
                    triggerChartResize();
                }, 100);
            },
            end(event) {
                void event;
            },
        },
    });
}
export function triggerChartResize() {
    if (tradesChart)
        tradesChart.resize();
    if (orderBookChart)
        orderBookChart.resize();
    if (rsiChart)
        rsiChart.resize();
}
