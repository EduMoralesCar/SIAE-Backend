const nodemailer = require('nodemailer');
const prisma = require('../config/prisma');
const { emitirNotificacionUsuario } = require('./socket.service');

let transporter = null;
let usandoEthereal = false;

async function obtenerTransporter() {
  if (transporter) return transporter;

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    return transporter;
  }

  try {
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    usandoEthereal = true;
    return transporter;
  } catch {
    return null;
  }
}

/**
 * Envía notificación al Buzón en Tiempo Real de los padres vinculados (y Tutor/Dirección si corresponde)
 * y despacha correo electrónico automático mediante Nodemailer.
 */
async function notificarPadresEstudiante({
  estudianteId,
  titulo,
  mensaje,
  tipo = 'ASISTENCIA',
  notificarDireccion = false,
  notificarTutor = false,
}) {
  try {
    const vinculos = await prisma.padreEstudiante.findMany({
      where: {
        estudiante_id: estudianteId,
        recibe_alertas: true,
      },
      include: {
        padre: true,
        estudiante: {
          include: {
            usuario: true,
            grado_seccion: true,
          },
        },
      },
    });

    const notificacionesData = vinculos.map((v) => ({
      usuario_destino_id: v.padre_usuario_id,
      estudiante_id: estudianteId,
      titulo,
      mensaje,
      tipo,
    }));

    // Si es alerta preventiva o crítica, notificar también al Docente Tutor del aula
    if (notificarTutor && vinculos[0]?.estudiante?.grado_seccion?.tutor_docente_id) {
      notificacionesData.push({
        usuario_destino_id: vinculos[0].estudiante.grado_seccion.tutor_docente_id,
        estudiante_id: estudianteId,
        titulo: `[TUTORÍA] ${titulo}`,
        mensaje,
        tipo,
      });
    }

    // Si es alerta crítica (ej. puntaje <= 60 o 3+ faltas), derivar a Dirección / TOE
    if (notificarDireccion) {
      const directivos = await prisma.usuario.findMany({
        where: { rol: { in: ['ADMIN', 'DIRECTOR'] }, activo: true },
      });
      for (const directivo of directivos) {
        notificacionesData.push({
          usuario_destino_id: directivo.id,
          estudiante_id: estudianteId,
          titulo: `[DIRECCIÓN / TOE] ${titulo}`,
          mensaje,
          tipo: 'ALERTA_CRITICA',
        });
      }
    }

    if (notificacionesData.length > 0) {
      await prisma.notificacion.createMany({
        data: notificacionesData,
      });

      // Push inmediato por WebSocket (Socket.IO) a cada perfil destinatario conectado
      for (const notif of notificacionesData) {
        emitirNotificacionUsuario(notif.usuario_destino_id, {
          titulo: notif.titulo,
          mensaje: notif.mensaje,
          tipo: notif.tipo,
          estudiante_id: notif.estudiante_id,
        });
      }
    }

    const mailTransporter = await obtenerTransporter();

    for (const v of vinculos) {
      if (!v.padre?.email) continue;

      if (mailTransporter) {
        const info = await mailTransporter.sendMail({
          from: process.env.SMTP_FROM || 'SIAE Notificaciones <alertas@siae.edu.pe>',
          to: v.padre.email,
          subject: `[SIAE] ${titulo}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
              <div style="background: #0f172a; color: #ffffff; padding: 14px 20px;">
                <h2 style="margin: 0; font-size: 16px;">SIAE — Control de Asistencia Escolar</h2>
              </div>
              <div style="padding: 20px; color: #1e293b;">
                <p style="margin-top: 0;">Estimado(a) <strong>${v.padre.nombres} ${v.padre.apellidos}</strong>,</p>
                <h3 style="color: #0f172a; margin-top: 8px; font-size: 15px;">${titulo}</h3>
                <p style="font-size: 14px; line-height: 1.5; background: #f8fafc; padding: 12px; border-left: 3px solid #0f172a; border-radius: 4px;">
                  ${mensaje}
                </p>
                <p style="font-size: 12px; color: #64748b; margin-top: 16px; margin-bottom: 0;">
                  Consulte el detalle actualizado ingresando al Portal de Padres SIAE desde su navegador móvil.
                </p>
              </div>
            </div>
          `,
        });

        if (usandoEthereal) {
          const previewUrl = nodemailer.getTestMessageUrl(info);
          console.log(`📧 [SIAE Email -> ${v.padre.email}] Vista previa: ${previewUrl}`);
        }
      } else {
        console.log(`📧 [SIAE Notificación -> ${v.padre.email}] ${titulo}: ${mensaje}`);
      }
    }
  } catch (err) {
    console.error('Error al enviar notificación SIAE:', err.message);
  }
}

module.exports = {
  notificarPadresEstudiante,
};
