#!/usr/bin/env bash
# Provision the Wonderland Windows GPU workstation on AWS EC2.
#
# NOTHING CHARGEABLE HAPPENS WITHOUT --confirm. Without it this prints the
# exact plan, the resolved AMI, the hourly price and the monthly estimate, and
# exits 0 having created nothing.
#
#   ./launch-workstation.sh                 # plan only (default)
#   ./launch-workstation.sh --confirm       # create the instance
#   ./launch-workstation.sh --stop|--start|--status|--terminate
#
# Design notes that are decisions, not defaults:
#   * us-west-2 because it is the only US-West region carrying g5/g6/g6e, and
#     measured 35-75 ms from the founder's Chromebook (us-east is 68-97 ms).
#   * g6.2xlarge (L4 24 GB) to START: the same GPU family as the Lightning L4
#     already proven for this project, at $1.35/h against g6e's $2.61/h. The
#     first job is to prove Aura runs on Windows Server with UE 5.8 at all --
#     that does not need L40S headroom. The SAME EBS root can be re-typed to
#     g6e.2xlarge (L40S 48 GB, 64 GB RAM) later: stop, change type, start.
#   * Windows Server 2022 Full: Windows 10/11 client licences cannot be bought
#     on EC2 (BYOL on dedicated hosts only). The Epic Launcher is not OFFICIALLY
#     supported on Server, though AWS's own game-dev toolkit ships exactly this
#     combination. This is the plan's main risk and it is cheap to test.
#   * No inbound 3389 ever. DCV on 8443 from one /32, and SSM Session Manager
#     as break-glass.
set -euo pipefail
REGION=${WL_REGION:-us-west-2}
PROFILE=${WL_AWS_PROFILE:-relay-wonderland}
TYPE=${WL_INSTANCE_TYPE:-g6.2xlarge}
DISK=${WL_DISK_GB:-300}
NAME=wonderland-aura-workstation
AWS="aws --profile $PROFILE --region $REGION"
HERE="$(cd "$(dirname "$0")" && pwd)"

price_of() { case "$1" in
  g6.2xlarge) echo 1.3456;; g6.4xlarge) echo 2.0592;; g6e.2xlarge) echo 2.61008;;
  g5.2xlarge) echo 1.58;; g5.4xlarge) echo 2.36;; g4dn.2xlarge) echo 1.12;; *) echo 0;; esac; }

plan() {
  local hr; hr=$(price_of "$TYPE")
  local ami; ami=$($AWS ssm get-parameters --names /aws/service/ami-windows-latest/Windows_Server-2022-English-Full-Base \
        --query 'Parameters[0].Value' --output text 2>/dev/null || echo '<needs aws credentials>')
  cat <<PLAN
  PLAN — nothing has been created.

    region        $REGION            (35-75 ms from the Chromebook; only US-West region with g6)
    instance      $TYPE          \$$hr/hour, Windows licence included
    AMI           $ami
    root volume   ${DISK} GB gp3      \$$(python3 -c "print(f'{$DISK*0.08:.2f}')")/month, persists across stop/start
    GPU driver    NVIDIA GRID from s3://ec2-windows-nvidia-drivers (free on EC2)
    desktop       Amazon DCV, browser, no client install on ChromeOS, TCP/UDP 8443
    inbound       8443 from your IP only. No 3389. SSM for break-glass.

  MONTHLY ESTIMATE
    running  8 h/week   \$$(python3 -c "print(f'{34.7*$hr:.0f}')") compute + \$$(python3 -c "print(f'{$DISK*0.08:.0f}')") storage = \$$(python3 -c "print(f'{34.7*$hr+$DISK*0.08:.0f}')")
    running 20 h/week   \$$(python3 -c "print(f'{86.6*$hr:.0f}')") compute + \$$(python3 -c "print(f'{$DISK*0.08:.0f}')") storage = \$$(python3 -c "print(f'{86.6*$hr+$DISK*0.08:.0f}')")
    left running 24 h   \$$(python3 -c "print(f'{24*$hr:.0f}')") for that one day
    stopped             \$$(python3 -c "print(f'{$DISK*0.08:.0f}')")/month, storage only

  To create it:  $0 --confirm
PLAN
}

case "${1:-}" in
  --confirm) : ;;
  --status)    $AWS ec2 describe-instances --filters "Name=tag:Name,Values=$NAME" \
                 --query 'Reservations[].Instances[].{id:InstanceId,state:State.Name,type:InstanceType,ip:PublicIpAddress}' --output table; exit 0;;
  --stop)      $AWS ec2 stop-instances  --instance-ids "$($AWS ec2 describe-instances --filters "Name=tag:Name,Values=$NAME" "Name=instance-state-name,Values=running" --query 'Reservations[0].Instances[0].InstanceId' --output text)"; exit 0;;
  --start)     $AWS ec2 start-instances --instance-ids "$($AWS ec2 describe-instances --filters "Name=tag:Name,Values=$NAME" --query 'Reservations[0].Instances[0].InstanceId' --output text)"; exit 0;;
  --terminate) $AWS ec2 terminate-instances --instance-ids "$($AWS ec2 describe-instances --filters "Name=tag:Name,Values=$NAME" --query 'Reservations[0].Instances[0].InstanceId' --output text)"; exit 0;;
  *) plan; exit 0;;
esac

echo "Creating. This incurs charges."
MYIP=$(curl -fsS https://checkip.amazonaws.com | tr -d '\n')
AMI=$($AWS ssm get-parameters --names /aws/service/ami-windows-latest/Windows_Server-2022-English-Full-Base --query 'Parameters[0].Value' --output text)

# instance role: read the free NVIDIA driver + DCV licence buckets, and SSM
$AWS iam create-role --role-name ${NAME}-role --assume-role-policy-document \
  '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null 2>&1 || true
$AWS iam attach-role-policy --role-name ${NAME}-role --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore >/dev/null 2>&1 || true
$AWS iam attach-role-policy --role-name ${NAME}-role --policy-arn arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess >/dev/null 2>&1 || true
$AWS iam create-instance-profile --instance-profile-name ${NAME}-profile >/dev/null 2>&1 || true
$AWS iam add-role-to-instance-profile --instance-profile-name ${NAME}-profile --role-name ${NAME}-role >/dev/null 2>&1 || true

SG=$($AWS ec2 create-security-group --group-name ${NAME}-sg --description "Wonderland Aura workstation: DCV only" --query GroupId --output text 2>/dev/null \
     || $AWS ec2 describe-security-groups --group-names ${NAME}-sg --query 'SecurityGroups[0].GroupId' --output text)
$AWS ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 8443 --cidr "${MYIP}/32" >/dev/null 2>&1 || true
$AWS ec2 authorize-security-group-ingress --group-id "$SG" --protocol udp --port 8443 --cidr "${MYIP}/32" >/dev/null 2>&1 || true

$AWS ec2 run-instances \
  --image-id "$AMI" --instance-type "$TYPE" \
  --iam-instance-profile Name=${NAME}-profile \
  --security-group-ids "$SG" \
  --block-device-mappings "[{\"DeviceName\":\"/dev/sda1\",\"Ebs\":{\"VolumeSize\":${DISK},\"VolumeType\":\"gp3\",\"DeleteOnTermination\":true}}]" \
  --metadata-options "HttpTokens=required,HttpEndpoint=enabled" \
  --user-data "file://${HERE}/bootstrap.ps1" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME},{Key=Project,Value=wonderland}]" \
  --query 'Instances[0].InstanceId' --output text
echo "Created. Bootstrap takes ~20 min. Then: $0 --status for the IP, and open https://<ip>:8443"
