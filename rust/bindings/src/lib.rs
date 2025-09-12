//! Node.js bindings for financial-math library using Neon
//!
//! This module provides Neon bindings to make the Rust financial math
//! library available to Node.js applications with zero-overhead performance.

use neon::prelude::*;
use financial_math::{PRICE_SCALE, QUANTITY_SCALE};
use btreemap::{OrderBookBTreeMap, PassiveLevel};

// ===== CONVERSIONS =====

fn price_to_int(mut cx: FunctionContext) -> JsResult<JsString> {
    let price = match cx.argument::<JsNumber>(0) {
        Ok(arg) => arg.value(&mut cx),
        Err(_) => return cx.throw_error("Expected number argument"),
    };

    let result = match financial_math::conversions::price_to_int(price) {
        Ok(value) => value,
        Err(e) => return cx.throw_error(&format!("Conversion error: {:?}", e)),
    };

    Ok(cx.string(result.to_string()))
}

fn int_to_price(mut cx: FunctionContext) -> JsResult<JsNumber> {
    let value_str = match cx.argument::<JsString>(0) {
        Ok(arg) => arg.value(&mut cx),
        Err(_) => return cx.throw_error("Expected string argument"),
    };

    let value_u128: u128 = match value_str.parse() {
        Ok(value) => value,
        Err(_) => return cx.throw_error("Invalid u128 value"),
    };

    let result = financial_math::conversions::int_to_price(value_u128);
    Ok(cx.number(result))
}

fn quantity_to_int(mut cx: FunctionContext) -> JsResult<JsString> {
    let quantity = match cx.argument::<JsNumber>(0) {
        Ok(arg) => arg.value(&mut cx),
        Err(_) => return cx.throw_error("Expected number argument"),
    };

    let result = match financial_math::conversions::quantity_to_int(quantity) {
        Ok(value) => value,
        Err(e) => return cx.throw_error(&format!("Conversion error: {:?}", e)),
    };

    Ok(cx.string(result.to_string()))
}

fn int_to_quantity(mut cx: FunctionContext) -> JsResult<JsNumber> {
    let value_str = match cx.argument::<JsString>(0) {
        Ok(arg) => arg.value(&mut cx),
        Err(_) => return cx.throw_error("Expected string argument"),
    };

    let value_u128: u128 = match value_str.parse() {
        Ok(value) => value,
        Err(_) => return cx.throw_error("Invalid u128 value"),
    };

    let result = financial_math::conversions::int_to_quantity(value_u128);
    Ok(cx.number(result))
}

// ===== ARITHMETIC =====

fn safe_add(mut cx: FunctionContext) -> JsResult<JsString> {
    let a_str = match cx.argument::<JsString>(0) {
        Ok(arg) => arg.value(&mut cx),
        Err(_) => return cx.throw_error("Expected string argument for a"),
    };

    let b_str = match cx.argument::<JsString>(1) {
        Ok(arg) => arg.value(&mut cx),
        Err(_) => return cx.throw_error("Expected string argument for b"),
    };

    let a_u128: u128 = match a_str.parse() {
        Ok(value) => value,
        Err(_) => return cx.throw_error("Invalid u128 value for a"),
    };

    let b_u128: u128 = match b_str.parse() {
        Ok(value) => value,
        Err(_) => return cx.throw_error("Invalid u128 value for b"),
    };

    let result = match financial_math::arithmetic::safe_add(a_u128, b_u128) {
        Ok(value) => value,
        Err(e) => return cx.throw_error(&format!("Arithmetic error: {:?}", e)),
    };

    Ok(cx.string(result.to_string()))
}

