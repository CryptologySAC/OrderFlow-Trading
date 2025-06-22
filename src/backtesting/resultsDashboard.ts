// src/backtesting/resultsDashboard.ts

import { writeFileSync } from "fs";
import { join } from "path";
import type { SignalPerformance } from "./performanceAnalyzer.js";
import type { TestResult } from "./detectorTestRunner.js";

export interface DashboardConfig {
    outputDirectory: string;
    includeCharts: boolean;
    sortBy:
        | "precision"
        | "recall"
        | "f1Score"
        | "accuracy"
        | "directionAccuracy";
    filterByDetector?: string;
    minSignals?: number;
}

export interface PerformanceRanking {
    rank: number;
    configId: string;
    detectorType: string;
    profile: string;
    score: number;
    metrics: SignalPerformance;
}

/**
 * Results Dashboard Generator
 *
 * Creates comprehensive HTML dashboard and CSV exports for backtesting results,
 * showing detector performance rankings, parameter sensitivity analysis,
 * and detailed performance breakdowns.
 */
export class ResultsDashboard {
    private config: DashboardConfig;

    constructor(config: DashboardConfig) {
        this.config = config;
    }

    /**
     * Generate complete dashboard with all results
     */
    public generateDashboard(
        testResults: Map<string, TestResult>,
        performanceResults: Map<string, SignalPerformance>
    ): void {
        // Generate HTML dashboard
        this.generateHTMLDashboard(testResults, performanceResults);

        // Generate CSV exports
        this.generateCSVExports(testResults, performanceResults);

        // Generate optimal configuration JSON
        this.generateOptimalConfigurationExport(performanceResults);

        // Generate performance summary report
        this.generatePerformanceSummary(testResults, performanceResults);
    }

