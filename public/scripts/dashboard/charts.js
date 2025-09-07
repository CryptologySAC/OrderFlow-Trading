import { maxSupportResistanceLevels, activeZones, maxActiveZones, signalsList, } from "./state.js";
import { renderSignalsList } from "./render.js";
import { Chart, registerables } from "chart.js";
import annotationPlugin from "chartjs-plugin-annotation";
import zoomPlugin from "chartjs-plugin-zoom";
import "chartjs-adapter-date-fns";
Chart.register(...registerables, zoomPlugin, annotationPlugin);
const MAX_LABEL_LENGTH = 250;
const TRUNCATED_LABEL_LENGTH = 245;
const ZONE_BASE_THICKNESS_PERCENT = 0.0008;
const ZONE_STRENGTH_MULTIPLIER_BASE = 1;
const ZONE_TOUCH_MULTIPLIER_MAX = 1;
const ZONE_TOUCH_COUNT_NORMALIZER = 10;
const BREACH_THRESHOLD_MULTIPLIER = 2;
const CLEANUP_TIME_HOURS = 2;
const CLEANUP_TIME_MS = CLEANUP_TIME_HOURS * 60 * 60 * 1000;
const ZONE_ALPHA_MIN_PERCENT = 0.15;
const ZONE_ALPHA_MAX_PERCENT = 0.4;
let supportResistanceLevels = [];
export function buildSignalLabel(signal) {
    if (!signal)
        return "Invalid Signal";
    let label = `[${signal.type?.toUpperCase() ?? "?"}] ${signal.side?.toUpperCase() ?? "?"} @ ${signal.price?.toFixed(2) ?? "?"}`;
    if (signal.confidence !== undefined) {
        label += `\nConf: ${(signal.confidence * 100).toFixed(0)}%`;
    }
    if (label.length > MAX_LABEL_LENGTH)
        label = label.slice(0, TRUNCATED_LABEL_LENGTH) + "...";
    return label;
}
export function handleSupportResistanceLevel(levelData) {
    const level = levelData.data;
    supportResistanceLevels.unshift(level);
    if (supportResistanceLevels.length > maxSupportResistanceLevels) {
        const oldestLevel = supportResistanceLevels.pop();
        removeSupportResistanceLevel(oldestLevel.id);
    }
    console.log("Support/Resistance level added to chart:", {
        id: level.id,
        price: level.price,
        type: level.type,
        strength: level.strength,
        touchCount: level.touchCount,
    });
}
function removeSupportResistanceLevel(levelId) {
    void levelId;
}
export function checkSupportResistanceBreaches(tradePrice) {
    if (!supportResistanceLevels.length)
        return;
    supportResistanceLevels = supportResistanceLevels.filter((level) => {
        const zoneHeight = level.price *
            ZONE_BASE_THICKNESS_PERCENT *
            (ZONE_STRENGTH_MULTIPLIER_BASE + level.strength * 2) *
            (ZONE_STRENGTH_MULTIPLIER_BASE +
                Math.min(level.touchCount / ZONE_TOUCH_COUNT_NORMALIZER, ZONE_TOUCH_MULTIPLIER_MAX));
        const breachThreshold = zoneHeight * BREACH_THRESHOLD_MULTIPLIER;
        let isBreached = false;
        if (level.type === "support") {
            isBreached = tradePrice < level.price - breachThreshold;
        }
        else {
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
            return false;
        }
        return true;
    });
}
export function cleanupOldSupportResistanceLevels() {
    const cutoffTime = Date.now() - CLEANUP_TIME_MS;
    supportResistanceLevels = supportResistanceLevels.filter((level) => {
        if (level.lastTouched < cutoffTime) {
            removeSupportResistanceLevel(level.id);
            return false;
        }
        return true;
    });
}
export function handleZoneUpdate(updateData) {
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
export function handleZoneSignal(signalData) {
    const { zone, confidence, expectedDirection } = signalData;
    if (zone.type === "accumulation" || zone.type === "distribution") {
        console.log(`${zone.type} zone signal filtered out - zones draw but signals don't show`, zone.id);
        return;
    }
    const normalizedSignal = {
        id: `zone_${zone.id}_${Date.now()}`,
        type: `${zone.type}_zone_${signalData.signalType}`,
        price: zone.priceRange.center ??
            (zone.priceRange.min + zone.priceRange.max) / 2,
        time: Date.now(),
        side: expectedDirection === "up"
            ? "buy"
            : expectedDirection === "down"
                ? "sell"
                : "buy",
        confidence: confidence,
        zone: zone,
    };
    signalsList.unshift(normalizedSignal);
    if (signalsList.length > 50) {
        signalsList.splice(50);
    }
    renderSignalsList();
}
function createZoneBox(zone) {
    activeZones.set(zone.id, zone);
    if (activeZones.size > maxActiveZones) {
        const oldestZoneId = activeZones.keys().next().value ?? "";
        removeZoneBox(oldestZoneId);
    }
}
function updateZoneBox(zone) {
    activeZones.set(zone.id, zone);
}
function completeZoneBox(zone) {
    activeZones.set(zone.id, zone);
}
function removeZoneBox(zoneId) {
    activeZones.delete(zoneId);
}
export function getZoneColor(zone) {
    const alpha = Math.max(ZONE_ALPHA_MIN_PERCENT, zone.strength * ZONE_ALPHA_MAX_PERCENT);
    switch (zone.type) {
        case "accumulation":
            return `rgba(34, 197, 94, ${alpha})`;
        case "distribution":
            return `rgba(239, 68, 68, ${alpha})`;
        case "iceberg":
            return `rgba(59, 130, 246, ${alpha})`;
        case "spoofing":
            return `rgba(147, 51, 234, ${alpha})`;
        case "hidden_liquidity":
            return `rgba(245, 158, 11, ${alpha})`;
        default:
            return `rgba(107, 114, 128, ${alpha})`;
    }
}
export function getZoneBorderColor(zone) {
    switch (zone.type) {
        case "accumulation":
            return "rgba(34, 197, 94, 0.8)";
        case "distribution":
            return "rgba(239, 68, 68, 0.8)";
        case "iceberg":
            return "rgba(59, 130, 246, 0.8)";
        case "spoofing":
            return "rgba(147, 51, 234, 0.8)";
        case "hidden_liquidity":
            return "rgba(245, 158, 11, 0.8)";
        default:
            return "rgba(107, 114, 128, 0.8)";
    }
}
export function getCompletedZoneColor(zone) {
    switch (zone.type) {
        case "accumulation":
            return "rgba(34, 197, 94, 0.2)";
        case "distribution":
            return "rgba(239, 68, 68, 0.2)";
        case "iceberg":
            return "rgba(59, 130, 246, 0.2)";
        case "spoofing":
            return "rgba(147, 51, 234, 0.2)";
        case "hidden_liquidity":
            return "rgba(245, 158, 11, 0.2)";
        default:
            return "rgba(107, 114, 128, 0.2)";
    }
}
export function getCompletedZoneBorderColor(zone) {
    switch (zone.type) {
        case "accumulation":
            return "rgba(34, 197, 94, 0.5)";
        case "distribution":
            return "rgba(239, 68, 68, 0.5)";
        case "iceberg":
            return "rgba(59, 130, 246, 0.5)";
        case "spoofing":
            return "rgba(147, 51, 234, 0.5)";
        case "hidden_liquidity":
            return "rgba(245, 158, 11, 0.5)";
        default:
            return "rgba(107, 114, 128, 0.5)";
    }
}
export function getZoneTextColor(zone) {
    if (zone.type === "accumulation") {
        return "rgba(21, 128, 61, 1)";
    }
    else {
        return "rgba(153, 27, 27, 1)";
    }
}
function getZoneLabel(zone) {
    const strengthPercent = Math.round(zone.strength * 100);
    const completionPercent = Math.round((zone.completion ?? 0) * 100);
    let typeLabel;
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
            typeLabel = zone.type.toUpperCase();
    }
    return `${typeLabel} ${strengthPercent}% (${completionPercent}%)`;
}
export function showZoneTooltip(zone, event) {
    const tooltip = document.createElement("div");
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
    const duration = Math.round((Date.now() - (zone.startTime ?? Date.now())) / 60000);
    const volumeFormatted = zone.totalVolume?.toLocaleString() || "N/A";
    let zoneColor;
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
    let tooltipContent = `<div style="font-weight: bold; margin-bottom: 6px; color: ${zoneColor};">
            ${getZoneLabel(zone)} ZONE
        </div>
        <div>Price Range: ${zone.priceRange.min.toFixed(4)} - ${zone.priceRange.max.toFixed(4)}</div>`;
    if (zone.priceRange.center) {
        tooltipContent += `<div>Center: ${zone.priceRange.center.toFixed(4)}</div>`;
    }
    tooltipContent += `
        <div>Strength: ${(zone.strength * 100).toFixed(1)}%</div>
        <div>Completion: ${((zone.completion ?? 0) * 100).toFixed(1)}%</div>`;
    if (zone.confidence !== undefined) {
        tooltipContent += `<div>Confidence: ${(zone.confidence * 100).toFixed(1)}%</div>`;
    }
    tooltipContent += `<div>Duration: ${duration}m</div>`;
    if (zone.type === "iceberg") {
        tooltipContent += `
            <div style="margin-top: 6px; border-top: 1px solid #333; padding-top: 6px;">
                <div>Refills: ${zone.refillCount || "N/A"}</div>
                <div>Volume: ${volumeFormatted}</div>
                <div>Avg Size: ${zone.averagePieceSize?.toFixed(2) || "N/A"}</div>
                <div>Side: ${zone.side?.toUpperCase() || "N/A"}</div>
            </div>`;
    }
    else if (zone.type === "spoofing") {
        tooltipContent += `
            <div style="margin-top: 6px; border-top: 1px solid #333; padding-top: 6px;">
                <div>Type: ${zone.spoofType || "N/A"}</div>
                <div>Wall Size: ${zone.wallSize?.toFixed(2) || "N/A"}</div>
                <div>Canceled: ${zone.canceled?.toFixed(2) || "N/A"}</div>
                <div>Executed: ${zone.executed?.toFixed(2) || "N/A"}</div>
                <div>Side: ${zone.side?.toUpperCase() || "N/A"}</div>
            </div>`;
    }
    else if (zone.type === "hidden_liquidity") {
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
    tooltip.style.left = `${event.x ?? +15}px`;
    tooltip.style.top = `${event.y ?? +15}px`;
}
export function hideZoneTooltip() {
    const tooltip = document.getElementById("zoneTooltip");
    if (tooltip) {
        tooltip.remove();
    }
}
export function getAnomalyIcon(type) {
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
export function cleanupOldZones() {
    const cutoffTime = Date.now() - 60 * 60 * 1000;
    for (const [zoneId, zone] of activeZones) {
        if (!zone.isActive && zone.endTime && zone.endTime < cutoffTime) {
            removeZoneBox(zoneId);
        }
    }
}
