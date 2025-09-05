import {
    maxSupportResistanceLevels,
    activeZones,
    maxActiveZones,
    signalsList,
} from "./state.js";
import { renderSignalsList } from "./render.js";

import type {
    Signal,
    SupportResistanceLevel,
    ZoneData,
} from "../frontend-types.js";

import { Chart, ChartEvent, registerables } from "chart.js";
import annotationPlugin from "chartjs-plugin-annotation"; //PartialEventContext, //    EventContext,

import zoomPlugin from "chartjs-plugin-zoom";
import "chartjs-adapter-date-fns";

Chart.register(...registerables, zoomPlugin, annotationPlugin);

// Define zone types locally
type ZoneUpdateType =
    | "zone_created"
    | "zone_updated"
    | "zone_strengthened"
    | "zone_weakened"
    | "zone_completed"
    | "zone_invalidated";
type ZoneSignalType = "completion" | "invalidation" | "consumption";

// Magic number constants
const MAX_LABEL_LENGTH = 250;
const TRUNCATED_LABEL_LENGTH = 245;

// Zone calculation constants
//const ZONE_ALPHA_MIN = 0.2;
//const ZONE_ALPHA_MAX = 0.5;
//const ZONE_DURATION_MAX_HOURS = 4;
//const ZONE_DURATION_MAX_MS = ZONE_DURATION_MAX_HOURS * 60 * 60 * 1000;
const ZONE_BASE_THICKNESS_PERCENT = 0.0008; // 0.08%
const ZONE_STRENGTH_MULTIPLIER_BASE = 1;
const ZONE_TOUCH_MULTIPLIER_MAX = 1;
const ZONE_TOUCH_COUNT_NORMALIZER = 10;
//const ZONE_ALPHA_MULTIPLIER = 1.5;
//const ZONE_ALPHA_MULTIPLIER_MAX = 0.8;

// Breach threshold constants
const BREACH_THRESHOLD_MULTIPLIER = 2;

// Cleanup time constants
const CLEANUP_TIME_HOURS = 2;
const CLEANUP_TIME_MS = CLEANUP_TIME_HOURS * 60 * 60 * 1000;

// Zone color constants
const ZONE_ALPHA_MIN_PERCENT = 0.15;
const ZONE_ALPHA_MAX_PERCENT = 0.4;

// Module-level variables with proper types
let supportResistanceLevels: SupportResistanceLevel[] = [];

// Global reference for RSI canvas (used in safeUpdateRSIChart)
declare const rsiCanvas: HTMLCanvasElement | undefined;

/**
 * Build a label string for orderflow signals for chart annotations.
 */
export function buildSignalLabel(signal: Signal): string {
    if (!signal) return "Invalid Signal";

    // 1. Main signal summary (type/side/price/time)
    let label: string = `[${signal.type?.toUpperCase() ?? "?"}] ${signal.side?.toUpperCase() ?? "?"} @ ${signal.price?.toFixed(2) ?? "?"}`;

    // 2. Confidence/Confirmations
    if (signal.confidence !== undefined) {
        label += `\nConf: ${(signal.confidence * 100).toFixed(0)}%`;
    }

    // Optional: truncate if label is too long for chart
    if (label.length > MAX_LABEL_LENGTH)
        label = label.slice(0, TRUNCATED_LABEL_LENGTH) + "...";

    return label;
}

