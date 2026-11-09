---
name: PSD Sentinel Precision Plate
description: A calm operational workspace built from a graphite command rail, compact neutral plates, and restrained cobalt states.
colors:
  cobalt: "oklch(0.52 0.2 258)"
  cobalt-dark: "oklch(0.55 0.2 258)"
  cobalt-link: "oklch(0.55 0.17 250)"
  cobalt-link-dark: "oklch(0.7 0.14 248)"
  canvas: "oklch(0.985 0.004 255)"
  canvas-dark: "oklch(0.13 0.025 258)"
  surface: "oklch(0.995 0.003 255)"
  surface-dark: "oklch(0.17 0.028 258)"
  surface-raised: "oklch(0.955 0.012 255)"
  surface-raised-dark: "oklch(0.22 0.035 258)"
  text-primary: "oklch(0.2 0.03 258)"
  text-primary-dark: "oklch(0.94 0.012 255)"
  text-secondary: "oklch(0.46 0.03 255)"
  text-secondary-dark: "oklch(0.72 0.025 255)"
  hairline: "oklch(0.89 0.014 255)"
  hairline-dark: "oklch(0.3 0.035 258)"
  graphite-rail: "oklch(0.18 0.035 258)"
  graphite-rail-dark: "oklch(0.1 0.025 258)"
  graphite-foreground: "oklch(0.82 0.02 255)"
  success: "oklch(0.5 0.14 148)"
  warning: "oklch(0.73 0.16 82)"
  danger: "oklch(0.54 0.2 27)"
  info: "oklch(0.5 0.16 246)"
  unknown: "oklch(0.58 0.03 255)"
typography:
  display:
    fontFamily: "Noto Sans Thai Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "28px"
    lineHeight: "36px"
  heading:
    fontFamily: "Noto Sans Thai Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    lineHeight: "28px"
  title:
    fontFamily: "Noto Sans Thai Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    lineHeight: "24px"
  body:
    fontFamily: "Noto Sans Thai Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    lineHeight: "24px"
  label:
    fontFamily: "Noto Sans Thai Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    lineHeight: "20px"
  caption:
    fontFamily: "Noto Sans Thai Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    lineHeight: "18px"
rounded:
  small: "4px"
  medium: "6px"
  control: "8px"
  panel: "12px"
  large: "16px"
spacing:
  inline: "8px"
  control: "12px"
  panel: "16px"
  section: "24px"
  page: "32px"
  page-compact-mobile: "16px"
  page-compact-tablet: "20px"
  page-compact-wide: "24px"
touchTargets:
  coarse: "44px"
  fine-dense: "36-40px"
  adjacent-gap: "4-8px"
components:
  navigation-active:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.medium}"
    padding: "8px 10px"
    height: "38px"
  application-header:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.text-primary}"
    height: "56px"
    padding: "0 20px"
  summary-plate:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.control}"
    padding: "12px"
  data-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.control}"
    padding: "16px"
  segmented-selected:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.medium}"
    padding: "6px 12px"
    height: "44px"
  form-control:
    typography-fine: "14px/20px"
    typography-coarse: "16px/24px"
    height: "44px"
    horizontal-padding: "12px"
    rounded: "{rounded.control}"
  operational-table:
    header-typography: "12px/18px, 600"
    primary-typography: "14px/20px"
    secondary-typography: "12px/18px"
    cell-padding: "8px 12px"
    header-height: "40px"
    two-line-row-height: "52-60px"
---

# Design System: PSD Sentinel Precision Plate

## Overview

**Creative North Star: "Graphite Command Rail + Precision Plates"**

PSD Sentinel is an operational interface whose premium character comes from exact alignment, controlled density, and immediate status legibility. The graphite rail anchors the application while opaque neutral work surfaces, hairline dividers, and compact page spacing keep attention on live operations rather than decoration.

The Precision Plate dashboard extends the existing Operational Precision foundation without changing product truth. It adapts the shipped fleet aggregates, GPS activity, work-order stages, overdue work, and recent events into an instrument-panel hierarchy; it does not imply a device-level register that the production data contract does not provide. Cobalt remains deliberately scarce and marks navigation selection, actions, links, and focus. Green, yellow, red, blue, and gray remain semantic status colors paired with text or icons.

**Key Characteristics:**

