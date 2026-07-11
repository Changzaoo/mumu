<#
.SYNOPSIS
  Aurial — trigger a server deploy from the Windows dev machine.

.DESCRIPTION
  SSHes into the LAN server and runs infra/scripts/deploy-api.sh there.
  The server pulls the latest commit from git — push your changes first.

  Host/user/path resolution order:
    1. -DeployHost / -DeployUser / -DeployPath parameters
    2. DEPLOY_HOST / DEPLOY_USER / DEPLOY_PATH environment variables
    3. the repo root .env file (same keys)
    4. defaults from .env.example (192.168.0.100 / v / /opt/aurial)

  Uses your SSH key if configured (run setup-ssh-key.ps1 once), otherwise
  ssh will prompt for the password interactively — never stored.

.EXAMPLE
  .\infra\scripts\deploy-from-windows.ps1
  .\infra\scripts\deploy-from-windows.ps1 -DeployHost 192.168.0.100 -DeployUser v
#>
[CmdletBinding()]
param(
    [string]$DeployHost,
    [string]$DeployUser,
    [string]$DeployPath
)

$ErrorActionPreference = 'Stop'

# ── Resolve settings: param > env > repo .env > default ────────
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$dotEnv = @{}
$dotEnvPath = Join-Path $repoRoot '.env'
if (Test-Path $dotEnvPath) {
    foreach ($line in Get-Content $dotEnvPath) {
        if ($line -match '^\s*(DEPLOY_[A-Z_]+)\s*=\s*(.+?)\s*$') {
            $dotEnv[$Matches[1]] = $Matches[2].Trim('"')
        }
    }
}

function Resolve-Setting([string]$Param, [string]$EnvName, [string]$Default) {
    if ($Param) { return $Param }
    $fromEnv = [Environment]::GetEnvironmentVariable($EnvName)
    if ($fromEnv) { return $fromEnv }
    if ($dotEnv.ContainsKey($EnvName)) { return $dotEnv[$EnvName] }
    return $Default
}

$DeployHost = Resolve-Setting $DeployHost 'DEPLOY_HOST' '192.168.0.100'
$DeployUser = Resolve-Setting $DeployUser 'DEPLOY_USER' 'v'
$DeployPath = Resolve-Setting $DeployPath 'DEPLOY_PATH' '/opt/aurial'

if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
    Write-Host 'error: ssh.exe not found. Install the "OpenSSH Client" optional feature.' -ForegroundColor Red
    exit 1
}

Write-Host "==> Deploying Aurial API on $DeployUser@$DeployHost ($DeployPath)" -ForegroundColor Green
Write-Host '    (the server deploys the latest pushed commit - did you git push?)'
Write-Host ''

# -t: allocate a tty so the colored step output of deploy-api.sh streams back.
ssh -t "$DeployUser@$DeployHost" "cd '$DeployPath' && ./infra/scripts/deploy-api.sh"
$code = $LASTEXITCODE

if ($code -ne 0) {
    Write-Host ''
    Write-Host "Deploy failed (exit $code). Inspect on the server:" -ForegroundColor Red
    Write-Host "  ssh $DeployUser@$DeployHost"
    Write-Host "  cd $DeployPath && docker compose -f infra/docker/docker-compose.prod.yml logs --tail 100 api worker"
    exit $code
}

Write-Host ''
Write-Host '==> Deploy finished successfully.' -ForegroundColor Green
