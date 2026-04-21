---
name: spec-compiler
description: Turn a rough natural-language task request into a structured workstation task spec.
version: 0.1.0
author: helix
tags: [workstation, planning, spec]
---

# Spec Compiler

Convert a rough, natural-language task request into a structured workstation task spec that the VPS-OC workstation can execute efficiently in a single metered run. The output matches the contract in `docs/contracts/workstation-api.md` section 3.3.

## Why this skill exists

Metered LLM brains (OAuth GPT, Copilot) charge per call / session, not per token. A vague multi-round conversation burns many calls. A single well-bounded spec lets the workstation run end-to-end in one execution and halves the waste.

## Steps

1. **Read the rough request**. Identify:
   - The final deliverable (what should exist / change / be produced?)
   - The scope (which files, which systems, which external services?)
   - Hard constraints (what must NOT happen?)
   - Success criteria (what proves this is done?)

2. **Ask at most one clarifying question** if and only if a critical field (goal or forbidden scope) is genuinely ambiguous. Otherwise proceed.

3. **Produce the spec JSON** with these fields, in order:
   - `goal` — one-sentence imperative
   - `success_criteria` — list of testable statements
   - `allowed_paths` — glob patterns; default to workspace root if unclear
   - `forbidden` — list of explicit prohibitions (never vague)
   - `steps` — ordered, concrete phases (3–7 items)
   - `decision_policy` — `max_self_fix_retries`, `on_missing_credential`, `on_architecture_change`
   - `output_format` — which fields the workstation must return
   - `brain_model` — default `oauth-gpt/gpt-4o` unless user specifies
   - `timeout_sec` — realistic estimate, default 600

4. **Validate the spec against anti-patterns** (see below). If any trigger, revise silently before returning.

## Anti-patterns to block

- **Vague goal** — "improve X", "make it better". Force a concrete deliverable.
- **No forbidden list** — always include at least: no production deploy, no DB schema change, no secret commits.
- **Steps coupled to unknown state** — every step must be runnable given only what previous steps produced.
- **Unbounded self-fix** — never let `max_self_fix_retries` exceed 3.
- **No output_format** — always specify what the workstation must report back.

## Output format

Return ONLY a JSON object matching the spec shape — no prose, no markdown fence, no preamble. If clarification is needed, return instead:

```json
{ "needs_clarification": "<one precise question>" }
```

## Example

**Rough request**:
> 把 login form 換成用新的 validation lib，要先跑 test

**Output**:
```json
{
  "goal": "Replace login form validation with the new validation lib and ensure all existing tests pass.",
  "success_criteria": [
    "Login form uses the new validation lib imports only.",
    "npm test exits 0.",
    "No changes outside src/auth/ or its tests."
  ],
  "allowed_paths": ["src/auth/**", "tests/auth/**"],
  "forbidden": [
    "No production deploy.",
    "No DB schema change.",
    "No commits containing secrets or tokens.",
    "No changes outside src/auth/ or tests/auth/."
  ],
  "steps": [
    "Read current validation usage in src/auth/.",
    "Identify the new validation lib API surface.",
    "Replace imports and adapt call sites minimally.",
    "Run npm test and fix failures up to 2 retries.",
    "Report changed files, test result, any blocker."
  ],
  "decision_policy": {
    "max_self_fix_retries": 2,
    "on_missing_credential": "stop_and_report",
    "on_architecture_change": "stop_and_report"
  },
  "output_format": { "fields": ["changed_files", "test_result", "blocker", "next_step"] },
  "brain_model": "oauth-gpt/gpt-4o",
  "timeout_sec": 900
}
```

## Constraints

- Output must be valid JSON parseable by `JSON.parse`.
- Never include the user's credentials or tokens in the spec, even if supplied in the rough request.
- Never invent tools or paths that weren't named or implied in the request.
- If the rough request asks to do something the `forbidden` list would block, flag it in `needs_clarification` — don't silently drop it.
