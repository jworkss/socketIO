"use strict";

function registerAuthHandlers(socket, { connectedSockets, readJSON, writeJSON, USERS_FILE }) {
  socket.on("auth:register", ({ username, password }, cb) => {
    if (!username || !password || username.length < 4 || password.length < 4) {
      return cb({
        ok: false,
        error: "Usuario y clave deben tener mínimo 4 caracteres.",
      });
    }

    const users = readJSON(USERS_FILE);
    if (users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
      return cb({ ok: false, error: "El usuario ya existe." });
    }

    const newUser = {
      id: "u_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
      username,
      password,
      score: 0,
      role: "user",
    };
    users.push(newUser);
    writeJSON(USERS_FILE, users);
    cb({
      ok: true,
      user: {
        id: newUser.id,
        username: newUser.username,
        role: newUser.role,
        score: newUser.score,
      },
    });
  });

  socket.on("auth:login", ({ username, password }, cb) => {
    const users = readJSON(USERS_FILE);
    const user = users.find(
      (candidate) =>
        candidate.username === username && candidate.password === password,
    );
    if (!user) return cb({ ok: false, error: "Credenciales inválidas." });

    cb({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        score: user.score,
      },
    });
  });

  socket.on("auth:guest", (cb) => {
    const timestampId = "guest_" + Date.now();
    const guestUser = {
      id: timestampId,
      username: "Invitado_" + timestampId.slice(-4),
      score: 0,
      role: "guest",
    };
    cb({ ok: true, user: guestUser });
  });

  socket.on("session:bind", (userObj) => {
    connectedSockets.set(socket.id, { ...userObj, socketId: socket.id });
  });

  socket.on("admin:getUsers", (cb) => {
    const user = connectedSockets.get(socket.id);
    if (!user || user.role !== "admin") {
      return cb({ ok: false, error: "Acceso no autorizado." });
    }
    cb({ ok: true, users: readJSON(USERS_FILE) });
  });

  socket.on("admin:updateUser", ({ id, password, score }, cb) => {
    const currentUser = connectedSockets.get(socket.id);
    if (!currentUser || currentUser.role !== "admin") {
      return cb({ ok: false, error: "No autorizado." });
    }

    const users = readJSON(USERS_FILE);
    const target = users.find((user) => user.id === id);
    if (!target) return cb({ ok: false, error: "Usuario no encontrado." });

    if (password && password.length >= 4) target.password = password;
    if (score !== undefined) target.score = Number(score);
    writeJSON(USERS_FILE, users);
    cb({ ok: true });
  });
}

module.exports = { registerAuthHandlers };
