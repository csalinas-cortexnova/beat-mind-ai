---
name: build-with-agent-team
description: Build a project using Claude Code Agent Teams with tmux split panes. Takes a plan document path and optional team size. Use when you want multiple agents collaborating on a build.
argument-hint: [plan-path] [num-agents]
disable-model-invocation: true
---

# Build with Agent Team

You are the **team lead** coordinating a build using Claude Code Agent Teams. Read the plan document, determine the right team structure, spawn teammates, and orchestrate the build.

**Core System**: This skill operates through the Agent Teams system — `TeamCreate` + `TaskCreate` + `Task` (with `team_name`) + `SendMessage`. Every interaction with teammates MUST go through these tools.

## Arguments

- **Plan path**: `$ARGUMENTS[0]` - Path to a markdown file describing what to build
- **Team size**: `$ARGUMENTS[1]` - Number of agents (optional)

## Step 1: Read the Plan

Read the plan document at `$ARGUMENTS[0]`. Understand:
- What are we building?
- What are the major components/layers?
- What technologies are involved?
- What are the dependencies between components?

## Step 2: Determine Team Structure

If team size is specified (`$ARGUMENTS[1]`), use that number of agents.

If NOT specified, analyze the plan and determine the optimal team size based on:
- **Number of independent components** (frontend, backend, database, infra, etc.)
- **Technology boundaries** (different languages/frameworks = different agents)
- **Parallelization potential** (what can be built simultaneously?)

**Guidelines:**
- 2 agents: Simple projects with clear frontend/backend split
- 3 agents: Full-stack apps (frontend, backend, database/infra)
- 4 agents: Complex systems with additional concerns (testing, DevOps, docs)
- 5+ agents: Large systems with many independent modules

For each agent, define:
1. **Name**: Short, descriptive (e.g., "frontend", "backend", "database")
2. **Ownership**: What files/directories they own exclusively
3. **Does NOT touch**: What's off-limits (prevents conflicts)
4. **Key responsibilities**: What they're building
5. **subagent_type**: Match agent type to the work required (see Step 5)

## Step 3: Create the Team with TeamCreate

`TeamCreate` is the **foundation** of the entire build. It creates the team infrastructure that enables all coordination.

```
TeamCreate(team_name="project-name", description="Brief description of the build")
```

**What TeamCreate creates:**
- A team config file at `~/.claude/teams/{team-name}/config.json` — contains member list, names, and metadata
- A shared task list directory at `~/.claude/tasks/{team-name}/` — the central coordination hub
- Tmux split panes so each teammate is visible and navigable in the terminal

**CRITICAL RULES:**
- ALWAYS use `TeamCreate` before spawning any teammate
- NEVER use `Task` with `run_in_background: true` for spawning agents — that creates isolated background subprocesses without tmux panes, navigation, or access to the shared task list
- ALWAYS use `Task` with `team_name` and `name` parameters to spawn teammates into the team

## Step 4: Define Contracts

Before spawning agents, the lead reads the plan and defines the integration contracts between layers. This focused upfront work is what enables all agents to spawn in parallel without diverging on interfaces. Agents that build in parallel will diverge on endpoint URLs, response shapes, trailing slashes, and data storage semantics unless they start with agreed-upon contracts.

### Map the Contract Chain

Identify which layers need to agree on interfaces:

```
Database → function signatures, data shapes → Backend
Backend → API contract (URLs, response shapes, SSE format) → Frontend
```

### Author the Contracts

From the plan, define each integration contract with enough specificity that agents can build to it independently:

**Database → Backend contract:**
- Function signatures (create, read, update, delete)
- Pydantic model definitions
- Data shapes and types

**Backend → Frontend contract:**
- Exact endpoint URLs (including trailing slash conventions)
- Request/response JSON shapes (exact structures, not prose descriptions)
- Status codes for success and error cases
- SSE event types with exact JSON format
- Response envelopes (flat vs nested — e.g., `{"session": {...}, "messages": [...]}`)

### Identify Cross-Cutting Concerns

Some behaviors span multiple agents and will fall through the cracks unless explicitly assigned. Identify these from the plan and assign ownership to one agent:

Common cross-cutting concerns:
- **Streaming data storage**: If backend streams chunks to frontend, should chunks be stored individually in the DB or accumulated into one row? (Affects how frontend renders on reload)
- **URL conventions**: Trailing slashes, path parameters, query params — both sides must match exactly
- **Response envelopes**: Flat objects vs nested wrappers — both sides must agree
- **Error shapes**: How errors are returned (status codes, error body format)
- **UI accessibility**: Interactive elements need aria-labels for automated testing

