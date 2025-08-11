#!/usr/bin/env python3
"""
Comprehensive Signal TP/SL Analysis
Analyzes successful absorption signals to verify if they reached TP or SL
"""

import sqlite3
import glob
import csv
from datetime import datetime
import os

def analyze_signals_from_csv(log_dir="logs"):
    """Analyze signals directly from CSV files which already contain outcome data"""
    
    # Find all successful absorption signal files
    pattern = os.path.join(log_dir, "**/absorption_successful_*.csv")
    files = glob.glob(pattern, recursive=True)
    
    print(f"Found {len(files)} successful signal files")
    
    all_signals = []
    
    for file in files:
        print(f"\nAnalyzing: {file}")
        with open(file, 'r') as f:
            reader = csv.DictReader(f)
            file_signals = list(reader)
            all_signals.extend(file_signals)
            
            # Count TP vs SL for this file
            tp_count = sum(1 for s in file_signals if s.get('TP_SL') == 'TP')
            sl_count = sum(1 for s in file_signals if s.get('TP_SL') == 'SL')
            print(f"  Signals: {len(file_signals)} (TP: {tp_count}, SL: {sl_count})")
    
    return all_signals

def analyze_signal_details(db_path, signal_data):
    """Get detailed minute-by-minute price movement for a signal"""
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    timestamp = int(signal_data['timestamp'])
    price = float(signal_data['price'])
    
    # Get price movement for 90 minutes
    start_time = timestamp
    end_time = timestamp + (90 * 60 * 1000)
    
    # Query for minute-by-minute data
    query = """
    SELECT 
        (tradeTime - ?) / 60000 as minute,
        MIN(CAST(price AS REAL)) as min_price,
        MAX(CAST(price AS REAL)) as max_price,
        AVG(CAST(price AS REAL)) as avg_price,
        COUNT(*) as trade_count
    FROM aggregated_trades
    WHERE tradeTime >= ? AND tradeTime <= ?
    GROUP BY minute
    ORDER BY minute
    LIMIT 91
    """
    
    cursor.execute(query, (start_time, start_time, end_time))
    minute_data = cursor.fetchall()
    conn.close()
    
    if not minute_data:
        return None
    
    # Calculate max adverse excursion (drawdown) and favorable excursion
    max_adverse = 0
    max_favorable = 0
    time_to_max_adverse = None
    time_to_max_favorable = None
    
    # Determine if we're looking at a long or short signal
    # Based on subsequent movements - negative means price went down (good for short/TOP)
    movement_5min = float(signal_data.get('subsequentMovement5min', 0))
    is_short = movement_5min < 0  # If price went down, it was likely a TOP signal
    
    for minute, min_p, max_p, avg_p, trades in minute_data:
        if min_p is None or max_p is None:
            continue
        
        minute = int(minute)
        
        if is_short:
            # Short position: adverse = price up, favorable = price down
            adverse = ((max_p - price) / price) * 100
            favorable = ((price - min_p) / price) * 100
        else:
            # Long position: adverse = price down, favorable = price up
            adverse = ((price - min_p) / price) * 100
            favorable = ((max_p - price) / price) * 100
        
        if adverse > max_adverse:
            max_adverse = adverse
            time_to_max_adverse = minute
        
        if favorable > max_favorable:
            max_favorable = favorable
            time_to_max_favorable = minute
    
    return {
        'max_adverse_pct': round(max_adverse, 3),
        'max_favorable_pct': round(max_favorable, 3),
        'time_to_max_adverse': time_to_max_adverse,
        'time_to_max_favorable': time_to_max_favorable,
        'minute_count': len(minute_data),
        'signal_direction': 'SHORT' if is_short else 'LONG'
    }

