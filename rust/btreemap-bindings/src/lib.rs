//! # BTreeMap Bindings - Node.js FFI for btreemap-core
//!
//! This crate provides Neon bindings to expose the btreemap-core
//! library functionality to Node.js applications.

use neon::prelude::*;
use btreemap_core::{OrderBookBTreeMap, PassiveLevel, RBNode};
use std::sync::Mutex;
use lazy_static::lazy_static;

// Global registry for OrderBookBTreeMap instances
lazy_static! {
    static ref TREE_REGISTRY: Mutex<std::collections::HashMap<String, OrderBookBTreeMap>> = Mutex::new(std::collections::HashMap::new());
}

// FFI Functions for Node.js integration

fn create_tree(mut cx: FunctionContext) -> JsResult<JsString> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);
    let mut registry = TREE_REGISTRY.lock().unwrap();
    let tree = OrderBookBTreeMap::new();
    registry.insert(id.clone(), tree);
    Ok(cx.string(&id))
}

fn insert(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);
    let price = cx.argument::<JsNumber>(1)?.value(&mut cx);
    let level_json = cx.argument::<JsString>(2)?.value(&mut cx);

    // Parse the JSON - values are already f64 as expected
    let level: PassiveLevel = serde_json::from_str(&level_json)
        .or_else(|e| cx.throw_error(&format!("Invalid level JSON: {}", e)))?;

    let mut registry = TREE_REGISTRY.lock().unwrap();
    if let Some(tree) = registry.get_mut(&id) {
        tree.insert(price, level);
        Ok(cx.undefined())
    } else {
        cx.throw_error("Tree not found")
    }
}

fn set(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);
    let price = cx.argument::<JsNumber>(1)?.value(&mut cx);
    let side = cx.argument::<JsString>(2)?.value(&mut cx);
    let quantity = cx.argument::<JsNumber>(3)?.value(&mut cx);

    let mut registry = TREE_REGISTRY.lock().unwrap();
    if let Some(tree) = registry.get_mut(&id) {
        tree.set(price, &side, quantity);
        Ok(cx.undefined())
    } else {
        cx.throw_error("Tree not found")
    }
}

fn delete(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);
    let price = cx.argument::<JsNumber>(1)?.value(&mut cx);

    let mut registry = TREE_REGISTRY.lock().unwrap();
    if let Some(tree) = registry.get_mut(&id) {
        tree.delete(price);
        Ok(cx.undefined())
    } else {
        cx.throw_error("Tree not found")
    }
}

fn search(mut cx: FunctionContext) -> JsResult<JsValue> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);
    let price = cx.argument::<JsNumber>(1)?.value(&mut cx);

    let registry = TREE_REGISTRY.lock().unwrap();
    if let Some(tree) = registry.get(&id) {
        if let Some(node) = tree.search(price) {
            let js_object = JsObject::new(&mut cx);
            let price_val = cx.number(node.price);
            js_object.set(&mut cx, "price", price_val)?;

            // Create level object - values are already f64
            let level_obj = JsObject::new(&mut cx);
            let level_price = cx.number(node.level.price);
            let level_bid = cx.number(node.level.bid);
            let level_ask = cx.number(node.level.ask);
            let level_timestamp = cx.number(node.level.timestamp);

            level_obj.set(&mut cx, "price", level_price)?;
            level_obj.set(&mut cx, "bid", level_bid)?;
            level_obj.set(&mut cx, "ask", level_ask)?;
            level_obj.set(&mut cx, "timestamp", level_timestamp)?;

            js_object.set(&mut cx, "level", level_obj)?;
            Ok(js_object.upcast())
        } else {
            Ok(cx.null().upcast())
        }
    } else {
        cx.throw_error("Tree not found")
    }
}