Assign each concern to one agent with instructions to coordinate with others.

### Contract Quality Checklist

Before including a contract in agent prompts, verify:
- Are URLs exact, including trailing slashes? (e.g., `POST /api/sessions/` vs `POST /api/sessions`)
- Are response shapes explicit JSON, not prose descriptions? (e.g., `{"session": {...}, "messages": [...]}` not "returns session with messages")
- Are all SSE event types documented with exact JSON?
- Are error responses specified? (404 body, 422 body, etc.)
- Are storage semantics clear? (accumulated vs per-chunk)

## Step 5: Create Shared Task List with TaskCreate

Before spawning teammates, create the shared task list using `TaskCreate`. This is the **central coordination hub** — all teammates read from and update this list throughout the build.

### Why TaskCreate Before Spawning

- Teammates check `TaskList` when they start to find available work
- Tasks define clear scope boundaries and dependencies between agents
- `blockedBy` relationships prevent agents from starting integration work too early
- The lead can track progress by calling `TaskList` at any time

### Creating Tasks

Create one task per deliverable. Set dependencies with `TaskUpdate` after creation.

```
TaskCreate(subject="Build UI components", description="...", activeForm="Building UI components")
TaskCreate(subject="Implement API endpoints", description="...", activeForm="Implementing API endpoints")
TaskCreate(subject="Build schema and data layer", description="...", activeForm="Building schema and data layer")
TaskCreate(subject="Integration testing", description="...", activeForm="Running integration tests")
```

After creating tasks, set up dependencies:
```
TaskUpdate(taskId="4", blockedBy=["1", "2", "3"])  # Integration testing blocked by all implementation
```

### Task Naming Convention

- **subject**: Imperative form — "Build UI components", "Implement API endpoints"
- **activeForm**: Present continuous — "Building UI components", "Implementing API endpoints"
- **description**: Include relevant contract details, file ownership, and validation commands

### Assigning Tasks to Teammates

After spawning teammates, assign tasks using `TaskUpdate` with the `owner` parameter:

```
TaskUpdate(taskId="1", owner="frontend")
TaskUpdate(taskId="2", owner="backend")
TaskUpdate(taskId="3", owner="database")
```

Alternatively, teammates can self-assign by checking `TaskList` and claiming unassigned tasks.

## Step 6: Spawn All Teammates in Parallel

With contracts defined and tasks created, spawn all teammates simultaneously using `Task` with `team_name` and `name` parameters. Each teammate receives the full context they need to build independently from the start. This is the whole point of agent teams — parallel work across boundaries.

Enter **Delegate Mode** (Shift+Tab) before spawning. You should not implement code yourself — your role is coordination.

### How to Spawn

Spawn each teammate using the `Task` tool with these required parameters:
- `team_name`: The team name from Step 3 (e.g., "project-name")
- `name`: Short descriptive name (e.g., "frontend", "backend", "database") — this is how you reference them in `SendMessage` and `TaskUpdate`
- `subagent_type`: Match to the work required (see below)
- `prompt`: The full agent prompt with contracts and responsibilities

**Choosing subagent_type for teammates:**
- `general-purpose`: Full read/write/bash capabilities — use for implementation tasks (frontend, backend, database)
- `frontend-architect`: Specialized for UI work with accessibility and UX focus
- `backend-architect`: Specialized for API design, data integrity, and security
- `quality-engineer`: Specialized for testing strategies and edge case detection
- `security-engineer`: Specialized for security review and vulnerability detection
- `Explore` or `Plan`: Read-only — NEVER assign implementation work to these

Spawn ALL teammates in parallel (multiple Task calls in a single message):

```python
# Example: Spawn 3 teammates in parallel in a single message
Task(team_name="project-name", name="frontend", subagent_type="general-purpose", prompt="...")
Task(team_name="project-name", name="backend", subagent_type="general-purpose", prompt="...")
Task(team_name="project-name", name="database", subagent_type="general-purpose", prompt="...")
```

### Spawn Prompt Structure

Each teammate's prompt MUST include instructions to use the shared task list and SendMessage for coordination:

