# Worker

Prima "završio", "odloži" i dugmad sa Telegrama, pamti posljednju aktivnost iz hooka, pita Nemanju da li je završio, poslije 23:00 sam pokreće pisanje u GitHub Actions kad prođe 40 minuta bez rada i šalje poruku iz rezultata (ADR 0004, ADR 0008). Mentoru poruke šalje samo Worker.

Jutarnju provjeru radi `jutarnja-provjera.yml` u privatnom repou, a ne Worker, da bi otkrila i kvar Workera. Od Workera samo čita stanje dana (`GET /actions/stanje`).

## Kako radi

`src/pravila.ts` je čista funkcija: ulaz je stanje dana, događaj i lokalno vrijeme, a izlaz novo stanje i spisak radnji. `src/index.ts` provjeri ulaz, učita stanje, pozove funkciju, upiše stanje i izvrši radnje.

| Faza | Značenje | "završio" |
|---|---|---|
| `otvoren` | ništa nije pokrenuto | pokreće pisanje |
| `pisanje` | workflow radi | odgovara da je pisanje u toku |
| `bez_poruke` | rezultat je stigao, a poruka nije poslata | odgovara da poruka još nije poslata |
| `neuspjeh` | pisanje nije uspjelo, nije pokrenuto ili se nije javilo u roku | pokreće novi pokušaj |
| `zatvoren` | poruka je poslata | odgovara da je izvještaj već poslat |

Svaki upis prolazi samo ako red nije mijenjan od učitavanja, pa od istovremenih događaja prolazi jedan. Zato dvije poruke pokreću jedno pisanje, a dva rezultata šalju jednu poruku.

## Radni dan

Stanje u bazi i pravila računaju **radni dan** (ADR 0008), po zoni `Europe/Belgrade`. Datum radnog dana je kalendarski datum, osim od 0:00 do 1:00: tada je radni dan jučerašnji, ako još nije zatvoren. Od 1:00 radni dan je uvijek tekući kalendarski.

- Aktivnost iz hooka, "završio" i dugme od 0:00 do 1:00 pripadaju jučerašnjem radnom danu dok nije zatvoren. Prva aktivnost poslije ponoći ne pravi novi dan dok je radni dan u toku.
- Rezultat važi za dan iz svog `datum`, pa pisanje pokrenuto u 1:00 za jučerašnji dan teče dalje i zatvara svoj dan.
- Dugme sa pitanja važi dok traje radni dan u kom je pitanje poslato, pa i poslije ponoći. Kad se dan zatvori, a najkasnije od 1:00, dugme dobija odgovor da je pitanje isteklo.
- **Od 1:00 do 5:00** "završio", "odloži" i "Jesam" sa jučerašnjeg pitanja se uvijek odnose na sinoćni rad. Ne pokreću ništa i ne važe za novi radni dan, a bot odgovori: "Radni dan je zatvoren u 1:00. Rad od sada ulazi u sljedeći izvještaj." Na dugme to stiže kao odgovor na pritisak. "Nije" sa jučerašnjeg pitanja i dalje dobija odgovor da je pitanje isteklo. Od 5:00 sve radi kao inače.
- Izvještaj i "Danas nema zabilježenog rada" idu mentoru bez zvuka (`disable_notification`) kad je kalendarski datum slanja poslije datuma radnog dana. Važi i za ponovljeno slanje. Poruke Nemanji, pa i one u probnom režimu, uvijek stižu sa zvukom.

Rezultat koji stigne van faze `pisanje` ništa ne radi. Ako slanje ne uspije, ruta vraća 502, dan ostaje `bez_poruke`, a tekst ostaje u bazi dok cron ne pošalje poruku.

## Cron

Okidač radi svakih 5 minuta po UTC-u (`wrangler.toml`), a Worker sam računa lokalno vrijeme. Svaki put gleda današnji dan i ranije dane koji su još u fazi `pisanje` ili `bez_poruke`, a do 2:00 i jučerašnji dan.

| Faza | Šta cron radi |
|---|---|
| `otvoren`, `neuspjeh` | samostalno slanje poslije 23:00 (vidi ispod). U fazi `otvoren` od 16:00 do 22:30 može da pokrene provjeru prije pitanja |
| `pisanje` | poslije 30 minuta bez rezultata prelazi u `neuspjeh` i upozorava Nemanju |
| `bez_poruke` | ponavlja slanje, bez novog pisanja |
| `zatvoren` | ništa |

