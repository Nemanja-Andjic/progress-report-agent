# Agent za izvještaje

Od bilješki sesija u privatnom repou i rada na GitHub-u pravi fajl izvještaja i tekst mentorove poruke, provjeri prije pitanja daje vrijeme posljednjeg svježeg rada, a na pitanje o radu piše odgovor. Commit, objavu i slanje radi workflow iz #26.

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

Kao rad se **ne računaju** ni commitovi čije je ime autora `progress-report-agent` i commitovi koji mijenjaju samo `biljeske-sesija/`, `pitanja-o-radu/` ili `signal-rada.json` u korijenu repoa. Inače bi agentov izvještaj, bilješka, pitanje o radu ili signal rada sami pravili rad, pa dan bez rada ne bi mogao da se desi, a sljedeći izvještaj bi opisivao prethodni. Commit koji uz njih mijenja i nešto drugo računa se kao rad, a bilješke i dalje ulaze preko svog foldera.

Signal rada (ADR 0009) nije rad i nikad nije ulaz za pisanje. Čita ga samo komanda `svjez-rad`, kao signal, po vremenu njegovog commita.

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

`grok-4.7` preko `POST /v1/responses`, sa `text.format` tipa `json_schema` i `strict: true` (ADR 0006). Razmišljanje je na najnižem nivou (`reasoning.effort: low`). Prolazne greške (mreža, isteklo vrijeme, 408, 429, 5xx) se pokušavaju najviše 2 puta, sa rokom od 480 s po pokušaju, pa sve staje u rok workflowa od 25 minuta. Ostali statusi, nedovršen odgovor i odgovor van šeme odmah su neuspjeh. Razlog neuspjeha kaže šta se desilo posljednji put (`isteklo vrijeme`, `status 503`, `greška mreže`) i nikad ne sadrži odgovor servisa.

Zahtjev šalje `store: false`, da xAI ne čuva odgovor za kasnije čitanje. To ne isključuje čuvanje radi revizije: po xAI dokumentaciji, zahtjevi i odgovori stoje 30 dana, osim na timu sa Zero Data Retention.

### Provjera

Gotov fajl se prvo upiše kao `izvjestaji/GGGG-MM-DD.nacrt` i provjeri komandom `napravi_sajt.py --provjeri` iz privatnog repoa. Tek kad prođe, postaje `.json`. Pravila provjere nisu u ovom repou. Poruka provjere koja nije o tom fajlu (pokvaren spisak, fali biblioteka) znači da provjera nije radila, pa je ishod neuspjeh.

## Svjež rad

```sh
AGENT_GITHUB_TOKEN=... python agent/agent.py svjez-rad --repo ../progress-report-izvjestaji
```

