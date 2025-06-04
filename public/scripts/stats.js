const WS_PORT = 3001;
const wsUrl = `ws://${window.location.hostname}:${WS_PORT}`;

let ws;
let pingTimer;
let connectionsGauge;
let memoryGauge;
let latencyChart;

function initVisuals() {
    if (typeof RadialGauge !== "undefined") {
        connectionsGauge = new RadialGauge({
            renderTo: "connectionsGauge",
            width: 200,
            height: 160,
            units: "Connections",
            title: "Active",
            minValue: 0,
            maxValue: 100,
            majorTicks: ["0", "20", "40", "60", "80", "100"],
            minorTicks: 4,
        }).draw();
        memoryGauge = new RadialGauge({
            renderTo: "memoryGauge",
            width: 200,
            height: 160,
            units: "MB",
            title: "Memory",
            minValue: 0,
            maxValue: 1000,
            majorTicks: ["0", "200", "400", "600", "800", "1000"],
            minorTicks: 4,
        }).draw();
    }

    if (typeof Chart !== "undefined") {
        const ctx = document
            .getElementById("latencyHistogram")
            .getContext("2d");
        latencyChart = new Chart(ctx, {
            type: "bar",
            data: {
                labels: ["p50", "p90", "p95", "p99"],
                datasets: [
                    {
                        label: "Latency (ms)",
                        data: [0, 0, 0, 0],
                        backgroundColor: "rgba(54, 162, 235, 0.5)",
                    },
                ],
            },
            options: {
                responsive: true,
                scales: {
                    y: { beginAtZero: true },
                },
            },
        });
    }
}

function updateTables(metrics) {
    const countersBody = document.querySelector("#countersTable tbody");
    countersBody.innerHTML = "";
    for (const [name, counter] of Object.entries(metrics.counters || {})) {
        const val =
            typeof counter === "object" && counter.value !== undefined
                ? counter.value
                : counter;
        const row = document.createElement("tr");
        row.innerHTML = `<td>${name}</td><td>${val}</td>`;
        countersBody.appendChild(row);
    }

    const gaugesBody = document.querySelector("#gaugesTable tbody");
    gaugesBody.innerHTML = "";
    for (const [name, value] of Object.entries(metrics.gauges || {})) {
        const row = document.createElement("tr");
        row.innerHTML = `<td>${name}</td><td>${value}</td>`;
        gaugesBody.appendChild(row);
    }

    const histBody = document.querySelector("#histogramsTable tbody");
    histBody.innerHTML = "";
    for (const [name, summary] of Object.entries(metrics.histograms || {})) {
        if (!summary) continue;
        const row = document.createElement("tr");
        row.innerHTML = `<td>${name}</td><td>${summary.count}</td><td>${summary.mean.toFixed(2)}</td><td>${summary.min}</td><td>${summary.max}</td>`;
        histBody.appendChild(row);
    }
}

function updateVisuals(data) {
    const metrics = data.metrics;
    const connVal =
        metrics.gauges?.connections_active ?? metrics.legacy?.connectionsActive;
    if (connectionsGauge && typeof connVal === "number") {
        connectionsGauge.value = connVal;
    }
    const memVal = metrics.gauges?.memory_usage;
    if (memoryGauge && typeof memVal === "number") {
        memoryGauge.value = memVal;
    }
    const latency = metrics.histograms?.processing_latency;
    if (latencyChart && latency && latency.percentiles) {
        latencyChart.data.datasets[0].data = [
            latency.percentiles.p50 || 0,
            latency.percentiles.p90 || 0,
            latency.percentiles.p95 || 0,
            latency.percentiles.p99 || 0,
        ];
        latencyChart.update("none");
    }
    updateTables(metrics);
}

function connect() {
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
        pingTimer = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "ping" }));
            }
        }, 10000);
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.type === "stats") {
                updateVisuals(msg.data);
            }
        } catch (err) {
            console.error("Stats parse error", err);
        }
    };

    ws.onclose = () => {
        clearInterval(pingTimer);
        setTimeout(connect, 1000);
    };
}

document.addEventListener("DOMContentLoaded", () => {
    initVisuals();
    connect();
});
