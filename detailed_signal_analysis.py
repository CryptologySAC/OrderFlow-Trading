#!/usr/bin/env python3
"""
Detailed Signal Analysis: Deep dive into TP/SL patterns and correlations
"""

import pandas as pd
import numpy as np
from scipy import stats
import warnings
warnings.filterwarnings('ignore')

def detailed_absorption_analysis():
    """Deep analysis of absorption detector patterns"""
    print("="*80)
    print("DETAILED ABSORPTION DETECTOR ANALYSIS")
    print("="*80)
    
    df = pd.read_csv('/Users/marcschot/Projects/OrderFlow Trading/logs/signal_validation/absorption_successful_2025-08-09.csv')
    
    tp_signals = df[df['TP_SL'] == 'TP']
    sl_signals = df[df['TP_SL'] == 'SL']
    
    print(f"\nDataset: {len(df)} total signals")
    print(f"TP Signals: {len(tp_signals)} ({len(tp_signals)/len(df)*100:.1f}%)")
    print(f"SL Signals: {len(sl_signals)} ({len(sl_signals)/len(df)*100:.1f}%)")
    
    # Confidence level detailed analysis
    print(f"\n📊 CONFIDENCE LEVEL DEEP DIVE:")
    confidence_bins = np.arange(0.5, 1.01, 0.05)
    for i in range(len(confidence_bins)-1):
        low, high = confidence_bins[i], confidence_bins[i+1]
        mask = (df['confidence'] >= low) & (df['confidence'] < high)
        subset = df[mask]
        
        if len(subset) > 0:
            tp_count = len(subset[subset['TP_SL'] == 'TP'])
            sl_count = len(subset[subset['TP_SL'] == 'SL'])
            total_decisive = tp_count + sl_count
            
            if total_decisive > 0:
                success_rate = tp_count / total_decisive * 100
                print(f"  {low:.2f}-{high:.2f}: {len(subset):>2} signals, {success_rate:>5.1f}% success ({tp_count}TP/{sl_count}SL)")
    
    # Volume analysis
    print(f"\n📈 VOLUME THRESHOLD ANALYSIS:")
    volume_params = ['minAggVolume', 'institutionalVolumeThreshold']
    
    for param in volume_params:
        tp_values = tp_signals[param]
        sl_values = sl_signals[param]
        
        tp_percentiles = np.percentile(tp_values, [25, 50, 75])
        sl_percentiles = np.percentile(sl_values, [25, 50, 75])
        
        print(f"\n  {param}:")
        print(f"    TP: Q25={tp_percentiles[0]:.0f}, Q50={tp_percentiles[1]:.0f}, Q75={tp_percentiles[2]:.0f}")
        print(f"    SL: Q25={sl_percentiles[0]:.0f}, Q50={sl_percentiles[1]:.0f}, Q75={sl_percentiles[2]:.0f}")
        
        # Find optimal threshold
        combined_values = np.concatenate([tp_values, sl_values])
        labels = np.concatenate([np.ones(len(tp_values)), np.zeros(len(sl_values))])
        
        # Test different thresholds
        thresholds = np.percentile(combined_values, [10, 25, 50, 75, 90])
        best_threshold = None
        best_score = -1
        
        for threshold in thresholds:
            above_threshold = combined_values >= threshold
            tp_above = np.sum(labels[above_threshold])
            total_above = np.sum(above_threshold)
            
            if total_above > 5:  # Minimum sample size
                precision = tp_above / total_above if total_above > 0 else 0
                if precision > best_score:
                    best_score = precision
                    best_threshold = threshold
        
        if best_threshold is not None:
            print(f"    Optimal threshold: {best_threshold:.0f} (precision: {best_score:.3f})")
    
    # Price efficiency analysis
    print(f"\n🎯 PRICE EFFICIENCY ANALYSIS:")
    tp_pe = tp_signals['priceEfficiencyThreshold']
    sl_pe = sl_signals['priceEfficiencyThreshold']
    
    print(f"  TP Price Efficiency: mean={tp_pe.mean():.6f}, std={tp_pe.std():.6f}")
    print(f"  SL Price Efficiency: mean={sl_pe.mean():.6f}, std={sl_pe.std():.6f}")
    
    # Movement correlation analysis
    print(f"\n📊 MOVEMENT CORRELATION ANALYSIS:")
    movement_cols = ['subsequentMovement5min', 'subsequentMovement15min', 'subsequentMovement1hr']
    
    for col in movement_cols:
        if col in df.columns:
            # Calculate correlation with confidence
            correlation_conf = df[['confidence', col]].corr().iloc[0,1]
            correlation_vol = df[['minAggVolume', col]].corr().iloc[0,1]
            
            print(f"  {col}:")
            print(f"    Correlation with confidence: {correlation_conf:.4f}")
            print(f"    Correlation with minAggVolume: {correlation_vol:.4f}")
            
            # Success by movement magnitude
            df['abs_movement'] = abs(df[col])
            high_movement = df[df['abs_movement'] > df['abs_movement'].quantile(0.75)]
            low_movement = df[df['abs_movement'] <= df['abs_movement'].quantile(0.25)]
            
            high_success = len(high_movement[high_movement['TP_SL'] == 'TP']) / len(high_movement[high_movement['TP_SL'].isin(['TP', 'SL'])]) * 100
            low_success = len(low_movement[low_movement['TP_SL'] == 'TP']) / len(low_movement[low_movement['TP_SL'].isin(['TP', 'SL'])]) * 100
            
            print(f"    High movement signals ({high_movement['abs_movement'].min():.4f}+): {high_success:.1f}% success")
            print(f"    Low movement signals (≤{low_movement['abs_movement'].max():.4f}): {low_success:.1f}% success")

