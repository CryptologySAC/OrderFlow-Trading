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
        },
    },
    {
        ignores: ["dist", "node_modules", "public", "scripts"],
    },
];
