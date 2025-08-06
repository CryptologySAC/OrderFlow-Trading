#!/usr/bin/env python3
"""
Quick database structure check
"""

import sqlite3
import pandas as pd

db_path = "/Users/marcschot/Projects/OrderFlow Trading/storage/trades.db"

try:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Get all tables
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = cursor.fetchall()
    print("Tables in database:")
    for table in tables:
        print(f"  - {table[0]}")
    
    # Check structure of trades table (or whatever the main table is)
    for table_name in [t[0] for t in tables]:
        print(f"\nTable '{table_name}' structure:")
        cursor.execute(f"PRAGMA table_info({table_name})")
        columns = cursor.fetchall()
        for col in columns:
            print(f"  {col[1]:20s} {col[2]:15s} {'NOT NULL' if col[3] else 'NULL':8s} {'PRIMARY KEY' if col[5] else ''}")
        
        # Get sample data
        cursor.execute(f"SELECT * FROM {table_name} LIMIT 3")
        sample = cursor.fetchall()
        if sample:
            print(f"\nSample data from '{table_name}':")
            df = pd.read_sql_query(f"SELECT * FROM {table_name} LIMIT 3", conn)
            print(df)
        
        # Get row count
        cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
        count = cursor.fetchone()[0]
        print(f"\nTotal rows in '{table_name}': {count}")
    
    conn.close()
    
except Exception as e:
    print(f"Error: {e}")
