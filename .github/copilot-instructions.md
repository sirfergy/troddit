# Copilot review instructions

The guidance below applies to code reviews, not implementation tasks.

## Use Impeccable for UI-impacting reviews

When reviewing changes that affect Troddit's interface or user-facing behavior
(components, styles, forms, navigation, theming, responsive layouts, or shared
view state), read and apply the actual vendored Impeccable guidance:

- `.github/skills/impeccable/SKILL.md`
- `.github/skills/impeccable/reference/audit.md`
- `PRODUCT.md` and existing `DESIGN.md` or surface briefs, when present

Use its technical audit criteria in the context of Troddit's existing,
content-first desktop/mobile interface. Preserve intentional themes and patterns.
Do not substitute a generic checklist while claiming Impeccable was used.
For changes with no application-UI impact, perform the normal code review.

## Read-only review mode

Apply the audit criteria, not Impeccable's authoring or repair workflows. Do not
edit files, conduct setup interviews, create design documents, enable hooks,
start servers, generate assets, or run init, document, Live, or remediation
commands as part of a review. Host permissions and review constraints still
apply; these instructions do not grant additional execution or network access.

Use provided screenshots/previews and permitted read-only tools when available.
Distinguish source reasoning from rendered verification. Never claim a browser,
touch, contrast, or performance check ran without the corresponding evidence.

Run `detect --json` on relevant changed UI sources only when a trusted native
engine matching `.github/skills/impeccable/scripts/VERSION` is already provisioned
and execution is permitted. The dedicated CCR setup workflow provisions
`/usr/local/bin/impeccable-engine` on Linux. Run from the checkout root with
`IMPECCABLE_SKILL_DIR=.github/skills/impeccable` so the native engine can locate
the pinned skill resources. Check `engine-probe` before relying on it.
Invoke the native engine directly. Do not use npx,
installers, updates, or the auto-downloading repository launcher to provision
tools during review. If unavailable, use the vendored audit guidance and
existing project documents without the detector; disclose that coverage limit
in the review summary when the host supports one.

For detector output, exit 0 or 2 means a completed scan; exit 1 means an incomplete
scan. Missing or malformed JSON is unavailable evidence. Zero findings is not
proof that the broader UI audit passed.

A setup failure can still leave Copilot running without the engine. Do not infer
tool availability or actual detector use merely from the presence of the YAML.

## Report actionable PR findings

Review the current diff and relevant surrounding implementation. Report issues
introduced, worsened, or newly exposed by the change, with concrete user impact
and a specific recommendation. The audit/evidence files in `.github/impeccable/`
are historical context, not proof of the current head's behavior.

Verify detector matches and standards claims in context. Do not turn font,
gradient, or other taste-only heuristics into blocking correctness findings.
Keep source-backed, detector-backed, and rendered findings distinguishable; cite
the detector's `antipattern` identifier only when it actually produced the finding.

Return findings through the host's normal review output. Use a valid repository
path and PR-diff line for inline comments; never invent an anchor for line 0,
URL-only, or otherwise unmappable output. Use a summary when no reliable anchor
exists and the host supports one; otherwise omit the unanchorable finding.
Deduplicate existing comments and omit unrelated pre-existing issues, whole-app
scores, and generic polish checklists unless explicitly requested.
