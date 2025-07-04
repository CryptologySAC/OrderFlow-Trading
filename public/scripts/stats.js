const wsUrl = `wss://api.cryptology.pe/ltcusdt_trades`;
let ws;
let pingTimer;

function initVisuals() {
    // No visual components to initialize - all data is now in tables
    console.log("Stats page initialized - using table-based display");
}

function updateTables(metrics) {
    console.log("updateTables called with metrics:", metrics);
    console.log("metrics.counters:", metrics.counters);
    console.log("metrics.gauges:", metrics.gauges);
    console.log("metrics.histograms:", metrics.histograms);

    // Update counters table
    const countersBody = document.querySelector("#countersTable tbody");
    if (countersBody) {
        // Preserve the Active Connections row
        const activeConnectionsRow =
            countersBody.querySelector("tr:first-child");
        countersBody.innerHTML = "";

        // Re-add the Active Connections row at the top
        if (activeConnectionsRow) {
            countersBody.appendChild(activeConnectionsRow);
        }

        for (const [name, counter] of Object.entries(metrics.counters || {})) {
            // Skip connections_active since we handle it separately
            if (name === "connections_active") continue;

            const val =
                typeof counter === "object" && counter.value !== undefined
                    ? counter.value
                    : counter;
            const row = document.createElement("tr");
            const displayName = formatMetricName(name);
            const displayValue = formatMetricValue(name, val);
            row.innerHTML = `<td>${displayName}</td><td>${displayValue}</td>`;
            countersBody.appendChild(row);
        }

        // Add a "No data" row if empty (excluding Active Connections)
        if (
            Object.keys(metrics.counters || {}).length === 0 ||
            (Object.keys(metrics.counters || {}).length === 1 &&
                metrics.counters.connections_active !== undefined)
        ) {
            const row = document.createElement("tr");
            row.innerHTML = `<td colspan="2" style="text-align: center; color: var(--text-secondary, #666);">No counter data available</td>`;
            countersBody.appendChild(row);
        }
    }

    // Update gauges table
    const gaugesBody = document.querySelector("#gaugesTable tbody");
    if (gaugesBody) {
        gaugesBody.innerHTML = "";
        for (const [name, value] of Object.entries(metrics.gauges || {})) {
            const row = document.createElement("tr");
            const displayName = formatMetricName(name);
            const displayValue = formatMetricValue(name, value);
            row.innerHTML = `<td>${displayName}</td><td>${displayValue}</td>`;
            gaugesBody.appendChild(row);
        }

        // Add a "No data" row if empty
        if (Object.keys(metrics.gauges || {}).length === 0) {
            const row = document.createElement("tr");
            row.innerHTML = `<td colspan="2" style="text-align: center; color: var(--text-secondary, #666);">No gauge data available</td>`;
            gaugesBody.appendChild(row);
        }
    }

    // Update histograms table
    const histBody = document.querySelector("#histogramsTable tbody");
    if (histBody) {
        histBody.innerHTML = "";

        // Debug: log all metrics to see structure
        console.log("All metrics data:", metrics);

        // Try different data sources for histograms
        const histograms =
            metrics.histograms || metrics.legacy?.histograms || {};

        // Also check for legacy processingLatency data
        const legacyLatency =
            metrics.legacy?.processingLatency || metrics.processingLatency;

        console.log("Histogram data:", histograms);
        console.log("Legacy latency data:", legacyLatency);

        const histogramEntries = Object.entries(histograms);
        let hasData = false;

        // Add legacy processing latency if available
        if (
            legacyLatency &&
            Array.isArray(legacyLatency) &&
            legacyLatency.length > 0
        ) {
            hasData = true;
            const row = document.createElement("tr");
            const count = legacyLatency.length;
            const mean = legacyLatency.reduce((a, b) => a + b, 0) / count;
            const min = Math.min(...legacyLatency);
            const max = Math.max(...legacyLatency);

            row.innerHTML = `<td>Processing Latency (Legacy)</td><td>${formatNumber(count)}</td><td>${mean.toFixed(2)} ms</td><td>${min.toFixed(2)} ms</td><td>${max.toFixed(2)} ms</td>`;
            histBody.appendChild(row);
        }

        for (const [name, summary] of histogramEntries) {
            if (!summary) continue;

            hasData = true;
            const row = document.createElement("tr");
            const displayName = formatMetricName(name);
            const count = formatNumber(summary.count || 0);

            // Handle different unit types based on metric name
            let meanDisplay, minDisplay, maxDisplay;
            if (
                name.includes("duration") ||
                name.includes("latency") ||
                name.includes("time")
            ) {
                meanDisplay = summary.mean
                    ? `${summary.mean.toFixed(2)} ms`
                    : "0.00 ms";
                minDisplay = summary.min
                    ? `${summary.min.toFixed(2)} ms`
                    : "0 ms";
                maxDisplay = summary.max
                    ? `${summary.max.toFixed(2)} ms`
                    : "0 ms";
            } else {
                meanDisplay = summary.mean ? summary.mean.toFixed(3) : "0.000";
                minDisplay = summary.min ? summary.min.toFixed(3) : "0";
                maxDisplay = summary.max ? summary.max.toFixed(3) : "0";
            }

            row.innerHTML = `<td>${displayName}</td><td>${count}</td><td>${meanDisplay}</td><td>${minDisplay}</td><td>${maxDisplay}</td>`;
            histBody.appendChild(row);
        }

        // Add a "No data" row if empty, but show expected histogram metrics
        if (!hasData) {
            // Show expected histogram metrics even when no data is available
            const expectedHistograms = [
                "signal_manager_signal_confidence_distribution",
                "signal_manager_signal_processing_duration_ms",
                "signal_coordinator_processing_duration_seconds",
                "signal_manager_correlation_strength_distribution",
            ];

            for (const metricName of expectedHistograms) {
                const row = document.createElement("tr");
                const displayName = formatMetricName(metricName);
                row.innerHTML = `<td>${displayName}</td><td>0</td><td>0.00 ms</td><td>0 ms</td><td>0 ms</td>`;
                row.style.opacity = "0.6";
                histBody.appendChild(row);
                hasData = true;
            }

            if (!hasData) {
                const row = document.createElement("tr");
                row.innerHTML = `<td colspan="5" style="text-align: center; color: var(--text-secondary, #666);">No histogram data available</td>`;
                histBody.appendChild(row);
            }
        }
    }
}