/**
 * Safely updates RSI chart with error recovery
 *v/
export function safeUpdateRSIChart(rsiData: RSIDataPoint[]): boolean {
    if (!rsiChart) {
        console.warn(
            "RSI chart not initialized, attempting to reinitialize..."
        );
        const rsiCtx: CanvasRenderingContext2D | null =
            rsiCanvas?.getContext("2d") || null;
        if (rsiCtx) {
            const newChart: ChartInstance | null = initializeRSIChart(rsiCtx);
            if (!newChart) {
                console.error("Failed to reinitialize RSI chart");
                return false;
            }
        } else {
            console.error(
                "Cannot reinitialize RSI chart - canvas context unavailable"
            );
            return false;
        }
    }

    if (
        rsiChart &&
        rsiChart.data &&
        rsiChart.data.datasets &&
        rsiChart.data.datasets[0]
    ) {
        // Update data directly (backlog loading handles data replacement)
        rsiChart.data.datasets[0].data = rsiData as unknown as ChartDataPoint[];

        // Update chart
        rsiChart.update("none");
        return true;
    }

    console.error("Failed to update RSI chart - chart structure invalid");
    return false;
}















export function addAnomalyChartLabel(anomaly: Anomaly): void {
    void anomaly;
    //const now: number = anomaly.timestamp || anomaly.detectedAt || Date.now();
    //if (!tradesChart.options.plugins) tradesChart.options.plugins = {};
    //if (!tradesChart.options.plugins.annotation) {
    //    tradesChart.options.plugins.annotation = { annotations: {} };
    //}
    //const annotations = tradesChart.options.plugins.annotation.annotations;
    //if (annotations === undefined) {
    //    throw new Error("annotations is undefined.");
    //}

    /*
    (annotations as any)[`anomaly.${now}`] = {
        type: "label",
        xValue: anomaly.timestamp ?? anomaly.detectedAt ?? now,
        yValue: anomaly.price ?? 0,
        content: `${getAnomalyIcon(anomaly.type)}`,
        backgroundColor:
            anomaly.severity === "critical"
                ? "rgba(229,57,53,0.8)"
                : anomaly.severity === "high"
                  ? "rgba(255,179,0,0.85)"
                  : anomaly.severity === "medium"
                    ? "rgba(255,241,118,0.5)"
                    : "rgba(33,150,243,0.5)",
        color: "#fff",
        font: { size: 18, weight: "bold" },
        padding: 6,
        borderRadius: 6,
    };
    */
//tradesChart.update("none");

/**
 * Handle incoming support/resistance level data
 */
export function handleSupportResistanceLevel(levelData: {
    data: SupportResistanceLevel;
}): void {
    //if (!tradesChart || !levelData.data) return;

    const level: SupportResistanceLevel = levelData.data;

    // Add to levels array
    supportResistanceLevels.unshift(level);

    // Limit the number of levels to prevent chart clutter
    if (supportResistanceLevels.length > maxSupportResistanceLevels) {
        // Remove oldest level from chart
        const oldestLevel: SupportResistanceLevel =
            supportResistanceLevels.pop()!;
        removeSupportResistanceLevel(oldestLevel.id);
    }

    // Add level to chart
    //addSupportResistanceToChart(level);

    console.log("Support/Resistance level added to chart:", {
        id: level.id,
        price: level.price,
        type: level.type,
        strength: level.strength,
        touchCount: level.touchCount,
    });
}

