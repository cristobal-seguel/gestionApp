import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createApp } from './app.js';
import { config } from './config.js';

// Punto de entrada: activa HTTPS solo cuando se configuran certificado y clave.
const app = createApp();
const createServer = config.httpsOptions ? createHttpsServer : createHttpServer;
const server = createServer(config.httpsOptions ?? {}, app);
server.listen(config.PORT, () => {
  const protocol = config.httpsOptions ? 'https' : 'http';
  console.log(`API disponible en ${protocol}://localhost:${config.PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
// Cierra el servidor de forma ordenada al detener el proceso.
  process.on(signal, () => server.close(() => process.exit(0)));
}