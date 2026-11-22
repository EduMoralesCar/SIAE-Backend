const express = require('express');
const router = express.Router();

const { verificarToken, autorizarRoles } = require('../middlewares/auth.middleware');
const { obtenerMonitorLogs } = require('../middlewares/logger.middleware');
const authCtrl = require('../controllers/auth.controller');
const adminCtrl = require('../controllers/admin.controller');
const asistenciaCtrl = require('../controllers/asistencia.controller');
const conductaCtrl = require('../controllers/conducta.controller');
const academicoCtrl = require('../controllers/academico.controller');
const reportesCtrl = require('../controllers/reportes.controller');
const jornadaCtrl = require('../controllers/jornada.controller');

// ============================================================================
// 1. AUTENTICACIÓN Y CUENTAS DEMO
// ============================================================================
router.post('/auth/login', authCtrl.login);
router.get('/auth/demos', authCtrl.obtenerUsuariosDemo);
router.get('/auth/perfil', verificarToken, authCtrl.perfil);

// ============================================================================
// 2. CONFIGURACIÓN ESCOLAR, AÑOS ESCOLARES, MATRÍCULAS, USUARIOS Y QR
// ============================================================================
router.get('/configuracion', verificarToken, adminCtrl.obtenerConfiguracion);
router.put(
  '/configuracion',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR'),
  adminCtrl.actualizarConfiguracion
);

router.get('/anios-escolares', verificarToken, adminCtrl.listarAniosEscolares);
router.post(
  '/anios-escolares',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR'),
  adminCtrl.crearAnioEscolar
);
router.patch(
  '/anios-escolares/:id/estado',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR'),
  adminCtrl.cambiarEstadoAnioEscolar
);

router.get('/grados-secciones', verificarToken, adminCtrl.listarGradosSecciones);
router.post(
  '/grados-secciones',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR'),
  adminCtrl.crearGradoSeccion
);

router.get('/matriculas', verificarToken, adminCtrl.listarMatriculas);
router.post(
  '/matriculas',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR'),
  adminCtrl.registrarMatricula
);

router.get(
  '/usuarios',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR', 'AUXILIAR', 'TUTOR'),
  adminCtrl.listarUsuarios
);
router.post(
  '/usuarios',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR'),
  adminCtrl.crearUsuario
);
router.patch(
  '/usuarios/:id/estado',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR'),
  adminCtrl.cambiarEstadoUsuario
);
router.post(
  '/padres-estudiantes',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR'),
  adminCtrl.vincularPadreEstudiante
);

router.get('/estudiantes', verificarToken, adminCtrl.listarEstudiantes);
router.get(
  '/estudiantes/:id/linea-tiempo',
  verificarToken,
  reportesCtrl.obtenerLineaTiempoEstudiante
);
router.get(
  '/estudiantes/:id/codigos-qr',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR', 'AUXILIAR'),
  adminCtrl.listarHistorialQREstudiante
);
router.post(
  '/estudiantes/:id/regenerar-qr',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR', 'AUXILIAR'),
  adminCtrl.regenerarQREstudiante
);

router.get(
  '/auditoria-general',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR'),
  adminCtrl.listarAuditoriaGeneral
);

// Monitoreo de logs HTTP y salud operativa en tiempo real (Evidencia de producción)
router.get(
  '/monitor/logs',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR'),
  (req, res) => {
    const limite = req.query.limite ? Number(req.query.limite) : 80;
    return res.json({
      ok: true,
      ...obtenerMonitorLogs(limite),
    });
  }
);

// ============================================================================
// 3. ASISTENCIA QR, JUSTIFICACIÓN CON AUDITORÍA Y CIERRE AUTOMÁTICO
// ============================================================================
router.post(
  '/asistencias/escanear',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR', 'AUXILIAR', 'DOCENTE', 'TUTOR'),
  asistenciaCtrl.escanearQR
);

router.post(
  '/asistencias/justificar',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR', 'AUXILIAR', 'TUTOR', 'DOCENTE'),
  asistenciaCtrl.justificarOModificarAsistencia
);

router.post(
  '/asistencias/cierre-automatico',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR', 'AUXILIAR'),
  asistenciaCtrl.dispararCierreManual
);

router.get('/asistencias', verificarToken, asistenciaCtrl.listarAsistencias);
router.put(
  '/asistencias/:id',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR', 'AUXILIAR', 'TUTOR', 'DOCENTE'),
  asistenciaCtrl.actualizarAsistencia
);
router.delete(
  '/asistencias/:id',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR'),
  asistenciaCtrl.eliminarAsistencia
);
router.get(
  '/auditoria',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR', 'AUXILIAR'),
  asistenciaCtrl.listarAuditoria
);

// ============================================================================
// 4. PERMISOS, EVIDENCIAS, SITUACIONES DE SALUD, AUTORIZACIONES RECOJO Y RETIROS
// ============================================================================
router.get('/archivos/:id', verificarToken, jornadaCtrl.obtenerArchivoEvidencia);

router.get('/permisos', verificarToken, jornadaCtrl.listarSolicitudesPermiso);
router.post('/permisos', verificarToken, jornadaCtrl.crearSolicitudPermiso);
router.patch(
  '/permisos/:id/revisar',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR', 'TUTOR'),
  jornadaCtrl.revisarSolicitudPermiso
);