/**
 * Add support/resistance level as translucent bar on chart
 * /
function addSupportResistanceToChart(level: SupportResistanceLevel): void {
    if (!tradesChart) return;

    if (!tradesChart.options.plugins) tradesChart.options.plugins = {};
    if (!tradesChart.options.plugins.annotation) {
        tradesChart.options.plugins.annotation = { annotations: {} };
    }
    const annotations = tradesChart.options.plugins.annotation.annotations;
    if (annotations === undefined) {
        throw new Error("annotations is undefined.");
    }
    //const levelId: string = `sr_level_${level.id}`;

    // Determine color based on type and strength
    //const isSupport: boolean = level.type === "support";
    //const baseColor: string = isSupport ? "34, 197, 94" : "239, 68, 68"; // Green for support, red for resistance
    /*
    const alpha: number = Math.max(
        ZONE_ALPHA_MIN,
        Math.min(ZONE_ALPHA_MAX, level.strength)
    ); // Opacity based on strength

    // Calculate time boundaries for the zone
    //const now: number = Date.now();
    const startTime: number = level.firstDetected;
    // Zone is valid until crossed or for a maximum duration
    //const maxValidDuration: number = ZONE_DURATION_MAX_MS; // 4 hours maximum

    /*
    const endTime: number = Math.min(
        now + maxValidDuration,
        level.lastTouched + maxValidDuration
    );

    // Create price tolerance for zone height - make it proportional to strength and touch count
    /*
    const baseThickness: number = level.price * ZONE_BASE_THICKNESS_PERCENT; // 0.08% base thickness
    const strengthMultiplier: number =
        ZONE_STRENGTH_MULTIPLIER_BASE + level.strength * 2; // 1x to 3x based on strength
    const touchMultiplier: number =
        ZONE_STRENGTH_MULTIPLIER_BASE +
        Math.min(
            level.touchCount / ZONE_TOUCH_COUNT_NORMALIZER,
            ZONE_TOUCH_MULTIPLIER_MAX
        ); // Additional thickness for more touches
    //const zoneHeight: number =
    //    baseThickness * strengthMultiplier * touchMultiplier;

    // Add the time-bounded zone box
    /* 
    const annotation: AnnotationOptions<"box"> = {
        type: "box",
        xMin: startTime,
        xMax: endTime,
        yMin: level.price - zoneHeight / 2,
        yMax: level.price + zoneHeight / 2,
        backgroundColor: `rgba(${baseColor}, ${alpha})`,
        borderColor: `rgba(${baseColor}, ${Math.min(alpha * ZONE_ALPHA_MULTIPLIER, ZONE_ALPHA_MULTIPLIER_MAX)})`,
        borderWidth: 1,
        drawTime: "beforeDatasetsDraw",
        z: 1,
    };

    // Only add borderDash if it has a value
    if (level.roleReversals?.length) {
        annotation.borderDash = [5, 5];
    }

    (annotations as any)[levelId] = annotation as any;
    * /

    // Add a label for the level - positioned at the start of the zone
    const labelId: string = `sr_label_${level.id}`;
    (annotations as any)[labelId] = {
        type: "label",
        xValue: startTime,
        yValue: level.price,
        content: `${isSupport ? "SUPPORT" : "RESISTANCE"} ${level.price.toFixed(2)}`,
        backgroundColor: `rgba(${baseColor}, ${COLOR_ALPHA_MAX})`,
        color: "white",
        font: {
            size: 9,
            weight: "bold",
            family: "monospace",
        },
        padding: 3,
        borderRadius: 3,
        position: {
            x: "start",
            y: "center",
        },
        xAdjust: 5,
        drawTime: "afterDatasetsDraw",
        z: 5,
    };
    tradesChart.update("none");
}

/**
 * Remove support/resistance level from chart
 */
function removeSupportResistanceLevel(levelId: string): void {
    //if (!tradesChart) return;

    void levelId;
    //const annotations = tradesChart.options.plugins?.annotation?.annotations;
    //if (!annotations) return;

    //const barId: string = `sr_level_${levelId}`;
    //const labelId: string = `sr_label_${levelId}`;

    //delete (annotations as any)[barId];
    //delete (annotations as any)[labelId];

    //tradesChart.update("none");
}

/**
 * Check if a trade price breaches any support/resistance zones and invalidate them
 */
export function checkSupportResistanceBreaches(tradePrice: number): void {
    if (!supportResistanceLevels.length) return;

    supportResistanceLevels = supportResistanceLevels.filter(
        (level: SupportResistanceLevel) => {
            // Calculate breach threshold - zone is breached if price moves significantly beyond it
            const zoneHeight: number =
                level.price *
                ZONE_BASE_THICKNESS_PERCENT *
                (ZONE_STRENGTH_MULTIPLIER_BASE + level.strength * 2) *
                (ZONE_STRENGTH_MULTIPLIER_BASE +
                    Math.min(
                        level.touchCount / ZONE_TOUCH_COUNT_NORMALIZER,
                        ZONE_TOUCH_MULTIPLIER_MAX
                    ));
            const breachThreshold: number =
                zoneHeight * BREACH_THRESHOLD_MULTIPLIER; // Breach if price moves 2x zone height beyond level

            let isBreached: boolean = false;

            if (level.type === "support") {
                // Support is breached if price falls significantly below it
                isBreached = tradePrice < level.price - breachThreshold;
            } else {
                // Resistance is breached if price rises significantly above it
                isBreached = tradePrice > level.price + breachThreshold;
            }

            if (isBreached) {
                console.log(`${level.type.toUpperCase()} level breached:`, {
                    levelPrice: level.price,
                    tradePrice: tradePrice,
                    threshold: breachThreshold,
                    levelId: level.id,
                });

                removeSupportResistanceLevel(level.id);
                return false; // Remove from array
            }

            return true; // Keep in array
        }
    );
}

