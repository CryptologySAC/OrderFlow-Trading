#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Parse CSV data for absorption detector analysis
function analyzeAbsorptionRejections() {
    const logFile = '/Users/marcschot/Projects/OrderFlow Trading/logs/signal_validation/signal_rejections_2025-07-31.csv';
    const startTime = 1753963200000; // 7am today
    
    const data = fs.readFileSync(logFile, 'utf-8');
    const lines = data.split('\n');
    const header = lines[0].split(',');
    
    console.log('=== ABSORPTION DETECTOR REJECTION ANALYSIS ===\n');
    console.log('Analysis Period: Since 7:00 AM, July 31, 2025\n');
    
    const rejections = {
        insufficient_aggressive_volume: [],
        passive_volume_ratio_too_low: [],
        price_efficiency_too_high: [],
        balanced_institutional_flow: [],
        other: []
    };
    
    const stats = {
        totalRejections: 0,
        missedOpportunities: 0,
        nearMisses: 0
    };
    
    // Parse rejection data
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const cols = line.split(',');
        const timestamp = parseInt(cols[0]);
        const detectorType = cols[1];
        const rejectionReason = cols[2];
        const price = parseFloat(cols[3]);
        const thresholdType = cols[4];
        const thresholdValue = parseFloat(cols[5]);
        const actualValue = parseFloat(cols[6]);
        const aggressiveVolume = parseFloat(cols[7]);
        const passiveVolume = parseFloat(cols[8]);
        const priceEfficiency = parseFloat(cols[9]) || null;
        const confidence = parseFloat(cols[10]) || null;
        const movement1hr = parseFloat(cols[13]) || null;
        const wasValidSignal = cols[14] === 'true';
        
        // Filter for absorption rejections since 7am
        if (timestamp >= startTime && detectorType === 'absorption') {
            stats.totalRejections++;
            
            const record = {
                timestamp,
                rejectionReason,
                price,
                thresholdType,
                thresholdValue,
                actualValue,
                aggressiveVolume,
                passiveVolume,
                priceEfficiency,
                confidence,
                movement1hr,
                wasValidSignal
            };
            
            if (rejections[rejectionReason]) {
                rejections[rejectionReason].push(record);
            } else {
                rejections.other.push(record);
            }
            
            // Track missed opportunities (0.7%+ movements)
            if (movement1hr && Math.abs(movement1hr) >= 0.007) {
                stats.missedOpportunities++;
            }
            
            // Track near misses for volume threshold
            if (rejectionReason === 'insufficient_aggressive_volume' && 
                actualValue > thresholdValue * 0.95) {
                stats.nearMisses++;
            }
        }
    }
    
    // Analysis Results
    console.log('📊 REJECTION SUMMARY:');
    console.log(`Total Absorption Rejections: ${stats.totalRejections}`);
    console.log(`Missed Opportunities (0.7%+ moves): ${stats.missedOpportunities}`);
    console.log(`Near-Miss Volume Rejections: ${stats.nearMisses}\n`);
    
    // Top rejection reasons
    console.log('🔍 TOP REJECTION REASONS:');
    const sortedReasons = Object.entries(rejections)
        .map(([reason, data]) => ({ reason, count: data.length }))
        .sort((a, b) => b.count - a.count)
        .filter(item => item.count > 0);
    
    sortedReasons.forEach((item, index) => {
        const percentage = ((item.count / stats.totalRejections) * 100).toFixed(1);
        console.log(`${index + 1}. ${item.reason}: ${item.count} (${percentage}%)`);
    });
    
    console.log('\n📈 VOLUME THRESHOLD ANALYSIS:');
    const volumeRejections = rejections.insufficient_aggressive_volume;
    if (volumeRejections.length > 0) {
        const volumeStats = {
            threshold800Count: 0,
            nearMissCount: 0,
            veryLowCount: 0,
            actualValues: []
        };
        
        volumeRejections.forEach(r => {
            volumeStats.actualValues.push(r.actualValue);
            if (r.thresholdValue === 800) volumeStats.threshold800Count++;
            if (r.actualValue > r.thresholdValue * 0.95) volumeStats.nearMissCount++;
            if (r.actualValue < 100) volumeStats.veryLowCount++;
        });
        
        volumeStats.actualValues.sort((a, b) => b - a);
        const median = volumeStats.actualValues[Math.floor(volumeStats.actualValues.length / 2)];
        const top10Percent = volumeStats.actualValues.slice(0, Math.floor(volumeStats.actualValues.length * 0.1));
        const avgTop10 = top10Percent.reduce((a, b) => a + b, 0) / top10Percent.length;
        
        console.log(`Current Volume Threshold: 800`);
        console.log(`Total Volume Rejections: ${volumeRejections.length}`);
        console.log(`Near-Miss Rejections (95%+ of threshold): ${volumeStats.nearMissCount}`);
        console.log(`Very Low Volume Rejections (<100): ${volumeStats.veryLowCount}`);
        console.log(`Median Rejected Volume: ${median.toFixed(1)}`);
        console.log(`Average Top 10% Rejected Volume: ${avgTop10.toFixed(1)}`);
        console.log(`Highest Rejected Volume: ${volumeStats.actualValues[0].toFixed(1)}`);
    }
    
    console.log('\n📊 PASSIVE VOLUME RATIO ANALYSIS:');
    const passiveRejections = rejections.passive_volume_ratio_too_low;
    if (passiveRejections.length > 0) {
        const passiveStats = {
            ratios: [],
            nearMissCount: 0
        };
        
        passiveRejections.forEach(r => {
            passiveStats.ratios.push(r.actualValue);
            if (r.actualValue > r.thresholdValue * 0.95) passiveStats.nearMissCount++;
        });
        
        passiveStats.ratios.sort((a, b) => b - a);
        const medianRatio = passiveStats.ratios[Math.floor(passiveStats.ratios.length / 2)];
        
        console.log(`Current Passive Ratio Threshold: 0.650`);
        console.log(`Total Passive Ratio Rejections: ${passiveRejections.length}`);
        console.log(`Near-Miss Rejections (95%+ of threshold): ${passiveStats.nearMissCount}`);
        console.log(`Median Rejected Ratio: ${medianRatio.toFixed(3)}`);
        console.log(`Highest Rejected Ratio: ${passiveStats.ratios[0].toFixed(3)}`);
    }
    
    console.log('\n💡 OPTIMIZATION RECOMMENDATIONS:');
    
    // Volume threshold recommendations
    if (volumeRejections.length > 0) {
        const volumeStats = rejections.insufficient_aggressive_volume;
        const nearMissPercentage = (stats.nearMisses / volumeStats.length * 100).toFixed(1);
        
        if (nearMissPercentage > 20) {
            console.log(`🎯 HIGH PRIORITY: Volume threshold too restrictive`);
            console.log(`   - ${nearMissPercentage}% of volume rejections are near-misses (795-799)`);
            console.log(`   - Recommend reducing threshold from 800 to 750-780`);
            console.log(`   - Expected improvement: +${stats.nearMisses} additional signals`);
        }
        
        const veryLowCount = volumeStats.filter(r => r.actualValue < 100).length;
        if (veryLowCount > volumeStats.length * 0.5) {
            console.log(`\n🔍 ZONE FILTERING ISSUE DETECTED:`);
            console.log(`   - ${veryLowCount} rejections with very low volume (<100)`);
            console.log(`   - Suggests zone temporal/proximity filters too restrictive`);
            console.log(`   - Review zone expansion logic and time window filters`);
        }
    }
    
    // Passive ratio recommendations
    if (passiveRejections.length > 0) {
        const nearMissPassive = passiveRejections.filter(r => r.actualValue > r.thresholdValue * 0.95).length;
        const nearMissPercentage = (nearMissPassive / passiveRejections.length * 100).toFixed(1);
        
        if (nearMissPercentage > 15) {
            console.log(`\n📉 Passive Volume Ratio threshold potentially too restrictive`);
            console.log(`   - ${nearMissPercentage}% of rejections are near-misses`);
            console.log(`   - Consider reducing from 0.650 to 0.620-0.640`);
        }
    }
    
    console.log('\n🎯 PRIORITY ACTION ITEMS:');
    console.log('1. Address volume threshold near-misses (795-799 range)');
    console.log('2. Investigate zone filtering for very low volume rejections');
    console.log('3. Review passive volume ratio calibration');
    console.log('4. Monitor missed opportunities with 0.7%+ movements');
    
    console.log('\n📈 EXPECTED IMPROVEMENTS:');
    const potentialSignals = stats.nearMisses + Math.floor(passiveRejections.length * 0.1);
    console.log(`Potential additional signals from optimization: ${potentialSignals}`);
    console.log(`Current signal-to-rejection ratio: ${(100 / stats.totalRejections * 100).toFixed(1)}% (if 100 successful signals exist)`);
    
}

analyzeAbsorptionRejections();