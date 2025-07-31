#!/usr/bin/env npx tsx

import * as fs from "fs";
import * as path from "path";
import { FinancialMath } from "./src/utils/financialMath.js";

// Type definitions for analysis
interface RejectionRecord {
    timestamp: string;
    detector: string;
    symbol: string;
    price: string;
    reason: string;
    details: string;
    context: string;
}

interface ParsedRejection {
    timestamp: Date;
    price: number;
    reason: string;
    thresholdType: string;
    thresholdValue: number;
    actualValue: number;
    ratio: number;
    aggressiveVolume: number;
    passiveVolume: number;
    marketContext: string;
}

interface NearMissAnalysis {
    rejection: ParsedRejection;
    reductionNeeded: number; // Percentage threshold needs to be reduced
    optimizationPotential: "HIGH" | "MEDIUM" | "LOW";
}

interface RejectionGroupAnalysis {
    reason: string;
    count: number;
    averageRatio: number;
    bestRatio: number;
    averageReductionNeeded: number;
    nearMisses: NearMissAnalysis[];
}

class AbsorptionNearMissAnalyzer {
    private readonly csvFilePath: string;
    private readonly topNearMisses: number = 20;

    constructor(csvFilePath: string) {
        this.csvFilePath = csvFilePath;
    }

    /**
     * Main analysis entry point
     */
    public async analyze(): Promise<void> {
        console.log("🔍 Absorption Detector Near-Miss Analysis");
        console.log("=========================================\n");

        try {
            const rejections = await this.loadRejectionData();
            const absorptionRejections =
                this.filterAbsorptionRejections(rejections);
            console.log(
                `📊 Total absorption rejections: ${absorptionRejections.length}`
            );

            const parsedRejections = this.parseRejections(absorptionRejections);
            console.log(
                `✅ Successfully parsed: ${parsedRejections.length} rejections\n`
            );

            const nearMisses = this.identifyNearMisses(parsedRejections);
            const groupedAnalysis = this.groupByRejectionType(nearMisses);

            this.displayTopNearMisses(nearMisses);
            this.displayGroupedAnalysis(groupedAnalysis);
            this.displayOptimizationRecommendations(groupedAnalysis);
        } catch (error) {
            console.error("❌ Analysis failed:", error);
            process.exit(1);
        }
    }

    /**
     * Load and parse CSV rejection data
     */
    private async loadRejectionData(): Promise<RejectionRecord[]> {
        if (!fs.existsSync(this.csvFilePath)) {
            throw new Error(`CSV file not found: ${this.csvFilePath}`);
        }

        const csvContent = fs.readFileSync(this.csvFilePath, "utf-8");
        const lines = csvContent.trim().split("\n");

        if (lines.length < 2) {
            throw new Error("CSV file appears to be empty or malformed");
        }

        const headers = lines[0]
            .split(",")
            .map((h) => h.trim().replace(/"/g, ""));
        const records: RejectionRecord[] = [];

        for (let i = 1; i < lines.length; i++) {
            const values = this.parseCsvLine(lines[i]);
            if (values.length === headers.length) {
                const record: RejectionRecord = {
                    timestamp: values[0],
                    detector: values[1],
                    symbol: values[2],
                    price: values[3],
                    reason: values[4],
                    details: values[5],
                    context: values[6],
                };
                records.push(record);
            }
        }

        return records;
    }

    /**
     * Parse CSV line handling quoted values
     */
    private parseCsvLine(line: string): string[] {
        const values: string[] = [];
        let current = "";
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === "," && !inQuotes) {
                values.push(current.trim());
                current = "";
            } else {
                current += char;
            }
        }

        values.push(current.trim());
        return values.map((v) => v.replace(/^"|"$/g, ""));
    }

    /**
     * Filter for absorption detector rejections only
     */
    private filterAbsorptionRejections(
        records: RejectionRecord[]
    ): RejectionRecord[] {
        return records.filter((record) =>
            record.detector.toLowerCase().includes("absorption")
        );
    }

