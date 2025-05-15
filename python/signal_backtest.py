import pandas as pd
import sqlite3
import torch
import numpy as np
from collections import deque
from multiprocessing import Pool, cpu_count
import logging
import os
from datetime import datetime

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Check for MPS availability
device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
logging.info(f"Using device: {device}")

# Configuration
DB_PATH = "trades.db"
CSV_FILES = {
    "A": "shp_category_A.csv",
    "B": "shp_category_B.csv",
    "C": "shp_category_C.csv"
}
SIGNAL_WINDOW = 60 * 1000  # 60 seconds in milliseconds
BUY_VOLUME_RATIO_THRESHOLD = 0.45
LARGE_SELL_TRADES_THRESHOLD = 5
TRADE_FREQUENCY_THRESHOLD = 50
LARGE_TRADE_PERCENTILE = 0.9
QUANTITY_WINDOW_SIZE = 10000  # For computing 90th percentile
CHUNK_SIZE = 100000  # Trades per multiprocessing chunk

def load_shp_data():
    """Load SHP timestamps and trade IDs from CSV files."""
    shp_data = {}
    for cat, path in CSV_FILES.items():
        if not os.path.exists(path):
            logging.error(f"CSV file {path} not found")
            return None
        df = pd.read_csv(path)
        shp_data[cat] = df[['entry_tradeTime', 'entry_aggregatedTradeId']].copy()
        shp_data[cat]['category'] = cat
    # Combine all SHPs
    all_shps = pd.concat(shp_data.values(), ignore_index=True)
    all_shps.sort_values('entry_tradeTime', inplace=True)
    return all_shps

def query_trades(start_time, end_time, conn):
    """Query trades within a time range."""
    query = """
    SELECT aggregatedTradeId, tradeTime, price, quantity, isBuyerMaker
    FROM aggregated_trades
    ORDER BY tradeTime
    """
    df = pd.read_sql_query(query, conn)
    return df

def compute_signal(trades, quantities, shp_times, current_time):
    """Compute signal conditions for the current trade."""
    # Filter trades in the last 60 seconds
    window_trades = trades[trades['tradeTime'] >= current_time - SIGNAL_WINDOW]
    if len(window_trades) <= TRADE_FREQUENCY_THRESHOLD:
        return False, None

    # Last 30 seconds for buy volume ratio and large sell trades
    last_30s_trades = window_trades[window_trades['tradeTime'] >= current_time - 30 * 1000]
    if last_30s_trades.empty:
        return False, None

    # Buy volume ratio
    buy_volume = last_30s_trades[last_30s_trades['isBuyerMaker'] == 0]['quantity'].sum()
    total_volume = last_30s_trades['quantity'].sum()
    buy_volume_ratio = buy_volume / total_volume if total_volume > 0 else 0.5

    # Large sell trades
    quantity_threshold = torch.quantile(quantities, LARGE_TRADE_PERCENTILE).item() if len(quantities) > 0 else 0
    large_sell_trades = (last_30s_trades[last_30s_trades['isBuyerMaker'] == 1]['quantity'] > quantity_threshold).sum()

    # Signal condition
    if (buy_volume_ratio < BUY_VOLUME_RATIO_THRESHOLD and
        large_sell_trades >= LARGE_SELL_TRADES_THRESHOLD and
        len(window_trades) > TRADE_FREQUENCY_THRESHOLD):
        return True, window_trades
    return False, None

