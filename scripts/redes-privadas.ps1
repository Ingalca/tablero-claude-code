# Pasa a Privada todos los perfiles de red guardados con un nombre, no solo el actual.
# Hace falta con repetidoras o redes mesh: Windows crea un perfil nuevo ("Mi red 2", "Mi red 3"...)
# cada vez que entra por un equipo distinto, y cada perfil nuevo arranca como Publica.
# Requiere PowerShell como administrador.
#   powershell -ExecutionPolicy Bypass -File scripts\redes-privadas.ps1                    lista los perfiles
#   powershell -ExecutionPolicy Bypass -File scripts\redes-privadas.ps1 -Nombre "Mi red"   pasa "Mi red*" a Privada
param([string]$Nombre)
$ErrorActionPreference = 'Stop'

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Hace falta abrir PowerShell como administrador.'
}

$categorias = @{ 0 = 'Publica'; 1 = 'Privada'; 2 = 'Dominio' }
$raiz = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\NetworkList\Profiles'
$perfiles = Get-ChildItem $raiz | ForEach-Object { [pscustomobject]@{ Ruta = $_.PSPath; Nombre = (Get-ItemProperty $_.PSPath).ProfileName; Categoria = (Get-ItemProperty $_.PSPath).Category } }

if (-not $Nombre) {
  $perfiles | Sort-Object Nombre | Format-Table @{ n = 'Perfil'; e = { $_.Nombre } }, @{ n = 'Tipo'; e = { $categorias[[int]$_.Categoria] } } -AutoSize
  Write-Host 'Para pasar a Privada todos los de una red: -Nombre "<nombre de la red>"'
  return
}

$cambiados = 0
foreach ($p in $perfiles | Where-Object { $_.Nombre -like "$Nombre*" }) {
  if ($p.Categoria -ne 1) {
    Set-ItemProperty $p.Ruta -Name Category -Value 1
    $cambiados++
  }
  Write-Host "  $($p.Nombre): Privada"
}
Write-Host "Listo: $cambiados perfiles cambiados a Privada."
Write-Host 'Si Windows crea otro perfil para esa red mas adelante, va a arrancar como Publica: correr esto de nuevo.'
