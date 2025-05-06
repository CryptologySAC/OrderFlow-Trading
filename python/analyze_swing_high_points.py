import pandas as pd
import sqlite3
import matplotlib.pyplot as plt
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA
import seaborn as sns

# Load HP data from CSV (assumes 'high_time' column with timestamps)
hp_df = pd.read_csv('swing_high_low_pairs_filtered_v1.1.csv')
hp_times = hp_df['high_time']

# Connect to SQLite database
DB_PATH = '../trades.db'
conn = sqlite3.connect(DB_PATH)

# Define timeframes in seconds
timeframes = {
    'long': 600,   # 10 minutes
    'medium': 180, # 3 minutes
    'short': 40    # 40 seconds
}

# Function to fetch trades between two timestamps from database
def fetch_trades_between(conn, start_time, end_time):
    start_ms = int(start_time.timestamp() * 1000)
    end_ms = int(end_time.timestamp() * 1000)
    query = """
    SELECT tradeTime, price, quantity, isBuyerMaker
    FROM aggregated_trades
    WHERE tradeTime >= ? AND tradeTime <= ?
    """
    df = pd.read_sql_query(query, conn, params=(start_ms, end_ms))
    return df

# Function to compute imbalance features for a set of trades
def compute_features(trades):
    if trades.empty:
        return 0, 0, 0
    buy_trades = trades[trades['isBuyerMaker'] == 0]
    sell_trades = trades[trades['isBuyerMaker'] == 1]
    
    # Volume
    buy_volume = buy_trades['quantity'].sum()
    sell_volume = sell_trades['quantity'].sum()
    total_volume = buy_volume + sell_volume
    delta_volume = buy_volume - sell_volume
    volume_imbalance = delta_volume / total_volume if total_volume > 0 else 0
    
    # Value
    buy_value = (buy_trades['quantity'] * buy_trades['price']).sum()
    sell_value = (sell_trades['quantity'] * sell_trades['price']).sum()
    total_value = buy_value + sell_value
    delta_value = buy_value - sell_value
    value_imbalance = delta_value / total_value if total_value > 0 else 0
    
    # Quantity (number of trades)
    buy_trades_count = len(buy_trades)
    sell_trades_count = len(sell_trades)
    total_trades = buy_trades_count + sell_trades_count
    delta_trades = buy_trades_count - sell_trades_count
    trades_imbalance = delta_trades / total_trades if total_trades > 0 else 0
    
    return volume_imbalance, value_imbalance, trades_imbalance

# Compute features for all HPs
features_list = []
for hp_time_str in hp_times:
    hp_time_dt = pd.to_datetime(hp_time_str)
    features = {}
    for tf_name, tf_seconds in timeframes.items():
        start_time = hp_time_dt - pd.Timedelta(seconds=tf_seconds)
        trades = fetch_trades_between(conn, start_time, hp_time_dt)
        vol_imb, val_imb, trd_imb = compute_features(trades)
        features[f'{tf_name}_volume_imbalance'] = vol_imb
        features[f'{tf_name}_value_imbalance'] = val_imb
        features[f'{tf_name}_trades_imbalance'] = trd_imb
    features_list.append(features)

# Create features DataFrame
features_df = pd.DataFrame(features_list)

# Standardize features for clustering
scaler = StandardScaler()
X_scaled = scaler.fit_transform(features_df)

# Apply K-means clustering
kmeans = KMeans(n_clusters=3, random_state=0)
clusters = kmeans.fit_predict(X_scaled)
features_df['cluster'] = clusters
hp_df['cluster'] = clusters

# Visualization 1: PCA plot of clusters
pca = PCA(n_components=2)
X_pca = pca.fit_transform(X_scaled)
plt.figure(figsize=(8, 6))
plt.scatter(X_pca[:, 0], X_pca[:, 1], c=clusters, cmap='viridis')
plt.title('HP Clusters (PCA Reduced)')
plt.xlabel('PCA Component 1')
plt.ylabel('PCA Component 2')
plt.colorbar(label='Cluster')
plt.savefig('hp_clusters_pca.png')
plt.close()

# Visualization 2: Distribution of imbalances by timeframe
fig, axes = plt.subplots(3, 3, figsize=(15, 10))
fig.suptitle('Imbalance Distributions Across Timeframes')
for i, tf in enumerate(['long', 'medium', 'short']):
    for j, feat in enumerate(['volume_imbalance', 'value_imbalance', 'trades_imbalance']):
        col = f'{tf}_{feat}'
        axes[i, j].hist(features_df[col], bins=20, color='skyblue')
        axes[i, j].set_title(f'{tf} {feat}')
        axes[i, j].set_xlabel('Imbalance')
        axes[i, j].set_ylabel('Frequency')
plt.tight_layout(rect=[0, 0, 1, 0.95])
plt.savefig('imbalance_distributions.png')
plt.close()

# Visualization 3: Clusters over time
hp_df['high_time_dt'] = pd.to_datetime(hp_df['high_time'])
plt.figure(figsize=(12, 6))
plt.scatter(hp_df['high_time_dt'], hp_df['cluster'], c=hp_df['cluster'], cmap='viridis')
plt.title('HP Clusters Distributed Over Time')
plt.xlabel('Time')
plt.ylabel('Cluster')
plt.colorbar(label='Cluster')
plt.savefig('clusters_over_time.png')
plt.close()

# Visualization 4: Box plot of imbalances by cluster
plt.figure(figsize=(12, 8))
for i, tf in enumerate(['long', 'medium', 'short']):
    for j, feat in enumerate(['volume_imbalance', 'value_imbalance', 'trades_imbalance']):
        col = f'{tf}_{feat}'
        plt.subplot(3, 3, i * 3 + j + 1)
        sns.boxplot(x='cluster', y=col, data=features_df)
        plt.title(f'{tf} {feat}')
plt.tight_layout()
plt.savefig('imbalances_by_cluster.png')
plt.close()

print("Analysis complete. Visualizations saved as PNG files.")