// Kompatibilitäts-Shim: der eigentliche Einstiegspunkt liegt unter server/.
// Erlaubt `node server.js` weiterhin (z.B. bei veraltetem compose-/Portainer-
// command nach dem Repo-Umbau v0.2.8). Eigentlicher Code: server/server.js.
require('./server/server.js');
