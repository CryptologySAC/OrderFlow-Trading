# MANDATORY COMPLIANCE HOOKS

## 🚨 CRITICAL: These hooks MUST be executed for EVERY coding task

### Usage:

**BEFORE starting any coding task:**

```bash
./.claude/hooks/enforce-hooks.sh
```

**AFTER completing any coding task:**

```bash
./.claude/hooks/post-task-verify.sh
```

### Hook Files:

1. **`enforce-hooks.sh`** - Main enforcement script that triggers pre-task check
2. **`pre-task-check.sh`** - Mandatory pre-task compliance verification
3. **`post-task-verify.sh`** - Mandatory post-task compliance verification

### Enforcement:

- ❌ **NO CODING without running pre-task check**
- ❌ **NO TASK COMPLETION without post-task verification**
- ❌ **NO EXCEPTIONS for any type of change**

### Why This Matters:

This is a **PRODUCTION TRADING SYSTEM**. These hooks prevent:

- Unauthorized modifications to production-critical files
- CLAUDE.md compliance violations
- Test failures going unnoticed
- Financial calculation errors
- Worker thread isolation violations

### Compliance Log:

All hook executions are logged to `.claude/compliance-log.txt` for audit trail.

## 🔒 ENFORCEMENT MECHANISM

Claude Code must run these hooks for EVERY task. No exceptions.

**Violation = Immediate task failure**
