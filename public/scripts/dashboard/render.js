import { signalsList, signalFilters } from "./state.js";
function formatSignalTime(timestamp) {
    const s = Math.floor((Date.now() - timestamp) / 1000);
    if (s < 60)
        return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60)
        return `${m}m ago`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m ago`;
}
function getSignalSummary(signal) {
    const signalData = signal.signalData || {};
    const confidence = ((signalData["confidence"] || 0) * 100).toFixed(1);
    const meta = signalData["meta"] || {};
    const anomaly = signalData["anomalyCheck"] || {};
    const takeProfit = signal.takeProfit;
    const stopLoss = signal.stopLoss;
    return [
        `Signal: ${signal.type} (${signal.side})`,
        `Price: $${signal.price.toFixed(2)}`,
        `Confidence: ${confidence}%`,
        `Take Profit: $${takeProfit?.toFixed(2) || "N/A"}`,
        `Stop Loss: $${stopLoss?.toFixed(2) || "N/A"}`,
        meta["volume"] && typeof meta["volume"] === "number"
            ? `Volume: ${meta["volume"].toFixed(2)}`
            : "",
        meta["absorptionRatio"] && typeof meta["absorptionRatio"] === "number"
            ? `Absorption: ${(meta["absorptionRatio"] * 100).toFixed(1)}%`
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
    if (!listElem)
        return;
    const filtered = signalsList.filter((signal) => signalFilters.has(signal.side));
    while (listElem.firstChild) {
        listElem.removeChild(listElem.firstChild);
    }
    const fragment = document.createDocumentFragment();
    for (const signal of filtered) {
        const signalData = signal.signalData ||
            {};
        const confidence = ((signalData["confidence"] || 0) * 100).toFixed(0);
        const timeAgo = formatSignalTime(signal.time);
        const classification = signal
            .signal_classification ||
            signal
                .signalClassification ||
            "";
        const classificationBadge = classification === "reversal"
            ? "⚡ REVERSAL"
            : classification === "trend_following"
                ? "📈 TREND"
                : "";
        const signalClass = classification === "reversal"
            ? "signal-reversal"
            : classification === "trend_following"
                ? "signal-trend"
                : "";
        const row = document.createElement("div");
        row.className = `signal-row signal-${signal.side} ${signalClass}`;
        row.setAttribute("data-signal-id", signal.id);
        row.title = getSignalSummary(signal);
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
        if (classificationBadge)
            header.appendChild(classBadge);
        header.appendChild(sideSpan);
        header.appendChild(timeSpan);
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
        const targets = document.createElement("div");
        targets.className = "signal-targets";
        const tpSpan = document.createElement("span");
        const takeProfit = signal.takeProfit;
        tpSpan.textContent = `TP: $${takeProfit && typeof takeProfit === "number" ? takeProfit.toFixed(2) : "N/A"}`;
        const slSpan = document.createElement("span");
        const stopLoss = signal.stopLoss;
        slSpan.textContent = `SL: $${stopLoss && typeof stopLoss === "number" ? stopLoss.toFixed(2) : "N/A"}`;
        targets.appendChild(tpSpan);
        targets.appendChild(slSpan);
        row.appendChild(header);
        row.appendChild(details);
        row.appendChild(targets);
        fragment.appendChild(row);
    }
    listElem.appendChild(fragment);
}
export function updateTradeDelayIndicator(delay) {
    const indicator = document.getElementById("tradeDelayIndicator");
    const valueElement = document.getElementById("tradeDelayValue");
    if (!indicator || !valueElement)
        return;
    let formattedDelay;
    if (delay >= 1000) {
        const seconds = (delay / 1000).toFixed(1);
        formattedDelay = `${seconds}s`;
    }
    else {
        formattedDelay = `${delay}ms`;
    }
    valueElement.textContent = formattedDelay;
    indicator.classList.remove("delay-green", "delay-orange", "delay-red");
    if (delay < 100) {
        indicator.classList.add("delay-green");
    }
    else if (delay < 500) {
        indicator.classList.add("delay-orange");
    }
    else {
        indicator.classList.add("delay-red");
    }
}
