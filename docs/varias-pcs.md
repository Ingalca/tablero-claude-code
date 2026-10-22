# Varias PCs

Cada PC corre su agente y abre su propio tablero en `http://localhost:4590`. Cada agente le pide a
los otros su estado cada 3 segundos, así que en todos los tableros se ven las sesiones de todas las
PCs. El click para traer una ventana al frente funciona solo con las sesiones de la PC propia.

Si una PC deja de responder (se apagó, se fue de la red), sus tarjetas no desaparecen: quedan en gris
con "Sin datos desde las HH:MM", y la barra de estado dice desde cuándo no hay conexión.

## Qué hace falta en cada PC

1. La red preparada: **perfil Privada** y detección de redes activada (ver [por la red local](#por-la-red-local-sin-tailscale)).
2. El agente instalado (ver el [README](../README.md#instalación)).
3. En `config.json`:
   - el **mismo `token`** en todas las PCs (copialo de la primera);
   - `"host": "0.0.0.0"`, para que escuche en la red y no solo en esta PC;
   - en `peers`, las otras PCs, **por nombre** si se puede: `"peers": ["notebook"]`. También sirve
     `nombre:puerto`, una IP o una URL completa (ver [por nombre o por IP](#4-por-nombre-o-por-ip));
   - un `maquina` claro, que es el nombre que se ve en las tarjetas (`"workstation"`, `"notebook"`).
4. **El puerto abierto en el firewall**, desde un PowerShell **como administrador**:

   ```
   powershell -ExecutionPolicy Bypass -File scripts\abrir-red.ps1
   ```

   Abre el puerto para la red local (solo con perfil de red **Privada**) y para Tailscale. Para
   cerrarlo: el mismo comando con `-Quitar`.
5. Reiniciar el agente: volver a correr `scripts\instalar-inicio.ps1`.

## Por la red local, sin Tailscale

Sirve cuando las PCs comparten la red de la oficina o de tu casa. Hay cuatro cosas que revisar, en
este orden.

### 1. Las dos en la misma red

En cada PC, `ipconfig`: la *Dirección IPv4* del adaptador que usa (Wi-Fi o Ethernet) tiene que ser de
la misma subred, y la *Puerta de enlace predeterminada* la misma. Por ejemplo `192.168.1.12` y
`192.168.1.19`, las dos con máscara `255.255.255.0` y puerta de enlace `192.168.1.1`.

Una red de invitados no sirve: suele aislar a los equipos entre sí.

### 2. Perfil de red Privada y detección de redes

Windows trata cada red como **Pública** o **Privada**. En una Pública no anuncia el nombre de la PC
ni pregunta el de las demás, y bloquea las conexiones que llegan; por eso `abrir-red.ps1` abre el
puerto solo para redes Privadas. En **cada PC**:

- **Perfil Privada:** Configuración → Red e Internet → Wi-Fi (o Ethernet) → la red conectada →
  **Tipo de perfil de red: Privada**. Para ver cómo está: `Get-NetConnectionProfile` en PowerShell.
- **Detección de redes activada:** Configuración → Red e Internet → Configuración de red avanzada →
  Configuración de uso compartido avanzado → **Redes privadas → Detección de redes**. Sin esto
  Windows no responde por nombre, aunque la red esté en Privada.

### 3. Si hay una repetidora o una red mesh

Con una repetidora, un extensor o una red mesh, Windows crea un **perfil nuevo** cada vez que la PC
entra por un equipo distinto: "Mi red", "Mi red 2", "Mi red 3"… Todos son la misma red, pero cada
perfil nuevo **arranca como Público**. El síntoma: el tablero dejaba de ver a una PC sin que nadie
tocara nada, y `Get-NetConnectionProfile` muestra un nombre con número en Pública.

Para pasar a Privada todos los perfiles de esa red de una vez, en un PowerShell **como administrador**:

```
powershell -ExecutionPolicy Bypass -File scriptsedes-privadas.ps1 -Nombre "Mi red"
```

Sin `-Nombre`, lista los perfiles guardados y su tipo. Si más adelante Windows crea otro perfil, hay
que volver a correrlo. Con una notebook que se mueve mucho, Tailscale evita este problema.

### 4. Por nombre o por IP

Por nombre es lo mejor, porque la IP la asigna el router y puede cambiar. El nombre de cada PC
aparece con `hostname`: **copialo de ahí en vez de tipearlo**, porque estos nombres mezclan la letra O
con el cero (`LAPTOP-5H2OKD1` no es `LAPTOP-5H20KD1`). Para comprobar que se resuelve, desde la otra PC:

```
Resolve-DnsName <nombre-de-la-otra>
```

Para revisar todo esto de una vez, en la PC que no se encuentra:

```
powershell -ExecutionPolicy Bypass -File scripts\diagnostico-red.ps1
```

Muestra el perfil de red, las reglas de detección de redes, LLMNR, NetBIOS y si hay un firewall de
terceros. Con `-Arreglar` (como administrador) activa las reglas de Windows que falten, solo para
redes privadas.

Si no se resuelve aunque todo lo anterior esté bien, casi siempre es el **firewall de la otra PC**:
el de Windows, o el de un antivirus con firewall propio (McAfee, Norton, ESET…), que no contesta las
consultas de nombre ni el ping. El tablero no necesita ninguna de las dos: **usá la IP** en `peers`.
Para que no cambie, reservala en el router (reserva DHCP) o pasá a Tailscale.

Para saber si las PCs se ven aunque el ping no conteste:

```
ping <ip-de-la-otra>
Get-NetNeighbor -IPAddress <ip-de-la-otra>
```

Si aparece con su dirección física (`Reachable` o `Stale`), se ven, y lo que bloquea es el firewall.
Si queda `Unreachable`, no se ven: están en subredes distintas o la red aísla a los equipos (ver el
paso 1).

### Comprobar

Desde cada PC, contra la otra:

```
curl.exe -4 http://<nombre-o-ip-de-la-otra>:4590/api/salud
```

Tiene que responder `{"ok":true}`. El `-4` importa: el agente escucha solo en IPv4, y un nombre
puede resolver también a direcciones IPv6, que no contestan y dejan la prueba esperando. El tablero
ya consulta a las otras PCs por IPv4. Después, en `http://localhost:4590` se ven las sesiones de las dos.

### Si no funciona

| Síntoma | Causa probable |
|---|---|
| El nombre no se resuelve | Red en Pública, detección de redes apagada, o el firewall de la otra PC (paso 2 y 4). Mientras tanto, usar la IP |
| Funcionaba y dejó de ver a una PC | Pasó a otro perfil de red, en Pública (paso 3), o le cambió la IP |
| `/api/salud` no responde | Falta `abrir-red.ps1`, el agente escucha en `127.0.0.1` (falta `"host": "0.0.0.0"`), o la red de esa PC está en Pública |
| El tablero dice "token distinto" | El `token` de `config.json` no es igual en las dos |
| El tablero dice "no responde" | Apagada, en otra red, o el firewall bloquea el puerto. Pasando el mouse (o por el ⓘ del Resumen) dice cuál es más probable según el error |
| Windows mostró un aviso del firewall para Node.js y se canceló | Esa respuesta crea una regla que bloquea a `node.exe`: buscala en "Firewall de Windows Defender → Configuración avanzada → Reglas de entrada" y borrala |
| Hay un antivirus con firewall propio | Hay que permitir el puerto 4590 (o `node.exe`) también en él |
| Responde por la red local aunque la red esté en Pública | Una regla para `node.exe` en redes públicas, de un aviso del firewall aceptado alguna vez: abre cualquier servidor de Node en un Wi-Fi público. `diagnostico-red.ps1` la muestra con el comando para desactivarla |

La red local va sin cifrar: el token y los extractos de mensajes viajan en texto plano (ver
[SECURITY.md](../SECURITY.md)).

## Con Tailscale

Tailscale arma una red privada entre tus máquinas: se ven estén donde estén (la oficina, tu casa, el
teléfono como módem) y todo va cifrado. Es lo más cómodo para una notebook que entra y sale, y evita
los problemas de perfiles de red y de nombres de la red local.

1. Instalar Tailscale en cada PC (tailscale.com/download) y entrar con la misma cuenta.
2. **Ponerles nombres cortos**, en la consola de Tailscale (login.tailscale.com → Machines → ⋯ →
   Edit machine name): por ejemplo `workstation` y `laptop`. Por defecto usa el nombre de Windows,
   que es largo y mezcla la O con el cero.
3. En `peers`, ese nombre: `"peers": ["laptop"]` en una y `"peers": ["workstation"]` en la otra. Con
   MagicDNS, que viene activado, el nombre corto alcanza (resuelve a la dirección `100.x.x.x`).
4. `abrir-red.ps1` ya deja abierto el puerto para las direcciones de Tailscale, en cualquier perfil
   de red. Reiniciar el agente con `instalar-inicio.ps1`.

Para comprobar, desde cada PC:

```
curl.exe -4 http://<nombre-en-tailscale>:4590/api/salud
```

Con los nombres de Tailscale en `peers`, el tablero sigue funcionando aunque una de las PCs cambie
de red: no hay que tocar la configuración.