/**
 * Clean up old support/resistance levels based on time
 */
export function cleanupOldSupportResistanceLevels(): void {
    const cutoffTime: number = Date.now() - CLEANUP_TIME_MS; // 2 hours

    supportResistanceLevels = supportResistanceLevels.filter(
        (level: SupportResistanceLevel) => {
            if (level.lastTouched < cutoffTime) {
                removeSupportResistanceLevel(level.id);
                return false;
            }
            return true;
        }
    );
}

/**
 * Zone Management Functions
 * Handle accumulation/distribution zones as visual boxes on the chart
 */

/**
 * Handle zone update messages from WebSocket
 */
export function handleZoneUpdate(updateData: {
    updateType: ZoneUpdateType;
    zone: ZoneData;
    significance: number;
}): void {
    const { updateType, zone } = updateData;

    switch (updateType) {
        case "zone_created":
            createZoneBox(zone);
            break;
        case "zone_updated":
        case "zone_strengthened":
        case "zone_weakened":
            updateZoneBox(zone);
            break;
        case "zone_completed":
            completeZoneBox(zone);
            break;
        case "zone_invalidated":
            removeZoneBox(zone.id);
            break;
    }
}

/**
 * Handle zone signal messages - add to signals list
 */
export function handleZoneSignal(signalData: {
    signalType: ZoneSignalType;
    zone: ZoneData;
    actionType: string;
    confidence: number;
    urgency: string;
    expectedDirection: "up" | "down";
    stopLossLevel?: number;
    takeProfitLevel?: number;
    positionSizing?: number;
}): void {
    const { zone, confidence, expectedDirection } = signalData;

    // Filter out accumulation and distribution zone signals from signals list
    // These zones are drawn via zoneUpdate messages, but signals shouldn't appear in the list
    if (zone.type === "accumulation" || zone.type === "distribution") {
        console.log(
            `${zone.type} zone signal filtered out - zones draw but signals don't show`,
            zone.id
        );
        return;
    }

    // Create a normalized signal for the signals list
    const normalizedSignal: Signal = {
        id: `zone_${zone.id}_${Date.now()}`,
        type: `${zone.type}_zone_${signalData.signalType}`,
        price:
            zone.priceRange.center ??
            (zone.priceRange.min + zone.priceRange.max) / 2,
        time: Date.now(),
        side:
            expectedDirection === "up"
                ? "buy"
                : expectedDirection === "down"
                  ? "sell"
                  : "buy",
        confidence: confidence,
        zone: zone,
    };

    // Add to signals list
    signalsList.unshift(normalizedSignal);
    if (signalsList.length > 50) {
        signalsList.splice(50);
    }
    renderSignalsList();
}

/**
 * Create a zone box on the chart
 */
function createZoneBox(zone: ZoneData): void {
    // Store zone data
    (activeZones as Map<string, ZoneData>).set(zone.id, zone);

    // Limit number of active zones
    if ((activeZones as Map<string, ZoneData>).size > maxActiveZones) {
        const oldestZoneId: string =
            (activeZones as Map<string, ZoneData>).keys().next().value ?? "";
        removeZoneBox(oldestZoneId);
    }

    // Add zone box to chart
    //addZoneToChart(zone);
}

/**
 * Update an existing zone box
 */
