# Onda en Juego

**Juego colaborativo de audio y dibujo de ondas en tiempo real**

**Nombre recomendado para presentar:** *Onda en Juego — desafío de sonido y
ondas*.

## Datos del trabajo

| | |
|---|---|
| Carrera | Diseño Multimedial |
| Materia | Tecno IV |
| Año | 2026 |
| Instancia | Trabajo Final |
| Profesores | Mauricio Gutierrez, Sebastián Zavatarelli |
| Alumnos | Marcos Duarte, Aimee Meza |

## Descripción

Onda en Juego es una aplicación web multijugador en la que los participantes
escuchan un sonido, dibujan en un canvas la forma de onda que imaginan y reciben
puntos según la cercanía de su dibujo con la referencia.

Las partidas se desarrollan en salas de entre 3 y 5 jugadores. En cada ronda,
una persona graba un sonido y el resto dibuja su respuesta durante un tiempo
configurable. El anfitrión define la duración de la grabación y del dibujo. Al
finalizar la ronda, todos ven la onda de referencia, las respuestas recibidas y
el marcador. El dibujo más cercano recibe 3 puntos; si hay empate, los jugadores
empatados reciben esos puntos.

La persona que graba puede observar la señal del micrófono en vivo y calibrar
la sensibilidad. La aplicación solicita al navegador reducción de ruido y
cancelación de eco cuando están disponibles; también permite ajustar la
ganancia de entrada.

## Tecnologías

- **Node.js** ejecuta el servidor y la lógica de la aplicación.
- **Socket.IO** mantiene la comunicación en tiempo real entre navegador y
  servidor: autenticación, salas, estados de juego, grabaciones, dibujos y
  resultados.
- **HTTPS** sirve la aplicación y habilita el acceso a funciones del micrófono
  en los navegadores. Los certificados locales se generan con `selfsigned`.
- **HTML y CSS** definen las vistas y su presentación adaptable.
- **JavaScript sin framework** implementa el cliente como módulos ES y el
  servidor como módulos CommonJS.
- **Web Audio API y MediaRecorder** capturan, procesan, visualizan y reproducen
  el audio. El procesamiento utiliza controles disponibles en el navegador,
  como reducción de ruido, cancelación de eco, ganancia y compresión.
- **Canvas 2D y Pointer Events** permiten dibujar con mouse o pantalla táctil y
  visualizar las ondas comparadas.
- **Archivos JSON** sirven como almacenamiento local de usuarios, puntajes y
  metadatos de audios.

### Dependencias de Node

Las dependencias están declaradas en `package.json`:

- `socket.io`: comunicación en tiempo real.
- `ip`: detección de la dirección IP local para mostrar el acceso desde otros
  dispositivos de la red.
- `qrcode-terminal`: impresión de un código QR en la consola.
- `selfsigned`: generación de certificados HTTPS locales.

## Organización de carpetas

```text
Tp2/
├── certs/                  Certificado y clave para HTTPS local
│   └── generate-cert.js    Generación del certificado autofirmado
├── data/                   Persistencia en archivos JSON
│   ├── users.json          Usuarios y puntajes
│   ├── audioData.json      Metadatos de audios enviados
│   └── videoData.json      Archivo residual; no lo usa el juego actual
├── public/                 Interfaz web servida al navegador
│   ├── index.html          Estructura de las vistas
│   ├── styles.css          Estilos y distribución adaptable
│   ├── main.js             Inicialización de módulos del cliente
│   ├── app-state.js        Estado de sesión y navegación
│   ├── auth.js             Interfaz de acceso y administración
│   ├── rooms.js            Lobby, sala y configuración
│   ├── game.js             Flujo de juego, dibujos y resultados
│   ├── audioEngine.js      Captura, procesamiento y reproducción de audio
│   └── mic-calibration.js  Calibración del micrófono
├── server/                 Módulos de lógica del servidor
│   ├── auth.js             Eventos de autenticación y administración
│   ├── rooms.js            Eventos de salas y lobby
│   ├── game.js             Rondas, validación y puntuación
│   └── persistence.js      Lectura y escritura de archivos JSON
├── package.json            Dependencias y comandos npm
├── package-lock.json       Versiones instaladas de dependencias
└── server.js               Arranque de HTTPS, Socket.IO y módulos
```

