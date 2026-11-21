const cron = require('node-cron');
const prisma = require('../config/prisma');
const { getLimaDateParts, TIMEZONE } = require('../utils/dateHelper');
const { notificarPadresEstudiante } = require('../services/notificacion.service');
const { limpiarCacheTotal } = require('../middlewares/cache.middleware');
const { emitirActualizacion } = require('../services/socket.service');

/**
 * Identifica a todos los estudiantes activos sin marcación GENERAL en la fecha actual
 * y les registra automáticamente el estado FALTA, disparando alertas a sus padres.
 */
async function ejecutarCierreAsistenciaDiaria(fechaObjetivo = null, usuarioId = null) {
  const { fecha, hora } = getLimaDateParts();
  const targetDate = fechaObjetivo || fecha;

  const estudiantesActivos = await prisma.estudiante.findMany({
    where: {
      usuario: { activo: true },
    },
    include: {
      usuario: true,
      grado_seccion: true,
    },
  });

  const asistenciasHoy = await prisma.asistencia.findMany({
    where: {
      fecha: targetDate,
      tipo_registro: 'GENERAL',
    },
    select: { estudiante_id: true },
  });

  const idsConRegistro = new Set(asistenciasHoy.map((a) => a.estudiante_id));
  const sinRegistro = estudiantesActivos.filter((e) => !idsConRegistro.has(e.id));

  let faltasGeneradas = 0;

  for (const est of sinRegistro) {
    await prisma.asistencia.create({
      data: {
        estudiante_id: est.id,
        fecha: targetDate,
        hora_entrada: null,
        hora_salida: null,
        minutos_tardanza: 0,
        tipo_registro: 'GENERAL',
        estado: 'FALTA',
        registrado_por_id: usuarioId,
        motivo_justificacion: 'Cierre automático de asistencia (08:31 AM - Sin registro de entrada)',
      },
    });

    faltasGeneradas++;

    await notificarPadresEstudiante({
      estudianteId: est.id,
      titulo: `Inasistencia Registrada (${targetDate})`,
      mensaje: `El estudiante ${est.usuario.nombres} ${est.usuario.apellidos} (${est.grado_seccion.grado}° "${est.grado_seccion.seccion}") no registró ingreso antes del cierre de asistencia (${hora}). Se asignó FALTA INJUSTIFICADA.`,
      tipo: 'ALERTA_CRITICA',
    });
  }

  if (faltasGeneradas > 0) {
    limpiarCacheTotal();
    emitirActualizacion({
      modulo: 'asistencia',
      metodo: 'CRON',
      ruta: '/asistencia/cierre-diario',
      detalle: `Cierre automático: ${faltasGeneradas} faltas registradas`,
    });
  }

  return {
    fecha: targetDate,
    totalEstudiantes: estudiantesActivos.length,
    conAsistenciaPrevia: idsConRegistro.size,
    faltasGeneradas,
  };
}

function iniciarCronAsistencia() {
  // Se ejecuta de lunes a viernes a las 08:31 AM hora de Perú (America/Lima)
  cron.schedule(
    '31 8 * * 1-5',
    async () => {
      console.log('⏰ [CRON SIAE 08:31 AM] Ejecutando cierre automático de asistencia...');
      try {
        const resultado = await ejecutarCierreAsistenciaDiaria();
        console.log('✅ [CRON SIAE] Cierre completado:', resultado);
      } catch (err) {
        console.error('❌ [CRON SIAE] Error en cierre automático:', err.message);
      }
    },
    {
      timezone: TIMEZONE,
    }
  );

  console.log(`🕒 [SIAE Cron] Programado cierre automático de faltas (L-V 08:31 AM - ${TIMEZONE})`);
}

module.exports = {
  iniciarCronAsistencia,
  ejecutarCierreAsistenciaDiaria,
};
