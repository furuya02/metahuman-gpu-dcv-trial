#!/usr/bin/env bash
# 現在のパブリック IP と接続先を表示する(EIP を使わないため起動ごとに IP が変わる)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && source .env && set +a
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-ap-northeast-1}"

ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=metahuman-gpu-dcv-trial-*" \
            "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)

read -r STATE TYPE IP < <(aws ec2 describe-instances --instance-ids "${ID}" \
  --query 'Reservations[0].Instances[0].[State.Name,InstanceType,PublicIpAddress]' \
  --output text)

echo "Instance : ${ID} (${TYPE}, ${STATE})"
echo "DCV      : https://${IP}:8443"
echo "RDP      : ${IP}:3389"
echo "ユーザー : Administrator (パスワードは EC2 コンソール > 接続 > RDP クライアント > パスワードを取得)"
