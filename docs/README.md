# 📚 OrderFlow Trading System Documentation

## 🎯 **Quick Start**

Welcome to the OrderFlow Trading System documentation! This comprehensive guide covers everything from setup to advanced detector optimization.

### 🚀 **Getting Started**

- **[Main README](../README.md)** - Project overview, installation, and quick start
- **[System Architecture](./System-Architecture-Flow.md)** - High-level system design and data flow
- **[Worker Thread Architecture](./Worker-Thread-Isolation-Architecture.md)** - Multi-threading implementation

---

## 🏗️ **Architecture & Design**

### Core System Architecture

- **[System Architecture Flow](./System-Architecture-Flow.md)** - Complete data flow diagrams
- **[Worker Thread Isolation](./Worker-Thread-Isolation-Architecture.md)** - Thread communication patterns
- **[Worker Thread Implementation](./Worker-Thread-Implementation-Summary.md)** - Implementation details
- **[Storage System Architecture](./Storage-System-Architecture.md)** - Data persistence design
- **[Zone-Based Architecture](./Zone-Based-Architecture.md)** - Advanced zone detection system

### Performance & Optimization

- **[Algorithm Complexity Analysis](./Algorithm-Complexity-Analysis.md)** - Performance characteristics
- **[Performance Tuning Guide](./Performance-Tuning-Guide.md)** - Optimization strategies
- **[Threshold Configuration Guide](./Threshold-Configuration-Guide.md)** - Parameter optimization

---

## 🎯 **Pattern Detectors**

### Detector Overview

- **[Complete Detector Reference](./detectors.md)** - All detectors with configuration
- **[Parameter Reference Table](./parameter-reference-table.md)** - Configuration parameters

### Individual Detectors

- **[Absorption Detector](./Absorption-Detector.md)** - Price efficiency analysis
- **[Exhaustion Detector](./Exhaustion-Detector.md)** - Momentum reversal detection
- **[DeltaCVD Simplification](./DeltaCVD-Simplification-Guide.md)** - Momentum detection optimization
- **[Accumulation Detector](./Accumulation-Detector.md)** - Long-term buying patterns
- **[Support/Resistance Detector](./SupportResistance-Detector.md)** - Key level identification
- **[Anomaly Detector](./Anomaly-Detector.md)** - Market anomaly detection

### Advanced Topics

- **[DeltaCVD A/B Testing](./DeltaCVD-AB-Testing-Guide.md)** - Performance comparison framework
- **[Zone-Based Architecture](./Zone-Based-Architecture.md)** - Advanced zone detection
- **[Signal Validation System](./Signal-Validation-Logging-System.md)** - Signal quality assurance

---

## ⚙️ **Configuration & Setup**

### Configuration Files

- **[Config Reference](./config-reference.md)** - Complete configuration guide
- **[Environment Setup](./exmple.env)** - Environment variables
- **[Threshold Configuration](./Threshold-Configuration-Guide.md)** - Parameter tuning

### Development Setup

- **[Contributing Guide](./CONTRIBUTING.md)** - Development workflow
- **[Development Standards](../CLAUDE.md)** - Coding standards and practices
- **[Testing Standards](../test/CLAUDE.md)** - Testing requirements

---

## 📊 **Analysis & Backtesting**

### Analysis Tools

- **[Backtesting Framework](../analysis/)** - Historical testing tools
- **[Signal Analysis Scripts](../analysis/analyze_success_with_price_reconstruction.ts)** - Performance analysis
- **[Threshold Optimization](../analysis/analyze_threshold_optimization_binary.ts)** - Parameter optimization

### Reports & Audits

- **[DeltaCVD Audit Report](./DeltaCVD-Audit-Report-2025-06-23.md)** - Recent optimization results
- **[Exhaustion Detector Audit](./ExhaustionDetector-Audit-Report-2025-06-23.md)** - Performance validation
- **[Production Deployment Summary](./ProductionDeployment_Summary.md)** - Deployment validation

---

## 🔧 **Development & Maintenance**

### Development Standards

