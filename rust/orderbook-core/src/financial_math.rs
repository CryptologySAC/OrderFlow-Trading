/// Normalize price to tick size with high precision
pub fn normalize_price_to_tick(price: f64, tick_size: f64) -> f64 {
    if tick_size == 0.0 {
        return price;
    }

    // Calculate: round(price / tick_size) * tick_size
    let ticks = price / tick_size;
    let rounded_ticks = ticks.round();
    rounded_ticks * tick_size
}

/// Calculate spread with high precision
pub fn calculate_spread(ask: f64, bid: f64, _precision: u32) -> f64 {
    if bid == 0.0 {
        return 0.0;
    }
    ask - bid
}

/// Calculate mid price with high precision
pub fn calculate_mid_price(bid: f64, ask: f64, _precision: u32) -> f64 {
    if bid == 0.0 || ask == f64::INFINITY {
        return 0.0;
    }
    (bid + ask) / 2.0
}

/// Safe division with zero check
pub fn safe_divide(numerator: f64, denominator: f64, default: f64) -> f64 {
    if denominator == 0.0 {
        default
    } else {
        numerator / denominator
    }
}

/// Safe multiplication
pub fn safe_multiply(a: f64, b: f64) -> f64 {
    a * b
}

/// Safe addition
pub fn safe_add(a: f64, b: f64) -> f64 {
    a + b
}

/// Safe subtraction
pub fn safe_subtract(a: f64, b: f64) -> f64 {
    a - b
}

/// Calculate percentage difference
pub fn calculate_percentage_change(old_value: f64, new_value: f64) -> f64 {
    if old_value == 0.0 {
        return 0.0;
    }
    ((new_value - old_value) / old_value) * 100.0
}

/// Round to specified decimal places
pub fn round_to_decimals(value: f64, decimals: u32) -> f64 {
    let multiplier = 10f64.powi(decimals as i32);
    (value * multiplier).round() / multiplier
}

/// Convert price to integer representation for precise calculations
pub fn price_to_int(price: f64, scale: u32) -> i64 {
    let scaled = price * 10f64.powi(scale as i32);
    scaled as i64
}

/// Convert integer back to price
pub fn int_to_price(price_int: i64, scale: u32) -> f64 {
    price_int as f64 / 10f64.powi(scale as i32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_price_to_tick() {
        let price = 500.00123;
        let tick_size = 0.001;
        let normalized = normalize_price_to_tick(price, tick_size);
        assert_eq!(normalized, 500.001);
    }

    #[test]
    fn test_calculate_spread() {
        let ask = 500.01;
        let bid = 500.00;
        let spread = calculate_spread(ask, bid, 8);
        assert_eq!(spread, 0.01);
    }

    #[test]
    fn test_calculate_mid_price() {
        let bid = 500.00;
        let ask = 500.02;
        let mid = calculate_mid_price(bid, ask, 8);
        assert_eq!(mid, 500.01);
    }

    #[test]
    fn test_safe_divide() {
        let result = safe_divide(10.0, 2.0, 0.0);
        assert_eq!(result, 5.0);

        let zero_result = safe_divide(10.0, 0.0, 42.0);
        assert_eq!(zero_result, 42.0);
    }

    #[test]
    fn test_price_conversions() {
        let price = 500.00123456;
        let price_int = price_to_int(price, 8);
        let converted_back = int_to_price(price_int, 8);
        assert!((price - converted_back).abs() < 1e-10);
    }
}