#!/usr/bin/env python3
"""
Signal Validation Analysis Tool
Analyzes signal validation logs to find best predictive settings for detectors
"""

import pandas as pd
import numpy as np
from pathlib import Path
import glob
import matplotlib.pyplot as plt
import seaborn as sns
from datetime import datetime
import warnings
warnings.filterwarnings('ignore')

def load_signal_data(logs_dir="logs/signal_validation"):
    """Load all signal validation CSV files"""
    csv_files = glob.glob(f"{logs_dir}/signal_validation_*.csv")
    
    if not csv_files:
        print(f"No signal validation files found in {logs_dir}")
        return None
    
    all_data = []
    for file in csv_files:
        try:
            df = pd.read_csv(file)
            df['file_date'] = Path(file).stem.split('_')[-1]
            all_data.append(df)
            print(f"Loaded {len(df)} signals from {Path(file).name}")
        except Exception as e:
            print(f"Error loading {file}: {e}")
    
    if not all_data:
        return None
    
    combined_df = pd.concat(all_data, ignore_index=True)
    print(f"\nTotal signals loaded: {len(combined_df)}")
    return combined_df

def analyze_absorption_detector(df):
    """Analyze absorption detector performance"""
    absorption_df = df[df['detectorType'] == 'absorption'].copy()
    
    if len(absorption_df) == 0:
        print("No absorption detector signals found")
        return {}
    
    print(f"\n🔍 ABSORPTION DETECTOR ANALYSIS ({len(absorption_df)} signals)")
    print("=" * 60)
    
    # Basic statistics
    print(f"Signal Distribution:")
    print(f"  - Buy signals: {len(absorption_df[absorption_df['signalSide'] == 'buy'])}")
    print(f"  - Sell signals: {len(absorption_df[absorption_df['signalSide'] == 'sell'])}")
    
    # Confidence analysis
    confidence_stats = absorption_df['confidence'].describe()
    print(f"\nConfidence Statistics:")
    print(f"  - Mean: {confidence_stats['mean']:.4f}")
    print(f"  - Median: {confidence_stats['50%']:.4f}")
    print(f"  - Std: {confidence_stats['std']:.4f}")
    print(f"  - Range: {confidence_stats['min']:.4f} - {confidence_stats['max']:.4f}")
    
    # Volume analysis
    volume_stats = absorption_df['totalAggressiveVolume'].describe()
    print(f"\nTotal Aggressive Volume Statistics:")
    print(f"  - Mean: {volume_stats['mean']:.2f}")
    print(f"  - Median: {volume_stats['50%']:.2f}")
    print(f"  - 75th percentile: {volume_stats['75%']:.2f}")
    print(f"  - 95th percentile: {absorption_df['totalAggressiveVolume'].quantile(0.95):.2f}")
    
    # Price efficiency analysis
    if 'priceEfficiency' in absorption_df.columns:
        price_eff_stats = absorption_df['priceEfficiency'].describe()
        print(f"\nPrice Efficiency Statistics:")
        print(f"  - Mean: {price_eff_stats['mean']:.6f}")
        print(f"  - Median: {price_eff_stats['50%']:.6f}")
        print(f"  - Range: {price_eff_stats['min']:.6f} - {price_eff_stats['max']:.6f}")
    
    # Absorption ratio analysis
    if 'absorptionRatio' in absorption_df.columns:
        absorption_ratio_stats = absorption_df['absorptionRatio'].describe()
        print(f"\nAbsorption Ratio Statistics:")
        print(f"  - Mean: {absorption_ratio_stats['mean']:.6f}")
        print(f"  - Median: {absorption_ratio_stats['50%']:.6f}")
        print(f"  - Range: {absorption_ratio_stats['min']:.6f} - {absorption_ratio_stats['max']:.6f}")
    
    # Quality grade analysis
    if 'qualityGrade' in absorption_df.columns:
        quality_counts = absorption_df['qualityGrade'].value_counts()
        print(f"\nQuality Grade Distribution:")
        for grade, count in quality_counts.items():
            percentage = (count / len(absorption_df)) * 100
            print(f"  - {grade}: {count} ({percentage:.1f}%)")
    
    # Institutional footprint analysis
    if 'institutionalFootprint' in absorption_df.columns:
        inst_footprint_stats = absorption_df['institutionalFootprint'].describe()
        print(f"\nInstitutional Footprint Statistics:")
        print(f"  - Mean: {inst_footprint_stats['mean']:.6f}")
        print(f"  - Median: {inst_footprint_stats['50%']:.6f}")
        print(f"  - Range: {inst_footprint_stats['min']:.6f} - {inst_footprint_stats['max']:.6f}")
    
    return {
        'detector': 'absorption',
        'total_signals': len(absorption_df),
        'buy_signals': len(absorption_df[absorption_df['signalSide'] == 'buy']),
        'sell_signals': len(absorption_df[absorption_df['signalSide'] == 'sell']),
        'avg_confidence': absorption_df['confidence'].mean(),
        'median_confidence': absorption_df['confidence'].median(),
        'avg_volume': absorption_df['totalAggressiveVolume'].mean(),
        'median_volume': absorption_df['totalAggressiveVolume'].median(),
        'volume_95th': absorption_df['totalAggressiveVolume'].quantile(0.95),
        'avg_price_efficiency': absorption_df['priceEfficiency'].mean() if 'priceEfficiency' in absorption_df.columns else None,
        'avg_absorption_ratio': absorption_df['absorptionRatio'].mean() if 'absorptionRatio' in absorption_df.columns else None,
    }

