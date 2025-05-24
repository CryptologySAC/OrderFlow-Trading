import type { Config } from "jest";

const config: Config = {
    testEnvironment: "node",
    roots: ["<rootDir>/test"],
    testMatch: ["**/*.test.ts"],
    moduleFileExtensions: ["ts", "js", "json", "node"],
    transform: {
        "^.+\\.tsx?$": ["ts-jest", { useESM: false }],
    },
};

export default config;
