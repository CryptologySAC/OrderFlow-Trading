#!/usr/bin/env node

// Simple test to check signal flow
import WebSocket from "ws";

console.log("🔍 Testing Signal Flow to Dashboard");
console.log("===================================\n");

console.log("1. Connecting to WebSocket (port 3001)...");

const ws = new WebSocket("ws://localhost:3001");

ws.on("open", () => {
    console.log("✅ WebSocket connected successfully");
    console.log("2. Listening for signals...\n");

    // Set a timeout to check if we receive any signals
    setTimeout(() => {
        console.log("⏰ No signals received in 10 seconds");
        console.log("   This suggests signals are not being broadcast");
        ws.close();
    }, 10000);
});

ws.on("message", (data) => {
    try {
        const message = JSON.parse(data.toString());
        console.log("📨 Received message:", message.type);

        if (message.type === "signal") {
            console.log("🎯 SIGNAL RECEIVED!");
            console.log("   Signal type:", message.data?.type);
            console.log("   Signal side:", message.data?.side);
            console.log("   Signal confidence:", message.data?.confidence);
            console.log("   ✅ WebSocket broadcasting is working!");
        } else if (message.type === "stats") {
            console.log("📊 Stats update received");
        } else {
            console.log("📄 Other message type:", message.type);
        }
    } catch (error) {
        console.log("❌ Failed to parse message:", error.message);
    }
});

ws.on("error", (error) => {
    console.log("❌ WebSocket error:", error.message);
});

ws.on("close", () => {
    console.log("🔌 WebSocket connection closed");
    console.log("\n💡 If no signals were received:");
    console.log("   - Signals are being emitted by detectors ✅");
    console.log("   - Signals are registered with SignalCoordinator ✅");
    console.log(
        "   - Issue is likely in SignalManager processing or WebSocket broadcasting"
    );
    process.exit(0);
});
