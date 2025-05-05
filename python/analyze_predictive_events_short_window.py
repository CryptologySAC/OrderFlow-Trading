import sqlite3
import pandas as pd
from datetime import datetime, timedelta

# Configuration
DB_PATH = "../trades.db"
CSV_PATH = "swing_high_low_pairs_v10.0.csv"  # 2% threshold data
WINDOW_SECONDS = 30  # Window to analyze before each HP (30 seconds)
VOLUME_THRESHOLD = 5.0  # Volume spike threshold (e.g., 5× average)
SELL_PROPORTION_THRESHOLD = 0.8  # Proportion of sell orders for spike
PRICE_TOLERANCE = 0.005  # Tolerance for support/resistance (±0.5%)

def convert_to_timestamp(dt):
    """Convert datetime to timestamp in milliseconds."""
    return int(dt.timestamp() * 1000)

def load_pairs(csv_path):
    """Load HP-LP pairs from CSV."""
    df = pd.read_csv(csv_path)
    df['high_time'] = pd.to_datetime(df['high_time'])
    df['low_time'] = pd.to_datetime(df['low_time'])
    return df

def fetch_trades_before_timestamp(conn, target_time, window_seconds):
    """Fetch trades in the window before a timestamp."""
    end_time = convert_to_timestamp(target_time)
    start_time = convert_to_timestamp(target_time - timedelta(seconds=window_seconds))
    
    query = """
        SELECT tradeTime, price, quantity, isBuyerMaker
        FROM aggregated_trades
        WHERE tradeTime BETWEEN ? AND ?
        ORDER BY tradeTime
    """
    df = pd.read_sql_query(query, conn, params=(start_time, end_time))
    df['tradeTime'] = pd.to_datetime(df['tradeTime'], unit='ms')
    df['usdt_volume'] = df['quantity'] * df['price']
    return df

def analyze_window(trades_df, avg_usdt_volume):
    """Analyze trade data in the window for predictive events."""
    if trades_df.empty:
        return None
    
    # Volume Spike
    has_volume_spike = (trades_df['usdt_volume'] > (avg_usdt_volume * VOLUME_THRESHOLD)).any()
    spike_time = trades_df[trades_df['usdt_volume'] > (avg_usdt_volume * VOLUME_THRESHOLD)]['tradeTime'].max() if has_volume_spike else None
    
    # Sell Order Spike
    sell_trades = trades_df[trades_df['isBuyerMaker'] == 1]
    sell_proportion = len(sell_trades) / len(trades_df) if len(trades_df) > 0 else 0
    has_sell_spike = sell_proportion >= SELL_PROPORTION_THRESHOLD
    
    # Price Rejection (peak followed by drop)
    if len(trades_df) > 1:
        max_price_idx = trades_df['price'].idxmax()
        last_price = trades_df.iloc[-1]['price']
        max_price = trades_df.iloc[max_price_idx]['price']
        has_price_rejection = last_price < max_price and (max_price - last_price) / max_price > 0.001  # Small drop
    else:
        has_price_rejection = False
    
    return {
        'has_volume_spike': has_volume_spike,
        'spike_time': spike_time,
        'has_sell_spike': has_sell_spike,
        'has_price_rejection': has_price_rejection
    }

def find_support_resistance(pairs_df, price, target_time, tolerance=PRICE_TOLERANCE):
    """Check if price is near historical support/resistance levels."""
    historical = pairs_df[pairs_df['high_time'] < target_time]
    historical_highs = historical['high_price']
    historical_lows = historical['low_price']
    near_high = any(abs(price - h) / h <= tolerance for h in historical_highs)
    near_low = any(abs(price - l) / l <= tolerance for l in historical_lows)
    return near_high or near_low

