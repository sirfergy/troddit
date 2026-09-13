# Impeccable for Troddit

Impeccable is installed for project-scoped GitHub Copilot use. The upstream skill
and its four companion agents are vendored unchanged, with licensing and
provenance retained. No automatic edit hooks or CI quality gate were enabled.
Application code and dependencies are unchanged.

## Interactive use

Start Copilot CLI from this checkout, then use:

```text
/impeccable audit
/impeccable audit src/components/settings/Settings.tsx
```

For a session started elsewhere, Copilot's `/add-dir <checkout>` command loads
that directory's project skills and agents as trusted configuration. Run the
skill's terminal commands with the working directory set to this project.

The engine can also be invoked directly:

```sh
.github/skills/impeccable/scripts/impeccable engine-probe
.github/skills/impeccable/scripts/impeccable detect --json src styles tailwind.config.js
```

On Windows without a POSIX shell, use `scripts/impeccable.cmd`.

The detector exits `0` when no primary findings were returned, `2` when findings
were returned, and `1` when a target could not be scanned. An empty detector
result is **not** an accessibility or overall quality pass: the agent-led audit
also checks implementation and rendered behavior.

[`PRODUCT.md`](../../PRODUCT.md) records the product context confirmed by the
maintainer. No new visual direction or `DESIGN.md` was invented.

## Copilot reviews

[Repository review instructions](../copilot-instructions.md) require Copilot to
read the vendored skill and audit playbook for changes affecting Troddit's UI.
Reviews stay read-only and focus on concrete, PR-relevant findings rather than
rerunning the historical whole-app audit or treating style heuristics as bugs.

The detector is used only when a trusted native engine is already provisioned
and the review host permits execution. The
[dedicated CCR setup workflow](../workflows/copilot-code-review.yml) installs
the Linux x86-64 engine before the review. It pins version `0.1.5` and its
SHA-256, checks the vendored `scripts/VERSION`, verifies the download before
installation, and runs an identity probe plus a fixed detector positive control.
It does not invoke the vendored launchers or reinstall the vendored skill.

The native engine is installed as `/usr/local/bin/impeccable-engine`, outside
the checkout and under a distinct name from the auto-downloading launcher.
Reviewers invoke it directly from the checkout root with
`IMPECCABLE_SKILL_DIR=.github/skills/impeccable`; no setup-workspace absolute path
or Actions environment-variable handoff is required.

The workflow's PR/manual run validates installation and execution on Linux.
It is not evidence that a CCR review invoked the detector. After merging the
workflow, inspect a real review's setup/session logs to establish that handoff.
If a setup step fails, Copilot can continue without the engine; availability
and review-host permissions must still be checked.

The setup also probes an end-of-job logging channel using a commit-pinned action.
Match `IMPECCABLE_TRACE_PROBE_MAIN` and `IMPECCABLE_TRACE_PROBE_POST` by probe ID
in the actual reviewer job log, and verify that the post marker follows the
reviewer work. This checks that action state and a temporary file survive until
cleanup; it does not wrap the engine or establish detector invocation. A missing
post marker is an unverified collection path, not evidence of zero detector calls.
`IMPECCABLE_TRACE_PROBE_POST_ENTERED` distinguishes callback entry from successful
state verification. The probe is left under `RUNNER_TEMP` for runner cleanup, so
an unrelated cleanup failure cannot hide the logging evidence.
Changes to the probe require refreshing its action commit pin in the workflow.

Review instructions do not grant network access or enable restricted tools.
The launcher can download an engine, so reviewers must not use it to bootstrap
tools. Missing detector or rendered evidence is a coverage limitation, not a pass.

Review mode does not use Live. The pinned upstream Live helpers have known
storage/session limitations: blocked browser storage can interrupt initialization,
and project changes can reuse stale scroll state. Those optional interactive
helpers remain unmodified; they are separate from the read-only review path.

## Initial audit

See [the audit report](audit.md) and [compact evidence](evidence.json). The audit
used the installed `SKILL.md`, its `reference/audit.md` playbook, the actual
detector, source inspection, and local browser observations. It did not apply
the recommended UI fixes.

## Version and update policy

- Skill: **4.3.1**, upstream tag `skill-v4.3.1`, commit
  `cd12f8660e2dde57b9615c8a6b8ea674101f9cfc`.
- Installer: **4.0.1**, the newest npm release allowed by the local seven-day
  release-age setting at installation time.
- Engine used for this audit: **0.1.5**. Its downloaded macOS ARM64 binary was
  checked against the official release checksum.

The official installation command used was:

```sh
npm exec --yes --package=impeccable@4.0.1 -- impeccable install -y --providers=github --scope=project --no-hooks
```

Pinning the installer alone does not pin future skill downloads. This repository
preserves the installed source; all 57 vendored skill, agent, and license files
were verified against the upstream release. When updating, review the new
upstream contents and refresh the provenance and licensing together.

Platform binaries are ignored by Git. The upstream launcher can use an installed
engine or download the version in `scripts/VERSION`, verifying its checksum.
Environment overrides and preinstalled engines follow the upstream launcher's
normal precedence.

See [provenance.json](provenance.json), the vendored
[Apache license](../skills/impeccable/LICENSE), and
[third-party notices](../skills/impeccable/NOTICE.md).
