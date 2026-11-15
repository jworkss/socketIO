"use strict";

const MIC_SETTINGS_KEY = "waveform-microphone-settings";
const MIN_SENSITIVITY = 0.5;
const MAX_SENSITIVITY = 2;

function clampSensitivity(value) {
  return Math.max(MIN_SENSITIVITY, Math.min(MAX_SENSITIVITY, value));
}

function loadMicrophoneSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(MIC_SETTINGS_KEY) || "{}");
    const sensitivity = Number(saved.sensitivity);
    return {
      sensitivity: Number.isFinite(sensitivity)
        ? clampSensitivity(sensitivity)
        : 1,
      noiseSuppression: saved.noiseSuppression !== false,
    };
  } catch (error) {
    console.error("No se pudieron cargar los ajustes del micrófono:", error);
    return { sensitivity: 1, noiseSuppression: true };
  }
}

class AudioEngine {
  constructor() {
    this.audioCtx = null;
    this.mediaRecorder = null;
    this.chunks = [];
    this.micStream = null;
    this.sourceNode = null;
    this.gainNode = null;
    this.compressorNode = null;
    this.analyser = null;
    this.monitorMuteNode = null;
    this.recordingDestination = null;
    this.inputPromise = null;
    this.isRecording = false;
    this.micSettings = loadMicrophoneSettings();
  }

