import { appState, socket, switchView } from "./app-state.js";

export function initializeAuth(refreshLobby) {
  document.getElementById("btn-login").onclick = () => {
    const username = document.getElementById("auth-username").value.trim();
    const password = document.getElementById("auth-password").value.trim();
    socket.emit("auth:login", { username, password }, handleAuth);
  };

  document.getElementById("btn-register").onclick = () => {
    const username = document.getElementById("auth-username").value.trim();
    const password = document.getElementById("auth-password").value.trim();
    socket.emit("auth:register", { username, password }, handleAuth);
  };

  document.getElementById("btn-guest").onclick = () => {
    socket.emit("auth:guest", handleAuth);
  };

  document.getElementById("btn-logout").onclick = () => location.reload();
  document.getElementById("btn-admin-close").onclick = () =>
    switchView("lobby");
  document.getElementById("btn-open-admin").onclick = () => {
    socket.emit("admin:getUsers", (res) => {
      if (!res.ok) return alert(res.error);
      renderUsers(res.users);
      switchView("admin");
    });
  };

  window.updateUser = (id) => {
    const score = document.getElementById(`sc-${id}`).value;
    const password = document.getElementById(`pw-${id}`).value;
    socket.emit("admin:updateUser", { id, score, password }, (res) => {
      if (res.ok) alert("Usuario actualizado.");
      else alert(res.error);
    });
  };

  function handleAuth(res) {
    if (!res.ok) {
      document.getElementById("auth-error").innerText = res.error;
      return;
    }

    appState.currentUser = res.user;
    socket.emit("session:bind", appState.currentUser);
    document.getElementById("user-display").innerText =
      `${res.user.username} (${res.user.role})`;
    if (res.user.role === "admin") {
      document.getElementById("btn-open-admin").classList.remove("hidden");
    }

    switchView("lobby");
    refreshLobby();
  }
}

function renderUsers(users) {
  const tbody = document.getElementById("admin-tbody");
  tbody.innerHTML = "";
  users.forEach((user) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${user.id}</td>
      <td>${user.username}</td>
      <td><input type="number" id="sc-${user.id}" value="${user.score}" style="width:70px"></td>
      <td><input type="text" id="pw-${user.id}" placeholder="Nueva clave" style="width:100px"></td>
      <td><button class="btn small success" onclick="updateUser('${user.id}')">Guardar</button></td>
    `;
    tbody.appendChild(row);
  });
}
