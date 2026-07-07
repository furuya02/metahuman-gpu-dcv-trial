#!/usr/bin/env bash
# インスタンスを起動する
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && source .env && set +a
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-ap-northeast-1}"

ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=metahuman-gpu-dcv-trial-*" \
            "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)

echo "start ${ID}"
aws ec2 start-instances --instance-ids "${ID}" >/dev/null
aws ec2 wait instance-running --instance-ids "${ID}"
echo "running. 接続先の確認: scripts/connect-info.sh"
