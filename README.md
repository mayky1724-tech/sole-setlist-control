# SOLÉ SetlistControl 🎸

Control de setlist para Ableton Live, accesible desde cualquier dispositivo en tu red WiFi.

---

## Requisitos

- Node.js 18+ instalado en el PC con Ableton
- Ableton Live 10, 11 o 12
- Plugin **AbletonOSC** (gratuito, open source)

---

## Instalación (una sola vez)

### 1. Instalar AbletonOSC en Ableton

1. Descarga AbletonOSC desde: https://github.com/ideoforms/AbletonOSC/releases
2. Copia la carpeta `AbletonOSC` en tu carpeta de Remote Scripts de Ableton:
   - **Mac**: `~/Music/Ableton/User Library/Remote Scripts/`
   - **Win**: `C:\Users\[usuario]\Documents\Ableton\User Library\Remote Scripts\`
3. Abre Ableton Live → Preferences → Link/Tempo/MIDI
4. En "Control Surface" selecciona **AbletonOSC**
5. Reinicia Ableton

### 2. Instalar dependencias del servidor

```bash
# Descomprime esta carpeta y entra a ella
cd sole-setlist-control

# Instala dependencias (solo la primera vez)
npm install
```

---

## Uso

### 1. Preparar Ableton

- En el Arrangement View, agrega **locators** al inicio de cada canción
- El nombre del locator = nombre de la canción en el setlist
- Tip: clic derecho sobre la regla de tiempo → "Add Locator"

### 2. Iniciar el servidor

```bash
npm start
```

Verás algo así:
```
╔══════════════════════════════════════════╗
║       SOLÉ SetlistControl – Servidor      ║
╠══════════════════════════════════════════╣
║  Local:    http://localhost:3000          ║
║  Red WiFi: http://192.168.1.X:3000   ║
╠══════════════════════════════════════════╣
║  Abre la URL de Red en tu celular         ║
╚══════════════════════════════════════════╝
```

### 3. Abrir en el celular

- Conecta tu celular a la **misma red WiFi** que el PC
- Abre el navegador y ve a `http://192.168.1.X:3000` (la IP que muestra la consola)
- ¡Listo! Puedes controlar el setlist desde cualquier dispositivo

---

## Funciones

| Función | Descripción |
|---|---|
| **Play / Pause** | Botón central verde |
| **Stop** | Detiene la reproducción |
| **Anterior / Siguiente** | Navega entre canciones del setlist |
| **Tap en canción** | Salta directamente a esa canción |
| **Editar orden** | Arrastra para reordenar el setlist (se guarda automáticamente) |
| **BPM** | Muestra el tempo actual de Ableton |
| **Progreso** | Barra que muestra cuánto va la canción actual |

---

## Notas

- El servidor debe estar corriendo en el PC con Ableton mientras usas la app
- Los cambios de orden del setlist se guardan en `setlist.json`
- Puedes conectar múltiples dispositivos simultáneamente (celular, tablet, etc.)
- Funciona en Mac y Windows

---

## Puertos usados

- `3000` — Interfaz web (HTTP + WebSocket)
- `11000` — OSC hacia Ableton (AbletonOSC escucha aquí)
- `11001` — OSC desde Ableton (el servidor escucha aquí)

Si tienes firewall activo, asegúrate de que el puerto 3000 esté permitido en la red local.
