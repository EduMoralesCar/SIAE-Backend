const prisma = require('../config/prisma');
const { getLimaDateParts, timeStringToMinutes } = require('../utils/dateHelper');
const { notificarPadresEstudiante } = require('../services/notificacion.service');
const { registrarAuditoria } = require('../services/auditoria.service');
const { ejecutarCierreAsistenciaDiaria } = require('../jobs/asistencia.cron');

async function escanearQR(req, res) {
  try {
    const {
      codigo_qr,
      tipo_registro = 'GENERAL',
      curso_nombre = null,
      modo_operacion = 'AUTO', // 'AUTO' | 'ENTRADA' | 'SALIDA'
      hora_simulada = null,
    } = req.body;

    if (!codigo_qr) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Código QR no proporcionado.',
      });
    }

    const limpio = String(codigo_qr).trim();

    // 1. Verificar si el código corresponde a un fotocheck REVOCADO / DESACTIVADO (Secciones 19 y 20)
    const qrRevocado = await prisma.codigoQR.findFirst({
      where: {
        token: limpio,
        estado: 'REVOCADO',
      },
      include: {
        estudiante: {
          include: {
            usuario: true,
            grado_seccion: true,
          },
        },
      },
    });

    if (qrRevocado) {
      await registrarAuditoria({
        usuario: req.usuario,
        accion: 'INTENTO_QR_REVOCADO',
        entidad: 'CODIGO_QR',
        entidad_id: qrRevocado.id,
        estudiante_id: qrRevocado.estudiante_id,
        descripcion: `Intento de escaneo con fotocheck desactivado (${limpio}) perteneciente a ${qrRevocado.estudiante.usuario.nombres} ${qrRevocado.estudiante.usuario.apellidos}. Motivo de baja: ${qrRevocado.motivo_revocacion || 'Reemplazo de QR'}.`,
        metadata: {
          token: limpio,
          motivo_revocacion: qrRevocado.motivo_revocacion,
          revoked_at: qrRevocado.revoked_at,
        },
      });

      return res.status(403).json({
        ok: false,
        esQrInvalido: true,
        mensaje: `QR NO VÁLIDO — Este código fue desactivado (${qrRevocado.motivo_revocacion || 'Fotocheck reemplazado'}).`,
        estudiante: qrRevocado.estudiante,
      });
    }

    // 2. Buscar estudiante por token QR activo, Código SIAE o DNI
    const estudiante = await prisma.estudiante.findFirst({
      where: {
        OR: [
          { codigo_qr_unico: limpio },
          { codigo_estudiante: { equals: limpio, mode: 'insensitive' } },
          { usuario: { dni: limpio } },
        ],
      },
      include: {
        usuario: true,
        grado_seccion: true,
        matriculas: {
          include: { anio_escolar: true },
          orderBy: { anio_escolar_num: 'desc' },
        },
      },
    });

    if (!estudiante || !estudiante.usuario.activo || estudiante.estado !== 'ACTIVO') {
      await registrarAuditoria({
        usuario: req.usuario,
        accion: 'INTENTO_QR_INVALIDO',
        entidad: 'CODIGO_QR',
        estudiante_id: estudiante?.id || null,
        descripcion: `QR NO VÁLIDO: Intento de registro con código "${limpio}" que no corresponde a un estudiante activo.`,
        metadata: { codigo_escaneado: limpio },
      });

      return res.status(404).json({
        ok: false,
        esQrInvalido: true,
        mensaje: 'QR NO VÁLIDO — El código no corresponde a un estudiante activo.',
      });
    }

    // 3. Verificar matrícula en el año escolar activo (Secciones 16 y 74)
    const matriculaActiva = estudiante.matriculas?.find(
      (m) => m.anio_escolar?.estado === 'ACTIVO'
    );
    if (matriculaActiva && matriculaActiva.estado !== 'MATRICULADO') {
      await registrarAuditoria({
        usuario: req.usuario,
        accion: 'INTENTO_ASISTENCIA_SIN_MATRICULA_ACTIVA',
        entidad: 'MATRICULA',
        entidad_id: matriculaActiva.id,
        estudiante_id: estudiante.id,
        descripcion: `El estudiante ${estudiante.usuario.nombres} ${estudiante.usuario.apellidos} figura con estado de matrícula "${matriculaActiva.estado}" en el año escolar ${matriculaActiva.anio_escolar.nombre}.`,
      });

      return res.status(403).json({
        ok: false,
        esQrInvalido: true,
        mensaje: `Matrícula no habilitada (${matriculaActiva.estado}) en el año escolar ${matriculaActiva.anio_escolar.nombre}.`,
        estudiante,
      });
    }

    let config = await prisma.configuracionEscolar.findFirst();
    if (!config) {
      config = await prisma.configuracionEscolar.create({ data: {} });
    }

    const ahoraLima = getLimaDateParts();
    const fechaHoy = ahoraLima.fecha;
    const horaActual = hora_simulada ? `${hora_simulada}:00` : ahoraLima.hora;
    const horaCorta = hora_simulada || ahoraLima.horaCorta;
    const minutosActuales = timeStringToMinutes(horaCorta);

    const ventanaMin = config.ventana_antiduplicado_min || 15;
    const ahoraTimestamp = new Date();
    const registradorNombre = `${req.usuario.nombres || ''} ${req.usuario.apellidos || ''}`.trim() || req.usuario.rol;

    // =========================================================================
    // CASO A: ASISTENCIA POR CLASE / CURSO
    // =========================================================================
    if (tipo_registro === 'CLASE') {
      const curso = curso_nombre || 'Curso General';
      const existenteClase = await prisma.asistencia.findFirst({
        where: {
          estudiante_id: estudiante.id,
          fecha: fechaHoy,
          tipo_registro: 'CLASE',
          curso_nombre: curso,
        },
        orderBy: { id: 'desc' },
      });

      if (existenteClase) {
        const diffMs = ahoraTimestamp.getTime() - new Date(existenteClase.ultimo_escaneo_ts).getTime();
        const diffMin = Math.floor(diffMs / 60000);
        if (diffMin < ventanaMin) {
          return res.status(409).json({
            ok: false,
            esDuplicado: true,
            minutosTranscurridos: diffMin,
            mensaje: `ASISTENCIA YA REGISTRADA en ${curso} a las ${existenteClase.hora_entrada}.`,
            estudiante,
            asistencia: existenteClase,
            registrado_por: registradorNombre,
          });
        }
      }

      const nuevaClase = await prisma.asistencia.create({
        data: {
          estudiante_id: estudiante.id,
          fecha: fechaHoy,
          hora_entrada: horaActual,
          tipo_registro: 'CLASE',
          curso_nombre: curso,
          estado: 'PRESENTE',
          registrado_por_id: req.usuario.id,
          ultimo_escaneo_ts: ahoraTimestamp,
        },
      });

      return res.status(201).json({
        ok: true,
        accion: 'ASISTENCIA_CLASE',
        mensaje: `Asistencia en aula confirmada (${curso}) para ${estudiante.usuario.nombres} ${estudiante.usuario.apellidos}.`,
        estudiante,
        asistencia: nuevaClase,
        registrado_por: registradorNombre,
      });
    }

    // =========================================================================
    // CASO B: ASISTENCIA GENERAL DE PUERTA (Entrada / Salida — Sección 16 y 18)
    // =========================================================================
    const asistenciaHoy = await prisma.asistencia.findFirst({
      where: {
        estudiante_id: estudiante.id,
        fecha: fechaHoy,
        tipo_registro: 'GENERAL',
      },
      orderBy: { id: 'desc' },
    });

    if (asistenciaHoy) {
      const diffMs = ahoraTimestamp.getTime() - new Date(asistenciaHoy.ultimo_escaneo_ts).getTime();
      const diffMin = Math.floor(diffMs / 60000);

      // Si estaba como FALTA (por cierre 08:31 AM) o PERMISO y recién llega -> Actualizar a TARDANZA
      if (asistenciaHoy.estado === 'FALTA' && !asistenciaHoy.hora_entrada && modo_operacion !== 'SALIDA') {
        const minLimitePuntual = timeStringToMinutes(config.hora_limite_puntual);
        const minRetraso = Math.max(1, minutosActuales - minLimitePuntual);

        const actualizadaEntrada = await prisma.asistencia.update({
          where: { id: asistenciaHoy.id },
          data: {
            hora_entrada: horaActual,
            estado: 'TARDANZA',
            minutos_tardanza: minRetraso,
            registrado_por_id: req.usuario.id,
            ultimo_escaneo_ts: ahoraTimestamp,
          },
        });

        await prisma.auditoriaAsistencia.create({
          data: {
            asistencia_id: asistenciaHoy.id,
            modificado_por_id: req.usuario.id,
            estado_anterior: 'FALTA',
            estado_nuevo: 'TARDANZA',
            motivo_cambio: `Ingreso posterior al cierre automático registrado por escaneo QR a las ${horaCorta}`,
          },
        });

        await registrarAuditoria({
          usuario: req.usuario,
          accion: 'ASISTENCIA_MODIFICADA',
          entidad: 'ASISTENCIA',
          entidad_id: asistenciaHoy.id,
          estudiante_id: estudiante.id,
          descripcion: `Asistencia actualizada de FALTA a TARDANZA por ingreso QR a las ${horaCorta}.`,
        });

        await notificarPadresEstudiante({
          estudianteId: estudiante.id,
          titulo: `Ingreso con Tardanza (${horaCorta})`,
          mensaje: `Su hijo(a) ${estudiante.usuario.nombres} ${estudiante.usuario.apellidos} ingresó al colegio a las ${horaCorta} (${minRetraso} min de retraso).`,
          tipo: 'ASISTENCIA',
        });

        return res.json({
          ok: true,
          accion: 'ENTRADA_TARDANZA',
          mensaje: `TARDANZA registrada a las ${horaCorta} (${minRetraso} min de retraso).`,
          estudiante,
          asistencia: actualizadaEntrada,
          registrado_por: registradorNombre,
        });
      }

      // Prevención de doble registro (Sección 18): Si no se solicita explícitamente SALIDA
      if (modo_operacion !== 'SALIDA' && (diffMin < ventanaMin || !asistenciaHoy.hora_salida)) {
        return res.status(409).json({
          ok: false,
          esDuplicado: true,
          minutosTranscurridos: diffMin,
          mensaje: `ASISTENCIA YA REGISTRADA — Hora de ingreso: ${asistenciaHoy.hora_entrada || 'Registrada'} (${asistenciaHoy.estado}).`,
          estudiante,
          asistencia: asistenciaHoy,
          registrado_por: registradorNombre,
        });
      }

      // Si ya tenía hora de salida registrada
      if (asistenciaHoy.hora_salida) {
        return res.status(409).json({
          ok: false,
          esDuplicado: true,
          mensaje: `ASISTENCIA YA REGISTRADA — Ingreso: ${asistenciaHoy.hora_entrada || '-'} · Salida: ${asistenciaHoy.hora_salida}.`,
          estudiante,
          asistencia: asistenciaHoy,
          registrado_por: registradorNombre,
        });
      }

      // REGISTRO DE SALIDA REGULAR
      const actualizadaSalida = await prisma.asistencia.update({
        where: { id: asistenciaHoy.id },
        data: {
          hora_salida: horaActual,
          ultimo_escaneo_ts: ahoraTimestamp,
        },
      });

      await notificarPadresEstudiante({
        estudianteId: estudiante.id,
        titulo: `Salida del Plantel Registrada (${horaCorta})`,
        mensaje: `Confirmamos que el estudiante ${estudiante.usuario.nombres} ${estudiante.usuario.apellidos} (${estudiante.grado_seccion.grado}° "${estudiante.grado_seccion.seccion}") registró su salida del colegio a las ${horaCorta}.`,
        tipo: 'ASISTENCIA',
      });

      return res.json({
        ok: true,
        accion: 'SALIDA',
        mensaje: `Salida registrada correctamente a las ${horaCorta} para ${estudiante.usuario.nombres} ${estudiante.usuario.apellidos}.`,
        estudiante,
        asistencia: actualizadaSalida,
        registrado_por: registradorNombre,
      });
    }

    // =========================================================================
    // NUEVO REGISTRO DE ENTRADA DEL DÍA (Sección 16)
    // =========================================================================
    const minLimitePuntual = timeStringToMinutes(config.hora_limite_puntual);
    let estadoCalculado = 'PRESENTE';
    let minutosTardanza = 0;

    if (minutosActuales > minLimitePuntual) {
      estadoCalculado = 'TARDANZA';
      minutosTardanza = minutosActuales - minLimitePuntual;
    }

    const nuevaAsistencia = await prisma.asistencia.create({
      data: {
        estudiante_id: estudiante.id,
        fecha: fechaHoy,
        hora_entrada: horaActual,
        hora_salida: null,
        minutos_tardanza: minutosTardanza,
        tipo_registro: 'GENERAL',
        estado: estadoCalculado,
        registrado_por_id: req.usuario.id,
        ultimo_escaneo_ts: ahoraTimestamp,
      },
    });

    const textoEstado =
      estadoCalculado === 'PRESENTE'
        ? `ASISTENCIA REGISTRADA — Presente (${horaActual})`
        : `ASISTENCIA REGISTRADA — Tardanza (${horaActual}, +${minutosTardanza} min)`;

    await notificarPadresEstudiante({
      estudianteId: estudiante.id,
      titulo:
        estadoCalculado === 'PRESENTE'
          ? `Ingreso Puntual (${horaCorta})`
          : `Ingreso con Tardanza (${horaCorta})`,
      mensaje: `${textoEstado} para el estudiante ${estudiante.usuario.nombres} ${estudiante.usuario.apellidos} (${estudiante.grado_seccion.grado}° "${estudiante.grado_seccion.seccion}").`,
      tipo: 'ASISTENCIA',
    });

    return res.status(201).json({
      ok: true,
      accion: estadoCalculado === 'PRESENTE' ? 'ENTRADA_PUNTUAL' : 'ENTRADA_TARDANZA',
      mensaje: textoEstado,
      estudiante,
      asistencia: nuevaAsistencia,
      registrado_por: registradorNombre,
    });
  } catch (err) {
    console.error('Error en escanearQR:', err);
    return res.status(500).json({
      ok: false,
      mensaje: 'Error al procesar el escaneo QR.',
      detalle: err.message,
    });
  }
}

