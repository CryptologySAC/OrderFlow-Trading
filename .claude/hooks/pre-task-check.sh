#!/bin/bash

# PRE-TASK COMPLIANCE CHECK - MANDATORY EXECUTION
# This script MUST be executed before starting ANY coding task

set -e  # Exit on any error

echo "🔒 PRE-TASK COMPLIANCE CHECK - MANDATORY EXECUTION"
echo "=================================================="
echo ""

# Check if this is being run from the correct directory
if [ ! -f "CLAUDE.md" ]; then
    echo "❌ CRITICAL ERROR: Must be run from project root directory"
    echo "❌ CLAUDE.md not found in current directory"
    exit 1
fi

echo "📋 INSTITUTIONAL GRADE DEVELOPMENT STANDARDS"
echo "============================================="
echo ""
echo "This is a PRODUCTION TRADING SYSTEM - zero tolerance for errors"
read -p "✅ Do you understand this is a production trading system? (yes/no): " prod_understanding
if [ "$prod_understanding" != "yes" ]; then
    echo "❌ FAILED: Must acknowledge production system status"
    exit 1
fi

echo ""
echo "📋 CRITICAL PROTECTION PROTOCOLS"
echo "================================"
echo ""
echo "Checking file modification categories..."

# Function to check if file is production-critical
is_production_critical() {
    local file="$1"
    case "$file" in
        "src/trading/dataStreamManager.ts"|"src/market/orderFlowPreprocessor.ts"|"src/indicators/"*|"src/services/signalCoordinator.ts"|"src/trading/signalManager.ts"|"src/multithreading/threadManager.ts"|"src/multithreading/workers/"*|"src/multithreading/workerLogger.ts"|"public/scripts/dashboard.js"|"config.json"|".env")
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

# Function to check if file is business-critical
is_business_critical() {
    local file="$1"
    case "$file" in
        "src/infrastructure/db.ts"|"src/infrastructure/migrate.ts"|"src/websocket/websocketManager.ts"|"src/core/config.ts")
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

# Get list of files that will be modified (from git status or user input)
echo "Which files will you be modifying? (Enter file paths, one per line, empty line to finish):"
files_to_modify=()
while IFS= read -r line; do
    [ -z "$line" ] && break
    files_to_modify+=("$line")
done

echo ""
echo "📋 FILE MODIFICATION ANALYSIS"
echo "============================="

production_critical_found=false
business_critical_found=false

for file in "${files_to_modify[@]}"; do
    if is_production_critical "$file"; then
        echo "🔴 PRODUCTION-CRITICAL: $file"
        production_critical_found=true
    elif is_business_critical "$file"; then
        echo "🟡 BUSINESS-CRITICAL: $file"
        business_critical_found=true
    else
        echo "🟢 DEVELOPMENT-SAFE: $file"
    fi
done

echo ""

# Check for production-critical modifications
if [ "$production_critical_found" = true ]; then
    echo "🚨 PRODUCTION-CRITICAL FILES DETECTED"
    echo "====================================="
    echo "REQUIRES EXPLICIT USER APPROVAL"
    read -p "❓ Do you have explicit approval to modify production-critical files? (yes/no): " approval
    if [ "$approval" != "yes" ]; then
        echo "❌ FAILED: No approval for production-critical modifications"
        echo "❌ TASK BLOCKED: Get explicit approval before proceeding"
        exit 1
    fi
fi

# Check for business-critical modifications
if [ "$business_critical_found" = true ]; then
    echo "⚠️  BUSINESS-CRITICAL FILES DETECTED"
    echo "===================================="
    echo "REQUIRES VALIDATION AND TESTING"
    read -p "❓ Will you validate with comprehensive testing? (yes/no): " validation
    if [ "$validation" != "yes" ]; then
        echo "❌ FAILED: Must commit to comprehensive validation"
        exit 1
    fi
fi

echo ""
echo "📋 MANDATORY STANDARDS COMPLIANCE"
echo "================================="

# Nuclear Cleanup Compliance
echo "🔧 Nuclear Cleanup Compliance:"
read -p "✅ Will you avoid ALL optional properties and fallback operators? (yes/no): " nuclear_cleanup
if [ "$nuclear_cleanup" != "yes" ]; then
    echo "❌ FAILED: Must follow nuclear cleanup principles"
    exit 1
fi

# Worker Thread Isolation
echo "🧵 Worker Thread Isolation:"
read -p "✅ Will you maintain strict worker thread isolation (no fallbacks, no duplicates)? (yes/no): " worker_isolation
if [ "$worker_isolation" != "yes" ]; then
    echo "❌ FAILED: Must maintain worker thread isolation"
    exit 1
fi

# Financial Math Compliance
echo "💰 Financial Math Compliance:"
read -p "✅ Will you use FinancialMath for ALL financial calculations? (yes/no): " financial_math
if [ "$financial_math" != "yes" ]; then
    echo "❌ FAILED: Must use FinancialMath for all calculations"
    exit 1
fi

# Logging Standards
echo "📝 Logging Standards:"
read -p "✅ Will you use only ILogger interface (no console.log, no direct Logger)? (yes/no): " logging
if [ "$logging" != "yes" ]; then
    echo "❌ FAILED: Must follow logging standards"
    exit 1
fi

# Testing Standards
echo "🧪 Testing Standards:"
read -p "✅ Will you use proper __mocks__/ structure and write tests that detect bugs? (yes/no): " testing
if [ "$testing" != "yes" ]; then
    echo "❌ FAILED: Must follow testing standards"
    exit 1
fi

echo ""
echo "📋 RISK ASSESSMENT REQUIRED"
echo "==========================="

echo "Risk Assessment Questions:"
read -p "❓ What is the potential impact on trading operations? (low/medium/high): " risk_level
read -p "❓ How will you test this change? (describe): " test_plan
read -p "❓ What is your rollback plan if something breaks? (describe): " rollback_plan

if [ -z "$test_plan" ] || [ -z "$rollback_plan" ]; then
    echo "❌ FAILED: Must provide test plan and rollback plan"
    exit 1
fi

echo ""
echo "📋 FINAL CONFIRMATION"
echo "===================="

echo "Summary of commitments:"
echo "- Risk Level: $risk_level"
echo "- Test Plan: $test_plan"
echo "- Rollback Plan: $rollback_plan"
echo "- Will follow all CLAUDE.md standards"
echo "- Will use proper file categorization"

read -p "✅ Do you confirm you will follow ALL requirements above? (yes/no): " final_confirmation
if [ "$final_confirmation" != "yes" ]; then
    echo "❌ FAILED: Must confirm compliance with all requirements"
    exit 1
fi

echo ""
echo "✅ PRE-TASK COMPLIANCE CHECK PASSED"
echo "==================================="
echo "📝 Recording compliance check completion..."

# Create compliance record
echo "$(date): Pre-task compliance check completed" >> .claude/compliance-log.txt
echo "Risk Level: $risk_level" >> .claude/compliance-log.txt
echo "Files: ${files_to_modify[@]}" >> .claude/compliance-log.txt
echo "Test Plan: $test_plan" >> .claude/compliance-log.txt
echo "Rollback Plan: $rollback_plan" >> .claude/compliance-log.txt
echo "---" >> .claude/compliance-log.txt

echo "🚀 READY TO PROCEED WITH TASK"
echo "Remember: Post-task compliance verification is MANDATORY"
echo ""