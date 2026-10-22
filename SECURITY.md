# Seguridad

## Qué protege el diseño

- **Los transcripts nunca salen de tu PC.** Por la red viaja solo el estado de cada sesión, su
  título y un extracto corto del último mensaje.
- **Desde la red solo se puede leer** (`/api/estado`), y con el token compartido. El agente rechaza
  además toda conexión que no venga de loopback, de una red privada (10/8, 172.16/12, 192.168/16)
  o de Tailscale (100.64/10).
- **El tablero y "traer al frente" solo se atienden desde la misma PC** (`127.0.0.1`, con
  `Host: localhost`). Nadie puede traer al frente ventanas de otra máquina. Esas rutas exigen un
  header propio, para que ninguna otra página abierta en el navegador pueda llamarlas.
- **No modifica los archivos de Claude Code**: los lee. No instala hooks ni toca `settings.json`.
- **Sin dependencias, sin telemetría**: no hay código de terceros ni conexiones a internet.

## Qué no protege

- **En la LAN el tráfico va sin cifrar**: HTTP plano, incluido el token y los extractos. En una red
  que no controlás, usá Tailscale (cifra todo) o dejá el agente en `127.0.0.1`.
- **El token es uno solo y compartido.** Quien lo tenga y esté en tu red puede leer el estado de
  tus sesiones. Para cambiarlo, editá `config.json` en todas las PCs.
- **Las reglas del firewall para `node.exe`.** Si alguna vez aceptaste el aviso del firewall de
  Windows para Node.js en redes públicas, cualquier servidor de Node, este u otro, queda abierto en
  un Wi-Fi público en cualquier puerto. El agente igual rechaza lo que no venga de una red privada o
  de Tailscale y pide el token, pero conviene desactivarlas: `scripts\diagnostico-red.ps1` las detecta.
- **Cualquier programa que corra en tu PC** puede leer `datos/` y llamar al agente desde
  `localhost`, igual que puede leer `~/.claude`.

## Reportar un problema

Si encontrás una vulnerabilidad, no abras un issue público: usá el reporte privado de GitHub
(pestaña **Security → Report a vulnerability** del repositorio).
