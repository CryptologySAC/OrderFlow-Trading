import {
    activeRange,
} from "./state.js";
import {
    applySystemTheme,
    updateThemeToggleButton,
} from "./theme.js";

/**
 * Save current column widths to localStorage
 */
/**
 * Save anomaly filter settings to localStorage
 */




/**
 * Save current time range setting to localStorage
 */
export function saveTimeRange() {
    try {
        const rangeSettings = {
            activeRange: activeRange,
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

/**
 * Save vertical layout state to localStorage
 */
export function saveVerticalLayout() {
    try {
        const layoutSettings = {
            isVertical: document.body.classList.contains("vertical-layout"),
            timestamp: Date.now(),
        };
        localStorage.setItem(
            "dashboardVerticalLayout",
            JSON.stringify(layoutSettings)
        );
        console.log("Vertical layout saved:", layoutSettings);
    } catch (error) {
        console.warn("Failed to save vertical layout to localStorage:", error);
    }
}

/**
 * Restore vertical layout state from localStorage
 */




/**
 * Reset column widths to default and clear localStorage
 */
 

/**
 * Reset all dashboard settings to defaults
 */
