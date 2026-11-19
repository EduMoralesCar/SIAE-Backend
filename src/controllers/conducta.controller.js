const prisma = require('../config/prisma');
const { getLimaDateParts } = require('../utils/dateHelper');
const { notificarPadresEstudiante } = require('../services/notificacion.service');
const { registrarAuditoria } = require('../services/auditoria.service');

const CATALOGO_CONDUCTA = {
  DEMERITO: [
    { codigo: 'DEM-01', categoria: 'Incumplimiento de uniforme escolar', puntos: -3, naturaleza: 'INCUMPLIMIENTO_NORMAS', gravedad: 'LEVE' },
    { codigo: 'DEM-02', categoria: 'Tardanza injustificada al aula tras recreo', puntos: -3, naturaleza: 'CONDUCTA', gravedad: 'LEVE' },
    { codigo: 'DEM-03', categoria: 'Interrupción reiterada de clase', puntos: -5, naturaleza: 'CONVIVENCIA', gravedad: 'MODERADA' },
    { codigo: 'DEM-04', categoria: 'Conflicto entre pares durante la jornada', puntos: -10, naturaleza: 'CONFLICTO', gravedad: 'MODERADA' },
    { codigo: 'DEM-05', categoria: 'Daño a mobiliario o bienes institucionales', puntos: -10, naturaleza: 'DANO_BIENES', gravedad: 'GRAVE' },
    { codigo: 'DEM-06', categoria: 'Evasión de aula o jornada escolar', puntos: -15, naturaleza: 'INCUMPLIMIENTO_NORMAS', gravedad: 'GRAVE' },
    { codigo: 'DEM-07', categoria: 'Falta grave de respeto a compañeros o personal', puntos: -15, naturaleza: 'CONVIVENCIA', gravedad: 'MUY_GRAVE' },
  ],
  MERITO: [
    { codigo: 'MER-01', categoria: 'Colaboración destacada en el aula', puntos: 5, naturaleza: 'CONVIVENCIA', gravedad: 'LEVE' },
    { codigo: 'MER-02', categoria: 'Liderazgo solidario y apoyo a compañeros', puntos: 5, naturaleza: 'CONVIVENCIA', gravedad: 'LEVE' },
    { codigo: 'MER-03', categoria: 'Representación del colegio en olimpiadas o concursos', puntos: 10, naturaleza: 'ACADEMICA', gravedad: 'LEVE' },
    { codigo: 'MER-04', categoria: 'Puntualidad y conducta ejemplar mensual', puntos: 10, naturaleza: 'CONDUCTA', gravedad: 'LEVE' },
  ],
};

function calcularSemaforoConducta(puntaje) {
  if (puntaje >= 76) {
    return { color: 'VERDE', nivel: 'ESTADO ÓPTIMO', requiereCitacion: false };
  }
  if (puntaje >= 61) {
    return { color: 'AMARILLO', nivel: 'ALERTA PREVENTIVA (TUTORÍA)', requiereCitacion: false };
  }
  return {
    color: 'ROJO',
    nivel: 'ALERTA CRÍTICA (DIRECCIÓN Y TOE - CITACIÓN OBLIGATORIA)',
    requiereCitacion: true,
  };
}

function obtenerCatalogo(req, res) {
  return res.json({ ok: true, catalogo: CATALOGO_CONDUCTA });
}