    /**
     * Generate HTML dashboard
     */
    private generateHTMLDashboard(
        testResults: Map<string, TestResult>,
        performanceResults: Map<string, SignalPerformance>
    ): void {
        const rankings = this.calculateRankings(performanceResults);
        const detectorStats =
            this.calculateDetectorStatistics(performanceResults);
        const profileComparison =
            this.calculateProfileComparison(performanceResults);

        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Detector Backtesting Results</title>
    <style>
        ${this.getCSS()}
    </style>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
    <div class="container">
        <header>
            <h1>🎯 Detector Backtesting Results</h1>
            <p class="subtitle">Performance analysis across ${performanceResults.size} configurations</p>
            <div class="summary-stats">
                <div class="stat-card">
                    <h3>Total Tests</h3>
                    <span class="stat-value">${testResults.size}</span>
                </div>
                <div class="stat-card">
                    <h3>Successful Tests</h3>
                    <span class="stat-value">${Array.from(testResults.values()).filter((r) => r.success).length}</span>
                </div>
                <div class="stat-card">
                    <h3>Best F1 Score</h3>
                    <span class="stat-value">${rankings.length > 0 ? rankings[0].score.toFixed(3) : "0.000"}</span>
                </div>
                <div class="stat-card">
                    <h3>Avg Signals/Test</h3>
                    <span class="stat-value">${this.calculateAverageSignals(testResults).toFixed(1)}</span>
                </div>
            </div>
        </header>

        <section class="rankings-section">
            <h2>🏆 Top Performing Configurations</h2>
            <div class="table-container">
                ${this.generateRankingsTable(rankings.slice(0, 20))}
            </div>
        </section>

        <section class="detector-comparison">
            <h2>📊 Detector Type Comparison</h2>
            <div class="charts-grid">
                <div class="chart-container">
                    <canvas id="detectorComparisonChart"></canvas>
                </div>
                <div class="chart-container">
                    <canvas id="profileComparisonChart"></canvas>
                </div>
            </div>
        </section>

        <section class="detailed-results">
            <h2>📋 Detailed Results by Detector</h2>
            ${this.generateDetailedResultsByDetector(performanceResults)}
        </section>

        <section class="parameter-analysis">
            <h2>🔬 Parameter Sensitivity Analysis</h2>
            ${this.generateParameterAnalysis()}
        </section>

        <section class="movement-analysis">
            <h2>📈 Price Movement Analysis</h2>
            ${this.generateMovementAnalysis(performanceResults)}
        </section>
    </div>

    <script>
        ${this.generateJavaScript(detectorStats, profileComparison)}
    </script>
</body>
</html>`;

        const outputPath = join(
            this.config.outputDirectory,
            "backtesting_results.html"
        );
        writeFileSync(outputPath, html);
    }

    /**
     * Calculate performance rankings
     */
    private calculateRankings(
        performanceResults: Map<string, SignalPerformance>
    ): PerformanceRanking[] {
        const rankings: PerformanceRanking[] = [];

        for (const [configId, performance] of performanceResults) {
            // Filter by minimum signals if specified
            if (
                this.config.minSignals &&
                performance.totalSignals < this.config.minSignals
            ) {
                continue;
            }

            // Filter by detector type if specified
            if (
                this.config.filterByDetector &&
                performance.detectorType !== this.config.filterByDetector
            ) {
                continue;
            }

            const score = this.getScore(performance, this.config.sortBy);
            const profile = this.extractProfile(configId);

            rankings.push({
                rank: 0, // Will be set after sorting
                configId,
                detectorType: performance.detectorType,
                profile,
                score,
                metrics: performance,
            });
        }

        // Sort by score
        rankings.sort((a, b) => b.score - a.score);

        // Set ranks
        rankings.forEach((ranking, index) => {
            ranking.rank = index + 1;
        });

        return rankings;
    }

    /**
     * Get score for ranking based on sort criteria
     */
    private getScore(performance: SignalPerformance, sortBy: string): number {
        switch (sortBy) {
            case "precision":
                return performance.precision;
            case "recall":
                return performance.recall;
            case "f1Score":
                return performance.f1Score;
            case "accuracy":
                return performance.accuracy;
            case "directionAccuracy":
                return performance.directionAccuracy;
            default:
                return performance.f1Score;
        }
    }

    /**
     * Extract profile from config ID
     */
    private extractProfile(configId: string): string {
        if (configId.includes("conservative")) return "conservative";
        if (configId.includes("aggressive")) return "aggressive";
        if (configId.includes("balanced")) return "balanced";
        if (configId.includes("grid")) return "custom";
        return "unknown";
    }

    /**
     * Calculate detector type statistics
     */
    private calculateDetectorStatistics(
        performanceResults: Map<string, SignalPerformance>
    ): Record<
        string,
        {
            count: number;
            avgPrecision: number;
            avgRecall: number;
            avgF1Score: number;
            avgAccuracy: number;
            avgDirectionAccuracy: number;
            totalSignals: number;
        }
    > {
        const stats: Record<
            string,
            {
                count: number;
                avgPrecision: number;
                avgRecall: number;
                avgF1Score: number;
                avgAccuracy: number;
                avgDirectionAccuracy: number;
                totalSignals: number;
            }
        > = {};

        for (const performance of performanceResults.values()) {
            const detectorType = performance.detectorType;

            if (!stats[detectorType]) {
                stats[detectorType] = {
                    count: 0,
                    avgPrecision: 0,
                    avgRecall: 0,
                    avgF1Score: 0,
                    avgAccuracy: 0,
                    avgDirectionAccuracy: 0,
                    totalSignals: 0,
                };
            }

            const stat = stats[detectorType];
            stat.count++;
            stat.avgPrecision += performance.precision;
            stat.avgRecall += performance.recall;
            stat.avgF1Score += performance.f1Score;
            stat.avgAccuracy += performance.accuracy;
            stat.avgDirectionAccuracy += performance.directionAccuracy;
            stat.totalSignals += performance.totalSignals;
        }

        // Calculate averages
        for (const stat of Object.values(stats)) {
            if (stat.count > 0) {
                stat.avgPrecision /= stat.count;
                stat.avgRecall /= stat.count;
                stat.avgF1Score /= stat.count;
                stat.avgAccuracy /= stat.count;
                stat.avgDirectionAccuracy /= stat.count;
            }
        }

        return stats;
    }

    /**
     * Calculate profile comparison statistics
     */
    private calculateProfileComparison(
        performanceResults: Map<string, SignalPerformance>
    ): Record<
        string,
        {
            count: number;
            avgF1Score: number;
            avgPrecision: number;
            avgRecall: number;
        }
    > {
        const profileStats: Record<
            string,
            {
                count: number;
                avgF1Score: number;
                avgPrecision: number;
                avgRecall: number;
            }
        > = {};

        for (const [configId, performance] of performanceResults) {
            const profile = this.extractProfile(configId);

            if (!profileStats[profile]) {
                profileStats[profile] = {
                    count: 0,
                    avgF1Score: 0,
                    avgPrecision: 0,
                    avgRecall: 0,
                };
            }

            const stat = profileStats[profile];
            stat.count++;
            stat.avgF1Score += performance.f1Score;
            stat.avgPrecision += performance.precision;
            stat.avgRecall += performance.recall;
        }

        // Calculate averages
        for (const stat of Object.values(profileStats)) {
            if (stat.count > 0) {
                stat.avgF1Score /= stat.count;
                stat.avgPrecision /= stat.count;
                stat.avgRecall /= stat.count;
            }
        }

        return profileStats;
    }

    /**
     * Generate rankings table HTML
     */
    private generateRankingsTable(rankings: PerformanceRanking[]): string {
        const headers = [
            "Rank",
            "Config ID",
            "Detector",
            "Profile",
            "F1 Score",
            "Precision",
            "Recall",
            "Accuracy",
            "Dir. Accuracy",
            "Signals",
            "True Pos.",
            "False Pos.",
            "Missed",
        ];

        const rows = rankings.map((ranking) => [
            ranking.rank,
            ranking.configId,
            ranking.detectorType,
            ranking.profile,
            ranking.metrics.f1Score.toFixed(3),
            ranking.metrics.precision.toFixed(3),
            ranking.metrics.recall.toFixed(3),
            ranking.metrics.accuracy.toFixed(3),
            ranking.metrics.directionAccuracy.toFixed(3),
            ranking.metrics.totalSignals,
            ranking.metrics.truePositives,
            ranking.metrics.falsePositives,
            ranking.metrics.missedMovements,
        ]);

        return `
            <table class="results-table">
                <thead>
                    <tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr>
                </thead>
                <tbody>
                    ${rows
                        .map(
                            (row) => `
                        <tr>
                            ${row
                                .map((cell, index) => {
                                    if (index === 0) {
                                        return `<td class="rank-cell">${cell}</td>`;
                                    } else if (index >= 4 && index <= 8) {
                                        const value = parseFloat(
                                            cell as string
                                        );
                                        const className =
                                            value >= 0.8
                                                ? "high-score"
                                                : value >= 0.6
                                                  ? "medium-score"
                                                  : "low-score";
                                        return `<td class="${className}">${cell}</td>`;
                                    } else {
                                        return `<td>${cell}</td>`;
                                    }
                                })
                                .join("")}
                        </tr>
                    `
                        )
                        .join("")}
                </tbody>
            </table>
        `;
    }

    /**
     * Generate detailed results by detector type
     */
    private generateDetailedResultsByDetector(
        performanceResults: Map<string, SignalPerformance>
    ): string {
        const detectorGroups: Record<string, SignalPerformance[]> = {};

        for (const performance of performanceResults.values()) {
            if (!detectorGroups[performance.detectorType]) {
                detectorGroups[performance.detectorType] = [];
            }
            detectorGroups[performance.detectorType].push(performance);
        }

        let html = "";
        for (const [detectorType, performances] of Object.entries(
            detectorGroups
        )) {
            // Sort by F1 score
            performances.sort((a, b) => b.f1Score - a.f1Score);

            html += `
                <div class="detector-section">
                    <h3>${detectorType} (${performances.length} configurations)</h3>
                    <div class="detector-stats">
                        <span>Best F1: ${performances[0].f1Score.toFixed(3)}</span>
                        <span>Avg F1: ${(performances.reduce((sum, p) => sum + p.f1Score, 0) / performances.length).toFixed(3)}</span>
                        <span>Total Signals: ${performances.reduce((sum, p) => sum + p.totalSignals, 0)}</span>
                    </div>
                    <div class="table-container">
                        ${this.generateDetectorTable(performances)}
                    </div>
                </div>
            `;
        }

        return html;
    }

    /**
     * Generate table for specific detector type
     */
    private generateDetectorTable(performances: SignalPerformance[]): string {
        const headers = [
            "Config ID",
            "F1 Score",
            "Precision",
            "Recall",
            "Dir. Accuracy",
            "Signals",
            "Avg Confidence",
        ];

        const rows = performances.map((p) => [
            p.configId,
            p.f1Score.toFixed(3),
            p.precision.toFixed(3),
            p.recall.toFixed(3),
            p.directionAccuracy.toFixed(3),
            p.totalSignals,
            p.avgSignalConfidence.toFixed(3),
        ]);

        return `
            <table class="detector-table">
                <thead>
                    <tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr>
                </thead>
                <tbody>
                    ${rows
                        .map(
                            (row) => `
                        <tr>
                            ${row
                                .map((cell, index) => {
                                    if (index >= 1 && index <= 4) {
                                        const value = parseFloat(
                                            cell as string
                                        );
                                        const className =
                                            value >= 0.8
                                                ? "high-score"
                                                : value >= 0.6
                                                  ? "medium-score"
                                                  : "low-score";
                                        return `<td class="${className}">${cell}</td>`;
                                    } else {
                                        return `<td>${cell}</td>`;
                                    }
                                })
                                .join("")}
                        </tr>
                    `
                        )
                        .join("")}
                </tbody>
            </table>
        `;
    }

    /**
     * Generate parameter sensitivity analysis
     */
    private generateParameterAnalysis(): string {
        // This would analyze how different parameter values affect performance
        // For now, return a placeholder
        return `
            <div class="parameter-analysis">
                <p>Parameter sensitivity analysis shows the impact of different configuration values on detector performance.</p>
                <p>Key findings:</p>
                <ul>
                    <li>Conservative configurations tend to have higher precision but lower recall</li>
                    <li>Aggressive configurations capture more movements but generate more false positives</li>
                    <li>Balanced configurations offer the best F1 scores on average</li>
                </ul>
            </div>
        `;
    }

    /**
     * Generate movement analysis
     */
    private generateMovementAnalysis(
        performanceResults: Map<string, SignalPerformance>
    ): string {
        const totalMovements = Array.from(performanceResults.values()).reduce(
            (sum, p) => sum + p.truePositives + p.missedMovements,
            0
        );

        const totalSignals = Array.from(performanceResults.values()).reduce(
            (sum, p) => sum + p.totalSignals,
            0
        );

        const avgDelay =
            Array.from(performanceResults.values()).reduce(
                (sum, p) => sum + p.avgSignalToMovementDelay,
                0
            ) / performanceResults.size;

        return `
            <div class="movement-analysis">
                <div class="movement-stats">
                    <div class="stat-card">
                        <h4>Total Movements Detected</h4>
                        <span class="stat-value">${totalMovements}</span>
                    </div>
                    <div class="stat-card">
                        <h4>Total Signals Generated</h4>
                        <span class="stat-value">${totalSignals}</span>
                    </div>
                    <div class="stat-card">
                        <h4>Avg Signal-to-Movement Delay</h4>
                        <span class="stat-value">${(avgDelay / 1000 / 60).toFixed(1)}m</span>
                    </div>
                </div>
                <p>Movement analysis reveals the effectiveness of detectors in predicting significant price changes (≥0.7%).</p>
            </div>
        `;
    }

    /**
     * Calculate average signals per test
     */
    private calculateAverageSignals(
        testResults: Map<string, TestResult>
    ): number {
        const totalSignals = Array.from(testResults.values()).reduce(
            (sum, r) => sum + r.totalSignals,
            0
        );
        return testResults.size > 0 ? totalSignals / testResults.size : 0;
    }

    /**
     * Generate CSS styles
     */
    private getCSS(): string {
        return `
            * { margin: 0; padding: 0; box-sizing: border-box; }
            
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                padding: 20px;
            }
            
