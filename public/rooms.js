import { appState, socket, switchView } from "./app-state.js";
import { openMicCalibration } from "./mic-calibration.js";

export function initializeRooms() {
  function refreshLobby() {
    socket.emit("lobby:list", (rooms) => {
      const list = document.getElementById("rooms-list");
      list.innerHTML = "";
      rooms.forEach((room) => {
        const item = document.createElement("li");
        item.innerHTML = `
          <span><strong>${room.name}</strong> (${room.playersCount}/5)</span>
          <button class="btn small primary" ${room.inGame || room.playersCount >= 5 ? "disabled" : ""} onclick="joinRoom('${room.name}')">
            ${room.inGame ? "Jugando" : "Unirse"}
          </button>
        `;
        list.appendChild(item);
      });
    });
  }

  socket.on("lobby:updated", refreshLobby);
  socket.on("room:state", renderRoom);
  socket.on("room:kicked", () => {
    alert("Has sido expulsado de la sala.");
    appState.currentRoom = null;
    switchView("lobby");
  });

  document.getElementById("btn-create-room").onclick = () => {
    socket.emit("lobby:create", (res) => {
      if (!res.ok) return alert(res.error);
      appState.currentRoom = res.roomName;
      switchView("room");
    });
  };

  window.joinRoom = (roomName) => {
    socket.emit("lobby:join", roomName, (res) => {
      if (!res.ok) return alert(res.error);
      appState.currentRoom = res.roomName;
      switchView("room");
    });
  };

  window.kickPlayer = (targetId) => {
    socket.emit("room:kick", { roomName: appState.currentRoom, targetId });
  };

  document.getElementById("btn-start-game").onclick = startGame;
  document.getElementById("btn-enable-mic").onclick = enableMicrophone;
  document.getElementById("recording-time").onchange = updateGameSettings;
  document.getElementById("guessing-time").onchange = updateGameSettings;
  document.getElementById("btn-ready").onclick = () => {
    socket.emit("room:readyToggle", appState.currentRoom);
  };
  document.getElementById("btn-leave-room").onclick = () => {
    socket.emit("room:leave", appState.currentRoom);
    appState.currentRoom = null;
    switchView("lobby");
  };

  return refreshLobby;

  function renderRoom(room) {
    appState.currentRoom = room.name;
    document.getElementById("room-title").innerText =
      `${room.name} (${room.players.length}/5 Jugadores)`;

    const list = document.getElementById("players-list");
    list.innerHTML = "";
    const isHost = room.creatorId === appState.currentUser.id;
    const settings = room.roundSettings || {
      recordingSeconds: 10,
      guessingSeconds: 30,
    };
    document.getElementById("recording-time").value =
      settings.recordingSeconds;
    document.getElementById("guessing-time").value = settings.guessingSeconds;
    document.getElementById("room-settings-summary").innerText =
      `Grabación: ${settings.recordingSeconds}s · Tiempo para dibujar: ${settings.guessingSeconds}s`;
    document
      .getElementById("host-game-settings")
      .classList.toggle("hidden", !isHost);

    room.players.forEach((player) => {
      const item = document.createElement("li");
      item.innerHTML = `
        <span>
          <strong>${player.username}</strong> ${player.id === room.creatorId ? "👑 (Anfitrión)" : ""}
          ${player.id === appState.currentUser.id ? "(Tú)" : ""} — 
          ${player.isReady ? '<span style="color:#4ade80;">LISTO</span>' : '<span style="color:#fbbf24;">ESPERANDO</span>'}
        </span>
        ${isHost && player.id !== appState.currentUser.id ? `<button class="btn small danger" onclick="kickPlayer('${player.id}')">Expulsar</button>` : ""}
      `;
      list.appendChild(item);
    });

    const startButton = document.getElementById("btn-start-game");
    if (!isHost) {
      startButton.classList.add("hidden");
      return;
    }
    startButton.classList.remove("hidden");

    if (room.players.length < 3) {
      startButton.disabled = true;
      startButton.innerText = `Faltan jugadores (${room.players.length}/3 mín.)...`;
    } else if (!room.players.every((player) => player.isReady)) {
      startButton.disabled = true;
      startButton.innerText = "Esperando que todos marquen Listo...";
    } else {
      startButton.disabled = false;
      startButton.innerText = `¡Iniciar Partida (${room.players.length} Rondas)!`;
    }
  }

  function startGame() {
    const startButton = document.getElementById("btn-start-game");
    startButton.disabled = true;
    startButton.innerText = "Iniciando...";

    socket.emit("room:start", appState.currentRoom, (res) => {
      if (!res.ok) {
        alert(res.error);
        startButton.disabled = false;
        startButton.innerText = "¡Iniciar Partida!";
      }
    });
  }

  function updateGameSettings() {
    socket.emit(
      "room:updateSettings",
      {
        roomName: appState.currentRoom,
        recordingSeconds: Number(
          document.getElementById("recording-time").value,
        ),
        guessingSeconds: Number(
          document.getElementById("guessing-time").value,
        ),
      },
      (res) => {
        if (!res.ok) alert(res.error);
      },
    );
  }

  function enableMicrophone() {
    const status = document.getElementById("mic-status");
    const readyButton = document.getElementById("btn-ready");
    status.innerText = "";
    openMicCalibration(() => {
      status.innerText = "Ya puedes marcarte como listo.";
      status.style.color = "#4ade80";
      readyButton.disabled = false;
    });
  }
}
