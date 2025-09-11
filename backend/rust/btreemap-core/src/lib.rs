//! # BTreeMap Core - High-Performance Order Book Implementation
//!
//! Core library providing BTreeMap-based order book functionality.
//! This crate contains only the Rust business logic without any Node.js bindings.

use std::collections::BTreeMap;
use std::sync::Mutex;
use serde::{Deserialize, Serialize};

/// PassiveLevel represents a price level in the order book
/// Using u128 for high-precision financial calculations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PassiveLevel {
    pub price: f64,  // Keep as f64 for JSON compatibility, convert internally
    pub bid: f64,
    pub ask: f64,
    pub timestamp: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consumed_ask: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consumed_bid: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub added_ask: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub added_bid: Option<f64>,
}

/// RBNode represents a node in the tree (for API compatibility)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RBNode {
    pub price: f64,
    pub level: PassiveLevel,
}

/// BTreeMap implementation with exact JavaScript API compatibility
/// Using u128 for high-precision price keys, f64 for values (JSON compatible)
pub struct OrderBookBTreeMap {
    tree: Mutex<BTreeMap<u128, PassiveLevel>>,
}

impl OrderBookBTreeMap {
    pub fn new() -> Self {
        Self {
            tree: Mutex::new(BTreeMap::new()),
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

    /// Insert a price level with bid/ask separation enforcement
    pub fn insert(&self, price: f64, level: PassiveLevel) {
        let mut tree = self.tree.lock().unwrap();
        let price_key = Self::price_to_u128(price);

        // If price already exists, merge with separation enforcement
        if let Some(existing) = tree.get_mut(&price_key) {
            *existing = self.enforce_bid_ask_separation(existing.clone(), level);
            return;
        }

        // Insert new level
        tree.insert(price_key, level);
    }

    /// Set bid/ask with automatic separation enforcement
    pub fn set(&self, price: f64, side: &str, quantity: f64) {
        let mut tree = self.tree.lock().unwrap();
        let price_key = Self::price_to_u128(price);

        if let Some(existing) = tree.get_mut(&price_key) {
            // Update existing level with separation enforcement
            if side == "bid" {
                existing.bid = quantity;
                existing.added_bid = Some(quantity);
                // Clear conflicting ask if setting bid > 0
                if quantity > 0.0 {
                    existing.ask = 0.0;
                    existing.added_ask = Some(0.0);
                }
            } else {
                existing.ask = quantity;
                existing.added_ask = Some(quantity);
                // Clear conflicting bid if setting ask > 0
                if quantity > 0.0 {
                    existing.bid = 0.0;
                    existing.added_bid = Some(0.0);
                }
            }
            existing.timestamp = current_timestamp();
        } else {
            // Create new level
            let level = PassiveLevel {
                price,
                bid: if side == "bid" { quantity } else { 0.0 },
                ask: if side == "ask" { quantity } else { 0.0 },
                timestamp: current_timestamp(),
                consumed_ask: Some(0.0),
                consumed_bid: Some(0.0),
                added_ask: if side == "ask" { Some(quantity) } else { Some(0.0) },
                added_bid: if side == "bid" { Some(quantity) } else { Some(0.0) },
            };
            tree.insert(price_key, level);
        }
    }

    /// Delete a price level
    pub fn delete(&self, price: f64) {
        let mut tree = self.tree.lock().unwrap();
        let price_key = Self::price_to_u128(price);
        tree.remove(&price_key);
    }

    /// Find a price level
    pub fn search(&self, price: f64) -> Option<RBNode> {
        let tree = self.tree.lock().unwrap();
        let price_key = Self::price_to_u128(price);
        tree.get(&price_key).map(|level| RBNode {
            price,
            level: level.clone(),
        })
    }

    /// Get price level
    pub fn get(&self, price: f64) -> Option<PassiveLevel> {
        let tree = self.tree.lock().unwrap();
        let price_key = Self::price_to_u128(price);
        tree.get(&price_key).cloned()
    }

    /// Get best bid (highest price with bid > 0)
    pub fn get_best_bid(&self) -> f64 {
        let tree = self.tree.lock().unwrap();
        tree.iter()
            .rev()
            .find(|(_, level)| level.bid > 0.0)
            .map(|(price, _)| Self::u128_to_price(*price))
            .unwrap_or(0.0)
    }

    /// Get best ask (lowest price with ask > 0)
    pub fn get_best_ask(&self) -> f64 {
        let tree = self.tree.lock().unwrap();
        tree.iter()
            .find(|(_, level)| level.ask > 0.0)
            .map(|(price, _)| Self::u128_to_price(*price))
            .unwrap_or(f64::INFINITY)
    }

    /// Get both best bid and ask
    pub fn get_best_bid_ask(&self) -> (f64, f64) {
        let tree = self.tree.lock().unwrap();
        let mut best_bid = 0.0;
        let mut best_ask = f64::INFINITY;

        for (price, level) in tree.iter().rev() {
            if level.bid > 0.0 && best_bid == 0.0 {
                best_bid = Self::u128_to_price(*price);
            }
            if level.ask > 0.0 && best_ask == f64::INFINITY {
                best_ask = Self::u128_to_price(*price);
            }
            if best_bid > 0.0 && best_ask != f64::INFINITY {
                break;
            }
        }

        (best_bid, best_ask)
    }

    /// Get all nodes for iteration
    pub fn get_all_nodes(&self) -> Vec<RBNode> {
        let tree = self.tree.lock().unwrap();
        tree.iter()
            .map(|(price, level)| RBNode {
                price: Self::u128_to_price(*price),
                level: level.clone(),
            })
            .collect()
    }

    /// Get tree size
    pub fn size(&self) -> usize {
        let tree = self.tree.lock().unwrap();
        tree.len()
    }

    /// Clear tree
    pub fn clear(&self) {
        let mut tree = self.tree.lock().unwrap();
        tree.clear();
    }

    /// Enforce bid/ask separation when merging levels
    fn enforce_bid_ask_separation(&self, existing: PassiveLevel, incoming: PassiveLevel) -> PassiveLevel {
        let mut result = existing;

        // If incoming has bid data, clear any existing ask and update bid
        if incoming.bid > 0.0 {
            result.bid = incoming.bid;
            result.added_bid = incoming.added_bid;
            result.ask = 0.0;
            result.added_ask = Some(0.0);
        }

        // If incoming has ask data, clear any existing bid and update ask
        if incoming.ask > 0.0 {
            result.ask = incoming.ask;
            result.added_ask = incoming.added_ask;
            result.bid = 0.0;
            result.added_bid = Some(0.0);
        }

        // Update other fields
        result.timestamp = incoming.timestamp;
        result.consumed_bid = incoming.consumed_bid;
        result.consumed_ask = incoming.consumed_ask;

        result
    }
}

/// Helper function to get current timestamp in milliseconds
fn current_timestamp() -> f64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_btreemap_basic_operations() {
        let tree = OrderBookBTreeMap::new();

        // Test insert
        let level = PassiveLevel {
            price: 100.0,
            bid: 10.0,
            ask: 0.0,
            timestamp: 1234567890.0,
            consumed_ask: Some(0.0),
            consumed_bid: Some(0.0),
            added_ask: Some(0.0),
            added_bid: Some(10.0),
        };

        tree.insert(100.0, level);

        // Test get
        let retrieved = tree.get(100.0);
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().bid, 10.0);

        // Test size
        assert_eq!(tree.size(), 1);

        // Test set
        tree.set(100.0, "ask", 5.0);
        let updated = tree.get(100.0);
        assert!(updated.is_some());
        let updated_level = updated.unwrap();
        assert_eq!(updated_level.ask, 5.0);
        assert_eq!(updated_level.bid, 0.0); // Should be cleared due to separation

        // Test delete
        tree.delete(100.0);
        assert_eq!(tree.size(), 0);
    }

    #[test]
    fn test_best_bid_ask() {
        let tree = OrderBookBTreeMap::new();

        // Add some levels
        tree.set(100.0, "bid", 10.0);
        tree.set(101.0, "bid", 5.0);
        tree.set(102.0, "ask", 8.0);
        tree.set(103.0, "ask", 3.0);

        // Test best bid (highest price with bid > 0)
        assert_eq!(tree.get_best_bid(), 101.0);

        // Test best ask (lowest price with ask > 0)
        assert_eq!(tree.get_best_ask(), 102.0);

        // Test combined
        let (bid, ask) = tree.get_best_bid_ask();
        assert_eq!(bid, 101.0);
        assert_eq!(ask, 102.0);
    }
}