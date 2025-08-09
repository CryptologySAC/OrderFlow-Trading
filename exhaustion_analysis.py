#!/usr/bin/env python3
"""
Exhaustion Detector Analysis: Performance metrics and swing timing analysis
"""

import pandas as pd
import numpy as np
from scipy import stats
import warnings
warnings.filterwarnings('ignore')

def analyze_exhaustion_signals():
    """Comprehensive analysis of exhaustion detector signals"""
    print("="*80)
    print("EXHAUSTION DETECTOR ANALYSIS")
    print("="*80)
    
    # Load exhaustion successful data
    try:
        df = pd.read_csv('/Users/marcschot/Projects/OrderFlow Trading/logs/signal_validation/exhaustion_successful_2025-08-09.csv')
        print(f"✓ Exhaustion signals loaded: {len(df)} records")
    except Exception as e:
        print(f"✗ Error loading exhaustion data: {e}")
        return None
    
    # Basic statistics
    print(f"\n📊 SIGNAL OUTCOME DISTRIBUTION:")
    tp_count = len(df[df['TP_SL'] == 'TP'])
    sl_count = len(df[df['TP_SL'] == 'SL'])
    neither_count = len(df[df['TP_SL'] == 'NEITHER'])
    
    print(f"  Take Profit (TP): {tp_count} ({tp_count/len(df)*100:.1f}%)")
    print(f"  Stop Loss (SL): {sl_count} ({sl_count/len(df)*100:.1f}%)")
    print(f"  Neither: {neither_count} ({neither_count/len(df)*100:.1f}%)")
    print(f"  Total Signals: {len(df)}")
    
    # Success rate
    if tp_count + sl_count > 0:
        success_rate = tp_count / (tp_count + sl_count) * 100
        print(f"\n🎯 SUCCESS RATE (TP/(TP+SL)): {success_rate:.1f}%")
    
    # Parameter analysis
    print(f"\n📈 PARAMETER ANALYSIS (TP vs SL):")
    
    tp_signals = df[df['TP_SL'] == 'TP']
    sl_signals = df[df['TP_SL'] == 'SL']
    
    if len(tp_signals) > 0 and len(sl_signals) > 0:
        # Key parameters
        key_params = ['confidence', 'exhaustionScore', 'volumeImbalanceRatio', 'volumeDepletionRate']
        
        print(f"{'Parameter':<25} {'TP Mean':<12} {'SL Mean':<12} {'Difference':<12}")
        print("-" * 65)
        
        for param in key_params:
            if param in df.columns:
                tp_mean = tp_signals[param].mean()
                sl_mean = sl_signals[param].mean()
                difference = tp_mean - sl_mean
                
                print(f"{param:<25} {tp_mean:<12.4f} {sl_mean:<12.4f} {difference:<12.4f}")
    
    # Confidence distribution
    print(f"\n📊 CONFIDENCE DISTRIBUTION:")
    confidence_ranges = [
        (0.0, 0.6, "Low (0.0-0.6)"),
        (0.6, 0.65, "Medium (0.6-0.65)"),
        (0.65, 0.7, "High (0.65-0.7)"),
        (0.7, 0.75, "Very High (0.7-0.75)"),
        (0.75, 1.0, "Extreme (0.75+)")
    ]
    
    for low, high, label in confidence_ranges:
        mask = (df['confidence'] >= low) & (df['confidence'] < high)
        subset = df[mask]
        if len(subset) > 0:
            tp_in_range = len(subset[subset['TP_SL'] == 'TP'])
            sl_in_range = len(subset[subset['TP_SL'] == 'SL'])
            total_in_range = tp_in_range + sl_in_range
            
            if total_in_range > 0:
                success_rate = tp_in_range / total_in_range * 100
                print(f"  {label:<20}: {len(subset):>3} signals, {success_rate:.1f}% success ({tp_in_range} TP / {sl_in_range} SL)")
    
    return df

