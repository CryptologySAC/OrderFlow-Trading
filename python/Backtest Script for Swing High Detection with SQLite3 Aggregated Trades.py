import sqlite3
import pandas as pd
import numpy as np
from collections import deque
import multiprocessing as mp
from itertools import product
import torch
import functools
from datetime import datetime, timedelta

# Check if MPS is available
device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
print(f"Using device: {device}")

def load_trade_data(db_path='./trades.db', table_name='aggregated_trades', symbol='LTCUSDT'):
    """
    Load raw trade data from an SQLite3 database for LTCUSDT market trades.
    Table: aggregated_trades with columns: aggregatedTradeId, firstTradeId, lastTradeId, tradeTime, symbol, price, quantity, isBuyerMaker, orderType, bestMatch.
    Filters for symbol='LTCUSDT' and orderType='MARKET'.
    Returns sorted DataFrame with timestamp, price, quantity, direction.
    """
    try:
        conn = sqlite3.connect(db_path)
        query = f"""
            SELECT tradeTime, price, quantity, isBuyerMaker
            FROM {table_name}
            WHERE symbol = ? 
            ORDER BY tradeTime
        """
        df = pd.read_sql_query(query, conn, params=(symbol,))
        conn.close()
        
        # Validate schema
        required_columns = ['tradeTime', 'price', 'quantity', 'isBuyerMaker']
        if not all(col in df.columns for col in required_columns):
            raise ValueError(f"Table must contain columns: {required_columns}")
        
        # Rename and process columns
        df = df.rename(columns={'tradeTime': 'timestamp'})
        df['timestamp'] = df['timestamp'].astype(np.int64)
        df['price'] = df['price'].astype(np.float32)
        df['quantity'] = df['quantity'].astype(np.float32)
        df['isBuyerMaker'] = df['isBuyerMaker'].astype(np.int32)
        df['direction'] = df['isBuyerMaker'].map({1: 'sell', 0: 'buy'})
        
        # Validate data
        if df[['timestamp', 'price', 'quantity', 'isBuyerMaker']].isnull().any().any():
            raise ValueError("Data contains missing values")
        if (df['price'] <= 0).any() or (df['quantity'] <= 0).any():
            raise ValueError("Price and quantity must be positive")
        if not df['isBuyerMaker'].isin([0, 1]).all():
            raise ValueError("isBuyerMaker must be 0 or 1")
        
        return df[['timestamp', 'price', 'quantity', 'direction']]
    except Exception as e:
        print(f"Error loading data: {e}")
        return None

