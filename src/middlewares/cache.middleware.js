const { emitirActualizacion } = require('../services/socket.service');

/**
 * Middleware de caché en memoria de alta velocidad con invalidación instantánea en escrituras
 * y difusión automática por WebSocket (Socket.IO) a todos los perfiles conectados.
 */
const store = new Map();
const DEFAULT_TTL_MS = 45 * 1000; // 45 segundos

function limpiarCacheTotal() {
  store.clear();
}

function cacheMiddleware(req, res, next) {
  // Si es una operación de escritura (POST, PUT, PATCH, DELETE), invalidar caché y emitir evento en tiempo real
  if (req.method !== 'GET') {
    limpiarCacheTotal();

    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        limpiarCacheTotal();
        // No emitir broadcast global al iniciar sesión (ya se actualiza vía siae:presencia)
        if (!req.path.includes('/auth/login')) {
          emitirActualizacion({
            metodo: req.method,
            ruta: req.path,
            actor: req.usuario
              ? {
                  id: req.usuario.id,
                  nombre: `${req.usuario.nombres || ''} ${req.usuario.apellidos || ''}`.trim(),
                  rol: req.usuario.rol,
                }
              : null,
          });
        }
      }
    });

    return next();
  }

  // No cachear descargas binarias (como exportación Excel) ni notificaciones en tiempo real
  if (req.path.includes('exportar-excel') || req.path.includes('/notificaciones')) {
    return next();
  }

  const userKey = req.headers.authorization ? req.headers.authorization.slice(-24) : 'anon';
  const key = `${userKey}:${req.originalUrl}`;
  const cached = store.get(key);

  if (cached && Date.now() < cached.expiresAt) {
    return res.json(cached.payload);
  }

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 200 && res.statusCode < 300 && body && body.ok !== false) {
      store.set(key, {
        payload: body,
        expiresAt: Date.now() + DEFAULT_TTL_MS,
      });
    }
    return originalJson(body);
  };

  return next();
}

module.exports = {
  cacheMiddleware,
  limpiarCacheTotal,
};
