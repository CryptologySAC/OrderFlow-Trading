// examples/enhanced-signal-metrics-demo.ts

/**
 * Demonstration of the enhanced signal metrics functionality
 * Shows how to access detailed signal statistics from SignalManager
 */

import { SignalManager } from '../src/trading/signalManager.js';
import { AnomalyDetector } from '../src/services/anomalyDetector.js';
import { AlertManager } from '../src/alerts/alertManager.js';
import { Logger } from '../src/infrastructure/logger.js';
import { MetricsCollector } from '../src/infrastructure/metricsCollector.js';
import { Storage } from '../src/storage/storage.js';
import type { ProcessedSignal, SignalStatistics } from '../src/trading/signalManager.js';

/**
 * Example usage of enhanced signal metrics
 */
async function demonstrateEnhancedMetrics() {
    // Setup dependencies (in practice, these would be injected)
    const logger = new Logger({ level: 'info' });
    const metricsCollector = new MetricsCollector();
    const storage = new Storage({ 
        databasePath: ':memory:', 
        maxConcurrentConnections: 1 
    });
    
    // Create mock instances for demo
    const anomalyDetector = {} as AnomalyDetector;
    const alertManager = {} as AlertManager;
    
    // Initialize SignalManager with enhanced metrics
    const signalManager = new SignalManager(
        anomalyDetector,
        alertManager,
        logger,
        metricsCollector,
        storage,
        {
            confidenceThreshold: 0.75,
            enableMarketHealthCheck: true,
            enableAlerts: false // Disable for demo
        }
    );

    console.log('🔧 Enhanced Signal Metrics Demo');
    console.log('================================\n');

    // Example: Process various signals to generate metrics
    const exampleSignals: ProcessedSignal[] = [
        {
            id: 'signal_1',
            type: 'absorption',
            detectorId: 'absorption_detector_v1',
            confidence: 0.85,
            timestamp: new Date(),
            data: { price: 50000, volume: 1000 }
        },
        {
            id: 'signal_2',
            type: 'exhaustion',
            detectorId: 'exhaustion_detector_v1',
            confidence: 0.65, // Below threshold - will be rejected
            timestamp: new Date(),
            data: { price: 50100, volume: 800 }
        },
        {
            id: 'signal_3',
            type: 'accumulation',
            detectorId: 'accumulation_detector_v1',
            confidence: 0.92,
            timestamp: new Date(),
            data: { price: 49900, volume: 1200 }
        }
    ];

    console.log('📊 Processing Example Signals...\n');

    // Mock the anomaly detector to return healthy market for demo
    (anomalyDetector as any).getMarketHealth = () => ({
        isHealthy: true,
        recommendation: 'continue',
        criticalIssues: [],
        recentAnomalyTypes: [],
        highestSeverity: 'low'
    });

    // Process signals through the enhanced metrics system
    for (const signal of exampleSignals) {
        try {
            signalManager.handleProcessedSignal(signal);
            console.log(`✅ Processed signal ${signal.id} (${signal.type}, confidence: ${signal.confidence})`);
        } catch (error) {
            console.log(`❌ Failed to process signal ${signal.id}: ${error}`);
        }
    }

    console.log('\n📈 Enhanced Signal Statistics:');
    console.log('==============================\n');

    // Get comprehensive signal statistics
    const stats: SignalStatistics = signalManager.getSignalStatistics();

    // Display processing metrics
    console.log('📋 Processing Metrics:');
    console.log(`   Total Processed: ${stats.processing.totalProcessed}`);
    console.log(`   Total Received: ${stats.processing.totalReceived}`);
    console.log(`   Total Confirmed: ${stats.processing.totalConfirmed}`);
    console.log(`   Processing Duration P50: ${stats.processing.processingDurationP50}ms`);
    console.log(`   Processing Duration P95: ${stats.processing.processingDurationP95}ms\n`);

    // Display rejection metrics
    console.log('🚫 Rejection Metrics:');
    console.log(`   Total Rejected: ${stats.rejections.totalRejected}`);
    console.log('   By Reason:');
    console.log(`     Low Confidence: ${stats.rejections.byReason.lowConfidence}`);
    console.log(`     Unhealthy Market: ${stats.rejections.byReason.unhealthyMarket}`);
    console.log(`     Processing Error: ${stats.rejections.byReason.processingError}`);
    console.log(`     Timeout: ${stats.rejections.byReason.timeout}`);
    console.log(`     Duplicate: ${stats.rejections.byReason.duplicate}\n`);

    // Display quality metrics
    console.log('⭐ Quality Metrics:');
    console.log(`   Average Confidence: ${stats.quality.averageConfidence.toFixed(3)}`);
    console.log(`   Confidence P50: ${stats.quality.confidenceP50.toFixed(3)}`);
    console.log(`   Confidence P95: ${stats.quality.confidenceP95.toFixed(3)}`);
    console.log(`   Average Confidence Adjustment: ${stats.quality.averageConfidenceAdjustment.toFixed(3)}\n`);

    // Display correlation metrics
    console.log('🔗 Correlation Metrics:');
    console.log(`   Average Strength: ${stats.correlation.averageStrength.toFixed(3)}`);
    console.log(`   Correlated Signals P50: ${stats.correlation.correlatedSignalsP50}`);
    console.log(`   Correlated Signals P95: ${stats.correlation.correlatedSignalsP95}`);
    console.log(`   Confirmations with Correlation: ${stats.correlation.confirmationsWithCorrelation}\n`);

    // Display market health metrics
    console.log('💊 Market Health Metrics:');
    console.log(`   Confirmations (Healthy Market): ${stats.marketHealth.confirmationsHealthyMarket}`);
    console.log(`   Confirmations (Unhealthy Market): ${stats.marketHealth.confirmationsUnhealthyMarket}`);
    console.log(`   Blocked by Health: ${stats.marketHealth.blockedByHealth}\n`);

    // Display timing metrics
    console.log('⏱️  Timing Metrics:');
    console.log(`   Average Signal Age: ${stats.timing.averageSignalAge.toFixed(2)}ms`);
    console.log(`   Signal Age P95: ${stats.timing.signalAgeP95.toFixed(2)}ms\n`);

    console.log('🔍 Additional Information:');
    console.log('==========================\n');

    // Show recent rejection reason
    const lastRejectReason = signalManager.getLastRejectReason();
    console.log(`Last Rejection Reason: ${lastRejectReason || 'None'}\n`);

    // Show status information
    const status = signalManager.getStatus();
    console.log('📊 Manager Status:');
    console.log(`   Recent Signals Count: ${status.recentSignalsCount}`);
    console.log(`   Correlations Count: ${status.correlationsCount}`);
    console.log(`   History Size: ${status.historySize}`);
    console.log(`   Market Healthy: ${status.marketHealth.isHealthy}`);
    console.log(`   Market Recommendation: ${status.marketHealth.recommendation}\n`);

    console.log('✨ Enhanced Metrics Features:');
    console.log('==============================\n');
    console.log('The enhanced metrics system now tracks:');
    console.log('• 📈 Detailed rejection reasons and categorization');
    console.log('• 🎯 Signal quality tiers and confidence distributions');
    console.log('• 🔗 Correlation strength and impact analysis');
    console.log('• 💊 Market health impact on signal processing');
    console.log('• ⏱️  Processing timing and signal age metrics');
    console.log('• 🔍 Detector-specific performance statistics');
    console.log('• 📊 Signal type breakdown and analysis\n');

    console.log('🚀 This enables better:');
    console.log('• Signal quality optimization');
    console.log('• Detector performance tuning');
    console.log('• Market condition adaptation');
    console.log('• Troubleshooting and debugging');
    console.log('• Performance monitoring and alerting\n');

    // Cleanup
    await storage.close();
    console.log('✅ Demo completed successfully!');
}

// Export for use in other examples
export { demonstrateEnhancedMetrics };

// Run demo if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    demonstrateEnhancedMetrics().catch(console.error);
}