# Muestreo de actividad para el agente de tablero-claude: cada 15 s imprime una linea JSON con
# los segundos sin teclado ni mouse y la ventana al frente. Lo lanza y lo lee src/actividad.js.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class Actividad {
  [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO p);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static uint SegundosInactivo() {
    var i = new LASTINPUTINFO();
    i.cbSize = (uint)Marshal.SizeOf(i);
    GetLastInputInfo(ref i);
    return unchecked((uint)Environment.TickCount - i.dwTime) / 1000;
  }
  public static string Ventana(out uint pid) {
    var h = GetForegroundWindow();
    var s = new StringBuilder(512);
    GetWindowText(h, s, 512);
    GetWindowThreadProcessId(h, out pid);
    return s.ToString();
  }
}
"@

while ($true) {
  $idProceso = [uint32]0
  $titulo = [Actividad]::Ventana([ref]$idProceso)
  $proceso = $null
  try { $proceso = (Get-Process -Id $idProceso -ErrorAction Stop).ProcessName } catch {}
  $linea = @{ idle = [Actividad]::SegundosInactivo(); titulo = $titulo; proceso = $proceso } | ConvertTo-Json -Compress
  [Console]::Out.WriteLine($linea)
  [Console]::Out.Flush()
  Start-Sleep -Seconds 15
}
