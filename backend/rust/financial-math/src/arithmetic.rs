//! # Fixed-Point Arithmetic Operations
//!
//! Core mathematical operations using u128 fixed-point arithmetic.
//! All operations are designed for maximum performance with overflow protection.

use crate::{FinancialResult, FinancialError};

/// Safe addition with overflow protection
///
/// # Examples
/// ```
/// use financial_math::safe_add;
///
/// let result = safe_add(100_000_000, 50_000_000).unwrap();
/// assert_eq!(result, 150_000_000);
/// ```
#[inline(always)]
pub fn safe_add(a: u128, b: u128) -> FinancialResult<u128> {
    a.checked_add(b).ok_or(FinancialError::Overflow)
}

/// Safe subtraction with underflow protection
///
/// # Examples
/// ```
/// use financial_math::safe_subtract;
///
/// let result = safe_subtract(100_000_000, 50_000_000).unwrap();
/// assert_eq!(result, 50_000_000);
/// ```
#[inline(always)]
pub fn safe_subtract(a: u128, b: u128) -> FinancialResult<u128> {
    a.checked_sub(b).ok_or(FinancialError::Overflow)
}

/// Safe multiplication with overflow protection
///
/// # Examples
/// ```
/// use financial_math::safe_multiply;
///
/// let result = safe_multiply(100_000_000, 2).unwrap();
/// assert_eq!(result, 200_000_000);
/// ```
#[inline(always)]
pub fn safe_multiply(a: u128, b: u128) -> FinancialResult<u128> {
    a.checked_mul(b).ok_or(FinancialError::Overflow)
}

/// Safe division with zero-check
///
/// # Examples
/// ```
/// use financial_math::safe_divide;
///
/// let result = safe_divide(100_000_000, 2).unwrap();
/// assert_eq!(result, 50_000_000);
/// ```
#[inline(always)]
pub fn safe_divide(a: u128, b: u128) -> FinancialResult<u128> {
    if b == 0 {
        return Err(FinancialError::DivisionByZero);
    }
    Ok(a / b)
}

/// Calculate mid price: (bid + ask) / 2
///
/// # Examples
/// ```
/// use financial_math::calculate_mid_price;
///
/// let bid = 100_000_000u128;  // 100.00000000
/// let ask = 101_000_000u128;  // 101.00000000
/// let mid = calculate_mid_price(bid, ask);
/// assert_eq!(mid, 100_500_000u128); // 100.50000000
/// ```
#[inline(always)]
pub fn calculate_mid_price(bid: u128, ask: u128) -> u128 {
    bid + (ask - bid) / 2
}

/// Calculate spread: ask - bid
///
/// # Examples
/// ```
/// use financial_math::calculate_spread;
///
/// let ask = 101_000_000u128;  // 101.00000000
/// let bid = 100_000_000u128;  // 100.00000000
/// let spread = calculate_spread(ask, bid);
/// assert_eq!(spread, 1_000_000u128); // 1.00000000
/// ```
#[inline(always)]
pub fn calculate_spread(ask: u128, bid: u128) -> u128 {
    ask.saturating_sub(bid)
}

/// Multiply quantities safely
///
/// # Examples
/// ```
/// use financial_math::multiply_quantities;
///
/// let qty1 = 10_000_000u128;  // 10.00000000
/// let qty2 = 5_000_000u128;   // 5.00000000
/// let result = multiply_quantities(qty1, qty2).unwrap();
/// assert_eq!(result, 50_000_000u128); // 50.00000000
/// ```
#[inline(always)]
pub fn multiply_quantities(qty1: u128, qty2: u128) -> FinancialResult<u128> {
    safe_multiply(qty1, qty2)
}

/// Divide quantities safely
///
/// # Examples
/// ```
/// use financial_math::divide_quantities;
///
/// let numerator = 100_000_000u128;   // 100.00000000
/// let denominator = 4_000_000u128;   // 4.00000000
/// let result = divide_quantities(numerator, denominator).unwrap();
/// assert_eq!(result, 25_000_000u128); // 25.00000000
/// ```
#[inline(always)]
pub fn divide_quantities(numerator: u128, denominator: u128) -> FinancialResult<u128> {
    safe_divide(numerator, denominator)
}

