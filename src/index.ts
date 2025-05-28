// src/index.ts

import {
    OrderFlowDashboard,
    createDependencies,
} from "./orderFlowDashboard.js";

/**
 * Main entry point for the Order Flow Trading application
 */
export async function main(): Promise<void> {
    try {
        // Create dependencies
        const dependencies = createDependencies();

        // Create dashboard
        const dashboard = new OrderFlowDashboard(dependencies);

        // Start the application
        await dashboard.startDashboard();

        console.log("Order Flow Trading system started successfully");
    } catch (error) {
        console.error("Failed to start Order Flow Trading system:", error);
        process.exit(1);
    }
}

// Start the application
//void main();
