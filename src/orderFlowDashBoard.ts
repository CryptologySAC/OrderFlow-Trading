import express from "express";
import path from "path";
import { BinanceStream } from "./app";

export class OrderFlowDashboard {
    private readonly httpServer: express.Application = express();
    private readonly httpPort: number = (process.env.PORT ?? 3000) as number;
    private readonly binanceStream: BinanceStream = new BinanceStream();

    private async startWebServer() {
        this.httpServer.use(express.static(path.join(__dirname, "../public")));
        this.httpServer.listen(this.httpPort, () => {
            console.log(`Server running at http://localhost:${this.httpPort}`);
        });
    }

    private async preloadTrades() {
        try {
            await this.binanceStream.main();
        } catch (error) {
            console.error("Error preloading trades:", error);
        }
    }

    public async startDashboard() {
        try {
            await this.startWebServer();
            await this.preloadTrades();
            console.log("Order Flow Dashboard started successfully.");
        } catch (error) {
            console.error("Error starting Order Flow Dashboard:", error);
        }
    }
}

const processor = new OrderFlowDashboard();
processor
    .startDashboard()
    .catch((err) => console.error("Failed to start processor:", err));
