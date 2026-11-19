const prisma = require('../config/prisma');
const { getLimaDateParts } = require('../utils/dateHelper');
const { calcularSemaforoConducta } = require('./conducta.controller');
const { notificarPadresEstudiante } = require('../services/notificacion.service');
const { registrarAuditoria } = require('../services/auditoria.service');

async function listarActividades(req, res) {
  try {
    const { grado_seccion_id, docente_id } = req.query;
    const where = {};
    if (grado_seccion_id) where.grado_seccion_id = Number(grado_seccion_id);
    if (docente_id) where.docente_id = Number(docente_id);

    const actividades = await prisma.actividad.findMany({
      where,
      orderBy: { fecha_entrega: 'desc' },
      include: {
        grado_seccion: true,
        docente: { select: { id: true, nombres: true, apellidos: true } },
        calificaciones: {
          include: {
            estudiante: {
              include: {
                usuario: { select: { nombres: true, apellidos: true, dni: true } },
              },
            },
          },
        },
      },
    });

    return res.json({ ok: true, actividades });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

async function crearActividad(req, res) {
  try {
    const { grado_seccion_id, curso_nombre, titulo_actividad, descripcion, fecha_entrega } = req.body;
    if (!grado_seccion_id || !curso_nombre || !titulo_actividad || !fecha_entrega) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Complete grado/sección, curso, título y fecha de entrega.',
      });
    }

    const estudiantesSeccion = await prisma.estudiante.findMany({
      where: { grado_seccion_id: Number(grado_seccion_id) },
      select: { id: true },
    });

    const actividad = await prisma.actividad.create({
      data: {
        grado_seccion_id: Number(grado_seccion_id),
        docente_id: req.usuario.id,
        curso_nombre: curso_nombre.trim(),
        titulo_actividad: titulo_actividad.trim(),
        descripcion: descripcion || null,
        fecha_entrega,
        calificaciones: {
          create: estudiantesSeccion.map((e) => ({
            estudiante_id: e.id,
            estado_entrega: 'PENDIENTE',
          })),
        },
      },
      include: {
        grado_seccion: true,
        calificaciones: true,
      },
    });

    return res.status(201).json({
      ok: true,
      mensaje: `Actividad "${actividad.titulo_actividad}" creada y asignada a ${estudiantesSeccion.length} estudiantes.`,
      actividad,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

async function calificarActividadEstudiante(req, res) {
  try {
    const { actividad_id, estudiante_id, estado_entrega, nota, observacion } = req.body;
    if (!actividad_id || !estudiante_id || !estado_entrega) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Indique actividad, estudiante y estado de entrega.',
      });
    }

    const calificacion = await prisma.calificacionActividad.upsert({
      where: {
        actividad_id_estudiante_id: {
          actividad_id: Number(actividad_id),
          estudiante_id: Number(estudiante_id),
        },
      },
      update: {
        estado_entrega,
        nota: nota !== undefined && nota !== '' ? Number(nota) : null,
        observacion: observacion || null,
      },
      create: {
        actividad_id: Number(actividad_id),
        estudiante_id: Number(estudiante_id),
        estado_entrega,
        nota: nota !== undefined && nota !== '' ? Number(nota) : null,
        observacion: observacion || null,
      },
      include: {
        actividad: true,
        estudiante: { include: { usuario: true } },
      },
    });

    if (estado_entrega === 'NO_PRESENTO') {
      await notificarPadresEstudiante({
        estudianteId: Number(estudiante_id),
        titulo: `Tarea No Presentada — ${calificacion.actividad.curso_nombre}`,
        mensaje: `El estudiante ${calificacion.estudiante.usuario.nombres} ${calificacion.estudiante.usuario.apellidos} no presentó la actividad "${calificacion.actividad.titulo_actividad}".`,
        tipo: 'ACADEMICO',
      });
    }

    return res.json({
      ok: true,
      mensaje: 'Calificación actualizada correctamente.',
      calificacion,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

/**
 * Construye el resumen integral de un estudiante (usado tanto en Portal de Padres, Portal de Estudiante y Expediente)
 */
async function construirExpedienteEstudiante(estudianteId) {
  const { fecha: fechaHoy } = getLimaDateParts();

  const estudiante = await prisma.estudiante.findUnique({
    where: { id: Number(estudianteId) },
    include: {
      usuario: {
        select: { id: true, nombres: true, apellidos: true, dni: true, email: true, telefono: true },
      },
      grado_seccion: {
        include: {
          tutor_docente: {
            select: { id: true, nombres: true, apellidos: true, email: true, telefono: true },
          },
        },
      },
      padres: {
        include: {
          padre: {
            select: { id: true, nombres: true, apellidos: true, dni: true, email: true, telefono: true },
          },
        },
      },
      matriculas: {
        include: {
          anio_escolar: true,
          grado_seccion: true,
        },
        orderBy: { anio_escolar_num: 'desc' },
      },
      codigos_qr: {
        orderBy: { created_at: 'desc' },
      },
      asistencias: {
        orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
        include: {
          registrado_por: { select: { nombres: true, apellidos: true, rol: true } },
        },
        take: 60,
      },
      solicitudes_permiso: {
        orderBy: { created_at: 'desc' },
        include: {
          solicitado_por: { select: { nombres: true, apellidos: true } },
          revisado_por: { select: { nombres: true, apellidos: true, rol: true } },
          evidencias: {
            include: {
              archivo: {
                select: {
                  id: true,
                  nombre_original: true,
                  mime_type: true,
                  tamano_bytes: true,
                  contenido_base64: true,
                },
              },
            },
          },
        },
      },
      situaciones_salud: {
        orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
        include: {
          registrado_por: { select: { nombres: true, apellidos: true, rol: true } },
          confirmado_por: { select: { nombres: true, apellidos: true, rol: true } },
        },
      },
      autorizaciones_recojo: {
        orderBy: { created_at: 'desc' },
        include: {
          autorizado_por: { select: { nombres: true, apellidos: true, rol: true } },
        },
      },
      retiros: {
        orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
        include: {
          registrado_por: { select: { nombres: true, apellidos: true, rol: true } },
          autorizacion: true,
        },
      },
      incidencias: {
        orderBy: { fecha_incidente: 'desc' },
        include: {
          registrado_por: { select: { nombres: true, apellidos: true, rol: true } },
          evidencias: {
            include: {
              archivo: {
                select: { id: true, nombre_original: true, mime_type: true, tamano_bytes: true },
              },
            },
          },
        },
        take: 40,
      },
      citaciones: {
        orderBy: [{ fecha_programada: 'desc' }, { id: 'desc' }],
        include: {
          responsable: { select: { nombres: true, apellidos: true, rol: true } },
          incidencia: true,
          reunion: {
            include: {
              participantes: true,
            },
          },
        },
      },
      reuniones: {
        orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
        include: {
          responsable: { select: { nombres: true, apellidos: true, rol: true } },
          participantes: true,
        },
      },
      actas: {
        orderBy: { created_at: 'desc' },
        include: {
          creado_por: { select: { nombres: true, apellidos: true, rol: true } },
          reunion: { include: { participantes: true } },
          compromisos: {
            include: {
              seguimientos: {
                include: {
                  registrado_por: { select: { nombres: true, apellidos: true, rol: true } },
                },
              },
            },
          },
        },
      },
      compromisos: {
        orderBy: { created_at: 'desc' },
        include: {
          acta: true,
          seguimientos: {
            orderBy: { created_at: 'desc' },
            include: {
              registrado_por: { select: { nombres: true, apellidos: true, rol: true } },
            },
          },
        },
      },
      calificaciones: {
        include: {
          actividad: {
            include: {
              docente: { select: { nombres: true, apellidos: true } },
            },
          },
        },
        orderBy: { updated_at: 'desc' },
      },
    },
  });

  if (!estudiante) return null;

  const asistenciasGenerales = estudiante.asistencias.filter((a) => a.tipo_registro === 'GENERAL');
  const asistenciaHoy = asistenciasGenerales.find((a) => a.fecha === fechaHoy) || null;

  const resumenAsistencia = {
    totalDias: asistenciasGenerales.length,
    presentes: asistenciasGenerales.filter((a) => a.estado === 'PRESENTE').length,
    tardanzas: asistenciasGenerales.filter((a) => a.estado === 'TARDANZA').length,
    faltas: asistenciasGenerales.filter((a) => a.estado === 'FALTA').length,
    justificados: asistenciasGenerales.filter(
      (a) => a.estado === 'JUSTIFICADO' || a.estado === 'PERMISO'
    ).length,
    permisos: asistenciasGenerales.filter((a) => a.estado === 'PERMISO').length,
    retirados: asistenciasGenerales.filter((a) => a.estado === 'RETIRADO').length,
  };

  resumenAsistencia.porcentajeAsistencia =
    resumenAsistencia.totalDias > 0
      ? Math.round(
          ((resumenAsistencia.presentes +
            resumenAsistencia.tardanzas +
            resumenAsistencia.justificados +
            resumenAsistencia.retirados) /
            resumenAsistencia.totalDias) *
            100
        )
      : 100;

  return {
    ...estudiante,
    fechaHoy,
    asistenciaHoy,
    resumenAsistencia,
    semaforoConducta: calcularSemaforoConducta(estudiante.puntaje_conducta),
  };
}

async function obtenerPortalPadre(req, res) {
  try {
    let vinculos = [];

    if (req.usuario.rol === 'PADRE') {
      vinculos = await prisma.padreEstudiante.findMany({
        where: { padre_usuario_id: req.usuario.id },
      });
    } else if (req.query.estudiante_id) {
      vinculos = [{ estudiante_id: Number(req.query.estudiante_id), parentesco: 'APODERADO' }];
    } else {
      const primerEst = await prisma.estudiante.findFirst({ orderBy: { id: 'asc' } });
      if (primerEst) vinculos = [{ estudiante_id: primerEst.id, parentesco: 'PADRE' }];
    }

    const hijos = [];
    for (const v of vinculos) {
      const exp = await construirExpedienteEstudiante(v.estudiante_id);
      if (exp) {
        hijos.push({
          parentesco: v.parentesco,
          ...exp,
        });
      }
    }

    const notificaciones = await prisma.notificacion.findMany({
      where: { usuario_destino_id: req.usuario.id },
      orderBy: { created_at: 'desc' },
      take: 40,
    });

    return res.json({
      ok: true,
      hijos,
      notificaciones,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

async function obtenerPortalEstudiante(req, res) {
  try {
    let estudianteId = req.query.estudiante_id ? Number(req.query.estudiante_id) : null;

    if (!estudianteId) {
      const perfil = await prisma.estudiante.findUnique({
        where: { usuario_id: req.usuario.id },
      });
      if (perfil) {
        estudianteId = perfil.id;
      } else {
        const primero = await prisma.estudiante.findFirst({ orderBy: { id: 'asc' } });
        if (primero) estudianteId = primero.id;
      }
    }

    if (!estudianteId) {
      return res.status(404).json({ ok: false, mensaje: 'Perfil de estudiante no encontrado.' });
    }

    const expediente = await construirExpedienteEstudiante(estudianteId);
    return res.json({ ok: true, expediente });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

async function listarNotificaciones(req, res) {
  try {
    const notificaciones = await prisma.notificacion.findMany({
      where: { usuario_destino_id: req.usuario.id },
      orderBy: { created_at: 'desc' },
      take: 40,
    });
    const noLeidas = notificaciones.filter((n) => !n.leido).length;
    return res.json({ ok: true, noLeidas, notificaciones });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

async function marcarNotificacionesLeidas(req, res) {
  try {
    await prisma.notificacion.updateMany({
      where: { usuario_destino_id: req.usuario.id, leido: false },
      data: { leido: true },
    });
    return res.json({ ok: true, mensaje: 'Notificaciones marcadas como leídas.' });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

async function confirmarRecepcionNotificacion(req, res) {
  try {
    const { id } = req.params;
    const notif = await prisma.notificacion.findUnique({
      where: { id: Number(id) },
    });

    if (!notif) {
      return res.status(404).json({ ok: false, mensaje: 'Notificación no encontrada.' });
    }

    const ahora = new Date();
    const actualizada = await prisma.notificacion.update({
      where: { id: notif.id },
      data: {
        leido: true,
        confirmado: true,
        fecha_confirmacion: ahora,
      },
    });

    if (notif.referencia_tipo === 'SALUD' && notif.referencia_id) {
      await prisma.situacionSalud.updateMany({
        where: { id: notif.referencia_id },
        data: {
          confirmado_padre: true,
          fecha_confirmacion_padre: ahora,
          confirmado_por_id: req.usuario.id,
        },
      });
    }

    await registrarAuditoria({
      usuario: req.usuario,
      accion: 'NOTIFICACION_CONFIRMADA',
      entidad: 'NOTIFICACION',
      entidad_id: notif.id,
      estudiante_id: notif.estudiante_id,
      descripcion: `Confirmación de recepción («RECIBÍ LA NOTIFICACIÓN») registrada por ${req.usuario.nombres} ${req.usuario.apellidos} para "${notif.titulo}".`,
    });

    return res.json({
      ok: true,
      mensaje: 'Recepción de notificación confirmada.',
      notificacion: actualizada,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

module.exports = {
  listarActividades,
  crearActividad,
  calificarActividadEstudiante,
  construirExpedienteEstudiante,
  obtenerPortalPadre,
  obtenerPortalEstudiante,
  listarNotificaciones,
  marcarNotificacionesLeidas,
  confirmarRecepcionNotificacion,
};
