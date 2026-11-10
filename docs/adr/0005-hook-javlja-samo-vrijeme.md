# Hook javlja samo vrijeme, a ne događaj iz Claude Code-a

Posljednju aktivnost javlja hook u Claude Code-u na Nemanjinom računaru, na svaku poruku i na kraj svakog odgovora. Hook je komanda koja šalje samo signal da je aktivnost bila, a ne ugrađeni hook tipa `http`. Tip `http` bi poslao cijeli događaj, a u njemu su tekst poruke, odgovor, `transcript_path` i `cwd`. Time bi sirov razgovor izašao sa računara, a agent smije da čita samo GitHub i bilješke sesija (ADR 0002).

GitHub i bilješke sesija se pogledaju tek kad pauza istekne, da agent ne pita ako ima svježeg rada. Nisu glavni signal, jer GitHub Events API kasni od 30 sekundi do 6 sati, a bilješke nastaju rijetko. Dan u kom hook nije javio ništa, npr. rad samo na claude.ai, ne dobija pitanje, nego ga pokriva samostalno slanje poslije 23:00 ([0008](0008-radni-dan-i-samostalno-slanje-poslije-23.md)). Rad na claude.ai poslije 22:30 javlja signal rada ([0009](0009-signal-rada-sa-claude-ai.md)).

Hook za posljednju aktivnost i hook za bilješke su u globalnim podešavanjima (`~/.claude/settings.json`), da rade u svakom folderu i repou. Za novi zadatak se zato mijenja samo `projekti.json`: novi projekat sa repoima postaje aktivan, a stari neaktivan.

## Posljedice

- Rad u folderu koji nema veze sa projektima takođe pomjera posljednju aktivnost i može da napravi bilješku. Takva bilješka ne ulazi u izvještaj, jer joj projekat nije sa spiska aktivnih projekata.
- GitHub i bilješke gleda kratak workflow u GitHub Actions, a ne Worker, jer GitHub token na Workeru može samo da pokreće workflow-e (ADR 0004). Worker ga pokrene kad pauza istekne, a workflow mu javi da li da pita. Svaka provjera troši oko minut Actions i kasni koliko i pokretanje workflow-a.
- Hook se Workeru predstavlja posebnim ključem koji može samo da javi aktivnost. Ključ je samo na Nemanjinom računaru, van svih repoa, a Worker odbija svaki zahtjev bez njega.
