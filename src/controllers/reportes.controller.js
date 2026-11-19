const ExcelJS = require('exceljs');
const prisma = require('../config/prisma');
const { getLimaDateParts } = require('../utils/dateHelper');
const { calcularSemaforoConducta } = require('./conducta.controller');
const { notificarPadresEstudiante } = require('../services/notificacion.service');

/**
 * Calcula la racha máxima de faltas consecutivas y el porcentaje de tardanzas de un estudiante
 */
function analizarRiesgoAsistencia(asistenciasGenerales) {
  const ordenadas = [...asistenciasGenerales].sort((a, b) => a.fecha.localeCompare(b.fecha));

  let rachaActual = 0;
  let maxRachaFaltas = 0;
  let totalTardanzas = 0;
  let totalFaltas = 0;

  for (const reg of ordenadas) {
    if (reg.estado === 'FALTA') {
      rachaActual++;
      totalFaltas++;
      if (rachaActual > maxRachaFaltas) maxRachaFaltas = rachaActual;
    } else {
      rachaActual = 0;
    }
    if (reg.estado === 'TARDANZA') {
      totalTardanzas++;
    }
  }

  let rachaReciente = 0;
  for (let i = ordenadas.length - 1; i >= 0; i--) {
    if (ordenadas[i].estado === 'FALTA') {
      rachaReciente++;
    } else {
      break;
    }
  }

  const totalDias = ordenadas.length;
  const porcentajeTardanzas = totalDias > 0 ? Math.round((totalTardanzas / totalDias) * 100) : 0;

  return {
    totalDias,
    totalFaltas,
    totalTardanzas,
    maxRachaFaltas,
    rachaReciente,
    porcentajeTardanzas,
    alertaFaltasConsecutivas: maxRachaFaltas >= 3 || rachaReciente >= 3,
    alertaExcesoTardanzas: totalDias >= 5 && porcentajeTardanzas > 20,
  };
}

/**
 * Sección 62 — Dashboard General con los 12 indicadores institucionales
 */
