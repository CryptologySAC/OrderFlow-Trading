#!/usr/bin/env node

const fs = require('fs');

// Fix the DeltaCVD constructor calls in config validation tests
const filePath = './test/detectors_config_validation.test.ts';
let content = fs.readFileSync(filePath, 'utf8');

// Pattern to match the old constructor signature
const oldConstructorPattern = /new DeltaCVDDetectorEnhanced\(\s*"test-deltacvd",\s*settings,\s*createMockPreprocessor\(\),\s*mockLogger,\s*mockSpoofing,\s*mockMetrics,\s*mockSignalLogger\s*\)/g;

// New constructor signature
const newConstructor = `new DeltaCVDDetectorEnhanced(
                "test-deltacvd",
                "LTCUSDT",
                settings,
                createMockPreprocessor(),
                mockLogger,
                mockMetrics,
                mockSignalLogger
            )`;

// Count matches
const matches = content.match(oldConstructorPattern);
const matchCount = matches ? matches.length : 0;

if (matchCount > 0) {
    // Replace all occurrences
    content = content.replace(oldConstructorPattern, newConstructor);
    
    // Write back the file
    fs.writeFileSync(filePath, content);
    
    console.log(`✅ Fixed ${matchCount} DeltaCVD constructor calls in detectors_config_validation.test.ts`);
} else {
    console.log('ℹ️  No DeltaCVD constructor calls found to fix');
}

console.log('✅ Config validation constructor fixes complete!');