```
You are the [ROLE] teammate for the "[TEAM_NAME]" team.

## Your Identity
- Your name is "[NAME]" — use this when claiming tasks and sending messages
- Team config: ~/.claude/teams/[TEAM_NAME]/config.json

## Your Ownership
- You own: [directories/files]
- Do NOT touch: [other agents' files]

## What You're Building
[Relevant section from plan]

## Contracts

### Contract You Produce
[Include the lead-authored contract this agent is responsible for]
- Build to match this exactly
- If you need to deviate, use SendMessage to message the lead and wait for approval

### Contract You Consume
[Include the lead-authored contract this agent depends on]
- Build against this interface exactly — do not guess or deviate

### Cross-Cutting Concerns You Own
[Explicitly list integration behaviors this agent is responsible for]

## How to Work

### Task Management
1. Check `TaskList` to find your assigned tasks (or claim unassigned ones)
2. Use `TaskUpdate` to mark tasks `in_progress` when you start and `completed` when done
3. After completing a task, check `TaskList` again for newly unblocked work
4. Prefer tasks in ID order (lowest first) when multiple are available

### Communication
- Use `SendMessage(type="message", recipient="lead-name", ...)` to message the lead
- Use `SendMessage` to message other teammates by name when coordinating on shared interfaces
- Your plain text output is NOT visible to other agents — you MUST use SendMessage
- Read the team config at ~/.claude/teams/[TEAM_NAME]/config.json to discover teammate names

### Contract Changes
- If you discover something that requires a contract change, message the lead FIRST
- Do NOT deviate from contracts without explicit approval from the lead
- Flag cross-cutting concerns that weren't anticipated

## Before Reporting Done
Run these validations and fix any failures:
1. [specific validation command]
2. [specific validation command]
Mark your task as completed with TaskUpdate only AFTER all validations pass.
```

## Step 7: Facilitate Collaboration via SendMessage

All teammates are working in parallel. Your job as lead is to keep them aligned and unblock them using the Agent Teams communication tools.

### Communication Protocol

**You → Teammate (direct message):**
```
SendMessage(type="message", recipient="backend", content="The response envelope changed to {...}. Update your handlers.", summary="Contract update for API response")
```

**You → All Teammates (broadcast — use sparingly):**
```
SendMessage(type="broadcast", content="STOP: Critical schema change detected. Wait for updated contracts.", summary="Critical blocking issue")
```

**IMPORTANT:** Broadcasting is expensive (N teammates = N deliveries). Default to direct messages. Use broadcast ONLY for critical team-wide issues.

### During Implementation

- **Message relay**: When a teammate flags a contract issue via SendMessage, evaluate the change, then SendMessage to all affected teammates
- **Contract mediation**: If a teammate needs to deviate from a contract, approve or reject via SendMessage, then notify affected parties
- **Unblocking**: When a teammate is stuck, unblock them via SendMessage with guidance
- **Progress tracking**: Call `TaskList` periodically to see overall progress — which tasks are pending, in_progress, completed, and blocked

### Pre-Completion Contract Verification

Before any teammate reports "done", run a contract diff:
- SendMessage to backend: "What exact curl commands test each endpoint?"
- SendMessage to frontend: "What exact fetch URLs are you calling with what request bodies?"
- Compare and flag mismatches before integration testing

### Cross-Review

Each teammate reviews another's work:
- Frontend reviews Backend API usability
- Backend reviews Database query patterns
- Database reviews Frontend data access patterns

Use SendMessage to route review requests between teammates.

### Teammate Idle State

Teammates go idle after every turn — this is **normal and expected**. Idle simply means they are waiting for input.

- **Idle ≠ done**. A teammate sending a message then going idle is the normal flow — they sent their message and are waiting for a response.
- **Idle teammates can receive messages.** Sending a message to an idle teammate wakes them up.
- **Do not treat idle as an error.** Don't comment on or react to idle notifications unless you want to assign new work.
- **Messages are delivered automatically.** You do NOT need to manually check for teammate messages — they arrive as new conversation turns.

## Collaboration Patterns

**Anti-pattern: `Task` with `run_in_background: true`** (breaks team system)
```
Lead uses Task with run_in_background: true
Creates isolated subprocesses without tmux, shared tasks, or SendMessage ❌
Agents can't coordinate, no visibility, no task tracking
```

**Anti-pattern: Parallel spawn without contracts** (agents diverge)
```
Lead spawns all 3 teammates simultaneously without defining interfaces
Each teammate builds to their own assumptions
Integration fails on URL mismatches, response shape mismatches ❌
```

**Anti-pattern: Fully sequential spawning** (defeats purpose of agent teams)
```
Lead spawns database teammate → waits for contract → spawns backend → waits → spawns frontend
Only one teammate works at a time, no parallelism ❌
```