async function obtenerDashboardDirectivo(req, res) {
  try {
    const { fecha: fechaHoy } = getLimaDateParts();
    const fechaConsulta = req.query.fecha || fechaHoy;
    const gradoSeccionIdFiltro = req.query.grado_seccion_id
      ? Number(req.query.grado_seccion_id)
      : null;

    const [
      estudiantes,
      asistenciasHoy,
      gradosSecciones,
      ultimasAuditorias,
      ultimasIncidencias,
      permisosPendientesCount,
      situacionesSaludHoyCount,
      retirosHoyCount,
      incidenciasAbiertasCount,
      citacionesPendientesCount,
      reunionesProximasCount,
      compromisosPendientesCount,
      actasCount,
    ] = await Promise.all([
      prisma.estudiante.findMany({
        where: { usuario: { activo: true } },
        include: {
          usuario: { select: { nombres: true, apellidos: true, dni: true, telefono: true } },
          grado_seccion: true,
          padres: {
            include: {
              padre: { select: { nombres: true, apellidos: true, telefono: true, email: true } },
            },
          },
          asistencias: {
            where: { tipo_registro: 'GENERAL' },
            orderBy: { fecha: 'asc' },
          },
        },
      }),
      prisma.asistencia.findMany({
        where: { fecha: fechaConsulta, tipo_registro: 'GENERAL' },
      }),
      prisma.gradoSeccion.findMany({
        where: { anio_escolar: 2026 },
        orderBy: [{ grado: 'asc' }, { seccion: 'asc' }],
        include: {
          tutor_docente: { select: { nombres: true, apellidos: true } },
        },
      }),
      prisma.auditoriaGeneral.findMany({
        orderBy: { created_at: 'desc' },
        take: 10,
      }),
      prisma.incidenciaConducta.findMany({
        orderBy: { fecha_incidente: 'desc' },
        take: 30,
        include: {
          estudiante: {
            include: {
              usuario: { select: { nombres: true, apellidos: true } },
              grado_seccion: true,
            },
          },
          registrado_por: { select: { nombres: true, apellidos: true, rol: true } },
        },
      }),
      prisma.solicitudPermiso.count({ where: { estado: 'PENDIENTE' } }),
      prisma.situacionSalud.count({ where: { fecha: fechaConsulta } }),
      prisma.retiroEstudiante.count({ where: { fecha: fechaConsulta } }),
      prisma.incidenciaConducta.count({
        where: { estado: { in: ['ABIERTA', 'EN_SEGUIMIENTO', 'CON_CITACION'] } },
      }),
      prisma.citacion.count({
        where: {
          estado: { in: ['PENDIENTE', 'CONFIRMADA', 'REPROGRAMADA', 'SOLICITA_REPROGRAMACION'] },
        },
      }),
      prisma.reunion.count(),
      prisma.compromiso.count({
        where: { estado: { in: ['PENDIENTE', 'EN_SEGUIMIENTO'] } },
      }),
      prisma.acta.count(),
    ]);

    const estudiantesScope = gradoSeccionIdFiltro
      ? estudiantes.filter((e) => e.grado_seccion_id === gradoSeccionIdFiltro)
      : estudiantes;
    const idsEstudiantesScope = new Set(estudiantesScope.map((e) => e.id));
    const asistenciasHoyScope = gradoSeccionIdFiltro
      ? asistenciasHoy.filter((a) => idsEstudiantesScope.has(a.estudiante_id))
      : asistenciasHoy;

    const kpisHoy = {
      fecha: fechaConsulta,
      totalMatriculados: estudiantesScope.length,
      presentes: asistenciasHoyScope.filter((a) => a.estado === 'PRESENTE').length,
      tardanzas: asistenciasHoyScope.filter((a) => a.estado === 'TARDANZA').length,
      faltas: asistenciasHoyScope.filter((a) => a.estado === 'FALTA').length,
      justificados: asistenciasHoyScope.filter(
        (a) => a.estado === 'JUSTIFICADO' || a.estado === 'PERMISO'
      ).length,
      retirados:
        asistenciasHoyScope.filter((a) => a.estado === 'RETIRADO').length ||
        (gradoSeccionIdFiltro ? 0 : retirosHoyCount),
      permisosPendientes: permisosPendientesCount,
      situacionesSaludHoy: situacionesSaludHoyCount,
      incidenciasAbiertas: incidenciasAbiertasCount,
      citacionesPendientes: citacionesPendientesCount,
      reunionesRegistradas: reunionesProximasCount,
      compromisosPendientes: compromisosPendientesCount,
      actasEmitidas: actasCount,
    };

    kpisHoy.sinRegistro = Math.max(
      0,
      kpisHoy.totalMatriculados -
        (kpisHoy.presentes +
          kpisHoy.tardanzas +
          kpisHoy.faltas +
          kpisHoy.justificados +
          asistenciasHoyScope.filter((a) => a.estado === 'RETIRADO').length)
    );

    const mapHoyPorEstudiante = new Map();
    for (const a of asistenciasHoy) {
      mapHoyPorEstudiante.set(a.estudiante_id, a.estado);
    }

    const resumenPorSeccion = gradosSecciones.map((gs) => {
      const alumnosSeccion = estudiantes.filter((e) => e.grado_seccion_id === gs.id);
      let presentes = 0;
      let tardanzas = 0;
      let faltas = 0;
      let justificados = 0;
      let retirados = 0;
      let sinRegistro = 0;

      for (const al of alumnosSeccion) {
        const est = mapHoyPorEstudiante.get(al.id);
        if (est === 'PRESENTE') presentes++;
        else if (est === 'TARDANZA') tardanzas++;
        else if (est === 'FALTA') faltas++;
        else if (est === 'JUSTIFICADO' || est === 'PERMISO') justificados++;
        else if (est === 'RETIRADO') retirados++;
        else sinRegistro++;
      }

      return {
        id: gs.id,
        grado: gs.grado,
        seccion: gs.seccion,
        etiqueta: `${gs.grado}° "${gs.seccion}"`,
        tutor: gs.tutor_docente
          ? `${gs.tutor_docente.nombres} ${gs.tutor_docente.apellidos}`
          : 'Sin asignar',
        totalAlumnos: alumnosSeccion.length,
        presentes,
        tardanzas,
        faltas,
        justificados,
        retirados,
        sinRegistro,
      };
    });

    // Construir serie de Tendencia Diaria (últimos 10 días registrados) para gráfica lineal/barras
    const mapaFechas = new Map();
    for (const est of estudiantesScope) {
      for (const asis of est.asistencias || []) {
        if (!mapaFechas.has(asis.fecha)) {
          mapaFechas.set(asis.fecha, {
            fecha: asis.fecha,
            etiqueta: asis.fecha.slice(5), // MM-DD
            presentes: 0,
            tardanzas: 0,
            faltas: 0,
            justificados: 0,
            retirados: 0,
          });
        }
        const bucket = mapaFechas.get(asis.fecha);
        if (asis.estado === 'PRESENTE') bucket.presentes++;
        else if (asis.estado === 'TARDANZA') bucket.tardanzas++;
        else if (asis.estado === 'FALTA') bucket.faltas++;
        else if (asis.estado === 'JUSTIFICADO' || asis.estado === 'PERMISO') bucket.justificados++;
        else if (asis.estado === 'RETIRADO') bucket.retirados++;
      }
    }
    const tendenciaDiaria = Array.from(mapaFechas.values())
      .sort((a, b) => a.fecha.localeCompare(b.fecha))
      .slice(-10);

    // Distribución del Semáforo de Conducta y Naturaleza de Incidencias (para gráficas Donut)
    let conductaOptimo = 0;
    let conductaPreventivo = 0;
    let conductaCritico = 0;
    for (const est of estudiantesScope) {
      if (est.puntaje_conducta >= 76) conductaOptimo++;
      else if (est.puntaje_conducta >= 61) conductaPreventivo++;
      else conductaCritico++;
    }

    const conteoNaturaleza = {};
    for (const inc of ultimasIncidencias) {
      if (gradoSeccionIdFiltro && !idsEstudiantesScope.has(inc.estudiante_id)) continue;
      const nat = inc.naturaleza || inc.tipo || 'CONVIVENCIA';
      conteoNaturaleza[nat] = (conteoNaturaleza[nat] || 0) + 1;
    }

    const distribucionConducta = {
      optimo: conductaOptimo,
      preventivo: conductaPreventivo,
      critico: conductaCritico,
      porNaturaleza: Object.entries(conteoNaturaleza).map(([nombre, total]) => ({
        nombre,
        total,
      })),
    };

    const alertasAusenciasRecurrentes = [];
    const alertasConducta = [];

    for (const est of estudiantesScope) {
      const analisis = analizarRiesgoAsistencia(est.asistencias);
      const apoderado = est.padres[0]?.padre || null;

      if (analisis.alertaFaltasConsecutivas || analisis.alertaExcesoTardanzas) {
        alertasAusenciasRecurrentes.push({
          estudiante_id: est.id,
          codigo_estudiante: est.codigo_estudiante,
          nombres: `${est.usuario.nombres} ${est.usuario.apellidos}`,
          dni: est.usuario.dni,
          seccion: `${est.grado_seccion.grado}° "${est.grado_seccion.seccion}"`,
          maxRachaFaltas: analisis.maxRachaFaltas,
          rachaReciente: analisis.rachaReciente,
          totalFaltas: analisis.totalFaltas,
          totalTardanzas: analisis.totalTardanzas,
          porcentajeTardanzas: analisis.porcentajeTardanzas,
          motivoAlerta:
            analisis.maxRachaFaltas >= 3
              ? `${analisis.maxRachaFaltas} faltas consecutivas detectadas`
              : `${analisis.porcentajeTardanzas}% de tardanzas acumuladas`,
          nivelSeveridad: analisis.maxRachaFaltas >= 3 ? 'CRITICA' : 'PREVENTIVA',
          apoderado: apoderado
            ? `${apoderado.nombres} ${apoderado.apellidos} (${apoderado.telefono || apoderado.email})`
            : 'No registrado',
        });
      }

      if (est.puntaje_conducta <= 75) {
        const sem = calcularSemaforoConducta(est.puntaje_conducta);
        alertasConducta.push({
          estudiante_id: est.id,
          codigo_estudiante: est.codigo_estudiante,
          nombres: `${est.usuario.nombres} ${est.usuario.apellidos}`,
          dni: est.usuario.dni,
          seccion: `${est.grado_seccion.grado}° "${est.grado_seccion.seccion}"`,
          puntaje_conducta: est.puntaje_conducta,
          semaforo: sem,
          apoderado: apoderado
            ? `${apoderado.nombres} ${apoderado.apellidos} (${apoderado.telefono || apoderado.email})`
            : 'No registrado',
        });
      }
    }

    alertasAusenciasRecurrentes.sort((a, b) => b.maxRachaFaltas - a.maxRachaFaltas);
    alertasConducta.sort((a, b) => a.puntaje_conducta - b.puntaje_conducta);

    return res.json({
      ok: true,
      kpisHoy,
      gradosSecciones,
      resumenPorSeccion,
      tendenciaDiaria,
      distribucionConducta,
      alertasAusenciasRecurrentes,
      alertasConducta,
      ultimasAuditorias,
      ultimasIncidencias: gradoSeccionIdFiltro
        ? ultimasIncidencias
            .filter((inc) => idsEstudiantesScope.has(inc.estudiante_id))
            .slice(0, 8)
        : ultimasIncidencias.slice(0, 8),
    });
  } catch (err) {
    console.error('Error en obtenerDashboardDirectivo:', err);
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

/**
 * Secciones 49, 50, 51, 55, 69 y 79:
 * Antecedentes, Historial Multianual y Línea de Tiempo Cronológica del Estudiante
 */
async function obtenerLineaTiempoEstudiante(req, res) {
  try {
    const { id } = req.params;
    const { anio_escolar, categoria } = req.query;

    // Principio de mínimo privilegio (Sección 68): un Padre solo puede consultar a sus hijos asociados
    if (req.usuario.rol === 'PADRE') {
      const vinculo = await prisma.padreEstudiante.findFirst({
        where: {
          padre_usuario_id: req.usuario.id,
          estudiante_id: Number(id),
        },
      });
      if (!vinculo) {
        return res.status(403).json({
          ok: false,
          mensaje: 'Solo tiene permiso para consultar el historial de los estudiantes asociados a su cuenta.',
        });
      }
    }

    const estudiante = await prisma.estudiante.findUnique({
      where: { id: Number(id) },
      include: {
        usuario: {
          select: { id: true, nombres: true, apellidos: true, dni: true, email: true, telefono: true },
        },
        grado_seccion: {
          include: {
            tutor_docente: { select: { id: true, nombres: true, apellidos: true, email: true } },
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
        },
        solicitudes_permiso: {
          orderBy: { created_at: 'desc' },
          include: {
            solicitado_por: { select: { nombres: true, apellidos: true } },
            revisado_por: { select: { nombres: true, apellidos: true, rol: true } },
            evidencias: { include: { archivo: { select: { id: true, nombre_original: true } } } },
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
            evidencias: { include: { archivo: { select: { id: true, nombre_original: true } } } },
          },
        },
        citaciones: {
          orderBy: [{ fecha_programada: 'desc' }, { id: 'desc' }],
          include: {
            responsable: { select: { nombres: true, apellidos: true, rol: true } },
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
            compromisos: true,
          },
        },
        compromisos: {
          orderBy: { created_at: 'desc' },
          include: {
            acta: true,
            seguimientos: {
              include: {
                registrado_por: { select: { nombres: true, apellidos: true, rol: true } },
              },
            },
          },
        },
      },
    });

    if (!estudiante) {
      return res.status(404).json({ ok: false, mensaje: 'Estudiante no encontrado.' });
    }

    // Sección 69: Seguridad de la información de salud
    const esTutorDeSeccion =
      estudiante.grado_seccion?.tutor_docente_id === req.usuario.id;
    const puedeVerDetalleSalud =
      ['ADMIN', 'DIRECTOR', 'AUXILIAR', 'PADRE', 'TUTOR'].includes(req.usuario.rol) ||
      esTutorDeSeccion;

    // Construir eventos unificados para la Línea de Tiempo (Sección 50 y 79)
    const eventos = [];

    // 1. Asistencias
    for (const a of estudiante.asistencias) {
      const hora = a.hora_entrada ? a.hora_entrada.slice(0, 5) : '08:00';
      eventos.push({
        id: `asis-${a.id}`,
        fecha: a.fecha,
        hora,
        anio: a.fecha.slice(0, 4),
        categoria: 'ASISTENCIA',
        titulo: `Asistencia registrada — ${a.estado}`,
        descripcion:
          a.estado === 'PRESENTE'
            ? `Estudiante ingresó puntualmente a las ${a.hora_entrada || hora}.`
            : a.estado === 'TARDANZA'
              ? `Estudiante ingresó con tardanza a las ${a.hora_entrada || hora} (+${a.minutos_tardanza} min).`
              : a.estado === 'RETIRADO'
                ? `Estudiante ingresó a las ${a.hora_entrada || '--:--'} y se retiró a las ${a.hora_salida || '--:--'}. ${a.motivo_justificacion || ''}`
                : a.estado === 'PERMISO' || a.estado === 'JUSTIFICADO'
                  ? `${a.estado}: ${a.motivo_justificacion || 'Justificado en plataforma'}`
                  : `Falta registrada. ${a.motivo_justificacion || ''}`,
        estado: a.estado,
        responsable: a.registrado_por
          ? `${a.registrado_por.nombres} ${a.registrado_por.apellidos}`
          : 'Sistema',
      });
    }

    // 2. Situaciones de salud + Notificación + Confirmación del padre (Secciones 50 y 79)
    for (const s of estudiante.situaciones_salud) {
      eventos.push({
        id: `salud-${s.id}`,
        fecha: s.fecha,
        hora: s.hora || '10:30',
        anio: s.fecha.slice(0, 4),
        categoria: 'SALUD',
        titulo: `Situación de salud registrada (${s.tipo_situacion})`,
        descripcion: puedeVerDetalleSalud
          ? `${s.descripcion} — Acción: ${s.accion_realizada}`
          : 'Atención registrada en tópico escolar (información de salud de acceso restringido).',
        estado: s.estado,
        responsable: `${s.registrado_por?.nombres || ''} ${s.registrado_por?.apellidos || ''}`.trim(),
      });

      if (s.notificado_padre) {
        eventos.push({
          id: `salud-notif-${s.id}`,
          fecha: s.fecha,
          hora: s.hora || '10:35',
          anio: s.fecha.slice(0, 4),
          categoria: 'NOTIFICACION',
          titulo: 'Padre notificado por situación de salud',
          descripcion:
            'Se envió comunicación oficial solicitando la atención/recojo por parte del padre o apoderado.',
          estado: s.confirmado_padre ? 'CONFIRMADO' : 'ENVIADO',
          responsable: `${s.registrado_por?.nombres || ''} ${s.registrado_por?.apellidos || ''}`.trim(),
        });
      }

      if (s.confirmado_padre && s.fecha_confirmacion_padre) {
        const dtConf = new Date(s.fecha_confirmacion_padre);
        const horaConf = dtConf.toTimeString().slice(0, 5);
        eventos.push({
          id: `salud-conf-${s.id}`,
          fecha: s.fecha,
          hora: horaConf,
          anio: s.fecha.slice(0, 4),
          categoria: 'CONFIRMACION',
          titulo: 'Padre confirmó recepción («RECIBÍ LA NOTIFICACIÓN»)',
          descripcion: `Recepción confirmada en plataforma por ${s.confirmado_por?.nombres || 'Apoderado'} ${s.confirmado_por?.apellidos || ''}.`,
          estado: 'CONFIRMADO',
          responsable: `${s.confirmado_por?.nombres || 'Padre'} ${s.confirmado_por?.apellidos || ''}`.trim(),
        });
      }
    }

    // 3. Retiros
    for (const r of estudiante.retiros) {
      eventos.push({
        id: `retiro-${r.id}`,
        fecha: r.fecha,
        hora: r.hora_salida || '11:15',
        anio: r.fecha.slice(0, 4),
        categoria: 'RETIRO',
        titulo: `Estudiante retirado por ${r.parentesco} (${r.recogido_por_nombre})`,
        descripcion: `Motivo: ${r.motivo}. Documento verificado: ${r.documento_verificado} ${r.recogido_por_dni}. ${r.observaciones || ''}`,
        estado: 'RETIRADO',
        responsable: `${r.registrado_por?.nombres || ''} ${r.registrado_por?.apellidos || ''}`.trim(),
      });
    }

    // 4. Solicitudes de permiso
    for (const p of estudiante.solicitudes_permiso) {
      eventos.push({
        id: `permiso-${p.id}`,
        fecha: p.fecha,
        hora: '08:00',
        anio: p.fecha.slice(0, 4),
        categoria: 'PERMISO',
        titulo: `Solicitud de permiso (${p.tipo}) — ${p.estado}`,
        descripcion: `${p.descripcion}${p.respuesta_revision ? ` · Revisión: ${p.respuesta_revision}` : ''}`,
        estado: p.estado,
        responsable: `${p.solicitado_por?.nombres || ''} ${p.solicitado_por?.apellidos || ''}`.trim(),
      });
    }

    // 5. Incidencias
    for (const inc of estudiante.incidencias) {
      const dtInc = new Date(inc.fecha_incidente);
      const fechaInc = dtInc.toISOString().slice(0, 10);
      const horaInc = dtInc.toTimeString().slice(0, 5);
      eventos.push({
        id: `inc-${inc.id}`,
        fecha: fechaInc,
        hora: horaInc,
        anio: fechaInc.slice(0, 4),
        categoria: 'INCIDENCIA',
        titulo: `Incidencia ${inc.codigo || `#${inc.id}`} (${inc.naturaleza} · Gravedad ${inc.gravedad})`,
        descripcion: `${inc.categoria}: ${inc.descripcion}${inc.acciones_tomadas ? ` · Acciones: ${inc.acciones_tomadas}` : ''}`,
        estado: inc.estado,
        responsable: `${inc.registrado_por?.nombres || ''} ${inc.registrado_por?.apellidos || ''}`.trim(),
      });
    }

    // 6. Citaciones
    for (const cit of estudiante.citaciones) {
      eventos.push({
        id: `cit-${cit.id}`,
        fecha: cit.fecha_programada,
        hora: cit.hora_programada || '10:00',
        anio: cit.fecha_programada.slice(0, 4),
        categoria: 'CITACION',
        titulo: `Citación a padre de familia (${cit.lugar})`,
        descripcion: `Motivo: ${cit.motivo}. Atenderá: ${cit.responsable?.nombres || ''} ${cit.responsable?.apellidos || ''} (${cit.rol_responsable}).${
          cit.respuesta_padre ? ` Respuesta del padre: ${cit.respuesta_padre}.` : ''
        }`,
        estado: cit.estado,
        responsable: `${cit.responsable?.nombres || ''} ${cit.responsable?.apellidos || ''}`.trim(),
      });
    }

    // 7. Reuniones
    for (const reu of estudiante.reuniones) {
      eventos.push({
        id: `reu-${reu.id}`,
        fecha: reu.fecha,
        hora: reu.hora || '10:05',
        anio: reu.fecha.slice(0, 4),
        categoria: 'REUNION',
        titulo: `Reunión con ${reu.responsable?.rol || 'Tutor'} — ${reu.motivo}`,
        descripcion: `${reu.descripcion} · Acuerdos: ${reu.acuerdos}`,
        estado: 'REALIZADA',
        responsable: `${reu.responsable?.nombres || ''} ${reu.responsable?.apellidos || ''}`.trim(),
      });
    }

    // 8. Actas
    for (const act of estudiante.actas) {
      const dtAct = new Date(act.created_at);
      const fechaAct = dtAct.toISOString().slice(0, 10);
      const horaAct = dtAct.toTimeString().slice(0, 5);
      eventos.push({
        id: `acta-${act.id}`,
        fecha: fechaAct,
        hora: horaAct,
        anio: fechaAct.slice(0, 4),
        categoria: 'ACTA',
        titulo: `Acta de ${act.tipo} registrada (${act.codigo})`,
        descripcion: `${act.motivo}: ${act.contenido}`,
        estado: act.aceptado_padre ? 'ACEPTADA' : 'EMITIDA',
        responsable: `${act.creado_por?.nombres || ''} ${act.creado_por?.apellidos || ''}`.trim(),
      });
    }

    // 9. Compromisos y Seguimientos
    for (const cmp of estudiante.compromisos) {
      const dtCmp = new Date(cmp.created_at);
      const fechaCmp = dtCmp.toISOString().slice(0, 10);
      eventos.push({
        id: `cmp-${cmp.id}`,
        fecha: fechaCmp,
        hora: '10:35',
        anio: fechaCmp.slice(0, 4),
        categoria: 'COMPROMISO',
        titulo: `Compromiso creado (${cmp.codigo})`,
        descripcion: `${cmp.descripcion} · Responsable: ${cmp.responsable_compromiso} · Fecha seguimiento: ${cmp.fecha_seguimiento}`,
        estado: cmp.estado,
        responsable: cmp.responsable_compromiso,
      });

      for (const seg of cmp.seguimientos || []) {
        eventos.push({
          id: `seg-${seg.id}`,
          fecha: seg.fecha,
          hora: '12:00',
          anio: seg.fecha.slice(0, 4),
          categoria: 'SEGUIMIENTO',
          titulo: `Seguimiento del compromiso ${cmp.codigo} — ${seg.resultado}`,
          descripcion: seg.observaciones,
          estado: seg.resultado,
          responsable: `${seg.registrado_por?.nombres || ''} ${seg.registrado_por?.apellidos || ''}`.trim(),
        });
      }
    }

    // Ordenar cronológicamente (más reciente primero)
    eventos.sort((a, b) => {
      const cmpFecha = b.fecha.localeCompare(a.fecha);
      if (cmpFecha !== 0) return cmpFecha;
      return (b.hora || '').localeCompare(a.hora || '');
    });

    // Filtrar por año escolar y categoría si se solicita (Sección 51)
    let eventosFiltrados = eventos;
    if (anio_escolar && anio_escolar !== 'TODOS') {
      eventosFiltrados = eventosFiltrados.filter((e) => e.anio === String(anio_escolar));
    }
    if (categoria && categoria !== 'TODAS') {
      eventosFiltrados = eventosFiltrados.filter((e) => e.categoria === categoria);
    }

    // Resumen histórico agrupado por Año Escolar (Sección 51)
    const historialPorAnio = estudiante.matriculas.map((mat) => {
      const anioStr = String(mat.anio_escolar?.nombre || mat.anio_escolar_num);
      const evAnio = eventos.filter((e) => e.anio === anioStr);
      return {
        matricula_id: mat.id,
        anio_escolar: anioStr,
        grado_seccion: `${mat.grado_seccion?.grado}° "${mat.grado_seccion?.seccion}" ${mat.grado_seccion?.nivel}`,
        estado_matricula: mat.estado,
        fecha_matricula: mat.fecha_matricula,
        total_eventos: evAnio.length,
        asistencias: evAnio.filter((e) => e.categoria === 'ASISTENCIA' && e.estado === 'PRESENTE').length,
        tardanzas: evAnio.filter((e) => e.categoria === 'ASISTENCIA' && e.estado === 'TARDANZA').length,
        faltas: evAnio.filter((e) => e.categoria === 'ASISTENCIA' && e.estado === 'FALTA').length,
        permisos: evAnio.filter((e) => e.categoria === 'PERMISO').length,
        retiros: evAnio.filter((e) => e.categoria === 'RETIRO').length,
        incidencias: evAnio.filter((e) => e.categoria === 'INCIDENCIA').length,
        reuniones: evAnio.filter((e) => e.categoria === 'REUNION').length,
        compromisos: evAnio.filter((e) => e.categoria === 'COMPROMISO').length,
      };
    });

    return res.json({
      ok: true,
      estudiante,
      historialPorAnio,
      eventosLineaTiempo: eventosFiltrados,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

async function construirDatosReporte(query) {
  const {
    fecha_inicio,
    fecha_fin,
    grado_seccion_id,
    grado,
    seccion,
    estado,
    estudiante_id,
    busqueda,
  } = query;

  const whereAsistencia = {
    tipo_registro: 'GENERAL',
  };

  if (fecha_inicio || fecha_fin) {
    whereAsistencia.fecha = {};
    if (fecha_inicio) whereAsistencia.fecha.gte = fecha_inicio;
    if (fecha_fin) whereAsistencia.fecha.lte = fecha_fin;
  }

  if (estado) whereAsistencia.estado = estado;
  if (estudiante_id) whereAsistencia.estudiante_id = Number(estudiante_id);

  const whereEstudiante = {};
  if (grado_seccion_id) {
    whereEstudiante.grado_seccion_id = Number(grado_seccion_id);
  } else if (grado || seccion) {
    whereEstudiante.grado_seccion = {};
    if (grado) whereEstudiante.grado_seccion.grado = Number(grado);
    if (seccion) whereEstudiante.grado_seccion.seccion = String(seccion).toUpperCase();
  }

  if (busqueda) {
    whereEstudiante.OR = [
      { codigo_estudiante: { contains: busqueda, mode: 'insensitive' } },
      { codigo_qr_unico: { contains: busqueda, mode: 'insensitive' } },
      { usuario: { nombres: { contains: busqueda, mode: 'insensitive' } } },
      { usuario: { apellidos: { contains: busqueda, mode: 'insensitive' } } },
      { usuario: { dni: { contains: busqueda, mode: 'insensitive' } } },
    ];
  }

  if (Object.keys(whereEstudiante).length > 0) {
    whereAsistencia.estudiante = whereEstudiante;
  }

  const filtroEstSub = {
    ...(estudiante_id ? { estudiante_id: Number(estudiante_id) } : {}),
    ...(Object.keys(whereEstudiante).length > 0 ? { estudiante: whereEstudiante } : {}),
  };

  const [
    registros,
    estudiantesFiltrados,
    auditorias,
    permisos,
    situacionesSalud,
    retiros,
    incidencias,
    citaciones,
    reuniones,
    compromisos,
  ] = await Promise.all([
    prisma.asistencia.findMany({
      where: whereAsistencia,
      orderBy: [{ fecha: 'desc' }, { estudiante: { usuario: { apellidos: 'asc' } } }],
      include: {
        estudiante: {
          include: {
            usuario: { select: { nombres: true, apellidos: true, dni: true } },
            grado_seccion: true,
          },
        },
        registrado_por: { select: { nombres: true, apellidos: true, rol: true } },
      },
    }),
    prisma.estudiante.findMany({
      where: {
        ...(estudiante_id ? { id: Number(estudiante_id) } : {}),
        ...whereEstudiante,
      },
      orderBy: [
        { grado_seccion: { grado: 'asc' } },
        { grado_seccion: { seccion: 'asc' } },
        { usuario: { apellidos: 'asc' } },
      ],
      include: {
        usuario: { select: { nombres: true, apellidos: true, dni: true } },
        grado_seccion: true,
      },
    }),
    prisma.auditoriaAsistencia.findMany({
      where: {
        asistencia: whereAsistencia,
      },
      orderBy: { fecha_hora_cambio: 'desc' },
      include: {
        modificado_por: { select: { nombres: true, apellidos: true, rol: true } },
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
    }),
    prisma.solicitudPermiso.findMany({
      where: filtroEstSub,
      orderBy: { created_at: 'desc' },
      include: {
        estudiante: {
          include: {
            usuario: { select: { nombres: true, apellidos: true, dni: true } },
            grado_seccion: true,
          },
        },
        solicitado_por: { select: { nombres: true, apellidos: true } },
        revisado_por: { select: { nombres: true, apellidos: true } },
      },
    }),
    prisma.situacionSalud.findMany({
      where: filtroEstSub,
      orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
      include: {
        estudiante: {
          include: {
            usuario: { select: { nombres: true, apellidos: true, dni: true } },
            grado_seccion: true,
          },
        },
        registrado_por: { select: { nombres: true, apellidos: true } },
      },
    }),
    prisma.retiroEstudiante.findMany({
      where: filtroEstSub,
      orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
      include: {
        estudiante: {
          include: {
            usuario: { select: { nombres: true, apellidos: true, dni: true } },
            grado_seccion: true,
          },
        },
        registrado_por: { select: { nombres: true, apellidos: true } },
      },
    }),
    prisma.incidenciaConducta.findMany({
      where: filtroEstSub,
      orderBy: { fecha_incidente: 'desc' },
      include: {
        estudiante: {
          include: {
            usuario: { select: { nombres: true, apellidos: true, dni: true } },
            grado_seccion: true,
          },
        },
        registrado_por: { select: { nombres: true, apellidos: true, rol: true } },
      },
    }),
    prisma.citacion.findMany({
      where: filtroEstSub,
      orderBy: [{ fecha_programada: 'desc' }, { id: 'desc' }],
      include: {
        estudiante: {
          include: {
            usuario: { select: { nombres: true, apellidos: true, dni: true } },
            grado_seccion: true,
          },
        },
        responsable: { select: { nombres: true, apellidos: true, rol: true } },
      },
    }),
    prisma.reunion.findMany({
      where: filtroEstSub,
      orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
      include: {
        estudiante: {
          include: {
            usuario: { select: { nombres: true, apellidos: true, dni: true } },
            grado_seccion: true,
          },
        },
        responsable: { select: { nombres: true, apellidos: true, rol: true } },
      },
    }),
    prisma.compromiso.findMany({
      where: filtroEstSub,
      orderBy: { created_at: 'desc' },
      include: {
        estudiante: {
          include: {
            usuario: { select: { nombres: true, apellidos: true, dni: true } },
            grado_seccion: true,
          },
        },
        acta: true,
      },
    }),
  ]);

  const consolidadoEstudiantes = estudiantesFiltrados.map((est) => {
    const misRegistros = registros.filter((r) => r.estudiante_id === est.id);
    const presentes = misRegistros.filter((r) => r.estado === 'PRESENTE').length;
    const tardanzas = misRegistros.filter((r) => r.estado === 'TARDANZA').length;
    const faltas = misRegistros.filter((r) => r.estado === 'FALTA').length;
    const justificados = misRegistros.filter(
      (r) => r.estado === 'JUSTIFICADO' || r.estado === 'PERMISO'
    ).length;
    const retirados = misRegistros.filter((r) => r.estado === 'RETIRADO').length;
    const total = misRegistros.length;

    const porcentajeAsistencia =
      total > 0
        ? Math.round(((presentes + tardanzas + justificados + retirados) / total) * 100)
        : 100;

    const riesgo = analizarRiesgoAsistencia(misRegistros);

    return {
      estudiante_id: est.id,
      codigo_estudiante: est.codigo_estudiante,
      codigo_qr_unico: est.codigo_qr_unico,
      dni: est.usuario.dni,
      apellidos_nombres: `${est.usuario.apellidos}, ${est.usuario.nombres}`,
      seccion: `${est.grado_seccion.grado}° "${est.grado_seccion.seccion}"`,
      puntaje_conducta: est.puntaje_conducta,
      semaforo_conducta: calcularSemaforoConducta(est.puntaje_conducta).color,
      total_registros: total,
      presentes,
      tardanzas,
      faltas,
      justificados,
      retirados,
      incidencias_count: incidencias.filter((i) => i.estudiante_id === est.id).length,
      citaciones_count: citaciones.filter((c) => c.estudiante_id === est.id).length,
      compromisos_count: compromisos.filter((c) => c.estudiante_id === est.id).length,
      porcentaje_asistencia: porcentajeAsistencia,
      max_racha_faltas: riesgo.maxRachaFaltas,
      alerta_recurrente: riesgo.alertaFaltasConsecutivas || riesgo.alertaExcesoTardanzas,
    };
  });

  return {
    registros,
    consolidadoEstudiantes,
    auditorias,
    permisos,
    situacionesSalud,
    retiros,
    incidencias,
    citaciones,
    reuniones,
    compromisos,
  };
}

async function obtenerReporteMulticriterio(req, res) {
  try {
    const datos = await construirDatosReporte(req.query);
    return res.json({
      ok: true,
      ...datos,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

async function exportarExcel(req, res) {
  try {
    const {
      registros,
      consolidadoEstudiantes,
      auditorias,
      permisos,
      situacionesSalud,
      retiros,
      incidencias,
      citaciones,
      compromisos,
    } = await construirDatosReporte(req.query);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SIAE - Sistema Integral de Gestión y Seguimiento Escolar QR';
    workbook.created = new Date();

    // HOJA 1: CONSOLIDADO POR ESTUDIANTE
    const sheetConsolidado = workbook.addWorksheet('Consolidado por Alumno');
    sheetConsolidado.columns = [
      { header: 'Código SIAE', key: 'codigo_estudiante', width: 20 },
      { header: 'Token QR', key: 'codigo_qr_unico', width: 20 },
      { header: 'DNI', key: 'dni', width: 12 },
      { header: 'Apellidos y Nombres', key: 'apellidos_nombres', width: 32 },
      { header: 'Grado y Sección', key: 'seccion', width: 16 },
      { header: 'Presentes', key: 'presentes', width: 11 },
      { header: 'Tardanzas', key: 'tardanzas', width: 11 },
      { header: 'Faltas', key: 'faltas', width: 11 },
      { header: 'Justif./Perm.', key: 'justificados', width: 13 },
      { header: 'Retiros', key: 'retirados', width: 11 },
      { header: '% Asistencia', key: 'porcentaje_asistencia', width: 13 },
      { header: 'Incidencias', key: 'incidencias_count', width: 12 },
      { header: 'Citaciones', key: 'citaciones_count', width: 12 },
      { header: 'Compromisos', key: 'compromisos_count', width: 13 },
      { header: 'Conducta', key: 'puntaje_conducta', width: 12 },
    ];

    sheetConsolidado.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheetConsolidado.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F172A' },
    };

    for (const item of consolidadoEstudiantes) {
      sheetConsolidado.addRow({
        ...item,
        porcentaje_asistencia: `${item.porcentaje_asistencia}%`,
      });
    }

    // HOJA 2: DETALLE DIARIO DE ASISTENCIAS
    const sheetDetalle = workbook.addWorksheet('Asistencias y Tardanzas');
    sheetDetalle.columns = [
      { header: 'Fecha', key: 'fecha', width: 14 },
      { header: 'Código SIAE', key: 'codigo', width: 20 },
      { header: 'DNI', key: 'dni', width: 12 },
      { header: 'Estudiante', key: 'estudiante', width: 32 },
      { header: 'Sección', key: 'seccion', width: 14 },
      { header: 'Estado', key: 'estado', width: 15 },
      { header: 'Hora Entrada', key: 'hora_entrada', width: 14 },
      { header: 'Hora Salida', key: 'hora_salida', width: 14 },
      { header: 'Min. Tardanza', key: 'minutos_tardanza', width: 15 },
      { header: 'Registrado Por', key: 'registrador', width: 24 },
      { header: 'Motivo / Justificación', key: 'motivo', width: 36 },
    ];

    sheetDetalle.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheetDetalle.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' },
    };

    for (const r of registros) {
      sheetDetalle.addRow({
        fecha: r.fecha,
        codigo: r.estudiante.codigo_estudiante,
        dni: r.estudiante.usuario.dni,
        estudiante: `${r.estudiante.usuario.apellidos}, ${r.estudiante.usuario.nombres}`,
        seccion: `${r.estudiante.grado_seccion.grado}° "${r.estudiante.grado_seccion.seccion}"`,
        estado: r.estado,
        hora_entrada: r.hora_entrada || '--:--',
        hora_salida: r.hora_salida || '--:--',
        minutos_tardanza: r.minutos_tardanza || 0,
        registrador: r.registrado_por
          ? `${r.registrado_por.nombres} ${r.registrado_por.apellidos}`
          : 'Sistema Automático',
        motivo: r.motivo_justificacion || '',
      });
    }

    // HOJA 3: PERMISOS, SALUD Y RETIROS
    const sheetJornada = workbook.addWorksheet('Permisos Salud y Retiros');
    sheetJornada.columns = [
      { header: 'Tipo Registro', key: 'tipo_evento', width: 20 },
      { header: 'Fecha y Hora', key: 'fecha_hora', width: 18 },
      { header: 'Estudiante', key: 'estudiante', width: 30 },
      { header: 'Sección', key: 'seccion', width: 12 },
      { header: 'Motivo / Categoría', key: 'motivo', width: 24 },
      { header: 'Detalle / Persona que Recoge', key: 'detalle', width: 42 },
      { header: 'Estado', key: 'estado', width: 18 },
    ];

    sheetJornada.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheetJornada.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF334155' },
    };

    for (const p of permisos) {
      sheetJornada.addRow({
        tipo_evento: 'SOLICITUD PERMISO',
        fecha_hora: p.fecha,
        estudiante: `${p.estudiante?.usuario?.apellidos}, ${p.estudiante?.usuario?.nombres}`,
        seccion: `${p.estudiante?.grado_seccion?.grado}° "${p.estudiante?.grado_seccion?.seccion}"`,
        motivo: p.tipo,
        detalle: p.descripcion,
        estado: p.estado,
      });
    }
    for (const s of situacionesSalud) {
      sheetJornada.addRow({
        tipo_evento: 'SITUACIÓN SALUD',
        fecha_hora: `${s.fecha} ${s.hora}`,
        estudiante: `${s.estudiante?.usuario?.apellidos}, ${s.estudiante?.usuario?.nombres}`,
        seccion: `${s.estudiante?.grado_seccion?.grado}° "${s.estudiante?.grado_seccion?.seccion}"`,
        motivo: s.tipo_situacion,
        detalle: `${s.descripcion} (Acción: ${s.accion_realizada})`,
        estado: s.estado,
      });
    }
    for (const ret of retiros) {
      sheetJornada.addRow({
        tipo_evento: 'RETIRO ESTUDIANTE',
        fecha_hora: `${ret.fecha} ${ret.hora_salida}`,
        estudiante: `${ret.estudiante?.usuario?.apellidos}, ${ret.estudiante?.usuario?.nombres}`,
        seccion: `${ret.estudiante?.grado_seccion?.grado}° "${ret.estudiante?.grado_seccion?.seccion}"`,
        motivo: ret.motivo,
        detalle: `Recogió: ${ret.recogido_por_nombre} (${ret.parentesco}, ${ret.documento_verificado} ${ret.recogido_por_dni})`,
        estado: 'RETIRADO',
      });
    }

    // HOJA 4: INCIDENCIAS, CITACIONES Y COMPROMISOS
    const sheetSeguimiento = workbook.addWorksheet('Incidencias y Compromisos');
    sheetSeguimiento.columns = [
      { header: 'Módulo', key: 'modulo', width: 16 },
      { header: 'Código / Fecha', key: 'codigo_fecha', width: 20 },
      { header: 'Estudiante', key: 'estudiante', width: 30 },
      { header: 'Sección', key: 'seccion', width: 12 },
      { header: 'Clasificación / Lugar', key: 'clasificacion', width: 24 },
      { header: 'Descripción / Compromiso', key: 'descripcion', width: 45 },
      { header: 'Estado', key: 'estado', width: 18 },
    ];

    sheetSeguimiento.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheetSeguimiento.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F172A' },
    };

    for (const inc of incidencias) {
      sheetSeguimiento.addRow({
        modulo: 'INCIDENCIA',
        codigo_fecha: inc.codigo || new Date(inc.fecha_incidente).toISOString().slice(0, 10),
        estudiante: `${inc.estudiante?.usuario?.apellidos}, ${inc.estudiante?.usuario?.nombres}`,
        seccion: `${inc.estudiante?.grado_seccion?.grado}° "${inc.estudiante?.grado_seccion?.seccion}"`,
        clasificacion: `${inc.naturaleza} (${inc.gravedad})`,
        descripcion: `${inc.categoria}: ${inc.descripcion}`,
        estado: inc.estado,
      });
    }
    for (const cit of citaciones) {
      sheetSeguimiento.addRow({
        modulo: 'CITACIÓN',
        codigo_fecha: `${cit.fecha_programada} ${cit.hora_programada}`,
        estudiante: `${cit.estudiante?.usuario?.apellidos}, ${cit.estudiante?.usuario?.nombres}`,
        seccion: `${cit.estudiante?.grado_seccion?.grado}° "${cit.estudiante?.grado_seccion?.seccion}"`,
        clasificacion: `${cit.lugar} (${cit.rol_responsable})`,
        descripcion: cit.motivo,
        estado: cit.estado,
      });
    }
    for (const cmp of compromisos) {
      sheetSeguimiento.addRow({
        modulo: 'COMPROMISO',
        codigo_fecha: `${cmp.codigo} (${cmp.fecha_seguimiento})`,
        estudiante: `${cmp.estudiante?.usuario?.apellidos}, ${cmp.estudiante?.usuario?.nombres}`,
        seccion: `${cmp.estudiante?.grado_seccion?.grado}° "${cmp.estudiante?.grado_seccion?.seccion}"`,
        clasificacion: cmp.responsable_compromiso,
        descripcion: cmp.descripcion,
        estado: cmp.estado,
      });
    }

    // HOJA 5: AUDITORÍA DE MODIFICACIONES
    const sheetAuditoria = workbook.addWorksheet('Log de Auditoría');
    sheetAuditoria.columns = [
      { header: 'Fecha/Hora Cambio', key: 'fecha_cambio', width: 22 },
      { header: 'Fecha Asistencia', key: 'fecha_asistencia', width: 16 },
      { header: 'Estudiante', key: 'estudiante', width: 30 },
      { header: 'Sección', key: 'seccion', width: 12 },
      { header: 'Estado Anterior', key: 'anterior', width: 16 },
      { header: 'Estado Nuevo', key: 'nuevo', width: 16 },
      { header: 'Modificado Por', key: 'responsable', width: 28 },
      { header: 'Motivo / Documento Probatorio', key: 'motivo', width: 42 },
    ];

    sheetAuditoria.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheetAuditoria.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF475569' },
    };

    for (const aud of auditorias) {
      sheetAuditoria.addRow({
        fecha_cambio: new Date(aud.fecha_hora_cambio).toLocaleString('es-PE', {
          timeZone: 'America/Lima',
        }),
        fecha_asistencia: aud.asistencia.fecha,
        estudiante: `${aud.asistencia.estudiante.usuario.apellidos}, ${aud.asistencia.estudiante.usuario.nombres}`,
        seccion: `${aud.asistencia.estudiante.grado_seccion.grado}° "${aud.asistencia.estudiante.grado_seccion.seccion}"`,
        anterior: aud.estado_anterior,
        nuevo: aud.estado_nuevo,
        responsable: `${aud.modificado_por.nombres} ${aud.modificado_por.apellidos} (${aud.modificado_por.rol})`,
        motivo: aud.motivo_cambio,
      });
    }

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Reporte_Integral_SIAE_${getLimaDateParts().fecha}.xlsx"`
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error al exportar Excel SIAE:', err);
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

async function enviarCitacionApoderado(req, res) {
  try {
    const { estudiante_id, motivo } = req.body;
    if (!estudiante_id) {
      return res.status(400).json({ ok: false, mensaje: 'Indique el estudiante.' });
    }

    const est = await prisma.estudiante.findUnique({
      where: { id: Number(estudiante_id) },
      include: { usuario: true, grado_seccion: true },
    });

    if (!est) {
      return res.status(404).json({ ok: false, mensaje: 'Estudiante no encontrado.' });
    }

    const { fecha } = getLimaDateParts();
    await prisma.citacion.create({
      data: {
        estudiante_id: est.id,
        motivo: motivo || 'Seguimiento preventivo de asistencia y conducta escolar.',
        fecha_programada: fecha,
        hora_programada: '15:00',
        lugar: 'Oficina de Tutoría / Dirección',
        responsable_id: req.usuario.id,
        rol_responsable: req.usuario.rol,
        estado: 'PENDIENTE',
      },
    });

    await notificarPadresEstudiante({
      estudianteId: est.id,
      titulo: `Citación de Apoderado — Dirección / Tutoría (${est.grado_seccion.grado}° "${est.grado_seccion.seccion}")`,
      mensaje: `Se solicita la presencia del apoderado de ${est.usuario.nombres} ${est.usuario.apellidos}. Motivo: ${
        motivo || 'Seguimiento preventivo de asistencia y conducta escolar.'
      }`,
      tipo: 'CITACION',
      notificarTutor: true,
    });

    return res.json({
      ok: true,
      mensaje: `Citación formal generada y enviada al apoderado de ${est.usuario.nombres} ${est.usuario.apellidos}.`,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

module.exports = {
  obtenerDashboardDirectivo,
  obtenerLineaTiempoEstudiante,
  obtenerReporteMulticriterio,
  exportarExcel,
  enviarCitacionApoderado,
};
