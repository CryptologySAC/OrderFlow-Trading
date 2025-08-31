# Gemini Project Context: OrderFlow Trading System

## Project Overview

This is a production-grade, real-time cryptocurrency trading system built with TypeScript. It connects to Binance via WebSockets to analyze the LTC/USDT order flow, process trade data through a series of advanced pattern detectors, and generate institutional-quality trading signals.

The system is designed for high performance and stability, featuring a multi-threaded architecture that isolates different concerns (API communication, data storage, WebSocket broadcasting, logging) into dedicated worker threads.

**Key Technologies:**
- **Backend:** Node.js, TypeScript
- **Real-time Data:** `@binance/spot` for WebSocket streams
- **API & Dashboard Server:** Express.js, `ws` (WebSocket library)
- **Testing:** Vitest
- **Linting & Formatting:** ESLint, Prettier
- **Runtime:** `tsx` for running TypeScript directly in development

**Core Architecture:**
The application follows a sophisticated, event-driven pipeline:
1.  **Binance Worker:** A dedicated worker thread manages the connection to the Binance WebSocket API, receiving raw trade and depth data.
2.  **Main Thread (`OrderFlowDashboard`):**
    -   Receives data from the Binance worker via the `ThreadManager`.
    -   **`OrderFlowPreprocessor`:** Enriches and processes the raw data.
    -   **Pattern Detectors:** The processed data is fed into a suite of 7 specialized detectors (e.g., `AbsorptionDetector`, `ExhaustionDetector`, `DeltaCVDDetector`) that identify specific market patterns.
    -   **`SignalCoordinator` & `SignalManager`:** Raw signals from detectors are validated, correlated, and combined into final, high-confidence trading signals.
3.  **Communication Worker:**
    -   Receives final signals and other data (trades, order book updates, anomalies) from the main thread.
    -   Broadcasts this information to a front-end dashboard via a WebSocket server running on port 3001.

## Building and Running

The project is managed with Yarn and uses `tsx` for a seamless development experience.

-   **Install Dependencies:**
    ```bash
    yarn install
    ```

-   **Run the Application (Development Mode):**
    Starts the application with hot-reloading. The back-end server will be available on `http://localhost:3000` and the WebSocket server on `ws://localhost:3001`.
    ```bash
    yarn start:dev
    ```

-   **Build for Production:**
    Transpiles the TypeScript code to JavaScript in the `dist/` directory.
    ```bash
    yarn build
    ```

-   **Run Tests:**
    Executes the entire test suite using Vitest.
    ```bash
    yarn test
    ```

-   **Linting and Formatting:**
    The project uses ESLint and Prettier to maintain code quality. These are typically run automatically via pre-commit hooks.
    ```bash
    # Run linter with auto-fix
    yarn lint

    # Format all files
    yarn format
    ```

## Development Conventions

This project adheres to strict, institutional-grade development standards.

-   **Worker Thread Isolation:** The separation between the main thread and worker threads is critical. Communication must only occur through the `ThreadManager`. Direct calls to worker functionalities are prohibited.
-   **Strict Typing:** The codebase enforces a zero-`any` policy. All new code must be strictly typed.
-   **Configuration:** All parameters, especially for detectors, must be configurable in `config.json` and not hard-coded ("magic numbers"). New configuration options must be documented and validated.
-   **Testing:** A high standard of testing is required, with a project-wide coverage target of >95%. New features, especially detectors, must be accompanied by comprehensive tests.
-   **Error Handling & Stability:** The system uses a `CircuitBreaker` pattern for external dependencies and a `RecoveryManager` to handle connection issues, ensuring high availability.
-   **Logging:** Structured logging is used throughout the application via the `pino` library, managed by a dedicated logging worker.
-   **Commits:** Pre-commit hooks are configured with `husky` to automatically run linting, testing, and formatting, ensuring that no failing code is committed.
