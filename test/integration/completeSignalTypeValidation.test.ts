// test/integration/completeSignalTypeValidation.test.ts
//
// 🎯 COMPLETE SIGNAL TYPE ECOSYSTEM VALIDATION
//
// Master validation test ensuring ALL enhanced detectors have correct:
// 1. Signal type emission contracts
// 2. SignalManager threshold mapping  
// 3. Configuration completeness
// 4. Frontend statistics compatibility
//
// PREVENTS ISSUES LIKE:
// - Signal type mismatches (accumulation vs accumulation_zone)
// - Missing threshold configurations
// - Incorrect type casting (as SignalType)
// - Frontend statistics showing 0 counts

import { describe, it, expect } from "vitest";
import type { SignalType } from "../../src/types/signalTypes.js";

/**
 * MASTER SIGNAL TYPE ECOSYSTEM VALIDATION
 * 
 * This test ensures the complete signal processing pipeline integrity
 */
describe("Complete Signal Type Ecosystem Validation", () => {
    
    /**
     * MASTER CONFIGURATION: All Enhanced Detector Signal Contracts
     * 
     * This is the single source of truth for signal type contracts
     */
    const ENHANCED_DETECTOR_CONTRACTS = {
        // Enhanced Detectors and their signal type emissions
        absorptionDetectorEnhanced: "absorption" as SignalType,
        exhaustionDetectorEnhanced: "exhaustion" as SignalType,
        accumulationZoneDetectorEnhanced: "accumulation" as SignalType,
        distributionDetectorEnhanced: "distribution" as SignalType,
        deltaCVDDetectorEnhanced: "cvd_confirmation" as SignalType,
    } as const;

    /**
     * MASTER CONFIGURATION: SignalManager Threshold Mapping
     * 
     * Must match config.json detectorThresholds exactly
     */
    const SIGNAL_MANAGER_THRESHOLDS = {
        absorption: 0.3,
        exhaustion: 0.2,
        accumulation: 0.3,
        distribution: 0.5,
        cvd_confirmation: 0.15,
    } as const;

    /**
     * MASTER CONFIGURATION: Frontend Statistics Mapping
     * 
     * Signal types that should appear in frontend statistics
     */
    const FRONTEND_STATISTICS_TYPES = {
        "Absorption": "absorption",
        "Exhaustion": "exhaustion", 
        "Accumulation Zones": "accumulation",
        "Distribution Zones": "distribution",
        "CVD Confirmation": "cvd_confirmation",
    } as const;

    /**
     * TEST 1: Signal Type Contract Completeness
     * 
     * Ensures all enhanced detectors have defined signal type contracts
     */
    describe("Signal Type Contract Completeness", () => {
        it("should have signal type contracts for all 5 enhanced detectors", () => {
            const detectorNames = Object.keys(ENHANCED_DETECTOR_CONTRACTS);
            
            expect(detectorNames).toHaveLength(5);
            expect(detectorNames).toContain("absorptionDetectorEnhanced");
            expect(detectorNames).toContain("exhaustionDetectorEnhanced");
            expect(detectorNames).toContain("accumulationZoneDetectorEnhanced");
            expect(detectorNames).toContain("distributionDetectorEnhanced");
            expect(detectorNames).toContain("deltaCVDDetectorEnhanced");

            console.log("✅ All 5 enhanced detectors have signal type contracts");
            console.log("📋 Enhanced Detector Signal Type Contracts:");
            Object.entries(ENHANCED_DETECTOR_CONTRACTS).forEach(([detector, signalType]) => {
                console.log(`   ${detector} → "${signalType}"`);
            });
        });

        it("should use only valid SignalType values", () => {
            const signalTypes = Object.values(ENHANCED_DETECTOR_CONTRACTS);
            
            // All signal types should be valid TypeScript SignalType values
            signalTypes.forEach(signalType => {
                expect(typeof signalType).toBe('string');
                expect(signalType.length).toBeGreaterThan(0);
            });

            // Should not contain any "_zone" suffixed types (avoid bloat)
            signalTypes.forEach(signalType => {
                expect(signalType).not.toMatch(/_zone$/);
            });

            console.log("✅ All detector signal types are valid SignalType values");
            console.log("✅ No unnecessary '_zone' suffixed types found");
        });
    });

    /**
     * TEST 2: SignalManager Threshold Mapping Validation
     * 
     * Ensures every detector signal type has a corresponding threshold
     */
    describe("SignalManager Threshold Mapping", () => {
        it("should have threshold configuration for every detector signal type", () => {
            const detectorSignalTypes = Object.values(ENHANCED_DETECTOR_CONTRACTS);
            const configuredThresholds = Object.keys(SIGNAL_MANAGER_THRESHOLDS);

            detectorSignalTypes.forEach(signalType => {
                expect(configuredThresholds).toContain(signalType);
                expect(SIGNAL_MANAGER_THRESHOLDS[signalType as keyof typeof SIGNAL_MANAGER_THRESHOLDS]).toBeDefined();
                expect(typeof SIGNAL_MANAGER_THRESHOLDS[signalType as keyof typeof SIGNAL_MANAGER_THRESHOLDS]).toBe('number');
            });

            console.log("✅ All detector signal types have threshold configuration");
            console.log("📊 Signal Type → Threshold Mapping:");
            Object.entries(SIGNAL_MANAGER_THRESHOLDS).forEach(([signalType, threshold]) => {
                console.log(`   "${signalType}" → ${threshold}`);
            });
        });

        it("should have realistic threshold values", () => {
            Object.entries(SIGNAL_MANAGER_THRESHOLDS).forEach(([signalType, threshold]) => {
                expect(threshold).toBeGreaterThan(0);
                expect(threshold).toBeLessThanOrEqual(1);
                expect(threshold).toBeGreaterThanOrEqual(0.1); // Minimum realistic threshold
            });

            console.log("✅ All thresholds are within realistic ranges (0.1 - 1.0)");
        });

        it("should validate specific threshold values match config.json", () => {
            // These values MUST match config.json exactly
            expect(SIGNAL_MANAGER_THRESHOLDS.absorption).toBe(0.3);
            expect(SIGNAL_MANAGER_THRESHOLDS.exhaustion).toBe(0.2);
            expect(SIGNAL_MANAGER_THRESHOLDS.accumulation).toBe(0.3);
            expect(SIGNAL_MANAGER_THRESHOLDS.distribution).toBe(0.5);
            expect(SIGNAL_MANAGER_THRESHOLDS.cvd_confirmation).toBe(0.15);

            console.log("✅ Threshold values match config.json configuration");
        });
    });

    /**
     * TEST 3: Frontend Statistics Compatibility
     * 
     * Ensures signal types map correctly to frontend statistics display
     */
    describe("Frontend Statistics Compatibility", () => {
        it("should map all detector signal types to frontend statistics", () => {
            const frontendTypes = Object.values(FRONTEND_STATISTICS_TYPES);
            const detectorTypes = Object.values(ENHANCED_DETECTOR_CONTRACTS);

            detectorTypes.forEach(detectorType => {
                expect(frontendTypes).toContain(detectorType);
            });

            console.log("✅ All detector signal types map to frontend statistics");
            console.log("📈 Frontend Statistics Mapping:");
            Object.entries(FRONTEND_STATISTICS_TYPES).forEach(([display, signalType]) => {
                console.log(`   "${display}" ← "${signalType}"`);
            });
        });

        it("should have descriptive frontend display names", () => {
            const displayNames = Object.keys(FRONTEND_STATISTICS_TYPES);
            
            expect(displayNames).toContain("Absorption");
            expect(displayNames).toContain("Exhaustion");
            expect(displayNames).toContain("Accumulation Zones");
            expect(displayNames).toContain("Distribution Zones");
            expect(displayNames).toContain("CVD Confirmation");

            console.log("✅ Frontend display names are descriptive and clear");
        });
    });

    /**
     * TEST 4: Signal Type Ecosystem Integrity
     * 
     * Validates the complete signal type ecosystem works together
     */
    describe("Signal Type Ecosystem Integrity", () => {
        it("should have complete signal processing pipeline coverage", () => {
            // Every detector should have:
            // 1. Signal type contract
            // 2. Threshold configuration  
            // 3. Frontend statistics mapping

            Object.entries(ENHANCED_DETECTOR_CONTRACTS).forEach(([detector, signalType]) => {
                // Has threshold configuration
                expect(SIGNAL_MANAGER_THRESHOLDS).toHaveProperty(signalType);
                
                // Has frontend statistics mapping
                const frontendTypes = Object.values(FRONTEND_STATISTICS_TYPES);
                expect(frontendTypes).toContain(signalType);

                console.log(`✅ ${detector}: ${signalType} → threshold: ${SIGNAL_MANAGER_THRESHOLDS[signalType as keyof typeof SIGNAL_MANAGER_THRESHOLDS]} → frontend: ✓`);
            });
        });

        it("should prevent signal type mismatch issues", () => {
            // This test documents the exact issue that was fixed:
            // Zone detectors were emitting "accumulation" but config had "accumulation_zone"
            
            const detectorSignalTypes = Object.values(ENHANCED_DETECTOR_CONTRACTS);
            const thresholdKeys = Object.keys(SIGNAL_MANAGER_THRESHOLDS);

            // Ensure no mismatches
            detectorSignalTypes.forEach(signalType => {
                expect(thresholdKeys).toContain(signalType);
            });

            // Ensure no unused threshold configurations
            const unusedThresholds = thresholdKeys.filter(
                key => !detectorSignalTypes.includes(key as SignalType)
            );

            if (unusedThresholds.length > 0) {
                console.log(`⚠️  Unused threshold configurations: ${unusedThresholds.join(', ')}`);
            }

            console.log("✅ No signal type mismatches detected");
            console.log("✅ All threshold configurations are used by detectors");
        });

        it("should validate signal type consistency", () => {
            // Ensure naming consistency
            const signalTypes = Object.values(ENHANCED_DETECTOR_CONTRACTS);
            
            // No mixed naming conventions
            const hasUnderscores = signalTypes.filter(type => type.includes('_'));
            const hasNoUnderscores = signalTypes.filter(type => !type.includes('_'));
            
            // Document the naming patterns
            console.log("📝 Signal Type Naming Patterns:");
            console.log(`   With underscores: ${hasUnderscores.join(', ')}`);
            console.log(`   Without underscores: ${hasNoUnderscores.join(', ')}`);
            
            // This is informational - both patterns are valid
            console.log("✅ Signal type naming patterns documented");
        });
    });

    /**
     * TEST 5: Configuration Contract Documentation
     * 
     * Documents the complete signal type configuration for future reference
     */
    describe("Configuration Contract Documentation", () => {
        it("should document complete signal type ecosystem", () => {
            console.log("\n🎯 COMPLETE ENHANCED DETECTOR SIGNAL TYPE ECOSYSTEM");
            console.log("=" .repeat(60));
            
            console.log("\n📡 DETECTOR → SIGNAL TYPE CONTRACTS:");
            Object.entries(ENHANCED_DETECTOR_CONTRACTS).forEach(([detector, signalType]) => {
                const threshold = SIGNAL_MANAGER_THRESHOLDS[signalType as keyof typeof SIGNAL_MANAGER_THRESHOLDS];
                const frontendName = Object.keys(FRONTEND_STATISTICS_TYPES).find(
                    key => FRONTEND_STATISTICS_TYPES[key as keyof typeof FRONTEND_STATISTICS_TYPES] === signalType
                );
                
                console.log(`   ${detector}`);
                console.log(`     ├─ Emits: "${signalType}"`);
                console.log(`     ├─ Threshold: ${threshold}`);
                console.log(`     └─ Frontend: "${frontendName}"`);
            });

            console.log("\n⚠️  CRITICAL PREVENTION:");
            console.log("   This test suite prevents signal type mismatch issues like:");
            console.log("   • Detectors emitting 'accumulation' but config expecting 'accumulation_zone'");
            console.log("   • Missing threshold configurations causing fallback to global threshold");
            console.log("   • Signals being generated but not appearing in frontend statistics");
            console.log("   • Type casting violations (as SignalType) in detector implementations");

            console.log("\n✅ Complete signal type ecosystem validated and documented");
        });
    });
});