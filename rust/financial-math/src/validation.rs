//! # Financial Value Validation
//!
//! Validation functions for financial values, prices, and quantities.

use crate::{FinancialResult, FinancialError};

/// Validate that a price value is valid for trading
///
/// # Examples
/// ```
/// use financial_math::is_valid_price;
///
/// assert!(is_valid_price(123.456789).is_ok());
/// assert!(is_valid_price(-1.0).is_err());
/// assert!(is_valid_price(f64::NAN).is_err());
/// ```
pub fn is_valid_price(price: f64) -> FinancialResult<f64> {
    if !price.is_finite() || price <= 0.0 {
        return Err(FinancialError::InvalidValue);
    }
    Ok(price)
}

/// Validate that a quantity value is valid for trading
///
/// # Examples
/// ```
/// use financial_math::is_valid_quantity;
///
/// assert!(is_valid_quantity(100.123456).is_ok());
/// assert!(is_valid_quantity(-5.0).is_err());
/// assert!(is_valid_quantity(f64::INFINITY).is_err());
/// ```
pub fn is_valid_quantity(quantity: f64) -> FinancialResult<f64> {
    if !quantity.is_finite() || quantity <= 0.0 {
        return Err(FinancialError::InvalidValue);
    }
    Ok(quantity)
}

/// Validate u128 fixed-point value bounds
///
/// # Examples
/// ```
/// use financial_math::validate_fixed_point_bounds;
///
/// assert!(validate_fixed_point_bounds(100_000_000, 8).is_ok());
/// assert!(validate_fixed_point_bounds(u128::MAX, 8).is_ok()); // u128::MAX is valid
/// ```
pub fn validate_fixed_point_bounds(value: u128, _scale: u32) -> FinancialResult<u128> {
    // u128 has no invalid values within its range
    // We could add custom bounds checking here if needed
    Ok(value)
}

/// Validate scale parameter
///
/// # Examples
/// ```
/// use financial_math::validate_scale;
///
/// assert!(validate_scale(8).is_ok());
/// assert!(validate_scale(20).is_ok());
/// assert!(validate_scale(0).is_err()); // Zero scale not allowed
/// ```
pub fn validate_scale(scale: u32) -> FinancialResult<u32> {
    if scale == 0 {
        return Err(FinancialError::InvalidScale);
    }
    Ok(scale)
}

/// Validate tick size for price normalization
///
/// # Examples
/// ```
/// use financial_math::validate_tick_size;
///
/// assert!(validate_tick_size(0.01).is_ok());
/// assert!(validate_tick_size(0.0).is_err()); // Zero tick size not allowed
/// ```
pub fn validate_tick_size(tick_size: f64) -> FinancialResult<f64> {
    if !tick_size.is_finite() || tick_size <= 0.0 {
        return Err(FinancialError::InvalidValue);
    }
    Ok(tick_size)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_price_validation() {
        // Valid prices
        assert!(is_valid_price(123.45).is_ok());
        assert!(is_valid_price(0.00000001).is_ok()); // Very small price

        // Invalid prices
        assert!(is_valid_price(0.0).is_err());
        assert!(is_valid_price(-1.0).is_err());
        assert!(is_valid_price(f64::NAN).is_err());
        assert!(is_valid_price(f64::INFINITY).is_err());
    }

    #[test]
    fn test_quantity_validation() {
        // Valid quantities
        assert!(is_valid_quantity(100.0).is_ok());
        assert!(is_valid_quantity(0.00000001).is_ok());

        // Invalid quantities
        assert!(is_valid_quantity(0.0).is_err());
        assert!(is_valid_quantity(-5.0).is_err());
        assert!(is_valid_quantity(f64::NAN).is_err());
    }

    #[test]
    fn test_scale_validation() {
        assert!(validate_scale(1).is_ok());
        assert!(validate_scale(8).is_ok());
        assert!(validate_scale(18).is_ok());
        assert!(validate_scale(0).is_err());
    }

    #[test]
    fn test_tick_size_validation() {
        assert!(validate_tick_size(0.01).is_ok());
        assert!(validate_tick_size(0.00000001).is_ok());
        assert!(validate_tick_size(0.0).is_err());
        assert!(validate_tick_size(-0.01).is_err());
    }
}