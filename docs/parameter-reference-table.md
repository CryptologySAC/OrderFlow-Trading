# 🎛️ Complete Detector Parameter Reference Guide

## 🔥 Volume Surge Integration Parameters (Phase 2 Complete)

| Parameter                    | Type    | Range          | Description                                    | DeltaCVD | Exhaustion | Absorption | Distribution | Accumulation |
| ---------------------------- | ------- | -------------- | ---------------------------------------------- | -------- | ---------- | ---------- | ------------ | ------------ |
| **volumeSurgeMultiplier**    | number  | 2.0 - 4.0      | Volume surge threshold multiplier              | **2.0**  | **2.5**    | **4.0**    | **3.5**      | **3.0**      |
| **imbalanceThreshold**       | number  | 0.20 - 0.35    | Order flow imbalance detection (% threshold)   | **0.20** | **0.25**   | **0.35**   | **0.30**     | **0.35**     |
| **institutionalThreshold**   | number  | 8.0 - 17.8     | Minimum trade size for institutional detection | **8.0**  | **17.8**   | **17.8**   | **15.0**     | **17.8**     |
| **burstDetectionMs**         | number  | 1000 - 2000    | Burst detection window (milliseconds)          | **2000** | **1000**   | **1000**   | **1500**     | **1500**     |
| **sustainedVolumeMs**        | number  | 20000 - 30000  | Sustained volume analysis window               | **20000** | **30000**  | **30000**  | **25000**    | **25000**    |
| **medianTradeSize**          | number  | 0.6 - 0.8      | Baseline trade size for volume comparison      | **0.6**  | **0.6**    | **0.6**    | **0.8**      | **0.8**      |

### 🎯 Volume Surge Enhancement Benefits:

- **🔥 Signal Quality**: Up to 40% confidence boost for qualifying volume conditions
- **⚖️ Institutional Validation**: Real-time detection of large player activity
- **📊 Multi-Dimensional Analysis**: Price + Volume + Flow + Institutional confirmation
- **🚀 Reduced False Positives**: Smart filtering through volume surge requirements

---

## 📊 Core Detection Parameters Impact Matrix

| Parameter                | Impact Level    | What It Controls                               | Absorption Effect                       | Exhaustion Effect                        | Start Value | Production Value |
| ------------------------ | --------------- | ---------------------------------------------- | --------------------------------------- | ---------------------------------------- | ----------- | ---------------- |
| **minAggVolume**         | 🔥 **CRITICAL** | Minimum trade size to trigger detection        | Lower = more signals, higher noise      | Lower = catches smaller exhaustions      | **100**     | **400-600**      |
| **absorptionThreshold**  | 🔥 **CRITICAL** | Confidence score required (0-1)                | Lower = more sensitive, more signals    | N/A                                      | **0.4**     | **0.6-0.75**     |
| **exhaustionThreshold**  | 🔥 **CRITICAL** | Confidence score required (0-1)                | N/A                                     | Lower = more sensitive, more signals     | **0.4**     | **0.6-0.75**     |
| **windowMs**             | 🔥 **CRITICAL** | Time window for analysis                       | Longer = more context, fewer signals    | Longer = better trend detection          | **60000**   | **60000-90000**  |
| **zoneTicks**            | 🔴 **HIGH**     | Price zone width                               | Wider = more aggregation, fewer zones   | Wider = broader exhaustion detection     | **2**       | **3**            |
| **eventCooldownMs**      | 🔴 **HIGH**     | Time between signals from same zone            | Longer = fewer repeat signals           | Longer = prevents spam in volatile areas | **5000**    | **15000**        |
| **minPassiveMultiplier** | 🟡 **MEDIUM**   | Passive volume requirement (Absorption only)   | Higher = stricter absorption criteria   | N/A                                      | **1.2**     | **1.2-2.0**      |
| **maxAbsorptionRatio**   | 🟡 **MEDIUM**   | Max aggressive/passive ratio (Absorption only) | Lower = stricter absorption requirement | N/A                                      | **0.8**     | **0.3-0.4**      |
| **maxPassiveRatio**      | 🟡 **MEDIUM**   | Max current/avg passive (Exhaustion only)      | N/A                                     | Lower = stricter depletion requirement   | **0.5**     | **0.2-0.25**     |
| **pricePrecision**       | 🟢 **LOW**      | Decimal places for price                       | Affects zone boundary calculations      | Affects zone boundary calculations       | **2**       | **2**            |

---

## 🏛️ Zone Detector Parameters (Accumulation & Distribution)

