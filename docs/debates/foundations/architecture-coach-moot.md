# Moot: The Technical Architecture Coach

This is a fictionalized workshop transcript. The named participants are used as
design lenses, not as sources of real quotes or actual positions.

## Motion

This workshop considers the motion:

> Agentic software development needs a technical architecture coach that
> intervenes at key moments to ensure the right structures are in place at the
> right time.

The tension is familiar:

- Too much structure too early becomes drag.
- Too little structure for too long becomes a pile of hacks.
- Pragmatists say: build what is needed and no more.
- Strategists say: choose structure based on planning horizon, reversibility,
  and solution visibility.

The question is how to augment a capable coding agent so that it can detect
when a codebase is becoming load-bearing, then call on a coach, strategist, or
MCP server to provide timely architectural signposts.

## Participants

- **Moderator**: frames the workshop and extracts decisions.
- **John Carmack lens**: simplicity, evidence, performance, avoiding ceremony.
- **Grady Booch lens**: significant decisions, architecture as memory, system
  structure, reversibility.
- **Andrej Karpathy lens**: agent loops, tool-mediated reflection, learned
  heuristics, scalable critic systems.

## Round 1: What Problem Are We Solving?

**Moderator:** The user says, "create a thing." The agent creates it. Then the
user asks for more features. At some point, the original structure is no longer
fit for purpose. How should a supporting coach detect that point?

**Carmack:** The coach should start from the code, not from architecture
fashion. If it cannot point to evidence, it should not interrupt. I want it to
say things like: this feature touched seven files that have no clean boundary,
state is duplicated in three components, and the next requested behavior will
make that worse. That is useful. "You need a service layer" is not useful by
itself.

**Booch:** Architecture is the set of significant decisions about a system:
things that are hard to change later, things that shape the system's evolution.
The coach should recognize when such a decision is being made implicitly. A
file used as temporary storage is an implementation detail. A file used as a
durable project store is an architectural decision.

**Karpathy:** The base coding agent is optimized for execution. The missing
piece is not more intelligence in every token. It is a reflective loop. At
interesting moments, the agent calls a critic: "Does this change imply the
system is crossing a threshold?" MCP is a plausible shape because it gives the
coach stable tools, memory, and a clean interface.

**Moderator:** So the coach is not a permanent planner?

**Carmack:** It should not be. A constant planner becomes friction. Most early
software should be allowed to be crude. You learn by building. The danger is
letting crude code silently become foundation code.

**Booch:** I agree with the distinction. The coach is not there to prevent
experimentation. It is there to notice when exploratory choices are becoming
load-bearing choices.

**Karpathy:** The agent needs a notion of phase change. Prototype code is fine.
Production-shaped code needs different constraints. The interesting part is
detecting that transition from the conversation, the diff, and the repo.

**Moderator:** What does "load-bearing" mean here?

**Booch:** A part of the system is load-bearing when other future choices depend
on it. A data model becomes load-bearing when multiple features read and write
it. An API becomes load-bearing when external clients depend on it. A UI
component becomes load-bearing when it encodes business behavior rather than
presentation.

**Carmack:** It is also load-bearing when touching it becomes scary. If a small
feature requires edits across unrelated files, the structure is not carrying
the work. If the agent avoids making a direct change because the consequences
are unclear, that is a signal.

**Karpathy:** From the agent perspective, load-bearing areas show up as repeated
attention. The same modules keep appearing in diffs. The same assumptions keep
being restated. The same logic gets copied. The coach can track this.

**Moderator:** What would the first version of the coach do?

**Carmack:** It would detect a few concrete smells:

- Repeated logic in adjacent features.
- State distributed across components without a clear owner.
- Persistence added without a data model.
- User-facing behavior added without tests.
- Security-sensitive behavior added without review.
- A small request causing a large scattered diff.

**Booch:** It would also maintain architectural memory:

- We chose local files because this was single-user and local.
- We deferred auth because there were no external users.
- We kept state in the page because there was only one workflow.
- Revisit if sharing, sync, permissions, or deployment appears.

**Karpathy:** That memory is important. Without it, every decision looks fresh.
The coach should not just inspect the current diff. It should remember the
conditions under which earlier simplifications were acceptable.

**Moderator:** Round 1 summary?

**Booch:** The coach exists to detect when an implementation choice has become
an architectural decision.

**Carmack:** It must justify interruptions with evidence.

**Karpathy:** It should operate as a sparse critic loop, not as a constant
co-author.

## Round 2: How Should The Coach Work?

**Moderator:** Let us design the mechanism. Is this an MCP server, a prompt
policy, a repo scanner, or something else?

**Karpathy:** I would start with an MCP server because it gives us explicit
tools. The coding agent should call the coach at known points. The coach can
read diffs, repo structure, recent requests, test posture, and prior
architecture decisions. The interface matters because it turns vague judgment
into repeatable calls.

