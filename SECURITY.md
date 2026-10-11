# Security Policy

## Supported versions

Security fixes target the latest stable release in the 1.x series, starting with the initial release, 1.0.0. The historical Python implementation in `legacy-python/` is not maintained for security fixes. Upgrade to the latest stable release before checking whether a problem still exists.

## Reporting a vulnerability

This repository is currently private. Collaborators should open an [issue in this private repository](https://github.com/Taxperia/UpdatePilot/issues/new) and notify the repository owner, `@Taxperia`. Reports are visible to people who can access the repository; they are not confidential from other collaborators.

If the repository becomes public, do not use public issues for vulnerability details. Use GitHub's **Report a vulnerability** feature in the Security tab when it is enabled, or an existing private communication channel with the maintainer. Private vulnerability reporting is not currently enabled for this private repository.

Include:

- The affected UpdatePilot version, Windows version, and architecture.
- A description of the issue and its security impact.
- Reproduction steps or a minimal proof of concept.
- Relevant logs with credentials, personal paths, and unrelated application data removed.
- Any suggested mitigation, if known.

Do not include access tokens or live secrets. Keep exploit details private until the maintainer has assessed the issue and coordinated a fix. Acknowledgment and remediation timing depend on maintainer availability; no response deadline or bounty is promised.

## Security model and limits

- The renderer runs with Node.js integration disabled, context isolation enabled, and sandboxing enabled. IPC requests are restricted to the application's main frame.
- Application discovery reads Windows application records. Downloaded installers are not executed automatically, including when automatic downloads are enabled.
- Direct downloads require HTTPS, including redirect targets. Incomplete or rejected downloads are removed.
- Node.js packages require a matching checksum from the publisher's official `SHASUMS256.txt` file. WinGet download hash verification remains enabled.
- GitHub asset SHA-256 digests are verified when provided. A manual download without a supplied digest has no independent checksum guarantee. HTTPS and checksums do not establish that an installer is safe to execute.
- Release executables are not code signed. `SHA256SUMS.txt` detects a mismatch with the published artifact; it is not a digital signature or proof of publisher identity.
- User-assigned repositories and manual download URLs are chosen by the user. Verify the publisher and package before running an installer.
- Local configuration may contain a GitHub token in plain text. The token is not exposed to the renderer, but local file access must be protected. Redact configuration before sharing it and use a token with only the permissions required.

## Dependency checks

Install dependencies using the committed lockfile with `npm.cmd ci`. Maintainers can run `npm.cmd audit` and `npm.cmd test` before a release. An audit reports known dependency advisories; it does not establish that the application is free of vulnerabilities.
