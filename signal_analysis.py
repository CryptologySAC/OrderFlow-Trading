#!/usr/bin/env python3
"""
Signal Validation Analysis: TP vs SL Pattern Detection
Analyzes absorption and deltaCVD signals to identify optimization opportunities.
"""

import pandas as pd
import numpy as np
from scipy import stats
import warnings
warnings.filterwarnings('ignore')

def load_and_prepare_data():
    """Load CSV files and prepare data for analysis"""
    print("=== LOADING SIGNAL VALIDATION DATA ===")
    
    # Load absorption data
    try:
        absorption_df = pd.read_csv('/Users/marcschot/Projects/OrderFlow Trading/logs/signal_validation/absorption_successful_2025-08-09.csv')
        print(f"✓ Absorption signals loaded: {len(absorption_df)} records")
    except Exception as e:
        print(f"✗ Error loading absorption data: {e}")
        return None, None
    
    # Load deltaCVD data
    try:
        deltacvd_df = pd.read_csv('/Users/marcschot/Projects/OrderFlow Trading/logs/signal_validation/deltacvd_successful_2025-08-09.csv')
        print(f"✓ DeltaCVD signals loaded: {len(deltacvd_df)} records")
    except Exception as e:
        print(f"✗ Error loading deltaCVD data: {e}")
        return absorption_df, None
    
    return absorption_df, deltacvd_df