// ============================================================================
// 1. INCIDENCIAS CLASIFICADAS Y EVIDENCIAS (Secciones 35 a 40 y 77)
// ============================================================================
async function registrarIncidencia(req, res) {
  try {
    const {
      estudiante_id,
      tipo = 'DEMERITO',
      naturaleza = 'CONVIVENCIA',
      gravedad = 'MODERADA',
      categoria,
      puntos_aplicados = 0,
      descripcion,
      acciones_tomadas = '',
      requiere_citacion = false,
      evidencia = null,
    } = req.body;

    if (!estudiante_id || !categoria || !descripcion) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Complete el estudiante, la categoría/título y la descripción de la incidencia.',
      });
    }

    const estudiante = await prisma.estudiante.findUnique({
      where: { id: Number(estudiante_id) },
      include: { usuario: true, grado_seccion: true },
    });

    if (!estudiante) {
      return res.status(404).json({ ok: false, mensaje: 'Estudiante no encontrado.' });
    }

    let delta = Number(puntos_aplicados) || 0;
    if (tipo === 'DEMERITO' && delta > 0) delta = -delta;
    if (tipo === 'MERITO' && delta < 0) delta = Math.abs(delta);

    const nuevoPuntaje = Math.max(0, Math.min(100, estudiante.puntaje_conducta + delta));
    const semaforo = calcularSemaforoConducta(nuevoPuntaje);

    const resultado = await prisma.$transaction(async (tx) => {
      const totalInc = await tx.incidenciaConducta.count();
      const codigoInc = `INC-${String(totalInc + 45).padStart(5, '0')}`;

      const incidencia = await tx.incidenciaConducta.create({
        data: {
          codigo: codigoInc,
          estudiante_id: estudiante.id,
          registrado_por_id: req.usuario.id,
          tipo,
          naturaleza,
          gravedad,
          categoria: categoria.trim(),
          puntos_aplicados: delta,
          descripcion: descripcion.trim(),
          acciones_tomadas: acciones_tomadas?.trim() || null,
          estado: tipo === 'MERITO' ? 'CERRADA' : Boolean(requiere_citacion) ? 'CON_CITACION' : 'EN_SEGUIMIENTO',
          requiere_citacion: Boolean(requiere_citacion),
        },
        include: {
          registrado_por: {
            select: { nombres: true, apellidos: true, rol: true },
          },
        },
      });

      if (evidencia && evidencia.nombre_original) {
        const arch = await tx.archivo.create({
          data: {
            storage_key: `evidencias/incidencia_${incidencia.id}_${Date.now()}`,
            nombre_original: evidencia.nombre_original,
            mime_type: evidencia.mime_type || 'application/pdf',
            tamano_bytes: Number(evidencia.tamano_bytes) || 0,
            contenido_base64: evidencia.contenido_base64 || null,
            entidad_tipo: 'INCIDENCIA',
            entidad_id: incidencia.id,
            subido_por_id: req.usuario.id,
          },
        });
        await tx.evidenciaIncidencia.create({
          data: {
            incidencia_id: incidencia.id,
            archivo_id: arch.id,
          },
        });
      }

      const estActualizado = await tx.estudiante.update({
        where: { id: estudiante.id },
        data: { puntaje_conducta: nuevoPuntaje },
        include: { usuario: true, grado_seccion: true },
      });

      return { incidencia, estudiante: estActualizado };
    });

    await registrarAuditoria({
      usuario: req.usuario,
      accion: 'INCIDENCIA_REGISTRADA',
      entidad: 'INCIDENCIA',
      entidad_id: resultado.incidencia.id,
      estudiante_id: estudiante.id,
      descripcion: `Incidencia ${resultado.incidencia.codigo} (${naturaleza} - ${gravedad}) registrada para ${estudiante.usuario.nombres} ${estudiante.usuario.apellidos}: ${categoria}.`,
      metadata: {
        codigo: resultado.incidencia.codigo,
        naturaleza,
        gravedad,
        categoria,
        puntos_aplicados: delta,
      },
    });

    const esCritico = gravedad === 'GRAVE' || gravedad === 'MUY_GRAVE' || semaforo.color === 'ROJO';

    await notificarPadresEstudiante({
      estudianteId: estudiante.id,
      titulo:
        tipo === 'MERITO'
          ? `Reconocimiento Institucional (${resultado.incidencia.codigo})`
          : `Notificación de Incidencia (${resultado.incidencia.codigo} — Gravedad ${gravedad})`,
      mensaje: `Estimado padre de familia: Se informa que se ha registrado una situación (${naturaleza}: "${categoria}") relacionada con su hijo(a) ${estudiante.usuario.nombres} ${estudiante.usuario.apellidos}. Detalle: ${descripcion.trim()}. Se solicita revisar la información en la plataforma.`,
      tipo: esCritico ? 'ALERTA_CRITICA' : 'INCIDENCIA',
      notificarTutor: true,
      notificarDireccion: esCritico,
    });

    return res.status(201).json({
      ok: true,
      mensaje: `Incidencia ${resultado.incidencia.codigo} (${naturaleza} · ${gravedad}) registrada correctamente.`,
      semaforo,
      ...resultado,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

async function listarIncidencias(req, res) {
  try {
    const { estudiante_id, grado_seccion_id, tipo, naturaleza, gravedad, estado } = req.query;
    const where = {};

    if (estudiante_id) where.estudiante_id = Number(estudiante_id);
    if (tipo) where.tipo = tipo;
    if (naturaleza) where.naturaleza = naturaleza;
    if (gravedad) where.gravedad = gravedad;
    if (estado) where.estado = estado;
    if (grado_seccion_id) {
      where.estudiante = { grado_seccion_id: Number(grado_seccion_id) };
    }

    const incidencias = await prisma.incidenciaConducta.findMany({
      where,
      orderBy: { fecha_incidente: 'desc' },
      include: {
        estudiante: {
          include: {
            usuario: { select: { nombres: true, apellidos: true, dni: true } },
            grado_seccion: true,
          },
        },
        registrado_por: {
          select: { id: true, nombres: true, apellidos: true, rol: true },
        },
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
        citaciones: true,
      },
      take: 250,
    });

    return res.json({ ok: true, incidencias });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

async function cerrarIncidencia(req, res) {
  try {
    const { id } = req.params;
    const { comentario_cierre = 'Incidencia atendida y cerrada conforme al protocolo.' } = req.body;

    const actualizada = await prisma.incidenciaConducta.update({
      where: { id: Number(id) },
      data: {
        estado: 'CERRADA',
        fecha_cierre: new Date(),
        comentario_cierre: comentario_cierre.trim(),
      },
      include: {
        estudiante: { include: { usuario: true } },
      },
    });

    await registrarAuditoria({
      usuario: req.usuario,
      accion: 'INCIDENCIA_CERRADA',
      entidad: 'INCIDENCIA',
      entidad_id: actualizada.id,
      estudiante_id: actualizada.estudiante_id,
      descripcion: `Cierre de incidencia ${actualizada.codigo || `#${actualizada.id}`} de ${actualizada.estudiante.usuario.nombres} ${actualizada.estudiante.usuario.apellidos}. Conclusión: ${comentario_cierre}`,
    });

    return res.json({
      ok: true,
      mensaje: `Incidencia ${actualizada.codigo || `#${actualizada.id}`} marcada como CERRADA.`,
      incidencia: actualizada,
    });
  } catch (err) {
    return res.status(400).json({ ok: false, mensaje: err.message });
  }
}

// ============================================================================
// 2. CITACIONES A PADRES, CONFIRMACIÓN Y REPROGRAMACIÓN (Secciones 41 a 44)
// ============================================================================
async function listarCitaciones(req, res) {
  try {
    const { estudiante_id, estado } = req.query;
    const where = {};

    if (req.usuario.rol === 'PADRE') {
      const vinculos = await prisma.padreEstudiante.findMany({
        where: { padre_usuario_id: req.usuario.id },
        select: { estudiante_id: true },
      });
      const ids = vinculos.map((v) => v.estudiante_id);
      where.estudiante_id = estudiante_id && ids.includes(Number(estudiante_id))
        ? Number(estudiante_id)
        : { in: ids };
    } else if (estudiante_id) {
      where.estudiante_id = Number(estudiante_id);
    }

    if (estado) where.estado = estado;

    const citaciones = await prisma.citacion.findMany({
      where,
      orderBy: [{ fecha_programada: 'desc' }, { id: 'desc' }],
      include: {
        estudiante: {
          include: {
            usuario: { select: { id: true, nombres: true, apellidos: true, dni: true } },
            grado_seccion: true,
          },
        },
        incidencia: true,
        responsable: {
          select: { id: true, nombres: true, apellidos: true, rol: true },
        },
        reunion: {
          include: {
            participantes: true,
            actas: true,
          },
        },
      },
    });

    return res.json({ ok: true, citaciones });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

async function crearCitacion(req, res) {
  try {
    const {
      estudiante_id,
      incidencia_id = null,
      motivo,
      fecha_programada,
      hora_programada,
      lugar = 'Oficina de Tutoría',
      responsable_id,
      rol_responsable = 'TUTOR',
    } = req.body;

    if (!estudiante_id || !motivo || !fecha_programada || !hora_programada) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Complete el estudiante, motivo, fecha y hora de la citación.',
      });
    }

    const respId = responsable_id ? Number(responsable_id) : req.usuario.id;

    const citacion = await prisma.$transaction(async (tx) => {
      const c = await tx.citacion.create({
        data: {
          estudiante_id: Number(estudiante_id),
          incidencia_id: incidencia_id ? Number(incidencia_id) : null,
          motivo: motivo.trim(),
          fecha_programada,
          hora_programada,
          lugar: lugar.trim(),
          responsable_id: respId,
          rol_responsable,
          estado: 'PENDIENTE',
        },
        include: {
          estudiante: { include: { usuario: true, grado_seccion: true } },
          responsable: { select: { id: true, nombres: true, apellidos: true, rol: true } },
          incidencia: true,
        },
      });

      if (incidencia_id) {
        await tx.incidenciaConducta.update({
          where: { id: Number(incidencia_id) },
          data: {
            estado: 'CON_CITACION',
            requiere_citacion: true,
          },
        });
      }

      return c;
    });

    await registrarAuditoria({
      usuario: req.usuario,
      accion: 'CITACION_GENERADA',
      entidad: 'CITACION',
      entidad_id: citacion.id,
      estudiante_id: citacion.estudiante_id,
      descripcion: `Citación generada para el apoderado de ${citacion.estudiante.usuario.nombres} ${citacion.estudiante.usuario.apellidos} el ${fecha_programada} a las ${hora_programada} en ${lugar}. Atenderá: ${citacion.responsable.nombres} ${citacion.responsable.apellidos} (${rol_responsable}).`,
      metadata: {
        fecha_programada,
        hora_programada,
        lugar,
        rol_responsable,
        motivo,
      },
    });

    await notificarPadresEstudiante({
      estudianteId: citacion.estudiante_id,
      titulo: `Citación a Padre de Familia (${fecha_programada} — ${hora_programada})`,
      mensaje: `Se ha generado una citación para el día ${fecha_programada} a las ${hora_programada} en ${lugar}. Atenderá: ${citacion.responsable.nombres} ${citacion.responsable.apellidos} (${rol_responsable}). Motivo: ${motivo.trim()}. Por favor confirme su asistencia en la plataforma.`,
      tipo: 'CITACION',
    });

    return res.status(201).json({
      ok: true,
      mensaje: 'Citación generada y notificada al padre o apoderado.',
      citacion,
    });
  } catch (err) {
    return res.status(400).json({ ok: false, mensaje: err.message });
  }
}

/**
 * Sección 43 — Confirmación de la Citación por el Padre:
 * "Confirmo asistencia" | "No puedo asistir" | "Solicito reprogramación"
 */
async function responderCitacionPadre(req, res) {
  try {
    const { id } = req.params;
    const { respuesta_padre, comentario_padre = '' } = req.body;

    if (
      !['CONFIRMO_ASISTENCIA', 'NO_PUEDO_ASISTIR', 'SOLICITO_REPROGRAMACION'].includes(
        respuesta_padre
      )
    ) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Seleccione una respuesta válida (Confirmo asistencia, No puedo asistir o Solicito reprogramación).',
      });
    }

    let nuevoEstado = 'CONFIRMADA';
    if (respuesta_padre === 'NO_PUEDO_ASISTIR') nuevoEstado = 'NO_PUEDE_ASISTIR';
    if (respuesta_padre === 'SOLICITO_REPROGRAMACION') nuevoEstado = 'SOLICITA_REPROGRAMACION';

    const actualizada = await prisma.citacion.update({
      where: { id: Number(id) },
      data: {
        estado: nuevoEstado,
        respuesta_padre,
        comentario_padre: comentario_padre?.trim() || null,
        fecha_confirmacion: new Date(),
      },
      include: {
        estudiante: { include: { usuario: true, grado_seccion: true } },
        responsable: { select: { id: true, nombres: true, apellidos: true, rol: true } },
      },
    });

    await registrarAuditoria({
      usuario: req.usuario,
      accion: 'CITACION_RESPUESTA_PADRE',
      entidad: 'CITACION',
      entidad_id: actualizada.id,
      estudiante_id: actualizada.estudiante_id,
      descripcion: `El padre/apoderado ${req.usuario.nombres} ${req.usuario.apellidos} respondió "${respuesta_padre}" a la citación #${actualizada.id} de ${actualizada.estudiante.usuario.nombres} ${actualizada.estudiante.usuario.apellidos}.`,
      metadata: {
        respuesta_padre,
        comentario_padre,
      },
    });

    return res.json({
      ok: true,
      mensaje: `Su respuesta (${respuesta_padre.replace(/_/g, ' ')}) fue registrada correctamente.`,
      citacion: actualizada,
    });
  } catch (err) {
    return res.status(400).json({ ok: false, mensaje: err.message });
  }
}