function updateZoneBox(zone: ZoneData): void {
    (activeZones as Map<string, ZoneData>).set(zone.id, zone);

    /*
    // Update the chart annotation
    if (
        tradesChart &&
        tradesChart.options &&
        tradesChart.options.plugins &&
        tradesChart.options.plugins.annotation &&
        tradesChart.options.plugins.annotation.annotations
    ) {
        const annotation = tradesChart.options.plugins.annotation
            .annotations as Record<string, AnnotationOptions<"box">>;

        if (annotation && annotation[`zone_${zone.id}`]) {
            const annotations = annotation[
                `zone_${zone.id}`
            ] as AnnotationOptions<"box">;
            // Update zone properties
            if (zone.type === "hidden_liquidity" || zone.type === "iceberg") {
                const price: number =
                    zone.priceRange.center ??
                    (zone.priceRange.min + zone.priceRange.max) / 2;
                annotations.yMin = price;
                annotations.yMax = price;
                annotations.borderColor = getZoneBorderColor(zone);
                // Update end time for iceberg orders if zone has ended
                if (zone.type === "iceberg" && zone.endTime) {
                    annotations.xMax = zone.endTime;
                }
            } else {
                annotations.yMin = zone.priceRange.min;
                annotations.yMax = zone.priceRange.max;
                annotations.backgroundColor = getZoneColor(zone);
                annotations.borderColor = getZoneBorderColor(zone);
            }
            if (annotations.label) {
                annotations.label.content = getZoneLabel(zone);
            }

            tradesChart.update("none");
        } else {
            // Zone doesn't exist yet, create it
            addZoneToChart(zone);
        }
    }
        */
}

/**
 * Mark zone as completed (change visual style)
 */
function completeZoneBox(zone: ZoneData): void {
    (activeZones as Map<string, ZoneData>).set(zone.id, zone);

    /*
    if (
        tradesChart &&
        tradesChart.options &&
        tradesChart.options.plugins &&
        tradesChart.options.plugins.annotation &&
        tradesChart.options.plugins.annotation.annotations
    ) {
        const annotation = tradesChart.options.plugins.annotation
            .annotations as Record<string, AnnotationOptions<"box">>;
        if (annotation && annotation[`zone_${zone.id}`]) {
            const annotations: AnnotationOptions<"box"> = annotation[
                `zone_${zone.id}`
            ] as AnnotationOptions<"box">;
            // Change to completed zone style
            if (zone.type === "hidden_liquidity" || zone.type === "iceberg") {
                annotations.borderColor = getCompletedZoneBorderColor(zone);
                annotations.borderWidth = 2;
                annotations.borderDash =
                    zone.type === "iceberg" ? [3, 3] : [5, 5]; // Shorter dashes for iceberg
                // Set final end time for iceberg orders
                if (zone.type === "iceberg" && zone.endTime) {
                    annotations.xMax = zone.endTime;
                }
            } else {
                annotations.backgroundColor = getCompletedZoneColor(zone);
                annotations.borderColor = getCompletedZoneBorderColor(zone);
                annotations.borderWidth = 2;
                annotations.borderDash = [5, 5];
            }
            if (annotations.label) {
                annotations.label.content = getZoneLabel(zone) + " ✓";
            }

            tradesChart.update("none");

            // Auto-remove completed zones after 30 minutes
            setTimeout(
                () => {
                    removeZoneBox(zone.id);
                },
                30 * 60 * 1000
            );
        }
    }
        */
}

/**
 * Remove zone box from chart
 */
function removeZoneBox(zoneId: string): void {
    (activeZones as Map<string, ZoneData>).delete(zoneId);
    /*
    if (
        tradesChart &&
        tradesChart.options &&
        tradesChart.options.plugins &&
        tradesChart.options.plugins.annotation &&
        tradesChart.options.plugins.annotation.annotations
    ) {
        const annotation = tradesChart.options.plugins.annotation
            .annotations as Record<string, AnnotationOptions<"box">>;
        if (annotation) {
            delete annotation[`zone_${zoneId}`];
        }

        tradesChart.update("none");
    }
        */
}

