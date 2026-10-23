# DEVELOPER-SUPPLIED EVIDENCE — not independent acceptance

Logs in this directory were produced for the xAI reviewer prompt rename at code commit `31bfc58b89de137670e5dbaf752c3328b31163f7` (tree `46744fc1dd0cf7a15d0e85c3d4456a604f17dca6`). The test commit is `664974a5ff5c673daad6f130c4e4d01d410fe912`. They do not replace independent reproduction. Commands and checksums are in `MANIFEST.md`.

`J1_XAI_REVIEW_INSTRUCTIONS` now says `Julius mission`. The rest of that prompt does not contain the word Relay. Repo paths and identifiers are unchanged. Other product strings that still say Relay were listed and left unchanged.

`vitest.log` and `vitest.json` are a full-repo run. They are context only. The J1 evidence is the 14-file run in `j1-14-file-vitest.txt` and `j1-14-file-vitest.json`, with the file list and command beside them. That run needed no redaction.

A credential that a git remote test printed in the full-repo run was replaced with `[REDACTED]` in `vitest.log` and `vitest.json` before those files were committed.
