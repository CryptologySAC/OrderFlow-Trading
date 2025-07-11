#!/usr/bin/env node

// Debug script to check why signals are not appearing in dashboard/stats
// This script checks the signal processing pipeline step by step

import { exec } from "child_process";
import fs from "fs";

console.log("🔍 SIGNAL FLOW DIAGNOSTIC SCRIPT");
console.log("=================================\n");

// Check if the application is running
exec("pm2 list | grep app", (error, stdout, stderr) => {
    if (error) {
        console.log("❌ PM2 Error:", error.message);
        return;
    }

    console.log("📊 PM2 Status:");
    console.log(stdout);
    console.log("");

    // Check recent logs for signal processing
    console.log("🔍 Checking recent logs for signal flow...\n");

    const logChecks = [
        {
            name: "Accumulation Signals Emitted",
            pattern: "ENHANCED ACCUMULATION SIGNAL EMITTED",
        },
        {
            name: "Signal Coordinator Received",
            pattern: "signal_coordinator_signals_received_total",
        },
        {
            name: "Signal Manager Processing",
            pattern: "SignalManager.*process",
        },
        {
            name: "Market Health Issues",
            pattern: "market health|insufficient.*data|isHealthy.*false",
        },
        {
            name: "Confidence Threshold Rejections",
            pattern: "confidence threshold|low_confidence",
        },
        {
            name: "Confirmed Signals",
            pattern: "signals_confirmed_total|signal confirmed",
        },
    ];

    let checkIndex = 0;

    function runNextCheck() {
        if (checkIndex >= logChecks.length) {
            console.log("\n📋 DIAGNOSTIC SUMMARY:");
            console.log(
                "1. Check if signals are being emitted by detectors ✅"
            );
            console.log("2. Check if SignalCoordinator is receiving them");
            console.log("3. Check if SignalManager is processing them");
            console.log("4. Check market health status");
            console.log("5. Check confidence threshold filtering");
            console.log("6. Check if any signals are being confirmed");
            console.log("\n💡 LIKELY ISSUES:");
            console.log("- Market health check failing (insufficient data)");
            console.log("- Confidence threshold too high");
            console.log("- WebSocket broadcasting not working");
            console.log("- Dashboard/stats not connected to WebSocket");
            return;
        }

        const check = logChecks[checkIndex];
        console.log(`🔍 ${check.name}:`);

        exec(
            `pm2 logs app --lines 100 | grep -i "${check.pattern}" | tail -5`,
            (error, stdout, stderr) => {
                if (stdout.trim()) {
                    console.log("✅ Found:");
                    console.log(stdout.trim());
                } else {
                    console.log("❌ Not found in recent logs");
                }
                console.log("");

                checkIndex++;
                setTimeout(runNextCheck, 1000); // Small delay between checks
            }
        );
    }

    runNextCheck();
});

console.log("🎯 Key things to check:");
console.log("1. Are accumulation signals being emitted by detectors?");
console.log("2. Is SignalCoordinator receiving and queuing them?");
console.log("3. Is SignalManager processing them?");
console.log("4. Is market health check blocking them?");
console.log("5. Are confidence thresholds filtering them out?");
console.log("6. Are confirmed signals being broadcast to WebSocket?");
console.log("");