- Graphite application rail with a clear cobalt active state
- Compact, border-led neutral surfaces with little resting elevation
- Shared metric cards for top-level summaries, with continuous plates reserved for workflow stages
- Dense but readable Noto Sans Thai typography with tabular operational numerals
- Responsive reflow that preserves all information and avoids page-level overflow
- Equal visual intent in light and dark themes rather than mechanical color inversion

## Decision Priority and Source of Truth

When design goals conflict, resolve them in this order:

1. **Task completion:** The operator can complete the job without guessing, losing entered data, or taking an unsafe action.
2. **Clarity and readability:** Labels, values, status, and next actions remain understandable during a quick operational scan.
3. **Accessibility:** Keyboard, focus, contrast, target size, assistive technology, and reduced motion are part of the default experience.
4. **Consistency:** Existing tokens and shared components take precedence over page-specific styling.
5. **Brand and aesthetics:** Premium character comes from precision, restraint, and material quality after the first four needs are met.

`src/styles/tailwind.css` is the runtime source of truth for visual tokens. Shared components in `src/components/ui` and `src/components/command-center` are the implementation source of truth for controls and common states. This document defines intent and usage contracts; it must not duplicate a temporary page implementation or authorize unsupported data and behavior.

**The Familiar Operations Rule.** Prefer interaction patterns that operators already understand. Novel presentation is acceptable only when it makes the task faster or clearer and remains fully labelled.

**The One Primary Decision Rule.** Each page, dialog, panel, or form step has one visually dominant next action. Secondary, tertiary, and destructive actions must not compete with it.

## Colors

The palette is a cool neutral instrument field with graphite structure and a single cobalt interaction voice. `src/styles/tailwind.css` remains the runtime source of truth for both themes.

### Primary

- **Command Cobalt:** Use for selected navigation, primary actions, focus, and information that must read as interactive.
- **Readable Cobalt Link:** Use the contrast-adjusted link role for cobalt text on neutral surfaces; do not substitute the button fill token for small text.

### Neutral

- **Quiet Canvas:** The application background behind all work surfaces.
- **Opaque Surface:** A cool off-white plate and panel background that avoids pure white glare. Dashboard surfaces do not use translucency.
- **Raised Neutral:** Quiet internal grouping, selected-control wells, and skeleton contrast.
- **Operational Ink:** Primary copy, headings, and changing numeric values.
- **Secondary Ink:** Supporting labels and metadata that remain readable at compact sizes.
- **Hairline:** One-pixel panel borders, row separators, and internal metric dividers.
- **Graphite Rail:** The persistent navigation structure; its darker variant preserves the same hierarchy in dark mode.

### Tertiary

- **Status Success, Warning, Danger, Info, and Unknown:** Reserve these roles for system state. Always pair them with a label, icon, or explicit value.

### Named Rules

**The One Cobalt Voice Rule.** Cobalt identifies selection, action, links, and focus; it is not a decorative wash.

**The Status Has Language Rule.** Semantic color never carries meaning by itself; status also appears as text, an icon, or both.

### Contrast and Saturation

- Normal text must reach at least 4.5:1 contrast against its actual background. Large text and meaningful non-text graphics must reach at least 3:1.
- Light mode may use slightly clearer saturation for recognition, but never at the cost of readable text or calm operational scanning.
- Dark mode uses controlled chroma and opaque surfaces. Do not reproduce light-mode colors by simple inversion.
- Pure black and pure white are avoided for large surfaces and primary copy; the neutral ink and surface tokens reduce glare while retaining contrast.
- Destructive red is reserved for destructive actions, irreversible confirmation, and true error states. Warnings and high priority are not automatically destructive.

## Typography

**Display Font:** Noto Sans Thai Variable (with UI sans-serif and system fallbacks)  
**Body Font:** Noto Sans Thai Variable (with UI sans-serif and system fallbacks)

**Character:** One family serves Thai, English, and numerals so mixed-language controls align on a common baseline. Dashboard content stays within a compact 12–22px working range beneath the standard 28px page title.

### Hierarchy

- **Display** (28px/36px): Standard page titles, including Dashboard and Reports.
- **Heading** (22px/28px): Primary operational figures and prominent section emphasis.
- **Title** (18px/24px): Section emphasis and responsive metric values.
- **Body** (16px/24px): Explanatory prose and comfortable reading, normally capped at 70ch.
- **Label** (14px/20px): Application chrome, navigation, controls, and dense panel titles.
- **Caption** (12px/18px): Metadata, compact labels, timestamps, and secondary descriptions.

