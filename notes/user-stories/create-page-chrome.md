# Create-page chrome backlog

> **Document status:** Active backlog for unplanned owner-requested create-page work
> **Last source review:** 2026-08-01

Owner-requested changes to the create page's chrome that no sprint story covers.
This file exists for the same reason [scene-fidelity.md](scene-fidelity.md) does:
so the work is visible rather than absorbed silently. It is not part of
[EPIC-S1-MIGRATE-001](engineering-backlog.md), it is in no sprint commitment, and
it competes for the same time as
[S1-SECURITY-001](../sprints/sprint-01-2026-07-22/user-stories.md), which is
marked *required before production cutover*.

Recording it does not approve it. Sequencing is the owner's call.

## US-CREATE-001 — One button clears the form off the world

Status: Implemented
Priority: Unranked — owner-requested outside sprint scope

As a visitor filling in the create form,
I want one button that hides every input and brings it back,
so that I can look at the live world I am shaping without losing what I typed.

Scenario: The whole interface leaves, not just the form

Given the create page has loaded on any viewport
When I press the single "Hide the form" button
Then the whole rail — heading, every field, chip, swatch, the error area and the
submit button — slides off the left edge and fades out
And the site header leaves upward, the identity island leaves to the right, and
the footer fades out
And what is left on screen is the live 3D world and that one button
And nothing of any panel or its shadow is left behind
And the same button, now reading "Show the form", brings all of it back with
every field holding exactly the value it held before.

Scenario: On a phone the world takes the whole screen

Given I am on a phone, where the world is a 46vh hero above the form
When I hide the form
Then the world grows to fill the viewport
And it returns to its hero height when I show the form again.

Scenario: Hidden means hidden to the keyboard too

Given the rail is hidden
When I press Tab repeatedly from the toggle
Then focus never lands on a form field or on the submit button
And dragging over the area the rail occupied orbits the camera normally.

Scenario: An error can never be reported into a hidden panel

Given I have hidden the rail
When world generation fails
Then the rail reappears on its own with the message above the submit button.

Scenario: Reduced motion still gets a working button

Given my system is set to reduce motion
When I press the button in either direction
Then the rail disappears or reappears instantly with no slide and no fade
And the label still switches between the two states.

Source evidence:

- `apps/myunivokai-web/src/lib/formRailCollapse.ts`
- `apps/myunivokai-web/src/lib/formRailCollapse.test.ts`
- `apps/myunivokai-web/src/app/page.tsx`
- `apps/myunivokai-web/src/app/layout.tsx` (header/footer exits)
- `apps/myunivokai-web/src/app/globals.css` (`.form-rail-collapse`, `.immersive-exit`)

Tasks:

- [x] Collapse the rail from a positioning wrapper, with the state in a pure,
      tested module (`feat/fe/create-form-rail-collapse`).
- [ ] Manual browser evidence, which no automated gate here can produce: vitest
      runs `environment: "node"` with `include: ["src/**/*.test.ts"]`, so a
      component test would not even be collected, and neither
      `@testing-library/react` nor a browser driver is installed. Matrix:
      desktop 1440x900 and mobile 390x844; universe **and** forest family
      (forest adds `.forest-chrome .glass-panel`'s opaque base); reduced motion
      on and off; mid-generation (the toggle must be disabled); rapid
      double-toggle; Tab-from-the-toggle while collapsed; and desktop expanded
      compared against the current build for pixel equality.

### Why the collapse lives on a wrapper, not on the panel

Two traps, both in `globals.css`, both silent:

- the rail carries `.glass-rise`, whose `animation: … both` fill retains
  `transform: translateY(0) scale(1)` forever. An animation-applied value
  outranks a normal declaration, so a transform on the panel itself never
  applies at all;
- the rail carries `.glass-panel`, which the `prefers-reduced-motion` block
  resets with `transform: none` — nullifying the collapse for exactly the users
  who most need it to work rather than merely to animate.

The wrapper carries neither class, so both are avoided structurally instead of
fought with `!important`.

### Why transform and opacity, not height

The rail has two incompatible height models — content-driven in the mobile flow,
viewport-pinned on desktop by `lg:top-[72px]` **and** `lg:bottom-6` — so no
single height animation covers both. Beyond that it is a 30px `backdrop-filter`
surface over a continuously rendering WebGL canvas, containing a dozen more
nested blurred surfaces: animating its box forces layout, paint and a fresh
backdrop every frame. Animating its position does not.

The layout *does* have to change on mobile, but exactly once per toggle: the box
is released only after the slide has finished, so the page closes up under an
already-invisible card. `FORM_RAIL_COLLAPSE_DURATION_MILLISECONDS` and the
stylesheet's `--form-rail-collapse-duration` are the same number, and
`formRailCollapse.test.ts` parses `globals.css` and fails if they ever drift.

### Reaching the header and footer, which are not the page's to hide

The owner's requirement is that hiding the form leaves **only** the 3D world, and
the header and footer live in the shared `app/layout.tsx` — an *ancestor* of the
page. No selector reaches upward, and lifting them into page state would make
the layout a client component and change every route.

So the page publishes the state as `data-world-immersive` on `<body>` and the
stylesheet hides each chrome surface from there. Two consequences worth knowing
before touching this:

- the effect's cleanup is load-bearing. Navigating away while hidden without
  clearing the attribute would leave the entire app with no header;
- the attribute name is a contract between TypeScript and CSS with no compiler
  between them, so a test asserts `globals.css` still selects on exactly the
  exported constant. Renaming one side alone would leave the form hiding while
  the header stays, and nothing would fail.

Each surface leaves toward the edge it is anchored to, except the footer, which
only fades: it sits in normal flow, where a downward translate would grow the
document's scrollable area instead of leaving it.

### Glass transparency

The owner asked for the transparency seen *mid-close* to become the resting
state. That moment is two effects at once — the material thinning **and** the
whole panel (text included) fading toward zero — so it cannot be adopted
literally on a form that has to be filled in. The decision (2026-08-01) was to
keep the first and drop the second: **the material goes nearly invisible, the
content stays at full opacity.**

**Clear, not frosted — the blur was the whole problem.** Three rounds were spent
lowering the *tint* while the blur stayed, and none of them read as transparent,
because the owner's word is "trong suốt" (see-through), not "mờ như kính" (hazy
like frosted glass). Blur was also what made the panel look like a dark card
over the **universe**: averaging a sharp star field on black flattens the bright
points away and leaves a grey wash, so more blur meant *less* apparent
transparency, in both families at once. There is now no blur anywhere in the
chrome — only saturation.

