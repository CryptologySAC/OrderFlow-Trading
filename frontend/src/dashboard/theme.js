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





// Depletion visualization toggle functions
export function getDepletionVisualizationEnabled() {
    const saved = localStorage.getItem("depletionVisualizationEnabled");
    return saved !== null ? JSON.parse(saved) : true; // Default to enabled
}

export function setDepletionVisualizationEnabled(enabled) {
    localStorage.setItem(
        "depletionVisualizationEnabled",
        JSON.stringify(enabled)
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
