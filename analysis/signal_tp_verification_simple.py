#!/usr/bin/env python3
"""
Signal Take Profit Verification Analysis (Simplified)
Verifies if successful absorption signals actually reached their TP targets within 90 minutes
"""

import sqlite3
import glob
import csv
from datetime import datetime, timedelta
import os

def parse_signal_logs(log_dir="logs"):
    """Parse successful absorption signals from CSV logs"""
    signals = []
    
    # Find all successful absorption signal files
    pattern = os.path.join(log_dir, "**/absorption_successful_*.csv")
    files = glob.glob(pattern, recursive=True)
    
    print(f"Found {len(files)} successful signal files")
    
    for file in files:
        print(f"Reading: {file}")
        try:
            with open(file, 'r') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    try:
                        signal = {
                            'timestamp': int(row['timestamp']),
                            'signal_type': row['signalType'],
                            'price': float(row['price']),
                            'confidence': float(row.get('confidence', 0)),
                            'file': os.path.basename(file),
                            'date': datetime.fromtimestamp(int(row['timestamp']) / 1000)
                        }
                        signals.append(signal)
                    except (KeyError, ValueError) as e:
                        print(f"Error parsing row: {e}")
                        continue
        except Exception as e:
            print(f"Error reading file {file}: {e}")
    
    return signals

def analyze_signal(db_path, signal, minutes=90):
    """Analyze a single signal's performance"""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    start_time = signal['timestamp']
    end_time = start_time + (minutes * 60 * 1000)
    entry_price = signal['price']
    signal_type = signal['signal_type']
    
    # TP/SL levels
    tp_percentage = 0.007  # 0.7%
    sl_percentage = 0.005  # 0.5%
    
    if signal_type == 'TOP':
        tp_price = entry_price * (1 - tp_percentage)  # Short TP
        sl_price = entry_price * (1 + sl_percentage)  # Short SL
    else:  # BOTTOM
        tp_price = entry_price * (1 + tp_percentage)  # Long TP
        sl_price = entry_price * (1 - sl_percentage)  # Long SL
    
    # Get price data grouped by minute
    query = """
    SELECT 
        (T - ?) / 60000 as minute,
        MIN(CAST(p AS REAL)) as min_price,
        MAX(CAST(p AS REAL)) as max_price
    FROM aggregated_trades
    WHERE T >= ? AND T <= ?
    GROUP BY minute
    ORDER BY minute
    """
    
    cursor.execute(query, (start_time, start_time, end_time))
    price_data = cursor.fetchall()
    conn.close()
    
    if not price_data:
        return None
    
    # Track performance
    max_drawdown = 0
    max_gain = 0
    time_to_max_drawdown = None
    time_to_max_gain = None
    time_to_tp = None
    time_to_sl = None
    reached_tp = False
    reached_sl = False
    
    for minute, min_p, max_p in price_data:
        if min_p is None or max_p is None:
            continue
            
        minute = int(minute)
        
        if signal_type == 'TOP':
            # Short position
            drawdown_pct = ((max_p - entry_price) / entry_price) * 100
            gain_pct = ((entry_price - min_p) / entry_price) * 100
            
            if min_p <= tp_price and not reached_tp:
                reached_tp = True
                if time_to_tp is None:
                    time_to_tp = minute
            
            if max_p >= sl_price and not reached_sl:
                reached_sl = True
                if time_to_sl is None:
                    time_to_sl = minute
                    
        else:  # BOTTOM
            # Long position
            drawdown_pct = ((entry_price - min_p) / entry_price) * 100
            gain_pct = ((max_p - entry_price) / entry_price) * 100
            
            if max_p >= tp_price and not reached_tp:
                reached_tp = True
                if time_to_tp is None:
                    time_to_tp = minute
            
            if min_p <= sl_price and not reached_sl:
                reached_sl = True
                if time_to_sl is None:
                    time_to_sl = minute
        
        if drawdown_pct > max_drawdown:
            max_drawdown = drawdown_pct
            time_to_max_drawdown = minute
            
        if gain_pct > max_gain:
            max_gain = gain_pct
            time_to_max_gain = minute
    
    hit_sl_before_tp = reached_sl and (not reached_tp or (time_to_sl or 999) < (time_to_tp or 999))
    
    return {
        'max_drawdown_pct': round(max_drawdown, 3),
        'max_gain_pct': round(max_gain, 3),
        'time_to_max_drawdown_min': time_to_max_drawdown,
        'time_to_max_gain_min': time_to_max_gain,
        'reached_tp': reached_tp,
        'reached_sl': reached_sl,
        'time_to_tp_min': time_to_tp,
        'time_to_sl_min': time_to_sl,
        'hit_sl_before_tp': hit_sl_before_tp
    }

