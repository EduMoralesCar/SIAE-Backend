require('dotenv').config();
const express = require('express');
const cors = require('cors');
const apiRoutes = require('./routes');
const { cacheMiddleware } = require('./middlewares/cache.middleware');
const { iniciarCronAsistencia } = require('./jobs/asistencia.cron');
const { getLimaDateParts } = require('./utils/dateHelper');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Endpoint de salud (útil para despertar el servicio en Render antes de la sustentación)
app.get('/api/health', (req, res) => {
  const lima = getLimaDateParts();
  res.json({
    ok: true,
    sistema: 'SIAE - Sistema Integral de Control de Asistencia Escolar',
    estado: 'OPERATIVO',
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

app.listen(PORT, () => {
  console.log('==================================================================');
  console.log(`🚀 Servidor Backend SIAE activo en: http://localhost:${PORT}`);
  console.log(`🏥 Healthcheck API:                 http://localhost:${PORT}/api/health`);
  console.log('==================================================================');
  iniciarCronAsistencia();
});