fn safe_subtract(mut cx: FunctionContext) -> JsResult<JsString> {
    let a_str = match cx.argument::<JsString>(0) {
        Ok(arg) => arg.value(&mut cx),
        Err(_) => return cx.throw_error("Expected string argument for a"),
    };

    let b_str = match cx.argument::<JsString>(1) {
        Ok(arg) => arg.value(&mut cx),
        Err(_) => return cx.throw_error("Expected string argument for b"),
    };

    let a_u128: u128 = match a_str.parse() {
        Ok(value) => value,
        Err(_) => return cx.throw_error("Invalid u128 value for a"),
    };

    let b_u128: u128 = match b_str.parse() {
        Ok(value) => value,
        Err(_) => return cx.throw_error("Invalid u128 value for b"),
    };

    let result = match financial_math::arithmetic::safe_subtract(a_u128, b_u128) {
        Ok(value) => value,
        Err(e) => return cx.throw_error(&format!("Arithmetic error: {:?}", e)),
    };

    Ok(cx.string(result.to_string()))
}

fn safe_multiply(mut cx: FunctionContext) -> JsResult<JsString> {
    let a_str = match cx.argument::<JsString>(0) {
        Ok(arg) => arg.value(&mut cx),
        Err(_) => return cx.throw_error("Expected string argument for a"),
    };

    let b_str = match cx.argument::<JsString>(1) {
        Ok(arg) => arg.value(&mut cx),
        Err(_) => return cx.throw_error("Expected string argument for b"),
    };

    let a_u128: u128 = match a_str.parse() {
        Ok(value) => value,
        Err(_) => return cx.throw_error("Invalid u128 value for a"),
    };

    let b_u128: u128 = match b_str.parse() {
        Ok(value) => value,
        Err(_) => return cx.throw_error("Invalid u128 value for b"),
    };

    let result = match financial_math::arithmetic::safe_multiply(a_u128, b_u128) {
        Ok(value) => value,
        Err(e) => return cx.throw_error(&format!("Arithmetic error: {:?}", e)),
    };

    Ok(cx.string(result.to_string()))
}

fn safe_divide(mut cx: FunctionContext) -> JsResult<JsString> {
    let a_str = match cx.argument::<JsString>(0) {
        Ok(arg) => arg.value(&mut cx),
        Err(_) => return cx.throw_error("Expected string argument for a"),
    };

    let b_str = match cx.argument::<JsString>(1) {
        Ok(arg) => arg.value(&mut cx),
        Err(_) => return cx.throw_error("Expected string argument for b"),
    };

    let a_u128: u128 = match a_str.parse() {
        Ok(value) => value,
        Err(_) => return cx.throw_error("Invalid u128 value for a"),
    };

    let b_u128: u128 = match b_str.parse() {
        Ok(value) => value,
        Err(_) => return cx.throw_error("Invalid u128 value for b"),
    };

    let result = match financial_math::arithmetic::safe_divide(a_u128, b_u128) {
        Ok(value) => value,
        Err(e) => return cx.throw_error(&format!("Arithmetic error: {:?}", e)),
    };

    Ok(cx.string(result.to_string()))
}

fn calculate_mid_price(mut cx: FunctionContext) -> JsResult<JsString> {
    let bid_str = match cx.argument::<JsString>(0) {
        Ok(arg) => arg.value(&mut cx),
        Err(_) => return cx.throw_error("Expected string argument for bid"),
    };

    let ask_str = match cx.argument::<JsString>(1) {
        Ok(arg) => arg.value(&mut cx),
        Err(_) => return cx.throw_error("Expected string argument for ask"),
    };

    let bid_u128: u128 = match bid_str.parse() {
        Ok(value) => value,
        Err(_) => return cx.throw_error("Invalid u128 value for bid"),
    };

    let ask_u128: u128 = match ask_str.parse() {
        Ok(value) => value,
        Err(_) => return cx.throw_error("Invalid u128 value for ask"),
    };

    let result = financial_math::arithmetic::calculate_mid_price(bid_u128, ask_u128);
    Ok(cx.string(result.to_string()))
}

fn calculate_spread(mut cx: FunctionContext) -> JsResult<JsString> {
    let bid_str = match cx.argument::<JsString>(0) {
        Ok(arg) => arg.value(&mut cx),
        Err(_) => return cx.throw_error("Expected string argument for bid"),
    };

    let ask_str = match cx.argument::<JsString>(1) {
        Ok(arg) => arg.value(&mut cx),
        Err(_) => return cx.throw_error("Expected string argument for ask"),
    };

    let bid_u128: u128 = match bid_str.parse() {
        Ok(value) => value,
        Err(_) => return cx.throw_error("Invalid u128 value for bid"),
    };

    let ask_u128: u128 = match ask_str.parse() {
        Ok(value) => value,
        Err(_) => return cx.throw_error("Invalid u128 value for ask"),
    };

    let result = financial_math::arithmetic::calculate_spread(bid_u128, ask_u128);
    Ok(cx.string(result.to_string()))
}

