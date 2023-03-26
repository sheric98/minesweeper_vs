import { WebSocketGame } from "./WebSocketGame";

const SOCKET_URL = "{0}";

var webSocketGame: null | WebSocketGame = null;
window.onload = () => {
    webSocketGame = new WebSocketGame(SOCKET_URL, document);
};
