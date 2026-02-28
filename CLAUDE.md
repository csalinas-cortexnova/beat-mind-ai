# CLAUDE.md

Este arquivo fornece instruções ao Claude Code quando trabalhando neste repositório.

## Instruções Gerais

- Sempre use `bun` em vez de `npm`
- Siga TDD: escreva testes primeiro, depois implemente
- Execute testes antes de commit: `bun run test && bun run lint`
- Prefira TypeScript sobre JavaScript
- Quando precisar criar UI ou UX, use a skill `/frontend-design` para gerar interfaces de alta qualidade

## Project Tracking

> **CRITICAL**: Tracking updates are MANDATORY steps, not optional. Skipping them breaks coordination between agents and sessions. Treat them as part of the implementation — code without tracking updates is incomplete.
>
> **STOP**: Do NOT write a single line of code, test, or implementation until steps 1-3 below are completed and verified. This is a hard gate — no exceptions.

### Mandatory Workflow (follow this EXACT order EVERY time)

#### PHASE 1 — BEFORE writing any code (BLOCKING GATE):

These steps MUST be completed sequentially before ANY code is written. Do NOT combine them with code-writing tool calls. Verify each step is done before proceeding to the next.

1. **Read `specs/INDEX.md`** — Understand current project status, what specs are done, in-progress, or pending. Identify dependencies.
2. **Mark spec as `[~]` in `specs/INDEX.md`** — If the spec is not already marked as in-progress, edit the file NOW. Use the Edit tool. Confirm the edit succeeded.
3. **Mark specific task(s) as `[~]` in `TASKS.md`** — Find the exact task lines you will work on. Edit them from `[ ]` to `[~]`. Use the Edit tool. Confirm the edit succeeded.
4. **Only THEN** proceed to Phase 2.

**Verification checkpoint**: Before writing any test or implementation code, you MUST have already made edits to `specs/INDEX.md` and/or `TASKS.md`. If you haven't, STOP and go back to step 1.

#### PHASE 2 — DURING implementation (REAL-TIME logging):

5. **Log gotchas, decisions, and blockers in `progress.txt` AS THEY HAPPEN** — Not at the end. Not in batch. Each time you make a design decision, encounter a gotcha, or hit a blocker, IMMEDIATELY edit `progress.txt` with a new line. Format: `[YYYY-MM-DD] CATEGORY: description`. Categories: `DECISION`, `GOTCHA`, `BLOCKER`, `NOTE`.
6. **If new tasks are discovered, add them to `TASKS.md` immediately** — Do not wait until the end.

**Rule**: For every 2-3 implementation files created, check if there are unlogged decisions. If yes, log them NOW before continuing.

#### PHASE 3 — AFTER implementation is complete (before moving on):

7. **Run tests**: `bun run test` — ALL must pass.
8. **Run lint**: `bun run lint` — ZERO errors (warnings are acceptable).
9. **Mark completed tasks as `[x]` in `TASKS.md`** — Edit the file.
10. **Update spec status in `specs/INDEX.md`** — `[x]` if fully done, keep `[~]` if partially done.
11. **Move completed spec to `specs/done/`** — If the spec is now fully `[x]`, move its file from `specs/` to `specs/done/` and update the link in `specs/INDEX.md` to point to `done/<filename>`.
12. **Log a COMPLETED entry in `progress.txt`** — Summarize what was done, number of tests, key decisions.

### Definition of Done

A task is NOT done until ALL of these are true:
- [ ] Tests pass (`bun run test`)
- [ ] Lint passes (`bun run lint`)
- [ ] Task marked `[x]` in `TASKS.md`
- [ ] Spec status updated in `specs/INDEX.md`
- [ ] Completed spec file moved to `specs/done/` (if spec is fully `[x]`)
- [ ] `progress.txt` has COMPLETED entry + all decisions/gotchas logged during implementation (not batched at the end)

### Common Violations (DO NOT repeat these)

| Violation | Correct Behavior |
|-----------|-----------------|
| Starting to code before marking `[~]` in TASKS.md | ALWAYS edit TASKS.md FIRST, then code |
| Reading specs/INDEX.md late or alongside code files | Read specs/INDEX.md as the VERY FIRST action |
| Batching all decisions/gotchas into progress.txt at the end | Log EACH decision in progress.txt immediately when it happens |
| Using internal TaskCreate/TaskUpdate instead of TASKS.md | TASKS.md is the source of truth for project tracking, not internal task tools |
| Skipping the verification checkpoint | After steps 1-3, explicitly confirm tracking files were updated before coding |
| Doing all work sequentially when 3+ independent units exist | Analyze dependency graph, build prereqs first, then spawn parallel agents for independent units |

