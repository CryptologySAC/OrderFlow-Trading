# 🏗️ System Architecture Flow Diagram

## 📋 Overview

This document provides comprehensive flow diagrams showing how data flows through the OrderFlow Trading System, from market data ingestion to signal generation and client delivery.

## 🌊 High-Level Data Flow

```mermaid
graph TD
    A[Binance WebSocket] --> B[BinanceWorker Thread]
    B --> C[OrderFlowPreprocessor]
    C --> D[EnrichedTradeEvent]
    D --> E[Pattern Detectors]
    E --> F[SignalCoordinator]
    F --> G[SignalManager]
    G --> H[Client Dashboard]

    I[Binance REST API] --> J[Smart ID-Based Backlog]
    J --> K[TradesProcessor]
    K --> C

    L[OrderBook State] --> M[OrderBook Updates]
    M --> C

    E --> N[AnomalyDetector]
    N --> O[AlertManager]
    O --> P[Webhook Notifications]

    Q[Database Storage] --> R[Historical Analysis]
    R --> E
```

## 🔄 Detailed Processing Pipeline

### Data Ingestion & Preprocessing

```mermaid
graph LR
    subgraph "Data Sources"
        A1[WebSocket Stream]
        A2[REST API Backlog]
        A3[OrderBook Depth]
    end

    subgraph "Worker Threads"
        B1[BinanceWorker]
        B2[StorageWorker]
        B3[CommunicationWorker]
    end

    subgraph "Data Processing"
        C1[OrderFlowPreprocessor]
        C2[EnrichedTradeEvent]
        C3[OrderBook State]
    end

    A1 --> B1
    A2 --> B1
    A3 --> B1

    B1 --> C1
    B2 --> C1

    C1 --> C2
    C1 --> C3

    C2 --> D[Pattern Detection]
    C3 --> D
```

### Pattern Detection Architecture

```mermaid
graph TD
    subgraph "Event-Based Detectors"
        A1[AbsorptionDetector<br/>O(n·z)]
        A2[ExhaustionDetector<br/>O(n·m)]
        A3[DeltaCVDConfirmation<br/>O(w·n·log n)]
    end

    subgraph "Service Detectors"
        B1[IcebergDetector<br/>O(c·p²)]
        B2[SpoofingDetector<br/>O(b·h·p)]
        B3[HiddenOrderDetector<br/>O(1)]
    end

    subgraph "Zone-Based Detectors"
        C1[AccumulationZoneDetector<br/>O(z·s)]
        C2[DistributionZoneDetector<br/>O(z·s)]
    end

    D[EnrichedTradeEvent] --> A1
    D --> A2
    D --> A3
    D --> B1
    D --> B2
    D --> B3
    D --> C1
    D --> C2

    A1 --> E[SignalCoordinator]
    A2 --> E
    A3 --> E
    B1 --> F[AnomalyDetector]
    B2 --> F
    B3 --> F
    C1 --> G[ZoneManager]
    C2 --> G

    E --> H[SignalManager]
    F --> H
    G --> H
```

### Signal Processing & Delivery

```mermaid
graph TD
    subgraph "Signal Sources"
        A1[Detector Signals]
        A2[Anomaly Events]
        A3[Zone Updates]
    end

    subgraph "Signal Processing"
        B1[SignalCoordinator<br/>Queue Management]
        B2[SignalManager<br/>Validation & Correlation]
        B3[AnomalyDetector<br/>Pattern Integration]
    end

    subgraph "Output Channels"
        C1[WebSocket Clients]
        C2[Webhook Alerts]
        C3[Database Storage]
        C4[Metrics & Logging]
    end

    A1 --> B1
    A2 --> B3
    A3 --> B1

    B1 --> B2
    B3 --> B2

    B2 --> C1
    B2 --> C2
    B2 --> C3
    B2 --> C4
```

## 🧵 Worker Thread Communication

```mermaid
graph LR
    subgraph "Main Thread"
        A[ThreadManager]
        B[OrderFlowDashboard]
    end

    subgraph "BinanceWorker"
        C1[WebSocket Connection]
        C2[Data Processing]
        C3[WorkerProxyLogger]
    end

    subgraph "StorageWorker"
        D1[Database Operations]
        D2[Data Persistence]
        D3[Query Processing]
    end

    subgraph "CommunicationWorker"
        E1[Client WebSockets]
        E2[Message Broadcasting]
        E3[Rate Limiting]
    end

    subgraph "LoggerWorker"
        F1[Log Processing]
        F2[File Writing]
        F3[Log Rotation]
    end

    A <==> C1
    A <==> D1
    A <==> E1
    A <==> F1

    B --> A

    C2 --> C3
    C3 -.-> F1
```

## 🔍 Detector-Specific Flow Patterns

### AbsorptionDetector - Zone Processing

```mermaid
graph TD
    A[Trade Event] --> B[Zone Calculation O(1)]
    B --> C[Zone Lookup O(1)]
    C --> D[Current Window Update O(1)]
    D --> E[Zone Iteration O(z)]
    E --> F[Price Efficiency Analysis]
    F --> G[Volume Surge Detection]
    G --> H[Passive Volume Tracking]
    H --> I{Absorption Threshold Check}
    I -->|Pass| J[Signal Generation]
    I -->|Fail| K[Continue Processing]
    J --> L[Confidence Scoring]
    L --> M[Zone State Update]
```

