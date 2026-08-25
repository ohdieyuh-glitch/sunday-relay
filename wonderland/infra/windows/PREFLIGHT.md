# Preflight: what blocked the launch, and the two things only you can do

Run against account **503718465749**, IAM user `relay-wonderland-builder`,
region us-west-2, on 2026-08-25. **Nothing was created and nothing was
charged.** The launch script refused before `run-instances` because the
account cannot run a GPU instance and this user cannot fix that itself.

## What was probed

| check | result |
|---|---|
| credentials valid | **yes** — `relay-wonderland-builder` |
| `g6.2xlarge` offered in us-west-2 | **yes** — 2a, 2b, 2c, 2d |
| **Running On-Demand G and VT instances** quota | **0.0 vCPU** — needs ≥ 8 |
| Running On-Demand P instances | 0.0 |
| Standard (A/C/D/H/I/M/R/T/Z) quota | 16.0 — non-GPU only |
| `ec2:DescribeInstances`, `DescribeSecurityGroups` | allow |
| `ssm:GetParameters` (resolve the Windows AMI) | **deny** |
| `iam:ListRoles` / create role + instance profile | **deny** |
| `servicequotas:RequestServiceQuotaIncrease` | **deny** |

A G-instance quota of 0 is normal for an account that has never launched one.
`g6.2xlarge` is 8 vCPU, so `run-instances` would have failed with
`VcpuLimitExceeded` — which is why the script checks first rather than
discovering it halfway through creating a security group and an IAM role.

## The two founder actions

### 1. Raise the GPU quota (free; minutes to ~24 h for AWS to approve)

Console → **Service Quotas → AWS services → Amazon EC2 → "Running On-Demand G
and VT instances" → Request increase at account level → 8** (or 16 if you want
room to re-type to `g6e.2xlarge` later — same 8 vCPU, but 16 leaves headroom
for a second box).

Direct link:
https://us-west-2.console.aws.amazon.com/servicequotas/home/services/ec2/quotas/L-DB2E81BA

AWS often auto-approves small GPU increases; occasionally a human reviews it.
Nothing is charged by asking.

### 2. Let this IAM user do the rest

`iam-policy-workstation.json` in this directory is the least-privilege policy
covering exactly what `launch-workstation.sh` does and nothing more: resolve
the Windows AMI, run/stop/start/terminate the instance, create one security
group, create *one named* role and instance profile (scoped by ARN — it cannot
touch any other role), request the quota itself next time, and use SSM Session
Manager as break-glass so port 3389 never opens.

Console → **IAM → Users → relay-wonderland-builder → Add permissions → Create
inline policy → JSON** → paste the file → name it
`wonderland-workstation`.

Direct link:
https://us-east-1.console.aws.amazon.com/iam/home#/users/relay-wonderland-builder

If you would rather not widen this user, the alternative is a second access key
for a user that already has these rights, dropped into `~/.aws/credentials`
under a profile name — tell me the profile name and I will use it.

## Then

    export AWS_PROFILE=relay-wonderland
    aws service-quotas get-service-quota --service-code ec2 \
      --quota-code L-DB2E81BA --region us-west-2 --query 'Quota.Value'

When that prints 8 or more, `./launch-workstation.sh --confirm` runs unattended
and the next thing that needs you is the Epic Launcher sign-in in the browser
desktop.

## Why not just use a non-GPU instance

The workstation exists to run the Unreal editor interactively with Aura in it.
Without a GPU there is no editor viewport worth looking at, no Lumen/Nanite,
and no point — the Linux Lightning farm already does everything that does not
need a screen.