def backtest_trades(trades, M, K, R, L, D, TP_pct, SL_pct, quantity=1.0):
    """
    Backtest the swing high detection strategy on raw trade data for LTCUSDT.
    Parameters:
        trades: DataFrame with timestamp, price, quantity, direction
        M: Look-back trades for price high
        K: Trades for volume confirmation
        R: Sell/buy volume ratio
        L: Trades to check price drop
        D: Minimum price drop percentage
        TP_pct: Take-profit percentage
        SL_pct: Stop-loss percentage
        quantity: Fixed quantity to short (1 LTC)
    Returns: Dictionary with statistics and trades list
    """
    # Convert to numpy arrays and move to MPS with float32
    prices = torch.tensor(trades['price'].values, dtype=torch.float32, device=device)
    quantities = torch.tensor(trades['quantity'].values, dtype=torch.float32, device=device)
    directions = trades['direction'].values
    timestamps = trades['timestamp'].values
    
    price_buffer = deque(maxlen=M)
    confirm_buffer = deque()
    drop_buffer = deque()
    trades_list = []
    total_profit = 0.0
    position = 0
    candidate = None
    confirming = False
    trade_id = 0
    profits = []  # For drawdown calculation
    
    for i in range(len(trades)):
        price = prices[i].item()
        trade_quantity = quantities[i].item()
        direction = directions[i]
        timestamp = timestamps[i]
        
        # Skip new signals if a trade is open
        if position != 0:
            continue
        
        # Update price buffer
        price_buffer.append((timestamp, price, trade_quantity, direction))
        
        # Check for candidate swing high
        if len(price_buffer) == M and not confirming:
            prices_array = torch.tensor([p[1] for p in price_buffer], dtype=torch.float32, device=device)
            max_price = torch.max(prices_array).item()
            if abs(price - max_price) < 1e-6:  # Adjusted for float32 precision
                candidate = (timestamp, price, i)
                confirming = True
                confirm_buffer.clear()
                drop_buffer.clear()
        
        # Confirm swing high with volume and price drop
        if confirming:
            confirm_buffer.append((timestamp, price, trade_quantity, direction))
            if len(confirm_buffer) == K:
                sell_volume = sum(q for _, _, q, d in confirm_buffer if d == 'sell')
                buy_volume = sum(q for _, _, q, d in confirm_buffer if d == 'buy')
                if buy_volume == 0 or sell_volume <= R * buy_volume:
                    confirming = False
                    candidate = None
                    continue
                drop_buffer.append((timestamp, price, trade_quantity, direction))
                if len(drop_buffer) == L:
                    prices_drop = torch.tensor([p[1] for p in drop_buffer], dtype=torch.float32, device=device)
                    min_price = torch.min(prices_drop).item()
                    if (candidate[1] - min_price) / candidate[1] >= D:
                        # Enter short position
                        entry_price = candidate[1]
                        entry_time = candidate[0]
                        TP_level = entry_price * (1 - TP_pct)
                        SL_level = entry_price * (1 + SL_pct)
                        position = -1
                        current_trade = {
                            'trade_id': trade_id,
                            'entry_time': pd.Timestamp(entry_time, unit='ms'),
                            'entry_price': entry_price,
                            'quantity': quantity,
                            'TP': TP_level,
                            'SL': SL_level
                        }
                        trade_id += 1
                        # Check trade outcome
                        valid_signal = False
                        for j in range(i+1, len(trades)):
                            trade_price = prices[j].item()
                            trade_time = pd.Timestamp(timestamps[j], unit='ms')
                            if trade_price <= TP_level:
                                close_price = TP_level
                                profit = (entry_price - close_price) * quantity
                                total_profit += profit
                                profits.append(profit)
                                current_trade.update({
                                    'close_time': trade_time,
                                    'close_price': close_price,
                                    'profit': profit,
                                    'valid': True
                                })
                                trades_list.append(current_trade)
                                position = 0
                                valid_signal = True
                                break
                            elif trade_price >= SL_level:
                                close_price = SL_level
                                profit = (entry_price - close_price) * quantity
                                total_profit += profit
                                profits.append(profit)
                                current_trade.update({
                                    'close_time': trade_time,
                                    'close_price': close_price,
                                    'profit': profit,
                                    'valid': False
                                })
                                trades_list.append(current_trade)
                                position = 0
                                break
                        if not valid_signal and position == -1 and i == len(trades) - 1:
                            close_price = prices[-1].item()
                            profit = (entry_price - close_price) * quantity
                            total_profit += profit
                            profits.append(profit)
                            current_trade.update({
                                'close_time': pd.Timestamp(timestamps[-1], unit='ms'),
                                'close_price': close_price,
                                'profit': profit,
                                'valid': prices[j+1:].min() <= TP_level if j+1 < len(prices) else False
                            })
                            trades_list.append(current_trade)
                            position = 0
                    confirming = False
                    candidate = None
    
    # Calculate additional statistics
    valid_trades = sum(1 for trade in trades_list if trade['valid'])
    win_rate = valid_trades / len(trades_list) if trades_list else 0.0
    avg_profit = total_profit / len(trades_list) if trades_list else 0.0
    max_drawdown = 0.0
    if profits:
        cum_profits = np.cumsum(profits)
        peak = cum_profits[0]
        max_drawdown = 0.0
        for profit in cum_profits:
            if profit > peak:
                peak = profit
            drawdown = peak - profit
            if drawdown > max_drawdown:
                max_drawdown = drawdown
    
    # Temporal distribution
    if trades_list:
        trades_df = pd.DataFrame(trades_list)
        trades_df['entry_date'] = trades_df['entry_time'].dt.date
        trades_df['entry_week'] = trades_df['entry_time'].dt.isocalendar().week
        daily_stats = trades_df.groupby('entry_date').agg({
            'trade_id': 'count',
            'valid': 'sum',
            'profit': 'sum'
        }).rename(columns={'trade_id': 'num_trades', 'valid': 'valid_trades', 'profit': 'total_profit'})
        weekly_stats = trades_df.groupby('entry_week').agg({
            'trade_id': 'count',
            'valid': 'sum',
            'profit': 'sum'
        }).rename(columns={'trade_id': 'num_trades', 'valid': 'valid_trades', 'profit': 'total_profit'})
    else:
        daily_stats = pd.DataFrame()
        weekly_stats = pd.DataFrame()
    
    return {
        'M': M,
        'K': K,
        'R': R,
        'L': L,
        'D': D,
        'TP_pct': TP_pct,
        'SL_pct': SL_pct,
        'total_profit': total_profit,
        'num_trades': len(trades_list),
        'valid_trades': valid_trades,
        'win_rate': win_rate,
        'avg_profit': avg_profit,
        'max_drawdown': max_drawdown,
        'trades': trades_list,
        'daily_stats': daily_stats,
        'weekly_stats': weekly_stats
    }

