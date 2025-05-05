import pandas as pd
import sqlite3
import matplotlib.pyplot as plt
import numpy as np
from datetime import datetime

# Configuration
DB_PATH = "../trades.db"
START_DATE = "2025-01-27"
END_DATE = "2025-05-01"
THRESHOLD = 0.01  # 1% price drop for pairs

def load_data(db_path, start_date, end_date):
    """Load trade data from SQLite database within the specified date range."""
    try:
        conn = sqlite3.connect(db_path)
        start_ts = int(datetime.strptime(start_date, "%Y-%m-%d").timestamp() * 1000)
        end_ts = int(datetime.strptime(end_date, "%Y-%m-%d").timestamp() * 1000)
        query = """
            SELECT tradeTime, price 
            FROM aggregated_trades 
            WHERE tradeTime BETWEEN ? AND ? 
            ORDER BY tradeTime
        """
        df = pd.read_sql_query(query, conn, params=(start_ts, end_ts))
        conn.close()
        if df.empty:
            raise ValueError("No data found in the specified date range.")
        df['tradeTime'] = pd.to_datetime(df['tradeTime'], unit='ms')
        print(f"Loaded {len(df)} trades from {df['tradeTime'].min()} to {df['tradeTime'].max()}")
        return df
    except Exception as e:
        print(f"Error loading data: {e}")
        return None

def find_swing_points(prices, times, threshold=0.01):
    """Detect swing highs and lows sequentially as if processing a live stream."""
    swings = []
    i = 0
    last_type = None
    last_price = prices[0]
    last_idx = 0
    current_high_price = prices[0]
    current_high_idx = 0
    current_low_price = prices[0]
    current_low_idx = 0

    while i < len(prices):
        current_price = prices[i]

        if last_type is None or last_type == 'low':
            # Track the highest price since the last swing low
            if current_price >= current_high_price:
                current_high_price = current_price
                current_high_idx = i
            # Check for a reversal (drop from the current high)
            price_drop = (current_high_price - current_price) / current_high_price
            if price_drop > 0:
                # Confirm the high
                if not swings or current_high_price >= last_price * (1 + threshold):
                    swings.append((current_high_idx, 'high', times[current_high_idx], current_high_price))
                    last_type = 'high'
                    last_price = current_high_price
                    last_idx = current_high_idx
                # Reset for finding the next low
                current_low_price = current_price
                current_low_idx = i
                i += 1
            else:
                i += 1
        else:  # last_type == 'high'
            # Track the lowest price since the last swing high
            if current_price <= current_low_price:
                current_low_price = current_price
                current_low_idx = i
            # Check for a reversal (rise from the current low)
            price_rise = (current_price - current_low_price) / current_low_price
            if price_rise > 0:
                # Confirm the low
                price_drop_from_high = (last_price - current_low_price) / last_price
                if price_drop_from_high >= threshold:
                    swings.append((current_low_idx, 'low', times[current_low_idx], current_low_price))
                    last_type = 'low'
                    last_price = current_low_price
                    last_idx = current_low_idx
                # Reset for finding the next high
                current_high_price = current_price
                current_high_idx = i
                i += 1
            else:
                i += 1

    return swings

def pair_swings(swing_points, threshold, data):
    """Pair swing highs with subsequent lows and filter by threshold."""
    pairs = []
    for i in range(len(swing_points) - 1):
        if swing_points[i][1] == 'high' and swing_points[i+1][1] == 'low':
            high_idx, _, high_time, high_price = swing_points[i]
            low_idx, _, low_time, low_price = swing_points[i+1]
            price_drop = (high_price - low_price) / high_price
            if price_drop >= threshold:
                pairs.append({
                    'high_time': high_time,
                    'high_price': high_price,
                    'low_time': low_time,
                    'low_price': low_price,
                    'price_drop_percent': price_drop * 100
                })
    print(f"Formed {len(pairs)} valid swing high-low pairs.")
    return pd.DataFrame(pairs)

def main():
    # Load data
    data = load_data(DB_PATH, START_DATE, END_DATE)
    if data is None or len(data) < 2:
        print("Insufficient data to analyze.")
        return

    # Detect swings sequentially
    prices = data['price'].values
    times = data['tradeTime'].values
    swing_points = find_swing_points(prices, times, THRESHOLD)
    if not swing_points:
        print("No swing points detected.")
        return

    # Debug: Verify swing points
    high_count = sum(1 for _, t, _, _ in swing_points if t == 'high')
    low_count = sum(1 for _, t, _, _ in swing_points if t == 'low')
    print(f"Detected {len(swing_points)} swing points: {high_count} highs, {low_count} lows")

    # Pair swings
    pairs_df = pair_swings(swing_points, THRESHOLD, data)
    if pairs_df.empty:
        print("No valid swing pairs found.")
        return

    # Save to CSV
    pairs_df.to_csv("swing_high_low_pairs_v1.9.csv", index=False)
    print("Results saved to 'swing_high_low_pairs_v1.9.csv'.")

    # Statistics
    print(f"Number of pairs: {len(pairs_df)}")
    print(f"Maximum drop: {pairs_df['price_drop_percent'].max()/100:.2%}")
    print(f"Average drop: {pairs_df['price_drop_percent'].mean()/100:.2%}")

    # Visualization
    plt.figure(figsize=(12, 6))
    plt.hist(pairs_df['high_time'], bins=50, color='blue', alpha=0.7)
    plt.title("Distribution of Swing High-Low Pairs Over Time (Jan 27 - May 1, 2025)")
    plt.xlabel("Time")
    plt.ylabel("Frequency")
    plt.grid(True)
    plt.savefig("swing_pairs_distribution_v1.9.png")
    plt.close()
    print("Distribution plot saved to 'swing_pairs_distribution_v1.9.png'.")

if __name__ == "__main__":
    main()