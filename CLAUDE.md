# Pockets

Chrome extension. Design: `docs/superpowers/specs/`. Plan: `docs/superpowers/plans/`.

## Model routing

Route by risk and reasoning difficulty, not task length. Trivial tasks: do them
directly, no plan, no subagents.

| Work | Agent | Model |
|---|---|---|
| Find files, summarise logs or output | `scout` | Haiku |
| Bounded work with clear acceptance criteria: routine refactors, straightforward tests, docs | `implementer` | Sonnet |
| Complex implementation, hard debugging, cross-cutting or sensitive changes | `senior-implementer` | Opus |
| Review of any substantive change | `reviewer` | Opus |

The lead handles ambiguous requirements, architecture and coordination itself.
Never give `scout` design decisions or code review. If a review turns on an
unresolved architectural question, the lead decides it, not the reviewer.

## Delegating

Every implementation brief states: objective and context, the files or area
owned, constraints and interfaces to preserve, acceptance criteria, validation
commands, and the definition of done. Run workers in parallel only when their
work is independent and their files do not overlap; sequence dependent tasks.

## Escalation

A worker stops and reports, without widening scope or retrying the same
approach, on: material ambiguity, two failed attempts, impact outside its
assigned area, or a needed architecture change. The report gives findings,
approaches tried, test results and the specific blocker. The lead then
re-briefs, moves the task up a tier, or decides the question.

## Verification

The lead integrates and checks the combined result against the requirements,
not the worker's summary. Run the tests, lint and type checks that exist. Report
what was verified, what was assumed, and what could not be run. A worker saying
"done" is not evidence.
