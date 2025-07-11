#!/bin/bash

# POST-TASK COMPLIANCE VERIFICATION - MANDATORY EXECUTION
# This script MUST be executed after completing ANY coding task

set -e  # Exit on any error

echo "🔒 POST-TASK COMPLIANCE VERIFICATION - MANDATORY EXECUTION"
echo "=========================================================="
echo ""

# Check if this is being run from the correct directory
if [ ! -f "CLAUDE.md" ]; then
    echo "❌ CRITICAL ERROR: Must be run from project root directory"
    echo "❌ CLAUDE.md not found in current directory"
    exit 1
fi

# Check if pre-task check was completed
if [ ! -f ".claude/compliance-log.txt" ]; then
    echo "❌ CRITICAL ERROR: No pre-task compliance check found"
    echo "❌ Pre-task check must be completed before post-task verification"
    exit 1
fi

echo "📋 MANDATORY BUILD VERIFICATION"
echo "==============================="
echo ""

echo "🔨 Running build check..."
if ! yarn build; then
    echo "❌ CRITICAL FAILURE: Build failed"
    echo "❌ TASK INCOMPLETE: Must fix all build errors"
    exit 1
fi
echo "✅ Build passed"

echo ""
echo "📋 MANDATORY TEST VERIFICATION"
echo "=============================="
echo ""

echo "🧪 Running test suite..."
test_output=$(yarn test 2>&1)
test_exit_code=$?

echo "$test_output" | tail -20

# Extract test results
failed_tests=$(echo "$test_output" | grep -E "Tests.*failed" | tail -1 || echo "0 failed")
passed_tests=$(echo "$test_output" | grep -E "Tests.*passed" | tail -1 || echo "0 passed")

echo ""
echo "📊 TEST RESULTS ANALYSIS"
echo "========================"
echo "Test Output Summary: $failed_tests | $passed_tests"

if [ $test_exit_code -ne 0 ]; then
    echo ""
    echo "❌ CRITICAL FAILURE: Tests failed"
    echo "❌ CURRENT TEST STATUS: $failed_tests | $passed_tests"
    echo ""
    read -p "❓ This is a PRODUCTION trading system. Are you accepting broken tests? (yes/no): " accept_failures
    if [ "$accept_failures" = "yes" ]; then
        echo "⚠️  WARNING: User accepted test failures"
        echo "⚠️  This violates institutional-grade standards"
        echo "⚠️  Production deployment blocked until tests pass"
    else
        echo "❌ TASK INCOMPLETE: Must fix all test failures"
        echo "❌ Current failures: $failed_tests"
        exit 1
    fi
else
    echo "✅ All tests passed"
fi

echo ""
echo "📋 CLAUDE.MD COMPLIANCE VERIFICATION"
echo "===================================="

# Check for common violations
echo "🔍 Checking for CLAUDE.md violations..."

# Check for magic numbers
echo "   Checking for magic numbers..."
magic_numbers_found=false
if grep -r "if.*[0-9]\+\.[0-9]\+" src/ --include="*.ts" | grep -v "test" | head -5; then
    echo "⚠️  Potential magic numbers found (review above)"
    read -p "❓ Are these properly configurable? (yes/no): " magic_ok
    if [ "$magic_ok" != "yes" ]; then
        magic_numbers_found=true
    fi
fi

# Check for fallback operators
echo "   Checking for fallback operators..."
fallback_found=false
if grep -r "??" src/ --include="*.ts" | grep -v "test" | head -5; then
    echo "⚠️  Fallback operators found (review above)"
    fallback_found=true
fi

# Check for console.log
echo "   Checking for console.log usage..."
console_found=false
if grep -r "console\." src/ --include="*.ts" | grep -v "console.error" | head -5; then
    echo "⚠️  Console usage found (review above)"
    console_found=true
fi

# Check for direct Logger imports
echo "   Checking for direct Logger imports..."
logger_found=false
if grep -r "import.*Logger" src/ --include="*.ts" | grep -v "ILogger\|interface" | head -5; then
    echo "⚠️  Direct Logger imports found (review above)"
    logger_found=true
fi

echo ""
echo "📋 COMPLIANCE VIOLATIONS SUMMARY"
echo "================================"

violations_found=false
if [ "$magic_numbers_found" = true ]; then
    echo "❌ Magic numbers violation"
    violations_found=true
