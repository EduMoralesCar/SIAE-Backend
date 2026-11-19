require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { getPreviousBusinessDays, getLimaDateParts } = require('../src/utils/dateHelper');

// Usar DIRECT_URL (puerto 5432 session pooler) para el seeder masivo
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

const NOMBRES_ALUMNOS = [
  ['Mateo Alejandro', 'Quispe Huamán', 'M', '2013-05-14'],
  ['Valentina Sofía', 'Rojas Mendoza', 'F', '2013-08-22'],
  ['Sebastián Gabriel', 'Flores Vargas', 'M', '2013-02-10'],
  ['Camila Fernanda', 'Sánchez Paredes', 'F', '2013-11-03'],
  ['Diego Joaquín', 'Castillo Romero', 'M', '2013-07-19'],
  ['Luciana Valeria', 'Gómez Espinoza', 'F', '2013-09-28'],
  ['Santiago Nicolás', 'Díaz Chávez', 'M', '2012-04-12'],
  ['Mariana Isabella', 'Torres Reyes', 'F', '2012-06-25'],
  ['Leonardo Matías', 'Cruz Morales', 'M', '2012-01-30'],
  ['Daniela Ximena', 'Ortiz Gutiérrez', 'F', '2012-10-15'],
  ['Rodrigo André', 'Ramos Silva', 'M', '2012-03-08'],
  ['Antonella Nicole', 'Mendoza Salazar', 'F', '2012-12-01'],
  ['Joaquín Emiliano', 'Vargas Aguilar', 'M', '2011-05-20'],
  ['Valeria Alessandra', 'Castro Medina', 'F', '2011-07-11'],
  ['Gael Ignacio', 'Romero León', 'M', '2011-02-17'],
  ['Ariana Victoria', 'Herrera Delgado', 'F', '2011-09-09'],
  ['Thiago Benjamín', 'Aguilar Vega', 'M', '2011-11-23'],
  ['Renata Milagros', 'Medina Campos', 'F', '2011-04-04'],
  ['Adrián Fabrizio', 'Vega Carrillo', 'M', '2010-06-18'],
  ['Natalia Lucía', 'León Acosta', 'F', '2010-08-29'],
  ['Bruno Alonso', 'Paredes Navarro', 'M', '2010-01-14'],
  ['Andrea Carolina', 'Salazar Miranda', 'F', '2010-10-27'],
  ['Emilio Facundo', 'Espinoza Valdivia', 'M', '2010-03-21'],
  ['Fátima Belén', 'Reyes Cárdenas', 'F', '2010-12-12'],
  ['Maximiliano Ian', 'Chávez Lozano', 'M', '2009-05-07'],
  ['Gabriela Paz', 'Morales Figueroa', 'F', '2009-07-16'],
  ['Lucas Emmanuel', 'Gutiérrez Ponce', 'M', '2009-02-24'],
  ['Micaela Abril', 'Silva Coronado', 'F', '2009-09-13'],
  ['Aarón Esteban', 'Delgado Bustamante', 'M', '2009-11-05'],
  ['Julieta Romina', 'Campos Palacios', 'F', '2009-04-19'],
];

const NOMBRES_PADRES = [
  ['Carlos Alberto', 'Quispe Condori'],
  ['María Elena', 'Mendoza Vda. de Rojas'],
  ['Jorge Luis', 'Flores Cáceres'],
  ['Patricia Carmen', 'Paredes Soto'],
  ['Roberto Carlos', 'Castillo Luján'],
  ['Rosa Angélica', 'Espinoza Salas'],
  ['Miguel Ángel', 'Díaz Peralta'],
  ['Carmen Rosa', 'Reyes Farfán'],
  ['Fernando José', 'Cruz Alarcón'],
  ['Silvia Beatriz', 'Gutiérrez Tapia'],
  ['Héctor Raúl', 'Ramos Becerra'],
  ['Verónica Luz', 'Salazar Ocampo'],
  ['Ricardo Arturo', 'Vargas Montes'],
  ['Elena Margarita', 'Medina Zúñiga'],
  ['Julio César', 'Romero Hidalgo'],
];

