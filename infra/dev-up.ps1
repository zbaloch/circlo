# Bring up the Halqo dev stack from Windows: runs infra/dev-up.sh inside Debian WSL, then keeps
# the WSL VM awake (WSL shuts the VM down shortly after the last WSL process exits, which stops MinIO).
# Usage:  .\infra\dev-up.ps1          Stop keep-alive:  .\infra\dev-up.ps1 -Stop
param([switch]$Stop)

$ErrorActionPreference = 'Stop'
$distro = 'Debian'
$marker = 'halqo-keepalive'

function Get-KeepAlive {
    Get-CimInstance Win32_Process -Filter "Name = 'wsl.exe'" |
        Where-Object { $_.CommandLine -like "*$marker*" }
}

if ($Stop) {
    Get-KeepAlive | ForEach-Object { Stop-Process -Id $_.ProcessId -Confirm:$false }
    Write-Host 'WSL keep-alive stopped.'
    return
}

$script = (& wsl.exe -d $distro -- wslpath -a ($PSScriptRoot -replace '\\', '/')).Trim() + '/dev-up.sh'
& wsl.exe -d $distro -- bash $script
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not (Get-KeepAlive)) {
    Start-Process -WindowStyle Hidden -FilePath wsl.exe -ArgumentList '-d', $distro, '--', 'bash', '-c', "exec -a $marker sleep infinity"
    Write-Host 'WSL keep-alive started (stop it with .\infra\dev-up.ps1 -Stop).'
}