def analyze_exhaustion_swing_timing(df):
    """Analyze exhaustion signals relative to swing highs/lows"""
    print("\n" + "="*80)
    print("EXHAUSTION SWING TIMING ANALYSIS")
    print("="*80)
    
    if df is None or len(df) == 0:
        print("No data available for timing analysis")
        return None
    
    # Convert timestamp to datetime
    df['datetime'] = pd.to_datetime(df['timestamp'], unit='ms')
    df['hour'] = df['datetime'].dt.hour
    
    # Categorize signals by timing
    results = []
    for idx, row in df.iterrows():
        price = row['price']
        
        # Get price movements
        movement_5min = row.get('subsequentMovement5min', 0)
        movement_15min = row.get('subsequentMovement15min', 0)
        movement_1hr = row.get('subsequentMovement1hr', 0)
        
        # Exhaustion signals should catch tops/bottoms where liquidity is depleted
        # Similar logic to absorption but exhaustion focuses on depletion not absorption
        timing_category = None
        signal_side = None
        
        if movement_5min > 0.002:  # Price went up after signal
            signal_side = 'buy'
            if movement_15min > 0.003:  # Continued upward
                timing_category = 'AT_EXHAUSTION_BOTTOM'  # Caught bottom exhaustion
            else:
                timing_category = 'FALSE_BOTTOM'
        elif movement_5min < -0.002:  # Price went down after signal
            signal_side = 'sell'
            if movement_15min < -0.003:  # Continued downward
                timing_category = 'AT_EXHAUSTION_TOP'  # Caught top exhaustion
            else:
                timing_category = 'FALSE_TOP'
        else:  # Minimal movement
            if movement_15min > 0.002:
                signal_side = 'buy'
                timing_category = 'LATE_BOTTOM'
            elif movement_15min < -0.002:
                signal_side = 'sell'
                timing_category = 'LATE_TOP'
            else:
                signal_side = 'neutral'
                timing_category = 'SIDEWAYS'
        
        results.append({
            'timestamp': row['timestamp'],
            'price': price,
            'confidence': row['confidence'],
            'exhaustionScore': row.get('exhaustionScore', 0),
            'volumeImbalanceRatio': row.get('volumeImbalanceRatio', 0),
            'hour': row['hour'],
            'TP_SL': row['TP_SL'],
            'timing_category': timing_category,
            'signal_side': signal_side,
            'movement_5min': movement_5min,
            'movement_15min': movement_15min,
            'movement_1hr': movement_1hr
        })
    
    results_df = pd.DataFrame(results)
    
    # Timing distribution
    print(f"\n📊 OVERALL TIMING DISTRIBUTION:")
    timing_counts = results_df['timing_category'].value_counts()
    for category, count in timing_counts.items():
        pct = count / len(results_df) * 100
        print(f"  {category}: {count} ({pct:.1f}%)")
    
    # Group categories
    at_exhaustion = results_df[results_df['timing_category'].isin(['AT_EXHAUSTION_BOTTOM', 'AT_EXHAUSTION_TOP'])]
    late_signals = results_df[results_df['timing_category'].isin(['LATE_BOTTOM', 'LATE_TOP'])]
    false_signals = results_df[results_df['timing_category'].isin(['FALSE_BOTTOM', 'FALSE_TOP'])]
    sideways = results_df[results_df['timing_category'] == 'SIDEWAYS']
    
    print(f"\n📈 CONSOLIDATED TIMING CATEGORIES:")
    print(f"  At Exhaustion Points: {len(at_exhaustion)} ({len(at_exhaustion)/len(results_df)*100:.1f}%)")
    print(f"  Late Signals: {len(late_signals)} ({len(late_signals)/len(results_df)*100:.1f}%)")
    print(f"  False Exhaustion: {len(false_signals)} ({len(false_signals)/len(results_df)*100:.1f}%)")
    print(f"  Sideways: {len(sideways)} ({len(sideways)/len(results_df)*100:.1f}%)")
    
    # TP vs SL breakdown
    print(f"\n🎯 TIMING BY OUTCOME (TP vs SL):")
    
    tp_signals = results_df[results_df['TP_SL'] == 'TP']
    sl_signals = results_df[results_df['TP_SL'] == 'SL']
    
    if len(tp_signals) > 0:
        print(f"\n  Take Profit (TP) Signals - {len(tp_signals)} total:")
        tp_exhaustion = len(tp_signals[tp_signals['timing_category'].isin(['AT_EXHAUSTION_BOTTOM', 'AT_EXHAUSTION_TOP'])])
        tp_late = len(tp_signals[tp_signals['timing_category'].isin(['LATE_BOTTOM', 'LATE_TOP'])])
        tp_false = len(tp_signals[tp_signals['timing_category'].isin(['FALSE_BOTTOM', 'FALSE_TOP'])])
        tp_sideways = len(tp_signals[tp_signals['timing_category'] == 'SIDEWAYS'])
        
        print(f"    At Exhaustion: {tp_exhaustion} ({tp_exhaustion/len(tp_signals)*100:.1f}%)")
        print(f"    Late: {tp_late} ({tp_late/len(tp_signals)*100:.1f}%)")
        print(f"    False: {tp_false} ({tp_false/len(tp_signals)*100:.1f}%)")
        print(f"    Sideways: {tp_sideways} ({tp_sideways/len(tp_signals)*100:.1f}%)")
    
    if len(sl_signals) > 0:
        print(f"\n  Stop Loss (SL) Signals - {len(sl_signals)} total:")
        sl_exhaustion = len(sl_signals[sl_signals['timing_category'].isin(['AT_EXHAUSTION_BOTTOM', 'AT_EXHAUSTION_TOP'])])
        sl_late = len(sl_signals[sl_signals['timing_category'].isin(['LATE_BOTTOM', 'LATE_TOP'])])
        sl_false = len(sl_signals[sl_signals['timing_category'].isin(['FALSE_BOTTOM', 'FALSE_TOP'])])
        sl_sideways = len(sl_signals[sl_signals['timing_category'] == 'SIDEWAYS'])
        
        print(f"    At Exhaustion: {sl_exhaustion} ({sl_exhaustion/len(sl_signals)*100:.1f}%)")
        print(f"    Late: {sl_late} ({sl_late/len(sl_signals)*100:.1f}%)")
        print(f"    False: {sl_false} ({sl_false/len(sl_signals)*100:.1f}%)")
        print(f"    Sideways: {sl_sideways} ({sl_sideways/len(sl_signals)*100:.1f}%)")
    
    # Success rates by timing
    print(f"\n🎯 SUCCESS RATES BY TIMING:")
    
    # At exhaustion success rate
    exhaustion_tp = len(at_exhaustion[at_exhaustion['TP_SL'] == 'TP'])
    exhaustion_sl = len(at_exhaustion[at_exhaustion['TP_SL'] == 'SL'])
    if exhaustion_tp + exhaustion_sl > 0:
        exhaustion_success = exhaustion_tp / (exhaustion_tp + exhaustion_sl) * 100
        print(f"  Signals at Exhaustion Points: {exhaustion_success:.1f}% success ({exhaustion_tp} TP / {exhaustion_sl} SL)")
    
    # Late signals success rate
    late_tp = len(late_signals[late_signals['TP_SL'] == 'TP'])
    late_sl = len(late_signals[late_signals['TP_SL'] == 'SL'])
    if late_tp + late_sl > 0:
        late_success = late_tp / (late_tp + late_sl) * 100
        print(f"  Late Signals: {late_success:.1f}% success ({late_tp} TP / {late_sl} SL)")
    
    # False signals success rate
    false_tp = len(false_signals[false_signals['TP_SL'] == 'TP'])
    false_sl = len(false_signals[false_signals['TP_SL'] == 'SL'])
    if false_tp + false_sl > 0:
        false_success = false_tp / (false_tp + false_sl) * 100
        print(f"  False Exhaustion Signals: {false_success:.1f}% success ({false_tp} TP / {false_sl} SL)")
    
    return results_df