/**
 * Sección 44 — Reprogramación de Citaciones conservando el historial de cambios
 */
async function reprogramarCitacion(req, res) {
  try {
    const { id } = req.params;
    const {
      fecha_programada,
      hora_programada,
      lugar,
      responsable_id,
      rol_responsable,
      motivo_reprogramacion = 'Reprogramación a solicitud del apoderado',
    } = req.body;

    const actual = await prisma.citacion.findUnique({
      where: { id: Number(id) },
      include: {
        estudiante: { include: { usuario: true } },
      },
    });

    if (!actual) {
      return res.status(404).json({ ok: false, mensaje: 'Citación no encontrada.' });
    }

    let historialPrevio = [];
    if (actual.historial_cambios) {
      try {
        historialPrevio = JSON.parse(actual.historial_cambios);
      } catch {
        historialPrevio = [];
      }
    }

    historialPrevio.push({
      fecha_anterior: actual.fecha_programada,
      hora_anterior: actual.hora_programada,
      lugar_anterior: actual.lugar,
      nueva_fecha: fecha_programada || actual.fecha_programada,
      nueva_hora: hora_programada || actual.hora_programada,
      nuevo_lugar: lugar || actual.lugar,
      motivo: motivo_reprogramacion,
      reprogramado_por: `${req.usuario.nombres} ${req.usuario.apellidos}`,
      timestamp: new Date().toISOString(),
    });

    const actualizada = await prisma.citacion.update({
      where: { id: actual.id },
      data: {
        fecha_programada: fecha_programada || actual.fecha_programada,
        hora_programada: hora_programada || actual.hora_programada,
        lugar: lugar || actual.lugar,
        responsable_id: responsable_id ? Number(responsable_id) : actual.responsable_id,
        rol_responsable: rol_responsable || actual.rol_responsable,
        estado: 'REPROGRAMADA',
        historial_cambios: JSON.stringify(historialPrevio),
      },
      include: {
        estudiante: { include: { usuario: true, grado_seccion: true } },
        responsable: { select: { id: true, nombres: true, apellidos: true, rol: true } },
      },
    });

    await registrarAuditoria({
      usuario: req.usuario,
      accion: 'CITACION_REPROGRAMADA',
      entidad: 'CITACION',
      entidad_id: actualizada.id,
      estudiante_id: actualizada.estudiante_id,
      descripcion: `Citación #${actualizada.id} de ${actualizada.estudiante.usuario.nombres} ${actualizada.estudiante.usuario.apellidos} reprogramada del ${actual.fecha_programada} (${actual.hora_programada}) al ${actualizada.fecha_programada} (${actualizada.hora_programada}).`,
      metadata: historialPrevio[historialPrevio.length - 1],
    });

    await notificarPadresEstudiante({
      estudianteId: actualizada.estudiante_id,
      titulo: `Citación Reprogramada (${actualizada.fecha_programada} — ${actualizada.hora_programada})`,
      mensaje: `Su citación ha sido reprogramada para el día ${actualizada.fecha_programada} a las ${actualizada.hora_programada} en ${actualizada.lugar}. Por favor confirme su asistencia.`,
      tipo: 'CITACION',
    });

    return res.json({
      ok: true,
      mensaje: 'Citación reprogramada y conservada en el historial de cambios.',
      citacion: actualizada,
    });
  } catch (err) {
    return res.status(400).json({ ok: false, mensaje: err.message });
  }
}

