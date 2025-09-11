//! # OrderBook Bindings - Node.js FFI for orderbook-core
//!
//! This crate provides Neon bindings to expose the orderbook-core
//! library functionality to Node.js applications.

use neon::prelude::*;
use orderbook_core::{OrderBook, DepthUpdate, PassiveLevel, BandSum, DepthMetrics, OrderBookHealth};
use std::sync::Mutex;
use std::collections::HashMap;
use lazy_static::lazy_static;

// Thread-safe storage for order books
lazy_static! {
    static ref ORDER_BOOK_REGISTRY: Mutex<HashMap<String, OrderBook>> = Mutex::new(HashMap::new());
}

/// Create a new order book instance
fn create_order_book(mut cx: FunctionContext) -> JsResult<JsString> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);
    let price_precision = cx.argument::<JsNumber>(1)?.value(&mut cx) as u32;
    let tick_size = cx.argument::<JsNumber>(2)?.value(&mut cx);

    let mut registry = ORDER_BOOK_REGISTRY.lock().unwrap();
    let order_book = OrderBook::new(price_precision, tick_size);
    registry.insert(id.clone(), order_book);

    Ok(cx.string(&id))
}

/// Update order book depth
fn update_depth(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);
    let updates_json = cx.argument::<JsString>(1)?.value(&mut cx);

    let updates: DepthUpdate = serde_json::from_str(&updates_json)
        .or_else(|e| cx.throw_error(&format!("Invalid JSON: {}", e)))?;

    let mut registry = ORDER_BOOK_REGISTRY.lock().unwrap();
    if let Some(order_book) = registry.get_mut(&id) {
        order_book.update_depth(updates)
            .or_else(|e| cx.throw_error(&e))?;
    } else {
        return cx.throw_error("Order book not found");
    }

    Ok(cx.undefined())
}

/// Get price level
fn get_level(mut cx: FunctionContext) -> JsResult<JsValue> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);
    let price = cx.argument::<JsNumber>(1)?.value(&mut cx);

    let registry = ORDER_BOOK_REGISTRY.lock().unwrap();
    if let Some(order_book) = registry.get(&id) {
        if let Some(level) = order_book.get_level(price) {
            let js_object = JsObject::new(&mut cx);

            // Values are already f64
            let price_val = cx.number(level.price);
            let bid_val = cx.number(level.bid);
            let ask_val = cx.number(level.ask);
            let timestamp_val = cx.string(&level.timestamp.to_rfc3339());

            js_object.set(&mut cx, "price", price_val)?;
            js_object.set(&mut cx, "bid", bid_val)?;
            js_object.set(&mut cx, "ask", ask_val)?;
            js_object.set(&mut cx, "timestamp", timestamp_val)?;

            Ok(js_object.upcast())
        } else {
            Ok(cx.null().upcast())
        }
    } else {
        cx.throw_error("Order book not found")
    }
}

/// Get best bid
fn get_best_bid(mut cx: FunctionContext) -> JsResult<JsNumber> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);

    let registry = ORDER_BOOK_REGISTRY.lock().unwrap();
    if let Some(order_book) = registry.get(&id) {
        Ok(cx.number(order_book.get_best_bid()))
    } else {
        cx.throw_error("Order book not found")
    }
}

/// Get best ask
fn get_best_ask(mut cx: FunctionContext) -> JsResult<JsNumber> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);

    let registry = ORDER_BOOK_REGISTRY.lock().unwrap();
    if let Some(order_book) = registry.get(&id) {
        Ok(cx.number(order_book.get_best_ask()))
    } else {
        cx.throw_error("Order book not found")
    }
}

/// Get spread
fn get_spread(mut cx: FunctionContext) -> JsResult<JsNumber> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);

    let registry = ORDER_BOOK_REGISTRY.lock().unwrap();
    if let Some(order_book) = registry.get(&id) {
        Ok(cx.number(order_book.get_spread()))
    } else {
        cx.throw_error("Order book not found")
    }
}

/// Get mid price
fn get_mid_price(mut cx: FunctionContext) -> JsResult<JsNumber> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);

    let registry = ORDER_BOOK_REGISTRY.lock().unwrap();
    if let Some(order_book) = registry.get(&id) {
        Ok(cx.number(order_book.get_mid_price()))
    } else {
        cx.throw_error("Order book not found")
    }
}

/// Sum band
fn sum_band(mut cx: FunctionContext) -> JsResult<JsValue> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);
    let center = cx.argument::<JsNumber>(1)?.value(&mut cx);
    let band_ticks = cx.argument::<JsNumber>(2)?.value(&mut cx) as u32;
    let tick_size = cx.argument::<JsNumber>(3)?.value(&mut cx);

    let registry = ORDER_BOOK_REGISTRY.lock().unwrap();
    if let Some(order_book) = registry.get(&id) {
        let result = order_book.sum_band(center, band_ticks, tick_size);

        let js_object = JsObject::new(&mut cx);
        let bid_val = cx.number(result.bid);
        let ask_val = cx.number(result.ask);
        let levels_val = cx.number(result.levels as f64);

        js_object.set(&mut cx, "bid", bid_val)?;
        js_object.set(&mut cx, "ask", ask_val)?;
        js_object.set(&mut cx, "levels", levels_val)?;

        Ok(js_object.upcast())
    } else {
        cx.throw_error("Order book not found")
    }
}