/**
 * Corrección manual o Justificación de Falta/Tardanza con Auditoría obligatoria (Sección 22 y 64)
 */
async function justificarOModificarAsistencia(req, res) {
  try {
    const {
      asistencia_id,
      estudiante_id,
      fecha,
      estado_nuevo,
      motivo_cambio,
      evidencia_url,
      hora_entrada,
      hora_salida,
    } = req.body;

    if (!estado_nuevo || !motivo_cambio || String(motivo_cambio).trim().length < 5) {
      return res.status(400).json({
        ok: false,
        mensaje:
          'Es obligatorio indicar el nuevo estado y un motivo detallado (mínimo 5 caracteres).',
      });
    }

    let asistencia = null;
    if (asistencia_id) {
      asistencia = await prisma.asistencia.findUnique({
        where: { id: Number(asistencia_id) },
      });
    } else if (estudiante_id && fecha) {
      asistencia = await prisma.asistencia.findFirst({
        where: {
          estudiante_id: Number(estudiante_id),
          fecha,
          tipo_registro: 'GENERAL',
        },
      });
    }

    const resultado = await prisma.$transaction(async (tx) => {
      if (asistencia) {
        const estadoAnterior = asistencia.estado;
        const actualizada = await tx.asistencia.update({
          where: { id: asistencia.id },
          data: {
            estado: estado_nuevo,
            motivo_justificacion: motivo_cambio.trim(),
            evidencia_url: evidencia_url || asistencia.evidencia_url,
            hora_entrada: hora_entrada !== undefined ? hora_entrada : asistencia.hora_entrada,
            hora_salida: hora_salida !== undefined ? hora_salida : asistencia.hora_salida,
          },
          include: {
            estudiante: { include: { usuario: true, grado_seccion: true } },
          },
        });

        const auditoria = await tx.auditoriaAsistencia.create({
          data: {
            asistencia_id: asistencia.id,
            modificado_por_id: req.usuario.id,
            estado_anterior: estadoAnterior,
            estado_nuevo,
            motivo_cambio: motivo_cambio.trim(),
            evidencia_url: evidencia_url || null,
          },
        });

        return { asistencia: actualizada, auditoria, estadoAnterior };
      } else {
        const creada = await tx.asistencia.create({
          data: {
            estudiante_id: Number(estudiante_id),
            fecha: fecha || getLimaDateParts().fecha,
            hora_entrada: hora_entrada || getLimaDateParts().hora,
            hora_salida: hora_salida || null,
            tipo_registro: 'GENERAL',
            estado: estado_nuevo,
            registrado_por_id: req.usuario.id,
            motivo_justificacion: motivo_cambio.trim(),
            evidencia_url: evidencia_url || null,
          },
          include: {
            estudiante: { include: { usuario: true, grado_seccion: true } },
          },
        });

        const auditoria = await tx.auditoriaAsistencia.create({
          data: {
            asistencia_id: creada.id,
            modificado_por_id: req.usuario.id,
            estado_anterior: 'FALTA',
            estado_nuevo,
            motivo_cambio: `[Registro Manual] ${motivo_cambio.trim()}`,
            evidencia_url: evidencia_url || null,
          },
        });

        return { asistencia: creada, auditoria, estadoAnterior: 'FALTA' };
      }
    });

    await registrarAuditoria({
      usuario: req.usuario,
      accion: 'ASISTENCIA_MODIFICADA',
      entidad: 'ASISTENCIA',
      entidad_id: resultado.asistencia.id,
      estudiante_id: resultado.asistencia.estudiante_id,
      descripcion: `Asistencia del ${resultado.asistencia.fecha} para ${resultado.asistencia.estudiante.usuario.nombres} ${resultado.asistencia.estudiante.usuario.apellidos} modificada de ${resultado.estadoAnterior} a ${estado_nuevo}. Motivo: ${motivo_cambio.trim()}`,
      metadata: {
        antes: resultado.estadoAnterior,
        despues: estado_nuevo,
        motivo: motivo_cambio.trim(),
        evidencia_url: evidencia_url || null,
      },
    });

    await notificarPadresEstudiante({
      estudianteId: resultado.asistencia.estudiante_id,
      titulo: `Actualización de Asistencia (${resultado.asistencia.fecha})`,
      mensaje: `El estado de asistencia de ${resultado.asistencia.estudiante.usuario.nombres} ${resultado.asistencia.estudiante.usuario.apellidos} fue actualizado a ${estado_nuevo}. Motivo: ${motivo_cambio.trim()}`,
      tipo: 'ASISTENCIA',
    });

    return res.json({
      ok: true,
      mensaje: 'Asistencia actualizada y registrada en el historial de auditoría.',
      ...resultado,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

async function listarAsistencias(req, res) {
  try {
    const {
      fecha,
      fecha_inicio,
      fecha_fin,
      grado_seccion_id,
      grado,
      seccion,
      estado,
      tipo_registro,
      estudiante_id,
    } = req.query;

    const where = {};
    if (fecha) {
      where.fecha = fecha;
    } else if (fecha_inicio || fecha_fin) {
      where.fecha = {};
      if (fecha_inicio) where.fecha.gte = fecha_inicio;
      if (fecha_fin) where.fecha.lte = fecha_fin;
    }

    if (estado) where.estado = estado;
    if (tipo_registro) where.tipo_registro = tipo_registro;
    if (estudiante_id) where.estudiante_id = Number(estudiante_id);

    if (grado_seccion_id || grado || seccion) {
      where.estudiante = {};
      if (grado_seccion_id) {
        where.estudiante.grado_seccion_id = Number(grado_seccion_id);
      } else {
        where.estudiante.grado_seccion = {};
        if (grado) where.estudiante.grado_seccion.grado = Number(grado);
        if (seccion) where.estudiante.grado_seccion.seccion = String(seccion).toUpperCase();
      }
    }

    const asistencias = await prisma.asistencia.findMany({
      where,
      orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
      include: {
        estudiante: {
          include: {
            usuario: {
              select: { nombres: true, apellidos: true, dni: true },
            },
            grado_seccion: true,
          },
        },
        registrado_por: {
          select: { id: true, nombres: true, apellidos: true, rol: true },
        },
        auditorias: {
          include: {
            modificado_por: {
              select: { nombres: true, apellidos: true, rol: true },
            },
          },
          orderBy: { fecha_hora_cambio: 'desc' },
        },
      },
      take: 500,
    });

    return res.json({ ok: true, asistencias });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

async function listarAuditoria(req, res) {
  try {
    const { fecha_inicio, fecha_fin } = req.query;
    const where = {};

    if (fecha_inicio || fecha_fin) {
      where.asistencia = { fecha: {} };
      if (fecha_inicio) where.asistencia.fecha.gte = fecha_inicio;
      if (fecha_fin) where.asistencia.fecha.lte = fecha_fin;
    }

    const auditorias = await prisma.auditoriaAsistencia.findMany({
      where,
      orderBy: { fecha_hora_cambio: 'desc' },
      include: {
        modificado_por: {
          select: { id: true, nombres: true, apellidos: true, rol: true, dni: true },
        },
        asistencia: {
          include: {
            estudiante: {
              include: {
                usuario: { select: { nombres: true, apellidos: true, dni: true } },
                grado_seccion: true,
              },
            },
          },
        },
      },
      take: 250,
    });

    return res.json({ ok: true, auditorias });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

async function dispararCierreManual(req, res) {
  try {
    const { fecha } = req.body;
    const resultado = await ejecutarCierreAsistenciaDiaria(fecha || null, req.usuario.id);

    await registrarAuditoria({
      usuario: req.usuario,
      accion: 'CIERRE_ASISTENCIA_EJECUTADO',
      entidad: 'ASISTENCIA',
      descripcion: `Cierre de asistencia ejecutado para ${resultado.fecha}. Faltas confirmadas: ${resultado.faltasGeneradas}.`,
      metadata: resultado,
    });

    return res.json({
      ok: true,
      mensaje: `Cierre de asistencia ejecutado para ${resultado.fecha}. Se asignaron ${resultado.faltasGeneradas} faltas automáticas.`,
      resultado,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

async function actualizarAsistencia(req, res) {
  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    return res.status(400).json({ ok: false, mensaje: 'ID de asistencia inválido.' });
  }
  req.body = { ...req.body, asistencia_id: id };
  return justificarOModificarAsistencia(req, res);
}

async function eliminarAsistencia(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ ok: false, mensaje: 'ID de asistencia inválido.' });
    }

    const existente = await prisma.asistencia.findUnique({
      where: { id },
      include: {
        estudiante: {
          include: {
            usuario: { select: { nombres: true, apellidos: true, dni: true } },
            grado_seccion: true,
          },
        },
      },
    });

    if (!existente) {
      return res.status(404).json({ ok: false, mensaje: 'Registro de asistencia no encontrado.' });
    }

    const motivo = (req.body?.motivo || req.query?.motivo || 'Eliminación administrativa de registro').trim();

    await prisma.$transaction(async (tx) => {
      await tx.auditoriaAsistencia.deleteMany({ where: { asistencia_id: id } });
      await tx.asistencia.delete({ where: { id } });
    });

    await registrarAuditoria({
      usuario: req.usuario,
      accion: 'ASISTENCIA_ELIMINADA',
      entidad: 'ASISTENCIA',
      entidad_id: id,
      estudiante_id: existente.estudiante_id,
      descripcion: `Registro de asistencia #${id} (${existente.fecha}, estado ${existente.estado}) de ${existente.estudiante?.usuario?.nombres || ''} ${existente.estudiante?.usuario?.apellidos || ''} eliminado. Motivo: ${motivo}`,
      metadata: {
        fecha: existente.fecha,
        estado_eliminado: existente.estado,
        hora_entrada: existente.hora_entrada,
        hora_salida: existente.hora_salida,
        motivo,
      },
    });

    return res.json({
      ok: true,
      mensaje: `Registro de asistencia #${id} eliminado y auditado correctamente.`,
      id_eliminado: id,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

module.exports = {
  escanearQR,
  justificarOModificarAsistencia,
  actualizarAsistencia,
  eliminarAsistencia,
  listarAsistencias,
  listarAuditoria,
  dispararCierreManual,
};