// ============================================================================
// 3. REGISTRO DE REUNIONES CON PADRES (Sección 45)
// ============================================================================
async function listarReuniones(req, res) {
  try {
    const { estudiante_id } = req.query;
    const where = {};
    if (estudiante_id) where.estudiante_id = Number(estudiante_id);

    const reuniones = await prisma.reunion.findMany({
      where,
      orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
      include: {
        estudiante: {
          include: {
            usuario: { select: { id: true, nombres: true, apellidos: true, dni: true } },
            grado_seccion: true,
          },
        },
        citacion: true,
        responsable: {
          select: { id: true, nombres: true, apellidos: true, rol: true },
        },
        participantes: true,
        actas: {
          include: {
            compromisos: true,
          },
        },
      },
    });

    return res.json({ ok: true, reuniones });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

async function registrarReunion(req, res) {
  try {
    const {
      citacion_id = null,
      estudiante_id,
      fecha,
      hora,
      motivo,
      descripcion,
      acuerdos,
      observaciones = '',
      participantes = [],
    } = req.body;

    if (!estudiante_id || !motivo || !descripcion || !acuerdos) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Complete el estudiante, motivo, descripción de la reunión y acuerdos alcanzados.',
      });
    }

    const lima = getLimaDateParts();
    const listaParticipantes =
      Array.isArray(participantes) && participantes.length > 0
        ? participantes
        : [
            {
              nombre_participante: `${req.usuario.nombres} ${req.usuario.apellidos}`,
              rol_participante: req.usuario.rol,
              dni_participante: req.usuario.dni || null,
            },
          ];

    const reunion = await prisma.$transaction(async (tx) => {
      const r = await tx.reunion.create({
        data: {
          citacion_id: citacion_id ? Number(citacion_id) : null,
          estudiante_id: Number(estudiante_id),
          fecha: fecha || lima.fecha,
          hora: hora || lima.horaCorta,
          responsable_id: req.usuario.id,
          motivo: motivo.trim(),
          descripcion: descripcion.trim(),
          acuerdos: acuerdos.trim(),
          observaciones: observaciones?.trim() || null,
          participantes: {
            create: listaParticipantes.map((p) => ({
              nombre_participante: p.nombre_participante,
              rol_participante: p.rol_participante || 'Participante',
              dni_participante: p.dni_participante || null,
            })),
          },
        },
        include: {
          estudiante: { include: { usuario: true, grado_seccion: true } },
          responsable: { select: { id: true, nombres: true, apellidos: true, rol: true } },
          participantes: true,
        },
      });

      if (citacion_id) {
        await tx.citacion.update({
          where: { id: Number(citacion_id) },
          data: { estado: 'ATENDIDA' },
        });
      }

      return r;
    });

    await registrarAuditoria({
      usuario: req.usuario,
      accion: 'REUNION_REGISTRADA',
      entidad: 'REUNION',
      entidad_id: reunion.id,
      estudiante_id: reunion.estudiante_id,
      descripcion: `Reunión registrada con el apoderado de ${reunion.estudiante.usuario.nombres} ${reunion.estudiante.usuario.apellidos}. Motivo: ${reunion.motivo}.`,
      metadata: {
        acuerdos: reunion.acuerdos,
        participantes: reunion.participantes,
      },
    });

    return res.status(201).json({
      ok: true,
      mensaje: 'Reunión y acuerdos registrados en el expediente del estudiante.',
      reunion,
    });
  } catch (err) {
    return res.status(400).json({ ok: false, mensaje: err.message });
  }
}

