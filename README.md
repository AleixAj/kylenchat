<p align="center">
  <img src="assets/icon.png" width="128" alt="Kylen Twitch Chat">
</p>

<h1 align="center">Kylen Twitch Chat</h1>

<p align="center">
  El chat de Twitch encima de tu juego, con fondo transparente.<br>
  Para streamers con una sola pantalla que no quieren mirar el chat en el móvil.
</p>

---

## Qué hace

- Muestra el chat de cualquier canal de Twitch en una ventana **transparente** que queda **siempre encima** del juego.
- Los clics **atraviesan** el chat, así que no molesta mientras juegas.
- Puedes elegir **posición, tamaño, fuente, tamaño de letra, colores, fondo y transparencia**.
- Muestra los emotes de **Twitch, 7TV, BTTV y FFZ**.
- Se **actualiza sola** cuando sale una versión nueva.
- No necesitas iniciar sesión en Twitch.

## Descarga e instalación

1. Ve a [**Releases**](https://github.com/AleixAj/kylentwitchchat/releases/latest) y descarga `KylenTwitchChat-Setup-x.x.x.exe`.
2. Ábrelo. Se instala en unos segundos y se abre sola.
3. Si Windows muestra *"Windows protegió tu PC"*, pulsa **Más información → Ejecutar de todas formas**. Sale porque la app todavía no tiene firma digital de pago, no porque sea peligrosa.

## Cómo se usa

1. Escribe el nombre de tu canal (o pega el enlace de twitch.tv) y pulsa **Conectar**.
2. Pulsa **Ctrl + Shift + L** para desbloquear el chat: arrástralo donde quieras y cambia su tamaño desde la esquina de abajo a la derecha.
3. Vuelve a pulsar **Ctrl + Shift + L** para fijarlo.
4. Ajusta la letra, los colores y la transparencia a tu gusto. Todo se guarda solo.

Si cierras la ventana de ajustes, la app sigue funcionando en la bandeja (junto al reloj). Haz clic en su icono para volver a abrirla.

### Atajos

| Atajo | Qué hace |
| --- | --- |
| `Ctrl + Shift + L` | Mover y cambiar el tamaño del chat / fijarlo |
| `Ctrl + Shift + H` | Ocultar o mostrar el chat |

### Importante para juegos (League of Legends, etc.)

- Pon el juego en modo **"Sin bordes"** (*Borderless*). En pantalla completa exclusiva, Windows no deja que ninguna ventana se vea encima.
- En OBS, captura el juego con **"Captura de juego"**. Así el chat no sale en el directo. Con "Captura de pantalla" sí saldría.

## ¿Me pueden banear?

La app **no toca el juego**: no lee su memoria, no modifica sus archivos y no se mete dentro de él. Es una ventana aparte, igual que tener un navegador o Discord encima. Tampoco lee datos de la partida ni da ninguna ventaja al jugar.

## Rendimiento

Está hecha para no afectar a los FPS ni al ping:

- No usa la tarjeta gráfica: el chat se dibuja con el procesador, que para texto gasta muy poco.
- En chats muy rápidos agrupa los mensajes y actualiza la pantalla unas 6 veces por segundo como mucho.
- Los emotes animados están desactivados por defecto (se pueden activar en ajustes).
- El chat solo recibe texto: gasta menos internet que una página web.

---

## Para desarrolladores

Hecha con [Electron](https://www.electronjs.org/). Necesitas [Node.js](https://nodejs.org/) 20 o superior.

```bash
npm install
npm start
```

| Archivo | Qué es |
| --- | --- |
| `main.js` | Proceso principal: ventanas, bandeja, atajos, ajustes y actualizaciones |
| `overlay.html` / `overlay.js` | La ventana transparente con el chat (conexión a Twitch y emotes) |
| `panel.html` / `panel.js` | La ventana de ajustes |
| `preload.js` | Puente seguro entre las ventanas y el proceso principal |
| `assets/` | Iconos |

### Crear el instalador

```bash
npm run dist
```

El instalador queda en `dist/`.

### Publicar una versión nueva (actualización automática)

1. Sube el número de `version` en `package.json` (por ejemplo, de `0.1.0` a `0.1.1`).
2. Publica la versión. En PowerShell:

   ```powershell
   $env:GH_TOKEN = gh auth token; npm run release
   ```

   Esto crea el instalador y lo sube a GitHub Releases junto con `latest.yml`.
3. Las apps ya instaladas buscan actualizaciones al arrancar y cada 4 horas. Cuando encuentran una versión nueva la descargan y avisan para reiniciar; si no se reinicia, se instala al cerrar la app.
