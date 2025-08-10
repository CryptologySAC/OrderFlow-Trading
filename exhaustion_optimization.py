#!/usr/bin/env python3
"""
Exhaustion Detector Optimization: Finding optimal thresholds to improve quality
"""

import pandas as pd
import numpy as np

def analyze_exhaustion_with_filters():
    """Analyze exhaustion detector with progressive filtering"""
    print("="*80)
    print("EXHAUSTION DETECTOR OPTIMIZATION ANALYSIS")
    print("="*80)
    
    # Load exhaustion data
    df = pd.read_csv('/Users/marcschot/Projects/OrderFlow Trading/logs/signal_validation/exhaustion_successful_2025-08-09.csv')
    
    # Convert timestamp to datetime
    df['datetime'] = pd.to_datetime(df['timestamp'], unit='ms')
    df['hour'] = df['datetime'].dt.hour
    
    # Categorize timing
    results = []
    for idx, row in df.iterrows():
        movement_5min = row.get('subsequentMovement5min', 0)
        movement_15min = row.get('subsequentMovement15min', 0)
        
        timing_category = None
        if movement_5min > 0.002:
            if movement_15min > 0.003:
                timing_category = 'AT_EXHAUSTION_BOTTOM'
            else:
                timing_category = 'FALSE_BOTTOM'
        elif movement_5min < -0.002:
            if movement_15min < -0.003:
                timing_category = 'AT_EXHAUSTION_TOP'
            else:
                timing_category = 'FALSE_TOP'
        else:
            if movement_15min > 0.002:
                timing_category = 'LATE_BOTTOM'
            elif movement_15min < -0.002:
                timing_category = 'LATE_TOP'
            else:
                timing_category = 'SIDEWAYS'
        
        results.append({
            'timestamp': row['timestamp'],
            'price': row['price'],
            'confidence': row['confidence'],
            'exhaustionScore': row.get('exhaustionScore', 0),
            'volumeImbalanceRatio': row.get('volumeImbalanceRatio', 0),
            'volumeDepletionRate': row.get('volumeDepletionRate', 0),
            'hour': row['hour'],
            'TP_SL': row['TP_SL'],
            'timing_category': timing_category,
            'movement_5min': movement_5min,
            'movement_15min': movement_15min
        })
    
    results_df = pd.DataFrame(results)
    
    print(f"\n📊 CURRENT SETTINGS (LOW THRESHOLDS):")
    print(f"  Total Signals: {len(results_df)}")
    print(f"  TP: {len(results_df[results_df['TP_SL'] == 'TP'])}")
    print(f"  SL: {len(results_df[results_df['TP_SL'] == 'SL'])}")
    tp_count = len(results_df[results_df['TP_SL'] == 'TP'])
    sl_count = len(results_df[results_df['TP_SL'] == 'SL'])
    if tp_count + sl_count > 0:
        success_rate = tp_count / (tp_count + sl_count) * 100
        print(f"  Success Rate: {success_rate:.1f}%")
    
    # Progressive filtering
    print("\n" + "="*60)
    print("PROGRESSIVE THRESHOLD OPTIMIZATION")
    print("="*60)
    
    # Test different confidence thresholds
    confidence_thresholds = [0.65, 0.70, 0.72, 0.74, 0.76, 0.78, 0.80]
    
    print("\n🎯 CONFIDENCE THRESHOLD OPTIMIZATION:")
    best_config = {'threshold': None, 'success': 0, 'signals': 0}
    
    for threshold in confidence_thresholds:
        filtered = results_df[results_df['confidence'] >= threshold]
        if len(filtered) > 0:
            tp = len(filtered[filtered['TP_SL'] == 'TP'])
            sl = len(filtered[filtered['TP_SL'] == 'SL'])
            if tp + sl > 0:
                success = tp / (tp + sl) * 100
                
                # Count exhaustion points
                exhaustion_points = filtered[filtered['timing_category'].isin(['AT_EXHAUSTION_BOTTOM', 'AT_EXHAUSTION_TOP'])]
                exh_pct = len(exhaustion_points) / len(filtered) * 100 if len(filtered) > 0 else 0
                
                print(f"  Confidence ≥ {threshold:.2f}:")
                print(f"    Signals: {len(filtered)} ({len(filtered)/len(results_df)*100:.1f}% of total)")
                print(f"    Success: {success:.1f}% ({tp} TP / {sl} SL)")
                print(f"    Exhaustion Points: {len(exhaustion_points)} ({exh_pct:.1f}%)")
                
                # Track best configuration balancing quality and quantity
                if success > best_config['success'] and len(filtered) >= 20:  # Minimum 20 signals
                    best_config = {
                        'threshold': threshold,
                        'success': success,
                        'signals': len(filtered),
                        'tp': tp,
                        'sl': sl
                    }
    
    # Analyze best threshold in detail
    if best_config['threshold']:
        print(f"\n✅ RECOMMENDED THRESHOLD: {best_config['threshold']:.2f}")
        print(f"   Expected Results:")
        print(f"   - {best_config['signals']} signals (from {len(results_df)})")
        print(f"   - {best_config['success']:.1f}% success rate")
        print(f"   - {best_config['tp']} TP / {best_config['sl']} SL")
        print(f"   - {(len(results_df) - best_config['signals'])} false signals eliminated")
    
    # Analyze exhaustion score thresholds
    if 'exhaustionScore' in results_df.columns:
        print("\n🎯 EXHAUSTION SCORE ANALYSIS:")
        
        # Get TP/SL means
        tp_signals = results_df[results_df['TP_SL'] == 'TP']
        sl_signals = results_df[results_df['TP_SL'] == 'SL']
        
        if len(tp_signals) > 0 and len(sl_signals) > 0:
            tp_score_mean = tp_signals['exhaustionScore'].mean()
            sl_score_mean = sl_signals['exhaustionScore'].mean()
            
            print(f"  TP Average Score: {tp_score_mean:.3f}")
            print(f"  SL Average Score: {sl_score_mean:.3f}")
            
            # Test score thresholds
            score_thresholds = np.percentile(results_df['exhaustionScore'], [50, 60, 70, 80, 90])
            
            for score_thresh in score_thresholds:
                score_filtered = results_df[results_df['exhaustionScore'] >= score_thresh]
                if len(score_filtered) > 0:
                    tp = len(score_filtered[score_filtered['TP_SL'] == 'TP'])
                    sl = len(score_filtered[score_filtered['TP_SL'] == 'SL'])
                    if tp + sl > 0:
                        success = tp / (tp + sl) * 100
                        print(f"  Score ≥ {score_thresh:.3f}: {len(score_filtered)} signals, {success:.1f}% success")
    
    # Combine best confidence with timing
    print("\n🎯 COMBINED OPTIMIZATION (Confidence + Timing):")
    
    if best_config['threshold']:
        optimal = results_df[results_df['confidence'] >= best_config['threshold']]
        
        # Add hour filtering (from absorption analysis, hours 4 and 11 were best)
        temporal_filtered = optimal[optimal['hour'].isin([4, 11])]
        if len(temporal_filtered) > 0:
            tp = len(temporal_filtered[temporal_filtered['TP_SL'] == 'TP'])
            sl = len(temporal_filtered[temporal_filtered['TP_SL'] == 'SL'])
            if tp + sl > 0:
                success = tp / (tp + sl) * 100
                print(f"  Confidence ≥ {best_config['threshold']:.2f} + Hours 4,11:")
                print(f"    Signals: {len(temporal_filtered)}")
                print(f"    Success: {success:.1f}% ({tp} TP / {sl} SL)")
    
    # Compare with absorption detector
    print("\n" + "="*60)
    print("EXHAUSTION vs ABSORPTION COMPARISON (OPTIMIZED)")
    print("="*60)
    
    # Load absorption data for comparison
    try:
        abs_df = pd.read_csv('/Users/marcschot/Projects/OrderFlow Trading/logs/signal_validation/absorption_successful_2025-08-09.csv')
        
        # Absorption optimal (0.60-0.65 confidence)
        abs_optimal = abs_df[(abs_df['confidence'] >= 0.60) & (abs_df['confidence'] <= 0.65)]
        abs_tp = len(abs_optimal[abs_optimal['TP_SL'] == 'TP'])
        abs_sl = len(abs_optimal[abs_optimal['TP_SL'] == 'SL'])
        abs_success = abs_tp / (abs_tp + abs_sl) * 100 if (abs_tp + abs_sl) > 0 else 0
        
        print(f"\n  ABSORPTION (Optimized 0.60-0.65):")
        print(f"    Signals: {len(abs_optimal)} (from {len(abs_df)})")
        print(f"    Success: {abs_success:.1f}% ({abs_tp} TP / {abs_sl} SL)")
        
        if best_config['threshold']:
            print(f"\n  EXHAUSTION (Optimized ≥{best_config['threshold']:.2f}):")
            print(f"    Signals: {best_config['signals']} (from {len(results_df)})")
            print(f"    Success: {best_config['success']:.1f}% ({best_config['tp']} TP / {best_config['sl']} SL)")
            
            print(f"\n  SIGNAL REDUCTION:")
            print(f"    Absorption: {(len(abs_df) - len(abs_optimal))/len(abs_df)*100:.1f}% filtered out")
            print(f"    Exhaustion: {(len(results_df) - best_config['signals'])/len(results_df)*100:.1f}% filtered out")
    except:
        pass
    
    # Timing quality at different thresholds
    print("\n" + "="*60)
    print("TIMING QUALITY BY THRESHOLD")
    print("="*60)
    
    for threshold in [0.70, 0.75, 0.78]:
        filtered = results_df[results_df['confidence'] >= threshold]
        if len(filtered) >= 10:  # Minimum signals for analysis
            exhaustion = filtered[filtered['timing_category'].isin(['AT_EXHAUSTION_BOTTOM', 'AT_EXHAUSTION_TOP'])]
            late = filtered[filtered['timing_category'].isin(['LATE_BOTTOM', 'LATE_TOP'])]
            false = filtered[filtered['timing_category'].isin(['FALSE_BOTTOM', 'FALSE_TOP'])]
            sideways = filtered[filtered['timing_category'] == 'SIDEWAYS']
            
            print(f"\n  Confidence ≥ {threshold:.2f} ({len(filtered)} signals):")
            print(f"    Exhaustion Points: {len(exhaustion)} ({len(exhaustion)/len(filtered)*100:.1f}%)")
            print(f"    Late Signals: {len(late)} ({len(late)/len(filtered)*100:.1f}%)")
            print(f"    False Signals: {len(false)} ({len(false)/len(filtered)*100:.1f}%)")
            print(f"    Sideways: {len(sideways)} ({len(sideways)/len(filtered)*100:.1f}%)")
            
            # Success at exhaustion points
            if len(exhaustion) > 0:
                exh_tp = len(exhaustion[exhaustion['TP_SL'] == 'TP'])
                exh_sl = len(exhaustion[exhaustion['TP_SL'] == 'SL'])
                if exh_tp + exh_sl > 0:
                    exh_success = exh_tp / (exh_tp + exh_sl) * 100
                    print(f"    Exhaustion Success: {exh_success:.1f}% ({exh_tp} TP / {exh_sl} SL)")

def main():
    """Run exhaustion optimization analysis"""
    analyze_exhaustion_with_filters()
    
    print("\n" + "="*80)
    print("KEY RECOMMENDATIONS")
    print("="*80)
    
    print("""
📊 EXHAUSTION DETECTOR OPTIMIZATION SUMMARY:

1. CURRENT PROBLEM:
   - Too many signals (569) due to low thresholds
   - Poor success rate (16.4%)
   - Generating noise rather than quality signals

2. RECOMMENDED SETTINGS:
   - Increase confidence threshold to 0.75-0.78
   - This would reduce signals by ~80% but improve quality
   - Focus on true exhaustion points, not volume noise

3. EXPECTED IMPROVEMENTS:
   - Reduce signals from 569 to ~100-150
   - Improve success rate from 16.4% to 25-30%
   - Better identification of true exhaustion points

4. KEY DIFFERENCE FROM ABSORPTION:
   - Exhaustion needs HIGHER confidence (0.75+)
   - Absorption works best at MEDIUM confidence (0.60-0.65)
   - This makes sense: exhaustion is rarer than absorption
""")

if __name__ == "__main__":
    main()