Metrics, timestamps, identifiers, and other changing numeric data use tabular numerals. Dashboard titles use the standard page hierarchy and do not add an eyebrow merely for decoration.

Form labels use 14px/20px at medium weight. Input, select, textarea, and searchable-select values use 14px/20px on fine-pointer devices and 16px/24px on coarse-pointer devices. Placeholder text uses the same size as the value with muted color and normal weight; it provides an example or hint and never replaces the visible label.

Operational tables use a compact, stable hierarchy:

- **Column header:** 12px/18px, medium or semibold, quiet foreground, sentence/title case rather than all caps.
- **Primary cell value:** 14px/20px, regular or medium according to importance.
- **Secondary cell value:** 12px/18px, muted but contrast-compliant.
- **Identifiers, dates, times, durations, and changing counts:** tabular numerals; align comparable numeric columns consistently.
- **Density floor:** Do not shrink meaningful table copy below 12px to fit more columns. Reflow, truncate locally with an accessible full value, or use contained horizontal scrolling instead.

Headings normally use a 1.2–1.3 line-height; labels, body copy, and Thai prose use approximately 1.4–1.6. Keep prose at roughly 40–75 characters per line, targeting about 65 characters for balanced Thai reading. Test Thai, English, mixed numerals, bold text, and long translated content—not placeholders alone.

**The Instrument Readout Rule.** Operational numbers align and scan like readings, while labels stay subordinate and never compete through scale.

**The Compact Without Cramping Rule.** Density comes from alignment and a limited type scale, not from undersized copy or removing the whitespace needed to distinguish groups.

## Layout

The desktop shell uses a fixed graphite navigation rail that is 232px expanded and 72px collapsed. The solid application header is 56px high. Non-full-bleed routes use compact page insets of 16px on small screens, 20px from the small breakpoint, and 24px on wide screens; the workspace is centered at a maximum width of 1600px with 16px between major regions.

The Dashboard begins with the standard page title and description, then a grid of shared summary cards that matches Reports. Its six metrics reflow as two columns by default, three from the large breakpoint, and six from the extra-large breakpoint. The primary operational workspace stacks until extra-large screens, where it becomes a flexible main fleet/GPS area plus a 360px attention rail. Both cards stretch to the shared row height so the desktop composition has no orphaned gap, while their empty-state content stays centered. On compact screens, populated operational panels appear before empty supporting panels; the work-order flow and recent-event ledger span the available workspace below on extra-large screens.

Responsive behavior preserves information rather than hiding it. Row contents may truncate locally, but the page must not acquire horizontal overflow at compact, tablet, or desktop widths.

**The First Viewport Rule.** On a 1440×1024 control-room display, overall status, fleet/GPS activity, abnormal work, and work-order flow belong in the initial scan without decorative whitespace.

**The Shared Summary Rule.** Top-level metrics use the same bordered summary-card component across Dashboard and Reports. Sequential workflow stages may share one continuous bordered surface with internal dividers.

### Grid and Spacing Contract

- Use the shared 4/8/12/16/24/32px spacing family. Page-specific arbitrary gaps require a documented layout reason.
- Keep a label close to its control, normally 8–12px; separate field groups by about 24px; separate the action area from the final field group by about 24–32px.
- Align page titles, filters, cards, tables, form controls, and dialog actions to shared edges. Misalignment is treated as a hierarchy defect, not decoration.
- Use proximity to communicate grouping. Related information stays close; unrelated tasks receive a visible gap, divider, heading, or separate surface.
- Chunk long or complex information into named groups. Do not treat a fixed number of items as a universal limit; group according to the user's mental model and decision.
- On smaller widths, reduce columns and reflow regions instead of scaling all typography and targets down.

## Elevation & Depth

The system is flat by default. Opaque surface contrast, one-pixel borders, and tonal grouping establish depth for dashboard plates and panels; resting dashboard surfaces do not use decorative shadows. The existing low, medium, and high elevation tokens remain available for raised actions or selected segmented tabs, menus, and dialogs/toasts respectively. Keyboard focus uses an explicit cobalt ring rather than shadow-only feedback.

### Shadow Vocabulary

