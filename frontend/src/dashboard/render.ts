// Rendering utilities for the trading dashboard
// Converted from JavaScript to TypeScript with strict type checking

import type { Anomaly, Signal } from "../frontend-types.js";
import {
    anomalyList,
    anomalyFilters,
    signalsList,
    signalFilters,
} from "./state.js";

// =============================================================================
// ANOMALY ICONS AND LABELS
// =============================================================================

function getAnomalyIcon(type: string): string {
    switch (type) {
        case "flash_crash":
            return "⚡";
        case "liquidity_void":
            return "💧";
        case "absorption":
            return "🔵";
        case "exhaustion":
            return "🔴";
        case "whale_activity":
            return "🐋";
        case "momentum_ignition":
            return "🔥";
        case "spoofing":
            return "👻";
        case "iceberg_order":
            return "🧊";
        case "hidden_liquidity":
            return "🔍";
        case "stealth_order":
            return "👤";
        case "reserve_order":
            return "📦";
        case "algorithmic_stealth":
            return "🤖";
        case "orderbook_imbalance":
            return "⚖️";
        case "flow_imbalance":
            return "⇄";
        default:
            return "•";
    }
}

function getAnomalyLabel(type: string): string {
    switch (type) {
        case "flash_crash":
            return "Flash Crash";
        case "liquidity_void":
            return "Liquidity Void";
        case "absorption":
            return "Absorption";
        case "exhaustion":
            return "Exhaustion";
        case "whale_activity":
            return "Whale Activity";
        case "momentum_ignition":
            return "Momentum Ignition";
        case "spoofing":
            return "Spoofing";
        case "iceberg_order":
            return "Iceberg Order";
        case "orderbook_imbalance":
            return "Orderbook Imbalance";
        case "flow_imbalance":
            return "Flow Imbalance";
        case "hidden_liquidity":
            return "Hidden Liquidity";
        case "stealth_order":
            return "Stealth Order";
        case "reserve_order":
            return "Reserve Order";
        case "algorithmic_stealth":
            return "Algorithmic Stealth";
        default:
            return type
                .replace(/_/g, " ")
                .replace(/\b\w/g, (l: string) => l.toUpperCase());
    }
}

function getReadableAction(action: string | undefined): string {
    if (!action) return "Monitor";

    switch (action.toLowerCase()) {
        case "buy_signal":
        case "buy":
            return "Buy";
        case "sell_signal":
        case "sell":
            return "Sell";
        case "hold_position":
        case "hold":
            return "Hold";
        case "close_position":
        case "close":
            return "Close";
        case "reduce_position":
        case "reduce":
            return "Reduce";
        case "increase_position":
        case "increase":
            return "Add";
        case "wait_for_confirmation":
        case "wait":
            return "Wait";
        case "monitor_closely":
        case "monitor":
            return "Monitor";
        case "avoid_trading":
        case "avoid":
            return "Avoid";
        case "exit_immediately":
        case "exit":
            return "Exit";
        default:
            // Convert snake_case to Title Case
            return action
                .replace(/_/g, " ")
                .replace(/\b\w/g, (l: string) => l.toUpperCase());
    }
}

// =============================================================================
// ANOMALY SUMMARY AND FORMATTING
// =============================================================================

function getAnomalySummary(anomaly: Anomaly): string {
    if (!anomaly || typeof anomaly !== "object") return "";
    const details = anomaly.details || {};
    const parts: string[] = [];

    if (details.confidence !== undefined) {
        const pct = Number(details.confidence) * 100;
        if (!Number.isNaN(pct)) parts.push(`Conf: ${pct.toFixed(0)}%`);
    }
    if (details.imbalance !== undefined) {
        const val = Number(details.imbalance);
        if (!Number.isNaN(val)) parts.push(`Imb: ${val.toFixed(2)}`);
    }
    if (details.absorptionRatio !== undefined) {
        const val = Number(details.absorptionRatio);
        if (!Number.isNaN(val)) parts.push(`AbsRatio: ${val.toFixed(2)}`);
    }
    if (details.rationale) {
        if (typeof details.rationale === "string") {
            parts.push(details.rationale);
        } else if (typeof details.rationale === "object") {
            const flags = Object.entries(details.rationale)
                .filter(([, v]) => Boolean(v))
                .map(([k]) => k)
                .join(", ");
            if (flags) parts.push(`Reasons: ${flags}`);
        }
    }
    return parts.join(" | ");
}