function formatNumber(num) {
    if (typeof num !== "number") return num;
    if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
    if (num >= 1000) return (num / 1000).toFixed(1) + "K";
    return num.toLocaleString();
}

function formatMetricName(name) {
    // Convert snake_case to readable names
    const nameMap = {
        connections_active: "Active Connections",
        memory_usage: "Memory Usage (MB)",
        uptime: "System Uptime",
        "Stream.uptime": "Stream Uptime",
        processing_latency: "Processing Latency",
        trades_processed: "Trades Processed",
        signals_generated: "Signals Generated",
        anomalies_detected: "Anomalies Detected",
        orderbook_updates: "OrderBook Updates",
        websocket_messages: "WebSocket Messages",
        depth_snapshots: "Depth Snapshots",
        trade_events: "Trade Events",
        signal_coordinator_processed: "Signals Coordinated",
        detector_restarts: "Detector Restarts",
        error_count: "Error Count",
        health_checks: "Health Checks",
        // API connectivity metrics
        api_connectivity_issue_websocket_disconnected:
            "WebSocket Disconnections",
        api_connectivity_issue_asymmetric_streaming:
            "Asymmetric Streaming Issues",
        stream_connections_successful: "Successful Stream Connections",
        // Generic patterns
        api_connectivity_issue: "API Connectivity Issues",
        stream_connections: "Stream Connections",
    };

    // Handle dotted names like "Stream.uptime"
    if (nameMap[name]) {
        return nameMap[name];
    }

    // Handle general case: convert snake_case and dotted names
    return name
        .split(/[._]/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

function formatMetricValue(name, value) {
    if (typeof value !== "number") return value;

    // Handle special cases - make uptime detection more flexible
    if (name.toLowerCase().includes("uptime")) {
        return formatUptime(value);
    }

    if (name.includes("memory") || name.includes("Memory")) {
        // Convert bytes to MB if needed
        const mb = value > 1000000 ? Math.round(value / 1024 / 1024) : value;
        return `${mb.toLocaleString()} MB`;
    }

    if (name.includes("latency") || name.includes("Latency")) {
        return `${value.toFixed(2)} ms`;
    }

    if (
        name.includes("percentage") ||
        name.includes("ratio") ||
        (value >= 0 && value <= 1 && value % 1 !== 0)
    ) {
        return `${(value * 100).toFixed(1)}%`;
    }

    // Use the existing formatNumber for general cases
    return formatNumber(value);
}

function formatUptime(uptimeMs) {
    if (typeof uptimeMs !== "number") return uptimeMs;

    const seconds = Math.floor(uptimeMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
        return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

function updateSignalMetrics(metrics) {
    const counters = metrics.counters || {};
    const histograms = metrics.histograms || {};

    // Helper function to safely get counter value
    const getCounterValue = (name) => {
        const counter = counters[name];
        return typeof counter === "object" ? counter.value || 0 : counter || 0;
    };

    // Helper function to get rate per minute
    const getRate = (count, timeFrameMinutes = 1) => {
        if (!count || count === 0) return 0;
        // Simple rate calculation - could be enhanced with actual time tracking
        return (count / 60).toFixed(1); // per minute estimate
    };

    // Signal Processing Overview
    const signalCandidates = getCounterValue(
        "signal_coordinator_signals_received_total"
    );
    const signalsProcessed = getCounterValue(
        "signal_manager_signals_processed_total"
    );
    const signalsConfirmed = getCounterValue(
        "signal_manager_signals_confirmed_total"
    );
    const signalsRejected = getCounterValue(
        "signal_manager_rejections_detailed_total"
    );

    updateElement("signalCandidates", formatNumber(signalCandidates));
    updateElement("signalCandidatesRate", getRate(signalCandidates));
    updateElement("signalsProcessed", formatNumber(signalsProcessed));
    updateElement("signalsProcessedRate", getRate(signalsProcessed));
    updateElement("signalsConfirmed", formatNumber(signalsConfirmed));
    updateElement("signalsConfirmedRate", getRate(signalsConfirmed));
    updateElement("signalsRejected", formatNumber(signalsRejected));
    updateElement("signalsRejectedRate", getRate(signalsRejected));

    // Signal Types Breakdown
    const signalTypes = [
        "absorption",
        "exhaustion",
        "accumulation_zone",
        "distribution_zone",
        "cvd_confirmation",
    ];

    signalTypes.forEach((type) => {
        const candidates =
            getCounterValue(
                `signal_coordinator_signals_received_total_${type}`
            ) || 0;
        const confirmed =
            getCounterValue(`signal_manager_signals_confirmed_total_${type}`) ||
            0;
        const rejected =
            getCounterValue(
                `signal_manager_rejections_detailed_total_${type}`
            ) || 0;
        const total = confirmed + rejected;
        const successRate =
            total > 0 ? ((confirmed / total) * 100).toFixed(1) + "%" : "--";

        // Map signal types to HTML element prefixes
        let typePrefix;
        if (type === "cvd_confirmation") {
            typePrefix = "cvd";
        } else if (type === "accumulation_zone") {
            typePrefix = "accumulationZone";
        } else if (type === "distribution_zone") {
            typePrefix = "distributionZone";
        } else {
            typePrefix = type;
        }

        updateElement(`${typePrefix}Candidates`, formatNumber(candidates));
        updateElement(`${typePrefix}Confirmed`, formatNumber(confirmed));
        updateElement(`${typePrefix}Rejected`, formatNumber(rejected));
        updateElement(`${typePrefix}SuccessRate`, successRate);
    });

    // Rejection Reasons
    const rejectionReasons = [
        "low_confidence",
        "unhealthy_market",
        "processing_error",
        "timeout",
        "duplicate",
    ];

    const totalRejections = signalsRejected;

    rejectionReasons.forEach((reason) => {
        const count =
            getCounterValue(
                `signal_manager_rejection_reasons_total_${reason}`
            ) ||
            getCounterValue(`signal_manager_signal_rejected_${reason}_total`) ||
            0;
        const percentage =
            totalRejections > 0
                ? ((count / totalRejections) * 100).toFixed(1) + "%"
                : "--";

        const reasonCamelCase = reason.replace(/_([a-z])/g, (match, letter) =>
            letter.toUpperCase()
        );
        updateElement(
            `rejected${reasonCamelCase.charAt(0).toUpperCase() + reasonCamelCase.slice(1)}`,
            formatNumber(count)
        );
        updateElement(
            `rejected${reasonCamelCase.charAt(0).toUpperCase() + reasonCamelCase.slice(1)}Percent`,
            percentage
        );
    });

    // Signal Quality Metrics
    const confidenceHist =
        histograms["signal_manager_signal_confidence_distribution"];
    const correlationHist =
        histograms["signal_manager_correlation_strength_distribution"];
    const processingTimeHist =
        histograms["signal_manager_signal_processing_duration_ms"];

    updateElement(
        "avgConfidence",
        confidenceHist ? (confidenceHist.mean || 0).toFixed(3) : "--"
    );
    updateElement(
        "confidenceP50",
        confidenceHist ? getPercentile(confidenceHist, 50).toFixed(3) : "--"
    );
    updateElement(
        "confidenceP95",
        confidenceHist ? getPercentile(confidenceHist, 95).toFixed(3) : "--"
    );
    updateElement(
        "avgCorrelationStrength",
        correlationHist ? (correlationHist.mean || 0).toFixed(3) : "--"
    );
    updateElement(
        "avgProcessingTime",
        processingTimeHist
            ? `${(processingTimeHist.mean || 0).toFixed(2)} ms`
            : "--"
    );

    // Queue depth from gauges
    const queueDepth = metrics.gauges?.signal_coordinator_queue_size || 0;
    updateElement("queueDepth", formatNumber(queueDepth));
}

function updateElement(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = value;
    }
}

function getPercentile(histogram, percentile) {
    if (!histogram || !histogram.percentiles) return 0;
    return histogram.percentiles[`p${percentile}`] || 0;
}

function updateWorkerInfo(data) {
    const workers = data.workers || {};

    updateElement("loggerWorkerStatus", workers.loggerWorker || "Unknown");
    updateElement("binanceWorkerStatus", workers.binanceWorker || "Unknown");
    updateElement(
        "communicationWorkerStatus",
        workers.communicationWorker || "Unknown"
    );
    updateElement("wsConnections", formatNumber(workers.wsConnections || 0));
    updateElement("streamHealth", workers.streamHealth || "Unknown");
}

function updateVisuals(data) {
    const metrics = data.metrics || data;

    // Update connections number display
    const connVal =
        metrics.gauges?.connections_active ??
        metrics.legacy?.connectionsActive ??
        metrics.connections_active ??
        0;
    const connectionsElement = document.getElementById("connectionsNumber");
    if (connectionsElement) {
        connectionsElement.textContent = connVal.toString();
    }

    // Update tables with all metrics data
    updateTables(metrics);

    // Update signal metrics sections
    updateSignalMetrics(metrics);

    // Update worker information
    updateWorkerInfo(data);
}

function connect() {
    console.log("Connecting to stats WebSocket:", wsUrl);
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log("Stats WebSocket connected");
        pingTimer = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "ping" }));
            }
        }, 10000);
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            console.log("Received stats message:", msg.type, msg);

            if (msg.type === "stats") {
                updateVisuals(msg.data || msg);
            } else if (msg.type === "metrics") {
                updateVisuals(msg.data || msg);
            } else if (msg.type === "pong") {
                // Handle pong response
                console.log("Received pong");
            }
        } catch (err) {
            console.error("Stats parse error", err, "Raw data:", event.data);
        }
    };

    ws.onerror = (error) => {
        console.error("WebSocket error:", error);
    };

    ws.onclose = (event) => {
        console.log("Stats WebSocket closed:", event.code, event.reason);
        clearInterval(pingTimer);
        setTimeout(connect, 1000);
    };
}

