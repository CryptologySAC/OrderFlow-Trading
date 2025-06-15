#!/usr/bin/env node

import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:3001");

let receivedPong = false;
let receivedBacklog = false;

ws.on("open", function open() {
    console.log(
        "✅ Connected to WebSocket server at",
        new Date().toISOString()
    );

    // Test 1: Send ping message
    const pingMessage = JSON.stringify({ type: "ping" });
    console.log("📤 Sending ping message:", pingMessage);
    ws.send(pingMessage);

    // Test 2: Send backlog message after delay
    setTimeout(() => {
        const backlogMessage = JSON.stringify({
            type: "backlog",
            data: { amount: 1000 },
        });
        console.log("📤 Sending backlog message:", backlogMessage);
        ws.send(backlogMessage);
    }, 1000);

    // Check results and close after tests
    setTimeout(() => {
        console.log("\n📊 Test Results:");
        console.log(
            "  - Ping/Pong:",
            receivedPong ? "✅ WORKING" : "❌ FAILED"
        );
        console.log(
            "  - Backlog:",
            receivedBacklog ? "✅ WORKING" : "❌ FAILED"
        );
        console.log("🔌 Closing connection...");
        ws.close();
    }, 5000);
});

ws.on("message", function message(data) {
    try {
        const parsed = JSON.parse(data);
        console.log("📥 Received message:", {
            type: parsed.type,
            dataLength: parsed.data
                ? Array.isArray(parsed.data)
                    ? parsed.data.length
                    : "object"
                : "none",
            timestamp: parsed.now || "none",
        });

        if (parsed.type === "pong") {
            console.log("✅ Ping/Pong working correctly!");
            receivedPong = true;
        } else if (parsed.type === "backlog") {
            console.log("✅ Backlog working correctly!");
            receivedBacklog = true;
        }
    } catch (error) {
        console.log("📥 Raw message:", data.toString());
    }
});

ws.on("error", function error(err) {
    console.error("❌ WebSocket error:", err.message);
});

ws.on("close", function close() {
    console.log("🔌 Connection closed");
    process.exit(0);
});

// Timeout after 10 seconds
setTimeout(() => {
    console.log("⏰ Test timeout - exiting");
    process.exit(1);
}, 10000);
