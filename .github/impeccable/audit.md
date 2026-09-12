# Troddit: initial Impeccable audit

## Implementation integrity verdict

**Pass, with technical hardening needed.** Troddit has a coherent, content-first
reading interface, a shared theme-token system, and purpose-built feed/thread
controls. The findings below do not justify replacing its visual identity.

This is an **Impeccable-guided technical audit**, not a visual redesign or a
compliance certification. The installed audit playbook supplied the dimensions
and severity rubric; the scores are the agent's assessment, not detector output.

## Audit health score

| Dimension | Score | Evidence |
|---|---:|---|
| Accessibility | 1/4 | Unnamed mobile navigation, incorrect tab semantics, low contrast, and invisible keyboard focus |
| Performance | 3/4, provisional | Virtualized feed; one confirmed hydration fallback. Production device performance was not benchmarked |
| Responsive design | 2/4 | Default widths work, but large text clips controls and several touch targets are small |
| Theming | 2/4 | Light/dark switching works and tokens are shared, but muted-text contrast fails in both tested palettes |
| Implementation integrity | 3/4 | Coherent product-specific interface; isolated semantic/runtime defects |
| **Total** | **11/20** | **Acceptable: significant work needed** |

The performance score is provisional. No production LCP/INP, real-device frame
rate, or large-feed bandwidth claim is made.

## Scope and method

- Application: `0.21.1`, commit `2a36ceb7491544a9437753f71310bc3a5590c1cc`.
- Runtime: an existing production build verified against the same application
  source tree; build ID `_6KEXf6Va_veBnsx7g4qe`.
- Tooling: Impeccable skill `4.3.1`, engine `0.1.5`.
- Surfaces: Settings and all seven sections, feed, direct thread, About, App
  updates dialog, and a targeted media-viewer check.
- Chromium and WebKit; desktop `1440x900`, iPhone-style mobile viewport
  `390x664`; light and dark themes.
- One completed 13-state batch per engine, followed by five targeted
  confirmation states per engine. Confirmation was captured on September 12,
  2026 UTC.
- Reddit content and authentication responses were local fixtures. Media
  confirmation used valid HTTPS fixture URLs with page-level request mocks and
  service-worker networking disabled.
- The original batch covered text/link-style cards; the confirmation used
  complete preview metadata and verified that image content rendered.
- No physical iPhone, production account, external provider-embed availability,
  full OAuth flow, or exhaustive motion/performance audit was performed.
- **No application UI changes were made.**

Compact measurements are in [evidence.json](evidence.json). Screenshots, raw
measurements, and the browser harness were retained in the local CLI session,
not added to the application.

### What the detector returned

The actual source command was:

```sh
.github/skills/impeccable/scripts/impeccable detect --json src styles tailwind.config.js
```

It completed with exit `0` and **zero source findings**. A deliberately poor
HTML/CSS positive control returned exit `2` and six findings, confirming that
the detector was operational.

Zero source-pattern matches did **not** mean the interface passed the broader
audit. The verified issues below came from the installed audit playbook's
code-level and rendered checks. This distinction is especially important for
dynamic React markup and theme tokens.

## Executive summary

**Seven actionable findings: 0 P0, 5 P1, 2 P2, 0 P3.**

The highest-value work is to repair Settings navigation semantics and labels,
make keyboard focus visible, improve text contrast, and make the mobile shell
tolerate larger text. This is accessibility and responsive hardening, not a
request for a decorative redesign.

## Detailed findings

### F1 - [P1 Major] All seven mobile Settings navigation items are unnamed

- **Location:** `src/components/settings/Settings.tsx:276-300`, especially
  line 296.
- **Category:** Accessibility.
- **Evidence:** Both engines expose seven `tab` roles with empty accessible
  names at mobile width. The same tabs have names at desktop width. The
  `hidden sm:block` category text is the only text label; the SVG icons do not
  provide replacement names.
- **Impact:** A screen-reader user cannot identify Appearance, Layout, Media,
  Comments, Filters, Behavior, or History from this navigation.
