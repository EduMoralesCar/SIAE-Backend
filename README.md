# SIAE — Backend API REST (`SIAE-Backend`)

Servidor API REST del **Sistema Integral de Gestión y Seguimiento Escolar mediante Identificación QR (SIAE)**, construido con **Node.js + Express + Prisma ORM (`v5.22.0`)** sobre **PostgreSQL en Supabase**.

Implementa un esquema relacional completo de **24 modelos**, autenticación segura **JWT + RBAC** para los **7 roles institucionales**, caché en memoria con invalidación automática ante escrituras, tareas programadas de cierre diario de faltas y trazabilidad de auditoría transversal.

---

## Capacidades Principales

- **Modelo Relacional Integral (24 Tablas en Supabase):** Usuarios y roles, años escolares, grados/secciones, matrículas, vínculo padre-estudiante, asistencias QR y por curso, auditoría de asistencia, situaciones de salud, retiros, solicitudes de permiso, autorizaciones de terceros, incidencias, citaciones, reuniones, actas, compromisos, evidencias adjuntas, actividades académicas, notificaciones y auditoría general.
- **Seguridad JWT + Control de Acceso RBAC:** Autenticación mediante correo electrónico o DNI (`bcryptjs`), emisión de tokens JWT y autorización por rol (`ADMIN`, `DIRECTOR`, `TUTOR`, `DOCENTE`, `AUXILIAR`, `PADRE`, `ESTUDIANTE`).
- **Control de Asistencia QR y Cierre Automático:** Validación de tokens QR activos, clasificación automática `PRESENTE`/`TARDANZA` según configuración institucional (`America/Lima`), bloqueo anti-duplicado configurable, edición manual con motivo obligatorio y cierre automático diario mediante `node-cron`.
- **Gestión de Jornada y Convivencia Escolar:** Registro de situaciones de salud con confirmación del padre, retiros validando identidad de terceros autorizados, permisos con archivos adjuntos (PDF/imagen), incidencias con recálculo de puntaje conductual (`0–100`), citaciones, reuniones, actas y compromisos.
- **Analítica y Expediente Multianual:** Dashboard directivo con 12 KPIs institucionales, filtrado por fecha y aula, series históricas diarias (`tendenciaDiaria`), distribución del semáforo conductual, detector automático de ausencias recurrentes (`≥3` faltas consecutivas o `>20%` tardanzas) y línea de tiempo cronológica del estudiante.
- **Optimización de Rendimiento:** Middleware de caché `GET` en memoria con invalidación instantánea en `POST`/`PUT`/`PATCH`/`DELETE` y consultas paralelizadas con `Promise.all`.

---

## Stack Tecnológico

| Categoría | Tecnologías |
| :--- | :--- |
| **Runtime y Framework** | Node.js, Express 4 |
| **ORM y Base de Datos** | Prisma ORM `v5.22.0`, PostgreSQL (Supabase Pooler + Direct URL) |
| **Seguridad** | `jsonwebtoken` (JWT), `bcryptjs`, CORS |
| **Automatización y Utilidades** | `node-cron`, `nodemailer`, `exceljs`, `dotenv` |

---

## Estructura del Proyecto

```text
Backend/
├── prisma/
│   ├── schema.prisma                   # Esquema relacional de 24 modelos (Supabase PostgreSQL)
│   └── seed.js                         # Poblador inicial por lotes con 7 roles y datos históricos
├── src/
│   ├── config/
│   │   └── prisma.js                   # Instancia singleton de PrismaClient
│   ├── controllers/
│   │   ├── auth.controller.js          # Login, sesión activa y buzón de notificaciones
│   │   ├── asistencia.controller.js    # Escaneo QR, registro manual, justificaciones y auditoría
│   │   ├── jornada.controller.js       # Salud escolar, retiros, permisos y autorizaciones de terceros
│   │   ├── conducta.controller.js      # Incidencias, citaciones, reuniones, actas y compromisos
│   │   ├── academico.controller.js     # Cursos, actividades docentes y portales de padre/estudiante
│   │   ├── reportes.controller.js      # Dashboard analítico, expediente multianual y reportes
│   │   └── admin.controller.js         # Usuarios, matrículas, fotochecks QR, horarios y auditoría
│   ├── jobs/
│   │   └── asistencia.cron.js          # Cierre automático diario de faltas
│   ├── middlewares/
│   │   ├── auth.middleware.js          # Verificación JWT y autorización RBAC por rol
│   │   └── cache.middleware.js         # Caché GET en memoria con invalidación en escrituras
│   ├── routes/
│   │   └── index.js                    # Enrutador REST consolidado bajo /api
│   ├── services/
│   │   ├── auditoria.service.js        # Registro transversal en AuditoriaGeneral
│   │   └── notificacion.service.js     # Alertas en tiempo real y envío opcional SMTP
│   ├── utils/
│   │   └── dateHelper.js               # Manejo de fecha y hora en zona America/Lima
│   └── app.js                          # Servidor Express principal
├── .env.example
└── package.json
```

---

## Instalación y Configuración con Supabase

### 1. Clonar e instalar dependencias

```bash
git clone https://github.com/EduMoralesCar/SIAE-Backend.git
cd SIAE-Backend
npm install
```

### 2. Configurar variables de entorno (`.env`)

