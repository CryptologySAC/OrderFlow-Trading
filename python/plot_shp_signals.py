import pandas as pd
import sqlite3
from datetime import timedelta, datetime
import numpy as np
import matplotlib.pyplot as plt
import os

# Constants
DB_PATH = '../trades.db'
WINDOW_SECONDS = 600  # ±5 minutes (300 seconds before and after)
START_TIME = pd.to_datetime('2025-01-31 21:37:27', utc=True).tz_convert('America/Lima')
END_TIME = pd.to_datetime('2025-02-10 11:41:28', utc=True).tz_convert('America/Lima')

# True Positives (9)
TRUE_POSITIVES = [
    pd.to_datetime('2025-02-01 22:13:05.635000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 23:15:56.899000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 01:35:45.080000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 10:06:30.104000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 07:41:02.505000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 08:08:20.309000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 16:06:40.992000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 04:50:23.735000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-08 03:33:50.388000-05:00').tz_convert('America/Lima'),
]

# False Positives (437)
FALSE_POSITIVES = [
    pd.to_datetime('2025-01-31 18:15:52.721000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-01-31 19:53:13.253000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-01-31 21:13:04.733000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-01-31 21:31:54.358000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-01-31 22:23:31.771000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 00:46:30.265000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 01:45:57.086000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 02:44:32.053000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 02:51:04.647000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 02:58:11.217000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 03:03:17.201000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 03:08:40.258000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 03:18:34.589000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 03:29:56.343000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 03:35:08.214000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 03:43:37.418000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 03:50:49.252000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 04:00:30.769000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 04:30:05.476000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 04:44:56.902000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 05:23:38.277000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 05:36:25.101000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 05:44:47.893000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 07:00:05.105000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 08:42:17.205000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 09:24:47.523000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 09:48:43.165000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 10:30:55.147000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 10:46:56.166000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 14:17:07.695000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 14:33:13.986000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 15:55:36.608000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 16:16:15.443000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 16:50:28.865000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 17:07:22.205000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 17:52:20.733000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 18:04:09.290000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 18:10:43.695000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 18:18:30.918000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 18:56:43.241000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 19:09:52.092000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 19:34:40.069000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 19:57:22.381000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 21:25:44.543000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 21:44:54.141000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 22:23:32.754000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 22:35:05.705000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 22:44:21.053000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-01 23:34:15.737000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 00:18:35.108000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 00:38:14.677000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 00:53:32.826000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 01:47:46.011000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 02:04:38.501000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 02:16:48.002000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 03:09:02.020000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 03:15:08.079000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 03:37:20.100000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 04:12:08.598000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 05:27:02.202000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 06:50:48.307000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 07:23:24.384000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 07:31:08.997000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 07:57:07.530000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 08:25:44.137000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 08:48:06.126000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 09:00:12.895000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 10:00:08.024000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 10:26:18.229000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 11:03:17.131000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 11:32:38.961000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 11:50:04.528000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 11:57:07.599000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 12:36:59.982000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 12:45:15.719000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 12:55:00.615000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 13:41:11.387000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 14:37:11.300000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 15:09:10.971000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 15:20:32.312000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 15:54:30.132000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 16:17:59.847000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 18:29:42.881000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 18:58:50.921000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 19:03:52.936000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 20:18:57.303000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 21:41:45.186000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 22:27:22.473000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 22:37:04.060000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 22:54:11.145000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 23:09:37.551000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 23:32:38.161000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 23:41:13.137000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 23:46:31.522000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-02 23:58:09.977000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 00:03:22.432000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 00:17:51.928000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 00:31:00.663000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 00:36:45.349000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 00:44:32.096000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 00:53:37.551000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 00:58:42.941000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 01:30:36.637000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 01:41:06.945000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 01:54:40.965000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 02:01:09.299000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 02:22:12.845000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 02:36:09.873000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 02:43:43.643000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 02:55:39.500000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 03:04:30.372000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 03:59:55.852000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 04:10:28.952000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 04:35:31.293000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 05:10:31.966000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 05:19:24.866000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 05:25:06.263000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 05:31:51.090000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 05:39:39.974000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 07:07:10.345000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 07:14:40.541000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 07:19:40.706000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 07:29:21.248000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 07:57:38.396000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 08:02:39.659000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 08:11:41.456000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 08:36:31.392000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 08:55:01.001000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 09:01:47.074000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 09:07:08.699000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 09:27:45.051000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 10:11:30.108000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 10:18:29.254000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 10:31:38.491000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 10:38:09.286000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 10:48:08.266000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 10:54:54.263000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 11:01:53.964000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 11:08:30.050000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 11:17:46.707000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 11:25:02.670000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 11:34:49.980000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 11:40:06.277000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 12:31:03.231000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 12:37:03.442000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 12:52:47.259000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 13:09:43.209000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 13:18:21.724000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 13:23:21.790000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 13:37:01.458000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 13:42:59.083000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 14:12:38.686000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 14:19:36.575000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 14:25:20.047000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 14:42:56.196000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 14:58:02.244000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 15:11:23-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 15:36:11.380000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 15:42:40.046000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 16:32:12.494000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 17:11:02.388000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 17:34:40.309000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 18:21:18.903000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 18:47:07.254000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 19:04:45.200000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 19:16:14.270000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 19:24:03.441000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 19:34:13.521000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 21:27:13.197000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 21:34:46.033000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-03 22:07:56.985000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 00:01:49.702000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 00:26:23.783000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 00:56:08.725000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 01:11:12.944000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 01:34:30.981000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 01:39:43.541000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 02:39:36.810000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 02:55:53.584000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 04:02:47.249000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 04:27:36.499000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 05:16:41.343000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 05:39:25.230000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 05:45:44.175000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 06:34:51.354000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 06:58:44.090000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 07:04:12.147000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 07:10:42.302000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 07:39:11.301000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 08:00:58.375000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 08:06:48.644000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 08:15:26.288000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 08:32:44.042000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 08:37:45.568000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 09:04:19.203000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 11:41:24.202000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 12:08:13.847000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 12:15:54.080000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 13:14:21.902000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 13:52:40.731000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 14:22:24.568000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 14:28:57.093000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 14:45:34.266000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 15:10:50.716000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 16:28:15.044000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 16:47:31.938000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 17:01:53.158000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 17:34:44.844000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 19:11:41.954000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 19:55:04.638000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 20:00:48.802000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 21:16:30.318000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-04 22:01:22.235000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 02:36:46.894000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 02:55:59.100000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 03:04:56.028000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 04:36:38.225000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 05:29:26.742000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 05:49:34.601000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 06:00:34.192000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 06:06:59.331000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 06:13:01.145000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 06:29:14.751000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 06:50:58.951000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 07:00:13.986000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 07:18:22.017000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 07:39:12.222000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 07:45:56.430000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 08:01:49.102000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 08:17:32.448000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 08:31:35.472000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 09:27:40.890000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 09:43:51.035000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 09:48:53.665000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 10:36:24.945000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 10:41:29.575000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 11:34:46.701000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 12:06:58.675000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 12:38:52.622000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 12:50:35.338000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 13:17:34.577000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 13:48:14.533000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 14:03:42.931000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 14:48:37.618000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 15:06:00.918000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 15:39:04.417000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 15:45:54.246000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 16:17:29.956000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 16:53:09.321000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 17:38:25.155000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 17:56:04.252000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 18:31:01.566000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 19:00:09.420000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 19:08:45.515000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 20:21:07.743000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-05 22:10:13.680000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 00:12:51.144000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 01:03:49.333000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 01:43:14.904000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 02:20:54.393000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 02:41:29.079000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 03:10:26.399000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 03:36:58.959000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 04:00:35.266000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 04:10:44.926000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 04:49:24.963000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 05:04:12.942000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 05:32:32.936000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 05:47:01.133000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 05:58:40.975000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 06:08:08.570000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 06:46:08.901000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 07:28:18.526000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 08:33:23.777000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 08:55:06.001000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 09:08:59.386000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 09:38:35.073000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 09:49:09.223000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 10:00:42.092000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 10:13:00.767000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 10:38:06.934000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 10:45:03.551000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 10:52:43.602000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 11:00:27.477000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 11:44:06.600000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 12:00:47.380000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 12:09:02.326000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 12:15:24.375000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 12:26:13.933000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 14:12:24.683000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 15:49:58.804000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 17:31:42.202000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 18:57:40.983000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 19:02:40.998000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 19:53:27.553000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 19:59:01.904000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 20:18:24.354000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 20:46:48.563000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 21:35:24.960000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 21:54:35.088000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 22:19:35.894000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 22:47:05.536000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-06 23:03:37.725000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 01:16:46.731000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 01:26:12.408000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 02:12:18.024000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 03:12:43.617000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 03:45:49.534000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 04:19:15.766000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 05:31:02.126000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 05:58:32.795000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 06:08:46.391000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 07:01:58.843000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 08:12:12.902000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 08:43:32.303000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 09:05:53.189000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 09:14:22.757000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 09:19:23.606000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 09:35:20.044000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 09:41:05.109000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 10:02:13.604000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 10:07:13.753000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 10:20:13.816000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 10:25:14.060000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 11:36:20.375000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 11:55:19.747000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 12:02:44.391000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 12:10:55.107000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 12:19:17.679000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 12:41:36.476000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 13:15:41.598000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 13:40:21.950000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 13:48:28.687000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 14:02:29.042000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 14:42:38.568000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 15:49:27.718000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 16:23:30.949000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 16:57:08.341000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 17:28:14.408000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 18:43:27.137000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 19:40:18.237000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 20:59:34.314000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 21:22:38.632000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 21:46:21.601000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-07 23:00:07.468000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-08 02:16:10.041000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-08 02:46:40.002000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-08 02:57:56.598000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-08 03:27:59.548000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-08 04:23:39.190000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-08 05:14:27.614000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-08 05:31:50.464000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-08 06:00:46.600000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-08 07:16:35.068000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-08 07:25:10.814000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-08 07:33:29.232000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-08 09:13:00.423000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-08 09:33:39.020000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-08 10:32:09.232000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-08 11:01:50.003000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-08 12:09:24.515000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-08 14:01:53.939000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-08 17:04:11.801000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-08 19:35:45.402000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-08 22:27:14.096000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-08 22:44:52.649000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-08 22:50:24.998000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 00:03:29.650000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 01:22:52.274000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 02:01:38.501000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 07:01:42.843000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 07:31:16.883000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 08:31:09.546000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 08:51:06.968000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 09:05:59.768000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 10:08:00.184000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 10:35:11.111000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 11:39:13.645000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 11:58:09.944000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 13:16:00-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 14:38:00.245000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 14:46:06.814000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 16:19:06.468000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 16:38:12.788000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 16:44:30.465000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 16:55:11.472000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 17:12:35.269000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 17:25:33.367000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 17:31:39.727000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 18:13:30.617000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 18:39:04.871000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 19:26:07.560000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 19:46:15.919000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 20:02:16.562000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 20:11:08.109000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 20:18:58.571000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 20:26:53.343000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 20:37:23.938000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 20:59:05.684000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 21:22:03.688000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 21:31:53.754000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 21:42:32.251000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 21:49:39.774000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 22:20:10.375000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 23:10:53.001000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 23:21:34.115000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 23:29:45.384000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-09 23:39:32.800000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-10 00:13:26.600000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-10 00:41:04.202000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-10 01:02:29.781000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-10 01:12:36.628000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-10 01:28:40.614000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-10 01:33:42.371000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-10 01:54:37.378000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-10 02:21:42.147000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-10 02:37:16.260000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-10 02:52:56.394000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-10 03:11:13.800000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-10 03:17:40.391000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-10 03:26:02.750000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-10 03:32:04.814000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-10 03:40:01.787000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-10 04:03:48.811000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-10 04:17:51.958000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-10 04:24:24.043000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-10 04:30:15.001000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-10 04:57:15.605000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-10 05:39:17.199000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-10 05:51:55.402000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-10 05:58:51.146000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-10 06:12:13.873000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-10 06:28:29.192000-05:00').tz_convert('America/Lima'),
    pd.to_datetime('2025-02-10 06:36:34.242000-05:00').tz_convert('America/Lima'),
]

