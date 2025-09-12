//! # Financial Math Library
//!
//! High-performance financial mathematics using u128 fixed-point arithmetic.
//! This library provides precise financial calculations without the overhead
//! of arbitrary precision libraries like Decimal.js.
//!
//! ## Key Features
//!
//! - **u128 fixed-point arithmetic** for maximum performance
//! - **Zero heap allocations** for core operations
//! - **Perfect precision** for financial calculations
//! - **Overflow protection** with checked operations
//! - **Native CPU operations** - no software arithmetic
//!
//! ## Fixed-Point Representation
//!
//! Prices and quantities are stored as u128 integers with implicit decimal places:
//!
//! ```rust
//! // Price 123.45678900 (8 decimal places)
//! // Stored as: 12345678900u128
//! const PRICE_SCALE: u32 = 8;
//! let price = 123_4567_8900u128; // 123.45678900
//! ```

pub mod conversions;
pub mod arithmetic;
pub mod division;
pub mod validation;
pub mod statistics;
pub mod zones;
pub mod big_arithmetic;

pub use conversions::*;
pub use arithmetic::*;
pub use division::*;
pub use validation::*;
pub use statistics::*;
pub use zones::*;
pub use big_arithmetic::*;

/// Core error type for financial operations
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FinancialError {
    /// Arithmetic overflow occurred
    Overflow,
    /// Division by zero attempted
    DivisionByZero,
    /// Invalid scale for operation
    InvalidScale,
    /// Value is negative (when unsigned type required)
    NegativeValue,
    /// Invalid price or quantity value
    InvalidValue,
}

impl std::fmt::Display for FinancialError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FinancialError::Overflow => write!(f, "Arithmetic overflow"),
            FinancialError::DivisionByZero => write!(f, "Division by zero"),
            FinancialError::InvalidScale => write!(f, "Invalid scale"),
            FinancialError::NegativeValue => write!(f, "Negative value"),
            FinancialError::InvalidValue => write!(f, "Invalid value"),
        }
    }
}

impl std::error::Error for FinancialError {}

/// Result type alias for financial operations
pub type FinancialResult<T> = Result<T, FinancialError>;

/// Fixed-point scales for different financial instruments
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scale {
    /// Price scale (typically 8 decimal places)
    Price(u32),
    /// Quantity scale (typically 8 decimal places)
    Quantity(u32),
    /// Percentage scale (typically 4 decimal places)
    Percentage(u32),
    /// Custom scale
    Custom(u32),
}

impl Scale {
    /// Get the scale value
    pub const fn value(self) -> u32 {
        match self {
            Scale::Price(s) | Scale::Quantity(s) | Scale::Percentage(s) | Scale::Custom(s) => s,
        }
    }

    /// Get the multiplier for this scale (10^scale)
    pub const fn multiplier(self) -> u128 {
        match self {
            Scale::Price(s) => 10u128.pow(s),
            Scale::Quantity(s) => 10u128.pow(s),
            Scale::Percentage(s) => 10u128.pow(s),
            Scale::Custom(s) => 10u128.pow(s),
        }
    }
}

/// Default scales for common financial operations
pub const PRICE_SCALE: Scale = Scale::Price(8);
pub const QUANTITY_SCALE: Scale = Scale::Quantity(8);
pub const PERCENTAGE_SCALE: Scale = Scale::Percentage(4);

/// Core financial value type with fixed-point representation
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct FinancialValue {
    /// The fixed-point value
    pub value: u128,
    /// The number of decimal places
    pub scale: u32,
}

impl FinancialValue {
    /// Create a new financial value
    pub const fn new(value: u128, scale: u32) -> Self {
        Self { value, scale }
    }

    /// Create from a price with default scale
    pub const fn from_price(value: u128) -> Self {
        Self::new(value, PRICE_SCALE.value())
    }

    /// Create from a quantity with default scale
    pub const fn from_quantity(value: u128) -> Self {
        Self::new(value, QUANTITY_SCALE.value())
    }

    /// Get the multiplier for this value's scale
    pub const fn multiplier(&self) -> u128 {
        10u128.pow(self.scale)
    }

    /// Convert to different scale
    pub fn to_scale(&self, new_scale: u32) -> FinancialResult<Self> {
        if new_scale == self.scale {
            return Ok(*self);
        }

        let result = if new_scale > self.scale {
            // Scale up (multiply by 10^(new_scale - current_scale))
            let multiplier = 10u128.pow(new_scale - self.scale);
            self.value.checked_mul(multiplier)
                .ok_or(FinancialError::Overflow)?
        } else {
            // Scale down (divide by 10^(current_scale - new_scale))
            let divisor = 10u128.pow(self.scale - new_scale);
            self.value / divisor
        };

        Ok(Self::new(result, new_scale))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_financial_value_creation() {
        let price = FinancialValue::from_price(123_4567_8900); // 123.45678900
        assert_eq!(price.value, 123_4567_8900u128);
        assert_eq!(price.scale, 8);
        assert_eq!(price.multiplier(), 100_000_000u128);
    }

    #[test]
    fn test_scale_conversion() {
        let value = FinancialValue::new(123_4567_8900, 8); // 123.45678900

        // Scale up to 10 decimal places
        let scaled_up = value.to_scale(10).unwrap();
        assert_eq!(scaled_up.value, 123_4567_8900_00u128);
        assert_eq!(scaled_up.scale, 10);

        // Scale down to 6 decimal places
        let scaled_down = value.to_scale(6).unwrap();
        assert_eq!(scaled_down.value, 123_4567_89u128); // 123.45678900 -> 123.456789 (6 decimals)
        assert_eq!(scaled_down.scale, 6);
    }
}