| Token | Was | Now |
| --- | --- | --- |
| `--glass-tint` | `0.30` | **`0.08`** |
| `--glass-blur` | `blur(30px) saturate(180%)` | **`saturate(125%)` — no blur** |
| header wash | `bg-mount/35`, `backdrop-blur-2xl` | **`bg-mount/10`, saturate only** |
| footer wash | `bg-void/45`, `backdrop-blur-2xl` | **`bg-void/10`, saturate only** |
| `.forest-chrome .glass-panel` | `0.62` | **`0.14`** |
| `grey` / `on-surface-variant` | `#B6B0A4` | **`#DCD7CB`** |
| `faint` / `outline` | `#807868` | **`#A79D8A`** |
| `.input-dark` fill | `rgba(255,255,255,0.05)` | **`rgba(8,8,10,0.42)`** |

What still marks a panel as a panel at this tint is its specular top edge, its
brass inner rule and its lift shadow — not a wash of dark. Those three must not
be thinned along with it.

**The correction that made it work.** The first attempt only lowered the tint
and kept `.forest-chrome` high as the counterweight, which produced the worst of
both: panels that were still muddy *and* still low-contrast, because grey text
sat on a mid-dark wash. Legibility now comes from the text instead of from a
wash behind it:

- `.glass-panel` / `.liquid-glass` carry a `text-shadow`, so text holds up over
  any scene while the material stays clear. `.btn-brass` cancels it — dark
  engraved labels on a brass fill need no shadow and a dark one muddies them.
- the muted tokens were tuned against a dark wash and had to rise once they sat
  straight on the live world.
- `.input-dark` is filled dark rather than veiled with 5% white. A field is the
  one surface a user reads character by character, and white-on-white over a
  daylight canopy lost both the value and the placeholder.

Raise `.forest-chrome .glass-panel` only if forest text still fails, and judge
that on the **Forest** family: the universe's `#050816` flatters any value.

### The world toggle

It docks at the header band's own vertical centre and above the header (z over
its 50), so it holds one place whether the header is present or has left. Both
offsets derive from `--header-height`, so the 57px contract is stated once
rather than copied.

At rest it is a bare icon — a true circle, because its padding is
`(size - icon) / 2` on both sides. The label unrolls on hover **or focus**: the
width comes from interpolating `grid-template-columns` between `0fr` and `1fr`
rather than a guessed `max-width`, so it stays correct when the label changes
between "Hide the form" and "Show the form". The label's own padding lives on
the clipped child, so the collapsed state clips the gap along with the text and
the circle stays circular.

`:focus` rather than `:focus-visible` is deliberate: a touch tap focuses without
hovering, and that is the only way a touch user ever sees the label. The
accessible name lives on the button and never depends on the label being
visible, so a screen reader is unaffected by any of this.

It is **solid brass, deliberately not glass.** It was reported missing twice: a
translucent circle is invisible against a bright forest canopy *and* against a
near-black star field, because it borrows its contrast from whatever is behind
it and both extremes defeat it. The header's own brass CTA stayed legible in
every screenshot, so the toggle takes the same treatment. Everything else on
this page may dissolve into the world; the one way back may not.

Known risk for QA: the toggle is centred in the header band, and on the
narrowest phones the header's own logo and nav leave little clear space there.

### Constraints any future create-page chrome work inherits

- The submit button sits **outside** the `<form>` and is re-attached by the HTML
  `form` attribute. Collapsing by unmounting the form leaves it a dead button
  with no error and no console warning — the collapse must stay a CSS
  visibility change over a mounted tree.
- Nothing on this page is persisted. A remount re-fires `resumePendingWorld` and
  wipes every field, so no chrome change may remount `HomePage`.
- No keyboard shortcut is available: `CameraRig` `preventDefault`s WASD and all
  four arrows window-wide whenever the target is not an input, and Escape is
  already bound inside the custom-interest field.
- Any camera move on toggle would re-key `<Canvas>`, destroy the GL context and
  replay the "Rendering universe" veil on every press.
