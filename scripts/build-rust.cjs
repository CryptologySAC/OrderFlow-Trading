#!/usr/bin/env node

/**
 * Unified Rust Build System
 *
 * This script provides a centralized way to build all Rust native addons
 * following the clean architecture pattern (core + bindings separation).
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..");
const RUST_DIR = path.join(ROOT_DIR, "rust");

// Build targets with their configurations
const BUILD_TARGETS = {
    "financial-math": {
        type: "legacy",
        buildCommand: "cd rust/bindings && neon build --release",
        output: "rust/bindings/native/index.node",
        destination: "rust/financial-math/native/index.node",
    },
    btreemap: {
        type: "core-bindings",
        buildCommand: "cd rust/btreemap-bindings && neon build --release",
        output: "rust/btreemap-bindings/native/index.node",
        destination: "rust/btreemap/native/index.node",
    },
    orderbook: {
        type: "core-bindings",
        buildCommand: "cd rust/orderbook-bindings && neon build --release",
        output: "rust/orderbook-bindings/native/index.node",
        destination: "rust/orderbook/native/index.node",
    },
};

function log(message, type = "info") {
    const timestamp = new Date().toISOString();
    const colors = {
        info: "\x1b[36m",
        success: "\x1b[32m",
        error: "\x1b[31m",
        warning: "\x1b[33m",
        reset: "\x1b[0m",
    };

    console.log(`${colors[type]}[${timestamp}] ${message}${colors.reset}`);
}

function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        log(`Created directory: ${dirPath}`);
    }
}

function copyFile(source, destination) {
    ensureDirectoryExists(path.dirname(destination));
    fs.copyFileSync(source, destination);
    log(`Copied ${source} -> ${destination}`);
}

function buildTarget(name, config) {
    log(`Building ${name}...`, "info");

    try {
        // Execute build command
        execSync(config.buildCommand, {
            cwd: ROOT_DIR,
            stdio: "inherit",
            env: { ...process.env, RUST_BACKTRACE: "1" },
        });

        // Copy output to destination if needed
        if (config.output && config.destination) {
            if (fs.existsSync(path.join(ROOT_DIR, config.output))) {
                copyFile(
                    path.join(ROOT_DIR, config.output),
                    path.join(ROOT_DIR, config.destination)
                );
            } else {
                log(
                    `Warning: Output file not found: ${config.output}`,
                    "warning"
                );
            }
        }

        log(`✅ ${name} built successfully`, "success");
    } catch (error) {
        log(`❌ Failed to build ${name}: ${error.message}`, "error");
        throw error;
    }
}

function buildAll(targets = null) {
    const targetsToBuild = targets || Object.keys(BUILD_TARGETS);

    log(
        `Starting unified Rust build for: ${targetsToBuild.join(", ")}`,
        "info"
    );
    log("=".repeat(60), "info");

    const results = [];

    for (const target of targetsToBuild) {
        if (!BUILD_TARGETS[target]) {
            log(`Unknown target: ${target}`, "error");
            continue;
        }

        try {
            buildTarget(target, BUILD_TARGETS[target]);
            results.push({ target, success: true });
        } catch (error) {
            results.push({ target, success: false, error: error.message });
        }
    }

    log("=".repeat(60), "info");

    // Summary
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    if (successful.length > 0) {
        log(
            `✅ Successfully built: ${successful.map((r) => r.target).join(", ")}`,
            "success"
        );
    }

    if (failed.length > 0) {
        log(
            `❌ Failed to build: ${failed.map((r) => r.target).join(", ")}`,
            "error"
        );
        failed.forEach((f) => log(`   ${f.target}: ${f.error}`, "error"));
        process.exit(1);
    }

    log("🎉 All Rust addons built successfully!", "success");
}

function showHelp() {
    console.log(`
Unified Rust Build System

Usage:
  node scripts/build-rust.js [targets...]

Targets:
  financial-math    Build financial math addon (legacy structure)
  btreemap         Build BTreeMap addon (core + bindings)
  orderbook        Build orderbook addon (core + bindings)
  all              Build all addons (default)

Examples:
  node scripts/build-rust.js all
  node scripts/build-rust.js btreemap orderbook
  node scripts/build-rust.js financial-math

Environment Variables:
  RUST_BACKTRACE=1    Enable detailed Rust backtraces
  RUST_LOG=debug      Enable debug logging
`);
}

function main() {
    const args = process.argv.slice(2);

    if (args.includes("--help") || args.includes("-h")) {
        showHelp();
        return;
    }

    if (args.length === 0 || args.includes("all")) {
        buildAll();
    } else {
        const validTargets = args.filter((arg) => BUILD_TARGETS[arg]);
        const invalidTargets = args.filter((arg) => !BUILD_TARGETS[arg]);

        if (invalidTargets.length > 0) {
            log(`Invalid targets: ${invalidTargets.join(", ")}`, "error");
            log(
                "Valid targets: " + Object.keys(BUILD_TARGETS).join(", "),
                "error"
            );
            process.exit(1);
        }

        buildAll(validTargets);
    }
}

if (require.main === module) {
    main();
}

module.exports = { buildAll, buildTarget, BUILD_TARGETS };