/*
function _capitalize(str: string): string {
    return str && str.length > 0
        ? (str[0] || "").toUpperCase() + str.slice(1)
        : str;
}
*/

function formatAgo(ts: number): string {
    const s: number = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return `${s}s ago`;
    const m: number = Math.floor(s / 60);
    return `${m}m ago`;
}

// =============================================================================
// ANOMALY LIST RENDERING
// =============================================================================

export function renderAnomalyList(): void {
    const listElem: HTMLElement | null = document.getElementById("anomalyList");
    if (!listElem) return;

    // PERFORMANCE OPTIMIZATION: Use efficient DOM manipulation instead of innerHTML
    const filtered: Anomaly[] = anomalyList.filter((a: Anomaly) =>
        anomalyFilters.has(a.severity)
    );

    // Clear existing content efficiently
    while (listElem.firstChild) {
        listElem.removeChild(listElem.firstChild);
    }

    // Create document fragment for batch DOM insertion
    const fragment: DocumentFragment = document.createDocumentFragment();

    for (const anomaly of filtered) {
        const row: HTMLDivElement = document.createElement("div");
        row.className = `anomaly-row ${anomaly.severity}`;
        row.title = getAnomalySummary(anomaly);

        // Create spans efficiently
        const iconSpan: HTMLSpanElement = document.createElement("span");
        iconSpan.className = "anomaly-icon";
        iconSpan.textContent = getAnomalyIcon(anomaly.type || "unknown");

        const labelSpan: HTMLSpanElement = document.createElement("span");
        labelSpan.className = "anomaly-label";
        labelSpan.textContent = getAnomalyLabel(anomaly.type || "unknown");

        const priceSpan: HTMLSpanElement = document.createElement("span");
        priceSpan.className = "anomaly-price";
        priceSpan.textContent = anomaly.affectedPriceRange
            ? `${anomaly.affectedPriceRange.min.toFixed(2)}-${anomaly.affectedPriceRange.max.toFixed(2)}`
            : `${anomaly.price?.toFixed(2) || "N/A"}`;

        const actionSpan: HTMLSpanElement = document.createElement("span");
        actionSpan.className = "anomaly-action";
        actionSpan.textContent = getReadableAction(anomaly.recommendedAction);

        const timeSpan: HTMLSpanElement = document.createElement("span");
        timeSpan.className = "anomaly-time";
        timeSpan.textContent = formatAgo(
            anomaly.detectedAt || anomaly.timestamp || Date.now()
        );

        // Append all spans to row
        row.appendChild(iconSpan);
        row.appendChild(labelSpan);
        row.appendChild(priceSpan);
        row.appendChild(actionSpan);
        row.appendChild(timeSpan);

        fragment.appendChild(row);
    }

    // Single DOM insertion
    listElem.appendChild(fragment);
}

// =============================================================================
// BADGE DISPLAY FUNCTIONS
// =============================================================================

export function showAnomalyBadge(anomaly: Anomaly): void {
    // Remove previous badge
    const existingBadge = document.querySelector(".anomaly-badge");
    if (existingBadge) existingBadge.remove();

    const badge: HTMLDivElement = document.createElement("div");
    badge.className = `anomaly-badge ${anomaly.severity}`;
    badge.innerHTML = `${getAnomalyIcon(anomaly.type || "unknown")} ${getAnomalyLabel(anomaly.type || "unknown")} @ ${anomaly.price?.toFixed(2) || "N/A"}`;
    document.body.appendChild(badge);
    // Note: State management for badges should be handled by the state module
    setTimeout(() => {
        badge.remove();
    }, 4000);
}