- **Low elevation** (`var(--shadow-low)`): Raised primary actions and the selected segment inside a muted control well.
- **Medium elevation** (`var(--shadow-medium)`): Menus and transient overlays.
- **High elevation** (`var(--shadow-high)`): Dialogs, drawers, and toast notifications.

**The Border Before Shadow Rule.** A persistent operational surface earns structure from its border and alignment; elevation is reserved for interaction hierarchy.

## Shapes

Precision Plates use small, controlled corners. Navigation items use the 6px medium radius; summary plates, dashboard panels, controls, and interactive rows use the 8px control radius. The broader 12px and 16px radii remain available for overlays and large surfaces, not routine dashboard panels. Full circles are limited to status dots, avatars, and true pills.

One-pixel dividers form the grid inside continuous workflow plates. Summary cards use a compact semantic icon tile consistent with Reports. Compact dashboard rows target a 52–56px rhythm, and 34px status-icon containers keep row silhouettes aligned without becoming decorative tiles.

**The Small Radius Rule.** Operational plates stay within the 6–8px instrument range; larger rounding does not replace hierarchy or spacing.

Nested surfaces use progressively smaller radii: an inner control or tile must not appear more rounded than the panel containing it unless it is a true pill or circle. Boxed fields are the default; underline-only inputs do not provide enough affordance for this operational context.

## Components

### Buttons and Actions

- **Primary:** Solid cobalt, one dominant action per context. Use an explicit verb such as Save, Create work order, Assign, Retry, or Export.
- **Secondary:** Neutral filled or outlined treatment for useful alternatives that should remain visible.
- **Tertiary:** Ghost or link treatment for low-emphasis actions such as Cancel, Back, or View details.
- **Destructive:** Red treatment only when the action destroys, removes, cancels, or irreversibly changes data. Confirmations name the object and consequence.
- Avoid generic labels such as Yes, No, OK, Submit, or Continue when a more specific action is available.
- Icon-only actions require an accessible name and a tooltip when the meaning is not universally clear. The icon may be 16–20px while its hit area remains large enough to operate.
- Button horizontal padding is normally about twice the vertical padding, with enough width for Thai and English labels without crowding.

All interactive components provide relevant default, hover, focus, active, selected, disabled, loading, success, and error states. Do not add a visual state that cannot be explained by a real product state.

### Touch Targets and Input Modality

- The default control and touch target is at least 44×44px. This applies to icon buttons, navigation, tabs, row actions, date steppers, clear buttons, and upload/remove controls—not only primary buttons.
- Adjacent compact targets keep a 4–8px separation or an equivalent non-overlapping hit-area boundary.
- On a fine pointer, dense secondary controls inside tables and menus may use a 36–40px target when 44px would materially damage comparison density. They must remain keyboard accessible, visibly focused, and at least 44px on coarse pointers.
- Never infer touch capability from viewport width alone; use input-modality-aware styles where density changes.
- A small visual icon does not authorize a small hit area. Do not make the whole row clickable when the row contains competing nested actions.

### Form Controls and Field Anatomy

- Use a visible label above every input. Placeholder text is optional guidance, never the only label.
- Mark optional fields with localized “optional” text when helpful; do not add repetitive required markers to every field when most fields are required.
- The field sequence is `label → control → hint or error`. Error text occupies the same message position as the hint and is programmatically associated through `aria-describedby`; invalid controls expose `aria-invalid`.
- Errors state what happened and how to recover. Prefer “เลขประจำตัวผู้เสียภาษีต้องมี 13 หลัก” over “ข้อมูลไม่ถูกต้อง”. Show the error next to the affected control and provide a page/form summary only when several errors would otherwise be missed.
- Inputs, selects, textareas, and comboboxes use the shared 44px control rhythm, 12px horizontal padding, 8px radius, visible border, and explicit focus ring.
- Disabled fields remain legible but clearly unavailable. Read-only data must not be styled as a disabled field when users still need to copy or inspect it.
- Use native or purpose-built controls that match the data: radio for one choice, checkbox for independent multiple choices, date/time controls for dates, and structured entry only when the structure helps recognition.
- Default to a single vertical form flow. Two columns are allowed only for short, strongly related values on sufficiently wide screens; collapse them without changing reading order.
- Ask only for information required by the current workflow. Progressive disclosure is preferred to a long form with conditional fields shown prematurely.

### Input Masks and Data Entry

