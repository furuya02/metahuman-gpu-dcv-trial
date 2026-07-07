#!/usr/bin/env bash
# インスタンスタイプを切り替える(停止→変更→起動)。ルート EBS は保持される。
#   準備作業: 既定の t3.large のまま
#   GPU 作業: scripts/switch-type.sh g5.xlarge
#   準備に戻す: scripts/switch-type.sh t3.large
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && source .env && set +a
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-ap-northeast-1}"

TYPE="${1:?使い方: scripts/switch-type.sh <instance-type>  例) scripts/switch-type.sh g5.xlarge}"

ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=metahuman-gpu-dcv-trial-*" \
            "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)

echo "instance ${ID} を ${TYPE} へ切り替えます(停止→変更→起動)"
aws ec2 stop-instances --instance-ids "${ID}" >/dev/null
aws ec2 wait instance-stopped --instance-ids "${ID}"
aws ec2 modify-instance-attribute --instance-id "${ID}" --instance-type "{\"Value\":\"${TYPE}\"}"
aws ec2 start-instances --instance-ids "${ID}" >/dev/null
aws ec2 wait instance-running --instance-ids "${ID}"

IP=$(aws ec2 describe-instances --instance-ids "${ID}" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
echo "完了。新しい接続先 DCV: https://${IP}:8443"
echo "(g5 などに切り替えた初回は NVIDIA ドライバ自動導入のため接続可能まで数分〜十数分かかります)"
