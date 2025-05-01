import pandas as pd
import numpy as np
from collections import deque
from datetime import timedelta, datetime
import itertools
import multiprocessing as mp
import torch
import sqlite3
import pytz
import uuid

VERSION = "20250429_140000"  # Contradictive signal as exit, April 29, 2025, 14:00:00

absorptionWindows = [10]
priceRanges = [0.005]
minLargeOrders = [75, 70]
volumeWindows = [15*60*1000, 20*60*1000]
confirmThresholds = [0.004]
stopLosses = [0.005]
takeProfits = [0.025]
db_file = '../trades.db'

# Define Lima timezone (PET, UTC-5)
lima_tz = pytz.timezone('America/Lima')

class OrderFlowAnalyzer:
    def __init__(self, absorptionWindow=4, priceRange=0.004, minLargeOrder=55, volumeWindow=20*60*1000, 
                 confirmThreshold=0.0015, stopLoss=0.005, takeProfit=0.01):
        self.absorptionWindow = absorptionWindow
        self.priceRange = priceRange
        self.minLargeOrder = minLargeOrder
        self.volumeWindow = pd.Timedelta(milliseconds=volumeWindow)
        self.confirmThreshold = confirmThreshold
        self.defaultStopLoss = stopLoss
        self.takeProfit = takeProfit
        self.priceBins = {}
        self.signals = []
        self.recentTrades = deque()
        self.activeTrade = None
        # Trading simulation attributes
        self.fee = 0.001  # 0.1%
        self.trade_log = []
        self.value_history = {'Daytime': [], 'Nighttime': []}
        # Route B: Queues for potential and pending signals
        self.potentialSignals = deque()
        self.pendingSignals = deque()
        # Initialize per timeframe
        self.reset_state()

    def reset_state(self):
        """Reset trading state for each timeframe."""
        self.state = {
            'Daytime': {'holding': 'LTC', 'LTC_amount': 100, 'USDT_amount': 0},
            'Nighttime': {'holding': 'LTC', 'LTC_amount': 100, 'USDT_amount': 0}
        }

    def processTrades(self, df):
        for _, trade in df.iterrows():
            timeframe = categorize_timeframe(trade['timestamp'])
            self.updateRecentTrades(trade)
            self.processTrade(trade, timeframe)
            # Update value history for drawdown
            if self.state[timeframe]['holding'] == 'LTC':
                current_value = self.state[timeframe]['LTC_amount'] * trade['price']
            else:
                current_value = self.state[timeframe]['USDT_amount']
            self.value_history[timeframe].append((trade['timestamp'], current_value))
        # Do not close active trade at end of data; discard it

    def updateRecentTrades(self, trade):
        current_time = trade['timestamp']
        while self.recentTrades and current_time - self.recentTrades[0]['timestamp'] > pd.Timedelta(seconds=self.absorptionWindow):
            self.recentTrades.popleft()
        self.recentTrades.append(trade)

    def checkInvalidation(self, signal_timestamp, signal_price, is_buy_signal):
        buy_volume = 0
        sell_volume = 0
        min_price = signal_price
        max_price = signal_price
        invalidation_window = pd.Timedelta(seconds=5)
        for trade in self.recentTrades:
            if signal_timestamp < trade['timestamp'] <= signal_timestamp + invalidation_window:
                if trade['isBuyer']:
                    buy_volume += trade['quantity']
                else:
                    sell_volume += trade['quantity']
                min_price = min(min_price, trade['price'])
                max_price = max(max_price, trade['price'])
        if is_buy_signal:
            volume_condition = sell_volume > 2 * buy_volume and sell_volume > 0
            price_condition = min_price <= signal_price * (1 - 0.002)
            return volume_condition or price_condition
        else:
            volume_condition = buy_volume > 2 * sell_volume and buy_volume > 0
            price_condition = max_price >= signal_price * (1 + 0.002)
            return volume_condition or price_condition

    def closeActiveTrade(self, exit_price, exit_timestamp, trade_index, timeframe, reason='opposite_signal'):
        if not self.activeTrade:
            return
        # Log trade details
        start_LTC = self.state[timeframe]['LTC_amount'] if self.activeTrade['holding'] == 'LTC' else 0
        start_USDT = self.state[timeframe]['USDT_amount'] if self.activeTrade['holding'] == 'USDT' else 0
        end_LTC = self.state[timeframe]['LTC_amount']
        end_USDT = self.state[timeframe]['USDT_amount']
        trade = {
            'trade_id': str(uuid.uuid4()),
            'timeframe': timeframe,
            'type': self.activeTrade['type'],
            'entry_timestamp': self.activeTrade['timestamp'],
            'entry_price': self.activeTrade['price'],
            'exit_timestamp': exit_timestamp,
            'exit_price': exit_price,
            'trade_index': trade_index,
            'is_invalidated': self.activeTrade['is_invalidated'],
            'close_reason': reason,
            'start_LTC': start_LTC,
            'start_USDT': start_USDT,
            'end_LTC': end_LTC,
            'end_USDT': end_USDT
        }
        self.signals.append(trade)
        self.trade_log.append(trade)
        self.activeTrade = None

    def calculate_return(self, exit_price):
        if not self.activeTrade:
            return 0
        entry_price = self.activeTrade['price']
        if self.activeTrade['type'] == 'sell_absorption':
            return (exit_price / entry_price) - 1
        else:
            return (entry_price / exit_price) - 1

    def processTrade(self, trade, timeframe):
        binPrice = round(trade['price'] / 0.001) * 0.001
        if binPrice not in self.priceBins:
            self.priceBins[binPrice] = {'buyVol': 0, 'sellVol': 0, 'lastUpdate': trade['timestamp']}
        bin = self.priceBins[binPrice]
        if trade['timestamp'] - bin['lastUpdate'] > self.volumeWindow:
            bin['buyVol'] = 0
            bin['sellVol'] = 0
        if trade['isBuyer']:
            bin['buyVol'] += trade['quantity']
        else:
            bin['sellVol'] += trade['quantity']
        bin['lastUpdate'] = trade['timestamp']

        # Expire old pending signals (5-minute window)
        while self.pendingSignals and trade['timestamp'] - self.pendingSignals[0]['timestamp'] > pd.Timedelta(minutes=5):
            self.pendingSignals.popleft()

        # Check potential signals for invalidation after 5 seconds
        while self.potentialSignals and trade['timestamp'] >= self.potentialSignals[0]['timestamp'] + pd.Timedelta(seconds=5):
            signal = self.potentialSignals.popleft()
            is_buy_signal = signal['type'] == 'sell_absorption'
            if not self.checkInvalidation(signal['timestamp'], signal['price'], is_buy_signal):
                # Signal is valid; add to pending signals for confirmation
                signal['is_invalidated'] = False
                if not self.activeTrade:
                    self.pendingSignals.append(signal)

        # Check pending signals for confirmation
        if not self.activeTrade:
            for signal in list(self.pendingSignals):
                is_buy_signal = signal['type'] == 'sell_absorption'
                confirmed = False
                if is_buy_signal and trade['price'] >= signal['price'] * (1 + self.confirmThreshold):
                    confirmed = True
                elif not is_buy_signal and trade['price'] <= signal['price'] * (1 - self.confirmThreshold):
                    confirmed = True
                if confirmed:
                    # Enter trade at current price
                    if self.activeTrade:
                        if (self.activeTrade['type'] == 'sell_absorption' and signal['type'] == 'buy_absorption') or \
                           (self.activeTrade['type'] == 'buy_absorption' and signal['type'] == 'sell_absorption'):
                            exit_price = trade['price']
                            reason = 'take_profit' if self.calculate_return(exit_price) > 0 else 'stop_loss'
                            self.closeActiveTrade(trade['price'], trade['timestamp'], trade.name, timeframe, reason=reason)
                        else:
                            self.pendingSignals.remove(signal)
                            continue
                    if signal['type'] == 'sell_absorption' and self.state[timeframe]['holding'] == 'USDT':
                        LTC_bought = (self.state[timeframe]['USDT_amount'] / trade['price']) * (1 - self.fee)
                        self.state[timeframe]['LTC_amount'] = LTC_bought
                        self.state[timeframe]['USDT_amount'] = 0
                        self.state[timeframe]['holding'] = 'LTC'
                        signal['price'] = trade['price']  # Update entry price to current trade
                        signal['timestamp'] = trade['timestamp']
                        signal['trade_index'] = trade.name
                        self.activeTrade = signal
                    elif signal['type'] == 'buy_absorption' and self.state[timeframe]['holding'] == 'LTC':
                        USDT_received = self.state[timeframe]['LTC_amount'] * trade['price'] * (1 - self.fee)
                        self.state[timeframe]['USDT_amount'] = USDT_received
                        self.state[timeframe]['LTC_amount'] = 0
                        self.state[timeframe]['holding'] = 'USDT'
                        signal['price'] = trade['price']  # Update entry price to current trade
                        signal['timestamp'] = trade['timestamp']
                        signal['trade_index'] = trade.name
                        self.activeTrade = signal
                    self.pendingSignals.remove(signal)

        # Generate new potential signal
        if trade['quantity'] >= self.minLargeOrder:
            opposingTrades = [t for t in self.recentTrades if t['isBuyer'] != trade['isBuyer'] and t['quantity'] <= 0.5]
            if opposingTrades:
                priceMin = trade['price'] * (1 - self.priceRange)
                priceMax = trade['price'] * (1 + self.priceRange)
                if all(priceMin <= t['price'] <= priceMax for t in opposingTrades):
                    signal_type = 'sell_absorption' if trade['isBuyer'] else 'buy_absorption'
                    if self.isNearHighVolume(trade['price']):
                        signal = {
                            'type': signal_type,
                            'timestamp': trade['timestamp'],
                            'price': trade['price'],
                            'score': trade['quantity'],
                            'trade_index': trade.name,
                            'holding': self.state[timeframe]['holding'],
                            'is_invalidated': False
                        }
                        self.potentialSignals.append(signal)

    def isNearHighVolume(self, price):
        binPrice = round(price / 0.001) * 0.001
        if binPrice in self.priceBins:
            bin = self.priceBins[binPrice]
            totalVol = bin['buyVol'] + bin['sellVol']
            return totalVol >= self.getTopVolumeThreshold()
        return False

    def getTopVolumeThreshold(self):
        volumes = [bin['buyVol'] + bin['sellVol'] for bin in self.priceBins.values()]
        return np.quantile(volumes, 0.9) if volumes else 0