def time_based_analysis():
    """Analyze temporal patterns in signal performance"""
    print(f"\n⏰ TEMPORAL PATTERN ANALYSIS:")
    
    df = pd.read_csv('/Users/marcschot/Projects/OrderFlow Trading/logs/signal_validation/absorption_successful_2025-08-09.csv')
    
    # Convert timestamp to datetime
    df['datetime'] = pd.to_datetime(df['timestamp'], unit='ms')
    df['hour'] = df['datetime'].dt.hour
    df['minute_of_hour'] = df['datetime'].dt.minute
    
    print(f"\n  Signal Distribution by Hour:")
    hourly_performance = []
    
    for hour in range(24):
        hour_data = df[df['hour'] == hour]
        if len(hour_data) > 0:
            tp_count = len(hour_data[hour_data['TP_SL'] == 'TP'])
            sl_count = len(hour_data[hour_data['TP_SL'] == 'SL'])
            total_decisive = tp_count + sl_count
            
            if total_decisive > 0:
                success_rate = tp_count / total_decisive * 100
                hourly_performance.append((hour, len(hour_data), success_rate, tp_count, sl_count))
                print(f"    Hour {hour:>2}: {len(hour_data):>2} signals, {success_rate:>5.1f}% success ({tp_count}TP/{sl_count}SL)")
    
    # Find best and worst performing hours
    if hourly_performance:
        best_hour = max(hourly_performance, key=lambda x: x[2])
        worst_hour = min(hourly_performance, key=lambda x: x[2])
        
        print(f"\n  Best performing hour: {best_hour[0]}:00 ({best_hour[2]:.1f}% success)")
        print(f"  Worst performing hour: {worst_hour[0]}:00 ({worst_hour[2]:.1f}% success)")

def clustering_analysis():
    """Identify signal clusters and patterns"""
    print(f"\n🔍 SIGNAL CLUSTERING ANALYSIS:")
    
    df = pd.read_csv('/Users/marcschot/Projects/OrderFlow Trading/logs/signal_validation/absorption_successful_2025-08-09.csv')
    
    # Price level clustering
    price_bins = np.arange(df['price'].min(), df['price'].max() + 0.5, 0.5)
    
    print(f"  Price Level Performance:")
    for i in range(len(price_bins)-1):
        low, high = price_bins[i], price_bins[i+1]
        price_subset = df[(df['price'] >= low) & (df['price'] < high)]
        
        if len(price_subset) >= 3:  # Minimum sample size
            tp_count = len(price_subset[price_subset['TP_SL'] == 'TP'])
            sl_count = len(price_subset[price_subset['TP_SL'] == 'SL'])
            total_decisive = tp_count + sl_count
            
            if total_decisive > 0:
                success_rate = tp_count / total_decisive * 100
                print(f"    ${low:.1f}-${high:.1f}: {len(price_subset):>2} signals, {success_rate:>5.1f}% success")
    
    # Signal clustering by parameters
    print(f"\n  Parameter-based Signal Clusters:")
    
    # High confidence, low volume cluster
    high_conf_low_vol = df[(df['confidence'] > 0.7) & (df['minAggVolume'] < df['minAggVolume'].median())]
    if len(high_conf_low_vol) > 0:
        tp_rate = len(high_conf_low_vol[high_conf_low_vol['TP_SL'] == 'TP']) / len(high_conf_low_vol[high_conf_low_vol['TP_SL'].isin(['TP', 'SL'])]) * 100
        print(f"    High Confidence + Low Volume: {len(high_conf_low_vol)} signals, {tp_rate:.1f}% success")
    
    # Low confidence, high volume cluster
    low_conf_high_vol = df[(df['confidence'] < 0.6) & (df['minAggVolume'] > df['minAggVolume'].median())]
    if len(low_conf_high_vol) > 0:
        tp_rate = len(low_conf_high_vol[low_conf_high_vol['TP_SL'] == 'TP']) / len(low_conf_high_vol[low_conf_high_vol['TP_SL'].isin(['TP', 'SL'])]) * 100
        print(f"    Low Confidence + High Volume: {len(low_conf_high_vol)} signals, {tp_rate:.1f}% success")

