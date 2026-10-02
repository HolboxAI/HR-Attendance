#!/usr/bin/env bash
set -e

EC2_HOST="98.84.138.15"
EC2_USER="ubuntu"
SSH_KEY="$HOME/.ssh/holbox-ec2.pem"
REMOTE_DIR="/home/ubuntu/boxcode-hrms"

echo "=== Deploying Code to Holbox EC2 Production ==="

# Rsync strictly excluding all database, local uploads, env files, and artifacts
rsync -avz -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=no" \
  --exclude 'node_modules' \
  --exclude '.venv' \
  --exclude '.next' \
  --exclude '.git' \
  --exclude '__pycache__' \
  --exclude 'data/' \
  --exclude '*.db*' \
  --exclude 'apps/api/.env' \
  --exclude 'myco-frontend/mobile/.env' \
  ./ "$EC2_USER@$EC2_HOST:$REMOTE_DIR/"

echo "=== Rebuilding Frontend and Restarting Services on EC2 ==="
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_HOST" "
  sudo systemctl restart boxcode-api.service && \
  cd $REMOTE_DIR/myco-frontend/web && \
  npm run build && \
  pm2 restart all
"

echo "=== Deployment Complete & Production Live! ==="
