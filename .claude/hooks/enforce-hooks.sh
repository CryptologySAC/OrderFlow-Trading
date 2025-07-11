#!/bin/bash

# HOOK ENFORCEMENT SCRIPT
# This script MUST be called before any coding task begins

echo "🔒 CLAUDE CODE COMPLIANCE ENFORCEMENT"
echo "====================================="
echo ""
echo "🚨 MANDATORY: Pre-task compliance check required"
echo ""

# Force execution of pre-task check
echo "Executing pre-task compliance check..."
if ! ./.claude/hooks/pre-task-check.sh; then
    echo ""
    echo "❌ PRE-TASK CHECK FAILED"
    echo "❌ TASK BLOCKED: Cannot proceed without compliance"
    exit 1
fi

echo ""
echo "✅ PRE-TASK CHECK COMPLETED"
echo "✅ Ready to proceed with coding task"
echo ""
echo "⚠️  REMINDER: You MUST run post-task verification when complete:"
echo "   ./.claude/hooks/post-task-verify.sh"
echo ""
echo "🚀 BEGIN CODING TASK"