// ============================================================================
// 4. ACTAS DE CONOCIMIENTO Y ACTAS DE COMPROMISO (Secciones 46, 47 y 78)
// ============================================================================
async function listarActas(req, res) {
  try {
    const { estudiante_id, tipo } = req.query;
    const where = {};

    if (req.usuario.rol === 'PADRE') {
      const vinculos = await prisma.padreEstudiante.findMany({
        where: { padre_usuario_id: req.usuario.id },
        select: { estudiante_id: true },
      });
      const ids = vinculos.map((v) => v.estudiante_id);
      where.estudiante_id = { in: ids };
    } else if (estudiante_id) {
      where.estudiante_id = Number(estudiante_id);
    }

    if (tipo) where.tipo = tipo;

    const actas = await prisma.acta.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        estudiante: {
          include: {
            usuario: { select: { id: true, nombres: true, apellidos: true, dni: true } },
            grado_seccion: true,
            padres: {
              include: {
                padre: { select: { id: true, nombres: true, apellidos: true, dni: true } },
              },
            },
          },
        },
        reunion: {
          include: { participantes: true },
        },
        creado_por: {
          select: { id: true, nombres: true, apellidos: true, rol: true },
        },
        compromisos: {
          include: {
            seguimientos: true,
          },
        },
      },
    });

    return res.json({ ok: true, actas });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

