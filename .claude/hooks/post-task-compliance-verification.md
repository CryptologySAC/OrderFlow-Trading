# POST-TASK COMPLIANCE VERIFICATION HOOK

## MANDATORY CLAUDE.MD COMPLIANCE VERIFICATION AFTER TASK COMPLETION

**🔒 CRITICAL: This hook MUST be executed after completing ANY coding task**

### 1. INSTITUTIONAL GRADE VERIFICATION

- [ ] **Zero errors** that could impact trading operations
- [ ] **Audit trail** of all modifications maintained
- [ ] **Rollback plan** tested and ready
- [ ] **Performance impact** assessed and documented

### 2. FILE MODIFICATION COMPLIANCE CHECK

- [ ] **NO PRODUCTION-CRITICAL FILES MODIFIED** without explicit approval
- [ ] **NO .env FILE MODIFICATIONS** (contains irreplaceable production API keys)
- [ ] **NO WEBSOCKET URL CHANGES** in dashboard.js
- [ ] **PROPER FILE CATEGORIZATION** respected throughout

### 3. WORKER THREAD ISOLATION VERIFICATION

- [ ] **NO FALLBACK IMPLEMENTATIONS CREATED** - Single source of truth maintained
- [ ] **NO DUPLICATE CODE PATHS** - Worker functionality exclusive to workers
- [ ] **PROXY CLASSES USED CORRECTLY** - WorkerProxyLogger, WorkerMetricsProxy, etc.
- [ ] **NO DIRECT INFRASTRUCTURE IMPORTS** - All access through proxy classes
- [ ] **INTERFACE COMPLIANCE** - ILogger, IWorkerMetricsCollector, etc. used correctly

### 4. MAGIC NUMBERS AND DEFAULTS ELIMINATION

- [ ] **NO HARDCODED THRESHOLDS** - All values configurable via settings
- [ ] **NO getDefault\*() METHODS** - Especially in enhanced detectors
- [ ] **NO FALLBACK OPERATORS** (??, ||) for configuration values
- [ ] **ZOD VALIDATION ENFORCED** - All settings validated with process.exit(1) on missing config
- [ ] **NUCLEAR CLEANUP COMPLIANCE** - Pure config-driven architecture

### 5. LOGGING STANDARDS VERIFICATION

- [ ] **NO CONSOLE.LOG USAGE** - All logging through ILogger interface
- [ ] **NO DIRECT LOGGER IMPORTS** - Only ILogger interface used
- [ ] **PROPER DEPENDENCY INJECTION** - Logger passed as dependency
- [ ] **WORKER LOGGING COMPLIANCE** - WorkerProxyLogger used in workers
- [ ] **ONLY console.error FOR PANIC** - With documented policy override

### 6. FINANCIAL CALCULATION INTEGRITY

- [ ] **ALL FINANCIAL MATH USED** - No direct floating-point arithmetic
- [ ] **TICK SIZE COMPLIANCE** - All price movements respect minimum tick sizes
- [ ] **NO DetectorUtils USAGE** - FinancialMath used for all calculations
- [ ] **NULL ON INVALID CALCULATIONS** - No default numbers or arbitrary fallbacks
- [ ] **HONEST DATA HANDLING** - Return null when calculations cannot be performed

### 7. LIVE DATA HANDLING VERIFICATION

- [ ] **NO LIVE DATA CACHING** - Strictly forbidden in production trading system
- [ ] **FRESH DATA ACCESS** - Always fetch current data
- [ ] **NO STALE DATA PATTERNS** - No cached orderbook, prices, or trades
- [ ] **REAL-TIME INTEGRITY** - Millisecond-fresh data requirements met

### 8. TESTING COMPLIANCE VERIFICATION

