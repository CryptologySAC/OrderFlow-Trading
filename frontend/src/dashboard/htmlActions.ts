import { TradeChart } from "./tradeChart.js";
//import { OrderBookChart } from "./orderBookChart.js";
import { RsiChart } from "./rsiChart.js";
import { NINETHY_MINUTES, PADDING_FACTOR } from "./state.js";

export class HTMLActions {
    private readonly tradeChart: TradeChart;
    private readonly rsiChart: RsiChart;
    private readonly rangeSelector: Element | null;
    private activeRange = NINETHY_MINUTES;

    constructor(
        tradeChart: TradeChart,
        rsiChart: RsiChart,
        activeRange: number,
        rangeSelector: Element | null
    ) {
        this.tradeChart = tradeChart;
        this.rsiChart = rsiChart;
        this.activeRange = activeRange;
        this.rangeSelector = rangeSelector;
    }

    public setRangeSelector() {
        if (!this.rangeSelector) {
            throw new Error("Range selector element not found");
        }
        this.rangeSelector.addEventListener("click", (e: Event) => {
            const target = e.target as HTMLElement;
            if (target.tagName === "BUTTON") {
                const range = target.getAttribute("data-range") as
                    | "5400000"
                    | "2700000"
                    | "900000"
                    | "300000";
                if (!this.isValidRange(range)) {
                    console.error(`Invalid range selected: ${range}`);
                } else {
                    if (this.rangeSelector) {
                        this.rangeSelector
                            .querySelectorAll("button")
                            .forEach((btn: HTMLButtonElement) =>
                                btn.classList.remove("active")
                            );
                    }
                    target.classList.add("active");
                    const newRange = parseInt(range);
                    this.setRange(newRange);
                    this.tradeChart.activeRange = newRange;
                    this.rsiChart.activeRange = newRange;
                    this.updateUnifiedTimeRange(Date.now());
                }
            }
        });
    }

    public updateUnifiedTimeRange(latestTime: number): void {
        const padding = Math.ceil(this.activeRange / PADDING_FACTOR);
        const unifiedMin = latestTime - this.activeRange;
        const unifiedMax = latestTime + padding;

        try {
            this.tradeChart.setScaleX(unifiedMin, unifiedMax, latestTime);
            this.rsiChart.setScaleX(unifiedMin, unifiedMax, latestTime);
        } catch (error) {
            console.error("updateUnifiedTimeRange Error: ", error);
        }
    }

    public restoreTimeRange(): number {
        try {
            const savedRange = localStorage.getItem("dashboardTimeRange");

            if (!savedRange) {
                console.log(
                    "No saved time range found, using default (90 minutes)"
                );
                return NINETHY_MINUTES;
            }

            const rangeSettings = JSON.parse(savedRange);

            if (rangeSettings.activeRange === undefined) {
                console.warn("Invalid saved time range, using default");
                return NINETHY_MINUTES;
            }

            // Update active range and apply to chart
            this.activeRange = rangeSettings.activeRange;

            // Update the UI to show the selected range
            const rangeSelector = document.querySelector(".rangeSelector");
            if (rangeSelector) {
                rangeSelector.querySelectorAll("button").forEach((button) => {
                    const buttonRange = button.getAttribute("data-range");
                    const buttonRangeValue =
                        buttonRange === "all" || !buttonRange
                            ? NINETHY_MINUTES
                            : parseInt(buttonRange);

                    if (buttonRangeValue === this.activeRange) {
                        button.classList.add("active");
                    } else {
                        button.classList.remove("active");
                    }
                });
            }

            console.log("Time range restored:", {
                range:
                    this.activeRange === null
                        ? "all"
                        : `${this.activeRange / 60000} minutes`,
                savedAt: new Date(rangeSettings.timestamp).toLocaleString(),
            });

            return this.activeRange;
        } catch (error) {
            console.warn(
                "Failed to restore time range from localStorage:",
                error
            );
        }

        return NINETHY_MINUTES;
    }

