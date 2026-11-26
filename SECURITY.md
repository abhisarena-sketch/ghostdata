# Security policy

## Supported versions

Security fixes are made on the latest release line (currently 0.1.x).

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Include the affected version, steps to reproduce, and the impact you expect. Do not include real personal data in reports.

We aim to acknowledge reports within 5 working days and to agree a disclosure date with you once a fix is ready.

## Scope

In scope: code execution from config files, schemas or imported data; path traversal or unsafe file writes in the CLI; data leaving the machine (uploads, telemetry, network calls); source values appearing in logs, errors or reports; generated values that are real identities or usable credentials; denial of service from small inputs (for example pattern or parser blow-ups).

Out of scope: personal data that detection misses. Detection is documented as heuristic; please report misses as normal issues with fictional examples.

## Design

See the [privacy and security guide](docs/privacy.md) for how DataGhost handles data.
