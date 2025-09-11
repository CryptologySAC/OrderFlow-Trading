// Rust-powered OrderBook implementation with BTreeMap for O(log n) performance
// Drop-in replacement for RedBlackTreeOrderBook with significant performance improvements

import { SpotWebsocketStreams } from "@binance/spot";
import type { IMetricsCollector } from "../infrastructure/metricsCollectorInterface.js";
import type { PassiveLevel, OrderBookHealth } from "../types/marketEvents.js";
import type { ILogger } from "../infrastructure/loggerInterface.js";
import type { ThreadManager } from "../multithreading/threadManager.js";
import type {
    IOrderBookState,
    OrderBookStateOptions,
} from "./orderBookState.js";

// Import the consolidated Rust BTreeMap native addon
// TODO: Fix orderbook build and re-enable
// import addon from "../../rust/orderbook/native";
const addon = null; // Temporary placeholder

type SnapShot = Map<number, PassiveLevel>;
