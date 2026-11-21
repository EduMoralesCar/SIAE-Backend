const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middlewares/auth.middleware');

let io = null;
const conexionesActivas = new Map();

function construirOrigenesPermitidos() {
  const raw = process.env.FRONTEND_URL || '';
  const lista = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return lista.length > 0 ? lista : true;
}

function obtenerEstadoPresencia() {
  const porRol = {};
  const usuariosUnicos = new Map();

  for (const conn of conexionesActivas.values()) {
    if (!porRol[conn.rol]) {
      porRol[conn.rol] = { rol: conn.rol, conexiones: 0, usuarios: new Set() };
    }
    porRol[conn.rol].conexiones += 1;
    porRol[conn.rol].usuarios.add(conn.nombreCompleto);
    usuariosUnicos.set(`${conn.usuarioId}:${conn.rol}`, {
      id: conn.usuarioId,
      nombre: conn.nombreCompleto,
      rol: conn.rol,
    });
  }

  const rolesConectados = Object.values(porRol).map((r) => ({
    rol: r.rol,
    conexiones: r.conexiones,
    usuarios: Array.from(r.usuarios),
  }));

  return {
    totalConexiones: conexionesActivas.size,
    perfilesActivos: usuariosUnicos.size,
    rolesConectados,
  };
}

function emitirPresencia() {
  if (!io) return;
  io.emit('siae:presencia', obtenerEstadoPresencia());
}

function iniciarWebSocket(httpServer) {
  const origin = construirOrigenesPermitidos();

  io = new Server(httpServer, {
    cors: {
      origin,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      credentials: origin !== true,
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Autenticación JWT durante el handshake WebSocket
  io.use((socket, next) => {
    try {
      const authToken = socket.handshake.auth?.token;
      const headerAuth = socket.handshake.headers?.authorization;
      const rawToken =
        authToken ||
        (headerAuth && headerAuth.startsWith('Bearer ') ? headerAuth.split(' ')[1] : null);

      if (!rawToken) {
        return next(new Error('Token JWT requerido para conexión en tiempo real.'));
      }

      const decoded = jwt.verify(rawToken, JWT_SECRET);
      socket.usuario = decoded;
      return next();
    } catch {
      return next(new Error('Token JWT inválido o expirado.'));
    }
  });

  io.on('connection', (socket) => {
    const u = socket.usuario;
    const nombreCompleto = `${u.nombres || ''} ${u.apellidos || ''}`.trim() || u.email;

    // Salas segmentadas por usuario, por rol y sala institucional
    socket.join(`user:${u.id}`);
    socket.join(`rol:${u.rol}`);
    if (['ADMIN', 'DIRECTOR', 'TUTOR', 'DOCENTE', 'AUXILIAR'].includes(u.rol)) {
      socket.join('institucional');
    }

    conexionesActivas.set(socket.id, {
      usuarioId: u.id,
      nombreCompleto,
      rol: u.rol,
      conectadoEn: new Date().toISOString(),
    });

    emitirPresencia();

    socket.on('siae:solicitar-presencia', () => {
      socket.emit('siae:presencia', obtenerEstadoPresencia());
    });

    socket.on('disconnect', () => {
      conexionesActivas.delete(socket.id);
      emitirPresencia();
    });
  });

  return io;
}

function clasificarModuloPorRuta(ruta = '') {
  const r = String(ruta).toLowerCase();
  if (r.includes('/asistencia')) return 'asistencia';
  if (r.includes('/salud')) return 'salud';
  if (r.includes('/retiros')) return 'retiros';
  if (r.includes('/permisos')) return 'permisos';
  if (r.includes('/autorizaciones-recojo')) return 'autorizaciones';
  if (r.includes('/citaciones')) return 'citaciones';
  if (r.includes('/reuniones')) return 'reuniones';
  if (r.includes('/actas')) return 'actas';
  if (r.includes('/compromisos')) return 'compromisos';
  if (r.includes('/conducta')) return 'conducta';
  if (r.includes('/actividades') || r.includes('/docente') || r.includes('/calificaciones')) {
    return 'academico';
  }
  if (r.includes('/carnets')) return 'carnets';
  if (r.includes('/notificaciones')) return 'notificaciones';
  if (r.includes('/reportes')) return 'reportes';
  if (r.includes('/admin/configuracion')) return 'configuracion';
  if (r.includes('/admin')) return 'usuarios';
  return 'general';
}

function emitirActualizacion({ modulo, metodo, ruta, actor = null, detalle = '' }) {
  if (!io) return;
  io.emit('siae:actualizacion', {
    modulo: modulo || clasificarModuloPorRuta(ruta),
    metodo,
    ruta,
    actor,
    detalle,
    timestamp: new Date().toISOString(),
  });
}

function emitirNotificacionUsuario(usuarioId, notificacion) {
  if (!io || !usuarioId) return;
  io.to(`user:${usuarioId}`).emit('siae:notificacion', {
    ...notificacion,
    timestamp: new Date().toISOString(),
  });
}

module.exports = {
  iniciarWebSocket,
  obtenerEstadoPresencia,
  clasificarModuloPorRuta,
  emitirActualizacion,
  emitirNotificacionUsuario,
};
