# BeatMind AI - Product Requirements Document (PRD)

**Version:** 1.0 | **Fecha:** 2026-02-26 | **Status:** Draft

---

## Contexto

BeatMind AI es una plataforma SaaS multi-tenant que transforma gimnasios, estudios de pilates, cycling y academias de fitness en instalaciones de entrenamiento basadas en datos. Combina monitoreo de frecuencia cardíaca en tiempo real con coaching AI para ofrecer feedback personalizado durante entrenamientos y reportes post-sesión.

**Problema:** No existe una solución accesible que permita a gimnasios pequeños y medianos ofrecer monitoreo cardíaco en vivo con coaching inteligente como diferenciador competitivo.

**Modelo de negocio:** B2B SaaS con pagos recurrentes gestionados offline. El admin (tú) provee el kit completo (mini PC + receptor ANT+ + bandas) a cada gimnasio como parte del servicio. White-label para cada gym.

**Lo que existe hoy (burnapp MVP):** Sistema funcional single-gym con lectura ANT+ (hasta 8 atletas), WebSocket a TV, persistencia PostgreSQL, AI coaching (Coach Pulse con OpenAI), y webhooks n8n. Todo en Node.js vanilla corriendo en la mini PC.

**Shift arquitectónico:** De todo-local en la mini PC → Mini PC solo lee ANT+ y envía datos a una plataforma centralizada en el VPS.

---

## 1. Personas de Usuario

| Rol | Quién | Acceso |
|-----|-------|--------|
| **SuperAdmin** | Dueño de la plataforma BeatMind AI (tú) | Todo: gyms, suscripciones, hardware, analytics globales |
| **Gym Owner** | Dueño/gerente de un gym suscrito | Su gym: trainers, atletas, sesiones, branding, reportes |
| **Trainer** | Instructor de clases | Su gym: monitoreo en vivo, sesiones, reportes de atletas |
| **Athlete** | Persona que entrena con banda HR | Solo su data: historial, reportes, progreso |

---

## 2. Arquitectura del Sistema

```
  GYM A (Mini PC)                 CENTRAL PLATFORM (VPS)              GYM B (Mini PC)
  ================                =====================               ================
  ANT+ Dongle(s)                  Next.js 16 App Router               ANT+ Dongle(s)
       |                          PostgreSQL (multi-tenant)                 |
  Local Agent                     OpenAI API                          Local Agent
  (Node.js/Bun)                   WhatsApp API (Twilio)               (Node.js/Bun)
       |                                |                                  |
       +--- HTTPS/WSS -----> [API + WS Server] <---- HTTPS/WSS -----------+
                                       |
                              +--------+--------+----------+
                              |        |        |          |
                          [TV Display] [Admin] [Athlete] [Reports]
```

### Tech Stack

| Capa | Tecnología |
|------|-----------|
| Framework | Next.js 16 (App Router) + React 19 + TypeScript |
| Styling | Tailwind CSS 4 |
| Auth | Clerk (Organizations + custom roles) |
| Database | PostgreSQL en VPS existente |
| ORM | Drizzle ORM |
| Real-time | WebSocket server separado (ws library) + PM2 |
| AI | OpenAI API (gpt-4o-mini) |
| WhatsApp | Twilio WhatsApp Business API |
| Package Manager | Bun |
| Local Agent | Node.js + ant-plus (TypeScript) |
| Charts | Recharts |

### WebSocket: Proceso separado

Next.js no soporta WebSocket persistente en route handlers. Solución: un proceso WS separado (`ws-server.ts`) junto a Next.js en el mismo VPS, ambos conectados a PostgreSQL. Gestión con PM2.

---

## 3. Autenticación y Autorización

### Clerk Multi-Tenancy

- Cada **Gym** = 1 Clerk **Organization**
- **SuperAdmin** = flag `is_superadmin` en metadata del usuario
- **Gym Owner** = Organization member con rol `org:admin`
- **Trainer** = Organization member con rol `org:trainer`
- **Athlete** = Organization member con rol `org:athlete`

### Protección de Rutas

