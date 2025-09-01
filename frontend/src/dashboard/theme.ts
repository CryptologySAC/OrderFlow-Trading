// Theme management for the trading dashboard
// Converted from JavaScript to TypeScript with strict type checking

import type { OrderBookData, ThemeMode } from "../frontend-types.js";
import {
    tradesChart,
    orderBookChart,
    rsiChart,
    orderBookData,
} from "./state.js";

// =============================================================================
// THEME TYPE DEFINITIONS
// =============================================================================

export type ThemeType = "light" | "dark" | "system";

// =============================================================================
// SYSTEM THEME DETECTION
// =============================================================================

export function getSystemTheme(): "light" | "dark" {
    return window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
}

export function getCurrentTheme(): ThemeMode {
    const saved: string | null = localStorage.getItem("dashboardTheme");
    if (saved && (saved === "light" || saved === "dark")) {
        return saved;
    }
    return "system";
}

// =============================================================================
// THEME APPLICATION
// =============================================================================

export function applyTheme(theme: ThemeMode): void {
    const body: HTMLElement = document.body;

    if (theme === "system") {
        body.removeAttribute("data-theme");
    } else {
        body.setAttribute("data-theme", theme);
    }

    // Update chart colors for dark/light mode
    updateChartTheme(theme === "system" ? getSystemTheme() : theme);
}

export function applySystemTheme(): void {
    applyTheme("system");
}

// =============================================================================
// THEME PERSISTENCE
// =============================================================================

export function saveTheme(theme: ThemeMode): void {
    try {
        if (theme === "system") {
            localStorage.removeItem("dashboardTheme");
        } else {
            localStorage.setItem("dashboardTheme", theme);
        }
        console.log("Theme saved:", theme);
    } catch (error: unknown) {
        console.warn("Failed to save theme to localStorage:", error);
    }
}

export function restoreTheme(): void {
    try {
        const savedTheme: ThemeMode = getCurrentTheme();
        applyTheme(savedTheme);
        updateThemeToggleButton();

        console.log("Theme restored:", savedTheme);
    } catch (error: unknown) {
        console.warn("Failed to restore theme from localStorage:", error);
    }
}

// =============================================================================
// THEME TOGGLE FUNCTIONALITY
// =============================================================================

