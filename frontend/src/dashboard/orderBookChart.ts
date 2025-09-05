import { Chart, registerables } from "chart.js";
import "chartjs-adapter-date-fns";
import annotationPlugin from "chartjs-plugin-annotation";

import { PRICE_DEVIATION_THRESHOLD } from "./state.js";

import {
    getCurrentTheme,
    getSystemTheme,
    getDepletionVisualizationEnabled,
} from "./theme.js";
import type {
    OrderBookData,
    OrderBookLevel,
    ChartDataset,
} from "../frontend-types.js";

Chart.register(...registerables, annotationPlugin);

// RGB color constants
const COLOR_RED_FULL = 255;
const COLOR_RED_MEDIUM = 80;
const COLOR_RED_LOW = 0;
const COLOR_GREEN_FULL = 255;
const COLOR_GREEN_MEDIUM = 128;

// Order book volume normalizers
const ORDER_BOOK_VOLUME_NORMALIZER_DARK = 1500;
const ORDER_BOOK_VOLUME_NORMALIZER_LIGHT = 2000;

// Volume calculation constants
const VOLUME_NORMALIZER_DARK = 1500;
const VOLUME_NORMALIZER_LIGHT = 2000;
const VOLUME_OPACITY_MIN = 0.3;
const VOLUME_OPACITY_LOW = 0.4;
const VOLUME_OPACITY_MEDIUM = 0.6;
const VOLUME_OPACITY_HIGH = 0.8;
const VOLUME_OPACITY_MAX = 0.9;

// Depletion ratio thresholds
const DEPLETION_RATIO_LOW = 0.3;
const DEPLETION_RATIO_MEDIUM = 0.7;

// Color alpha constants
const COLOR_ALPHA_FULL = 1;
const COLOR_ALPHA_MEDIUM = 0.5;
const COLOR_ALPHA_STRONG = 0.8;
const COLOR_ALPHA_MAX = 0.9;

