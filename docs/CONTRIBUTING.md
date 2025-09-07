# Contributing to OrderFlow Trading System

## 🚨 **CRITICAL: Production Trading System**

This is a **production-grade cryptocurrency trading system** that handles real market data and generates trading signals. All contributions must adhere to the highest standards of quality, security, and reliability.

## 🏗️ Development Workflow

### Branching Strategy

- **`main`**: Production-ready, CI-protected branch
- **`dev`**: Main development branch for integration
- **`feature/*`**: Short-lived feature branches (e.g., `feature/enhanced-detector`)
- **`hotfix/*`**: Emergency fixes for production issues

### Contribution Process

1. **Fork** the repository
2. **Create** a feature branch from `dev`
3. **Develop** with comprehensive testing
4. **Test** thoroughly (unit, integration, performance)
5. **Create** a Pull Request to `dev`
6. **Review** by maintainers with trading system expertise
7. **Merge** to `dev` after approval
8. **Deploy** to production via `dev` → `main` (only stable releases)

### Code Quality Requirements

#### Pre-commit Checks (MANDATORY)

```bash
# Run all quality checks
yarn check

# Individual checks
yarn lint           # ESLint with auto-fix
yarn typecheck      # TypeScript compilation
yarn test          # Unit tests with coverage
yarn build         # Production build validation
```

#### Testing Standards

- **Minimum 95% test coverage** required
- **All tests must pass** before merge
- **Integration tests** for critical trading logic
- **Performance benchmarks** for detector algorithms
- **Zero tolerance** for test integrity violations

## 🎯 Development Guidelines

### 🚫 **ABSOLUTE PROHIBITIONS**

**NEVER:**

- Modify production-critical files without approval
- Use magic numbers in detector implementations
- Cache live market data
- Skip input validation
- Bypass error handling
- Create fallback implementations for worker threads

### ✅ **REQUIRED STANDARDS**

- **FinancialMath** for all financial calculations
- **Zod validation** for all configuration
- **Comprehensive error handling** with correlation IDs
- **Tick size compliance** for all price operations
- **Worker thread isolation** maintenance
- **Sub-millisecond latency** for trading operations

### Code Style

- **TypeScript strict mode** enabled
- **Zero `any` types** - precise type definitions
- **ESLint + Prettier** compliance
- **Descriptive commit messages** following conventional commits
- **Comprehensive documentation** for all trading logic

## 🧪 Testing Strategy

### Test Categories

1. **Unit Tests**: Individual components and utilities
2. **Integration Tests**: Detector signal processing pipelines
3. **Performance Tests**: Latency and throughput validation
4. **Backtesting Tests**: Historical signal accuracy validation

### Test Data

- **Realistic market data** patterns (not random data)
- **Edge cases** for all detector algorithms
- **Performance benchmarks** against production baselines
- **Error conditions** and failure scenarios

## 📋 Pull Request Template

### Required PR Information

```markdown
## Description

[Brief description of changes]

## Type of Change

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Breaking change
- [ ] Performance improvement
- [ ] Documentation update

## Impact Assessment

- [ ] Trading logic affected?
- [ ] Performance impact?
- [ ] Configuration changes?
- [ ] Database schema changes?

## Testing

- [ ] Unit tests added/updated
- [ ] Integration tests pass
- [ ] Performance benchmarks met
- [ ] Backtesting validation complete

## Checklist

- [ ] Code follows project standards
- [ ] Documentation updated
- [ ] Tests pass with 95%+ coverage
- [ ] No breaking changes without approval
- [ ] Reviewed by trading system expert
```

## 🚨 **PRODUCTION DEPLOYMENT**

### Deployment Requirements

- **Zero downtime** deployment strategy
- **Rollback plan** for all changes
- **Performance monitoring** post-deployment
- **Trading signal validation** in production
- **Emergency stop** procedures documented

### Risk Assessment

All changes must be assessed for:

- **Financial impact** of incorrect signals
- **Performance degradation** risk
- **Data integrity** compromise potential
- **System stability** impact

## 📞 Support

For questions or clarifications:

- Review existing documentation in `docs/` directory
- Check `CLAUDE.md` for development standards
- Create an issue for bugs or feature requests
- Contact maintainers for production-critical changes

---

**⚠️ Remember: This system trades with real money. Quality and reliability are paramount.**
