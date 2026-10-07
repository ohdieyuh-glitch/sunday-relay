# WONDERLAND_BETA_EULA.txt: notes for the legal reviewer (NOT shipped; CORE, 2026-10-07)

**Status: a TECHNICALLY COMPLIANT DRAFT. LEGAL REVIEW REQUIRED before any wider or public distribution** (the founder's Decision 1,
2026-10-07T11:41:34Z, recorded verbatim in `_qa_handoff/julius_readiness/landing/FOUNDER_DECISIONS_BETA_EULA_COMMIT_AUTHORSHIP_20261007.md`).
The shipped text's line 2 says so too. CORE is not a lawyer, and this is not legal advice.

## Why it exists
The Unreal Engine EULA §4(c) (read from the Internet Archive's 2026-03-01 capture, sha256 a1c5b571...;
`_qa_handoff/integration/wonderland_rights_inventory_20261007/UE_EULA_DISTRIBUTED_PRODUCT_TERMS_20261007.md`) lets a developer
permit end users to use the engine in a distributed product "solely (1) as incorporated in the Product in object code as an
inseparable part of the Product, (2) to the extent necessary for end users to make permitted uses of the Product, and (3) pursuant
to an end user license agreement that explicitly disclaims any representations, warranties, conditions, and liabilities related to
the Licensed Technology", and adds: "You may not permit your end users to incorporate any Licensed Technology into their own
products, services, or other projects." Until this file, the Beta zip carried no end-user agreement.

## The founder's minimum, and where the draft meets it
| The founder's requirement | Where |
|---|---|
| explicitly disclaim representations, warranties, conditions and liabilities relating to Unreal Engine / Epic Licensed Technology | §4, the capitalised bullet (both "Epic makes no ..." and "we disclaim ... on Epic's behalf") |
| Epic is not responsible for Wonderland or its operation / support | §4, third bullet |
| i.Wonder Laboratories, Inc. as the product / company party ONLY where documented rights support it | the opening names it as the party OFFERING the Beta (the founder's R-2 ruling: "Canonical company: i.Wonder Laboratories, Inc."). It is NOT named as a holder of any right (§3 says the agreement "does not itself state who holds those rights") |
| distinguish Wonderland / i.Wonder terms from Epic's Unreal Engine rights | §4, opening paragraph |
| preserve all required third-party license notices | §5 (THIRD_PARTY_NOTICES.txt + Epic's NOTICES.txt ship beside it; build step 6b) |
| not purport to revoke rights already granted under earlier licenses | §3, last sentence (the repository's MIT License history) |
| private-Beta / testing language | §2, §7 |
| no unsupported ownership / copyright assertions while R-1 is open | no copyright line, no "owns", no "proprietary to"; §3 is explicit. The static scan's S14 FAILS a package whose EULA carries one |

## Open points for counsel (CORE does not decide them)
1. **R-1, the authority to grant §1's permission.** The founder's ruling: i.Wonder Laboratories, Inc. is INTENDED to own the
   founder's Julius / i.Wonder IP, but no executed assignment has been found (R-1 = NEEDS FORMAL ASSIGNMENT). The repository's
   LICENSE names "ohdieyuh-glitch" (the founder) as the copyright holder, and the AI providers' terms assign their output rights,
   if any, to the account holder (MAIN's R-3 record). Whether i.Wonder may grant §1, or the founder should grant it personally or
   through a license to i.Wonder, is for counsel. The draft avoids any statement of title either way.
2. Governing law, venue and dispute resolution: none stated.
3. Age / minors, export, consumer-law carve-outs per country: none beyond "to the extent permitted by applicable law".
4. Whether line 2 (the DRAFT marker) stays in the text shipped to private testers. The founder asked for the mark; CORE put it
   where a tester sees it.
5. Data and privacy: the agreement points to README_BETA.txt (SECOND-approved bytes, D-01) rather than restating it, so the two
   cannot drift. Counsel may want a separate privacy notice before a public release.
6. The Epic Online Services SDK ships too (`EOSSDK-Win64-Shipping.dll`). Its own agreement was not read (inventory §6).