- **Rokovi.** Računaju se po pravom vremenu, a ne po lokalnom satu, pa ih prelazak na ljetnje i zimsko vrijeme ne pomjera.
- **Neuspjeh.** Mentor ne dobija ništa, pa ni "Danas nema zabilježenog rada". Dan ostaje nezatvoren, a rad ulazi u sljedeći izvještaj. Dok radni dan traje, upozorenje Nemanji nudi "završio" za novi pokušaj. Kad prođe, npr. poslije neuspjeha u 1:00, upozorenje kaže da rad ulazi u sljedeći izvještaj, jer "završio" tada ne pokreće ništa do 5:00, a od 5:00 pokreće novi dan.
- **Upozorenje o slanju.** Ako slanje ne uspije od 23:00 nadalje, Nemanja jednom dobija upozorenje. Ranije se slanje samo ponavlja.
- **Dvostruko slanje.** Cron ne ponavlja slanje pokušano u posljednjih minut, pa ne šalje poruku koju ruta baš tada šalje. Ako Worker padne poslije poruke, a prije upisa `zatvoren`, ili odgovor Telegrama ne stigne, poruka može da ode dvaput. Telegram nema ključ koji bi to spriječio, a dvije iste poruke su bolje od poruke koja nikad ne stigne.

## Samostalno slanje poslije 23:00

Prije 23:00 izvještaj nikad ne ide sam, ni kad je pauza duga. Poslije 23:00 ide sam tek kad prođe 40 minuta bez rada, najranije u 23:40, a najkasnije u 1:00 (ADR 0008).

**T** je vrijeme posljednjeg rada koji Worker zna: posljednja aktivnost iz hooka ili rad koji je javila provjera. Dan bez ijednog signala iz hooka i bez rada iz provjere ima prvu provjeru u 23:40.

Cron pokreće `provjera-svjezeg-rada.yml` u prvom cron-u u kom je vrijeme bar 23:40 i bar T + 40 minuta, a prošlo je i odlaganje poslije neuspjele provjere. Javljanje ide na istu rutu kao prije pitanja, a Worker odlučuje:

| Javljanje | Šta Worker radi |
|---|---|
| `nema-svjezeg-rada` | pokreće pisanje. To je prvi samostalni pokušaj |
| `svjez-rad`, rad mlađi od 40 minuta | T je vrijeme tog rada, a sljedeća provjera je u T + 40 minuta |
| `svjez-rad`, rad star 40 minuta ili više | pokreće pisanje, kao `nema-svjezeg-rada` |
| `neuspjeh` ili ništa u roku od 15 minuta | nova provjera poslije 30 minuta |

- **Aktivnost za vrijeme provjere.** Pomjera T, a rezultat te provjere ne pokreće pisanje.
- **1:00.** Ako radni dan nije zatvoren i pisanje nije u toku, pisanje kreće bez provjere. To je drugi samostalni pokušaj, i kad prvi nije ni krenuo. Cron koji izostane nadoknadi sljedeći, do 2:00. Pisanje koje je u 1:00 bilo u toku zauzima taj pokušaj, pa poslije njegovog neuspjeha nema novog.
- **Najviše dva pokušaja.** Poslije neuspjeha prvog pokušaja nema novih provjera ni samostalnog slanja do 1:00. Poslije neuspjeha u 1:00 mentor ne dobija ništa, a Nemanja dobija upozorenje. "završio" i dalje pokreće novi pokušaj dok radni dan traje, a pisanje koje je ono pokrenulo ne troši samostalni pokušaj.
- **Neuspjeh prije 23:00**, npr. poslije "Jesam", ukida samo nova pitanja tog dana. Samostalno slanje poslije 23:00 i u 1:00 i dalje važi.
- **Pitanje bez odgovora** ne zaustavlja samostalno slanje, a ni "Nije" ga ne odlaže.
- **Dan bez rada** se utvrđuje istim putem, pa "Danas nema zabilježenog rada" ne ide prije 23:40.
- **"odloži"** ukida samostalno slanje poslije 40 minuta bez rada, ali ne i 1:00 (vidi ispod).

## "odloži"

Poruka "odloži" (ili "odlozi"), samo sa Nemanjinog chata, rezerva je za rad koji agent ne vidi (ADR 0008). Važi za radni dan koji je u toku, i prije 23:00 i od 0:00 do 1:00, a od 1:00 do 5:00 ne važi (vidi "Radni dan"). Bot potvrdi: "U redu, čekam tvoje ‚završio', najkasnije do 1:00."

