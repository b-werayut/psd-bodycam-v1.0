# Tracking camera directory: persistent tree rail

final result: passed

## Reference and rendered evidence

- Latest user reference: `C:/Git/psd-bodycam-v1.0/output/tracking-layouts/revisions/tree-rail-reference.png`.
- Desktop screenshot: `C:/Git/psd-bodycam-v1.0/output/tracking-layouts/verification/tree-rail-desktop.jpg`, CSS viewport 1280x720.
- Mobile screenshot: `C:/Git/psd-bodycam-v1.0/output/tracking-layouts/verification/tree-rail-mobile.jpg`, CSS viewport 390x844.
- Source and desktop implementation were opened together for visual comparison. The scope is the highlighted camera directory beside the existing application navigation.
- Browser: Codex in-app browser, http://127.0.0.1:5174/tracking. The isolated preview imports real application components with eight fictional camera snapshots and a no-op realtime provider. Production authentication and backend code are unchanged by this correction.

## Result

The camera directory is a persistent, borderless white rail beside the desktop application navigation. It includes the compact heading and online count, search, collapsible group with a building icon and count, vertical branch line, and plain camera rows. Each row uses a status dot, small camera icon, name, and a secondary code/type/status line. The selected row has a subtle blue background. Rounded device cards and the desktop directory-menu trigger have been removed from this view.

The map fills the remaining right workspace without a page gutter or outer card. The toolbar and selected-camera details float inside the map. Existing live-view permissions, route links and realtime marker behavior remain connected.

Measured desktop geometry: application navigation x0..232; directory x232,y56,width320,height664; map x552,y56,width728,height664. Document width equals the 1280px viewport. On mobile the map is x0,y56,width390,height788; the same directory is available from the camera-list button and closes after selection. No document overflow was observed.

The mobile dialog heading reserves space for its close button. Verified close-button bottom y225.81 and search-input top y229.81; their hit areas do not overlap.

## Content boundaries

Tracking snapshots do not include company membership. The collapsible group is therefore labeled “กล้องในระบบ” / “System cameras”; the screenshot's company name is not fabricated. The reference's talk-to-camera footer belongs to Live Wall and was not introduced into Tracking. Its drag-to-video helper is adapted to selecting a camera on the map. Existing status filters remain available from the compact button inside the search field.

## Verification

- Browser: search automatically expands the group and returns the matching camera; collapse hides rows; offline filter returns the offline camera; selecting a row highlights it and opens the floating details bar.
- Mobile: camera list opens with the same tree presentation; selecting a camera closes the dialog and updates map details.
- Map tiles loaded, no framework error overlay, browser warning/error console empty.
- Focused tracking, route-view and translation tests: 25 passed.
- Full client suite: 100 files, 880 tests passed.
- TypeScript, ESLint, production build and tracking diff whitespace check passed. The existing bundle-size advisory remains.
- Test log: `output/tracking-layouts/verification/tree-rail-tests.log`.
- Build log: `output/tracking-layouts/verification/tree-rail-build.log`.

No actionable P0/P1/P2 findings remain in this correction. Visual QA used fictional snapshots; production sign-in and real DSS playback were not exercised.

## Evidence playback layout — 26 November 2026

final result: passed

### Visual truth and evidence

- User-selected layout: `C:/Users/WERAYU~1/AppData/Local/Temp/codex-clipboard-25f42190-c357-4de0-a9a1-0691c40e20d3.png` (936x782).
- User-selected idle player: `C:/Users/WERAYU~1/AppData/Local/Temp/codex-clipboard-9507b9d6-e867-4f72-b3dc-4e6efce183e5.png` (654x365).
- Evidence folder: `C:/Users/WERAYU~1/AppData/Local/Temp/codex-evidence-qa/`.
- Final desktop: `desktop-idle-final.jpg`, CSS viewport and screenshot 1440x1024, 1:1 pixel density.
- Empty search: `desktop-empty.jpg`; dark theme: `desktop-dark.jpg`.
- Mobile: `mobile-evidence.jpg`, CSS viewport 390x844, full-page capture.
- Full-view comparison: `layout-comparison.jpg`. The existing 232px application navigation was excluded and the remaining implementation was proportionally scaled to the 936px reference width.
- Focused player comparison: `idle-comparison.jpg`. Both references and the normalized implementation were opened together. The selected layout's populated player is intentionally replaced with the user's separate idle design when no clip is playing. Real recording availability determines the number of file buttons.

