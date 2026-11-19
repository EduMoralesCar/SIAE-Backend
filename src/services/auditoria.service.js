const prisma = require('../config/prisma');
const crypto = require('crypto');

/**
 * Genera un token QR único e independiente del DNI con el formato institucional:
 * Ejemplo: STU-8F72-A91C-X45 (Sección 13)
 */
function generarTokenQR() {
  const seg1 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const seg2 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const seg3 = crypto.randomBytes(2).toString('hex').toUpperCase().slice(0, 3);
  return `STU-${seg1}-${seg2}-${seg3}`;
}

/**
 * Registra un evento en la tabla transversal de Auditoría General (Secciones 64 y 65)
 */
async function registrarAuditoria({
  usuario = null,
  usuario_id = null,
  usuario_nombre = null,
  usuario_rol = null,
  accion,
  entidad,
  entidad_id = null,
  estudiante_id = null,
  descripcion,
  metadata = null,
}) {
  try {
    const uid = usuario?.id || usuario_id || null;
    const unombre =
      usuario_nombre ||
      (usuario ? `${usuario.nombres || ''} ${usuario.apellidos || ''}`.trim() : 'Sistema');
    const urol = usuario?.rol || usuario_rol || 'SISTEMA';

    return await prisma.auditoriaGeneral.create({
      data: {
        usuario_id: uid,
        usuario_nombre: unombre,
        usuario_rol: urol,
        accion,
        entidad,
        entidad_id: entidad_id ? Number(entidad_id) : null,
        estudiante_id: estudiante_id ? Number(estudiante_id) : null,
        descripcion,
        metadata: metadata
          ? typeof metadata === 'string'
            ? metadata
            : JSON.stringify(metadata)
          : null,
      },
    });
  } catch (error) {
    console.error('Error al registrar auditoría general:', error.message);
    return null;
  }
}

module.exports = {
  generarTokenQR,
  registrarAuditoria,
};
