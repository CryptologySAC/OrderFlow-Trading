use rust_decimal::Decimal;

/// Normalize price to tick size with high precision
pub fn normalize_price_to_tick(price: Decimal, tick_size: Decimal) -> Decimal {
    if tick_size.is_zero() {
        return price;
    }

    // Calculate: round(price / tick_size) * tick_size
    let ticks = price / tick_size;
    let rounded_ticks = ticks.round();
    rounded_ticks * tick_size
}

/// Calculate spread with high precision
pub fn calculate_spread(ask: Decimal, bid: Decimal, _precision: u32) -> Decimal {
    if bid.is_zero() {
        return Decimal::ZERO;
    }
    ask - bid
}

/// Calculate mid price with high precision
pub fn calculate_mid_price(bid: Decimal, ask: Decimal, _precision: u32) -> Decimal {
    if bid.is_zero() || ask.is_zero() {
        return Decimal::ZERO;
    }
    (bid + ask) / Decimal::TWO
}

/// Safe division with zero check
pub fn safe_divide(numerator: Decimal, denominator: Decimal, default: Decimal) -> Decimal {
    if denominator.is_zero() {
        default
    } else {
        numerator / denominator
    }
}

/// Safe multiplication
pub fn safe_multiply(a: Decimal, b: Decimal) -> Decimal {
    a * b
}

/// Safe addition
pub fn safe_add(a: Decimal, b: Decimal) -> Decimal {
    a + b
}

/// Safe subtraction
pub fn safe_subtract(a: Decimal, b: Decimal) -> Decimal {
    a - b
}

/// Calculate percentage difference
pub fn calculate_percentage_change(old_value: Decimal, new_value: Decimal) -> Decimal {
    if old_value.is_zero() {
        return Decimal::ZERO;
    }
    ((new_value - old_value) / old_value) * Decimal::ONE_HUNDRED
}

/// Round to specified decimal places
pub fn round_to_decimals(value: Decimal, decimals: u32) -> Decimal {
    let multiplier = Decimal::from(10i64.pow(decimals as u32));
    (value * multiplier).round() / multiplier
}

/// Convert price to integer representation for precise calculations
pub fn price_to_int(price: Decimal, scale: u32) -> i64 {
    let scaled = price * Decimal::from(10i64.pow(scale as u32));
    scaled.mantissa() as i64
}

/// Convert integer back to price
pub fn int_to_price(price_int: i64, scale: u32) -> Decimal {
    Decimal::from(price_int) / Decimal::from(10i64.pow(scale as u32))
}

#[cfg(test)]
mod tests {
    use super::*;
use rust_decimal::Decimal;

    #[test]
    fn test_normalize_price_to_tick() {
        let price = Decimal::new(50000123, 5); // 500.00123
        let tick_size = Decimal::new(1, 3); // 0.001
        let normalized = normalize_price_to_tick(price, tick_size);
        assert_eq!(normalized, Decimal::new(500001, 3)); // 500.001
    }

    #[test]
    fn test_calculate_spread() {
        let ask = Decimal::new(50001, 2); // 500.01
        let bid = Decimal::new(50000, 2); // 500.00
        let spread = calculate_spread(ask, bid, 8);
        assert_eq!(spread, Decimal::new(1, 2)); // 0.01
    }

    #[test]
    fn test_calculate_mid_price() {
        let bid = Decimal::new(50000, 2); // 500.00
        let ask = Decimal::new(50002, 2); // 500.02
        let mid = calculate_mid_price(bid, ask, 8);
        assert_eq!(mid, Decimal::new(50001, 2)); // 500.01
    }

    #[test]
    fn test_safe_divide() {
        let result = safe_divide(Decimal::TEN, Decimal::TWO, Decimal::ZERO);
        assert_eq!(result, Decimal::new(5, 0));

        let zero_result = safe_divide(Decimal::TEN, Decimal::ZERO, Decimal::new(42, 0));
        assert_eq!(zero_result, Decimal::new(42, 0));
    }

    #[test]
    fn test_price_conversions() {
        let price = Decimal::new(50000123456, 8); // 500.00123456
        let price_int = price_to_int(price, 8);
        let converted_back = int_to_price(price_int, 8);
        assert_eq!(price, converted_back);
    }
}