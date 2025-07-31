#!/usr/bin/env node

/**
 * Simple Absorption Near-Miss Analyzer
 * Analyzes rejection logs for absorption detector near-misses
 */

const fs = require('fs');
const path = require('path');

// CSV file path
const csvPath = '/Users/marcschot/Projects/OrderFlow Trading/logs/signal_validation/signal_rejections_2025-07-31.csv';

function convertTimestamp(timestamp) {
    const date = new Date(parseInt(timestamp));
    return date.toISOString().replace('T', ' ').slice(0, 23);
}

function parseCSV(csvContent) {
    const lines = csvContent.split('\n');
    const header = lines[0].split(',');
    const data = [];
    
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const columns = line.split(',');
        if (columns.length >= 9) {
            const row = {};
            header.forEach((col, index) => {
                row[col] = columns[index];
            });
            data.push(row);
        }
    }
    
    return data;
}

function analyzeAbsorptionRejections() {
    console.log('🔍 Absorption Detector Near-Miss Analysis');
    console.log('=========================================\n');
    
    try {
        const csvContent = fs.readFileSync(csvPath, 'utf-8');
        const allData = parseCSV(csvContent);
        
        // Filter for absorption detector rejections only
        const absorptionRejections = allData.filter(row => 
            row.detectorType === 'absorption'
        );
        
        console.log(`📊 Total absorption rejections: ${absorptionRejections.length}`);
        
        // Calculate ratios for rejections with numeric actual and threshold values
        const nearMisses = [];
        
        absorptionRejections.forEach(rejection => {
            const actualValue = parseFloat(rejection.actualValue);
            const thresholdValue = parseFloat(rejection.thresholdValue);
            
            if (!isNaN(actualValue) && !isNaN(thresholdValue) && thresholdValue > 0) {
                const ratio = actualValue / thresholdValue;
                nearMisses.push({
                    timestamp: convertTimestamp(rejection.timestamp),
                    price: parseFloat(rejection.price),
                    rejectionReason: rejection.rejectionReason,
                    thresholdType: rejection.thresholdType,
                    thresholdValue: thresholdValue,
                    actualValue: actualValue,
                    ratio: ratio,
                    aggressiveVolume: parseFloat(rejection.aggressiveVolume) || 0,
                    passiveVolume: parseFloat(rejection.passiveVolume) || 0,
                    reductionNeeded: ((thresholdValue - actualValue) / thresholdValue * 100).toFixed(2)
                });
            }
        });
        
        // Sort by ratio (highest first - closest to threshold)
        nearMisses.sort((a, b) => b.ratio - a.ratio);
        
        console.log(`✅ Near-miss candidates found: ${nearMisses.length}\n`);
        
        // Show top 20 near-misses
        console.log('🎯 Top 20 Near-Miss Rejections');
        console.log('==================================================\n');
        
        const topNearMisses = nearMisses.slice(0, 20);
        
        topNearMisses.forEach((rejection, index) => {
            console.log(`${index + 1}. ${rejection.timestamp}`);
            console.log(`   Price: $${rejection.price.toFixed(2)}`);
            console.log(`   Rejection: ${rejection.rejectionReason}`);
            console.log(`   Threshold Type: ${rejection.thresholdType}`);
            console.log(`   Threshold: ${rejection.thresholdValue} | Actual: ${rejection.actualValue.toFixed(4)}`);
            console.log(`   Ratio: ${rejection.ratio.toFixed(4)} (${(rejection.ratio * 100).toFixed(2)}% of threshold)`);
            console.log(`   Reduction Needed: ${rejection.reductionNeeded}%`);
            console.log(`   Volume - Aggressive: ${rejection.aggressiveVolume.toFixed(2)}, Passive: ${rejection.passiveVolume.toFixed(2)}`);
            
            // Market context
            const totalVolume = rejection.aggressiveVolume + rejection.passiveVolume;
            if (totalVolume > 0) {
                const aggressiveRatio = rejection.aggressiveVolume / totalVolume;
                console.log(`   Market Context: ${aggressiveRatio > 0.6 ? 'Aggressive-dominant' : aggressiveRatio < 0.4 ? 'Passive-dominant' : 'Balanced'}`);
            }
            
            console.log('');
        });
        
        // Group by rejection reason
        console.log('📊 Analysis by Rejection Type');
        console.log('==================================================\n');
        
        const groupedByReason = {};
        nearMisses.forEach(rejection => {
            if (!groupedByReason[rejection.rejectionReason]) {
                groupedByReason[rejection.rejectionReason] = [];
            }
            groupedByReason[rejection.rejectionReason].push(rejection);
        });
        
        Object.keys(groupedByReason).forEach(reason => {
            const rejections = groupedByReason[reason];
            const avgRatio = rejections.reduce((sum, r) => sum + r.ratio, 0) / rejections.length;
            const maxRatio = Math.max(...rejections.map(r => r.ratio));
            const avgReduction = rejections.reduce((sum, r) => sum + parseFloat(r.reductionNeeded), 0) / rejections.length;
            
            console.log(`${reason}: ${rejections.length} rejections`);
            console.log(`  Average ratio: ${avgRatio.toFixed(4)} (${(avgRatio * 100).toFixed(2)}%)`);
            console.log(`  Best ratio: ${maxRatio.toFixed(4)} (${(maxRatio * 100).toFixed(2)}%)`);
            console.log(`  Average reduction needed: ${avgReduction.toFixed(2)}%`);
            console.log('');
        });
        
        // Optimization recommendations
        console.log('🚀 Optimization Recommendations');
        console.log('==================================================\n');
        
        // High priority: ratios > 0.8
        const highPriority = nearMisses.filter(r => r.ratio > 0.8);
        console.log(`🔥 HIGH PRIORITY (${highPriority.length} opportunities):`);
        console.log(`   Ratio > 80% of threshold - minimal risk adjustments`);
        
        if (highPriority.length > 0) {
            const avgReduction = highPriority.reduce((sum, r) => sum + parseFloat(r.reductionNeeded), 0) / highPriority.length;
            console.log(`   Average threshold reduction needed: ${avgReduction.toFixed(2)}%`);
            
            const reasonCounts = {};
            highPriority.forEach(r => {
                reasonCounts[r.rejectionReason] = (reasonCounts[r.rejectionReason] || 0) + 1;
            });
            
            console.log('   Top rejection reasons:');
            Object.entries(reasonCounts)
                .sort(([,a], [,b]) => b - a)
                .slice(0, 3)
                .forEach(([reason, count]) => {
                    console.log(`     • ${reason}: ${count} occurrences`);
                });
        }
        console.log('');
        
        // Medium priority: ratios 0.6-0.8
        const mediumPriority = nearMisses.filter(r => r.ratio > 0.6 && r.ratio <= 0.8);
        console.log(`⚠️ MEDIUM PRIORITY (${mediumPriority.length} opportunities):`);
        console.log(`   Ratio 60-80% of threshold - moderate risk adjustments`);
        
        if (mediumPriority.length > 0) {
            const avgReduction = mediumPriority.reduce((sum, r) => sum + parseFloat(r.reductionNeeded), 0) / mediumPriority.length;
            console.log(`   Average threshold reduction needed: ${avgReduction.toFixed(2)}%`);
        }
        console.log('');
        
        // Low priority: ratios 0.4-0.6
        const lowPriority = nearMisses.filter(r => r.ratio > 0.4 && r.ratio <= 0.6);
        console.log(`📋 LOW PRIORITY (${lowPriority.length} opportunities):`);
        console.log(`   Ratio 40-60% of threshold - higher risk adjustments`);
        console.log('');
        
        console.log('💡 Implementation Notes:');
        console.log('• Start with HIGH PRIORITY parameters showing <20% reduction needed');
        console.log('• Test in simulation environment first');
        console.log('• Monitor false positive rates after adjustments');
        console.log('• Consider A/B testing for critical parameters');
        
    } catch (error) {
        console.error('Analysis failed:', error.message);
        process.exit(1);
    }
}

// Run the analysis
analyzeAbsorptionRejections();