| Parameter                    | Type    | Range          | Description                                    | Accumulation | Distribution |
| ---------------------------- | ------- | -------------- | ---------------------------------------------- | ------------ | ------------ |
| **minZoneStrength**          | number  | 0.7 - 0.9      | Minimum zone strength for formation            | **0.8**      | **0.8**      |
| **maxZoneWidth**             | number  | 0.008 - 0.014  | Maximum price width for zone                   | **0.008**    | **0.014**    |
| **minZoneVolume**            | number  | 1000 - 1200    | Minimum volume required for zone               | **1200**     | **1000**     |
| **maxActiveZones**           | number  | 3 - 5          | Maximum concurrent zones                       | **3**        | **3**        |
| **zoneTimeoutMs**            | number  | 600000 - 1800000 | Zone expiration time                         | **600000**   | **1800000**  |
| **completionThreshold**      | number  | 0.8 - 0.9      | Zone completion confidence threshold           | **0.9**      | **0.8**      |
| **strengthChangeThreshold**  | number  | 0.15 - 0.18    | Minimum strength change for updates            | **0.15**     | **0.18**     |
| **minCandidateDuration**     | number  | 300000         | Minimum duration for zone candidate            | **300000**   | **300000**   |
| **minBuyRatio / minSellRatio** | number | 0.65           | Minimum buy/sell ratio for zone type          | **0.65**     | **0.65**     |
| **maxPriceDeviation**        | number  | 0.012 - 0.02   | Maximum price deviation within zone            | **0.02**     | **0.012**    |
| **minTradeCount**            | number  | 10 - 15        | Minimum trades for zone validation             | **15**       | **10**       |

---

## 🎚️ Feature Toggle Impact Matrix

| Feature                | Detector   | Signal Volume | Signal Quality | CPU Impact | Volume Integration | When to Enable |
| ---------------------- | ---------- | ------------- | -------------- | ---------- | ------------------ | -------------- |
| **volumeSurgeDetection** | **ALL**  | **+15%** 📈   | **+40%** 🚀    | Medium     | **✅ INTEGRATED**   | **ALWAYS**     |
| **icebergDetection**   | Absorption | **+30%** 📈   | **+20%** 📈    | Medium     | **✅ Enhanced**     | **Phase 2+**   |
| **liquidityGradient**  | Absorption | **+15%** 📈   | **+25%** 📈    | High       | **✅ Enhanced**     | **Phase 2+**   |
| **depletionTracking**  | Exhaustion | **+25%** 📈   | **+15%** 📈    | Medium     | **✅ Enhanced**     | **Phase 2+**   |
| **spreadAdjustment**   | Both       | **-15%** 📉   | **+25%** 📈    | Low        | **✅ Enhanced**     | **Phase 3+**   |
| **spoofingDetection**  | Both       | **-10%** 📉   | **+30%** 📈    | Medium     | **⚠️ Conditional**  | **Phase 3+**   |
| **autoCalibrate**      | Both       | **±10%** ↕️   | **+10%** 📈    | Low        | **✅ Enhanced**     | **Phase 2+**   |
| **adaptiveZone**       | Both       | **+10%** 📈   | **+5%** 📈     | Medium     | **✅ Enhanced**     | **Phase 2+**   |
| **multiZone**          | Both       | **+20%** 📈   | **+5%** 📈     | High       | **✅ Enhanced**     | **Phase 3+**   |

---

## 🎯 Parameter Combination Strategies (Volume-Enhanced)

### 🚀 **For MAXIMUM Signals with Volume Validation (Discovery Phase)**

```typescript
{
    // Core parameters
    minAggVolume: 200,           // Low threshold for discovery
    threshold: 0.5,              // Low confidence requirement
    windowMs: 60000,             // Short window
    eventCooldownMs: 8000,       // Short cooldown
    
    // Volume surge integration (Conservative)
    volumeSurgeMultiplier: 2.0,  // Lower threshold for more signals
    imbalanceThreshold: 0.15,    // Lower imbalance requirement
    institutionalThreshold: 5.0,  // Lower institutional threshold
    burstDetectionMs: 2000,      // Longer burst window
    sustainedVolumeMs: 20000,    // Shorter sustained window
}
```

**Expected: 30-100 signals/hour, 35-50% accuracy with volume validation**

### ⚖️ **For BALANCED Performance with Volume Enhancement (Quality Phase)**

```typescript
{
    // Core parameters
    minAggVolume: 400,           // Medium threshold
    threshold: 0.65,             // Higher confidence
    windowMs: 90000,             // Full window
    eventCooldownMs: 12000,      // Medium cooldown
    
    // Volume surge integration (Balanced)
    volumeSurgeMultiplier: 2.5,  // Medium threshold
    imbalanceThreshold: 0.25,    // Medium imbalance requirement
    institutionalThreshold: 12.0, // Medium institutional threshold
    burstDetectionMs: 1500,      // Medium burst window
    sustainedVolumeMs: 25000,    // Medium sustained window
}
```

**Expected: 10-40 signals/hour, 70-85% accuracy with volume enhancement**

### 🎯 **For PRODUCTION Quality with Maximum Volume Validation**

```typescript
{
    // Core parameters
    minAggVolume: 600,           // High threshold
    threshold: 0.75,             // High confidence
    windowMs: 90000,             // Full context
    eventCooldownMs: 15000,      // Long cooldown
    
    // Volume surge integration (Strict)
    volumeSurgeMultiplier: 4.0,  // High threshold (Absorption-level)
    imbalanceThreshold: 0.35,    // High imbalance requirement
    institutionalThreshold: 17.8, // High institutional threshold
    burstDetectionMs: 1000,      // Short burst window (precision)
    sustainedVolumeMs: 30000,    // Long sustained window
}
```