/// Get depth metrics
fn get_depth_metrics(mut cx: FunctionContext) -> JsResult<JsValue> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);

    let registry = ORDER_BOOK_REGISTRY.lock().unwrap();
    if let Some(order_book) = registry.get(&id) {
        let metrics = order_book.get_depth_metrics();

        let js_object = JsObject::new(&mut cx);
        let total_levels_val = cx.number(metrics.total_levels as f64);
        let bid_levels_val = cx.number(metrics.bid_levels as f64);
        let ask_levels_val = cx.number(metrics.ask_levels as f64);

        js_object.set(&mut cx, "totalLevels", total_levels_val)?;
        js_object.set(&mut cx, "bidLevels", bid_levels_val)?;
        js_object.set(&mut cx, "askLevels", ask_levels_val)?;
        let total_bid_volume_val = cx.number(metrics.total_bid_volume);
        let total_ask_volume_val = cx.number(metrics.total_ask_volume);
        let imbalance_val = cx.number(metrics.imbalance);

        js_object.set(&mut cx, "totalBidVolume", total_bid_volume_val)?;
        js_object.set(&mut cx, "totalAskVolume", total_ask_volume_val)?;
        js_object.set(&mut cx, "imbalance", imbalance_val)?;

        Ok(js_object.upcast())
    } else {
        cx.throw_error("Order book not found")
    }
}

/// Clear order book
fn clear_order_book(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);

    let mut registry = ORDER_BOOK_REGISTRY.lock().unwrap();
    if let Some(order_book) = registry.get_mut(&id) {
        order_book.clear();
        Ok(cx.undefined())
    } else {
        cx.throw_error("Order book not found")
    }
}

/// Get order book size
fn get_size(mut cx: FunctionContext) -> JsResult<JsNumber> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);

    let registry = ORDER_BOOK_REGISTRY.lock().unwrap();
    if let Some(order_book) = registry.get(&id) {
        Ok(cx.number(order_book.size() as f64))
    } else {
        cx.throw_error("Order book not found")
    }
}

/// Get health status
fn get_health(mut cx: FunctionContext) -> JsResult<JsValue> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);

    let registry = ORDER_BOOK_REGISTRY.lock().unwrap();
    if let Some(order_book) = registry.get(&id) {
        let health = order_book.get_health();

        let js_object = JsObject::new(&mut cx);
        let status_val = cx.string(&health.status);
        let initialized_val = cx.boolean(health.initialized);
        let last_update_ms_val = cx.number(health.last_update_ms as f64);
        let circuit_breaker_open_val = cx.boolean(health.circuit_breaker_open);
        let error_rate_val = cx.number(health.error_rate as f64);
        let book_size_val = cx.number(health.book_size as f64);
        let spread_val = cx.number(health.spread);
        let mid_price_val = cx.number(health.mid_price);

        js_object.set(&mut cx, "status", status_val)?;
        js_object.set(&mut cx, "initialized", initialized_val)?;
        js_object.set(&mut cx, "lastUpdateMs", last_update_ms_val)?;
        js_object.set(&mut cx, "circuitBreakerOpen", circuit_breaker_open_val)?;
        js_object.set(&mut cx, "errorRate", error_rate_val)?;
        js_object.set(&mut cx, "bookSize", book_size_val)?;
        js_object.set(&mut cx, "spread", spread_val)?;
        js_object.set(&mut cx, "midPrice", mid_price_val)?;

        // Add details object
        let details = JsObject::new(&mut cx);
        let bid_levels_val = cx.number(health.details.bid_levels as f64);
        let ask_levels_val = cx.number(health.details.ask_levels as f64);
        let total_bid_volume_val = cx.number(health.details.total_bid_volume);
        let total_ask_volume_val = cx.number(health.details.total_ask_volume);
        let stale_levels_val = cx.number(health.details.stale_levels as f64);
        let memory_usage_mb_val = cx.number(health.details.memory_usage_mb);

        details.set(&mut cx, "bidLevels", bid_levels_val)?;
        details.set(&mut cx, "askLevels", ask_levels_val)?;
        details.set(&mut cx, "totalBidVolume", total_bid_volume_val)?;
        details.set(&mut cx, "totalAskVolume", total_ask_volume_val)?;
        details.set(&mut cx, "staleLevels", stale_levels_val)?;
        details.set(&mut cx, "memoryUsageMB", memory_usage_mb_val)?;

        js_object.set(&mut cx, "details", details)?;

        Ok(js_object.upcast())
    } else {
        cx.throw_error("Order book not found")
    }
}

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("createOrderBook", create_order_book)?;
    cx.export_function("updateDepth", update_depth)?;
    cx.export_function("getLevel", get_level)?;
    cx.export_function("getBestBid", get_best_bid)?;
    cx.export_function("getBestAsk", get_best_ask)?;
    cx.export_function("getSpread", get_spread)?;
    cx.export_function("getMidPrice", get_mid_price)?;
    cx.export_function("sumBand", sum_band)?;
    cx.export_function("getDepthMetrics", get_depth_metrics)?;
    cx.export_function("getHealth", get_health)?;
    cx.export_function("clear", clear_order_book)?;
    cx.export_function("size", get_size)?;
    Ok(())
}