### Findings and corrections

- Initial P2: stacked range fields and separate full-width action buttons made the inspector taller than the video and pushed the timeline below the desktop viewport. Corrected with horizontal field labels, adjacent playback/download actions, and tighter inspector spacing.
- Initial P2: excess ruler spacing and tall file buttons made the bottom panel too tall. Corrected with a compact ruler and metadata row. The final desktop empty timeline ends at y992 in the 1024px viewport; the playback inspector ends at y658.
- Recaptured and compared the final implementation after both corrections. No actionable P0/P1/P2 findings remain.

### Required fidelity surfaces

- Typography: existing Noto Sans Thai Variable and readable semantic type scale retained. Title, field labels, selected recording, and timeline remain in the reference's hierarchy.
- Layout: player left, selected recording/range inspector right, full-width day ruler and file buttons below. On mobile these stack without horizontal document overflow (390px viewport and scroll width).
- Colors: existing light/dark PSD tokens and cobalt selection/primary states retained. Player uses the existing dark stream surface with an outlined Play icon before selection, and VideoOff with an explicit message after an empty search.
- Assets: source product logo and Lucide icons retained; production footage comes from the real StreamPlayer. No illustrative park footage or invented recordings were added.
- Copy: all new strings have Thai and English entries. Work-order metadata is read-only, and the reference's search input filters returned times/work orders locally without issuing an audited platform search while typing.

### Interaction and validation

- Browser: Codex in-app browser, `http://localhost:5173/evidence`, local documented operator test account.
- Selected a real camera and clicked its timeline interval. Player opened, start/end fields filled, selected metadata updated, and both timeline/file controls reflected the selected state.
- Entered an unmatched file query and verified the no-match message. Changing the day reset the player and query. A real day with no recordings showed "ยังไม่มีวิดีโอให้เล่น" and an empty availability ruler.
- Checked desktop, mobile, and dark theme, input clipping, page identity, meaningful content, and absence of framework overlays. Browser warning/error logs were empty. Restored the default viewport and left `/evidence` open.
- Full client suite: 105 files, 922 tests passed. Tests cover midnight clipping, fixed 24-hour timeline positions, keyboard selection, local filtering, range validation, and existing download behavior.
- TypeScript/production build and full client ESLint passed. Existing bundle-size advisories remain. Test log: `C:/Users/WERAYU~1/AppData/Local/Temp/codex-evidence-tests.log`; build log: `C:/Users/WERAYU~1/AppData/Local/Temp/codex-evidence-build.log`.
- MP4 generation/download was verified by the existing automated tests; a new real MP4 export was not requested during browser QA.

Implementation checklist complete for the initial layout. See the playback-height correction below for the subsequent user-reported issue.

## Evidence panel-height correction — 26 November 2026

final result: passed

- User evidence: `C:/Users/WERAYU~1/AppData/Local/Temp/codex-clipboard-fafa2618-34ef-4ced-baad-6fb34522a7c7.png` and `codex-clipboard-5801019e-93ad-4640-bea8-339a73e02e05.png` in the same folder.
- Reproduced with real playback at 1680x900 and a collapsed sidebar: the player was 682px tall, inspector 413px, document 1248px. Clicking a recording scrolled the page to y266, cutting off the video top and exposing a large external gap below the inspector.
- Fix: the desktop page reserves space for its heading, controls and bounded recording list; the remaining shared row determines both player and inspector height. StreamPlayer uses its existing fill mode, retains object-contain and its session/audit footer, and stays at the natural 16:9 ratio in the mobile stack. Inspector feedback and long recording lists scroll internally.
- First correction found a partially clipped recording button inside the bottom list. Increased that panel's allowance to 256px so a full 64px button plus focus padding is visible. Tightened desktop inspector spacing so both primary actions fit in the shorter laptop viewport.
- Final 1680x900: player and inspector both 352px high, y252..604; timeline bottom y876; document height 900px, scroll y0. No external mismatch or horizontal overflow.
- Final 1366x768 after clicking a file: player and inspector both 336px high, y136..472; timeline ends at y744; both playback and MP4 actions fully visible; video readyState 4. Normal short-screen page scroll remains, while the complete player and timeline are visible together.
- Mobile 390x844: video stage 346x194.625 (16:9), document scroll width 380px; normal stacked layout retained.
- Evidence in `C:/Users/WERAYU~1/AppData/Local/Temp/codex-evidence-qa/`: `fit-before.jpg`, `fit-desktop-playing.jpg`, `fit-laptop-playing.jpg`, `fit-mobile-idle.jpg`, and the combined `fit-comparison.jpg`. Before/after use the same camera, day and recording; the changed scroll position demonstrates the correction. Font, color, logo and copy tokens are unchanged; video is fitted rather than cropped.
- An initial hot reload raced the newly created stylesheet and logged a Vite reload error. Reloading after the stylesheet existed resolved it; no subsequent app error or framework overlay appeared. Browser full-page mobile screenshot timed out, so the mobile evidence uses a viewport screenshot and DOM measurements.
- Full client suite: 105 files, 922 tests passed. Production build/TypeScript and full ESLint passed. Logs: `C:/Users/WERAYU~1/AppData/Local/Temp/codex-evidence-fit-tests.log` and `codex-evidence-fit-build.log` in the same folder.
- Test playback stopped after verification; default browser viewport restored. No actionable P0/P1/P2 findings remain.

