# Agent za izvještaje

Od bilješki sesija u privatnom repou pravi fajl izvještaja i tekst mentorove poruke. Commit, objavu i slanje radi workflow iz #26, a GitHub kao ulaz stiže u #23.

## Podešavanje

Treba Python 3.14 i `git`. Provjera se pokreće iz privatnog repoa, pa njene zavisnosti moraju biti u `.venv` tog repoa ili u istom Python-u kojim se pokreće agent.

```sh
py -3.14 -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
```

## Pisanje

```sh
XAI_API_KEY=... python agent/agent.py pisi --datum 2030-05-15 --repo ../progress-report-izvjestaji
```

`XAI_API_KEY` dolazi samo iz GitHub Secrets (#25) i ne piše se ni u jedan fajl.

Komanda na stdout ispiše jedan JSON red, a izlazni kod je 1 samo za neuspjeh:

| `ishod` | Značenje | Ostala polja |
|---|---|---|
| `novi-fajl` | fajl je napisan i prošao je provjeru | `fajl`, `obrisani` |
| `postoji-fajl` | fajl za taj datum već postoji, pa se ništa ne piše i Grok se ne zove | `fajl` |
| `dan-bez-rada` | nema ulaza, nema fajla ni poziva Groka | |
| `neuspjeh` | nema fajla, a mentor ne smije da dobije "nema rada" | `razlog` |

Uvijek postoji i polje `upozorenja`, spisak poruka za Nemanju. Ni `razlog` ni `upozorenja` ne sadrže vrijednost iz bilješke, izvještaja ili odgovora Groka, nego samo fajl, polje i vrstu greške.

Commit mora da obuhvati i `fajl` i brisanja iz `obrisani`, pod imenom `progress-report-agent`.

### Ulaz

Groku idu samo bilješke iz `biljeske-sesija/` koje ispunjavaju sve uslove:

- projekat je aktivan u `projekti.json`. Ostale se preskaču bez upozorenja, jer je to privatan rad;
- vrijeme je u periodu, od početka uključivo do kraja isključivo. Kraj je zaokružen naniže na minut, kao i vrijeme bilješke, pa bilješka iz tog minuta ide u sljedeći izvještaj;
- prošla je `napravi_sajt.py --provjeri-biljesku`. Inače dodaje upozorenje.

Ako je bar jedna bilješka odbijena, a nijedna nije prošla, ishod je `neuspjeh`, a ne `dan-bez-rada`. Rad možda postoji, a mentor ne smije da dobije "nema rada" za takav dan (ADR 0006). Isto važi i za bilješku iz koje se ne vidi vrijeme ili projekat. Ona pravi upozorenje na svakom pisanju i ruši dan bez drugih bilješki, dok je Nemanja ne ispravi ili ukloni.

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

Testovi rade nad privremenim git repoom, sa lažnim xAI serverom (`XAI_ADRESA`, `XAI_PAUZA`), lažnom komandom provjere i, za prelazak na zimsko vrijeme, zadatim satom (`AGENT_SADA`), pa ne traže privatni repo ni ključ. Pravu vezu sa provjerom potvrđuje proba cijelog puta (#32). GitHub Actions (`.github/workflows/testovi.yml`) ih pokreće na push u `main` i na svaki pull request.
