import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from datetime import datetime

# Load the CSV file (update path as needed)
csv_file = 'ltcusdt_price_level_imbalance_flow_3000_prox_0.1.csv'
df = pd.read_csv(csv_file)

# Convert trade_time (ms) to datetime
df['trade_datetime'] = pd.to_datetime(df['trade_time'], unit='ms')

# Plot 1: All Trades Over Time
plt.figure(figsize=(12, 6))

# Plot buy signals
buy_tp = df[(df['trade_type'] == 'buy') & (df['outcome'] == 'TP First')]
buy_sl = df[(df['trade_type'] == 'buy') & (df['outcome'] == 'SL First')]
sell_tp = df[(df['trade_type'] == 'sell') & (df['outcome'] == 'TP First')]
sell_sl = df[(df['trade_type'] == 'sell') & (df['outcome'] == 'SL First')]

plt.scatter(buy_tp['trade_datetime'], [1] * len(buy_tp), color='blue', marker='o', label='Buy TP', s=100)
plt.scatter(buy_sl['trade_datetime'], [1] * len(buy_sl), color='blue', marker='x', label='Buy SL', s=100)
plt.scatter(sell_tp['trade_datetime'], [0] * len(sell_tp), color='red', marker='o', label='Sell TP', s=100)
plt.scatter(sell_sl['trade_datetime'], [0] * len(sell_sl), color='red', marker='x', label='Sell SL', s=100)

plt.title('Trade Outcomes Over Time for LTCUSDT')
plt.xlabel('Trade Time')
plt.ylabel('Trade Type (1=Buy, 0=Sell)')
plt.legend()
plt.gca().xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m-%d %H:%M'))
plt.gca().xaxis.set_major_locator(mdates.AutoDateLocator())
plt.xticks(rotation=45)
plt.tight_layout()
plt.savefig('trades_over_time.png')
plt.close()

# Plot 2: Trades Grouped by Day of Week
# Ensure days are ordered
day_order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
df['day_of_week'] = pd.Categorical(df['day_of_week'], categories=day_order, ordered=True)

# Group by day of week, trade type, and outcome
grouped = df.groupby(['day_of_week', 'trade_type', 'outcome']).size().unstack(fill_value=0).unstack(fill_value=0)

plt.figure(figsize=(12, 6))

# Plot stacked bars
bar_width = 0.35
days = day_order
x = range(len(days))

# Buy trades
buy_tp_counts = grouped[('TP First', 'buy')] if ('TP First', 'buy') in grouped else [0] * len(days)
buy_sl_counts = grouped[('SL First', 'buy')] if ('SL First', 'buy') in grouped else [0] * len(days)
plt.bar(x, buy_tp_counts, bar_width, label='Buy TP', color='blue')
plt.bar(x, buy_sl_counts, bar_width, bottom=buy_tp_counts, label='Buy SL', color='lightblue')

# Sell trades
sell_tp_counts = grouped[('TP First', 'sell')] if ('TP First', 'sell') in grouped else [0] * len(days)
sell_sl_counts = grouped[('SL First', 'sell')] if ('SL First', 'sell') in grouped else [0] * len(days)
plt.bar([i + bar_width for i in x], sell_tp_counts, bar_width, label='Sell TP', color='red')
plt.bar([i + bar_width for i in x], sell_sl_counts, bar_width, bottom=sell_tp_counts, label='Sell SL', color='pink')

plt.title('Trade Outcomes by Day of Week for LTCUSDT')
plt.xlabel('Day of Week')
plt.ylabel('Number of Trades')
plt.xticks([i + bar_width / 2 for i in x], days, rotation=45)
plt.legend()
plt.tight_layout()
plt.savefig('trades_by_day_of_week.png')
plt.close()