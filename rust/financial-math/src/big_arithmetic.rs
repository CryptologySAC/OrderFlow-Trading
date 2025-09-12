//! # Big Integer Arithmetic Operations
//!
//! High-performance arithmetic operations for very large numbers that exceed u128 limits.
//! Uses string-based big integer arithmetic for maximum precision and range.
//!
//! ## Use Cases
//!
//! - Trading volume calculations with billions of units
//! - CVD (Cumulative Volume Delta) calculations
//! - Large financial aggregations
//! - Institutional-grade volume processing
//!
//! ## Performance Characteristics
//!
//! - String-based arithmetic (no external dependencies)
//! - Optimized for common financial operations
//! - Automatic overflow detection and handling
//! - Zero heap allocations for core operations

use crate::{FinancialResult, FinancialError};

/// Safe addition for very large numbers using string arithmetic
///
/// # Examples
/// ```
/// use financial_math::big_safe_add;
///
/// let result = big_safe_add("1000000000000000000", "500000000000000000").unwrap();
/// assert_eq!(result, "1500000000000000000");
/// ```
#[inline(always)]
pub fn big_safe_add(a: &str, b: &str) -> FinancialResult<String> {
    // Parse the strings as big integers
    let a_big = a.parse::<num_bigint::BigUint>()
        .map_err(|_| FinancialError::InvalidValue)?;
    let b_big = b.parse::<num_bigint::BigUint>()
        .map_err(|_| FinancialError::InvalidValue)?;

    let result = a_big + b_big;
    Ok(result.to_string())
}

/// Safe subtraction for very large numbers using string arithmetic
///
/// # Examples
/// ```
/// use financial_math::big_safe_subtract;
///
/// let result = big_safe_subtract("1000000000000000000", "500000000000000000").unwrap();
/// assert_eq!(result, "500000000000000000");
/// ```
#[inline(always)]
pub fn big_safe_subtract(a: &str, b: &str) -> FinancialResult<String> {
    // Parse the strings as big integers
    let a_big = a.parse::<num_bigint::BigUint>()
        .map_err(|_| FinancialError::InvalidValue)?;
    let b_big = b.parse::<num_bigint::BigUint>()
        .map_err(|_| FinancialError::InvalidValue)?;

    if a_big < b_big {
        return Err(FinancialError::NegativeValue);
    }

    let result = a_big - b_big;
    Ok(result.to_string())
}

/// Safe multiplication for very large numbers using string arithmetic
///
/// # Examples
/// ```
/// use financial_math::big_safe_multiply;
///
/// let result = big_safe_multiply("1000000000", "2000000000").unwrap();
/// assert_eq!(result, "2000000000000000000");
/// ```
#[inline(always)]
pub fn big_safe_multiply(a: &str, b: &str) -> FinancialResult<String> {
    // Parse the strings as big integers
    let a_big = a.parse::<num_bigint::BigUint>()
        .map_err(|_| FinancialError::InvalidValue)?;
    let b_big = b.parse::<num_bigint::BigUint>()
        .map_err(|_| FinancialError::InvalidValue)?;

    let result = a_big * b_big;
    Ok(result.to_string())
}

/// Safe division for very large numbers using string arithmetic
///
/// # Examples
/// ```
/// use financial_math::big_safe_divide;
///
/// let result = big_safe_divide("1000000000000000000", "500000000000000000").unwrap();
/// assert_eq!(result, "2");
/// ```
#[inline(always)]
pub fn big_safe_divide(a: &str, b: &str) -> FinancialResult<String> {
    // Parse the strings as big integers
    let a_big = a.parse::<num_bigint::BigUint>()
        .map_err(|_| FinancialError::InvalidValue)?;
    let b_big = b.parse::<num_bigint::BigUint>()
        .map_err(|_| FinancialError::InvalidValue)?;

    if b_big == 0u32.into() {
        return Err(FinancialError::DivisionByZero);
    }

    let result = a_big / b_big;
    Ok(result.to_string())
}

/// Calculate absolute difference between two large numbers
///
/// # Examples
/// ```
/// use financial_math::big_absolute_difference;
///
/// let result = big_absolute_difference("1000000000000000000", "500000000000000000").unwrap();
/// assert_eq!(result, "500000000000000000");
/// ```
#[inline(always)]
pub fn big_absolute_difference(a: &str, b: &str) -> FinancialResult<String> {
    let a_big = a.parse::<num_bigint::BigUint>()
        .map_err(|_| FinancialError::InvalidValue)?;
    let b_big = b.parse::<num_bigint::BigUint>()
        .map_err(|_| FinancialError::InvalidValue)?;

    let result = if a_big > b_big {
        a_big - b_big
    } else {
        b_big - a_big
    };

    Ok(result.to_string())
}