- **Standard:** WCAG 4.1.2, Name, Role, Value.
- **Recommendation:** Provide a persistent programmatic name independently of
  whether the visible label is hidden. Coordinate this with F2.
- **Suggested command:** `/impeccable harden` targeting Settings navigation.

### F2 - [P1 Major] Settings presents tabs but implements scroll navigation

- **Location:** `src/components/settings/Settings.tsx:250-321`.
- **Category:** Accessibility / Implementation integrity.
- **Evidence:** There are zero `tabpanel` elements and no `aria-controls`
  relationships. Selecting Media with two Arrow Down presses, then pressing
  Tab, focuses **Theme options in Appearance**, in both engines.
- **Impact:** Keyboard and assistive-technology behavior does not match the
  selected tab or the user's current location.
- **Standard:** WAI-ARIA Tabs Pattern; relevant to WCAG 2.4.3, Focus Order.
- **Recommendation:** Preserve the intended scrolling layout with correctly
  named in-page navigation and explicit destinations, or implement real
  tab/tabpanel behavior. Do not fix only the visible labels.
- **Suggested command:** `/impeccable harden` targeting Settings navigation.

### F3 - [P1 Major] Muted text and operable inactive labels have insufficient contrast

- **Location:** `styles/globals.css:9,41`;
  `src/components/settings/Settings.tsx:283`; consumers of `text-th-textLight`.
- **Category:** Accessibility / Theming.
- **Evidence:** Small feed metadata and comment-count links measure
  **2.43:1 in light mode** and **3.60:1 in dark mode**. Unselected desktop
  Settings labels measure **3.36:1 light** and **4.39:1 dark**, after their
  50% opacity is composed with the background. Text sizes are 12-16px.
- **Impact:** Reading post context and locating controls is unnecessarily
  difficult, especially for users with low vision.
- **Standard:** WCAG 1.4.3 requires 4.5:1 for this ordinary-sized text.
  Unselected but operable navigation is not an inactive-control exemption.
- **Recommendation:** Adjust muted-text tokens per palette and the opacity of
  operable Settings labels. Preserve the palette rather than recoloring the app.
- **Suggested command:** `/impeccable colorize` scoped specifically to contrast
  in the existing theme tokens and labels.

### F4 - [P1 Major] The main Options button has no visible keyboard focus cue

- **Location:** `src/components/NavMenu.tsx:77-87`.
- **Category:** Accessibility.
- **Evidence:** Keyboard-origin focus reaches the button, but its outline is
  transparent, its border is transparent, and there is no box-shadow,
  background, or foreground change. The only computed-style change is from
  no outline to a transparent outline. Both engines reproduce this.
- **Impact:** A keyboard user cannot see that the main options control has focus.
- **Standard:** WCAG 2.4.7, Focus Visible.
- **Recommendation:** Add an intentional `focus-visible` treatment; a hover-only
  border is not a keyboard-focus replacement.
- **Suggested command:** `/impeccable harden` targeting navigation focus states.

### F5 - [P1 Major] Large-text stress testing clips mobile navigation and Settings

- **Location:** `src/components/NavBar.tsx:120-203`;
  `src/pages/settings.tsx:6-8`;
  `src/components/settings/Settings.tsx:258-310`.
- **Category:** Responsive design.
- **Evidence:** At a 390px viewport with the root text size doubled to 32px,
  Filters starts at **502px** and Options at **590px**, outside the viewport.
  The document remains 390px wide with horizontal overflow hidden, while
  Settings navigation is also partially clipped to the left.
- **Impact:** Important controls become unreachable by pointer/touch in this
  enlarged-text state.
- **Standard:** Relevant to WCAG 1.4.4, Resize Text. This was a **root-font-size
  stress test**, not a claim that physical iOS text-size settings or every
  browser-zoom mode were tested.
- **Recommendation:** Allow the header to adapt and the Settings content to
  shrink/reflow; avoid relying on fixed, non-shrinking widths that grow with text.
