# Tracking Full-area Map Implementation Plan

**Goal:** Fill the workspace with the map, remove the permanent camera-directory column and retain the original application menu. Camera search/filter/selection opens through a menu button.

**Spec:** User-provided `output/tracking-layouts/revisions/full-map-reference.png` and explicit request to remove the left camera card.

**Architecture:** Position MapCanvas edge-to-edge inside LiveMapPage. Float a compact toolbar above it and retain selected details at the bottom. Mount the existing directory in Dialog only when opened. Feed measured toolbar/card heights to LiveMapViewport fit padding.

**Tech Stack:** React, TypeScript, Leaflet, existing Dialog and theme components, Vitest.

- [x] Add and observe failing coverage for a menu-only directory with persistent search.
- [x] Implement full-area map/menu layout and top/bottom overlay padding; update integration interactions.
- [x] Verify desktop/mobile geometry, search/filter/selection and all client checks.

Production authentication, realtime snapshot contracts and the existing application navigation are unchanged.