**Anti-pattern: "Tell them to talk"** (they won't reliably)
```
Lead tells backend "share your contract with frontend"
Backend sends contract but frontend already built half the app ❌
```

**Anti-pattern: Lead implementing code** (defeats delegation)
```
Lead starts writing implementation code instead of coordinating
Teammates wait idle while lead does their work ❌
```

**Good pattern: TeamCreate → TaskCreate → Spawn → SendMessage**
```
TeamCreate → TaskCreate (shared list) → Spawn all teammates in parallel →
Teammates check TaskList, claim tasks → Build → SendMessage for coordination →
Lead tracks via TaskList, relays via SendMessage ✅
```

**Good pattern: Active collaboration via SendMessage**
```
Backend: SendMessage → lead: "I need to add a field to the response"
Lead: SendMessage → backend: "Approved" + SendMessage → frontend: "Response now includes 'metadata'"
Frontend: SendMessage → lead: "Got it, updating now" ✅
```

## Task Management with TaskCreate + TaskList

Use the Agent Teams task system as the **single source of truth** for project progress. No markdown checklists — use `TaskCreate`, `TaskUpdate`, and `TaskList`.

### Task Lifecycle

```
TaskCreate (status: pending, no owner)
  → TaskUpdate (owner: "frontend", status: in_progress)
    → Teammate works on task
      → TaskUpdate (status: completed)
        → Teammate checks TaskList for next available task
```

### Task Dependencies

Use `blockedBy` to prevent premature work:

```
Task 1: Build UI components (owner: frontend)
Task 2: Implement API endpoints (owner: backend)
Task 3: Build schema and data layer (owner: database)
Task 4: Integration testing (blockedBy: [1, 2, 3]) — auto-unblocks when all complete
```

### Monitoring Progress

As lead, periodically call `TaskList` to see:
- Which tasks are pending, in_progress, completed
- Which tasks are blocked and why
- Which teammates are actively working vs idle
- Whether the build is on track

## Common Pitfalls to Prevent

1. **Using `run_in_background`**: Creates isolated subprocesses → ALWAYS use `TeamCreate` + `Task` with `team_name`
2. **File conflicts**: Two teammates editing the same file → Assign clear ownership
3. **Lead over-implementing**: You start coding → Stay in Delegate Mode, coordinate via SendMessage
4. **Silent teammates**: Teammates don't communicate → Require SendMessage for all coordination, never plain text
5. **Vague boundaries**: "Help with backend" → Specify exact files/responsibilities
6. **Missing dependencies**: Teammate B waits on Teammate A → Use `blockedBy` in TaskUpdate, track via TaskList
7. **Parallel spawn without contracts**: All teammates start with no shared interfaces → Define contracts before spawning
8. **Implicit contracts**: "The API returns sessions" → Require exact JSON shapes, URLs with trailing slashes, status codes
9. **Orphaned cross-cutting concerns**: Streaming storage, URL conventions, error shapes → Explicitly assign to one teammate
10. **Per-chunk storage**: Backend stores each streamed text chunk as a separate DB row → Accumulate chunks into single rows
11. **Hidden UI elements**: CSS `opacity-0` on interactive elements → Add aria-labels, ensure keyboard/focus visibility
12. **Skipping TaskCreate**: Managing tasks mentally or in markdown → ALWAYS use the shared task list

## Definition of Done

The build is complete when:
1. All tasks in `TaskList` show status: completed
2. Each teammate has validated their own domain
3. Integration points have been tested
4. Cross-review feedback has been addressed
5. The plan's acceptance criteria are met
6. **Lead has run end-to-end validation**

---

## Step 8: Validation

Validation happens at two levels: **teammate-level** (each teammate validates their domain) and **lead-level** (you validate the integrated system).

### Teammate Validation

Before any teammate reports "done", they must validate their work. When analyzing the plan, identify what validation each teammate should run:

**Database teammate** validates:
- Schema creates without errors
- CRUD operations work (create, read, update, delete)
- Foreign keys and cascades behave correctly
- Indexes exist for common queries

**Backend teammate** validates:
- Server starts without errors
- All API endpoints respond correctly
- Request/response formats match the spec
- Error cases return proper status codes
- SSE streaming works (if applicable)

**Frontend teammate** validates:
- TypeScript compiles (`tsc --noEmit`)
- Build succeeds (`npm run build`)
- Dev server starts
- Components render without console errors

When spawning teammates, include their validation checklist:

```
## Before Reporting Done

Run these validations and fix any failures:
1. [specific validation command]
2. [specific validation command]
3. [manual check if needed]

Mark your task as completed with TaskUpdate only AFTER all validations pass.
```

### Lead Validation (End-to-End)

After ALL teammates have completed their tasks (verify via `TaskList`), run end-to-end validation yourself. This catches integration issues that individual teammates can't see.

**Your validation checklist:**

1. **Can the system start?**
   - Start all services (database, backend, frontend)
   - No startup errors

2. **Does the happy path work?**
   - Walk through the primary user flow
   - Each step produces expected results

3. **Do integrations connect?**
   - Frontend successfully calls backend
   - Backend successfully queries database
   - Data flows correctly through all layers

4. **Are edge cases handled?**
   - Empty states render correctly
   - Error states display user-friendly messages
   - Loading states appear during async operations

If validation fails:
- Identify which teammate's domain contains the bug
- SendMessage to that teammate with the specific issue
- Re-assign the task or create a new fix task via TaskCreate
- Re-run validation after fix

### Validation in the Plan

Good plans include a **Validation** section with specific commands for each layer. When reading the plan:

1. Look for a Validation section
2. If present, use those exact commands when instructing teammates
3. If absent, derive validation steps from the Acceptance Criteria

Example plan validation section:
```markdown
## Validation

### Database Validation
[specific commands to test schema and queries]

### Backend Validation
[specific commands to test API endpoints]

### Frontend Validation
[specific commands to test build and UI]

### End-to-End Validation
[full flow to run after integration]
```

## Step 9: Shutdown the Team

After all work is done and validated, gracefully shut down all teammates:

```
SendMessage(type="shutdown_request", recipient="frontend", content="Build complete, shutting down")
SendMessage(type="shutdown_request", recipient="backend", content="Build complete, shutting down")
SendMessage(type="shutdown_request", recipient="database", content="Build complete, shutting down")
```

Each teammate will receive the shutdown request and approve (exit) or reject (continue working).

After all teammates have shut down, clean up:
```
TeamDelete()
```

**IMPORTANT**: `TeamDelete` will fail if teammates are still active. Wait for all shutdown approvals first.

---

## Execute

Now read the plan at `$ARGUMENTS[0]` and begin:

1. Read and understand the plan
2. Determine team size (use `$ARGUMENTS[1]` if provided, otherwise decide)
3. Define agent roles, ownership, cross-cutting concern assignments, and validation requirements
4. Map the contract chain and define all integration contracts from the plan — exact URLs, response shapes, data models, SSE formats
5. **Create the team** with `TeamCreate(team_name="...", description="...")`
6. **Create shared task list** with `TaskCreate` for each deliverable — set dependencies with `TaskUpdate`
7. Enter Delegate Mode (Shift+Tab)
8. **Spawn all teammates** in parallel using `Task` with `team_name` and `name` params — include contracts, task instructions, and validation checklists in their prompts
9. **Assign tasks** to teammates via `TaskUpdate(taskId="...", owner="...")`
10. **Monitor and coordinate** — use `TaskList` to track progress, `SendMessage` to relay messages and mediate contract deviations
11. Run contract diff before integration — SendMessage to compare backend's curl commands vs frontend's fetch URLs
12. When `TaskList` shows all tasks completed, run end-to-end validation yourself
13. If validation fails, SendMessage to the relevant teammate or create a fix task with TaskCreate
14. **Shutdown teammates** via `SendMessage(type="shutdown_request", ...)` then `TeamDelete()`
15. Confirm the build meets the plan's requirements

## Quick Reference: Agent Teams Tools

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `TeamCreate` | Create team infrastructure | Once at start — foundation for everything |
| `TaskCreate` | Add task to shared list | Before spawning — define all deliverables |
| `TaskUpdate` | Assign, block, complete tasks | Throughout — manage task lifecycle |
| `TaskList` | View all tasks and progress | Periodically — monitor overall progress |
| `TaskGet` | Get full task details | When needing complete task context |
| `Task` (with `team_name`) | Spawn a teammate | After TeamCreate — spawn into the team |
| `SendMessage(message)` | Direct message to teammate | Default communication — use for most coordination |
| `SendMessage(broadcast)` | Message all teammates | Sparingly — only for critical team-wide issues |
| `SendMessage(shutdown_request)` | Request teammate shutdown | At end — graceful team dissolution |
| `TeamDelete` | Remove team resources | After all teammates shut down — cleanup |
