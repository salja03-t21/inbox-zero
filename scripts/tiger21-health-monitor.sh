#!/bin/bash

# TIGER 21 Inbox Zero Health Monitoring Script
# Usage: ./scripts/tiger21-health-monitor.sh [--verbose] [--json] [--alert]
# 
# This script checks the health of the TIGER 21 Inbox Zero deployment
# and provides detailed status information for troubleshooting.

set -euo pipefail

# Configuration
DOMAIN="iz.tiger21.com"
SERVER="167.99.116.99"
STACK_NAME="inbox-zero-tiger21"
TIMEOUT=30

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Flags
VERBOSE=false
JSON_OUTPUT=false
ALERT_MODE=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        --json|-j)
            JSON_OUTPUT=true
            shift
            ;;
        --alert|-a)
            ALERT_MODE=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--verbose] [--json] [--alert]"
            echo "  --verbose, -v    Show detailed output"
            echo "  --json, -j       Output in JSON format"
            echo "  --alert, -a      Alert mode (exit 1 if any issues)"
            exit 0
            ;;
        *)
            echo "Unknown option $1"
            exit 1
            ;;
    esac
done

# Utility functions
log() {
    if [[ "$JSON_OUTPUT" == "false" ]]; then
        echo -e "$1"
    fi
}

log_verbose() {
    if [[ "$VERBOSE" == "true" && "$JSON_OUTPUT" == "false" ]]; then
        echo -e "$1"
    fi
}

check_status() {
    local service="$1"
    local status="$2"
    local message="$3"
    
    if [[ "$status" == "OK" ]]; then
        log "${GREEN}✅ $service: $message${NC}"
        return 0
    elif [[ "$status" == "WARN" ]]; then
        log "${YELLOW}⚠️  $service: $message${NC}"
        return 1
    else
        log "${RED}❌ $service: $message${NC}"
        return 2
    fi
}

# Initialize results
declare -A results
overall_status="OK"

log "${BLUE}🔍 TIGER 21 Inbox Zero Health Check${NC}"
log "${BLUE}Domain: https://$DOMAIN${NC}"
log "${BLUE}Server: $SERVER${NC}"
log "${BLUE}Time: $(date)${NC}"
log ""

# 1. Check domain DNS resolution
log_verbose "Checking DNS resolution..."
if dig +short "$DOMAIN" > /dev/null 2>&1; then
    dns_ip=$(dig +short "$DOMAIN" | head -n1)
    results["dns"]="OK"
    check_status "DNS Resolution" "OK" "Resolves to $dns_ip"
else
    results["dns"]="FAIL"
    check_status "DNS Resolution" "FAIL" "Cannot resolve domain"
    overall_status="FAIL"
fi

# 2. Check SSL certificate
log_verbose "Checking SSL certificate..."
if ssl_info=$(echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null | openssl x509 -noout -dates 2>/dev/null); then
    expiry=$(echo "$ssl_info" | grep "notAfter" | cut -d= -f2)
    expiry_epoch=$(date -d "$expiry" +%s 2>/dev/null || date -j -f "%b %d %H:%M:%S %Y %Z" "$expiry" +%s 2>/dev/null)
    current_epoch=$(date +%s)
    days_until_expiry=$(( (expiry_epoch - current_epoch) / 86400 ))
    
    if [[ $days_until_expiry -gt 30 ]]; then
        results["ssl"]="OK"
        check_status "SSL Certificate" "OK" "Valid, expires in $days_until_expiry days"
    elif [[ $days_until_expiry -gt 7 ]]; then
        results["ssl"]="WARN"
        check_status "SSL Certificate" "WARN" "Expires in $days_until_expiry days"
        if [[ "$overall_status" == "OK" ]]; then overall_status="WARN"; fi
    else
        results["ssl"]="FAIL"
        check_status "SSL Certificate" "FAIL" "Expires in $days_until_expiry days"
        overall_status="FAIL"
    fi
else
    results["ssl"]="FAIL"
    check_status "SSL Certificate" "FAIL" "Cannot retrieve certificate"
    overall_status="FAIL"
