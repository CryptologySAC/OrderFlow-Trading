import sqlite3
import pandas as pd
from datetime import datetime, timedelta

# Configuration
DB_PATH = "../trades.db"
CSV_PATH = "swing_high_low_pairs_async_v1.1.csv"  # HP data with sequence condition
WINDOW_SECONDS = 120  # 2-minute window before each HP
LAST_N_TRADES = 10    # Last 10 trades for signal (approx. 10-20 seconds)
SELL_PROPORTION_THRESHOLD = 0.8  # Proportion of sell orders for signal
BUY_SELL_RATIO_THRESHOLD = 0.2   # Buy-to-sell volume ratio threshold
PRICE_TOLERANCE = 0.005          # Tolerance for support/resistance (±0.5%)

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

def analyze_last_trades(trades_df):
    """Analyze the last N trades for predictive signals."""
    if len(trades_df) < LAST_N_TRADES:
        return None
    
    last_trades = trades_df.tail(LAST_N_TRADES)
    
    # Sell Order Acceleration
    sell_trades = last_trades[last_trades['isBuyerMaker'] == 1]
    sell_proportion = len(sell_trades) / len(last_trades)
    has_sell_acceleration = sell_proportion >= SELL_PROPORTION_THRESHOLD
    
    # Volume Divergence
    buy_trades = last_trades[last_trades['isBuyerMaker'] == 0]
    buy_volume = buy_trades['usdt_volume'].sum()
    sell_volume = sell_trades['usdt_volume'].sum()
    buy_sell_ratio = buy_volume / sell_volume if sell_volume > 0 else float('inf')
    has_volume_divergence = buy_sell_ratio < BUY_SELL_RATIO_THRESHOLD
    
    # Price Momentum Slowdown
    first_price = last_trades.iloc[0]['price']
    last_price = last_trades.iloc[-1]['price']
    price_change_rate = (last_price - first_price) / first_price
    has_momentum_slowdown = price_change_rate <= 0
    
    return {
        'has_sell_acceleration': has_sell_acceleration,
        'has_volume_divergence': has_volume_divergence,
        'has_momentum_slowdown': has_momentum_slowdown
    }

def find_support_resistance(pairs_df, price, target_time, tolerance=PRICE_TOLERANCE):
    """Check if price is near historical support/resistance levels."""
    historical = pairs_df[pairs_df['high_time'] < target_time]
    historical_highs = historical['high_price']
    near_high = any(abs(price - h) / h <= tolerance for h in historical_highs)
    return near_high

def main():
    """Analyze order flow signals before HPs to identify predictive patterns."""
    try:
        conn = sqlite3.connect(DB_PATH)
        print("Connected to database successfully.")

        # Load pairs (HPs meeting sequence condition)
        pairs_df = load_pairs(CSV_PATH)
        hps = pairs_df[['high_time', 'high_price']].copy()
        print(f"Analyzing {len(hps)} HPs from swing_high_low_pairs_async_v1.1.csv.")

        # Analyze trades before each HP
        hp_metrics = []
        for idx, hp_row in hps.iterrows():
            hp_time = hp_row['high_time']
            hp_price = hp_row['high_price']
            
            # Fetch trades in the 2-minute window before the HP
            trades_before_hp = fetch_trades_before_timestamp(conn, hp_time, WINDOW_SECONDS)
            metrics = analyze_last_trades(trades_before_hp)
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
        for _, hp_row in hps.iterrows():
            hp_time = hp_row['high_time']
            non_hp_time = hp_time - timedelta(minutes=5)  # Offset by 5 minutes
            trades_before_non_hp = fetch_trades_before_timestamp(conn, non_hp_time, WINDOW_SECONDS)
            metrics = analyze_last_trades(trades_before_non_hp)
            if metrics:
                metrics['hp_time'] = non_hp_time
                metrics['hp_price'] = trades_before_non_hp['price'].max() if not trades_before_non_hp.empty else 0
                metrics['near_support_resistance'] = find_support_resistance(
                    pairs_df, metrics['hp_price'], non_hp_time, PRICE_TOLERANCE
                )
                non_hp_metrics.append(metrics)

        non_hp_metrics_df = pd.DataFrame(non_hp_metrics)

        # Compare metrics
        print("\n=== Order Flow Signal Analysis (Last 10 Trades in 2-Minute Window) ===")
        # Sell Order Acceleration
        hp_sell_acceleration_freq = hp_metrics_df['has_sell_acceleration'].mean()
        non_hp_sell_acceleration_freq = non_hp_metrics_df['has_sell_acceleration'].mean()
        print(f"Sell Order Acceleration Frequency (>{SELL_PROPORTION_THRESHOLD*100}% sells):")
        print(f"  Before HPs: {hp_sell_acceleration_freq:.2%}")
        print(f"  Before Non-HPs: {non_hp_sell_acceleration_freq:.2%}")

        # Volume Divergence
        hp_volume_divergence_freq = hp_metrics_df['has_volume_divergence'].mean()
        non_hp_volume_divergence_freq = non_hp_metrics_df['has_volume_divergence'].mean()
        print(f"Volume Divergence Frequency (Buy/Sell Ratio < {BUY_SELL_RATIO_THRESHOLD}):")
        print(f"  Before HPs: {hp_volume_divergence_freq:.2%}")
        print(f"  Before Non-HPs: {non_hp_volume_divergence_freq:.2%}")

        # Price Momentum Slowdown
        hp_momentum_slowdown_freq = hp_metrics_df['has_momentum_slowdown'].mean()
        non_hp_momentum_slowdown_freq = non_hp_metrics_df['has_momentum_slowdown'].mean()
        print(f"Price Momentum Slowdown Frequency (Price Change ≤ 0):")
        print(f"  Before HPs: {hp_momentum_slowdown_freq:.2%}")
        print(f"  Before Non-HPs: {non_hp_momentum_slowdown_freq:.2%}")

        # Support/Resistance
        hp_near_sr = hp_metrics_df['near_support_resistance'].mean()
        non_hp_near_sr = non_hp_metrics_df['near_support_resistance'].mean()
        print(f"Near Support/Resistance (±{PRICE_TOLERANCE*100}%):")
        print(f"  Before HPs: {hp_near_sr:.2%}")
        print(f"  Before Non-HPs: {non_hp_near_sr:.2%}")

    except Exception as e:
        print(f"Error during order flow signal analysis: {e}")
    finally:
        conn.close()
        print("\nDatabase connection closed.")

if __name__ == "__main__":
    main()