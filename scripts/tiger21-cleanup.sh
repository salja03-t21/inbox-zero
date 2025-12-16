#!/bin/bash

# TIGER 21 Inbox Zero Docker Cleanup Script
# Usage: ./scripts/tiger21-cleanup.sh [--dry-run] [--aggressive] [--local] [--remote]
# 
# This script cleans up Docker images and containers to free up disk space
# on both local development machine and production server.

set -euo pipefail

# Configuration
SERVER="167.99.116.99"
REGISTRY="ghcr.io/tiger21-llc/inbox-zero"
KEEP_IMAGES=5  # Number of recent images to keep

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Flags
DRY_RUN=false
AGGRESSIVE=false
LOCAL_ONLY=false
REMOTE_ONLY=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run|-n)
            DRY_RUN=true
            shift
            ;;
        --aggressive|-a)
            AGGRESSIVE=true
            shift
            ;;
        --local|-l)
            LOCAL_ONLY=true
            shift
            ;;
        --remote|-r)
            REMOTE_ONLY=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--dry-run] [--aggressive] [--local] [--remote]"
            echo "  --dry-run, -n     Show what would be deleted without actually deleting"
            echo "  --aggressive, -a  More aggressive cleanup (includes unused volumes)"
            echo "  --local, -l       Only clean local machine"
            echo "  --remote, -r      Only clean remote server"
            echo ""
            echo "Examples:"
            echo "  $0                    # Clean both local and remote (safe mode)"
            echo "  $0 --dry-run          # Show what would be cleaned"
            echo "  $0 --aggressive       # Aggressive cleanup including volumes"
            echo "  $0 --local --dry-run  # Show local cleanup only"
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
    echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[$(date '+%H:%M:%S')] ✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}[$(date '+%H:%M:%S')] ❌ $1${NC}"
}

execute_command() {
    local cmd="$1"
    local description="$2"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_warning "DRY RUN: $description"
        log "Would execute: $cmd"
        return 0
    else
        log "$description"
        if eval "$cmd"; then
            log_success "Completed: $description"
            return 0
        else
            log_error "Failed: $description"
            return 1
        fi
    fi
}

get_disk_usage() {
    local location="$1"
    if [[ "$location" == "local" ]]; then
        df -h / | awk 'NR==2 {print $5}' | sed 's/%//'
    else
        ssh -o ConnectTimeout=10 "root@$SERVER" 'df -h / | awk "NR==2 {print \$5}" | sed "s/%//"' 2>/dev/null || echo "N/A"
    fi
}

