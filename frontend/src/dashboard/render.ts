import { signalsList, signalFilters } from "./state.js";
import type { Signal } from "../frontend-types.js";

// Import mutable references that need to be updated

// Constants for magic numbers

// Signal list rendering
function formatSignalTime(timestamp: number): string {
    const s = Math.floor((Date.now() - timestamp) / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m ago`;
}

function getSignalSummary(signal: Signal): string {
    // Access signalData safely with proper typing
    const signalData =
        (signal as { signalData?: Record<string, unknown> }).signalData || {};
    const confidence = (
        ((signalData["confidence"] as number) || 0) * 100
    ).toFixed(1);
    const meta = (signalData["meta"] as Record<string, unknown>) || {};
    const anomaly =
        (signalData["anomalyCheck"] as { marketHealthy?: boolean }) || {};

    // Access takeProfit and stopLoss safely
    const takeProfit = (signal as { takeProfit?: number }).takeProfit;
    const stopLoss = (signal as { stopLoss?: number }).stopLoss;

    return [
        `Signal: ${signal.type} (${signal.side})`,
        `Price: $${signal.price.toFixed(2)}`,
        `Confidence: ${confidence}%`,
        `Take Profit: $${takeProfit?.toFixed(2) || "N/A"}`,
        `Stop Loss: $${stopLoss?.toFixed(2) || "N/A"}`,
        meta["volume"] && typeof meta["volume"] === "number"
            ? `Volume: ${(meta["volume"] as number).toFixed(2)}`
            : "",
        meta["absorptionRatio"] && typeof meta["absorptionRatio"] === "number"
            ? `Absorption: ${((meta["absorptionRatio"] as number) * 100).toFixed(1)}%`
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
        const signalData =
            (signal as { signalData?: Record<string, unknown> }).signalData ||
            {};
        const confidence = (
            ((signalData["confidence"] as number) || 0) * 100
        ).toFixed(0);
        const timeAgo = formatSignalTime(signal.time);

        // Determine classification display
        const classification =
            (signal as { signal_classification?: string })
                .signal_classification ||
            (signal as { signalClassification?: string })
                .signalClassification ||
            "";
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
        const takeProfit = (signal as { takeProfit?: number }).takeProfit;
        tpSpan.textContent = `TP: $${takeProfit && typeof takeProfit === "number" ? takeProfit.toFixed(2) : "N/A"}`;

        const slSpan = document.createElement("span");
        const stopLoss = (signal as { stopLoss?: number }).stopLoss;
        slSpan.textContent = `SL: $${stopLoss && typeof stopLoss === "number" ? stopLoss.toFixed(2) : "N/A"}`;

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

export function updateTradeDelayIndicator(delay: number): void {
    const indicator = document.getElementById("tradeDelayIndicator");
    const valueElement = document.getElementById("tradeDelayValue");

    if (!indicator || !valueElement) return;

    // Format delay with fixed width
    let formattedDelay: string;
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