## Evidence full-width correction — 27 November 2026

final result: passed

- Latest user instruction permits vertical scrolling and requests removal of the large outside margins. This supersedes the earlier viewport-fitting width constraint.
- Removed both the fixed 1280px page cap and the viewport-height-dependent maximum width. The existing 1.85:1 workspace split, natural 16:9 player and equal-height inspector remain in place. There is no fixed page height.
- Source: `C:/Users/WERAYU~1/AppData/Local/Temp/codex-clipboard-b43cb4e9-59ab-45e6-ba38-f767ce4767ca.png`.
- Rendered evidence: `C:/Users/WERAYU~1/AppData/Local/Temp/codex-evidence-qa/full-width-desktop.jpg`.
- At 1680x900 with collapsed navigation, page width is 1550px, exactly the available main-content width after its standard 24px gutters. Player stage is 993.75x558.984375 (16:9), and player/inspector are both 560.984375px high.
- At 1366x768 with expanded navigation, page width is 1076px with equal 24px gutters; stage ratio remains 16:9. No horizontal document overflow at either size. Vertical scrolling is intentional.
- Inspected the rendered screen, toggled navigation and checked browser console (no warnings/errors). Default viewport and collapsed navigation restored.
- Focused evidence/player tests: 75 passed. TypeScript/production build and full client ESLint passed; existing bundle-size advisories remain. No actionable P0/P1/P2 findings remain for this correction.

## Evidence recording list and MP4 status — 27 November 2026

final result: passed

- Moved the recording list into the right inspector and added the current MP4 export status below it, separated by a horizontal rule. The bottom timeline retains its selectable bars without repeating the list.
- The download section has an idle explanation and preserves queued, conversion progress, ready/download, permission, failure/retry and expiry behavior. Thai and English copy remain in parity.
- Browser: selected the real 17:06–18:11 recording, verified matching input values and timeline selection, and confirmed video readyState 4. The stage remains exactly 16:9; the inspector matches the player height and scrolls as needed.
- Checked a 390px viewport: main content has equal client/scroll widths, the stage remains 16:9, and the inspector expands naturally in the mobile stack. Restored the default viewport and stopped test playback.
- Screenshot: `C:/Users/WERAYU~1/AppData/Local/Temp/codex-evidence-qa/recordings-download-panels.jpg`.
- Verification: full client suite 105 files / 924 tests passed; TypeScript/production build and ESLint passed. MP4 state transitions are covered by automated tests; browser QA did not request a new real export.

### Download feedback refinement — 27 November 2026

- Latest instruction supersedes the persistent MP4 section: the recording list is the only lower inspector section. Download feedback appears immediately below the action buttons only after a request, and disappears when its range is reset.
- Verified hidden idle feedback and two real recording rows in the browser. Pending request, queue/progress/ready, error/retry, permission and expiry behavior pass in the focused tests (43 tests including translation checks); ESLint and TypeScript/production build passed.
- Screenshot: `C:/Users/WERAYU~1/AppData/Local/Temp/codex-evidence-qa/recordings-only-idle.jpg`. Restored the default viewport; no new real MP4 export was requested.