Od tada tog radnog dana nema pitanja o završetku ni provjera, a izvještaj ide na "završio" ili u 1:00. Provjera koja je bila u toku se odbacuje.

| Faza | "odloži" |
|---|---|
| `otvoren`, `neuspjeh` | potvrda. Ponovno "odloži" samo ponovi potvrdu |
| `pisanje` | odgovara da je pisanje u toku |
| `bez_poruke` | odgovara da poruka još nije poslata |
| `zatvoren` | odgovara da je izvještaj već poslat |

- **Pitanje koje je već poslato** ostaje. "Jesam" i dalje pokreće pisanje, a "Nije" dobija odgovor "U redu." i ne pravi novo pitanje.
- **Poslije neuspjeha** "odloži" važi kao i inače, pa pisanje kreće u 1:00 ako taj pokušaj nije potrošen.
- **Poništavanja nema.** Izlaz je "završio".

## Pitanje o završetku

Cron pokreće `provjera-svjezeg-rada.yml` u privatnom repou kad su ispunjeni svi uslovi:

- dan je u fazi `otvoren`, pa je isključeno sve što je u toku, neuspjeh i zatvoren dan;
- vrijeme je između 16:00 i 22:30, obje granice uključene;
- tog dana je bilo aktivnosti iz hooka. Dan bez signala nema pitanje, a pokriva ga samostalno slanje poslije 23:00;
- pauza je bar 60 minuta;
- nema pitanja bez odgovora, ni provjere koja je u toku;
- prošlo je odlaganje, ako ga ima.

Workflow javi ishod, a Worker odlučuje:

| Javljanje | Šta Worker radi |
|---|---|
| `nema-svjezeg-rada` | šalje pitanje sa dugmadima "Jesam" i "Nije" |
| `svjez-rad`, rad mlađi od 60 minuta | odlaže za 60 minuta od tog rada. Posljednja aktivnost se ne mijenja, a rad se pamti i za samostalno slanje |
| `svjez-rad`, rad star 60 minuta ili više | šalje pitanje |
| `neuspjeh` ili ništa u roku od 15 minuta | nova provjera poslije 30 minuta, bez pitanja i bez poruke |

- **Stariji rad.** `svjez-rad` iz agenta daje posljednji rad u cijelom periodu izvještaja, pa i onaj od jutros. Zato se računa samo rad mlađi od pauze, inače pitanje ne bi krenulo nijednog dana sa commitom.
- **Aktivnost za vrijeme provjere.** Pitanje se ne šalje, jer pauze više nema, nego opet važi 60 minuta.
- **Oznaka provjere.** Svako pokretanje dobija svoju oznaku, a workflow je vraća. Javljanje sa drugom oznakom se ne računa, pa provjera koja je zakasnila ne odlučuje umjesto nove.
- **Rok za pitanje.** Provjera kreće najkasnije u 22:30, a javljanje poslije 15 minuta je neuspjeh, pa pitanje stiže najkasnije do 22:45.
- **Neuspjelo slanje.** Pitanje koje Telegram ne primi ne čeka odgovor, a nova provjera kreće poslije 30 minuta. Isto važi i kad GitHub ne pokrene workflow.

Dugmad:

| Dugme | Šta radi |
|---|---|
| "Jesam" | isto što i poruka "završio": pokreće pisanje odmah, a drugi pritisak ne pokreće novo |
| "Nije" | nova provjera za 30 minuta. Ako je u međuvremenu bilo aktivnosti, opet važi 60 minuta pauze. Provjera koja je u toku se odbacuje |
| dugme od ranijeg radnog dana | odgovor "Pitanje je isteklo.", bez ikakve radnje |
| dugme sa tuđeg chata | ignoriše se, bez odgovora |

Na pitanje bez odgovora nema novog pitanja dok se ne pojavi nova aktivnost. Poslije nje opet važi 60 minuta pauze, a dugmad sa starog pitanja i dalje važe do kraja radnog dana. Pritisak zato ne zavisi od toga koje je pitanje posljednje.

## Ulazi

### `POST /telegram`

Traži zaglavlje `X-Telegram-Bot-Api-Secret-Token`. Prima poruke "završio" i "odloži", sa Nemanjinog chata, bez obzira na velika slova, razmake oko riječi i kvačicu, i pritisak na dugme sa pitanja (`callback_query`). Sve ostalo se tiho preskače, sa statusom 200, da Telegram ne ponavlja zahtjev.

### `POST /actions/rezultat`

