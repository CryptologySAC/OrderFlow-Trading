//! # Statistical Calculations
//!
//! High-performance statistical functions using u128 fixed-point arithmetic.

use crate::{FinancialResult, FinancialError};

/// Calculate mean of u128 values
///
/// # Examples
/// ```
/// use financial_math::calculate_mean;
///
/// let values = vec![100_000_000, 110_000_000, 90_000_000]; // 100, 110, 90
/// let mean = calculate_mean(&values).unwrap();
/// assert_eq!(mean, 100_000_000); // 100.000000
/// ```
pub fn calculate_mean(values: &[u128]) -> FinancialResult<u128> {
    if values.is_empty() {
        return Err(FinancialError::InvalidValue);
    }

    let sum: u128 = values.iter().sum();
    Ok(sum / values.len() as u128)
}

/// Calculate standard deviation using fixed-point arithmetic
///
/// # Examples
/// ```
/// use financial_math::calculate_std_dev;
///
/// let values = vec![100_000_000, 110_000_000, 90_000_000];
/// let std_dev = calculate_std_dev(&values).unwrap();
/// // Standard deviation of [100, 110, 90] is approximately 8.16496
/// ```
pub fn calculate_std_dev(values: &[u128]) -> FinancialResult<u128> {
    if values.len() < 2 {
        return Err(FinancialError::InvalidValue);
    }

    let mean = calculate_mean(values)?;
    let variance = calculate_variance(values, mean)?;
    integer_sqrt(variance)
}

/// Calculate variance of u128 values
///
/// # Examples
/// ```
/// use financial_math::calculate_variance;
///
/// let values = vec![100_000_000, 110_000_000, 90_000_000];
/// let mean = 100_000_000;
/// let variance = calculate_variance(&values, mean).unwrap();
/// ```
pub fn calculate_variance(values: &[u128], mean: u128) -> FinancialResult<u128> {
    if values.len() < 2 {
        return Err(FinancialError::InvalidValue);
    }

    let sum_squared_diff: u128 = values
        .iter()
        .map(|&x| {
            let diff = if x > mean { x - mean } else { mean - x };
            diff * diff
        })
        .sum();

    Ok(sum_squared_diff / (values.len() as u128 - 1))
}

/// Calculate percentile using fixed-point arithmetic
///
/// # Examples
/// ```
/// use financial_math::calculate_percentile;
///
/// let values = vec![90_000_000, 100_000_000, 110_000_000, 120_000_000];
/// let median = calculate_percentile(&values, 50).unwrap();
/// assert_eq!(median, 105_000_000); // 105.000000 (interpolated median)
/// ```
pub fn calculate_percentile(values: &[u128], percentile: u32) -> FinancialResult<u128> {
    if values.is_empty() || percentile > 100 {
        return Err(FinancialError::InvalidValue);
    }

    if values.len() == 1 {
        return Ok(values[0]);
    }

    let mut sorted_values = values.to_vec();
    sorted_values.sort_unstable();

    if percentile == 0 {
        return Ok(sorted_values[0]);
    }
    if percentile == 100 {
        return Ok(sorted_values[sorted_values.len() - 1]);
    }

    // Calculate position as floating point
    let position = (percentile as f64 * (sorted_values.len() as f64 - 1.0)) / 100.0;

    let lower_index = position as usize;
    let upper_index = lower_index + 1;

    if upper_index >= sorted_values.len() {
        return Ok(sorted_values[lower_index]);
    }

    let lower_value = sorted_values[lower_index];
    let upper_value = sorted_values[upper_index];

    // Linear interpolation
    let fraction = position - (lower_index as f64);
    let diff = upper_value - lower_value;
    let interpolated = lower_value + (diff as f64 * fraction) as u128;

    Ok(interpolated)
}

/// Calculate median (50th percentile)
///
/// # Examples
/// ```
/// use financial_math::calculate_median;
///
/// let values = vec![90_000_000, 100_000_000, 110_000_000];
/// let median = calculate_median(&values).unwrap();
/// assert_eq!(median, 100_000_000); // 100.000000
/// ```
pub fn calculate_median(values: &[u128]) -> FinancialResult<u128> {
    calculate_percentile(values, 50)
}

