# Ayudante de ventanas para el agente de tablero-claude. Lee pedidos por stdin, uno por linea,
# con los campos separados por tabulador, y contesta una linea:
#   carpeta <TAB> <nombre>            activa la ventana de VS Code de esa carpeta
#                                     -> ok | sin-foco | no-encontrada
#   terminal <TAB> <pid> <TAB> <titulo>  activa la ventana de la terminal donde corre ese proceso
#                                     -> ok | sin-foco | no-encontrada | ambigua
#   anfitrion <TAB> <pid>             que programa muestra esa terminal
#                                     -> WindowsTerminal | mintty | conhost | Code | (vacio)
#
# Activar: Windows no deja que un proceso en segundo plano le quite el foco a la aplicacion que se
# esta usando. El permiso lo tiene quien recibio el ultimo evento de entrada: se envia un evento de
# mouse vacio, que no mueve nada, y despues se activa la ventana. Es el recurso que usa PowerToys.
#
# Terminal: se adjunta un momento a la consola del proceso y se pide su ventana. En la consola
# clasica es la ventana visible; en Windows Terminal es una ventana oculta cuya duena es la ventana
# de Windows Terminal que tiene esa pestana. Git Bash (mintty) no usa una consola de Windows: ahi se
# busca la ventana de mintty por el titulo que le pone Claude Code.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Add-Type @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
public static class Ventanas {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("kernel32.dll")] static extern bool FreeConsole();
  [DllImport("kernel32.dll")] static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public MOUSEINPUT mi; }
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);

  static string Titulo(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }

  static string Proceso(IntPtr h) {
    uint pid; GetWindowThreadProcessId(h, out pid);
    try { return Process.GetProcessById((int)pid).ProcessName; } catch { return ""; }
  }

  static List<IntPtr> Visibles() {
    var r = new List<IntPtr>();
    EnumWindows((h, l) => { if (IsWindowVisible(h)) r.Add(h); return true; }, IntPtr.Zero);
    return r;
  }

  static string Activar(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9); // SW_RESTORE
    var vacio = new INPUT[] { new INPUT { type = 0 } }; // INPUT_MOUSE sin movimiento
    SendInput(1, vacio, Marshal.SizeOf(typeof(INPUT)));
    SetForegroundWindow(h);
    BringWindowToTop(h);
    return GetForegroundWindow() == h ? "ok" : "sin-foco";
  }

  public static string Carpeta(string carpeta) {
    string sufijo = " - " + carpeta + " - Visual Studio Code";
    string solo = carpeta + " - Visual Studio Code";
    foreach (var h in Visibles()) {
      var t = Titulo(h);
      if (t.EndsWith(sufijo, StringComparison.OrdinalIgnoreCase) || t.Equals(solo, StringComparison.OrdinalIgnoreCase)) return Activar(h);
    }
    return "no-encontrada";
  }

  // La ventana visible que muestra la consola del proceso, o cero si no tiene (mintty, o ya no existe).
  static IntPtr VentanaDeConsola(uint pid) {
    FreeConsole();
    if (!AttachConsole(pid)) return IntPtr.Zero;
    IntPtr c = GetConsoleWindow();
    FreeConsole();
    if (c == IntPtr.Zero) return IntPtr.Zero;
    IntPtr raiz = GetAncestor(c, 3); // GA_ROOTOWNER
    if (raiz == IntPtr.Zero) raiz = c;
    return IsWindowVisible(raiz) ? raiz : IntPtr.Zero;
  }

  // Ventanas de mintty con el titulo que pone Claude Code: "<icono> <titulo>".
  static List<IntPtr> Mintty(string titulo) {
    var r = new List<IntPtr>();
    foreach (var h in Visibles()) {
      if (Proceso(h) != "mintty") continue;
      var t = Titulo(h).Trim();
      bool deClaude = t.Length > 1 && (t[0] == (char)0x2733 || t[0] == (char)0x25D0 || t[0] == (char)0x25D1); // icono de reposo o de trabajo
      if (!deClaude) continue;
      if (string.IsNullOrEmpty(titulo) || t.IndexOf(titulo, StringComparison.OrdinalIgnoreCase) >= 0) r.Add(h);
    }
    return r;
  }

  public static string Terminal(uint pid, string titulo) {
    IntPtr h = VentanaDeConsola(pid);
    if (h != IntPtr.Zero) return Activar(h);
    var porTitulo = Mintty(titulo);
    if (porTitulo.Count == 0 && !string.IsNullOrEmpty(titulo)) porTitulo = Mintty(null);
    if (porTitulo.Count == 1) return Activar(porTitulo[0]);
    return porTitulo.Count == 0 ? "no-encontrada" : "ambigua";
  }

  public static string Anfitrion(uint pid) {
    IntPtr h = VentanaDeConsola(pid);
    return h == IntPtr.Zero ? "" : Proceso(h);
  }
}
"@

while ($null -ne ($linea = [Console]::In.ReadLine())) {
  $respuesta = 'error'
  try {
    $partes = $linea.Split("`t")
    switch ($partes[0]) {
      'carpeta' { $respuesta = [Ventanas]::Carpeta($partes[1].Trim()) }
      'terminal' { $respuesta = [Ventanas]::Terminal([uint32]$partes[1], $(if ($partes.Count -gt 2) { $partes[2] } else { '' })) }
      'anfitrion' {
        $respuesta = [Ventanas]::Anfitrion([uint32]$partes[1])
        if (-not $respuesta) {
          # Sin consola de Windows: Git Bash corre a Claude con su propio sh.exe.
          $padre = (Get-CimInstance Win32_Process -Filter "ProcessId=$([uint32]$partes[1])").ParentProcessId
          $ruta = (Get-CimInstance Win32_Process -Filter "ProcessId=$padre").ExecutablePath
          if ($ruta -like '*\Git\*') { $respuesta = 'mintty' }
        }
      }
    }
  } catch {}
  [Console]::Out.WriteLine($respuesta)
  [Console]::Out.Flush()
}
