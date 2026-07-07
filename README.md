# metahuman-gpu-dcv-trial

A CDK stack that spins up a remote workstation to **briefly try MetaHuman / Unreal Engine / Live Link Face on an AWS GPU instance**.

The everyday setup work (downloading/installing Unreal and MetaHuman assets) needs no GPU, so it **boots on a cheap `t3.large` by default** and you **switch to `g5.xlarge` only when you actually need to render**. The root EBS volume is preserved across instance-type changes, so your setup stays intact.

> ⚠️ **Cost first**
> - A GPU (`g5.xlarge`) costs **about $1.4–1.5/h while running**.
> - Even while stopped, the EBS volume (gp3 200GB) costs **~$7–8/month**. Run `cdk destroy` to remove it entirely.
> - Auto-stop is **not** included in this CDK. Stopping is expected to be handled by an external mechanism (e.g. a LINE reminder). Always run `scripts/stop.sh` when done.

---

## Architecture

```
[Local PC: DCV client/browser] ──NICE DCV (8443 TCP/UDP, your IP only)──▶ EC2 (Windows Server 2022)
[iPhone: Live Link Face]       ──(same network)──────────────────────────▶  default t3.large (no GPU / setup)
                                                                            switch g5.xlarge (A10G 24GB / render)
Network: new VPC / no NAT / public subnet / no EIP (zero idle charges while stopped)
```

- No cost-safety devices (auto-stop, budgets) are included — that is delegated to external operation.
- NVIDIA driver and NICE DCV are installed via UserData (PowerShell). The driver is installed automatically the first time you switch to a GPU instance type.

## Prerequisites

- AWS CLI / credentials (`.env` is fine), Node.js, `pnpm`
- An existing key pair (needed to decrypt the Windows Administrator password)

## Setup

```bash
git clone https://github.com/furuya02/metahuman-gpu-dcv-trial.git
cd metahuman-gpu-dcv-trial/cdk
pnpm install

# first time only
pnpm cdk bootstrap

# create a key pair if you don't have one
aws ec2 create-key-pair --key-name metahuman-key \
  --query KeyMaterial --output text > ~/.ssh/metahuman-key.pem

# deploy (allowed_ip and key_name are required)
pnpm cdk deploy \
  -c allowed_ip=$(curl -s https://checkip.amazonaws.com)/32 \
  -c key_name=metahuman-key
```

### Context parameters

| Key | Required | Default | Purpose |
|---|---|---|---|
| `allowed_ip` | Yes | none | Your IP allowed for DCV/RDP (e.g. `203.0.113.10/32`) |
| `key_name` | Yes | none | Existing key pair for Administrator password decryption |
| `suffix` | - | Account ID | Resource name suffix |
| `instance_type` | - | `t3.large` | Boot type (use t3 for setup, switch to GPU via switch-type.sh) |
| `volume_gb` | - | `200` | Root EBS size (GB) |

## Usage

```bash
cd metahuman-gpu-dcv-trial

# start / stop
scripts/start.sh
scripts/stop.sh                 # always, when done

# show connection info (public IP changes on each start)
scripts/connect-info.sh

# switch to a GPU type when needed (stop -> modify -> start; EBS preserved)
scripts/switch-type.sh g5.xlarge
# switch back for setup work
scripts/switch-type.sh t3.large
```

### Connect (NICE DCV)

1. Get `https://<IP>:8443` from `scripts/connect-info.sh`
2. Connect with the NICE DCV client (or a browser)
3. User `Administrator`; get the password from EC2 console > instance > Connect > RDP client > Get password (using your key pair .pem)

### MetaHuman / Unreal / Live Link Face (manual)

This template provides the GPU environment and connectivity. Do the following manually after connecting:

- Epic Games Launcher → install Unreal Engine
- MetaHuman plugin / Quixel Bridge → fetch MetaHuman assets
- iPhone Live Link Face app → connect to Unreal's Live Link on the same network

> Heavy downloads/installs need no GPU, so do them on `t3.large` and switch to `g5.xlarge` only for rendering to save cost.

## Cleanup

```bash
scripts/stop.sh                 # pause (EBS charges remain)
cd cdk && pnpm cdk destroy      # full removal (EBS deleted too)
```

## Notes

- OS is Windows Server 2022. Linux is out of scope (Epic Games Launcher / MetaHuman asset acquisition assume Windows/Mac).
- Keep instance types within x86 (g5 is x86_64; Graviton/ARM t4g/c7g are not compatible).

## Troubleshooting / Manual Fallback

The UserData (PowerShell) auto-installation may fail depending on the environment at first boot. If you cannot connect via DCV or `nvidia-smi` is not found, install manually. Log in as Administrator via RDP (port 3389) and open PowerShell (as Administrator).

### NICE DCV not running

```powershell
# check if already installed
Test-Path 'C:\Program Files\NICE\DCV\Server\bin\dcv.exe'
# if False, install manually

Invoke-WebRequest `
  -Uri https://d1uj6qtbmh3dt5.cloudfront.net/nice-dcv-server-x64-Release.msi `
  -OutFile C:\dcv.msi
Start-Process msiexec.exe `
  -ArgumentList '/i C:\dcv.msi /quiet /norestart ADDLOCAL=ALL' -Wait

# verify a console session exists (after dcvserver service starts)
& 'C:\Program Files\NICE\DCV\Server\bin\dcv.exe' list-sessions
# "console" should appear
```

Reboot if the service does not start after installation.

```powershell
Restart-Computer -Force
```

### NVIDIA driver not installed (GPU instances only)

```powershell
# check GPU detection (should show NVIDIA on g5)
Get-WmiObject Win32_VideoController | Select-Object Name

# check nvidia-smi
Test-Path 'C:\Windows\System32\nvidia-smi.exe'
# if False, install manually

New-Item -ItemType Directory -Force -Path C:\nvidia | Out-Null
aws s3 cp --recursive s3://ec2-windows-nvidia-drivers/latest/ C:\nvidia\

$exe = Get-ChildItem C:\nvidia -Filter *.exe -Recurse | Select-Object -First 1
Start-Process -FilePath $exe.FullName -ArgumentList '-s -noreboot' -Wait
Restart-Computer -Force
```

After reboot, run `nvidia-smi` to confirm the GPU is recognized.
