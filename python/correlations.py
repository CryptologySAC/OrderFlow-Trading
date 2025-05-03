import pandas as pd
from datetime import timedelta
from scipy.stats import pearsonr
import itertools
import sqlite3
import numpy as np



def analyze_absorption_correlations(trades, large_trade_threshold=4607.62, window_minutes=89, move_threshold=0.9, absorption_window_seconds=30):
    large_trades = trades[trades['usdt_value'] > large_trade_threshold].copy()
    print(f"Analyzing {len(large_trades)} large trades for order flow correlations...")
    results = []

    for idx, trade in large_trades.iterrows():
        entry_time = trade['trade_timestamp']
        entry_price = trade['price']
        trade_type = trade['trade_type']
        window_end = entry_time + timedelta(minutes=window_minutes)
        absorption_end = entry_time + timedelta(seconds=absorption_window_seconds)

        # Filter trades in 30-second absorption window
        absorption_trades = trades[(trades['trade_timestamp'] > entry_time) & 
                                  (trades['trade_timestamp'] <= absorption_end)]

        # Order Flow Metrics
        # 1. Immediate Opposing Trade Surge
        opposing_trades = absorption_trades[absorption_trades['trade_type'] != trade_type]
        opposing_count_30s = len(opposing_trades)
        opposing_volume_30s = opposing_trades['usdt_value'].sum()
        absorption_ratio_30s = opposing_volume_30s / trade['usdt_value'] if trade['usdt_value'] > 0 else 0

        # 2. Initial Price Stability
        max_price_30s = absorption_trades['price'].max()
        min_price_30s = absorption_trades['price'].min()
        initial_price_move = abs((max_price_30s - entry_price) / entry_price * 100) if max_price_30s and trade_type == 'buy' else abs((min_price_30s - entry_price) / entry_price * 100) if min_price_30s else 0

        # 3. Trade Frequency Spike
        total_trades_30s = len(absorption_trades)
        trade_frequency_30s = total_trades_30s / absorption_window_seconds if absorption_window_seconds > 0 else 0

        # 4. Volume Dominance Reversal
        same_type_volume_30s = absorption_trades[absorption_trades['trade_type'] == trade_type]['usdt_value'].sum()
        volume_dominance_ratio_30s = opposing_volume_30s / same_type_volume_30s if same_type_volume_30s > 0 else float('inf')

        # Analyze price move in main window
        window_trades = trades[(trades['trade_timestamp'] > entry_time) & 
                              (trades['trade_timestamp'] <= window_end)]
        down_threshold = entry_price * (1 - move_threshold / 100)
        up_threshold = entry_price * (1 + move_threshold / 100)
        
        hit_down_first = False
        hit_up_first = False
        for _, window_trade in window_trades.iterrows():
            price = window_trade['price']
            if price <= down_threshold:
                hit_down_first = True
                break
            elif price >= up_threshold:
                hit_up_first = True
                break

        outcome = 'Bottom First' if hit_down_first else 'Top First' if hit_up_first else 'Neither'

        results.append({
            'trade_type': trade_type,
            'outcome': outcome,
            'absorption_ratio_30s': absorption_ratio_30s,
            'opposing_count_30s': opposing_count_30s,
            'initial_price_move': initial_price_move,
            'trade_frequency_30s': trade_frequency_30s,
            'volume_dominance_ratio_30s': volume_dominance_ratio_30s
        })

    results_df = pd.DataFrame(results)

    # Correlation Analysis
    print("\nCorrelation Analysis with Desired Outcome:")
    buy_trades = results_df[results_df['trade_type'] == 'buy'].copy()
    sell_trades = results_df[results_df['trade_type'] == 'sell'].copy()

    # Convert outcome to binary (1 for desired outcome, 0 otherwise)
    buy_trades['desired_outcome'] = (buy_trades['outcome'] == 'Bottom First').astype(int)
    sell_trades['desired_outcome'] = (sell_trades['outcome'] == 'Top First').astype(int)

    metrics = ['absorption_ratio_30s', 'opposing_count_30s', 'initial_price_move', 'trade_frequency_30s', 'volume_dominance_ratio_30s']
    for metric in metrics:
        # Handle infinite values
        buy_finite = buy_trades[buy_trades[metric].replace([float('inf'), -float('inf')], pd.NA).notna()]
        sell_finite = sell_trades[sell_trades[metric].replace([float('inf'), -float('inf')], pd.NA).notna()]
        
        buy_corr, _ = pearsonr(buy_finite[metric], buy_finite['desired_outcome']) if len(buy_finite) > 1 else (0, 0)
        sell_corr, _ = pearsonr(sell_finite[metric], sell_finite['desired_outcome']) if len(sell_finite) > 1 else (0, 0)
        print(f"{metric}:")
        print(f"  Buy Trades Correlation: {buy_corr:.4f}")
        print(f"  Sell Trades Correlation: {sell_corr:.4f}")

    # Individual Metric Success Rates
    print("\nIndividual Metric Success Rates:")
    thresholds = {
        'absorption_ratio_30s': 0.5,
        'opposing_count_30s': 3,
        'initial_price_move': 0.05,
        'trade_frequency_30s': 0.5,
        'volume_dominance_ratio_30s': 1.5
    }

    for metric, threshold in thresholds.items():
        if metric == 'initial_price_move':
            buy_filtered = buy_trades[buy_trades[metric] < threshold]
            sell_filtered = sell_trades[sell_trades[metric] < threshold]
        else:
            buy_filtered = buy_trades[buy_trades[metric] > threshold]
            sell_filtered = sell_trades[sell_trades[metric] > threshold]
        
        buy_bottom_prob = len(buy_filtered[buy_filtered['outcome'] == 'Bottom First']) / len(buy_filtered) * 100 if len(buy_filtered) > 0 else 0
        sell_top_prob = len(sell_filtered[sell_filtered['outcome'] == 'Top First']) / len(sell_filtered) * 100 if len(sell_filtered) > 0 else 0
        print(f"{metric} (Threshold: {threshold}):")
        print(f"  Buy Trades (-0.9% Move): {buy_bottom_prob:.2f}% ({len(buy_filtered)} signals)")
        print(f"  Sell Trades (+0.9% Move): {sell_top_prob:.2f}% ({len(sell_filtered)} signals)")

    # Combination Analysis
    print("\nCombination Success Rates:")
    metric_names = list(thresholds.keys())
    for r in range(1, len(metric_names) + 1):
        for combo in itertools.combinations(metric_names, r):
            buy_conditions = pd.Series(True, index=buy_trades.index)
            sell_conditions = pd.Series(True, index=sell_trades.index)
            for metric in combo:
                threshold = thresholds[metric]
                if metric == 'initial_price_move':
                    buy_conditions &= (buy_trades[metric] < threshold)
                    sell_conditions &= (sell_trades[metric] < threshold)
                else:
                    buy_conditions &= (buy_trades[metric] > threshold)
                    sell_conditions &= (sell_trades[metric] > threshold)
            
            buy_filtered = buy_trades[buy_conditions]
            sell_filtered = sell_trades[sell_conditions]
            buy_bottom_prob = len(buy_filtered[buy_filtered['outcome'] == 'Bottom First']) / len(buy_filtered) * 100 if len(buy_filtered) > 0 else 0
            sell_top_prob = len(sell_filtered[sell_filtered['outcome'] == 'Top First']) / len(sell_filtered) * 100 if len(sell_filtered) > 0 else 0
            print(f"Combination: {', '.join(combo)}")
            print(f"  Buy Trades (-0.9% Move): {buy_bottom_prob:.2f}% ({len(buy_filtered)} signals)")
            print(f"  Sell Trades (+0.9% Move): {sell_top_prob:.2f}% ({len(sell_filtered)} signals)")

    return results_df

