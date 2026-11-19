const prisma = require('../config/prisma');
const { getLimaDateParts } = require('../utils/dateHelper');
const { notificarPadresEstudiante, crearNotificacion } = require('../services/notificacion.service');
const { registrarAuditoria } = require('../services/auditoria.service');

const MIME_PERMITIDOS = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
];
const MAX_BYTES_ARCHIVO = 5 * 1024 * 1024; // 5 MB

/**
 * Helper interno para guardar un archivo/evidencia validando tipo y tamaño (Sección 70)
 */
async function guardarEvidenciaInterna(tx, evidencia, usuarioId, entidadTipo, entidadId = null) {
  if (!evidencia || !evidencia.nombre_original) return null;

  const mime = (evidencia.mime_type || 'application/pdf').toLowerCase();
  if (!MIME_PERMITIDOS.includes(mime)) {
    throw new Error('Tipo de archivo no permitido. Solo se aceptan PDF, JPG, PNG o WEBP.');
  }

  const tamano = Number(evidencia.tamano_bytes) || 0;
  if (tamano > MAX_BYTES_ARCHIVO) {
    throw new Error('El archivo excede el tamaño máximo permitido de 5 MB.');
  }

  const limpioNombre = String(evidencia.nombre_original).replace(/[^a-zA-Z0-9._-]/g, '_');
  const storageKey = `evidencias/${entidadTipo.toLowerCase()}_${Date.now()}_${limpioNombre}`;

  return tx.archivo.create({
    data: {
      storage_key: storageKey,
      nombre_original: evidencia.nombre_original,
      mime_type: mime,
      tamano_bytes: tamano,
      contenido_base64: evidencia.contenido_base64 || null,
      entidad_tipo: entidadTipo,
      entidad_id: entidadId ? Number(entidadId) : null,
      subido_por_id: usuarioId || null,
    },
  });
}

/**
 * Helper para obtener IDs de hijos asociados a un padre (Sección 11 y 68)
 */
async function obtenerIdsHijosPadre(padreUsuarioId) {
  const vinculos = await prisma.padreEstudiante.findMany({
    where: { padre_usuario_id: Number(padreUsuarioId) },
    select: { estudiante_id: true },
  });
  return vinculos.map((v) => v.estudiante_id);
}

// ============================================================================
// 1. ARCHIVOS Y EVIDENCIAS PROTEGIDAS (Sección 70)
// ============================================================================
async function obtenerArchivoEvidencia(req, res) {
  try {
    const { id } = req.params;
    const archivo = await prisma.archivo.findUnique({
      where: { id: Number(id) },
      include: {
        subido_por: { select: { id: true, nombres: true, apellidos: true, rol: true } },
      },
    });

    if (!archivo) {
      return res.status(404).json({ ok: false, mensaje: 'Archivo de evidencia no encontrado.' });
    }

    // Si es PADRE, solo puede ver archivos que él mismo subió o de sus hijos
    if (req.usuario.rol === 'PADRE' && archivo.subido_por_id !== req.usuario.id) {
      return res.status(403).json({
        ok: false,
        mensaje: 'Acceso restringido a usuarios autorizados.',
      });
    }

    return res.json({ ok: true, archivo });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

// ============================================================================
// 2. SOLICITUDES DE PERMISO Y APROBACIÓN (Secciones 23 y 24)
// ============================================================================
async function listarSolicitudesPermiso(req, res) {
  try {
    const { estudiante_id, estado, tipo } = req.query;
    const where = {};

    if (req.usuario.rol === 'PADRE') {
      const idsHijos = await obtenerIdsHijosPadre(req.usuario.id);
      where.estudiante_id = estudiante_id
        ? idsHijos.includes(Number(estudiante_id))
          ? Number(estudiante_id)
          : -1
        : { in: idsHijos };
    } else if (estudiante_id) {
      where.estudiante_id = Number(estudiante_id);
    }

    if (estado) where.estado = estado;
    if (tipo) where.tipo = tipo;

    const permisos = await prisma.solicitudPermiso.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        estudiante: {
          include: {
            usuario: { select: { id: true, nombres: true, apellidos: true, dni: true } },
            grado_seccion: true,
          },
        },
        solicitado_por: {
          select: { id: true, nombres: true, apellidos: true, rol: true },
        },
        revisado_por: {
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
                created_at: true,
              },
            },
          },
        },
      },
    });

    return res.json({ ok: true, permisos });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