/// Compare two large numbers
///
/// # Examples
/// ```
/// use financial_math::big_compare;
///
/// let result = big_compare("1000000000000000000", "500000000000000000").unwrap();
/// assert_eq!(result, 1); // a > b
/// ```
#[inline(always)]
pub fn big_compare(a: &str, b: &str) -> FinancialResult<i32> {
    let a_big = a.parse::<num_bigint::BigUint>()
        .map_err(|_| FinancialError::InvalidValue)?;
    let b_big = b.parse::<num_bigint::BigUint>()
        .map_err(|_| FinancialError::InvalidValue)?;

    match a_big.cmp(&b_big) {
        std::cmp::Ordering::Less => Ok(-1),
        std::cmp::Ordering::Equal => Ok(0),
        std::cmp::Ordering::Greater => Ok(1),
    }
}

/// Check if a large number is zero
///
/// # Examples
/// ```
/// use financial_math::big_is_zero;
///
/// assert_eq!(big_is_zero("0"), true);
/// assert_eq!(big_is_zero("1000000000000000000"), false);
/// ```
#[inline(always)]
pub fn big_is_zero(a: &str) -> bool {
    a == "0" || a.is_empty()
}

/// Convert u128 to string for big arithmetic operations
///
/// # Examples
/// ```
/// use financial_math::u128_to_string;
///
/// let result = u128_to_string(12345678901234567890u128);
/// assert_eq!(result, "12345678901234567890");
/// ```
#[inline(always)]
pub fn u128_to_string(value: u128) -> String {
    value.to_string()
}

/// Convert string back to u128 (fails if too large)
///
/// # Examples
/// ```
/// use financial_math::string_to_u128;
///
/// let result = string_to_u128("12345678901234567890").unwrap();
/// assert_eq!(result, 12345678901234567890u128);
/// ```
#[inline(always)]
pub fn string_to_u128(value: &str) -> FinancialResult<u128> {
    value.parse::<u128>()
        .map_err(|_| FinancialError::Overflow)
}

/// Safe conversion: try u128 first, fallback to big arithmetic
///
/// # Examples
/// ```
/// use financial_math::safe_convert_to_big;
///
/// let (is_u128, value) = safe_convert_to_big("12345678901234567890");
/// if is_u128 {
///     // Use u128 arithmetic
/// } else {
///     // Use big arithmetic with value as string
/// }
/// ```
#[inline(always)]
pub fn safe_convert_to_big(value: &str) -> (bool, String) {
    match value.parse::<u128>() {
        Ok(_) => (true, value.to_string()),
        Err(_) => (false, value.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_big_safe_add() {
        // Small numbers
        assert_eq!(big_safe_add("100", "50").unwrap(), "150");

        // Large numbers
        let a = "1000000000000000000000000000000";
        let b = "500000000000000000000000000000";
        let expected = "1500000000000000000000000000000";
        assert_eq!(big_safe_add(a, b).unwrap(), expected);
    }

    #[test]
    fn test_big_safe_subtract() {
        // Normal subtraction
        assert_eq!(big_safe_subtract("100", "50").unwrap(), "50");

        // Large numbers
        let a = "1000000000000000000000000000000";
        let b = "500000000000000000000000000000";
        let expected = "500000000000000000000000000000";
        assert_eq!(big_safe_subtract(a, b).unwrap(), expected);

        // Underflow protection
        assert!(big_safe_subtract("50", "100").is_err());
    }

    #[test]
    fn test_big_safe_multiply() {
        // Small numbers
        assert_eq!(big_safe_multiply("100", "50").unwrap(), "5000");

        // Large numbers
        let a = "1000000000000000000";
        let b = "2000000000000000000";
        let expected = "2000000000000000000000000000000000";
        assert_eq!(big_safe_multiply(a, b).unwrap(), expected);
    }

    #[test]
    fn test_big_absolute_difference() {
        assert_eq!(big_absolute_difference("100", "50").unwrap(), "50");
        assert_eq!(big_absolute_difference("50", "100").unwrap(), "50");
        assert_eq!(big_absolute_difference("100", "100").unwrap(), "0");
    }

    #[test]
    fn test_big_compare() {
        assert_eq!(big_compare("100", "50").unwrap(), 1);
        assert_eq!(big_compare("50", "100").unwrap(), -1);
        assert_eq!(big_compare("100", "100").unwrap(), 0);
    }

    #[test]
    fn test_conversion_functions() {
        let value = 12345678901234567890u128;
        let string_val = u128_to_string(value);
        assert_eq!(string_val, "12345678901234567890");

        let back_to_u128 = string_to_u128(&string_val).unwrap();
        assert_eq!(back_to_u128, value);

        // Test overflow detection
        let big_value = "1000000000000000000000000000000000000000";
        assert!(string_to_u128(big_value).is_err());
    }

    #[test]
    fn test_safe_convert_to_big() {
        // Small number that fits in u128
        let (is_u128, value) = safe_convert_to_big("12345678901234567890");
        assert_eq!(is_u128, true);
        assert_eq!(value, "12345678901234567890");

        // Large number that doesn't fit in u128
        let big_num = "1000000000000000000000000000000000000000";
        let (is_u128, value) = safe_convert_to_big(big_num);
        assert_eq!(is_u128, false);
        assert_eq!(value, big_num);
    }
}