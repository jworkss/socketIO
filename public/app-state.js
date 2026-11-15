export const socket = window.io();

export const appState = {
  currentUser: null,
  currentRoom: null,
  gameState: null,
};

const views = {
  auth: document.getElementById("view-auth"),
  admin: document.getElementById("view-admin"),
  lobby: document.getElementById("view-lobby"),
  room: document.getElementById("view-room"),
  game: document.getElementById("view-game"),
};

export function switchView(viewName) {
  Object.values(views).forEach((view) => view.classList.remove("active"));
  views[viewName].classList.add("active");
}