**Carmack:** The tool must be cheap enough that the agent actually uses it. If
every call produces a long design essay, people will ignore it. I want a small
answer: proceed, pause, restructure, test, or review.

**Booch:** The output should include the type of architectural moment. For
example: persistence threshold, identity threshold, distribution threshold,
collaboration threshold, public API threshold, operational threshold.

**Moderator:** What are the candidate MCP tools?

**Karpathy:** Minimal tool set:

```text
architecture.assess_change
architecture.horizon_scan
architecture.review_structure
architecture.record_decision
architecture.check_revisit_triggers
```

**Carmack:** `assess_change` is the critical path. It takes the user's request,
the current diff, recent related requests, and maybe repo metrics. It returns
whether architecture attention is warranted.

**Booch:** `record_decision` is the memory. It records the decision, the reason,
the alternatives, and the revisit condition.

**Moderator:** Let us define `assess_change`.

**Karpathy:** Input:

```json
{
  "user_request": "Add saved projects",
  "recent_requests": [
    "Create a project editor",
    "Add autosave draft state"
  ],
  "changed_files": [
    "src/pages/Editor.tsx",
    "src/components/ProjectPanel.tsx"
  ],
  "diff_summary": "Adds localStorage persistence for projects",
  "repo_signals": {
    "test_coverage": "low",
    "persistence": "localStorage",
    "auth": "none",
    "deployment": "none"
  },
  "architecture_memory": [
    {
      "decision": "Keep project state inside the editor page",
      "reason": "Only one workflow exists",
      "revisit_if": ["multiple project workflows", "sharing", "sync"]
    }
  ]
}
```

Output:

```json
{
  "intervention": "signpost",
  "confidence": "high",
  "threshold": "persistence",
  "risk": "Project data is becoming durable without a data model boundary.",
  "recommendation": "Introduce a Project model and persistence boundary before adding more project features.",
  "do_not_add": "Do not introduce full multi-user infrastructure unless sharing or sync is requested.",
  "suggested_next_steps": [
    "Create a project repository module",
    "Move localStorage access out of React components",
    "Add tests for create/load/update/delete"
  ]
}
```

**Carmack:** The `do_not_add` field is essential. The coach must protect
against overengineering, not only underengineering.

**Booch:** Yes. Architecture coaching should be a bidirectional constraint. It
should say: this much structure is warranted, and that much is premature.

**Moderator:** What are the levels of intervention?

**Booch:** I would define four:

```text
silent
  No architectural issue. Continue.

note
  Mild signpost. Mention a future pressure but do not change the plan.

recommend
  Architecture work should happen soon or as part of this change.

block
  The requested change is likely unsafe without an architectural decision first.
```

**Carmack:** I would be careful with "block." Blocking should be rare. Security,
data loss, irreversible public contracts, migrations, payments, permissions.
Most things should be recommendations.

**Karpathy:** The agent can treat these levels differently. `note` becomes a
short user-facing sentence. `recommend` becomes a pause with a concrete plan.
`block` asks the user to choose between options because implementation without
a decision would be irresponsible.

**Moderator:** What should trigger a call to the coach?

**Carmack:** Triggers should be concrete:

- The same file or concept is touched by three related requests.
- The feature touches UI, state, and persistence.
- The diff spans many unrelated directories.
- New auth, permissions, secrets, payments, or public networking appear.
- Tests fail or are absent around newly load-bearing behavior.
- The agent is about to introduce a second implementation of the same concept.

**Booch:** Also:

- A prototype assumption becomes false.
- A decision has low reversibility.
- A concept needs a stable name.
- A module boundary is being crossed repeatedly.

**Karpathy:** Conversation triggers matter too:

- "Let users share..."
- "Deploy this..."
- "Invite teammates..."
- "Make it real..."
- "Store this..."
- "Sync across devices..."
- "Charge users..."
- "Admin can..."
- "Public API..."

These are semantic signals that a product boundary is changing.

**Moderator:** What is the coach's core scoring model?

**Booch:** Four axes:

```text
complexity
  How many moving parts does the change involve?

irreversibility
  How expensive is this decision to undo?

solution visibility
  How clear is the correct design?

planning horizon
  How likely is this area to keep changing?
```

**Carmack:** The behavior follows from the axes:

```text
low complexity + high visibility
  Build directly.

low complexity + low visibility
  Keep simple and isolate assumptions.

high complexity + high visibility
  Add structure now.

high complexity + low visibility
  Add temporary structure, record assumptions, define revisit triggers.
```

**Karpathy:** The last case is common. The coach should recommend reversible
structure. For example, wrap storage behind an interface, but do not choose a
distributed event architecture.

**Moderator:** Round 2 summary?