  async init() {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.audioCtx.state === "suspended") {
      await this.audioCtx.resume();
    }
  }

  getMicrophoneSettings() {
    return { ...this.micSettings };
  }

  setSensitivity(value) {
    const sensitivity = clampSensitivity(Number(value));
    if (!Number.isFinite(sensitivity)) {
      throw new Error("La sensibilidad seleccionada no es válida.");
    }

    this.micSettings.sensitivity = sensitivity;
    if (this.gainNode && this.audioCtx) {
      this.gainNode.gain.setTargetAtTime(
        sensitivity,
        this.audioCtx.currentTime,
        0.03,
      );
    }
    this.saveMicrophoneSettings();
  }

  setNoiseSuppression(enabled) {
    this.micSettings.noiseSuppression = Boolean(enabled);
    this.saveMicrophoneSettings();
  }

  saveMicrophoneSettings() {
    try {
      localStorage.setItem(MIC_SETTINGS_KEY, JSON.stringify(this.micSettings));
    } catch (error) {
      console.error("No se pudieron guardar los ajustes del micrófono:", error);
    }
  }

  async ensureMicrophoneInput() {
    if (this.micStream) return;
    if (!this.inputPromise) {
      this.inputPromise = this.createMicrophoneInput();
    }

    const pendingInput = this.inputPromise;
    try {
      await pendingInput;
    } finally {
      if (this.inputPromise === pendingInput) this.inputPromise = null;
    }
  }

  async createMicrophoneInput() {
    await this.init();

    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: this.micSettings.noiseSuppression },
        autoGainControl: { ideal: false },
      },
      video: false,
    });

    try {
      this.sourceNode = this.audioCtx.createMediaStreamSource(this.micStream);
      this.gainNode = this.audioCtx.createGain();
      this.gainNode.gain.value = this.micSettings.sensitivity;
      this.compressorNode = this.audioCtx.createDynamicsCompressor();
      this.compressorNode.threshold.value = -12;
      this.compressorNode.knee.value = 6;
      this.compressorNode.ratio.value = 5;
      this.compressorNode.attack.value = 0.005;
      this.compressorNode.release.value = 0.15;
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.15;
      this.monitorMuteNode = this.audioCtx.createGain();
      this.monitorMuteNode.gain.value = 0;
      this.recordingDestination =
        this.audioCtx.createMediaStreamDestination();

      this.sourceNode.connect(this.gainNode);
      this.gainNode.connect(this.compressorNode);
      this.compressorNode.connect(this.analyser);
      this.compressorNode.connect(this.recordingDestination);
      this.analyser.connect(this.monitorMuteNode);
      this.monitorMuteNode.connect(this.audioCtx.destination);
    } catch (error) {
      this.stopMicrophoneInput();
      throw error;
    }
  }

  async startMicrophonePreview() {
    await this.ensureMicrophoneInput();
  }

  stopMicrophonePreview() {
    if (!this.isRecording) this.stopMicrophoneInput();
  }

  async startRecording() {
    if (this.isRecording) {
      throw new Error("Ya hay una grabación en curso.");
    }
    if (typeof MediaRecorder === "undefined") {
      throw new Error("Este navegador no permite grabar audio.");
    }

    await this.ensureMicrophoneInput();
    this.chunks = [];
    try {
      this.mediaRecorder = new MediaRecorder(
        this.recordingDestination.stream,
      );
    } catch (error) {
      this.stopMicrophoneInput();
      throw error;
    }

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };

    try {
      this.mediaRecorder.start();
      this.isRecording = true;
    } catch (error) {
      this.mediaRecorder = null;
      this.stopMicrophoneInput();
      throw error;
    }
  }

  stopRecording() {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") {
        this.isRecording = false;
        this.stopMicrophoneInput();
        resolve(null);
        return;
      }

      this.mediaRecorder.onstop = async () => {
        try {
          const blob = new Blob(this.chunks, { type: "audio/webm" });
          const arrayBuffer = await blob.arrayBuffer();
          const decodedBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
          resolve(decodedBuffer);
        } catch (error) {
          reject(error);
        } finally {
          this.isRecording = false;
          this.stopMicrophoneInput();
        }
      };

      try {
        this.mediaRecorder.stop();
      } catch (error) {
        this.isRecording = false;
        this.stopMicrophoneInput();
        reject(error);
      }
    });
  }

  stopMicrophoneInput() {
    if (this.sourceNode) this.sourceNode.disconnect();
    if (this.gainNode) this.gainNode.disconnect();
    if (this.compressorNode) this.compressorNode.disconnect();
    if (this.analyser) this.analyser.disconnect();
    if (this.monitorMuteNode) this.monitorMuteNode.disconnect();
    if (this.recordingDestination) {
      this.recordingDestination.stream
        .getTracks()
        .forEach((track) => track.stop());
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop());
    }

    this.sourceNode = null;
    this.gainNode = null;
    this.compressorNode = null;
    this.analyser = null;
    this.monitorMuteNode = null;
    this.recordingDestination = null;
    this.micStream = null;
  }

  getLiveWaveform(sampleCount = 128) {
    if (!this.analyser) return [];
    const data = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(data);
    return Array.from({ length: sampleCount }, (_, index) => {
      const sampleIndex = Math.floor((index * data.length) / sampleCount);
      return (data[sampleIndex] - 128) / 128;
    });
  }

  getInputLevel() {
    const samples = this.getLiveWaveform();
    if (samples.length === 0) return 0;
    const rms = Math.sqrt(
      samples.reduce((sum, sample) => sum + sample * sample, 0) /
        samples.length,
    );
    return Math.min(100, Math.round(rms * 500));
  }

  drawLiveWaveform(canvas, color = "#38bdf8") {
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;

    const pixelRatio = window.devicePixelRatio || 1;
    const width = Math.round(bounds.width * pixelRatio);
    const height = Math.round(bounds.height * pixelRatio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const context = canvas.getContext("2d");
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.fillStyle = "#0f172a";
    context.fillRect(0, 0, bounds.width, bounds.height);
    context.strokeStyle = "#334155";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, bounds.height / 2);
    context.lineTo(bounds.width, bounds.height / 2);
    context.stroke();

    const samples = this.getLiveWaveform();
    if (samples.length < 2) return;
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.beginPath();
    samples.forEach((sample, index) => {
      const x = (index / (samples.length - 1)) * bounds.width;
      const y = bounds.height / 2 - sample * (bounds.height * 0.45);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
  }

  // Normaliza amplitudes lineales a un rango relativo de 0 a 100%
  extractNormalizedPeaks(audioBuffer, numPoints = 100) {
    const rawData = audioBuffer.getChannelData(0);
    const peaks = [];
    let maxAmp = 0;

    for (let i = 0; i < numPoints; i++) {
      const start = Math.floor((i * rawData.length) / numPoints);
      const end = Math.max(start + 1, Math.floor(((i + 1) * rawData.length) / numPoints));
      let sum = 0;
      for (let j = start; j < end && j < rawData.length; j++) {
        sum += Math.abs(rawData[j]);
      }
      const avg = sum / Math.max(1, end - start);
      if (avg > maxAmp) maxAmp = avg;
      peaks.push(avg);
    }

    // Escalamiento porcentual uniforme (0-100)
    return peaks.map((p) => (maxAmp > 0 ? (p / maxAmp) * 100 : 0));
  }

  // Reproduce un AudioBuffer en los altavoces
  async playBuffer(audioBuffer) {
    await this.init();
    const source = this.audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioCtx.destination);
    source.start();
  }

  // Serializa y deserializa AudioBuffer para Socket.io
  bufferToArray(audioBuffer) {
    return Array.from(audioBuffer.getChannelData(0));
  }

  arrayToBuffer(rawArray, sampleRate = 44100) {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass();
    }
    const buf = this.audioCtx.createBuffer(1, rawArray.length, sampleRate);
    buf.copyToChannel(new Float32Array(rawArray), 0);
    return buf;
  }
}

window.audioEngine = new AudioEngine();
