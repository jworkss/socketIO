"use strict";

function createGameService({
  io,
  rooms,
  connectedSockets,
  readJSON,
  writeJSON,
  AUDIO_FILE,
  USERS_FILE,
}) {
  function buildRoundSchedule(players) {
    return players.map((player) => ({
      hostId: player.id,
      hostName: player.username,
      mode: "audio",
    }));
  }

  function startGame(roomName) {
    const room = rooms.get(roomName);
    if (!room) return;

    room.inGame = true;
    room.schedule = buildRoundSchedule(room.players);
    room.currentRoundIndex = 0;
    io.emit("lobby:updated");
    startRound(roomName);
  }

  function registerGameHandlers(socket) {
    socket.on("game:audioSubmit", (payload, cb) => {
      const { roomName, audioSamples, sampleRate, waveform } = payload || {};
      const room = rooms.get(roomName);
      const user = connectedSockets.get(socket.id);
      if (!room || !room.inGame || !room.roundState) {
        return cb({ ok: false, error: "Ronda inactiva." });
      }
      if (user?.id !== room.roundState.hostId) {
        return cb({
          ok: false,
          error: "Solo el anfitrión puede enviar el audio.",
        });
      }
      if (!room.players.some((player) => player.id === user.id)) {
        return cb({ ok: false, error: "No perteneces a esta sala." });
      }
      if (
        room.roundState.guessPhaseActive ||
        room.roundState.resolved ||
        !Array.isArray(audioSamples) ||
        !Number.isInteger(sampleRate) ||
        sampleRate < 8000 ||
        sampleRate > 192000 ||
        audioSamples.length < 100 ||
        audioSamples.length >
          sampleRate * (room.roundState.recordingSeconds + 1) ||
        audioSamples.some(
          (value) => !Number.isFinite(value) || value < -1 || value > 1,
        ) ||
        !isValidWaveform(waveform)
      ) {
        return cb({
          ok: false,
          error: "El audio o la forma de onda no son válidos.",
        });
      }

      const audioData = readJSON(AUDIO_FILE);
      audioData.push({
        round: room.currentRoundIndex + 1,
        hostId: room.roundState.hostId,
        timestamp: Date.now(),
      });
      writeJSON(AUDIO_FILE, audioData);

      room.roundState.correctWaveform = waveform;
      room.roundState.submissions = new Map();
      room.roundState.guessPhaseActive = true;
      io.to(roomName).emit("game:audioGuessPhase", {
        audioSamples,
        sampleRate,
        guessingSeconds: room.roundState.guessingSeconds,
      });

      const roundState = room.roundState;
      setTimeout(
        () => resolveAudioRound(roomName, roundState),
        roundState.guessingSeconds * 1000 + 1000,
      );
      cb({ ok: true });
    });

    socket.on("game:submitWaveform", (payload, cb) => {
      const { roomName, waveform } = payload || {};
      const room = rooms.get(roomName);
      const user = connectedSockets.get(socket.id);
      if (
        !room ||
        !room.roundState ||
        !room.roundState.guessPhaseActive ||
        room.roundState.resolved ||
        !user
      ) {
        return cb({ ok: false, error: "La fase de dibujo ya no está activa." });
      }
      if (user.id === room.roundState.hostId) {
        return cb({ ok: false, error: "El anfitrión no participa en su ronda." });
      }
      if (!room.players.some((player) => player.id === user.id)) {
        return cb({ ok: false, error: "No perteneces a esta sala." });
      }
      if (room.roundState.submissions.has(user.id)) {
        return cb({ ok: false, error: "Ya enviaste tu dibujo." });
      }
      if (!isValidWaveform(waveform)) {
        return cb({ ok: false, error: "El dibujo enviado no es válido." });
      }

      room.roundState.submissions.set(user.id, waveform);
      cb({ ok: true });

      const participantCount = room.players.filter(
        (player) => player.id !== room.roundState.hostId,
      ).length;
      if (room.roundState.submissions.size === participantCount) {
        resolveAudioRound(roomName, room.roundState);
      }
    });
  }

  function resolveAudioRound(roomName, roundState) {
    const room = rooms.get(roomName);
    if (!room || room.roundState !== roundState || roundState.resolved) return;

    roundState.resolved = true;
    roundState.guessPhaseActive = false;
    const target = roundState.correctWaveform;
    const drawings = Array.from(
      roundState.submissions,
      ([playerId, waveform]) => {
        const player = room.players.find(
          (candidate) => candidate.id === playerId,
        );
        return {
          id: playerId,
          username: player ? player.username : "Jugador",
          waveform,
        error:
          waveform.reduce(
            (sum, amplitude, index) =>
              sum + Math.abs(amplitude - target[index]),
            0,
          ) / target.length,
        };
      },
    );
    const bestError =
      drawings.length > 0
        ? Math.min(...drawings.map((drawing) => drawing.error))
        : null;
    const closestIds =
      bestError === null
        ? []
        : drawings
            .filter((drawing) => Math.abs(drawing.error - bestError) < 0.001)
            .map((drawing) => drawing.id);

    closestIds.forEach((playerId) => {
      const player = room.players.find((candidate) => candidate.id === playerId);
      if (player) player.roomScore += 3;
    });

    deliverRoundResults(roomName, {
      referenceWaveform: target,
      playerWaveforms: drawings,
      closestIds,
    });
  }

  function startRound(roomName) {
    const room = rooms.get(roomName);
    if (!room) return;
    if (room.currentRoundIndex >= room.schedule.length) {
      return finishGame(roomName);
    }

    const roundConfig = room.schedule[room.currentRoundIndex];
    room.roundState = {
      roundNumber: room.currentRoundIndex + 1,
      totalRounds: room.schedule.length,
      hostId: roundConfig.hostId,
      hostName: roundConfig.hostName,
      mode: roundConfig.mode,
      recordingSeconds: room.roundSettings.recordingSeconds,
      guessingSeconds: room.roundSettings.guessingSeconds,
    };

    io.to(roomName).emit("game:roundStart", room.roundState);
  }

  function deliverRoundResults(roomName, waveformResults) {
    const room = rooms.get(roomName);
    if (!room) return;

    const scoreboard = room.players
      .map((player) => ({
        id: player.id,
        username: player.username,
        score: player.roomScore,
      }))
      .sort((a, b) => b.score - a.score);

    io.to(roomName).emit("game:roundResults", {
      scoreboard,
      currentRound: room.currentRoundIndex + 1,
      totalRounds: room.schedule.length,
      ...waveformResults,
    });

    setTimeout(() => {
      room.currentRoundIndex++;
      startRound(roomName);
    }, 6000);
  }

  function finishGame(roomName) {
    const room = rooms.get(roomName);
    if (!room) return;

    const users = readJSON(USERS_FILE);
    room.players.forEach((player) => {
      const user = users.find((candidate) => candidate.id === player.id);
      if (user) user.score += player.roomScore;
    });
    writeJSON(USERS_FILE, users);

    const finalScoreboard = room.players
      .map((player) => ({
        id: player.id,
        username: player.username,
        score: player.roomScore,
      }))
      .sort((a, b) => b.score - a.score);

    io.to(roomName).emit("game:finished", {
      winner: finalScoreboard[0],
      scoreboard: finalScoreboard,
    });

    room.inGame = false;
    room.currentRoundIndex = 0;
    room.roundState = null;
    room.players.forEach((player) => {
      player.isReady = false;
      player.roomScore = 0;
    });
    io.emit("lobby:updated");
  }

  return { registerGameHandlers, startGame };
}

function isValidWaveform(waveform) {
  return (
    Array.isArray(waveform) &&
    waveform.length === 100 &&
    waveform.every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 100,
    )
  );
}

module.exports = { createGameService };
