const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const { JWT_SECRET } = require('../middlewares/auth.middleware');
const { registrarAuditoria } = require('../services/auditoria.service');

async function login(req, res) {
  try {
    const { identificador, password } = req.body;
    if (!identificador || !password) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Ingrese su correo o DNI y su contraseña.',
      });
    }

    const usuario = await prisma.usuario.findFirst({
      where: {
        OR: [
          { email: identificador.trim().toLowerCase() },
          { dni: identificador.trim() },
        ],
      },
      include: {
        estudiante_perfil: {
          include: { grado_seccion: true },
        },
        secciones_tutoradas: true,
        hijos_vinculados: {
          include: {
            estudiante: {
              include: {
                usuario: true,
                grado_seccion: true,
              },
            },
          },
        },
      },
    });

    if (!usuario || !usuario.activo) {
      await registrarAuditoria({
        accion: 'LOGIN_FALLIDO',
        entidad: 'USUARIO',
        descripcion: `Intento de inicio de sesión fallido o cuenta inactiva para identificador "${identificador}".`,
      });
      return res.status(401).json({
        ok: false,
        mensaje: 'Credenciales incorrectas o usuario inactivo.',
      });
    }

    const passwordValido = await bcrypt.compare(password, usuario.password_hash);
    if (!passwordValido) {
      await registrarAuditoria({
        usuario,
        accion: 'LOGIN_PASSWORD_INCORRECTO',
        entidad: 'USUARIO',
        entidad_id: usuario.id,
        descripcion: `Contraseña incorrecta para el usuario ${usuario.email}.`,
      });
      return res.status(401).json({
        ok: false,
        mensaje: 'Contraseña incorrecta.',
      });
    }

    const payload = {
      id: usuario.id,
      nombres: usuario.nombres,
      apellidos: usuario.apellidos,
      dni: usuario.dni,
      email: usuario.email,
      rol: usuario.rol,
    };

    const token = jwt.sign(payload, JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    });

    await registrarAuditoria({
      usuario,
      accion: 'LOGIN_EXITOSO',
      entidad: 'USUARIO',
      entidad_id: usuario.id,
      descripcion: `Inicio de sesión exitoso (${usuario.rol}).`,
    });

    const { password_hash, ...usuarioSinPassword } = usuario;

    return res.json({
      ok: true,
      mensaje: `Bienvenido(a) ${usuario.nombres} ${usuario.apellidos}`,
      token,
      usuario: usuarioSinPassword,
    });
  } catch (err) {
    console.error('Error en login SIAE:', err);
    return res.status(500).json({
      ok: false,
      mensaje: 'Error interno al procesar el inicio de sesión.',
      detalle: err.message,
    });
  }
}

async function perfil(req, res) {
  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.usuario.id },
      include: {
        estudiante_perfil: {
          include: { grado_seccion: true },
        },
        secciones_tutoradas: true,
        hijos_vinculados: {
          include: {
            estudiante: {
              include: {
                usuario: true,
                grado_seccion: true,
              },
            },
          },
        },
      },
    });

    if (!usuario) {
      return res.status(404).json({ ok: false, mensaje: 'Usuario no encontrado.' });
    }

    const { password_hash, ...usuarioSinPassword } = usuario;
    return res.json({ ok: true, usuario: usuarioSinPassword });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

/**
 * Devuelve un usuario representativo por cada uno de los roles oficiales del sistema
 */
async function obtenerUsuariosDemo(req, res) {
  try {
    const roles = ['ADMIN', 'DIRECTOR', 'TUTOR', 'DOCENTE', 'AUXILIAR', 'PADRE', 'ESTUDIANTE'];
    const demos = [];

    for (const rol of roles) {
      const u = await prisma.usuario.findFirst({
        where: { rol, activo: true },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          nombres: true,
          apellidos: true,
          dni: true,
          email: true,
          rol: true,
        },
      });
      if (u) demos.push(u);
    }

    return res.json({ ok: true, demos });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

module.exports = {
  login,
  perfil,
  obtenerUsuariosDemo,
};