Traži zaglavlje `Authorization: Bearer <ključ za Actions>`.

```json
{ "datum": "2030-05-15", "ishod": "gotovo", "tekst": "Tekst poruke" }
```

| `ishod` | Šta radi |
|---|---|
| `gotovo` | šalje `tekst` mentoru i zatvara dan, poslije ponoći bez zvuka. Važi i za izvještaj i za dan bez rada, a `tekst` je obavezan, do 4000 znakova |
| `neuspjeh` | mentor ne dobija ništa, a Nemanja dobija upozorenje bez vrijednosti |

| Status | Značenje |
|---|---|
| 200 | primljeno, a poruka je poslata ako je trebalo. Važi i za dvostruk rezultat |
| 400 | tijelo nije ispravno, a stanje dana se ne mijenja |
| 401 | fali ključ ili nije ispravan |
| 502 | poruka nije poslata, a ponovno slanje radi cron Workera, ne workflow |

### `POST /actions/provjera`

Traži isti ključ kao `/actions/rezultat`. Poziva ga `provjera-svjezeg-rada.yml`, koji `datum` i `oznaka` dobija od Workera. Ista ruta služi i provjeri prije pitanja i samostalnoj provjeri poslije 23:00.

```json
{ "datum": "2030-05-15", "oznaka": "1905430800000", "ishod": "svjez-rad", "vrijeme": "2030-05-15T14:30+02:00" }
```

`ishod` je `svjez-rad`, `nema-svjezeg-rada` ili `neuspjeh`. `vrijeme` je obavezno samo za `svjez-rad` i mora da ima zonu. Čitaju se samo ova polja.

| Status | Značenje |
|---|---|
| 200 | primljeno. Važi i za dvostruko i zakasnilo javljanje, koje ništa ne mijenja |
| 400 | tijelo nije ispravno, a stanje dana se ne mijenja |
| 401 | fali ključ ili nije ispravan |

### `GET /actions/stanje?datum=2030-05-15`

Traži isti ključ kao `/actions/rezultat`. Poziva ga `jutarnja-provjera.yml`. Ruta samo čita, pa ne mijenja dan, ne šalje poruke i ne pravi red u bazi.

```json
{ "datum": "2030-05-15", "faza": "zatvoren" }
```

Odgovor nosi samo datum i fazu, nikad tekst poruke. `faza` je jedna od faza iz tabele iznad. Dan je zatvoren samo u fazi `zatvoren`, a tu je i dan bez rada, jer je mentor dobio "Danas nema zabilježenog rada". Dan koji Worker nije vidio, npr. jer mu cron nije radio, ima fazu `otvoren`.

| Status | Značenje |
|---|---|
| 200 | stanje je u tijelu |
| 400 | `datum` fali ili nije ispravan |
| 401 | fali ključ ili nije ispravan |

### `POST /actions/vlasnik`

Traži isti ključ kao `/actions/rezultat`. Opšta ruta za poruke vlasniku (ADR 0004): kroz nju workflow-i iz privatnog repoa šalju Nemanji greške i obavještenja, pa im ne treba Telegram token. Jedini izuzetak je jutarnja provjera, koja Nemanji piše direktno, jer tada Worker ne odgovara (ADR 0010).

```json
{ "tekst": "Tekst poruke" }
```

`tekst` je obavezan, do 4000 znakova, i ne smije biti prazan. Čita se samo ovo polje.

- Worker tekst samo proslijedi na Nemanjin chat, bez oznake "(proba)" i sa zvukom. Ništa ne pamti i ne mijenja stanje dana.
- Poruka ide samo na Nemanjin chat, nikad na mentorov, i u probnom režimu i van njega. Ako `TELEGRAM_CHAT_NEMANJA` nije podešen, ne ide nigdje.
- Worker ne ponavlja slanje. Ako Telegram ne primi poruku, o novom pokušaju odlučuje workflow.

| Status | Značenje |
|---|---|
| 200 | poruka je poslata |
| 400 | tijelo nije ispravno, a ništa se ne šalje |
| 401 | fali ključ ili nije ispravan |
| 502 | Telegram nije primio poruku |

### `POST /aktivnost`

Traži zaglavlje `Authorization: Bearer <ključ hooka>`. Taj ključ ne radi ni na jednoj drugoj ruti, a nijedan drugi ključ ne radi na ovoj. Poziva ga hook iz [hookovi/aktivnost.py](../hookovi/aktivnost.py) (ADR 0005).

