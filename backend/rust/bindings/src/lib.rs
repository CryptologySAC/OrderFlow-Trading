//! Node.js bindings for financial-math library using Neon
//!
//! This module provides Neon bindings to make the Rust financial math
//! library available to Node.js applications with zero-overhead performance.

use neon::prelude::*;
use financial_math::{PRICE_SCALE, QUANTITY_SCALE};

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
    Ok(())
}