async function generarActa(req, res) {
  try {
    const {
      estudiante_id,
      reunion_id = null,
      tipo = 'COMPROMISO', // 'CONOCIMIENTO' | 'COMPROMISO' | 'OTRO'
      motivo,
      contenido,
      informacion_comunicada = '',
      observaciones = '',
      compromisos_iniciales = [],
    } = req.body;

    if (!estudiante_id || !motivo || !contenido) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Complete el estudiante, el motivo y el contenido del acta institucional.',
      });
    }

    const acta = await prisma.$transaction(async (tx) => {
      const totalActas = await tx.acta.count();
      const codigoActa = `ACT-${String(totalActas + 11).padStart(5, '0')}`;

      const nuevaActa = await tx.acta.create({
        data: {
          codigo: codigoActa,
          estudiante_id: Number(estudiante_id),
          reunion_id: reunion_id ? Number(reunion_id) : null,
          tipo,
          motivo: motivo.trim(),
          contenido: contenido.trim(),
          informacion_comunicada: informacion_comunicada?.trim() || null,
          observaciones: observaciones?.trim() || null,
          creado_por_id: req.usuario.id,
          aceptado_padre: false,
        },
        include: {
          estudiante: {
            include: {
              usuario: true,
              grado_seccion: true,
              padres: { include: { padre: true } },
            },
          },
          reunion: { include: { participantes: true } },
          creado_por: { select: { id: true, nombres: true, apellidos: true, rol: true } },
        },
      });

      // Si es Acta de Compromiso y se enviaron compromisos iniciales, crearlos automáticamente
      if (Array.isArray(compromisos_iniciales) && compromisos_iniciales.length > 0) {
        let countCmp = await tx.compromiso.count();
        for (const item of compromisos_iniciales) {
          if (!item.descripcion) continue;
          countCmp += 1;
          await tx.compromiso.create({
            data: {
              codigo: `CMP-${String(countCmp + 18).padStart(5, '0')}`,
              estudiante_id: Number(estudiante_id),
              acta_id: nuevaActa.id,
              descripcion: item.descripcion.trim(),
              responsable_compromiso: item.responsable_compromiso || 'Padre de familia',
              fecha_seguimiento: item.fecha_seguimiento || getLimaDateParts().fecha,
              estado: 'PENDIENTE',
            },
          });
        }
      }

      return nuevaActa;
    });

    await registrarAuditoria({
      usuario: req.usuario,
      accion: `ACTA_${tipo}_GENERADA`,
      entidad: 'ACTA',
      entidad_id: acta.id,
      estudiante_id: acta.estudiante_id,
      descripcion: `Acta de ${tipo} (${acta.codigo}) generada para ${acta.estudiante.usuario.nombres} ${acta.estudiante.usuario.apellidos}. Motivo: ${acta.motivo}.`,
      metadata: {
        codigo: acta.codigo,
        tipo,
        motivo: acta.motivo,
      },
    });

    await notificarPadresEstudiante({
      estudianteId: acta.estudiante_id,
      titulo: `Nueva Acta de ${tipo} (${acta.codigo})`,
      mensaje: `Se ha generado el Acta de ${tipo} ${acta.codigo} correspondiente al estudiante ${acta.estudiante.usuario.nombres} ${acta.estudiante.usuario.apellidos}. Puede revisarla y confirmar su aceptación en el portal.`,
      tipo: 'ACTA',
    });

    return res.status(201).json({
      ok: true,
      mensaje: `Acta de ${tipo} (${acta.codigo}) generada y almacenada en el historial del estudiante.`,
      acta,
    });
  } catch (err) {
    return res.status(400).json({ ok: false, mensaje: err.message });
  }
}

