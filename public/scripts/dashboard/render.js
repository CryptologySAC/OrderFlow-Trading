
import {
    anomalyList,
    anomalyFilters,
    signalsList,
    signalFilters,
    latestBadgeElem,
    badgeTimeout,
} from "./state.js";

function getAnomalyIcon(type) {
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

function getAnomalyLabel(type) {
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
                .replace(/\b\w/g, (l) => l.toUpperCase());
    }
}

function getReadableAction(action) {
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
                .replace(/\b\w/g, (l) => l.toUpperCase());
    }
}

function getAnomalySummary(anomaly) {
    if (!anomaly || typeof anomaly !== "object") return "";
    const details = anomaly.details || {};
    const parts = [];
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
                .filter(([_, v]) => Boolean(v))
                .map(([k]) => k)
                .join(", ");
            if (flags) parts.push(`Reasons: ${flags}`);
        }
    }
    return parts.join(" | ");
}
function capitalize(str) {
    return str[0].toUpperCase() + str.slice(1);
}
function formatAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    return `${m}m ago`;
}

export function renderAnomalyList() {
    const listElem = document.getElementById("anomalyList");
    if (!listElem) return;
    // Filter
    const filtered = anomalyList.filter((a) => anomalyFilters.has(a.severity));
    listElem.innerHTML = filtered
        .map(
            (a) => `
            <div class="anomaly-row ${a.severity}" title="${getAnomalySummary(a)}">
                <span class="anomaly-icon">${getAnomalyIcon(a.type)}</span>
                <span class="anomaly-label">${getAnomalyLabel(a.type)}</span>
                <span class="anomaly-price">${a.affectedPriceRange ? `${a.affectedPriceRange.min.toFixed(2)}-${a.affectedPriceRange.max.toFixed(2)}` : `${a.price?.toFixed(2) || "N/A"}`}</span>
                <span class="anomaly-action">${getReadableAction(a.recommendedAction)}</span>
                <span class="anomaly-time">${formatAgo(a.detectedAt || a.time || Date.now())}</span>
            </div>
        `
        )
        .join("");
}
export function showAnomalyBadge(anomaly) {
    // Remove previous badge
    if (latestBadgeElem) latestBadgeElem.remove();
    const badge = document.createElement("div");
    badge.className = `anomaly-badge ${anomaly.severity}`;
    badge.innerHTML = `${getAnomalyIcon(anomaly.type)} ${getAnomalyLabel(anomaly.type)} @ ${anomaly.price?.toFixed(2) || "N/A"}`;
    document.body.appendChild(badge);
    latestBadgeElem = badge;
    if (badgeTimeout) clearTimeout(badgeTimeout);
    badgeTimeout = setTimeout(() => {
        badge.remove();
        latestBadgeElem = null;
    }, 4000);
}

export function showSignalBundleBadge(signals) {
    if (!Array.isArray(signals) || signals.length === 0) return;
    const top = signals[0];
    if (latestBadgeElem) latestBadgeElem.remove();
    const badge = document.createElement("div");
    badge.className = "anomaly-badge";
    let color = "#757575"; // grey
    if (top.confidence > 0.9) {
        color = "#2e7d32"; // green
    } else if (top.confidence >= 0.75) {
        color = "#fb8c00"; // orange
    }
    badge.style.background = color;
    badge.innerHTML = `${top.side.toUpperCase()} @ ${top.price.toFixed(2)} (${(
        top.confidence * 100
    ).toFixed(0)}%)`;
    document.body.appendChild(badge);
    latestBadgeElem = badge;
    if (badgeTimeout) clearTimeout(badgeTimeout);
    badgeTimeout = setTimeout(() => {
        badge.remove();
        latestBadgeElem = null;
    }, 4000);
}

// Signal list rendering
function formatSignalTime(timestamp) {
    const s = Math.floor((Date.now() - timestamp) / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m ago`;
}

function getSignalSummary(signal) {
    const confidence = ((signal.signalData?.confidence || 0) * 100).toFixed(1);
    const meta = signal.signalData?.meta || {};
    const anomaly = signal.signalData?.anomalyCheck || {};

    return [
        `Signal: ${signal.type} (${signal.side})`,
        `Price: $${signal.price.toFixed(2)}`,
        `Confidence: ${confidence}%`,
        `Take Profit: $${signal.takeProfit?.toFixed(2) || "N/A"}`,
        `Stop Loss: $${signal.stopLoss?.toFixed(2) || "N/A"}`,
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

export function renderSignalsList() {
    const listElem = document.getElementById("signalsList");
    if (!listElem) return;

    // Filter signals based on selected filters
    const filtered = signalsList.filter((signal) =>
        signalFilters.has(signal.side)
    );

    listElem.innerHTML = filtered
        .map((signal) => {
            const confidence = (
                (signal.signalData?.confidence || 0) * 100
            ).toFixed(0);
            const timeAgo = formatSignalTime(signal.time);

            // Determine classification display
            const classification =
                signal.signal_classification ||
                signal.signalClassification ||
                "";
            const classificationBadge =
                classification === "reversal"
                    ? '<span class="signal-classification reversal">⚡ REVERSAL</span>'
                    : classification === "trend_following"
                      ? '<span class="signal-classification trend">📈 TREND</span>'
                      : "";

            const signalClass =
                classification === "reversal"
                    ? "signal-reversal"
                    : classification === "trend_following"
                      ? "signal-trend"
                      : "";

            return `
                <div class="signal-row signal-${signal.side} ${signalClass}" 
                     data-signal-id="${signal.id}"
                     title="${getSignalSummary(signal)}">
                    <div class="signal-row-header">
                        <span class="signal-type">${signal.type.replace("_confirmed", "").replace("_", " ")}</span>
                        ${classificationBadge}
                        <span class="signal-side ${signal.side}">${signal.side.toUpperCase()}</span>
                        <span class="signal-time">${timeAgo}</span>
                    </div>
                    <div class="signal-details">
                        <span class="signal-price">$${signal.price.toFixed(2)}</span>
                        <span class="signal-confidence">${confidence}%</span>
                    </div>
                    <div class="signal-targets">
                        <span>TP: $${signal.takeProfit?.toFixed(2) || "N/A"}</span>
                        <span>SL: $${signal.stopLoss?.toFixed(2) || "N/A"}</span>
                    </div>
                </div>
            `;
        })
        .join("");
}

export function updateTradeDelayIndicator(delay) {
    const indicator = document.getElementById("tradeDelayIndicator");
    const valueElement = document.getElementById("tradeDelayValue");

    if (!indicator || !valueElement) return;

    // Format delay with fixed width
    let formattedDelay;
    if (delay >= 1000) {
        // Show as seconds with 1 decimal place
        const seconds = (delay / 1000).toFixed(1);
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
