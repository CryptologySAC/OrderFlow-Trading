import eslintPluginPrettier from "eslint-plugin-prettier";
import eslintPluginTs from "@typescript-eslint/eslint-plugin";
import eslintParserTs from "@typescript-eslint/parser";

export default [
    {
        files: ["**/*.ts"],
        languageOptions: {
            parser: eslintParserTs,
            parserOptions: {
                project: "./tsconfig.json",
                sourceType: "module",
            },
        },
        plugins: {
            "@typescript-eslint": eslintPluginTs,
            prettier: eslintPluginPrettier,
        },
        rules: {
            ...eslintPluginTs.configs.recommended.rules,
            ...eslintPluginTs.configs["recommended-type-checked"].rules,
            "prettier/prettier": "error",
            "@typescript-eslint/explicit-module-boundary-types": "off",
            "@typescript-eslint/no-floating-promises": "error",
            "@typescript-eslint/no-misused-promises": "error",
            "@typescript-eslint/no-unused-vars": "error",

            "@typescript-eslint/no-magic-numbers": [
                "warn",
                {
                    ignore: [
                        -1,
                        0,
                        1,
                        2,
                        3,
                        4,
                        5,
                        6,
                        7,
                        8,
                        9,
                        10, // Basic numbers
                        15,
                        20,
                        24,
                        30,
                        50,
                        60, // Time intervals
                        100,
                        200,
                        500,
                        1000, // Scale factors
                        3600,
                        5000,
                        10000,
                        30000,
                        60000,
                        86400, // Time constants (ms, seconds)
                        0.1,
                        0.01,
                        0.001,
                        0.0001, // Decimal precision
                        0.5,
                        0.7,
                        0.75,
                        0.8,
                        0.9,
                        0.95, // Common thresholds
                        95,
                        99, // Percentiles
                        300,
                        400,
                        600,
                        900,
                        1200,
                        1500,
                        1800, // Common intervals (5min, 10min, etc in seconds)
                        45000,
                        90000,
                        120000,
                        180000,
                        300000,
                        600000,
                        3600000,
                        8640000, // Common intervals in milliseconds
                        1024, // Common Memory size
                    ], // Common time/math/trading constants
                    ignoreArrayIndexes: true,
                    ignoreDefaultValues: true,
                    ignoreClassFieldInitialValues: true,
                    ignoreNumericLiteralTypes: true,
                    ignoreEnums: true,
                    ignoreReadonlyClassProperties: true,
                    enforceConst: true,
                    detectObjects: false, // Don't flag object property values
                },
            ], // CLAUDE.md compliance
            "@typescript-eslint/prefer-readonly": "off", // Immutability
            "@typescript-eslint/prefer-readonly-parameter-types": "off",
            "@typescript-eslint/no-floating-promises": "error", // Critical for async
            "@typescript-eslint/no-misused-promises": "error",
            "no-eval": "error", // Security
            "no-implied-eval": "error",
            "prefer-const": "error", // Immutability preference
            "no-var": "error", // Modern JS
        },
    },
    {
        files: ["backend/test/**/*.ts", "**/*.test.ts"],
        rules: {
            "@typescript-eslint/no-magic-numbers": "off", // Allow magic numbers in tests
        },
    },
    {
        ignores: ["dist", "node_modules", "public", "scripts"],
    },
];