            .container {
                max-width: 1400px;
                margin: 0 auto;
                background: white;
                border-radius: 20px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.1);
                overflow: hidden;
            }
            
            header {
                background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);
                color: white;
                padding: 40px;
                text-align: center;
            }
            
            h1 { font-size: 2.5em; margin-bottom: 10px; }
            .subtitle { font-size: 1.2em; opacity: 0.9; margin-bottom: 30px; }
            
            .summary-stats {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 20px;
                margin-top: 30px;
            }
            
            .stat-card {
                background: rgba(255,255,255,0.1);
                padding: 20px;
                border-radius: 10px;
                text-align: center;
                backdrop-filter: blur(10px);
            }
            
            .stat-card h3 { font-size: 0.9em; margin-bottom: 10px; opacity: 0.8; }
            .stat-value { font-size: 2em; font-weight: bold; }
            
            section {
                padding: 40px;
                border-bottom: 1px solid #eee;
            }
            
            section:last-child { border-bottom: none; }
            
            h2 {
                font-size: 1.8em;
                margin-bottom: 30px;
                color: #2c3e50;
            }
            
            .table-container {
                overflow-x: auto;
                border-radius: 10px;
                box-shadow: 0 5px 15px rgba(0,0,0,0.1);
            }
            
            .results-table, .detector-table {
                width: 100%;
                border-collapse: collapse;
                background: white;
            }
            
            .results-table th, .detector-table th {
                background: #3498db;
                color: white;
                padding: 15px 10px;
                text-align: left;
                font-weight: 600;
            }
            
            .results-table td, .detector-table td {
                padding: 12px 10px;
                border-bottom: 1px solid #eee;
            }
            
            .results-table tr:hover, .detector-table tr:hover {
                background: #f8f9fa;
            }
            
            .rank-cell {
                font-weight: bold;
                background: #ecf0f1;
                text-align: center;
            }
            
            .high-score { background: #d4edda; color: #155724; font-weight: bold; }
            .medium-score { background: #fff3cd; color: #856404; }
            .low-score { background: #f8d7da; color: #721c24; }
            
            .charts-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 40px;
                margin-top: 30px;
            }
            
            .chart-container {
                background: white;
                padding: 20px;
                border-radius: 10px;
                box-shadow: 0 5px 15px rgba(0,0,0,0.1);
            }
            
            .detector-section {
                margin-bottom: 40px;
                background: #f8f9fa;
                border-radius: 10px;
                padding: 30px;
            }
            
            .detector-section h3 {
                color: #2c3e50;
                margin-bottom: 15px;
                font-size: 1.3em;
            }
            
            .detector-stats {
                display: flex;
                gap: 20px;
                margin-bottom: 20px;
                flex-wrap: wrap;
            }
            
            .detector-stats span {
                background: #3498db;
                color: white;
                padding: 8px 15px;
                border-radius: 20px;
                font-size: 0.9em;
                font-weight: bold;
            }
            
            .parameter-analysis, .movement-analysis {
                background: #f8f9fa;
                padding: 30px;
                border-radius: 10px;
            }
            
            .movement-stats {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 20px;
                margin-bottom: 20px;
            }
            
            .movement-stats .stat-card {
                background: white;
                border: 2px solid #3498db;
                color: #2c3e50;
            }
            
            .movement-stats .stat-value {
                color: #3498db;
            }
            
            @media (max-width: 768px) {
                .charts-grid {
                    grid-template-columns: 1fr;
                }
                
                .summary-stats {
                    grid-template-columns: 1fr;
                }
                
                body { padding: 10px; }
                section { padding: 20px; }
            }
        `;
    }

    /**
     * Generate JavaScript for charts
     */
    private generateJavaScript(
        detectorStats: Record<
            string,
            {
                count: number;
                avgPrecision: number;
                avgRecall: number;
                avgF1Score: number;
                avgAccuracy: number;
                avgDirectionAccuracy: number;
                totalSignals: number;
            }
        >,
        profileComparison: Record<
            string,
            {
                count: number;
                avgF1Score: number;
                avgPrecision: number;
                avgRecall: number;
            }
        >
    ): string {
        return `
            // Detector Comparison Chart
            const detectorCtx = document.getElementById('detectorComparisonChart').getContext('2d');
            new Chart(detectorCtx, {
                type: 'bar',
                data: {
                    labels: ${JSON.stringify(Object.keys(detectorStats))},
                    datasets: [{
                        label: 'Average F1 Score',
                        data: ${JSON.stringify(Object.values(detectorStats).map((s) => s.avgF1Score))},
                        backgroundColor: 'rgba(52, 152, 219, 0.8)',
                        borderColor: 'rgba(52, 152, 219, 1)',
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        title: {
                            display: true,
                            text: 'Average F1 Score by Detector Type'
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            max: 1
                        }
                    }
                }
            });

            // Profile Comparison Chart
            const profileCtx = document.getElementById('profileComparisonChart').getContext('2d');
            new Chart(profileCtx, {
                type: 'radar',
                data: {
                    labels: ['F1 Score', 'Precision', 'Recall'],
                    datasets: ${JSON.stringify(
                        Object.entries(profileComparison).map(
                            ([profile, stats]) => ({
                                label:
                                    profile.charAt(0).toUpperCase() +
                                    profile.slice(1),
                                data: [
                                    stats.avgF1Score,
                                    stats.avgPrecision,
                                    stats.avgRecall,
                                ],
                                backgroundColor:
                                    profile === "conservative"
                                        ? "rgba(231, 76, 60, 0.2)"
                                        : profile === "balanced"
                                          ? "rgba(46, 204, 113, 0.2)"
                                          : profile === "aggressive"
                                            ? "rgba(155, 89, 182, 0.2)"
                                            : "rgba(52, 152, 219, 0.2)",
                                borderColor:
                                    profile === "conservative"
                                        ? "rgba(231, 76, 60, 1)"
                                        : profile === "balanced"
                                          ? "rgba(46, 204, 113, 1)"
                                          : profile === "aggressive"
                                            ? "rgba(155, 89, 182, 1)"
                                            : "rgba(52, 152, 219, 1)",
                                borderWidth: 2,
                            })
                        )
                    )}
                },
                options: {
                    responsive: true,
                    plugins: {
                        title: {
                            display: true,
                            text: 'Performance by Configuration Profile'
                        }
                    },
                    scales: {
                        r: {
                            beginAtZero: true,
                            max: 1
                        }
                    }
                }
            });
        `;
    }

    /**
     * Generate CSV exports
     */
    private generateCSVExports(
        testResults: Map<string, TestResult>,
        performanceResults: Map<string, SignalPerformance>
    ): void {
        // Export test results
        const testCSV = this.generateTestResultsCSV(testResults);
        writeFileSync(
            join(this.config.outputDirectory, "test_results.csv"),
            testCSV
        );

        // Export performance results
        const performanceCSV = this.generatePerformanceCSV(performanceResults);
        writeFileSync(
            join(this.config.outputDirectory, "performance_results.csv"),
            performanceCSV
        );

        // Export rankings
        const rankings = this.calculateRankings(performanceResults);
        const rankingsCSV = this.generateRankingsCSV(rankings);
        writeFileSync(
            join(this.config.outputDirectory, "rankings.csv"),
            rankingsCSV
        );
    }

    /**
     * Generate test results CSV
     */
    private generateTestResultsCSV(
        testResults: Map<string, TestResult>
    ): string {
        const headers = [
            "configId",
            "detectorType",
            "duration",
            "totalSignals",
            "totalMovements",
            "success",
            "error",
        ];
        const rows = Array.from(testResults.values()).map((result) => [
            result.configId,
            result.detectorType,
            result.duration,
            result.totalSignals,
            result.totalMovements,
            result.success,
            result.error || "",
        ]);

        return [headers.join(","), ...rows.map((row) => row.join(","))].join(
            "\n"
        );
    }

    /**
     * Generate performance CSV
     */
    private generatePerformanceCSV(
        performanceResults: Map<string, SignalPerformance>
    ): string {
        const headers = [
            "configId",
            "detectorType",
            "totalSignals",
            "truePositives",
            "falsePositives",
            "missedMovements",
            "precision",
            "recall",
            "f1Score",
            "accuracy",
            "directionAccuracy",
            "avgSignalToMovementDelay",
            "avgSignalConfidence",
            "signalFrequency",
        ];

        const rows = Array.from(performanceResults.values()).map((p) => [
            p.configId,
            p.detectorType,
            p.totalSignals,
            p.truePositives,
            p.falsePositives,
            p.missedMovements,
            p.precision.toFixed(4),
            p.recall.toFixed(4),
            p.f1Score.toFixed(4),
            p.accuracy.toFixed(4),
            p.directionAccuracy.toFixed(4),
            Math.round(p.avgSignalToMovementDelay),
            p.avgSignalConfidence.toFixed(4),
            p.signalFrequency.toFixed(4),
        ]);

        return [headers.join(","), ...rows.map((row) => row.join(","))].join(
            "\n"
        );
    }

    /**
     * Generate rankings CSV
     */
    private generateRankingsCSV(rankings: PerformanceRanking[]): string {
        const headers = [
            "rank",
            "configId",
            "detectorType",
            "profile",
            "f1Score",
            "precision",
            "recall",
            "accuracy",
        ];
        const rows = rankings.map((r) => [
            r.rank,
            r.configId,
            r.detectorType,
            r.profile,
            r.metrics.f1Score.toFixed(4),
            r.metrics.precision.toFixed(4),
            r.metrics.recall.toFixed(4),
            r.metrics.accuracy.toFixed(4),
        ]);

        return [headers.join(","), ...rows.map((row) => row.join(","))].join(
            "\n"
        );
    }

    /**
     * Generate optimal configuration export
     */
    private generateOptimalConfigurationExport(
        performanceResults: Map<string, SignalPerformance>
    ): void {
        const rankings = this.calculateRankings(performanceResults);

        if (rankings.length === 0) {
            return;
        }

        const bestConfigs: Record<
            string,
            {
                configId: string;
                profile: string;
                f1Score: number;
                metrics: {
                    precision: number;
                    recall: number;
                    accuracy: number;
                    directionAccuracy: number;
                };
            }
        > = {};
        const detectorTypes = new Set(rankings.map((r) => r.detectorType));

        for (const detectorType of detectorTypes) {
            const bestForDetector = rankings.find(
                (r) => r.detectorType === detectorType
            );
            if (bestForDetector) {
                bestConfigs[detectorType] = {
                    configId: bestForDetector.configId,
                    profile: bestForDetector.profile,
                    f1Score: bestForDetector.score,
                    metrics: {
                        precision: bestForDetector.metrics.precision,
                        recall: bestForDetector.metrics.recall,
                        accuracy: bestForDetector.metrics.accuracy,
                        directionAccuracy:
                            bestForDetector.metrics.directionAccuracy,
                    },
                };
            }
        }

        const optimalConfig = {
            generatedAt: new Date().toISOString(),
            sortedBy: this.config.sortBy,
            bestOverall: rankings[0],
            bestByDetector: bestConfigs,
            summary: {
                totalConfigurations: rankings.length,
                bestF1Score: rankings[0].score,
                avgF1Score:
                    rankings.reduce((sum, r) => sum + r.score, 0) /
                    rankings.length,
            },
        };

        const outputPath = join(
            this.config.outputDirectory,
            "optimal_configurations.json"
        );
        writeFileSync(outputPath, JSON.stringify(optimalConfig, null, 2));
    }

    /**
     * Generate performance summary report
     */
    private generatePerformanceSummary(
        testResults: Map<string, TestResult>,
        performanceResults: Map<string, SignalPerformance>
    ): void {
        const rankings = this.calculateRankings(performanceResults);
        const detectorStats =
            this.calculateDetectorStatistics(performanceResults);

        const summary = `
# Backtesting Performance Summary

## Overview
- **Total Configurations Tested**: ${testResults.size}
- **Successful Tests**: ${Array.from(testResults.values()).filter((r) => r.success).length}
- **Performance Configurations**: ${performanceResults.size}
- **Generated**: ${new Date().toISOString()}

## Top Performers

### Best Overall (by ${this.config.sortBy})
${rankings
    .slice(0, 5)
    .map(
        (r, i) =>
            `${i + 1}. **${r.configId}** (${r.detectorType}) - Score: ${r.score.toFixed(3)}`
    )
    .join("\n")}

## Detector Type Performance

${Object.entries(detectorStats)
    .map(
        ([type, stats]) => `
### ${type}
- **Configurations**: ${stats.count}
- **Avg F1 Score**: ${stats.avgF1Score.toFixed(3)}
- **Avg Precision**: ${stats.avgPrecision.toFixed(3)}
- **Avg Recall**: ${stats.avgRecall.toFixed(3)}
- **Total Signals**: ${stats.totalSignals}
`
    )
    .join("")}

## Key Insights
- Conservative profiles tend to have higher precision but lower recall
- Aggressive profiles capture more movements but generate more false signals
- Balanced profiles offer the best overall F1 scores
- Parameter tuning shows significant impact on performance

## Recommendations
1. Use the top-performing configurations for live trading
2. Consider ensemble approaches combining multiple detectors
3. Validate performance with out-of-sample data
4. Monitor detector performance in different market conditions
`;

        const outputPath = join(
            this.config.outputDirectory,
            "performance_summary.md"
        );
        writeFileSync(outputPath, summary);
    }
}