Copia `.env.example` a `.env` y completa tus credenciales de **Supabase** (*Connect → ORMs → Prisma*):

```env
DATABASE_URL="postgresql://postgres.[TU-PROYECTO-ID]:[TU-PASSWORD]@aws-1-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=20&pool_timeout=20"
DIRECT_URL="postgresql://postgres.[TU-PROYECTO-ID]:[TU-PASSWORD]@aws-1-us-west-2.pooler.supabase.com:5432/postgres"

PORT=4000
JWT_SECRET="tu_clave_secreta_jwt"
JWT_EXPIRES_IN="24h"
TZ="America/Lima"
```

### 3. Sincronizar base de datos y ejecutar el servidor

```bash
npm run db:setup   # Ejecuta prisma generate + prisma db push + seed.js
npm run dev        # Inicia el servidor con recarga automática en http://localhost:4000
```

| Script | Descripción |
| :--- | :--- |
| `npm run db:generate` | Genera el cliente Prisma actualizado |
| `npm run db:push` | Sincroniza el esquema `schema.prisma` hacia Supabase |
| `npm run db:seed` | Pobla las 24 tablas con los 7 roles y escenarios de demostración |
| `npm run db:setup` | Ejecuta el ciclo completo `generate` + `push` + `seed` |
| `npm start` | Inicia el servidor en modo producción (`node src/app.js`) |

---

## Principales Grupos de Endpoints (`/api`)

| Módulo | Prefijo / Rutas clave | Descripción |
| :--- | :--- | :--- |
| **Autenticación** | `POST /api/auth/login`, `GET /api/auth/me`, `GET /api/notificaciones` | Sesión JWT, validación de perfil y notificaciones |
| **Asistencia QR** | `POST /api/asistencia/escanear`, `GET /api/asistencia`, `PUT /api/asistencia/:id` | Escaneo QR, listado diario, edición auditada y justificaciones |
| **Jornada Escolar** | `/api/salud`, `/api/retiros`, `/api/permisos`, `/api/autorizaciones-recojo` | Atenciones médicas, salidas anticipadas, permisos y terceros |
| **Convivencia** | `/api/conducta`, `/api/citaciones`, `/api/reuniones`, `/api/actas`, `/api/compromisos` | Incidencias, puntaje conductual, citaciones, actas y seguimiento |
| **Académico y Portales** | `/api/docente/*`, `GET /api/portal/padre`, `GET /api/portal/estudiante` | Actividades por curso y vistas consolidadas de familia y alumno |
| **Analítica y Expediente** | `GET /api/reportes/dashboard`, `GET /api/expediente/:estudianteId`, `GET /api/reportes` | KPIs, tendencias diarias, línea de tiempo y reportes exportables |
| **Administración** | `/api/admin/usuarios`, `/api/admin/matriculas`, `/api/admin/configuracion`, `/api/carnets` | Gestión de usuarios, matrículas, fotochecks QR y auditoría general |

---

## Cuentas de Prueba (Seed)

Contraseña para todas las cuentas de demostración: **`123456`**

| Rol | Correo electrónico |
| :--- | :--- |
| **Administrador** | `admin@siae.edu.pe` |
| **Director** | `director@siae.edu.pe` |
| **Tutor** | `tutor1@siae.edu.pe` |
| **Docente** | `docente1@siae.edu.pe` |
| **Auxiliar** | `auxiliar1@siae.edu.pe` |
| **Padre / Apoderado** | `padre1@siae.edu.pe` |
| **Estudiante** | `alumno1@siae.edu.pe` |

---

## Arquitectura de Ramas (Git Flow)

El repositorio utiliza **Git Flow** con commits atómicos en español siguiendo **Conventional Commits** (`feat`, `fix`, `chore`, `perf`, `docs`), integrando cada módulo mediante **Pull Requests** hacia `dev` antes del release hacia `main`.

```mermaid
flowchart LR
    main["main (Producción)"] --> dev["dev (Integración)"]
    dev --> d1["docs/documentacion-readme"]
    dev --> f1["feature/base-datos-prisma-supabase"]
    dev --> f2["feature/infraestructura-servicios-y-cache"]
    dev --> f3["feature/autenticacion-y-seguridad-jwt"]
    dev --> f4["feature/asistencia-qr-y-cierre-automatico"]
    dev --> f5["feature/jornada-salud-retiros-y-permisos"]
    dev --> f6["feature/convivencia-conducta-y-actas"]
    dev --> f7["feature/academico-portales-y-reportes"]
    dev --> f8["feature/administracion-rutas-y-servidor"]
    d1 & f1 & f2 & f3 & f4 & f5 & f6 & f7 & f8 -->|"Pull Requests"| dev
    dev -->|"PR Release"| main
```

### Política de Ramas
- **`main`**: Rama estable de producción. Solo recibe código validado mediante Pull Request desde `dev`.
- **`dev`**: Rama de integración continua donde convergen todas las ramas `feature/*` y `docs/*`.
- **`feature/<modulo>`**: Ramas por dominio funcional con commits atómicos en español y sin solapamiento entre sí.
- **`docs/<tema>`**: Ramas exclusivas para documentación técnica.

---

## Repositorio Relacionado
- **Frontend Web:** [SIAE-Frontend](https://github.com/EduMoralesCar/SIAE-Frontend)
