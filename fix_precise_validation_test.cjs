#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Function to fix DeltaCVD test files by removing mockSpoofing references
function fixPreciseValidationTest() {
    const testFile = './test/deltaCVDConfirmation_preciseValidation.test.ts';
    
    console.log(`\n=== Fixing ${testFile} ===`);
    
    if (!fs.existsSync(testFile)) {
        console.log(`❌ File not found: ${testFile}`);
        return false;
    }
    
    let content = fs.readFileSync(testFile, 'utf8');
    let changeCount = 0;
    
    // Function to log changes
    function logChange(oldText, newText, description) {
        console.log(`  ✅ ${description}`);
        console.log(`     OLD: ${oldText.slice(0, 60)}...`);
        console.log(`     NEW: ${newText.slice(0, 60)}...`);
        changeCount++;
    }
    
    // Fix 1: Remove all mockSpoofing references from constructor calls
    const spoofingConstructorPattern = /,\s*mockSpoofing,/g;
    const oldContent1 = content;
    content = content.replace(spoofingConstructorPattern, ',');
    if (content !== oldContent1) {
        logChange('mockSpoofing,', '', 'Removed mockSpoofing from constructors');
    }
    
    // Fix 2: Add symbol parameter to constructors that are missing it
    const constructorPattern = /new DeltaCVDDetectorEnhanced\(\s*"([^"]+)",\s*\{/g;
    const oldContent2 = content;
    content = content.replace(constructorPattern, 'new DeltaCVDDetectorEnhanced(\n                "$1",\n                "LTCUSDT",\n                {');
    if (content !== oldContent2) {
        logChange('new DeltaCVDDetectorEnhanced("id", {', 'new DeltaCVDDetectorEnhanced("id", "LTCUSDT", {', 'Added symbol parameter to constructors');
    }
    
    // Fix 3: Fix any remaining constructor spacing issues
    const spacingPattern = /new DeltaCVDDetectorEnhanced\(\s*"([^"]+)",\s*"([^"]+)",\s*\{([^}]+)\},\s*mockPreprocessor,\s*mockLogger,\s*mockMetrics\s*\)/g;
    const oldContent3 = content;
    content = content.replace(spacingPattern, 'new DeltaCVDDetectorEnhanced(\n                "$1",\n                "$2",\n                {$3},\n                mockPreprocessor,\n                mockLogger,\n                mockMetrics\n            )');
    if (content !== oldContent3) {
        logChange('Compressed constructor', 'Formatted constructor', 'Fixed constructor formatting');
    }
    
    // Write the file back
    fs.writeFileSync(testFile, content);
    
    console.log(`  📝 Total changes: ${changeCount}`);
    console.log(`  ✅ Fixed ${testFile}`);
    
    return changeCount > 0;
}

// Function to fix real world scenarios test
function fixRealWorldScenariosTest() {
    const testFile = './test/deltaCVDConfirmation_realWorldScenarios.test.ts';
    
    console.log(`\n=== Fixing ${testFile} ===`);
    
    if (!fs.existsSync(testFile)) {
        console.log(`❌ File not found: ${testFile}`);
        return false;
    }
    
    let content = fs.readFileSync(testFile, 'utf8');
    let changeCount = 0;
    
    // Function to log changes
    function logChange(oldText, newText, description) {
        console.log(`  ✅ ${description}`);
        console.log(`     OLD: ${oldText.slice(0, 60)}...`);
        console.log(`     NEW: ${newText.slice(0, 60)}...`);
        changeCount++;
    }
    
    // Fix 1: Remove all mockSpoofing references from constructor calls
    const spoofingConstructorPattern = /,\s*mockSpoofing,/g;
    const oldContent1 = content;
    content = content.replace(spoofingConstructorPattern, ',');
    if (content !== oldContent1) {
        logChange('mockSpoofing,', '', 'Removed mockSpoofing from constructors');
    }
    
    // Fix 2: Add symbol parameter where missing and fix constructor formatting
    const constructorFixPattern = /new DeltaCVDDetectorEnhanced\(\s*"([^"]+)",\s*\{/g;
    const oldContent2 = content;
    content = content.replace(constructorFixPattern, 'new DeltaCVDDetectorEnhanced(\n                "$1",\n                "LTCUSDT",\n                {');
    if (content !== oldContent2) {
        logChange('new DeltaCVDDetectorEnhanced("id", {', 'new DeltaCVDDetectorEnhanced("id", "LTCUSDT", {', 'Added symbol parameter to constructors');
    }
    
    // Write the file back
    fs.writeFileSync(testFile, content);
    
    console.log(`  📝 Total changes: ${changeCount}`);
    console.log(`  ✅ Fixed ${testFile}`);
    
    return changeCount > 0;
}

// Main execution
console.log('🔧 Fixing DeltaCVD test files - mockSpoofing removal and constructor fixes');

let totalChanges = 0;

// Fix both test files
if (fixPreciseValidationTest()) totalChanges++;
if (fixRealWorldScenariosTest()) totalChanges++;

console.log(`\n🎯 SUMMARY: Fixed ${totalChanges} test files with constructor and mockSpoofing issues`);
console.log('✅ Ready to run tests again!');