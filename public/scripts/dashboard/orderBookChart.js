import { Chart, registerables } from "chart.js";
import "chartjs-adapter-date-fns";
import annotationPlugin from "chartjs-plugin-annotation";
import { PRICE_DEVIATION_THRESHOLD } from "./state.js";
import { getCurrentTheme, getSystemTheme, getDepletionVisualizationEnabled, } from "./theme.js";
Chart.register(...registerables, annotationPlugin);
const COLOR_RED_FULL = 255;
const COLOR_RED_MEDIUM = 80;
const COLOR_RED_LOW = 0;
const COLOR_GREEN_FULL = 255;
const COLOR_GREEN_MEDIUM = 128;
const ORDER_BOOK_VOLUME_NORMALIZER_DARK = 1500;
const ORDER_BOOK_VOLUME_NORMALIZER_LIGHT = 2000;
const VOLUME_NORMALIZER_DARK = 1500;
const VOLUME_NORMALIZER_LIGHT = 2000;
const VOLUME_OPACITY_MIN = 0.3;
const VOLUME_OPACITY_LOW = 0.4;
const VOLUME_OPACITY_MEDIUM = 0.6;
const VOLUME_OPACITY_HIGH = 0.8;
const VOLUME_OPACITY_MAX = 0.9;
const DEPLETION_RATIO_LOW = 0.3;
const DEPLETION_RATIO_MEDIUM = 0.7;
const COLOR_ALPHA_FULL = 1;
const COLOR_ALPHA_MEDIUM = 0.5;
const COLOR_ALPHA_STRONG = 0.8;
const COLOR_ALPHA_MAX = 0.9;
export class OrderBookChart {
    orderBookChart;
    _orderBookData = {
        priceLevels: [],
        bestBid: 0,
        bestAsk: 0,
        spread: 0,
        midPrice: 0,
        totalBidVolume: 0,
        totalAskVolume: 0,
        imbalance: 0,
        timestamp: 0,
    };
    constructor(ctx) {
        const labels = [];
        const askData = [];
        const bidData = [];
        const askColors = [];
        const bidColors = [];
        this.orderBookChart = new Chart(ctx, {
            type: "bar",
            data: {
                labels: labels,
                datasets: [
                    {
                        label: "Asks",
                        data: askData,
                        backgroundColor: askColors,
                        borderColor: "rgba(255, 0, 0, 0.5)",
                        borderWidth: 1,
                        barPercentage: 0.9,
                        categoryPercentage: 1.0,
                    },
                    {
                        label: "Bids",
                        data: bidData,
                        backgroundColor: bidColors,
                        borderColor: "rgba(0, 128, 0, 0.5)",
                        borderWidth: 1,
                        barPercentage: 0.9,
                        categoryPercentage: 1.0,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                indexAxis: "y",
                scales: {
                    x: {
                        title: { display: true, text: "Volume (LTC)" },
                        ticks: {
                            callback: (value) => Math.abs(value),
                        },
                    },
                    y: {
                        title: { display: true, text: "Price (USDT)" },
                        offset: true,
                        reverse: true,
                        ticks: {
                            callback: function (_value, index) {
                                const label = this.getLabelForValue(index);
                                if (label && label.includes("_ask")) {
                                    return label.split("_")[0];
                                }
                                return "";
                            },
                        },
                    },
                },
                datasets: {
                    bar: {
                        barPercentage: 1.0,
                        categoryPercentage: 0.5,
                    },
                },
                plugins: {
                    legend: {
                        display: true,
                        position: "top",
                        labels: {
                            usePointStyle: true,
                            boxWidth: 10,
                            boxHeight: 10,
                            padding: 10,
                            font: { size: 12 },
                        },
                    },
                },
            },
        });
    }
    set orderBookData(newValue) {
        this._orderBookData = newValue;
        if (!window.orderbookInitialized) {
            console.log("📊 Orderbook initialized:", {
                levels: this.orderBookData.priceLevels.length,
                midPrice: this.orderBookData.midPrice,
            });
            window.orderbookInitialized = true;
        }
    }
    get orderBookData() {
        return this._orderBookData;
    }
    updateOrderBookDisplay() {
        const labels = [];
        const askData = [];
        const bidData = [];
        const priceLevels = this.orderBookData.priceLevels || [];
        const currentTime = Date.now();
        const midPrice = this.orderBookData.midPrice || 0;
        const validLevels = [];
        const invalidLevels = [];
        priceLevels.forEach((level) => {
            if (this.validateDepletionLevel(level, midPrice, currentTime)) {
                validLevels.push(level);
            }
            else {
                invalidLevels.push(level);
            }
        });
        if (invalidLevels.length > 0) {
            console.log(`📊 Depletion validation: ${validLevels.length} valid, ${invalidLevels.length} invalid levels filtered`);
        }
        const maxLevels = 50;
        const sortedLevels = validLevels.sort((a, b) => a.price - b.price);
        let midIndex = 0;
        let minDiff = Infinity;
        for (let i = 0; i < sortedLevels.length; i++) {
            const level = sortedLevels[i];
            if (!level)
                continue;
            const diff = Math.abs(level.price - midPrice);
            if (diff < minDiff) {
                minDiff = diff;
                midIndex = i;
            }
        }
        const halfLevels = Math.floor(maxLevels / 2);
        const startIndex = Math.max(0, midIndex - halfLevels);
        const endIndex = Math.min(sortedLevels.length, startIndex + maxLevels);
        const displayLevels = sortedLevels.slice(startIndex, endIndex);
        const currentTheme = getCurrentTheme();
        const actualTheme = currentTheme === "system" ? getSystemTheme() : currentTheme;
        const askColors = [];
        const bidColors = [];
        const depletionLabels = [];
        displayLevels.forEach((level) => {
            const priceStr = level.price.toFixed(2);
            const depletionRatio = level.depletionRatio || 0;
            const depletionVelocity = level.depletionVelocity || 0;
            const askColor = this.getDepletionColor(level.ask || 0, depletionRatio, "ask", actualTheme);
            const bidColor = this.getDepletionColor(level.bid || 0, depletionRatio, "bid", actualTheme);
            labels.push(`${priceStr}_ask`);
            askData.push(level.ask || 0);
            bidData.push(null);
            askColors.push(askColor);
            bidColors.push("rgba(0, 0, 0, 0)");
            const depletionInfo = depletionRatio > 0
                ? ` (${(depletionRatio * 100).toFixed(1)}% depleted, ${depletionVelocity.toFixed(1)} LTC/sec)`
                : "";
            depletionLabels.push(`${priceStr}_ask${depletionInfo}`);
            labels.push(`${priceStr}_bid`);
            askData.push(null);
            bidData.push(level.bid || 0);
            askColors.push("rgba(0, 0, 0, 0)");
            bidColors.push(bidColor);
            depletionLabels.push(`${priceStr}_bid${depletionInfo}`);
        });
        if (this.orderBookChart.data &&
            this.orderBookChart.data.datasets.length >= 2) {
            const chart = this.orderBookChart;
            chart.data.labels =
                depletionLabels;
            chart.data.datasets[0].data = askData;
            chart.data.datasets[1].data = bidData;
            chart.data.datasets[0].backgroundColor =
                askColors;
            chart.data.datasets[1].backgroundColor =
                bidColors;
        }
        this.updateOrderBookBorderColors(actualTheme);
        this.orderBookChart.update("default");
    }
    validateDepletionLevel(level, midPrice, currentTime) {
        if (!level || typeof level.price !== "number") {
            console.warn("⚠️ Depletion validation: Invalid level data", level);
            return false;
        }
        const priceDeviation = Math.abs(level.price - midPrice) / midPrice;
        if (priceDeviation > PRICE_DEVIATION_THRESHOLD) {
            console.warn(`⚠️ Depletion validation: Price ${level.price.toFixed(4)} too far from mid price ${midPrice.toFixed(4)} (${(priceDeviation * 100).toFixed(2)}% deviation)`);
            return false;
        }
        const depletionRatio = level.depletionRatio;
        if (depletionRatio !== undefined && depletionRatio !== null) {
            if (depletionRatio < 0 || depletionRatio > 1) {
                console.warn(`⚠️ Depletion validation: Invalid depletion ratio ${depletionRatio} for price ${level.price.toFixed(4)}`);
                return false;
            }
        }
        const hasOriginalBidVolume = Boolean(level.originalBidVolume && level.originalBidVolume > 0);
        const hasOriginalAskVolume = Boolean(level.originalAskVolume && level.originalAskVolume > 0);
        if (depletionRatio !== undefined &&
            depletionRatio !== null &&
            depletionRatio > 0) {
            if (!hasOriginalBidVolume && !hasOriginalAskVolume) {
                console.warn(`⚠️ Depletion validation: Missing original volume data for depleted level at ${level.price.toFixed(4)}`);
                return false;
            }
        }
        if (level.timestamp && currentTime - level.timestamp > 10 * 60 * 1000) {
            console.warn(`⚠️ Depletion validation: Stale data for price ${level.price.toFixed(4)} (${Math.round((currentTime - level.timestamp) / 60000)} minutes old)`);
            return false;
        }
        return true;
    }
    getDepletionColor(volume, depletionRatio, side, theme) {
        if (volume <= 0)
            return "rgba(0, 0, 0, 0)";
        const depletionEnabled = typeof getDepletionVisualizationEnabled === "function"
            ? getDepletionVisualizationEnabled()
            : true;
        const baseColors = {
            ask: theme === "dark"
                ? [COLOR_RED_FULL, COLOR_RED_MEDIUM, COLOR_RED_MEDIUM]
                : [COLOR_RED_FULL, COLOR_RED_LOW, COLOR_RED_LOW],
            bid: theme === "dark"
                ? [COLOR_RED_MEDIUM, COLOR_GREEN_FULL, COLOR_RED_MEDIUM]
                : [COLOR_RED_LOW, COLOR_GREEN_MEDIUM, COLOR_RED_LOW],
        };
        const [r, g, b] = baseColors[side] || [
            0, 0, 0,
        ];
        let baseOpacity = theme === "dark"
            ? Math.min(volume / VOLUME_NORMALIZER_DARK, VOLUME_OPACITY_MAX)
            : Math.min(volume / VOLUME_NORMALIZER_LIGHT, COLOR_ALPHA_FULL);
        if (depletionEnabled && depletionRatio > 0) {
            if (depletionRatio < DEPLETION_RATIO_LOW) {
                baseOpacity = Math.max(baseOpacity, VOLUME_OPACITY_LOW);
            }
            else if (depletionRatio < DEPLETION_RATIO_MEDIUM) {
                baseOpacity = Math.max(baseOpacity, VOLUME_OPACITY_MEDIUM);
            }
            else {
                baseOpacity = Math.max(baseOpacity, VOLUME_OPACITY_HIGH);
            }
        }
        return `rgba(${r}, ${g}, ${b}, ${Math.max(baseOpacity, VOLUME_OPACITY_MIN)})`;
    }
    updateOrderBookBorderColors(theme) {
        const datasets = this.orderBookChart.data.datasets;
        if (!datasets || datasets.length < 2)
            return;
        const borderOpacity = theme === "dark" ? COLOR_ALPHA_STRONG : COLOR_ALPHA_MEDIUM;
        if (datasets[0]) {
            datasets[0].borderColor =
                theme === "dark"
                    ? `rgba(255, 120, 120, ${borderOpacity})`
                    : `rgba(255, 0, 0, ${borderOpacity})`;
        }
        if (datasets[1]) {
            datasets[1].borderColor =
                theme === "dark"
                    ? `rgba(120, 255, 120, ${borderOpacity})`
                    : `rgba(0, 128, 0, ${borderOpacity})`;
        }
    }
    updateOrderBookBarColors(theme) {
        const datasets = this.orderBookChart.data.datasets;
        if (!datasets || datasets.length < 2)
            return;
        const askColors = [];
        const bidColors = [];
        this.orderBookData.priceLevels.forEach((level) => {
            const askOpacity = theme === "dark"
                ? Math.min((level.ask ?? 0) / ORDER_BOOK_VOLUME_NORMALIZER_DARK, COLOR_ALPHA_MAX)
                : Math.min((level.ask ?? 0) / ORDER_BOOK_VOLUME_NORMALIZER_LIGHT, COLOR_ALPHA_FULL);
            const askColor = level.ask
                ? theme === "dark"
                    ? `rgba(${COLOR_RED_FULL}, ${COLOR_RED_MEDIUM}, ${COLOR_RED_MEDIUM}, ${Math.max(askOpacity, VOLUME_OPACITY_MIN)})`
                    : `rgba(${COLOR_RED_FULL}, ${COLOR_RED_LOW}, ${COLOR_RED_LOW}, ${askOpacity})`
                : "rgba(0, 0, 0, 0)";
            const bidOpacity = theme === "dark"
                ? Math.min((level.bid ?? 0) / ORDER_BOOK_VOLUME_NORMALIZER_DARK, COLOR_ALPHA_MAX)
                : Math.min((level.bid ?? 0) / ORDER_BOOK_VOLUME_NORMALIZER_LIGHT, COLOR_ALPHA_FULL);
            const bidColor = level.bid
                ? theme === "dark"
                    ? `rgba(${COLOR_RED_MEDIUM}, ${COLOR_GREEN_FULL}, ${COLOR_RED_MEDIUM}, ${Math.max(bidOpacity, VOLUME_OPACITY_MIN)})`
                    : `rgba(${COLOR_RED_LOW}, ${COLOR_GREEN_MEDIUM}, ${COLOR_RED_LOW}, ${bidOpacity})`
                : "rgba(0, 0, 0, 0)";
            askColors.push(askColor);
            bidColors.push("rgba(0, 0, 0, 0)");
            askColors.push("rgba(0, 0, 0, 0)");
            bidColors.push(bidColor);
        });
        if (datasets[0]) {
            datasets[0].backgroundColor = askColors;
        }
        if (datasets[1]) {
            datasets[1].backgroundColor = bidColors;
        }
        this.updateOrderBookBorderColors(theme);
    }
}