export function showSignalBundleBadge(signals: Signal[]): void {
    if (!Array.isArray(signals) || signals.length === 0) return;
    const top: Signal | undefined = signals[0];
    if (!top) return;
    // Remove any existing badge
    const existingBadge = document.querySelector(".anomaly-badge");
    if (existingBadge) existingBadge.remove();

    const badge: HTMLDivElement = document.createElement("div");
    badge.className = "anomaly-badge";
    let color: string = "#757575"; // grey
    if (top.confidence && top.confidence > 0.9) {
        color = "#2e7d32"; // green
    } else if (top.confidence && top.confidence >= 0.75) {
        color = "#fb8c00"; // orange
    }
    badge.style.background = color;
    badge.innerHTML = `${(top.side || "UNKNOWN").toUpperCase()} @ ${top.price.toFixed(2)} (${(
        (top.confidence || 0) * 100
    ).toFixed(0)}%)`;
    document.body.appendChild(badge);
    // Note: State management for badges should be handled by the state module
    setTimeout(() => {
        badge.remove();
    }, 4000);
}

// =============================================================================
// SIGNAL LIST RENDERING
// =============================================================================

function formatSignalTime(timestamp: number): string {
    const s: number = Math.floor((Date.now() - timestamp) / 1000);
    if (s < 60) return `${s}s ago`;
    const m: number = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h: number = Math.floor(m / 60);
    return `${h}h ${m % 60}m ago`;
}

function getSignalSummary(signal: Signal): string {
    const confidence: string = (
        ((signal as any).signalData?.confidence || 0) * 100
    ).toFixed(1);
    const meta: any = (signal as any).signalData?.meta || {};
    const anomaly: any = (signal as any).signalData?.anomalyCheck || {};

    return [
        `Signal: ${signal.type} (${signal.side || "unknown"})`,
        `Price: $${signal.price.toFixed(2)}`,
        `Confidence: ${confidence}%`,
        `Take Profit: $${(signal as any).takeProfit?.toFixed(2) || "N/A"}`,
        `Stop Loss: $${(signal as any).stopLoss?.toFixed(2) || "N/A"}`,
        meta.volume ? `Volume: ${meta.volume.toFixed(2)}` : "",
        meta.absorptionRatio
            ? `Absorption: ${(meta.absorptionRatio * 100).toFixed(1)}%`
            : "",
        anomaly.marketHealthy !== undefined
            ? `Market Health: ${anomaly.marketHealthy ? "Healthy" : "Unhealthy"}`
            : "",
        `Generated: ${new Date(signal.time).toLocaleString()}`,
    ]
        .filter(Boolean)
        .join("\n");
}