- Masks may add spaces, dashes, or grouping while the user types, but stored and submitted values are normalized to the API contract.
- Validation compares normalized values so formatting-only edits do not create false changes.
- Preserve caret behavior, deletion, paste, autofill, and selection. Never silently discard a valid character merely to maintain decoration.
- Set the appropriate `type`, `inputMode`, autocomplete purpose, and localized example for telephone, numeric identifier, date, time, email, and search data.
- Communicate the expected structure before an error occurs. If the mask is strict, provide a short visible example or hint.
- Do not mask free text or values whose format varies legitimately. Formatting must reduce cognitive load, not force users to fight the field.

### Searchable Selects and Choice Controls

- Long option lists support both typing and scrolling. Match normalized labels, preserve the selected value, and provide clear empty and disabled-option states.
- Comboboxes support Arrow Up/Down, Enter, Escape, focus restoration, active option announcement, and a visible clear action when clearing is allowed.
- Avoid presenting an exhaustive wall of choices. Group, filter, or progressively narrow options where the domain supports it.
- Add an “Other” option only when the product genuinely accepts a value outside the controlled vocabulary and can store or route it safely.

### Multi-step Forms

- Split a form into steps when sections represent distinct decisions, dependencies, or validation boundaries—not merely to make the page look shorter.
- Show the current step, total progress, step names, and completed states in text as well as visuals. The progress indicator is navigation only when completed steps are actually editable.
- Validate fields needed for the current transition before advancing. Preserve all entered data when moving back, editing a completed section, or encountering a submission error.
- Keep concise summaries of completed steps visible below or beside the current step when space allows. Each summary names the section, shows the values most useful for recognition, and offers an explicit Edit action.
- The summary is not a second form. It omits empty optional values, protects sensitive data, wraps long content safely, and returns users to the relevant step without clearing later compatible answers.
- The final review names the action and consequence before submission. Back remains secondary; the submit action becomes primary only on the final step.
- The work-order create flow uses a compact segmented step rail: completed steps are directly editable, the immediate next step performs the current validation boundary, and later steps remain disabled. Keep a labelled Next action in the sticky action area as the discoverable forward path; a separate Previous action is unnecessary because completed steps and Summary Edit provide direct backward navigation. Cancel remains available and Create becomes primary only on the final step.
- The active segment and step content move with short, direction-aware spring transitions. Forward content enters from the right and backward content enters from the left; the current form and its Summary move as one unit without height animation. Completed steps pair a check icon with the label, and `prefers-reduced-motion` removes movement without hiding the state change. Every segment remains a native keyboard-operable control with a minimum 44px target.

### Application Shell

- **Rail:** Solid graphite, 232px expanded and 72px collapsed, with 12px horizontal navigation padding.
- **Brand/header rhythm:** The brand block and application header share a 56px minimum height and a separating hairline.
- **Navigation:** Items are at least 44px tall for touch and 38px at desktop density; active items use a solid cobalt field with white text/icon, while inactive items use quiet graphite foregrounds and a darker hover surface.
- **Motion:** Width and label-opacity changes run for 150–200ms and are disabled by reduced-motion preferences.

### Operational Summary Cards

- **Structure:** Six data-derived instances of the shared `MetricSummary` card used by Reports.
- **Responsive grid:** Six, three, or two columns according to available width; no metric is hidden.
- **Readout:** A semantic icon tile and subordinate label lead a 22px semibold tabular value.
- **States:** Loading keeps each card's geometry with skeleton values; errors show an em dash rather than fabricated totals.

### Dashboard Panels

- **Surface:** Solid card color, 8px corners, a one-pixel border, and no resting shadow.
- **Header:** Compact 44px-minimum header with a bottom divider, 16px horizontal inset, and optional right-aligned action.
- **Content:** 16px standard inset, with continuous internal bands allowed to meet panel edges when the grouping needs it.
- **States:** Loading, empty, error, and retry behavior use the shared asynchronous-state pattern and preserve region labels.
- **Content model:** One card or panel represents one concept. If the entire card has only one destination, the full card may be interactive with a visible focus state; otherwise use explicit actions and avoid competing click targets.

### Segmented Period Control

- **Shape:** A muted 8px control well containing 6px segments.
- **Selection:** The active segment moves to the solid surface with low elevation; selection remains keyboard-operable and visibly focused.
- **Behavior:** The period changes the existing GPS chart/table only; the control does not imply a new data source.