function setupColumnResizing() {
    console.log("setupColumnResizing called");
    if (typeof interact === "undefined") {
        console.error("Interact.js not loaded - resizing will not work");
        return;
    }
    console.log("Interact.js is available, setting up resizing...");

    // Setup column resizing for all resizable table headers
    interact(".resizable").draggable({
        axis: "x",
        listeners: {
            start(event) {
                event.target.classList.add("resizing");
            },
            move(event) {
                const th = event.target;
                const table = th.closest("table");
                const columnIndex = Array.from(th.parentNode.children).indexOf(
                    th
                );

                // Get all cells in this column
                const cells = table.querySelectorAll(
                    `tr > *:nth-child(${columnIndex + 1})`
                );

                // Calculate new width
                const currentWidth = th.offsetWidth;
                const newWidth = Math.max(80, currentWidth + event.dx);

                // Apply new width to all cells in the column
                cells.forEach((cell) => {
                    cell.style.width = `${newWidth}px`;
                    cell.style.minWidth = `${newWidth}px`;
                    cell.style.maxWidth = `${newWidth}px`;
                });
            },
            end(event) {
                event.target.classList.remove("resizing");
            },
        },
    });
}

// Save and restore column widths
function saveColumnWidths() {
    const tables = document.querySelectorAll("table[id]");
    const widths = {};

    tables.forEach((table) => {
        const tableId = table.id;
        const headers = table.querySelectorAll("th.resizable");
        widths[tableId] = Array.from(headers).map((th) => th.offsetWidth);
    });

    localStorage.setItem("statsColumnWidths", JSON.stringify(widths));
}