    public restoreTheme() {
        try {
            const savedTheme = this.getCurrentTheme();
            this.applyTheme(savedTheme);
            this.updateThemeToggleButton();

            console.log("Theme restored:", savedTheme);
        } catch (error) {
            console.warn("Failed to restore theme from localStorage:", error);
        }
    }

    public restoreColumnWidths() {
        try {
            const savedWidths = localStorage.getItem("dashboardColumnWidths");
    
            if (!savedWidths) {
                console.log("No saved column widths found, using defaults");
                return;
            }
    
            const columnWidths = JSON.parse(savedWidths);
    
            // Validate saved data
            if (!columnWidths.column1 || !columnWidths.column3) {
                console.warn("Invalid saved column widths, using defaults");
                return;
            }
    
            // Apply saved widths with validation
            const column1 = document.getElementById("column1");
            const column3 = document.getElementById("column3");
    
            if (column1 && column3) {
                // Ensure widths are within valid ranges
                const column1Width = Math.min(
                    Math.max(columnWidths.column1, 15),
                    50
                ); // 15-50%
                const column3Width = Math.min(
                    Math.max(columnWidths.column3, 10),
                    30
                ); // 10-30%
    
                column1.style.flex = `0 0 ${column1Width}%`;
                column3.style.flex = `0 0 ${column3Width}%`;
    
                console.log("Column widths restored:", {
                    column1: column1Width,
                    column3: column3Width,
                    savedAt: new Date(columnWidths.timestamp).toLocaleString(),
                });
            }
        } catch (error) {
            console.warn(
                "Failed to restore column widths from localStorage:",
                error
            );
        }
    }

    private getCurrentTheme(): "light" | "dark" | "system" {
        const saved = localStorage.getItem("dashboardTheme");
        if (saved && (saved === "light" || saved === "dark")) {
            return saved;
        }
        return "system";
    }

    private applyTheme(theme: "light" | "dark" | "system") {
        const body = document.body;

        if (theme === "system") {
            body.removeAttribute("data-theme");
        } else {
            body.setAttribute("data-theme", theme);
        }

        // Update chart colors for dark/light mode
        this.updateChartTheme(
            theme === "system" ? this.getSystemTheme() : theme
        );
    }

    public getSystemTheme() {
        return window.matchMedia &&
            window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light";
    }