**Karpathy:** MCP server with a small set of tools.

**Booch:** Memory plus thresholds.

**Carmack:** Evidence-based, short outputs, with explicit anti-overengineering
advice.

## Round 3: Stress Testing With Scenarios

### Scenario A: React Page State Becomes Shared Behavior

**Moderator:** The user first asks for a simple dashboard. The agent builds one
React page with local state. Then the user asks for filters, saved views, and a
second page that uses the same filter behavior.

**Carmack:** First page: no issue. Filters on one page: still probably fine.
When the second page needs the same behavior, duplication is near. The coach
should say: extract the stateful behavior, not necessarily a global state
system.

**Booch:** The concept has emerged: "view filters." It deserves a name and a
boundary. That might be a custom hook, a model object, or a small module.

**Karpathy:** The signpost could be:

```text
Signpost: repeated UI state behavior.
Confidence: medium-high.
Recommendation: extract filter state and query serialization into a custom hook
or utility before adding saved views. Do not introduce global state management
unless multiple distant surfaces need coordinated updates.
```

**Carmack:** That is the right scope. Custom hook, not a state framework.

### Scenario B: Files Become A Datastore

**Moderator:** The user asks for notes stored in local files. Later they ask
for search, tags, history, and sync.

**Booch:** The first file write may be an implementation detail. Search, tags,
history, and sync make it a data architecture issue.

**Carmack:** Files can still be fine. The coach should not reflexively demand a
database. But if the app needs query semantics, concurrency, or migration, the
agent should stop pretending plain files are free.

**Karpathy:** The coach should distinguish levels:

```text
Files are still acceptable if:
- single user
- local only
- small data volume
- simple load/save semantics

Consider SQLite or a database if:
- queries matter
- concurrent writes exist
- sync exists
- permissions exist
- migrations matter
- data loss would be serious
```

**Moderator:** User-facing signpost?

```text
Signpost: storage semantics are expanding.
The app is no longer only saving documents; it now needs query, history, and
possibly sync behavior. Keep files if this remains single-user and local, but
introduce a storage boundary now. If sync or collaboration is next, plan a
database-backed model before adding more file-level behavior.
```

**Carmack:** Good. The storage boundary is the cheap structure. Database choice
can wait until the requirement is real.

### Scenario C: Single-User Becomes Collaborative

**Moderator:** The user asks: "Let teammates share projects."

**Booch:** That is a phase change. The system now has identity, ownership,
authorization, and probably auditability. It should not be implemented as a
few flags in existing UI components.

**Carmack:** This is where I would allow the coach to be more forceful. Sharing
without an ownership model is how you get security problems.

**Karpathy:** The coach should call this a collaboration threshold:

```text
Intervention: recommend or block, depending on current system.
Threshold: single-user to multi-user.
Risk: ownership and permissions will be implicit if implemented directly.
Recommended decision: define identity, project ownership, role model, invite
flow, and data access boundary before coding the feature.
```

**Moderator:** Should it block?

**Carmack:** If the app is public or uses real user data, yes. If it is still a
mock prototype, recommend.

**Booch:** Blocking depends on consequence. The coach should know whether the
system handles real data.

### Scenario D: Prototype Auth Becomes Real Auth

**Moderator:** The app has a fake login for demos. The user says, "Make login
real."

**Carmack:** Security review. No debate.

**Booch:** Authentication is a significant architectural decision because it
affects identity, data access, sessions, deployment, and operational support.

**Karpathy:** The coach should give options, not just warnings:

```text
Option A: Use a managed auth provider.
  Best if speed and correctness matter.

Option B: Implement app-owned auth.
  Only if there is a specific reason and a security review/test plan.

Option C: Keep demo auth.
  Acceptable only if the app is not public and stores no real user data.
```

**Carmack:** Default to managed auth unless there is a strong reason not to.
Agents should not casually build password systems.

### Scenario E: "Deploy This To Others"

**Moderator:** The user says: "Can you deploy this so others can use it?"

**Booch:** Deployment turns local assumptions into operational assumptions.
Configuration, secrets, persistence, logging, backups, and access control all
become relevant.

**Carmack:** The coach should avoid turning every deployment into Kubernetes.
For a small app, a simple host may be enough. But it should check whether the
app has secrets, data, and public endpoints.

**Karpathy:** This is an operational threshold:

```text
Signpost: local to hosted.
Recommendation: before deployment, identify environment variables, secret
handling, persistence location, error logging, backup expectations, and basic
security headers. Use the simplest hosting target that satisfies these needs.
```

**Moderator:** The common pattern across scenarios?

**Booch:** The coach detects a threshold.

**Carmack:** It recommends the smallest structure that addresses the actual
risk.

**Karpathy:** It records the decision and watches for revisit triggers.

## Conclusions