fn get(mut cx: FunctionContext) -> JsResult<JsValue> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);
    let price = cx.argument::<JsNumber>(1)?.value(&mut cx);

    let registry = TREE_REGISTRY.lock().unwrap();
    if let Some(tree) = registry.get(&id) {
        if let Some(level) = tree.get(price) {
            let js_object = JsObject::new(&mut cx);
            let price_val = cx.number(level.price);
            let bid_val = cx.number(level.bid);
            let ask_val = cx.number(level.ask);
            let timestamp_val = cx.number(level.timestamp);

            js_object.set(&mut cx, "price", price_val)?;
            js_object.set(&mut cx, "bid", bid_val)?;
            js_object.set(&mut cx, "ask", ask_val)?;
            js_object.set(&mut cx, "timestamp", timestamp_val)?;
            Ok(js_object.upcast())
        } else {
            Ok(cx.null().upcast())
        }
    } else {
        cx.throw_error("Tree not found")
    }
}

fn get_best_bid(mut cx: FunctionContext) -> JsResult<JsNumber> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);

    let registry = TREE_REGISTRY.lock().unwrap();
    if let Some(tree) = registry.get(&id) {
        Ok(cx.number(tree.get_best_bid()))
    } else {
        cx.throw_error("Tree not found")
    }
}

fn get_best_ask(mut cx: FunctionContext) -> JsResult<JsNumber> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);

    let registry = TREE_REGISTRY.lock().unwrap();
    if let Some(tree) = registry.get(&id) {
        Ok(cx.number(tree.get_best_ask()))
    } else {
        cx.throw_error("Tree not found")
    }
}

fn get_all_nodes(mut cx: FunctionContext) -> JsResult<JsValue> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);

    let registry = TREE_REGISTRY.lock().unwrap();
    if let Some(tree) = registry.get(&id) {
        let nodes = tree.get_all_nodes();
        let js_array = JsArray::new(&mut cx, nodes.len());

        for (i, node) in nodes.iter().enumerate() {
            let js_node = JsObject::new(&mut cx);
            let node_price = cx.number(node.price);
            js_node.set(&mut cx, "price", node_price)?;

            let level_obj = JsObject::new(&mut cx);
            let level_price = cx.number(node.level.price);
            let level_bid = cx.number(node.level.bid);
            let level_ask = cx.number(node.level.ask);
            let level_timestamp = cx.number(node.level.timestamp);

            level_obj.set(&mut cx, "price", level_price)?;
            level_obj.set(&mut cx, "bid", level_bid)?;
            level_obj.set(&mut cx, "ask", level_ask)?;
            level_obj.set(&mut cx, "timestamp", level_timestamp)?;

            js_node.set(&mut cx, "level", level_obj)?;
            js_array.set(&mut cx, i as u32, js_node)?;
        }

        Ok(js_array.upcast())
    } else {
        cx.throw_error("Tree not found")
    }
}

fn size(mut cx: FunctionContext) -> JsResult<JsNumber> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);

    let registry = TREE_REGISTRY.lock().unwrap();
    if let Some(tree) = registry.get(&id) {
        Ok(cx.number(tree.size() as f64))
    } else {
        cx.throw_error("Tree not found")
    }
}

fn clear_tree(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let id = cx.argument::<JsString>(0)?.value(&mut cx);

    let mut registry = TREE_REGISTRY.lock().unwrap();
    if let Some(tree) = registry.get_mut(&id) {
        tree.clear();
        Ok(cx.undefined())
    } else {
        cx.throw_error("Tree not found")
    }
}

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("createTree", create_tree)?;
    cx.export_function("insert", insert)?;
    cx.export_function("set", set)?;
    cx.export_function("delete", delete)?;
    cx.export_function("search", search)?;
    cx.export_function("get", get)?;
    cx.export_function("getBestBid", get_best_bid)?;
    cx.export_function("getBestAsk", get_best_ask)?;
    cx.export_function("getAllNodes", get_all_nodes)?;
    cx.export_function("size", size)?;
    cx.export_function("clear", clear_tree)?;
    Ok(())
}