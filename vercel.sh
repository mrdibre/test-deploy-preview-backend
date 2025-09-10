#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Required environment variables
required_vars=("VERCEL_TOKEN" "VERCEL_PROJECT_ID" "VERCEL_ORG_ID" "FE_BRANCH")

log() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

# Check required environment variables
for var in "${required_vars[@]}"; do
    if [[ -z "${!var}" ]]; then
        error "Missing required environment variable: $var"
    fi
done

# API base URL
VERCEL_API_BASE="https://api.vercel.com"

# Target API URL for this branch
TARGET_API_URL="https://api.pr-${FE_BRANCH}.deploy-preview.mrdibre.com"

log "Starting Vercel deployment management for branch: $FE_BRANCH"
log "Target API URL: $TARGET_API_URL"

# Function to make API calls
api_call() {
    local method="$1"
    local endpoint="$2"
    local data="$3"
    
    local curl_args=(
        -X "$method"
        -H "Authorization: Bearer $VERCEL_TOKEN"
        -H "Content-Type: application/json"
        -s
    )
    
    if [[ -n "$data" ]]; then
        curl_args+=(-d "$data")
    fi
    
    curl "${curl_args[@]}" "$VERCEL_API_BASE$endpoint"
}

# Function to check existing deployments
check_existing_deployment() {
    log "Checking for existing deployments..."
    
    local response=$(api_call "GET" "/v6/deployments?projectId=$VERCEL_PROJECT_ID&limit=50")
    
    if [[ $? -ne 0 ]]; then
        error "Failed to fetch deployments"
    fi
    
    echo "$response" | jq -r --arg branch "$FE_BRANCH" '
        .deployments[]? | 
        select(.meta.githubCommitRef == $branch or .name | test($branch)) |
        select(.state == "READY" or .state == "BUILDING") |
        .uid' | head -1
}

# Function to get environment variable ID
get_env_var_id() {
    log "Fetching VITE_API_URL environment variable ID..."
    
    local response=$(api_call "GET" "/v9/projects/$VERCEL_PROJECT_ID/env")
    
    if [[ $? -ne 0 ]]; then
        error "Failed to fetch environment variables"
    fi
    
    echo "$response" | jq -r '.envs[]? | select(.key == "VITE_API_URL") | .id' | head -1
}

# Function to update environment variable
update_env_var() {
    local env_var_id="$1"
    
    if [[ -z "$env_var_id" ]]; then
        warn "VITE_API_URL environment variable not found, creating new one..."
        
        local create_data=$(jq -n \
            --arg key "VITE_API_URL" \
            --arg value "$TARGET_API_URL" \
            '{
                key: $key,
                value: $value,
                target: ["preview"],
                type: "plain"
            }')
        
        local response=$(api_call "POST" "/v10/projects/$VERCEL_PROJECT_ID/env" "$create_data")
        
        if [[ $? -eq 0 ]]; then
            log "Created new VITE_API_URL environment variable"
        else
            error "Failed to create environment variable"
        fi
    else
        log "Updating VITE_API_URL environment variable (ID: $env_var_id)..."
        
        local update_data=$(jq -n \
            --arg key "VITE_API_URL" \
            --arg value "$TARGET_API_URL" \
            '{
                key: $key,
                value: $value,
                target: ["preview"],
                type: "plain"
            }')
        
        local response=$(api_call "PATCH" "/v9/projects/$VERCEL_PROJECT_ID/env/$env_var_id" "$update_data")
        
        if [[ $? -eq 0 ]]; then
            log "Updated VITE_API_URL to: $TARGET_API_URL"
        else
            error "Failed to update environment variable"
        fi
    fi
}

# Function to trigger new deployment
create_deployment() {
    log "Creating new deployment..."
    
    local deploy_data=$(jq -n \
        --arg name "pr-$FE_BRANCH" \
        --arg branch "$FE_BRANCH" \
        --arg project "$VERCEL_PROJECT_ID" \
        '{
            name: $name,
            project: $project,
            target: "preview",
            gitSource: {
                type: "github",
                ref: $branch
            }
        }')
    
    local response=$(api_call "POST" "/v13/deployments" "$deploy_data")
    
    if [[ $? -eq 0 ]]; then
        local deployment_url=$(echo "$response" | jq -r '.url // empty')
        local deployment_id=$(echo "$response" | jq -r '.uid // empty')
        
        if [[ -n "$deployment_url" ]]; then
            log "New deployment created successfully!"
            log "Deployment URL: https://$deployment_url"
            log "Deployment ID: $deployment_id"
        else
            log "Deployment triggered successfully"
        fi
    else
        error "Failed to create new deployment"
    fi
}

# Function to redeploy existing deployment
redeploy_existing() {
    local existing_deployment_id="$1"
    
    log "Redeploying existing deployment (ID: $existing_deployment_id)..."
    
    local redeploy_data=$(jq -n \
        --arg deploymentId "$existing_deployment_id" \
        '{
            deploymentId: $deploymentId,
            target: "preview"
        }')
    
    local response=$(api_call "POST" "/v13/deployments" "$redeploy_data")
    
    if [[ $? -eq 0 ]]; then
        local deployment_url=$(echo "$response" | jq -r '.url // empty')
        local deployment_id=$(echo "$response" | jq -r '.uid // empty')
        
        if [[ -n "$deployment_url" ]]; then
            log "Redeployment triggered successfully!"
            log "Deployment URL: https://$deployment_url"
            log "Deployment ID: $deployment_id"
        else
            log "Redeployment triggered successfully"
        fi
    else
        warn "Failed to redeploy existing deployment, creating new one instead..."
        create_deployment
    fi
}

# Main execution
main() {
    # Check if jq is available
    if ! command -v jq &> /dev/null; then
        error "jq is required but not installed. Please install jq to continue."
    fi
    
    # Step 1: Check for existing deployments
    existing_deployment=$(check_existing_deployment)
    
    # Step 2: Update environment variable
    env_var_id=$(get_env_var_id)
    update_env_var "$env_var_id"
    
    # Step 3: Deploy or redeploy
    if [[ -n "$existing_deployment" ]]; then
        log "Found existing deployment: $existing_deployment"
        redeploy_existing "$existing_deployment"
    else
        log "No existing deployment found for branch: $FE_BRANCH"
        create_deployment
    fi
    
    log "Vercel deployment process completed successfully!"
}

# Run main function
main "$@"
