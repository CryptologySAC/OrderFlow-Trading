// src/index.ts
//import { App } from "./app.js";
import { OrderFlowDashboard } from "./orderFlowDashBoard.js";
import { createDependencies } from "./core/dependencies.js";
import { ThreadManager } from "./multithreading/threadManager.js";

/**
 * Main entry point for the Order Flow Trading application
 */
export async function main(): Promise<void> {
    try {
        const threadManager = new ThreadManager();
        const dependencies = createDependencies(threadManager);
        const dashboard = await OrderFlowDashboard.create(dependencies);
        await dashboard.startDashboard();

        const shutdown = async (): Promise<void> => {
            try {
                await threadManager.shutdown();
                process.exit(0);
            } catch (error) {
                // POLICY OVERRIDE: Using console.error for system panic during shutdown
                // REASON: Logging infrastructure may be unavailable during shutdown, critical failure requires immediate visibility
                console.error("❌ Error during shutdown:", error);
                process.exit(1);
            }
        };

        process.on("SIGINT", () => {
            void shutdown();
        });
        process.on("SIGTERM", () => {
            void shutdown();
        });
    } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        // POLICY OVERRIDE: Using console.error for system panic during main startup
        // REASON: Logger infrastructure not available during startup failure, critical failure requires immediate visibility
        console.error("❌ CRITICAL STARTUP FAILURE:");
        console.error(
            "❌ Failed to start Order Flow Trading system:",
            err.message
        );
        console.error("❌ Stack trace:", err.stack);
        console.error("❌ Application cannot continue - exiting immediately");
        process.exit(1);
    }
}