def analyze_absorption_signals(df):
    """Comprehensive analysis of absorption detector signals"""
    print("\n" + "="*60)
    print("ABSORPTION DETECTOR ANALYSIS")
    print("="*60)
    
    if df is None or len(df) == 0:
        print("No absorption data available for analysis")
        return
    
    # Basic signal distribution
    tp_count = len(df[df['TP_SL'] == 'TP'])
    sl_count = len(df[df['TP_SL'] == 'SL'])
    neither_count = len(df[df['TP_SL'] == 'NEITHER'])
    
    print(f"\n📊 SIGNAL OUTCOME DISTRIBUTION:")
    print(f"Take Profit (TP): {tp_count} ({tp_count/len(df)*100:.1f}%)")
    print(f"Stop Loss (SL): {sl_count} ({sl_count/len(df)*100:.1f}%)")
    print(f"Neither: {neither_count} ({neither_count/len(df)*100:.1f}%)")
    print(f"Total Signals: {len(df)}")
    
    # Success rate calculation
    if tp_count + sl_count > 0:
        success_rate = tp_count / (tp_count + sl_count) * 100
        print(f"\n🎯 SUCCESS RATE (TP/(TP+SL)): {success_rate:.1f}%")
    
    # Analyze key parameters for TP vs SL
    print(f"\n📈 PARAMETER ANALYSIS (TP vs SL):")
    
    tp_signals = df[df['TP_SL'] == 'TP']
    sl_signals = df[df['TP_SL'] == 'SL']
    
    if len(tp_signals) > 0 and len(sl_signals) > 0:
        # Key numerical parameters
        key_params = [
            'confidence', 'minAggVolume', 'priceEfficiencyThreshold', 
            'maxAbsorptionRatio', 'minPassiveMultiplier', 'finalConfidenceRequired',
            'minEnhancedConfidenceThreshold', 'institutionalVolumeThreshold'
        ]
        
        print(f"{'Parameter':<35} {'TP Mean':<12} {'SL Mean':<12} {'Difference':<12} {'P-Value':<10}")
        print("-" * 85)
        
        significant_differences = []
        
        for param in key_params:
            if param in df.columns:
                tp_mean = tp_signals[param].mean()
                sl_mean = sl_signals[param].mean()
                difference = tp_mean - sl_mean
                
                # Statistical test
                try:
                    _, p_value = stats.ttest_ind(tp_signals[param], sl_signals[param])
                    significance = "***" if p_value < 0.001 else "**" if p_value < 0.01 else "*" if p_value < 0.05 else ""
                    
                    print(f"{param:<35} {tp_mean:<12.4f} {sl_mean:<12.4f} {difference:<12.4f} {p_value:<10.4f} {significance}")
                    
                    if p_value < 0.05:
                        significant_differences.append({
                            'parameter': param,
                            'tp_mean': tp_mean,
                            'sl_mean': sl_mean,
                            'difference': difference,
                            'p_value': p_value
                        })
                except:
                    print(f"{param:<35} {tp_mean:<12.4f} {sl_mean:<12.4f} {difference:<12.4f} {'N/A':<10}")
        
        # Quality flags analysis
        print(f"\n🏆 QUALITY FLAGS ANALYSIS:")
        quality_flags = ['crossTimeframe', 'institutionalVolume', 'zoneConfluence', 'exhaustionGap', 'priceEfficiencyHigh']
        
        for flag in quality_flags:
            if flag in df.columns:
                tp_flag_rate = tp_signals[flag].mean() * 100 if len(tp_signals) > 0 else 0
                sl_flag_rate = sl_signals[flag].mean() * 100 if len(sl_signals) > 0 else 0
                print(f"{flag:<25}: TP={tp_flag_rate:.1f}%, SL={sl_flag_rate:.1f}%")
        
        # Confidence level distribution analysis
        print(f"\n📊 CONFIDENCE DISTRIBUTION:")
        confidence_ranges = [
            (0.0, 0.6, "Low (0.0-0.6)"),
            (0.6, 0.7, "Medium (0.6-0.7)"),
            (0.7, 0.8, "High (0.7-0.8)"),
            (0.8, 1.0, "Very High (0.8-1.0)")
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
                    print(f"{label:<20}: {len(subset):>3} signals, {success_rate:.1f}% success rate")
        
        # Movement analysis
        print(f"\n📈 MOVEMENT ANALYSIS:")
        movement_cols = ['subsequentMovement5min', 'subsequentMovement15min', 'subsequentMovement1hr']
        for col in movement_cols:
            if col in df.columns:
                tp_move = tp_signals[col].mean() * 100 if len(tp_signals) > 0 else 0
                sl_move = sl_signals[col].mean() * 100 if len(sl_signals) > 0 else 0
                print(f"{col:<25}: TP={tp_move:.2f}%, SL={sl_move:.2f}%")
        
        # Print significant findings
        if significant_differences:
            print(f"\n🔍 STATISTICALLY SIGNIFICANT DIFFERENCES (p < 0.05):")
            for diff in significant_differences:
                direction = "higher" if diff['difference'] > 0 else "lower"
                print(f"• {diff['parameter']}: TP signals have {direction} values ({diff['difference']:.4f}, p={diff['p_value']:.4f})")
    
    else:
        print("Insufficient data for TP vs SL comparison")

def analyze_deltacvd_signals(df):
    """Comprehensive analysis of deltaCVD detector signals"""
    print("\n" + "="*60)
    print("DELTACVD DETECTOR ANALYSIS")
    print("="*60)
    
    if df is None or len(df) == 0:
        print("No deltaCVD data available for analysis")
        return
    
    # Basic signal distribution
    tp_count = len(df[df['TP_SL'] == 'TP'])
    sl_count = len(df[df['TP_SL'] == 'SL'])
    
    print(f"\n📊 SIGNAL OUTCOME DISTRIBUTION:")
    print(f"Take Profit (TP): {tp_count} ({tp_count/len(df)*100:.1f}%)")
    print(f"Stop Loss (SL): {sl_count} ({sl_count/len(df)*100:.1f}%)")
    print(f"Total Signals: {len(df)}")
    
    # Success rate calculation
    if tp_count + sl_count > 0:
        success_rate = tp_count / (tp_count + sl_count) * 100
        print(f"\n🎯 SUCCESS RATE (TP/(TP+SL)): {success_rate:.1f}%")
    
    # Analyze key parameters for TP vs SL
    print(f"\n📈 PARAMETER ANALYSIS (TP vs SL):")
    
    tp_signals = df[df['TP_SL'] == 'TP']
    sl_signals = df[df['TP_SL'] == 'SL']
    
    if len(tp_signals) > 0 and len(sl_signals) > 0:
        # Key numerical parameters
        key_params = [
            'confidence', 'minTradesPerSec', 'minVolPerSec', 'signalThreshold',
            'institutionalThreshold'
        ]
        
        print(f"{'Parameter':<25} {'TP Mean':<12} {'SL Mean':<12} {'Difference':<12} {'P-Value':<10}")
        print("-" * 75)
        
        for param in key_params:
            if param in df.columns:
                tp_mean = tp_signals[param].mean()
                sl_mean = sl_signals[param].mean()
                difference = tp_mean - sl_mean
                
                # Statistical test
                try:
                    _, p_value = stats.ttest_ind(tp_signals[param], sl_signals[param])
                    significance = "***" if p_value < 0.001 else "**" if p_value < 0.01 else "*" if p_value < 0.05 else ""
                    
                    print(f"{param:<25} {tp_mean:<12.4f} {sl_mean:<12.4f} {difference:<12.4f} {p_value:<10.4f} {significance}")
                except:
                    print(f"{param:<25} {tp_mean:<12.4f} {sl_mean:<12.4f} {difference:<12.4f} {'N/A':<10}")
        
        # Quality flags analysis
        print(f"\n🏆 QUALITY FLAGS ANALYSIS:")
        quality_flags = ['crossTimeframe', 'institutionalVolume', 'zoneConfluence', 'exhaustionGap', 'priceEfficiencyHigh']
        
        for flag in quality_flags:
            if flag in df.columns:
                tp_flag_rate = tp_signals[flag].mean() * 100 if len(tp_signals) > 0 else 0
                sl_flag_rate = sl_signals[flag].mean() * 100 if len(sl_signals) > 0 else 0
                print(f"{flag:<25}: TP={tp_flag_rate:.1f}%, SL={sl_flag_rate:.1f}%")
        
        # Movement analysis
        print(f"\n📈 MOVEMENT ANALYSIS:")
        movement_cols = ['subsequentMovement5min', 'subsequentMovement15min', 'subsequentMovement1hr']
        for col in movement_cols:
            if col in df.columns:
                tp_move = tp_signals[col].mean() * 100 if len(tp_signals) > 0 else 0
                sl_move = sl_signals[col].mean() * 100 if len(sl_signals) > 0 else 0
                print(f"{col:<25}: TP={tp_move:.2f}%, SL={sl_move:.2f}%")
    
    else:
        print("Insufficient data for TP vs SL comparison")

def generate_optimization_recommendations(absorption_df, deltacvd_df):
    """Generate specific optimization recommendations based on analysis"""
    print("\n" + "="*60)
    print("OPTIMIZATION RECOMMENDATIONS")
    print("="*60)
    
    recommendations = []
    
    # Absorption detector recommendations
    if absorption_df is not None and len(absorption_df) > 0:
        tp_signals = absorption_df[absorption_df['TP_SL'] == 'TP']
        sl_signals = absorption_df[absorption_df['TP_SL'] == 'SL']
        
        if len(tp_signals) > 0 and len(sl_signals) > 0:
            print(f"\n🎯 ABSORPTION DETECTOR OPTIMIZATIONS:")
            
            # Confidence threshold optimization
            tp_conf_mean = tp_signals['confidence'].mean()
            sl_conf_mean = sl_signals['confidence'].mean()
            
            if tp_conf_mean > sl_conf_mean:
                recommendations.append(f"• Increase confidence threshold to ~{tp_conf_mean:.3f} (current TP average)")
            
            # Price efficiency threshold optimization
            if 'priceEfficiencyThreshold' in absorption_df.columns:
                tp_pe_mean = tp_signals['priceEfficiencyThreshold'].mean()
                sl_pe_mean = sl_signals['priceEfficiencyThreshold'].mean()
                
                if abs(tp_pe_mean - sl_pe_mean) > 0.001:  # Significant difference
                    recommendations.append(f"• Adjust priceEfficiencyThreshold to ~{tp_pe_mean:.6f} (TP average)")
            
            # Volume threshold optimization
            if 'minAggVolume' in absorption_df.columns:
                tp_vol_mean = tp_signals['minAggVolume'].mean()
                sl_vol_mean = sl_signals['minAggVolume'].mean()
                
                if tp_vol_mean != sl_vol_mean:
                    direction = "increase" if tp_vol_mean > sl_vol_mean else "decrease"
                    recommendations.append(f"• {direction.capitalize()} minAggVolume threshold to ~{tp_vol_mean:.0f}")
            
            for rec in recommendations:
                print(rec)
    
    # DeltaCVD detector recommendations
    if deltacvd_df is not None and len(deltacvd_df) > 0:
        tp_signals = deltacvd_df[deltacvd_df['TP_SL'] == 'TP']
        sl_signals = deltacvd_df[deltacvd_df['TP_SL'] == 'SL']
        
        if len(tp_signals) > 0 and len(sl_signals) > 0:
            print(f"\n🎯 DELTACVD DETECTOR OPTIMIZATIONS:")
            
            deltacvd_recommendations = []
            
            # Signal threshold optimization
            tp_thresh_mean = tp_signals['signalThreshold'].mean()
            sl_thresh_mean = sl_signals['signalThreshold'].mean()
            
            if tp_thresh_mean != sl_thresh_mean:
                direction = "increase" if tp_thresh_mean > sl_thresh_mean else "decrease"
                deltacvd_recommendations.append(f"• {direction.capitalize()} signalThreshold to ~{tp_thresh_mean:.2f}")
            
            # Volume parameters
            tp_vol_mean = tp_signals['minVolPerSec'].mean()
            sl_vol_mean = sl_signals['minVolPerSec'].mean()
            
            if abs(tp_vol_mean - sl_vol_mean) > 1.0:  # Significant difference
                direction = "increase" if tp_vol_mean > sl_vol_mean else "decrease"
                deltacvd_recommendations.append(f"• {direction.capitalize()} minVolPerSec to ~{tp_vol_mean:.1f}")
            
            for rec in deltacvd_recommendations:
                print(rec)
    
    # General recommendations
    print(f"\n🔧 GENERAL OPTIMIZATIONS:")
    print("• Consider implementing adaptive thresholds based on market volatility")
    print("• Add quality flag weighting system to boost high-confidence signals")
    print("• Implement ensemble voting between multiple detector outputs")
    print("• Consider time-of-day and market session filtering")
    
    return recommendations

def main():
    """Main analysis function"""
    print("Signal Validation Analysis: TP vs SL Pattern Detection")
    print("=" * 60)
    
    # Load data
    absorption_df, deltacvd_df = load_and_prepare_data()
    
    # Analyze absorption signals
    analyze_absorption_signals(absorption_df)
    
    # Analyze deltaCVD signals
    analyze_deltacvd_signals(deltacvd_df)
    
    # Generate recommendations
    generate_optimization_recommendations(absorption_df, deltacvd_df)
    
    print(f"\n" + "="*60)
    print("ANALYSIS COMPLETE")
    print("="*60)

if __name__ == "__main__":
    main()