### DeltaCVDConfirmation - Multi-Window Analysis

```mermaid
graph TD
    A[Trade Event] --> B[Window Distribution O(w)]
    B --> C1[60s Window CVD]
    B --> C2[300s Window CVD]
    B --> C3[900s Window CVD]
    C1 --> D1[Z-Score Calculation]
    C2 --> D2[Z-Score Calculation]
    C3 --> D3[Z-Score Calculation]
    D1 --> E[Signal Synthesis]
    D2 --> E
    D3 --> E
    E --> F[Price Correlation Analysis]
    F --> G[Passive Volume Enhancement]
    G --> H{Multi-Window Validation}
    H -->|Pass| I[Confidence Scoring]
    H -->|Fail| J[Continue Processing]
```

### IcebergDetector - Pattern Recognition

```mermaid
graph TD
    A[Trade Event] --> B[Candidate Detection]
    B --> C{Existing Candidate?}
    C -->|Yes| D[Update Candidate]
    C -->|No| E[Create New Candidate]
    D --> F[Pattern Analysis O(p)]
    E --> G[Size Validation]
    G --> F
    F --> H[Confidence Calculation]
    H --> I{Qualification Check}
    I -->|Pass| J[Iceberg Signal]
    I -->|Fail| K[Continue Tracking]
    J --> L[LRU Cleanup]
    K --> M[Periodic Cleanup]
```

## 📊 Performance Monitoring Points

### Critical Measurement Points

```mermaid
graph LR
    subgraph "Latency Monitoring"
        A1[WebSocket → Preprocessor]
        A2[Preprocessor → Detectors]
        A3[Detectors → SignalManager]
        A4[SignalManager → Clients]
    end

    subgraph "Throughput Monitoring"
        B1[Trades/Second Processing]
        B2[Signals/Second Generation]
        B3[Client Messages/Second]
    end

    subgraph "Resource Monitoring"
        C1[Memory Usage per Detector]
        C2[CPU Usage per Thread]
        C3[Queue Depth Monitoring]
    end

    A1 --> D[Performance Dashboard]
    A2 --> D
    A3 --> D
    A4 --> D
    B1 --> D
    B2 --> D
    B3 --> D
    C1 --> D
    C2 --> D
    C3 --> D
```

## 🚨 Error Handling & Recovery Flow

```mermaid
graph TD
    A[System Error] --> B{Error Type}
    B -->|Connection| C[Circuit Breaker]
    B -->|Processing| D[Detector Isolation]
    B -->|Memory| E[Cleanup Procedures]
    B -->|Threading| F[Worker Restart]

    C --> G[Exponential Backoff]
    D --> H[Error Logging]
    E --> I[Memory Optimization]
    F --> J[Thread Recovery]

    G --> K[Health Check]
    H --> K
    I --> K
    J --> K

    K --> L{Recovery Success?}
    L -->|Yes| M[Resume Operations]
    L -->|No| N[Escalate Alert]

    M --> O[Normal Processing]
    N --> P[Manual Intervention]
```

## 🎯 Configuration Flow

```mermaid
graph LR
    subgraph "Configuration Sources"
        A1[config.json]
        A2[Environment Variables]
        A3[CLAUDE.md Guidelines]
    end

    subgraph "Configuration Processing"
        B1[Config Manager]
        B2[Symbol-Specific Settings]
        B3[Detector Settings]
    end

    subgraph "Application Components"
        C1[Detector Instances]
        C2[Worker Threads]
        C3[Database Connections]
        C4[WebSocket Servers]
    end

    A1 --> B1
    A2 --> B1
    A3 --> B1

    B1 --> B2
    B2 --> B3

    B3 --> C1
    B1 --> C2
    B1 --> C3
    B1 --> C4
```

## 📈 Scaling Architecture

```mermaid
graph TD
    subgraph "Horizontal Scaling"
        A1[Load Balancer]
        A2[Multiple Instances]
        A3[Shared Database]
    end

    subgraph "Vertical Scaling"
        B1[Multi-Core Processing]
        B2[Memory Optimization]
        B3[CPU Optimization]
    end

    subgraph "Performance Optimization"
        C1[Object Pooling]
        C2[Connection Pooling]
        C3[Cache Management]
    end

    A1 --> A2
    A2 --> A3

    B1 --> B2
    B2 --> B3

    C1 --> C2
    C2 --> C3

    A3 --> D[System Performance]
    B3 --> D
    C3 --> D
```

---

## 🔗 Related Documentation

- **[Algorithm Complexity Analysis](./Algorithm-Complexity-Analysis.md)** - Detailed complexity analysis for all detectors
- **[Worker Thread Isolation Architecture](./Worker-Thread-Isolation-Architecture.md)** - Worker thread communication patterns
- **[Zone-Based Architecture](./Zone-Based-Architecture.md)** - Zone-based detector architecture
- **[Storage System Architecture](./Storage-System-Architecture.md)** - Data persistence patterns

**This architecture documentation provides the foundation for system optimization, troubleshooting, and scaling decisions in the institutional trading environment.**
