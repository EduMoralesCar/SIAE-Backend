const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'siae_secret_jwt_key_universidad_2026_seguro';

function verificarToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      ok: false,
      mensaje: 'No autenticado. Token JWT no proporcionado.',
    });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.usuario = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      ok: false,
      mensaje: 'Sesión expirada o token inválido.',
    });
  }
}

function autorizarRoles(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ ok: false, mensaje: 'No autenticado.' });
    }
    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({
        ok: false,
        mensaje: `Acceso denegado. Se requiere uno de los roles: ${rolesPermitidos.join(', ')}`,
      });
    }
    next();
  };
}

module.exports = {
  verificarToken,
  autorizarRoles,
  JWT_SECRET,
};
