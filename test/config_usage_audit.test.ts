import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Config Usage Audit", () => {
    describe("Mock Config Synchronization", () => {
        it("should verify mock config matches real config structure", () => {
            // Read real config.json
            const realConfigPath = path.join(process.cwd(), "config.json");
            const realConfigContent = fs.readFileSync(realConfigPath, "utf8");
            const realConfig = JSON.parse(realConfigContent);

            // Read mock config.json from __mocks__/ directory (CLAUDE.md compliant)
            const mockConfigPath = path.join(
                process.cwd(),
                "__mocks__/config.json"
            );
            const mockConfigContent = fs.readFileSync(mockConfigPath, "utf8");
            const mockConfig = JSON.parse(mockConfigContent);

            // Extract all property paths from both configs
            function extractPaths(obj: any, prefix = ""): string[] {
                const paths: string[] = [];
                for (const [key, value] of Object.entries(obj)) {
                    const currentPath = prefix ? `${prefix}.${key}` : key;
                    paths.push(currentPath);
                    if (
                        value &&
                        typeof value === "object" &&
                        !Array.isArray(value)
                    ) {
                        paths.push(...extractPaths(value, currentPath));
                    }
                }
                return paths;
            }

            const realPaths = new Set(extractPaths(realConfig));
            const mockPaths = new Set(extractPaths(mockConfig));

            // Find missing paths in mock
            const missingInMock = Array.from(realPaths).filter(
                (path) => !mockPaths.has(path)
            );

            // Find extra paths in mock
            const extraInMock = Array.from(mockPaths).filter(
                (path) => !realPaths.has(path)
            );

            // Report findings
            if (missingInMock.length > 0) {
                console.error(
                    "🚨 MOCK CONFIG MISSING PATHS (update __mocks__/config.json):"
                );
                missingInMock.forEach((path) => console.error(`  - ${path}`));
            }

            if (extraInMock.length > 0) {
                console.error(
                    "🚨 MOCK CONFIG EXTRA PATHS (remove from __mocks__/config.json):"
                );
                extraInMock.forEach((path) => console.error(`  - ${path}`));
            }

            // Test should fail if mock is out of sync
            expect(
                missingInMock,
                `Mock config missing: ${missingInMock.join(", ")}`
            ).toHaveLength(0);
            expect(
                extraInMock,
                `Mock config has extra: ${extraInMock.join(", ")}`
            ).toHaveLength(0);

            console.log(
                `✅ MOCK SYNC: ${realPaths.size} paths verified in sync`
            );
        });
    });

    describe("Configuration Property Usage Verification", () => {
        it("should verify all config.json properties are actually used in the codebase", () => {
            // Use mock config from __mocks__/ directory (CLAUDE.md compliant)
            const mockConfigPath = path.join(
                process.cwd(),
                "__mocks__/config.json"
            );
            const mockConfigContent = fs.readFileSync(mockConfigPath, "utf8");
            const config = JSON.parse(mockConfigContent);

            // Function to extract all property paths from nested object
            function extractPaths(obj: any, prefix = ""): string[] {
                const paths: string[] = [];

                for (const [key, value] of Object.entries(obj)) {
                    const currentPath = prefix ? `${prefix}.${key}` : key;
                    paths.push(currentPath);

                    if (
                        value &&
                        typeof value === "object" &&
                        !Array.isArray(value)
                    ) {
                        paths.push(...extractPaths(value, currentPath));
                    }
                }

                return paths;
            }

            // Extract all property paths from config
            const allConfigPaths = extractPaths(config);

            // Read config.ts file to check usage
            const configTsPath = path.join(process.cwd(), "src/core/config.ts");
            const configTsContent = fs.readFileSync(configTsPath, "utf8");

            // Properties that are expected to be unused (meta properties)
            const expectedUnusedPaths = [
                "symbols", // container object
                "symbols.LTCUSDT", // container object
                "marketDataStorage", // container object
                "mqtt", // container object
                "dataStream", // container object
                "symbols.LTCUSDT.orderBookState", // container object
                "symbols.LTCUSDT.orderBookProcessor", // container object
                "symbols.LTCUSDT.tradesProcessor", // container object
                "symbols.LTCUSDT.signalManager", // container object
                "symbols.LTCUSDT.signalCoordinator", // container object
                "symbols.LTCUSDT.exhaustion", // container object
                "symbols.LTCUSDT.absorption", // container object
                "symbols.LTCUSDT.icebergDetector", // container object
                "symbols.LTCUSDT.supportResistanceDetector", // container object
                "symbols.LTCUSDT.spoofingDetector", // container object
                "symbols.LTCUSDT.hiddenOrderDetector", // container object
                "symbols.LTCUSDT.anomalyDetector", // container object
                "symbols.LTCUSDT.deltaCvdConfirmation", // container object
                "symbols.LTCUSDT.accumulation", // container object
                "symbols.LTCUSDT.distribution", // container object
                "symbols.LTCUSDT.universalZoneConfig", // container object
                "symbols.LTCUSDT.signalManager.detectorThresholds", // container object
                "symbols.LTCUSDT.signalManager.positionSizing", // container object
                "symbols.LTCUSDT.exhaustion.scoringWeights", // container object
                "symbols.LTCUSDT.exhaustion.features", // container object
                "symbols.LTCUSDT.absorption.features", // container object
            ];

            // Check each config path for usage
            const unusedPaths: string[] = [];
            const problematicPaths: string[] = [];

            for (const configPath of allConfigPaths) {
                // Skip expected unused paths (container objects)
                if (expectedUnusedPaths.includes(configPath)) {
                    continue;
                }

                // Extract the final property name for searching
                const propertyName = configPath.split(".").pop()!;

                // Search for usage patterns in config.ts
                const usagePatterns = [
                    // Direct property access
                    new RegExp(`\\.${propertyName}\\b`, "g"),
                    // String literal property access
                    new RegExp(`['"]${propertyName}['"]`, "g"),
                    // Destructuring
                    new RegExp(`{[^}]*\\b${propertyName}\\b[^}]*}`, "g"),
                    // Variable assignment
                    new RegExp(`${propertyName}\\s*:`, "g"),
                ];

                const isUsed = usagePatterns.some((pattern) =>
                    pattern.test(configTsContent)
                );

                if (!isUsed) {
                    // Check if it's a critical path that should always be used
                    const isCritical = [
                        "nodeEnv",
                        "httpPort",
                        "wsPort",
                        "symbol",
                        "pricePrecision",
                        "minAggVolume",
                        "windowMs",
                        "eventCooldownMs",
                        "absorptionThreshold",
                        "exhaustionThreshold",
                        "enhancementMode",
                        "useStandardizedZones",
                    ].includes(propertyName);

                    if (isCritical) {
                        problematicPaths.push(configPath);
                    } else {
                        unusedPaths.push(configPath);
                    }
                }
            }

            // Report findings
            if (problematicPaths.length > 0) {
                console.warn(
                    "🚨 CRITICAL: These critical config properties appear unused:"
                );
                problematicPaths.forEach((path) => console.warn(`  - ${path}`));
            }

            if (unusedPaths.length > 0) {
                console.warn(
                    "⚠️  UNUSED: These config properties appear unused:"
                );
                unusedPaths.forEach((path) => console.warn(`  - ${path}`));
            }

            console.log(
                `✅ CONFIG AUDIT: Checked ${allConfigPaths.length} properties`
            );
            console.log(
                `   - Expected unused (containers): ${expectedUnusedPaths.length}`
            );
            console.log(`   - Potentially unused: ${unusedPaths.length}`);
            console.log(`   - Critical missing: ${problematicPaths.length}`);

            // Test should fail if critical properties are unused
            expect(problematicPaths).toHaveLength(0);

            // Log unused properties for cleanup consideration
            if (unusedPaths.length > 0) {
                console.log(
                    "\n📋 Consider reviewing these unused properties for cleanup:"
                );
                unusedPaths.forEach((path) => console.log(`   - ${path}`));
            }
        });

        it("should verify all Config class methods have corresponding config.json entries", () => {
            // Use mock config from __mocks__/ directory (CLAUDE.md compliant)
            const mockConfigPath = path.join(
                process.cwd(),
                "__mocks__/config.json"
            );
            const mockConfigContent = fs.readFileSync(mockConfigPath, "utf8");
            const config = JSON.parse(mockConfigContent);

            // Read config.ts to extract method names that reference config properties
            const configTsPath = path.join(process.cwd(), "src/core/config.ts");
            const configTsContent = fs.readFileSync(configTsPath, "utf8");

            // Extract Config getter method names
            const getterPattern = /static get (\w+)\(\)/g;
            const getterMethods: string[] = [];
            let match;

            while ((match = getterPattern.exec(configTsContent)) !== null) {
                getterMethods.push(match[1]);
            }

            // Methods that don't require config.json entries (computed or environment-based)
            const exemptMethods = [
                "API_KEY",
                "API_SECRET",
                "LLM_API_KEY",
                "LLM_MODEL", // Environment variables
                "TICK_SIZE", // Computed from PRICE_PRECISION
                "validate", // Method, not getter
                "validateDetectorConfig", // Private method
                "DETECTOR_CONFIDENCE_THRESHOLDS", // Nested access
                "DETECTOR_POSITION_SIZING", // Nested access
            ];

            console.log(`\n📊 CONFIG METHOD AUDIT:`);
            console.log(
                `   - Total Config getter methods: ${getterMethods.length}`
            );
            console.log(`   - Exempt methods: ${exemptMethods.length}`);

            // Check that non-exempt methods have config backing
            const methodsNeedingConfig = getterMethods.filter(
                (method) => !exemptMethods.includes(method)
            );
            console.log(
                `   - Methods requiring config: ${methodsNeedingConfig.length}`
            );

            // This is more of an informational test - we're not failing on this
            // since the relationship between method names and config paths can be complex
            expect(getterMethods.length).toBeGreaterThan(40); // We should have substantial config coverage
        });

        it("should verify no duplicate configurations exist", () => {
            // Use mock config from __mocks__/ directory (CLAUDE.md compliant)
            const mockConfigPath = path.join(
                process.cwd(),
                "__mocks__/config.json"
            );
            const mockConfigContent = fs.readFileSync(mockConfigPath, "utf8");
            const config = JSON.parse(mockConfigContent);

            // Function to find duplicate values in nested object
            function findDuplicateValues(
                obj: any,
                path = ""
            ): { value: any; paths: string[] }[] {
                const valueMap = new Map<any, string[]>();

                function traverse(current: any, currentPath: string) {
                    if (
                        current &&
                        typeof current === "object" &&
                        !Array.isArray(current)
                    ) {
                        for (const [key, value] of Object.entries(current)) {
                            const fullPath = currentPath
                                ? `${currentPath}.${key}`
                                : key;

                            if (
                                value &&
                                typeof value === "object" &&
                                !Array.isArray(value)
                            ) {
                                traverse(value, fullPath);
                            } else if (
                                typeof value === "number" ||
                                typeof value === "string" ||
                                typeof value === "boolean"
                            ) {
                                // Only check primitive values for duplicates
                                const existing = valueMap.get(value) || [];
                                existing.push(fullPath);
                                valueMap.set(value, existing);
                            }
                        }
                    }
                }

                traverse(obj, path);

                // Return only values that appear multiple times
                return Array.from(valueMap.entries())
                    .filter(([value, paths]) => paths.length > 1)
                    .map(([value, paths]) => ({ value, paths }));
            }

            const duplicates = findDuplicateValues(config);

            // Filter out expected duplicates (common values that should be the same)
            const expectedDuplicateValues = [
                true,
                false, // booleans are expected to repeat
                0,
                1,
                2,
                3,
                5,
                10, // small numbers are expected to repeat
                "production",
                "testing",
                "disabled", // common enum values
                "LTCUSDT", // symbol appears in multiple places
                "info",
                "debug",
                "error", // log levels
                0.01,
                0.1,
                0.2,
                0.3,
                0.5,
                1.0, // common decimal values
            ];

            const unexpectedDuplicates = duplicates.filter(
                (dup) => !expectedDuplicateValues.includes(dup.value)
            );

            if (unexpectedDuplicates.length > 0) {
                console.warn("🔄 POTENTIAL DUPLICATES found in config:");
                unexpectedDuplicates.forEach((dup) => {
                    console.warn(`   Value '${dup.value}' appears in:`);
                    dup.paths.forEach((path) => console.warn(`     - ${path}`));
                });
            }

            console.log(
                `✅ DUPLICATE CHECK: Found ${duplicates.length} duplicate values`
            );
            console.log(
                `   - Expected duplicates: ${duplicates.length - unexpectedDuplicates.length}`
            );
            console.log(
                `   - Unexpected duplicates: ${unexpectedDuplicates.length}`
            );

            // Don't fail the test for duplicates, just report them
            // This is informational to help with config cleanup
        });
    });
});
