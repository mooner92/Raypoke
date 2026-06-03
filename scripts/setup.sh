#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# PokeBOT — Oracle Cloud (Ubuntu 22.04) initial setup script.
# Installs Node.js 22, Docker, nginx, opens firewall ports, and bootstraps .env.
# Run as a sudo-capable user from the project root:  bash scripts/setup.sh
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

log() { echo -e "\033[1;32m[setup]\033[0m $*"; }
warn() { echo -e "\033[1;33m[setup]\033[0m $*"; }

# 1. Node.js 22 via nvm ─────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v 2>/dev/null)" != v22* ]]; then
  log "Installing Node.js 22 via nvm..."
  export NVM_DIR="$HOME/.nvm"
  if [ ! -d "$NVM_DIR" ]; then
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  fi
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
  nvm install 22
  nvm alias default 22
else
  log "Node.js 22 already present: $(node -v)"
fi

# 2. Docker + docker compose ─────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER" || true
  warn "Re-login (or 'newgrp docker') for group membership to take effect."
else
  log "Docker already present: $(docker -v)"
fi

# 3. nginx ────────────────────────────────────────────────────────────────────
if ! command -v nginx >/dev/null 2>&1; then
  log "Installing nginx..."
  sudo apt-get update -y
  sudo apt-get install -y nginx
else
  log "nginx already present."
fi

# 4. Firewall — Oracle requires BOTH iptables and the Security List (console) ─────
log "Opening ports 3000, 80, 443 in iptables..."
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3000 -j ACCEPT || true
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT || true
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT || true
if command -v netfilter-persistent >/dev/null 2>&1; then
  sudo netfilter-persistent save || true
fi
warn "REMINDER: also open 80/443 in the Oracle Cloud Console → Security List ingress rules."

# 5. .env bootstrap ──────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  log "Creating .env from .env.example — fill in your API keys."
  cp .env.example .env
  warn "Edit .env now: GEMINI_API_KEY is required."
else
  log ".env already exists; leaving it untouched."
fi

# 6. PM2 (Docker-less alternative) ─────────────────────────────────────────────────
if ! command -v pm2 >/dev/null 2>&1; then
  log "Installing PM2 (optional, for non-Docker deployments)..."
  npm install -g pm2 || warn "PM2 install skipped."
fi

# 7. Start the service ────────────────────────────────────────────────────────────
if command -v docker >/dev/null 2>&1; then
  log "Building and starting via docker compose..."
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
  sleep 5
  curl -fsS "http://localhost:${PORT:-3000}/health" && echo || warn "Health check did not respond yet."
else
  warn "Docker unavailable; start manually with 'npm run build && npm start' or PM2."
fi

log "Setup complete."