def compare_detectors():
    """Compare absorption vs exhaustion detector performance"""
    print("\n" + "="*80)
    print("ABSORPTION vs EXHAUSTION COMPARISON")
    print("="*80)
    
    # Load both datasets
    try:
        absorption_df = pd.read_csv('/Users/marcschot/Projects/OrderFlow Trading/logs/signal_validation/absorption_successful_2025-08-09.csv')
        exhaustion_df = pd.read_csv('/Users/marcschot/Projects/OrderFlow Trading/logs/signal_validation/exhaustion_successful_2025-08-09.csv')
    except:
        print("Could not load data for comparison")
        return
    
    # Calculate success rates
    abs_tp = len(absorption_df[absorption_df['TP_SL'] == 'TP'])
    abs_sl = len(absorption_df[absorption_df['TP_SL'] == 'SL'])
    abs_success = abs_tp / (abs_tp + abs_sl) * 100 if (abs_tp + abs_sl) > 0 else 0
    
    exh_tp = len(exhaustion_df[exhaustion_df['TP_SL'] == 'TP'])
    exh_sl = len(exhaustion_df[exhaustion_df['TP_SL'] == 'SL'])
    exh_success = exh_tp / (exh_tp + exh_sl) * 100 if (exh_tp + exh_sl) > 0 else 0
    
    print(f"\n📊 PERFORMANCE COMPARISON:")
    print(f"\n  ABSORPTION DETECTOR:")
    print(f"    Total Signals: {len(absorption_df)}")
    print(f"    TP: {abs_tp}, SL: {abs_sl}")
    print(f"    Success Rate: {abs_success:.1f}%")
    
    print(f"\n  EXHAUSTION DETECTOR:")
    print(f"    Total Signals: {len(exhaustion_df)}")
    print(f"    TP: {exh_tp}, SL: {exh_sl}")
    print(f"    Success Rate: {exh_success:.1f}%")
    
    # Confidence distribution comparison
    print(f"\n📊 CONFIDENCE DISTRIBUTION COMPARISON:")
    
    abs_conf_mean = absorption_df['confidence'].mean()
    abs_conf_std = absorption_df['confidence'].std()
    exh_conf_mean = exhaustion_df['confidence'].mean()
    exh_conf_std = exhaustion_df['confidence'].std()
    
    print(f"  Absorption: mean={abs_conf_mean:.3f}, std={abs_conf_std:.3f}")
    print(f"  Exhaustion: mean={exh_conf_mean:.3f}, std={exh_conf_std:.3f}")
    
    # Check for optimal confidence ranges
    print(f"\n🎯 OPTIMAL CONFIDENCE RANGES:")
    
    # Absorption optimal range (from previous analysis)
    abs_optimal = absorption_df[(absorption_df['confidence'] >= 0.60) & (absorption_df['confidence'] <= 0.65)]
    abs_opt_tp = len(abs_optimal[abs_optimal['TP_SL'] == 'TP'])
    abs_opt_sl = len(abs_optimal[abs_optimal['TP_SL'] == 'SL'])
    abs_opt_success = abs_opt_tp / (abs_opt_tp + abs_opt_sl) * 100 if (abs_opt_tp + abs_opt_sl) > 0 else 0
    
    print(f"  Absorption (0.60-0.65): {len(abs_optimal)} signals, {abs_opt_success:.1f}% success")
    
    # Find optimal range for exhaustion
    for low, high in [(0.55, 0.60), (0.60, 0.65), (0.65, 0.70), (0.70, 0.75), (0.75, 0.80)]:
        exh_range = exhaustion_df[(exhaustion_df['confidence'] >= low) & (exhaustion_df['confidence'] < high)]
        if len(exh_range) > 0:
            exh_range_tp = len(exh_range[exh_range['TP_SL'] == 'TP'])
            exh_range_sl = len(exh_range[exh_range['TP_SL'] == 'SL'])
            if exh_range_tp + exh_range_sl > 0:
                exh_range_success = exh_range_tp / (exh_range_tp + exh_range_sl) * 100
                print(f"  Exhaustion ({low:.2f}-{high:.2f}): {len(exh_range)} signals, {exh_range_success:.1f}% success")

def main():
    """Run exhaustion detector analysis"""
    print("EXHAUSTION DETECTOR COMPREHENSIVE ANALYSIS")
    print("="*80)
    
    # Analyze exhaustion signals
    df = analyze_exhaustion_signals()
    
    # Analyze swing timing
    if df is not None:
        analyze_exhaustion_swing_timing(df)
    
    # Compare with absorption
    compare_detectors()
    
    print("\n" + "="*80)
    print("ANALYSIS COMPLETE")
    print("="*80)

if __name__ == "__main__":
    main()