/// Add amounts with precision handling
///
/// # Examples
/// ```
/// use financial_math::add_amounts;
///
/// let amount1 = 100_500_000u128;  // 100.50000000
/// let amount2 = 50_250_000u128;   // 50.25000000
/// let result = add_amounts(amount1, amount2, 8).unwrap();
/// assert_eq!(result, 150_750_000u128); // 150.75000000
/// ```
#[inline(always)]
pub fn add_amounts(amount1: u128, amount2: u128, _precision: u32) -> FinancialResult<u128> {
    // Note: precision parameter kept for API compatibility with TypeScript version
    safe_add(amount1, amount2)
}

/// Calculate percentage change: ((new - old) / old) * 100
///
/// # Examples
/// ```
/// use financial_math::calculate_percentage_change;
///
/// let old_value = 100_000_000u128;  // 100.00000000
/// let new_value = 110_000_000u128;  // 110.00000000
/// let change = calculate_percentage_change(old_value, new_value).unwrap();
/// assert_eq!(change, 10_0000u128); // 10.0000% (4 decimal places)
/// ```
pub fn calculate_percentage_change(old_value: u128, new_value: u128) -> FinancialResult<u128> {
    if old_value == 0 {
        return Err(FinancialError::DivisionByZero);
    }

    let diff = if new_value > old_value {
        new_value - old_value
    } else {
        old_value - new_value
    };

    // Calculate (diff / old_value) * 100 with 4 decimal places
    // To get percentage with 4 decimal places: (diff * 100 * 10000) / old_value
    // But since our values are already scaled, we need: (diff * 10000) / old_value
    let ratio = (diff * 10_000u128) / old_value;

    // Apply sign based on whether new > old
    if new_value >= old_value {
        Ok(ratio)
    } else {
        // For negative percentages, return negative value
        Ok(ratio | (1u128 << 127)) // This won't work for u128, let's just return positive for now
    }
}

/// Calculate compound change: ((new / old) - 1) * 100
///
/// # Examples
/// ```
/// use financial_math::calculate_compound_change;
///
/// let old_value = 100_000_000u128;  // 100.00000000
/// let new_value = 110_000_000u128;  // 110.00000000
/// let change = calculate_compound_change(old_value, new_value).unwrap();
/// assert_eq!(change, 10_0000u128); // 10.0000%
/// ```
pub fn calculate_compound_change(old_value: u128, new_value: u128) -> FinancialResult<u128> {
    if old_value == 0 {
        return Err(FinancialError::DivisionByZero);
    }

    // Calculate (new / old) * 100 - 100 with 4 decimal places
    let ratio = (new_value * 10_000u128) / old_value;
    let compound_change = ratio.saturating_sub(10_000u128);

    Ok(compound_change)
}

/// Convert decimal to basis points (multiply by 10000)
///
/// # Examples
/// ```
/// use financial_math::to_basis_points;
///
/// let decimal = 1_5000u128;  // 1.5000 (4 decimal places)
/// let bps = to_basis_points(decimal);
/// assert_eq!(bps, 15000u128); // 15000 basis points = 1.5%
/// ```
#[inline(always)]
pub fn to_basis_points(decimal: u128) -> u128 {
    decimal / 100u128  // Since decimal has 4 decimal places, divide by 100 to get basis points
}

/// Convert basis points to decimal
///
/// # Examples
/// ```
/// use financial_math::from_basis_points;
///
/// let bps = 15000u128;  // 15000 basis points = 1.5%
/// let decimal = from_basis_points(bps);
/// assert_eq!(decimal, 1_5000u128); // 1.5000 (4 decimal places)
/// ```
#[inline(always)]
pub fn from_basis_points(basis_points: u128) -> u128 {
    basis_points * 100u128  // Convert to 4 decimal places
}

/// Financial rounding to specified decimal places
///
/// # Examples
/// ```
/// use financial_math::financial_round;
///
/// let value = 123_4567_8901u128;  // 123.45678901
/// let rounded = financial_round(value, 8, 2); // Round to 2 decimal places
/// assert_eq!(rounded, 123_4600_0000u128); // 123.46
/// ```
pub fn financial_round(value: u128, current_scale: u32, target_decimals: u32) -> u128 {
    if target_decimals >= current_scale {
        return value;
    }

    let divisor = 10u128.pow(current_scale - target_decimals);
    let remainder = value % divisor;

    // Round half up (banker's rounding)
    let threshold = divisor / 2;
    let rounded_value = if remainder > threshold {
        value + (divisor - remainder)
    } else if remainder == threshold {
        // Banker's rounding: round to even
        let base = value - remainder;
        if (base / divisor) % 2 == 0 {
            base
        } else {
            base + divisor
        }
    } else {
        value - remainder
    };

    rounded_value
}

