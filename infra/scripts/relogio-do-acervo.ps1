# Cria (ou recria) a tarefa agendada "Radinho relogio do acervo" neste PC:
# roda infra/scripts/relogio-do-acervo.cmd no logon do usuário, em prioridade
# baixa, sem limite de tempo, e religa se cair. Rodar uma vez:
#   powershell -NoProfile -ExecutionPolicy Bypass -File infra/scripts/relogio-do-acervo.ps1
# Para parar: schtasks /End /TN "Radinho relogio do acervo"; para remover: /Delete.
$ErrorActionPreference = 'Stop'
$nome = 'Radinho relogio do acervo'
$cmd = Join-Path $PSScriptRoot 'relogio-do-acervo.cmd'
$acao = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$cmd`""
$gatilho = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$config = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 5) `
  -MultipleInstances IgnoreNew -StartWhenAvailable -Priority 9 `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Unregister-ScheduledTask -TaskName $nome -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $nome -Action $acao -Trigger $gatilho -Settings $config `
  -Description 'Alinha a letra ao audio das faixas do acervo e publica na borda do GitHub (apps/importer/relogioDoAcervo.mjs).' | Out-Null
Start-ScheduledTask -TaskName $nome
Write-Host "tarefa '$nome' criada e iniciada"