### Task Selection and Scope Control

- Select ONE task (or one cohesive batch) at a time
- **Reference specs by number** (01-12) for consistency across agents and sessions
- **Validate subtask volume**: If the number of subtasks is large, re-prioritize and execute in parts (phases or batches). Do not tackle everything at once.
- **New tasks discovered during analysis**: Add them to `TASKS.md` and associate them with the relevant specs in `specs/`.
- **Scope discipline**: Never do more than what is already specified unless strictly necessary (e.g., blockers, dependencies, or critical gaps).

## TDD (Test Driven Development)

Este projeto segue TDD rigoroso. **Nunca escreva código de feature sem um teste falhando primeiro.**

### Ciclo Red-Green-Refactor
1. **RED**: Escreva um teste que falha para o comportamento desejado
2. **GREEN**: Escreva o código mínimo para o teste passar
3. **REFACTOR**: Melhore o código mantendo os testes passando

### Regras
- Todo código de feature DEVE ter testes correspondentes
- Testes devem ser escritos ANTES da implementação
- **NÃO burle (mock) os testes para fazê-los passar** — testes devem validar comportamento real
- **Implementações devem passar nos testes sem gambiarras** — se o teste falha, corrija a implementação, não o teste
- Só use mocks para dependências externas (APIs, DB, serviços terceiros), nunca para a lógica sendo testada
- Rode `bun run test` antes de qualquer commit
- Rode `bun run test:watch` durante o desenvolvimento

### Convenções de Testes
- Arquivos de teste: `*.test.ts` / `*.test.tsx`
- Localização: colocados junto ao código ou em `__tests__/`
- Naming: `describe('ComponentName')` → `it('should do something')`
- Use `@testing-library/react` para componentes
- Use `@testing-library/user-event` para interações

### Categorias de Testes
| Tipo | Escopo | Ferramenta |
|------|--------|------------|
| Unit | Funções, hooks, utils | Vitest |
| Integration | Componentes + estado | Vitest + Testing Library |
| E2E | Fluxos completos | Playwright (futuro) |

### Comandos
```bash
bun run test          # Roda todos os testes uma vez
bun run test:watch    # Roda em modo watch
bun run test:coverage # Roda com relatório de cobertura
```

## Parallel Agent Strategy

> **DIRECTIVE**: Maximize efficiency by using parallel agents whenever the task allows it. Before starting any implementation, ALWAYS analyze the dependency graph to determine if parallelization is possible. Working sequentially on 3+ independent units when agents could run in parallel is a waste of time and a workflow violation.

### Decision Checklist (evaluate BEFORE starting implementation)

Ask these questions for every task:

1. **Does the task have 3+ independent work units?** (endpoints, components, utilities that don't depend on each other) → If YES, parallelization is likely beneficial.
2. **Does each unit involve significant effort?** (at minimum 1 test file + 1 implementation file per unit) → If YES, the coordination overhead is worth it.
3. **Are there shared dependencies (guards, schemas, utilities) needed by multiple units?** → If YES, build these sequentially FIRST, then parallelize the rest.
4. **Do the independent units touch different files?** (no two agents editing the same file) → If YES, safe to parallelize.

**If all 4 conditions are met → USE PARALLEL AGENTS. This is not optional.**

### When NOT to Parallelize

- Task has fewer than 3 independent work units — overhead exceeds benefit
- All subtasks are strictly sequential (B requires the output of A)
- All work touches the same 1-2 files (merge conflicts)
- Task is a single bugfix, refactor, or small enhancement
- The approach for later subtasks depends on discoveries/decisions from earlier ones

### Parallelization Workflow

```
┌─────────────────────────────────────────────────────┐
│ PHASE 1 — TRACKING (lead, sequential)               │
│  1. Read specs/INDEX.md                             │
│  2. Mark [~] in specs/INDEX.md and TASKS.md         │
├─────────────────────────────────────────────────────┤
│ PHASE 2 — PREREQS (lead, sequential)                │
│  3. Map dependency graph of the task                │
│  4. Build shared prereqs (guards, schemas, utils)   │
│  5. Log decisions in progress.txt as they happen    │
├─────────────────────────────────────────────────────┤
│ PHASE 3 — PARALLEL EXECUTION (agents)               │
│  6. TeamCreate to create team                       │
│  7. Spawn agents via Task with team_name + name     │
│     - Each agent: clear scope, reference patterns   │
│     - Each agent: follows TDD (test first, impl)    │
│     - Use isolation: "worktree" for file safety     │
│  8. Log decisions in progress.txt as agents report  │
├─────────────────────────────────────────────────────┤
│ PHASE 4 — INTEGRATION (lead, sequential)            │
│  9. Collect and merge agent results                 │
│ 10. Run full test suite: bun run test               │
│ 11. Run lint: bun run lint                          │
│ 12. Mark [x] in TASKS.md, update specs/INDEX.md     │
│ 13. Log COMPLETED in progress.txt                   │
└─────────────────────────────────────────────────────┘
```

### Concrete Example

**Task**: Implement 5 athlete API endpoints (Spec 03 Part G)

**Dependency graph analysis**:
- `requireAthleteApi()` guard → blocker for ALL 5 endpoints
- 3 utility functions → independent of each other, used by different endpoints
- `AthleteProgressQuerySchema` → only used by progress endpoint (trivial)
- 5 endpoints → independent of each other once prereqs exist

**Correct execution**:
```
Sequential (lead):   guard + 3 utilities + schema  (~15 min)
                            ↓
Parallel (3 agents): ┌─ Agent 1: GET/PATCH profile (test + route)
                     ├─ Agent 2: GET sessions + GET sessions/[id] (tests + routes)
                     └─ Agent 3: GET progress (test + route)
                            ↓
Sequential (lead):   merge → full test suite → tracking updates
```

### Agent Spawning Mechanics

When spawning agents, ALWAYS use the Agent Teams system:
1. `TeamCreate` to create the team
2. `Task` with `team_name`, `name`, and `isolation: "worktree"` to spawn each agent
3. Each agent prompt MUST include:
   - Exact files to create/modify (no ambiguity)
   - Reference patterns to follow (path to an existing similar file)
   - Shared prereqs that are already available
   - Instruction to follow TDD (write test first, then implement)

**NEVER** use `Task` with `run_in_background: true` for spawning agents — that creates isolated background subprocesses without team coordination.

## Skill Creation for Agent Teams

Before spawning agents in parallel for a complex task:
1. Check if agents will need specialized knowledge not covered by existing skills
2. If yes, create a new skill in `.claude/skills/<name>/SKILL.md`
3. Update the Skills table in this CLAUDE.md file
4. Agents can then invoke the skill via `/skill-name` to get domain-specific guidance

## Skills Disponíveis

| Skill | Comando | Descrição |
|-------|---------|-----------|
| PostHog | `/posthog` | Analytics, feature flags, session replay |
| SEO Technical | `/seo-technical` | SEO técnico para Next.js |
| Marketing Copy | `/marketing-copy` | Copywriting Direct Response |
| UX Design | `/ux-design` | UX Design (princípios Apple) |
| Stripe | `/stripe` | Pagamentos internacionais |
| Polar | `/polar` | Pagamentos com MoR (tax compliance) |
| AbacatePay | `/abacatepay` | Pagamentos PIX (Brasil) |
| Cloudflare | `/cloudflare` | DNS, domínios, email routing, R2 storage |
| Favicon | `/favicon` | Geração de favicons e app icons |
| Drizzle | `/drizzle` | Schema patterns, migrations, multi-tenancy |
| Plan Spec | `/plan-spec` | Plan-first workflow: check priority queue, create/read spec plan, execute by parts |

## Commands Disponíveis

| Command | Descrição |
|---------|-----------|
| `/commit` | Stage all changes e cria commit com mensagem AI |
| `/push` | Push da branch atual para o remote |
| `/pr` | Cria Pull Request no GitHub |
| `/ship` | Commit + Push + PR em um só comando |

## Agents Disponíveis

| Agent | Descrição |
|-------|-----------|
| security-auditor | Auditoria de segurança para APIs, database, auth |

## Como Usar as Skills

### SEO Technical
```bash
/seo-technical
```
Configura SEO completo:
- Sitemaps e robots.txt
- Meta tags e OpenGraph
- Structured data (JSON-LD)
- Performance (Core Web Vitals)

### Marketing Copy
```bash
/marketing-copy
```
Escreve copy usando:
- Framework Elevated Direct Response
- Tom contrarian educator
- Hooks e CTAs otimizados

### UX Design
```bash
/ux-design
```
Design de UX com:
- Princípios da era Jobs (Apple)
- Progressive disclosure
- Anticipatory design

### Favicon
```bash
/favicon
```
Geração de favicons:
- Todos os tamanhos (16, 32, 180, 192, 512)
- Apple touch icon e Android chrome
- Web manifest para PWA
- Configuração de metadata Next.js

## Segurança

Após implementar features, execute o agent de segurança:
```
O agent security-auditor pode ser invocado para auditar:
- APIs e endpoints
- Database e RLS
- Autenticação e autorização
- Exposição de dados
```