- **Suggested command:** `/impeccable adapt` targeting the mobile header and
  enlarged-text Settings layout.

### F6 - [P2 Minor] Several frequently used touch targets are small

- **Location:** `src/components/cards/Card1.tsx:638-675,804-851`;
  `src/components/PostOptButton.tsx:73`.
- **Category:** Responsive design.
- **Evidence:** Feed vote buttons are **20x20px**; feed post-options controls are
  **18x26px**. The main Options button is **40x36px**.
- **Impact:** Precise taps are required for routine reading actions.
- **Standard:** Impeccable recommends 44x44px targets. WCAG 2.5.8's AA minimum
  is 24x24px with exceptions; **not every target below 44px is an AA failure**.
  Spacing/equivalent-control exceptions were not exhaustively evaluated here.
- **Recommendation:** Expand the interactive hit areas without unnecessarily
  enlarging the icons or abandoning the compact reading layout.
- **Suggested command:** `/impeccable adapt` targeting feed and thread controls.

### F7 - [P2 Minor] About produces hydration errors from invalid block nesting

- **Location:** `src/pages/about.tsx:47-56`.
- **Category:** Performance / Implementation integrity.
- **Evidence:** Direct About navigation emits React hydration errors 418/423 in
  both engines. Its paragraph contains a link wrapping `h4` elements, which
  forces the HTML parser to repair the server markup before React hydrates it.
- **Impact:** The page recovers, but performs avoidable client rendering and
  starts with runtime errors. This was not observed on the other sampled routes.
- **Standard:** HTML content-model and hydration correctness; not an obsolete
  WCAG 2.2 "Parsing" claim.
- **Recommendation:** Use a valid block container or phrasing content for the
  version/changelog row, then check a fresh direct navigation.
- **Suggested command:** `/impeccable harden` targeting About markup.

## Patterns and false-positive handling

- Settings mixes visual scroll navigation with tab semantics. Treat F1/F2 as a
  coordinated fix rather than seven unrelated label patches.
- Contrast problems recur through shared tokens and opacity utilities; fix the
  underlying values instead of individual text instances.
- Many controls remove outlines and rely on hover styling. F4 is a reproduced
  example, not a claim that every outline-free element lacks another focus cue.
- Decorative/redundant `r/` avatar glyphs were excluded from the contrast issue.
- Opaque-image/gradient backgrounds and disabled controls were not treated as
  ordinary text-contrast failures by the measurement pass.
- Eager image loading in a virtualized list was not reported as a performance
  defect without a workload/profile showing harm.
- Compact post cards, system typography, and existing themes were not treated as
  generic "AI slop" merely for using common UI patterns.

## Positive findings to preserve

- Shared semantic theme tokens and working light/dark switching.
- No document-width overflow at the default tested sizes.
- A virtualized feed rather than mounting the entire browsing history.
- Image alt text based on post titles in the confirmed media fixtures.
- App updates dialog: Tab and Shift+Tab wrap correctly; Escape closes it.
- Synthesized horizontal touch cancellation restored the media viewer from
  `translate3d(200px, 0px, 0px)` to zero while leaving the viewer open, in both
  engines. This verifies the JavaScript gesture path, not physical-device
  compositor behavior.

## Recommended next passes

1. **[P1] `/impeccable harden`** - Settings names/semantics and navigation focus;
   include the small About markup repair.
2. **[P1] `/impeccable adapt`** - Large-text/mobile reflow, then touch hit areas.
3. **[P1] `/impeccable colorize`** - Contrast-only changes within existing themes.
4. **Final `/impeccable polish`** - Check the repaired states together without
   replacing the existing visual identity.

Re-run `/impeccable audit` after the chosen fixes. These are recommendations,
not changes applied by this setup PR.

## Reference criteria

- [Contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- [Name, role, value](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html)
- [Tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
- [Focus visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html)
- [Resize text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html)
- [Target size minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
