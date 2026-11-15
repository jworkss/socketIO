"use strict";

const RECORDING_DURATIONS = [5, 10, 15, 20];
const GUESSING_DURATIONS = [15, 20, 30, 45, 60];

function registerRoomHandlers(
  socket,
  { io, rooms, connectedSockets, startGame },
) {
  socket.on("lobby:list", (cb) => {
    const roomList = [];
    rooms.forEach((room, name) => {
      roomList.push({
        name,
        creator: room.creatorName,
        playersCount: room.players.length,
        inGame: room.inGame,
      });
    });
    cb(roomList);
  });

  socket.on("lobby:create", (cb) => {
    const user = connectedSockets.get(socket.id);
    if (!user) return cb({ ok: false, error: "No autenticado" });

    const roomName = `Sala_${user.username}`;
    if (rooms.has(roomName)) {
      return cb({
        ok: false,
        error: "Ya tienes una sala activa con tu nombre",
      });
    }

    const newRoom = {
      name: roomName,
      creatorId: user.id,
      creatorName: user.username,
      inGame: false,
      players: [{ ...user, isReady: false, roomScore: 0 }],
      schedule: [],
      currentRoundIndex: 0,
      roundState: null,
      roundSettings: { recordingSeconds: 10, guessingSeconds: 30 },
    };

    rooms.set(roomName, newRoom);
    socket.join(roomName);
    cb({ ok: true, roomName });
    io.to(roomName).emit("room:state", newRoom);
    io.emit("lobby:updated");
  });

  socket.on("lobby:join", (roomName, cb) => {
    const user = connectedSockets.get(socket.id);
    if (!user) return cb({ ok: false, error: "No autenticado" });
    const room = rooms.get(roomName);
    if (!room) return cb({ ok: false, error: "Sala no existe" });
    if (room.inGame) return cb({ ok: false, error: "Partida ya en curso" });
    if (room.players.length >= 5) {
      return cb({ ok: false, error: "Sala llena (máximo 5 jugadores)" });
    }
    if (room.players.some((player) => player.id === user.id)) {
      return cb({ ok: false, error: "Ya estás en la sala" });
    }

    room.players.push({ ...user, isReady: false, roomScore: 0 });
    socket.join(roomName);
    cb({ ok: true, roomName });
    io.to(roomName).emit("room:state", room);
    io.emit("lobby:updated");
  });

  socket.on("room:readyToggle", (roomName) => {
    const room = rooms.get(roomName);
    const user = connectedSockets.get(socket.id);
    if (!room || !user) return;

    const player = room.players.find((candidate) => candidate.id === user.id);
    if (player) {
      player.isReady = !player.isReady;
      io.to(roomName).emit("room:state", room);
    }
  });

  socket.on(
    "room:updateSettings",
    ({ roomName, recordingSeconds, guessingSeconds }, cb) => {
      const room = rooms.get(roomName);
      const user = connectedSockets.get(socket.id);
      if (!room || !user || room.creatorId !== user.id) {
        return cb({ ok: false, error: "Solo el anfitrión puede cambiar los tiempos." });
      }
      if (room.inGame) {
        return cb({ ok: false, error: "No se pueden cambiar los tiempos durante la partida." });
      }
      if (
        !RECORDING_DURATIONS.includes(recordingSeconds) ||
        !GUESSING_DURATIONS.includes(guessingSeconds)
      ) {
        return cb({ ok: false, error: "Los tiempos seleccionados no son válidos." });
      }

      room.roundSettings = { recordingSeconds, guessingSeconds };
      io.to(roomName).emit("room:state", room);
      cb({ ok: true });
    },
  );

  socket.on("room:leave", (roomName) => {
    leaveCurrentRoom(socket, roomName, { io, rooms, connectedSockets });
  });

  socket.on("room:kick", ({ roomName, targetId }) => {
    const room = rooms.get(roomName);
    const user = connectedSockets.get(socket.id);
    if (!room || !user || room.creatorId !== user.id) return;

    const targetSocketEntry = Array.from(connectedSockets.entries()).find(
      ([, candidate]) => candidate.id === targetId,
    );
    if (targetSocketEntry) {
      const [targetSocketId] = targetSocketEntry;
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.leave(roomName);
        targetSocket.emit("room:kicked");
      }
    }

    room.players = room.players.filter((player) => player.id !== targetId);
    io.to(roomName).emit("room:state", room);
    io.emit("lobby:updated");
  });

  socket.on(
    "room:start",
    (roomName, cb) => {
      const room = rooms.get(roomName);
      const user = connectedSockets.get(socket.id);
      if (!room || !user || room.creatorId !== user.id) {
        return cb({ ok: false, error: "No autorizado." });
      }
      if (
        !room.roundSettings ||
        !RECORDING_DURATIONS.includes(room.roundSettings.recordingSeconds) ||
        !GUESSING_DURATIONS.includes(room.roundSettings.guessingSeconds)
      ) {
        return cb({
          ok: false,
          error: "Los tiempos seleccionados no son válidos.",
        });
      }
      if (room.players.length < 3 || room.players.length > 5) {
        return cb({
          ok: false,
          error: "Se requieren entre 3 y 5 jugadores para iniciar.",
        });
      }
      if (!room.players.every((player) => player.isReady)) {
        return cb({
          ok: false,
          error: "Todos los jugadores deben marcar 'Listo'.",
        });
      }

      startGame(roomName);
      cb({ ok: true });
    },
  );

  socket.on("disconnect", () => {
    rooms.forEach((room, roomName) => {
      if (room.players.some((player) => player.socketId === socket.id)) {
        leaveCurrentRoom(socket, roomName, { io, rooms, connectedSockets });
      }
    });
    connectedSockets.delete(socket.id);
  });
}

function leaveCurrentRoom(socket, roomName, { io, rooms, connectedSockets }) {
  const room = rooms.get(roomName);
  if (!room) return;
  const user = connectedSockets.get(socket.id);
  room.players = room.players.filter((player) => player.socketId !== socket.id);
  socket.leave(roomName);

  if (room.players.length === 0) {
    rooms.delete(roomName);
  } else {
    if (user && room.creatorId === user.id && room.players[0]) {
      room.creatorId = room.players[0].id;
      room.creatorName = room.players[0].username;
    }
    io.to(roomName).emit("room:state", room);
  }
  io.emit("lobby:updated");
}

module.exports = { registerRoomHandlers };