The workshop supports the motion with constraints. Agentic development does
need a technical architecture coach, but the coach must be designed to avoid
architecture theater.

The coach should not be a universal upfront design phase. It should be a sparse
intervention system that appears when the codebase, diff, or conversation shows
that the solution is crossing a complexity threshold.

The most important concept is **load-bearing transition**. Early code can be
rough. Rough code becomes dangerous when future features, users, data, or
external systems begin depending on it.

The coach should have three responsibilities:

1. **Threshold detection**
   Detect moments when simple implementation choices are becoming significant
   architectural decisions.

2. **Architectural memory**
   Record decisions, assumptions, alternatives, and revisit conditions so the
   system can recognize when a once-valid simplification has expired.

3. **Right-sized signposting**
   Recommend the smallest structure that protects the next likely change, while
   explicitly warning against premature structure.

The coach should be evidence-driven. Its recommendations should cite concrete
signals such as repeated logic, scattered diffs, persistence changes, auth
changes, deployment exposure, missing tests, or violated revisit conditions.

## Recommendations

### Build The Coach As An MCP Server

Use an MCP server or equivalent tool boundary so the coding agent can call the
coach deliberately. The coach should not be embedded only as a vague prompt
instruction.

Minimal initial tools:

```text
architecture.assess_change
  Decide whether the current request or diff crosses an architecture threshold.

architecture.horizon_scan
  Look at recent requests and infer likely pressure points.

architecture.review_structure
  Inspect repo structure, changed files, duplication, and dependency signals.

architecture.record_decision
  Save a decision, rationale, alternatives, and revisit conditions.

architecture.check_revisit_triggers
  Compare current work against prior assumptions.
```

### Use Four Decision Axes

Every assessment should consider:

```text
complexity
irreversibility
solution visibility
planning horizon
```

Decision policy:

```text
Low complexity, high visibility:
  Build directly.

Low complexity, low visibility:
  Keep simple. Isolate assumptions.

High complexity, high visibility:
  Add structure now.

High complexity, low visibility:
  Add reversible structure. Record assumptions. Set revisit triggers.
```

### Define Intervention Levels

The coach should output one of:

```text
silent
  No user-facing advice.

note
  Mention a future pressure point without changing implementation.

recommend
  Suggest architectural work before or alongside the feature.

block
  Stop implementation until a decision is made because risk is high.
```

Blocking should be rare and reserved for high-consequence areas such as real
auth, permissions, payments, production data migrations, public APIs, or
security-sensitive deployment.

### Detect These Thresholds First

Start with a practical trigger taxonomy:

```text
repetition threshold
  The same behavior appears in multiple places.

state ownership threshold
  State moves from local UI detail to shared product behavior.

persistence threshold
  Data must survive, migrate, sync, or be queried.

identity threshold
  Users, sessions, roles, or account ownership appear.

collaboration threshold
  Single-user data becomes shared or permissioned.

public API threshold
  External callers depend on request/response contracts.

deployment threshold
  Local code becomes hosted software for other people.

operational threshold
  Logs, metrics, backups, alerts, or recovery become relevant.

security threshold
  Secrets, auth, permissions, payments, or private data appear.

blast-radius threshold
  A small feature requires broad, unrelated changes.
```

### Make Recommendations Bidirectional

Every meaningful recommendation should include both:

```text
Add this structure now.
Do not add this larger structure yet.
```

Example:

```text
Add a project persistence boundary now.
Do not add multi-tenant collaboration infrastructure until sharing is requested.
```

This is how the coach avoids both underengineering and overengineering.

### Preserve Architectural Memory

Record decisions in a compact form:

```json
{
  "decision": "Store draft project data in localStorage",
  "context": "Single-user prototype with no sharing or sync",
  "alternatives": ["SQLite", "server database", "file storage"],
  "reason": "Fastest reversible option for local-only prototype",
  "risks": ["No multi-device sync", "Weak migration story"],
  "revisit_if": ["sharing", "sync", "large project data", "user accounts"]
}
```

This lets the coach identify when the current request invalidates an earlier
assumption.

### Keep User-Facing Signposts Short

The user should see concise advice:

```text
Architecture signpost: collaboration threshold.
This feature turns projects from personal data into shared data. Before coding
sharing, define ownership, roles, invites, and the data access boundary. A full
enterprise permission system is premature; a simple owner/editor/viewer model
is enough if those roles match the product.
```

### First Prototype Goal

The first version of the coach should focus on timing, not perfect design. Its
success criterion is:

> The coach reliably notices when the next requested feature would make the
> current simple structure expensive, risky, or incoherent.

The coach is successful when it helps the agent say:

```text
We can keep moving, but this is the moment to name the concept, isolate the
state, add a boundary, or make the decision explicit.
```

The target is not maximum architecture. The target is architectural timing.

