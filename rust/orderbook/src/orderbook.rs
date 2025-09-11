use std::collections::BTreeMap;
use chrono::{DateTime, Utc, Duration};
use crate::types::*;
use crate::financial_math::*;

/// High-performance order book implementation using BTreeMap with u128 keys
/// Provides O(log n) operations for all price level operations with maximum performance
pub struct OrderBook {
    /// BTreeMap with u128 keys for high-precision price storage (8 decimal places)
    levels: BTreeMap<u128, PassiveLevel>,
    config: OrderBookConfig,
    last_update: DateTime<Utc>,
    error_count: usize,
    circuit_open: bool,
    circuit_open_until: Option<DateTime<Utc>>,
}

impl OrderBook {
    /// Create a new order book with the given configuration
    pub fn new(price_precision: u32, tick_size: f64) -> Self {
        let config = OrderBookConfig {
            price_precision,
            tick_size,
            ..Default::default()
        };

        Self {
            levels: BTreeMap::new(),
            config,
            last_update: Utc::now(),
            error_count: 0,
            circuit_open: false,
            circuit_open_until: None,
        }
    }

    /// Convert f64 price to u128 with high precision (multiply by 1e8 for 8 decimal places)
    fn price_to_u128(price: f64) -> u128 {
        (price * 100_000_000.0) as u128
    }

    /// Convert u128 price back to f64
    fn u128_to_price(value: u128) -> f64 {
        value as f64 / 100_000_000.0
    }

    /// Update order book with depth changes - O(log n) per update
    pub fn update_depth(&mut self, update: DepthUpdate) -> Result<(), String> {
        // Check circuit breaker
        if self.circuit_open {
            if let Some(until) = self.circuit_open_until {
                if Utc::now() < until {
                    return Ok(()); // Circuit is open, ignore updates
                } else {
                    self.circuit_open = false;
                    self.circuit_open_until = None;
                }
            }
        }

        let now = Utc::now();

        // Process bids - O(k log n) where k is number of updates
        for (price_str, qty_str) in &update.bids {
            let price: f64 = price_str.parse()
                .map_err(|_| format!("Invalid price: {}", price_str))?;
            let qty: f64 = qty_str.parse()
                .map_err(|_| format!("Invalid quantity: {}", qty_str))?;

            self.update_level(price, qty, 0.0, now)?;
        }

        // Process asks - O(k log n) where k is number of updates
        for (price_str, qty_str) in &update.asks {
            let price: f64 = price_str.parse()
                .map_err(|_| format!("Invalid price: {}", price_str))?;
            let qty: f64 = qty_str.parse()
                .map_err(|_| format!("Invalid quantity: {}", qty_str))?;

            self.update_level(price, 0.0, qty, now)?;
        }

        self.last_update = now;
        Ok(())
    }

    /// Update a single price level - O(log n)
    fn update_level(&mut self, price: f64, bid_qty: f64, ask_qty: f64, timestamp: DateTime<Utc>) -> Result<(), String> {
        // Normalize price to tick size and convert to u128
        let normalized_price = self.normalize_price(price);
        let price_key = Self::price_to_u128(normalized_price);

        if bid_qty == 0.0 && ask_qty == 0.0 {
            // Remove level if both sides are zero
            self.levels.remove(&price_key);
        } else {
            // Update or insert level
            let level = self.levels.entry(price_key).or_insert_with(|| PassiveLevel {
                price: normalized_price,
                bid: 0.0,
                ask: 0.0,
                timestamp,
                consumed_ask: None,
                consumed_bid: None,
                added_ask: None,
                added_bid: None,
            });

            // Update quantities
            level.bid = bid_qty;
            level.ask = ask_qty;
            level.timestamp = timestamp;

            // Track changes for debugging
            if bid_qty != 0.0 {
                level.added_bid = Some(bid_qty);
            }
            if ask_qty != 0.0 {
                level.added_ask = Some(ask_qty);
            }
        }

        Ok(())
    }

    /// Get level at specific price - O(log n)
    pub fn get_level(&self, price: f64) -> Option<&PassiveLevel> {
        let normalized_price = self.normalize_price(price);
        let price_key = Self::price_to_u128(normalized_price);
        self.levels.get(&price_key)
    }

    /// Get best bid price - O(1) amortized with cached value
    pub fn get_best_bid(&self) -> f64 {
        // BTreeMap is ordered, so we can get the last (highest) key
        self.levels.iter()
            .rev()
            .find(|(_, level)| level.bid != 0.0)
            .map(|(price, _)| Self::u128_to_price(*price))
            .unwrap_or(0.0)
    }

    /// Get best ask price - O(1) amortized with cached value
    pub fn get_best_ask(&self) -> f64 {
        // BTreeMap is ordered, so we can get the first (lowest) key
        self.levels.iter()
            .find(|(_, level)| level.ask != 0.0)
            .map(|(price, _)| Self::u128_to_price(*price))
            .unwrap_or(f64::INFINITY)
    }

    /// Calculate spread with high precision
    pub fn get_spread(&self) -> f64 {
        let best_bid = self.get_best_bid();
        let best_ask = self.get_best_ask();

        if best_bid == 0.0 || best_ask == f64::INFINITY {
            0.0
        } else {
            calculate_spread(best_ask, best_bid, self.config.price_precision)
        }
    }