def run_backtest(params, trades):
    """
    Wrapper function for parallel processing.
    """
    M, K, R, L, D, TP_pct, SL_pct = params
    result = backtest_trades(trades, M, K, R, L, D, TP_pct, SL_pct)
    return result

def main():
    # Load trade data
    print("Loading trade data for LTCUSDT...")
    trades = load_trade_data(db_path='trades.db', table_name='aggregated_trades', symbol='LTCUSDT')
    if trades is None:
        print("Failed to load trade data. Exiting.")
        return
    
    # Define parameter ranges
    M_values = [50, 100]
    K_values = [5, 10]
    R_values = [2.0, 3.0]
    L_values = [50, 100]
    D_values = [0.01]
    TP_pct_values = [0.01, 0.02]
    SL_pct_values = [0.005, 0.01]
    
    # Create parameter combinations
    param_combinations = list(product(M_values, K_values, R_values, L_values, D_values, TP_pct_values, SL_pct_values))
    
    # Run backtests in parallel
    print(f"Running backtests with {len(param_combinations)} parameter combinations...")
    with mp.Pool(processes=mp.cpu_count()) as pool:
        run_backtest_partial = functools.partial(run_backtest, trades=trades)
        results = pool.map(run_backtest_partial, param_combinations)
    
    # Aggregate results
    results_df = pd.DataFrame([{
        'M': r['M'],
        'K': r['K'],
        'R': r['R'],
        'L': r['L'],
        'D': r['D'],
        'TP_pct': r['TP_pct'],
        'SL_pct': r['SL_pct'],
        'total_profit': r['total_profit'],
        'num_trades': r['num_trades'],
        'valid_trades': r['valid_trades'],
        'win_rate': r['win_rate'],
        'avg_profit': r['avg_profit'],
        'max_drawdown': r['max_drawdown']
    } for r in results])
    print("\nBacktest Results:")
    print(results_df.to_string(index=False))
    
    # Save results to CSV
    results_df.to_csv('backtest_results.csv', index=False)
    print("\nBacktest results saved to 'backtest_results.csv'")
    
    # Find best parameters
    best_result = results_df.loc[results_df['total_profit'].idxmax()]
    print("\nBest Parameters:")
    print(f"M: {best_result['M']}")
    print(f"K: {best_result['K']}")
    print(f"R: {best_result['R']}")
    print(f"L: {best_result['L']}")
    print(f"D: {best_result['D']}")
    print(f"TP_pct: {best_result['TP_pct']}")
    print(f"SL_pct: {best_result['SL_pct']}")
    print(f"Total Profit: {best_result['total_profit']} LTC")
    print(f"Number of Trades: {best_result['num_trades']}")
    print(f"Valid Trades: {best_result['valid_trades']}")
    print(f"Win Rate: {best_result['win_rate']:.2%}")
    print(f"Average Profit per Trade: {best_result['avg_profit']:.4f} LTC")
    print(f"Maximum Drawdown: {best_result['max_drawdown']:.4f} LTC")
    
    # Save best trades and temporal statistics
    best_trades = next(r['trades'] for r in results if r['M'] == best_result['M'] and r['K'] == best_result['K'] and r['R'] == best_result['R'] and r['L'] == best_result['L'] and r['D'] == best_result['D'] and r['TP_pct'] == best_result['TP_pct'] and r['SL_pct'] == best_result['SL_pct'])
    trades_df = pd.DataFrame(best_trades)
    trades_df.to_csv('best_trades.csv', index=False)
    print("\nBest trades saved to 'best_trades.csv'")
    
    # Save temporal statistics
    best_daily_stats = next(r['daily_stats'] for r in results if r['M'] == best_result['M'] and r['K'] == best_result['K'] and r['R'] == best_result['R'] and r['L'] == best_result['L'] and r['D'] == best_result['D'] and r['TP_pct'] == best_result['TP_pct'] and r['SL_pct'] == best_result['SL_pct'])
    best_weekly_stats = next(r['weekly_stats'] for r in results if r['M'] == best_result['M'] and r['K'] == best_result['K'] and r['R'] == best_result['R'] and r['L'] == best_result['L'] and r['D'] == best_result['D'] and r['TP_pct'] == best_result['TP_pct'] and r['SL_pct'] == best_result['SL_pct'])
    best_daily_stats.to_csv('best_daily_stats.csv')
    best_weekly_stats.to_csv('best_weekly_stats.csv')
    print("Daily statistics saved to 'best_daily_stats.csv'")
    print("Weekly statistics saved to 'best_weekly_stats.csv'")

if __name__ == '__main__':
    main()