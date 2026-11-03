# Hook za bilješke sesija

Poslije 30+ minuta rada od posljednje bilješke, Claude Code na kraju odgovora sam napiše kratku bilješku sesije i pošalje je u `main` privatnog repoa `progress-report-izvjestaji`. Format i provjera bilješke su opisani u README-u privatnog repoa.

Trajno uključivanje je ručni korak iz #31.

## Kako radi

- **Hook** (`biljeska.py hook`) računa vrijeme rada, posebno za svaku sesiju. Od poruke do kraja odgovora sve je rad. Između dva odgovora rad je samo razmak kraći od 60 minuta, a duži se računa kao pauza.
- Kad se skupi 30 minuta, hook na kraju odgovora traži bilješku i vrijeme kreće ispočetka. Ako bilješka tada ne nastane, sljedeći zahtjev stiže poslije novih 30 minuta. U plan režimu hook ne traži bilješku, jer Claude tada ne smije da piše.
- **Upis** (`biljeska.py upisi`) provjeri bilješku komandom `--provjeri-biljesku` iz privatnog repoa. Bilješka koja ne prođe se ne upisuje, a Claude dobija poruku bez pronađene vrijednosti i može da ispravi tekst.
- Ispravna bilješka se šalje iz privremene kopije (`git worktree`) sa najnovijeg `origin/main`, pa se izmjene i grana u radnom folderu privatnog repoa ne diraju. Ako je u međuvremenu stigao drugi commit, radi se rebase i novi push.
- Commit sadrži samo `biljeske-sesija/`, pa ne pokreće ni objavu ni testove, a sajt taj folder ne čita.

## Šta hook ne radi

- Ne šalje ništa na mrežu i ne čita razgovor. Od ulaza koristi samo ID sesije, ime događaja, `stop_hook_active` i `permission_mode`. U repo ide samo bilješka koju Claude sam napiše.
- Ne prekida rad: svaka njegova greška se tiho preskače. Bez mreže ili kad push ne uspije, bilješka ostaje na računaru i šalje se na jednom od sljedećih krajeva odgovora.

## Šta gdje stoji

Sve je u `~/.claude/biljeske-sesija/`, van svih repoa:

- `stanje/`: vrijeme rada po sesiji. Stariji fajlovi se brišu poslije 30 dana;
- `na-cekanju/`: bilješke koje još nisu poslate. Ako tu stoje duže vrijeme, razlog je u `posljednja-greska-slanja.txt`;
- `odbijene/`: bilješke koje su prošle prvu provjeru, a pale pri slanju jer se spisak zabranjenih pojmova u međuvremenu promijenio. Ne šalju se same: pogledaj ih, pa ih obriši ili ispravi.

## Uključivanje

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

## Provjera poslije uključivanja

Poslije 30+ minuta rada u jednoj sesiji treba da se u `biljeske-sesija/` na `main` privatnog repoa pojavi nova bilješka, a da objava i testovi ostanu nepokrenuti.

Bilješka na claude.ai se piše po posebnom uputstvu: [docs/biljeska-na-claude-ai.md](../docs/biljeska-na-claude-ai.md).
