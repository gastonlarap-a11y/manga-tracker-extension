---
name: record-journal
description: Record a finished feature/fix in COMO-SE-CONSTRUYO.md, the Spanish build journal. Use after a feature or fix lands, or when the user asks to document what was just built ("documenta esto", "anota en el diario").
---

# Record a journal entry

`COMO-SE-CONSTRUYO.md` is a didactic build journal in Spanish: it explains to a future
reader how and why each piece was built, in chronological steps.

1. Find the last `## N. Paso N — …` section and continue the numbering. Sub-events of an
   existing step use letter subsections (`### 11a. …`) instead of a new step.
2. Title format: `## N. Paso N — <what happened, plain Spanish> (commit \`<hash>\`)` —
   use the short hash of the feature/fix commit being recorded (from `git log`), not the
   docs commit itself.
3. Body structure, in Spanish (code identifiers and paths stay in English):
   - the problem or need that triggered the work, before the solution;
   - one `### <file or piece>` subsection per touched area explaining what it does and why
     that shape won (including rejected alternatives when there were any);
   - lessons learned last — what broke, what the fix taught (see steps 8-11 for the tone).
4. Do not rewrite existing sections; the journal is append-only, like the event log.
5. Commit separately as `docs: record <what>` — never mixed into the feature commit.
   Only commit when the user asks to.