    /**
     * Parse rejection records and extract threshold comparisons
     */
    private parseRejections(records: RejectionRecord[]): ParsedRejection[] {
        const parsed: ParsedRejection[] = [];

        for (const record of records) {
            try {
                const thresholdData = this.extractThresholdData(
                    record.reason,
                    record.details
                );
                if (!thresholdData) continue;

                const contextData = this.parseContext(record.context);

                const parsedRejection: ParsedRejection = {
                    timestamp: new Date(record.timestamp),
                    price: parseFloat(record.price),
                    reason: record.reason,
                    thresholdType: thresholdData.type,
                    thresholdValue: thresholdData.threshold,
                    actualValue: thresholdData.actual,
                    ratio:
                        FinancialMath.safeDivision(
                            thresholdData.actual,
                            thresholdData.threshold
                        ) || 0,
                    aggressiveVolume: contextData.aggressiveVolume,
                    passiveVolume: contextData.passiveVolume,
                    marketContext: this.determineMarketContext(
                        contextData.aggressiveVolume,
                        contextData.passiveVolume
                    ),
                };

                parsed.push(parsedRejection);
            } catch (error) {
                // Skip malformed records
                continue;
            }
        }

        return parsed;
    }

    /**
     * Extract threshold and actual values from rejection reason and details
     */
    private extractThresholdData(
        reason: string,
        details: string
    ): { type: string; threshold: number; actual: number } | null {
        const combined = `${reason} ${details}`.toLowerCase();

        // Pattern matching for various threshold types
        const patterns = [
            // Absorption threshold patterns
            {
                regex: /absorption.*threshold.*?(\d+\.?\d*)[^\d]*actual.*?(\d+\.?\d*)/,
                type: "absorptionThreshold",
            },
            // Volume patterns
            {
                regex: /min.*agg.*volume.*?(\d+\.?\d*)[^\d]*actual.*?(\d+\.?\d*)/,
                type: "minAggVolume",
            },
            // Price efficiency patterns
            {
                regex: /price.*efficiency.*threshold.*?(\d+\.?\d*)[^\d]*actual.*?(\d+\.?\d*)/,
                type: "priceEfficiencyThreshold",
            },
            // Spread impact patterns
            {
                regex: /spread.*impact.*threshold.*?(\d+\.?\d*)[^\d]*actual.*?(\d+\.?\d*)/,
                type: "spreadImpactThreshold",
            },
            // Velocity patterns
            {
                regex: /velocity.*threshold.*?(\d+\.?\d*)[^\d]*actual.*?(\d+\.?\d*)/,
                type: "velocityThreshold",
            },
            // Passive multiplier patterns
            {
                regex: /passive.*multiplier.*?(\d+\.?\d*)[^\d]*actual.*?(\d+\.?\d*)/,
                type: "minPassiveMultiplier",
            },
        ];

        for (const pattern of patterns) {
            const match = combined.match(pattern.regex);
            if (match) {
                const threshold = parseFloat(match[1]);
                const actual = parseFloat(match[2]);

                if (!isNaN(threshold) && !isNaN(actual) && threshold > 0) {
                    return {
                        type: pattern.type,
                        threshold,
                        actual,
                    };
                }
            }
        }

        return null;
    }

    /**
     * Parse context data for volume information
     */
    private parseContext(context: string): {
        aggressiveVolume: number;
        passiveVolume: number;
    } {
        let aggressiveVolume = 0;
        let passiveVolume = 0;

        try {
            // Try to parse as JSON first
            const contextObj = JSON.parse(context);
            aggressiveVolume =
                contextObj.aggressiveVolume || contextObj.aggVolume || 0;
            passiveVolume = contextObj.passiveVolume || 0;
        } catch {
            // Fallback to regex parsing
            const aggMatch = context.match(
                /aggressive.*?volume.*?(\d+\.?\d*)/i
            );
            const passMatch = context.match(/passive.*?volume.*?(\d+\.?\d*)/i);

            if (aggMatch) aggressiveVolume = parseFloat(aggMatch[1]);
            if (passMatch) passiveVolume = parseFloat(passMatch[1]);
        }

        return { aggressiveVolume, passiveVolume };
    }

