import { appState, socket, switchView } from "./app-state.js";
import { closeMicCalibration, openMicCalibration } from "./mic-calibration.js";

const audioEngine = window.audioEngine;
const WAVEFORM_COLORS = ["#38bdf8", "#4ade80", "#f472b6", "#c084fc", "#fb923c"];
let guessTimerInterval = null;
let activeWaveformCanvas = null;
let activeResultsChart = null;
let lastWaveformResults = null;
let recordingMonitorInterval = null;

export function initializeGame() {
  socket.on("game:roundStart", (data) => {
    closeMicCalibration();
    clearGuessPhase();
    if (data.roundNumber === 1) lastWaveformResults = null;
    appState.gameState = data;
    switchView("game");
    document.getElementById("hud-round").innerText =
      `Ronda ${data.roundNumber}/${data.totalRounds}`;
    document.getElementById("hud-mode").innerText =
      `Modo: ${data.mode.toUpperCase()}`;
    setupRoundStage();
  });

  socket.on("game:audioGuessPhase", handleGuessPhase);
  socket.on("game:roundResults", showRoundResults);
  socket.on("game:finished", showGameResults);
}

function setupRoundStage() {
  const controls = document.getElementById("game-controls");
  controls.innerHTML = "";
  const gameState = appState.gameState;
  const isHost = gameState.hostId === appState.currentUser.id;

  if (isHost) {
    controls.innerHTML = `
      <div class="round-waiting">
      <p><strong>Eres el anfitrión.</strong> Graba un sonido de hasta ${gameState.recordingSeconds} segundos.</p>
      <canvas id="recording-waveform" class="recording-monitor-canvas"
        aria-label="Forma de onda del micrófono en vivo"></canvas>
      <div id="recording-level-meter" class="recording-level-meter"
        role="meter" aria-label="Nivel de grabación"
        aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <div id="recording-level-fill" class="recording-level-fill"></div>
      </div>
      <p id="recording-countdown" class="status-msg" aria-live="polite"></p>
      <p id="recording-status" class="status-msg" role="status" aria-live="polite"></p>
      <div class="recording-actions">
        <button id="btn-adjust-mic" class="btn secondary">Ajustar micrófono</button>
        <button id="btn-record-audio" class="btn danger">Iniciar grabación</button>
      </div>
      </div>
    `;
    setupAudioHostControls();
  } else {
    controls.innerHTML = `
      <div class="round-waiting">
        <p>El anfitrión (${gameState.hostName}) tiene hasta ${gameState.recordingSeconds} segundos para grabar.</p>
      </div>
    `;
  }
}

function setupAudioHostControls() {
  const button = document.getElementById("btn-record-audio");
  const countdown = document.getElementById("recording-countdown");
  const status = document.getElementById("recording-status");
  let recordingInterval = null;
  let recordingDeadline = 0;
  let isSubmitting = false;

  document.getElementById("btn-adjust-mic").onclick = () =>
    openMicCalibration();

  button.onclick = async () => {
    if (audioEngine.isRecording) {
      await submitRecording();
      return;
    }

    button.disabled = true;
    button.innerText = "Solicitando micrófono...";
    status.innerText = "";
    try {
      await audioEngine.startRecording();
      startRecordingMonitor();
      recordingDeadline =
        Date.now() + appState.gameState.recordingSeconds * 1000;
      button.disabled = false;
      button.classList.replace("danger", "warning");
      button.innerText = "Detener grabación";
      updateRecordingCountdown();
      recordingInterval = setInterval(updateRecordingCountdown, 250);
    } catch (error) {
      console.error("No se pudo iniciar la grabación:", error);
      button.disabled = false;
      button.innerText = "Reintentar grabación";
      status.innerText =
        "No se pudo iniciar la grabación. Revisa los permisos del micrófono.";
      status.style.color = "#f87171";
    }
  };

  function updateRecordingCountdown() {
    const remaining = Math.max(
      0,
      Math.ceil((recordingDeadline - Date.now()) / 1000),
    );
    countdown.innerText = `Tiempo de grabación: ${remaining}s`;
    if (remaining === 0) submitRecording();
  }

  async function submitRecording() {
    if (isSubmitting || !audioEngine.isRecording) return;
    isSubmitting = true;
    clearInterval(recordingInterval);
    closeMicCalibration();
    stopRecordingMonitor();
    button.disabled = true;
    button.innerText = "Procesando audio...";

    try {
      const audioBuffer = await audioEngine.stopRecording();
      if (!audioBuffer) throw new Error("No se recibió audio grabado.");
      socket.emit(
        "game:audioSubmit",
        {
          roomName: appState.currentRoom,
          audioSamples: audioEngine.bufferToArray(audioBuffer),
          sampleRate: audioBuffer.sampleRate,
          waveform: audioEngine.extractNormalizedPeaks(audioBuffer),
        },
        (res) => {
          if (!res.ok) {
            status.innerText = res.error;
            status.style.color = "#f87171";
            button.disabled = false;
            button.innerText = "Reintentar envío";
            isSubmitting = false;
          }
        },
      );
      countdown.innerText = "";
      status.innerText = "Audio enviado. Esperando a los participantes...";
      status.style.color = "#4ade80";
    } catch (error) {
      console.error("No se pudo procesar la grabación:", error);
      status.innerText = "No se pudo procesar la grabación. Inténtalo otra vez.";
      status.style.color = "#f87171";
      button.disabled = false;
      button.innerText = "Reintentar grabación";
      isSubmitting = false;
    }
  }
}

