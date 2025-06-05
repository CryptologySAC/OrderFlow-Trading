const wsUrl = `wss://api.cryptology.pe/ltcusdt_trades`;
let ws;
let pingTimer;
let memoryGauge;
let latencyChart;

function initVisuals() {
    // Initialize memory gauge only
    if (typeof RadialGauge !== "undefined") {
        memoryGauge = new RadialGauge({
            renderTo: "memoryGauge",
            width: 200,
            height: 160,
            units: "MB",
            title: "Memory Usage",
            minValue: 0,
            maxValue: 1000,
            majorTicks: ["0", "200", "400", "600", "800", "1000"],
            minorTicks: 4,
            colorPlate: "#fff",
            borderShadowWidth: 0,
            borders: false,
            needleType: "arrow",
            colorNeedle: "#007bff",
            colorNeedleEnd: "#007bff",
            needleWidth: 2,
            needleCircleSize: 7,
            colorNeedleCircleOuter: "#007bff",
            needleCircleOuter: false,
            colorMajorTicks: "#444",
            colorMinorTicks: "#666",
            colorTitle: "#444",
            colorUnits: "#444",
            colorNumbers: "#444",
            animationRule: "bounce",
            animationDuration: 500,
        }).draw();
    }

    // Initialize latency chart
    if (typeof Chart !== "undefined") {
        const ctx = document.getElementById("latencyHistogram");
        if (ctx) {
            latencyChart = new Chart(ctx.getContext("2d"), {
                type: "bar",
                data: {
                    labels: ["p50", "p90", "p95", "p99"],
                    datasets: [
                        {
                            label: "Latency (ms)",
                            data: [0, 0, 0, 0],
                            backgroundColor: [
                                "rgba(75, 192, 192, 0.6)",
                                "rgba(54, 162, 235, 0.6)",
                                "rgba(255, 206, 86, 0.6)",
                                "rgba(255, 99, 132, 0.6)",
                            ],
                            borderColor: [
                                "rgba(75, 192, 192, 1)",
                                "rgba(54, 162, 235, 1)",
                                "rgba(255, 206, 86, 1)",
                                "rgba(255, 99, 132, 1)",
                            ],
                            borderWidth: 1,
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: false,
                        },
                        title: {
                            display: false,
                        },
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: "Latency (ms)",
                            },
                        },
                        x: {
                            title: {
                                display: true,
                                text: "Percentiles",
                            },
                        },
                    },
                    layout: {
                        padding: 10,
                    },
                },
            });
        }
    }
}

function updateTables(metrics) {
    // Update counters table
    const countersBody = document.querySelector("#countersTable tbody");
    if (countersBody) {
        countersBody.innerHTML = "";
        for (const [name, counter] of Object.entries(metrics.counters || {})) {
            const val =
                typeof counter === "object" && counter.value !== undefined
                    ? counter.value
                    : counter;
            const row = document.createElement("tr");
            row.innerHTML = `<td>${name}</td><td>${formatNumber(val)}</td>`;
            countersBody.appendChild(row);
        }

        // Add a "No data" row if empty
        if (Object.keys(metrics.counters || {}).length === 0) {
            const row = document.createElement("tr");
            row.innerHTML = `<td colspan="2" style="text-align: center; color: #666;">No counter data available</td>`;
            countersBody.appendChild(row);
        }
    }

    // Update gauges table
    const gaugesBody = document.querySelector("#gaugesTable tbody");
    if (gaugesBody) {
        gaugesBody.innerHTML = "";
        for (const [name, value] of Object.entries(metrics.gauges || {})) {
            const row = document.createElement("tr");
            row.innerHTML = `<td>${name}</td><td>${formatNumber(value)}</td>`;
            gaugesBody.appendChild(row);
        }

        // Add a "No data" row if empty
        if (Object.keys(metrics.gauges || {}).length === 0) {
            const row = document.createElement("tr");
            row.innerHTML = `<td colspan="2" style="text-align: center; color: #666;">No gauge data available</td>`;
            gaugesBody.appendChild(row);
        }
    }

    // Update histograms table
    const histBody = document.querySelector("#histogramsTable tbody");
    if (histBody) {
        histBody.innerHTML = "";
        for (const [name, summary] of Object.entries(
            metrics.histograms || {}
        )) {
            if (!summary) continue;
            const row = document.createElement("tr");
            const count = summary.count || 0;
            const mean = summary.mean ? summary.mean.toFixed(2) : "0.00";
            const min = summary.min || 0;
            const max = summary.max || 0;
            row.innerHTML = `<td>${name}</td><td>${count}</td><td>${mean}</td><td>${min}</td><td>${max}</td>`;
            histBody.appendChild(row);
        }

        // Add a "No data" row if empty
        if (Object.keys(metrics.histograms || {}).length === 0) {
            const row = document.createElement("tr");
            row.innerHTML = `<td colspan="5" style="text-align: center; color: #666;">No histogram data available</td>`;
            histBody.appendChild(row);
        }
    }
}

function formatNumber(num) {
    if (typeof num !== "number") return num;
    if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
    if (num >= 1000) return (num / 1000).toFixed(1) + "K";
    return num.toLocaleString();
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

    // Update memory gauge
    const memVal =
        metrics.gauges?.memory_usage ??
        metrics.legacy?.memoryUsage ??
        metrics.memory_usage;
    if (memoryGauge && typeof memVal === "number") {
        // Convert to MB if it's in bytes
        const memoryMB =
            memVal > 1000000 ? Math.round(memVal / 1024 / 1024) : memVal;
        memoryGauge.value = memoryMB;
    }

    // Update latency chart
    const latency =
        metrics.histograms?.processing_latency ??
        metrics.histograms?.latency ??
        metrics.legacy?.latency;

    if (latencyChart && latency) {
        let latencyData = [0, 0, 0, 0];

        if (latency.percentiles) {
            latencyData = [
                latency.percentiles.p50 || latency.percentiles["50"] || 0,
                latency.percentiles.p90 || latency.percentiles["90"] || 0,
                latency.percentiles.p95 || latency.percentiles["95"] || 0,
                latency.percentiles.p99 || latency.percentiles["99"] || 0,
            ];
        } else if (Array.isArray(latency)) {
            // Handle array format
            latencyData = latency.slice(0, 4);
        } else if (typeof latency === "object") {
            // Handle direct object format
            latencyData = [
                latency.p50 || latency["50"] || 0,
                latency.p90 || latency["90"] || 0,
                latency.p95 || latency["95"] || 0,
                latency.p99 || latency["99"] || 0,
            ];
        }

        latencyChart.data.datasets[0].data = latencyData;
        latencyChart.update("none");
    }

    updateTables(metrics);
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

document.addEventListener("DOMContentLoaded", () => {
    initVisuals();
    connect();
});
