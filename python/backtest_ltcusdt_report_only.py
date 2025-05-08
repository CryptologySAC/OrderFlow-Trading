import pandas as pd
import sqlite3
from multiprocessing import Pool
from functools import partial

# Define global constants
DB_PATH = '../trades.db'
NUM_PROCESSES = 8
WINDOW_TRADES = 1740  # ~300 seconds
VOLUME_RATIO_THRESHOLD = 3.0
CUMULATIVE_DELTA_THRESHOLD = -400

# Parameters
PARAMS = {
    'TP_pct': [0.02], # 2% take-profit (HP drop)
    'SL_pct': [0.01]  # 1% stop-loss
}

# Load trade data
def load_trades():
    conn = sqlite3.connect(DB_PATH)
    trades = pd.read_sql_query("SELECT tradeTime, price, quantity, isBuyerMaker FROM aggregated_trades ORDER BY tradeTime ASC", conn)
    trades['tradeTime'] = pd.to_datetime(trades['tradeTime'], unit='ms')
    conn.close()
    return trades

# Backtest function
def backtest(params, trades):
    TP_pct, SL_pct = params
    total_profit = 0.0
    num_trades = 0
    valid_trades = 0
    wins = 0
    profits = []
    max_drawdown = 0.0
    equity = 0.0
    peak_equity = 0.0

    # Iterate through trades
    for i in range(WINDOW_TRADES, len(trades) - WINDOW_TRADES):
        window = trades.iloc[i-WINDOW_TRADES:i]
        # Compute pattern components
        buy_volume = window[window['isBuyerMaker'] == 0]['quantity'].sum()
        sell_volume = window[window['isBuyerMaker'] == 1]['quantity'].sum()
        volume_ratio = sell_volume / buy_volume if buy_volume > 0 else float('inf')
        buy_value = (window[window['isBuyerMaker'] == 0]['quantity'] * window[window['isBuyerMaker'] == 0]['price']).sum()
        sell_value = (window[window['isBuyerMaker'] == 1]['quantity'] * window[window['isBuyerMaker'] == 1]['price']).sum()
        cumulative_delta = buy_value - sell_value

        # Check refined pattern
        if (volume_ratio > VOLUME_RATIO_THRESHOLD and 
            cumulative_delta < CUMULATIVE_DELTA_THRESHOLD):
            entry_price = trades['price'].iloc[i]
            future_window = trades.iloc[i:i+WINDOW_TRADES]
            if len(future_window) < WINDOW_TRADES:
                continue

            # Check TP and SL for a short position
            tp_price = entry_price * (1 - TP_pct)
            sl_price = entry_price * (1 + SL_pct)
            hit_tp = False
            hit_sl = False
            for price in future_window['price']:
                if price <= tp_price:
                    hit_tp = True
                    break
                if price >= sl_price:
                    hit_sl = True
                    break

            if hit_tp:
                profit = TP_pct
                wins += 1
            elif hit_sl:
                profit = -SL_pct
            else:
                continue

            total_profit += profit
            num_trades += 1
            valid_trades += 1
            profits.append(profit)
            equity += profit
            peak_equity = max(peak_equity, equity)
            max_drawdown = min(max_drawdown, equity - peak_equity)

    win_rate = (wins / num_trades) * 100 if num_trades > 0 else 0.0
    avg_profit = sum(profits) / num_trades if num_trades > 0 else 0.0

    return {
        'TP_pct': TP_pct, 'SL_pct': SL_pct,
        'total_profit': total_profit, 'num_trades': num_trades, 'valid_trades': valid_trades,
        'win_rate': win_rate, 'avg_profit': avg_profit, 'max_drawdown': max_drawdown
    }

if __name__ == '__main__':
    # Load data
    trades = load_trades()

    # Generate parameter combinations
    param_combinations = [(TP_pct, SL_pct) for TP_pct, SL_pct in itertools.product(
        PARAMS['TP_pct'], PARAMS['SL_pct']
    )]

    # Parallelize backtest
    with Pool(processes=NUM_PROCESSES) as pool:
        backtest_with_data = partial(backtest, trades=trades)
        results = pool.map(backtest_with_data, param_combinations)

    # Save results
    results_df = pd.DataFrame(results)
    results_df.to_csv('backtest_results_report_only.csv', index=False)
    print("Backtest results saved to 'backtest_results_report_only.csv'.")