fi

# 3. Check application health endpoint
log_verbose "Checking application health endpoint..."
if health_response=$(curl -s --max-time $TIMEOUT "https://$DOMAIN/api/health/simple" 2>/dev/null); then
    if echo "$health_response" | grep -q "ok"; then
        results["app_health"]="OK"
        check_status "Application Health" "OK" "Health endpoint responding"
    else
        results["app_health"]="WARN"
        check_status "Application Health" "WARN" "Health endpoint returned: $health_response"
        if [[ "$overall_status" == "OK" ]]; then overall_status="WARN"; fi
    fi
else
    results["app_health"]="FAIL"
    check_status "Application Health" "FAIL" "Health endpoint not responding"
    overall_status="FAIL"
fi

# 4. Check application response time
log_verbose "Checking application response time..."
if response_time=$(curl -s -w "%{time_total}" -o /dev/null --max-time $TIMEOUT "https://$DOMAIN" 2>/dev/null); then
    response_ms=$(echo "$response_time * 1000" | bc -l | cut -d. -f1)
    if [[ $response_ms -lt 2000 ]]; then
        results["response_time"]="OK"
        check_status "Response Time" "OK" "${response_ms}ms"
    elif [[ $response_ms -lt 5000 ]]; then
        results["response_time"]="WARN"
        check_status "Response Time" "WARN" "${response_ms}ms (slow)"
        if [[ "$overall_status" == "OK" ]]; then overall_status="WARN"; fi
    else
        results["response_time"]="FAIL"
        check_status "Response Time" "FAIL" "${response_ms}ms (very slow)"
        overall_status="FAIL"
    fi
else
    results["response_time"]="FAIL"
    check_status "Response Time" "FAIL" "Timeout or error"
    overall_status="FAIL"
fi

# 5. Check Docker services on server
log_verbose "Checking Docker services..."
if ssh_output=$(ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no "root@$SERVER" "docker service ls --filter name=$STACK_NAME --format 'table {{.Name}}\t{{.Replicas}}\t{{.Image}}'" 2>/dev/null); then
    service_count=$(echo "$ssh_output" | tail -n +2 | wc -l)
    failed_services=$(echo "$ssh_output" | tail -n +2 | grep -E "0/[0-9]+" | wc -l)
    
    if [[ $failed_services -eq 0 && $service_count -ge 4 ]]; then
        results["docker_services"]="OK"
        check_status "Docker Services" "OK" "$service_count services running"
        
        if [[ "$VERBOSE" == "true" ]]; then
            log_verbose "\nService Details:"
            echo "$ssh_output" | while IFS= read -r line; do
                log_verbose "  $line"
            done
        fi
    elif [[ $failed_services -gt 0 ]]; then
        results["docker_services"]="FAIL"
        check_status "Docker Services" "FAIL" "$failed_services services failed"
        overall_status="FAIL"
        
        if [[ "$VERBOSE" == "true" ]]; then
            log_verbose "\nFailed Services:"
            echo "$ssh_output" | tail -n +2 | grep -E "0/[0-9]+" | while IFS= read -r line; do
                log_verbose "  ${RED}$line${NC}"
            done
        fi
    else
        results["docker_services"]="WARN"
        check_status "Docker Services" "WARN" "Only $service_count services found (expected 4)"
        if [[ "$overall_status" == "OK" ]]; then overall_status="WARN"; fi
    fi
else
    results["docker_services"]="FAIL"
    check_status "Docker Services" "FAIL" "Cannot connect to server"
    overall_status="FAIL"
fi