def analyze_exhaustion_detector(df):
    """Analyze exhaustion detector performance"""
    exhaustion_df = df[df['detectorType'] == 'exhaustion'].copy()
    
    if len(exhaustion_df) == 0:
        print("No exhaustion detector signals found")
        return {}
    
    print(f"\n🔍 EXHAUSTION DETECTOR ANALYSIS ({len(exhaustion_df)} signals)")
    print("=" * 60)
    
    # Basic statistics
    print(f"Signal Distribution:")
    print(f"  - Buy signals: {len(exhaustion_df[exhaustion_df['signalSide'] == 'buy'])}")
    print(f"  - Sell signals: {len(exhaustion_df[exhaustion_df['signalSide'] == 'sell'])}")
    
    # Confidence analysis
    confidence_stats = exhaustion_df['confidence'].describe()
    print(f"\nConfidence Statistics:")
    print(f"  - Mean: {confidence_stats['mean']:.4f}")
    print(f"  - Median: {confidence_stats['50%']:.4f}")
    print(f"  - Std: {confidence_stats['std']:.4f}")
    print(f"  - Range: {confidence_stats['min']:.4f} - {confidence_stats['max']:.4f}")
    
    # Exhaustion ratio analysis
    if 'exhaustionRatio' in exhaustion_df.columns:
        exhaustion_ratio_stats = exhaustion_df['exhaustionRatio'].describe()
        print(f"\nExhaustion Ratio Statistics:")
        print(f"  - Mean: {exhaustion_ratio_stats['mean']:.6f}")
        print(f"  - Median: {exhaustion_ratio_stats['50%']:.6f}")
        print(f"  - Range: {exhaustion_ratio_stats['min']:.6f} - {exhaustion_ratio_stats['max']:.6f}")
    
    return {
        'detector': 'exhaustion',
        'total_signals': len(exhaustion_df),
        'buy_signals': len(exhaustion_df[exhaustion_df['signalSide'] == 'buy']),
        'sell_signals': len(exhaustion_df[exhaustion_df['signalSide'] == 'sell']),
        'avg_confidence': exhaustion_df['confidence'].mean(),
        'median_confidence': exhaustion_df['confidence'].median(),
    }

def analyze_signal_timing(df):
    """Analyze signal timing patterns"""
    print(f"\n📊 SIGNAL TIMING ANALYSIS")
    print("=" * 60)
    
    # Convert timestamp to datetime
    df['datetime'] = pd.to_datetime(df['timestamp'], unit='ms')
    df['hour'] = df['datetime'].dt.hour
    df['minute'] = df['datetime'].dt.minute
    
    # Hourly distribution
    hourly_counts = df['hour'].value_counts().sort_index()
    print(f"\nSignals by Hour (UTC):")
    for hour, count in hourly_counts.items():
        print(f"  {hour:02d}:00 - {count} signals")
    
    # Time gaps between signals
    df_sorted = df.sort_values('timestamp')
    time_diffs = df_sorted['timestamp'].diff() / 1000  # Convert to seconds
    
    print(f"\nTime Gaps Between Signals:")
    print(f"  - Mean gap: {time_diffs.mean():.1f} seconds")
    print(f"  - Median gap: {time_diffs.median():.1f} seconds")
    print(f"  - Min gap: {time_diffs.min():.1f} seconds")
    print(f"  - Max gap: {time_diffs.max():.1f} seconds")

