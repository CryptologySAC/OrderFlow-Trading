import {
    orderBookChart,
    orderBookData,
} from "./state.js";
import {
    updateOrderBookDisplay,
} from "./charts.js";







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