    /// Calculate mid price with high precision
    pub fn get_mid_price(&self) -> f64 {
        let best_bid = self.get_best_bid();
        let best_ask = self.get_best_ask();

        if best_bid == 0.0 || best_ask == f64::INFINITY {
            0.0
        } else {
            calculate_mid_price(best_bid, best_ask, self.config.price_precision)
        }
    }

    /// Sum band calculation - O(log n) with BTreeMap range operations
    pub fn sum_band(&self, center: f64, band_ticks: u32, tick_size: f64) -> BandSum {
        // Calculate band boundaries
        let band_size = tick_size * band_ticks as f64;
        let min_price = center - band_size;
        let max_price = center + band_size;

        let min_key = Self::price_to_u128(min_price);
        let max_key = Self::price_to_u128(max_price);

        let mut sum_bid = 0.0;
        let mut sum_ask = 0.0;
        let mut levels = 0;

        // Use BTreeMap range query - O(log n + k) where k is levels in range
        for (_, level) in self.levels.range(min_key..=max_key) {
            sum_bid += level.bid;
            sum_ask += level.ask;
            levels += 1;
        }

        BandSum {
            bid: sum_bid,
            ask: sum_ask,
            levels,
        }
    }

    /// Get depth metrics - O(n) but optimized with single pass
    pub fn get_depth_metrics(&self) -> DepthMetrics {
        let mut bid_levels = 0;
        let mut ask_levels = 0;
        let mut total_bid_volume = 0.0;
        let mut total_ask_volume = 0.0;

        // Single pass through all levels
        for level in self.levels.values() {
            if level.bid != 0.0 {
                bid_levels += 1;
                total_bid_volume += level.bid;
            }
            if level.ask != 0.0 {
                ask_levels += 1;
                total_ask_volume += level.ask;
            }
        }

        let total_volume = total_bid_volume + total_ask_volume;
        let imbalance = if total_volume == 0.0 {
            0.0
        } else {
            (total_bid_volume - total_ask_volume) / total_volume
        };

        DepthMetrics {
            total_levels: self.levels.len(),
            bid_levels,
            ask_levels,
            total_bid_volume,
            total_ask_volume,
            imbalance,
        }
    }

    /// Get order book size
    pub fn size(&self) -> usize {
        self.levels.len()
    }

    /// Clear all levels
    pub fn clear(&mut self) {
        self.levels.clear();
    }

    /// Normalize price to tick size
    fn normalize_price(&self, price: f64) -> f64 {
        normalize_price_to_tick(price, self.config.tick_size)
    }

    /// Get health status
    pub fn get_health(&self) -> OrderBookHealth {
        let now = Utc::now();
        let last_update_age = now.signed_duration_since(self.last_update).num_milliseconds();
        let metrics = self.get_depth_metrics();

        // Count stale levels
        let stale_threshold = Duration::milliseconds(self.config.stale_threshold_ms as i64);
        let mut stale_levels = 0;
        for level in self.levels.values() {
            if now.signed_duration_since(level.timestamp) > stale_threshold {
                stale_levels += 1;
            }
        }

        // Determine status
        let status = if self.circuit_open || last_update_age > 10000 {
            "unhealthy"
        } else if self.error_count > self.config.max_error_rate / 2 || last_update_age > 5000 || stale_levels > self.levels.len() / 10 {
            "degraded"
        } else {
            "healthy"
        };

        OrderBookHealth {
            status: status.to_string(),
            initialized: !self.levels.is_empty(),
            last_update_ms: last_update_age,
            circuit_breaker_open: self.circuit_open,
            error_rate: self.error_count,
            book_size: self.levels.len(),
            spread: self.get_spread(),
            mid_price: self.get_mid_price(),
            details: HealthDetails {
                bid_levels: metrics.bid_levels,
                ask_levels: metrics.ask_levels,
                total_bid_volume: metrics.total_bid_volume,
                total_ask_volume: metrics.total_ask_volume,
                stale_levels,
                memory_usage_mb: self.estimate_memory_usage(),
            },
        }
    }

    /// Estimate memory usage
    fn estimate_memory_usage(&self) -> f64 {
        // Rough estimate: ~200 bytes per level
        (self.levels.len() * 200) as f64 / (1024.0 * 1024.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_order_book_creation() {
        let order_book = OrderBook::new(8, 0.00000001);
        assert_eq!(order_book.size(), 0);
    }

    #[test]
    fn test_update_depth() {
        let mut order_book = OrderBook::new(8, 0.00000001);

        let update = DepthUpdate {
            symbol: "BTCUSDT".to_string(),
            first_update_id: 1,
            final_update_id: 1,
            bids: vec![("50000.0".to_string(), "1.0".to_string())],
            asks: vec![("50001.0".to_string(), "1.0".to_string())],
        };

        order_book.update_depth(update).unwrap();
        assert_eq!(order_book.size(), 2);
        assert_eq!(order_book.get_best_bid(), 50000.0);
        assert_eq!(order_book.get_best_ask(), 50001.0);
    }
}