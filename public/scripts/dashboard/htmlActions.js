import { NINETHY_MINUTES, PADDING_FACTOR } from "./state.js";
export class HTMLActions {
    tradeChart;
    rsiChart;
    rangeSelector;
    activeRange = NINETHY_MINUTES;
    constructor(tradeChart, rsiChart, activeRange, rangeSelector) {
        this.tradeChart = tradeChart;
        this.rsiChart = rsiChart;
        this.activeRange = activeRange;
        this.rangeSelector = rangeSelector;
    }
    setRangeSelector() {
        if (!this.rangeSelector) {
            throw new Error("Range selector element not found");
        }
        this.rangeSelector.addEventListener("click", (e) => {
            const target = e.target;
            if (target.tagName === "BUTTON") {
                const range = target.getAttribute("data-range");
                if (!this.isValidRange(range)) {
                    console.error(`Invalid range selected: ${range}`);
                }
                else {
                    if (this.rangeSelector) {
                        this.rangeSelector
                            .querySelectorAll("button")
                            .forEach((btn) => btn.classList.remove("active"));
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
    updateUnifiedTimeRange(latestTime) {
        const padding = Math.ceil(this.activeRange / PADDING_FACTOR);
        const unifiedMin = latestTime - this.activeRange;
        const unifiedMax = latestTime + padding;
        try {
            this.tradeChart.setScaleX(unifiedMin, unifiedMax, latestTime);
            this.rsiChart.setScaleX(unifiedMin, unifiedMax, latestTime);
        }
        catch (error) {
            console.error("updateUnifiedTimeRange Error: ", error);
        }
    }
    restoreTimeRange() {
        try {
            const savedRange = localStorage.getItem("dashboardTimeRange");
            if (!savedRange) {
                console.log("No saved time range found, using default (90 minutes)");
                return NINETHY_MINUTES;
            }
            const rangeSettings = JSON.parse(savedRange);
            if (rangeSettings.activeRange === undefined) {
                console.warn("Invalid saved time range, using default");
                return NINETHY_MINUTES;
            }
            this.activeRange = rangeSettings.activeRange;
            const rangeSelector = document.querySelector(".rangeSelector");
            if (rangeSelector) {
                rangeSelector.querySelectorAll("button").forEach((button) => {
                    const buttonRange = button.getAttribute("data-range");
                    const buttonRangeValue = buttonRange === "all" || !buttonRange
                        ? NINETHY_MINUTES
                        : parseInt(buttonRange);
                    if (buttonRangeValue === this.activeRange) {
                        button.classList.add("active");
                    }
                    else {
                        button.classList.remove("active");
                    }
                });
            }
            console.log("Time range restored:", {
                range: this.activeRange === null
                    ? "all"
                    : `${this.activeRange / 60000} minutes`,
                savedAt: new Date(rangeSettings.timestamp).toLocaleString(),
            });
            return this.activeRange;
        }
        catch (error) {
            console.warn("Failed to restore time range from localStorage:", error);
        }
        return NINETHY_MINUTES;
    }
    restoreTheme() {
        try {
            const savedTheme = this.getCurrentTheme();
            this.applyTheme(savedTheme);
            this.updateThemeToggleButton();
            console.log("Theme restored:", savedTheme);
        }
        catch (error) {
            console.warn("Failed to restore theme from localStorage:", error);
        }
    }
    restoreColumnWidths() {
        try {
            const savedWidths = localStorage.getItem("dashboardColumnWidths");
            if (!savedWidths) {
                console.log("No saved column widths found, using defaults");
                return;
            }
            const columnWidths = JSON.parse(savedWidths);
            if (!columnWidths.column1 || !columnWidths.column3) {
                console.warn("Invalid saved column widths, using defaults");
                return;
            }
            const column1 = document.getElementById("column1");
            const column3 = document.getElementById("column3");
            if (column1 && column3) {
                const column1Width = Math.min(Math.max(columnWidths.column1, 15), 50);
                const column3Width = Math.min(Math.max(columnWidths.column3, 10), 30);
                column1.style.flex = `0 0 ${column1Width}%`;
                column3.style.flex = `0 0 ${column3Width}%`;
                console.log("Column widths restored:", {
                    column1: column1Width,
                    column3: column3Width,
                    savedAt: new Date(columnWidths.timestamp).toLocaleString(),
                });
            }
        }
        catch (error) {
            console.warn("Failed to restore column widths from localStorage:", error);
        }
    }
    getCurrentTheme() {
        const saved = localStorage.getItem("dashboardTheme");
        if (saved && (saved === "light" || saved === "dark")) {
            return saved;
        }
        return "system";
    }
    applyTheme(theme) {
        const body = document.body;
        if (theme === "system") {
            body.removeAttribute("data-theme");
        }
        else {
            body.setAttribute("data-theme", theme);
        }
        this.updateChartTheme(theme === "system" ? this.getSystemTheme() : theme);
    }
    getSystemTheme() {
        return window.matchMedia &&
            window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light";
    }
    updateChartTheme(theme) {
        void theme;
        if (this.tradeChart) {
        }
    }
    updateThemeToggleButton() {
        const button = document.getElementById("themeToggle");
        if (!button)
            return;
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
    setRange(duration) {
        console.log("Applying time range after chart initialization:", duration === null ? "ALL" : `${duration / 60000} minutes`);
        this.activeRange = duration;
        this.tradeChart.activeRange = duration;
        this.rsiChart.activeRange = duration;
        this.saveTimeRange();
    }
    isValidRange(value) {
        return ["5400000", "2700000", "900000", "300000"].includes(value);
    }
    saveTimeRange() {
        try {
            const rangeSettings = {
                activeRange: this.activeRange,
                timestamp: Date.now(),
            };
            localStorage.setItem("dashboardTimeRange", JSON.stringify(rangeSettings));
            console.log("Time range saved:", rangeSettings);
        }
        catch (error) {
            console.warn("Failed to save time range to localStorage:", error);
        }
    }
}