def main():
    """Analyze trade data in the last 30 seconds before true HPs to identify predictive events."""
    try:
        conn = sqlite3.connect(DB_PATH)
        print("Connected to database successfully.")

        # Load pairs (2% threshold data)
        pairs_df = load_pairs(CSV_PATH)
        true_hps = pairs_df[['high_time', 'high_price']].copy()
        print(f"Analyzing {len(true_hps)} HPs from 2% threshold data.")

        # Calculate average USDT volume for volume spike detection
        query = "SELECT quantity, price FROM aggregated_trades"
        trades_df = pd.read_sql_query(query, conn)
        trades_df['usdt_volume'] = trades_df['quantity'] * trades_df['price']
        avg_usdt_volume = trades_df['usdt_volume'].mean()
        print(f"Average USDT volume per trade: {avg_usdt_volume:.2f}")

        # Analyze trades before each true HP
        hp_metrics = []
        for idx, hp_row in true_hps.iterrows():
            hp_time = hp_row['high_time']
            hp_price = hp_row['high_price']
            
            # Fetch trades in the last 30 seconds before the HP
            trades_before_hp = fetch_trades_before_timestamp(conn, hp_time, WINDOW_SECONDS)
            metrics = analyze_window(trades_before_hp, avg_usdt_volume)
            if metrics:
                metrics['hp_time'] = hp_time
                metrics['hp_price'] = hp_price
                # Check for support/resistance
                metrics['near_support_resistance'] = find_support_resistance(
                    pairs_df, hp_price, hp_time, PRICE_TOLERANCE
                )
                hp_metrics.append(metrics)

        # Convert metrics to DataFrame
        hp_metrics_df = pd.DataFrame(hp_metrics)

        # Analyze non-HPs for comparison (random timestamps offset by 5 minutes)
        non_hp_metrics = []
        for _, hp_row in true_hps.iterrows():
            hp_time = hp_row['high_time']
            non_hp_time = hp_time - timedelta(minutes=5)  # Offset by 5 minutes
            trades_before_non_hp = fetch_trades_before_timestamp(conn, non_hp_time, WINDOW_SECONDS)
            metrics = analyze_window(trades_before_non_hp, avg_usdt_volume)
            if metrics:
                metrics['hp_time'] = non_hp_time
                metrics['hp_price'] = trades_before_non_hp['price'].max() if not trades_before_non_hp.empty else 0
                metrics['near_support_resistance'] = find_support_resistance(
                    pairs_df, metrics['hp_price'], non_hp_time, PRICE_TOLERANCE
                )
                non_hp_metrics.append(metrics)

        non_hp_metrics_df = pd.DataFrame(non_hp_metrics)

        # Compare metrics
        print("\n=== Predictive Event Analysis (Last 30 Seconds) ===")
        # Volume Spike
        hp_volume_spike_freq = hp_metrics_df['has_volume_spike'].mean()
        non_hp_volume_spike_freq = non_hp_metrics_df['has_volume_spike'].mean()
        print(f"Volume Spike Frequency (>{VOLUME_THRESHOLD}× avg):")
        print(f"  Before HPs: {hp_volume_spike_freq:.2%}")
        print(f"  Before Non-HPs: {non_hp_volume_spike_freq:.2%}")

        # Sell Order Spike
        hp_sell_spike_freq = hp_metrics_df['has_sell_spike'].mean()
        non_hp_sell_spike_freq = non_hp_metrics_df['has_sell_spike'].mean()
        print(f"Sell Order Spike Frequency (>{SELL_PROPORTION_THRESHOLD*100}% sells):")
        print(f"  Before HPs: {hp_sell_spike_freq:.2%}")
        print(f"  Before Non-HPs: {non_hp_sell_spike_freq:.2%}")

        # Price Rejection
        hp_rejection_freq = hp_metrics_df['has_price_rejection'].mean()
        non_hp_rejection_freq = non_hp_metrics_df['has_price_rejection'].mean()
        print(f"Price Rejection Frequency:")
        print(f"  Before HPs: {hp_rejection_freq:.2%}")
        print(f"  Before Non-HPs: {non_hp_rejection_freq:.2%}")

        # Support/Resistance
        hp_near_sr = hp_metrics_df['near_support_resistance'].mean()
        non_hp_near_sr = non_hp_metrics_df['near_support_resistance'].mean()
        print(f"Near Support/Resistance (±{PRICE_TOLERANCE*100}%):")
        print(f"  Before HPs: {hp_near_sr:.2%}")
        print(f"  Before Non-HPs: {non_hp_near_sr:.2%}")

    except Exception as e:
        print(f"Error during predictive event analysis: {e}")
    finally:
        conn.close()
        print("\nDatabase connection closed.")

if __name__ == "__main__":
    main()