/// Calculate minimum value
///
/// # Examples
/// ```
/// use financial_math::calculate_min;
///
/// let values = vec![110_000_000, 90_000_000, 100_000_000];
/// let min = calculate_min(&values).unwrap();
/// assert_eq!(min, 90_000_000);
/// ```
pub fn calculate_min(values: &[u128]) -> FinancialResult<u128> {
    if values.is_empty() {
        return Err(FinancialError::InvalidValue);
    }
    Ok(*values.iter().min().unwrap())
}

/// Calculate maximum value
///
/// # Examples
/// ```
/// use financial_math::calculate_max;
///
/// let values = vec![90_000_000, 110_000_000, 100_000_000];
/// let max = calculate_max(&values).unwrap();
/// assert_eq!(max, 110_000_000);
/// ```
pub fn calculate_max(values: &[u128]) -> FinancialResult<u128> {
    if values.is_empty() {
        return Err(FinancialError::InvalidValue);
    }
    Ok(*values.iter().max().unwrap())
}

/// Integer square root approximation using Newton's method
/// This is needed for standard deviation calculation
fn integer_sqrt(n: u128) -> FinancialResult<u128> {
    if n == 0 || n == 1 {
        return Ok(n);
    }

    let mut x = n / 2;
    let mut y = (x + n / x) / 2;

    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }

    Ok(x)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_mean() {
        let values = vec![100_000_000, 110_000_000, 90_000_000];
        let mean = calculate_mean(&values).unwrap();
        assert_eq!(mean, 100_000_000); // (100 + 110 + 90) / 3 = 100

        // Empty array should fail
        assert!(calculate_mean(&[]).is_err());
    }

    #[test]
    fn test_calculate_median() {
        let values = vec![90_000_000, 100_000_000, 110_000_000];
        let median = calculate_median(&values).unwrap();
        assert_eq!(median, 100_000_000); // Middle value for odd count

        let values2 = vec![90_000_000, 100_000_000, 110_000_000, 120_000_000];
        let median2 = calculate_median(&values2).unwrap();
        assert_eq!(median2, 105_000_000); // (100 + 110) / 2 = 105
    }

    #[test]
    fn test_calculate_percentile() {
        let values = vec![90_000_000, 100_000_000, 110_000_000, 120_000_000];

        let p25 = calculate_percentile(&values, 25).unwrap();
        assert_eq!(p25, 97_500_000); // 25th percentile with interpolation

        let p75 = calculate_percentile(&values, 75).unwrap();
        assert_eq!(p75, 112_500_000); // 75th percentile with interpolation

        let p100 = calculate_percentile(&values, 100).unwrap();
        assert_eq!(p100, 120_000_000); // Maximum value
    }

    #[test]
    fn test_min_max() {
        let values = vec![110_000_000, 90_000_000, 100_000_000];

        let min = calculate_min(&values).unwrap();
        assert_eq!(min, 90_000_000);

        let max = calculate_max(&values).unwrap();
        assert_eq!(max, 110_000_000);

        // Empty array should fail
        assert!(calculate_min(&[]).is_err());
        assert!(calculate_max(&[]).is_err());
    }

    #[test]
    fn test_integer_sqrt() {
        // Test perfect squares
        assert_eq!(integer_sqrt(0).unwrap(), 0);
        assert_eq!(integer_sqrt(1).unwrap(), 1);
        assert_eq!(integer_sqrt(4).unwrap(), 2);
        assert_eq!(integer_sqrt(9).unwrap(), 3);
        assert_eq!(integer_sqrt(16).unwrap(), 4);

        // Test non-perfect squares (should round down)
        assert_eq!(integer_sqrt(2).unwrap(), 1);
        assert_eq!(integer_sqrt(10).unwrap(), 3);
        assert_eq!(integer_sqrt(15).unwrap(), 3);
    }
}