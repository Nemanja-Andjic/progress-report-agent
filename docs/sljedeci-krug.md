# Za sljedeći krug: gdje agent radi i kako čita sesije

## Odluke iz planiranja drugog kruga

Veće odluke su u ADR 0004 i 0005. Ovdje su vrijednosti koje se lako mijenjaju:

- Pitanje o završetku kreće poslije 60 minuta pauze.
- Agent smije sam da pita između 16:00 i 22:30.
- Poruka "završio" poslata botu važi cijeli dan i radi isto što i dugme. Prima se samo sa Nemanjinog chata.
- Poslije "Nije" agent pita ponovo za 30 minuta, ako u tih 30 minuta nije bilo aktivnosti. Ako jeste, opet važi 60 minuta pauze.
- Na pitanje bez odgovora nema novog pitanja dok se ne pojavi nova aktivnost.
- Na zatvoren dan bot na "završio" odgovara da je izvještaj već poslat.
- Nema dugmeta ni poruke "Danas ne radim". Dan bez rada se javlja sam u 23:00.
- U Claude Code-u hook traži bilješku kad se završi odgovor, a prošlo je 30+ minuta rada od posljednje bilješke. Otvoreno: rad kraći od 30 minuta, bez commita, može proći bez bilješke.
- Na claude.ai, u projektu "Rad sa Tarikom", Claude sam upiše bilješku u `biljeske-sesija/` privatnog repoa (commit i push u `main`) kad Nemanja kaže "napiši bilješku sesije". Format i ADR 0002 su isti kao u Claude Code-u.
- Objava sajta ignoriše `biljeske-sesija/**`.
- Slanje bilješke botu se sad ne pravi. Dodaje se samo ako zatreba za razgovore bez pristupa GitHub-u.
- Poslije neuspjelog pisanja ili objave nema novih pitanja tog dana. Agent pokuša još jednom u 23:00, a Nemanja ranije može poslati "završio".
- Redoslijed: commit, objava, provjera zaštite, pa poruka mentoru. Ako fajl već postoji, a objava ili slanje nisu uspjeli, fajl se ne piše ponovo.
- Agent čita samo repoe aktivnih projekata, iz polja `repoi` u `projekti.json`.
- Hookovi su u `~/.claude/settings.json`, pa rade u svakom folderu. Za novi zadatak se mijenja samo `projekti.json`.
- Bilješka ulazi u izvještaj samo ako joj je projekat sa spiska aktivnih projekata. Ostale agent preskače, npr. rad u `moj-cms`.
- ADR 0002 provodi prompt i `--provjeri`: obrasci tajni i putanja i pojmovi iz privatnog `zabranjeni-pojmovi.json`. Bilješka sa pogotkom ne ide Groku.
- Jutarnja provjera u Actions pita Worker da li je juče završeno. Ako nije, ili Worker ne odgovara, Nemanja dobija poruku.

## Potvrđeni tehnički izbori

- Stanje Workera je u D1, da dvostruki pritisak i 23:00 ne pošalju izvještaj dva puta. Besplatan plan daje 5 miliona pročitanih i 100.000 upisanih redova dnevno i 5 GB prostora, što je dovoljno.
- Kod Workera i agenta je u javnom repou. Workflow u privatnom repou uzima kod iz javnog, a tajne su samo u GitHub Secrets privatnog repoa i na Workeru.
- Worker daje datum workflow-u, da kašnjenje Actions-a ne promijeni datum izvještaja.
- Isti workflow radi commit i objavu, jer commit sa `GITHUB_TOKEN` ne pokreće `objava.yml`. `testovi.yml` takođe ignoriše `biljeske-sesija/**`.
- Dugme sa pitanja važi samo za dan kad je pitanje poslato. Poruka "završio" poslije ponoći važi za novi dan.
- Prvi pravi izvještaj u istom commitu briše oba probna, a period mu je posljednja 24 sata, ne od probnog izvještaja.
- Rad kraći od 30 minuta, bez commita, može proći bez bilješke. To se prihvata dok se ne pokaže kao problem.

## Za spec i tickete

- Rizik za spec: nije potvrđeno da hook na kraju odgovora može natjerati Claude-a da napiše bilješku. To je viđeno samo posredno, u dokumentaciji za `SubagentStop`. Ticket za taj hook počinje kratkom probom.
- #16 ostaje otvoren. Zatvara se zajedno sa specom #5, kad prvi pravi izvještaj stigne mentoru i on se prijavi na sajt.

## Stanje prije planiranja

Odluka je odložena u prvom krugu (pravimo samo sajt). Za sajt je objava uvijek ista: commit jednog fajla izvještaja u privatni repo `progress-report-izvjestaji`.

## Šta mora da se pokrije

- Lokalne Claude Code sesije, koje su samo na Nemanjinom računaru.
- Claude sesije na claude.ai (u oblaku), koje **nisu** na računaru.
- GitHub (issue-i, PR-ovi, commitovi).

## Opcije

- **A) GitHub Actions** čita sirove sesije. Problem: ne vidi ni lokalne sesije ni one na claude.ai.
- **B) Nemanjin računar** (Windows Task Scheduler). Vidi lokalne sesije, ali ne i one na claude.ai, a računar mora biti upaljen.
- **D) Bilješke sesija**: na kraju svake sesije (lokalne i na claude.ai) Claude sam upiše kratku bilješku u poseban folder privatnog repoa. Agent čita samo bilješke i GitHub, pa može da radi u GitHub Actions i nikad ne čita sirove razgovore.

## Na šta paziti

- Pravilo iz [ADR 0002](adr/0002-sta-agent-nikad-ne-pise.md) važi i za bilješke sesija, jer one ostaju u git istoriji.
- Ako ručnu ispravku prepoznajemo po autoru commita (prijedlog Q18 B), agent mora commit-ovati pod svojim imenom, čak i ako radi sa Nemanjinog računara.