def load_trades():
    conn = sqlite3.connect(DB_PATH)
    trades = pd.read_sql_query("SELECT tradeTime, price, quantity, isBuyerMaker FROM aggregated_trades ORDER BY tradeTime ASC", conn)
    trades['tradeTime'] = pd.to_datetime(trades['tradeTime'], unit='ms', utc=True).dt.tz_convert('America/Lima')
    conn.close()
    trades = trades[(trades['tradeTime'] >= START_TIME) & (trades['tradeTime'] <= END_TIME)]
    return trades

def generate_true_positive_timestamps():
    true_positive_timestamps = [pd.to_datetime('2025-02-10 10:47:52', utc=True).tz_convert('America/Lima')]
    np.random.seed(42)
    for _ in range(110):
        while True:
            random_time = START_TIME + timedelta(seconds=np.random.randint(0, (END_TIME - START_TIME).total_seconds()))
            too_close = any(abs((random_time - shp).total_seconds()) < 300 for shp in true_positive_timestamps)
            if not too_close:
                true_positive_timestamps.append(random_time)
                break
    return sorted(true_positive_timestamps)

def get_missed_true_positives(true_positive_timestamps, detected_true_positives):
    detected_set = set(detected_true_positives)
    missed = [tp for tp in true_positive_timestamps if tp not in detected_set]
    return missed