/**
 * Add zone as chart annotation
 * /
function addZoneToChart(zone: ZoneData): void {
    if (
        tradesChart &&
        tradesChart.options &&
        tradesChart.options.plugins &&
        tradesChart.options.plugins.annotation &&
        tradesChart.options.plugins.annotation.annotations
    ) {
        console.log(
            "Adding zone to chart:",
            zone.type,
            zone.id,
            zone.priceRange
        );
    
        /*

        if (zone.type === "hidden_liquidity" || zone.type === "iceberg") {
            const price: number =
                zone.priceRange.center ??
                (zone.priceRange.min + zone.priceRange.max) / 2;

            // Calculate actual end time for iceberg orders based on zone duration
            const endTime: number = zone.endTime || Date.now() + 5 * 60 * 1000;

            const zoneAnnotationLine: AnnotationOptions<"line"> = {
                type: "line",
                xMin: zone.startTime ?? Date.now(),
                xMax: endTime,
                yMin: price,
                yMax: price,
                borderColor: getZoneBorderColor(zone),
                borderWidth: zone.type === "iceberg" ? 3 : 2, // Slightly thicker for iceberg
                label: {
                    display: true,
                    content: getZoneLabel(zone),
                    position: "start",
                    font: {
                        size: 10,
                        weight: "bold",
                    },
                    color: getZoneTextColor(zone),
                    backgroundColor: "rgba(255, 255, 255, 0.8)",
                    padding: 4,
                    borderRadius: 3,
                },
                enter: (_ctx: EventContext, event: ChartEvent) => {
                    showZoneTooltip(zone, event);
                },
                leave: () => {
                    hideZoneTooltip();
                },
            };

            // Add borderDash only if it's defined
            if (zone.type === "iceberg") {
                zoneAnnotationLine.borderDash = [8, 4];
            }
            const annotation = tradesChart.options.plugins.annotation
                .annotations as Record<string, AnnotationOptions<"line">>;
            if (annotation) {
                annotation[`zone_${zone.id}`] = zoneAnnotationLine;
            }
        } else {
            const zoneAnnotation: AnnotationOptions<"box"> = {
                type: "box",
                xMin: zone.startTime ?? Date.now(),
                xMax: Date.now() + 5 * 60 * 1000, // Extend 5 minutes into future
                yMin: zone.priceRange.min,
                yMax: zone.priceRange.max,
                backgroundColor: getZoneColor(zone),
                borderColor: getZoneBorderColor(zone),
                borderWidth: 1,
                label: {
                    display: true,
                    content: getZoneLabel(zone),
                    position: "start",
                    font: {
                        size: 10,
                        weight: "bold",
                    },
                    color: getZoneTextColor(zone),
                    backgroundColor: "rgba(255, 255, 255, 0.8)",
                    padding: 4,
                    borderRadius: 3,
                },
                enter: (_ctx: EventContext, event: ChartEvent) => {
                    showZoneTooltip(zone, event);
                },
                leave: () => {
                    hideZoneTooltip();
                },
            } as AnnotationOptions<"box">;
            const annotation = tradesChart.options.plugins.annotation
                .annotations as Record<string, AnnotationOptions<"box">>;
            if (annotation) {
                annotation[`zone_${zone.id}`] = zoneAnnotation;
            }
        }
        tradesChart.update("none");
    }
        */
//}

/**
 * Get zone background color based on type and strength
 */
export function getZoneColor(zone: ZoneData): string {
    const alpha: number = Math.max(
        ZONE_ALPHA_MIN_PERCENT,
        zone.strength * ZONE_ALPHA_MAX_PERCENT
    ); // Min 15%, max 40% opacity

    switch (zone.type) {
        case "accumulation":
            return `rgba(34, 197, 94, ${alpha})`; // Green
        case "distribution":
            return `rgba(239, 68, 68, ${alpha})`; // Red
        case "iceberg":
            return `rgba(59, 130, 246, ${alpha})`; // Blue
        case "spoofing":
            return `rgba(147, 51, 234, ${alpha})`; // Purple
        case "hidden_liquidity":
            return `rgba(245, 158, 11, ${alpha})`; // Amber
        default:
            return `rgba(107, 114, 128, ${alpha})`; // Gray
    }
}

/**
 * Get zone border color
 */
