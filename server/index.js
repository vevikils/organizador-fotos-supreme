// server/index.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');

const apiRouter = require('./api');

const app = express();
const PORT = process.env.PORT || 3850;

app.use(cors());
app.use(express.json());
app.use('/cache', express.static(path.join(__dirname, '..', 'cache')));
app.use('/api', apiRouter);
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const server = http.createServer(app);

function startServer() {
  return new Promise((resolve, reject) => {
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`[Servidor] Organizador de Fotos iniciado en http://127.0.0.1:${PORT}`);
      resolve({ server, port: PORT });
    });
    server.on('error', err => {
      if (err.code === 'EADDRINUSE') {
        const nextPort = Number(PORT) + 1;
        server.listen(nextPort, '127.0.0.1', () => {
          console.log(`[Servidor] Organizador de Fotos iniciado en http://127.0.0.1:${nextPort}`);
          resolve({ server, port: nextPort });
        });
      } else {
        reject(err);
      }
    });
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  startServer,
  PORT
};
