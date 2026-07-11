<#
.SYNOPSIS
  Aurial — set up SSH key auth from this Windows machine to the LAN server.

.DESCRIPTION
  1. Generates an ed25519 key pair if one does not exist yet.
  2. Copies the public key to the server (ssh-copy-id equivalent — you will
     type the server password ONCE; it is never stored anywhere).
  3. Verifies key-based login works and prints how to disable password auth.

  Compatible with Windows PowerShell 5.1. Requires the "OpenSSH Client"
  optional feature (Settings > Apps > Optional Features) — Windows 10/11
  usually ship it enabled.

.EXAMPLE
  .\infra\scripts\setup-ssh-key.ps1
  .\infra\scripts\setup-ssh-key.ps1 -DeployHost 192.168.0.100 -DeployUser v
#>
[CmdletBinding()]
param(
    [string]$DeployHost = $(if ($env:DEPLOY_HOST) { $env:DEPLOY_HOST } else { '192.168.0.100' }),
    [string]$DeployUser = $(if ($env:DEPLOY_USER) { $env:DEPLOY_USER } else { 'v' }),
    [string]$KeyPath = "$env:USERPROFILE\.ssh\id_ed25519"
)

$ErrorActionPreference = 'Stop'

function Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Green
}

# ── 0. Preflight ───────────────────────────────────────────────
if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
    Write-Host 'error: ssh.exe not found. Install the "OpenSSH Client" optional feature:' -ForegroundColor Red
    Write-Host '       Settings > Apps > Optional Features > Add a feature > OpenSSH Client'
    exit 1
}

$sshDir = Split-Path $KeyPath -Parent
if (-not (Test-Path $sshDir)) {
    New-Item -ItemType Directory -Path $sshDir | Out-Null
}

# ── 1. Generate key if missing ─────────────────────────────────
Step "SSH key ($KeyPath)"
if (Test-Path $KeyPath) {
    Write-Host 'Key already exists - reusing it.'
} else {
    Write-Host 'Generating a new ed25519 key. A passphrase is optional but recommended.'
    ssh-keygen -t ed25519 -f $KeyPath -C "aurial-$env:USERNAME@$env:COMPUTERNAME"
    if ($LASTEXITCODE -ne 0) { throw 'ssh-keygen failed.' }
}

$pubKeyPath = "$KeyPath.pub"
if (-not (Test-Path $pubKeyPath)) { throw "Public key not found: $pubKeyPath" }

# ── 2. Copy the public key to the server (ssh-copy-id equivalent) ──
Step "Installing the public key on $DeployUser@$DeployHost"
Write-Host 'You will be asked for the SERVER password once (nothing is stored).'
# Remote side is bash: append the key, fix permissions, dedupe.
$remote = 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && sort -u -o ~/.ssh/authorized_keys ~/.ssh/authorized_keys && echo key-installed'
Get-Content $pubKeyPath | ssh "$DeployUser@$DeployHost" $remote
if ($LASTEXITCODE -ne 0) { throw 'Failed to install the key on the server.' }

# ── 3. Verify key-based login ──────────────────────────────────
Step 'Verifying key-based login (no password should be asked)'
ssh -o PasswordAuthentication=no -o BatchMode=yes -i $KeyPath "$DeployUser@$DeployHost" 'echo ok: key login works on $(hostname)'
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Key login failed - keep using password auth and re-run this script.' -ForegroundColor Yellow
    exit 1
}

# ── 4. Hardening hint (manual, on purpose) ─────────────────────
Step 'Done. Recommended: disable password auth on the server'
Write-Host @"
Only AFTER confirming the key works (it just did), run on the server:

  ssh $DeployUser@$DeployHost
  sudo nano /etc/ssh/sshd_config     # set:  PasswordAuthentication no
  sudo systemctl restart ssh

Keep this terminal open while testing a second login - if you lock
yourself out, revert the change from the still-open session.
"@
