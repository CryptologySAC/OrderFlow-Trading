import * as fs from "fs";
import * as readline from "readline";

const REJECTED_MISSED_LOG_PATH =
    "logs/signal_validation/absorption_rejected_missed_2025-08-25.jsonl";
const NEAR_MISS_REPORT_PATH = "analysis/reports/strong_near_misses.jsonl";

interface ThresholdCheck {
    threshold: number;
    calculated: number;
    op: string;
}

interface ThresholdChecks {
    [key: string]: ThresholdCheck | any;
}

interface RejectedMissedLog {
    rejectionReason: string;
    thresholdChecks: ThresholdChecks;
}

interface StrongNearMiss {
    rejectionReason: string;
    strongThresholds: Record<
        string,
        { threshold: number; calculated: number; factor: number }
    >;
    timestamp: number;
}

const STRONG_THRESHOLD_FACTORS = {
    minAggVolume: 5, // 5x the threshold
    maxPriceImpactRatio: 0.2, // 1/5th of the threshold
    minPassiveMultiplier: 3, // 3x the threshold
};

async function analyzeNearMisses() {
    const strongNearMisses: StrongNearMiss[] = [];

    const fileStream = fs.createReadStream(REJECTED_MISSED_LOG_PATH);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
    });

    for await (const line of rl) {
        try {
            const log: RejectedMissedLog & { timestamp: number } =
                JSON.parse(line);
            const strongThresholds: StrongNearMiss["strongThresholds"] = {};

            for (const key in STRONG_THRESHOLD_FACTORS) {
                if (log.thresholdChecks[key]) {
                    const check = log.thresholdChecks[key] as ThresholdCheck;
                    let isStrong = false;
                    let factor = 0;

                    if (
                        check.op === "EQL" &&
                        check.calculated >=
                            check.threshold * STRONG_THRESHOLD_FACTORS[key]
                    ) {
                        isStrong = true;
                        factor = check.calculated / check.threshold;
                    } else if (
                        check.op === "EQS" &&
                        check.calculated <=
                            check.threshold * STRONG_THRESHOLD_FACTORS[key]
                    ) {
                        isStrong = true;
                        factor = check.threshold / check.calculated;
                    }

                    if (isStrong) {
                        strongThresholds[key] = {
                            threshold: check.threshold,
                            calculated: check.calculated,
                            factor,
                        };
                    }
                }
            }

            // We are looking for cases where one or two minor thresholds fail, but at least one major threshold is very strong.
            if (Object.keys(strongThresholds).length > 0) {
                strongNearMisses.push({
                    rejectionReason: log.rejectionReason,
                    strongThresholds,
                    timestamp: log.timestamp,
                });
            }
        } catch (error) {
            console.error("Error parsing log line:", error);
        }
    }

    fs.writeFileSync(
        NEAR_MISS_REPORT_PATH,
        strongNearMisses.map((a) => JSON.stringify(a)).join("\n")
    );
    console.log(
        `Analysis complete. Found ${strongNearMisses.length} strong near-misses. Report saved to ${NEAR_MISS_REPORT_PATH}`
    );
}

analyzeNearMisses();