export function toggleTheme(): void {
    const current: ThemeMode = getCurrentTheme();
    let next: ThemeMode;

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

export function updateThemeToggleButton(): void {
    const button: HTMLElement | null = document.getElementById("themeToggle");
    if (!button) return;

    const current: ThemeMode = getCurrentTheme();
    const icons: Record<ThemeMode, string> = {
        system: "🔄",
        light: "☀️",
        dark: "🌙",
    };

    const labels: Record<ThemeMode, string> = {
        system: "System",
        light: "Light",
        dark: "Dark",
    };

    button.innerHTML = `${icons[current]} ${labels[current]}`;
    button.title = `Current theme: ${labels[current]}. Click to cycle through themes.`;
}

// =============================================================================
// CHART THEME UPDATES
// =============================================================================

export function updateChartTheme(theme: "light" | "dark"): void {
    // Update chart colors based on theme
    if (tradesChart) {
        const gridColor: string =
            theme === "dark"
                ? "rgba(255, 255, 255, 0.25)"
                : "rgba(102, 102, 102, 0.1)";
        const annotationColor: string =
            theme === "dark"
                ? "rgba(255, 255, 255, 0.6)"
                : "rgba(102, 102, 102, 0.4)";
        const tickColor: string = theme === "dark" ? "#e0e0e0" : "#666666";

        // Update grid colors
        if (tradesChart.options.scales.x.grid) {
            tradesChart.options.scales.x.grid.color = gridColor;
        }
        if (tradesChart.options.scales.y.grid) {
            tradesChart.options.scales.y.grid.color = gridColor;
        }

        // Update tick colors
        if (tradesChart.options.scales.x.ticks) {
            tradesChart.options.scales.x.ticks.color = tickColor;
        }
        if (tradesChart.options.scales.y.ticks) {
            tradesChart.options.scales.y.ticks.color = tickColor;
        }

        // Update RSI chart colors to match
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

        // Update annotation colors
        if (tradesChart.options.plugins?.annotation?.annotations) {
            const annotations: Record<string, any> =
                tradesChart.options.plugins.annotation.annotations;
            Object.keys(annotations).forEach((key: string) => {
                if (key.includes("15min") || !isNaN(Number(key))) {
                    annotations[key].borderColor = annotationColor;
                }
            });
        }

        tradesChart.update("none");
    }

    // Update order book chart colors
    if (orderBookChart) {
        const gridColor: string =
            theme === "dark"
                ? "rgba(255, 255, 255, 0.25)"
                : "rgba(102, 102, 102, 0.1)";
        const tickColor: string = theme === "dark" ? "#e0e0e0" : "#666666";

        // Update grid colors
        if (orderBookChart.options.scales.x.grid) {
            orderBookChart.options.scales.x.grid.color = gridColor;
        }
        if (orderBookChart.options.scales.y.grid) {
            orderBookChart.options.scales.y.grid.color = gridColor;
        }

        // Update tick colors
        if (orderBookChart.options.scales.x.ticks) {
            orderBookChart.options.scales.x.ticks.color = tickColor;
        }
        if (orderBookChart.options.scales.y.ticks) {
            orderBookChart.options.scales.y.ticks.color = tickColor;
        }

        // Update order book bar colors with better visibility in dark mode
        updateOrderBookBarColors(theme);

        scheduleOrderBookUpdate();
    }

    // Update RSI chart colors
    if (rsiChart) {
        const gridColor: string =
            theme === "dark"
                ? "rgba(255, 255, 255, 0.25)"
                : "rgba(102, 102, 102, 0.1)";
        const annotationColor: string =
            theme === "dark"
                ? "rgba(255, 255, 255, 0.6)"
                : "rgba(102, 102, 102, 0.4)";
        const tickColor: string = theme === "dark" ? "#e0e0e0" : "#666666";

        // Update grid colors
        if (rsiChart.options.scales.x.grid) {
            rsiChart.options.scales.x.grid.color = gridColor;
        }
        if (rsiChart.options.scales.y.grid) {
            rsiChart.options.scales.y.grid.color = gridColor;
        }

        // Update tick colors
        if (rsiChart.options.scales.x.ticks) {
            rsiChart.options.scales.x.ticks.color = tickColor;
        }
        if (rsiChart.options.scales.y.ticks) {
            rsiChart.options.scales.y.ticks.color = tickColor;
        }

        // Update annotation colors
        if (rsiChart.options.plugins?.annotation?.annotations) {
            const annotations: Record<string, any> =
                rsiChart.options.plugins.annotation.annotations;
            Object.keys(annotations).forEach((key: string) => {
                if (key.includes("15min") || !isNaN(Number(key))) {
                    annotations[key].borderColor = annotationColor;
                }
            });
        }

        rsiChart.update("none");
    }
}

// =============================================================================
// DEPLETION VISUALIZATION TOGGLE
// =============================================================================

export function getDepletionVisualizationEnabled(): boolean {
    const saved: string | null = localStorage.getItem(
        "depletionVisualizationEnabled"
    );
    return saved !== null ? JSON.parse(saved) : true; // Default to enabled
}

export function setDepletionVisualizationEnabled(enabled: boolean): void {
    // Use safe stringify to prevent potential recursion issues
    const safeStringify = (window as any).safeStringify || JSON.stringify;
    localStorage.setItem(
        "depletionVisualizationEnabled",
        safeStringify(enabled)
    );
}

export function toggleDepletionVisualization(): void {
    const currentEnabled: boolean = getDepletionVisualizationEnabled();
    const newEnabled: boolean = !currentEnabled;
    setDepletionVisualizationEnabled(newEnabled);
    updateDepletionToggleButton();

    // Force refresh of orderbook display to apply new setting
    if (orderBookChart && orderBookData) {
        updateOrderBookDisplay(orderBookData);
    }
}

export function updateDepletionToggleButton(): void {
    const depletionToggleBtn: HTMLElement | null =
        document.getElementById("depletionToggle");
    if (depletionToggleBtn) {
        const enabled: boolean = getDepletionVisualizationEnabled();
        depletionToggleBtn.textContent = enabled
            ? "📊 Depletion ON"
            : "📊 Depletion OFF";
        depletionToggleBtn.classList.toggle("active", enabled);
    }
}

// =============================================================================
// PLACEHOLDER FUNCTIONS (TO BE IMPLEMENTED)
// =============================================================================

// These functions are imported but not defined in this file
// They should be implemented in charts.ts when that file is fully converted
function updateOrderBookBarColors(theme: "light" | "dark"): void {
    // Placeholder - to be implemented in charts.ts
    console.log("updateOrderBookBarColors called with theme:", theme);
}

function scheduleOrderBookUpdate(): void {
    // Placeholder - to be implemented in charts.ts
    console.log("scheduleOrderBookUpdate called");
}

function updateOrderBookDisplay(data: OrderBookData): void {
    // Placeholder - to be implemented in charts.ts
    console.log("updateOrderBookDisplay called with data:", data);
}