export function renderSignalsList(): void {
    const listElem: HTMLElement | null = document.getElementById("signalsList");
    if (!listElem) return;

    // PERFORMANCE OPTIMIZATION: Use efficient DOM manipulation instead of innerHTML
    const filtered: Signal[] = signalsList.filter((signal: Signal) =>
        signalFilters.has(signal.side || "unknown")
    );

    // Clear existing content efficiently
    while (listElem.firstChild) {
        listElem.removeChild(listElem.firstChild);
    }

    // Create document fragment for batch DOM insertion
    const fragment: DocumentFragment = document.createDocumentFragment();

    for (const signal of filtered) {
        const confidence: string = (
            ((signal as any).signalData?.confidence || 0) * 100
        ).toFixed(0);
        const timeAgo: string = formatSignalTime(signal.time);

        // Determine classification display
        const classification: string =
            (signal as any).signal_classification ||
            (signal as any).signalClassification ||
            "";
        const classificationBadge: string =
            classification === "reversal"
                ? "⚡ REVERSAL"
                : classification === "trend_following"
                  ? "📈 TREND"
                  : "";

        const signalClass: string =
            classification === "reversal"
                ? "signal-reversal"
                : classification === "trend_following"
                  ? "signal-trend"
                  : "";

        // Create signal row
        const row: HTMLDivElement = document.createElement("div");
        row.className = `signal-row signal-${signal.side || "unknown"} ${signalClass}`;
        row.setAttribute("data-signal-id", signal.id);
        row.title = getSignalSummary(signal);

        // Create header
        const header: HTMLDivElement = document.createElement("div");
        header.className = "signal-row-header";

        const typeSpan: HTMLSpanElement = document.createElement("span");
        typeSpan.className = "signal-type";
        typeSpan.textContent = signal.type
            .replace("_confirmed", "")
            .replace("_", " ");

        const classBadge: HTMLSpanElement = document.createElement("span");
        if (classificationBadge) {
            classBadge.className = `signal-classification ${classification.toLowerCase()}`;
            classBadge.textContent = classificationBadge;
        }

        const sideSpan: HTMLSpanElement = document.createElement("span");
        sideSpan.className = `signal-side ${signal.side || "unknown"}`;
        sideSpan.textContent = (signal.side || "UNKNOWN").toUpperCase();

        const timeSpan: HTMLSpanElement = document.createElement("span");
        timeSpan.className = "signal-time";
        timeSpan.textContent = timeAgo;

        header.appendChild(typeSpan);
        if (classificationBadge) header.appendChild(classBadge);
        header.appendChild(sideSpan);
        header.appendChild(timeSpan);

        // Create details
        const details: HTMLDivElement = document.createElement("div");
        details.className = "signal-details";

        const priceSpan: HTMLSpanElement = document.createElement("span");
        priceSpan.className = "signal-price";
        priceSpan.textContent = `$${signal.price.toFixed(2)}`;

        const confSpan: HTMLSpanElement = document.createElement("span");
        confSpan.className = "signal-confidence";
        confSpan.textContent = `${confidence}%`;

        details.appendChild(priceSpan);
        details.appendChild(confSpan);

        // Create targets
        const targets: HTMLDivElement = document.createElement("div");
        targets.className = "signal-targets";

        const tpSpan: HTMLSpanElement = document.createElement("span");
        tpSpan.textContent = `TP: $${(signal as any).takeProfit?.toFixed(2) || "N/A"}`;

        const slSpan: HTMLSpanElement = document.createElement("span");
        slSpan.textContent = `SL: $${(signal as any).stopLoss?.toFixed(2) || "N/A"}`;

        targets.appendChild(tpSpan);
        targets.appendChild(slSpan);

        // Assemble row
        row.appendChild(header);
        row.appendChild(details);
        row.appendChild(targets);

        fragment.appendChild(row);
    }

    // Single DOM insertion
    listElem.appendChild(fragment);
}

// =============================================================================
// TRADE DELAY INDICATOR
// =============================================================================

export function updateTradeDelayIndicator(delay: number): void {
    const indicator: HTMLElement | null = document.getElementById(
        "tradeDelayIndicator"
    );
    const valueElement: HTMLElement | null =
        document.getElementById("tradeDelayValue");

    if (!indicator || !valueElement) return;

    // Format delay with fixed width
    let formattedDelay: string;
    if (delay >= 1000) {
        // Show as seconds with 1 decimal place
        const seconds: string = (delay / 1000).toFixed(1);
        formattedDelay = `${seconds}s`;
    } else {
        // Show as milliseconds, ensure consistent width
        formattedDelay = `${delay}ms`;
    }

    // Update the displayed value
    valueElement.textContent = formattedDelay;

    // Remove previous delay classes
    indicator.classList.remove("delay-green", "delay-orange", "delay-red");

    // Add appropriate color class based on delay
    if (delay < 100) {
        indicator.classList.add("delay-green");
    } else if (delay < 500) {
        indicator.classList.add("delay-orange");
    } else {
        indicator.classList.add("delay-red");
    }
}
