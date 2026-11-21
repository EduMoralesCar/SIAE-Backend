require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const apiRoutes = require('./routes');
const { cacheMiddleware } = require('./middlewares/cache.middleware');
const { iniciarCronAsistencia } = require('./jobs/asistencia.cron');
const { getLimaDateParts } = require('./utils/dateHelper');
const { iniciarWebSocket, obtenerEstadoPresencia } = require('./services/socket.service');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 4000;

const origenesPermitidos = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: origenesPermitidos.length > 0 ? origenesPermitidos : true,
    credentials: origenesPermitidos.length > 0,
  })
);
app.use(express.json({ limit: '10mb' }));

// Inicializar servidor WebSocket (Socket.IO) sobre el mismo puerto HTTP (listo para Render/Railway)
iniciarWebSocket(server);

// Endpoint de salud (útil para despertar el servicio en Render antes de la sustentación)
app.get('/api/health', (req, res) => {
  const lima = getLimaDateParts();
  res.json({
    ok: true,
    sistema: 'SIAE - Sistema Integral de Control de Asistencia Escolar',
    estado: 'OPERATIVO',
    websocket: 'ACTIVO',
    presencia: obtenerEstadoPresencia(),
    fechaHoraLima: `${lima.fecha} ${lima.hora}`,
  });
});

app.use('/api', cacheMiddleware, apiRoutes);

// Manejador global de errores
app.use((err, req, res, next) => {
  console.error('Error no controlado en SIAE:', err);
  res.status(500).json({
    ok: false,
    mensaje: 'Error interno en el servidor SIAE.',
    detalle: err.message,
  });
});

server.listen(PORT, () => {
  console.log('==================================================================');
  console.log(`🚀 Servidor Backend SIAE activo en: http://localhost:${PORT}`);
  console.log(`⚡ WebSocket Tiempo Real (Socket.IO): ws://localhost:${PORT}`);
  console.log(`🏥 Healthcheck API:                 http://localhost:${PORT}/api/health`);
  console.log('==================================================================');
  iniciarCronAsistencia();
});
