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

            // 🚫 INSTITUTIONAL-GRADE TYPE SAFETY RULES (ZERO TOLERANCE)
            "@typescript-eslint/consistent-type-assertions": [
                "error",
                {
                    assertionStyle: "never", // 🚫 BAN ALL TYPE ASSERTIONS ("as")
                },
            ],
            "@typescript-eslint/no-explicit-any": "error", // 🚫 Ban "any" type
            "@typescript-eslint/no-unsafe-assignment": "error", // 🚫 Ban unsafe assignments
            "@typescript-eslint/no-unsafe-call": "error", // 🚫 Ban unsafe function calls
            "@typescript-eslint/no-unsafe-member-access": "error", // 🚫 Ban unsafe property access
            "@typescript-eslint/no-unsafe-return": "error", // 🚫 Ban unsafe returns
            "@typescript-eslint/no-unsafe-argument": "error", // 🚫 Ban unsafe arguments
            "@typescript-eslint/strict-boolean-expressions": "error", // 🚫 Force strict boolean checks
            "@typescript-eslint/prefer-nullish-coalescing": "error", // ✅ Force ?? instead of ||
            "@typescript-eslint/prefer-optional-chain": "error", // ✅ Force ?. syntax
            "@typescript-eslint/no-non-null-assertion": "error", // 🚫 Ban ! assertions
        },
    },
    {
        ignores: ["dist", "node_modules", "public", "scripts"],
    },
];
