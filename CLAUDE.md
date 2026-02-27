# CLAUDE.md

Este arquivo fornece instruções ao Claude Code quando trabalhando neste repositório.

## Instruções Gerais

- Sempre use `bun` em vez de `npm`
- Siga TDD: escreva testes primeiro, depois implemente
- Execute testes antes de commit: `bun run test && bun run lint`
- Prefira TypeScript sobre JavaScript
- Quando precisar criar UI ou UX, use a skill `/frontend-design` para gerar interfaces de alta qualidade

## Project Tracking

- **Before starting work**, consult `specs/INDEX.md` to understand project status and dependencies
- **When starting a spec**, update its status to `[~]` in `specs/INDEX.md`
- **When completing a spec**, update its status to `[x]` in `specs/INDEX.md`
- **Mark tasks** in `TASKS.md` with `[~]` when starting, `[x]` when done
- **Log gotchas, decisions, and blockers** in `progress.txt` using the format: `[YYYY-MM-DD] CATEGORY: description`
- **Reference specs by number** (01-12) for consistency across agents and sessions

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

## Skill Creation for Agent Teams

Before spawning agents in parallel for a complex task:
1. Check if agents will need specialized knowledge not covered by existing skills
2. If yes, create a new skill in `.claude/skills/<name>/SKILL.md`
3. Update the Skills table in this CLAUDE.md file
4. Agents can then invoke the skill via `/skill-name` to get domain-specific guidance

## Agent Spawning
When asked to spawn, create, or start agents/teammates, ALWAYS use the Agent Teams system:
1. `TeamCreate` to create the team  
2. `Task` with `team_name` and `name` parameters to spawn each agent  
NEVER use `Task` with `run_in_background: true` for spawning agents — that creates isolated background subprocesses without tmux panes or navigation.

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