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
- Aevum owns global entry points, reviewed events, memory inbox, permissions,
  and future cross-domain Agent routing.
- Viatica owns private ledger data. Sidera owns learning, capture/reflection,
  knowledge graph, and deep research.
- Ultreia may use approved Aevum context as explainable coaching input, but it
  must not read private Viatica or Sidera data directly.

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
- Coaching advice must explain which data or approved context it used.
- Training plans and health-risk decisions should stay confirmable, not black
  box automatic changes.
- Brand presence should be visible but restrained.
- Exported images should work as standalone artifacts outside the app.
- Family consistency means shared app-shell discipline, not turning Ultreia into
  the global Aevum OS.

## Data And AI Principles

- Use the shared Aevum account, but keep Ultreia data in training-owned tables.
- Cross-product facts must arrive through reviewed Aevum events or memory.
- AI Coach can propose plans, rescues, reports, memories, and action cards, but
  risky or durable actions need user confirmation.
- Desktop Codex Runner is preferred for richer coach tasks; fallback providers
  must preserve clear error and provenance behavior.

## Current Milestone

Keep Ultreia stable as the mature training product while gradually turning AI
Coach from copilot into a confirmable Agent. Do not expand it into ledger,
knowledge-base, or global launcher responsibilities.

## Accessibility & Inclusion

Keep text readable on mobile screens, preserve strong contrast on exported
images, support reduced motion, and avoid motion-dependent information.
