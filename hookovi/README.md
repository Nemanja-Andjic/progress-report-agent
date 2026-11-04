# Hookovi

Dva hooka za Claude Code. Trajno uključivanje oba je ručni korak iz #31.

- **Hook za aktivnost** javlja Workeru samo da je aktivnost bila.
- **Hook za bilješke sesija** traži bilješku poslije 30+ minuta rada.

## Hook za aktivnost

Na svaku poruku i na kraj svakog odgovora javi Workeru da je aktivnost bila. Worker tako zna kad je bila posljednja aktivnost i ništa više (ADR 0005).

### Kako radi

- Hook je komanda, a ne ugrađeni hook tipa `http`, jer bi `http` poslao cijeli događaj: tekst razgovora, `transcript_path` i `cwd`.
- Događaj sa stdin-a se ne čita. Šalje se prazan `POST /aktivnost`, sa ključem u zaglavlju, a vrijeme određuje Worker svojim satom.
- Cijelo javljanje ima rok od 3 sekunde. Hook ništa ne ispisuje i uvijek izlazi sa 0: kad Worker ne odgovara, odbije ključ ili podešavanja fale, Claude ne vidi ništa, a jedno javljanje se samo izgubi.
- Ključ ne prati preusmjeravanje na drugu adresu.

Zbog tišine se pogrešan ključ ne vidi u Claude Code-u, nego samo po tome što se vrijeme na Workeru ne pomjera (vidi provjeru dolje).

### Uključivanje

Potreban je Python (komanda `py -3`), bez dodatnih paketa, i objavljen Worker sa tajnom `KLJUC_HOOKA` (vidi [worker/README.md](../worker/README.md)).

Napravi `~/.claude/aktivnost/podesavanja.json`, van svih repoa, sa adresom koju je ispisao `wrangler deploy` i istim ključem koji je upisan u `wrangler secret put KLJUC_HOOKA`:

```json
{ "adresa": "https://ADRESA_WORKERA", "kljuc": "KLJUČ_HOOKA" }
```

Adresa mora da počne sa `https://`. Ključ se ne piše ni u jedan repo, ni u chat, ni u issue.

U `~/.claude/settings.json` dodaj donji dio, sa stvarnom putanjom do ovog repoa. Ako je hook za bilješke već uključen, dodaj ove unose u nizove `UserPromptSubmit` i `Stop` koji već postoje, pored njegovih:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "py -3 \"PUTANJA/hookovi/aktivnost.py\"", "timeout": 5 }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "py -3 \"PUTANJA/hookovi/aktivnost.py\"", "timeout": 5 }
        ]
      }
    ]
  }
}
```

Hook se učitava iz radnog foldera ovog repoa, pa mora da postoji na grani koja je tu izabrana.

Za isključivanje ukloni te unose iz podešavanja.

### Provjera poslije uključivanja

Pošalji poruku u Claude Code-u, pa iz foldera `worker/` pokreni:

```sh
npx wrangler d1 execute DB --remote --command "SELECT datum, posljednja_aktivnost FROM dani ORDER BY datum DESC LIMIT 1"
```

`posljednja_aktivnost` je u milisekundama od 1.1.1970. po UTC-u i treba da se pomjeri poslije svake poruke. Ako se ne pomjera, `npx wrangler tail` prikazuje status: 401 znači pogrešan ključ, a ako zahtjeva nema, provjeri adresu i putanju u podešavanjima.

## Hook za bilješke sesija

Poslije 30+ minuta rada od posljednje bilješke, Claude Code na kraju odgovora sam napiše kratku bilješku sesije i pošalje je u `main` privatnog repoa `progress-report-izvjestaji`. Format i provjera bilješke su opisani u README-u privatnog repoa.

### Kako radi

- **Hook** (`biljeska.py hook`) računa vrijeme rada, posebno za svaku sesiju. Od poruke do kraja odgovora sve je rad. Između dva odgovora rad je samo razmak kraći od 60 minuta, a duži se računa kao pauza.
- Kad se skupi 30 minuta, hook na kraju odgovora traži bilješku i vrijeme kreće ispočetka. Ako bilješka tada ne nastane, sljedeći zahtjev stiže poslije novih 30 minuta. U plan režimu hook ne traži bilješku, jer Claude tada ne smije da piše.
- **Upis** (`biljeska.py upisi`) provjeri bilješku komandom `--provjeri-biljesku` iz privatnog repoa. Bilješka koja ne prođe se ne upisuje, a Claude dobija poruku bez pronađene vrijednosti i može da ispravi tekst.
- Ispravna bilješka se šalje iz privremene kopije (`git worktree`) sa najnovijeg `origin/main`, pa se izmjene i grana u radnom folderu privatnog repoa ne diraju. Ako je u međuvremenu stigao drugi commit, radi se rebase i novi push.
- Commit sadrži samo `biljeske-sesija/`, pa ne pokreće ni objavu ni testove, a sajt taj folder ne čita.

### Šta hook ne radi

- Ne šalje ništa na mrežu i ne čita razgovor. Od ulaza koristi samo ID sesije, ime događaja, `stop_hook_active` i `permission_mode`. U repo ide samo bilješka koju Claude sam napiše.
- Ne prekida rad: svaka njegova greška se tiho preskače. Bez mreže ili kad push ne uspije, bilješka ostaje na računaru i šalje se na jednom od sljedećih krajeva odgovora.

### Šta gdje stoji

Sve je u `~/.claude/biljeske-sesija/`, van svih repoa:

- `stanje/`: vrijeme rada po sesiji. Stariji fajlovi se brišu poslije 30 dana;
- `na-cekanju/`: bilješke koje još nisu poslate. Ako tu stoje duže vrijeme, razlog je u `posljednja-greska-slanja.txt`;
- `odbijene/`: bilješke koje su prošle prvu provjeru, a pale pri slanju jer se spisak zabranjenih pojmova u međuvremenu promijenio. Ne šalju se same: pogledaj ih, pa ih obriši ili ispravi.

### Uključivanje

Potrebni su Python (komanda `py -3`), Git Bash i `.venv` u privatnom repou (vidi njegov README). Privatni repo mora biti u istom folderu kao ovaj, ili mu putanju zadaj u varijabli `BILJESKE_REPO`.

U `~/.claude/settings.json` dodaj donji dio, sa stvarnom putanjom do ovog repoa. Hook ide na oba događaja, a pravilo u `permissions` omogućava upis bilješke bez pitanja:

```json
{
  "permissions": {
    "allow": ["Bash(py -3 \"PUTANJA/hookovi/biljeska.py\" upisi *)"]
  },
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "py -3 \"PUTANJA/hookovi/biljeska.py\" hook", "timeout": 10 }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "py -3 \"PUTANJA/hookovi/biljeska.py\" hook", "timeout": 10 }
        ]
      }
    ]
  }
}
```

Ovaj dio spoji sa onim što je već u fajlu, a ne pregazi ga. Claude Code izmjene obično pokupi sam, a ako `/hooks` ne prikaže hook, pokreni novu sesiju.

Hook se učitava iz radnog foldera ovog repoa, pa mora da postoji na grani koja je tu izabrana.

Za isključivanje ukloni taj dio iz podešavanja.

### Provjera poslije uključivanja

Poslije 30+ minuta rada u jednoj sesiji treba da se u `biljeske-sesija/` na `main` privatnog repoa pojavi nova bilješka, a da objava i testovi ostanu nepokrenuti.

Bilješka na claude.ai se piše po posebnom uputstvu: [docs/biljeska-na-claude-ai.md](../docs/biljeska-na-claude-ai.md).
