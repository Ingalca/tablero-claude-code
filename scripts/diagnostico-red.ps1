# Diagnostico de red para tablero-claude: por que otra PC no encuentra a esta por nombre (o no le llega).
# Sin parametros solo muestra; no cambia nada.
#   powershell -ExecutionPolicy Bypass -File scripts\diagnostico-red.ps1
# Con -Arreglar (PowerShell como administrador) activa, solo para redes privadas, las reglas de Windows
# para que la PC responda por nombre (deteccion de redes) y al ping.
#   powershell -ExecutionPolicy Bypass -File scripts\diagnostico-red.ps1 -Arreglar
param([switch]$Arreglar)
$ErrorActionPreference = 'Continue'

function Titulo($t) { Write-Host ''; Write-Host "== $t" -ForegroundColor Cyan }
function Bien($t) { Write-Host "  [ok] $t" -ForegroundColor Green }
function Mal($t) { Write-Host "  [!!] $t" -ForegroundColor Yellow }

# Grupos de reglas por su identificador interno: no depende del idioma de Windows.
$GRUPO_DETECCION = '@FirewallAPI.dll,-32752'   # Deteccion de redes
$GRUPO_MDNS = '@%SystemRoot%\system32\firewallapi.dll,-37302'

Titulo "Esta PC: $(hostname)"
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.PrefixOrigin -ne 'WellKnown' -and $_.InterfaceAlias -notlike 'vEthernet*' } |
  ForEach-Object { Write-Host "  $($_.InterfaceAlias): $($_.IPAddress)/$($_.PrefixLength)" }

Titulo 'Perfil de red'
foreach ($red in Get-NetConnectionProfile) {
  if ($red.NetworkCategory -eq 'Public') { Mal "$($red.InterfaceAlias) - '$($red.Name)': Publica. Tiene que ser Privada." }
  else { Bien "$($red.InterfaceAlias) - '$($red.Name)': $($red.NetworkCategory)" }
}

Titulo 'Firewall de Windows'
foreach ($p in Get-NetFirewallProfile) { Write-Host "  perfil $($p.Name): $(if ($p.Enabled) { 'activo' } else { 'apagado' })" }

Titulo 'Reglas para responder por nombre (deteccion de redes, perfil Privado)'
$reglas = @(Get-NetFirewallRule -Group $GRUPO_DETECCION -Direction Inbound -ErrorAction SilentlyContinue) + @(Get-NetFirewallRule -Group $GRUPO_MDNS -Direction Inbound -ErrorAction SilentlyContinue)
$privadas = $reglas | Where-Object { $_.Profile -match 'Private|Any' }
$clave = $privadas | Where-Object { $_.Name -match 'NB_Name|LLMNR|mDNS|NB_Datagram' }
foreach ($r in $clave) {
  if ($r.Enabled -eq 'True') { Bien "$($r.DisplayName)" } else { Mal "$($r.DisplayName): desactivada" }
}
if (-not $clave) { Mal 'No encontre las reglas de deteccion de redes.' }

Titulo 'Responder al ping (perfil Privado)'
$ping = Get-NetFirewallRule -Direction Inbound -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'FPS-ICMP4-ERQ-In*' -and $_.Profile -match 'Private|Any' }
if ($ping | Where-Object Enabled -eq 'True') { Bien 'activado' } else { Mal 'desactivado (no es necesario para el tablero, pero ayuda a diagnosticar)' }

Titulo 'Resolucion de nombres'
$pol = Get-ItemProperty 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\DNSClient' -ErrorAction SilentlyContinue
if ($pol -and $pol.EnableMulticast -eq 0) { Mal 'LLMNR desactivado por politica' } else { Bien 'LLMNR permitido' }
foreach ($a in Get-CimInstance Win32_NetworkAdapterConfiguration -Filter 'IPEnabled=true') {
  $nb = @{ 0 = 'segun el router'; 1 = 'activado'; 2 = 'DESACTIVADO' }[[int]$a.TcpipNetbiosOptions]
  $linea = "NetBIOS en '$($a.Description)': $nb"
  if ($a.TcpipNetbiosOptions -eq 2) { Mal $linea } else { Bien $linea }
}
foreach ($s in 'FDResPub', 'fdPHost', 'Dnscache') {
  $svc = Get-Service $s -ErrorAction SilentlyContinue
  if ($svc -and $svc.Status -eq 'Running') { Bien "servicio $($svc.DisplayName): corriendo" } elseif ($svc) { Mal "servicio $($svc.DisplayName): $($svc.Status)" }
}

Titulo 'Antivirus o firewall de terceros'
$fw = Get-CimInstance -Namespace root/SecurityCenter2 -ClassName FirewallProduct -ErrorAction SilentlyContinue
$av = Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction SilentlyContinue
if ($fw) { $fw | ForEach-Object { Mal "firewall de terceros: $($_.displayName). Puede bloquear aunque Windows este bien configurado." } } else { Bien 'sin firewall de terceros' }
$av | Where-Object { $_.displayName -notlike '*Defender*' } | ForEach-Object { Write-Host "  antivirus: $($_.displayName)" }

Titulo 'node.exe abierto en redes publicas'
# El aviso del firewall que aparece la primera vez que Node escucha en la red crea reglas por programa:
# si se acepta para redes publicas, cualquier servidor de Node queda abierto en un Wi-Fi publico, en
# cualquier puerto. El tablero no las necesita: abrir-red.ps1 abre solo su puerto.
$nodePublico = Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue | Where-Object Program -like '*node.exe' |
  Get-NetFirewallRule | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' -and $_.Enabled -eq 'True' -and $_.Profile -match 'Public|Any' }
if ($nodePublico) {
  Mal "$(@($nodePublico).Count) reglas dejan entrar a node.exe desde redes publicas, en cualquier puerto."
  Write-Host '  Si no las necesitas para otro proyecto, se desactivan (PowerShell como administrador) con:'
  Write-Host "  Get-NetFirewallApplicationFilter | Where-Object Program -like '*node.exe' | Get-NetFirewallRule | Where-Object { `$_.Direction -eq 'Inbound' -and `$_.Profile -match 'Public|Any' } | Disable-NetFirewallRule"
} else { Bien 'ninguna' }

Titulo 'Puerto del tablero'
$propias = Get-NetFirewallRule -DisplayName 'tablero-claude-code*' -ErrorAction SilentlyContinue
if ($propias) { $propias | ForEach-Object { Bien "$($_.DisplayName): $(if ($_.Enabled -eq 'True') { 'activa' } else { 'desactivada' })" } } else { Mal 'falta abrir-red.ps1' }
$escucha = Get-NetTCPConnection -LocalPort 4590 -State Listen -ErrorAction SilentlyContinue
if ($escucha) { Bien "el agente escucha en $(($escucha.LocalAddress | Sort-Object -Unique) -join ', '):4590" } else { Mal 'el agente no esta escuchando en el puerto 4590' }

if ($Arreglar) {
  Titulo 'Arreglando'
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Para -Arreglar hace falta PowerShell como administrador.' }
  $privadas | Where-Object Enabled -ne 'True' | Enable-NetFirewallRule
  $ping | Where-Object Enabled -ne 'True' | Enable-NetFirewallRule
  foreach ($s in 'FDResPub', 'fdPHost') { Set-Service $s -StartupType Automatic -ErrorAction SilentlyContinue; Start-Service $s -ErrorAction SilentlyContinue }
  Bien 'reglas de deteccion de redes y ping activadas para redes privadas; servicios de descubrimiento en marcha'
  Write-Host '  Volver a correr el diagnostico sin -Arreglar para ver como quedo.'
}
