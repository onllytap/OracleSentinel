#!/bin/bash
# ============================================================================
# OracleSentinel — Production Deployment Script
# ============================================================================
# Usage: ./deploy.sh
# Run this script from /opt/oraclesentinel on the VPS
# ============================================================================

set -e

echo "================================================"
echo "OracleSentinel Production Deployment"
echo "================================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "docker-compose.production.yml" ]; then
    echo -e "${RED}ERROR: docker-compose.production.yml not found${NC}"
    echo "Please run this script from /opt/oraclesentinel"
    exit 1
fi

if [ ! -f "server/.env" ]; then
    echo -e "${RED}ERROR: server/.env not found${NC}"
    exit 1
fi

echo -e "${YELLOW}[1/5] Stopping existing containers...${NC}"
docker compose -f docker-compose.production.yml down --remove-orphans 2>/dev/null || true

echo -e "${YELLOW}[2/5] Cleaning up old images...${NC}"
docker system prune -f 2>/dev/null || true

echo -e "${YELLOW}[3/5] Building new images (no cache)...${NC}"
docker compose -f docker-compose.production.yml build --no-cache

echo -e "${YELLOW}[4/5] Starting containers...${NC}"
docker compose -f docker-compose.production.yml up -d

echo -e "${YELLOW}[5/5] Waiting for health check...${NC}"
sleep 10

# Check container status
if docker compose -f docker-compose.production.yml ps | grep -q "unhealthy\|Exit"; then
    echo -e "${RED}WARNING: Some containers may have issues${NC}"
    docker compose -f docker-compose.production.yml ps
    docker compose -f docker-compose.production.yml logs --tail=50 oraclesentinel
else
    echo -e "${GREEN}All containers are running!${NC}"
fi

echo ""
echo "================================================"
echo "Testing CSP Headers..."
echo "================================================"

# Wait a bit more for the server to be ready
sleep 5

# Test CSP header
CSP_HEADER=$(curl -sSI "https://api.oraclesentinel.com/embed?widget_id=default" 2>/dev/null | grep -i "content-security-policy" || echo "")

if echo "$CSP_HEADER" | grep -q "frame-ancestors"; then
    echo -e "${GREEN}CSP Header OK!${NC}"
    echo "$CSP_HEADER" | head -1
else
    echo -e "${YELLOW}CSP Header not found or incomplete. Testing local...${NC}"
    LOCAL_CSP=$(curl -sSI "http://localhost:3001/embed?widget_id=default" 2>/dev/null | grep -i "content-security-policy" || echo "")
    if [ -n "$LOCAL_CSP" ]; then
        echo -e "${GREEN}Local CSP Header:${NC}"
        echo "$LOCAL_CSP" | head -1
    else
        echo -e "${RED}No CSP header found. Check logs:${NC}"
        docker compose -f docker-compose.production.yml logs --tail=20 oraclesentinel
    fi
fi

echo ""
echo "================================================"
echo "Deployment Complete!"
echo "================================================"
echo ""
echo "Commands:"
echo "  View logs:    docker compose -f docker-compose.production.yml logs -f oraclesentinel"
echo "  Restart:      docker compose -f docker-compose.production.yml restart"
echo "  Stop:         docker compose -f docker-compose.production.yml down"
echo ""
echo "Test URLs:"
echo "  Health:       https://api.oraclesentinel.com/health"
echo "  Embed:        https://api.oraclesentinel.com/embed?widget_id=default"
echo "  Factory:      https://api.oraclesentinel.com/factory"
echo ""