// ===== STATISTICS =====

fn calculate_mean(mut cx: FunctionContext) -> JsResult<JsString> {
    let values_array = match cx.argument::<JsArray>(0) {
        Ok(arg) => arg,
        Err(_) => return cx.throw_error("Expected array argument"),
    };

    let values_vec: Vec<Handle<JsValue>> = match values_array.to_vec(&mut cx) {
        Ok(vec) => vec,
        Err(_) => return cx.throw_error("Failed to convert array to vector"),
    };
    let mut values_u128 = Vec::new();

    for value in values_vec {
        let value_str = match value.downcast::<JsString, _>(&mut cx) {
            Ok(str_handle) => str_handle,
            Err(_) => return cx.throw_error("Expected string in array"),
        };

        let value_u128: u128 = match value_str.value(&mut cx).parse() {
            Ok(parsed) => parsed,
            Err(_) => return cx.throw_error("Invalid u128 value in array"),
        };

        values_u128.push(value_u128);
    }

    let result = match financial_math::statistics::calculate_mean(&values_u128) {
        Ok(value) => value,
        Err(e) => return cx.throw_error(&format!("Statistics error: {:?}", e)),
    };

    Ok(cx.string(result.to_string()))
}

fn calculate_median(mut cx: FunctionContext) -> JsResult<JsString> {
    let values_array = match cx.argument::<JsArray>(0) {
        Ok(arg) => arg,
        Err(_) => return cx.throw_error("Expected array argument"),
    };

    let values_vec: Vec<Handle<JsValue>> = match values_array.to_vec(&mut cx) {
        Ok(vec) => vec,
        Err(_) => return cx.throw_error("Failed to convert array to vector"),
    };
    let mut values_u128 = Vec::new();

    for value in values_vec {
        let value_str = match value.downcast::<JsString, _>(&mut cx) {
            Ok(str_handle) => str_handle,
            Err(_) => return cx.throw_error("Expected string in array"),
        };

        let value_u128: u128 = match value_str.value(&mut cx).parse() {
            Ok(parsed) => parsed,
            Err(_) => return cx.throw_error("Invalid u128 value in array"),
        };

        values_u128.push(value_u128);
    }

    let result = match financial_math::statistics::calculate_median(&values_u128) {
        Ok(value) => value,
        Err(e) => return cx.throw_error(&format!("Statistics error: {:?}", e)),
    };

    Ok(cx.string(result.to_string()))
}

fn calculate_min(mut cx: FunctionContext) -> JsResult<JsString> {
    let values_array = match cx.argument::<JsArray>(0) {
        Ok(arg) => arg,
        Err(_) => return cx.throw_error("Expected array argument"),
    };

    let values_vec: Vec<Handle<JsValue>> = match values_array.to_vec(&mut cx) {
        Ok(vec) => vec,
        Err(_) => return cx.throw_error("Failed to convert array to vector"),
    };
    let mut values_u128 = Vec::new();

    for value in values_vec {
        let value_str = match value.downcast::<JsString, _>(&mut cx) {
            Ok(str_handle) => str_handle,
            Err(_) => return cx.throw_error("Expected string in array"),
        };

        let value_u128: u128 = match value_str.value(&mut cx).parse() {
            Ok(parsed) => parsed,
            Err(_) => return cx.throw_error("Invalid u128 value in array"),
        };

        values_u128.push(value_u128);
    }

    let result = match financial_math::statistics::calculate_min(&values_u128) {
        Ok(value) => value,
        Err(e) => return cx.throw_error(&format!("Statistics error: {:?}", e)),
    };

    Ok(cx.string(result.to_string()))
}

