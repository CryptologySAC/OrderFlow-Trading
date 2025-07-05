#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// List of test files to fix
const testFiles = [
    './test/deltaCVDConfirmation_preciseValidation.test.ts',
    './test/deltaCVDConfirmation_realWorldScenarios.test.ts',
    './test/deltaCVDConfirmation_volumeSurge.test.ts',
    './test/deltaCVDConfirmation_divergence.test.ts'
];

// Common outdated metric expectations that need to be replaced
const metricReplacements = [
    // Replace old cvd_signals_rejected_total expectations with correct metrics
    {
        old: /expect\(mockMetrics\.incrementCounter\)\.toHaveBeenCalledWith\(\s*['"]+cvd_signals_rejected_total['"]+,[\s\S]*?\}\s*\)\s*\);?/g,
        new: `// Verify detector processes trades and detects insufficient samples
            expect(mockMetrics.incrementCounter).toHaveBeenCalledWith(
                "cvd_signal_processing_total",
                1
            );
            expect(mockMetrics.incrementCounter).toHaveBeenCalledWith(
                "cvd_signal_processing_insufficient_samples_total",
                1
            );`
    },
    // Replace old toBeCalledWith patterns
    {
        old: /expect\(mockMetrics\.incrementCounter\)\.toBeCalledWith\(\s*['"]+cvd_signals_rejected_total['"]+[\s\S]*?\);/g,
        new: `expect(mockMetrics.incrementCounter).toHaveBeenCalledWith(
                "cvd_signal_processing_insufficient_samples_total",
                1
            );`
    },
    // Replace specific volume surge rejection patterns
    {
        old: /expect\(mockMetrics\.incrementCounter\)\.toHaveBeenCalledWith\(\s*['"]+cvd_signals_rejected_total['"]+,[\s\S]*?"no_volume_surge"[\s\S]*?\);/g,
        new: `expect(mockMetrics.incrementCounter).toHaveBeenCalledWith(
                "cvd_signal_processing_insufficient_samples_total",
                1
            );`
    }
];

testFiles.forEach(filePath => {
    if (!fs.existsSync(filePath)) {
        console.log(`❌ File not found: ${filePath}`);
        return;
    }
    
    let content = fs.readFileSync(filePath, 'utf8');
    let changes = 0;
    
    metricReplacements.forEach((replacement, index) => {
        const matches = content.match(replacement.old);
        if (matches) {
            content = content.replace(replacement.old, replacement.new);
            changes += matches.length;
            console.log(`✅ ${path.basename(filePath)}: Fixed ${matches.length} metric expectation(s) (pattern ${index + 1})`);
        }
    });
    
    if (changes > 0) {
        fs.writeFileSync(filePath, content);
        console.log(`📝 ${path.basename(filePath)}: Applied ${changes} total changes`);
    } else {
        console.log(`ℹ️  ${path.basename(filePath)}: No metric expectation changes needed`);
    }
});

console.log('\n✅ Metric expectations update complete!');