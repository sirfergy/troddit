# Impeccable for Troddit

Impeccable is installed for project-scoped GitHub Copilot use. The upstream skill
and its four companion agents are vendored unchanged, with licensing and
provenance retained. No automatic edit hooks or CI quality gate were enabled.
Application code and dependencies are unchanged.

## Use

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
