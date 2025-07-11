#!/usr/bin/env node

/**
 * Script to systematically fix DeltaCVD test files for standalone architecture
 */

const fs = require('fs');
const path = require('path');

const testFiles = [
    'test/deltaCVDConfirmation_divergence.test.ts',
    'test/deltaCVDConfirmation_volumeSurge.test.ts', 
    'test/deltaCVDConfirmation_realWorldScenarios.test.ts',
    'test/deltaCVDConfirmation_preciseValidation.test.ts'
];

for (const testFile of testFiles) {
    const filePath = path.join(__dirname, testFile);
    
    if (!fs.existsSync(filePath)) {
        console.log(`Skipping ${testFile} - file not found`);
        continue;
    }
    
    console.log(`Fixing ${testFile}...`);
    
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Fix imports
    content = content.replace(/vi\.mock\("\.\.\/src\/services\/spoofingDetector"\);?\s*/g, '');
    content = content.replace(/import \{ WorkerLogger \} from "\.\.\/src\/multithreading\/workerLogger";?/g, 'import type { ILogger } from "../src/infrastructure/loggerInterface.js";');
    content = content.replace(/import \{ SpoofingDetector \} from "\.\.\/src\/services\/spoofingDetector";?/g, '');
    content = content.replace(/from "\.\.\/src\/indicators\/deltaCVDDetectorEnhanced"/g, 'from "../src/indicators/deltaCVDDetectorEnhanced.js"');
    content = content.replace(/from "\.\.\/src\/market\/orderFlowPreprocessor"/g, 'from "../src/market/orderFlowPreprocessor.js"');
    content = content.replace(/from "\.\.\/src\/types\/marketEvents"/g, 'from "../src/types/marketEvents.js"');
    
    // Fix variable declarations
    content = content.replace(/let mockLogger: WorkerLogger;/g, 'let mockLogger: ILogger;');
    content = content.replace(/let mockSpoofing: SpoofingDetector;/g, '');
    content = content.replace(/let mockSpoofingDetector: SpoofingDetector;/g, '');
    
    // Fix logger initialization
    content = content.replace(/mockLogger = new WorkerLogger\(\);/g, `mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            trace: vi.fn(),
        } as ILogger;`);
    
    // Fix spoofing detector initialization
    content = content.replace(/mockSpoofing = new SpoofingDetector\([^}]+\};?\s*/gm, '');
    content = content.replace(/mockSpoofingDetector = new SpoofingDetector\([^}]+\};?\s*/gm, '');
    
    // Fix constructor calls - add symbol parameter and remove spoofing detector
    content = content.replace(
        /new DeltaCVDDetectorEnhanced\(\s*"([^"]+)",\s*([^,]+),\s*mockPreprocessor,\s*mockLogger,\s*mockSpoofing,?\s*mockMetrics/gm,
        'new DeltaCVDDetectorEnhanced(\n                "$1",\n                "LTCUSDT",\n                $2,\n                mockPreprocessor,\n                mockLogger,\n                mockMetrics'
    );
    
    content = content.replace(
        /new DeltaCVDDetectorEnhanced\(\s*"([^"]+)",\s*([^,]+),\s*mockPreprocessor,\s*mockLogger,\s*mockSpoofingDetector,?\s*mockMetrics/gm,
        'new DeltaCVDDetectorEnhanced(\n                "$1",\n                "LTCUSDT",\n                $2,\n                mockPreprocessor,\n                mockLogger,\n                mockMetrics'
    );
    
    // Fix detection mode constants
    content = content.replace(/detectionMode: "divergence"/g, 'detectionMode: "divergence" as const');
    content = content.replace(/detectionMode: "momentum"/g, 'detectionMode: "momentum" as const');
    content = content.replace(/detectionMode: "hybrid"/g, 'detectionMode: "hybrid" as const');
    
    fs.writeFileSync(filePath, content);
    console.log(`Fixed ${testFile}`);
}

console.log('All DeltaCVD test files have been updated for standalone architecture!');