cleanup_local() {
    log "${BLUE}🧹 Starting local cleanup...${NC}"
    
    local initial_usage=$(get_disk_usage "local")
    log "Initial disk usage: ${initial_usage}%"
    
    # 1. Remove stopped containers
    if docker ps -aq --filter "status=exited" | grep -q .; then
        execute_command "docker rm \$(docker ps -aq --filter 'status=exited')" "Remove stopped containers"
    else
        log "No stopped containers to remove"
    fi
    
    # 2. Remove dangling images
    if docker images -f "dangling=true" -q | grep -q .; then
        execute_command "docker rmi \$(docker images -f 'dangling=true' -q)" "Remove dangling images"
    else
        log "No dangling images to remove"
    fi
    
    # 3. Clean up old inbox-zero images (keep last N)
    log "Checking for old inbox-zero images..."
    if docker images "$REGISTRY" --format "table {{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.CreatedAt}}" | tail -n +2 | wc -l | grep -q -v "^0$"; then
        local old_images=$(docker images "$REGISTRY" --format "{{.ID}}" | tail -n +$((KEEP_IMAGES + 1)))
        if [[ -n "$old_images" ]]; then
            execute_command "echo '$old_images' | xargs docker rmi" "Remove old inbox-zero images (keeping $KEEP_IMAGES most recent)"
        else
            log "No old inbox-zero images to remove (have $(docker images "$REGISTRY" --format "{{.ID}}" | wc -l) images, keeping $KEEP_IMAGES)"
        fi
    else
        log "No inbox-zero images found locally"
    fi
    
    # 4. Remove unused networks
    if docker network ls --filter "driver=bridge" --filter "name!=bridge" --filter "name!=host" --filter "name!=none" -q | grep -q .; then
        execute_command "docker network prune -f" "Remove unused networks"
    else
        log "No unused networks to remove"
    fi
    
    # 5. Aggressive cleanup
    if [[ "$AGGRESSIVE" == "true" ]]; then
        log_warning "Performing aggressive cleanup..."
        
        # Remove unused volumes
        if docker volume ls -q | grep -q .; then
            execute_command "docker volume prune -f" "Remove unused volumes"
        fi
        
        # Remove all unused images (not just dangling)
        execute_command "docker image prune -a -f" "Remove all unused images"
        
        # Clean build cache
        execute_command "docker builder prune -a -f" "Clean Docker build cache"
    fi
    
    # 6. System prune (safe)
    execute_command "docker system prune -f" "Remove unused data (containers, networks, images)"
    
    local final_usage=$(get_disk_usage "local")
    log_success "Local cleanup completed"
    log "Final disk usage: ${final_usage}% (was ${initial_usage}%)"
    
    if [[ "$initial_usage" != "N/A" && "$final_usage" != "N/A" ]]; then
        local saved=$((initial_usage - final_usage))
        if [[ $saved -gt 0 ]]; then
            log_success "Freed up ${saved}% disk space"
        fi
    fi
}

cleanup_remote() {
    log "${BLUE}🧹 Starting remote cleanup on $SERVER...${NC}"
    
    # Check server connectivity
    if ! ssh -o ConnectTimeout=10 "root@$SERVER" 'echo "Connected"' >/dev/null 2>&1; then
        log_error "Cannot connect to server $SERVER"
        return 1
    fi
    
    local initial_usage=$(get_disk_usage "remote")
    log "Initial disk usage: ${initial_usage}%"
    
    # 1. Remove stopped containers
    log "Checking for stopped containers..."
    local stopped_containers=$(ssh "root@$SERVER" 'docker ps -aq --filter "status=exited"' 2>/dev/null || echo "")
    if [[ -n "$stopped_containers" ]]; then
        execute_command "ssh 'root@$SERVER' 'docker rm \$(docker ps -aq --filter \"status=exited\")'" "Remove stopped containers on server"
    else
        log "No stopped containers to remove on server"
    fi
    
    # 2. Remove dangling images
    log "Checking for dangling images..."
    local dangling_images=$(ssh "root@$SERVER" 'docker images -f "dangling=true" -q' 2>/dev/null || echo "")
    if [[ -n "$dangling_images" ]]; then
        execute_command "ssh 'root@$SERVER' 'docker rmi \$(docker images -f \"dangling=true\" -q)'" "Remove dangling images on server"
    else
        log "No dangling images to remove on server"
    fi
    
    # 3. Clean up old inbox-zero images (keep last N)
    log "Checking for old inbox-zero images on server..."
    local image_count=$(ssh "root@$SERVER" "docker images '$REGISTRY' --format '{{.ID}}' | wc -l" 2>/dev/null || echo "0")
    if [[ "$image_count" -gt "$KEEP_IMAGES" ]]; then
        execute_command "ssh 'root@$SERVER' 'docker images \"$REGISTRY\" --format \"{{.ID}}\" | tail -n +$((KEEP_IMAGES + 1)) | xargs -r docker rmi'" "Remove old inbox-zero images on server (keeping $KEEP_IMAGES most recent)"
    else
        log "No old inbox-zero images to remove on server (have $image_count images, keeping $KEEP_IMAGES)"
    fi
    
    # 4. Remove unused networks (be careful not to remove swarm networks)
    execute_command "ssh 'root@$SERVER' 'docker network prune -f'" "Remove unused networks on server"
    
    # 5. Aggressive cleanup
    if [[ "$AGGRESSIVE" == "true" ]]; then
        log_warning "Performing aggressive cleanup on server..."
        
        # Check if any volumes are safe to remove (not used by running services)
        log "Checking for unused volumes..."
        local unused_volumes=$(ssh "root@$SERVER" 'docker volume ls -q --filter "dangling=true"' 2>/dev/null || echo "")
        if [[ -n "$unused_volumes" ]]; then
            # Be extra careful with volumes in production
            log_warning "Found unused volumes, but skipping removal in production for safety"
            log "Unused volumes: $unused_volumes"
            log "To remove manually: ssh root@$SERVER 'docker volume rm $unused_volumes'"
        fi
        
        # Remove all unused images (not just dangling)
        execute_command "ssh 'root@$SERVER' 'docker image prune -a -f'" "Remove all unused images on server"
        
        # Clean build cache
        execute_command "ssh 'root@$SERVER' 'docker builder prune -a -f'" "Clean Docker build cache on server"
    fi
    
    # 6. System prune (safe)
    execute_command "ssh 'root@$SERVER' 'docker system prune -f'" "Remove unused data on server"
    
    # 7. Clean up old log files if they exist
    execute_command "ssh 'root@$SERVER' 'find /var/lib/docker/containers -name \"*.log\" -type f -size +100M -mtime +7 -exec truncate -s 0 {} \;'" "Truncate large old Docker log files"
    
    local final_usage=$(get_disk_usage "remote")
    log_success "Remote cleanup completed"
    log "Final disk usage: ${final_usage}% (was ${initial_usage}%)"
    
    if [[ "$initial_usage" != "N/A" && "$final_usage" != "N/A" ]]; then
        local saved=$((initial_usage - final_usage))
        if [[ $saved -gt 0 ]]; then
            log_success "Freed up ${saved}% disk space on server"
        fi
    fi
}

