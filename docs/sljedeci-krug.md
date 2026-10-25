# Za sljedeći krug: gdje agent radi i kako čita sesije

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