export class OrderBookChart {
    private readonly orderBookChart: Chart<"bar">;
    private _orderBookData: OrderBookData = {
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

    /**
     * Initializes the order book bar chart.
     */
    constructor(ctx: CanvasRenderingContext2D) {
        // Create labels for both bid and ask positions for each price level
        const labels: string[] = [];
        const askData: (number | null)[] = [];
        const bidData: (number | null)[] = [];
        const askColors: string[] = [];
        const bidColors: string[] = [];

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
                            callback: (value: unknown) =>
                                Math.abs(value as number),
                        },
                    },
                    y: {
                        title: { display: true, text: "Price (USDT)" },
                        offset: true,
                        reverse: true,
                        ticks: {
                            callback: function (
                                this: {
                                    getLabelForValue: (index: number) => string;
                                },
                                _value: unknown,
                                index: number
                            ) {
                                const label: string = this.getLabelForValue(
                                    index
                                ) as string;
                                if (label && label.includes("_ask")) {
                                    return label.split("_")[0]; // Only show price for ask positions
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

    public set orderBookData(newValue: OrderBookData) {
        this._orderBookData = newValue;
        if (!window.orderbookInitialized) {
            console.log("📊 Orderbook initialized:", {
                levels: this.orderBookData.priceLevels.length,
                midPrice: this.orderBookData.midPrice,
            });
            window.orderbookInitialized = true;
        }
    }

    public get orderBookData(): OrderBookData {
        return this._orderBookData;
    }

    public updateOrderBookDisplay(): void {
        const labels: string[] = [];
        const askData: (number | null)[] = [];
        const bidData: (number | null)[] = [];

        // Backend sends data already configured with proper binSize (1-tick)
        // Just display it directly without any local processing
        const priceLevels: OrderBookLevel[] =
            this.orderBookData.priceLevels || [];
        const currentTime: number = Date.now();
        const midPrice: number = this.orderBookData.midPrice || 0;

        // Validate and filter depletion data
        const validLevels: OrderBookLevel[] = [];
        const invalidLevels: OrderBookLevel[] = [];

        priceLevels.forEach((level: OrderBookLevel) => {
            if (this.validateDepletionLevel(level, midPrice, currentTime)) {
                validLevels.push(level);
            } else {
                invalidLevels.push(level);
            }
        });

        // Log validation summary
        if (invalidLevels.length > 0) {
            console.log(
                `📊 Depletion validation: ${validLevels.length} valid, ${invalidLevels.length} invalid levels filtered`
            );
        }

        // Select levels symmetrically around mid price for balanced display
        const maxLevels: number = 50; // Show more levels since we have 1-tick precision

        // Sort levels by price
        const sortedLevels: OrderBookLevel[] = validLevels.sort(
            (a: OrderBookLevel, b: OrderBookLevel) => a.price - b.price
        );

        // Find the index closest to midPrice
        let midIndex: number = 0;
        let minDiff: number = Infinity;
        for (let i = 0; i < sortedLevels.length; i++) {
            const level = sortedLevels[i];
            if (!level) continue;
            const diff: number = Math.abs(level.price - midPrice);
            if (diff < minDiff) {
                minDiff = diff;
                midIndex = i;
            }
        }

        // Select levels around midpoint
        const halfLevels: number = Math.floor(maxLevels / 2);
        const startIndex: number = Math.max(0, midIndex - halfLevels);
        const endIndex: number = Math.min(
            sortedLevels.length,
            startIndex + maxLevels
        );
        const displayLevels: OrderBookLevel[] = sortedLevels.slice(
            startIndex,
            endIndex
        );

        // Get current theme for depletion colors
        const currentTheme: string = getCurrentTheme();
        const actualTheme: string =
            currentTheme === "system" ? getSystemTheme() : currentTheme;

        // Build chart data with depletion information
        const askColors: string[] = [];
        const bidColors: string[] = [];
        const depletionLabels: string[] = [];

        displayLevels.forEach((level: OrderBookLevel) => {
            const priceStr: string = level.price.toFixed(2);
            const depletionRatio: number = level.depletionRatio || 0;
            const depletionVelocity: number = level.depletionVelocity || 0;

            // Create depletion-aware colors for ask bars
            const askColor: string = this.getDepletionColor(
                level.ask || 0,
                depletionRatio,
                "ask",
                actualTheme
            );
            const bidColor: string = this.getDepletionColor(
                level.bid || 0,
                depletionRatio,
                "bid",
                actualTheme
            );

            // Add ask position
            labels.push(`${priceStr}_ask`);
            askData.push(level.ask || 0);
            bidData.push(null);
            askColors.push(askColor);
            bidColors.push("rgba(0, 0, 0, 0)"); // Transparent for ask position

            // Add depletion info to tooltip
            const depletionInfo: string =
                depletionRatio > 0
                    ? ` (${(depletionRatio * 100).toFixed(1)}% depleted, ${depletionVelocity.toFixed(1)} LTC/sec)`
                    : "";
            depletionLabels.push(`${priceStr}_ask${depletionInfo}`);

            // Add bid position
            labels.push(`${priceStr}_bid`);
            askData.push(null);
            bidData.push(level.bid || 0);
            askColors.push("rgba(0, 0, 0, 0)"); // Transparent for bid position
            bidColors.push(bidColor);

            // Add depletion info to tooltip
            depletionLabels.push(`${priceStr}_bid${depletionInfo}`);
        });

        if (
            this.orderBookChart.data &&
            this.orderBookChart.data.datasets.length >= 2
        ) {
            const chart = this.orderBookChart;
            (chart.data as unknown as { labels: string[] }).labels =
                depletionLabels; // Use labels with depletion info
            (chart.data.datasets[0] as ChartDataset).data = askData;
            (chart.data.datasets[1] as ChartDataset).data = bidData;

            // Apply depletion-aware colors
            (chart.data.datasets[0] as ChartDataset).backgroundColor =
                askColors;
            (chart.data.datasets[1] as ChartDataset).backgroundColor =
                bidColors;
        }

        // Update border colors for better visibility
        this.updateOrderBookBorderColors(actualTheme);

        this.orderBookChart.update("default");
    }

    /**
     * Validate depletion level data for current market conditions
     */
    private validateDepletionLevel(
        level: OrderBookLevel,
        midPrice: number,
        currentTime: number
    ): boolean {
        // Check if level has basic required properties
        if (!level || typeof level.price !== "number") {
            console.warn("⚠️ Depletion validation: Invalid level data", level);
            return false;
        }

        // Check price proximity to current market (within 2% of mid price)
        const priceDeviation: number =
            Math.abs(level.price - midPrice) / midPrice;
        if (priceDeviation > PRICE_DEVIATION_THRESHOLD) {
            console.warn(
                `⚠️ Depletion validation: Price ${level.price.toFixed(4)} too far from mid price ${midPrice.toFixed(4)} (${(priceDeviation * 100).toFixed(2)}% deviation)`
            );
            return false;
        }

        // Check if depletion data exists and is reasonable
        const depletionRatio = level.depletionRatio;
        if (depletionRatio !== undefined && depletionRatio !== null) {
            if (depletionRatio < 0 || depletionRatio > 1) {
                console.warn(
                    `⚠️ Depletion validation: Invalid depletion ratio ${depletionRatio} for price ${level.price.toFixed(4)}`
                );
                return false;
            }
        }

        // Check volume data consistency
        // Note: hasBidVolume and hasAskVolume are not used but kept for potential future validation
        const hasOriginalBidVolume: boolean = Boolean(
            level.originalBidVolume && level.originalBidVolume > 0
        );
        const hasOriginalAskVolume: boolean = Boolean(
            level.originalAskVolume && level.originalAskVolume > 0
        );

        // If we have depletion data, we should have both current and original volumes
        if (
            depletionRatio !== undefined &&
            depletionRatio !== null &&
            depletionRatio > 0
        ) {
            if (!hasOriginalBidVolume && !hasOriginalAskVolume) {
                console.warn(
                    `⚠️ Depletion validation: Missing original volume data for depleted level at ${level.price.toFixed(4)}`
                );
                return false;
            }
        }

        // Check for data freshness (if timestamp available)
        if (level.timestamp && currentTime - level.timestamp > 10 * 60 * 1000) {
            // 10 minutes
            console.warn(
                `⚠️ Depletion validation: Stale data for price ${level.price.toFixed(4)} (${Math.round((currentTime - level.timestamp) / 60000)} minutes old)`
            );
            return false;
        }

        return true;
    }

    /**
     * Get depletion-aware color for orderbook bars
     */
    private getDepletionColor(
        volume: number,
        depletionRatio: number,
        side: "ask" | "bid",
        theme: string
    ): string {
        if (volume <= 0) return "rgba(0, 0, 0, 0)";

        // Check if depletion visualization is enabled
        const depletionEnabled: boolean =
            typeof getDepletionVisualizationEnabled === "function"
                ? getDepletionVisualizationEnabled()
                : true;

        // Base colors for ask/bid
        const baseColors: Record<string, [number, number, number]> = {
            ask:
                theme === "dark"
                    ? [COLOR_RED_FULL, COLOR_RED_MEDIUM, COLOR_RED_MEDIUM]
                    : [COLOR_RED_FULL, COLOR_RED_LOW, COLOR_RED_LOW], // Red
            bid:
                theme === "dark"
                    ? [COLOR_RED_MEDIUM, COLOR_GREEN_FULL, COLOR_RED_MEDIUM]
                    : [COLOR_RED_LOW, COLOR_GREEN_MEDIUM, COLOR_RED_LOW], // Green
        };

        const [r, g, b]: [number, number, number] = baseColors[side] || [
            0, 0, 0,
        ];

        // Calculate opacity based on volume
        let baseOpacity: number =
            theme === "dark"
                ? Math.min(volume / VOLUME_NORMALIZER_DARK, VOLUME_OPACITY_MAX)
                : Math.min(volume / VOLUME_NORMALIZER_LIGHT, COLOR_ALPHA_FULL);

        // Apply depletion effect only if visualization is enabled
        if (depletionEnabled && depletionRatio > 0) {
            if (depletionRatio < DEPLETION_RATIO_LOW) {
                // Low depletion - slight color shift
                baseOpacity = Math.max(baseOpacity, VOLUME_OPACITY_LOW);
            } else if (depletionRatio < DEPLETION_RATIO_MEDIUM) {
                // Medium depletion - moderate intensification
                baseOpacity = Math.max(baseOpacity, VOLUME_OPACITY_MEDIUM);
            } else {
                // High depletion - strong intensification
                baseOpacity = Math.max(baseOpacity, VOLUME_OPACITY_HIGH);
            }
        }

        return `rgba(${r}, ${g}, ${b}, ${Math.max(baseOpacity, VOLUME_OPACITY_MIN)})`;
    }

    /**
     * Update orderbook border colors for better visibility
     */
    private updateOrderBookBorderColors(theme: string): void {
        const datasets = this.orderBookChart.data.datasets as ChartDataset[];
        if (!datasets || datasets.length < 2) return;

        const borderOpacity: number =
            theme === "dark" ? COLOR_ALPHA_STRONG : COLOR_ALPHA_MEDIUM;

        // Enhanced border colors for depletion visualization
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

    public updateOrderBookBarColors(theme: string): void {
        //todo
        const datasets = this.orderBookChart.data.datasets as ChartDataset[];
        if (!datasets || datasets.length < 2) return;

        // Enhanced colors for better visibility in dark mode
        const askColors: string[] = [];
        const bidColors: string[] = [];

        this.orderBookData.priceLevels.forEach((level: OrderBookLevel) => {
            // Ask colors (red) - enhanced opacity for dark mode
            const askOpacity: number =
                theme === "dark"
                    ? Math.min(
                          (level.ask ?? 0) / ORDER_BOOK_VOLUME_NORMALIZER_DARK,
                          COLOR_ALPHA_MAX
                      ) // Higher max opacity in dark mode
                    : Math.min(
                          (level.ask ?? 0) / ORDER_BOOK_VOLUME_NORMALIZER_LIGHT,
                          COLOR_ALPHA_FULL
                      );

            const askColor: string = level.ask
                ? theme === "dark"
                    ? `rgba(${COLOR_RED_FULL}, ${COLOR_RED_MEDIUM}, ${COLOR_RED_MEDIUM}, ${Math.max(askOpacity, VOLUME_OPACITY_MIN)})` // Brighter red with min opacity
                    : `rgba(${COLOR_RED_FULL}, ${COLOR_RED_LOW}, ${COLOR_RED_LOW}, ${askOpacity})`
                : "rgba(0, 0, 0, 0)";

            // Bid colors (green) - enhanced opacity for dark mode
            const bidOpacity: number =
                theme === "dark"
                    ? Math.min(
                          (level.bid ?? 0) / ORDER_BOOK_VOLUME_NORMALIZER_DARK,
                          COLOR_ALPHA_MAX
                      ) // Higher max opacity in dark mode
                    : Math.min(
                          (level.bid ?? 0) / ORDER_BOOK_VOLUME_NORMALIZER_LIGHT,
                          COLOR_ALPHA_FULL
                      );

            const bidColor: string = level.bid
                ? theme === "dark"
                    ? `rgba(${COLOR_RED_MEDIUM}, ${COLOR_GREEN_FULL}, ${COLOR_RED_MEDIUM}, ${Math.max(bidOpacity, VOLUME_OPACITY_MIN)})` // Brighter green with min opacity
                    : `rgba(${COLOR_RED_LOW}, ${COLOR_GREEN_MEDIUM}, ${COLOR_RED_LOW}, ${bidOpacity})`
                : "rgba(0, 0, 0, 0)";

            // Add ask position
            askColors.push(askColor);
            bidColors.push("rgba(0, 0, 0, 0)");

            // Add bid position
            askColors.push("rgba(0, 0, 0, 0)");
            bidColors.push(bidColor);
        });

        // Update the chart datasets
        if (datasets[0]) {
            datasets[0].backgroundColor = askColors; // Asks
        }
        if (datasets[1]) {
            datasets[1].backgroundColor = bidColors; // Bids
        }

        // Update border colors for better definition in dark mode
        this.updateOrderBookBorderColors(theme);
    }
}
