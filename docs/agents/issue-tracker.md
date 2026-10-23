# Issue tracker: GitHub

Issue-i i specifikacije ovog repoa vode se kao GitHub issue-i. Za sve operacije koristi `gh` CLI.

## Konvencije

- **Napravi issue**: `gh issue create --title "..." --body "..."`. Za tijelo u više redova koristi heredoc.
- **Pročitaj issue**: `gh issue view <number> --json number,title,body,labels,comments`.
- **Izlistaj issue-e**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`, uz odgovarajuće filtere `--label` i `--state`.
- **Napravi sub-issue nekog roditelja**: `gh issue create --parent <parent> ...`, ili naknadno `gh issue edit <parent> --add-sub-issue <child>` (`gh` 2.94+). Sa starijim `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>` (database id, kao u **Blokiranje** ispod). Ako sub-issue-i nisu dostupni, na vrh tijela djeteta stavi `Part of #<parent>`.
- **Komentariši issue**: `gh issue comment <number> --body "..."`
- **Dodaj / ukloni labele**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Zatvori**: `gh issue close <number> --comment "..."`

Repo se zaključuje iz `git remote -v`; `gh` to radi sam kad se pokrene unutar klona.

## Pull request-ovi kao ulaz za triage

**PRs as a request surface: no.** _(Postavi na `yes` ako ovaj repo tretira spoljne pull request-ove kao zahtjeve za funkcionalnost; `/triage` čita ovaj flag.)_

Kad je postavljeno na `yes`, pull request-ovi prolaze kroz iste labele i stanja kao issue-i, preko `gh pr` ekvivalenata:

- **Pročitaj PR**: `gh pr view <number> --comments`, a za diff `gh pr diff <number>`.
- **Izlistaj spoljne PR-ove za triage**: `gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`.
- **Komentar / labela / zatvaranje**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub dijeli isti niz brojeva za issue-e i PR-ove, pa golo `#42` može biti bilo šta od ta dva: provjeri sa `gh pr view 42`, a ako to ne uspije, sa `gh issue view 42`.

## Kad skill kaže "publish to the issue tracker"

Napravi GitHub issue.

## Kad skill kaže "fetch the relevant ticket"

Pročitaj ga kao u **Pročitaj issue** iznad.

## Wayfinding operacije

Koristi ih `/wayfinder`. **Mapa** je jedan issue, a njeni **child** issue-i su tiketi.

- **Mapa**: jedan issue sa labelom `wayfinder:map`, čije tijelo sadrži Notes / Decisions-so-far / Fog. `gh issue create --label wayfinder:map`.
- **Child tiket**: issue povezan s mapom kao GitHub sub-issue (vidi **Napravi sub-issue nekog roditelja**). Gdje sub-issue-i nisu uključeni, dodaj dijete u task listu u tijelu mape i na vrh tijela djeteta stavi `Part of #<map>`. Labele: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Kad se tiket preuzme, dodjeljuje se developeru koji ga vodi.
- **Blokiranje**: GitHub-ove **native issue dependencies**, kanonski prikaz koji se vidi u UI-ju. Vezu dodaj sa `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, gdje je `<blocker-db-id>` numerički **database id** blokera (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _ne_ `#number` ni `node_id`). GitHub prijavljuje `issue_dependencies_summary.blocked_by` (samo otvoreni blokeri, to je živa kapija). Gdje dependencies nisu dostupne, na vrh tijela djeteta stavi red `Blocked by: #<n>, #<n>`. Tiket je odblokiran kad su svi blokeri zatvoreni.
- **Frontier upit**: izlistaj otvorenu djecu mape (`gh issue list --state open`, ograničeno na sub-issue-e / task listu mape), izbaci one s otvorenim blokerom (`issue_dependencies_summary.blocked_by > 0`, ili otvoren issue u redu `Blocked by`) ili s dodijeljenom osobom; pobjeđuje prvi po redu u mapi.
- **Preuzimanje**: `gh issue edit <n> --add-assignee @me`, prvi upis u sesiji.
- **Razrješenje**: `gh issue comment <n> --body "<answer>"`, zatim `gh issue close <n>`, pa u Decisions-so-far mape dodaj pokazivač na kontekst (suština + link).