| Ruta | Roles Permitidos |
|------|-----------------|
| `/superadmin/*` | SuperAdmin |
| `/gym/*` | Gym Owner, Trainer |
| `/athlete/*` | Athlete |
| `/tv/[gymId]?token=TOKEN` | Público (auth por token UUID, sin Clerk) |
| `/api/agent/*` | Agent (auth por `X-Agent-Id` + `X-Agent-Secret`) |

---

## 4. Módulos y Features

### 4.1 SuperAdmin Dashboard (`/superadmin`)

| Feature | Prioridad |
|---------|-----------|
| Lista de gyms (status, suscripción, último activo, # atletas) | P0 |
| Crear gym (nombre, dirección, email del owner, plan, max atletas) | P0 |
| Editar gym (status suscripción: active/suspended/cancelled) | P0 |
| Asignar Owner (invitación Clerk) | P0 |
| Inventario hardware (mini PCs, dongles: serial, gym asignado, status) | P1 |
| Health de agents (conectado/desconectado, último heartbeat) | P1 |
| Analytics globales (total atletas, sesiones activas, sesiones del mes) | P2 |

### 4.2 Gym Dashboard (`/gym`)

**Settings (Owner):**
- Perfil del gym (nombre, dirección, timezone)
- White-label (logo, color primario/secundario)
- TV token (ver/regenerar)

**Gestión de Trainers (Owner):**
- CRUD trainers con invitación Clerk

**Gestión de Atletas (Owner + Trainer):**
- CRUD atletas (nombre, email, phone WhatsApp, edad, peso, max HR)
- Mapeo atleta-banda: asignar `sensor_id` ANT+ a perfil de atleta (persistente)
- Import CSV (P2)

**Sesiones (Owner + Trainer):**
- Vista de sesión activa (versión web del TV dashboard)
- Inicio/fin manual con tipo de clase (spinning, pilates, cycling)
- Auto-sesiones: auto-start con primer sensor, auto-end tras 2min inactividad
- Historial de sesiones (fecha, duración, # atletas, HR promedio/max)
- Detalle de sesión por atleta (zonas, HR, calorías)

**Reportes (Owner + Trainer):**
- Reporte post-sesión auto-generado
- Progreso de atleta (tendencias semanales/mensuales)
- Envío por WhatsApp

### 4.3 TV Dashboard (`/tv/[gymId]?token=TOKEN`)

Migración y mejora del `dashboard/index.html` de burnapp.

| Feature | Prioridad |
|---------|-----------|
| Grid dinámico hasta 20 atletas (4x5) | P0 |
| Tarjeta de atleta: BPM grande, zona HR con color, % max HR, nombre real | P0 |
| Sparkline 60s por atleta | P0 |
| 5 zonas HR con colores (Blue/Green/Yellow/Orange/Red) | P0 |
| Coach AI overlay en tarjeta (8s, mismo UX que burnapp) | P0 |
| Conexión WebSocket a VPS con auto-reconnect | P0 |
| Auth por token (sin Clerk) | P0 |
| Branding white-label (logo, nombre, colores del gym) | P1 |
| Timer de sesión | P1 |
| Banner "COACH AI ACTIVADO" | P1 |
| Modo leaderboard (ranking por calorías o tiempo en zona 4-5) | P2 |

### 4.4 Portal del Atleta (`/athlete`)

| Feature | Prioridad |
|---------|-----------|
| Dashboard: último sesión, total sesiones, racha semanal | P0 |
| Historial de sesiones | P0 |
| Detalle de sesión (chart HR, zonas, mensajes AI recibidos) | P1 |
| Charts de progreso (semanal/mensual) | P1 |
| Perfil (nombre, edad, peso, max HR, número WhatsApp, opt-in) | P0 |

### 4.5 Sistema AI Coaching

Port de `ai-analyzer.js` de burnapp a TypeScript como servicio server-side.

- Auto-análisis cada 15-60s durante sesión activa
- Warmup 60s después del primer sensor
- Mensajes por atleta: nombre, zona, tendencia, BPM promedio
- Persona "Coach Pulse": enérgico, breve (2-3 frases), usa BPM promedio
- Soporte español/portugués (configurable por gym)
- Resumen AI post-sesión
- Prompts personalizables por gym (P2)

### 4.6 Reportes y WhatsApp

**Post-sesión (por atleta):**
- Fecha, duración, tipo de clase
- HR promedio/max/min
- Tiempo en cada zona (bar chart)
- Calorías estimadas
- Chart HR en el tiempo
- Resumen AI

**WhatsApp (Twilio):**
- Template message aprobado: "Hola {nombre}, tu sesión de {clase} en {gym} terminó! Duración: {duración}, HR Promedio: {hr} BPM, Calorías: {cal}. Ver reporte: {url}"
- Auto-envío 2min después de fin de sesión
- Opt-in requerido del atleta
- Retry una vez si falla

### 4.7 Local Agent (Mini PC)

Package separado dentro del repo: `agent/`

```
agent/
  src/
    ant-reader.ts        -- Port de burnapp ant-reader.js
    device-manager.ts    -- Port de burnapp device-manager.js
    vps-client.ts        -- NUEVO: envía datos al VPS central
    local-dashboard.ts   -- Dashboard TV local (fallback sin internet)
    config.ts
    index.ts
  package.json
  .env                   -- AGENT_ID, GYM_ID, AGENT_SECRET, VPS_URL
```

**Funciones:**
- Lee ANT+ via USB dongle(s) (soporta múltiples receptores para 16-20 atletas)
- Envía HR data al VPS cada 1s (WebSocket) y cada 5s (HTTPS batch)
- Buffering local durante caídas de red (hasta 10min)
- Auto-reconnect con backoff exponencial
- Reporta health status cada 30s
- Dashboard TV local como fallback

---

## 5. Schema de Base de Datos

### Estrategia Multi-Tenant

Shared database, shared schema con `gym_id` FK en todas las tablas. Filtrado por `gym_id` en application layer (no RLS por simplicidad inicial).

### Tablas Principales

```sql
-- Gyms (tenants)
gyms (id UUID PK, name, slug UNIQUE, address, phone, timezone, language,
      clerk_org_id UNIQUE, tv_access_token UUID,
      subscription_status, subscription_plan, max_athletes,
      logo_url, primary_color, secondary_color,
      created_at, updated_at)

-- Users (linked to Clerk)
users (id UUID PK, clerk_user_id UNIQUE, email, name, phone,
       is_superadmin BOOLEAN, created_at, updated_at)

-- Gym memberships (user <-> gym con rol)
gym_memberships (id UUID PK, user_id FK, gym_id FK, role, is_active,
                 UNIQUE(user_id, gym_id))

-- Athletes (perfil extendido para monitoreo)
athletes (id UUID PK, user_id FK nullable, gym_id FK, name, email, phone,
          age, weight_kg, max_hr DEFAULT 190, whatsapp_opt_in,
          is_active, created_at, updated_at)

-- Mapeo atleta-banda (persistente)
athlete_bands (id UUID PK, athlete_id FK, gym_id FK, sensor_id INT,
               band_label, is_active, UNIQUE(gym_id, sensor_id))

-- Sessions
sessions (id UUID PK, gym_id FK, trainer_id FK, class_type,
          status, started_at, ended_at, duration_seconds,
          athlete_count, ai_summary, created_at)

-- HR readings (tabla de alto volumen, particionada por mes)
hr_readings (id BIGSERIAL PK, session_id FK, gym_id FK, athlete_id FK,
             sensor_id INT, heart_rate_bpm, hr_zone, hr_zone_name,
             hr_zone_color, hr_max_percent, beat_time, beat_count,
             device_active, recorded_at)

-- Stats por atleta por sesión
session_athletes (id UUID PK, session_id FK, athlete_id FK, sensor_id,
                  avg_hr, max_hr, min_hr, calories,
                  time_zone_1_s..time_zone_5_s,
                  joined_at, left_at, UNIQUE(session_id, athlete_id))

-- AI coaching messages
ai_coaching_messages (id UUID PK, session_id FK, gym_id FK,
                      message TEXT, model, athlete_summaries JSONB, created_at)

-- Agents (mini PCs)
agents (id UUID PK, gym_id FK, agent_secret, name, hardware_model,
        serial_number, status, last_heartbeat, ip_address,
        software_version, config JSONB, created_at)

-- HR bands inventory
hr_bands (id UUID PK, gym_id FK, sensor_id, band_label, brand, model,
          status, purchased_at, notes, created_at)
```

### Índices clave

```sql
idx_hr_readings_session_time (session_id, recorded_at DESC)
idx_hr_readings_gym_time (gym_id, recorded_at DESC)
idx_hr_readings_athlete (athlete_id, recorded_at DESC)
idx_sessions_gym (gym_id, started_at DESC)
idx_sessions_active (gym_id, status) WHERE status = 'active'
idx_athletes_gym (gym_id) WHERE is_active = true
idx_athlete_bands_gym (gym_id, sensor_id) WHERE is_active = true
```

### Volumen estimado

20 atletas x 1 reading/5s x 8h/día x 26 días/mes x 10 gyms = ~7.5M filas/mes.
Mitigación: Particionamiento por mes, archivado >6 meses, tablas resumen.

---

## 6. API Design

### Agent API (Mini PC → VPS)

```
POST /api/agent/heartbeat     -- Batch de HR data (cada 5s)
POST /api/agent/status        -- Health status (cada 30s)
WS   /ws/agent                -- Stream real-time (cada 1s)
```

Auth: Headers `X-Agent-Id` + `X-Agent-Secret`

### TV WebSocket

```
WS /ws/tv/[gymId]?token=TOKEN
  VPS → TV: { type: "hr-update", devices: {...} }        -- cada 1s
  VPS → TV: { type: "ai-coaching", analysis: "..." }     -- periódico
  VPS → TV: { type: "session-event", event: "started" }  -- eventos
```

### REST API (Web App, auth Clerk)

```
-- SuperAdmin
GET/POST/PATCH /api/v1/superadmin/gyms
GET            /api/v1/superadmin/agents

-- Gym
GET/PATCH      /api/v1/gym/profile
GET/POST/PATCH /api/v1/gym/athletes
POST/DELETE    /api/v1/gym/athletes/[id]/bands
GET/POST       /api/v1/gym/trainers
GET            /api/v1/gym/sessions
GET            /api/v1/gym/sessions/active
POST           /api/v1/gym/sessions/[id]/end

-- Athlete
GET/PATCH      /api/v1/athlete/profile
GET            /api/v1/athlete/sessions
GET            /api/v1/athlete/progress

-- Reports
GET            /api/v1/reports/session/[id]
POST           /api/v1/reports/session/[id]/send-whatsapp
```

---

## 7. Data Flow

### Real-time (Banda → TV): latencia target < 2s

```
HR Band → ANT+ Dongle → ant-reader.ts (mini PC) → device-manager.ts
→ vps-client.ts (WS cada 1s) → VPS WS Server → mapea sensor_id a atleta
→ broadcast a TV via /ws/tv/[gymId] → React renderiza tarjeta
```

### AI Coaching

```
Timer 15-60s → query hr_readings (últimos N min) → resumir por atleta
→ OpenAI API → almacenar en ai_coaching_messages → broadcast a TV
→ overlay en tarjeta del atleta (8s visible)
```

### Post-sesión

```
Sesión termina → calcular stats por atleta → generar resumen AI
→ WhatsApp template a atletas con opt-in → reporte disponible en portal
```

---

## 8. Estructura de Archivos

```
beat-mind-ai/
  app/
    (auth)/sign-in, sign-up
    (platform)/
      superadmin/           -- Dashboard admin
      gym/                  -- Dashboard gym (owner + trainer)
        athletes/, trainers/, sessions/, settings/, branding/
      athlete/              -- Portal del atleta
        sessions/, progress/, profile/
    tv/[gymId]/page.tsx     -- TV display (sin Clerk layout)
    api/
      agent/heartbeat, status
      v1/superadmin, gym, athlete, reports
  lib/
    db/schema.ts, migrations/, index.ts
    auth/guards.ts, agent-auth.ts
    hr/zones.ts, calories.ts
    ai/coach.ts, prompts.ts
    ws/manager.ts, gym-state.ts
    whatsapp/client.ts, templates.ts
    utils/gym-scope.ts
  components/tv/, dashboard/, athlete/
  agent/                    -- Package separado para mini PC
    src/ant-reader.ts, device-manager.ts, vps-client.ts, index.ts
```

---

## 9. Plan de Fases

### Fase 1: Foundation (Semanas 1-3)
- Drizzle ORM + migraciones PostgreSQL
- Clerk con Organizations y roles custom
- Layout system con route groups y guards por rol
- SuperAdmin: CRUD de gyms y suscripciones
- Agent API: endpoints heartbeat, status, y WebSocket
- Port de `hr-zones.ts` como utilidad compartida
- **Seguridad: rotar TODAS las credenciales expuestas en `.env`**

### Fase 2: Gym Management + Local Agent (Semanas 4-6)
- Gym Dashboard: settings, white-label, TV token
- CRUD atletas y mapeo atleta-banda
- Gestión de trainers
- Port del Local Agent a TypeScript (ant-reader, device-manager, vps-client)
- Buffering local y auto-reconnect
- Dashboard TV local (fallback)
- Auto-sesiones

### Fase 3: TV Dashboard + AI Coaching (Semanas 7-9)
- TV Dashboard React (grid dinámico hasta 20 atletas)
- Tarjetas de atleta con BPM, zona, sparkline, nombre real
- WebSocket al VPS con auto-reconnect
- Auth por token, white-label
- Port de AI coaching a TypeScript server-side
- Coach overlay en TV (8s)
- Timer de sesión

### Fase 4: Reports + Athlete Portal (Semanas 10-12)
- Cálculo de stats post-sesión (HR, zonas, calorías)
- Página de reporte web
- Resumen AI de sesión
- Athlete Portal: dashboard, historial, detalle, perfil
- Integración Twilio WhatsApp
- Auto-envío de reportes

### Fase 5: Polish + Launch (Semanas 13-14)
- Sesiones manuales desde gym dashboard
- Charts de progreso del atleta
- Modo leaderboard en TV
- Particionamiento de hr_readings
- Testing end-to-end con hardware real
- Security audit

---

## 10. Seguridad

**CRÍTICO:** El archivo `.env` tiene credenciales reales commiteadas en git. Acción inmediata:
1. Rotar TODAS las keys (Clerk, PostgreSQL, OpenAI)
2. Limpiar `.env` del historial de git
3. Verificar `.gitignore`

**Aislamiento de datos:** Todas las queries incluyen `gym_id`. Utility `withGymScope(gymId)`.

**API Security:** Clerk middleware (web), Agent credentials (mini PC API), Token UUID (TV).

---

## 11. Verificación

Para validar que la implementación funciona end-to-end:

1. **Auth:** Login como SuperAdmin → crear gym → invitar Owner → login como Owner → invitar Trainer y Athlete
2. **Agent:** Configurar mini PC con credenciales → verificar heartbeat llega al VPS → agent aparece "online" en admin
3. **Real-time:** Conectar banda ANT+ → verificar datos en TV dashboard via WebSocket → verificar nombre real del atleta
4. **AI:** Esperar warmup 60s → verificar mensaje Coach Pulse aparece en TV overlay → verificar almacenado en DB
5. **Reportes:** Terminar sesión → verificar stats calculados → verificar WhatsApp enviado → verificar reporte en portal atleta
6. **White-label:** Cambiar logo/colores del gym → verificar reflejados en TV y portal
7. **Resiliencia:** Desconectar internet de mini PC → verificar buffering local → reconectar → verificar datos sincronizados
8. **Tests:** `bun run test && bun run lint`

### Archivos críticos del MVP a reusar

- `/Users/csarsalinas/AI Coding/burnapp/src/ant-reader.js` → port a TypeScript
- `/Users/csarsalinas/AI Coding/burnapp/src/device-manager.js` → port a TypeScript
- `/Users/csarsalinas/AI Coding/burnapp/src/ai-analyzer.js` → port como servicio server-side
- `/Users/csarsalinas/AI Coding/burnapp/src/hr-zones.js` → port como utilidad compartida
- `/Users/csarsalinas/AI Coding/burnapp/dashboard/index.html` → reescribir como componentes React