function handleGuessPhase({ audioSamples, sampleRate, guessingSeconds }) {
  const controls = document.getElementById("game-controls");
  if (appState.gameState.hostId === appState.currentUser.id) {
    controls.innerHTML = `
      <div class="round-waiting">
        <p>Grabación enviada. Los participantes tienen ${guessingSeconds} segundos para dibujar la onda.</p>
      </div>
    `;
    return;
  }

  const audioBuffer = audioEngine.arrayToBuffer(audioSamples, sampleRate);
  controls.innerHTML = `
    <div class="drawing-layout">
    <p class="drawing-instructions">Dibuja la onda con varios trazos; puedes continuar después de escuchar de nuevo.</p>
    <div class="waveform-actions">
      <button id="btn-replay-audio" class="btn secondary">Escuchar / volver a escuchar</button>
      <span id="guess-countdown" class="status-msg" role="timer"></span>
    </div>
    <canvas id="waveform-canvas" class="waveform-canvas" aria-label="Dibuja la forma de onda del sonido"></canvas>
    <p id="guess-status" class="drawing-status" role="status" aria-live="polite"></p>
    <div class="waveform-actions drawing-actions">
      <button id="btn-clear-waveform" class="btn secondary">Borrar y redibujar</button>
      <button id="btn-submit-waveform" class="btn success">Enviar dibujo</button>
    </div>
    </div>
  `;

  const status = document.getElementById("guess-status");
  document.getElementById("btn-replay-audio").onclick = async () => {
    try {
      await audioEngine.playBuffer(audioBuffer);
    } catch (error) {
      console.error("No se pudo reproducir el audio:", error);
      status.innerText = "No se pudo reproducir el audio.";
      status.style.color = "#f87171";
    }
  };

  activeWaveformCanvas = setupWaveformCanvas(
    document.getElementById("waveform-canvas"),
  );
  setupWaveformSubmission(status, guessingSeconds);
}

function setupWaveformSubmission(status, guessingSeconds) {
  const canvas = document.getElementById("waveform-canvas");
  const clearButton = document.getElementById("btn-clear-waveform");
  const submitButton = document.getElementById("btn-submit-waveform");
  const countdown = document.getElementById("guess-countdown");
  let submitted = false;

  function submitDrawing() {
    if (submitted) return true;
    const waveform = activeWaveformCanvas.getWaveform();
    if (waveform.length === 0) return false;

    submitted = true;
    canvas.style.pointerEvents = "none";
    clearButton.disabled = true;
    submitButton.disabled = true;
    clearInterval(guessTimerInterval);
    guessTimerInterval = null;
    countdown.innerText = "Dibujo enviado";
    status.innerText = "Enviando dibujo...";
    socket.emit(
      "game:submitWaveform",
      { roomName: appState.currentRoom, waveform },
      (res) => {
        if (!res.ok) {
          status.innerText = res.error;
          status.style.color = "#f87171";
          return;
        }
        status.innerText = "Dibujo enviado. Esperando a los demás...";
        status.style.color = "#4ade80";
      },
    );
    return true;
  }

  clearButton.onclick = () => {
    activeWaveformCanvas.clear();
    status.innerText = "";
  };
  submitButton.onclick = () => {
    if (!submitDrawing()) {
      status.innerText = "Dibuja una forma de onda antes de enviarla.";
      status.style.color = "#fbbf24";
    }
  };

  const deadline = Date.now() + guessingSeconds * 1000;
  function updateCountdown() {
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    countdown.innerText = `Tiempo restante: ${remaining}s`;
    if (remaining === 0) {
      clearInterval(guessTimerInterval);
      guessTimerInterval = null;
      if (!submitDrawing()) {
        canvas.style.pointerEvents = "none";
        clearButton.disabled = true;
        submitButton.disabled = true;
        status.innerText = "Se agotó el tiempo sin enviar un dibujo.";
        status.style.color = "#f87171";
      }
    }
  }

  updateCountdown();
  guessTimerInterval = setInterval(updateCountdown, 250);
}

