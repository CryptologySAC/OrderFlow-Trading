use neon::prelude::*;


mod types;
mod orderbook;
mod financial_math;
mod neon_bindings;
use neon_bindings::*;

// Export the order book types and functions
pub use types::*;
pub use orderbook::*;
pub use financial_math::*;

/// Initialize the Neon module
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