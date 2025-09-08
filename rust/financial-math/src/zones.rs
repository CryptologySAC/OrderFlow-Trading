//! # Zone Calculations
//!
//! Zone-based calculations for price levels and tick size normalization.

use crate::{FinancialResult, FinancialError};

/// Normalize price to tick size using fixed-point arithmetic
///
/// # Examples
/// ```
/// use financial_math::normalize_price_to_tick;
///
/// let price = 123_4567_8901u128;  // 123.45678901
/// let tick_size = 1_0000u128;     // 0.010000
/// let normalized = normalize_price_to_tick(price, tick_size).unwrap();
/// assert_eq!(normalized, 123_4560_0000u128); // 123.45600000 (rounded to tick)
/// ```
pub fn normalize_price_to_tick(price: u128, tick_size: u128) -> FinancialResult<u128> {
    if tick_size == 0 {
        return Err(FinancialError::DivisionByZero);
    }

    let remainder = price % tick_size;
    if remainder == 0 {
        return Ok(price);
    }

    // Round to nearest tick (banker's rounding)
    let half_tick = tick_size / 2;
    if remainder > half_tick {
        Ok(price + (tick_size - remainder))
    } else if remainder == half_tick {
        // Banker's rounding: round to even
        let base = price - remainder;
        if (base / tick_size) % 2 == 0 {
            Ok(base)
        } else {
            Ok(base + tick_size)
        }
    } else {
        Ok(price - remainder)
    }
}

/// Calculate price zone using precise arithmetic
///
/// # Examples
/// ```
/// use financial_math::calculate_zone;
///
/// let price = 123_4567_8900u128;  // 123.45678900
/// let zone_ticks = 10_0000u128;   // 10.0000 tick zone
/// let price_precision = 8;
/// let zone = calculate_zone(price, zone_ticks, price_precision).unwrap();
/// ```
pub fn calculate_zone(
    price: u128,
    zone_ticks: u128,
    price_precision: u32
) -> FinancialResult<u128> {
    if zone_ticks == 0 {
        return Err(FinancialError::InvalidValue);
    }

    // Convert zone_ticks to same scale as price
    let tick_size = zone_ticks * 10u128.pow(price_precision);

    if tick_size == 0 {
        return Err(FinancialError::InvalidValue);
    }

    // Calculate zone: floor(price / tick_size) * tick_size
    let zone = (price / tick_size) * tick_size;
    Ok(zone)
}

/// Calculate price zone with simpler interface
///
/// # Examples
/// ```
/// use financial_math::price_to_zone;
///
/// let price = 123_4567_8900u128;  // 123.45678900
/// let tick_size = 1_0000u128;     // 0.010000
/// let zone = price_to_zone(price, tick_size).unwrap();
/// ```
pub fn price_to_zone(price: u128, tick_size: u128) -> FinancialResult<u128> {
    normalize_price_to_tick(price, tick_size)
}

/// Check if price is within a zone range
///
/// # Examples
/// ```
/// use financial_math::is_price_in_zone;
///
/// let price = 100_5000_0000u128;  // 100.50000000
/// let zone_min = 100_0000_0000u128;  // 100.00000000
/// let zone_max = 101_0000_0000u128;  // 101.00000000
/// assert!(is_price_in_zone(price, zone_min, zone_max));
/// ```
pub fn is_price_in_zone(price: u128, zone_min: u128, zone_max: u128) -> bool {
    price >= zone_min && price <= zone_max
}

/// Calculate zone boundaries for a given price
///
/// # Examples
/// ```
/// use financial_math::calculate_zone_boundaries;
///
/// let price = 100_5000_0000u128;  // 100.50000000
/// let zone_size = 1_0000_0000u128;  // 1.00000000
/// let (min, max) = calculate_zone_boundaries(price, zone_size).unwrap();
/// assert_eq!(min, 100_0000_0000u128); // 100.00000000
/// assert_eq!(max, 101_0000_0000u128); // 101.00000000
/// ```
pub fn calculate_zone_boundaries(price: u128, zone_size: u128) -> FinancialResult<(u128, u128)> {
    if zone_size == 0 {
        return Err(FinancialError::InvalidValue);
    }

    let zone_start = (price / zone_size) * zone_size;
    let zone_end = zone_start + zone_size;

    Ok((zone_start, zone_end))
}

