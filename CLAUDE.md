# Progress Report Agent

## Jezik

Issue-e, commitove, PR-ove i dokumente piši na našem jeziku (ijekavica). Na engleskom ostaju:

- ključne riječi koje GitHub prepoznaje: `Closes #N`, `Fixes #N`, `Refs #N`
- `Co-Authored-By:` i ostali potpisi u commitu
- komande, imena fajlova, foldera i oznaka (labela)
- stručni nazivi koji se ne prevode (pull request, merge, branch, API)

Imena grana piši malim slovima, sa crticama i bez kvačica (č, ć, š, ž, đ).

## Agent skills

### Issue tracker

Issue-i se vode u GitHub Issues ovog repoa, preko `gh` CLI-ja. Vidi `docs/agents/issue-tracker.md`.

### Triage labels

Pet kanonskih labela, svaka nosi ime svoje uloge (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). Vidi `docs/agents/triage-labels.md`.

### Domain docs

Single-context: jedan `GLOSSARY.md` i `docs/adr/` u korijenu repoa. Vidi `docs/agents/domain.md`.
