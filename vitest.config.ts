// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node", // "jsdom" for browser tests if needed
        globals: true, // describe/it/expect as globals
        setupFiles: [
            // Uncomment if you want global setup (e.g., EventEmitter tweaks)
            // "./test/vitest.setup.ts"
        ],
        coverage: {
            reporter: ["text", "html"],
            reportsDirectory: "./coverage",
            include: ["src"],
        },
    },
});