Komanda je za provjeru prije pitanja (#29) i za provjeru poslije 23:00 pred samostalno slanje. Isto javljanje služi za obje, jer signala rada prije 22:30 nema. Ne zove Groka, a na stdout ispiše jedan JSON red, sa izlaznim kodom 1 samo za neuspjeh:

| `ishod` | Značenje | Ostala polja |
|---|---|---|
| `svjez-rad` | u tekućem periodu ima svježeg rada ili signala rada | `vrijeme` posljednjeg od njih |
| `nema-svjezeg-rada` | u tekućem periodu nema ni svježeg rada ni signala rada | |
| `neuspjeh` | ne zna se da li ima rada, pa pitanje ne smije da krene | `razlog` |

I ovdje uvijek postoji polje `upozorenja`. Svjež rad ima isti period i pravila kao ulaz za pisanje, pa treba puna git istorija, a tuđ rad, commit agenta i commit samo sa bilješkama, pitanjima o radu ili signalom se ne računaju. Razlike su tri:

- kraj perioda je tačan trenutak, a ne zaokružen na minut, jer se traži baš rad iz ovog minuta;
- provjera iz ADR 0002 se ne zove. Podatak sa pogotkom ne ide nikud, a rad je bio, pa se njegovo vrijeme računa;
- uz svjež rad se gleda i signal rada, koji nije rad, nego samo signal: vrijeme posljednjeg commita koji je mijenjao `signal-rada.json` u kopiji privatnog repoa, ako je u periodu. Vrijeme upisano u fajl se ne čita, jer Claude na claude.ai nema pouzdan sat.

## Poruka

```sh
python agent/agent.py poruka --datum 2030-05-15 --repo ../progress-report-izvjestaji --adresa-sajta https://adresa-sajta
```

Na stdout ispiše tekst poruke: naslov, numerisan sažetak i link složen iz datuma. Adresa sajta se prosljeđuje jer je nema u javnom repou.

Naslov se računa iz autora prvog commita fajla, isto kao oznaka porijekla na sajtu: `🤖 Izvještaj za ...` za izvještaj agenta, i ručno ispravljen, a `✍️ Izvještaj (napisano ručno) za ...` za sve ostalo. Zato se komanda poziva poslije commita, jer se necommit-ovan fajl računa kao ručno napisan.

## Odgovor o radu

```sh
XAI_API_KEY=... AGENT_GITHUB_TOKEN=... python agent/agent.py odgovor --chat mentor --pitanje "Šta je Nemanja radio juče?" --repo ../progress-report-izvjestaji --adresa-sajta https://adresa-sajta
```

Komanda piše odgovor na pitanje o radu preko Groka (ADR 0007). `--chat` je `mentor` ili `nemanja`, nikad ID chata. Adresa sajta se prosljeđuje kao i za poruku, jer od nje Python slaže linkove na izvještaje. Na stdout ispiše jedan JSON red, a izlazni kod je 1 samo za neuspjeh:

| `ishod` | Značenje | Ostala polja |
|---|---|---|
| `odgovor` | odgovor je prošao provjeru i upisan je u `pitanja-o-radu/` | `tekst`, `persiranje`, `fajl` |
| `odbijeno` | pitanje ima obrazac tajne ili putanju, pa nije poslato Groku ni sačuvano | `tekst`, `persiranje`, `razlog` |
| `neuspjeh` | nema odgovora ni fajla | `tekst`, `persiranje`, `razlog` |

`tekst` je prazan, a `persiranje` je `bez_promjene` za sve osim ishoda `odgovor`. I ovdje uvijek postoji `upozorenja`. `razlog` i `upozorenja` nikad ne sadrže vrijednost iz pitanja, ulaza ni odgovora, pa idu Nemanji. `tekst` je odgovor za chat i ne smije u log workflow-a. Commit radi workflow, pod imenom `progress-report-agent`, i obuhvata `fajl` i `pitanja-o-radu/podesavanja.json`.

Plitka kopija repoa je dovoljna, jer se ulaz bira po vremenu, a ne po istoriji.

### Provjera pitanja

Pitanje se prvo provjeri komandom `napravi_sajt.py --provjeri-biljesku`, kao tekst bilješke u privremenom fajlu van repoa. Nalaz `ima obrazac tajne ili ključa` ili `ima putanju sa računara` daje ishod `odbijeno`: ništa se ne čita, Grok se ne zove i ništa se ne upisuje. Zabranjen pojam u pitanju se pušta, jer ga je napisao onaj ko pita. Ostali nalazi (npr. dužina) se za pitanje ne gledaju.

### Ulaz

Za posljednjih 30 dana, od trenutka pokretanja:

- izvještaji iz `izvjestaji/` čiji je datum u tom periodu, po zoni `Europe/Belgrade`. Groku idu datum i stavke sa oznakama dokaza, bez linkova. Izvještaj koji ne može da se pročita dodaje upozorenje i ne ide Groku;
- bilješke sa projektom iz `projekti.json`, aktivnim ili neaktivnim, po istim pravilima i istoj provjeri kao za pisanje. Bilješke sa projektom kog nema se preskaču bez upozorenja;
- issue-i, PR-ovi i commitovi iz `repoi` svih projekata iz `projekti.json`, po istim pravilima i istoj provjeri kao za pisanje, ali bez ID-a dokaza;
- pamćenje: do 5 posljednjih odgovora sa istog chata iz posljednja 24 sata, iz `pitanja-o-radu/`. Pamćenje jednog chata nikad ne ide drugom;
- oblik obraćanja (`ti` ili `vi`) iz `pitanja-o-radu/podesavanja.json`.

Za razliku od pisanja, ništa iz ulaza nije obavezno: bez ijednog podatka Grok i dalje odgovara da o tome nema zapisa.

### Grok

Isti model i ista podešavanja kao za pisanje, sa šemom `tekst`, `izvjestaji` (datumi izvještaja iz kojih odgovor dolazi) i `persiranje` (`da`, `ne` ili `bez_promjene`). Rok jednog pokušaja je 150 s. Ponovni pokušaj ide samo ako sa pauzom i rokom stane u 5 minuta od pokretanja komande, jer Worker toliko čeka odgovor.

Odgovor sa datumom izvještaja kog nema u ulazu je `neuspjeh`. Linkove `ADRESA/izvjestaji/GGGG-MM-DD/` dodaje Python na kraj teksta, po jedan u redu, od najstarijeg.

### Provjera i čuvanje

Gotov odgovor, sa linkovima, prolazi `napravi_sajt.py --provjeri-biljesku` kao tekst u privremenom fajlu van repoa. Obrazac tajne, putanja i zabranjen pojam daju `neuspjeh`. Ostali nalazi provjere bilješke (npr. dužina) se za odgovor ne gledaju. Agent prepoznaje nalaze po tekstu poruke provjere, pa promjena tih poruka u `napravi_sajt.py` mora da prati i `agent.py`.

Uspješan odgovor dobija fajl `pitanja-o-radu/GGGG-MM-DDTHHMMSS-chat.json` (vrijeme po UTC-u), sa poljima `vrijeme`, `chat`, `pitanje`, `odgovor` i `izvjestaji`. Persiranje se upisuje u `pitanja-o-radu/podesavanja.json` samo kad Grok vrati `da` ili `ne`, u obliku `{"mentor": {"persiranje": true}}`. Podešavanja drugog chata ostaju. Pokvaren fajl podešavanja dodaje upozorenje, a obraćanje je na „ti”. Ako bi persiranje trebalo upisati, ishod je `neuspjeh`, da upis ne prepiše pokvaren fajl. Odbijeno pitanje i neuspio odgovor ne upisuju ništa.

## Testovi

```sh
.venv/Scripts/python -m pytest
```

Testovi rade nad privremenim git repoom, sa lažnim xAI serverom (`XAI_ADRESA`, `XAI_PAUZA`, `XAI_ROK`, `XAI_ROK_ODGOVORA`, `AGENT_ROK_ODGOVORA`), lažnim GitHub serverom (`AGENT_GITHUB_ADRESA`, `AGENT_GITHUB_PAUZA`), lažnom komandom provjere i, za prelazak na zimsko vrijeme, zadatim satom (`AGENT_SADA`), pa ne traže privatni repo, ključ ni token. Pravu vezu sa provjerom potvrđuje proba cijelog puta (#32). GitHub Actions (`.github/workflows/testovi.yml`) ih pokreće na push u `main` i na svaki pull request.