def load_data_from_sqlite(db_file, table_name='aggregated_trades', symbol='LTCUSDT'):
    conn = sqlite3.connect(db_file)
    try:
        query = f"""
            SELECT aggregatedTradeId AS id, firstTradeId AS trade_id1, lastTradeId AS trade_id2,
                   tradeTime AS timestamp, symbol AS pair, price, quantity,
                   isBuyerMaker AS is_buyer, orderType AS order_type, bestMatch AS unknown
            FROM {table_name}
            WHERE symbol = ?
            ORDER BY tradeTime
        """
        df = pd.read_sql_query(query, conn, params=(symbol,))
        if df.empty:
            raise ValueError(f"No data found for symbol {symbol} in table {table_name}")
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms').dt.tz_localize('UTC').dt.tz_convert(lima_tz)
        df['isBuyer'] = df['is_buyer'] == 1
        return df
    except Exception as e:
        print(f"Error loading data: {e}")
        return None
    finally:
        conn.close()

def categorize_timeframe(timestamp):
    hour = timestamp.hour
    return 'Daytime' if 6 <= hour < 22 else 'Nighttime'

def compute_future_max_min(df, time_delta):
    df = df.sort_values('timestamp').reset_index(drop=True)
    max_prices = np.full(len(df), np.nan)
    min_prices = np.full(len(df), np.nan)
    j = 0
    for i in range(len(df)):
        current_time = df['timestamp'].iloc[i]
        while j < len(df) and df['timestamp'].iloc[j] <= current_time + time_delta:
            j += 1
        future_trades = df.iloc[i+1:j]
        if not future_trades.empty:
            max_prices[i] = future_trades['price'].max()
            min_prices[i] = future_trades['price'].min()
    return max_prices, min_prices