- [ ] **PROPER MOCK USAGE** - All mocks from **mocks**/ directory
- [ ] **NO INLINE MOCKS** - Test files use proper mock structure
- [ ] **ERROR DETECTION CAPABILITY** - Tests fail when bugs are present
- [ ] **REAL-WORLD VALIDATION** - Tests validate correct behavior, not current bugs
- [ ] **NO TEST ADJUSTMENT FOR BUGS** - Fix code, not tests

### 9. ARCHITECTURAL PATTERN COMPLIANCE

- [ ] **SINGLE RESPONSIBILITY** - Each component has clear, focused purpose
- [ ] **DEPENDENCY INJECTION** - Proper interface-based dependency management
- [ ] **INTERFACE SEGREGATION** - Minimal, focused interfaces used
- [ ] **NO TIGHT COUPLING** - Components interact through well-defined interfaces

### 10. SECURITY AND PRODUCTION SAFETY

- [ ] **NO SECRETS EXPOSURE** - Never log or expose API keys/secrets
- [ ] **NO MALICIOUS PATTERNS** - Code reviewed for security implications
- [ ] **PROPER ERROR HANDLING** - All errors caught and handled appropriately
- [ ] **CORRELATION ID PROPAGATION** - Request tracing maintained

### 11. PERFORMANCE AND SCALABILITY

- [ ] **SUB-MILLISECOND LATENCY** - Trade processing optimized
- [ ] **MEMORY STABILITY** - No memory leaks or unbounded growth
- [ ] **CONCURRENT ACCESS SAFE** - Thread-safe patterns used
- [ ] **RESOURCE CLEANUP** - Proper cleanup methods implemented

### 12. CODE QUALITY VERIFICATION

- [ ] **NO ANY TYPES** - Precise typing throughout
- [ ] **EXPLICIT RETURN TYPES** - All functions properly typed
- [ ] **STRICT NULL CHECKING** - Null safety enforced
- [ ] **NO IMPLICIT RETURNS** - Clear return statements

## FINAL COMPLIANCE CONFIRMATION

### Build and Test Verification

- [ ] **yarn build** completes with zero errors and warnings (MANDATORY - RUN THIS)
- [ ] **All lint issues resolved** - yarn build includes linting
- [ ] **All TypeScript compilation errors fixed** - yarn build includes compilation
- [ ] **yarn test** passes with >95% coverage
- [ ] **Integration tests** pass completely
- [ ] **No broken imports** or dependencies

**🚨 MANDATORY: Run `yarn build` and fix ANY errors or warnings before completing task**

### Documentation and Traceability

- [ ] **Changes documented** with clear rationale
- [ ] **Git history clean** with meaningful commit messages
- [ ] **Breaking changes identified** and communicated
- [ ] **Performance impact measured** and acceptable

### Risk Assessment Completed

- [ ] **Financial impact**: Assessed and acceptable
- [ ] **System stability**: No degradation introduced
- [ ] **Security posture**: No new vulnerabilities
- [ ] **Operational continuity**: No disruption to trading

## VIOLATIONS FOUND CHECKLIST

If ANY violations are found:

- [ ] **Document the violation** with specific details
- [ ] **Assess impact severity** (Critical/High/Medium/Low)
- [ ] **Create remediation plan** with timeline
- [ ] **Get approval for fixes** if touching production-critical code
- [ ] **Implement corrections** following proper change control
- [ ] **Re-verify compliance** after corrections

## SIGN-OFF REQUIRED

**I certify that:**

- [ ] All work completed adheres to CLAUDE.md institutional-grade standards
- [ ] No CLAUDE.md violations remain in the codebase
- [ ] All financial system integrity requirements are met
- [ ] Worker thread isolation is properly maintained
- [ ] All logging, testing, and architectural patterns comply
- [ ] The production trading system remains secure and reliable

**🚨 ANY REMAINING VIOLATIONS MUST BE ADDRESSED BEFORE TASK COMPLETION**

**Signature**: ****\*\*\*\*****\_****\*\*\*\***** **Date**: ****\*\*\*\*****\_****\*\*\*\*****
