/**
 * Utilidades de Fecha y Hora estandarizadas en Zona Horaria America/Lima (UTC-5)
 * Garantiza comportamiento idéntico en desarrollo local y en despliegue en Render.
 */

const TIMEZONE = 'America/Lima';

function getLimaDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const map = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }
  const hour = map.hour === '24' ? '00' : map.hour;
  return {
    fecha: `${map.year}-${map.month}-${map.day}`,
    hora: `${hour}:${map.minute}:${map.second}`,
    horaCorta: `${hour}:${map.minute}`,
    minutosDelDia: parseInt(hour, 10) * 60 + parseInt(map.minute, 10),
  };
}

function timeStringToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
}

function getPreviousBusinessDays(count = 15, baseDate = new Date()) {
  const days = [];
  const cursor = new Date(baseDate);
  while (days.length < count) {
    const dayOfWeek = cursor.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      const { fecha } = getLimaDateParts(cursor);
      days.push(fecha);
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return days.reverse(); // Orden cronológico ascendente
}

module.exports = {
  TIMEZONE,
  getLimaDateParts,
  timeStringToMinutes,
  getPreviousBusinessDays,
};