fn calculate_max(mut cx: FunctionContext) -> JsResult<JsString> {
    let values_array = match cx.argument::<JsArray>(0) {
        Ok(arg) => arg,
        Err(_) => return cx.throw_error("Expected array argument"),
    };

    let values_vec: Vec<Handle<JsValue>> = match values_array.to_vec(&mut cx) {
        Ok(vec) => vec,
        Err(_) => return cx.throw_error("Failed to convert array to vector"),
    };
    let mut values_u128 = Vec::new();

    for value in values_vec {
        let value_str = match value.downcast::<JsString, _>(&mut cx) {
            Ok(str_handle) => str_handle,
            Err(_) => return cx.throw_error("Expected string in array"),
        };

        let value_u128: u128 = match value_str.value(&mut cx).parse() {
            Ok(parsed) => parsed,
            Err(_) => return cx.throw_error("Invalid u128 value in array"),
        };

        values_u128.push(value_u128);
    }

    let result = match financial_math::statistics::calculate_max(&values_u128) {
        Ok(value) => value,
        Err(e) => return cx.throw_error(&format!("Statistics error: {:?}", e)),
    };

    Ok(cx.string(result.to_string()))
}

// ===== ZONES =====

fn normalize_price_to_tick(mut cx: FunctionContext) -> JsResult<JsString> {
    let price_str = match cx.argument::<JsString>(0) {
        Ok(arg) => arg.value(&mut cx),
        Err(_) => return cx.throw_error("Expected string argument for price"),
    };

    let tick_size_str = match cx.argument::<JsString>(1) {
        Ok(arg) => arg.value(&mut cx),
        Err(_) => return cx.throw_error("Expected string argument for tick_size"),
    };

    let price_u128: u128 = match price_str.parse() {
        Ok(value) => value,
        Err(_) => return cx.throw_error("Invalid u128 value for price"),
    };

    let tick_size_u128: u128 = match tick_size_str.parse() {
        Ok(value) => value,
        Err(_) => return cx.throw_error("Invalid u128 value for tick_size"),
    };

    let result = match financial_math::zones::normalize_price_to_tick(price_u128, tick_size_u128) {
        Ok(value) => value,
        Err(e) => return cx.throw_error(&format!("Zone error: {:?}", e)),
    };

    Ok(cx.string(result.to_string()))
}

fn is_price_in_zone(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let price_str = match cx.argument::<JsString>(0) {
        Ok(arg) => arg.value(&mut cx),
        Err(_) => return cx.throw_error("Expected string argument for price"),
    };

    let zone_low_str = match cx.argument::<JsString>(1) {
        Ok(arg) => arg.value(&mut cx),
        Err(_) => return cx.throw_error("Expected string argument for zone_low"),
    };

    let zone_high_str = match cx.argument::<JsString>(2) {
        Ok(arg) => arg.value(&mut cx),
        Err(_) => return cx.throw_error("Expected string argument for zone_high"),
    };

    let price_u128: u128 = match price_str.parse() {
        Ok(value) => value,
        Err(_) => return cx.throw_error("Invalid u128 value for price"),
    };

    let zone_low_u128: u128 = match zone_low_str.parse() {
        Ok(value) => value,
        Err(_) => return cx.throw_error("Invalid u128 value for zone_low"),
    };

    let zone_high_u128: u128 = match zone_high_str.parse() {
        Ok(value) => value,
        Err(_) => return cx.throw_error("Invalid u128 value for zone_high"),
    };

    let result = financial_math::zones::is_price_in_zone(price_u128, zone_low_u128, zone_high_u128);
    Ok(cx.boolean(result))
}

// ===== UTILITY FUNCTIONS =====

fn get_price_scale(mut cx: FunctionContext) -> JsResult<JsNumber> {
    Ok(cx.number(PRICE_SCALE.value() as f64))
}

fn get_quantity_scale(mut cx: FunctionContext) -> JsResult<JsNumber> {
    Ok(cx.number(QUANTITY_SCALE.value() as f64))
}

// ===== BTREEMAP ORDER BOOK =====

