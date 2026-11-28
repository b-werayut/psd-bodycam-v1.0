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

### Select a range before playback — 27 November 2026

- Moved recorded files directly below the end-time field, with a separator above the list and the playback/download buttons below it.
- File and timeline selections fill the range and update selected metadata/highlights without mounting or replacing the video. Watch is the only action that starts or switches playback. Manual edits clear the file highlight; camera/day changes reset selection and playback.
- Browser: rapid selections initially left zero video elements; pressing Watch opened the real recording (readyState 4). Further rapid file/timeline selections retained the same nonempty video source while updating the draft range. Test playback was stopped afterward.
- Verified field/list/button order at 1680px and 390px, natural 16:9 video, and no horizontal overflow at 390px. Restored the default viewport. Screenshots: `C:/Users/WERAYU~1/AppData/Local/Temp/codex-evidence-qa/select-before-watch-desktop.jpg` and `select-before-watch-mobile.jpg` in the same directory.
- Evidence/player/translation tests: 90 passed. TypeScript/production build and ESLint passed; existing bundle-size advisories remain.

### Empty player and inspector sections — 27 November 2026

- Before selecting a recording or entering a valid range, the player shows “ยังไม่มีไฟล์วิดีโอ” with a video-off icon. Selecting a range changes it to the Watch prompt without starting playback.
- Grouped the inspector into summary, time fields, recorded files, and actions, separated by full-width rules. Each group has 12px desktop / 16px mobile padding; the actions have a subtle surface tint.
- Browser checked with two real recordings: initial empty message, selection prompt, zero video elements before Watch, and unchanged 16:9 ratio. At 390px the content has no horizontal overflow; file rows, separators and keyboard-focused actions remain visible and aligned.
- Screenshots in `C:/Users/WERAYU~1/AppData/Local/Temp/codex-evidence-qa/`: `empty-player-sections-desktop.png`, `empty-player-sections-mobile-actions.jpg`. Default viewport restored and the page left with no selection.
- Evidence/player/translation tests: 90 passed. TypeScript/production build and ESLint passed.

### Search sidebar and bottom recordings — 27 November 2026

- Latest layout request moves camera/day/file search into the adjacent controls card and returns recorded files below the timeline. Search, selected metadata, time fields and actions retain full-width separators; file choices use a responsive grid.
- Search fields form two compact rows when their container is at least 400px wide, and stack in narrower cards. At 1680x900 the player and controls card both measure 560.984px high; the search section is 180px high. The picture remains 16:9 and the page uses the full available width.
- Browser verified selecting a real bottom file fills the start/end fields and updates the timeline while leaving zero video elements. Local file filtering from the sidebar reduced the list to one matching recording. Playback still requires Watch; download feedback still appears only after a request below its button.
- At 390px the controls stack, file choices form one column, and main-content client/scroll widths both equal 380px. Restored the default viewport and left the page without a selection.
- Screenshots in `C:/Users/WERAYU~1/AppData/Local/Temp/codex-evidence-qa/`: `search-sidebar-desktop-idle.jpg`, `search-sidebar-desktop-files.jpg`, `search-sidebar-mobile-files.jpg`.
- Evidence/player/translation tests: 90 passed. TypeScript/production build, ESLint and scoped diff checks passed. No new real playback or MP4 export was requested during this layout QA.

### Search work orders using the selected camera — 27 November 2026

- Replaced the free-text recording filter with a searchable work-order dropdown. Its choices come from actual work orders for the selected camera and their actual work period on the selected Bangkok day. Search matches work-order number/title; clearing restores all recordings.
- Added optional `deviceId` filtering to `GET /work-orders`, before counting/pagination. Camera code, vendor ID and serial references use the existing resolver precedence; unknown/deleted cameras return no matches. Existing `work-orders:read` permission remains required.
- The client reads all scoped pages, handles loading/errors/retry/no permission, and resets its choice when camera/day changes. Choosing a work order fills the clipped actual period and filters overlapping recording files. Choosing a file clips playback to that period; playback still requires Watch.
- Browser verified actual camera 101: the API returned four related jobs, two with work periods overlapping 25 November. Searching by title and number, selecting each, no-overlap feedback, clearing, and zero video elements before Watch worked. Fixed and verified reopening a focused dropdown by clicking it again.
- Desktop/mobile captures: `C:/Users/WERAYU~1/AppData/Local/Temp/codex-evidence-qa/camera-work-order-search-desktop.jpg` and `camera-work-order-search-mobile.jpg`. At 390px, client/scroll widths both measured 380px. Default viewport restored; no playback or MP4 job started.
- Validation: full client suite 107 files / 943 tests passed; work-order API integration suite 8 tests passed. Client/server production builds, server typecheck, both ESLint checks and scoped diff checks passed. Rebuilt/restarted the existing local API so its running version accepts the new query parameter; verified the scoped request succeeds.

### Remove the redundant search action — 27 November 2026

- Removed Search because camera/day changes already load recordings and choosing a work order immediately filters them. The work-order dropdown now fills its row; empty-state instructions no longer ask users to press Search. Failed-load retry and explicit Watch/download actions remain available.
- Browser confirmed there is no Search button and the dropdown occupies the available row. Evidence/player/picker/translation tests: 105 passed. TypeScript/production build, ESLint and scoped diff checks passed.

### Playback limits and error feedback — 27 November 2026

