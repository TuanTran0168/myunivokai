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

Scenario: The form leaves and comes back

Given the create page has loaded on any viewport
When I press the single "Hide the form" button
Then the whole rail — heading, every field, chip, swatch, the error area and the
submit button — slides off the left edge and fades out
And nothing of the panel or its shadow is left on screen
And the same button, now reading "Show the form", brings the rail back with every
field holding exactly the value it held before.

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
- `apps/myunivokai-web/src/app/globals.css` (`.form-rail-collapse`)

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