Tijelo se ne čita, pa zahtjev ne može da unese ništa osim signala da je aktivnost bila. Vrijeme određuje Worker svojim satom i upisuje ga u radni dan. Od 0:00 do 1:00 to je jučerašnji dan dok nije zatvoren, a od 1:00, ili kad je jučerašnji zatvoren, prva aktivnost pravi red za novi dan.

Aktivnost mijenja samo vrijeme. Zatvoren dan ostaje zatvoren, pisanje koje je u toku teče dalje, a ništa se ne šalje.

| Status | Značenje |
|---|---|
| 204 | vrijeme je upisano |
| 401 | fali ključ ili nije ispravan |

### Ono što Worker očekuje od privatnog repoa

Worker pokreće `pisanje-i-objava.yml` na grani `main`, sa ulazom `datum`, i `provjera-svjezeg-rada.yml` na grani `main`, sa ulazima `datum` i `oznaka`. Workflow ne računa datum sam.

## Probni režim

Podešavanje je `PROBNI_REZIM` u `wrangler.toml`. Tek tačna vrijednost `iskljucen` šalje poruke na mentorov chat, bez oznake. Sve drugo, i kad podešavanje fali, šalje ih na Nemanjin chat, sa oznakom "(proba)".

`wrangler deploy` prepisuje vrijednost iz `wrangler.toml`, pa promjena samo na Cloudflare-u traje do sljedeće objave. Isključuje se u #32.

## Ručna objava

Worker je na posebnom Cloudflare nalogu (ADR 0004), a objavljuje se samo sa Nemanjinog računara, pa token koji može da ga izmijeni nije ni u jednom repou ni u GitHub Secrets. Komande se pokreću iz foldera `worker/`. Treba Node 24.

```sh
npm ci
npx wrangler login
npx wrangler whoami
```

`whoami` mora da pokaže poseban nalog, a ne nalog sa sajtom.

Baza se pravi jednom. ID baze se upiše u `database_id` u `wrangler.toml` i commit-uje. On nije tajna, jer bez pristupa nalogu ne daje ništa.

```sh
npx wrangler d1 create progress-report-worker
```

Prije svake objave:

```sh
npx wrangler d1 migrations apply DB --remote
npx wrangler deploy
```

### Tajne

Svaka se upisuje komandom `npx wrangler secret put IME`, koja vrijednost traži sama. Vrijednosti se ne pišu ni u jedan fajl u repou, ni u chat, ni u issue.

| Ime | Šta je |
|---|---|
| `TELEGRAM_BOT_TOKEN` | token bota |
| `TELEGRAM_WEBHOOK_TAJNA` | tajni token webhook-a, smije da ima slova, brojeve, `_` i `-`, npr. `openssl rand -hex 32` |
| `TELEGRAM_CHAT_NEMANJA` | ID Nemanjinog chata |
| `TELEGRAM_CHAT_MENTOR` | ID mentorovog chata, samo na Workeru |
| `GITHUB_TOKEN` | fine-grained token, samo za privatni repo i samo Actions: write |
| `KLJUC_ACTIONS` | ključ za rute za Actions, isti je i u GitHub Secrets privatnog repoa |
| `KLJUC_HOOKA` | ključ za javljanje aktivnosti, različit od `KLJUC_ACTIONS`, npr. `openssl rand -hex 32`. Drugi primjerak je samo na Nemanjinom računaru (vidi [hookovi/README.md](../hookovi/README.md)) |

Tajna koja fali se ponaša bezbjedno: ulaz bez svog ključa odbija svaki zahtjev.

### Webhook

Poslije prve objave, sa adresom koju je ispisao `wrangler deploy`. `read -rs` ne ostavlja vrijednosti u istoriji komandi:

```sh
read -rs TOKEN_BOTA
read -rs TAJNA_WEBHOOKA
curl -sS "https://api.telegram.org/bot$TOKEN_BOTA/setWebhook" \
  -d "url=https://ADRESA_WORKERA/telegram" \
  -d "secret_token=$TAJNA_WEBHOOKA" \
  -d 'allowed_updates=["message","callback_query"]'
```

Dok je webhook uključen, `getUpdates` za tog bota ne radi.

## Testovi

```sh
npm ci
npm test
npm run tipovi
```

Testovi rade lokalno, u Cloudflare-ovom alatu za testiranje Workera, sa lokalnim D1 i lažnim Telegramom i GitHub-om, pa ne traže nalog ni tajne. GitHub Actions (`.github/workflows/testovi.yml`) ih pokreće na push u `main` i na svaki pull request.