    private updateChartTheme(theme: "light" | "dark" | "system") {
        // Update chart colors based on theme
        void theme;
        if (this.tradeChart) {
            //const gridColor =
            //    theme === "dark"
            //        ? "rgba(255, 255, 255, 0.25)"
            //        : "rgba(102, 102, 102, 0.1)";
            //const annotationColor =
            //    theme === "dark"
            //        ? "rgba(255, 255, 255, 0.6)"
            //        : "rgba(102, 102, 102, 0.4)";
            //const tickColor = theme === "dark" ? "#e0e0e0" : "#666666";

            // Update grid colors TODO
            /*
        tradesChart.options.scales.x.grid.color = gridColor;
        tradesChart.options.scales.y.grid =
            tradesChart.options.scales.y.grid || {};
        tradesChart.options.scales.y.grid.color = gridColor;

        // Update tick colors
        tradesChart.options.scales.x.ticks.color = tickColor;
        tradesChart.options.scales.y.ticks.color = tickColor;

        // Update RSI chart colors to match
        if (rsiChart) {
            rsiChart.options.scales.x.grid.color = gridColor;
            rsiChart.options.scales.y.grid =
                rsiChart.options.scales.y.grid || {};
            rsiChart.options.scales.y.grid.color = gridColor;
            rsiChart.options.scales.x.ticks.color = tickColor;
            rsiChart.options.scales.y.ticks.color = tickColor;
        }

        // Update annotation colors
        const annotations = tradesChart.options.plugins.annotation.annotations;
        Object.keys(annotations).forEach((key) => {
            if (key.includes("15min") || !isNaN(key)) {
                annotations[key].borderColor = annotationColor;
            }
        });

        tradesChart.update("none");
    }

    // Update order book chart colors
    if (orderBookChart) {
        const gridColor =
            theme === "dark"
                ? "rgba(255, 255, 255, 0.25)"
                : "rgba(102, 102, 102, 0.1)";
        const tickColor = theme === "dark" ? "#e0e0e0" : "#666666";

        // Update grid colors
        orderBookChart.options.scales.x.grid =
            orderBookChart.options.scales.x.grid || {};
        orderBookChart.options.scales.x.grid.color = gridColor;
        orderBookChart.options.scales.y.grid =
            orderBookChart.options.scales.y.grid || {};
        orderBookChart.options.scales.y.grid.color = gridColor;

        // Update tick colors
        orderBookChart.options.scales.x.ticks.color = tickColor;
        orderBookChart.options.scales.y.ticks.color = tickColor;

        // Update order book bar colors with better visibility in dark mode
        updateOrderBookBarColors(theme);

        scheduleOrderBookUpdate();
    }

    // Update RSI chart colors
    if (rsiChart) {
        const gridColor =
            theme === "dark"
                ? "rgba(255, 255, 255, 0.25)"
                : "rgba(102, 102, 102, 0.1)";
        const annotationColor =
            theme === "dark"
                ? "rgba(255, 255, 255, 0.6)"
                : "rgba(102, 102, 102, 0.4)";
        const tickColor = theme === "dark" ? "#e0e0e0" : "#666666";

        // Update grid colors
        rsiChart.options.scales.x.grid.color = gridColor;
        rsiChart.options.scales.y.grid = rsiChart.options.scales.y.grid || {};
        rsiChart.options.scales.y.grid.color = gridColor;

        // Update tick colors
        rsiChart.options.scales.x.ticks.color = tickColor;
        rsiChart.options.scales.y.ticks.color = tickColor;

        // Update annotation colors
        const annotations = rsiChart.options.plugins.annotation.annotations;
        Object.keys(annotations).forEach((key) => {
            if (key.includes("15min") || !isNaN(key)) {
                annotations[key].borderColor = annotationColor;
            }
        });

        rsiChart.update("none");
        */
        }
    }

    private updateThemeToggleButton() {
        const button = document.getElementById("themeToggle");
        if (!button) return;

        const current = this.getCurrentTheme();
        const icons = {
            system: "🔄",
            light: "☀️",
            dark: "🌙",
        };

        const labels = {
            system: "System",
            light: "Light",
            dark: "Dark",
        };

        button.innerHTML = `${icons[current]} ${labels[current]}`;
        button.title = `Current theme: ${labels[current]}. Click to cycle through themes.`;
    }

    /**
     * Sets the time range for the trades chart.
     * @param {number} duration - Duration in milliseconds.
     */
    private setRange(duration: number) {
        // Apply the restored time range to the charts AFTER initialization
        console.log(
            "Applying time range after chart initialization:",
            duration === null ? "ALL" : `${duration / 60000} minutes`
        );
        this.activeRange = duration;
        this.tradeChart.activeRange = duration;
        this.rsiChart.activeRange = duration;

        // Save the new time range setting
        this.saveTimeRange();
    }

    private isValidRange(
        value: string
    ): value is "5400000" | "2700000" | "900000" | "300000" {
        return ["5400000", "2700000", "900000", "300000"].includes(value);
    }

    private saveTimeRange() {
        try {
            const rangeSettings = {
                activeRange: this.activeRange,
                timestamp: Date.now(),
            };

            localStorage.setItem(
                "dashboardTimeRange",
                JSON.stringify(rangeSettings)
            );
            console.log("Time range saved:", rangeSettings);
        } catch (error) {
            console.warn("Failed to save time range to localStorage:", error);
        }
    }
}