### Status Rails and Ledgers

- **Work-order flow:** All shipped stages remain in one responsive two/three/six-column rail with tabular counts, status dots, and a connecting hairline at wide widths.
- **Attention rows:** 56px-minimum rows prioritize abnormal state, pair a semantic icon with text, and keep the existing work-order destination.
- **Recent events:** 52px-minimum rows use separators, explicit status text, and tabular timestamps; the ledger remains a full-width continuation of the operational hierarchy.

### Data Adaptation

The fleet/GPS workspace expresses the hierarchy of a precision register using the production aggregate contract. It may summarize fleet health, show GPS activity, and expose an accessible data table, but it must not invent device-level records, API fields, or implied drill-down behavior to mimic a reference image.

### Operational Data Tables

- Use a 40px header and 8px vertical/12px horizontal cell padding. A typical two-line row is 52–60px tall; one-line utility tables may be denser only when targets and readability remain intact.
- Put the most identifying value first and its supporting context directly beneath it. Metadata is muted rather than made smaller than the 12px caption floor.
- Status uses a semantic dot or icon plus a text label. Priority, assignment, and timestamps remain independently understandable without color.
- Align columns consistently across rows. Numeric values align for comparison; prose aligns to the reading edge. Keep action columns narrow and predictable.
- Row actions stay visible and operable. Use a labelled primary row destination when appropriate and an overflow menu for secondary actions; destructive actions do not sit beside routine actions without separation.
- On narrow screens, first remove nonessential repetition, then allow contained horizontal scrolling inside the table frame or use a deliberate stacked representation. Never cause page-level horizontal overflow or shrink the text below the type contract.
- A horizontally scrollable data region exposes a subtle edge fade toward hidden content, receives an accessible label, and joins the keyboard tab order only while content actually overflows. Recalculate this state when its columns or container size change; after scrolling, update the edge cues to match the remaining content in each direction.
- Headers use correct table semantics and scope. Sorting, selection, pagination, and row menus are keyboard operable and communicate their state.

### Loading, Empty, Error, and Success States

- Skeletons mirror the approximate geometry and count of the final content. Use generic spinners only for a compact action whose surrounding layout already exists.
- Loading labels remain available to assistive technology; shimmer and spinners stop under reduced-motion preferences.
- Empty states distinguish “no data exists” from “no results match the current filters.” Give the next useful action when one exists.
- Error states explain the affected scope and recovery path. Retry preserves filters and entered information whenever safe.
- Success feedback confirms the completed object or action and does not block the next operational task unnecessarily.

## Iconography and Imagery

Lucide is the shared interface icon system. Use its outline language consistently—normally 16px in compact controls, 18px in rows, and 20px in prominent actions—with approximately 1.5–2px stroke weight. Do not mix icon packs, filled glyphs, emoji, or custom metaphors inside standard navigation and actions unless a product-specific symbol has been reviewed as part of the system.

Icons reinforce a nearby label or familiar action; they do not fill empty space. Ambiguous icons need a visible label or tooltip. Decorative icons are hidden from assistive technology, while meaningful stand-alone icons receive an accessible name.

Operational imagery—maps, camera previews, thumbnails, evidence, avatars, and attachments—must be sharp at its rendered size, preserve the important subject when cropped, and use a stable aspect ratio within each component type. Provide responsive dimensions and compression appropriate to the actual display. Meaningful images require useful alt text; decorative imagery uses empty alt text. A blurred, incorrectly cropped, or misleading evidence image is a functional defect, not a polish issue.

## UX Writing and Content Density

- Labels name the information; buttons name the action; headings name the decision or group. Avoid internal implementation terms when operators use a clearer domain term.
- Use concise sentence or title case appropriate to the language. Avoid all caps, decorative eyebrow text, and punctuation used only for visual emphasis.
- Error copy includes the problem and recovery. Empty-state copy explains why the region is empty and what the user can do next. Confirmation copy names the affected object and irreversible result.
- Prefer direct Thai and English translations that preserve intent over equal character length. Layouts must tolerate longer translations without clipping controls.
- For long optional descriptions, show a bounded preview with a labelled expand/collapse action rather than uncontrolled overflow or an unexplained ellipsis.
- Do not repeat the same status, owner, or timestamp in adjacent regions unless the repetition supports a distinct decision.

## Accessibility and Responsive Contract

