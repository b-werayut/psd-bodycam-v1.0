# Tracking Map and Camera Table Implementation Plan

**Goal:** Implement the approved tracking image with a large map above a camera table, and search/status filters in the table toolbar below the map.

**Architecture:** Keep the existing tracking snapshot/realtime hook, routes, permissions, selected-marker state and live dialog. Replace the floating camera directory in `LiveMapPage` with a semantic `CameraTablePanel`; reuse the existing table, badges, controls and theme tokens. Update map padding now that the canvas has no overlapping directory.

**Tech Stack:** React, TypeScript, Tailwind, existing shadcn components, Leaflet, Vitest.

**Spec:** User-approved `output/tracking-layouts/revisions/map-register-table-toolbar.png`.

## Constraints

- Preserve ongoing local changes and the current/history view switch.
- Keep production data and permission checks; use fictional data only for isolated visual verification.
- Keep offline live-view actions disabled and stale GPS distinct from connectivity.
- Preserve Thai/English copy parity and mobile/table keyboard access.

## Tasks

- [x] Update tracking integration tests to exercise the camera table, selection, filtering, permissions and live dialog; observe the missing-table failure.
- [x] Create `client/src/features/tracking/components/CameraTablePanel.tsx`, integrate the approved layout in `LiveMapPage.tsx`, update map padding/popup presentation and add translated table labels.
- [x] Run focused tests, full client tests, typecheck/lint/build; inspect desktop/mobile rendering and search/filter/selection in the browser.

## Review Focus

No coordinates must render as missing, stale fixes must not appear current, offline cameras must not open live view, search must filter the table and map consistently, and narrow screens must scroll the table without overflowing the page.