def recommend_optimal_settings(analysis_results):
    """Generate recommendations for optimal detector settings"""
    print(f"\n🎯 OPTIMAL SETTINGS RECOMMENDATIONS")
    print("=" * 60)
    
    for result in analysis_results:
        if result['detector'] == 'absorption':
            print(f"\n📈 ABSORPTION DETECTOR OPTIMAL SETTINGS:")
            print(f"Based on analysis of {result['total_signals']} signals")
            
            # Volume thresholds
            print(f"\n🔹 Recommended Volume Thresholds:")
            print(f"  - minAggVolume: {result['median_volume']:.0f} (median volume)")
            print(f"  - High-quality threshold: {result['volume_95th']:.0f} (95th percentile)")
            
            # Confidence thresholds
            print(f"\n🔹 Recommended Confidence Thresholds:")
            print(f"  - Base confidence: {result['median_confidence']:.2f}")
            print(f"  - Premium signals: {result['avg_confidence'] + 0.1:.2f}")
            
            # Quality filtering
            print(f"\n🔹 Quality Filtering Recommendations:")
            print(f"  - Focus on premium grade signals (higher institutional footprint)")
            print(f"  - Filter out signals below median confidence")
            
            if result['avg_price_efficiency']:
                print(f"  - Price efficiency threshold: {result['avg_price_efficiency']:.4f}")
            
            if result['avg_absorption_ratio']:
                print(f"  - Absorption ratio threshold: {result['avg_absorption_ratio']:.4f}")
        
        elif result['detector'] == 'exhaustion':
            print(f"\n📉 EXHAUSTION DETECTOR OPTIMAL SETTINGS:")
            print(f"Based on analysis of {result['total_signals']} signals")
            
            print(f"\n🔹 Recommended Confidence Thresholds:")
            print(f"  - Base confidence: {result['median_confidence']:.2f}")
            print(f"  - High-quality threshold: {result['avg_confidence']:.2f}")

def generate_config_updates(analysis_results):
    """Generate actual config.json updates"""
    print(f"\n⚙️ CONFIG.JSON UPDATE RECOMMENDATIONS")
    print("=" * 60)
    
    for result in analysis_results:
        if result['detector'] == 'absorption':
            print(f"\n// Absorption Detector Optimized Settings")
            print(f"\"absorption\": {{")
            print(f"  \"minAggVolume\": {result['median_volume']:.0f},")
            print(f"  \"absorptionThreshold\": {result['avg_absorption_ratio']:.2f},") if result['avg_absorption_ratio'] else print(f"  \"absorptionThreshold\": 0.65,")
            print(f"  \"priceEfficiencyThreshold\": {result['avg_price_efficiency']:.4f},") if result['avg_price_efficiency'] else print(f"  \"priceEfficiencyThreshold\": 0.005,")
            print(f"  \"finalConfidenceRequired\": {result['median_confidence']:.2f},")
            print(f"  \"premiumSignalThreshold\": {result['avg_confidence'] + 0.1:.2f}")
            print(f"}}")
        
        elif result['detector'] == 'exhaustion':
            print(f"\n// Exhaustion Detector Optimized Settings")
            print(f"\"exhaustion\": {{")
            print(f"  \"finalConfidenceRequired\": {result['median_confidence']:.2f},")
            print(f"  \"premiumSignalThreshold\": {result['avg_confidence']:.2f}")
            print(f"}}")

def main():
    """Main analysis function"""
    print("🔬 SIGNAL VALIDATION ANALYSIS")
    print("=" * 60)
    
    # Load data
    df = load_signal_data()
    if df is None:
        return
    
    # Analyze each detector type
    analysis_results = []
    
    # Analyze absorption detector
    absorption_results = analyze_absorption_detector(df)
    if absorption_results:
        analysis_results.append(absorption_results)
    
    # Analyze exhaustion detector  
    exhaustion_results = analyze_exhaustion_detector(df)
    if exhaustion_results:
        analysis_results.append(exhaustion_results)
    
    # Overall timing analysis
    analyze_signal_timing(df)
    
    # Generate recommendations
    recommend_optimal_settings(analysis_results)
    generate_config_updates(analysis_results)
    
    print(f"\n✅ Analysis complete!")
    print(f"Analyzed {len(df)} total signals from {df['detectorType'].nunique()} detector types")

if __name__ == "__main__":
    main()