    /**
     * Determine market context based on volume relationship
     */
    private determineMarketContext(
        aggressiveVolume: number,
        passiveVolume: number
    ): string {
        if (aggressiveVolume === 0 && passiveVolume === 0) {
            return "NO_VOLUME";
        }

        const totalVolume = FinancialMath.safeAdd(
            aggressiveVolume,
            passiveVolume
        );
        if (totalVolume === 0) {
            return "NO_VOLUME";
        }

        const aggressiveRatio =
            FinancialMath.safeDivision(aggressiveVolume, totalVolume) || 0;

        if (aggressiveRatio >= 0.7) {
            return "AGGRESSIVE_DOMINANT";
        } else if (aggressiveRatio >= 0.3) {
            return "BALANCED";
        } else {
            return "PASSIVE_DOMINANT";
        }
    }

    /**
     * Identify near-miss rejections with highest ratios
     */
    private identifyNearMisses(
        rejections: ParsedRejection[]
    ): NearMissAnalysis[] {
        const nearMisses: NearMissAnalysis[] = [];

        for (const rejection of rejections) {
            if (rejection.ratio > 0 && rejection.ratio < 1.0) {
                const reductionNeeded =
                    FinancialMath.safeMultiply(
                        FinancialMath.safeSubtraction(1, rejection.ratio),
                        100
                    ) || 0;

                const optimizationPotential = this.assessOptimizationPotential(
                    rejection.ratio,
                    reductionNeeded
                );

                nearMisses.push({
                    rejection,
                    reductionNeeded,
                    optimizationPotential,
                });
            }
        }

        // Sort by ratio descending (closest to 1.0 first)
        return nearMisses.sort((a, b) => b.rejection.ratio - a.rejection.ratio);
    }

    /**
     * Assess optimization potential based on ratio and reduction needed
     */
    private assessOptimizationPotential(
        ratio: number,
        reductionNeeded: number
    ): "HIGH" | "MEDIUM" | "LOW" {
        if (ratio >= 0.9 && reductionNeeded <= 10) {
            return "HIGH";
        } else if (ratio >= 0.7 && reductionNeeded <= 25) {
            return "MEDIUM";
        } else {
            return "LOW";
        }
    }

    /**
     * Group analysis by rejection reason type
     */
    private groupByRejectionType(
        nearMisses: NearMissAnalysis[]
    ): RejectionGroupAnalysis[] {
        const groups = new Map<string, NearMissAnalysis[]>();

        // Group by threshold type
        for (const nearMiss of nearMisses) {
            const thresholdType = nearMiss.rejection.thresholdType;
            if (!groups.has(thresholdType)) {
                groups.set(thresholdType, []);
            }
            groups.get(thresholdType)!.push(nearMiss);
        }

        // Create analysis for each group
        const analyses: RejectionGroupAnalysis[] = [];
        for (const [reason, misses] of groups) {
            const ratios = misses.map((m) => m.rejection.ratio);
            const reductions = misses.map((m) => m.reductionNeeded);

            analyses.push({
                reason,
                count: misses.length,
                averageRatio: FinancialMath.calculateMean(ratios),
                bestRatio: Math.max(...ratios),
                averageReductionNeeded: FinancialMath.calculateMean(reductions),
                nearMisses: misses.slice(0, 5), // Top 5 for each group
            });
        }

        return analyses.sort((a, b) => b.bestRatio - a.bestRatio);
    }

