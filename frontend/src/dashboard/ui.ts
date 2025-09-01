// UI interaction and layout management for the trading dashboard
// Converted from JavaScript to TypeScript with strict type checking

import type { Trade, RSIDataPoint, InteractEvent } from "../frontend-types.js";
import {
    tradesChart,
    orderBookChart,
    rsiChart,
    trades,
    rsiData,
    setActiveRange,
    PADDING_TIME,
    //GRID_SIZE,
    //ITEM_MARGIN,
} from "./state.js";

// =============================================================================
// LAYOUT AND SNAPPING UTILITIES
// =============================================================================
/*
function snap(value: number): number {
    return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

interface Rectangle {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

/*
function rectsOverlap(r1: Rectangle, r2: Rectangle): boolean {
    return !(
        r1.right <= r2.left ||
        r1.left >= r2.right ||
        r1.bottom <= r2.top ||
        r1.top >= r2.bottom
    );
}

/*
function isOverlapping(target: HTMLElement): boolean {
    const rect: Rectangle = target.getBoundingClientRect();
    const elements: NodeListOf<Element> = document.querySelectorAll(
        ".chart-container, .anomaly-list-container, .gauge-container"
    );
    const others: HTMLElement[] = Array.from(elements).filter(
        (el: Element): el is HTMLElement =>
            el !== target && el instanceof HTMLElement
    ) as HTMLElement[];

    return others.some((el: HTMLElement) => {
        const r: Rectangle = el.getBoundingClientRect();
        return !(
            rect.right + ITEM_MARGIN <= r.left ||
            rect.left >= r.right + ITEM_MARGIN ||
            rect.bottom + ITEM_MARGIN <= r.top ||
            rect.top >= r.bottom + ITEM_MARGIN
        );
    });
}

interface Position {
    x: number;
    y: number;
}

/*
function snapToOthers(
    x: number,
    y: number,
    width: number,
    height: number,
    target: HTMLElement
): Position {
    const elements: NodeListOf<Element> = document.querySelectorAll(
        ".chart-container, .anomaly-list-container, .gauge-container"
    );
    const others: HTMLElement[] = Array.from(elements).filter(
        (el: Element): el is HTMLElement =>
            el !== target && el instanceof HTMLElement
    ) as HTMLElement[];

    for (const el of others) {
        const r: Rectangle = el.getBoundingClientRect();
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
*/
/*
function adjustLayout(movedEl: HTMLElement): void {
    const elements: HTMLElement[] = Array.from(
        document.querySelectorAll(
            ".chart-container, .anomaly-list-container, .gauge-container"
        )
    ) as HTMLElement[];

    const queue: HTMLElement[] = [movedEl];
    const handled: Set<HTMLElement> = new Set();

    while (queue.length) {
        const el: HTMLElement = queue.shift()!;
        handled.add(el);
        const rect: Rectangle = el.getBoundingClientRect();

        for (const other of elements) {
            if (other === el) continue;
            const oRect: Rectangle = other.getBoundingClientRect();
            if (!rectsOverlap(rect, oRect)) continue;

            let x: number = parseFloat(other.getAttribute("data-x") || "0");
            let y: number = parseFloat(other.getAttribute("data-y") || "0");

            const moveRight: number = rect.right + ITEM_MARGIN - oRect.left;
            const moveLeft: number = oRect.right - rect.left + ITEM_MARGIN;
            const moveDown: number = rect.bottom + ITEM_MARGIN - oRect.top;
            const moveUp: number = oRect.bottom - rect.top + ITEM_MARGIN;

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
            other.setAttribute("data-x", x.toString());
            other.setAttribute("data-y", y.toString());

            if (!handled.has(other)) queue.push(other);
        }
    }
}
    */

//let layoutAdjustScheduled: boolean = false;

/*
function scheduleLayoutAdjust(target: HTMLElement): void {
    if (!layoutAdjustScheduled) {
        layoutAdjustScheduled = true;
        requestAnimationFrame(() => {
            adjustLayout(target);
            layoutAdjustScheduled = false;
        });
    }
}
    */

// =============================================================================
// TIME RANGE MANAGEMENT
// =============================================================================

/**
 * Sets the time range for the trades chart.
 * @param duration - Duration in milliseconds, or null for all data.
 */