def main():
    db_path = "storage/trades.db"
    
    print("=" * 100)
    print("COMPREHENSIVE SIGNAL TP/SL ANALYSIS")
    print("=" * 100)
    
    # Analyze signals from CSV
    signals = analyze_signals_from_csv()
    
    if not signals:
        print("No signals found")
        return
    
    print(f"\nTotal signals analyzed: {len(signals)}")
    
    # Count outcomes
    tp_signals = [s for s in signals if s.get('TP_SL') == 'TP']
    sl_signals = [s for s in signals if s.get('TP_SL') == 'SL']
    
    print(f"\n📊 OUTCOME SUMMARY:")
    print(f"  ✅ Reached TP: {len(tp_signals)} ({len(tp_signals)/len(signals)*100:.1f}%)")
    print(f"  ❌ Hit SL: {len(sl_signals)} ({len(sl_signals)/len(signals)*100:.1f}%)")
    
    # Analyze subsequent movements
    print(f"\n📈 PRICE MOVEMENT ANALYSIS:")
    
    for outcome, outcome_signals in [('TP', tp_signals), ('SL', sl_signals)]:
        if not outcome_signals:
            continue
            
        print(f"\n{outcome} Signals ({len(outcome_signals)} total):")
        
        movements_5min = [float(s['subsequentMovement5min']) * 100 for s in outcome_signals if s.get('subsequentMovement5min', '').strip()]
        movements_15min = [float(s['subsequentMovement15min']) * 100 for s in outcome_signals if s.get('subsequentMovement15min', '').strip()]
        movements_1hr = [float(s['subsequentMovement1hr']) * 100 for s in outcome_signals if s.get('subsequentMovement1hr', '').strip()]
        
        avg_5min = sum(movements_5min) / len(movements_5min) if movements_5min else 0
        avg_15min = sum(movements_15min) / len(movements_15min) if movements_15min else 0
        avg_1hr = sum(movements_1hr) / len(movements_1hr) if movements_1hr else 0
        
        print(f"  Average movement after 5 min: {avg_5min:+.3f}%")
        print(f"  Average movement after 15 min: {avg_15min:+.3f}%")
        print(f"  Average movement after 1 hour: {avg_1hr:+.3f}%")
        
        # Find worst/best movements
        if outcome == 'SL':
            worst_5min = max(movements_5min) if movements_5min else 0
            worst_15min = max(movements_15min) if movements_15min else 0
            worst_1hr = max(movements_1hr) if movements_1hr else 0
            print(f"  Worst adverse movement: 5min={worst_5min:+.3f}%, 15min={worst_15min:+.3f}%, 1hr={worst_1hr:+.3f}%")
    
    # Detailed analysis with database
    print(f"\n🔍 DETAILED MINUTE-BY-MINUTE ANALYSIS:")
    print("Analyzing first 20 signals for detailed drawdown/gain patterns...")
    
    detailed_results = []
    for i, signal in enumerate(signals[:20], 1):
        details = analyze_signal_details(db_path, signal)
        if details:
            detailed_results.append({**signal, **details})
            print(f"  Signal {i}: {details['signal_direction']} - "
                  f"Max Adverse: {details['max_adverse_pct']:.3f}% @ {details['time_to_max_adverse']}min, "
                  f"Max Favorable: {details['max_favorable_pct']:.3f}% @ {details['time_to_max_favorable']}min, "
                  f"Outcome: {signal['TP_SL']}")
    
    # Create comprehensive table
    print("\n" + "=" * 150)
    print("DETAILED SIGNAL TABLE (NO OMISSIONS)")
    print("=" * 150)
    print(f"{'Timestamp':<20} {'Price':<10} {'Outcome':<8} {'5min %':<10} {'15min %':<10} {'1hr %':<10} {'Confidence':<12} {'Valid Signal':<12}")
    print("-" * 150)
    
    for s in signals:
        timestamp = datetime.fromtimestamp(int(s['timestamp'])/1000).strftime('%Y-%m-%d %H:%M:%S')
        price = float(s['price'])
        outcome = s.get('TP_SL', '')
        mov_5min = float(s['subsequentMovement5min']) * 100 if s.get('subsequentMovement5min', '').strip() else 0
        mov_15min = float(s['subsequentMovement15min']) * 100 if s.get('subsequentMovement15min', '').strip() else 0
        mov_1hr = float(s['subsequentMovement1hr']) * 100 if s.get('subsequentMovement1hr', '').strip() else 0
        confidence = float(s['confidence']) if s.get('confidence', '').strip() else 0
        was_valid = s.get('wasValidSignal', '')
        
        # Highlight problematic signals
        marker = ""
        if outcome == 'SL' and abs(mov_5min) > 0.5:  # Hit SL with >0.5% adverse move in 5min
            marker = " ⚠️"
        
        print(f"{timestamp:<20} {price:<10.2f} {outcome:<8} {mov_5min:<+10.3f} {mov_15min:<+10.3f} {mov_1hr:<+10.3f} {confidence:<12.4f} {was_valid:<12}{marker}")
    
    # Summary statistics
    print("\n" + "=" * 100)
    print("KEY FINDINGS:")
    print("=" * 100)
    
    # Check how many SL signals went significantly negative before recovering
    sl_with_recovery = []
    for s in sl_signals:
        if not s.get('subsequentMovement5min', '').strip() or not s.get('subsequentMovement1hr', '').strip():
            continue
        mov_5min = float(s['subsequentMovement5min']) * 100
        mov_1hr = float(s['subsequentMovement1hr']) * 100
        # If it hit SL but later moved favorably
        if abs(mov_1hr) > 0.7:  # More than 0.7% move (TP level)
            sl_with_recovery.append(s)
    
    print(f"\n⚠️  CRITICAL ISSUE: {len(sl_signals)}/{len(signals)} signals ({len(sl_signals)/len(signals)*100:.1f}%) hit SL")
    
    if sl_with_recovery:
        print(f"⚠️  {len(sl_with_recovery)} SL signals would have reached TP if held longer:")
        for s in sl_with_recovery[:5]:  # Show first 5 examples
            timestamp = datetime.fromtimestamp(int(s['timestamp'])/1000).strftime('%H:%M:%S')
            mov_1hr = float(s['subsequentMovement1hr']) * 100
            print(f"    - {timestamp}: Hit SL but moved {mov_1hr:+.3f}% after 1 hour")
    
    # Save results
    output_file = 'signal_tp_sl_analysis_results.csv'
    with open(output_file, 'w', newline='') as f:
        if signals:
            writer = csv.DictWriter(f, fieldnames=signals[0].keys())
            writer.writeheader()
            writer.writerows(signals)
    print(f"\n✅ Full results saved to: {output_file}")
    
    # Final verdict
    print("\n" + "=" * 100)
    print("CONCLUSION:")
    print("=" * 100)
    tp_rate = len(tp_signals)/len(signals)*100
    if tp_rate < 50:
        print(f"❌ CRITICAL: Only {tp_rate:.1f}% of signals reached TP. Most signals hit SL first!")
        print("   This suggests the entry timing or SL placement needs adjustment.")
    else:
        print(f"✅ {tp_rate:.1f}% of signals reached TP successfully.")

if __name__ == "__main__":
    main()