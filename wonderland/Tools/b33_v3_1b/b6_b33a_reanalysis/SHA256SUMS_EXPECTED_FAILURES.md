# Expected failures in this folder's SHA256SUMS.txt (2026-10-23, Cosmo; Skywalker ruling 4 on 3c040da4, finding F3)

`sha256sum -c SHA256SUMS.txt`, run in this folder, reports exactly 2 FAILED lines. Both are **intentional**:

| Line | Entry | Listed sha256 | Why it fails here |
|---|---|---|---|
| 3 | `../CANDIDATE.json` | `9be2b062b12e7c47ff068843ea727dda7cc39f1c8a7cdfe8efae5836c84de5a5` | The B6 re-analysis ran with the `tools/b33_v3_1` candidate file. v3.1b ships its own CANDIDATE.json (READY, `f4521fbb…`). |
| 6 | `../b33_judge.py` | `2ecc8b732dd5d9a60370a7fdef71a25ceac1a107530b1ef3e3ed0642221f0d86` | The B6 re-analysis ran the `tools/b33_v3_1` judge. v3.1b's judge is `4caddf0b…`. |

These are the historical inputs of the B6 re-analysis. They match the hashes recorded in this folder's `JUDGE_b33a_v3_1.txt` (lines 95 and 105) and `JUDGE_b33a_v3_1.json` (lines 19 and 43). Rewriting them would falsify that record, so SHA256SUMS.txt is kept byte for byte. Verify those 2 entries against `tools/b33_v3_1`, not against this folder's parent.

Every other entry, including the six `slices/*.log`, must report OK.