# 6. Check server resources
log_verbose "Checking server resources..."
if resource_info=$(ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no "root@$SERVER" "df -h / && echo '---' && free -h && echo '---' && uptime" 2>/dev/null); then
    disk_usage=$(echo "$resource_info" | head -n2 | tail -n1 | awk '{print $5}' | sed 's/%//')
    memory_usage=$(echo "$resource_info" | grep "Mem:" | awk '{used=$3; total=$2; gsub(/[^0-9.]/, "", used); gsub(/[^0-9.]/, "", total); print int(used/total*100)}')
    load_avg=$(echo "$resource_info" | tail -n1 | awk '{print $10}' | sed 's/,//')
    
    resource_status="OK"
    resource_message=""
    
    if [[ $disk_usage -gt 90 ]]; then
        resource_status="FAIL"
        resource_message="Disk ${disk_usage}% full"
        overall_status="FAIL"
    elif [[ $disk_usage -gt 80 ]]; then
        resource_status="WARN"
        resource_message="Disk ${disk_usage}% full"
        if [[ "$overall_status" == "OK" ]]; then overall_status="WARN"; fi
    elif [[ $(echo "$load_avg > 8" | bc -l) -eq 1 ]]; then
        resource_status="WARN"
        resource_message="High load: $load_avg"
        if [[ "$overall_status" == "OK" ]]; then overall_status="WARN"; fi
    else
        resource_message="Disk ${disk_usage}%, Memory ${memory_usage}%, Load $load_avg"
    fi
    
    results["resources"]="$resource_status"
    check_status "Server Resources" "$resource_status" "$resource_message"
    
    if [[ "$VERBOSE" == "true" ]]; then
        log_verbose "\nResource Details:"
        echo "$resource_info" | while IFS= read -r line; do
            log_verbose "  $line"
        done
    fi
else
    results["resources"]="FAIL"
    check_status "Server Resources" "FAIL" "Cannot retrieve resource information"
    overall_status="FAIL"
fi

# 7. Check recent Docker logs for errors
log_verbose "Checking recent logs for errors..."
if log_errors=$(ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no "root@$SERVER" "docker service logs --since 10m --tail 50 ${STACK_NAME}_app 2>/dev/null | grep -i -E '(error|exception|failed|timeout)' | wc -l" 2>/dev/null); then
    if [[ $log_errors -eq 0 ]]; then
        results["logs"]="OK"
        check_status "Recent Logs" "OK" "No errors in last 10 minutes"
    elif [[ $log_errors -lt 5 ]]; then
        results["logs"]="WARN"
        check_status "Recent Logs" "WARN" "$log_errors errors in last 10 minutes"
        if [[ "$overall_status" == "OK" ]]; then overall_status="WARN"; fi
    else
        results["logs"]="FAIL"
        check_status "Recent Logs" "FAIL" "$log_errors errors in last 10 minutes"
        overall_status="FAIL"
    fi
else
    results["logs"]="WARN"
    check_status "Recent Logs" "WARN" "Cannot retrieve logs"
    if [[ "$overall_status" == "OK" ]]; then overall_status="WARN"; fi
fi

# Output results
log ""
if [[ "$JSON_OUTPUT" == "true" ]]; then
    # JSON output
    echo "{"
    echo "  \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
    echo "  \"domain\": \"$DOMAIN\","
    echo "  \"server\": \"$SERVER\","
    echo "  \"overall_status\": \"$overall_status\","
    echo "  \"checks\": {"
    
    first=true
    for check in dns ssl app_health response_time docker_services resources logs; do
        if [[ "$first" == "true" ]]; then
            first=false
        else
            echo ","
        fi
        echo -n "    \"$check\": \"${results[$check]}\""
    done
    echo ""
    echo "  }"
    echo "}"
else
    # Human readable summary
    case $overall_status in
        "OK")
            log "${GREEN}🎉 Overall Status: HEALTHY${NC}"
            ;;
        "WARN")
            log "${YELLOW}⚠️  Overall Status: WARNING - Some issues detected${NC}"
            ;;
        "FAIL")
            log "${RED}🚨 Overall Status: CRITICAL - Immediate attention required${NC}"
            ;;
    esac
fi

# Exit with appropriate code
if [[ "$ALERT_MODE" == "true" ]]; then
    case $overall_status in
        "OK")
            exit 0
            ;;
        "WARN")
            exit 1
            ;;
        "FAIL")
            exit 2
            ;;
    esac
else
    exit 0
fi