router.get('/salud', verificarToken, jornadaCtrl.listarSituacionesSalud);
router.post(
  '/salud',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR', 'AUXILIAR', 'TUTOR', 'DOCENTE'),
  jornadaCtrl.registrarSituacionSalud
);
router.patch('/salud/:id/confirmar', verificarToken, jornadaCtrl.confirmarNotificacionSalud);

router.get('/autorizaciones-recojo', verificarToken, jornadaCtrl.listarAutorizacionesRecojo);
router.post('/autorizaciones-recojo', verificarToken, jornadaCtrl.crearAutorizacionRecojo);
router.patch(
  '/autorizaciones-recojo/:id/estado',
  verificarToken,
  jornadaCtrl.cambiarEstadoAutorizacionRecojo
);

router.get('/retiros', verificarToken, jornadaCtrl.listarRetirosEstudiantes);
router.post(
  '/retiros',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR', 'AUXILIAR', 'TUTOR'),
  jornadaCtrl.registrarRetiroEstudiante
);

// ============================================================================
// 5. INCIDENCIAS, CITACIONES, REUNIONES, ACTAS, COMPROMISOS Y SEGUIMIENTO
// ============================================================================
router.get('/conducta/catalogo', verificarToken, conductaCtrl.obtenerCatalogo);
router.get('/conducta/incidencias', verificarToken, conductaCtrl.listarIncidencias);
router.post(
  '/conducta/incidencias',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR', 'AUXILIAR', 'DOCENTE', 'TUTOR'),
  conductaCtrl.registrarIncidencia
);
router.patch(
  '/conducta/incidencias/:id/cerrar',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR', 'AUXILIAR', 'DOCENTE', 'TUTOR'),
  conductaCtrl.cerrarIncidencia
);

router.get('/citaciones', verificarToken, conductaCtrl.listarCitaciones);
router.post(
  '/citaciones',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR', 'AUXILIAR', 'DOCENTE', 'TUTOR'),
  conductaCtrl.crearCitacion
);
router.patch('/citaciones/:id/responder', verificarToken, conductaCtrl.responderCitacionPadre);
router.patch(
  '/citaciones/:id/reprogramar',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR', 'AUXILIAR', 'DOCENTE', 'TUTOR'),
  conductaCtrl.reprogramarCitacion
);

router.get('/reuniones', verificarToken, conductaCtrl.listarReuniones);
router.post(
  '/reuniones',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR', 'AUXILIAR', 'DOCENTE', 'TUTOR'),
  conductaCtrl.registrarReunion
);

router.get('/actas', verificarToken, conductaCtrl.listarActas);
router.post(
  '/actas',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR', 'AUXILIAR', 'DOCENTE', 'TUTOR'),
  conductaCtrl.generarActa
);
router.patch('/actas/:id/aceptar', verificarToken, conductaCtrl.aceptarActaPadre);

router.get('/compromisos', verificarToken, conductaCtrl.listarCompromisos);
router.post(
  '/compromisos',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR', 'AUXILIAR', 'DOCENTE', 'TUTOR'),
  conductaCtrl.crearCompromiso
);
router.post(
  '/compromisos/:id/seguimientos',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR', 'AUXILIAR', 'DOCENTE', 'TUTOR'),
  conductaCtrl.registrarSeguimientoCompromiso
);

// ============================================================================
// 6. ACTIVIDADES, CALIFICACIONES, PORTAL PADRES Y PORTAL ESTUDIANTE
// ============================================================================
router.get('/actividades', verificarToken, academicoCtrl.listarActividades);
router.post(
  '/actividades',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR', 'DOCENTE', 'TUTOR'),
  academicoCtrl.crearActividad
);
router.post(
  '/actividades/calificar',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR', 'DOCENTE', 'TUTOR'),
  academicoCtrl.calificarActividadEstudiante
);

router.get('/portal/padre', verificarToken, academicoCtrl.obtenerPortalPadre);
router.get('/portal/estudiante', verificarToken, academicoCtrl.obtenerPortalEstudiante);

router.get('/notificaciones', verificarToken, academicoCtrl.listarNotificaciones);
router.patch('/notificaciones/leidas', verificarToken, academicoCtrl.marcarNotificacionesLeidas);
router.patch(
  '/notificaciones/:id/confirmar',
  verificarToken,
  academicoCtrl.confirmarRecepcionNotificacion
);

// ============================================================================
// 7. DASHBOARD DIRECTIVO, REPORTES MULTICRITERIO Y EXPORTACIÓN EXCEL
// ============================================================================
router.get(
  '/reportes/dashboard',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR', 'AUXILIAR', 'DOCENTE', 'TUTOR'),
  reportesCtrl.obtenerDashboardDirectivo
);
router.get(
  '/reportes/multicriterio',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR', 'AUXILIAR', 'DOCENTE', 'TUTOR'),
  reportesCtrl.obtenerReporteMulticriterio
);
router.get(
  '/reportes/exportar-excel',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR', 'AUXILIAR', 'DOCENTE', 'TUTOR'),
  reportesCtrl.exportarExcel
);
router.post(
  '/reportes/citar-apoderado',
  verificarToken,
  autorizarRoles('ADMIN', 'DIRECTOR', 'AUXILIAR', 'DOCENTE', 'TUTOR'),
  reportesCtrl.enviarCitacionApoderado
);

module.exports = router;
