#!/usr/bin/env node

const fs = require('fs');

// Fix the DeltaCVD constructor calls in signal generation debug tests
const filePath = './test/detectors_signal_generation_debug.test.ts';
let content = fs.readFileSync(filePath, 'utf8');

// Pattern to match DeltaCVD constructors with old signature
const patterns = [
    // Pattern 1: "debug-deltacvd" constructor
    {
        old: /new DeltaCVDDetectorEnhanced\(\s*"debug-deltacvd",\s*completeDeltaCVDSettings,\s*mockPreprocessor,\s*mockLogger,\s*mockSpoofing,\s*mockMetrics,\s*mockSignalLogger\s*\)/g,
        new: `new DeltaCVDDetectorEnhanced(
                "debug-deltacvd",
                "LTCUSDT",
                completeDeltaCVDSettings,
                mockPreprocessor,
                mockLogger,
                mockMetrics,
                mockSignalLogger
            )`
    },
    // Pattern 2: "compare-deltacvd" constructor
    {
        old: /new DeltaCVDDetectorEnhanced\(\s*"compare-deltacvd",\s*completeDeltaCVDSettings,\s*mockPreprocessor,\s*mockLogger,\s*mockSpoofing,\s*mockMetrics,\s*mockSignalLogger\s*\)/g,
        new: `new DeltaCVDDetectorEnhanced(
                "compare-deltacvd",
                "LTCUSDT",
                completeDeltaCVDSettings,
                mockPreprocessor,
                mockLogger,
                mockMetrics,
                mockSignalLogger
            )`
    }
];

let totalFixCount = 0;

patterns.forEach((pattern, index) => {
    const matches = content.match(pattern.old);
    const matchCount = matches ? matches.length : 0;
    
    if (matchCount > 0) {
        content = content.replace(pattern.old, pattern.new);
        console.log(`✅ Pattern ${index + 1}: Fixed ${matchCount} DeltaCVD constructor call(s)`);
        totalFixCount += matchCount;
    }
});

if (totalFixCount > 0) {
    // Write back the file
    fs.writeFileSync(filePath, content);
    console.log(`✅ Fixed ${totalFixCount} total DeltaCVD constructor calls in detectors_signal_generation_debug.test.ts`);
} else {
    console.log('ℹ️  No DeltaCVD constructor calls found to fix');
}

console.log('✅ Signal generation debug constructor fixes complete!');