use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

/// Represents a price level in the order book
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PassiveLevel {
    pub price: f64,
    pub bid: f64,
    pub ask: f64,
    pub timestamp: DateTime<Utc>,
    pub consumed_ask: Option<f64>,
    pub consumed_bid: Option<f64>,
    pub added_ask: Option<f64>,
    pub added_bid: Option<f64>,
}

impl Default for PassiveLevel {
    fn default() -> Self {
        Self {
            price: 0.0,
            bid: 0.0,
            ask: 0.0,
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
    pub total_bid_volume: f64,
    pub total_ask_volume: f64,
    pub imbalance: f64,
}

/// Band sum result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BandSum {
    pub bid: f64,
    pub ask: f64,
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
    pub spread: f64,
    pub mid_price: f64,
    pub details: HealthDetails,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthDetails {
    pub bid_levels: usize,
    pub ask_levels: usize,
    pub total_bid_volume: f64,
    pub total_ask_volume: f64,
    pub stale_levels: usize,
    pub memory_usage_mb: f64,
}

/// Configuration for order book
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderBookConfig {
    pub price_precision: u32,
    pub tick_size: f64,
    pub max_levels: usize,
    pub max_price_distance: f64,
    pub prune_interval_ms: u64,
    pub max_error_rate: usize,
    pub stale_threshold_ms: u64,
}

impl Default for OrderBookConfig {
    fn default() -> Self {
        Self {
            price_precision: 8,
            tick_size: 0.00000001, // 0.00000001
            max_levels: 1000,
            max_price_distance: 0.1, // 0.1 (10%)
            prune_interval_ms: 30000,
            max_error_rate: 10,
            stale_threshold_ms: 300000,
        }
    }
}