#!/usr/bin/env npx tsx

/**
 * Clean up unused variables detected by TypeScript compiler
 * This prevents issues with compiled JavaScript missing expected functionality
 */

import { execSync } from "child_process";
import fs from "fs";

console.log("🧹 Cleaning unused variables from TypeScript files...");

// Get TypeScript errors
try {
    execSync("tsc -p tsconfig.build.json", { stdio: "pipe" });
    console.log("✅ No TypeScript errors found!");
} catch (error: any) {
    const output = error.stdout?.toString() || error.stderr?.toString() || "";

    // Parse unused variable errors
    const unusedVarRegex =
        /(.+?)\((\d+),(\d+)\): error TS6133: '(.+?)' is declared but its value is never read\./g;
    const unusedPropRegex =
        /(.+?)\((\d+),(\d+)\): error TS6138: Property '(.+?)' is declared but its value is never read\./g;

    const unusedVars: Array<{
        file: string;
        line: number;
        col: number;
        name: string;
        type: "var" | "prop";
    }> = [];

    let match;
    while ((match = unusedVarRegex.exec(output)) !== null) {
        unusedVars.push({
            file: match[1],
            line: parseInt(match[2]),
            col: parseInt(match[3]),
            name: match[4],
            type: "var",
        });
    }

    while ((match = unusedPropRegex.exec(output)) !== null) {
        unusedVars.push({
            file: match[1],
            line: parseInt(match[2]),
            col: parseInt(match[3]),
            name: match[4],
            type: "prop",
        });
    }

    console.log(`Found ${unusedVars.length} unused variables/properties:`);

    // Group by file
    const fileGroups = unusedVars.reduce(
        (acc, item) => {
            if (!acc[item.file]) acc[item.file] = [];
            acc[item.file].push(item);
            return acc;
        },
        {} as Record<string, typeof unusedVars>
    );

    Object.entries(fileGroups).forEach(([file, vars]) => {
        console.log(`\n📄 ${file}:`);
        vars.forEach((v) => {
            console.log(`  - Line ${v.line}: ${v.name} (${v.type})`);
        });
    });

    console.log("\n⚠️  These need to be manually reviewed and removed.");
    console.log("💡 Consider:");
    console.log("   - Remove if truly unused");
    console.log(
        "   - Add underscore prefix (_variable) if intentionally unused"
    );
    console.log(
        "   - Add // eslint-disable-next-line @typescript-eslint/no-unused-vars if needed"
    );
}