def plot_signal(trades, signal_time, label, idx):
    window_start = signal_time - timedelta(seconds=WINDOW_SECONDS // 2)
    window_end = signal_time + timedelta(seconds=WINDOW_SECONDS // 2)
    window_trades = trades[(trades['tradeTime'] >= window_start) & (trades['tradeTime'] <= window_end)]

    if window_trades.empty:
        print(f"No trades found for {label} {idx} at {signal_time}")
        return

    # Normalize quantity for circle size (scale to 10-100)
    quantities = window_trades['quantity']
    q_min, q_max = quantities.min(), quantities.max()
    if q_max > q_min:
        sizes = 10 + 90 * (quantities - q_min) / (q_max - q_min)
    else:
        sizes = 50  # Default size if all quantities are the same

    # Colors: green for buy (isBuyerMaker=False), red for sell (isBuyerMaker=True)
    colors = ['green' if not is_buyer else 'red' for is_buyer in window_trades['isBuyerMaker']]

    plt.figure(figsize=(8, 6))
    plt.scatter(window_trades['tradeTime'], window_trades['price'], s=sizes, c=colors, alpha=0.6)
    
    # Highlight the signal point
    signal_trade = window_trades.iloc[(window_trades['tradeTime'] - signal_time).abs().argmin()]
    signal_size = 10 + 90 * (signal_trade['quantity'] - q_min) / (q_max - q_min) if q_max > q_min else 50
    signal_color = 'green' if not signal_trade['isBuyerMaker'] else 'red'
    plt.scatter(signal_trade['tradeTime'], signal_trade['price'], s=signal_size, c=signal_color, edgecolors='black', linewidth=2, label='Signal')

    # Add a vertical line at the signal time
    plt.axvline(x=signal_time, color='black', linestyle='--', label='Signal Time')

    plt.title(f"{label} {idx}: {signal_time.strftime('%Y-%m-%d %H:%M:%S')}")
    plt.xlabel('Time')
    plt.ylabel('Price')
    plt.legend()
    plt.xticks(rotation=45)
    plt.tight_layout()

    # Create output directory if it doesn't exist
    os.makedirs('shp_plots', exist_ok=True)
    filename = f"shp_plots/{label.lower().replace(' ', '_')}_{idx}_{signal_time.strftime('%Y%m%d_%H%M%S')}.png"
    plt.savefig(filename)
    plt.close()

if __name__ == '__main__':
    # Load trades
    trades = load_trades()
    print(f"Loaded {len(trades)} trades")

    # Generate all true positive timestamps
    all_true_positives = generate_true_positive_timestamps()
    print(f"Generated {len(all_true_positives)} true positive timestamps")

    # Identify missed true positives
    missed_true_positives = get_missed_true_positives(all_true_positives, TRUE_POSITIVES)
    print(f"Missed True Positives: {len(missed_true_positives)}")

    # Plot True Positives
    for idx, tp in enumerate(TRUE_POSITIVES, 1):
        print(f"Plotting True Positive {idx}/{len(TRUE_POSITIVES)}: {tp}")
        plot_signal(trades, tp, "True Positive", idx)

    # Plot Missed True Positives
    for idx, mtp in enumerate(missed_true_positives, 1):
        print(f"Plotting Missed True Positive {idx}/{len(missed_true_positives)}: {mtp}")
        plot_signal(trades, mtp, "Missed True Positive", idx)

    # Plot False Positives
    for idx, fp in enumerate(FALSE_POSITIVES, 1):
        print(f"Plotting False Positive {idx}/{len(FALSE_POSITIVES)}: {fp}")
        plot_signal(trades, fp, "False Positive", idx)

    print("All plots generated in 'shp_plots' directory")