const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const { generarTokenQR, registrarAuditoria } = require('../services/auditoria.service');
const { getLimaDateParts } = require('../utils/dateHelper');

async function obtenerConfiguracion(req, res) {
  try {
    let config = await prisma.configuracionEscolar.findFirst();
    if (!config) {
      config = await prisma.configuracionEscolar.create({ data: {} });
    }
    return res.json({ ok: true, configuracion: config });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

async function actualizarConfiguracion(req, res) {
  try {
    const {
      nombre_institucion,
      anio_escolar,
      hora_inicio_entrada,
      hora_limite_puntual,
      hora_limite_tardanza,
      hora_inicio_salida,
      ventana_antiduplicado_min,
      puntaje_conducta_inicial,
    } = req.body;

    let config = await prisma.configuracionEscolar.findFirst();
    if (!config) {
      config = await prisma.configuracionEscolar.create({ data: {} });
    }

    const actualizada = await prisma.configuracionEscolar.update({
      where: { id: config.id },
      data: {
        nombre_institucion: nombre_institucion ?? config.nombre_institucion,
        anio_escolar: anio_escolar ? Number(anio_escolar) : config.anio_escolar,
        hora_inicio_entrada: hora_inicio_entrada ?? config.hora_inicio_entrada,
        hora_limite_puntual: hora_limite_puntual ?? config.hora_limite_puntual,
        hora_limite_tardanza: hora_limite_tardanza ?? config.hora_limite_tardanza,
        hora_inicio_salida: hora_inicio_salida ?? config.hora_inicio_salida,
        ventana_antiduplicado_min:
          ventana_antiduplicado_min !== undefined
            ? Number(ventana_antiduplicado_min)
            : config.ventana_antiduplicado_min,
        puntaje_conducta_inicial:
          puntaje_conducta_inicial !== undefined
            ? Number(puntaje_conducta_inicial)
            : config.puntaje_conducta_inicial,
      },
    });

    await registrarAuditoria({
      usuario: req.usuario,
      accion: 'CONFIGURACION_ACTUALIZADA',
      entidad: 'CONFIGURACION',
      entidad_id: actualizada.id,
      descripcion: `Configuración institucional actualizada (Puntual: ${actualizada.hora_limite_puntual}, Tardanza: ${actualizada.hora_limite_tardanza}).`,
      metadata: actualizada,
    });

    return res.json({
      ok: true,
      mensaje: 'Configuración escolar de SIAE actualizada correctamente.',
      configuracion: actualizada,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

// ============================================================================
// AÑOS ESCOLARES (Secciones 51 y 80)
// ============================================================================
async function listarAniosEscolares(req, res) {
  try {
    const anios = await prisma.anioEscolar.findMany({
      orderBy: { nombre: 'desc' },
      include: {
        _count: {
          select: { matriculas: true },
        },
      },
    });
    return res.json({ ok: true, anios });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

async function crearAnioEscolar(req, res) {
  try {
    const { nombre, fecha_inicio, fecha_fin, estado = 'ACTIVO' } = req.body;
    if (!nombre || !fecha_inicio || !fecha_fin) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Complete el nombre del año escolar, fecha de inicio y fecha de fin.',
      });
    }

    const nuevo = await prisma.anioEscolar.create({
      data: {
        nombre: String(nombre).trim(),
        fecha_inicio,
        fecha_fin,
        estado,
      },
    });

    await registrarAuditoria({
      usuario: req.usuario,
      accion: 'ANIO_ESCOLAR_CREADO',
      entidad: 'ANIO_ESCOLAR',
      entidad_id: nuevo.id,
      descripcion: `Año escolar ${nuevo.nombre} creado (${nuevo.fecha_inicio} al ${nuevo.fecha_fin}).`,
      metadata: nuevo,
    });

    return res.status(201).json({
      ok: true,
      mensaje: `Año escolar ${nuevo.nombre} registrado.`,
      anio_escolar: nuevo,
    });
  } catch (err) {
    return res.status(400).json({ ok: false, mensaje: err.message });
  }
}

async function cambiarEstadoAnioEscolar(req, res) {
  try {
    const { id } = req.params;
    const { estado } = req.body;
    const actualizado = await prisma.anioEscolar.update({
      where: { id: Number(id) },
      data: { estado },
    });

    await registrarAuditoria({
      usuario: req.usuario,
      accion: 'ANIO_ESCOLAR_ESTADO',
      entidad: 'ANIO_ESCOLAR',
      entidad_id: actualizado.id,
      descripcion: `Estado del año escolar ${actualizado.nombre} cambiado a ${estado}.`,
    });

    return res.json({
      ok: true,
      mensaje: `Año escolar ${actualizado.nombre} actualizado a ${estado}.`,
      anio_escolar: actualizado,
    });
  } catch (err) {
    return res.status(400).json({ ok: false, mensaje: err.message });
  }
}

// ============================================================================
// GRADOS Y SECCIONES
// ============================================================================
async function listarGradosSecciones(req, res) {
  try {
    const { anio_escolar } = req.query;
    const where = {};
    if (anio_escolar) {
      where.anio_escolar = Number(anio_escolar);
    }

    const grados = await prisma.gradoSeccion.findMany({
      where,
      orderBy: [{ anio_escolar: 'desc' }, { grado: 'asc' }, { seccion: 'asc' }],
      include: {
        tutor_docente: {
          select: { id: true, nombres: true, apellidos: true, email: true, rol: true },
        },
        _count: {
          select: { estudiantes: true, matriculas: true },
        },
      },
    });
    return res.json({ ok: true, grados });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

async function crearGradoSeccion(req, res) {
  try {
    const { grado, seccion, tutor_docente_id, anio_escolar } = req.body;
    const nuevo = await prisma.gradoSeccion.create({
      data: {
        grado: Number(grado),
        seccion: String(seccion).toUpperCase().trim(),
        tutor_docente_id: tutor_docente_id ? Number(tutor_docente_id) : null,
        anio_escolar: anio_escolar ? Number(anio_escolar) : 2026,
      },
    });

    await registrarAuditoria({
      usuario: req.usuario,
      accion: 'GRADO_SECCION_CREADO',
      entidad: 'GRADO_SECCION',
      entidad_id: nuevo.id,
      descripcion: `Aula ${nuevo.grado}° "${nuevo.seccion}" (${nuevo.anio_escolar}) creada.`,
      metadata: nuevo,
    });

    return res.status(201).json({
      ok: true,
      mensaje: 'Grado y sección creados.',
      grado_seccion: nuevo,
    });
  } catch (err) {
    return res.status(400).json({ ok: false, mensaje: err.message });
  }
}

// ============================================================================
// MATRÍCULAS (Sección 52)
// ============================================================================
async function listarMatriculas(req, res) {
  try {
    const { anio_escolar_id, anio_escolar_num, grado_seccion_id, estudiante_id, estado } = req.query;
    const where = {};
    if (anio_escolar_id) where.anio_escolar_id = Number(anio_escolar_id);
    if (anio_escolar_num) where.anio_escolar_num = Number(anio_escolar_num);
    if (grado_seccion_id) where.grado_seccion_id = Number(grado_seccion_id);
    if (estudiante_id) where.estudiante_id = Number(estudiante_id);
    if (estado) where.estado = estado;

    const matriculas = await prisma.matricula.findMany({
      where,
      orderBy: [{ anio_escolar_num: 'desc' }, { id: 'desc' }],
      include: {
        estudiante: {
          include: {
            usuario: { select: { id: true, nombres: true, apellidos: true, dni: true, email: true } },
          },
        },
        grado_seccion: true,
        anio_escolar: true,
      },
    });
    return res.json({ ok: true, matriculas });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

async function registrarMatricula(req, res) {
  try {
    const {
      estudiante_id,
      grado_seccion_id,
      anio_escolar_id,
      estado = 'MATRICULADO',
      fecha_matricula,
      observaciones,
    } = req.body;

    if (!estudiante_id || !grado_seccion_id || !anio_escolar_id) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Seleccione estudiante, año escolar y grado/sección.',
      });
    }

    const anioObj = await prisma.anioEscolar.findUnique({
      where: { id: Number(anio_escolar_id) },
    });
    if (!anioObj) {
      return res.status(404).json({ ok: false, mensaje: 'Año escolar no encontrado.' });
    }

    const anioNum = Number(anioObj.nombre) || 2026;
    const fechaMat = fecha_matricula || getLimaDateParts().fecha;

    const matricula = await prisma.$transaction(async (tx) => {
      const m = await tx.matricula.upsert({
        where: {
          estudiante_id_anio_escolar_id: {
            estudiante_id: Number(estudiante_id),
            anio_escolar_id: Number(anio_escolar_id),
          },
        },
        update: {
          grado_seccion_id: Number(grado_seccion_id),
          estado,
          fecha_matricula: fechaMat,
          observaciones: observaciones || null,
        },
        create: {
          estudiante_id: Number(estudiante_id),
          grado_seccion_id: Number(grado_seccion_id),
          anio_escolar_id: Number(anio_escolar_id),
          anio_escolar_num: anioNum,
          estado,
          fecha_matricula: fechaMat,
          observaciones: observaciones || null,
        },
        include: {
          estudiante: { include: { usuario: true } },
          grado_seccion: true,
          anio_escolar: true,
        },
      });

      // Si el año escolar está activo, actualizar el aula actual del estudiante sin perder matrículas pasadas
      if (anioObj.estado === 'ACTIVO') {
        await tx.estudiante.update({
          where: { id: Number(estudiante_id) },
          data: {
            grado_seccion_id: Number(grado_seccion_id),
            estado: estado === 'RETIRADO' ? 'RETIRADO' : 'ACTIVO',
          },
        });
      }

      return m;
    });

    await registrarAuditoria({
      usuario: req.usuario,
      accion: 'MATRICULA_REGISTRADA',
      entidad: 'MATRICULA',
      entidad_id: matricula.id,
      estudiante_id: matricula.estudiante_id,
      descripcion: `Matrícula ${matricula.anio_escolar.nombre} (${matricula.grado_seccion.grado}° "${matricula.grado_seccion.seccion}") registrada para ${matricula.estudiante.usuario.nombres} ${matricula.estudiante.usuario.apellidos} — Estado: ${matricula.estado}.`,
      metadata: {
        anio_escolar: matricula.anio_escolar.nombre,
        grado: matricula.grado_seccion.grado,
        seccion: matricula.grado_seccion.seccion,
        estado: matricula.estado,
      },
    });

    return res.status(201).json({
      ok: true,
      mensaje: 'Matrícula registrada y vinculada al historial del estudiante.',
      matricula,
    });
  } catch (err) {
    return res.status(400).json({ ok: false, mensaje: err.message });
  }
}

// ============================================================================
// USUARIOS Y VINCULACIÓN PADRE-ESTUDIANTE
// ============================================================================
async function listarUsuarios(req, res) {
  try {
    const { rol, busqueda } = req.query;
    const where = {};
    if (rol) where.rol = rol;
    if (busqueda) {
      where.OR = [
        { nombres: { contains: busqueda, mode: 'insensitive' } },
        { apellidos: { contains: busqueda, mode: 'insensitive' } },
        { dni: { contains: busqueda, mode: 'insensitive' } },
        { email: { contains: busqueda, mode: 'insensitive' } },
      ];
    }

    const usuarios = await prisma.usuario.findMany({
      where,
      orderBy: { id: 'desc' },
      select: {
        id: true,
        nombres: true,
        apellidos: true,
        dni: true,
        email: true,
        telefono: true,
        rol: true,
        activo: true,
        created_at: true,
        estudiante_perfil: {
          include: { grado_seccion: true },
        },
        secciones_tutoradas: true,
        hijos_vinculados: {
          include: {
            estudiante: {
              include: { usuario: true, grado_seccion: true },
            },
          },
        },
      },
    });

    return res.json({ ok: true, usuarios });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

async function crearUsuario(req, res) {
  try {
    const {
      nombres,
      apellidos,
      dni,
      email,
      password,
      telefono,
      rol,
      grado_seccion_id,
      fecha_nacimiento,
      sexo,
      estudiante_id_vinculo,
      parentesco,
    } = req.body;

    if (!nombres || !apellidos || !dni || !email || !rol) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Complete los campos obligatorios: nombres, apellidos, DNI, email y rol.',
      });
    }

    const password_hash = await bcrypt.hash(password || '123456', 10);

    const resultado = await prisma.$transaction(async (tx) => {
      const usuario = await tx.usuario.create({
        data: {
          nombres: nombres.trim(),
          apellidos: apellidos.trim(),
          dni: dni.trim(),
          email: email.trim().toLowerCase(),
          password_hash,
          telefono: telefono || null,
          rol,
        },
      });

      if (rol === 'ESTUDIANTE') {
        if (!grado_seccion_id) {
          throw new Error('Para registrar un estudiante debe seleccionar su Grado y Sección.');
        }
        const totalEst = await tx.estudiante.count();
        const correlativo = String(totalEst + 1).padStart(4, '0');
        const codigo_estudiante = `SIAE-2026-SEC-${correlativo}`;
        const tokenQR = generarTokenQR();

        const nuevoEst = await tx.estudiante.create({
          data: {
            usuario_id: usuario.id,
            codigo_qr_unico: tokenQR,
            codigo_estudiante,
            codigo_modular: `MOD-2026-${correlativo}`,
            grado_seccion_id: Number(grado_seccion_id),
            puntaje_conducta: 100,
            fecha_nacimiento: fecha_nacimiento || null,
            sexo: sexo || null,
            estado: 'ACTIVO',
          },
        });

        // Registrar el QR en la tabla histórica codigos_qr (Sección 14)
        await tx.codigoQR.create({
          data: {
            estudiante_id: nuevoEst.id,
            token: tokenQR,
            estado: 'ACTIVO',
            generado_por_id: req.usuario?.id || null,
          },
        });

        // Registrar su matrícula activa si existe año escolar activo
        const anioActivo = await tx.anioEscolar.findFirst({
          where: { estado: 'ACTIVO' },
          orderBy: { nombre: 'desc' },
        });
        if (anioActivo) {
          await tx.matricula.create({
            data: {
              estudiante_id: nuevoEst.id,
              grado_seccion_id: Number(grado_seccion_id),
              anio_escolar_id: anioActivo.id,
              anio_escolar_num: Number(anioActivo.nombre) || 2026,
              estado: 'MATRICULADO',
              fecha_matricula: getLimaDateParts().fecha,
              observaciones: 'Matrícula inicial generada al registrar estudiante.',
            },
          });
        }
      }

      if (rol === 'PADRE' && estudiante_id_vinculo) {
        await tx.padreEstudiante.create({
          data: {
            padre_usuario_id: usuario.id,
            estudiante_id: Number(estudiante_id_vinculo),
            parentesco: parentesco || 'PADRE',
            recibe_alertas: true,
          },
        });
      }

      return usuario;
    });

    await registrarAuditoria({
      usuario: req.usuario,
      accion: 'USUARIO_CREADO',
      entidad: 'USUARIO',
      entidad_id: resultado.id,
      descripcion: `Usuario ${resultado.nombres} ${resultado.apellidos} (${resultado.rol}) creado.`,
      metadata: { email: resultado.email, rol: resultado.rol },
    });

    return res.status(201).json({
      ok: true,
      mensaje: `Usuario ${resultado.nombres} ${resultado.apellidos} (${resultado.rol}) creado exitosamente.`,
      usuario: resultado,
    });
  } catch (err) {
    return res.status(400).json({
      ok: false,
      mensaje: err.message || 'No se pudo registrar el usuario.',
    });
  }
}

async function cambiarEstadoUsuario(req, res) {
  try {
    const { id } = req.params;
    const { activo } = req.body;
    const actualizado = await prisma.usuario.update({
      where: { id: Number(id) },
      data: { activo: Boolean(activo) },
    });

    await registrarAuditoria({
      usuario: req.usuario,
      accion: Boolean(activo) ? 'USUARIO_ACTIVADO' : 'USUARIO_DESACTIVADO',
      entidad: 'USUARIO',
      entidad_id: actualizado.id,
      descripcion: `Usuario ${actualizado.nombres} ${actualizado.apellidos} (${actualizado.rol}) ${Boolean(activo) ? 'activado' : 'desactivado'}.`,
    });

    return res.json({
      ok: true,
      mensaje: 'Estado del usuario actualizado.',
      usuario: actualizado,
    });
  } catch (err) {
    return res.status(400).json({ ok: false, mensaje: err.message });
  }
}

async function vincularPadreEstudiante(req, res) {
  try {
    const { padre_usuario_id, estudiante_id, parentesco = 'PADRE' } = req.body;
    if (!padre_usuario_id || !estudiante_id) {
      return res.status(400).json({
        ok: false,
        mensaje: 'Seleccione el padre/apoderado y el estudiante a vincular.',
      });
    }

    const vinculo = await prisma.padreEstudiante.upsert({
      where: {
        padre_usuario_id_estudiante_id: {
          padre_usuario_id: Number(padre_usuario_id),
          estudiante_id: Number(estudiante_id),
        },
      },
      update: { parentesco },
      create: {
        padre_usuario_id: Number(padre_usuario_id),
        estudiante_id: Number(estudiante_id),
        parentesco,
        recibe_alertas: true,
      },
      include: {
        padre: { select: { nombres: true, apellidos: true } },
        estudiante: { include: { usuario: { select: { nombres: true, apellidos: true } } } },
      },
    });

    await registrarAuditoria({
      usuario: req.usuario,
      accion: 'PADRE_ESTUDIANTE_VINCULADO',
      entidad: 'ESTUDIANTE',
      entidad_id: Number(estudiante_id),
      estudiante_id: Number(estudiante_id),
      descripcion: `Asociación registrada: ${vinculo.padre.nombres} ${vinculo.padre.apellidos} (${parentesco}) con el estudiante ${vinculo.estudiante.usuario.nombres} ${vinculo.estudiante.usuario.apellidos}.`,
    });

    return res.status(201).json({
      ok: true,
      mensaje: 'Asociación padre/apoderado — estudiante registrada.',
      vinculo,
    });
  } catch (err) {
    return res.status(400).json({ ok: false, mensaje: err.message });
  }
}

// ============================================================================
// ESTUDIANTES Y GESTIÓN DE CÓDIGOS QR / PÉRDIDA DE FOTOCHECK (Sección 20)
// ============================================================================
async function listarEstudiantes(req, res) {
  try {
    const { grado_seccion_id, grado, seccion, busqueda } = req.query;
    const where = {};

    // Si es PADRE, solamente puede consultar a sus hijos asociados (Sección 11 y 68)
    if (req.usuario?.rol === 'PADRE') {
      where.padres = {
        some: { padre_usuario_id: req.usuario.id },
      };
    }

    if (grado_seccion_id) {
      where.grado_seccion_id = Number(grado_seccion_id);
    } else if (grado || seccion) {
      where.grado_seccion = {};
      if (grado) where.grado_seccion.grado = Number(grado);
      if (seccion) where.grado_seccion.seccion = String(seccion).toUpperCase();
    }

    if (busqueda) {
      where.OR = [
        { codigo_estudiante: { contains: busqueda, mode: 'insensitive' } },
        { codigo_qr_unico: { contains: busqueda, mode: 'insensitive' } },
        { usuario: { nombres: { contains: busqueda, mode: 'insensitive' } } },
        { usuario: { apellidos: { contains: busqueda, mode: 'insensitive' } } },
        { usuario: { dni: { contains: busqueda, mode: 'insensitive' } } },
      ];
    }

    const estudiantes = await prisma.estudiante.findMany({
      where,
      orderBy: [
        { grado_seccion: { grado: 'asc' } },
        { grado_seccion: { seccion: 'asc' } },
        { usuario: { apellidos: 'asc' } },
      ],
      include: {
        usuario: {
          select: {
            id: true,
            nombres: true,
            apellidos: true,
            dni: true,
            email: true,
            telefono: true,
            activo: true,
          },
        },
        grado_seccion: true,
        padres: {
          include: {
            padre: {
              select: { id: true, nombres: true, apellidos: true, dni: true, email: true, telefono: true },
            },
          },
        },
        codigos_qr: {
          orderBy: { created_at: 'desc' },
        },
      },
    });

    return res.json({ ok: true, estudiantes });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

async function listarHistorialQREstudiante(req, res) {
  try {
    const { id } = req.params;
    const codigos = await prisma.codigoQR.findMany({
      where: { estudiante_id: Number(id) },
      orderBy: { created_at: 'desc' },
    });
    return res.json({ ok: true, codigos });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

/**
 * Sección 20 — Pérdida del Fotocheck:
 * 1. Se desactiva el QR anterior.
 * 2. Se genera un nuevo identificador (STU-XXXX-XXXX-XXX).
 * 3. Se genera un nuevo QR y se asocia al mismo estudiante.
 * 4. El QR anterior ya no permite registrar asistencia.
 */
async function regenerarQREstudiante(req, res) {
  try {
    const { id } = req.params;
    const { motivo = 'Pérdida o deterioro de fotocheck reportado' } = req.body;

    const estudiante = await prisma.estudiante.findUnique({
      where: { id: Number(id) },
      include: { usuario: true, grado_seccion: true },
    });

    if (!estudiante) {
      return res.status(404).json({ ok: false, mensaje: 'Estudiante no encontrado.' });
    }

    const qrAnterior = estudiante.codigo_qr_unico;
    const nuevoToken = generarTokenQR();

    const actualizado = await prisma.$transaction(async (tx) => {
      // 1. Revocar todos los QR activos previos del estudiante
      await tx.codigoQR.updateMany({
        where: {
          estudiante_id: estudiante.id,
          estado: 'ACTIVO',
        },
        data: {
          estado: 'REVOCADO',
          motivo_revocacion: motivo.trim(),
          revocado_por_id: req.usuario.id,
          revoked_at: new Date(),
        },
      });

      // Si el código anterior no existía en la tabla codigos_qr, insertarlo como REVOCADO para bloquearlo
      const existeAnterior = await tx.codigoQR.findUnique({
        where: { token: qrAnterior },
      });
      if (!existeAnterior) {
        await tx.codigoQR.create({
          data: {
            estudiante_id: estudiante.id,
            token: qrAnterior,
            estado: 'REVOCADO',
            motivo_revocacion: motivo.trim(),
            revocado_por_id: req.usuario.id,
            revoked_at: new Date(),
          },
        });
      }

      // 2. Crear nuevo registro de código QR activo
      await tx.codigoQR.create({
        data: {
          estudiante_id: estudiante.id,
          token: nuevoToken,
          estado: 'ACTIVO',
          generado_por_id: req.usuario.id,
        },
      });

      // 3. Actualizar el token activo en el estudiante
      return tx.estudiante.update({
        where: { id: estudiante.id },
        data: { codigo_qr_unico: nuevoToken },
        include: {
          usuario: {
            select: {
              id: true,
              nombres: true,
              apellidos: true,
              dni: true,
              email: true,
              telefono: true,
              activo: true,
            },
          },
          grado_seccion: true,
          padres: {
            include: {
              padre: {
                select: { id: true, nombres: true, apellidos: true, email: true, telefono: true },
              },
            },
          },
          codigos_qr: {
            orderBy: { created_at: 'desc' },
          },
        },
      });
    });

    await registrarAuditoria({
      usuario: req.usuario,
      accion: 'QR_REVOCADO_Y_REEMPLAZADO',
      entidad: 'CODIGO_QR',
      entidad_id: estudiante.id,
      estudiante_id: estudiante.id,
      descripcion: `Fotocheck regenerado para ${estudiante.usuario.nombres} ${estudiante.usuario.apellidos}. QR anterior (${qrAnterior}) revocado. Nuevo QR: ${nuevoToken}. Motivo: ${motivo}`,
      metadata: {
        qr_anterior: qrAnterior,
        qr_nuevo: nuevoToken,
        motivo,
      },
    });

    return res.json({
      ok: true,
      mensaje: `Código QR anterior (${qrAnterior}) desactivado. Nuevo identificador emitido: ${nuevoToken}`,
      qr_anterior: qrAnterior,
      qr_nuevo: nuevoToken,
      estudiante: actualizado,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

// ============================================================================
// AUDITORÍA GENERAL DEL SISTEMA (Secciones 64 y 65)
// ============================================================================
async function listarAuditoriaGeneral(req, res) {
  try {
    const { entidad, accion, estudiante_id, busqueda } = req.query;
    const where = {};

    if (entidad) where.entidad = entidad;
    if (accion) where.accion = accion;
    if (estudiante_id) where.estudiante_id = Number(estudiante_id);
    if (busqueda) {
      where.OR = [
        { descripcion: { contains: busqueda, mode: 'insensitive' } },
        { usuario_nombre: { contains: busqueda, mode: 'insensitive' } },
        { accion: { contains: busqueda, mode: 'insensitive' } },
        { entidad: { contains: busqueda, mode: 'insensitive' } },
      ];
    }

    const logs = await prisma.auditoriaGeneral.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: 300,
    });

    return res.json({ ok: true, logs });
  } catch (err) {
    return res.status(500).json({ ok: false, mensaje: err.message });
  }
}

module.exports = {
  obtenerConfiguracion,
  actualizarConfiguracion,
  listarAniosEscolares,
  crearAnioEscolar,
  cambiarEstadoAnioEscolar,
  listarGradosSecciones,
  crearGradoSeccion,
  listarMatriculas,
  registrarMatricula,
  listarUsuarios,
  crearUsuario,
  cambiarEstadoUsuario,
  vincularPadreEstudiante,
  listarEstudiantes,
  listarHistorialQREstudiante,
  regenerarQREstudiante,
  listarAuditoriaGeneral,
};
