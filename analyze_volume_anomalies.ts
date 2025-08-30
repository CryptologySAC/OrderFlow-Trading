import * as fs from "fs";
import * as readline from "readline";

const REJECTION_LOG_PATH =
    "logs/signal_validation/absorption_rejections_2025-08-25.jsonl";
const ANOMALY_OUTPUT_PATH = "analysis/reports/volume_anomalies_report.jsonl";

interface RejectionLog {
    timestamp: number;
    rejectionReason: string;
    thresholdType: string;
    actualValue: number;
    price: number;
}

interface Anomaly {
    timestamp: number;
    price: number;
    anomalyType: string;
    value: number;
    rollingAverage: number;
    deviation: number;
}

const ROLLING_WINDOW_SIZE = 100;
const ANOMALY_THRESHOLD_STD_DEV = 2.5;

async function analyzeVolumeAnomalies() {
    const passiveVolumeValues: number[] = [];
    const anomalies: Anomaly[] = [];
    let rollingSum = 0;

    const fileStream = fs.createReadStream(REJECTION_LOG_PATH);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
    });

    for await (const line of rl) {
        try {
            const log: RejectionLog = JSON.parse(line);

            if (log.thresholdType === "passive_volume_ratio") {
                const value = log.actualValue;
                passiveVolumeValues.push(value);
                rollingSum += value;

                if (passiveVolumeValues.length > ROLLING_WINDOW_SIZE) {
                    rollingSum -= passiveVolumeValues.shift()!;
                    const rollingAverage = rollingSum / ROLLING_WINDOW_SIZE;
                    const stdDev = Math.sqrt(
                        passiveVolumeValues.reduce(
                            (sq, n) => sq + Math.pow(n - rollingAverage, 2),
                            0
                        ) / ROLLING_WINDOW_SIZE
                    );

                    if (
                        value >
                        rollingAverage + stdDev * ANOMALY_THRESHOLD_STD_DEV
                    ) {
                        anomalies.push({
                            timestamp: log.timestamp,
                            price: log.price,
                            anomalyType: "positive_passive_volume_anomaly",
                            value: value,
                            rollingAverage: rollingAverage,
                            deviation: (value - rollingAverage) / stdDev,
                        });
                    }
                }
            }
        } catch (error) {
            console.error("Error parsing log line:", error);
        }
    }

    fs.writeFileSync(
        ANOMALY_OUTPUT_PATH,
        anomalies.map((a) => JSON.stringify(a)).join("\n")
    );
    console.log(
        `Analysis complete. Found ${anomalies.length} anomalies. Report saved to ${ANOMALY_OUTPUT_PATH}`
    );
}

analyzeVolumeAnomalies();
