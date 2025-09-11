// Type declarations for Financial Math native module
interface FinancialMathBindings {
    // Conversions
    price_to_int(price: number): string;
    int_to_price(value: string): number;
    quantity_to_int(quantity: number): string;
    int_to_quantity(value: string): number;
    percentage_to_int(percentage: number): string;
    int_to_percentage(value: string): number;

    // Arithmetic
    safe_add(a: string, b: string): string;
    safe_subtract(a: string, b: string): string;
    safe_multiply(a: string, b: string): string;
    safe_divide(a: string, b: string): string;
    calculate_mid_price(bid: string, ask: string): string;
    calculate_spread(bid: string, ask: string): string;

    // Statistics
    calculate_mean(values: string[]): string;
    calculate_median(values: string[]): string;
    calculate_min(values: string[]): string;
    calculate_max(values: string[]): string;

    // Zones
    normalize_price_to_tick(price: string, tick_size: string): string;
    is_price_in_zone(
        price: string,
        zone_low: string,
        zone_high: string
    ): boolean;

    // Utility
    get_price_scale(): number;
    get_quantity_scale(): number;
}

declare const bindings: FinancialMathBindings;
export default bindings;
