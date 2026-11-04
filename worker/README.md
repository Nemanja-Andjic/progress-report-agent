# Worker

Prima "završio" sa Telegrama, u 23:00 sam pokreće pisanje u GitHub Actions i šalje poruku iz rezultata (ADR 0004). Mentoru poruke šalje samo Worker.

Pitanje o završetku, javljanje aktivnosti i jutarnja provjera stižu u #28 do #30.

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

Dan se računa po zoni `Europe/Belgrade`. "završio" važi za tekući dan, a rezultat za dan iz svog `datum`, pa rezultat stigao poslije ponoći zatvara svoj dan.

Rezultat koji stigne van faze `pisanje` ništa ne radi. Ako slanje ne uspije, ruta vraća 502, dan ostaje `bez_poruke`, a tekst ostaje u bazi dok cron ne pošalje poruku.

## Cron

Okidač radi svakih 5 minuta po UTC-u (`wrangler.toml`), a Worker sam računa lokalno vrijeme. Svaki put gleda današnji dan i ranije dane koji su još u fazi `pisanje` ili `bez_poruke`.

| Faza | Šta cron radi |
|---|---|
| `otvoren`, `neuspjeh` | od 23:00 do ponoći, ako cron već nije pokretao pisanje za taj dan, pokreće pisanje |
| `pisanje` | poslije 30 minuta bez rezultata prelazi u `neuspjeh` i upozorava Nemanju |
| `bez_poruke` | ponavlja slanje, bez novog pisanja |
| `zatvoren` | ništa |

- **Jedan pokušaj.** Cron pokreće pisanje najviše jednom za dan, pa neuspjeh u 23:00 ne pravi novo pisanje svakih 5 minuta. "završio" i dalje pokreće novi pokušaj. Pisanje koje je "završio" pokrenuo prije toga ne troši pokušaj iz 23:00.
- **Rokovi.** Računaju se po pravom vremenu, a ne po lokalnom satu, pa ih prelazak na ljetnje i zimsko vrijeme ne pomjera.
- **Neuspjeh.** Mentor ne dobija ništa, pa ni "Danas nema zabilježenog rada". Dan ostaje nezatvoren, a rad ulazi u sljedeći izvještaj.
- **Upozorenje o slanju.** Ako slanje ne uspije od 23:00 nadalje, Nemanja jednom dobija upozorenje. Ranije se slanje samo ponavlja.
- **Dvostruko slanje.** Cron ne ponavlja slanje pokušano u posljednjih minut, pa ne šalje poruku koju ruta baš tada šalje. Ako Worker padne poslije poruke, a prije upisa `zatvoren`, ili odgovor Telegrama ne stigne, poruka može da ode dvaput. Telegram nema ključ koji bi to spriječio, a dvije iste poruke su bolje od poruke koja nikad ne stigne.

## Ulazi

### `POST /telegram`

Traži zaglavlje `X-Telegram-Bot-Api-Secret-Token`. Prima samo poruku "završio", sa Nemanjinog chata, bez obzira na velika slova, razmake oko riječi i kvačicu na `š`. Sve ostalo se tiho preskače, sa statusom 200, da Telegram ne ponavlja zahtjev.

### `POST /actions/rezultat`

Traži zaglavlje `Authorization: Bearer <ključ za Actions>`.

```json
{ "datum": "2030-05-15", "ishod": "gotovo", "tekst": "Tekst poruke" }
```

| `ishod` | Šta radi |
|---|---|
| `gotovo` | šalje `tekst` mentoru i zatvara dan. Važi i za izvještaj i za dan bez rada, a `tekst` je obavezan, do 4000 znakova |
| `neuspjeh` | mentor ne dobija ništa, a Nemanja dobija upozorenje bez vrijednosti |

| Status | Značenje |
|---|---|
| 200 | primljeno, a poruka je poslata ako je trebalo. Važi i za dvostruk rezultat |
| 400 | tijelo nije ispravno, a stanje dana se ne mijenja |
| 401 | fali ključ ili nije ispravan |
| 502 | poruka nije poslata, a ponovno slanje radi cron Workera, ne workflow |

### Ono što Worker očekuje od #26

Worker pokreće `pisanje-i-objava.yml` u privatnom repou, na grani `main`, sa ulazom `datum`. Workflow ne računa datum sam.

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

Tajna koja fali se ponaša bezbjedno: ulaz bez svog ključa odbija svaki zahtjev.

### Webhook

Poslije prve objave, sa adresom koju je ispisao `wrangler deploy`. `read -rs` ne ostavlja vrijednosti u istoriji komandi:

```sh
read -rs TOKEN_BOTA
read -rs TAJNA_WEBHOOKA
curl -sS "https://api.telegram.org/bot$TOKEN_BOTA/setWebhook" \
  -d "url=https://ADRESA_WORKERA/telegram" \
  -d "secret_token=$TAJNA_WEBHOOKA" \
  -d 'allowed_updates=["message"]'
```

Dok je webhook uključen, `getUpdates` za tog bota ne radi.

## Testovi

```sh
npm ci
npm test
npm run tipovi
```

Testovi rade lokalno, u Cloudflare-ovom alatu za testiranje Workera, sa lokalnim D1 i lažnim Telegramom i GitHub-om, pa ne traže nalog ni tajne. GitHub Actions (`.github/workflows/testovi.yml`) ih pokreće na push u `main` i na svaki pull request.
