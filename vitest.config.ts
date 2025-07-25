// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node", // "jsdom" for browser tests if needed
        globals: true, // describe/it/expect as globals
        setupFiles: ["./test/vitest.setup.ts"],
        coverage: {
            reporter: ["text", "html"],
            reportsDirectory: "./coverage",
            include: ["src"],
        },
        pool: 'threads', // or 'forks' for separate processes
        poolOptions: {
            threads: {
                maxThreads: 2, // Limit to 2 threads
                minThreads: 1
            },
            forks: {
                maxForks: 2, // Limit to 2 processes if using forks                    
                minForks: 1
            }
        },
        isolate: true,
        clearMocks: true,
        restoreMocks: true,
        fileParallelism: false
    },
});
