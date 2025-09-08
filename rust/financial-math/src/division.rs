//! # Precise Division Operations
//!
//! Division operations with proper precision handling for fixed-point arithmetic.

use crate::{FinancialResult, FinancialError};

/// Precise division with scale adjustment
///
/// # Examples
/// ```
/// use financial_math::precise_divide;
///
/// let result = precise_divide(100_000_000, 3_000_000, 8).unwrap();
/// assert_eq!(result, 33_333_333); // 33.333333
/// ```
pub fn precise_divide(numerator: u128, denominator: u128, scale: u32) -> FinancialResult<u128> {
    if denominator == 0 {
        return Err(FinancialError::DivisionByZero);
    }

    // Scale numerator to maintain precision
    let scaled_numerator = numerator * 10u128.pow(scale);
    Ok(scaled_numerator / denominator)
}

/// Safe division with default value on error
///
/// # Examples
/// ```
/// use financial_math::safe_divide_with_default;
///
/// let result = safe_divide_with_default(100_000_000, 0, 0);
/// assert_eq!(result, 0); // Returns default on division by zero
/// ```
pub fn safe_divide_with_default(numerator: u128, denominator: u128, default: u128) -> u128 {
    if denominator == 0 {
        return default;
    }
    numerator / denominator
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_precise_divide() {
        let result = precise_divide(100_000_000, 2_000_000, 8).unwrap();
        assert_eq!(result, 5_000_000_000); // 50.000000 with 8 decimal places

        // Division by zero
        assert!(precise_divide(100, 0, 8).is_err());
    }

    #[test]
    fn test_safe_divide_with_default() {
        assert_eq!(safe_divide_with_default(100, 2, 0), 50);
        assert_eq!(safe_divide_with_default(100, 0, 999), 999); // Returns default
    }
}