fi
if [ "$fallback_found" = true ]; then
    echo "❌ Fallback operators violation"
    violations_found=true
fi
if [ "$console_found" = true ]; then
    echo "❌ Console.log usage violation"
    violations_found=true
fi
if [ "$logger_found" = true ]; then
    echo "❌ Direct Logger import violation"
    violations_found=true
fi

if [ "$violations_found" = true ]; then
    echo ""
    echo "❌ CLAUDE.MD VIOLATIONS DETECTED"
    read -p "❓ Will you fix these violations before task completion? (yes/no): " fix_violations
    if [ "$fix_violations" != "yes" ]; then
        echo "❌ TASK INCOMPLETE: Must fix CLAUDE.md violations"
        exit 1
    fi
else
    echo "✅ No CLAUDE.md violations detected"
fi

echo ""
echo "📋 PRODUCTION IMPACT ASSESSMENT"
echo "==============================="

read -p "❓ Did you modify any production-critical files? (yes/no): " modified_critical
if [ "$modified_critical" = "yes" ]; then
    echo "🚨 Production-critical modifications detected"
    read -p "❓ Were these approved in pre-task check? (yes/no): " was_approved
    if [ "$was_approved" != "yes" ]; then
        echo "❌ VIOLATION: Unapproved production-critical modifications"
        exit 1
    fi
    
    read -p "❓ Have you tested the impact thoroughly? (yes/no): " tested_impact
    if [ "$tested_impact" != "yes" ]; then
        echo "❌ INCOMPLETE: Must test production-critical changes"
        exit 1
    fi
fi

echo ""
echo "📋 FINANCIAL SYSTEM INTEGRITY"
echo "============================="

read -p "❓ Did you modify any financial calculations? (yes/no): " modified_financial
if [ "$modified_financial" = "yes" ]; then
    read -p "❓ Did you use FinancialMath for ALL calculations? (yes/no): " used_financial_math
    if [ "$used_financial_math" != "yes" ]; then
        echo "❌ VIOLATION: Must use FinancialMath for financial calculations"
        exit 1
    fi
    
    read -p "❓ Are price movements tick-size compliant? (yes/no): " tick_compliant
    if [ "$tick_compliant" != "yes" ]; then
        echo "❌ VIOLATION: Must respect tick size compliance"
        exit 1
    fi
fi

echo ""
echo "📋 WORKER THREAD ISOLATION"
echo "=========================="

read -p "❓ Did you modify any worker thread code? (yes/no): " modified_workers
if [ "$modified_workers" = "yes" ]; then
    read -p "❓ Did you maintain strict isolation (no fallbacks, no duplicates)? (yes/no): " maintained_isolation
    if [ "$maintained_isolation" != "yes" ]; then
        echo "❌ VIOLATION: Must maintain worker thread isolation"
        exit 1
    fi
fi

echo ""
echo "📋 FINAL COMPLIANCE CONFIRMATION"
echo "================================"

echo "Summary of verification:"
echo "- Build: ✅ Passed"
if [ $test_exit_code -eq 0 ]; then
    echo "- Tests: ✅ All passed"
else
    echo "- Tests: ⚠️  Some failed (acknowledged)"
fi
if [ "$violations_found" = true ]; then
    echo "- CLAUDE.md: ⚠️  Violations found (to be fixed)"
else
    echo "- CLAUDE.md: ✅ Compliant"
fi
echo "- Production Impact: Assessed"
echo "- Financial Integrity: Verified"
echo "- Worker Isolation: Verified"

echo ""
read -p "✅ Do you certify this task meets institutional-grade standards? (yes/no): " final_certification
if [ "$final_certification" != "yes" ]; then
    echo "❌ TASK INCOMPLETE: Cannot certify compliance"
    exit 1
fi

echo ""
echo "✅ POST-TASK COMPLIANCE VERIFICATION PASSED"
echo "==========================================="

# Record completion
echo "$(date): Post-task compliance verification completed" >> .claude/compliance-log.txt
echo "Build: Passed" >> .claude/compliance-log.txt
echo "Tests: $test_exit_code" >> .claude/compliance-log.txt
echo "Violations: $violations_found" >> .claude/compliance-log.txt
echo "Certified: $final_certification" >> .claude/compliance-log.txt
echo "====================" >> .claude/compliance-log.txt

echo ""
echo "🎯 TASK COMPLETION CERTIFIED"
echo "Production trading system integrity maintained"
echo ""