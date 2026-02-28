# Skill: Plan Spec

## Trigger
User invokes `/plan-spec`

---

## ⛔ SCOPE: SOLO PLANIFICACIÓN — NUNCA EJECUCIÓN

**Este skill produce UN ÚNICO entregable: un archivo `.md` de plan en `specs/plans/`.**

| SÍ hace | NO hace |
|---------|---------|
| **Valida** planes existentes (antes de crear nuevos) | Implementar código |
| Escribe `specs/plans/spec-{NN}-{slug}.md` | Escribir tests |
| Actualiza `specs/INDEX.md` (Plan: `[Pending]` → link) | Crear/modificar archivos fuente |
| Registra 1 línea en `progress.txt` | Ejecutar ninguna parte del plan |

La implementación es un flujo **separado**: el usuario (u otro agente) elegirá después UNA parte del plan y la desarrollará. Ese paso NO es este skill.

---

## Purpose

Las specs del proyecto son grandes y complejas. Este skill descompone cada spec en partes manejables (3-6 partes autocontenidas) para que cada sesión de trabajo se enfoque en UNA sola tarea.

## Instructions

### Step 0 — Validate existing plans (READ ONLY — antes de crear planes nuevos)

Para cada archivo en `specs/plans/*.md`:

1. **Archivo existe** — El plan está referenciado en la Priority Queue de `specs/INDEX.md` con un link válido.
2. **Spec referenciada existe** — El plan apunta a una spec del Spec Catalog y ese archivo existe.
3. **Consistencia plan ↔ implementación** — Para partes marcadas `[x]` o `COMPLETED`:
   - Verificar que los archivos listados en "Files to create" o "Files created" existen en el codebase.
   - Si faltan archivos → marcar como inconsistencia.
4. **Consistencia plan ↔ TASKS.md** — Las tareas mencionadas en "TASKS.md mapping" existen en la sección correspondiente de `TASKS.md`.

**Para cada plan en INDEX con link (no `[Pending]`):** verificar que el archivo `specs/plans/spec-{NN}-*.md` existe. Si el link apunta a un archivo inexistente → inconsistencia.

**Resultado de la validación:**
- Si hay **inconsistencias críticas** (plan referenciado en INDEX pero archivo no existe, o spec no existe) → reportar al usuario con detalle y **preguntar si desea corregir antes de crear planes nuevos**.
- Si hay **inconsistencias menores** (archivos faltantes en partes "completadas", TASKS desalineados) → reportar como advertencias, pero **se puede proseguir** a crear planes nuevos.
- Si todo OK → proseguir silenciosamente a Step 1.

### Step 1 — Read Priority Queue
Read `specs/INDEX.md`. Locate the **Priority Queue** table.

### Step 2 — Find next spec to plan
Scan the Priority Queue from Priority 1 downward. Find the **highest-priority spec** whose Plan column says `[Pending]` (i.e., does NOT have a plan file yet).

- If ALL specs already have plans → report this to the user and **STOP**.
- If a spec is found → proceed to Step 3.

### Step 3 — Analyze the spec (READ ONLY — no file creation)
1. Read the full spec file (path in Spec Catalog, e.g. `specs/superadmin_dashboard_spec.md` o `specs/gym_dashboard_spec.md`)
2. Read `TASKS.md` to locate the task section for that spec
3. Read `specs/plans/spec-05-superadmin-dashboard.md` as **formato de referencia** (estructura, secciones)
4. Revisar el codebase (solo lectura) para: código reutilizable, dependencias, patrones del proyecto

### Step 4 — Write the plan
Create a new plan file in `specs/plans/` following the reference format:
- File naming: `spec-{NN}-{slug}.md` (e.g., `spec-04-security.md`)
- Split the spec into **3-6 autocontained parts**
- Each part must include:
  - **Scope**: what this part delivers
  - **Files to create/modify**: exact paths
  - **Tests**: what tests to write
  - **Existing code to reuse**: paths to existing utilities, patterns, guards
  - **TASKS.md mapping**: which tasks from TASKS.md correspond to this part
  - **Dependencies**: which other parts must be completed first
- Include a **parallelization graph** showing which parts can run concurrently
- Mark all parts as `[ ]` (pending)

### Step 5 — Update tracking
1. Update `specs/INDEX.md`: in the Priority Queue, change `[Pending]` del Plan a un link al archivo nuevo (ej. `[4 partes](plans/spec-06-gym-dashboard.md)`)
2. Agregar en `progress.txt`: `[YYYY-MM-DD] NOTE: Plan created for Spec NN - N parts`

### Step 6 — Report and STOP
Reportar al usuario:
- **Validación** (Step 0): resumen de planes validados; advertencias o inconsistencias si hubo.
- Si se creó un plan nuevo: qué spec, cuántas partes, resumen por parte (1 línea), grafo de paralelización.
- Si NO se creó plan: razón (todos tienen plan, o usuario pidió corregir primero).

**⛔ LÍMITE: El skill termina aquí. NO implementar. NO escribir código. NO ejecutar partes del plan. Si el usuario pide implementar, eso es un flujo distinto (ej. "implementa Part A de spec-06").**

## Reference format
Usar `specs/plans/spec-05-superadmin-dashboard.md` como template canónico.

Cada parte del plan debe incluir **TASKS.md mapping** explícito: qué ítems de `TASKS.md` cubre esa parte. Así el flujo posterior sabe qué marcar `[x]` al completar.

## Flujo posterior (fuera del skill)
Cuando se ejecute de nuevo el proceso, el usuario/agente:
1. Lee `specs/INDEX.md`
2. Identifica specs con plan pero aún no desarrolladas
3. Lee la carpeta `specs/plans/`
4. Elige **una y solo una** parte del plan (ej. Part A)
5. Implementa esa parte siguiendo TDD

Ese flujo es **independiente** de `/plan-spec`. Este skill solo crea el plan.

## Rules
- **Solo READ + WRITE del plan (+ validación read-only).** Nunca código de implementación, tests ni archivos fuente.
- **Step 0 (validación) es obligatorio** antes de crear planes nuevos. Si hay inconsistencias críticas, preguntar al usuario antes de proseguir.
- Los ÚNICOS archivos que este skill puede crear/editar:
  - `specs/plans/spec-{NN}-{slug}.md` (nuevo plan)
  - `specs/INDEX.md` (solo la columna Plan de la tabla)
  - `progress.txt` (solo 1 línea de log)
- Prohibido: ejecutar, implementar, codificar, crear tests después del plan
- Respetar orden de prioridad en la cola (no saltar specs)
- Si no existe el archivo de referencia, preguntar al usuario antes de continuar
