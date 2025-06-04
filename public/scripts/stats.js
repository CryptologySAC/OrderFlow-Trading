const wsUrl = `wss://api.cryptology.pe/ltcusdt_trades`;
let ws;
let pingTimer;

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
                document.getElementById("stats").textContent = JSON.stringify(
                    msg.data,
                    null,
                    2
                );
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

connect();