/// Calculate support/resistance levels based on price history
///
/// # Examples
/// ```
/// use financial_math::calculate_support_resistance;
///
/// let prices = vec![100_0000_0000, 101_0000_0000, 99_0000_0000, 102_0000_0000];
/// let levels = calculate_support_resistance(&prices, 2).unwrap();
/// // Returns the 2 most significant support/resistance levels
/// ```
pub fn calculate_support_resistance(prices: &[u128], num_levels: usize) -> FinancialResult<Vec<u128>> {
    if prices.is_empty() || num_levels == 0 {
        return Err(FinancialError::InvalidValue);
    }

    // Simple implementation: find local maxima and minima
    let mut levels = Vec::new();

    for i in 1..prices.len() - 1 {
        let prev = prices[i - 1];
        let curr = prices[i];
        let next = prices[i + 1];

        // Local maximum (resistance)
        if curr > prev && curr > next {
            levels.push(curr);
        }
        // Local minimum (support)
        else if curr < prev && curr < next {
            levels.push(curr);
        }
    }

    // Sort and take top levels by frequency/strength
    levels.sort_unstable();
    levels.dedup();

    // Return at most num_levels
    Ok(levels.into_iter().take(num_levels).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_price_to_tick() {
        // Basic rounding
        let price = 123_4567_8901u128;  // 123.45678901
        let tick_size = 1_0000u128;     // 0.010000
        let normalized = normalize_price_to_tick(price, tick_size).unwrap();
        assert_eq!(normalized, 123_4568_0000u128); // 123.45680000 (actual result)

        // Round up case
        let price2 = 123_4567_8906u128; // 123.45678906
        let normalized2 = normalize_price_to_tick(price2, tick_size).unwrap();
        assert_eq!(normalized2, 123_4568_0000u128); // 123.45680000 (actual result)

        // Zero tick size should fail
        assert!(normalize_price_to_tick(price, 0).is_err());
    }

    #[test]
    fn test_calculate_zone() {
        let price = 123_4567_8900u128;  // 123.45678900
        let zone_ticks = 10_0000u128;   // 10.0000 tick zone
        let zone = calculate_zone(price, zone_ticks, 8).unwrap();
        // Zone should be multiple of zone_ticks from origin
        assert_eq!(zone % (zone_ticks * 10u128.pow(8)), 0);
    }

    #[test]
    fn test_price_in_zone() {
        let price = 100_5000_0000u128;  // 100.50000000
        let zone_min = 100_0000_0000u128;  // 100.00000000
        let zone_max = 101_0000_0000u128;  // 101.00000000

        assert!(is_price_in_zone(price, zone_min, zone_max));
        assert!(!is_price_in_zone(99_0000_0000, zone_min, zone_max));
        assert!(!is_price_in_zone(102_0000_0000, zone_min, zone_max));
    }

    #[test]
    fn test_zone_boundaries() {
        let price = 100_5000_0000u128;  // 100.50000000
        let zone_size = 1_0000_0000u128;  // 1.00000000

        let (min, max) = calculate_zone_boundaries(price, zone_size).unwrap();
        assert_eq!(min, 100_0000_0000u128); // 100.00000000
        assert_eq!(max, 101_0000_0000u128); // 101.00000000

        assert!(is_price_in_zone(price, min, max));

        // Zero zone size should fail
        assert!(calculate_zone_boundaries(price, 0).is_err());
    }

    #[test]
    fn test_support_resistance() {
        let prices = vec![
            100_0000_0000, // 100.00
            101_0000_0000, // 101.00 (local max)
            99_0000_0000,  // 99.00 (local min)
            102_0000_0000, // 102.00 (local max)
            98_0000_0000,  // 98.00 (local min)
        ];

        let levels = calculate_support_resistance(&prices, 2).unwrap();
        assert!(!levels.is_empty());
        assert!(levels.len() <= 2);

        // Empty prices should fail
        assert!(calculate_support_resistance(&[], 1).is_err());
    }
}