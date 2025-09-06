import { NINETHY_MINUTES, PADDING_FACTOR } from "./state.js";
import interact from "interactjs";
const BADGE_TIMEOUT_MS = 4000;
export class HTMLActions {
    tradeChart;
    rsiChart;
    rangeSelector;
    activeRange = NINETHY_MINUTES;
    anomalyFilters = new Set(["critical", "high"]);
    anomalyList = [];
    anomalySeverityOrder = [
        "critical",
        "high",
        "medium",
        "info",
    ];
    latestBadgeElem = null;
    badgeTimeout = null;
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
                            .forEach((btn) => requestAnimationFrame(() => {
                            btn.classList.remove("active");
                        }));
                    }
                    requestAnimationFrame(() => {
                        target.classList.add("active");
                    });
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
                    requestAnimationFrame(() => {
                        if (buttonRangeValue === this.activeRange) {
                            button.classList.add("active");
                        }
                        else {
                            button.classList.remove("active");
                        }
                    });
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
    restoreColumnDimensions() {
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
                requestAnimationFrame(() => {
                    column1.style.flex = `0 0 ${column1Width}%`;
                    column3.style.flex = `0 0 ${column3Width}%`;
                });
                console.log("Column widths restored:", {
                    column1: column1Width,
                    column3: column3Width,
                    savedAt: new Date(columnWidths.timestamp).toLocaleString(),
                });
            }
            const savedHeights = localStorage.getItem("dashboardColumnHeights");
            if (!savedHeights) {
                console.log("No saved column heights found, using defaults");
                return;
            }
            const columnHeights = JSON.parse(savedHeights);
            if (!columnHeights.rsiContainer ||
                !columnHeights.anomalyListContainer) {
                console.warn("Invalid saved column heights, using defaults");
                return;
            }
            const rsiContainer = document.getElementById("rsiContainer");
            const anomalyListContainer = document.getElementById("anomalyListContainer");
            if (rsiContainer && anomalyListContainer) {
                const rsiContainerHeight = Math.min(Math.max(columnHeights.rsiContainer, 15), 50);
                const anomalyListContainerHeight = Math.min(Math.max(columnHeights.rsiContainer, 15), 85);
                requestAnimationFrame(() => {
                    rsiContainer.style.flex = `0 0 ${rsiContainerHeight}%`;
                    anomalyListContainer.style.flex = `0 0 ${anomalyListContainerHeight}%`;
                });
                console.log("Column widths restored:", {
                    rsiContainer: rsiContainerHeight,
                    anomalyListContainer: anomalyListContainerHeight,
                    savedAt: new Date(columnHeights.timestamp).toLocaleString(),
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
    restoreAnomalyFilters() {
        try {
            const savedFilters = localStorage.getItem("dashboardAnomalyFilters");
            if (!savedFilters) {
                console.log("No saved anomaly filters found, using defaults");
                return;
            }
            const filterSettings = JSON.parse(savedFilters);
            if (!filterSettings.filters ||
                !Array.isArray(filterSettings.filters)) {
                console.warn("Invalid saved anomaly filters, using defaults");
                return;
            }
            this.setAnomalyFilters(new Set(filterSettings.filters));
            const filterBox = document.querySelector(".anomaly-filter");
            if (filterBox) {
                filterBox
                    .querySelectorAll("input[type=checkbox]")
                    .forEach((checkbox) => {
                    checkbox.checked =
                        this.anomalyFilters.has(checkbox.value);
                });
            }
            console.log("Anomaly filters restored:", {
                filters: filterSettings.filters,
                savedAt: new Date(filterSettings.timestamp).toLocaleString(),
            });
            this.renderAnomalyList();
        }
        catch (error) {
            console.warn("Failed to restore anomaly filters from localStorage:", error);
        }
    }
    renderAnomalyList() {
        const listElem = document.getElementById("anomalyList");
        if (!listElem)
            return;
        const filtered = this.anomalyList.filter((a) => this.anomalyFilters.has(a.severity));
        while (listElem.firstChild) {
            listElem.removeChild(listElem.firstChild);
        }
        const fragment = document.createDocumentFragment();
        for (const anomaly of filtered) {
            const row = document.createElement("div");
            row.className = `anomaly-row ${anomaly.severity}`;
            row.title = this.getAnomalySummary(anomaly);
            requestAnimationFrame(() => {
                const iconSpan = document.createElement("span");
                iconSpan.className = "anomaly-icon";
                iconSpan.textContent = this.getAnomalyIcon(anomaly.type || "");
                const labelSpan = document.createElement("span");
                labelSpan.className = "anomaly-label";
                labelSpan.textContent = this.getAnomalyLabel(anomaly.type || "");
                const priceSpan = document.createElement("span");
                priceSpan.className = "anomaly-price";
                priceSpan.textContent = anomaly.affectedPriceRange
                    ? `${anomaly.affectedPriceRange.min.toFixed(2)}-${anomaly.affectedPriceRange.max.toFixed(2)}`
                    : `${anomaly.price?.toFixed(2) || "N/A"}`;
                const actionSpan = document.createElement("span");
                actionSpan.className = "anomaly-action";
                actionSpan.textContent = this.getReadableAction(anomaly.recommendedAction);
                const timeSpan = document.createElement("span");
                timeSpan.className = "anomaly-time";
                timeSpan.textContent = this.formatAgo(anomaly.detectedAt || anomaly.timestamp || Date.now());
                row.appendChild(iconSpan);
                row.appendChild(labelSpan);
                row.appendChild(priceSpan);
                row.appendChild(actionSpan);
                row.appendChild(timeSpan);
                fragment.appendChild(row);
            });
        }
        listElem.appendChild(fragment);
    }
    getAnomalySummary(anomaly) {
        if (!anomaly || typeof anomaly !== "object")
            return "";
        const details = anomaly.details || {};
        const parts = [];
        if (details.confidence !== undefined) {
            const pct = Number(details.confidence) * 100;
            if (!Number.isNaN(pct))
                parts.push(`Conf: ${pct.toFixed(0)}%`);
        }
        if (details.imbalance !== undefined) {
            const val = Number(details.imbalance);
            if (!Number.isNaN(val))
                parts.push(`Imb: ${val.toFixed(2)}`);
        }
        if (details.absorptionRatio !== undefined) {
            const val = Number(details.absorptionRatio);
            if (!Number.isNaN(val))
                parts.push(`AbsRatio: ${val.toFixed(2)}`);
        }
        if (details.rationale) {
            if (typeof details.rationale === "string") {
                parts.push(details.rationale);
            }
            else if (typeof details.rationale === "object") {
                const flags = Object.entries(details.rationale)
                    .filter(([, v]) => Boolean(v))
                    .map(([k]) => k)
                    .join(", ");
                if (flags)
                    parts.push(`Reasons: ${flags}`);
            }
        }
        return parts.join(" | ");
    }
    formatAgo(ts) {
        const s = Math.floor((Date.now() - ts) / 1000);
        if (s < 60)
            return `${s}s ago`;
        const m = Math.floor(s / 60);
        return `${m}m ago`;
    }
    getAnomalyLabel(type) {
        switch (type) {
            case "flash_crash":
                return "Flash Crash";
            case "liquidity_void":
                return "Liquidity Void";
            case "absorption":
                return "Absorption";
            case "exhaustion":
                return "Exhaustion";
            case "whale_activity":
                return "Whale Activity";
            case "momentum_ignition":
                return "Momentum Ignition";
            case "spoofing":
                return "Spoofing";
            case "iceberg_order":
                return "Iceberg Order";
            case "orderbook_imbalance":
                return "Orderbook Imbalance";
            case "flow_imbalance":
                return "Flow Imbalance";
            case "hidden_liquidity":
                return "Hidden Liquidity";
            case "stealth_order":
                return "Stealth Order";
            case "reserve_order":
                return "Reserve Order";
            case "algorithmic_stealth":
                return "Algorithmic Stealth";
            default:
                return type
                    .replace(/_/g, " ")
                    .replace(/\b\w/g, (l) => l.toUpperCase());
        }
    }
    getAnomalyIcon(type) {
        switch (type) {
            case "flash_crash":
                return "⚡";
            case "liquidity_void":
                return "💧";
            case "absorption":
                return "🔵";
            case "exhaustion":
                return "🔴";
            case "whale_activity":
                return "🐋";
            case "momentum_ignition":
                return "🔥";
            case "spoofing":
                return "👻";
            case "iceberg_order":
                return "🧊";
            case "hidden_liquidity":
                return "🔍";
            case "stealth_order":
                return "👤";
            case "reserve_order":
                return "📦";
            case "algorithmic_stealth":
                return "🤖";
            case "orderbook_imbalance":
                return "⚖️";
            case "flow_imbalance":
                return "⇄";
            default:
                return "•";
        }
    }
    showAnomalyBadge(anomaly) {
        if (this.latestBadgeElem)
            this.latestBadgeElem.remove();
        const badge = document.createElement("div");
        badge.className = `anomaly-badge ${anomaly.severity}`;
        badge.innerHTML = `${this.getAnomalyIcon(anomaly.type || "")} ${this.getAnomalyLabel(anomaly.type || "")} @ ${anomaly.price?.toFixed(2) || "N/A"}`;
        document.body.appendChild(badge);
        this.latestBadgeElem = badge;
        if (this.badgeTimeout)
            clearTimeout(this.badgeTimeout);
        this.badgeTimeout = setTimeout(() => {
            badge.remove();
            this.latestBadgeElem = null;
        }, BADGE_TIMEOUT_MS);
    }
    setAnomalyFilters(filters) {
        this.anomalyFilters = filters;
    }
    saveColumnDimensions() {
        try {
            const dashboard = document.querySelector(".dashboard");
            const column1 = document.getElementById("column1");
            const column3 = document.getElementById("column3");
            const rsiContainer = document.getElementById("rsiContainer");
            const anomalyListContainer = document.getElementById("anomalyListContainer");
            if (dashboard &&
                column1 &&
                column3 &&
                rsiContainer &&
                anomalyListContainer) {
                const dashboardRect = dashboard.getBoundingClientRect();
                const column1Rect = column1.getBoundingClientRect();
                const column3Rect = column3.getBoundingClientRect();
                const rsiContainerRect = rsiContainer.getBoundingClientRect();
                const anomalyListContainerRect = anomalyListContainer.getBoundingClientRect();
                const column1Percent = (column1Rect.width / dashboardRect.width) * 100;
                const column3Percent = (column3Rect.width / dashboardRect.width) * 100;
                const rsiContainerPercent = (rsiContainerRect.height / dashboardRect.height) * 100;
                const anomalyListContainerPercent = (anomalyListContainerRect.height / dashboardRect.height) *
                    100;
                const columnWidths = {
                    column1: column1Percent,
                    column3: column3Percent,
                    timestamp: Date.now(),
                };
                const columHeights = {
                    rsiContainer: rsiContainerPercent,
                    anomalyListContainer: anomalyListContainerPercent,
                    timestamp: Date.now(),
                };
                localStorage.setItem("dashboardColumnWidths", JSON.stringify(columnWidths));
                localStorage.setItem("dashboardColumnHeights", JSON.stringify(columHeights));
                console.log("Column widths saved:", columnWidths);
                console.log("Column heights saved:", columHeights);
            }
        }
        catch (error) {
            console.warn("Failed to save column dimensions to localStorage:", error);
        }
    }
    setupColumnResizing() {
        if (!interact) {
            console.error("Interact.js not loaded");
            return;
        }
        const self = this;
        interact(".resize-handle-y").resizable({
            listeners: {
                move(event) {
                    const handle = event.target;
                    const handleId = handle.id;
                    const dashboard = document.querySelector(".dashboard");
                    if (dashboard) {
                        const dashboardRect = dashboard.getBoundingClientRect();
                        if (handleId === "resize-v1") {
                            const rsiContainer = document.getElementById("rsiContainer");
                            if (rsiContainer) {
                                const rsiContainerRect = rsiContainer.getBoundingClientRect();
                                const newHeight = Math.min(Math.max(rsiContainerRect.height - event.dy, 200), dashboardRect.height * 0.5);
                                const newPercent = (newHeight / dashboardRect.height) * 100;
                                requestAnimationFrame(() => {
                                    rsiContainer.style.flex = `0 0 ${newPercent}%`;
                                });
                                console.log(`INTERACT: ${event.dy} | ${newPercent}`);
                            }
                        }
                        else if (handleId === "resize-v2") {
                            const anomalyListContainer = document.getElementById("anomalyListContainer");
                            if (anomalyListContainer) {
                                const anomalyListContainerRect = anomalyListContainer.getBoundingClientRect();
                                const newHeight = Math.min(Math.max(anomalyListContainerRect.height -
                                    event.dy, 200), dashboardRect.height * 0.5);
                                const newPercent = (newHeight / dashboardRect.height) * 100;
                                requestAnimationFrame(() => {
                                    anomalyListContainer.style.flex = `0 0 ${newPercent}%`;
                                });
                                console.log(`INTERACT: ${event.dy} | ${newPercent}`);
                            }
                        }
                    }
                },
                end(event) {
                    void event;
                    self.saveColumnDimensions();
                },
            },
        });
        interact(".resize-handle").resizable({
            listeners: {
                move(event) {
                    const handle = event.target;
                    const handleId = handle.id;
                    const dashboard = document.querySelector(".dashboard");
                    if (dashboard) {
                        const dashboardRect = dashboard.getBoundingClientRect();
                        if (handleId === "resize1") {
                            const column1 = document.getElementById("column1");
                            if (column1) {
                                const column1Rect = column1.getBoundingClientRect();
                                const newWidth = Math.min(Math.max(column1Rect.width + event.dx, 200), dashboardRect.width * 0.5);
                                const newPercent = (newWidth / dashboardRect.width) * 100;
                                requestAnimationFrame(() => {
                                    column1.style.flex = `0 0 ${newPercent}%`;
                                });
                            }
                        }
                        else if (handleId === "resize2") {
                            const column3 = document.getElementById("column3");
                            if (column3) {
                                const column3Rect = column3.getBoundingClientRect();
                                const newWidth = Math.min(Math.max(column3Rect.width - event.dx, 150), dashboardRect.width * 0.3);
                                const newPercent = (newWidth / dashboardRect.width) * 100;
                                requestAnimationFrame(() => {
                                    column3.style.flex = `0 0 ${newPercent}%`;
                                });
                            }
                        }
                        else if (handleId === "resize-v1") {
                            console.log("INTERACT:");
                            const tradesContainer = document.getElementById("tradesContainer");
                            if (tradesContainer) {
                                const tradesContainerRect = tradesContainer.getBoundingClientRect();
                                const newHeight = Math.min(Math.max(tradesContainerRect.height + event.dy, 200), dashboardRect.height * 0.5);
                                requestAnimationFrame(() => {
                                    tradesContainer.style.flex = `0 0 0 ${newHeight}%`;
                                });
                            }
                        }
                    }
                },
                end(event) {
                    void event;
                    self.saveColumnDimensions();
                },
            },
        });
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
        requestAnimationFrame(() => {
            button.innerHTML = `${icons[current]} ${labels[current]}`;
            button.title = `Current theme: ${labels[current]}. Click to cycle through themes.`;
        });
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
    getReadableAction(action) {
        if (!action)
            return "Monitor";
        switch (action.toLowerCase()) {
            case "buy_signal":
            case "buy":
                return "Buy";
            case "sell_signal":
            case "sell":
                return "Sell";
            case "hold_position":
            case "hold":
                return "Hold";
            case "close_position":
            case "close":
                return "Close";
            case "reduce_position":
            case "reduce":
                return "Reduce";
            case "increase_position":
            case "increase":
                return "Add";
            case "wait_for_confirmation":
            case "wait":
                return "Wait";
            case "monitor_closely":
            case "monitor":
                return "Monitor";
            case "avoid_trading":
            case "avoid":
                return "Avoid";
            case "exit_immediately":
            case "exit":
                return "Exit";
            default:
                return action
                    .replace(/_/g, " ")
                    .replace(/\b\w/g, (l) => l.toUpperCase());
        }
    }
    showSignalBundleBadge(signals) {
        if (!Array.isArray(signals) || signals.length === 0)
            return;
        const top = signals[0];
        if (this.latestBadgeElem)
            this.latestBadgeElem.remove();
        const badge = document.createElement("div");
        badge.className = "anomaly-badge";
        let color = "#757575";
        if (top.confidence && top.confidence > 0.9) {
            color = "#2e7d32";
        }
        else if (top.confidence && top.confidence >= 0.75) {
            color = "#fb8c00";
        }
        requestAnimationFrame(() => {
            badge.style.background = color;
            badge.innerHTML = `${top.side.toUpperCase()} @ ${top.price.toFixed(2)} (${((top.confidence || 0) * 100).toFixed(0)}%)`;
            document.body.appendChild(badge);
        });
        this.latestBadgeElem = badge;
        if (this.badgeTimeout)
            clearTimeout(this.badgeTimeout);
        this.badgeTimeout = setTimeout(() => {
            badge.remove();
            this.latestBadgeElem = null;
        }, BADGE_TIMEOUT_MS);
    }
    saveAnomalyFilters() {
        try {
            const filterSettings = {
                filters: Array.from(this.anomalyFilters),
                timestamp: Date.now(),
            };
            localStorage.setItem("dashboardAnomalyFilters", JSON.stringify(filterSettings));
            console.log("Anomaly filters saved:", filterSettings);
        }
        catch (error) {
            console.warn("Failed to save anomaly filters to localStorage:", error);
        }
    }
    resetAllSettings() {
        try {
            this.resetColumnDimensions();
            this.setAnomalyFilters(new Set(["critical", "high"]));
            localStorage.removeItem("dashboardAnomalyFilters");
            const filterBox = document.querySelector(".anomaly-filter");
            if (filterBox) {
                filterBox
                    .querySelectorAll("input[type=checkbox]")
                    .forEach((checkbox) => {
                    checkbox.checked =
                        this.anomalyFilters.has(checkbox.value);
                });
            }
            this.renderAnomalyList();
            this.activeRange = NINETHY_MINUTES;
            localStorage.removeItem("dashboardTimeRange");
            const rangeSelector = document.querySelector(".rangeSelector");
            if (rangeSelector) {
                rangeSelector.querySelectorAll("button").forEach((button) => {
                    const buttonRange = button.getAttribute("data-range");
                    const buttonRangeValue = buttonRange
                        ? parseInt(buttonRange)
                        : NINETHY_MINUTES;
                    requestAnimationFrame(() => {
                        if (buttonRangeValue === this.activeRange) {
                            button.classList.add("active");
                        }
                        else {
                            button.classList.remove("active");
                        }
                    });
                });
            }
            localStorage.removeItem("dashboardTheme");
            this.applySystemTheme();
            this.updateThemeToggleButton();
            this.tradeChart.activeRange = this.activeRange;
            this.rsiChart.activeRange = this.activeRange;
            this.updateUnifiedTimeRange;
            console.log("All dashboard settings reset to defaults");
        }
        catch (error) {
            console.warn("Failed to reset all settings:", error);
        }
    }
    resetColumnDimensions() {
        try {
            const column1 = document.getElementById("column1");
            const column3 = document.getElementById("column3");
            if (column1 && column3) {
                requestAnimationFrame(() => {
                    column1.style.flex = "0 0 25%";
                    column3.style.flex = "0 0 15%";
                });
                localStorage.removeItem("dashboardColumnWidths");
                console.log("Column widths reset to defaults");
            }
            const rsiContainer = document.getElementById("rsiContainer");
            const anomalyListContainer = document.getElementById("anomalyListContainer");
            if (rsiContainer && anomalyListContainer) {
                requestAnimationFrame(() => {
                    rsiContainer.style.flex = "0 0 50%";
                    anomalyListContainer.style.flex = "0 0 50%";
                });
                localStorage.removeItem("dashboardColumnHeights");
                console.log("Column heights reset to defaults");
            }
        }
        catch (error) {
            console.warn("Failed to reset column dimensions:", error);
        }
    }
    applySystemTheme() {
        this.applyTheme("system");
    }
    saveTheme(theme) {
        try {
            if (theme === "system") {
                localStorage.removeItem("dashboardTheme");
            }
            else {
                localStorage.setItem("dashboardTheme", theme);
            }
            console.log("Theme saved:", theme);
        }
        catch (error) {
            console.warn("Failed to save theme to localStorage:", error);
        }
    }
    toggleTheme() {
        const current = this.getCurrentTheme();
        let next;
        switch (current) {
            case "system":
                next = "light";
                break;
            case "light":
                next = "dark";
                break;
            case "dark":
                next = "system";
                break;
            default:
                next = "system";
        }
        this.applyTheme(next);
        this.saveTheme(next);
        this.updateThemeToggleButton();
    }
}