def process_chunk(chunk_args):
    """Process a chunk of trades for signal detection."""
    start_idx, end_idx, trades, shps, chunk_start_time, chunk_end_time = chunk_args
    results = []
    quantities = deque(maxlen=QUANTITY_WINDOW_SIZE)

    # Convert quantities to PyTorch tensor
    for qty in trades['quantity'].values[:min(QUANTITY_WINDOW_SIZE, len(trades))]:
        quantities.append(torch.tensor(qty, dtype=torch.float32, device=device))

    for idx in range(start_idx, end_idx):
        trade = trades.iloc[idx]
        current_time = trade['tradeTime']

        # Update quantity window
        quantities.append(torch.tensor(trade['quantity'], dtype=torch.float32, device=device))

        # Compute signal
        try:
            signal_triggered, window_trades = compute_signal(trades.iloc[:idx+1],
                                                            torch.tensor(list(quantities), device=device),
                                                            shps['entry_tradeTime'].values,
                                                            current_time)
        except Exception as e:
            logging.warning(f"Error computing signal at trade {current_time}: {e}")
            continue

        if signal_triggered:
            # Check for SHP within 60 seconds
            future_shps = shps[(shps['entry_tradeTime'] > current_time) &
                               (shps['entry_tradeTime'] <= current_time + SIGNAL_WINDOW)]
            if not future_shps.empty:
                # True positive: Take the earliest SHP
                shp = future_shps.iloc[0]
                results.append({
                    'tradeTime': current_time,
                    'is_true_positive': 1,
                    'aggregatedTradeId': shp['entry_aggregatedTradeId'],
                    'shp_time': shp['entry_tradeTime'],
                    'category': shp['category']
                })
            else:
                # False positive
                results.append({
                    'tradeTime': current_time,
                    'is_true_positive': 0,
                    'aggregatedTradeId': None,
                    'shp_time': None,
                    'category': None
                })

    return results

def main():
    # Load SHP data
    shps = load_shp_data()
    if shps is None:
        return

    # Connect to database
    conn = sqlite3.connect(DB_PATH)

    # Determine trade time range
    min_time = shps['entry_tradeTime'].min() - SIGNAL_WINDOW
    max_time = shps['entry_tradeTime'].max() + SIGNAL_WINDOW

    # Load all trades in the range
    logging.info(f"Loading trades from {min_time} to {max_time}")
    trades = query_trades(min_time, max_time, conn)
    conn.close()

    if trades.empty:
        logging.error("No trades found in the specified time range")
        return

    # Ensure isBuyerMaker is integer
    trades['isBuyerMaker'] = trades['isBuyerMaker'].astype(int)

    # Prepare chunks for multiprocessing
    num_trades = len(trades)
    chunk_size = min(CHUNK_SIZE, num_trades // cpu_count() + 1)
    tasks = []
    for i in range(0, num_trades, chunk_size):
        tasks.append((i, min(i + chunk_size, num_trades), trades, shps,
                      trades['tradeTime'].iloc[i],
                      trades['tradeTime'].iloc[min(i + chunk_size - 1, num_trades - 1)]))

    # Process chunks in parallel
    logging.info(f"Processing {num_trades} trades in {len(tasks)} chunks with {cpu_count()} workers")
    with Pool(processes=cpu_count()) as pool:
        chunk_results = pool.map(process_chunk, tasks)

    # Combine results
    results = []
    for chunk_result in chunk_results:
        results.extend(chunk_result)

    if not results:
        logging.error("No signals triggered during backtest")
        return

    # Save results to CSV
    df_results = pd.DataFrame(results)
    output_path = "signal_backtest_results.csv"
    df_results.to_csv(output_path, index=False)
    logging.info(f"Backtest results saved to {output_path}")

    # Summary statistics
    true_positives = df_results[df_results['is_true_positive'] == 1]
    false_positives = df_results[df_results['is_true_positive'] == 0]
    logging.info(f"Total signals: {len(df_results)}")
    logging.info(f"True positives: {len(true_positives)} ({len(true_positives)/len(df_results)*100:.2f}%)")
    logging.info(f"False positives: {len(false_positives)} ({len(false_positives)/len(df_results)*100:.2f}%)")
    for cat in ['A', 'B', 'C']:
        cat_count = len(true_positives[true_positives['category'] == cat])
        logging.info(f"True positives for Category {cat}: {cat_count}")

if __name__ == "__main__":
    main()