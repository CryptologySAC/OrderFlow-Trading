import {
    activeRange,
    setActiveRange,
    anomalyFilters,
    setAnomalyFilters,
} from "./state.js";
import { renderAnomalyList } from "./render.js";
import {
    applySystemTheme,
    updateThemeToggleButton,
    saveTheme,
} from "./theme.js";

/**
 * Save current column widths to localStorage
 */
export function saveColumnWidths() {
    try {
        const dashboard = document.querySelector(".dashboard");
        const dashboardRect = dashboard.getBoundingClientRect();

        const column1 = document.getElementById("column1");
        const column3 = document.getElementById("column3");

        const column1Rect = column1.getBoundingClientRect();
        const column3Rect = column3.getBoundingClientRect();

        const column1Percent = (column1Rect.width / dashboardRect.width) * 100;
        const column3Percent = (column3Rect.width / dashboardRect.width) * 100;

        const columnWidths = {
            column1: column1Percent,
            column3: column3Percent,
            timestamp: Date.now(),
        };

        localStorage.setItem(
            "dashboardColumnWidths",
            JSON.stringify(columnWidths)
        );

        console.log("Column widths saved:", columnWidths);
    } catch (error) {
        console.warn("Failed to save column widths to localStorage:", error);
    }
}

/**
 * Save anomaly filter settings to localStorage
 */
export function saveAnomalyFilters() {
    try {
        const filterSettings = {
            filters: Array.from(anomalyFilters),
            timestamp: Date.now(),
        };

        localStorage.setItem(
            "dashboardAnomalyFilters",
            JSON.stringify(filterSettings)
        );
        console.log("Anomaly filters saved:", filterSettings);
    } catch (error) {
        console.warn("Failed to save anomaly filters to localStorage:", error);
    }
}

/**
 * Restore anomaly filter settings from localStorage
 */
export function restoreAnomalyFilters() {
    try {
        const savedFilters = localStorage.getItem("dashboardAnomalyFilters");

        if (!savedFilters) {
            console.log("No saved anomaly filters found, using defaults");
            return;
        }

        const filterSettings = JSON.parse(savedFilters);

        if (!filterSettings.filters || !Array.isArray(filterSettings.filters)) {
            console.warn("Invalid saved anomaly filters, using defaults");
            return;
        }

        // Update the anomaly filters set
        setAnomalyFilters(new Set(filterSettings.filters));

        // Update the UI checkboxes
        const filterBox = document.querySelector(".anomaly-filter");
        if (filterBox) {
            filterBox
                .querySelectorAll("input[type=checkbox]")
                .forEach((checkbox) => {
                    checkbox.checked = anomalyFilters.has(checkbox.value);
                });
        }

        console.log("Anomaly filters restored:", {
            filters: filterSettings.filters,
            savedAt: new Date(filterSettings.timestamp).toLocaleString(),
        });

        // Re-render the anomaly list with restored filters
        renderAnomalyList();
    } catch (error) {
        console.warn(
            "Failed to restore anomaly filters from localStorage:",
            error
        );
    }
}

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
export function restoreVerticalLayout() {
    try {
        const savedLayout = localStorage.getItem("dashboardVerticalLayout");

        if (!savedLayout) {
            console.log("No saved vertical layout found, using default.");
            return;
        }

        const layoutSettings = JSON.parse(savedLayout);

        if (layoutSettings.isVertical) {
            document.body.classList.add("vertical-layout");
        } else {
            document.body.classList.remove("vertical-layout");
        }

        console.log("Vertical layout restored:", {
            isVertical: layoutSettings.isVertical,
            savedAt: new Date(layoutSettings.timestamp).toLocaleString(),
        });

    } catch (error) {
        console.warn(
            "Failed to restore vertical layout from localStorage:",
            error
        );
    }
}



/**
 * Reset column widths to default and clear localStorage
 */
function resetColumnWidths() {
    try {
        const column1 = document.getElementById("column1");
        const column3 = document.getElementById("column3");

        if (column1 && column3) {
            column1.style.flex = "0 0 25%";
            column3.style.flex = "0 0 15%";

            localStorage.removeItem("dashboardColumnWidths");

            

            console.log("Column widths reset to defaults");
        }
    } catch (error) {
        console.warn("Failed to reset column widths:", error);
    }
}

/**
 * Reset all dashboard settings to defaults
 */
export function resetAllSettings() {
    try {
        // Reset column widths
        resetColumnWidths();

        // Reset anomaly filters to default (critical and high)
        setAnomalyFilters(new Set(["critical", "high"]));
        localStorage.removeItem("dashboardAnomalyFilters");

        // Update UI checkboxes
        const filterBox = document.querySelector(".anomaly-filter");
        if (filterBox) {
            filterBox
                .querySelectorAll("input[type=checkbox]")
                .forEach((checkbox) => {
                    checkbox.checked = anomalyFilters.has(checkbox.value);
                });
        }
        renderAnomalyList();

        // Reset time range to default (90 minutes)
        setActiveRange(90 * 60000);
        localStorage.removeItem("dashboardTimeRange");

        // Update UI range selector
        const rangeSelector = document.querySelector(".rangeSelector");
        if (rangeSelector) {
            rangeSelector.querySelectorAll("button").forEach((button) => {
                const buttonRange = button.getAttribute("data-range");
                const buttonRangeValue =
                    buttonRange === "all" ? null : parseInt(buttonRange);

                if (buttonRangeValue === activeRange) {
                    button.classList.add("active");
                } else {
                    button.classList.remove("active");
                }
            });
        }

        // Reset theme to system default
        localStorage.removeItem("dashboardTheme");
        applySystemTheme();
        updateThemeToggleButton();

        // Apply to chart
        if (tradesChart) {
            setRange(activeRange);
        }

        // Reset vertical layout
        localStorage.removeItem("dashboardVerticalLayout");
        document.body.classList.remove("vertical-layout");
       

        console.log("All dashboard settings reset to defaults");
    } catch (error) {
        console.warn("Failed to reset all settings:", error);
    }
}
