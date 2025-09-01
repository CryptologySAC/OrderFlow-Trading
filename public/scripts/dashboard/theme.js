import { tradesChart, orderBookChart, rsiChart, orderBookData, } from "./state.js";
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
    }
    else {
        body.setAttribute("data-theme", theme);
    }
    updateChartTheme(theme === "system" ? getSystemTheme() : theme);
}
export function applySystemTheme() {
    applyTheme("system");
}
export function saveTheme(theme) {
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
export function restoreTheme() {
    try {
        const savedTheme = getCurrentTheme();
        applyTheme(savedTheme);
        updateThemeToggleButton();
        console.log("Theme restored:", savedTheme);
    }
    catch (error) {
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
    if (!button)
        return;
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
    if (tradesChart) {
        const gridColor = theme === "dark"
            ? "rgba(255, 255, 255, 0.25)"
            : "rgba(102, 102, 102, 0.1)";
        const annotationColor = theme === "dark"
            ? "rgba(255, 255, 255, 0.6)"
            : "rgba(102, 102, 102, 0.4)";
        const tickColor = theme === "dark" ? "#e0e0e0" : "#666666";
        if (tradesChart.options.scales.x.grid) {
            tradesChart.options.scales.x.grid.color = gridColor;
        }
        if (tradesChart.options.scales.y.grid) {
            tradesChart.options.scales.y.grid.color = gridColor;
        }
        if (tradesChart.options.scales.x.ticks) {
            tradesChart.options.scales.x.ticks.color = tickColor;
        }
        if (tradesChart.options.scales.y.ticks) {
            tradesChart.options.scales.y.ticks.color = tickColor;
        }
        if (rsiChart) {
            if (rsiChart.options.scales.x.grid) {
                rsiChart.options.scales.x.grid.color = gridColor;
            }
            if (rsiChart.options.scales.y.grid) {
                rsiChart.options.scales.y.grid.color = gridColor;
            }
            if (rsiChart.options.scales.x.ticks) {
                rsiChart.options.scales.x.ticks.color = tickColor;
            }
            if (rsiChart.options.scales.y.ticks) {
                rsiChart.options.scales.y.ticks.color = tickColor;
            }
        }
        if (tradesChart.options.plugins?.annotation?.annotations) {
            const annotations = tradesChart.options.plugins.annotation.annotations;
            Object.keys(annotations).forEach((key) => {
                if (key.includes("15min") || !isNaN(Number(key))) {
                    annotations[key].borderColor = annotationColor;
                }
            });
        }
        tradesChart.update("none");
    }
    if (orderBookChart) {
        const gridColor = theme === "dark"
            ? "rgba(255, 255, 255, 0.25)"
            : "rgba(102, 102, 102, 0.1)";
        const tickColor = theme === "dark" ? "#e0e0e0" : "#666666";
        if (orderBookChart.options.scales.x.grid) {
            orderBookChart.options.scales.x.grid.color = gridColor;
        }
        if (orderBookChart.options.scales.y.grid) {
            orderBookChart.options.scales.y.grid.color = gridColor;
        }
        if (orderBookChart.options.scales.x.ticks) {
            orderBookChart.options.scales.x.ticks.color = tickColor;
        }
        if (orderBookChart.options.scales.y.ticks) {
            orderBookChart.options.scales.y.ticks.color = tickColor;
        }
        updateOrderBookBarColors(theme);
        scheduleOrderBookUpdate();
    }
    if (rsiChart) {
        const gridColor = theme === "dark"
            ? "rgba(255, 255, 255, 0.25)"
            : "rgba(102, 102, 102, 0.1)";
        const annotationColor = theme === "dark"
            ? "rgba(255, 255, 255, 0.6)"
            : "rgba(102, 102, 102, 0.4)";
        const tickColor = theme === "dark" ? "#e0e0e0" : "#666666";
        if (rsiChart.options.scales.x.grid) {
            rsiChart.options.scales.x.grid.color = gridColor;
        }
        if (rsiChart.options.scales.y.grid) {
            rsiChart.options.scales.y.grid.color = gridColor;
        }
        if (rsiChart.options.scales.x.ticks) {
            rsiChart.options.scales.x.ticks.color = tickColor;
        }
        if (rsiChart.options.scales.y.ticks) {
            rsiChart.options.scales.y.ticks.color = tickColor;
        }
        if (rsiChart.options.plugins?.annotation?.annotations) {
            const annotations = rsiChart.options.plugins.annotation.annotations;
            Object.keys(annotations).forEach((key) => {
                if (key.includes("15min") || !isNaN(Number(key))) {
                    annotations[key].borderColor = annotationColor;
                }
            });
        }
        rsiChart.update("none");
    }
}
export function getDepletionVisualizationEnabled() {
    const saved = localStorage.getItem("depletionVisualizationEnabled");
    return saved !== null ? JSON.parse(saved) : true;
}
export function setDepletionVisualizationEnabled(enabled) {
    const safeStringify = window.safeStringify || JSON.stringify;
    localStorage.setItem("depletionVisualizationEnabled", safeStringify(enabled));
}
export function toggleDepletionVisualization() {
    const currentEnabled = getDepletionVisualizationEnabled();
    const newEnabled = !currentEnabled;
    setDepletionVisualizationEnabled(newEnabled);
    updateDepletionToggleButton();
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
function updateOrderBookBarColors(theme) {
    console.log("updateOrderBookBarColors called with theme:", theme);
}
function scheduleOrderBookUpdate() {
    console.log("scheduleOrderBookUpdate called");
}
function updateOrderBookDisplay(data) {
    console.log("updateOrderBookDisplay called with data:", data);
}