export function setRange(duration: number | null): void {
    setActiveRange(duration);

    // Use EXACT same timestamp for both charts to ensure perfect synchronization
    const now: number = Date.now();

    if (duration !== null) {
        // Calculate time range ONCE and use for both charts
        const minTime: number = now - duration;
        const maxTime: number = now + PADDING_TIME;

        console.log(
            `Setting IDENTICAL time range for both charts: ${new Date(minTime).toLocaleTimeString()} - ${new Date(maxTime).toLocaleTimeString()}`
        );

        // Update trades chart
        if (tradesChart) {
            tradesChart.options.scales.x.min = minTime;
            tradesChart.options.scales.x.max = maxTime;
            // Note: updateYAxisBounds() and updateTimeAnnotations() will be implemented in charts.ts
            tradesChart.update();
        }

        // Update RSI chart with EXACT same values
        if (rsiChart) {
            rsiChart.options.scales.x.min = minTime;
            rsiChart.options.scales.x.max = maxTime;
            // Note: updateRSITimeAnnotations() will be implemented in charts.ts
            rsiChart.update();
        }
    } else {
        // For "ALL" range, calculate based on available data
        let minTime: number = Infinity;
        let maxTime: number = -Infinity;

        // Check RSI data for time range
        if (rsiData && rsiData.length > 0) {
            rsiData.forEach((rsiPoint: RSIDataPoint) => {
                if (rsiPoint.time < minTime) minTime = rsiPoint.time;
                if (rsiPoint.time > maxTime) maxTime = rsiPoint.time;
            });
        }

        // Check trades data for time range
        if (trades && trades.length > 0) {
            trades.forEach((trade: Trade) => {
                if (trade.time < minTime) minTime = trade.time;
                if (trade.time > maxTime) maxTime = trade.time;
            });
        }

        // If we have data, use the calculated range
        if (minTime !== Infinity && maxTime !== -Infinity) {
            const timeRange: number = maxTime - minTime;
            const padding: number = Math.max(PADDING_TIME, timeRange * 0.05); // 5% padding or minimum PADDING_TIME

            if (tradesChart) {
                if (tradesChart.options.scales.x) {
                    tradesChart.options.scales.x.min = minTime - padding;
                    tradesChart.options.scales.x.max = maxTime + padding;
                }
                // Note: updateYAxisBounds() will be implemented in charts.ts
                tradesChart.update();
            }

            if (rsiChart) {
                if (rsiChart.options.scales.x) {
                    rsiChart.options.scales.x.min = minTime - padding;
                    rsiChart.options.scales.x.max = maxTime + padding;
                }
                // Note: updateRSITimeAnnotations() will be implemented in charts.ts
                rsiChart.update();
            }
        } else {
            // No data available, use undefined to let Chart.js auto-scale
            if (tradesChart && tradesChart.options.scales.x) {
                delete tradesChart.options.scales.x.min;
                delete tradesChart.options.scales.x.max;
                // Note: updateYAxisBounds() will be implemented in charts.ts
                tradesChart.update();
            }

            if (rsiChart && rsiChart.options.scales.x) {
                delete rsiChart.options.scales.x.min;
                delete rsiChart.options.scales.x.max;
                rsiChart.update();
            }
        }
    }

    // Note: saveTimeRange() will be implemented in persistence.ts
}

// =============================================================================
// COLUMN RESIZING
// =============================================================================

/**
 * Sets up column resizing capabilities using interact.js with localStorage persistence.
 * Elements are no longer draggable or individually resizable - only column width resizing is allowed.
 */
export function setupColumnResizing(): void {
    if (typeof (window as any).interact === "undefined") {
        console.error("Interact.js not loaded");
        return;
    }

    // Setup column resizing functionality
    (window as any).interact(".resize-handle").draggable({
        axis: "x",
        listeners: {
            move(event: InteractEvent) {
                const handle: HTMLElement = event.target;
                const handleId: string = handle.id;
                const dashboard: Element | null =
                    document.querySelector(".dashboard");

                if (!dashboard) return;

                const dashboardRect: DOMRect =
                    dashboard.getBoundingClientRect();

                if (handleId === "resize1") {
                    // Resizing between column 1 and column 2
                    const column1: HTMLElement | null =
                        document.getElementById("column1");
                    if (!column1) return;

                    const column1Rect: DOMRect =
                        column1.getBoundingClientRect();

                    const newWidth: number = Math.min(
                        Math.max(column1Rect.width + event.dx, 200),
                        dashboardRect.width * 0.5
                    );
                    const newPercent: number =
                        (newWidth / dashboardRect.width) * 100;

                    column1.style.flex = `0 0 ${newPercent}%`;
                } else if (handleId === "resize2") {
                    // Resizing between column 2 and column 3
                    const column3: HTMLElement | null =
                        document.getElementById("column3");
                    if (!column3) return;

                    const column3Rect: DOMRect =
                        column3.getBoundingClientRect();

                    const newWidth: number = Math.min(
                        Math.max(column3Rect.width - event.dx, 150),
                        dashboardRect.width * 0.3
                    );
                    const newPercent: number =
                        (newWidth / dashboardRect.width) * 100;

                    column3.style.flex = `0 0 ${newPercent}%`;
                }

                // Debounced chart resize and save
                clearTimeout((window as any).resizeTimeout);
                (window as any).resizeTimeout = setTimeout(() => {
                    triggerChartResize();
                    // Note: saveColumnWidths() will be implemented in persistence.ts
                }, 100);
            },
            end(event: InteractEvent) {
                // Note: saveColumnWidths() will be implemented in persistence.ts
                void event;
            },
        },
    });
}

export function triggerChartResize(): void {
    // Trigger chart resize after column resize
    if (tradesChart) tradesChart.resize();
    if (orderBookChart) orderBookChart.resize();
    if (rsiChart) rsiChart.resize();
}
