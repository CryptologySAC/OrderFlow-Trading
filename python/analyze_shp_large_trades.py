import pandas as pd
import sqlite3
import numpy as np
from datetime import timedelta

# Define global constants
DB_PATH = '../trades.db'
SHP_PATH = 'swing_high_low_pairs_filtered_v1.1.csv'
WINDOW_SECONDS = 300  # 5 minutes before SHP

# Load SHP data
def load_shp_data():
    shp_df = pd.read_csv(SHP_PATH)
    shp_df['high_time'] = pd.to_datetime(shp_df['high_time'])
    return shp_df

# Load trade data
def load_trades():
    conn = sqlite3.connect(DB_PATH)
    trades = pd.read_sql_query("SELECT tradeTime, price, quantity, isBuyerMaker FROM aggregated_trades ORDER BY tradeTime ASC", conn)
    trades['tradeTime'] = pd.to_datetime(trades['tradeTime'], unit='ms')
    trades['usdt_value'] = trades['quantity'] * trades['price']
    conn.close()
    return trades

# Calculate the 99th percentile threshold for quantity
def calculate_quantity_threshold(trades):
    return np.percentile(trades['quantity'], 99)

# Analyze large trades before a single SHP
def analyze_shp(shp_row, trades, quantity_threshold):
    high_time = shp_row['high_time']
    start_time = high_time - timedelta(seconds=WINDOW_SECONDS)

    # Extract trades within the 300-second window
    window_trades = trades[(trades['tradeTime'] >= start_time) & (trades['tradeTime'] < high_time)]
    if window_trades.empty:
        return None

    # Identify large trades
    large_trades = window_trades[window_trades['quantity'] > quantity_threshold]
    if large_trades.empty:
        return None

    # Separate BUY and SELL large trades
    buy_lts = large_trades[large_trades['isBuyerMaker'] == 0]
    sell_lts = large_trades[large_trades['isBuyerMaker'] == 1]

    # Compute metrics for BUY large trades
    num_buy_lts = len(buy_lts)
    total_buy_quantity = buy_lts['quantity'].sum() if num_buy_lts > 0 else 0
    total_buy_usdt = buy_lts['usdt_value'].sum() if num_buy_lts > 0 else 0
    avg_buy_quantity = buy_lts['quantity'].mean() if num_buy_lts > 0 else 0
    avg_buy_usdt = buy_lts['usdt_value'].mean() if num_buy_lts > 0 else 0
    latest_buy_timing = (high_time - buy_lts['tradeTime'].max()).total_seconds() if num_buy_lts > 0 else None

    # Compute metrics for SELL large trades
    num_sell_lts = len(sell_lts)
    total_sell_quantity = sell_lts['quantity'].sum() if num_sell_lts > 0 else 0
    total_sell_usdt = sell_lts['usdt_value'].sum() if num_sell_lts > 0 else 0
    avg_sell_quantity = sell_lts['quantity'].mean() if num_sell_lts > 0 else 0
    avg_sell_usdt = sell_lts['usdt_value'].mean() if num_sell_lts > 0 else 0
    latest_sell_timing = (high_time - sell_lts['tradeTime'].max()).total_seconds() if num_sell_lts > 0 else None

    return {
        'high_time': high_time,
        'num_buy_lts': num_buy_lts,
        'num_sell_lts': num_sell_lts,
        'total_buy_quantity': total_buy_quantity,
        'total_sell_quantity': total_sell_quantity,
        'total_buy_usdt': total_buy_usdt,
        'total_sell_usdt': total_sell_usdt,
        'avg_buy_quantity': avg_buy_quantity,
        'avg_sell_quantity': avg_sell_quantity,
        'avg_buy_usdt': avg_buy_usdt,
        'avg_sell_usdt': avg_sell_usdt,
        'latest_buy_timing': latest_buy_timing,
        'latest_sell_timing': latest_sell_timing
    }

if __name__ == '__main__':
    # Load data
    trades = load_trades()
    shp_df = load_shp_data()

    # Calculate 99th percentile threshold for quantity
    quantity_threshold = calculate_quantity_threshold(trades)
    print(f"99th Percentile Quantity Threshold: {quantity_threshold}")

    # Analyze large trades before each SHP
    results = []
    for _, shp_row in shp_df.iterrows():
        result = analyze_shp(shp_row, trades, quantity_threshold)
        if result is not None:
            results.append(result)

    # Convert results to DataFrame
    results_df = pd.DataFrame(results)

    # Save to CSV
    results_df.to_csv('shp_large_trades_analysis.csv', index=False)
    print("Analysis saved to 'shp_large_trades_analysis.csv'.")

    # Compute and print summary statistics
    print("\nSummary Statistics:")
    print(f"Total SHPs with Large Trades: {len(results_df)}")
    print(f"Mean Number of BUY LTs: {results_df['num_buy_lts'].mean():.2f}")
    print(f"Mean Number of SELL LTs: {results_df['num_sell_lts'].mean():.2f}")
    print(f"Mean Total BUY Quantity: {results_df['total_buy_quantity'].mean():.2f}")
    print(f"Mean Total SELL Quantity: {results_df['total_sell_quantity'].mean():.2f}")
    print(f"Mean Total BUY USDT Value: {results_df['total_buy_usdt'].mean():.2f}")
    print(f"Mean Total SELL USDT Value: {results_df['total_sell_usdt'].mean():.2f}")
    print(f"Mean Average BUY Quantity per LT: {results_df['avg_buy_quantity'][results_df['num_buy_lts'] > 0].mean():.2f}")
    print(f"Mean Average SELL Quantity per LT: {results_df['avg_sell_quantity'][results_df['num_sell_lts'] > 0].mean():.2f}")
    print(f"Mean Average BUY USDT Value per LT: {results_df['avg_buy_usdt'][results_df['num_buy_lts'] > 0].mean():.2f}")
    print(f"Mean Average SELL USDT Value per LT: {results_df['avg_sell_usdt'][results_df['num_sell_lts'] > 0].mean():.2f}")
    print(f"Mean Latest BUY LT Timing (seconds before SHP): {results_df['latest_buy_timing'].mean():.2f}")
    print(f"Mean Latest SELL LT Timing (seconds before SHP): {results_df['latest_sell_timing'].mean():.2f}")