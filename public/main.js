import { initializeAuth } from "./auth.js";
import { initializeGame } from "./game.js";
import { initializeMicrophoneCalibration } from "./mic-calibration.js";
import { initializeRooms } from "./rooms.js";

initializeMicrophoneCalibration();
const refreshLobby = initializeRooms();
initializeAuth(refreshLobby);
initializeGame();
