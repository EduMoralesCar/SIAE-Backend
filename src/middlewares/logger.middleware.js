const { getLimaDateParts } = require('../utils/dateHelper');

const MAX_LOGS = 200;
const logsRecientes = [];
const inicioServidorTs = Date.now();

const metricas = {
  totalPeticiones: 0,
  exitosas2xx: 0,
  errores4xx: 0,
  errores5xx: 0,
  latenciaAcumuladaMs: 0,
};

function requestLoggerMiddleware(req, res, next) {
  const inicio = process.hrtime.bigint();

  res.on('finish', () => {
    const fin = process.hrtime.bigint();
    const duracionMs = Number(fin - inicio) / 1e6;
    const duracionRedondeada = Math.round(duracionMs * 10) / 10;
    const status = res.statusCode;

    metricas.totalPeticiones += 1;
    metricas.latenciaAcumuladaMs += duracionRedondeada;
    if (status >= 500) metricas.errores5xx += 1;
    else if (status >= 400) metricas.errores4xx += 1;
    else metricas.exitosas2xx += 1;

    const nivel = status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO';
    const { fecha, hora } = getLimaDateParts();
    const timestampLima = `${fecha} ${hora}`;
    const usuario = req.usuario
      ? `${req.usuario.rol}:${req.usuario.email || req.usuario.id}`
      : 'ANONIMO';
    const ip =
      (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() ||
      req.socket?.remoteAddress ||
      'local';

    const entrada = {
      timestamp: timestampLima,
      nivel,
      metodo: req.method,
      ruta: req.originalUrl,
      estado: status,
      duracion_ms: duracionRedondeada,
      usuario,
      ip,
    };

    logsRecientes.unshift(entrada);
    if (logsRecientes.length > MAX_LOGS) {
      logsRecientes.pop();
    }

    // Salida estructurada a consola (capturada en tiempo real por Render / Railway / Cloud Logs)
    console.log(
      `[${timestampLima}] ${nivel.padEnd(5)} ${req.method.padEnd(6)} ${req.originalUrl} -> ${status} (${duracionRedondeada}ms) | ${usuario}`
    );
  });

  next();
}

function obtenerMonitorLogs(limite = 100) {
  const uptimeSegundos = Math.floor((Date.now() - inicioServidorTs) / 1000);
  const latenciaPromedioMs =
    metricas.totalPeticiones > 0
      ? Math.round((metricas.latenciaAcumuladaMs / metricas.totalPeticiones) * 10) / 10
      : 0;

  return {
    uptimeSegundos,
    inicioServidor: new Date(inicioServidorTs).toISOString(),
    memoriaMB: Math.round((process.memoryUsage().rss / (1024 * 1024)) * 10) / 10,
    metricas: {
      totalPeticiones: metricas.totalPeticiones,
      exitosas2xx: metricas.exitosas2xx,
      errores4xx: metricas.errores4xx,
      errores5xx: metricas.errores5xx,
      latenciaPromedioMs,
    },
    logs: logsRecientes.slice(0, Math.min(Number(limite) || 100, MAX_LOGS)),
  };
}

module.exports = {
  requestLoggerMiddleware,
  obtenerMonitorLogs,
};
