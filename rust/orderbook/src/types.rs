use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

/// Represents a price level in the order book
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PassiveLevel {
    pub price: Decimal,
    pub bid: Decimal,
    pub ask: Decimal,
    pub timestamp: DateTime<Utc>,
    pub consumed_ask: Option<Decimal>,
    pub consumed_bid: Option<Decimal>,
    pub added_ask: Option<Decimal>,
    pub added_bid: Option<Decimal>,
}

impl Default for PassiveLevel {
    fn default() -> Self {
        Self {
            price: Decimal::ZERO,
            bid: Decimal::ZERO,
            ask: Decimal::ZERO,
            timestamp: Utc::now(),
            consumed_ask: None,
            consumed_bid: None,
            added_ask: None,
            added_bid: None,
        }
    }
}

/// Depth update from websocket stream
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DepthUpdate {
    pub symbol: String,
    pub first_update_id: u64,
    pub final_update_id: u64,
    pub bids: Vec<(String, String)>,
    pub asks: Vec<(String, String)>,
}

/// Order book depth metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DepthMetrics {
    pub total_levels: usize,
    pub bid_levels: usize,
    pub ask_levels: usize,
    pub total_bid_volume: Decimal,
    pub total_ask_volume: Decimal,
    pub imbalance: Decimal,
}

/// Band sum result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BandSum {
    pub bid: Decimal,
    pub ask: Decimal,
    pub levels: usize,
}

/// Order book health status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderBookHealth {
    pub status: String,
    pub initialized: bool,
    pub last_update_ms: i64,
    pub circuit_breaker_open: bool,
    pub error_rate: usize,
    pub book_size: usize,
    pub spread: Decimal,
    pub mid_price: Decimal,
    pub details: HealthDetails,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthDetails {
    pub bid_levels: usize,
    pub ask_levels: usize,
    pub total_bid_volume: Decimal,
    pub total_ask_volume: Decimal,
    pub stale_levels: usize,
    pub memory_usage_mb: f64,
}

/// Configuration for order book
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderBookConfig {
    pub price_precision: u32,
    pub tick_size: Decimal,
    pub max_levels: usize,
    pub max_price_distance: Decimal,
    pub prune_interval_ms: u64,
    pub max_error_rate: usize,
    pub stale_threshold_ms: u64,
}

impl Default for OrderBookConfig {
    fn default() -> Self {
        Self {
            price_precision: 8,
            tick_size: Decimal::new(1, 8), // 0.00000001
            max_levels: 1000,
            max_price_distance: Decimal::new(1, 1), // 0.1 (10%)
            prune_interval_ms: 30000,
            max_error_rate: 10,
            stale_threshold_ms: 300000,
        }
    }
}