df = load_data_from_sqlite(db_file, table_name='aggregated_trades', symbol='LTCUSDT')

if df is None or df.empty:
    print("Failed to load data. Exiting.")
    exit(1)

time_delta_5min = pd.Timedelta(minutes=5)
time_delta_2h = pd.Timedelta(hours=2)
df['max_price_5min'], df['min_price_5min'] = compute_future_max_min(df, time_delta_5min)
df['max_price_2h'], df['min_price_2h'] = compute_future_max_min(df, time_delta_2h)
df['timeframe'] = df['timestamp'].apply(categorize_timeframe)

device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
print(f"Version {VERSION}, Using device: {device}")

counter = 0
def evaluate_parameters(params, df=df):
    global counter
    counter += 1
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Version {VERSION}, Processed {counter}/{len(param_combinations)}")
    absorptionWindow, priceRange, minLargeOrder, volumeWindow, confirmThreshold, stopLoss, takeProfit = params
    analyzer = OrderFlowAnalyzer(absorptionWindow, priceRange, minLargeOrder, volumeWindow, confirmThreshold, stopLoss, takeProfit)
    analyzer.processTrades(df)
    
    signals = pd.DataFrame(analyzer.signals)
    trade_log = pd.DataFrame(analyzer.trade_log)
    if signals.empty:
        return {
            'Daytime': (0, 0, 0, 0, 0),
            'Nighttime': (0, 0, 0, 0, 0)
        }, {'Daytime': 100, 'Nighttime': 100}, {'Daytime': 0, 'Nighttime': 0}, trade_log
    
    signals['timeframe'] = signals['entry_timestamp'].apply(categorize_timeframe)
    results = {}
    
    for timeframe in ['Daytime', 'Nighttime']:
        tf_signals = signals[signals['timeframe'] == timeframe]
        if tf_signals.empty:
            results[timeframe] = (0, 0, 0, 0, 0)
            continue
        
        signal_types = tf_signals['type'].values
        entry_prices = torch.tensor(tf_signals['entry_price'].values, dtype=torch.float32, device=device)
        exit_prices = torch.tensor(tf_signals['exit_price'].values, dtype=torch.float32, device=device)
        trade_indices = tf_signals['trade_index'].values
        is_invalidated = torch.tensor(tf_signals['is_invalidated'].values, dtype=torch.bool, device=device)
        close_reasons = tf_signals['close_reason'].values
        
        trade_data = df.loc[trade_indices, ['max_price_2h', 'min_price_2h']].values
        max_prices_2h = torch.tensor(trade_data[:, 0], dtype=torch.float32, device=device)
        min_prices_2h = torch.tensor(trade_data[:, 1], dtype=torch.float32, device=device)
        
        outcomes = torch.zeros(len(tf_signals), dtype=torch.int32, device=device)
        returns = torch.zeros(len(tf_signals), dtype=torch.float32, device=device)
        
        stop_loss = torch.where(is_invalidated, torch.tensor(0.001, device=device), torch.tensor(stopLoss, device=device))
        
        buy_mask = np.array([t == 'sell_absorption' for t in signal_types])
        if buy_mask.any():
            buy_indices = torch.tensor(np.where(buy_mask)[0], device=device)
            entry_buy = entry_prices[buy_indices]
            exit_buy = exit_prices[buy_indices]
            max_buy = max_prices_2h[buy_indices]
            min_buy = min_prices_2h[buy_indices]
            stop_loss_buy = stop_loss[buy_indices]
            close_reason_buy = close_reasons[buy_mask]
            
            manual_close = np.array([r in ['take_profit', 'stop_loss'] for r in close_reason_buy])
            if manual_close.any():
                manual_indices = buy_indices[torch.tensor(manual_close, device=device)]
                returns[manual_indices] = (exit_buy[manual_close] / entry_buy[manual_close]) - 1
                outcomes[manual_indices[returns[manual_indices] > 0]] = 1
                outcomes[manual_indices[returns[manual_indices] <= 0]] = 2
            
            tp_sl_indices = buy_indices[~torch.tensor(manual_close, device=device)]
            if len(tp_sl_indices) > 0:
                entry_buy_tp_sl = entry_buy[~manual_close]
                max_buy_tp_sl = max_buy[~manual_close]
                min_buy_tp_sl = min_buy[~manual_close]
                stop_loss_buy_tp_sl = stop_loss_buy[~manual_close]
                
                tp_price = entry_buy_tp_sl * (1 + takeProfit)
                sl_price = entry_buy_tp_sl * (1 - stop_loss_buy_tp_sl)
                
                tp_hit = max_buy_tp_sl >= tp_price
                outcomes[tp_sl_indices[tp_hit]] = 1
                returns[tp_sl_indices[tp_hit]] = takeProfit
                
                sl_hit = (~tp_hit) & (min_buy_tp_sl <= sl_price)
                outcomes[tp_sl_indices[sl_hit]] = 2
                returns[tp_sl_indices[sl_hit]] = -stop_loss_buy_tp_sl[sl_hit]
                
                orig_profit = (~tp_hit) & (~sl_hit) & (max_buy_tp_sl >= entry_buy_tp_sl * 1.01)
                outcomes[tp_sl_indices[orig_profit]] = 1
                returns[tp_sl_indices[orig_profit]] = (max_buy_tp_sl[orig_profit] / entry_buy_tp_sl[orig_profit]) - 1
        
        sell_mask = np.array([t == 'buy_absorption' for t in signal_types])
        if sell_mask.any():
            sell_indices = torch.tensor(np.where(sell_mask)[0], device=device)
            entry_sell = entry_prices[sell_indices]
            exit_sell = exit_prices[sell_indices]
            min_sell = min_prices_2h[sell_indices]
            max_sell = max_prices_2h[sell_indices]
            stop_loss_sell = stop_loss[sell_indices]
            close_reason_sell = close_reasons[sell_mask]
            
            manual_close = np.array([r in ['take_profit', 'stop_loss'] for r in close_reason_sell])
            if manual_close.any():
                manual_indices = sell_indices[torch.tensor(manual_close, device=device)]
                returns[manual_indices] = (entry_sell[manual_close] / exit_sell[manual_close]) - 1
                outcomes[manual_indices[returns[manual_indices] > 0]] = 1
                outcomes[manual_indices[returns[manual_indices] <= 0]] = 2
            
            tp_sl_indices = sell_indices[~torch.tensor(manual_close, device=device)]
            if len(tp_sl_indices) > 0:
                entry_sell_tp_sl = entry_sell[~manual_close]
                min_sell_tp_sl = min_sell[~manual_close]
                max_sell_tp_sl = max_sell[~manual_close]
                stop_loss_sell_tp_sl = stop_loss_sell[~manual_close]
                
                tp_price = entry_sell_tp_sl * (1 - takeProfit)
                sl_price = entry_sell_tp_sl * (1 + stop_loss_sell_tp_sl)
                
                tp_hit = min_sell_tp_sl <= tp_price
                outcomes[tp_sl_indices[tp_hit]] = 1
                returns[tp_sl_indices[tp_hit]] = takeProfit
                
                sl_hit = (~tp_hit) & (max_sell_tp_sl >= sl_price)
                outcomes[tp_sl_indices[sl_hit]] = 2
                returns[tp_sl_indices[sl_hit]] = -stop_loss_sell_tp_sl[sl_hit]
                
                orig_profit = (~tp_hit) & (~sl_hit) & (min_sell_tp_sl <= entry_sell_tp_sl * 0.99)
                outcomes[tp_sl_indices[orig_profit]] = 1
                returns[tp_sl_indices[orig_profit]] = (entry_sell_tp_sl[orig_profit] / min_sell_tp_sl[orig_profit]) - 1
        
        profitable_pct = (outcomes == 1).float().mean().item()
        num_signals = len(tf_signals)
        avg_return = returns.mean().item() if len(returns) > 0 else 0
        hit_rate = profitable_pct
        loss_rate = (outcomes == 2).float().mean().item()
        
        results[timeframe] = (profitable_pct, num_signals, avg_return, hit_rate, loss_rate)
    
    # Calculate final amount and max drawdown per timeframe
    final_amounts = {}
    max_drawdowns = {}
    last_price = df.iloc[-1]['price']
    for timeframe in ['Daytime', 'Nighttime']:
        if analyzer.state[timeframe]['holding'] == 'LTC':
            final_amounts[timeframe] = analyzer.state[timeframe]['LTC_amount']
        else:
            final_amounts[timeframe] = analyzer.state[timeframe]['USDT_amount'] / last_price
        values = [v for _, v in analyzer.value_history[timeframe]]
        peak = -np.inf
        max_drawdown = 0
        for v in values:
            if v > peak:
                peak = v
            else:
                drawdown = (peak - v) / peak if peak > 0 else 0
                if drawdown > max_drawdown:
                    max_drawdown = drawdown
        max_drawdowns[timeframe] = max_drawdown
    
    return results, final_amounts, max_drawdowns, trade_log

