import {
    tradesChart,
    orderBookChart,
    rsiChart,
    activeRange,
    setActiveRange,
    GRID_SIZE,
    ITEM_MARGIN,
} from "./state.js";
import { saveColumnWidths, saveTimeRange } from "./persistence.js";

function snap(value) {
    return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function rectsOverlap(r1, r2) {
    return !(
        r1.right <= r2.left ||
        r1.left >= r2.right ||
        r1.bottom <= r2.top ||
        r1.top >= r2.bottom
    );
}

function isOverlapping(target) {
    const rect = target.getBoundingClientRect();
    const others = Array.from(
        document.querySelectorAll(
            ".chart-container, .anomaly-list-container, .gauge-container"
        )
    ).filter((el) => el !== target);
    return others.some((el) => {
        const r = el.getBoundingClientRect();
        return !(
            rect.right + ITEM_MARGIN <= r.left ||
            rect.left >= r.right + ITEM_MARGIN ||
            rect.bottom + ITEM_MARGIN <= r.top ||
            rect.top >= r.bottom + ITEM_MARGIN
        );
    });
}

function snapToOthers(x, y, width, height, target) {
    const others = Array.from(
        document.querySelectorAll(
            ".chart-container, .anomaly-list-container, .gauge-container"
        )
    ).filter((el) => el !== target);
    for (const el of others) {
        const r = el.getBoundingClientRect();
        if (Math.abs(x - (r.right + ITEM_MARGIN)) <= ITEM_MARGIN) {
            x = r.right + ITEM_MARGIN;
        }
        if (Math.abs(x + width + ITEM_MARGIN - r.left) <= ITEM_MARGIN) {
            x = r.left - width - ITEM_MARGIN;
        }
        if (Math.abs(y - (r.bottom + ITEM_MARGIN)) <= ITEM_MARGIN) {
            y = r.bottom + ITEM_MARGIN;
        }
        if (Math.abs(y + height + ITEM_MARGIN - r.top) <= ITEM_MARGIN) {
            y = r.top - height - ITEM_MARGIN;
        }
    }
    return { x, y };
}

function adjustLayout(movedEl) {
    const elements = Array.from(
        document.querySelectorAll(
            ".chart-container, .anomaly-list-container, .gauge-container"
        )
    );

    const queue = [movedEl];
    const handled = new Set();

    while (queue.length) {
        const el = queue.shift();
        handled.add(el);
        const rect = el.getBoundingClientRect();
        for (const other of elements) {
            if (other === el) continue;
            const oRect = other.getBoundingClientRect();
            if (!rectsOverlap(rect, oRect)) continue;

            let x = parseFloat(other.getAttribute("data-x")) || 0;
            let y = parseFloat(other.getAttribute("data-y")) || 0;

            const moveRight = rect.right + ITEM_MARGIN - oRect.left;
            const moveLeft = oRect.right - rect.left + ITEM_MARGIN;
            const moveDown = rect.bottom + ITEM_MARGIN - oRect.top;
            const moveUp = oRect.bottom - rect.top + ITEM_MARGIN;

            if (Math.abs(moveRight) < Math.abs(moveDown)) {
                if (oRect.left >= rect.left) x += moveRight;
                else x -= moveLeft;
            } else {
                if (oRect.top >= rect.top) y += moveDown;
                else y -= moveUp;
            }

            x = snap(x);
            y = snap(y);
            ({ x, y } = snapToOthers(
                x,
                y,
                other.offsetWidth,
                other.offsetHeight,
                other
            ));
            other.style.transform = `translate(${x}px, ${y}px)`;
            other.setAttribute("data-x", x);
            other.setAttribute("data-y", y);

            if (!handled.has(other)) queue.push(other);
        }
    }
}

let layoutAdjustScheduled = false;
function scheduleLayoutAdjust(target) {
    if (!layoutAdjustScheduled) {
        layoutAdjustScheduled = true;
        requestAnimationFrame(() => {
            adjustLayout(target);
            layoutAdjustScheduled = false;
        });
    }
}

/**
 * Sets the time range for the trades chart.
 * @param {number|null} duration - Duration in milliseconds, or null for all data.
 */
export function setRange(duration) {
    // Apply the restored time range to the charts AFTER initialization
        console.log(
            "Applying time range after chart initialization:",
            activeRange === null ? "ALL" : `${activeRange / 60000} minutes`
        );
    setActiveRange(duration);

    // Save the new time range setting
    saveTimeRange();
}

/**
 * Sets up column resizing capabilities using interact.js with localStorage persistence.
 * Elements are no longer draggable or individually resizable - only column width resizing is allowed.
 */
export function setupColumnResizing() {
    if (typeof interact === "undefined") {
        console.error("Interact.js not loaded");
        return;
    }

    // Setup column resizing functionality
    interact(".resize-handle").draggable({
        axis: "x",
        listeners: {
            move(event) {
                const handle = event.target;
                const handleId = handle.id;
                const dashboard = document.querySelector(".dashboard");
                const dashboardRect = dashboard.getBoundingClientRect();

                if (handleId === "resize1") {
                    // Resizing between column 1 and column 2
                    const column1 = document.getElementById("column1");
                    const column1Rect = column1.getBoundingClientRect();

                    const newWidth = Math.min(
                        Math.max(column1Rect.width + event.dx, 200),
                        dashboardRect.width * 0.5
                    );
                    const newPercent = (newWidth / dashboardRect.width) * 100;

                    column1.style.flex = `0 0 ${newPercent}%`;
                } else if (handleId === "resize2") {
                    // Resizing between column 2 and column 3
                    const column3 = document.getElementById("column3");
                    const column3Rect = column3.getBoundingClientRect();

                    const newWidth = Math.min(
                        Math.max(column3Rect.width - event.dx, 150),
                        dashboardRect.width * 0.3
                    );
                    const newPercent = (newWidth / dashboardRect.width) * 100;

                    column3.style.flex = `0 0 ${newPercent}%`;
                }

                // Debounced chart resize and save
                clearTimeout(window.resizeTimeout);
                window.resizeTimeout = setTimeout(() => {
                    triggerChartResize();
                    saveColumnWidths();
                }, 100);
            },
            end(event) {
                // Save column widths immediately when resize ends
                saveColumnWidths();
            },
        },
    });
}

export function triggerChartResize() {
    // Trigger chart resize after column resize
    if (tradesChart) tradesChart.resize();
    if (orderBookChart) orderBookChart.resize();
    if (rsiChart) rsiChart.resize();
}
