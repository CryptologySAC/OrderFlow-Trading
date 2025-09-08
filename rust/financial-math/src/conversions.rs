//! # Fixed-Point Conversions
//!
//! Convert between floating-point numbers and u128 fixed-point representation.
//! This module handles the critical conversions that maintain precision
//! while interfacing with external systems that use floating-point.

use crate::{FinancialResult, FinancialError, Scale, PRICE_SCALE, QUANTITY_SCALE};

/// Convert a floating-point price to u128 fixed-point representation
///
/// # Examples
/// ```
/// use financial_math::price_to_int;
///
/// let price = 123.45678900;
/// let fixed_point = price_to_int(price).unwrap();
/// assert_eq!(fixed_point, 12345678900u128);
/// ```
pub fn price_to_int(price: f64) -> FinancialResult<u128> {
    if !price.is_finite() || price < 0.0 {
        return Err(FinancialError::InvalidValue);
    }

    // Convert to fixed-point with 8 decimal places
    let multiplier = PRICE_SCALE.multiplier();
    let scaled = (price * multiplier as f64).round() as u128;

    Ok(scaled)
}

/// Convert u128 fixed-point price back to floating-point
///
/// # Examples
/// ```
/// use financial_math::int_to_price;
///
/// let fixed_point = 12345678900u128;
/// let price = int_to_price(fixed_point);
/// assert_eq!(price, 123.45678900);
/// ```
pub fn int_to_price(price_int: u128) -> f64 {
    let multiplier = PRICE_SCALE.multiplier() as f64;
    price_int as f64 / multiplier
}

/// Convert a floating-point quantity to u128 fixed-point representation
///
/// # Examples
/// ```
/// use financial_math::quantity_to_int;
///
/// let quantity = 100.12345678;
/// let fixed_point = quantity_to_int(quantity).unwrap();
/// assert_eq!(fixed_point, 10012345678u128);
/// ```
pub fn quantity_to_int(quantity: f64) -> FinancialResult<u128> {
    if !quantity.is_finite() || quantity < 0.0 {
        return Err(FinancialError::InvalidValue);
    }

    // Convert to fixed-point with 8 decimal places
    let multiplier = QUANTITY_SCALE.multiplier();
    let scaled = (quantity * multiplier as f64).round() as u128;

    Ok(scaled)
}

/// Convert u128 fixed-point quantity back to floating-point
///
/// # Examples
/// ```
/// use financial_math::int_to_quantity;
///
/// let fixed_point = 10012345678u128;
/// let quantity = int_to_quantity(fixed_point);
/// assert_eq!(quantity, 100.12345678);
/// ```
pub fn int_to_quantity(quantity_int: u128) -> f64 {
    let multiplier = QUANTITY_SCALE.multiplier() as f64;
    quantity_int as f64 / multiplier
}

/// Convert percentage to fixed-point representation (4 decimal places)
///
/// # Examples
/// ```
/// use financial_math::percentage_to_int;
///
/// let percentage = 12.3456;
/// let fixed_point = percentage_to_int(percentage).unwrap();
/// assert_eq!(fixed_point, 123456u128);
/// ```
pub fn percentage_to_int(percentage: f64) -> FinancialResult<u128> {
    if !percentage.is_finite() {
        return Err(FinancialError::InvalidValue);
    }

    // Convert to fixed-point with 4 decimal places
    let multiplier = 10_000u128; // 10^4
    let scaled = (percentage * multiplier as f64).round() as u128;

    Ok(scaled)
}

/// Convert fixed-point percentage back to floating-point
///
/// # Examples
/// ```
/// use financial_math::int_to_percentage;
///
/// let fixed_point = 123456u128;
/// let percentage = int_to_percentage(fixed_point);
/// assert_eq!(percentage, 12.3456);
/// ```
pub fn int_to_percentage(percentage_int: u128) -> f64 {
    let multiplier = 10_000u128 as f64; // 10^4
    percentage_int as f64 / multiplier
}

/// Generic conversion from floating-point to fixed-point with custom scale
///
/// # Examples
/// ```
/// use financial_math::{float_to_fixed, Scale};
///
/// let value = 123.456789;
/// let fixed_point = float_to_fixed(value, Scale::Custom(6)).unwrap();
/// assert_eq!(fixed_point, 123456789u128);
/// ```
pub fn float_to_fixed(value: f64, scale: Scale) -> FinancialResult<u128> {
    if !value.is_finite() || value < 0.0 {
        return Err(FinancialError::InvalidValue);
    }

    let multiplier = scale.multiplier();
    let scaled = (value * multiplier as f64).round() as u128;

    Ok(scaled)
}

