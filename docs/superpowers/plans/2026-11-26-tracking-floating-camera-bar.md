# Tracking Floating Camera Bar Implementation Plan

**Goal:** Apply the supplied reference directly to code: compact directory left, full-height map right, selected camera details floating inside the map at the bottom.

**Spec:** `output/tracking-layouts/revisions/floating-card-reference.png`, plus the explicit instruction that the card overlaps the map rather than occupying a separate row.

**Architecture:** Keep the live data hook, route switch, semantic tokens and permissions. `CameraDirectoryPanel` handles compact selection/search/filtering. `SelectedCameraBar` presents details and reports its height; `LiveMapViewport` uses that height as map-fit padding. Mobile directory access uses the existing Dialog component.

**Tech Stack:** React, TypeScript, Leaflet, existing UI components, Tailwind, Vitest.

- [x] Update integration tests for directory/floating-card behavior; observe failures against the table implementation.
- [x] Implement the components and integrate the full-height workspace, mobile directory and overlay fit padding.
- [x] Verify behavior, desktop/mobile geometry, full client tests, typecheck, lint and build.

No backend endpoints, authentication rules or live data contracts are changed.
