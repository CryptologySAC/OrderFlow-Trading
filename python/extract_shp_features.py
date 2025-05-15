import pandas as pd
import sqlite3
import numpy as np
from multiprocessing import Pool

# Load CSV files for categories A, B, and C
category_a = pd.read_csv('shp_category_A.csv')
category_a['category'] = 'A'
category_b = pd.read_csv('shp_category_B.csv')
category_b['category'] = 'B'
category_c = pd.read_csv('shp_category_C.csv')
category_c['category'] = 'C'

# Combine into one DataFrame
shp_df = pd.concat([category_a, category_b, category_c], ignore_index=True)

def compute_interval_features(interval_trades, large_sell_threshold):
    """
    Compute order flow features for a given trade interval.
    """
    if interval_trades.empty:
        return {
            'cd': 0,
            'buy_volume_ratio': np.nan,
            'large_sell_trades': 0,
            'num_trades': 0,
            'mean_time_diff': np.nan,
            'max_consecutive_sells': 0,
            'price_change': 0,
        }
    
    buy_trades = interval_trades[interval_trades['isBuyerMaker'] == 0]
    sell_trades = interval_trades[interval_trades['isBuyerMaker'] == 1]
    
    # Cumulative Delta (CD)
    cd = buy_trades['quantity'].sum() - sell_trades['quantity'].sum()
    
    # Buy Volume Ratio
    total_volume = interval_trades['quantity'].sum()
    buy_volume_ratio = buy_trades['quantity'].sum() / total_volume if total_volume > 0 else np.nan
    
    # Large Sell Trades (using threshold from full window)
    large_sell_trades = (sell_trades['quantity'] > large_sell_threshold).sum()
    
    # Number of Trades
    num_trades = len(interval_trades)
    
    # Mean Time Difference Between Trades
    if num_trades > 1:
        time_diffs = np.diff(interval_trades['tradeTime'])
        mean_time_diff = np.mean(time_diffs)
    else:
        mean_time_diff = np.nan
    
    # Max Consecutive Sell Trades
    max_consecutive_sells = 0
    current_consecutive = 0
    for is_sell in interval_trades['isBuyerMaker']:
        if is_sell:
            current_consecutive += 1
            max_consecutive_sells = max(max_consecutive_sells, current_consecutive)
        else:
            current_consecutive = 0
    
    # Price Change
    price_change = interval_trades.iloc[-1]['price'] - interval_trades.iloc[0]['price'] if num_trades > 0 else 0
    
    return {
        'cd': cd,
        'buy_volume_ratio': buy_volume_ratio,
        'large_sell_trades': large_sell_trades,
        'num_trades': num_trades,
        'mean_time_diff': mean_time_diff,
        'max_consecutive_sells': max_consecutive_sells,
        'price_change': price_change,
    }

def compute_features(trades, entry_tradeTime):
    """
    Compute features for the full 60s window and sub-intervals (first 30s, last 30s).
    """
    # Determine large sell threshold from the entire 60s window
    sell_trades_60s = trades[trades['isBuyerMaker'] == 1]
    large_sell_threshold = np.percentile(sell_trades_60s['quantity'], 90) if not sell_trades_60s.empty else np.inf
    
    # Features for full 60 seconds
    features_60s = compute_interval_features(trades, large_sell_threshold)
    
    # Split into first 30s and last 30s
    mid_time = entry_tradeTime - 30000
    first_30s = trades[trades['tradeTime'] < mid_time]
    last_30s = trades[trades['tradeTime'] >= mid_time]
    
    features_first_30s = compute_interval_features(first_30s, large_sell_threshold)
    features_last_30s = compute_interval_features(last_30s, large_sell_threshold)
    
    # Combine all features with prefixes for sub-intervals
    features = {
        **features_60s,
        **{f'first_30s_{k}': v for k, v in features_first_30s.items()},
        **{f'last_30s_{k}': v for k, v in features_last_30s.items()}
    }
    return features

def process_shp(shp_row):
    """
    Process a single SHP: extract 60s of trade data and compute features.
    """
    entry_tradeTime = shp_row['entry_tradeTime']
    category = shp_row['category']
    start_time = entry_tradeTime - 60000  # 60 seconds before
    
    # Connect to database and query trades
    conn = sqlite3.connect('trades.db')
    query = """
    SELECT tradeTime, price, quantity, isBuyerMaker
    FROM aggregated_trades
    WHERE tradeTime >= ? AND tradeTime < ?
    ORDER BY tradeTime
    """
    trades = pd.read_sql_query(query, conn, params=(start_time, entry_tradeTime))
    conn.close()
    
    # Handle empty trade windows
    if trades.empty:
        return {
            'entry_tradeTime': entry_tradeTime,
            'category': category,
            'num_trades_60s': 0,
            'cd_60s': 0,
            'buy_volume_ratio_60s': np.nan,
            'large_sell_trades_60s': 0,
            'mean_time_diff_60s': np.nan,
            'max_consecutive_sells_60s': 0,
            'price_change_60s': 0,
            # Sub-interval features set to defaults
            **{f'first_30s_{k}': 0 if k != 'buy_volume_ratio' and k != 'mean_time_diff' else np.nan
               for k in ['cd', 'buy_volume_ratio', 'large_sell_trades', 'num_trades', 'mean_time_diff', 'max_consecutive_sells', 'price_change']},
            **{f'last_30s_{k}': 0 if k != 'buy_volume_ratio' and k != 'mean_time_diff' else np.nan
               for k in ['cd', 'buy_volume_ratio', 'large_sell_trades', 'num_trades', 'mean_time_diff', 'max_consecutive_sells', 'price_change']}
        }
    
    # Compute features for non-empty windows
    features = compute_features(trades, entry_tradeTime)
    features['entry_tradeTime'] = entry_tradeTime
    features['category'] = category
    return features

# Process all SHPs in parallel using multiprocessing
if __name__ == '__main__':
    with Pool() as pool:
        results = pool.map(process_shp, [row for _, row in shp_df.iterrows()])

    # Convert results to DataFrame and save to CSV
    results_df = pd.DataFrame(results)
    results_df.to_csv('shp_features.csv', index=False)