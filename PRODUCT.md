# Product

## Register

product

## Users

Ultreia is used by Chinese endurance runners who track completed training,
review progress, prepare for races, receive AI Coach guidance, and share
selected achievements with friends or social platforms.

## Product Purpose

Ultreia turns training records, races, charts, weather context, recovery notes,
and coaching context into a compact personal training hub. Success means users
can understand recent workload, keep their log organized, prepare for target
races, and receive explainable coaching suggestions without managing a complex
spreadsheet.

## Product Boundary

- Ultreia owns training records, calendar planning, races, PRs, recovery,
  weather-to-training interpretation, AI Coach, reports, training memory, and
  training-specific Agent actions.
- Aevum owns global entry points, cross-product policy, derived-memory
  lifecycle, exception handling, and cross-domain Agent routing.
- Viatica owns private ledger data. Sidera owns learning, capture/reflection,
  knowledge graph, and deep research.
- Ultreia may use policy-authorized, scoped, still-valid Aevum context as
  explainable coaching input, but it must not read private Viatica or Sidera
  data directly.

For ecosystem-level source of truth, read Aevum's `docs/ecosystem/` folder.

## Brand Personality

Focused, athletic, mature. Ultreia should feel like a serious training tool
with enough visual character for personal sharing.

## Family Alignment

Ultreia is the most mature mobile implementation in the Aevum family, so other
products may reference its navigation, settings discipline, guide/changelog
structure, splash treatment, update flow, and restrained dark product UI.
References must stop at reusable interaction patterns; training logic stays
inside Ultreia.

## App UI Direction

The live app UI follows the family dark product system: near-black graphite
backgrounds, translucent panels, precision hairlines, low outer glow, subtle
blur, micro-noise texture, and quiet stateful motion. Ultreia's own accent is
deep moss / olive with a small amount of cyan-green trail energy. It should read
as athletic and data-forward, never bright fitness green.

Exported posters may use separate day/night palettes because they are shareable
artifacts, not the core app shell.

## Anti-references

Avoid childish sports graphics, generic SaaS cards, flat unfinished poster
layouts, decorative gradients without data meaning, template-like visuals, and
anything that makes training judgment feel gamified or unserious.

## Design Principles

- Training data should become visual material, not just text on a background.
- Mobile readability wins over decorative density.
- Coaching advice must explain which data or authorized context it used.
- Current training writes stay confirmable. The target Agent may automatically
  execute explicitly authorized, reversible, low-risk adjustments only after
  fresh-state and conflict guards pass; material load increases, key-session or
  target-race changes, and health-risk decisions remain stricter or
  `requires_user`.
- Brand presence should be visible but restrained.
- Exported images should work as standalone artifacts outside the app.
- Family consistency means shared app-shell discipline, not turning Ultreia into
  the global Aevum OS.

## Data And AI Principles

- Use the shared Aevum account, but keep Ultreia data in training-owned tables.
- Cross-product facts must arrive through Aevum Report/Query policy, not direct
  access to another product's private store.
- Action Card is a typed action and audit record. The current UI uses manual
  confirmation; future actions declare `auto`, `guarded`, or `requires_user`.
- Ultreia may autonomously report meaningful training changes to Aevum, but a
  Report cannot grant a new scope or directly write Aevum memory.
- Desktop Codex Runner is preferred for richer coach tasks; fallback providers
  must preserve clear error and provenance behavior.

## Current Milestone

Keep Ultreia stable as the mature training product while advancing AI Coach
from a confirmable Agent into a policy-governed training Agent. The Calendar
conflict-safe prerequisite and Aevum B2 receiver are complete. The seven-signal
Ultreia v8 producer and its B2 outbox constraints are deployed; read-only
acceptance and a normal seven-slot Cron run passed. Producer-side cadence,
privacy and schema checks remain mandatory; sensitive recovery and health-risk
evidence is recorded by Aevum as `needs_user`. Reports still grant no
memory-write or Action authority. The B3 read-only Query responder v2 is ACTIVE
behind an independent HMAC channel. It returns only current target, reviewed
training-preference and aggregated 28-day training-state facts, never raw
workouts, location, notes, health context or write authority. Query does not
block proactive Reports. Do not
expand Ultreia into ledger, knowledge-base, or global launcher responsibilities.

## Accessibility & Inclusion

Keep text readable on mobile screens, preserve strong contrast on exported
images, support reduced motion, and avoid motion-dependent information.
