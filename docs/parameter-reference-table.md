# 🎛️ Detector Parameter Reference Guide

## 📊 Core Detection Parameters Impact Matrix

| Parameter                | Impact Level    | What It Controls                               | Absorption Effect                       | Exhaustion Effect                        | Start Value | Production Value |
| ------------------------ | --------------- | ---------------------------------------------- | --------------------------------------- | ---------------------------------------- | ----------- | ---------------- |
| **minAggVolume**         | 🔥 **CRITICAL** | Minimum trade size to trigger detection        | Lower = more signals, higher noise      | Lower = catches smaller exhaustions      | **100**     | **600**          |
| **absorptionThreshold**  | 🔥 **CRITICAL** | Confidence score required (0-1)                | Lower = more sensitive, more signals    | N/A                                      | **0.4**     | **0.75**         |
| **exhaustionThreshold**  | 🔥 **CRITICAL** | Confidence score required (0-1)                | N/A                                     | Lower = more sensitive, more signals     | **0.4**     | **0.75**         |
| **windowMs**             | 🔥 **CRITICAL** | Time window for analysis                       | Longer = more context, fewer signals    | Longer = better trend detection          | **60000**   | **90000**        |
| **zoneTicks**            | 🔴 **HIGH**     | Price zone width                               | Wider = more aggregation, fewer zones   | Wider = broader exhaustion detection     | **2**       | **3**            |
| **eventCooldownMs**      | 🔴 **HIGH**     | Time between signals from same zone            | Longer = fewer repeat signals           | Longer = prevents spam in volatile areas | **5000**    | **15000**        |
| **minPassiveMultiplier** | 🟡 **MEDIUM**   | Passive volume requirement (Absorption only)   | Higher = stricter absorption criteria   | N/A                                      | **1.2**     | **2.0**          |
| **maxAbsorptionRatio**   | 🟡 **MEDIUM**   | Max aggressive/passive ratio (Absorption only) | Lower = stricter absorption requirement | N/A                                      | **0.8**     | **0.3**          |
| **maxPassiveRatio**      | 🟡 **MEDIUM**   | Max current/avg passive (Exhaustion only)      | N/A                                     | Lower = stricter depletion requirement   | **0.5**     | **0.25**         |
| **pricePrecision**       | 🟢 **LOW**      | Decimal places for price                       | Affects zone boundary calculations      | Affects zone boundary calculations       | **2**       | **2**            |

---

## 🎚️ Feature Toggle Impact Matrix

| Feature                | Detector   | Signal Volume | Signal Quality | CPU Impact | When to Enable   |
| ---------------------- | ---------- | ------------- | -------------- | ---------- | ---------------- |
| **icebergDetection**   | Absorption | **+30%** 📈   | **+20%** 📈    | Medium     | **Phase 2+**     |
| **liquidityGradient**  | Absorption | **+15%** 📈   | **+25%** 📈    | High       | **Phase 2+**     |
| **depletionTracking**  | Exhaustion | **+25%** 📈   | **+15%** 📈    | Medium     | **Phase 2+**     |
| **spreadAdjustment**   | Both       | **-15%** 📉   | **+25%** 📈    | Low        | **Phase 3+**     |
| **spoofingDetection**  | Both       | **-10%** 📉   | **+30%** 📈    | Medium     | **Phase 3+**     |
| **autoCalibrate**      | Both       | **±10%** ↕️   | **+10%** 📈    | Low        | **Phase 2+**     |
| **adaptiveZone**       | Both       | **+10%** 📈   | **+5%** 📈     | Medium     | **Phase 2+**     |
| **multiZone**          | Both       | **+20%** 📈   | **+5%** 📈     | High       | **Phase 3+**     |
| **absorptionVelocity** | Absorption | **+5%** 📈    | **+10%** 📈    | High       | **Phase 3+**     |
| **volumeVelocity**     | Exhaustion | **+5%** 📈    | **+10%** 📈    | High       | **Phase 3+**     |

---

## 🎯 Parameter Combination Strategies

### 🚀 **For MAXIMUM Signals (Discovery Phase)**