function restoreColumnWidths() {
    try {
        const savedWidths = JSON.parse(
            localStorage.getItem("statsColumnWidths") || "{}"
        );

        Object.entries(savedWidths).forEach(([tableId, widths]) => {
            const table = document.getElementById(tableId);
            if (!table) return;

            const headers = table.querySelectorAll("th.resizable");
            widths.forEach((width, index) => {
                const th = headers[index];
                if (th && width) {
                    const columnIndex = Array.from(
                        th.parentNode.children
                    ).indexOf(th);
                    const cells = table.querySelectorAll(
                        `tr > *:nth-child(${columnIndex + 1})`
                    );

                    cells.forEach((cell) => {
                        cell.style.width = `${width}px`;
                        cell.style.minWidth = `${width}px`;
                        cell.style.maxWidth = `${width}px`;
                    });
                }
            });
        });
    } catch (error) {
        console.error("Failed to restore column widths:", error);
    }
}

// Auto-save column widths when they change
function setupAutoSave() {
    let saveTimeout;
    document.addEventListener("mouseup", () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(saveColumnWidths, 500);
    });
}

// Reset column widths for a specific table
function resetTableColumns(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return;

    const cells = table.querySelectorAll("th, td");
    cells.forEach((cell) => {
        cell.style.width = "";
        cell.style.minWidth = "";
        cell.style.maxWidth = "";
    });

    // Remove from saved widths
    try {
        const savedWidths = JSON.parse(
            localStorage.getItem("statsColumnWidths") || "{}"
        );
        delete savedWidths[tableId];
        localStorage.setItem("statsColumnWidths", JSON.stringify(savedWidths));
    } catch (error) {
        console.error("Failed to reset column widths:", error);
    }
}

// Make resetTableColumns globally available
window.resetTableColumns = resetTableColumns;

document.addEventListener("DOMContentLoaded", () => {
    console.log("DOM Content Loaded - initializing stats page");
    initVisuals();
    connect();

    // Setup column resizing after DOM is loaded - TEMPORARILY DISABLED FOR DEBUGGING
    // setTimeout(() => {
    //     try {
    //         console.log("Setting up column resizing...");
    //         restoreColumnWidths();
    //         setupColumnResizing();
    //         setupAutoSave();
    //         console.log("Column resizing setup complete");
    //     } catch (error) {
    //         console.error("Error setting up column resizing:", error);
    //     }
    // }, 100);
});
