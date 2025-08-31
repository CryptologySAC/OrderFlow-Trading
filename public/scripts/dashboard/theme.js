import {
    tradesChart,
    orderBookChart,
    rsiChart,
    orderBookData,
} from "./state.js";
import {
    scheduleOrderBookUpdate,
    updateOrderBookBarColors,
    updateOrderBookDisplay,
} from "./charts.js";

export function getSystemTheme() {
    return window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
}

export function getCurrentTheme() {
    const saved = localStorage.getItem("dashboardTheme");
    if (saved && (saved === "light" || saved === "dark")) {
        return saved;
    }
    return "system";
}

export function applyTheme(theme) {
    const body = document.body;

    if (theme === "system") {
        body.removeAttribute("data-theme");
    } else {
        body.setAttribute("data-theme", theme);
    }

    // Update chart colors for dark/light mode
    updateChartTheme(theme === "system" ? getSystemTheme() : theme);
}

export function applySystemTheme() {
    applyTheme("system");
}

export function saveTheme(theme) {
    try {
        if (theme === "system") {
            localStorage.removeItem("dashboardTheme");
        } else {
            localStorage.setItem("dashboardTheme", theme);
        }
        console.log("Theme saved:", theme);
    } catch (error) {
        console.warn("Failed to save theme to localStorage:", error);
    }
}

export function restoreTheme() {
    try {
        const savedTheme = getCurrentTheme();
        applyTheme(savedTheme);
        updateThemeToggleButton();

        console.log("Theme restored:", savedTheme);
    } catch (error) {
        console.warn("Failed to restore theme from localStorage:", error);
    }
}

export function toggleTheme() {
    const current = getCurrentTheme();
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

    applyTheme(next);
    saveTheme(next);
    updateThemeToggleButton();
}

export function updateThemeToggleButton() {
    const button = document.getElementById("themeToggle");
    if (!button) return;

    const current = getCurrentTheme();
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

export function updateChartTheme(theme) {
    // Update chart colors based on theme
    if (tradesChart) {
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
    }
}

// Depletion visualization toggle functions
export function getDepletionVisualizationEnabled() {
    const saved = localStorage.getItem("depletionVisualizationEnabled");
    return saved !== null ? JSON.parse(saved) : true; // Default to enabled
}

export function setDepletionVisualizationEnabled(enabled) {
    // Use safe stringify to prevent potential recursion issues
    const safeStringify = window.safeStringify || JSON.stringify;
    localStorage.setItem(
        "depletionVisualizationEnabled",
        safeStringify(enabled)
    );
}

export function toggleDepletionVisualization() {
    const currentEnabled = getDepletionVisualizationEnabled();
    const newEnabled = !currentEnabled;
    setDepletionVisualizationEnabled(newEnabled);
    updateDepletionToggleButton();

    // Force refresh of orderbook display to apply new setting
    if (orderBookChart && orderBookData) {
        updateOrderBookDisplay(orderBookData);
    }
}

export function updateDepletionToggleButton() {
    const depletionToggleBtn = document.getElementById("depletionToggle");
    if (depletionToggleBtn) {
        const enabled = getDepletionVisualizationEnabled();
        depletionToggleBtn.textContent = enabled
            ? "📊 Depletion ON"
            : "📊 Depletion OFF";
        depletionToggleBtn.classList.toggle("active", enabled);
    }
}
