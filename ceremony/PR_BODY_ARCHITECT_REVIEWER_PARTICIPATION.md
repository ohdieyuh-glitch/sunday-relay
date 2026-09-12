# Julius: the other two slots could not ask, so the qualification's first required step was impossible

Frozen candidate `relay/julius-architect-reviewer-participation`, 1 commit(s) over trusted main `d2cda379`, authored and committed by `julius-worker[bot]`.

Step 5 of the nine-candidate path to the paid continuous-worker qualification. Originally frozen at `f00b58ec`, stacked on coder-participation; rebased onto `d2cda379` after #256, #257, #259, #258 and #260, re-authored as `julius-worker[bot]`, and patch-identical to `f00b58ec` (`git patch-id --stable`).

`julius-worker-participation` gave the Coding Agent a way to ask, through the
only structured thing an agentic session returns. It gave the other two slots
nothing. The Prompt Architect answers one JSON object against a strict schema
and the Independent Reviewer returns a review object, and neither shape had
anywhere to put a question — so a mission granting research to those roles
would have granted authority no run could exercise.

That is not a rounding error against the qualification this campaign is for.
Its required sequence opens with the Architect doing serious pre-lock
investigation, and on trusted main the Architect had no way to investigate
anything: it could plan around a gap, or note it in `unresolvedQuestions` for
someone to read afterwards, but it could not ask and then plan with the answer.
The same is true of the Reviewer, which had to accept a claim or refuse it on
suspicion.

THE SAME ASK, IN THE SHAPE EACH SLOT ANSWERS IN. One vocabulary, one set of
bounds, one sanitizer — the domain's own `sanitizeJuliusResearchAsks`, unchanged.
The domain now also owns the JSON-schema fragment and the sentence that explains
it, both built from the constants the sanitizer enforces, so an instruction and
a refusal cannot describe different rules. The boundary forbids a connector
importing the mission domain, so the fragment cannot live beside the plan
schema; the composition root holds both and joins them, which is why the
connector's own files are untouched by this change.

REQUIRED, NOT OPTIONAL, AND THAT IS THE BETTER SHAPE. Strict mode rejects a
schema whose `required` omits a property, so the field cannot be optional there
— and an empty list turns out to be worth having: it is a worker SAYING it needs
nothing, which is a different fact from one that never mentioned the subject. An
empty list is not carried on, so needing nothing costs no checkpoint and earns
no refusal.

The transport still decides nothing. An ask the domain will refuse is handed on
to be refused, for the reason `contractProposal` gives: an adapter that
pre-cleaned a request would be deciding what the domain may refuse, and a
request refused before the pipeline saw it leaves no row behind.

Proven at both seams with the real adapters: the schema the architect is
actually sent requires the field on the plan branch and the guidance branch, its
charter says what the field means, and an ask crosses untouched; the reviewer's
prompt declares the field and the ask survives the REAL parser onto the dispatch
result. Seventeen mutations, all killed — including two that pass a prompt
assertion satisfied by the wrong half of the text.

Precondition 3 for the paid qualification reads PASS for all three slots after
this, rather than passing for the policy and failing for two of three transports.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01KLYuWBeq4erDEd89bec95L