function setupWaveformCanvas(canvas) {
  const context = canvas.getContext("2d");
  const strokes = [];
  let currentStroke = null;
  let canvasWidth = 0;
  let canvasHeight = 0;

  function draw() {
    context.clearRect(0, 0, canvasWidth, canvasHeight);
    context.fillStyle = "#0f172a";
    context.fillRect(0, 0, canvasWidth, canvasHeight);
    context.strokeStyle = "#334155";
    context.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = (canvasHeight * i) / 4;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(canvasWidth, y);
      context.stroke();
    }

    context.strokeStyle = "#38bdf8";
    context.lineWidth = 3;
    context.lineCap = "round";
    context.lineJoin = "round";
    strokes.forEach((stroke) => {
      if (stroke.length === 0) return;
      context.beginPath();
      context.moveTo(stroke[0].x * canvasWidth, stroke[0].y * canvasHeight);
      stroke.slice(1).forEach((point) => {
        context.lineTo(point.x * canvasWidth, point.y * canvasHeight);
      });
      context.stroke();
    });
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    canvasWidth = rect.width;
    canvasHeight = rect.height;
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvasWidth * pixelRatio);
    canvas.height = Math.round(canvasHeight * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    draw();
  }

  function addPointerPoint(event) {
    const rect = canvas.getBoundingClientRect();
    currentStroke.push({
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    });
    draw();
  }

  function pointerDown(event) {
    currentStroke = [];
    strokes.push(currentStroke);
    canvas.setPointerCapture(event.pointerId);
    addPointerPoint(event);
  }

  function pointerMove(event) {
    if (currentStroke) addPointerPoint(event);
  }

  function pointerUp() {
    currentStroke = null;
  }

  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", pointerUp);
  window.addEventListener("resize", resize);
  resize();

  return {
    clear() {
      strokes.length = 0;
      currentStroke = null;
      draw();
    },
    dispose() {
      window.removeEventListener("resize", resize);
    },
    getWaveform() {
      const points = strokes.flat();
      if (points.length < 2) return [];
      const sortedPoints = points.sort((a, b) => a.x - b.x);
      let segment = 0;
      return Array.from({ length: 100 }, (_, index) => {
        const x = index / 99;
        while (
          segment < sortedPoints.length - 2 &&
          sortedPoints[segment + 1].x < x
        ) {
          segment++;
        }
        const left = sortedPoints[segment];
        const right =
          sortedPoints[Math.min(segment + 1, sortedPoints.length - 1)];
        const span = right.x - left.x;
        const fraction =
          span > 0 ? Math.max(0, Math.min(1, (x - left.x) / span)) : 0;
        const y = left.y + (right.y - left.y) * fraction;
        return Math.round((1 - y) * 100);
      });
    },
  };
}

function showRoundResults({
  scoreboard,
  currentRound,
  totalRounds,
  referenceWaveform,
  playerWaveforms,
  closestIds,
}) {
  clearGuessPhase();
  lastWaveformResults = {
    referenceWaveform,
    playerWaveforms,
    closestIds,
    hostId: appState.gameState.hostId,
  };
  const closestPlayers = scoreboard
    .filter((player) => closestIds.includes(player.id))
    .map((player) => player.username);
  renderResults({
    heading: `Resultados de ronda ${currentRound}/${totalRounds}`,
    subtitle: closestPlayers.length
      ? `Más cercana: ${closestPlayers.join(", ")}`
      : "No se recibieron dibujos",
    scoreboard,
    waveformResults: lastWaveformResults,
  });
}

function showGameResults({ winner, scoreboard }) {
  clearGuessPhase();
  renderResults({
    heading: "¡Partida finalizada!",
    subtitle: `Ganador: ${winner.username} (${winner.score} pts)`,
    scoreboard,
    waveformResults: lastWaveformResults,
    final: true,
  });
  document.getElementById("btn-return-room").onclick = () => {
    clearGuessPhase();
    switchView("room");
  };
}

