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
        // BinanceWorker will be started by dashboard in parallel with backlog fill

        // Create dependencies
        const dependencies = createDependencies(threadManager);

        // Create dashboard
        const dashboard = await OrderFlowDashboard.create(dependencies);

        // Start the application
        await dashboard.startDashboard();

        console.log(
            "Order Flow Trading system (Multithreaded) started successfully"
        );

        const shutdown = async (): Promise<void> => {
            console.log(
                "Received shutdown signal, shutting down gracefully..."
            );
            try {
                await threadManager.shutdown();
                console.log("Shutdown completed successfully");
                process.exit(0);
            } catch (error) {
                console.error("Error during shutdown:", error);
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
        console.error("Failed to start Order Flow Trading system:", err);
        process.exit(1);
    }
}

// Start the application
//void main();