show_cleanup_summary() {
    log "${BLUE}📊 Cleanup Summary${NC}"
    
    if [[ "$LOCAL_ONLY" != "true" ]]; then
        log "Remote server ($SERVER):"
        ssh "root@$SERVER" 'echo "  Disk usage: $(df -h / | awk "NR==2 {print \$5}")"' 2>/dev/null || log "  Cannot connect to server"
        ssh "root@$SERVER" 'echo "  Docker images: $(docker images | wc -l) total"' 2>/dev/null || true
        ssh "root@$SERVER" 'echo "  Running containers: $(docker ps -q | wc -l)"' 2>/dev/null || true
    fi
    
    if [[ "$REMOTE_ONLY" != "true" ]]; then
        log "Local machine:"
        echo "  Disk usage: $(df -h / | awk 'NR==2 {print $5}')"
        echo "  Docker images: $(docker images | wc -l) total"
        echo "  Running containers: $(docker ps -q | wc -l)"
    fi
}

# Main execution
main() {
    log "${BLUE}🚀 TIGER 21 Docker Cleanup Script${NC}"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_warning "DRY RUN MODE - No changes will be made"
    fi
    
    if [[ "$AGGRESSIVE" == "true" ]]; then
        log_warning "AGGRESSIVE MODE - Will remove more data"
    fi
    
    log ""
    
    # Execute cleanup based on flags
    if [[ "$REMOTE_ONLY" == "true" ]]; then
        cleanup_remote
    elif [[ "$LOCAL_ONLY" == "true" ]]; then
        cleanup_local
    else
        # Clean both local and remote
        cleanup_local
        log ""
        cleanup_remote
    fi
    
    log ""
    show_cleanup_summary
    
    log ""
    log_success "Cleanup completed successfully!"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log "Run without --dry-run to actually perform the cleanup"
    fi
}

# Run main function
main "$@"