fn create_order_book_btree(mut cx: FunctionContext) -> JsResult<JsBox<OrderBookBTreeMap>> {
    let tree = OrderBookBTreeMap::new();
    Ok(cx.boxed(tree))
}

fn btree_insert(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let tree = cx.argument::<JsBox<OrderBookBTreeMap>>(0)?;
    let price = cx.argument::<JsNumber>(1)?.value(&mut cx);
    let level_obj = cx.argument::<JsObject>(2)?;

    let bid = level_obj.get::<JsNumber, _, _>(&mut cx, "bid")?.value(&mut cx);
    let ask = level_obj.get::<JsNumber, _, _>(&mut cx, "ask")?.value(&mut cx);
    let timestamp = level_obj.get::<JsNumber, _, _>(&mut cx, "timestamp")?.value(&mut cx);

    let consumed_ask = level_obj.get_opt::<JsNumber, _, _>(&mut cx, "consumedAsk")?
        .map(|v| v.value(&mut cx)).unwrap_or(0.0);
    let consumed_bid = level_obj.get_opt::<JsNumber, _, _>(&mut cx, "consumedBid")?
        .map(|v| v.value(&mut cx)).unwrap_or(0.0);
    let added_ask = level_obj.get_opt::<JsNumber, _, _>(&mut cx, "addedAsk")?
        .map(|v| v.value(&mut cx)).unwrap_or(0.0);
    let added_bid = level_obj.get_opt::<JsNumber, _, _>(&mut cx, "addedBid")?
        .map(|v| v.value(&mut cx)).unwrap_or(0.0);

    let level = PassiveLevel {
        price,
        bid,
        ask,
        timestamp,
        consumed_ask: Some(consumed_ask),
        consumed_bid: Some(consumed_bid),
        added_ask: Some(added_ask),
        added_bid: Some(added_bid),
    };

    tree.insert(price, level);
    Ok(cx.undefined())
}

fn btree_set(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let tree_box = cx.argument::<JsBox<OrderBookBTreeMap>>(0)?;
    let price = cx.argument::<JsNumber>(1)?.value(&mut cx);
    let side = cx.argument::<JsString>(2)?.value(&mut cx);
    let quantity = cx.argument::<JsNumber>(3)?.value(&mut cx);

    let tree: &OrderBookBTreeMap = &*tree_box;
    tree.set(price, side.as_str(), quantity);
    Ok(cx.undefined())
}

fn btree_delete(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let tree_box = cx.argument::<JsBox<OrderBookBTreeMap>>(0)?;
    let price = cx.argument::<JsNumber>(1)?.value(&mut cx);

    let tree: &OrderBookBTreeMap = &*tree_box;
    tree.delete(price);
    Ok(cx.undefined())
}

fn btree_search(mut cx: FunctionContext) -> JsResult<JsValue> {
    let tree_box = cx.argument::<JsBox<OrderBookBTreeMap>>(0)?;
    let price = cx.argument::<JsNumber>(1)?.value(&mut cx);

    let tree: &OrderBookBTreeMap = &*tree_box;
    match tree.search(price) {
        Some(node) => {
            let obj = JsObject::new(&mut cx);
            let price_val = cx.number(node.price);
            obj.set(&mut cx, "price", price_val)?;
            let level_obj = level_to_js_object(&mut cx, &node.level)?;
            obj.set(&mut cx, "level", level_obj)?;
            Ok(obj.as_value(&mut cx))
        }
        None => Ok(cx.undefined().as_value(&mut cx))
    }
}

fn btree_get(mut cx: FunctionContext) -> JsResult<JsValue> {
    let tree_box = cx.argument::<JsBox<OrderBookBTreeMap>>(0)?;
    let price = cx.argument::<JsNumber>(1)?.value(&mut cx);

    let tree: &OrderBookBTreeMap = &*tree_box;
    match tree.get(price) {
        Some(level) => {
            let obj = level_to_js_object(&mut cx, &level)?;
            Ok(obj.as_value(&mut cx))
        }
        None => Ok(cx.undefined().as_value(&mut cx))
    }
}