async function aceptarActaPadre(req, res) {
  try {
    const { id } = req.params;
    const actualizada = await prisma.acta.update({
      where: { id: Number(id) },
      data: {
        aceptado_padre: true,
        fecha_aceptacion: new Date(),
      },
      include: {
        estudiante: { include: { usuario: true } },
      },
    });

    await registrarAuditoria({
      usuario: req.usuario,
      accion: 'ACTA_ACEPTADA_POR_PADRE',
      entidad: 'ACTA',
      entidad_id: actualizada.id,
      estudiante_id: actualizada.estudiante_id,
      descripcion: `Conformidad / aceptación digital registrada en el Acta ${actualizada.codigo} por ${req.usuario.nombres} ${req.usuario.apellidos}.`,
    });

    return res.json({
      ok: true,
      mensaje: `Conformidad registrada para el Acta ${actualizada.codigo}.`,
      acta: actualizada,
    });
  } catch (err) {
    return res.status(400).json({ ok: false, mensaje: err.message });
  }
}

// ============================================================================
// 5. COMPROMISOS Y SEGUIMIENTO DE COMPROMISOS (Sección 48)
// ============================================================================
async function listarCompromisos(req, res) {
  try {
    const { estudiante_id, estado } = req.query;
    const where = {};

    if (req.usuario.rol === 'PADRE') {
      const vinculos = await prisma.padreEstudiante.findMany({
        where: { padre_usuario_id: req.usuario.id },
        select: { estudiante_id: true },
      });
      const ids = vinculos.map((v) => v.estudiante_id);
      where.estudiante_id = { in: ids };
    } else if (estudiante_id) {
      where.estudiante_id = Number(estudiante_id);
    }

    if (estado) where.estado = estado;

    const compromisos = await prisma.compromiso.findMany({
      where,
      orderBy: [{ fecha_seguimiento: 'asc' }, { id: 'desc' }],
      include: {
        estudiante: {
          include: {
            usuario: { select: { id: true, nombres: true, apellidos: true, dni: true } },
            grado_seccion: true,
          },
        },
        acta: true,
        seguimientos: {
          orderBy: { created_at: 'desc' },
          include: {
            registrado_por: {
              select: { id: true, nombres: true, apellidos: true, rol: true },
            },
          },
        },
      },
    });

    return res.json({ ok: true, compromisos });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

async function crearCompromiso(req, res) {
  try {
    const {
      estudiante_id,
      acta_id = null,
      descripcion,
      responsable_compromiso = 'Padre de familia',
      fecha_seguimiento,
    } = req.body;

    if (!estudiante_id || !descripcion || !fecha_seguimiento) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Complete el estudiante, la descripción del compromiso y la fecha de seguimiento.',
      });
    }

    const totalCmp = await prisma.compromiso.count();
    const codigoCmp = `CMP-${String(totalCmp + 18).padStart(5, '0')}`;

    const compromiso = await prisma.compromiso.create({
      data: {
        codigo: codigoCmp,
        estudiante_id: Number(estudiante_id),
        acta_id: acta_id ? Number(acta_id) : null,
        descripcion: descripcion.trim(),
        responsable_compromiso: responsable_compromiso.trim(),
        fecha_seguimiento,
        estado: 'PENDIENTE',
      },
      include: {
        estudiante: { include: { usuario: true, grado_seccion: true } },
        acta: true,
      },
    });

    await registrarAuditoria({
      usuario: req.usuario,
      accion: 'COMPROMISO_CREADO',
      entidad: 'COMPROMISO',
      entidad_id: compromiso.id,
      estudiante_id: compromiso.estudiante_id,
      descripcion: `Compromiso ${compromiso.codigo} registrado para ${compromiso.estudiante.usuario.nombres} ${compromiso.estudiante.usuario.apellidos}. Fecha de seguimiento: ${fecha_seguimiento}.`,
    });

    return res.status(201).json({
      ok: true,
      mensaje: `Compromiso ${compromiso.codigo} registrado con fecha de seguimiento ${fecha_seguimiento}.`,
      compromiso,
    });
  } catch (err) {
    return res.status(400).json({ ok: false, mensaje: err.message });
  }
}