export function getZoneBorderColor(zone: ZoneData): string {
    switch (zone.type) {
        case "accumulation":
            return "rgba(34, 197, 94, 0.8)"; // Green
        case "distribution":
            return "rgba(239, 68, 68, 0.8)"; // Red
        case "iceberg":
            return "rgba(59, 130, 246, 0.8)"; // Blue
        case "spoofing":
            return "rgba(147, 51, 234, 0.8)"; // Purple
        case "hidden_liquidity":
            return "rgba(245, 158, 11, 0.8)"; // Amber
        default:
            return "rgba(107, 114, 128, 0.8)"; // Gray
    }
}

/**
 * Get completed zone colors (more muted)
 */
export function getCompletedZoneColor(zone: ZoneData): string {
    switch (zone.type) {
        case "accumulation":
            return "rgba(34, 197, 94, 0.2)"; // Lighter green
        case "distribution":
            return "rgba(239, 68, 68, 0.2)"; // Lighter red
        case "iceberg":
            return "rgba(59, 130, 246, 0.2)"; // Lighter blue
        case "spoofing":
            return "rgba(147, 51, 234, 0.2)"; // Lighter purple
        case "hidden_liquidity":
            return "rgba(245, 158, 11, 0.2)"; // Lighter amber
        default:
            return "rgba(107, 114, 128, 0.2)"; // Lighter gray
    }
}

export function getCompletedZoneBorderColor(zone: ZoneData): string {
    switch (zone.type) {
        case "accumulation":
            return "rgba(34, 197, 94, 0.5)"; // Muted green
        case "distribution":
            return "rgba(239, 68, 68, 0.5)"; // Muted red
        case "iceberg":
            return "rgba(59, 130, 246, 0.5)"; // Muted blue
        case "spoofing":
            return "rgba(147, 51, 234, 0.5)"; // Muted purple
        case "hidden_liquidity":
            return "rgba(245, 158, 11, 0.5)"; // Muted amber
        default:
            return "rgba(107, 114, 128, 0.5)"; // Muted gray
    }
}

/**
 * Get zone text color
 */
export function getZoneTextColor(zone: ZoneData): string {
    if (zone.type === "accumulation") {
        return "rgba(21, 128, 61, 1)"; // Dark green
    } else {
        return "rgba(153, 27, 27, 1)"; // Dark red
    }
}

/**
 * Generate zone label text
 */
function getZoneLabel(zone: ZoneData): string {
    const strengthPercent: number = Math.round(zone.strength * 100);
    const completionPercent: number = Math.round((zone.completion ?? 0) * 100);

    let typeLabel: string;
    switch (zone.type) {
        case "accumulation":
            typeLabel = "ACC";
            break;
        case "distribution":
            typeLabel = "DIST";
            break;
        case "iceberg":
            typeLabel = "🧊 ICE";
            break;
        case "spoofing":
            typeLabel = "👻 SPOOF";
            break;
        case "hidden_liquidity":
            typeLabel = "🔍 HIDDEN";
            break;
        default:
            typeLabel = (zone.type as string).toUpperCase();
    }

    return `${typeLabel} ${strengthPercent}% (${completionPercent}%)`;
}

/**
 * Show zone tooltip on hover
 */