fn btree_get_best_bid(mut cx: FunctionContext) -> JsResult<JsNumber> {
    let tree_box = cx.argument::<JsBox<OrderBookBTreeMap>>(0)?;
    let tree: &OrderBookBTreeMap = &*tree_box;
    let best_bid = tree.get_best_bid();
    Ok(cx.number(best_bid))
}

fn btree_get_best_ask(mut cx: FunctionContext) -> JsResult<JsNumber> {
    let tree_box = cx.argument::<JsBox<OrderBookBTreeMap>>(0)?;
    let tree: &OrderBookBTreeMap = &*tree_box;
    let best_ask = tree.get_best_ask();
    Ok(cx.number(best_ask))
}

fn btree_get_best_bid_ask(mut cx: FunctionContext) -> JsResult<JsObject> {
    let tree_box = cx.argument::<JsBox<OrderBookBTreeMap>>(0)?;
    let tree: &OrderBookBTreeMap = &*tree_box;
    let (bid, ask) = tree.get_best_bid_ask();

    let obj = JsObject::new(&mut cx);
    let bid_val = cx.number(bid);
    obj.set(&mut cx, "bid", bid_val)?;
    let ask_val = cx.number(ask);
    obj.set(&mut cx, "ask", ask_val)?;
    Ok(obj)
}

fn btree_get_all_nodes(mut cx: FunctionContext) -> JsResult<JsArray> {
    let tree_box = cx.argument::<JsBox<OrderBookBTreeMap>>(0)?;
    let tree: &OrderBookBTreeMap = &*tree_box;
    let nodes = tree.get_all_nodes();

    let arr = JsArray::new(&mut cx, nodes.len());
    for (i, node) in nodes.iter().enumerate() {
        let obj = JsObject::new(&mut cx);
        let price_val = cx.number(node.price);
        obj.set(&mut cx, "price", price_val)?;
        let level_obj = level_to_js_object(&mut cx, &node.level)?;
        obj.set(&mut cx, "level", level_obj)?;
        arr.set(&mut cx, i as u32, obj)?;
    }
    Ok(arr)
}

fn btree_size(mut cx: FunctionContext) -> JsResult<JsNumber> {
    let tree_box = cx.argument::<JsBox<OrderBookBTreeMap>>(0)?;
    let tree: &OrderBookBTreeMap = &*tree_box;
    let size = tree.size();
    Ok(cx.number(size as f64))
}

fn btree_clear(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let tree_box = cx.argument::<JsBox<OrderBookBTreeMap>>(0)?;
    let tree: &OrderBookBTreeMap = &*tree_box;
    tree.clear();
    Ok(cx.undefined())
}

// Helper function to convert PassiveLevel to JavaScript object
fn level_to_js_object<'a>(cx: &mut impl Context<'a>, level: &PassiveLevel) -> JsResult<'a, JsObject> {
    let obj = JsObject::new(cx);

    let price_val = cx.number(level.price);
    obj.set(cx, "price", price_val)?;
    let bid_val = cx.number(level.bid);
    obj.set(cx, "bid", bid_val)?;
    let ask_val = cx.number(level.ask);
    obj.set(cx, "ask", ask_val)?;
    let timestamp_val = cx.number(level.timestamp);
    obj.set(cx, "timestamp", timestamp_val)?;

    if let Some(consumed_ask) = level.consumed_ask {
        let consumed_ask_val = cx.number(consumed_ask);
        obj.set(cx, "consumedAsk", consumed_ask_val)?;
    }
    if let Some(consumed_bid) = level.consumed_bid {
        let consumed_bid_val = cx.number(consumed_bid);
        obj.set(cx, "consumedBid", consumed_bid_val)?;
    }
    if let Some(added_ask) = level.added_ask {
        let added_ask_val = cx.number(added_ask);
        obj.set(cx, "addedAsk", added_ask_val)?;
    }
    if let Some(added_bid) = level.added_bid {
        let added_bid_val = cx.number(added_bid);
        obj.set(cx, "addedBid", added_bid_val)?;
    }

    Ok(obj)
}

