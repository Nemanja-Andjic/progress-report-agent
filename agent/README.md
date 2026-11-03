# Agent za izvještaje

Od bilješki sesija u privatnom repou i rada na GitHub-u pravi fajl izvještaja i tekst mentorove poruke, a provjeri prije pitanja daje vrijeme posljednjeg svježeg rada. Commit, objavu i slanje radi workflow iz #26.

## Podešavanje

Treba Python 3.14 i `git`. Provjera se pokreće iz privatnog repoa, pa njene zavisnosti moraju biti u `.venv` tog repoa ili u istom Python-u kojim se pokreće agent.

```sh
py -3.14 -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
```

## Pisanje

```sh
XAI_API_KEY=... AGENT_GITHUB_TOKEN=... python agent/agent.py pisi --datum 2030-05-15 --repo ../progress-report-izvjestaji
```

`XAI_API_KEY` i `AGENT_GITHUB_TOKEN` dolaze samo iz GitHub Secrets (#25) i ne pišu se ni u jedan fajl. `AGENT_GITHUB_TOKEN` je token koji samo čita repoe aktivnih projekata. Podrazumijevani `GITHUB_TOKEN` workflow-a ne može da ga zamijeni, jer vidi samo svoj repo. Za probu na računaru, samo za čitanje: `AGENT_GITHUB_TOKEN=$(gh auth token)`.

Komanda na stdout ispiše jedan JSON red, a izlazni kod je 1 samo za neuspjeh:

| `ishod` | Značenje | Ostala polja |
|---|---|---|
| `novi-fajl` | fajl je napisan i prošao je provjeru | `fajl`, `obrisani` |
| `postoji-fajl` | fajl za taj datum već postoji, pa se ništa ne piše i Grok se ne zove | `fajl` |
| `dan-bez-rada` | nema ulaza, nema fajla ni poziva Groka | |
| `neuspjeh` | nema fajla, a mentor ne smije da dobije "nema rada" | `razlog` |

Uvijek postoji i polje `upozorenja`, spisak poruka za Nemanju. Ni `razlog` ni `upozorenja` ne sadrže vrijednost iz bilješke, izvještaja, sa GitHub-a ili iz odgovora Groka, nego samo fajl ili repo sa oznakom podatka, i vrstu greške.

Commit mora da obuhvati i `fajl` i brisanja iz `obrisani`, pod imenom `progress-report-agent`.

### Ulaz

Groku idu samo bilješke iz `biljeske-sesija/` koje ispunjavaju sve uslove:

- projekat je aktivan u `projekti.json`. Ostale se preskaču bez upozorenja, jer je to privatan rad;
- vrijeme je u periodu, od početka uključivo do kraja isključivo. Kraj je zaokružen naniže na minut, kao i vrijeme bilješke, pa bilješka iz tog minuta ide u sljedeći izvještaj;
- prošla je `napravi_sajt.py --provjeri-biljesku`. Inače dodaje upozorenje.

Sa GitHub-a idu issue-i, PR-ovi i commitovi iz polja `repoi` aktivnih projekata, i to samo oni čiji je autor nalog `Nemanja-Andjic` (`NALOG_NA_GITHUBU` u `agent.py`). Tuđi i od botova se preskaču bez upozorenja. Commit se računa po nalogu koji mu GitHub dodijeli preko emaila, pa se commit sa emailom koji nije vezan za nalog takođe preskače.

- issue i PR ulaze ako su mijenjani u periodu (`updated_at`), a čita se naslov, opis i stanje. Komentari se ne čitaju;
- commit ulazi ako mu je vrijeme commit-ovanja u periodu, sa bilo koje grane. Isti commit na više grana ulazi jednom;
- opis i poruka commita se skraćuju na 2000 znakova, ali tek poslije provjere, da presječena tajna ne prođe kao običan tekst.

Kao rad se **ne računaju** ni commitovi čije je ime autora `progress-report-agent` i commitovi koji mijenjaju samo `biljeske-sesija/`. Inače bi agentov izvještaj ili bilješka sami pravili rad, pa dan bez rada ne bi mogao da se desi, a sljedeći izvještaj bi opisivao prethodni. Commit koji mijenja i `biljeske-sesija/` i nešto drugo računa se kao rad, a bilješke i dalje ulaze preko svog foldera.

Podaci sa GitHub-a se provjeravaju jednim pozivom `napravi_sajt.py --provjeri`, nad privremenim fajlom van repoa u kom je svaki podatak dvije stavke: naslov sa dokazom i tekst. Agent čita poruke po obliku `stavke[N].polje vrsta`. Svaki nalaz dodaje upozorenje bez vrijednosti:

- pogodak po ADR 0002 u naslovu: podatak ne ide Groku;
- pogodak u tekstu (opis issue-a ili PR-a, ostatak poruke commita): Groku ide podatak bez teksta, npr. kad uputstvo pominje `~/.claude/settings.json`;
- pogodak u linku, ili link koji nije na spisku dozvoljenih linkova: Groku ide podatak bez dokaza;
- poruka drugog oblika znači da provjera nije radila, pa je ishod `neuspjeh`.

Ako je bar nešto odbijeno, a ništa nije prošlo, ishod je `neuspjeh`, a ne `dan-bez-rada`. Rad možda postoji, a mentor ne smije da dobije "nema rada" za takav dan (ADR 0006). Isto važi i za bilješku iz koje se ne vidi vrijeme ili projekat. Ona pravi upozorenje na svakom pisanju i ruši dan bez drugog ulaza, dok je Nemanja ne ispravi ili ukloni.

Greška GitHub-a je `neuspjeh`, a ne manje rada: status van prolaznih, neočekivan odgovor, fali token ili repo koji token ne vidi. Prolazne greške (mreža, 408, 429, 5xx) se pokušavaju do 3 puta.

### Dokazi

Python svakom podatku koji je prošao provjeru da ID (`D1`, `D2`...). Grok dobija samo ID i oznaku, npr. `PR #12`, a nikad link. U stavci vraća ID-eve, a prave linkove upisuje Python, pa je nepoznat ID `neuspjeh`.

### Period

Period počinje od najkasnijeg kraja perioda među fajlovima u `izvjestaji/`. Bez ijednog fajla, ili dok agent nije napisao nijedan izvještaj, period je posljednja 24 sata. Zato je za to potrebna puna git istorija, a plitka kopija završava neuspjehom.

Vremena se upisuju po zoni `Europe/Belgrade`, a kraj perioda je trenutak pisanja, a ne `--datum`.

### Prvi izvještaj agenta

Dok u istoriji `izvjestaji/` nema nijednog commita od `progress-report-agent`, svi postojeći fajlovi su ručno napisani primjeri. Prvi izvještaj agenta ih ne računa kao prethodne i briše ih tek pošto novi fajl prođe provjeru. Poslije toga se ručno napisan izvještaj računa kao prethodni i nikad se ne briše, pa i kad su izvještaji iz probe obrisani.

### Grok

`grok-4.7` preko `POST /v1/responses`, sa `text.format` tipa `json_schema` i `strict: true` (ADR 0006). Prolazne greške (mreža, 408, 429, 5xx) se pokušavaju do 3 puta, a ostali statusi, nedovršen odgovor i odgovor van šeme odmah su neuspjeh.

Zahtjev šalje `store: false`, da xAI ne čuva odgovor za kasnije čitanje. To ne isključuje čuvanje radi revizije: po xAI dokumentaciji, zahtjevi i odgovori stoje 30 dana, osim na timu sa Zero Data Retention.

### Provjera

Gotov fajl se prvo upiše kao `izvjestaji/GGGG-MM-DD.nacrt` i provjeri komandom `napravi_sajt.py --provjeri` iz privatnog repoa. Tek kad prođe, postaje `.json`. Pravila provjere nisu u ovom repou. Poruka provjere koja nije o tom fajlu (pokvaren spisak, fali biblioteka) znači da provjera nije radila, pa je ishod neuspjeh.

## Svjež rad

```sh
AGENT_GITHUB_TOKEN=... python agent/agent.py svjez-rad --repo ../progress-report-izvjestaji
```

Komanda je za provjeru prije pitanja (#29). Ne zove Groka, a na stdout ispiše jedan JSON red, sa izlaznim kodom 1 samo za neuspjeh:

| `ishod` | Značenje | Ostala polja |
|---|---|---|
| `svjez-rad` | u tekućem periodu ima rada | `vrijeme` posljednjeg rada |
| `nema-svjezeg-rada` | u tekućem periodu nema rada | |
| `neuspjeh` | ne zna se da li ima rada, pa pitanje ne smije da krene | `razlog` |

I ovdje uvijek postoji polje `upozorenja`. Period i pravila su isti kao za pisanje, pa treba puna git istorija, a tuđ rad, commit agenta i commit samo sa bilješkama se ne računaju. Razlike su dvije:

- kraj perioda je tačan trenutak, a ne zaokružen na minut, jer se traži baš rad iz ovog minuta;
- provjera iz ADR 0002 se ne zove. Podatak sa pogotkom ne ide nikud, a rad je bio, pa se njegovo vrijeme računa.

## Poruka

```sh
python agent/agent.py poruka --datum 2030-05-15 --repo ../progress-report-izvjestaji --adresa-sajta https://adresa-sajta
```

Na stdout ispiše tekst poruke: naslov, numerisan sažetak i link složen iz datuma. Adresa sajta se prosljeđuje jer je nema u javnom repou.

Naslov se računa iz autora prvog commita fajla, isto kao oznaka porijekla na sajtu: `🤖 Izvještaj za ...` za izvještaj agenta, i ručno ispravljen, a `✍️ Izvještaj (napisano ručno) za ...` za sve ostalo. Zato se komanda poziva poslije commita, jer se necommit-ovan fajl računa kao ručno napisan.

## Testovi

```sh
.venv/Scripts/python -m pytest
```

Testovi rade nad privremenim git repoom, sa lažnim xAI serverom (`XAI_ADRESA`, `XAI_PAUZA`), lažnim GitHub serverom (`AGENT_GITHUB_ADRESA`, `AGENT_GITHUB_PAUZA`), lažnom komandom provjere i, za prelazak na zimsko vrijeme, zadatim satom (`AGENT_SADA`), pa ne traže privatni repo, ključ ni token. Pravu vezu sa provjerom potvrđuje proba cijelog puta (#32). GitHub Actions (`.github/workflows/testovi.yml`) ih pokreće na push u `main` i na svaki pull request.