async function main() {
  console.log('🌱 Iniciando Seeder Integral SIAE en Supabase (PostgreSQL)...');

  const passwordHash = await bcrypt.hash('123456', 10);

  // Limpiar tablas respetando llaves foráneas
  await prisma.auditoriaGeneral.deleteMany();
  await prisma.seguimientoCompromiso.deleteMany();
  await prisma.compromiso.deleteMany();
  await prisma.acta.deleteMany();
  await prisma.participanteReunion.deleteMany();
  await prisma.reunion.deleteMany();
  await prisma.citacion.deleteMany();
  await prisma.evidenciaIncidencia.deleteMany();
  await prisma.incidenciaConducta.deleteMany();
  await prisma.retiroEstudiante.deleteMany();
  await prisma.autorizacionRecojo.deleteMany();
  await prisma.situacionSalud.deleteMany();
  await prisma.evidenciaPermiso.deleteMany();
  await prisma.solicitudPermiso.deleteMany();
  await prisma.archivo.deleteMany();
  await prisma.notificacion.deleteMany();
  await prisma.calificacionActividad.deleteMany();
  await prisma.actividad.deleteMany();
  await prisma.auditoriaAsistencia.deleteMany();
  await prisma.asistencia.deleteMany();
  await prisma.codigoQR.deleteMany();
  await prisma.matricula.deleteMany();
  await prisma.padreEstudiante.deleteMany();
  await prisma.estudiante.deleteMany();
  await prisma.gradoSeccion.deleteMany();
  await prisma.anioEscolar.deleteMany();
  await prisma.usuario.deleteMany();
  await prisma.configuracionEscolar.deleteMany();

  console.log('   ✔ Tablas limpiadas. Creando configuración, años escolares y usuarios...');

  // 1. Configuración Escolar
  await prisma.configuracionEscolar.create({
    data: {
      nombre_institucion: 'I.E. Emblemática Nivel Secundaria — SIAE',
      anio_escolar: 2026,
      hora_inicio_entrada: '07:00',
      hora_limite_puntual: '08:00',
      hora_limite_tardanza: '08:30',
      hora_inicio_salida: '13:30',
      ventana_antiduplicado_min: 15,
      puntaje_conducta_inicial: 100,
    },
  });

  // 2. Años Escolares (2025 y 2026)
  const anio2025 = await prisma.anioEscolar.create({
    data: {
      nombre: '2025',
      fecha_inicio: '2025-03-03',
      fecha_fin: '2025-12-19',
      estado: 'CERRADO',
    },
  });

  const anio2026 = await prisma.anioEscolar.create({
    data: {
      nombre: '2026',
      fecha_inicio: '2026-03-02',
      fecha_fin: '2026-12-18',
      estado: 'ACTIVO',
    },
  });

  // 3. Usuarios de los 6 Roles Oficiales
  const admin = await prisma.usuario.create({
    data: {
      nombres: 'Ricardo Andrés',
      apellidos: 'Salazar Villanueva',
      dni: '10000000',
      email: 'admin@siae.edu.pe',
      password_hash: passwordHash,
      telefono: '987000111',
      rol: 'ADMIN',
    },
  });

  const director = await prisma.usuario.create({
    data: {
      nombres: 'Eduardo Martín',
      apellidos: 'Montesinos Vega',
      dni: '10000001',
      email: 'director@siae.edu.pe',
      password_hash: passwordHash,
      telefono: '987654321',
      rol: 'DIRECTOR',
    },
  });

  const auxiliar1 = await prisma.usuario.create({
    data: {
      nombres: 'Raúl Ernesto',
      apellidos: 'Huamán Palomino',
      dni: '20000001',
      email: 'auxiliar1@siae.edu.pe',
      password_hash: passwordHash,
      telefono: '987111222',
      rol: 'AUXILIAR',
    },
  });

  const auxiliar2 = await prisma.usuario.create({
    data: {
      nombres: 'Gladys Rocío',
      apellidos: 'Villacorta Díaz',
      dni: '20000002',
      email: 'auxiliar2@siae.edu.pe',
      password_hash: passwordHash,
      telefono: '987111333',
      rol: 'AUXILIAR',
    },
  });

  const tutor1 = await prisma.usuario.create({
    data: {
      nombres: 'Marco Antonio',
      apellidos: 'Zevallos Pizarro',
      dni: '30000001',
      email: 'tutor1@siae.edu.pe',
      password_hash: passwordHash,
      telefono: '987222111',
      rol: 'TUTOR',
    },
  });

  const tutor2 = await prisma.usuario.create({
    data: {
      nombres: 'Laura Cristina',
      apellidos: 'Benavides Carpio',
      dni: '30000002',
      email: 'tutor2@siae.edu.pe',
      password_hash: passwordHash,
      telefono: '987222333',
      rol: 'TUTOR',
    },
  });

  const docente1 = await prisma.usuario.create({
    data: {
      nombres: 'César Augusto',
      apellidos: 'Linares Santillán',
      dni: '30000003',
      email: 'docente1@siae.edu.pe',
      password_hash: passwordHash,
      telefono: '987222444',
      rol: 'DOCENTE',
    },
  });

  const tutores = [tutor1, tutor2, docente1, tutor1, tutor2];

  // 4. Grados y Secciones (2025 y 2026)
  const grados2025 = [];
  for (let g = 1; g <= 5; g++) {
    const gs25 = await prisma.gradoSeccion.create({
      data: {
        grado: g,
        seccion: 'A',
        nivel: 'SECUNDARIA',
        tutor_docente_id: tutores[g - 1].id,
        anio_escolar: 2025,
      },
    });
    grados2025.push(gs25);
  }

  const gradosCreados = [];
  for (let g = 1; g <= 5; g++) {
    const gs = await prisma.gradoSeccion.create({
      data: {
        grado: g,
        seccion: 'A',
        nivel: 'SECUNDARIA',
        tutor_docente_id: tutores[g - 1].id,
        anio_escolar: 2026,
      },
    });
    gradosCreados.push(gs);
  }

  // 5. Padres de Familia (15)
  const padresCreados = [];
  for (let i = 0; i < 15; i++) {
    const [nombres, apellidos] = NOMBRES_PADRES[i];
    const padre = await prisma.usuario.create({
      data: {
        nombres,
        apellidos,
        dni: `400000${String(i + 1).padStart(2, '0')}`,
        email: `padre${i + 1}@siae.edu.pe`,
        password_hash: passwordHash,
        telefono: `999888${String(100 + i)}`,
        rol: 'PADRE',
      },
    });
    padresCreados.push(padre);
  }

  console.log('   ✔ Creando 30 estudiantes, matrículas multianuales y códigos QR...');

  // 6. Estudiantes (30) + Lotes de QR, Matrículas y Vínculos
  const estudiantesCreados = [];
  const loteCodigosQR = [];
  const loteMatriculas = [];
  const lotePadresEstudiantes = [];

  for (let i = 0; i < 30; i++) {
    const [nombres, apellidos, sexo, fechaNacimiento] = NOMBRES_ALUMNOS[i];
    const gradoIndex = Math.floor(i / 6);
    const gs = gradosCreados[gradoIndex];
    const numStr = String(i + 1).padStart(2, '0');
    const dniAlumno = `700000${numStr}`;

    const usuarioEst = await prisma.usuario.create({
      data: {
        nombres,
        apellidos,
        dni: dniAlumno,
        email: `alumno${i + 1}@siae.edu.pe`,
        password_hash: passwordHash,
        telefono: `955444${String(100 + i)}`,
        rol: 'ESTUDIANTE',
      },
    });

    let puntajeInicial = 95;
    if (i === 0) puntajeInicial = 85;
    if (i === 2) puntajeInicial = 55;
    if (i === 5) puntajeInicial = 68;
    if (i === 11) puntajeInicial = 58;
    if (i === 18) puntajeInicial = 70;
    if (i === 1) puntajeInicial = 100;

    const hexPart = (1000 + i * 73).toString(16).toUpperCase();
    const tokenQR = `STU-8F${numStr}-A9${hexPart.slice(0, 2)}-X${numStr}`;
    const codigoEst = `SIAE-2026-SEC-${String(i + 1).padStart(4, '0')}`;
    const padreAsignado = padresCreados[Math.floor(i / 2)];

    const est = await prisma.estudiante.create({
      data: {
        usuario_id: usuarioEst.id,
        codigo_qr_unico: tokenQR,
        codigo_estudiante: codigoEst,
        codigo_modular: `MOD-2026-${numStr}`,
        grado_seccion_id: gs.id,
        puntaje_conducta: puntajeInicial,
        fecha_nacimiento: fechaNacimiento,
        sexo,
        estado: 'ACTIVO',
        contacto_emergencia: `${padreAsignado.nombres} ${padreAsignado.apellidos} (${padreAsignado.telefono})`,
      },
    });

    estudiantesCreados.push({ ...est, usuario: usuarioEst, grado_seccion: gs });

    if (i === 0) {
      loteCodigosQR.push({
        estudiante_id: est.id,
        token: 'STU-OLD0-LOST-001',
        estado: 'REVOCADO',
        motivo_revocacion: 'Pérdida de fotocheck reportada por el padre de familia',
        generado_por_id: admin.id,
        revocado_por_id: admin.id,
        revoked_at: new Date(Date.now() - 86400000 * 5),
      });
    }

    loteCodigosQR.push({
      estudiante_id: est.id,
      token: tokenQR,
      estado: 'ACTIVO',
      generado_por_id: admin.id,
    });

    if (gradoIndex > 0) {
      loteMatriculas.push({
        estudiante_id: est.id,
        grado_seccion_id: grados2025[gradoIndex - 1].id,
        anio_escolar_id: anio2025.id,
        anio_escolar_num: 2025,
        estado: 'PROMOVIDO',
        fecha_matricula: '2025-02-20',
        observaciones: 'Año escolar 2025 concluido satisfactoriamente.',
      });
    }

    loteMatriculas.push({
      estudiante_id: est.id,
      grado_seccion_id: gs.id,
      anio_escolar_id: anio2026.id,
      anio_escolar_num: 2026,
      estado: 'MATRICULADO',
      fecha_matricula: '2026-02-18',
      observaciones: 'Matrícula regular ratificada por apoderado.',
    });

    lotePadresEstudiantes.push({
      padre_usuario_id: padreAsignado.id,
      estudiante_id: est.id,
      parentesco: i % 2 === 0 ? 'PADRE' : 'MADRE',
      recibe_alertas: true,
    });
  }

  await prisma.codigoQR.createMany({ data: loteCodigosQR });
  await prisma.matricula.createMany({ data: loteMatriculas });
  await prisma.padreEstudiante.createMany({ data: lotePadresEstudiantes });

  console.log('   ✔ Generando historial masivo de asistencias (10 días hábiles)...');

  // 7. Historial de Asistencias en Lote (createMany)
  const diasHabiles = getPreviousBusinessDays(10);
  const { fecha: fechaHoy } = getLimaDateParts();
  if (!diasHabiles.includes(fechaHoy)) {
    diasHabiles[diasHabiles.length - 1] = fechaHoy;
  }
  const fechaAyer = diasHabiles[diasHabiles.length - 2] || fechaHoy;

  const loteAsistencias = [];
  for (let idxEst = 0; idxEst < estudiantesCreados.length; idxEst++) {
    const est = estudiantesCreados[idxEst];

    for (let d = 0; d < diasHabiles.length; d++) {
      const fechaDia = diasHabiles[d];
      const esUltimos3Dias = d >= diasHabiles.length - 3;
      const esUltimos4Dias = d >= diasHabiles.length - 4;

      let estado = 'PRESENTE';
      let horaEntrada = `07:${String(35 + ((idxEst + d) % 22)).padStart(2, '0')}:00`;
      let horaSalida = d === diasHabiles.length - 1 ? null : '13:40:00';
      let minTardanza = 0;
      let motivo = null;

      if (
        (idxEst === 0 && esUltimos3Dias && d < diasHabiles.length - 1) ||
        (idxEst === 7 && esUltimos4Dias) ||
        (idxEst === 14 && esUltimos3Dias)
      ) {
        estado = 'FALTA';
        horaEntrada = null;
        horaSalida = null;
        motivo = 'Cierre automático de asistencia (08:31 AM)';
      } else if (idxEst === 0 && d === diasHabiles.length - 1) {
        estado = 'RETIRADO';
        horaEntrada = '07:42:15';
        horaSalida = '11:15:00';
        motivo = 'Retirado por padre debido a situación de salud registrada en jornada';
      } else if ((idxEst === 3 || idxEst === 10) && d % 2 === 0) {
        estado = 'TARDANZA';
        minTardanza = 14 + (d % 10);
        horaEntrada = `08:${String(minTardanza).padStart(2, '0')}:00`;
      } else if (idxEst === 1 && d === diasHabiles.length - 2) {
        estado = 'JUSTIFICADO';
        horaEntrada = null;
        horaSalida = null;
        motivo = 'Cita médica odontológica acreditada con constancia ESSALUD #48921';
      } else if (idxEst === 3 && d === diasHabiles.length - 1) {
        estado = 'PERMISO';
        horaEntrada = null;
        horaSalida = null;
        motivo = 'Permiso por cita médica especializada aprobado por Dirección';
      } else if ((idxEst + d) % 9 === 0) {
        estado = 'TARDANZA';
        minTardanza = 8;
        horaEntrada = '08:08:00';
      }

      loteAsistencias.push({
        estudiante_id: est.id,
        fecha: fechaDia,
        hora_entrada: horaEntrada,
        hora_salida: horaSalida,
        minutos_tardanza: minTardanza,
        tipo_registro: 'GENERAL',
        estado,
        registrado_por_id: idxEst % 2 === 0 ? auxiliar1.id : auxiliar2.id,
        motivo_justificacion: motivo,
      });
    }
  }

  await prisma.asistencia.createMany({ data: loteAsistencias });

  // Crear auditoría para la asistencia justificada
  const asisJustificada = await prisma.asistencia.findFirst({
    where: { estado: 'JUSTIFICADO' },
  });
  if (asisJustificada) {
    await prisma.auditoriaAsistencia.create({
      data: {
        asistencia_id: asisJustificada.id,
        modificado_por_id: director.id,
        estado_anterior: 'FALTA',
        estado_nuevo: 'JUSTIFICADO',
        motivo_cambio:
          asisJustificada.motivo_justificacion ||
          'Cita médica odontológica acreditada con constancia ESSALUD #48921',
        evidencia_url: 'constancia-essalud-48921.pdf',
      },
    });
  }

  console.log('   ✔ Creando permisos, situaciones de salud, autorizaciones de recojo y retiros...');

  // 8. Archivos / Evidencias y Solicitudes de Permiso
  const archivoPermiso1 = await prisma.archivo.create({
    data: {
      storage_key: 'evidencias/cita-medica-camila-sanchez.pdf',
      nombre_original: 'Constancia_Cita_Medica_INSN.pdf',
      mime_type: 'application/pdf',
      tamano_bytes: 145200,
      entidad_tipo: 'PERMISO',
      subido_por_id: padresCreados[1].id,
    },
  });

  const permisoAprobado = await prisma.solicitudPermiso.create({
    data: {
      estudiante_id: estudiantesCreados[3].id,
      solicitado_por_id: padresCreados[1].id,
      fecha: fechaHoy,
      tipo: 'CITA_MEDICA',
      descripcion: 'Control oftalmológico programado en el Instituto Nacional de Salud del Niño.',
      estado: 'APROBADO',
      revisado_por_id: director.id,
      respuesta_revision: 'Aprobado conforme a constancia médica adjunta.',
      reviewed_at: new Date(),
    },
  });

  await prisma.evidenciaPermiso.create({
    data: {
      permiso_id: permisoAprobado.id,
      archivo_id: archivoPermiso1.id,
    },
  });

  await prisma.solicitudPermiso.create({
    data: {
      estudiante_id: estudiantesCreados[0].id,
      solicitado_por_id: padresCreados[0].id,
      fecha: fechaHoy,
      tipo: 'SALUD',
      descripcion: 'Descanso médico de 24 horas posterior a atención por cuadro febril.',
      estado: 'PENDIENTE',
    },
  });

  // 9. Situaciones de Salud
  const saludMateo = await prisma.situacionSalud.create({
    data: {
      estudiante_id: estudiantesCreados[0].id,
      registrado_por_id: auxiliar1.id,
      fecha: fechaHoy,
      hora: '10:35',
      tipo_situacion: 'FIEBRE',
      descripcion:
        'El estudiante presentó malestar general y temperatura de 38.2 °C durante la tercera hora de clases.',
      accion_realizada:
        'Atención primaria en tópico escolar y comunicación inmediata al padre para recojo.',
      requiere_recojo: true,
      estado: 'RETIRADO',
      notificado_padre: true,
      confirmado_padre: true,
      fecha_confirmacion_padre: new Date(Date.now() - 3600000),
      confirmado_por_id: padresCreados[0].id,
    },
  });

  await prisma.situacionSalud.create({
    data: {
      estudiante_id: estudiantesCreados[1].id,
      registrado_por_id: auxiliar2.id,
      fecha: fechaHoy,
      hora: '11:20',
      tipo_situacion: 'MALESTAR',
      descripcion:
        'Presentó dolor estomacal moderado luego del recreo. Permanece en observación en tópico.',
      accion_realizada:
        'Se notificó al padre de familia solicitando acercarse al plantel para recoger a la estudiante.',
      requiere_recojo: true,
      estado: 'PENDIENTE_RECOJO',
      notificado_padre: true,
      confirmado_padre: false,
    },
  });

  // 10. Autorizaciones de Recojo y Retiros
  const autTioMateo = await prisma.autorizacionRecojo.create({
    data: {
      estudiante_id: estudiantesCreados[0].id,
      autorizado_por_id: padresCreados[0].id,
      persona_autorizada: 'Juan Carlos Quispe Condori',
      parentesco: 'Tío',
      dni_persona: '45891234',
      telefono_persona: '984512369',
      tipo_autorizacion: 'UN_SOLO_USO',
      valido_desde: fechaHoy,
      valido_hasta: fechaHoy,
      hora_aproximada: '12:30',
      observaciones: 'Autorizado por el padre debido a turno laboral.',
      estado: 'APROBADO',
    },
  });

  await prisma.autorizacionRecojo.create({
    data: {
      estudiante_id: estudiantesCreados[1].id,
      autorizado_por_id: padresCreados[0].id,
      persona_autorizada: 'Rosa María Condori Vda. de Quispe',
      parentesco: 'Abuela',
      dni_persona: '09451238',
      telefono_persona: '981223344',
      tipo_autorizacion: 'PERMANENTE',
      valido_desde: '2026-03-02',
      valido_hasta: '2026-12-18',
      observaciones: 'Apoderada alterna autorizada para todo el año escolar 2026.',
      estado: 'APROBADO',
    },
  });

  await prisma.retiroEstudiante.create({
    data: {
      estudiante_id: estudiantesCreados[0].id,
      situacion_salud_id: saludMateo.id,
      fecha: fechaHoy,
      hora_salida: '11:15',
      motivo: 'Situación de salud',
      recogido_por_nombre: `${padresCreados[0].nombres} ${padresCreados[0].apellidos}`,
      recogido_por_dni: padresCreados[0].dni,
      parentesco: 'Padre',
      documento_verificado: 'DNI',
      registrado_por_id: auxiliar1.id,
      observaciones:
        'Padre acudió tras confirmar la notificación de salud y firmó cuaderno de salida.',
    },
  });

  console.log('   ✔ Creando incidencias, citaciones, reuniones, actas, compromisos y seguimientos...');

  // 11. Incidencias, Citaciones, Reuniones, Actas, Compromisos y Seguimientos
  const inc1 = await prisma.incidenciaConducta.create({
    data: {
      codigo: 'INC-00045',
      estudiante_id: estudiantesCreados[0].id,
      registrado_por_id: tutor1.id,
      tipo: 'DEMERITO',
      naturaleza: 'CONVIVENCIA',
      gravedad: 'MODERADA',
      categoria: 'Conflicto entre pares durante el recreo',
      puntos_aplicados: -10,
      descripcion:
        'Se produjo una discusión verbal en el patio durante el recreo que requirió mediación del tutor.',
      acciones_tomadas:
        'Diálogo reflexivo inmediato y citación a padre de familia para acuerdos de convivencia.',
      estado: 'CON_CITACION',
      requiere_citacion: true,
    },
  });

  const inc2 = await prisma.incidenciaConducta.create({
    data: {
      codigo: 'INC-00046',
      estudiante_id: estudiantesCreados[2].id,
      registrado_por_id: auxiliar1.id,
      tipo: 'DEMERITO',
      naturaleza: 'INCUMPLIMIENTO_NORMAS',
      gravedad: 'GRAVE',
      categoria: 'Evasión de aula o jornada escolar',
      puntos_aplicados: -15,
      descripcion:
        'No ingresó a la tercera hora de Ciencia y Tecnología pese a encontrarse en el plantel.',
      acciones_tomadas:
        'Notificación inmediata a Dirección y generación de citación urgente al apoderado.',
      estado: 'CON_CITACION',
      requiere_citacion: true,
    },
  });

  await prisma.incidenciaConducta.create({
    data: {
      codigo: 'INC-00047',
      estudiante_id: estudiantesCreados[1].id,
      registrado_por_id: tutor1.id,
      tipo: 'MERITO',
      naturaleza: 'ACADEMICA',
      gravedad: 'LEVE',
      categoria: 'Representación destacada en Olimpiada de Matemática',
      puntos_aplicados: 10,
      descripcion: 'Primer puesto en la Olimpiada Escolar de Matemática Nivel 1° Secundaria.',
      acciones_tomadas: 'Felicitación pública e inscripción en el cuadro de mérito.',
      estado: 'CERRADA',
      requiere_citacion: false,
    },
  });

  const citacionMateo = await prisma.citacion.create({
    data: {
      estudiante_id: estudiantesCreados[0].id,
      incidencia_id: inc1.id,
      motivo: 'Incidencia de convivencia registrada (INC-00045) y seguimiento de asistencia',
      fecha_programada: fechaAyer,
      hora_programada: '10:00',
      lugar: 'Oficina de Tutoría',
      responsable_id: tutor1.id,
      rol_responsable: 'TUTOR',
      estado: 'ATENDIDA',
      respuesta_padre: 'CONFIRMO_ASISTENCIA',
      comentario_padre: 'Confirmo mi asistencia puntual.',
      fecha_confirmacion: new Date(Date.now() - 86400000 * 2),
    },
  });

  await prisma.citacion.create({
    data: {
      estudiante_id: estudiantesCreados[1].id,
      motivo: 'Reunión informativa de seguimiento académico y tutoría',
      fecha_programada: fechaHoy,
      hora_programada: '15:00',
      lugar: 'Sala de Reuniones — Tutoría 1° A',
      responsable_id: tutor1.id,
      rol_responsable: 'TUTOR',
      estado: 'PENDIENTE',
    },
  });

  await prisma.citacion.create({
    data: {
      estudiante_id: estudiantesCreados[2].id,
      incidencia_id: inc2.id,
      motivo: 'Citación urgente por evasión de clase (INC-00046)',
      fecha_programada: fechaHoy,
      hora_programada: '16:00',
      lugar: 'Dirección General',
      responsable_id: director.id,
      rol_responsable: 'DIRECTOR',
      estado: 'CONFIRMADA',
      respuesta_padre: 'CONFIRMO_ASISTENCIA',
      fecha_confirmacion: new Date(),
    },
  });

  const reunionMateo = await prisma.reunion.create({
    data: {
      citacion_id: citacionMateo.id,
      estudiante_id: estudiantesCreados[0].id,
      fecha: fechaAyer,
      hora: '10:05',
      responsable_id: tutor1.id,
      motivo: 'Incidencia de convivencia (INC-00045)',
      descripcion:
        'Se expuso al padre de familia los hechos ocurridos durante el recreo y se revisó el récord de asistencia de la semana.',
      acuerdos:
        '1. El padre dialogará en casa sobre el respeto y convivencia escolar.\n2. Mantener comunicación quincenal con el tutor.\n3. Justificar oportunamente cualquier inasistencia por motivos médicos.',
      observaciones: 'El padre mostró plena disposición a colaborar con la tutoría.',
      participantes: {
        create: [
          {
            nombre_participante: `${padresCreados[0].nombres} ${padresCreados[0].apellidos}`,
            rol_participante: 'Padre de familia',
            dni_participante: padresCreados[0].dni,
          },
          {
            nombre_participante: `${tutor1.nombres} ${tutor1.apellidos}`,
            rol_participante: 'Tutor',
            dni_participante: tutor1.dni,
          },
        ],
      },
    },
  });

  await prisma.acta.create({
    data: {
      codigo: 'ACT-00011',
      estudiante_id: estudiantesCreados[0].id,
      reunion_id: reunionMateo.id,
      tipo: 'CONOCIMIENTO',
      motivo: 'Toma de conocimiento sobre reporte de inasistencias de la semana',
      contenido:
        'Se deja constancia de que el padre de familia ha sido informado detalladamente sobre las inasistencias registradas y el procedimiento institucional para solicitud de permisos.',
      informacion_comunicada:
        'Reglamento interno de asistencia y canales de justificación médica.',
      observaciones: 'Conforme por ambas partes.',
      creado_por_id: tutor1.id,
      aceptado_padre: true,
      fecha_aceptacion: new Date(Date.now() - 86400000),
    },
  });

  const actaCompromiso = await prisma.acta.create({
    data: {
      codigo: 'ACT-00012',
      estudiante_id: estudiantesCreados[0].id,
      reunion_id: reunionMateo.id,
      tipo: 'COMPROMISO',
      motivo: 'Incidencia registrada INC-00045 — Acuerdos de convivencia escolar',
      contenido:
        'El padre de familia y el estudiante asumen el compromiso de cumplir las normas de convivencia, asistir puntualmente y mantener comunicación constante con el tutor de 1° A.',
      informacion_comunicada: 'Normas de convivencia escolar y protocolo de seguimiento.',
      observaciones: 'Se programó revisión de seguimiento.',
      creado_por_id: tutor1.id,
      aceptado_padre: true,
      fecha_aceptacion: new Date(Date.now() - 86400000),
    },
  });

  const compromiso1 = await prisma.compromiso.create({
    data: {
      codigo: 'CMP-00018',
      estudiante_id: estudiantesCreados[0].id,
      acta_id: actaCompromiso.id,
      descripcion:
        'Cumplir las normas de convivencia en el aula y patio, evitando conflictos con sus compañeros.',
      responsable_compromiso: 'Padre de familia y Estudiante',
      fecha_seguimiento: fechaHoy,
      estado: 'EN_SEGUIMIENTO',
    },
  });

  await prisma.seguimientoCompromiso.create({
    data: {
      compromiso_id: compromiso1.id,
      fecha: fechaHoy,
      resultado: 'EN_PROGRESO',
      observaciones:
        'Se verificó mejora en el trato con sus compañeros durante las primeras horas de clase.',
      registrado_por_id: tutor1.id,
    },
  });

  const compromiso2 = await prisma.compromiso.create({
    data: {
      codigo: 'CMP-00019',
      estudiante_id: estudiantesCreados[0].id,
      acta_id: actaCompromiso.id,
      descripcion:
        'Registrar oportunamente en la plataforma las solicitudes de permiso médico adjuntando constancia.',
      responsable_compromiso: 'Padre de familia',
      fecha_seguimiento: fechaHoy,
      estado: 'CUMPLIDO',
    },
  });

  await prisma.seguimientoCompromiso.create({
    data: {
      compromiso_id: compromiso2.id,
      fecha: fechaHoy,
      resultado: 'CUMPLIDO',
      observaciones:
        'El padre registró la solicitud de permiso médico en el sistema conforme a lo acordado.',
      registrado_por_id: tutor1.id,
    },
  });

  // 12. Actividades Académicas y Calificaciones en Lote
  const cursosPorGrado = [
    { curso: 'Matemática', titulo: 'Resolución de Ecuaciones Lineales y Sistemas' },
    { curso: 'Comunicación', titulo: 'Ensayo Argumentativo sobre Comprensión Lectora' },
    { curso: 'Ciencia y Tecnología', titulo: 'Informe de Laboratorio: Célula Eucariota' },
  ];

  const loteCalificaciones = [];
  for (const gs of gradosCreados) {
    const alumnosSeccion = estudiantesCreados.filter((e) => e.grado_seccion_id === gs.id);

    for (let c = 0; c < cursosPorGrado.length; c++) {
      const itemCurso = cursosPorGrado[c];
      const act = await prisma.actividad.create({
        data: {
          grado_seccion_id: gs.id,
          docente_id: gs.tutor_docente_id || tutor1.id,
          curso_nombre: itemCurso.curso,
          titulo_actividad: `${itemCurso.titulo} (${gs.grado}° "${gs.seccion}")`,
          descripcion: 'Entregar en formato físico y registrar avance en clase.',
          fecha_entrega: fechaHoy,
        },
      });

      for (let idxAl = 0; idxAl < alumnosSeccion.length; idxAl++) {
        const al = alumnosSeccion[idxAl];
        let estadoEntrega = 'ENTREGADO';
        let nota = 15 + ((idxAl + c) % 5);
        let obs = 'Buen desarrollo y puntualidad.';

        if (idxAl === 0 && c === 2) {
          estadoEntrega = 'PENDIENTE';
          nota = null;
          obs = 'Pendiente de revisión por retiro médico.';
        } else if (idxAl === 2 && c === 1) {
          estadoEntrega = 'NO_PRESENTO';
          nota = 8;
          obs = 'No presentó el trabajo en la fecha límite.';
        }

        loteCalificaciones.push({
          actividad_id: act.id,
          estudiante_id: al.id,
          estado_entrega: estadoEntrega,
          nota,
          observacion: obs,
        });
      }
    }
  }

  await prisma.calificacionActividad.createMany({ data: loteCalificaciones });

  // 13. Notificaciones y Auditoría General
  await prisma.notificacion.createMany({
    data: [
      {
        usuario_destino_id: padresCreados[0].id,
        estudiante_id: estudiantesCreados[0].id,
        titulo: 'Situación de salud registrada — Solicitud de recojo',
        mensaje:
          'Estimado padre de familia: Se informa que el estudiante Mateo Alejandro Quispe Huamán presentó fiebre (38.2 °C) a las 10:35. Se solicita acercarse a la institución para recogerlo.',
        tipo: 'SALUD',
        leido: true,
        requiere_confirmacion: true,
        confirmado: true,
        fecha_confirmacion: new Date(Date.now() - 3600000),
      },
      {
        usuario_destino_id: padresCreados[0].id,
        estudiante_id: estudiantesCreados[1].id,
        titulo: 'Situación de salud registrada — Pendiente de confirmación',
        mensaje:
          'Estimado padre de familia: Se informa que la estudiante Valentina Sofía Rojas Mendoza presenta malestar estomacal (11:20). Por favor confirme la recepción de este aviso y acérquese a la institución.',
        tipo: 'SALUD',
        leido: false,
        requiere_confirmacion: true,
        confirmado: false,
      },
      {
        usuario_destino_id: padresCreados[0].id,
        estudiante_id: estudiantesCreados[1].id,
        titulo: 'Citación a Padre de Familia programada',
        mensaje: `Se ha generado una citación para el día ${fechaHoy} a las 15:00 en Sala de Reuniones — Tutoría 1° A. Por favor confirme su asistencia.`,
        tipo: 'CITACION',
        leido: false,
        requiere_confirmacion: true,
        confirmado: false,
      },
      {
        usuario_destino_id: director.id,
        estudiante_id: estudiantesCreados[2].id,
        titulo: 'Incidencia Grave registrada (INC-00046)',
        mensaje:
          'Se registró una incidencia de gravedad GRAVE para Sebastián Gabriel Flores Vargas (1° "A") por evasión de aula. Citación programada para hoy a las 16:00.',
        tipo: 'INCIDENCIA',
      },
    ],
  });

  await prisma.auditoriaGeneral.createMany({
    data: [
      {
        usuario_id: admin.id,
        usuario_nombre: `${admin.nombres} ${admin.apellidos}`,
        usuario_rol: 'ADMIN',
        accion: 'QR_REVOCADO_Y_REEMPLAZADO',
        entidad: 'CODIGO_QR',
        estudiante_id: estudiantesCreados[0].id,
        descripcion:
          'Se desactivó el QR anterior STU-OLD0-LOST-001 por pérdida de fotocheck y se emitió nuevo código activo.',
        metadata: JSON.stringify({
          qr_anterior: 'STU-OLD0-LOST-001',
          qr_nuevo: estudiantesCreados[0].codigo_qr_unico,
          motivo: 'Pérdida de fotocheck',
        }),
      },
      {
        usuario_id: director.id,
        usuario_nombre: `${director.nombres} ${director.apellidos}`,
        usuario_rol: 'DIRECTOR',
        accion: 'ASISTENCIA_MODIFICADA',
        entidad: 'ASISTENCIA',
        estudiante_id: estudiantesCreados[1].id,
        descripcion: 'Asistencia modificada de FALTA a JUSTIFICADO con documento presentado.',
        metadata: JSON.stringify({
          antes: 'FALTA',
          despues: 'JUSTIFICADO',
          motivo: 'Cita médica odontológica acreditada con constancia ESSALUD #48921',
        }),
      },
      {
        usuario_id: padresCreados[0].id,
        usuario_nombre: `${padresCreados[0].nombres} ${padresCreados[0].apellidos}`,
        usuario_rol: 'PADRE',
        accion: 'AUTORIZACION_RECOJO_CREADA',
        entidad: 'AUTORIZACION_RECOJO',
        entidad_id: autTioMateo.id,
        estudiante_id: estudiantesCreados[0].id,
        descripcion:
          'Autorización de recojo creada a favor de Juan Carlos Quispe Condori (Tío, DNI 45891234).',
        metadata: JSON.stringify({
          persona_autorizada: 'Juan Carlos Quispe Condori',
          dni: '45891234',
          tipo: 'UN_SOLO_USO',
        }),
      },
      {
        usuario_id: auxiliar1.id,
        usuario_nombre: `${auxiliar1.nombres} ${auxiliar1.apellidos}`,
        usuario_rol: 'AUXILIAR',
        accion: 'RETIRO_ESTUDIANTE_REGISTRADO',
        entidad: 'RETIRO',
        estudiante_id: estudiantesCreados[0].id,
        descripcion:
          'Estudiante Mateo Alejandro Quispe Huamán retirado a las 11:15 por su padre debido a situación de salud.',
        metadata: JSON.stringify({
          recogido_por: `${padresCreados[0].nombres} ${padresCreados[0].apellidos}`,
          hora_salida: '11:15',
          motivo: 'Situación de salud',
        }),
      },
      {
        usuario_id: tutor1.id,
        usuario_nombre: `${tutor1.nombres} ${tutor1.apellidos}`,
        usuario_rol: 'TUTOR',
        accion: 'ACTA_COMPROMISO_GENERADA',
        entidad: 'ACTA',
        entidad_id: actaCompromiso.id,
        estudiante_id: estudiantesCreados[0].id,
        descripcion:
          'Generación de Acta de Compromiso ACT-00012 y compromisos CMP-00018 / CMP-00019.',
        metadata: JSON.stringify({
          codigo_acta: 'ACT-00012',
          tipo: 'COMPROMISO',
        }),
      },
    ],
  });

  console.log('✅ Seeder Integral SIAE ejecutado con éxito:');
  console.log('   - Administrador: admin@siae.edu.pe / 123456');
  console.log('   - Director:      director@siae.edu.pe / 123456');
  console.log('   - Tutor:         tutor1@siae.edu.pe / 123456');
  console.log('   - Docente:       docente1@siae.edu.pe / 123456');
  console.log('   - Auxiliar:      auxiliar1@siae.edu.pe / 123456');
  console.log('   - Padre:         padre1@siae.edu.pe / 123456');
  console.log('   - Estudiante:    alumno1@siae.edu.pe / 123456');
}

main()
  .catch((e) => {
    console.error('❌ Error en Seeder SIAE:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
