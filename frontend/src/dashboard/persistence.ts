import {
    activeRange,
    setActiveRange,
    anomalyFilters,
    setAnomalyFilters,
    tradesChart,
} from "./state.js";
import { triggerChartResize, setRange } from "./ui.js";
import { renderAnomalyList } from "./render.js";
import { applySystemTheme, updateThemeToggleButton } from "./theme.js";

// Type declarations for window extensions
declare global {
    interface Window {
        safeStringify?: (value: unknown) => string;
    }
}

/**
 * Save current column widths to localStorage
 */
export function saveColumnWidths(): void {
    try {
        const dashboard = document.querySelector(".dashboard");
        const dashboardRect = dashboard?.getBoundingClientRect();

        const column1 = document.getElementById("column1");
        const column3 = document.getElementById("column3");

        if (!dashboard || !column1 || !column3 || !dashboardRect) {
            console.warn("Dashboard or columns not found for saving widths");
            return;
        }

        const column1Rect = column1.getBoundingClientRect();
        const column3Rect = column3.getBoundingClientRect();

        const column1Percent = (column1Rect.width / dashboardRect.width) * 100;
        const column3Percent = (column3Rect.width / dashboardRect.width) * 100;

        const columnWidths = {
            column1: column1Percent,
            column3: column3Percent,
            timestamp: Date.now(),
        };

        // Use safe stringify to prevent potential recursion issues
        const safeStringify = (window as any).safeStringify || JSON.stringify;
        localStorage.setItem(
            "dashboardColumnWidths",
            safeStringify(columnWidths)
        );

        console.log("Column widths saved:", columnWidths);
    } catch (error) {
        console.warn("Failed to save column widths to localStorage:", error);
    }
}

/**
 * Save anomaly filter settings to localStorage
 */
export function saveAnomalyFilters(): void {
    try {
        const filterSettings = {
            filters: Array.from(anomalyFilters),
            timestamp: Date.now(),
        };

        // Use safe stringify to prevent potential recursion issues
        const safeStringify = (window as any).safeStringify || JSON.stringify;
        localStorage.setItem(
            "dashboardAnomalyFilters",
            safeStringify(filterSettings)
        );
        console.log("Anomaly filters saved:", filterSettings);
    } catch (error) {
        console.warn("Failed to save anomaly filters to localStorage:", error);
    }
}

/**
 * Restore anomaly filter settings from localStorage
 */
export function restoreAnomalyFilters(): void {
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
                    const checkboxElement = checkbox as HTMLInputElement;
                    checkboxElement.checked = anomalyFilters.has(
                        checkboxElement.value
                    );
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
export function saveTimeRange(): void {
    try {
        const rangeSettings = {
            activeRange: activeRange,
            timestamp: Date.now(),
        };

        // Use safe stringify to prevent potential recursion issues
        const safeStringify = (window as any).safeStringify || JSON.stringify;
        localStorage.setItem(
            "dashboardTimeRange",
            safeStringify(rangeSettings)
        );
        console.log("Time range saved:", rangeSettings);
    } catch (error) {
        console.warn("Failed to save time range to localStorage:", error);
    }
}

/**
 * Save vertical layout state to localStorage
 */
export function saveVerticalLayout(): void {
    try {
        const layoutSettings = {
            isVertical: document.body.classList.contains("vertical-layout"),
            timestamp: Date.now(),
        };
        // Use safe stringify to prevent potential recursion issues
        const safeStringify = (window as any).safeStringify || JSON.stringify;
        localStorage.setItem(
            "dashboardVerticalLayout",
            safeStringify(layoutSettings)
        );
        console.log("Vertical layout saved:", layoutSettings);
    } catch (error) {
        console.warn("Failed to save vertical layout to localStorage:", error);
    }
}

/**
 * Restore vertical layout state from localStorage
 */
export function restoreVerticalLayout(): void {
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

        // Trigger chart resize after restoration
        setTimeout(() => {
            triggerChartResize();
        }, 100);
    } catch (error) {
        console.warn(
            "Failed to restore vertical layout from localStorage:",
            error
        );
    }
}

/**
 * Restore time range setting from localStorage
 */
export function restoreTimeRange(): void {
    try {
        const savedRange = localStorage.getItem("dashboardTimeRange");

        if (!savedRange) {
            console.log(
                "No saved time range found, using default (90 minutes)"
            );
            return;
        }

        const rangeSettings = JSON.parse(savedRange);

        if (rangeSettings.activeRange === undefined) {
            console.warn("Invalid saved time range, using default");
            return;
        }

        // Update active range and apply to chart
        setActiveRange(rangeSettings.activeRange);

        // Update the UI to show the selected range
        const rangeSelector = document.querySelector(".rangeSelector");
        if (rangeSelector) {
            rangeSelector.querySelectorAll("button").forEach((button) => {
                const buttonRange = button.getAttribute("data-range");
                const buttonRangeValue =
                    buttonRange === "all"
                        ? null
                        : buttonRange
                          ? parseInt(buttonRange)
                          : null;

                if (buttonRangeValue === activeRange) {
                    button.classList.add("active");
                } else {
                    button.classList.remove("active");
                }
            });
        }

        console.log("Time range restored:", {
            range:
                activeRange === null ? "all" : `${activeRange / 60000} minutes`,
            savedAt: new Date(rangeSettings.timestamp).toLocaleString(),
        });

        // Apply the range to the chart if it exists
        if (tradesChart) {
            setRange(activeRange);
        }
    } catch (error) {
        console.warn("Failed to restore time range from localStorage:", error);
    }
}

/**
 * Restore column widths from localStorage
 */
export function restoreColumnWidths(): void {
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

            // Trigger chart resize after restoration
            setTimeout(() => {
                triggerChartResize();
            }, 100);
        }
    } catch (error) {
        console.warn(
            "Failed to restore column widths from localStorage:",
            error
        );
    }
}

/**
 * Reset column widths to default and clear localStorage
 */
function resetColumnWidths(): void {
    try {
        const column1 = document.getElementById("column1");
        const column3 = document.getElementById("column3");

        if (column1 && column3) {
            column1.style.flex = "0 0 25%";
            column3.style.flex = "0 0 15%";

            localStorage.removeItem("dashboardColumnWidths");

            setTimeout(() => {
                triggerChartResize();
            }, 100);

            console.log("Column widths reset to defaults");
        }
    } catch (error) {
        console.warn("Failed to reset column widths:", error);
    }
}

/**
 * Reset all dashboard settings to defaults
 */
export function resetAllSettings(): void {
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
                    const checkboxElement = checkbox as HTMLInputElement;
                    checkboxElement.checked = anomalyFilters.has(
                        checkboxElement.value
                    );
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
                    buttonRange === "all"
                        ? null
                        : buttonRange
                          ? parseInt(buttonRange)
                          : null;

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
        setTimeout(() => {
            triggerChartResize();
        }, 100);

        console.log("All dashboard settings reset to defaults");
    } catch (error) {
        console.warn("Failed to reset all settings:", error);
    }
}