```typescript
{
    minAggVolume: 100,           // Very low threshold
    threshold: 0.4,              // Low confidence requirement
    windowMs: 60000,             // Short window
    eventCooldownMs: 5000,       // Short cooldown
    // All advanced features: false
}
```

**Expected: 50-200 signals/hour, 20-40% accuracy**

### ⚖️ **For BALANCED Performance (Quality Phase)**

```typescript
{
    minAggVolume: 400,           // Medium threshold
    threshold: 0.65,             // Higher confidence
    windowMs: 90000,             // Full window
    eventCooldownMs: 12000,      // Medium cooldown
    // Key features enabled
}
```

**Expected: 8-30 signals/hour, 60-80% accuracy**

### 🎯 **For PRODUCTION Quality**

```typescript
{
    minAggVolume: 600,           // High threshold
    threshold: 0.75,             // High confidence
    windowMs: 90000,             // Full context
    eventCooldownMs: 15000,      // Long cooldown
    // All quality features enabled
}
```

**Expected: 2-12 signals/hour, 80-95% accuracy**

---

## 📈 Market Condition Adjustments

### 🌪️ **High Volatility Markets (>2% daily range)**

- ⬇️ **Decrease:** `windowMs` (45000-60000)
- ⬆️ **Increase:** `minAggVolume` (+50%)
- ⬆️ **Increase:** `eventCooldownMs` (20000+)
- ✅ **Enable:** `spreadAdjustment`, `spoofingDetection`

### 😴 **Low Volatility Markets (<0.5% daily range)**

- ⬆️ **Increase:** `windowMs` (120000+)
- ⬇️ **Decrease:** `minAggVolume` (-30%)
- ⬇️ **Decrease:** thresholds (-0.1)
- ✅ **Enable:** `adaptiveZone`, `autoCalibrate`

### 🏪 **High Volume Markets (>$1B daily)**

- ⬆️ **Increase:** `minAggVolume` (1000+)
- ⬇️ **Decrease:** `zoneTicks` (1-2)
- ✅ **Enable:** `multiZone`, `liquidityGradient`

### 🏘️ **Low Volume Markets (<$100M daily)**

- ⬇️ **Decrease:** `minAggVolume` (50-200)
- ⬆️ **Increase:** `zoneTicks` (4-5)
- ❌ **Disable:** Complex features (save CPU)

---

## 🔧 Quick Tuning Cheat Sheet

### 🚨 **Too Many Signals?**

1. ⬆️ Increase `minAggVolume` (+50%)
2. ⬆️ Increase `threshold` (+0.1)
3. ⬆️ Increase `eventCooldownMs` (+5000)

### 📡 **Too Few Signals?**

1. ⬇️ Decrease `minAggVolume` (-30%)
2. ⬇️ Decrease `threshold` (-0.1)
3. ⬇️ Decrease `eventCooldownMs` (-3000)
4. ✅ Enable `icebergDetection` or `depletionTracking`

### 🎯 **Poor Signal Quality?**

2. ✅ Enable `spoofingDetection`
3. ✅ Enable `spreadAdjustment`
4. ⬆️ Increase `minPassiveMultiplier` (Absorption)
5. ⬇️ Decrease `maxPassiveRatio` (Exhaustion)

### 🐌 **Performance Issues?**

1. ❌ Disable `liquidityGradient`
2. ❌ Disable `absorptionVelocity`/`volumeVelocity`
3. ⬇️ Decrease `windowMs`
4. ⬆️ Increase `minAggVolume`

---

## 🏁 **Phase Progression Summary**

| Phase | Duration | Goal       | Signal Volume | Accuracy Target | Key Changes                               |
| ----- | -------- | ---------- | ------------- | --------------- | ----------------------------------------- |
| **1** | 3 days   | Discovery  | 50-200/hour   | 20-40%          | Low thresholds, basic features            |
| **2** | 4 days   | Filtering  | 20-80/hour    | 40-60%          | Add core features, moderate thresholds    |
| **3** | 5 days   | Quality    | 8-30/hour     | 60-80%          | Add quality features, higher thresholds   |
| **4** | 4 days   | Production | 2-12/hour     | 80-95%          | Enable price confirmation, max thresholds |

**🎯 Success Metrics:** Each phase should show improvement in precision while maintaining reasonable signal frequency for your trading strategy.
