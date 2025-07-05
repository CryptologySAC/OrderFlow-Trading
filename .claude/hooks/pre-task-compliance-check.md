# PRE-TASK COMPLIANCE CHECK HOOK

## MANDATORY CLAUDE.MD REVIEW BEFORE ANY TASK

**🔒 CRITICAL: This hook MUST be executed before starting ANY coding task**

### 1. INSTITUTIONAL GRADE DEVELOPMENT STANDARDS

- [ ] This is a **PRODUCTION TRADING SYSTEM** - zero tolerance for errors
- [ ] All changes must meet institutional-grade standards
- [ ] Financial impact assessment required for any modifications

### 2. CRITICAL PROTECTION PROTOCOLS

- [ ] Check if files are PRODUCTION-CRITICAL (NO MODIFICATIONS WITHOUT APPROVAL)
- [ ] Check if files are BUSINESS-CRITICAL (REQUIRES VALIDATION)
- [ ] Identify DEVELOPMENT-SAFE files only

### 3. MANDATORY CHANGE VALIDATION PROTOCOL

- [ ] Risk Assessment: Evaluate potential impact on trading operations
- [ ] Worker Thread Isolation Check: Ensure no fallback/duplicate implementations
- [ ] Dependency Analysis: Identify all affected components
- [ ] Test Coverage: Ensure comprehensive test coverage exists
- [ ] Rollback Plan: Define immediate rollback procedure

### 4. STRICTLY FORBIDDEN PATTERNS

- [ ] **NO LIVE DATA CACHING** - Caching of live market data is STRICTLY FORBIDDEN
- [ ] **NO DEFAULT METHODS** - All `getDefault*()` methods are STRICTLY FORBIDDEN
- [ ] **NO FALLBACK OPERATORS** - All `??` fallback operators are STRICTLY FORBIDDEN
- [ ] **NO HARDCODED VALUES** - All threshold, limit, and calculation values MUST be configurable
- [ ] **NO MAGIC NUMBERS** - All numeric values must come from configuration

### 5. WORKER THREAD ISOLATION (ZERO TOLERANCE)

- [ ] **NO FALLBACK IMPLEMENTATIONS** - If functionality is handled by a worker thread, it MUST ONLY be handled by that worker
- [ ] **NO DUPLICATE CODE PATHS** - No "backup" implementations in main thread
- [ ] **USE PROXY CLASSES ONLY** - WorkerProxyLogger, WorkerMetricsProxy, etc.
- [ ] **NO DIRECT INFRASTRUCTURE** - Never instantiate Logger, MetricsCollector, etc. directly

### 6. LOGGING STANDARDS (MANDATORY)

- [ ] **ALL LOGGING MUST USE ILogger INTERFACE** - Never import concrete Logger implementations
- [ ] **NO CONSOLE.LOG** - Use ILogger methods only
- [ ] **ONLY console.error for system panic** with documented POLICY OVERRIDE
- [ ] **DEPENDENCY INJECTION** - Always use dependency injection for ILogger

### 7. FINANCIAL CALCULATIONS (MISSION CRITICAL)

- [ ] **ALL FINANCIAL CALCULATIONS MUST USE FinancialMath** - Never direct floating-point arithmetic
- [ ] **TICK SIZE COMPLIANCE** - All price movements must respect minimum tick sizes
- [ ] **NO DetectorUtils USAGE** - Replace with FinancialMath equivalents

### 8. CALCULATION INTEGRITY (ZERO TOLERANCE)

- [ ] **RETURN NULL FOR INVALID CALCULATIONS** - Never use default numbers or fallbacks
- [ ] **NO ARBITRARY VALUES** - When calculations fail, return null
- [ ] **HONEST DATA HANDLING** - Better to admit insufficient data than guess

### 9. UNIT TESTING STANDARDS (MANDATORY)

- [ ] **TESTS MUST DETECT ERRORS** - Never adjust tests to pass buggy implementations
- [ ] **VALIDATE REAL-WORLD LOGIC** - Test against correct behavior, not current broken code
- [ ] **USE PROPER MOCKS** - Always use **mocks**/ directory structure
- [ ] **NO INLINE MOCKS** - Never create inline mocks in test files

### 10. ABSOLUTE PROHIBITIONS (ZERO TOLERANCE)

- [ ] **NEVER MODIFY .env FILE** - Contains irreplaceable production API keys
- [ ] **NO TEST CODE IN PRODUCTION** - Keep test/validation scripts separate
- [ ] **NO PRODUCTION CODE IN TEST DIRECTORIES** - Maintain clear separation
- [ ] **NO TYPE CASTING TO BYPASS VALIDATION** - Use proper interfaces

## CONFIRMATION REQUIRED <ESSENTIAL>

Before proceeding with any task, confirm:

- [ ] I have read and understand ALL CLAUDE.md requirements
- [ ] I have identified which category this task falls into (PRODUCTION-CRITICAL/BUSINESS-CRITICAL/DEVELOPMENT-SAFE)
- [ ] I understand the worker thread isolation requirements
- [ ] I will use proper logging, financial math, and testing patterns
- [ ] I will NOT create any fallback implementations or use magic numbers
- [ ] I will seek approval for any business-critical or production-critical changes

**🚨 FAILURE TO FOLLOW THESE STANDARDS IS UNACCEPTABLE AND VIOLATES PRODUCTION TRADING SYSTEM INTEGRITY**