- Combined the 24-hour playback and 120-minute export limits into one desktop line. Removed redundant helper text beneath the controls and adjusted section spacing. The first section has 20px top padding so its labels have room above them.
- Evidence playback failures use the existing error toast. The player retains a message inside its fixed video stage; it no longer inserts an error banner above the picture. Other player surfaces retain their existing inline/quiet feedback behavior.
- Browser checked 1680×900 with collapsed navigation: the idle inspector measured 559px for both its client and content height, with no internal scroll. Both limit messages shared the same top coordinate. Video remained 16:9.
- Selecting work order WO-202611-00002 on 25 November and pressing Watch produced the actual no-recording error. The toast appeared, and the video stayed 1px below the inspector's top border before and after failure. Watch's existing scroll-to-player behavior still applies.
- At 390px, both document client and scroll widths measured 380px. The inspector had no internal overflow, and the two limits wrapped naturally. Restored the default viewport and cleared the failed playback by reloading; recording files loaded again. No MP4 export was requested.
- Validation: 10 focused test files / 95 tests passed, including the new toast regression and existing inline player behavior. Client TypeScript/production build and ESLint passed.

## Login: Prism Glass — 27 November 2026

final result: passed

### Visual truth and evidence

- Selected visual: `C:/Git/psd-bodycam-v1.0/output/login-concepts-2026-11-27/03-prism-glass.png` (1823x863 pixels).
- User adjustments: genuine glass card; replace the indigo button with a complementary color; implement in the existing application.
- Implementation: `http://127.0.0.1:5173/login`, Codex in-app browser. Desktop CSS viewport 1824x864, devicePixelRatio 1; source differs by one pixel in each dimension. No stretched reference was used.
- Evidence directory: `C:/Users/WERAYU~1/AppData/Local/Temp/psd-login-qa-20261127/`.
- Desktop captures: `desktop-light.jpg`, `desktop-dark.jpg`; mobile: `mobile-light.jpg`, `mobile-dark.jpg` (390x844); compact viewport 320x640: `mobile-compact.jpg` (310x749 full-page image, excluding the scrollbar).
- Full-view comparison: `comparison-full.jpg`; focused form comparison: `comparison-card.jpg`. Source and implementation were opened together and the real form regions were also compared without stretching either card.

### Required fidelity surfaces

- Typography: existing local Noto Sans Thai Variable retained. Title is 20px/28px; labels, inputs and helper copy retain the application's semantic type scale. Fonts reported loaded; title, card and main page have no foreground blur or transform after arrival. Browser JPEG captures soften fine lettering, so DOM font measurements and the unchanged source logo were also checked.
- Layout: single original 430px card retained rather than the generated mock's approximately 467px card. Desktop measured x697, y124.5, width430, height663. Same logo, title, SSO, divider, credential fields, submit button and audit footer hierarchy. Mobile card is 350x635 at a 390x844 viewport; no horizontal document overflow. Short screens scroll naturally and keep the submit button reachable.
- Colors/materials: pale blue ribbon background matches the selected reference; 44% white card, 32px backdrop blur, saturation, white edge highlights and restrained shadows make the glass surface. The user's requested button deviation is solid muted navy `#16466a` (dark theme `#215b82`) with white text and distinct hover/active states. The former indigo treatment is absent. Dark theme retains the same source image with a darker filter and a translucent navy card.
- Assets: real existing PSD light/dark logos, Microsoft mark and Lucide controls retained. Generated background-only asset `src/assets/auth/prism-glass-background.webp`, 1920x1080, 27,028 bytes. It has no baked-in form, text, logo, lens or map. No additional dependency was installed.
- Copy: existing Thai/English translations and audit message retained. All authentication logic and conditional SSO/password flows remain connected to the existing API.

### Interaction and validation

- Page identity: `/login`, title `PSD — Body Worn Camera`; meaningful login form rendered; no framework overlay.
- Required-field interaction: empty submission marks both credential fields invalid, shows Thai field errors and focuses username without issuing a login request.
- Password visibility: synthetic preview-only text switches to type=text and back to password; cleared afterward without submitting.
- Language: TH to EN updates labels, Microsoft SSO, helper copy and footer, then restored to TH.
- Theme: light/dark switches card, image treatment, logo, dock, fields and button; restored light theme afterward.
- Responsive checks: desktop 1824x864, mobile 390x844 and compact 320x640. Default browser viewport override reset after validation.
- Console: an initial React 18 warning caused by an optional fetchPriority prop was corrected by removing the prop. A fresh reload and all subsequent interactions produced no new warning/error entries.
- Focused auth/theme/design tests: 4 files, 63 tests passed. `npm run build` (TypeScript + production build), `npm run lint` and `git diff --check` passed. Existing large-chunk build advisory remains.
- Production authentication, an actual Microsoft redirect and credentials were not submitted during visual QA; existing automated login tests cover the authentication states.

No actionable P0/P1/P2 visual or interaction findings remain. Intentional deviations are the requested navy action color, the original 430px card width and the established application typography. JPEG capture softness limits pixel-level glyph comparison; responsive geometry and live text styles were verified independently.

### Background generation

Built-in Imagegen, grounded in the selected third concept; WebP encoded at quality 92. Native output: `C:/Users/Werayut Jaisue/.codex/generated_images/01a21c6f-7f10-7ee2-8940-701427841636/exec-51ffc282-2d5c-4126-a5de-5971b9e6e663.png`.

Prompt: Create a background image asset for a premium desktop SaaS login, target 1920x1080 landscape. The attached image is the selected visual reference. Reproduce only its background art, faithfully matching the soft pale ice-blue/cool-white and slight periwinkle atmosphere. Broad softly flowing translucent satin/light ribbons in the extreme upper-right and lower-left corners, with fine luminous white edges and graceful curves. Center is quiet, pale, low contrast, luminous and open for a real glass login card placed later in HTML. Large calm negative space, subtle frosted atmospheric depth. No harsh purple, saturated rainbow, objects, camera or world map. Background only: omit all UI, central card or rectangular shape, logos, text, fields, buttons and language/theme controls. No ghost outlines, central card shadow, border or watermark. Seamless full-bleed background, no device or presentation framing.
