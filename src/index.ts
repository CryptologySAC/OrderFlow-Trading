// src/index.ts

import {
    OrderFlowDashboard,
    createDependencies,
} from "./orderFlowDashBoard.js";
import { ThreadManager } from "./multithreading/threadManager.js";

/**
 * Main entry point for the Order Flow Trading application
 */
export async function main(): Promise<void> {
    try {
        const threadManager = new ThreadManager();
        threadManager.startBinance();

        // Create dependencies
        const dependencies = createDependencies(threadManager);

        // Create dashboard
        const dashboard = await OrderFlowDashboard.create(dependencies);

        // Start the application
        await dashboard.startDashboard();

        console.log(
            "Order Flow Trading system (Multithreaded) started successfully"
        );

        const shutdown = (): void => {
            void threadManager.shutdown();
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
    } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        console.error("Failed to start Order Flow Trading system:", err);
        process.exit(1);
    }
}

// Start the application
//void main();
