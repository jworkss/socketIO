const audioEngine = window.audioEngine;
let previewTimer = null;
let previewRequest = 0;
let previewActive = false;
let onMicrophoneEnabled = null;

export function initializeMicrophoneCalibration() {
  const dialog = document.getElementById("mic-calibration-dialog");
  const sensitivity = document.getElementById("mic-sensitivity");
  const noiseSuppression = document.getElementById("mic-noise-suppression");

  syncControls();
  document.getElementById("btn-close-mic-calibration").onclick = () =>
    dialog.close();
  document.getElementById("btn-start-mic-test").onclick = startPreview;
  document.getElementById("btn-stop-mic-test").onclick = stopPreview;

  sensitivity.oninput = () => {
    const value = Number(sensitivity.value);
    audioEngine.setSensitivity(value / 100);
    document.getElementById("mic-sensitivity-value").value = `${value}%`;
  };

  noiseSuppression.onchange = async () => {
    audioEngine.setNoiseSuppression(noiseSuppression.checked);
    if (previewActive && !audioEngine.isRecording) {
      stopPreview();
      await startPreview();
    } else {
      showStatus(
        audioEngine.isRecording
          ? "La reducción de ruido se aplicará en la próxima grabación."
          : "Ajuste guardado para la próxima prueba.",
        "#4ade80",
      );
    }
  };

  dialog.addEventListener("close", stopPreview);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

export function openMicCalibration(onEnabled = null) {
  const dialog = document.getElementById("mic-calibration-dialog");
  onMicrophoneEnabled = onEnabled;
  syncControls();
  showStatus("Solicitando acceso al micrófono...", "#cbd5e1");
  if (!dialog.open) dialog.showModal();
  startPreview();
}

export function closeMicCalibration() {
  const dialog = document.getElementById("mic-calibration-dialog");
  if (dialog.open) dialog.close();
}

function syncControls() {
  const settings = audioEngine.getMicrophoneSettings();
  const sensitivity = Math.round(settings.sensitivity * 100);
  document.getElementById("mic-sensitivity").value = sensitivity;
  document.getElementById("mic-sensitivity-value").value = `${sensitivity}%`;
  document.getElementById("mic-noise-suppression").checked =
    settings.noiseSuppression;
  document.getElementById("mic-noise-suppression").disabled =
    audioEngine.isRecording;
}

async function startPreview() {
  const dialog = document.getElementById("mic-calibration-dialog");
  const startButton = document.getElementById("btn-start-mic-test");
  const stopButton = document.getElementById("btn-stop-mic-test");
  const request = ++previewRequest;

  startButton.disabled = true;
  try {
    await audioEngine.startMicrophonePreview();
    if (request !== previewRequest || !dialog.open) {
      audioEngine.stopMicrophonePreview();
      return;
    }

    previewActive = true;
    stopButton.disabled = false;
    document.getElementById("mic-noise-suppression").disabled =
      audioEngine.isRecording;
    showStatus(
      audioEngine.isRecording
        ? "Se muestra el audio de la grabación. La sensibilidad se ajusta en vivo."
        : "Prueba activa. Habla con el volumen normal y ajusta la sensibilidad.",
      "#4ade80",
    );
    if (onMicrophoneEnabled) onMicrophoneEnabled();
    clearInterval(previewTimer);
    previewTimer = setInterval(renderPreview, 50);
    renderPreview();
  } catch (error) {
    console.error("No se pudo iniciar la prueba del micrófono:", error);
    startButton.disabled = false;
    stopButton.disabled = true;
    showStatus(
      "No se pudo acceder al micrófono. Revisa los permisos del navegador.",
      "#f87171",
    );
  }
}

function stopPreview() {
  previewRequest++;
  clearInterval(previewTimer);
  previewTimer = null;
  previewActive = false;
  audioEngine.stopMicrophonePreview();
  document.getElementById("btn-start-mic-test").disabled = false;
  document.getElementById("btn-stop-mic-test").disabled = true;
  document.getElementById("mic-level-fill").style.width = "0%";
  const canvas = document.getElementById("mic-preview-canvas");
  audioEngine.drawLiveWaveform(canvas);
}

function renderPreview() {
  const canvas = document.getElementById("mic-preview-canvas");
  const level = audioEngine.getInputLevel();
  const levelFill = document.getElementById("mic-level-fill");
  levelFill.style.width = `${level}%`;
  levelFill.style.background = level >= 80 ? "#f87171" : "#38bdf8";
  levelFill.parentElement.setAttribute("aria-valuenow", String(level));
  audioEngine.drawLiveWaveform(canvas);
}

function showStatus(message, color) {
  const status = document.getElementById("mic-calibration-status");
  status.innerText = message;
  status.style.color = color;
}