def generate_specific_recommendations():
    """Generate specific, actionable optimization recommendations"""
    print(f"\n" + "="*80)
    print("SPECIFIC OPTIMIZATION RECOMMENDATIONS")
    print("="*80)
    
    df = pd.read_csv('/Users/marcschot/Projects/OrderFlow Trading/logs/signal_validation/absorption_successful_2025-08-09.csv')
    tp_signals = df[df['TP_SL'] == 'TP']
    sl_signals = df[df['TP_SL'] == 'SL']
    
    print(f"\n🎯 IMMEDIATE PARAMETER ADJUSTMENTS:")
    
    # Confidence threshold
    high_confidence = df[df['confidence'] >= 0.7]
    high_conf_tp_rate = len(high_confidence[high_confidence['TP_SL'] == 'TP']) / len(high_confidence[high_confidence['TP_SL'].isin(['TP', 'SL'])]) * 100
    
    print(f"1. CONFIDENCE THRESHOLD:")
    print(f"   • Current distribution: TP mean = {tp_signals['confidence'].mean():.3f}")
    print(f"   • High confidence (≥0.7) signals have {high_conf_tp_rate:.1f}% success rate")
    print(f"   • RECOMMENDATION: Set minimum confidence threshold to 0.70")
    print(f"   • Expected impact: Filter out {len(df[df['confidence'] < 0.7])} low-quality signals")
    
    # Volume thresholds
    tp_vol_75th = tp_signals['minAggVolume'].quantile(0.75)
    print(f"\n2. VOLUME THRESHOLD:")
    print(f"   • TP signals 75th percentile volume: {tp_vol_75th:.0f}")
    print(f"   • RECOMMENDATION: Set maximum minAggVolume to {tp_vol_75th:.0f}")
    print(f"   • Rationale: TP signals consistently have lower volume requirements")
    
    # Price efficiency
    tp_pe_mean = tp_signals['priceEfficiencyThreshold'].mean()
    print(f"\n3. PRICE EFFICIENCY THRESHOLD:")
    print(f"   • TP signals average: {tp_pe_mean:.6f}")
    print(f"   • RECOMMENDATION: Target priceEfficiencyThreshold around {tp_pe_mean:.6f}")
    
    # Passive multiplier
    tp_passive_mean = tp_signals['minPassiveMultiplier'].mean()
    print(f"\n4. PASSIVE MULTIPLIER:")
    print(f"   • TP signals average: {tp_passive_mean:.1f}")
    print(f"   • RECOMMENDATION: Increase minPassiveMultiplier to {tp_passive_mean:.1f}")
    print(f"   • Impact: Focus on signals with stronger passive absorption patterns")
    
    print(f"\n🔧 CONFIGURATION CHANGES:")
    print(f"   Update config.json with:")
    print(f"   {{")
    print(f"     \"finalConfidenceRequired\": 0.70,")
    print(f"     \"maxMinAggVolume\": {tp_vol_75th:.0f},")
    print(f"     \"targetPriceEfficiency\": {tp_pe_mean:.6f},")
    print(f"     \"minPassiveMultiplier\": {tp_passive_mean:.1f}")
    print(f"   }}")
    
    # Expected improvement
    # Simulate filtering with new thresholds
    filtered_df = df[
        (df['confidence'] >= 0.70) &
        (df['minAggVolume'] <= tp_vol_75th) &
        (df['minPassiveMultiplier'] >= tp_passive_mean * 0.8)  # Allow some tolerance
    ]
    
    if len(filtered_df) > 0:
        filtered_tp = len(filtered_df[filtered_df['TP_SL'] == 'TP'])
        filtered_sl = len(filtered_df[filtered_df['TP_SL'] == 'SL'])
        filtered_total = filtered_tp + filtered_sl
        
        if filtered_total > 0:
            new_success_rate = filtered_tp / filtered_total * 100
            current_success_rate = len(tp_signals) / (len(tp_signals) + len(sl_signals)) * 100
            
            print(f"\n📈 EXPECTED IMPROVEMENT:")
            print(f"   • Current success rate: {current_success_rate:.1f}%")
            print(f"   • Projected success rate: {new_success_rate:.1f}%")
            print(f"   • Signal volume reduction: {len(df)} → {len(filtered_df)} ({len(filtered_df)/len(df)*100:.1f}%)")
            print(f"   • Quality improvement: {new_success_rate - current_success_rate:+.1f} percentage points")

def main():
    """Run detailed analysis"""
    detailed_absorption_analysis()
    time_based_analysis()
    clustering_analysis()
    generate_specific_recommendations()

if __name__ == "__main__":
    main()