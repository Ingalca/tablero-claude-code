# Detiene el agente y saca el arranque automatico.
# Con -SoloDetener lo detiene pero deja el lanzador en Inicio (lo usa instalar-inicio.ps1).
param([switch]$SoloDetener)

$raiz = Split-Path -Parent $PSScriptRoot
$agente = Join-Path $raiz 'agente.js'
$vbs = Join-Path ([Environment]::GetFolderPath('Startup')) 'tablero-claude.vbs'

# Primero el lanzador, para que no reinicie al agente.
Get-CimInstance Win32_Process -Filter "Name = 'wscript.exe'" |
  Where-Object { $_.CommandLine -like '*tablero-claude.vbs*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false }
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like "*$agente*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false }

if (-not $SoloDetener) {
  if (Test-Path $vbs) { Remove-Item $vbs -Confirm:$false }
  Write-Host 'Listo: agente detenido y arranque automatico quitado.'
}
