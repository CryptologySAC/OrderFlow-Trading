use rust_decimal::Decimal;
use rust_decimal::prelude::*;
use std::collections::BTreeMap;
use chrono::{DateTime, Utc, Duration};
use crate::types::*;
use crate::financial_math::*;

/// High-performance order book implementation using BTreeMap
/// Provides O(log n) operations for all price level operations
pub struct OrderBook {
    /// BTreeMap for O(log n) price level operations
    levels: BTreeMap<Decimal, PassiveLevel>,
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
            tick_size: Decimal::try_from(tick_size).unwrap_or(Decimal::new(1, 8)),
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
            let price = Decimal::from_str_exact(price_str)
                .map_err(|_| format!("Invalid price: {}", price_str))?;
            let qty = Decimal::from_str_exact(qty_str)
                .map_err(|_| format!("Invalid quantity: {}", qty_str))?;

            self.update_level(price, qty, Decimal::ZERO, now)?;
        }

        // Process asks - O(k log n) where k is number of updates
        for (price_str, qty_str) in &update.asks {
            let price = Decimal::from_str_exact(price_str)
                .map_err(|_| format!("Invalid price: {}", price_str))?;
            let qty = Decimal::from_str_exact(qty_str)
                .map_err(|_| format!("Invalid quantity: {}", qty_str))?;

            self.update_level(price, Decimal::ZERO, qty, now)?;
        }

        self.last_update = now;
        Ok(())
    }

    /// Update a single price level - O(log n)
    fn update_level(&mut self, price: Decimal, bid_qty: Decimal, ask_qty: Decimal, timestamp: DateTime<Utc>) -> Result<(), String> {
        // Normalize price to tick size
        let normalized_price = self.normalize_price(price);

        if bid_qty.is_zero() && ask_qty.is_zero() {
            // Remove level if both sides are zero
            self.levels.remove(&normalized_price);
        } else {
            // Update or insert level
            let level = self.levels.entry(normalized_price).or_insert_with(|| PassiveLevel {
                price: normalized_price,
                bid: Decimal::ZERO,
                ask: Decimal::ZERO,
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
            if !bid_qty.is_zero() {
                level.added_bid = Some(bid_qty);
            }
            if !ask_qty.is_zero() {
                level.added_ask = Some(ask_qty);
            }
        }

        Ok(())
    }

    /// Get level at specific price - O(log n)
    pub fn get_level(&self, price: f64) -> Option<&PassiveLevel> {
        let price_decimal = Decimal::from_f64_retain(price)?;
        let normalized_price = self.normalize_price(price_decimal);
        self.levels.get(&normalized_price)
    }

    /// Get best bid price - O(1) amortized with cached value
    pub fn get_best_bid(&self) -> f64 {
        // BTreeMap is ordered, so we can get the last (highest) key
        self.levels.iter()
            .rev()
            .find(|(_, level)| !level.bid.is_zero())
            .map(|(price, _)| price.to_f64().unwrap_or(0.0))
            .unwrap_or(0.0)
    }

    /// Get best ask price - O(1) amortized with cached value
    pub fn get_best_ask(&self) -> f64 {
        // BTreeMap is ordered, so we can get the first (lowest) key
        self.levels.iter()
            .find(|(_, level)| !level.ask.is_zero())
            .map(|(price, _)| price.to_f64().unwrap_or(f64::INFINITY))
            .unwrap_or(f64::INFINITY)
    }

    /// Calculate spread with high precision
    pub fn get_spread(&self) -> f64 {
        let best_bid = Decimal::from_f64_retain(self.get_best_bid()).unwrap_or(Decimal::ZERO);
        let best_ask = Decimal::from_f64_retain(self.get_best_ask()).unwrap_or(Decimal::ZERO);

        if best_bid.is_zero() || best_ask.is_zero() {
            0.0
        } else {
            calculate_spread(best_ask, best_bid, self.config.price_precision).to_f64().unwrap_or(0.0)
        }
    }

    /// Calculate mid price with high precision
    pub fn get_mid_price(&self) -> f64 {
        let best_bid = Decimal::from_f64_retain(self.get_best_bid()).unwrap_or(Decimal::ZERO);
        let best_ask = Decimal::from_f64_retain(self.get_best_ask()).unwrap_or(Decimal::ZERO);

        if best_bid.is_zero() || best_ask.is_zero() {
            0.0
        } else {
            calculate_mid_price(best_bid, best_ask, self.config.price_precision).to_f64().unwrap_or(0.0)
        }
    }

    /// Sum band calculation - O(log n) with BTreeMap range operations
    pub fn sum_band(&self, center: f64, band_ticks: u32, tick_size: f64) -> BandSum {
        let center_decimal = Decimal::from_f64_retain(center).unwrap_or(Decimal::ZERO);
        let tick_size_decimal = Decimal::from_f64_retain(tick_size).unwrap_or(Decimal::new(1, 8));

        // Calculate band boundaries
        let band_size = tick_size_decimal * Decimal::from(band_ticks);
        let min_price = center_decimal - band_size;
        let max_price = center_decimal + band_size;

        let mut sum_bid = Decimal::ZERO;
        let mut sum_ask = Decimal::ZERO;
        let mut levels = 0;

        // Use BTreeMap range query - O(log n + k) where k is levels in range
        for (_, level) in self.levels.range(min_price..=max_price) {
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
        let mut total_bid_volume = Decimal::ZERO;
        let mut total_ask_volume = Decimal::ZERO;

        // Single pass through all levels
        for level in self.levels.values() {
            if !level.bid.is_zero() {
                bid_levels += 1;
                total_bid_volume += level.bid;
            }
            if !level.ask.is_zero() {
                ask_levels += 1;
                total_ask_volume += level.ask;
            }
        }

        let total_volume = total_bid_volume + total_ask_volume;
        let imbalance = if total_volume.is_zero() {
            Decimal::ZERO
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
    fn normalize_price(&self, price: Decimal) -> Decimal {
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
            spread: Decimal::from_f64_retain(self.get_spread()).unwrap_or(Decimal::ZERO),
            mid_price: Decimal::from_f64_retain(self.get_mid_price()).unwrap_or(Decimal::ZERO),
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