export function showZoneTooltip(zone: ZoneData, event: ChartEvent): void {
    const tooltip: HTMLDivElement = document.createElement("div");
    tooltip.id = "zoneTooltip";
    tooltip.style.position = "fixed";
    tooltip.style.background = "rgba(0, 0, 0, 0.9)";
    tooltip.style.color = "white";
    tooltip.style.padding = "12px";
    tooltip.style.borderRadius = "6px";
    tooltip.style.fontSize = "12px";
    tooltip.style.fontFamily = "monospace";
    tooltip.style.pointerEvents = "none";
    tooltip.style.zIndex = "10000";
    tooltip.style.maxWidth = "300px";
    tooltip.style.lineHeight = "1.4";
    tooltip.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.3)";

    const duration: number = Math.round(
        (Date.now() - (zone.startTime ?? Date.now())) / 60000
    );
    const volumeFormatted: string = zone.totalVolume?.toLocaleString() || "N/A";

    // Get zone type color
    let zoneColor: string;
    switch (zone.type) {
        case "accumulation":
            zoneColor = "#22c55e";
            break;
        case "distribution":
            zoneColor = "#ef4444";
            break;
        case "iceberg":
            zoneColor = "#3b82f6";
            break;
        case "spoofing":
            zoneColor = "#9333ea";
            break;
        case "hidden_liquidity":
            zoneColor = "#f59e0b";
            break;
        default:
            zoneColor = "#6b7280";
    }

    let tooltipContent: string = `<div style="font-weight: bold; margin-bottom: 6px; color: ${zoneColor};">
            ${getZoneLabel(zone)} ZONE
        </div>
        <div>Price Range: ${zone.priceRange.min.toFixed(4)} - ${zone.priceRange.max.toFixed(4)}</div>`;

    // Add center for accumulation/distribution zones
    if (zone.priceRange.center) {
        tooltipContent += `<div>Center: ${zone.priceRange.center.toFixed(4)}</div>`;
    }

    tooltipContent += `
        <div>Strength: ${(zone.strength * 100).toFixed(1)}%</div>
        <div>Completion: ${((zone.completion ?? 0) * 100).toFixed(1)}%</div>`;

    // Add confidence if available
    if (zone.confidence !== undefined) {
        tooltipContent += `<div>Confidence: ${(zone.confidence * 100).toFixed(1)}%</div>`;
    }

    tooltipContent += `<div>Duration: ${duration}m</div>`;

    // Add type-specific details
    if (zone.type === "iceberg") {
        tooltipContent += `
            <div style="margin-top: 6px; border-top: 1px solid #333; padding-top: 6px;">
                <div>Refills: ${zone.refillCount || "N/A"}</div>
                <div>Volume: ${volumeFormatted}</div>
                <div>Avg Size: ${zone.averagePieceSize?.toFixed(2) || "N/A"}</div>
                <div>Side: ${zone.side?.toUpperCase() || "N/A"}</div>
            </div>`;
    } else if (zone.type === "spoofing") {
        tooltipContent += `
            <div style="margin-top: 6px; border-top: 1px solid #333; padding-top: 6px;">
                <div>Type: ${zone.spoofType || "N/A"}</div>
                <div>Wall Size: ${zone.wallSize?.toFixed(2) || "N/A"}</div>
                <div>Canceled: ${zone.canceled?.toFixed(2) || "N/A"}</div>
                <div>Executed: ${zone.executed?.toFixed(2) || "N/A"}</div>
                <div>Side: ${zone.side?.toUpperCase() || "N/A"}</div>
            </div>`;
    } else if (zone.type === "hidden_liquidity") {
        tooltipContent += `
            <div style="margin-top: 6px; border-top: 1px solid #333; padding-top: 6px;">
                <div>Stealth Type: ${zone.stealthType || "N/A"}</div>
                <div>Stealth Score: ${((zone.stealthScore ?? 0) * 100).toFixed(1) + "%"}</div>
                <div>Trades: ${zone.tradeCount || "N/A"}</div>
                <div>Volume: ${volumeFormatted}</div>
                <div>Side: ${zone.side?.toUpperCase() || "N/A"}</div>
            </div>`;
    }

    tooltip.innerHTML = tooltipContent;

    document.body.appendChild(tooltip);

    // Position tooltip
    tooltip.style.left = `${event.x ?? +15}px`;
    tooltip.style.top = `${event.y ?? +15}px`;
}

export function hideZoneTooltip(): void {
    const tooltip: HTMLElement | null = document.getElementById("zoneTooltip");
    if (tooltip) {
        tooltip.remove();
    }
}

export function getAnomalyIcon(type: string | undefined): string {
    switch (type) {
        case "volume_anomaly":
            return "📊";
        case "price_anomaly":
            return "💹";
        case "liquidity_anomaly":
            return "💧";
        default:
            return "❓";
    }
}

/**
 * Cleanup old completed zones
 */
export function cleanupOldZones() {
    const cutoffTime = Date.now() - 60 * 60 * 1000; // 1 hour

    for (const [zoneId, zone] of activeZones) {
        if (!zone.isActive && zone.endTime && zone.endTime < cutoffTime) {
            removeZoneBox(zoneId);
        }
    }
}