- Every control has an accessible name, visible keyboard focus, logical focus order, and keyboard behavior matching its role.
- Selection, severity, validation, and availability never rely on color alone. Pair color with text, icon, shape, or state attributes.
- Focus rings remain visible in light and dark themes and are not clipped by `overflow: hidden` containers.
- Motion communicates a change of state, generally within 150–200ms. Honor reduced motion by removing nonessential animation while preserving the state change.
- Test at 320, 375, 768, 1024, 1280, and 1440px reference widths, plus 200% zoom. Test both pointer modes where control density differs.
- Test real Thai and English content, long names, large numbers, empty values, validation messages, loading, permissions, and network failure.
- Local truncation must expose the full meaningful value through a title, tooltip, expansion, or detail view. Primary actions and recovery actions must never be clipped or unreachable.
- Responsive adaptation preserves task order and information hierarchy. Reordering visual regions must not create a conflicting DOM or keyboard order.

## Design Review Checklist

Before a UI foundation or feature is considered ready, verify:

- [ ] The primary task and one primary action are immediately identifiable.
- [ ] Type uses the 12/14/16/18/22/28px scale and the operational table/form contracts where applicable.
- [ ] Spacing uses the shared scale; labels, groups, sections, and actions have visibly different relationships.
- [ ] Controls have relevant default, hover, focus, active, selected, disabled, loading, success, and error states.
- [ ] Coarse-pointer targets reach 44×44px; dense fine-pointer exceptions remain keyboard accessible and restore 44px for coarse input.
- [ ] Labels remain visible, placeholders are hints only, masks preserve editing, and errors state how to recover.
- [ ] Long forms preserve data, show progress, and expose completed-step summaries with Edit actions.
- [ ] Tables preserve 12/14px readability, semantic headers, accessible actions, and contained responsive behavior.
- [ ] Loading skeletons resemble final content; empty, filtered-empty, error, retry, and success states are intentional.
- [ ] Color meaning is reinforced by text/icon and meets contrast requirements in both themes.
- [ ] Lucide icons are consistent, targets are large enough, and ambiguous icon-only actions have labels or tooltips.
- [ ] Images are sharp, correctly cropped, efficiently loaded, and use appropriate alt text.
- [ ] Thai, English, mixed numerals, long content, permissions, failure states, reduced motion, keyboard use, and 200% zoom have been checked.
- [ ] No page-level overflow or unreachable action appears across compact, tablet, and desktop widths.

## Do's and Don'ts

### Do:

- **Do** keep the graphite 232/72px rail, 56px header rhythm, and compact 16/20/24px page inset aligned across the shell.
- **Do** use the shared summary-card language for page-level KPIs and continuous plates for sequential status flows.
- **Do** preserve the six/three/two-column summary reflow and all loading, empty, error, retry, keyboard, and responsive behavior.
- **Do** pair semantic status color with text or an icon and use tabular numerals for changing operational data.
- **Do** adapt reference imagery to the product's real API, permissions, routes, and realtime boundaries.
- **Do** keep visible labels, specific recovery text, appropriate input masks, and summaries of completed steps in long workflows.
- **Do** use one Lucide icon language and keep visual icon size separate from the 44px touch target.
- **Do** keep operational tables at 12px headers/metadata and 14px primary values with predictable row rhythm.
- **Do** verify semantic-theme contrast, relevant layout and component tests, the production build, both themes, Thai/English content, and compact-to-desktop overflow after foundation changes.

### Don't:

- **Don't** invent page-specific KPI styling when the shared summary-card component already expresses the metric hierarchy.
- **Don't** use gradients, glass, glow, hard decorative shadows, oversized hero type, decorative eyebrows, or large routine panel radii.
- **Don't** spend cobalt on decoration or use success, warning, danger, info, or unknown colors outside semantic status.
- **Don't** use placeholder text as a label, generic errors, unexplained icon-only actions, or Yes/No buttons when the action can be named.
- **Don't** shrink table text or touch targets indiscriminately to create density; use grouping, reflow, and input-modality-aware exceptions.
- **Don't** split a short form into artificial steps or hide completed-step context when users need it to verify later answers.
- **Don't** canonize mock values, temporary sample content, or a device-level register unsupported by the production data contract.
- **Don't** hide dashboard information to make a narrow layout fit or introduce page-level horizontal scrolling.
