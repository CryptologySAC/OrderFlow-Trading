//! # OrderBook Core - High-Performance Order Book Implementation
//!
//! Core library providing order book functionality with BTreeMap.
//! This crate contains only the Rust business logic without any Node.js bindings.

mod types;
mod orderbook;
mod financial_math;

// Export the order book types and functions
pub use types::*;
pub use orderbook::*;
pub use financial_math::*;