/// Generic conversion from fixed-point to floating-point with custom scale
///
/// # Examples
/// ```
/// use financial_math::{fixed_to_float, Scale};
///
/// let fixed_point = 123456789u128;
/// let value = fixed_to_float(fixed_point, Scale::Custom(6));
/// assert_eq!(value, 123.456789);
/// ```
pub fn fixed_to_float(fixed_value: u128, scale: Scale) -> f64 {
    let multiplier = scale.multiplier() as f64;
    fixed_value as f64 / multiplier
}

/// Safe conversion that handles edge cases
///
/// # Examples
/// ```
/// use financial_math::safe_float_to_fixed;
///
/// // Normal case
/// let result = safe_float_to_fixed(123.456789, 8).unwrap();
/// assert_eq!(result, 12345678900u128);
///
/// // Edge case: very small number
/// let small = safe_float_to_fixed(0.00000001, 8).unwrap();
/// assert_eq!(small, 1u128);
///
/// // Error case: negative number
/// let negative = safe_float_to_fixed(-1.0, 8);
/// assert!(negative.is_err());
/// ```
pub fn safe_float_to_fixed(value: f64, scale: u32) -> FinancialResult<u128> {
    if !value.is_finite() {
        return Err(FinancialError::InvalidValue);
    }

    if value < 0.0 {
        return Err(FinancialError::NegativeValue);
    }

    // Handle very small numbers that would round to zero
    if value > 0.0 && value < 1.0 / 10f64.powf(scale as f64) {
        return Err(FinancialError::InvalidValue);
    }

    let multiplier = 10u128.pow(scale);
    let scaled = (value * multiplier as f64).round();

    // Check for overflow
    if scaled > u128::MAX as f64 {
        return Err(FinancialError::Overflow);
    }

    Ok(scaled as u128)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_price_conversions() {
        // Test basic price conversion
        let price = 123.45678900;
        let fixed = price_to_int(price).unwrap();
        assert_eq!(fixed, 12345678900u128);

        let back_to_float = int_to_price(fixed);
        assert!((back_to_float - price).abs() < 1e-10); // Very small difference due to rounding
    }

    #[test]
    fn test_quantity_conversions() {
        let quantity = 100.12345678;
        let fixed = quantity_to_int(quantity).unwrap();
        assert_eq!(fixed, 10012345678u128);

        let back_to_float = int_to_quantity(fixed);
        assert!((back_to_float - quantity).abs() < 1e-10);
    }

    #[test]
    fn test_percentage_conversions() {
        let percentage = 12.3456;
        let fixed = percentage_to_int(percentage).unwrap();
        assert_eq!(fixed, 123456u128);

        let back_to_float = int_to_percentage(fixed);
        assert!((back_to_float - percentage).abs() < 1e-6);
    }

    #[test]
    fn test_edge_cases() {
        // Zero should work
        assert_eq!(price_to_int(0.0).unwrap(), 0u128);

        // Very small numbers
        let small_price = 0.00000001; // 1 satoshi in BTC
        let fixed_small = price_to_int(small_price).unwrap();
        assert_eq!(fixed_small, 1u128);

        // Negative numbers should fail
        assert!(price_to_int(-1.0).is_err());

        // NaN should fail
        assert!(price_to_int(f64::NAN).is_err());

        // Infinity should fail
        assert!(price_to_int(f64::INFINITY).is_err());
    }

    #[test]
    fn test_custom_scale_conversions() {
        let value = 123.456789;
        let fixed = float_to_fixed(value, Scale::Custom(6)).unwrap();
        assert_eq!(fixed, 123456789u128);

        let back_to_float = fixed_to_float(fixed, Scale::Custom(6));
        assert!((back_to_float - value).abs() < 1e-6);
    }

    #[test]
    fn test_safe_conversions() {
        // Normal case
        let result = safe_float_to_fixed(123.456789, 8).unwrap();
        assert_eq!(result, 12345678900u128);

        // Negative should fail
        assert!(safe_float_to_fixed(-1.0, 8).is_err());

        // NaN should fail
        assert!(safe_float_to_fixed(f64::NAN, 8).is_err());

        // Very small number should fail
        assert!(safe_float_to_fixed(1e-20, 8).is_err());
    }
}