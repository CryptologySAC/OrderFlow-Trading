#!/bin/bash
# Signal Optimization Deployment Script
# Implements phased rollout with automated monitoring and rollback

set -e  # Exit on any error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_BACKUP="${SCRIPT_DIR}/config_backup_$(date +%Y%m%d_%H%M%S).json"
LOG_FILE="${SCRIPT_DIR}/optimization_deployment.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Error handling
error_exit() {
    log "${RED}ERROR: $1${NC}"
    exit 1
}

# Backup current configuration
backup_config() {
    log "${BLUE}Creating configuration backup...${NC}"
    cp config.json "$CONFIG_BACKUP" || error_exit "Failed to backup configuration"
    log "${GREEN}Configuration backed up to: $CONFIG_BACKUP${NC}"
}

# Merge configuration patch
merge_config() {
    local phase_config=$1
    log "${BLUE}Merging $phase_config with current configuration...${NC}"
    
    # Use jq to merge configurations
    if command -v jq >/dev/null 2>&1; then
        jq -s '.[0] * .[1]' config.json "$phase_config" > config_temp.json
        mv config_temp.json config.json
        log "${GREEN}Configuration merged successfully${NC}"
    else
        error_exit "jq is required for configuration merging. Please install jq."
    fi
}

# Validate configuration
validate_config() {
    log "${BLUE}Validating configuration...${NC}"
    
    # Run configuration validation
    if yarn test:config >/dev/null 2>&1; then
        log "${GREEN}Configuration validation passed${NC}"
    else
        error_exit "Configuration validation failed"
    fi
}

# Build and test
build_and_test() {
    log "${BLUE}Building project and running tests...${NC}"
    
    # Build
    yarn build || error_exit "Build failed"
    log "${GREEN}Build completed successfully${NC}"
    
    # Run critical tests
    yarn test:integration || error_exit "Integration tests failed"
    log "${GREEN}Integration tests passed${NC}"
}

# Start monitoring
start_monitoring() {
    log "${BLUE}Starting optimization monitoring...${NC}"
    
    # Create monitoring configuration
    cat > monitoring_config.json << EOF
{
    "optimization_phase": "$1",
    "deployment_time": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "baseline_metrics": {
        "signal_volume_target": 25,
        "detection_rate_target": 30,
        "false_positive_limit": 3,
        "latency_increase_limit": 20
    },
    "rollback_triggers": {
        "false_positive_rate": 5.0,
        "precision_drop": 2.0,
        "latency_increase": 15.0,
        "processing_overload": 10.0
    }
}
EOF
    
    log "${GREEN}Monitoring configuration created${NC}"
}

# Deploy specific phase
deploy_phase() {
    local phase=$1
    local config_file="config_${phase}_patch.json"
    
    log "${YELLOW}========================================${NC}"
    log "${YELLOW}DEPLOYING OPTIMIZATION PHASE: $phase${NC}"
    log "${YELLOW}========================================${NC}"
    
    # Check if phase configuration exists
    if [[ ! -f "$config_file" ]]; then
        error_exit "Configuration file $config_file not found"
    fi
    
    # Backup current config
    backup_config
    
    # Merge configuration
    merge_config "$config_file"
    
    # Validate
    validate_config
    
    # Build and test
    build_and_test
    
    # Start monitoring
    start_monitoring "$phase"
    
    # Restart application
    log "${BLUE}Restarting application...${NC}"
    if command -v pm2 >/dev/null 2>&1; then
        pm2 restart orderflow || error_exit "Failed to restart application with pm2"
    else
        log "${YELLOW}PM2 not found. Please restart the application manually.${NC}"
    fi
    
    log "${GREEN}========================================${NC}"
    log "${GREEN}PHASE $phase DEPLOYMENT COMPLETED${NC}"
    log "${GREEN}========================================${NC}"
    
    # Display monitoring information
    cat << EOF

${BLUE}DEPLOYMENT SUMMARY:${NC}
- Phase: $phase
- Configuration backup: $CONFIG_BACKUP
- Log file: $LOG_FILE
- Monitoring config: monitoring_config.json

${YELLOW}NEXT STEPS:${NC}
1. Monitor system performance for next 24-48 hours
2. Check signal volume and detection rate improvements
3. Watch for false positive rate increases
4. Use 'yarn monitor:optimization' to track KPIs

${RED}ROLLBACK COMMAND (if needed):${NC}
./deploy_optimization.sh rollback

EOF
}

# Rollback function
rollback() {
    log "${RED}========================================${NC}"
    log "${RED}INITIATING ROLLBACK${NC}"
    log "${RED}========================================${NC}"
    
    # Find most recent backup
    LATEST_BACKUP=$(ls -t config_backup_*.json 2>/dev/null | head -n1)
    
    if [[ -z "$LATEST_BACKUP" ]]; then
        error_exit "No backup configuration found"
    fi
    
    log "${BLUE}Rolling back to: $LATEST_BACKUP${NC}"
    
    # Restore configuration
    cp "$LATEST_BACKUP" config.json || error_exit "Failed to restore configuration"
    
    # Validate restored configuration
    validate_config
    
    # Build and restart
    yarn build || error_exit "Build failed during rollback"
    
    if command -v pm2 >/dev/null 2>&1; then
        pm2 restart orderflow || error_exit "Failed to restart application during rollback"
    fi
    
    log "${GREEN}========================================${NC}"
    log "${GREEN}ROLLBACK COMPLETED SUCCESSFULLY${NC}"
    log "${GREEN}========================================${NC}"
}

# Main execution
case "${1:-}" in
    "phase1"|"phase2"|"phase3")
        deploy_phase "$1"
        ;;
    "rollback")
        rollback
        ;;
    *)
        cat << EOF
Signal Optimization Deployment Tool

Usage: $0 [phase1|phase2|phase3|rollback]

Phases:
  phase1   - Conservative optimization (recommended first deployment)
  phase2   - Moderate optimization (deploy after phase1 validation)
  phase3   - Aggressive optimization (deploy after phase2 validation)
  rollback - Rollback to previous configuration

Examples:
  $0 phase1    # Deploy conservative optimization
  $0 rollback  # Rollback to previous configuration

EOF
        exit 1
        ;;
esac