param_combinations = list(itertools.product(absorptionWindows, priceRanges, minLargeOrders, volumeWindows, confirmThresholds, stopLosses, takeProfits))

if __name__ == '__main__':
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Starting grid search with version {VERSION}, {len(param_combinations)} combinations")
    counter = 0
    with mp.Pool(mp.cpu_count()) as pool:
        results = pool.map(evaluate_parameters, param_combinations)
    
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Grid search completed")
    results_data = []
    all_trades = []
    for i, params in enumerate(param_combinations):
        absorptionWindow, priceRange, minLargeOrder, volumeWindow, confirmThreshold, stopLoss, takeProfit = params
        result, final_amounts, max_drawdowns, trade_log = results[i]
        daytime_results, nighttime_results = result['Daytime'], result['Nighttime']
        param_id = str(uuid.uuid4())
        for timeframe, (profitable_pct, num_signals, avg_return, hit_rate, loss_rate) in [('Daytime', daytime_results), ('Nighttime', nighttime_results)]:
            results_data.append({
                'param_id': param_id,
                'timeframe': timeframe,
                'absorptionWindow': absorptionWindow,
                'priceRange': priceRange,
                'minLargeOrder': minLargeOrder,
                'volumeWindow': volumeWindow / (60*1000),
                'confirmThreshold': confirmThreshold,
                'stopLoss': stopLoss,
                'takeProfit': takeProfit,
                'profitable_pct': profitable_pct,
                'num_signals': num_signals,
                'avg_return': avg_return,
                'hit_rate': hit_rate,
                'loss_rate': loss_rate,
                'final_amount': final_amounts[timeframe],
                'max_drawdown': max_drawdowns[timeframe]
            })
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Timeframe: {timeframe}")
            print(f"Params: absorptionWindow={absorptionWindow}s, priceRange={priceRange*100}%, minLargeOrder={minLargeOrder}, "
                  f"volumeWindow={volumeWindow/(60*1000)}min, confirmThreshold={confirmThreshold*100}%, "
                  f"stopLoss={stopLoss*100}% (dynamic to 0.1% on invalidation), takeProfit={takeProfit*100}%")
            print(f"Profitable Signals: {profitable_pct:.2%}, Total Signals: {num_signals}, "
                  f"Avg Return: {avg_return:.4f}, Hit Rate: {hit_rate:.2%}, Loss Rate: {loss_rate:.2%}")
            print(f"Final Amount: {final_amounts[timeframe]:.4f} LTC, Max Drawdown: {max_drawdowns[timeframe]:.2%}")
        # Add trade log with parameter ID
        if not trade_log.empty:
            trade_log['param_id'] = param_id
            all_trades.append(trade_log)
    
    results_df = pd.DataFrame(results_data)
    trades_df = pd.concat(all_trades, ignore_index=True) if all_trades else pd.DataFrame()
    for timeframe in ['Daytime', 'Nighttime']:
        tf_df = results_df[results_df['timeframe'] == timeframe]
        if not tf_df.empty:
            best_result = tf_df.loc[tf_df['avg_return'].idxmax()]
            print(f"\nBest Parameter Combination (Max Average Return) for {timeframe}:")
            print(f"Absorption Window: {best_result['absorptionWindow']} seconds")
            print(f"Price Range: {best_result['priceRange']*100}%")
            print(f"Minimum Large Order: {best_result['minLargeOrder']} LTC")
            print(f"Volume Window: {best_result['volumeWindow']} minutes")
            print(f"Confirmation Threshold: {best_result['confirmThreshold']*100}%")
            print(f"Default Stop Loss: {best_result['stopLoss']*100}% (dynamic to 0.1% on invalidation)")
            print(f"Take Profit: {best_result['takeProfit']*100}%")
            print(f"Percentage of Profitable Signals: {best_result['profitable_pct']:.2%}")
            print(f"Total Number of Signals: {int(best_result['num_signals'])}")
            print(f"Average Return: {best_result['avg_return']:.4f}")
            print(f"Hit Rate: {best_result['hit_rate']:.2%}")
            print(f"Loss Rate: {best_result['loss_rate']:.2%}")
            print(f"Final Amount: {best_result['final_amount']:.4f} LTC")
            print(f"Max Drawdown: {best_result['max_drawdown']:.2%}")
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    results_csv = f"results_{timestamp}.csv"
    trades_csv = f"trades_{timestamp}.csv"
    param_info = (f"Version: {VERSION}, Parameters: absorptionWindows={absorptionWindows}, "
                  f"priceRanges={priceRanges}, minLargeOrders={minLargeOrders}, "
                  f"volumeWindows={[v/(60*1000) for v in volumeWindows]}min, "
                  f"confirmThresholds={confirmThresholds}, stopLosses={stopLosses}, "
                  f"takeProfits={takeProfits}")
    results_df.to_csv(results_csv, index=False)
    with open(results_csv, 'r') as f:
        content = f.read()
    with open(results_csv, 'w') as f:
        f.write(f"# {param_info}\n{content}")
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Results saved to {results_csv}")
    
    if not trades_df.empty:
        trades_df.to_csv(trades_csv, index=False)
        with open(trades_csv, 'r') as f:
            content = f.read()
        with open(trades_csv, 'w') as f:
            f.write(f"# {param_info}\n{content}")
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Trade log saved to {trades_csv}")

    df['sma_short'] = df['price'].rolling(window=10).mean()
    df['sma_long'] = df['price'].rolling(window=50).mean()
    sma_signals = []
    stop_loss = 0.005
    take_profit = 0.01
    active_trade = None
    for i in range(1, len(df)):
        if df['sma_short'].iloc[i-1] < df['sma_long'].iloc[i-1] and df['sma_short'].iloc[i] >= df['sma_long'].iloc[i]:
            if active_trade:
                if active_trade['type'] == 'sell':
                    sma_signals.append({
                        'entry_timestamp': active_trade['timestamp'],
                        'entry_price': active_trade['price'],
                        'exit_timestamp': df['timestamp'].iloc[i],
                        'exit_price': df['price'].iloc[i],
                        'type': active_trade['type'],
                        'index': i,
                        'timeframe': df['timeframe'].iloc[i],
                        'close_reason': 'opposite_signal'
                    })
                    active_trade = None
                else:
                    continue
            active_trade = {'timestamp': df['timestamp'].iloc[i], 'type': 'buy', 'price': df['price'].iloc[i], 'index': i}
        elif df['sma_short'].iloc[i-1] > df['sma_long'].iloc[i-1] and df['sma_short'].iloc[i] <= df['sma_long'].iloc[i]:
            if active_trade:
                if active_trade['type'] == 'buy':
                    sma_signals.append({
                        'entry_timestamp': active_trade['timestamp'],
                        'entry_price': active_trade['price'],
                        'exit_timestamp': df['timestamp'].iloc[i],
                        'exit_price': df['price'].iloc[i],
                        'type': active_trade['type'],
                        'index': i,
                        'timeframe': df['timeframe'].iloc[i],
                        'close_reason': 'opposite_signal'
                    })
                    active_trade = None
                else:
                    continue
            active_trade = {'timestamp': df['timestamp'].iloc[i], 'type': 'sell', 'price': df['price'].iloc[i], 'index': i}
    
    sma_signals = pd.DataFrame(sma_signals)
    if not sma_signals.empty:
        for timeframe in ['Daytime', 'Nighttime']:
            tf_sma_signals = sma_signals[sma_signals['timeframe'] == timeframe]
            if tf_sma_signals.empty:
                continue
            sma_types = tf_sma_signals['type'].values
            entry_prices = torch.tensor(tf_sma_signals['entry_price'].values, dtype=torch.float32, device=device)
            exit_prices = torch.tensor(tf_sma_signals['exit_price'].values, dtype=torch.float32, device=device)
            sma_indices = tf_sma_signals['index'].values
            close_reasons = tf_sma_signals['close_reason'].values
            
            sma_trade_data = df.loc[sma_indices, ['max_price_2h', 'min_price_2h']].values
            sma_max_prices = torch.tensor(sma_trade_data[:, 0], dtype=torch.float32, device=device)
            sma_min_prices = torch.tensor(sma_trade_data[:, 1], dtype=torch.float32, device=device)
            
            sma_outcomes = torch.zeros(len(tf_sma_signals), dtype=torch.int32, device=device)
            sma_returns = torch.zeros(len(tf_sma_signals), dtype=torch.float32, device=device)
            
            buy_mask = np.array([t == 'buy' for t in sma_types])
            if buy_mask.any():
                buy_indices = torch.tensor(np.where(buy_mask)[0], device=device)
                entry_buy = entry_prices[buy_indices]
                exit_buy = exit_prices[buy_indices]
                max_buy = sma_max_prices[buy_indices]
                min_buy = sma_min_prices[buy_indices]
                close_reason_buy = close_reasons[buy_mask]
                
                manual_close = np.array([r in ['opposite_signal'] for r in close_reason_buy])
                if manual_close.any():
                    manual_indices = buy_indices[torch.tensor(manual_close, device=device)]
                    sma_returns[manual_indices] = (exit_buy[manual_close] / entry_buy[manual_close]) - 1
                    sma_outcomes[manual_indices[sma_returns[manual_indices] > 0]] = 1
                    sma_outcomes[manual_indices[sma_returns[manual_indices] <= 0]] = 2
                
                tp_sl_indices = buy_indices[~torch.tensor(manual_close, device=device)]
                if len(tp_sl_indices) > 0:
                    entry_buy_tp_sl = entry_buy[~manual_close]
                    max_buy_tp_sl = max_buy[~manual_close]
                    min_buy_tp_sl = min_buy[~manual_close]
                    
                    tp_price = entry_buy_tp_sl * (1 + take_profit)
                    sl_price = entry_buy_tp_sl * (1 - stop_loss)
                    
                    tp_hit = max_buy_tp_sl >= tp_price
                    sma_outcomes[tp_sl_indices[tp_hit]] = 1
                    sma_returns[tp_sl_indices[tp_hit]] = take_profit
                    
                    sl_hit = (~tp_hit) & (min_buy_tp_sl <= sl_price)
                    sma_outcomes[tp_sl_indices[sl_hit]] = 2
                    sma_returns[tp_sl_indices[sl_hit]] = -stop_loss
                    
                    orig_profit = (~tp_hit) & (~sl_hit) & (max_buy_tp_sl >= entry_buy_tp_sl * 1.01)
                    sma_outcomes[tp_sl_indices[orig_profit]] = 1
                    sma_returns[tp_sl_indices[orig_profit]] = (max_buy_tp_sl[orig_profit] / entry_buy_tp_sl[orig_profit]) - 1
            
            sell_mask = np.array([t == 'sell' for t in sma_types])
            if sell_mask.any():
                sell_indices = torch.tensor(np.where(sell_mask)[0], device=device)
                entry_sell = entry_prices[sell_indices]
                exit_sell = exit_prices[sell_indices]
                min_sell = sma_min_prices[sell_indices]
                max_sell = sma_max_prices[sell_indices]
                close_reason_sell = close_reasons[sell_mask]
                
                manual_close = np.array([r in ['opposite_signal'] for r in close_reason_sell])
                if manual_close.any():
                    manual_indices = sell_indices[torch.tensor(manual_close, device=device)]
                    sma_returns[manual_indices] = (entry_sell[manual_close] / exit_sell[manual_close]) - 1
                    sma_outcomes[manual_indices[sma_returns[manual_indices] > 0]] = 1
                    sma_outcomes[manual_indices[sma_returns[manual_indices] <= 0]] = 2
                
                tp_sl_indices = sell_indices[~torch.tensor(manual_close, device=device)]
                if len(tp_sl_indices) > 0:
                    entry_sell_tp_sl = entry_sell[~manual_close]
                    min_sell_tp_sl = min_sell[~manual_close]
                    max_sell_tp_sl = max_sell[~manual_close]
                    
                    tp_price = entry_sell_tp_sl * (1 - take_profit)
                    sl_price = entry_sell_tp_sl * (1 + stop_loss)
                    
                    tp_hit = min_sell_tp_sl <= tp_price
                    sma_outcomes[tp_sl_indices[tp_hit]] = 1
                    sma_returns[tp_sl_indices[tp_hit]] = take_profit
                    
                    sl_hit = (~tp_hit) & (max_sell_tp_sl >= sl_price)
                    sma_outcomes[tp_sl_indices[sl_hit]] = 2
                    sma_returns[tp_sl_indices[sl_hit]] = -stop_loss
                    
                    orig_profit = (~tp_hit) & (~sl_hit) & (min_sell_tp_sl <= entry_sell_tp_sl * 0.99)
                    sma_outcomes[tp_sl_indices[orig_profit]] = 1
                    sma_returns[tp_sl_indices[orig_profit]] = (entry_sell_tp_sl[orig_profit] / min_sell_tp_sl[orig_profit]) - 1
            
            sma_profitable_pct = (sma_outcomes == 1).float().mean().item()
            sma_avg_return = sma_returns.mean().item() if len(sma_returns) > 0 else 0
            sma_hit_rate = sma_profitable_pct
            sma_loss_rate = (sma_outcomes == 2).float().mean().item()
            
            print(f"\n[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Baseline (SMA Crossover with SL={stop_loss*100}% and TP={take_profit*100}%) for {timeframe}:")
            print(f"Profitable Signals: {sma_profitable_pct:.2%}, Avg Return: {sma_avg_return:.4f}, "
                  f"Hit Rate: {sma_hit_rate:.2%}, Loss Rate: {sma_loss_rate:.2%}")
    else:
        print(f"\n[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] No SMA crossover signals generated.")
