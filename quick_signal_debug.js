// Quick debug: Check market health and signal processing
import { exec } from "child_process";

console.log("🔍 QUICK SIGNAL DEBUG");
console.log("====================\n");

// Check for the specific issues most likely to block signals
const checks = [
    'pm2 logs app --lines 50 | grep -E "(insufficient.*data|market health|isHealthy)" | tail -3',
    'pm2 logs app --lines 50 | grep -E "confidence.*0\\.4|rejected.*confidence" | tail -3',
    'pm2 logs app --lines 50 | grep -E "accumulation.*queued|signal.*received.*accumulation" | tail -3',
    'pm2 logs app --lines 50 | grep -E "WebSocket.*broadcast|confirmed.*signal" | tail -3',
];

const labels = [
    "Market Health Issues:",
    "Confidence Rejections:",
    "Signal Queueing:",
    "Signal Broadcasting:",
];

let index = 0;

function runCheck() {
    if (index >= checks.length) {
        console.log("\n💡 SOLUTION:");
        console.log(
            'If you see "insufficient data" -> Market needs more time to collect snapshots'
        );
        console.log(
            "If you see confidence rejections -> Check confidence thresholds in config.json"
        );
        console.log(
            "If signals are queued but not broadcast -> Check WebSocket connection"
        );
        console.log("If no signals are queued -> Check detector registration");
        return;
    }

    console.log(labels[index]);
    exec(checks[index], (error, stdout) => {
        console.log(stdout.trim() || "❌ No matches found");
        console.log("");
        index++;
        setTimeout(runCheck, 500);
    });
}

runCheck();