async function registrarSeguimientoCompromiso(req, res) {
  try {
    const { id } = req.params;
    const {
      resultado = 'CUMPLIDO', // 'EN_SEGUIMIENTO' | 'CUMPLIDO' | 'INCUMPLIDO' | 'CERRADO'
      observaciones,
      estado_compromiso,
    } = req.body;

    if (!observaciones) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Ingrese las observaciones de la evaluación de seguimiento.',
      });
    }

    const { fecha } = getLimaDateParts();
    const nuevoEstado = estado_compromiso || resultado;

    const seguimiento = await prisma.$transaction(async (tx) => {
      const seg = await tx.seguimientoCompromiso.create({
        data: {
          compromiso_id: Number(id),
          fecha,
          resultado,
          observaciones: observaciones.trim(),
          registrado_por_id: req.usuario.id,
        },
        include: {
          registrado_por: { select: { id: true, nombres: true, apellidos: true, rol: true } },
        },
      });

      await tx.compromiso.update({
        where: { id: Number(id) },
        data: { estado: nuevoEstado },
      });

      return seg;
    });

    const cmp = await prisma.compromiso.findUnique({
      where: { id: Number(id) },
      include: { estudiante: { include: { usuario: true } } },
    });

    await registrarAuditoria({
      usuario: req.usuario,
      accion: 'COMPROMISO_SEGUIMIENTO_REGISTRADO',
      entidad: 'COMPROMISO',
      entidad_id: Number(id),
      estudiante_id: cmp?.estudiante_id || null,
      descripcion: `Seguimiento registrado para el compromiso ${cmp?.codigo || `#${id}`}: Resultado "${resultado}" -> Estado "${nuevoEstado}". Observación: ${observaciones.trim()}`,
    });

    if (cmp) {
      await notificarPadresEstudiante({
        estudianteId: cmp.estudiante_id,
        titulo: `Seguimiento de Compromiso (${cmp.codigo} — ${nuevoEstado})`,
        mensaje: `Se realizó la revisión del compromiso "${cmp.descripcion}". Resultado: ${resultado}. Observaciones: ${observaciones.trim()}.`,
        tipo: 'COMPROMISO',
      });
    }

    return res.status(201).json({
      ok: true,
      mensaje: `Seguimiento registrado. Estado del compromiso actualizado a ${nuevoEstado}.`,
      seguimiento,
    });
  } catch (err) {
    return res.status(400).json({ ok: false, mensaje: err.message });
  }
}

module.exports = {
  obtenerCatalogo,
  registrarIncidencia,
  listarIncidencias,
  cerrarIncidencia,
  listarCitaciones,
  crearCitacion,
  responderCitacionPadre,
  reprogramarCitacion,
  listarReuniones,
  registrarReunion,
  listarActas,
  generarActa,
  aceptarActaPadre,
  listarCompromisos,
  crearCompromiso,
  registrarSeguimientoCompromiso,
  calcularSemaforoConducta,
};