- **[General Development](../src/CLAUDE.md)** - Core development guidelines
- **[Detector Development](../src/indicators/CLAUDE.md)** - Pattern detection standards
- **[Testing Standards](../test/CLAUDE.md)** - Quality assurance requirements

### Maintenance

- **[Storage System Status](./Storage-System-Status.md)** - Database health monitoring
- **[Signal Validation Process](./signal-validation-process.md)** - Quality assurance
- **[Stats API Reference](./stats-api-reference.md)** - Monitoring endpoints

---

## 📈 **Advanced Topics**

### Market Analysis

- **[Market Behaviors](./Market-Behaviors.md)** - Market pattern analysis
- **[BuyerIsMaker Field](./BuyerIsMaker-field.md)** - Order flow analysis
- **[90-Minute Strategy](./90-Minute-Local-HighLow-Strategy.md)** - Time-based strategies

### Specialized Analysis

- **[Absorption Passive Logic](./AbsorptionDetector-PassiveSideLogic-Analysis.md)** - Advanced absorption analysis
- **[Absorption Signal Direction](./AbsorptionDetector-Signal-Direction-Fix.md)** - Signal direction optimization
- **[Accumulation Performance](./AccumulationZoneDetector_PerformanceAnalysis.md)** - Zone performance analysis

---

## 🚨 **Critical Production Information**

### Safety & Compliance

- **[Production Deployment](./ProductionDeployment_Summary.md)** - Safe deployment procedures
- **[Emergency Protocols](../CLAUDE.md#emergency-override-protocol)** - Crisis management
- **[Risk Assessment](../CLAUDE.md#change-control-matrix)** - Change impact analysis

### Monitoring & Alerting

- **[Health Monitoring](./Storage-System-Architecture.md#performance-monitoring)** - System health checks
- **[Alert Configuration](../config.json)** - Alert system setup
- **[Performance Metrics](./Algorithm-Complexity-Analysis.md)** - Performance monitoring

---

## 🔗 **External Resources**

### API Documentation

- **[Binance API](./api_documentation/binance/)** - Exchange API reference
- **[WebSocket Guide](./api_documentation/networking/ws.md)** - Real-time data protocols
- **[MQTT Guide](./api_documentation/networking/mqtt.md)** - Message queuing

### Development Tools

- **[TypeScript Config](../tsconfig.json)** - TypeScript configuration
- **[ESLint Config](../eslint.config.js)** - Code quality rules
- **[Vitest Config](../vitest.config.ts)** - Testing configuration

---

## 📋 **Quick Reference**

### Most Important Files

- **[README](../README.md)** - Project overview and setup
- **[CLAUDE.md](../CLAUDE.md)** - Development standards
- **[config.json](../config.json)** - System configuration
- **[detectors.md](./detectors.md)** - Detector reference

### Emergency Contacts

- **System Issues**: Check [Storage System Status](./Storage-System-Status.md)
- **Performance Problems**: Review [Algorithm Complexity](./Algorithm-Complexity-Analysis.md)
- **Configuration Issues**: See [Config Reference](./config-reference.md)

### Development Workflow

1. Read [Contributing Guide](./CONTRIBUTING.md)
2. Follow [Development Standards](../src/CLAUDE.md)
3. Run `yarn check` before committing
4. Create PR with comprehensive testing

---

## 🎯 **Navigation Tips**

- **New to the project?** Start with [README](../README.md) → [System Architecture](./System-Architecture-Flow.md)
- **Developing detectors?** Read [Detector Standards](../src/indicators/CLAUDE.md) → [Detector Reference](./detectors.md)
- **Performance issues?** Check [Algorithm Complexity](./Algorithm-Complexity-Analysis.md) → [Performance Tuning](./Performance-Tuning-Guide.md)
- **Configuration help?** See [Config Reference](./config-reference.md) → [Threshold Guide](./Threshold-Configuration-Guide.md)

---

**📞 Need Help?** Check the relevant documentation section above, or create an issue with detailed information about your question or problem.

**⚠️ Production System**: This documentation covers a live trading system. Always follow the [Contributing Guide](./CONTRIBUTING.md) for any modifications.
