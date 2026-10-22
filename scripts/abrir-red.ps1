# Abre el puerto del agente en el firewall de Windows, para que las otras PCs consulten esta.
# Requiere PowerShell como administrador.
#   powershell -ExecutionPolicy Bypass -File scripts\abrir-red.ps1           abre
#   powershell -ExecutionPolicy Bypass -File scripts\abrir-red.ps1 -Quitar   cierra
#
# Dos reglas, para no abrir de mas:
#   - red local: solo con perfil Privada o Dominio (en un Wi-Fi publico, nadie de ese Wi-Fi entra);
#   - Tailscale: solo desde sus direcciones (100.64.0.0/10), en cualquier perfil, porque Windows
#     suele marcar la red de Tailscale como publica.
# Ademas el agente exige el token y rechaza todo lo que no sea red privada o Tailscale.
param([switch]$Quitar)
$ErrorActionPreference = 'Stop'

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Hace falta abrir PowerShell como administrador.'
}

$prefijo = 'tablero-claude-code'
Get-NetFirewallRule -DisplayName "$prefijo*" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
if ($Quitar) { Write-Host 'Listo: reglas quitadas.'; return }

$raiz = Split-Path -Parent $PSScriptRoot
$puerto = 4590
$rutaCfg = Join-Path $raiz 'config.json'
if (Test-Path $rutaCfg) {
  $cfg = Get-Content $rutaCfg -Raw | ConvertFrom-Json
  if ($cfg.puerto) { $puerto = $cfg.puerto }
}

New-NetFirewallRule -DisplayName "$prefijo (red local)" -Direction Inbound -Action Allow -Protocol TCP `
  -LocalPort $puerto -Profile Private, Domain -RemoteAddress LocalSubnet | Out-Null
New-NetFirewallRule -DisplayName "$prefijo (Tailscale)" -Direction Inbound -Action Allow -Protocol TCP `
  -LocalPort $puerto -Profile Any -RemoteAddress '100.64.0.0/10' | Out-Null
Write-Host "Listo: puerto $puerto abierto para la red local (perfil Privada) y para Tailscale."

foreach ($red in Get-NetConnectionProfile) {
  if ($red.NetworkCategory -eq 'Public' -and $red.InterfaceAlias -notlike '*Tailscale*') {
    Write-Warning "La red '$($red.Name)' ($($red.InterfaceAlias)) esta como Publica: por ahi no va a funcionar. Cambiala a Privada en Configuracion > Red e Internet."
  }
}