    /**
     * Display top near-miss rejections
     */
    private displayTopNearMisses(nearMisses: NearMissAnalysis[]): void {
        console.log(`🎯 Top ${this.topNearMisses} Near-Miss Rejections`);
        console.log("=".repeat(50));

        const topMisses = nearMisses.slice(0, this.topNearMisses);

        for (let i = 0; i < topMisses.length; i++) {
            const analysis = topMisses[i];
            const rejection = analysis.rejection;

            console.log(
                `\n${i + 1}. ${analysis.optimizationPotential} POTENTIAL`
            );
            console.log(`   Timestamp: ${rejection.timestamp.toISOString()}`);
            console.log(`   Price: $${rejection.price.toFixed(4)}`);
            console.log(`   Rejection: ${rejection.reason}`);
            console.log(`   Threshold Type: ${rejection.thresholdType}`);
            console.log(`   Threshold: ${rejection.thresholdValue}`);
            console.log(`   Actual: ${rejection.actualValue}`);
            console.log(`   Ratio: ${(rejection.ratio * 100).toFixed(2)}%`);
            console.log(
                `   Reduction Needed: ${analysis.reductionNeeded.toFixed(2)}%`
            );
            console.log(`   Aggressive Volume: ${rejection.aggressiveVolume}`);
            console.log(`   Passive Volume: ${rejection.passiveVolume}`);
            console.log(`   Market Context: ${rejection.marketContext}`);
        }
    }

    /**
     * Display grouped analysis by rejection type
     */
    private displayGroupedAnalysis(groups: RejectionGroupAnalysis[]): void {
        console.log("\n\n📊 Analysis by Rejection Type");
        console.log("=".repeat(50));

        for (const group of groups) {
            console.log(`\n🔍 ${group.reason.toUpperCase()}`);
            console.log(`   Count: ${group.count} rejections`);
            console.log(
                `   Average Ratio: ${(group.averageRatio * 100).toFixed(2)}%`
            );
            console.log(
                `   Best Ratio: ${(group.bestRatio * 100).toFixed(2)}%`
            );
            console.log(
                `   Average Reduction Needed: ${group.averageReductionNeeded.toFixed(2)}%`
            );

            if (group.nearMisses.length > 0) {
                console.log(`   Top Near-Misses:`);
                for (let i = 0; i < Math.min(3, group.nearMisses.length); i++) {
                    const miss = group.nearMisses[i];
                    console.log(
                        `     • ${(miss.rejection.ratio * 100).toFixed(1)}% ratio, ${miss.reductionNeeded.toFixed(1)}% reduction needed`
                    );
                }
            }
        }
    }

    /**
     * Display optimization recommendations
     */
    private displayOptimizationRecommendations(
        groups: RejectionGroupAnalysis[]
    ): void {
        console.log("\n\n🚀 Optimization Recommendations");
        console.log("=".repeat(50));

        // Sort by optimization potential
        const prioritized = groups.sort((a, b) => {
            const aHighPotential = a.nearMisses.filter(
                (m) => m.optimizationPotential === "HIGH"
            ).length;
            const bHighPotential = b.nearMisses.filter(
                (m) => m.optimizationPotential === "HIGH"
            ).length;
            return bHighPotential - aHighPotential;
        });

        for (let i = 0; i < Math.min(5, prioritized.length); i++) {
            const group = prioritized[i];
            const highPotential = group.nearMisses.filter(
                (m) => m.optimizationPotential === "HIGH"
            ).length;

            console.log(`\n${i + 1}. ${group.reason.toUpperCase()}`);
            console.log(
                `   Priority: ${highPotential > 0 ? "HIGH" : group.nearMisses.length > 5 ? "MEDIUM" : "LOW"}`
            );
            console.log(
                `   Recommended Reduction: ${Math.min(group.averageReductionNeeded, 25).toFixed(1)}%`
            );
            console.log(
                `   Expected Additional Signals: ${Math.min(group.count, 10)}`
            );
            console.log(
                `   Risk Assessment: ${group.averageReductionNeeded > 20 ? "MEDIUM - Review for false positives" : "LOW - Safe optimization"}`
            );
        }

        console.log("\n💡 Implementation Notes:");
        console.log("• Start with parameters showing <15% reduction needed");
        console.log("• Test in simulation environment first");
        console.log("• Monitor false positive rates after adjustments");
        console.log("• Consider A/B testing for critical parameters");
    }
}

// Script execution
const csvPath =
    "/Users/marcschot/Projects/OrderFlow Trading/logs/signal_validation/signal_rejections_2025-07-31.csv";
const analyzer = new AbsorptionNearMissAnalyzer(csvPath);

analyzer.analyze().catch((error) => {
    console.error("Script execution failed:", error);
    process.exit(1);
});
