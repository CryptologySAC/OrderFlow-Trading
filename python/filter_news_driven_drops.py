import pandas as pd

# Configuration
CSV_PATH = "swing_high_low_pairs_async_v1.1.csv"
OUTPUT_CSV_PATH = "swing_high_low_pairs_filtered_v1.1.csv"
PERCENTILE_THRESHOLD = 95  # Exclude top 5% (above 95th percentile)

def filter_news_driven_drops():
    """Filter out the top 5% of HP-to-LP drops assumed to be news-driven."""
    try:
        # Load pairs
        pairs_df = pd.read_csv(CSV_PATH)
        print(f"Loaded {len(pairs_df)} pairs from {CSV_PATH}.")

        # Sort by price_drop_percent in descending order
        pairs_df_sorted = pairs_df.sort_values(by='price_drop_percent', ascending=False)

        # Calculate the 95th percentile threshold
        threshold = pairs_df_sorted['price_drop_percent'].quantile(PERCENTILE_THRESHOLD / 100)
        print(f"95th percentile drop threshold: {threshold:.2f}%")

        # Filter out the top 5% (drops above the 95th percentile)
        filtered_pairs_df = pairs_df_sorted[pairs_df_sorted['price_drop_percent'] <= threshold]
        print(f"Filtered to {len(filtered_pairs_df)} pairs (excluded top 5% with drops > {threshold:.2f}%).")

        # Save filtered pairs to a new CSV
        filtered_pairs_df.to_csv(OUTPUT_CSV_PATH, index=False)
        print(f"Filtered pairs saved to '{OUTPUT_CSV_PATH}'.")

    except Exception as e:
        print(f"Error during filtering: {e}")

if __name__ == "__main__":
    filter_news_driven_drops()