# Load data from SQLite
def load_data_from_sqlite(db_file, table_name='aggregated_trades', symbol='LTCUSDT'):
    conn = sqlite3.connect(db_file)
    try:
        query = f"""
            SELECT aggregatedTradeId AS id, firstTradeId AS trade_id1, lastTradeId AS trade_id2,
                   tradeTime AS timestamp, symbol AS pair, price, quantity,
                   isBuyerMaker AS is_buyer, orderType AS order_type
            FROM {table_name}
            WHERE symbol = ?
            ORDER BY tradeTime
        """
        df = pd.read_sql_query(query, conn, params=(symbol,))
        if df.empty:
            raise ValueError(f"No data found for symbol {symbol} in table {table_name}")
        
        # Convert is_buyer to buy/sell
        df['trade_type'] = np.where(df['is_buyer'] == 1, 'buy', 'sell')
        
        # Calculate USDT value
        df['usdt_value'] = df['quantity'] * df['price']
        
        # Convert timestamp to datetime
        df['trade_timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
        
        return df
    except Exception as e:
        print(f"Error loading data: {e}")
        return None
    finally:
        conn.close()

if __name__ == "__main__":
    db_file = '../trades.db'
    trades = load_data_from_sqlite(db_file)
    if trades is None:
        raise SystemExit("Failed to load data. Exiting.")
    
    results = analyze_absorption_correlations(trades, large_trade_threshold=4607.62, move_threshold=0.9)
    results.to_csv('order_flow_correlation_results.csv', index=False)
    print("Saved analysis results to 'order_flow_correlation_results.csv'")