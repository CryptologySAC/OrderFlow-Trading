#!/usr/bin/env python3
"""
Swing Timing Analysis: Analyzes absorption signals relative to swing highs/lows
Determines if signals occur at reversal points or after movement has started
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta

def analyze_swing_timing():
    """Analyze absorption signals relative to swing highs/lows"""
    print("="*80)
    print("ABSORPTION SIGNAL TIMING ANALYSIS - SWING HIGH/LOW DETECTION")
    print("="*80)
    
    # Load absorption data
    df = pd.read_csv('/Users/marcschot/Projects/OrderFlow Trading/logs/signal_validation/absorption_successful_2025-08-09.csv')
    
    # Convert timestamp to datetime
    df['datetime'] = pd.to_datetime(df['timestamp'], unit='ms')
    df['hour'] = df['datetime'].dt.hour
    
    print(f"\nTotal Signals Analyzed: {len(df)}")
    print(f"TP Signals: {len(df[df['TP_SL'] == 'TP'])}")
    print(f"SL Signals: {len(df[df['TP_SL'] == 'SL'])}")
    print(f"Neither: {len(df[df['TP_SL'] == 'NEITHER'])}")
    
    # Calculate price movements to determine swing points
    # We'll use 5min, 15min, and 1hr movements to classify timing
    
    # Classification criteria:
    # 1. AT REVERSAL: Signal occurs at/near swing point (price reverses after signal)
    #    - For BUY: Price was falling, signal triggers, then price rises
    #    - For SELL: Price was rising, signal triggers, then price falls
    # 2. AFTER MOVEMENT: Signal occurs after movement already started
    #    - For BUY: Price already rising when signal triggers
    #    - For SELL: Price already falling when signal triggers
    
    results = []
    
    for idx, row in df.iterrows():
        price = row['price']
        
        # Get price movements
        movement_5min = row.get('subsequentMovement5min', 0)
        movement_15min = row.get('subsequentMovement15min', 0)
        movement_1hr = row.get('subsequentMovement1hr', 0)
        
        # Determine signal direction based on subsequent movement
        # Absorption signals catch reversals, so we determine direction from price action
        # If price goes up after signal -> it was a BUY signal (bottom reversal)
        # If price goes down after signal -> it was a SELL signal (top reversal)
        
        timing_category = None
        signal_side = None
        
        # Use 5min and 15min movements to determine signal type and timing
        if movement_5min > 0.002:  # Price went up (0.2% threshold)
            signal_side = 'buy'
            if movement_15min > 0.003:  # Continued upward movement
                timing_category = 'AT_REVERSAL_BOTTOM'
            else:
                timing_category = 'FALSE_BOTTOM'
        elif movement_5min < -0.002:  # Price went down (-0.2% threshold)
            signal_side = 'sell'
            if movement_15min < -0.003:  # Continued downward movement
                timing_category = 'AT_REVERSAL_TOP'
            else:
                timing_category = 'FALSE_TOP'
        else:  # Minimal movement - check longer timeframe
            if movement_15min > 0.002:
                signal_side = 'buy'
                timing_category = 'LATE_BOTTOM'  # Slow to develop
            elif movement_15min < -0.002:
                signal_side = 'sell'
                timing_category = 'LATE_TOP'  # Slow to develop
            else:
                # No significant movement - sideways
                signal_side = 'neutral'
                timing_category = 'SIDEWAYS'
        
        results.append({
            'timestamp': row['timestamp'],
            'signalSide': signal_side,
            'price': price,
            'TP_SL': row['TP_SL'],
            'timing_category': timing_category,
            'movement_5min': movement_5min,
            'movement_15min': movement_15min,
            'movement_1hr': movement_1hr,
            'confidence': row['confidence'],
            'hour': row['hour']
        })
    
    results_df = pd.DataFrame(results)
    
    # Aggregate statistics
    print("\n" + "="*60)
    print("TIMING ANALYSIS RESULTS")
    print("="*60)
    
    # Overall timing distribution
    print("\n📊 OVERALL TIMING DISTRIBUTION:")
    timing_counts = results_df['timing_category'].value_counts()
    for category, count in timing_counts.items():
        pct = count / len(results_df) * 100
        print(f"  {category}: {count} ({pct:.1f}%)")
    
    # Group reversal categories
    at_reversal = results_df[results_df['timing_category'].isin(['AT_REVERSAL_BOTTOM', 'AT_REVERSAL_TOP'])]
    late_signals = results_df[results_df['timing_category'].isin(['LATE_BOTTOM', 'LATE_TOP'])]
    false_signals = results_df[results_df['timing_category'].isin(['FALSE_BOTTOM', 'FALSE_TOP'])]
    sideways = results_df[results_df['timing_category'] == 'SIDEWAYS']
    
    print("\n📈 CONSOLIDATED TIMING CATEGORIES:")
    print(f"  At Swing High/Low (Reversals): {len(at_reversal)} ({len(at_reversal)/len(results_df)*100:.1f}%)")
    print(f"  Late Signals (Slow to develop): {len(late_signals)} ({len(late_signals)/len(results_df)*100:.1f}%)")
    print(f"  False Reversal Signals: {len(false_signals)} ({len(false_signals)/len(results_df)*100:.1f}%)")
    print(f"  Sideways (No clear direction): {len(sideways)} ({len(sideways)/len(results_df)*100:.1f}%)")
    
    # TP vs SL breakdown
    print("\n🎯 TIMING BY OUTCOME (TP vs SL):")
    
    print("\n  Take Profit (TP) Signals:")
    tp_signals = results_df[results_df['TP_SL'] == 'TP']
    if len(tp_signals) > 0:
        tp_reversal = len(tp_signals[tp_signals['timing_category'].isin(['AT_REVERSAL_BOTTOM', 'AT_REVERSAL_TOP'])])
        tp_late = len(tp_signals[tp_signals['timing_category'].isin(['LATE_BOTTOM', 'LATE_TOP'])])
        tp_false = len(tp_signals[tp_signals['timing_category'].isin(['FALSE_BOTTOM', 'FALSE_TOP'])])
        tp_sideways = len(tp_signals[tp_signals['timing_category'] == 'SIDEWAYS'])
        
        print(f"    At Reversal: {tp_reversal}/{len(tp_signals)} ({tp_reversal/len(tp_signals)*100:.1f}%)")
        print(f"    Late Development: {tp_late}/{len(tp_signals)} ({tp_late/len(tp_signals)*100:.1f}%)")
        print(f"    False Reversal: {tp_false}/{len(tp_signals)} ({tp_false/len(tp_signals)*100:.1f}%)")
        print(f"    Sideways: {tp_sideways}/{len(tp_signals)} ({tp_sideways/len(tp_signals)*100:.1f}%)")
    
    print("\n  Stop Loss (SL) Signals:")
    sl_signals = results_df[results_df['TP_SL'] == 'SL']
    if len(sl_signals) > 0:
        sl_reversal = len(sl_signals[sl_signals['timing_category'].isin(['AT_REVERSAL_BOTTOM', 'AT_REVERSAL_TOP'])])
        sl_late = len(sl_signals[sl_signals['timing_category'].isin(['LATE_BOTTOM', 'LATE_TOP'])])
        sl_false = len(sl_signals[sl_signals['timing_category'].isin(['FALSE_BOTTOM', 'FALSE_TOP'])])
        sl_sideways = len(sl_signals[sl_signals['timing_category'] == 'SIDEWAYS'])
        
        print(f"    At Reversal: {sl_reversal}/{len(sl_signals)} ({sl_reversal/len(sl_signals)*100:.1f}%)")
        print(f"    Late Development: {sl_late}/{len(sl_signals)} ({sl_late/len(sl_signals)*100:.1f}%)")
        print(f"    False Reversal: {sl_false}/{len(sl_signals)} ({sl_false/len(sl_signals)*100:.1f}%)")
        print(f"    Sideways: {sl_sideways}/{len(sl_signals)} ({sl_sideways/len(sl_signals)*100:.1f}%)")
    
    # Detailed breakdown by signal direction
    print("\n📊 DETAILED BREAKDOWN BY SIGNAL DIRECTION:")
    
    print("\n  BUY Signals (attempting to catch bottoms):")
    buy_signals = results_df[results_df['signalSide'] == 'buy']
    if len(buy_signals) > 0:
        buy_tp = buy_signals[buy_signals['TP_SL'] == 'TP']
        buy_sl = buy_signals[buy_signals['TP_SL'] == 'SL']
        
        print(f"    Total: {len(buy_signals)}")
        print(f"    At Bottom (reversal): {len(buy_signals[buy_signals['timing_category'] == 'AT_REVERSAL_BOTTOM'])}")
        print(f"    Late Bottom: {len(buy_signals[buy_signals['timing_category'] == 'LATE_BOTTOM'])}")
        print(f"    False Bottom: {len(buy_signals[buy_signals['timing_category'] == 'FALSE_BOTTOM'])}")
        
        if len(buy_tp) > 0:
            print(f"\n    TP Buy Signals: {len(buy_tp)}")
            print(f"      - At Bottom: {len(buy_tp[buy_tp['timing_category'] == 'AT_REVERSAL_BOTTOM'])}")
            print(f"      - Late Bottom: {len(buy_tp[buy_tp['timing_category'] == 'LATE_BOTTOM'])}")
        
        if len(buy_sl) > 0:
            print(f"\n    SL Buy Signals: {len(buy_sl)}")
            print(f"      - At Bottom: {len(buy_sl[buy_sl['timing_category'] == 'AT_REVERSAL_BOTTOM'])}")
            print(f"      - Late Bottom: {len(buy_sl[buy_sl['timing_category'] == 'LATE_BOTTOM'])}")
    
    print("\n  SELL Signals (attempting to catch tops):")
    sell_signals = results_df[results_df['signalSide'] == 'sell']
    if len(sell_signals) > 0:
        sell_tp = sell_signals[sell_signals['TP_SL'] == 'TP']
        sell_sl = sell_signals[sell_signals['TP_SL'] == 'SL']
        
        print(f"    Total: {len(sell_signals)}")
        print(f"    At Top (reversal): {len(sell_signals[sell_signals['timing_category'] == 'AT_REVERSAL_TOP'])}")
        print(f"    Late Top: {len(sell_signals[sell_signals['timing_category'] == 'LATE_TOP'])}")
        print(f"    False Top: {len(sell_signals[sell_signals['timing_category'] == 'FALSE_TOP'])}")
        
        if len(sell_tp) > 0:
            print(f"\n    TP Sell Signals: {len(sell_tp)}")
            print(f"      - At Top: {len(sell_tp[sell_tp['timing_category'] == 'AT_REVERSAL_TOP'])}")
            print(f"      - Late Top: {len(sell_tp[sell_tp['timing_category'] == 'LATE_TOP'])}")
        
        if len(sell_sl) > 0:
            print(f"\n    SL Sell Signals: {len(sell_sl)}")
            print(f"      - At Top: {len(sell_sl[sell_sl['timing_category'] == 'AT_REVERSAL_TOP'])}")
            print(f"      - Late Top: {len(sell_sl[sell_sl['timing_category'] == 'LATE_TOP'])}")
    
    # Success rates by timing
    print("\n🎯 SUCCESS RATES BY TIMING:")
    
    # At reversal success rate
    reversal_tp = len(at_reversal[at_reversal['TP_SL'] == 'TP'])
    reversal_sl = len(at_reversal[at_reversal['TP_SL'] == 'SL'])
    if reversal_tp + reversal_sl > 0:
        reversal_success = reversal_tp / (reversal_tp + reversal_sl) * 100
        print(f"  Signals at Reversal Points: {reversal_success:.1f}% success ({reversal_tp} TP / {reversal_sl} SL)")
    
    # Late signals success rate
    late_tp = len(late_signals[late_signals['TP_SL'] == 'TP'])
    late_sl = len(late_signals[late_signals['TP_SL'] == 'SL'])
    if late_tp + late_sl > 0:
        late_success = late_tp / (late_tp + late_sl) * 100
        print(f"  Late Development Signals: {late_success:.1f}% success ({late_tp} TP / {late_sl} SL)")
    
    # False signal success rate
    false_tp = len(false_signals[false_signals['TP_SL'] == 'TP'])
    false_sl = len(false_signals[false_signals['TP_SL'] == 'SL'])
    if false_tp + false_sl > 0:
        false_success = false_tp / (false_tp + false_sl) * 100
        print(f"  False Reversal Signals: {false_success:.1f}% success ({false_tp} TP / {false_sl} SL)")
    
    # Price movement magnitude analysis
    print("\n📏 MOVEMENT MAGNITUDE ANALYSIS:")
    
    print("\n  Average Movement After Signal (by timing):")
    for category in ['AT_REVERSAL_BOTTOM', 'AT_REVERSAL_TOP', 'LATE_BOTTOM', 'LATE_TOP', 'FALSE_BOTTOM', 'FALSE_TOP', 'SIDEWAYS']:
        cat_data = results_df[results_df['timing_category'] == category]
        if len(cat_data) > 0:
            avg_5min = cat_data['movement_5min'].mean() * 100
            avg_15min = cat_data['movement_15min'].mean() * 100
            avg_1hr = cat_data['movement_1hr'].mean() * 100
            print(f"    {category}:")
            print(f"      5min: {avg_5min:+.2f}%, 15min: {avg_15min:+.2f}%, 1hr: {avg_1hr:+.2f}%")
    
    # Confidence levels by timing
    print("\n🔍 CONFIDENCE LEVELS BY TIMING:")
    for category in ['AT_REVERSAL_BOTTOM', 'AT_REVERSAL_TOP', 'LATE_BOTTOM', 'LATE_TOP']:
        cat_data = results_df[results_df['timing_category'] == category]
        if len(cat_data) > 0:
            avg_conf = cat_data['confidence'].mean()
            print(f"  {category}: avg confidence = {avg_conf:.3f}")
    
    # Hour analysis for reversal timing
    print("\n⏰ REVERSAL TIMING BY HOUR:")
    reversal_by_hour = at_reversal.groupby('hour').size()
    for hour, count in reversal_by_hour.items():
        print(f"  Hour {hour:02d}:00 - {count} reversal signals")
    
    return results_df

def create_summary_report(results_df):
    """Create a summary report of timing analysis"""
    print("\n" + "="*80)
    print("EXECUTIVE SUMMARY - SWING TIMING ANALYSIS")
    print("="*80)
    
    total = len(results_df)
    tp_total = len(results_df[results_df['TP_SL'] == 'TP'])
    sl_total = len(results_df[results_df['TP_SL'] == 'SL'])
    
    # Calculate key metrics
    at_reversal = results_df[results_df['timing_category'].isin(['AT_REVERSAL_BOTTOM', 'AT_REVERSAL_TOP'])]
    late_signals = results_df[results_df['timing_category'].isin(['LATE_BOTTOM', 'LATE_TOP'])]
    false_signals = results_df[results_df['timing_category'].isin(['FALSE_BOTTOM', 'FALSE_TOP'])]
    sideways = results_df[results_df['timing_category'] == 'SIDEWAYS']
    
    reversal_pct = len(at_reversal) / total * 100
    late_pct = len(late_signals) / total * 100
    false_pct = len(false_signals) / total * 100
    sideways_pct = len(sideways) / total * 100
    
    # TP/SL at reversals
    tp_at_reversal = len(at_reversal[at_reversal['TP_SL'] == 'TP'])
    sl_at_reversal = len(at_reversal[at_reversal['TP_SL'] == 'SL'])
    
    # TP/SL late signals
    tp_late = len(late_signals[late_signals['TP_SL'] == 'TP'])
    sl_late = len(late_signals[late_signals['TP_SL'] == 'SL'])
    
    print(f"\n📊 KEY FINDINGS:")
    print(f"\n1. TIMING DISTRIBUTION:")
    print(f"   • {reversal_pct:.1f}% of signals occur at swing highs/lows (reversal points)")
    print(f"   • {late_pct:.1f}% of signals are late (slow to develop)")
    print(f"   • {false_pct:.1f}% are false reversals")
    print(f"   • {sideways_pct:.1f}% occur in sideways markets")
    
    print(f"\n2. SUCCESS BY TIMING:")
    if tp_at_reversal + sl_at_reversal > 0:
        reversal_success = tp_at_reversal / (tp_at_reversal + sl_at_reversal) * 100
        print(f"   • Reversal signals: {reversal_success:.1f}% success rate")
        print(f"     - {tp_at_reversal} TP / {sl_at_reversal} SL")
    
    if tp_late + sl_late > 0:
        late_success = tp_late / (tp_late + sl_late) * 100
        print(f"   • Late development signals: {late_success:.1f}% success rate")
        print(f"     - {tp_late} TP / {sl_late} SL")
    
    print(f"\n3. TP SIGNAL TIMING:")
    if tp_total > 0:
        tp_reversal_pct = tp_at_reversal / tp_total * 100
        tp_late_pct = tp_late / tp_total * 100
        print(f"   • {tp_reversal_pct:.1f}% of TP signals catch reversals")
        print(f"   • {tp_late_pct:.1f}% of TP signals are late to develop")
    
    print(f"\n4. SL SIGNAL TIMING:")
    if sl_total > 0:
        sl_reversal_pct = sl_at_reversal / sl_total * 100
        sl_late_pct = sl_late / sl_total * 100
        print(f"   • {sl_reversal_pct:.1f}% of SL signals attempt reversals")
        print(f"   • {sl_late_pct:.1f}% of SL signals are late to develop")
    
    print(f"\n💡 INSIGHTS:")
    if 'reversal_success' in locals() and 'late_success' in locals():
        if reversal_success > late_success:
            print(f"   ✅ Reversal signals are {reversal_success - late_success:.1f}% more successful than late signals")
            print(f"   → Focus on improving reversal detection accuracy")
        else:
            print(f"   ⚠️ Late development signals are {late_success - reversal_success:.1f}% more successful")
            print(f"   → Consider waiting for confirmation before signaling")
    
    print(f"\n📈 RECOMMENDATIONS:")
    print(f"   1. Prioritize signals that show strong reversal characteristics")
    print(f"   2. Add filters to avoid late entries after movement has started")
    print(f"   3. Consider different thresholds for reversal vs continuation signals")
    print(f"   4. Implement swing point detection to improve timing")

def main():
    """Run the swing timing analysis"""
    results_df = analyze_swing_timing()
    create_summary_report(results_df)
    print("\n" + "="*80)
    print("ANALYSIS COMPLETE")
    print("="*80)

if __name__ == "__main__":
    main()