// ===== MODULE REGISTRATION =====

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    match cx.export_function("price_to_int", price_to_int) {
        Ok(_) => {},
        Err(e) => return Err(e),
    }
    match cx.export_function("int_to_price", int_to_price) {
        Ok(_) => {},
        Err(e) => return Err(e),
    }
    match cx.export_function("quantity_to_int", quantity_to_int) {
        Ok(_) => {},
        Err(e) => return Err(e),
    }
    match cx.export_function("int_to_quantity", int_to_quantity) {
        Ok(_) => {},
        Err(e) => return Err(e),
    }
    match cx.export_function("safe_add", safe_add) {
        Ok(_) => {},
        Err(e) => return Err(e),
    }
    match cx.export_function("safe_subtract", safe_subtract) {
        Ok(_) => {},
        Err(e) => return Err(e),
    }
    match cx.export_function("safe_multiply", safe_multiply) {
        Ok(_) => {},
        Err(e) => return Err(e),
    }
    match cx.export_function("safe_divide", safe_divide) {
        Ok(_) => {},
        Err(e) => return Err(e),
    }
    match cx.export_function("calculate_mid_price", calculate_mid_price) {
        Ok(_) => {},
        Err(e) => return Err(e),
    }
    match cx.export_function("calculate_spread", calculate_spread) {
        Ok(_) => {},
        Err(e) => return Err(e),
    }
    match cx.export_function("calculate_mean", calculate_mean) {
        Ok(_) => {},
        Err(e) => return Err(e),
    }
    match cx.export_function("calculate_median", calculate_median) {
        Ok(_) => {},
        Err(e) => return Err(e),
    }
    match cx.export_function("calculate_min", calculate_min) {
        Ok(_) => {},
        Err(e) => return Err(e),
    }
    match cx.export_function("calculate_max", calculate_max) {
        Ok(_) => {},
        Err(e) => return Err(e),
    }
    match cx.export_function("normalize_price_to_tick", normalize_price_to_tick) {
        Ok(_) => {},
        Err(e) => return Err(e),
    }
    match cx.export_function("is_price_in_zone", is_price_in_zone) {
        Ok(_) => {},
        Err(e) => return Err(e),
    }
    match cx.export_function("get_price_scale", get_price_scale) {
        Ok(_) => {},
        Err(e) => return Err(e),
    }
    match cx.export_function("get_quantity_scale", get_quantity_scale) {
        Ok(_) => {},
        Err(e) => return Err(e),
    }
    match cx.export_function("create_order_book_btree", create_order_book_btree) {
        Ok(_) => {},
        Err(e) => return Err(e),
    }
    match cx.export_function("btree_insert", btree_insert) {
        Ok(_) => {},
        Err(e) => return Err(e),
    }
    match cx.export_function("btree_set", btree_set) {
        Ok(_) => {},
        Err(e) => return Err(e),
    }
    match cx.export_function("btree_delete", btree_delete) {
        Ok(_) => {},
        Err(e) => return Err(e),
    }
    match cx.export_function("btree_search", btree_search) {
        Ok(_) => {},
        Err(e) => return Err(e),
    }
    match cx.export_function("btree_get", btree_get) {
        Ok(_) => {},
        Err(e) => return Err(e),
    }
    match cx.export_function("btree_get_best_bid", btree_get_best_bid) {
        Ok(_) => {},
        Err(e) => return Err(e),
    }
    match cx.export_function("btree_get_best_ask", btree_get_best_ask) {
        Ok(_) => {},
        Err(e) => return Err(e),
    }
    match cx.export_function("btree_get_best_bid_ask", btree_get_best_bid_ask) {
        Ok(_) => {},
        Err(e) => return Err(e),
    }
    match cx.export_function("btree_get_all_nodes", btree_get_all_nodes) {
        Ok(_) => {},
        Err(e) => return Err(e),
    }
    match cx.export_function("btree_size", btree_size) {
        Ok(_) => {},
        Err(e) => return Err(e),
    }
    match cx.export_function("btree_clear", btree_clear) {
        Ok(_) => {},
        Err(e) => return Err(e),
    }
    Ok(())
}