async function crearSolicitudPermiso(req, res) {
  try {
    const {
      estudiante_id,
      fecha,
      fecha_fin,
      tipo = 'SALUD',
      descripcion,
      evidencia = null,
    } = req.body;

    if (!estudiante_id || !fecha || !descripcion) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Complete el estudiante, la fecha del permiso y la descripción.',
      });
    }

    if (req.usuario.rol === 'PADRE') {
      const idsHijos = await obtenerIdsHijosPadre(req.usuario.id);
      if (!idsHijos.includes(Number(estudiante_id))) {
        return res.status(403).json({
          ok: false,
          mensaje: 'Solo puede solicitar permisos para los estudiantes asociados a su cuenta.',
        });
      }
    }

    const permiso = await prisma.$transaction(async (tx) => {
      const nuevo = await tx.solicitudPermiso.create({
        data: {
          estudiante_id: Number(estudiante_id),
          solicitado_por_id: req.usuario.id,
          fecha,
          fecha_fin: fecha_fin || null,
          tipo,
          descripcion: descripcion.trim(),
          estado: 'PENDIENTE',
        },
        include: {
          estudiante: { include: { usuario: true, grado_seccion: true } },
        },
      });

      if (evidencia && evidencia.nombre_original) {
        const arch = await guardarEvidenciaInterna(
          tx,
          evidencia,
          req.usuario.id,
          'PERMISO',
          nuevo.id
        );
        if (arch) {
          await tx.evidenciaPermiso.create({
            data: {
              permiso_id: nuevo.id,
              archivo_id: arch.id,
            },
          });
        }
      }

      return nuevo;
    });

    await registrarAuditoria({
      usuario: req.usuario,
      accion: 'PERMISO_SOLICITADO',
      entidad: 'PERMISO',
      entidad_id: permiso.id,
      estudiante_id: permiso.estudiante_id,
      descripcion: `Solicitud de permiso (${tipo}) para ${permiso.estudiante.usuario.nombres} ${permiso.estudiante.usuario.apellidos} en fecha ${fecha}.`,
      metadata: { fecha, tipo, descripcion },
    });

    // Notificar a Dirección
    const directivos = await prisma.usuario.findMany({
      where: { rol: { in: ['DIRECTOR', 'ADMIN'] }, activo: true },
      select: { id: true },
    });
    for (const dir of directivos) {
      await crearNotificacion({
        usuarioDestinoId: dir.id,
        estudianteId: permiso.estudiante_id,
        titulo: `Nueva solicitud de permiso (${tipo})`,
        mensaje: `El apoderado de ${permiso.estudiante.usuario.nombres} ${permiso.estudiante.usuario.apellidos} (${permiso.estudiante.grado_seccion.grado}° "${permiso.estudiante.grado_seccion.seccion}") solicitó permiso para el ${fecha}.`,
        tipo: 'PERMISO',
      });
    }

    return res.status(201).json({
      ok: true,
      mensaje: 'Solicitud de permiso enviada correctamente para revisión.',
      permiso,
    });
  } catch (err) {
    return res.status(400).json({ ok: false, mensaje: err.message });
  }
}

