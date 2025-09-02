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

    // PERFORMANCE OPTIMIZATION: Use efficient DOM manipulation instead of innerHTML
    const filtered = anomalyList.filter((a) => anomalyFilters.has(a.severity));

    // Clear existing content efficiently
    while (listElem.firstChild) {
        listElem.removeChild(listElem.firstChild);
    }

    // Create document fragment for batch DOM insertion
    const fragment = document.createDocumentFragment();

    for (const anomaly of filtered) {
        const row = document.createElement("div");
        row.className = `anomaly-row ${anomaly.severity}`;
        row.title = getAnomalySummary(anomaly);

        // Create spans efficiently
        const iconSpan = document.createElement("span");
        iconSpan.className = "anomaly-icon";
        iconSpan.textContent = getAnomalyIcon(anomaly.type);

        const labelSpan = document.createElement("span");
        labelSpan.className = "anomaly-label";
        labelSpan.textContent = getAnomalyLabel(anomaly.type);

        const priceSpan = document.createElement("span");
        priceSpan.className = "anomaly-price";
        priceSpan.textContent = anomaly.affectedPriceRange
            ? `${anomaly.affectedPriceRange.min.toFixed(2)}-${anomaly.affectedPriceRange.max.toFixed(2)}`
            : `${anomaly.price?.toFixed(2) || "N/A"}`;

        const actionSpan = document.createElement("span");
        actionSpan.className = "anomaly-action";
        actionSpan.textContent = getReadableAction(anomaly.recommendedAction);

        const timeSpan = document.createElement("span");
        timeSpan.className = "anomaly-time";
        timeSpan.textContent = formatAgo(
            anomaly.detectedAt || anomaly.time || Date.now()
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

    // PERFORMANCE OPTIMIZATION: Use efficient DOM manipulation instead of innerHTML
    const filtered = signalsList.filter((signal) =>
        signalFilters.has(signal.side)
    );

    // Clear existing content efficiently
    while (listElem.firstChild) {
        listElem.removeChild(listElem.firstChild);
    }

    // Create document fragment for batch DOM insertion
    const fragment = document.createDocumentFragment();

    for (const signal of filtered) {
        const confidence = ((signal.signalData?.confidence || 0) * 100).toFixed(
            0
        );
        const timeAgo = formatSignalTime(signal.time);

        // Determine classification display
        const classification =
            signal.signal_classification || signal.signalClassification || "";
        const classificationBadge =
            classification === "reversal"
                ? "⚡ REVERSAL"
                : classification === "trend_following"
                  ? "📈 TREND"
                  : "";

        const signalClass =
            classification === "reversal"
                ? "signal-reversal"
                : classification === "trend_following"
                  ? "signal-trend"
                  : "";

        // Create signal row
        const row = document.createElement("div");
        row.className = `signal-row signal-${signal.side} ${signalClass}`;
        row.setAttribute("data-signal-id", signal.id);
        row.title = getSignalSummary(signal);

        // Create header
        const header = document.createElement("div");
        header.className = "signal-row-header";

        const typeSpan = document.createElement("span");
        typeSpan.className = "signal-type";
        typeSpan.textContent = signal.type
            .replace("_confirmed", "")
            .replace("_", " ");

        const classBadge = document.createElement("span");
        if (classificationBadge) {
            classBadge.className = `signal-classification ${classification.toLowerCase()}`;
            classBadge.textContent = classificationBadge;
        }

        const sideSpan = document.createElement("span");
        sideSpan.className = `signal-side ${signal.side}`;
        sideSpan.textContent = signal.side.toUpperCase();

        const timeSpan = document.createElement("span");
        timeSpan.className = "signal-time";
        timeSpan.textContent = timeAgo;

        header.appendChild(typeSpan);
        if (classificationBadge) header.appendChild(classBadge);
        header.appendChild(sideSpan);
        header.appendChild(timeSpan);

        // Create details
        const details = document.createElement("div");
        details.className = "signal-details";

        const priceSpan = document.createElement("span");
        priceSpan.className = "signal-price";
        priceSpan.textContent = `$${signal.price.toFixed(2)}`;

        const confSpan = document.createElement("span");
        confSpan.className = "signal-confidence";
        confSpan.textContent = `${confidence}%`;

        details.appendChild(priceSpan);
        details.appendChild(confSpan);

        // Create targets
        const targets = document.createElement("div");
        targets.className = "signal-targets";

        const tpSpan = document.createElement("span");
        tpSpan.textContent = `TP: $${signal.takeProfit?.toFixed(2) || "N/A"}`;

        const slSpan = document.createElement("span");
        slSpan.textContent = `SL: $${signal.stopLoss?.toFixed(2) || "N/A"}`;

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