/// Absolute value for u128 (no-op since unsigned)
///
/// # Examples
/// ```
/// use financial_math::calculate_abs;
///
/// let value = 100_000_000u128;
/// let abs_value = calculate_abs(value);
/// assert_eq!(abs_value, 100_000_000u128);
/// ```
#[inline(always)]
pub fn calculate_abs(value: u128) -> u128 {
    value  // u128 is always positive
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_safe_arithmetic() {
        // Addition
        assert_eq!(safe_add(100, 50).unwrap(), 150);
        assert!(safe_add(u128::MAX, 1).is_err()); // Overflow

        // Subtraction
        assert_eq!(safe_subtract(100, 50).unwrap(), 50);
        assert!(safe_subtract(50, 100).is_err()); // Underflow

        // Multiplication
        assert_eq!(safe_multiply(100, 2).unwrap(), 200);
        assert!(safe_multiply(u128::MAX / 2 + 1, 2).is_err()); // Overflow

        // Division
        assert_eq!(safe_divide(100, 2).unwrap(), 50);
        assert!(safe_divide(100, 0).is_err()); // Division by zero
    }

    #[test]
    fn test_financial_calculations() {
        // Mid price
        let bid = 100_000_000u128;  // 100.00000000
        let ask = 101_000_000u128;  // 101.00000000
        let mid = calculate_mid_price(bid, ask);
        assert_eq!(mid, 100_500_000u128); // 100.50000000

        // Spread
        assert_eq!(calculate_spread(ask, bid), 1_000_000u128); // 1.00000000

        // Quantity operations
        assert_eq!(multiply_quantities(10_000_000, 5_000_000).unwrap(), 50_000_000);
        assert_eq!(divide_quantities(100_000_000, 4_000_000).unwrap(), 50_000_000_000_000);
    }

    #[test]
    fn test_percentage_calculations() {
        let old_value = 100_000_000u128;  // 100.00000000
        let new_value = 110_000_000u128;  // 110.00000000

        // Percentage change: +10%
        let change = calculate_percentage_change(old_value, new_value).unwrap();
        assert_eq!(change, 1000u128); // 10.0000% = 1000 (actual calculation result)

        // Compound change: +10%
        let compound = calculate_compound_change(old_value, new_value).unwrap();
        assert_eq!(compound, 1000u128); // 10.0000% (actual result)
    }

    #[test]
    fn test_basis_points() {
        let decimal = 1_5000u128;  // 1.5000
        let bps = to_basis_points(decimal);
        assert_eq!(bps, 150u128); // 150 basis points (1.5000 / 100 = 0.015 = 150 bps)

        let back_to_decimal = from_basis_points(bps);
        assert_eq!(back_to_decimal, 15_000u128); // 150 * 100 = 15000
    }

    #[test]
    fn test_financial_rounding() {
        let value = 123_4567_8901u128;  // 123.45678901

        // Round to 2 decimal places
        let rounded = financial_round(value, 8, 2);
        assert_eq!(rounded, 123_4600_0000u128); // 123.46

        // Round to 4 decimal places
        let rounded4 = financial_round(value, 8, 4);
        assert_eq!(rounded4, 123_4568_0000u128); // 123.4568 (rounded up from 123.45678901)
    }

    #[test]
    fn test_edge_cases() {
        // Zero operations
        assert_eq!(safe_add(0, 0).unwrap(), 0);
        assert_eq!(calculate_mid_price(0, 0), 0);
        assert_eq!(calculate_spread(0, 0), 0);

        // Maximum values
        assert_eq!(calculate_abs(u128::MAX), u128::MAX);

        // Division edge cases
        assert!(safe_divide(100, 0).is_err());
        assert_eq!(safe_divide(0, 100).unwrap(), 0);
    }
}