async function revisarSolicitudPermiso(req, res) {
  try {
    const { id } = req.params;
    const { estado, respuesta_revision } = req.body;

    if (!['APROBADO', 'RECHAZADO'].includes(estado)) {
      return res.status(400).json({
        ok: false,
        mensaje: 'El estado de revisión debe ser APROBADO o RECHAZADO.',
      });
    }

    const existente = await prisma.solicitudPermiso.findUnique({
      where: { id: Number(id) },
      include: {
        estudiante: { include: { usuario: true, grado_seccion: true } },
      },
    });

    if (!existente) {
      return res.status(404).json({ ok: false, mensaje: 'Solicitud de permiso no encontrada.' });
    }

    const actualizado = await prisma.$transaction(async (tx) => {
      const p = await tx.solicitudPermiso.update({
        where: { id: existente.id },
        data: {
          estado,
          revisado_por_id: req.usuario.id,
          respuesta_revision:
            respuesta_revision?.trim() ||
            (estado === 'APROBADO' ? 'Solicitud aprobada.' : 'Solicitud rechazada.'),
          reviewed_at: new Date(),
        },
        include: {
          estudiante: { include: { usuario: true, grado_seccion: true } },
          solicitado_por: { select: { id: true, nombres: true, apellidos: true } },
          revisado_por: { select: { id: true, nombres: true, apellidos: true, rol: true } },
          evidencias: { include: { archivo: true } },
        },
      });

      // Si se aprueba el permiso, registrar o actualizar la asistencia de esa fecha con estado PERMISO
      if (estado === 'APROBADO') {
        const asisPrevia = await tx.asistencia.findFirst({
          where: {
            estudiante_id: existente.estudiante_id,
            fecha: existente.fecha,
            tipo_registro: 'GENERAL',
          },
        });

        const motivoPermiso = `Permiso aprobado (${existente.tipo}): ${existente.descripcion}`;
        if (asisPrevia) {
          const estadoAnt = asisPrevia.estado;
          await tx.asistencia.update({
            where: { id: asisPrevia.id },
            data: {
              estado: 'PERMISO',
              motivo_justificacion: motivoPermiso,
            },
          });
          await tx.auditoriaAsistencia.create({
            data: {
              asistencia_id: asisPrevia.id,
              modificado_por_id: req.usuario.id,
              estado_anterior: estadoAnt,
              estado_nuevo: 'PERMISO',
              motivo_cambio: motivoPermiso,
            },
          });
        } else {
          const nuevaAsis = await tx.asistencia.create({
            data: {
              estudiante_id: existente.estudiante_id,
              fecha: existente.fecha,
              tipo_registro: 'GENERAL',
              estado: 'PERMISO',
              registrado_por_id: req.usuario.id,
              motivo_justificacion: motivoPermiso,
            },
          });
          await tx.auditoriaAsistencia.create({
            data: {
              asistencia_id: nuevaAsis.id,
              modificado_por_id: req.usuario.id,
              estado_anterior: 'FALTA',
              estado_nuevo: 'PERMISO',
              motivo_cambio: motivoPermiso,
            },
          });
        }
      }

      return p;
    });

    await registrarAuditoria({
      usuario: req.usuario,
      accion: estado === 'APROBADO' ? 'PERMISO_APROBADO' : 'PERMISO_RECHAZADO',
      entidad: 'PERMISO',
      entidad_id: actualizado.id,
      estudiante_id: actualizado.estudiante_id,
      descripcion: `Solicitud de permiso #${actualizado.id} de ${actualizado.estudiante.usuario.nombres} ${actualizado.estudiante.usuario.apellidos} (${actualizado.fecha}) fue ${estado}.`,
      metadata: {
        estado,
        respuesta_revision: actualizado.respuesta_revision,
      },
    });

    await notificarPadresEstudiante({
      estudianteId: actualizado.estudiante_id,
      titulo: `Solicitud de Permiso ${estado} (${actualizado.fecha})`,
      mensaje: `La solicitud de permiso por ${actualizado.tipo} para ${actualizado.estudiante.usuario.nombres} ${actualizado.estudiante.usuario.apellidos} fue marcada como ${estado}. Observación: ${actualizado.respuesta_revision}`,
      tipo: 'PERMISO',
    });

    return res.json({
      ok: true,
      mensaje: `Solicitud de permiso marcada como ${estado}.`,
      permiso: actualizado,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

// ============================================================================
// 3. SITUACIONES DE SALUD DURANTE LA JORNADA Y CONFIRMACIÓN DEL PADRE (Secciones 25, 26, 27, 69)
// ============================================================================
async function listarSituacionesSalud(req, res) {
  try {
    const { estudiante_id, fecha, estado } = req.query;
    const where = {};

    // Principio de mínimo privilegio en información de salud (Sección 69)
    if (req.usuario.rol === 'PADRE') {
      const idsHijos = await obtenerIdsHijosPadre(req.usuario.id);
      where.estudiante_id = estudiante_id
        ? idsHijos.includes(Number(estudiante_id))
          ? Number(estudiante_id)
          : -1
        : { in: idsHijos };
    } else if (estudiante_id) {
      where.estudiante_id = Number(estudiante_id);
    }

    if (fecha) where.fecha = fecha;
    if (estado) where.estado = estado;

    const situaciones = await prisma.situacionSalud.findMany({
      where,
      orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
      include: {
        estudiante: {
          include: {
            usuario: { select: { id: true, nombres: true, apellidos: true, dni: true } },
            grado_seccion: true,
            padres: {
              include: {
                padre: { select: { id: true, nombres: true, apellidos: true, telefono: true } },
              },
            },
          },
        },
        registrado_por: {
          select: { id: true, nombres: true, apellidos: true, rol: true },
        },
        confirmado_por: {
          select: { id: true, nombres: true, apellidos: true, rol: true },
        },
        retiros: true,
      },
    });

    return res.json({ ok: true, situaciones });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

async function registrarSituacionSalud(req, res) {
  try {
    const {
      estudiante_id,
      tipo_situacion = 'MALESTAR',
      descripcion,
      accion_realizada,
      requiere_recojo = true,
    } = req.body;

    if (!estudiante_id || !descripcion || !accion_realizada) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Complete el estudiante, la descripción de la situación de salud y la acción realizada.',
      });
    }

    const { fecha, horaCorta } = getLimaDateParts();

    const situacion = await prisma.situacionSalud.create({
      data: {
        estudiante_id: Number(estudiante_id),
        registrado_por_id: req.usuario.id,
        fecha,
        hora: horaCorta,
        tipo_situacion,
        descripcion: descripcion.trim(),
        accion_realizada: accion_realizada.trim(),
        requiere_recojo: Boolean(requiere_recojo),
        estado: Boolean(requiere_recojo) ? 'PENDIENTE_RECOJO' : 'EN_OBSERVACION',
        notificado_padre: true,
        confirmado_padre: false,
      },
      include: {
        estudiante: {
          include: {
            usuario: true,
            grado_seccion: true,
            padres: true,
          },
        },
        registrado_por: {
          select: { id: true, nombres: true, apellidos: true, rol: true },
        },
      },
    });

    await registrarAuditoria({
      usuario: req.usuario,
      accion: 'SITUACION_SALUD_REGISTRADA',
      entidad: 'SALUD',
      entidad_id: situacion.id,
      estudiante_id: situacion.estudiante_id,
      descripcion: `Situación de salud (${tipo_situacion}) registrada para ${situacion.estudiante.usuario.nombres} ${situacion.estudiante.usuario.apellidos} a las ${horaCorta}. Estado: ${situacion.estado}.`,
      metadata: {
        tipo_situacion,
        requiere_recojo,
        accion_realizada,
      },
    });

    // Notificar a los padres con solicitud de confirmación de recepción (Secciones 26 y 27)
    const responsableNombre = `${req.usuario.nombres} ${req.usuario.apellidos} (${req.usuario.rol})`;
    for (const rel of situacion.estudiante.padres) {
      await prisma.notificacion.create({
        data: {
          usuario_destino_id: rel.padre_usuario_id,
          estudiante_id: situacion.estudiante_id,
          titulo: Boolean(requiere_recojo)
            ? `URGENTE: Situación de salud — Solicitud de recojo (${horaCorta})`
            : `Aviso de atención de salud en jornada (${horaCorta})`,
          mensaje: Boolean(requiere_recojo)
            ? `Estimado padre de familia: Se informa que el estudiante ${situacion.estudiante.usuario.nombres} ${situacion.estudiante.usuario.apellidos} presenta una situación de salud (${tipo_situacion}: ${descripcion.trim()}). Se solicita acercarse a la institución educativa para recoger al estudiante. Responsable: ${responsableNombre}.`
            : `Estimado padre de familia: Se informa que el estudiante ${situacion.estudiante.usuario.nombres} ${situacion.estudiante.usuario.apellidos} fue atendido por ${tipo_situacion} (${descripcion.trim()}). Acción: ${accion_realizada.trim()}.`,
          tipo: 'SALUD',
          requiere_confirmacion: true,
          referencia_tipo: 'SALUD',
          referencia_id: situacion.id,
        },
      });
    }

    return res.status(201).json({
      ok: true,
      mensaje: 'Situación de salud registrada y notificación enviada al padre o apoderado.',
      situacion,
    });
  } catch (err) {
    return res.status(400).json({ ok: false, mensaje: err.message });
  }
}

/**
 * Sección 27 — Confirmación del Padre: "RECIBÍ LA NOTIFICACIÓN"
 */
async function confirmarNotificacionSalud(req, res) {
  try {
    const { id } = req.params;

    const situacion = await prisma.situacionSalud.findUnique({
      where: { id: Number(id) },
      include: {
        estudiante: { include: { usuario: true } },
      },
    });

    if (!situacion) {
      return res.status(404).json({ ok: false, mensaje: 'Registro de salud no encontrado.' });
    }

    if (req.usuario.rol === 'PADRE') {
      const idsHijos = await obtenerIdsHijosPadre(req.usuario.id);
      if (!idsHijos.includes(situacion.estudiante_id)) {
        return res.status(403).json({
          ok: false,
          mensaje: 'No tiene autorización para confirmar este registro.',
        });
      }
    }

    const ahora = new Date();
    const actualizada = await prisma.situacionSalud.update({
      where: { id: situacion.id },
      data: {
        confirmado_padre: true,
        fecha_confirmacion_padre: ahora,
        confirmado_por_id: req.usuario.id,
        estado:
          situacion.estado === 'PENDIENTE_RECOJO' ? 'PADRE_CONFIRMADO' : situacion.estado,
      },
      include: {
        estudiante: { include: { usuario: true, grado_seccion: true } },
        registrado_por: { select: { id: true, nombres: true, apellidos: true, rol: true } },
        confirmado_por: { select: { id: true, nombres: true, apellidos: true, rol: true } },
      },
    });

    // Actualizar notificación vinculada
    await prisma.notificacion.updateMany({
      where: {
        referencia_tipo: 'SALUD',
        referencia_id: situacion.id,
      },
      data: {
        leido: true,
        confirmado: true,
        fecha_confirmacion: ahora,
      },
    });

    await registrarAuditoria({
      usuario: req.usuario,
      accion: 'SALUD_NOTIFICACION_CONFIRMADA',
      entidad: 'SALUD',
      entidad_id: situacion.id,
      estudiante_id: situacion.estudiante_id,
      descripcion: `Confirmación de recepción («RECIBÍ LA NOTIFICACIÓN») registrada por ${req.usuario.nombres} ${req.usuario.apellidos} para la situación de salud de ${situacion.estudiante.usuario.nombres} ${situacion.estudiante.usuario.apellidos}.`,
    });

    return res.json({
      ok: true,
      mensaje: 'Recepción de notificación confirmada y registrada con fecha y hora.',
      situacion: actualizada,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

// ============================================================================
// 4. AUTORIZACIONES DE RECOJO POR TERCERAS PERSONAS (Secciones 29, 30, 31, 33)
// ============================================================================
async function listarAutorizacionesRecojo(req, res) {
  try {
    const { estudiante_id, estado, dni_persona } = req.query;
    const where = {};

    if (req.usuario.rol === 'PADRE') {
      const idsHijos = await obtenerIdsHijosPadre(req.usuario.id);
      where.estudiante_id = estudiante_id
        ? idsHijos.includes(Number(estudiante_id))
          ? Number(estudiante_id)
          : -1
        : { in: idsHijos };
    } else if (estudiante_id) {
      where.estudiante_id = Number(estudiante_id);
    }

    if (estado) where.estado = estado;
    if (dni_persona) where.dni_persona = { contains: String(dni_persona).trim() };

    const autorizaciones = await prisma.autorizacionRecojo.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        estudiante: {
          include: {
            usuario: { select: { id: true, nombres: true, apellidos: true, dni: true } },
            grado_seccion: true,
          },
        },
        autorizado_por: {
          select: { id: true, nombres: true, apellidos: true, dni: true, rol: true },
        },
        retiros: true,
      },
    });

    return res.json({ ok: true, autorizaciones });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

async function crearAutorizacionRecojo(req, res) {
  try {
    const {
      estudiante_id,
      persona_autorizada,
      parentesco,
      dni_persona,
      telefono_persona,
      tipo_autorizacion = 'UN_SOLO_USO',
      valido_desde,
      valido_hasta,
      hora_aproximada,
      observaciones,
      evidencia = null,
    } = req.body;

    if (!estudiante_id || !persona_autorizada || !parentesco || !dni_persona) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Complete el estudiante, nombre completo de la persona autorizada, parentesco y DNI.',
      });
    }

    if (req.usuario.rol === 'PADRE') {
      const idsHijos = await obtenerIdsHijosPadre(req.usuario.id);
      if (!idsHijos.includes(Number(estudiante_id))) {
        return res.status(403).json({
          ok: false,
          mensaje: 'Solo puede registrar autorizaciones de recojo para sus hijos asociados.',
        });
      }
    }

    const hoy = getLimaDateParts().fecha;
    const desde = valido_desde || hoy;
    const hasta =
      tipo_autorizacion === 'PERMANENTE'
        ? valido_hasta || '2026-12-31'
        : valido_hasta || desde;

    const autorizacion = await prisma.$transaction(async (tx) => {
      let archivoId = null;
      if (evidencia && evidencia.nombre_original) {
        const arch = await guardarEvidenciaInterna(
          tx,
          evidencia,
          req.usuario.id,
          'AUTORIZACION_RECOJO'
        );
        if (arch) archivoId = arch.id;
      }

      return tx.autorizacionRecojo.create({
        data: {
          estudiante_id: Number(estudiante_id),
          autorizado_por_id: req.usuario.id,
          persona_autorizada: persona_autorizada.trim(),
          parentesco: parentesco.trim(),
          dni_persona: dni_persona.trim(),
          telefono_persona: telefono_persona?.trim() || null,
          tipo_autorizacion,
          valido_desde: desde,
          valido_hasta: hasta,
          hora_aproximada: hora_aproximada || null,
          observaciones: observaciones?.trim() || null,
          archivo_id: archivoId,
          estado: 'APROBADO',
        },
        include: {
          estudiante: { include: { usuario: true, grado_seccion: true } },
          autorizado_por: { select: { id: true, nombres: true, apellidos: true, rol: true } },
        },
      });
    });

    await registrarAuditoria({
      usuario: req.usuario,
      accion: 'AUTORIZACION_RECOJO_CREADA',
      entidad: 'AUTORIZACION_RECOJO',
      entidad_id: autorizacion.id,
      estudiante_id: autorizacion.estudiante_id,
      descripcion: `Autorización de recojo (${tipo_autorizacion}) creada para ${autorizacion.estudiante.usuario.nombres} ${autorizacion.estudiante.usuario.apellidos} a favor de ${autorizacion.persona_autorizada} (${autorizacion.parentesco}, DNI ${autorizacion.dni_persona}).`,
      metadata: {
        persona_autorizada: autorizacion.persona_autorizada,
        dni_persona: autorizacion.dni_persona,
        parentesco: autorizacion.parentesco,
        tipo_autorizacion,
        valido_desde: desde,
        valido_hasta: hasta,
      },
    });

    return res.status(201).json({
      ok: true,
      mensaje: `Autorización de recojo registrada para ${autorizacion.persona_autorizada} (DNI ${autorizacion.dni_persona}).`,
      autorizacion,
    });
  } catch (err) {
    return res.status(400).json({ ok: false, mensaje: err.message });
  }
}

async function cambiarEstadoAutorizacionRecojo(req, res) {
  try {
    const { id } = req.params;
    const { estado } = req.body;

    const actualizada = await prisma.autorizacionRecojo.update({
      where: { id: Number(id) },
      data: { estado },
      include: {
        estudiante: { include: { usuario: true } },
      },
    });

    await registrarAuditoria({
      usuario: req.usuario,
      accion: 'AUTORIZACION_RECOJO_ESTADO',
      entidad: 'AUTORIZACION_RECOJO',
      entidad_id: actualizada.id,
      estudiante_id: actualizada.estudiante_id,
      descripcion: `Autorización de recojo #${actualizada.id} (${actualizada.persona_autorizada}) cambiada a estado ${estado}.`,
    });

    return res.json({
      ok: true,
      mensaje: `Estado de autorización actualizado a ${estado}.`,
      autorizacion: actualizada,
    });
  } catch (err) {
    return res.status(400).json({ ok: false, mensaje: err.message });
  }
}

// ============================================================================
// 5. RETIRO DE ESTUDIANTES Y VERIFICACIÓN DE IDENTIDAD (Secciones 28, 31, 32, 34, 76)
// ============================================================================
async function listarRetirosEstudiantes(req, res) {
  try {
    const { estudiante_id, fecha } = req.query;
    const where = {};

    if (req.usuario.rol === 'PADRE') {
      const idsHijos = await obtenerIdsHijosPadre(req.usuario.id);
      where.estudiante_id = estudiante_id
        ? idsHijos.includes(Number(estudiante_id))
          ? Number(estudiante_id)
          : -1
        : { in: idsHijos };
    } else if (estudiante_id) {
      where.estudiante_id = Number(estudiante_id);
    }

    if (fecha) where.fecha = fecha;

    const retiros = await prisma.retiroEstudiante.findMany({
      where,
      orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
      include: {
        estudiante: {
          include: {
            usuario: { select: { id: true, nombres: true, apellidos: true, dni: true } },
            grado_seccion: true,
          },
        },
        autorizacion: true,
        situacion_salud: true,
        registrado_por: {
          select: { id: true, nombres: true, apellidos: true, rol: true },
        },
      },
    });

    return res.json({ ok: true, retiros });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

async function registrarRetiroEstudiante(req, res) {
  try {
    const {
      estudiante_id,
      motivo = 'Situación de salud',
      modalidad_recojo = 'PADRE_TITULAR', // 'PADRE_TITULAR' | 'TERCERO_AUTORIZADO'
      autorizacion_id = null,
      situacion_salud_id = null,
      recogido_por_nombre,
      recogido_por_dni,
      parentesco = 'Padre',
      documento_verificado = 'DNI',
      observaciones = '',
      evidencia = null,
    } = req.body;

    if (!estudiante_id || !recogido_por_nombre || !recogido_por_dni) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Seleccione el estudiante e ingrese el nombre y DNI verificado de la persona que lo recoge.',
      });
    }

    const { fecha, horaCorta } = getLimaDateParts();
    const dniLimpio = String(recogido_por_dni).trim();

    // Verificar estudiante y sus padres vinculados
    const estudiante = await prisma.estudiante.findUnique({
      where: { id: Number(estudiante_id) },
      include: {
        usuario: true,
        grado_seccion: true,
        padres: { include: { padre: true } },
      },
    });

    if (!estudiante) {
      return res.status(404).json({ ok: false, mensaje: 'Estudiante no encontrado.' });
    }

    // Sección 31: El sistema deberá evitar que una persona no autorizada pueda retirar al estudiante
    let autorizacionVerificada = null;
    const esPadreRegistrado = estudiante.padres.some((p) => p.padre.dni === dniLimpio);

    if (modalidad_recojo === 'TERCERO_AUTORIZADO' || (!esPadreRegistrado && autorizacion_id)) {
      if (!autorizacion_id) {
        // Buscar si tiene una autorización aprobada por DNI para hoy
        autorizacionVerificada = await prisma.autorizacionRecojo.findFirst({
          where: {
            estudiante_id: estudiante.id,
            dni_persona: dniLimpio,
            estado: 'APROBADO',
            valido_desde: { lte: fecha },
            valido_hasta: { gte: fecha },
          },
        });
      } else {
        autorizacionVerificada = await prisma.autorizacionRecojo.findUnique({
          where: { id: Number(autorizacion_id) },
        });
      }

      if (!autorizacionVerificada) {
        await registrarAuditoria({
          usuario: req.usuario,
          accion: 'INTENTO_RETIRO_NO_AUTORIZADO',
          entidad: 'RETIRO',
          estudiante_id: estudiante.id,
          descripcion: `BLOQUEO DE SEGURIDAD: Intento de retiro de ${estudiante.usuario.nombres} ${estudiante.usuario.apellidos} por persona sin autorización vigente (${recogido_por_nombre}, DNI ${dniLimpio}).`,
        });

        return res.status(403).json({
          ok: false,
          mensaje: `BLOQUEO DE SEGURIDAD: La persona ${recogido_por_nombre} (DNI ${dniLimpio}) no figura como padre titular ni cuenta con una autorización de recojo vigente para hoy.`,
        });
      }

      if (autorizacionVerificada.estado !== 'APROBADO') {
        return res.status(403).json({
          ok: false,
          mensaje: `La autorización seleccionada no está disponible (Estado actual: ${autorizacionVerificada.estado}).`,
        });
      }

      if (fecha < autorizacionVerificada.valido_desde || fecha > autorizacionVerificada.valido_hasta) {
        return res.status(403).json({
          ok: false,
          mensaje: `La autorización de recojo está fuera de su rango de vigencia (${autorizacionVerificada.valido_desde} al ${autorizacionVerificada.valido_hasta}).`,
        });
      }
    } else if (!esPadreRegistrado && modalidad_recojo === 'PADRE_TITULAR') {
      // Verificar si por DNI existe autorización activa aunque haya marcado padre titular
      autorizacionVerificada = await prisma.autorizacionRecojo.findFirst({
        where: {
          estudiante_id: estudiante.id,
          dni_persona: dniLimpio,
          estado: 'APROBADO',
          valido_desde: { lte: fecha },
          valido_hasta: { gte: fecha },
        },
      });

      if (!autorizacionVerificada) {
        return res.status(403).json({
          ok: false,
          mensaje: `El DNI ${dniLimpio} no corresponde al padre/madre registrado del estudiante ni tiene una autorización de tercero aprobada. Registre primero la autorización de recojo.`,
        });
      }
    }

    const retiro = await prisma.$transaction(async (tx) => {
      let archivoEvidenciaId = null;
      if (evidencia && evidencia.nombre_original) {
        const arch = await guardarEvidenciaInterna(tx, evidencia, req.usuario.id, 'RETIRO');
        if (arch) archivoEvidenciaId = arch.id;
      }

      const nuevoRetiro = await tx.retiroEstudiante.create({
        data: {
          estudiante_id: estudiante.id,
          autorizacion_id: autorizacionVerificada ? autorizacionVerificada.id : null,
          situacion_salud_id: situacion_salud_id ? Number(situacion_salud_id) : null,
          fecha,
          hora_salida: horaCorta,
          motivo: motivo.trim(),
          recogido_por_nombre: recogido_por_nombre.trim(),
          recogido_por_dni: dniLimpio,
          parentesco: parentesco.trim(),
          documento_verificado,
          registrado_por_id: req.usuario.id,
          archivo_evidencia_id: archivoEvidenciaId,
          observaciones: observaciones?.trim() || null,
        },
        include: {
          estudiante: { include: { usuario: true, grado_seccion: true } },
          autorizacion: true,
          situacion_salud: true,
          registrado_por: { select: { id: true, nombres: true, apellidos: true, rol: true } },
        },
      });

      // Si se utilizó una autorización de un solo uso / fecha específica / emergencia, marcarla como UTILIZADA (Sección 31 y 33)
      if (
        autorizacionVerificada &&
        ['UN_SOLO_USO', 'FECHA_ESPECIFICA', 'HORARIO_ESPECIFICO', 'EMERGENCIA'].includes(
          autorizacionVerificada.tipo_autorizacion
        )
      ) {
        await tx.autorizacionRecojo.update({
          where: { id: autorizacionVerificada.id },
          data: { estado: 'UTILIZADA' },
        });
      }

      // Si estaba vinculado a una situación de salud, marcarla como RETIRADO
      if (situacion_salud_id) {
        await tx.situacionSalud.update({
          where: { id: Number(situacion_salud_id) },
          data: { estado: 'RETIRADO' },
        });
      }

      // Actualizar o crear la asistencia del día con estado RETIRADO y hora_salida (Sección 17 y 28)
      const asistenciaHoy = await tx.asistencia.findFirst({
        where: {
          estudiante_id: estudiante.id,
          fecha,
          tipo_registro: 'GENERAL',
        },
      });

      const detalleRetiro = `Retirado a las ${horaCorta} por ${recogido_por_nombre.trim()} (${parentesco.trim()}, DNI ${dniLimpio}) — Motivo: ${motivo.trim()}`;

      if (asistenciaHoy) {
        const estadoAnt = asistenciaHoy.estado;
        await tx.asistencia.update({
          where: { id: asistenciaHoy.id },
          data: {
            estado: 'RETIRADO',
            hora_salida: `${horaCorta}:00`,
            motivo_justificacion: detalleRetiro,
          },
        });
        await tx.auditoriaAsistencia.create({
          data: {
            asistencia_id: asistenciaHoy.id,
            modificado_por_id: req.usuario.id,
            estado_anterior: estadoAnt,
            estado_nuevo: 'RETIRADO',
            motivo_cambio: detalleRetiro,
          },
        });
      } else {
        await tx.asistencia.create({
          data: {
            estudiante_id: estudiante.id,
            fecha,
            hora_salida: `${horaCorta}:00`,
            tipo_registro: 'GENERAL',
            estado: 'RETIRADO',
            registrado_por_id: req.usuario.id,
            motivo_justificacion: detalleRetiro,
          },
        });
      }

      return nuevoRetiro;
    });

    await registrarAuditoria({
      usuario: req.usuario,
      accion: 'RETIRO_ESTUDIANTE_REGISTRADO',
      entidad: 'RETIRO',
      entidad_id: retiro.id,
      estudiante_id: estudiante.id,
      descripcion: `Estudiante ${estudiante.usuario.nombres} ${estudiante.usuario.apellidos} retirado a las ${horaCorta} por ${retiro.recogido_por_nombre} (${retiro.parentesco}, DNI ${retiro.recogido_por_dni}). Motivo: ${retiro.motivo}.`,
      metadata: {
        hora_salida: horaCorta,
        recogido_por_nombre: retiro.recogido_por_nombre,
        recogido_por_dni: retiro.recogido_por_dni,
        parentesco: retiro.parentesco,
        autorizacion_id: retiro.autorizacion_id,
      },
    });

    await notificarPadresEstudiante({
      estudianteId: estudiante.id,
      titulo: `Retiro de Estudiante Registrado (${horaCorta})`,
      mensaje: `Se deja constancia del retiro del estudiante ${estudiante.usuario.nombres} ${estudiante.usuario.apellidos} a las ${horaCorta}. Persona que recogió: ${retiro.recogido_por_nombre} (${retiro.parentesco}, ${retiro.documento_verificado} ${retiro.recogido_por_dni}). Motivo: ${retiro.motivo}.`,
      tipo: 'RECOJO',
    });

    return res.status(201).json({
      ok: true,
      mensaje: `Retiro del estudiante registrado a las ${horaCorta}. Estado de asistencia actualizado a RETIRADO.`,
      retiro,
    });
  } catch (err) {
    return res.status(400).json({ ok: false, mensaje: err.message });
  }
}

module.exports = {
  obtenerArchivoEvidencia,
  listarSolicitudesPermiso,
  crearSolicitudPermiso,
  revisarSolicitudPermiso,
  listarSituacionesSalud,
  registrarSituacionSalud,
  confirmarNotificacionSalud,
  listarAutorizacionesRecojo,
  crearAutorizacionRecojo,
  cambiarEstadoAutorizacionRecojo,
  listarRetirosEstudiantes,
  registrarRetiroEstudiante,
};