def main():
    db_path = "storage/trades.db"
    
    print("=" * 80)
    print("Signal Take Profit Verification Analysis")
    print("=" * 80)
    
    # Parse signals
    print("\n1. Parsing successful absorption signals...")
    signals = parse_signal_logs()
    print(f"Found {len(signals)} successful signals")
    
    if not signals:
        print("No signals found to analyze")
        return
    
    # Analyze each signal
    print("\n2. Analyzing price movements for each signal...")
    
    results = []
    tp_count = 0
    sl_count = 0
    sl_before_tp_count = 0
    no_data_count = 0
    
    for i, signal in enumerate(signals, 1):
        date_str = signal['date'].strftime('%Y-%m-%d %H:%M:%S')
        print(f"\nSignal {i}/{len(signals)}: {date_str} {signal['signal_type']} @ {signal['price']:.2f}")
        
        result = analyze_signal(db_path, signal)
        
        if result is None:
            print("  ⚠️ No price data found")
            no_data_count += 1
            continue
        
        results.append({**signal, **result})
        
        # Update counters
        if result['reached_tp']:
            tp_count += 1
        if result['reached_sl']:
            sl_count += 1
        if result['hit_sl_before_tp']:
            sl_before_tp_count += 1
        
        # Print summary
        print(f"  Max Drawdown: {result['max_drawdown_pct']:.3f}% at {result['time_to_max_drawdown_min']} min")
        print(f"  Max Gain: {result['max_gain_pct']:.3f}% at {result['time_to_max_gain_min']} min")
        print(f"  Reached TP: {result['reached_tp']} {'at ' + str(result['time_to_tp_min']) + ' min' if result['reached_tp'] else ''}")
        print(f"  Reached SL: {result['reached_sl']} {'at ' + str(result['time_to_sl_min']) + ' min' if result['reached_sl'] else ''}")
        if result['hit_sl_before_tp']:
            print(f"  ⚠️ HIT SL BEFORE TP!")
    
    # Summary
    print("\n" + "=" * 80)
    print("SUMMARY STATISTICS")
    print("=" * 80)
    
    analyzed_count = len(results)
    total_count = len(signals)
    
    print(f"\nTotal Signals: {total_count}")
    print(f"Signals with data: {analyzed_count}")
    print(f"Signals without data: {no_data_count}")
    
    if analyzed_count > 0:
        print(f"\n--- Take Profit Performance ---")
        print(f"Reached TP: {tp_count}/{analyzed_count} ({tp_count/analyzed_count*100:.1f}%)")
        
        print(f"\n--- Stop Loss Performance ---")
        print(f"Reached SL: {sl_count}/{analyzed_count} ({sl_count/analyzed_count*100:.1f}%)")
        print(f"Hit SL before TP: {sl_before_tp_count}/{analyzed_count} ({sl_before_tp_count/analyzed_count*100:.1f}%)")
        
        # Calculate averages
        avg_drawdown = sum(r['max_drawdown_pct'] for r in results) / len(results)
        avg_gain = sum(r['max_gain_pct'] for r in results) / len(results)
        max_drawdown = max(r['max_drawdown_pct'] for r in results)
        max_gain = max(r['max_gain_pct'] for r in results)
        
        print(f"\n--- Drawdown Statistics ---")
        print(f"Average Max Drawdown: {avg_drawdown:.3f}%")
        print(f"Worst Drawdown: {max_drawdown:.3f}%")
        
        print(f"\n--- Gain Statistics ---")
        print(f"Average Max Gain: {avg_gain:.3f}%")
        print(f"Best Gain: {max_gain:.3f}%")
        
        # Detailed table
        print("\n" + "=" * 140)
        print("DETAILED SIGNAL PERFORMANCE TABLE (ALL SIGNALS, NO OMISSIONS)")
        print("=" * 140)
        print(f"{'Date':<20} {'Type':<6} {'Price':<10} {'Max DD%':<10} {'DD Time':<10} {'Max Gain%':<12} {'Gain Time':<12} {'TP?':<5} {'SL?':<5} {'SL First?':<10}")
        print("-" * 140)
        
        # Sort by date
        results.sort(key=lambda x: x['date'])
        
        for r in results:
            date_str = r['date'].strftime('%Y-%m-%d %H:%M:%S')
            tp_str = '✓' if r['reached_tp'] else '✗'
            sl_str = '✓' if r['reached_sl'] else '✗'
            sl_first_str = '⚠️ YES' if r['hit_sl_before_tp'] else 'No'
            
            dd_time = str(r['time_to_max_drawdown_min']) if r['time_to_max_drawdown_min'] else 'N/A'
            gain_time = str(r['time_to_max_gain_min']) if r['time_to_max_gain_min'] else 'N/A'
            
            print(f"{date_str:<20} {r['signal_type']:<6} {r['price']:<10.2f} "
                  f"{r['max_drawdown_pct']:<10.3f} {dd_time:<10} "
                  f"{r['max_gain_pct']:<12.3f} {gain_time:<12} "
                  f"{tp_str:<5} {sl_str:<5} {sl_first_str:<10}")
        
        # Problem signals
        problem_signals = [r for r in results if r['hit_sl_before_tp']]
        if problem_signals:
            print("\n" + "=" * 80)
            print("⚠️  PROBLEM SIGNALS (Hit SL before TP)")
            print("=" * 80)
            print(f"\nTotal: {len(problem_signals)} signals")
            for r in problem_signals:
                print(f"\n{r['date'].strftime('%Y-%m-%d %H:%M:%S')} - {r['signal_type']} @ {r['price']:.2f}")
                print(f"  SL hit at: {r['time_to_sl_min']} min")
                print(f"  TP {'reached at ' + str(r['time_to_tp_min']) + ' min' if r['reached_tp'] else 'never reached'}")
                print(f"  Max drawdown: {r['max_drawdown_pct']:.3f}%")
        
        # Save results to CSV
        output_file = 'signal_tp_verification_results.csv'
        with open(output_file, 'w', newline='') as f:
            if results:
                fieldnames = ['date', 'signal_type', 'price', 'max_drawdown_pct', 'time_to_max_drawdown_min',
                             'max_gain_pct', 'time_to_max_gain_min', 'reached_tp', 'time_to_tp_min',
                             'reached_sl', 'time_to_sl_min', 'hit_sl_before_tp']
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                for r in results:
                    row = {k: r.get(k, '') for k in fieldnames}
                    row['date'] = r['date'].strftime('%Y-%m-%d %H:%M:%S')
                    writer.writerow(row)
        print(f"\n✅ Results saved to: {output_file}")

if __name__ == "__main__":
    main()