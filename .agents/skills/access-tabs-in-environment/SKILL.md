---
name: access-tabs-in-environment
description: 'Access and use content from currently open VS Code tabs in this workspace. Use for open tabs, open editors, active files, compare tabs, summarize tabs, review open files, or apply changes across currently opened files.'
argument-hint: 'What should be done with the open tabs (summarize, compare, review, edit, refactor)?'
---

# Access Tabs In Environment

Use this skill when the user asks to work with currently open tabs or open editors in this environment.

## What This Skill Produces
- A reliable workflow to identify the open-tab set for the current request.
- A normalized file list (workspace paths) and any tabs that cannot be resolved.
- The requested output (summary, diff, review, edits, extraction) scoped to those tabs.

## When To Use
- "Use my open tabs"
- "Compare what I have open"
- "Summarize all open files"
- "Apply this change to currently open editors"
- "Review the tabs I have open"

## Procedure
1. Detect tab context from the conversation and environment.
2. Build a candidate tab list from explicit user input first (attachments, listed files, active file mentions).
3. If no tab list is available, ask for a tab list or ask the user to confirm the intended files.
4. Resolve each candidate to a workspace path and verify existence.
5. For read-only requests, read only the needed file ranges, then execute the requested task.
6. For edit requests, present the edit scope and ask for confirmation before making changes.
7. Offer an "approve all edits for this request" option to suppress repeated confirmations within the same request.
8. Report results per tab and clearly mark missing or unresolved tabs.

## Decision Points
- If tabs are explicitly listed by the user: trust that list as the source of truth.
- If tabs are only implied: propose a detected list and ask for confirmation before broad edits.
- If a tab points outside the workspace or cannot be found: continue with resolvable tabs and report skips.
- If the request is read-only (summarize/review): proceed once tab scope is known.
- If the request includes edits: always require confirmation before any modification.
- If the user selects "approve all edits for this request": apply all queued tab-scoped edits without re-prompting, but only for the current request.

## Quality Checks
- Every claimed tab appears in the resolved list or unresolved list.
- No file outside the confirmed tab scope is edited.
- No modification is applied without explicit confirmation unless the user approved all edits for the current request.
- Output is grouped by file and references concrete file locations when relevant.
- Any assumptions are stated explicitly.

## Completion Checklist
- Confirmed tab scope
- Resolved paths validated
- Requested operation completed
- Unresolved tabs reported
- Final response includes a concise per-file outcome

## Example Prompts
- "/access-tabs-in-environment summarize my open tabs and highlight risky code"
- "/access-tabs-in-environment compare the open tabs and list duplicated logic"
- "/access-tabs-in-environment apply the same import cleanup to all open editors"
- "/access-tabs-in-environment apply this rename to open tabs; approve all edits for this request"