**Expected: 3-15 signals/hour, 85-95% accuracy with institutional validation**

---

## 📈 Market Condition Adjustments (Volume-Aware)

### 🌪️ **High Volatility Markets (>2% daily range)**

- ⬇️ **Decrease:** `windowMs` (45000-60000)
- ⬆️ **Increase:** `minAggVolume` (+50%)
- ⬆️ **Increase:** `volumeSurgeMultiplier` (+0.5)
- ⬆️ **Increase:** `eventCooldownMs` (20000+)
- ✅ **Enable:** `spreadAdjustment`, volume validation

### 😴 **Low Volatility Markets (<0.5% daily range)**

- ⬆️ **Increase:** `windowMs` (120000+)
- ⬇️ **Decrease:** `minAggVolume` (-30%)
- ⬇️ **Decrease:** `volumeSurgeMultiplier` (-0.5)
- ⬇️ **Decrease:** thresholds (-0.1)
- ✅ **Enable:** `adaptiveZone`, extended volume windows

### 🏪 **High Volume Markets (>$1B daily)**

- ⬆️ **Increase:** `minAggVolume` (1000+)
- ⬆️ **Increase:** `institutionalThreshold` (+5.0)
- ⬇️ **Decrease:** `zoneTicks` (1-2)
- ✅ **Enable:** `multiZone`, institutional detection

### 🏘️ **Low Volume Markets (<$100M daily)**

- ⬇️ **Decrease:** `minAggVolume` (100-300)
- ⬇️ **Decrease:** `institutionalThreshold` (-5.0)
- ⬆️ **Increase:** `zoneTicks` (4-5)
- ⬆️ **Increase:** `sustainedVolumeMs` (+10000)

---

## 🔧 Volume-Enhanced Quick Tuning Cheat Sheet

### 🚨 **Too Many Signals with Volume Integration?**

1. ⬆️ Increase `volumeSurgeMultiplier` (+0.5)
2. ⬆️ Increase `imbalanceThreshold` (+0.05)
3. ⬆️ Increase `institutionalThreshold` (+2.0)
4. ⬆️ Increase `minAggVolume` (+50%)

### 📡 **Too Few Volume-Enhanced Signals?**

1. ⬇️ Decrease `volumeSurgeMultiplier` (-0.5)
2. ⬇️ Decrease `imbalanceThreshold` (-0.05)
3. ⬇️ Decrease `institutionalThreshold` (-2.0)
4. ⬆️ Increase `sustainedVolumeMs` (+5000)

### 🎯 **Poor Volume Signal Quality?**

1. ⬆️ Increase `burstDetectionMs` (+500)
2. ⬆️ Increase `institutionalThreshold` (+2.0)
3. ✅ Enable strict volume validation
4. ⬆️ Increase `volumeSurgeMultiplier` (+0.5)

### 🐌 **Performance Issues with Volume Analysis?**

1. ⬇️ Decrease `sustainedVolumeMs` (-5000)
2. ⬆️ Increase `burstDetectionMs` (+500)
3. ⬆️ Increase `minAggVolume` (reduce processing load)
4. ❌ Disable complex volume features if needed

---

## 🏁 **Volume-Enhanced Phase Progression**

| Phase | Duration | Goal                     | Signal Volume | Accuracy Target | Volume Features                                          |
| ----- | -------- | ------------------------ | ------------- | --------------- | -------------------------------------------------------- |
| **1** | 3 days   | Volume Discovery         | 30-100/hour   | 35-50%          | Basic volume surge detection, low thresholds            |
| **2** | 4 days   | Volume Filtering         | 15-60/hour    | 50-70%          | Add imbalance detection, moderate thresholds            |
| **3** | 5 days   | Volume Quality           | 10-40/hour    | 70-85%          | Add institutional detection, higher thresholds          |
| **4** | 4 days   | Volume Production        | 3-15/hour     | 85-95%          | Full volume validation, maximum thresholds              |

**🎯 Volume Success Metrics:** Each phase should show improvement in precision through enhanced institutional validation while maintaining reasonable signal frequency.

## 🚀 **Volume Surge Integration Benefits Summary**

- **📊 Enhanced Signal Quality**: Up to 40% confidence boost for qualifying signals
- **🏦 Institutional Validation**: Real-time large player activity detection
- **⚖️ Order Flow Analysis**: Buyer vs seller aggression identification
- **🔥 Volume Spike Detection**: 2x-4x surge threshold monitoring
- **⚡ Multi-Timeframe Validation**: Burst + sustained volume analysis
- **🎯 Smart Filtering**: Reduced false positives through volume requirements

**Phase 2 Volume Integration is complete across all detectors for superior 0.7%+ move prediction capability.**