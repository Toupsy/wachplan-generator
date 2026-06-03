// Kompatibilitäts-Shim: der eigentliche Einstiegspunkt liegt unter server/.
// Erlaubt `node admin-server.js` weiterhin (z.B. bei veraltetem compose-/Portainer-
// command nach dem Repo-Umbau v0.2.8). Eigentlicher Code: server/admin-server.js.
require('./server/admin-server.js');