`node_modules/` contiene las dependencias instaladas por npm; no se modifica
manualmente.

## Archivos JavaScript

### Servidor

- **`server.js`**: inicia el servidor HTTPS en el puerto `3000`, sirve los
  recursos de `public/`, inicializa Socket.IO y registra los manejadores de
  autenticación, salas y juego. También muestra las direcciones de acceso y un
  QR en la consola.
- **`server/auth.js`**: implementa el registro, el inicio de sesión, el modo
  invitado y las operaciones del panel de administración mediante eventos de
  Socket.IO.
- **`server/rooms.js`**: administra la lista de salas, ingreso y salida de
  jugadores, estado de preparación, anfitrión y configuración de los tiempos.
  Valida que haya entre 3 y 5 jugadores para iniciar.
- **`server/game.js`**: organiza las rondas, recibe y valida el audio y los
  dibujos, compara cada respuesta con la referencia y calcula los puntos.
- **`server/persistence.js`**: centraliza las rutas y operaciones de lectura y
  escritura de `users.json` y `audioData.json`.
- **`certs/generate-cert.js`**: genera un certificado autofirmado para
  `localhost` y la IP local.

### Cliente

- **`public/main.js`**: punto de entrada; inicializa autenticación, salas,
  calibración del micrófono y juego.
- **`public/app-state.js`**: mantiene el socket, el usuario y la sala actuales,
  y cambia entre las vistas de la aplicación.
- **`public/auth.js`**: conecta los formularios de acceso y registro, el modo
  invitado y el panel de administración con los eventos del servidor.
- **`public/rooms.js`**: presenta el lobby y la sala; permite crear o unirse a
  salas, marcarse listo, ajustar los tiempos y abrir la calibración del
  micrófono.
- **`public/game.js`**: controla las fases de cada ronda, la grabación del
  anfitrión, el temporizador, el canvas para dibujar, el envío de respuestas y
  las pantallas de resultados.
- **`public/audioEngine.js`**: encapsula la captura del micrófono, la
  previsualización, el procesamiento, la grabación y la reproducción. Guarda
  sensibilidad y reducción de ruido en el almacenamiento local del navegador.
- **`public/mic-calibration.js`**: implementa el panel de calibración con
  visualización y nivel en vivo, control de sensibilidad y opción de reducción
  de ruido.

## Flujo general

1. El navegador carga `public/index.html` y sus módulos JavaScript.
2. El usuario inicia sesión o entra como invitado; el cliente envía eventos al
   servidor mediante Socket.IO.
3. Los jugadores crean o se unen a una sala, ajustan el micrófono y marcan que
   están listos.
4. El anfitrión inicia la partida y el servidor distribuye las rondas.
5. El anfitrión de cada ronda graba un sonido; los demás escuchan y dibujan su
   forma de onda.
6. El servidor puntúa las respuestas y distribuye la comparación y el
   marcador.

## Ejecución local

Requiere Node.js y npm instalados.

```powershell
npm install
npm start
```

El servidor informa en la consola la URL local y, si está disponible, la URL de
red y su código QR. Para volver a generar los certificados locales:

```powershell
npm run cert
```

El certificado es autofirmado, por lo que el navegador puede mostrar una
advertencia de confianza al abrir la aplicación. Para probarla desde un
teléfono, ambos dispositivos deben estar en la misma red y el navegador debe
permitir el acceso al micrófono.

## Alcance y consideraciones

- Las salas y el estado de una partida se mantienen en memoria; se pierden al
  reiniciar el servidor.
- La persistencia está basada en JSON y no está preparada para escrituras
  concurrentes o grandes volúmenes de datos.
- Actualmente las contraseñas de usuarios se guardan en `users.json` sin hash.
  Este proyecto es académico y no debe exponerse como sistema de producción sin
  implementar almacenamiento y autenticación seguros.
- La reducción de ruido depende del soporte del navegador y del dispositivo.
  Puede atenuar el ruido ambiente, pero no garantiza aislar completamente la
  voz. Aumentar la sensibilidad también puede amplificar el ruido.
- `data/videoData.json` es un archivo residual de una versión anterior; el juego
  actual no lo utiliza.
