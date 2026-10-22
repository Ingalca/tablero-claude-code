# Hace que el agente arranque solo al iniciar sesion en Windows, sin ventana, y lo arranca ahora.
# Deja un lanzador .vbs en la carpeta Inicio del usuario: no hace falta ser administrador.
# Si el agente se cae, el lanzador lo reinicia a los 10 s (salvo que el puerto este ocupado).
$ErrorActionPreference = 'Stop'

$raiz = Split-Path -Parent $PSScriptRoot
$agente = Join-Path $raiz 'agente.js'
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'No encuentro node en el PATH. Instalar Node.js 20 o superior.' }

# Crea config.json con un token nuevo si todavia no existe.
& $node -e "require(process.argv[1]).cargar()" (Join-Path $raiz 'src\config.js')
if ($LASTEXITCODE -ne 0) { throw 'config.json invalido: ver el error de arriba.' }

$inicio = [Environment]::GetFolderPath('Startup')
$vbs = Join-Path $inicio 'tablero-claude.vbs'

$contenido = @"
' Lanzador del agente de tablero-claude. Lo genera scripts\instalar-inicio.ps1; se borra con quitar-inicio.ps1.
Set sh = CreateObject("WScript.Shell")
Do
  codigo = sh.Run("""$node"" ""$agente""", 0, True)
  If codigo = 3 Then Exit Do
  WScript.Sleep 10000
Loop
"@
Set-Content -Path $vbs -Value $contenido -Encoding ASCII

& (Join-Path $PSScriptRoot 'quitar-inicio.ps1') -SoloDetener
Start-Process wscript.exe -ArgumentList "`"$vbs`""

Start-Sleep -Seconds 3
$cfg = Get-Content (Join-Path $raiz 'config.json') -Raw | ConvertFrom-Json
Write-Host "Listo: el agente arranca al iniciar sesion ($vbs)."
Write-Host "Escucha en $($cfg.host):$($cfg.puerto). Log: $(Join-Path $raiz 'datos\agente.log')"
