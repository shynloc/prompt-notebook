# Adaptive Structured Prompt Optimizer Design

## Status

Accepted for implementation on 2026-08-10.

## Problem

Image prompts are not members of one flat taxonomy. Portrait and product describe subjects; poster, cover and infographic describe artifacts and communication goals; photography, illustration and 3D describe media; comics combine medium, narrative and sequence. A growing category-specific system prompt would duplicate rules, mishandle mixed work and increase every request's token cost.

The current optimizer asks for a professionally structured result and names common photography concerns, but it does not expose a validated plan, preserve exact literals deterministically, distinguish graphic/data/narrative needs, or let the user correct the inferred structure.

## Decision

Build a small prompt compiler around a finite semantic-slot vocabulary. The optimizer will use multi-label intent rather than a mutually exclusive image type, return a bounded Prompt IR, validate it on the server, render the final prompt from validated sections, and fall back to the existing plain-text result when an OpenAI-compatible provider cannot follow the structured contract.

The default path remains one provider call. Strict two-call planning is deliberately deferred until production evidence shows that it is needed.

## Stable semantic slots

- `general`: provider-neutral improvement for a non-image prompt.
- `contract`: artifact, purpose, audience and usage.
- `content`: subjects, properties, actions and relationships.
- `context`: place, time, environment and mood.
- `organization`: composition, layout, hierarchy, space and panels.
- `appearance`: medium, style, color, light and material treatment.
- `capture_render`: viewpoint, camera, lens, perspective and rendering.
- `information`: exact copy, data, icons, charts and symbols.
- `continuity`: identity, product, brand and cross-frame consistency.
- `constraints_output`: exclusions and output contract; API-controlled dimensions remain API parameters.

Only applicable slots are emitted. Mixed work uses the union of applicable slots.

## Request context and priority

The service combines bounded evidence in this order:

1. User-requested module overrides.
2. Page context such as AI Model selection, reference count and aspect ratio.
3. Explicit evidence in the source prompt.
4. Model inference.

The note editor uses `auto`; ImageHub uses `image_generation`. A user may retry an image result with an explicit module selection or retry it as a general prompt.

## Prompt IR

```ts
interface ModelPromptOptimizationPlan {
  version: 1;
  context: "general" | "image_generation";
  artifactLabel: string;
  intents: {
    purposes: PromptPurpose[];
    media: PromptMedium[];
    subjects: PromptSubject[];
  };
  selectedModules: PromptModuleId[];
  capabilities: PromptCapabilityId[];
  sections: Array<{ module: PromptModuleId; content: string }>;
  warnings: Array<{ code: ModelWarningCode; message: string; module?: PromptModuleId }>;
}
```

The model returns the IR only. The server filters unknown, duplicate or context-incompatible modules, enforces limits, derives the canonical selected-module list from the rendered sections, checks its own locked literals, and renders the visible optimized prompt. The API adds `format`, `requestedModules`, fixed section headings, `lockedFacts` preservation results, and warnings with `info | warning | error` severity plus an independent `blocking` flag. A general result is rendered as plain text; an image result uses only fixed, server-owned section headings.

## Exact-literal protection

The server extracts a conservative bounded canonical list from quoted copy, explicitly labelled values and high-confidence numeric expressions such as percentages, dates, dimensions and aspect ratios. These values stay in the user message, never in the system instruction. Missing values produce a blocking warning; Apply remains disabled until the user explicitly confirms that they reviewed the risk. If more than 30 distinct candidates are found, the result also blocks ordinary Apply and states that only the first 30 were checked.

The optimizer must never infer sensitive identity attributes from an image or fabricate data, brand claims, citations, product specifications or poster copy.

## Provider compatibility

Prompt Notebook supports user-selected OpenAI-compatible endpoints. The structured response is therefore requested using ordinary system/user messages rather than assuming JSON Schema support. The parser accepts a plain JSON object and a single common Markdown-fence wrapper and validates it with strict Zod schemas. A response that is clearly natural-language text may use the legacy fallback; a truncated or malformed JSON-like response becomes a stable retryable error instead of leaking broken structure to the user.

Clearly natural-language provider output remains compatible through the legacy plain-text path. JSON-like output that is malformed or truncated fails with a stable retryable error instead of exposing broken structure. API keys, full provider error bodies and full prompts are not logged.

## User experience

The existing original/result comparison and explicit apply/discard behavior remain. Structured results add:

- recognized artifact/subject/medium labels;
- selected semantic-module chips;
- visible factual/conflict warnings;
- a collapsed structure view;
- an adjustment panel with module checkboxes;
- explicit “re-optimize with selected modules” and “treat as general prompt” actions.

The default path still requires one click. Users only open adjustment controls when automatic recognition is wrong.

## Failure modes

- Clearly natural-language output: show the plain-text provider result.
- Truncated or malformed JSON-like output: return a stable retryable error.
- Unknown module: discard it and add a warning.
- Missing or duplicate sections: normalize valid sections and add warnings; a missing explicitly requested module is blocking.
- No context-compatible sections: return a stable retryable error.
- Missing locked literal: return a warning and retain explicit user confirmation before applying.
- Prompt text aspect ratio conflicting with ImageHub's active ratio: return a blocking warning without silently choosing one.
- Conflicting hard requirements: expose a warning; never choose silently.
- Stale editor content: preserve the current protection that disables apply.
- Provider or network failure: retain stable sanitized errors and retry behavior.

## Non-goals

- Persisting Prompt IR in notes in this release.
- Training on private user prompts.
- Vector search over prompt recipes.
- Provider-specific Midjourney or vendor parameter syntax.
- A mandatory second planning call.

## Success criteria

- Portrait, product, poster, infographic, cover, comic and landscape examples select composable modules without a new category prompt.
- Mixed examples retain all relevant modules.
- Exact quoted copy, percentages, dates, dimensions and aspect ratios are checked.
- General prompts remain supported.
- Clearly natural-language legacy results fall back safely; invalid JSON-like structure is rejected.
- Mobile and desktop users can inspect and correct the plan without accidental overwrite.