function renderResults({
  heading,
  subtitle = "",
  scoreboard,
  waveformResults,
  final = false,
}) {
  const controls = document.getElementById("game-controls");
  const drawings = waveformResults?.playerWaveforms || [];
  const drawingIds = new Set(drawings.map((player) => player.id));
  const submittedPlayers = scoreboard.filter(
    (player) => player.id !== waveformResults?.hostId,
  );
  const closestIds = new Set(waveformResults?.closestIds || []);
  const chartPlayers = drawings.map((player, index) => ({
    ...player,
    color: WAVEFORM_COLORS[index % WAVEFORM_COLORS.length],
  }));
  const legend = [
    `<div class="waveform-legend-item"><span class="waveform-legend-line" style="background:#fbbf24"></span><span>Referencia</span></div>`,
    ...chartPlayers.map(
      (player) => `
        <div class="waveform-legend-item">
          <span class="waveform-legend-line" style="background:${player.color}"></span>
          <span>${player.username}${closestIds.has(player.id) ? " · +3 pts" : ""}</span>
        </div>
      `,
    ),
    ...submittedPlayers
      .filter((player) => !drawingIds.has(player.id))
      .map(
        (player) => `
          <div class="waveform-legend-item">
            <span class="waveform-legend-line" style="background:#64748b"></span>
            <span>${player.username} · sin dibujo</span>
          </div>
        `,
      ),
  ];
  controls.innerHTML = `
    <div class="results-layout">
      <header class="results-heading">
        <strong>${heading}</strong>
        <span>${subtitle}</span>
        ${final ? '<button id="btn-return-room" class="btn primary">Volver a la sala</button>' : ""}
      </header>
      <div class="results-chart">
        <canvas id="results-waveform-canvas" class="results-waveform-canvas"
          aria-label="Comparación de la onda de referencia y los dibujos de los participantes"></canvas>
      </div>
      <div class="waveform-legend">${legend.join("")}</div>
      <ul class="list results-scoreboard">
        ${scoreboard
          .map(
            (player, index) => `
          <li style="${player.id === appState.currentUser.id ? "border: 2px solid #38bdf8;" : ""}">
            <span>${final ? `#${index + 1} ` : ""}${player.username}${player.id === appState.currentUser.id ? " (Tú)" : ""}</span>
            <strong>${player.score} pts</strong>
          </li>
        `,
          )
          .join("")}
      </ul>
    </div>
  `;

  if (waveformResults?.referenceWaveform) {
    activeResultsChart = setupResultsChart(
      document.getElementById("results-waveform-canvas"),
      waveformResults.referenceWaveform,
      chartPlayers,
    );
  }
}

function clearGuessPhase() {
  if (guessTimerInterval !== null) {
    clearInterval(guessTimerInterval);
    guessTimerInterval = null;
  }
  if (activeWaveformCanvas) {
    activeWaveformCanvas.dispose();
    activeWaveformCanvas = null;
  }
  if (activeResultsChart) {
    activeResultsChart.dispose();
    activeResultsChart = null;
  }
  stopRecordingMonitor();
}

function startRecordingMonitor() {
  stopRecordingMonitor();
  const canvas = document.getElementById("recording-waveform");
  const levelFill = document.getElementById("recording-level-fill");
  const update = () => {
    audioEngine.drawLiveWaveform(canvas, "#4ade80");
    const level = audioEngine.getInputLevel();
    levelFill.style.width = `${level}%`;
    levelFill.style.background = level >= 80 ? "#f87171" : "#4ade80";
    document
      .getElementById("recording-level-meter")
      .setAttribute("aria-valuenow", String(level));
  };
  update();
  recordingMonitorInterval = setInterval(update, 50);
}

function stopRecordingMonitor() {
  if (recordingMonitorInterval !== null) {
    clearInterval(recordingMonitorInterval);
    recordingMonitorInterval = null;
  }
}

function setupResultsChart(canvas, referenceWaveform, playerWaveforms) {
  const context = canvas.getContext("2d");

  function draw() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * pixelRatio);
    canvas.height = Math.round(rect.height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.fillStyle = "#0f172a";
    context.fillRect(0, 0, rect.width, rect.height);

    const padding = Math.min(rect.width, rect.height) * 0.06;
    const plotWidth = rect.width - padding * 2;
    const plotHeight = rect.height - padding * 2;
    context.strokeStyle = "#334155";
    context.lineWidth = 1;
    for (let index = 0; index <= 4; index++) {
      const y = padding + (plotHeight * index) / 4;
      context.beginPath();
      context.moveTo(padding, y);
      context.lineTo(rect.width - padding, y);
      context.stroke();
    }

    function drawWaveform(waveform, color, dashed = false) {
      if (!Array.isArray(waveform) || waveform.length < 2) return;
      context.strokeStyle = color;
      context.lineWidth = dashed ? 3 : 2;
      context.setLineDash(dashed ? [8, 5] : []);
      context.beginPath();
      waveform.forEach((value, index) => {
        const x = padding + (plotWidth * index) / (waveform.length - 1);
        const y = padding + plotHeight * (1 - value / 100);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
    }

    drawWaveform(referenceWaveform, "#fbbf24", true);
    playerWaveforms.forEach((player) =>
      drawWaveform(player.waveform, player.color),
    );
    context.setLineDash([]);
  }

  window.addEventListener("resize", draw);
  draw();
  return {
    dispose() {
      window.removeEventListener("resize", draw);
    },
  };
}
