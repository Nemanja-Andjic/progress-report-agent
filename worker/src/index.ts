// Worker samo provjeri ulaz, učita stanje, pozove pravila dana, upiše stanje i izvrši radnje.
// Vidi worker/README.md.

import {
  datumRadnogDana,
  KRAJ_DRUGOG_POKUSAJA_SAT,
  lokalnoVrijeme,
  noviDan,
  PITANJE_ISTEKLO,
  pomjerenDatum,
  primijeni,
  type Dogadjaj,
  type Faza,
  type LokalnoVrijeme,
  type Radnja,
  type StanjeDana,
} from "./pravila";
import {
  greskaZaNemanju,
  istekao,
  NEUSPJEH,
  porukaZaChat,
  RAZMISLJAM,
  SAMO_TEKST,
  spojenoPitanje,
  vrstaPoruke,
  type Chat,
  type IshodOdgovora,
  type Persiranje,
} from "./pitanja";

const REPO_IZVJESTAJA = "Nemanja-Andjic/progress-report-izvjestaji";
const WORKFLOW_PISANJA = "pisanje-i-objava.yml";
const WORKFLOW_PROVJERE = "provjera-svjezeg-rada.yml";
const WORKFLOW_JUTARNJE_PROVJERE = "jutarnja-provjera.yml";
const WORKFLOW_PITANJA = "pitanje-o-radu.yml";
// 6:30 UTC, u minutima od ponoći po UTC-u.
const JUTARNJA_PROVJERA_MINUT_UTC = 6 * 60 + 30;
const PODACI_DUGMETA = /^pitanje:(\d{4}-\d{2}-\d{2}):(jesam|nije)$/;
const OBLIK_VREMENA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/;
const ROK_POZIVA_MS = 10_000;
const POKUSAJI_UPISA = 5;
// Telegram prima do 4096 znakova, a oznaka probnog režima je dio poruke.
const NAJDUZA_PORUKA = 4000;

interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_TAJNA?: string;
  TELEGRAM_CHAT_NEMANJA?: string;
  TELEGRAM_CHAT_MENTOR?: string;
  GITHUB_TOKEN?: string;
  KLJUC_ACTIONS?: string;
  KLJUC_HOOKA?: string;
  PROBNI_REZIM?: string;
}

interface UcitanDan {
  stanje: StanjeDana;
  verzija: number;
}

interface RedDana {
  datum: string;
  faza: Faza;
  tekst: string | null;
  u_toku_od: number | null;
  samostalni_pokusaji: number;
  upozoren: number;
  posljednja_aktivnost: number | null;
  rad_iz_provjere: number | null;
  provjera_od: number | null;
  pitanje_od: number | null;
  nije_od: number | null;
  odlozeno_do: number | null;
  odlozeno_slanje: number;
  verzija: number;
}

function izReda(red: RedDana): UcitanDan {
  return {
    stanje: {
      datum: red.datum,
      faza: red.faza,
      tekst: red.tekst,
      uTokuOd: red.u_toku_od,
      samostalniPokusaji: red.samostalni_pokusaji,
      upozoren: Boolean(red.upozoren),
      posljednjaAktivnost: red.posljednja_aktivnost,
      radIzProvjere: red.rad_iz_provjere,
      provjeraOd: red.provjera_od,
      pitanjeOd: red.pitanje_od,
      nijeOd: red.nije_od,
      odlozenoDo: red.odlozeno_do,
      odlozenoSlanje: Boolean(red.odlozeno_slanje),
    },
    verzija: red.verzija,
  };
}

// Podešavanje koje fali ne pušta nikoga, a poređenje ne otkriva koliko se znakova poklopilo.
async function kljucVazi(primljen: string | null | undefined, ocekivan: string | undefined): Promise<boolean> {
  if (!primljen || !ocekivan) return false;
  const [a, b] = await Promise.all(
    [primljen, ocekivan].map((tekst) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(tekst))),
  );
  return crypto.subtle.timingSafeEqual(a, b);
}

function kljucIzZaglavlja(zahtjev: Request): string | undefined {
  return zahtjev.headers.get("Authorization")?.replace(/^Bearer /, "");
}

async function ucitajDan(db: D1Database, datum: string): Promise<UcitanDan> {
  const red = await db.prepare("SELECT * FROM dani WHERE datum = ?1").bind(datum).first<RedDana>();
  return red ? izReda(red) : { stanje: noviDan(datum), verzija: 0 };
}

// Od 0:00 do 1:00 to je jučerašnji dan dok nije zatvoren, a inače današnji (ADR 0008).
async function ucitajRadniDan(db: D1Database, lokalno: LokalnoVrijeme): Promise<UcitanDan> {
  const juce = await ucitajDan(db, pomjerenDatum(lokalno.datum, -1));
  if (datumRadnogDana(lokalno, juce.stanje.faza) === juce.stanje.datum) return juce;
  return ucitajDan(db, lokalno.datum);
}

// Upisuje samo ako red nije mijenjan od učitavanja. Zato od dva istovremena događaja prolazi
// jedan, a drugi ponovo učita stanje i dobije odgovor za novu fazu.
async function upisi(db: D1Database, stanje: StanjeDana, verzija: number): Promise<boolean> {
  const rezultat = await db
    .prepare(
      `INSERT INTO dani (datum, faza, tekst, u_toku_od, samostalni_pokusaji, upozoren, posljednja_aktivnost,
         provjera_od, pitanje_od, nije_od, odlozeno_do, rad_iz_provjere, odlozeno_slanje, verzija)
       VALUES (?1, ?2, ?3, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?4 + 1)
       ON CONFLICT (datum) DO UPDATE SET faza = excluded.faza, tekst = excluded.tekst,
         u_toku_od = excluded.u_toku_od, samostalni_pokusaji = excluded.samostalni_pokusaji,
         upozoren = excluded.upozoren, rad_iz_provjere = excluded.rad_iz_provjere,
         posljednja_aktivnost = excluded.posljednja_aktivnost, provjera_od = excluded.provjera_od,
         pitanje_od = excluded.pitanje_od, nije_od = excluded.nije_od, odlozeno_do = excluded.odlozeno_do,
         odlozeno_slanje = excluded.odlozeno_slanje, verzija = excluded.verzija
       WHERE dani.verzija = ?4`,
    )
    .bind(
      stanje.datum,
      stanje.faza,
      stanje.tekst,
      verzija,
      stanje.uTokuOd,
      stanje.samostalniPokusaji,
      Number(stanje.upozoren),
      stanje.posljednjaAktivnost,
      stanje.provjeraOd,
      stanje.pitanjeOd,
      stanje.nijeOd,
      stanje.odlozenoDo,
      stanje.radIzProvjere,
      Number(stanje.odlozenoSlanje),
    )
    .run();
  return rezultat.meta.changes === 1;
}

async function predji(
  db: D1Database,
  ucitaj: () => Promise<UcitanDan>,
  dogadjaj: Dogadjaj,
  lokalno: LokalnoVrijeme,
): Promise<{ datum: string; radnje: Radnja[] }> {
  for (let pokusaj = 0; pokusaj < POKUSAJI_UPISA; pokusaj++) {
    const { stanje, verzija } = await ucitaj();
    const prelaz = primijeni(stanje, dogadjaj, lokalno);
    const rezultat = { datum: prelaz.stanje.datum, radnje: prelaz.radnje };
    if (prelaz.stanje === stanje) return rezultat;
    // Novi dan još nema red u bazi, pa se ne poredi sa verzijom prethodnog dana.
    const ocekivana = prelaz.stanje.datum === stanje.datum ? verzija : 0;
    if (await upisi(db, prelaz.stanje, ocekivana)) return rezultat;
  }
  throw new Error("Stanje dana nije upisano.");
}

// Nikad ne ispisuje adresu ni tekst, jer adresa nosi token bota, a tekst je sadržaj izvještaja.
async function posaljiPoruku(env: Env, chat: string | undefined, tekst: string, dodatak?: object): Promise<boolean> {
  try {
    const odgovor = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: tekst, ...dodatak }),
      signal: AbortSignal.timeout(ROK_POZIVA_MS),
    });
    if (!odgovor.ok) console.error(`Telegram nije primio poruku: status ${odgovor.status}.`);
    return odgovor.ok;
  } catch {
    console.error("Telegram nije primio poruku: nema odgovora.");
    return false;
  }
}

function posaljiPitanje(env: Env, datum: string, tekst: string): Promise<boolean> {
  return posaljiPoruku(env, env.TELEGRAM_CHAT_NEMANJA, tekst, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Jesam", callback_data: `pitanje:${datum}:jesam` },
          { text: "Nije", callback_data: `pitanje:${datum}:nije` },
        ],
      ],
    },
  });
}

// Neuspjeh se samo bilježi: odgovor samo gasi znak na dugmetu, a pritisak je već obrađen.
async function odgovoriNaDugme(env: Env, id: string, tekst?: string): Promise<void> {
  try {
    const odgovor = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: id, text: tekst }),
      signal: AbortSignal.timeout(ROK_POZIVA_MS),
    });
    if (!odgovor.ok) console.error(`Telegram nije primio odgovor na dugme: status ${odgovor.status}.`);
  } catch {
    console.error("Telegram nije primio odgovor na dugme: nema odgovora.");
  }
}

// Jedino mjesto koje čita mentorov chat. Sve osim izričitog "iskljucen" znači probni režim.
// U probnom režimu poruka ide Nemanji, a poruke Nemanji uvijek stižu sa zvukom.
function posaljiMentoru(env: Env, tekst: string, bezZvuka: boolean): Promise<boolean> {
  if (env.PROBNI_REZIM === "iskljucen") {
    return posaljiPoruku(env, env.TELEGRAM_CHAT_MENTOR, tekst, bezZvuka ? { disable_notification: true } : undefined);
  }
  return posaljiPoruku(env, env.TELEGRAM_CHAT_NEMANJA, `(proba)\n\n${tekst}`);
}

async function pokreniWorkflow(env: Env, workflow: string, ulazi: Record<string, string>): Promise<boolean> {
  const adresa = `https://api.github.com/repos/${REPO_IZVJESTAJA}/actions/workflows/${workflow}/dispatches`;
  try {
    const odgovor = await fetch(adresa, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "progress-report-worker",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: "main", inputs: ulazi }),
      signal: AbortSignal.timeout(ROK_POZIVA_MS),
    });
    if (!odgovor.ok) console.error(`GitHub nije pokrenuo ${workflow}: status ${odgovor.status}.`);
    return odgovor.ok;
  } catch {
    console.error(`GitHub nije pokrenuo ${workflow}: nema odgovora.`);
    return false;
  }
}

// Vraća false samo ako poruka za mentora nije otišla. Tada dan ostaje bez poruke, a tekst u bazi.
async function izvrsi(env: Env, datum: string, radnje: Radnja[], lokalno: LokalnoVrijeme): Promise<boolean> {
  const nastavi = async (dogadjaj: Dogadjaj) =>
    izvrsi(env, datum, (await predji(env.DB, () => ucitajDan(env.DB, datum), dogadjaj, lokalno)).radnje, lokalno);

  for (const radnja of radnje) {
    switch (radnja.vrsta) {
      case "pokreni_pisanje":
        if (!(await pokreniWorkflow(env, WORKFLOW_PISANJA, { datum: radnja.datum }))) {
          return nastavi({ vrsta: "pokretanje_nije_uspjelo" });
        }
        break;
      case "pokreni_provjeru":
        if (!(await pokreniWorkflow(env, WORKFLOW_PROVJERE, { datum: radnja.datum, oznaka: radnja.oznaka }))) {
          return nastavi({ vrsta: "provjera_nije_pokrenuta" });
        }
        break;
      case "posalji_pitanje":
        if (!(await posaljiPitanje(env, radnja.datum, radnja.tekst))) {
          return nastavi({ vrsta: "pitanje_nije_poslato" });
        }
        break;
      case "odgovori_na_dugme":
        await odgovoriNaDugme(env, radnja.id, radnja.tekst);
        break;
      case "posalji_nemanji":
        await posaljiPoruku(env, env.TELEGRAM_CHAT_NEMANJA, radnja.tekst);
        break;
      case "posalji_mentoru":
        if (!(await posaljiMentoru(env, radnja.tekst, radnja.bezZvuka))) {
          await nastavi({ vrsta: "slanje_nije_uspjelo" });
          return false;
        }
        await nastavi({ vrsta: "poruka_poslata" });
        break;
    }
  }
  return true;
}

// Odgovor ide samo na chat sa kog je pitanje stiglo.
function idChata(env: Env, chat: Chat): string | undefined {
  return chat === "nemanja" ? env.TELEGRAM_CHAT_NEMANJA : env.TELEGRAM_CHAT_MENTOR;
}

// Briše poruke jednog pokretanja i vraća njihov chat. Brisanje vraća redove samo jednom, pa od
// odgovora, roka i neuspjelog pokretanja koji stignu u isto vrijeme dalje ide samo jedan.
async function obrisiPokretanje(db: D1Database, oznaka: string): Promise<Chat | null> {
  const { results } = await db
    .prepare("DELETE FROM pitanja_o_radu WHERE oznaka = ?1 RETURNING chat")
    .bind(oznaka)
    .all<{ chat: Chat }>();
  return results[0]?.chat ?? null;
}

async function javiNeuspjeh(env: Env, chat: Chat, razlog: "rok" | "nije_pokrenuto"): Promise<void> {
  await posaljiPoruku(env, idChata(env, chat), NEUSPJEH);
  await posaljiPoruku(env, env.TELEGRAM_CHAT_NEMANJA, greskaZaNemanju(chat, razlog));
}

// Pokretanje kome je prošao rok je neuspjeh, i kad GitHub workflow nije ni pokrenuo.
async function zavrsiIsteklo(env: Env, chat: Chat): Promise<void> {
  const pokretanje = await env.DB.prepare(
    "SELECT oznaka, pokrenuto FROM pitanja_o_radu WHERE chat = ?1 AND oznaka IS NOT NULL LIMIT 1",
  )
    .bind(chat)
    .first<{ oznaka: string; pokrenuto: number }>();
  if (!pokretanje || !istekao(pokretanje.pokrenuto, Date.now())) return;
  if (await obrisiPokretanje(env.DB, pokretanje.oznaka)) await javiNeuspjeh(env, chat, "rok");
}

// Ako za chat ništa nije u toku, sve poruke koje čekaju dobiju istu oznaku i idu kao jedno pitanje.
// Uslov je u istom upisu, pa od dva istovremena poziva pokreće samo jedan. Poruka koja stigne
// poslije upisa čeka sljedeće pokretanje.
async function pokreniSljedece(env: Env, chat: Chat): Promise<void> {
  for (;;) {
    const oznaka = crypto.randomUUID();
    const preuzeto = await env.DB.prepare(
      `UPDATE pitanja_o_radu SET oznaka = ?2, pokrenuto = ?3
       WHERE chat = ?1 AND oznaka IS NULL
         AND NOT EXISTS (SELECT 1 FROM pitanja_o_radu WHERE chat = ?1 AND oznaka IS NOT NULL)`,
    )
      .bind(chat, oznaka, Date.now())
      .run();
    if (preuzeto.meta.changes === 0) return;

    const { results } = await env.DB.prepare("SELECT tekst FROM pitanja_o_radu WHERE oznaka = ?1 ORDER BY id")
      .bind(oznaka)
      .all<{ tekst: string }>();
    const pitanje = spojenoPitanje(results.map((red) => red.tekst));
    if (await pokreniWorkflow(env, WORKFLOW_PITANJA, { chat, oznaka, pitanje })) return;
    // Neuspjelo pokretanje ide kao istekao rok, pa red prelazi na sljedeće poruke.
    if (await obrisiPokretanje(env.DB, oznaka)) await javiNeuspjeh(env, chat, "nije_pokrenuto");
  }
}

// Pitanje o radu nikad ne dira stanje radnog dana i nije aktivnost (ADR 0007). Potvrdu dobija i
// pitanje koje čeka u redu.
async function primiPitanje(env: Env, chat: Chat, tekst: string): Promise<void> {
  await zavrsiIsteklo(env, chat);
  await env.DB.prepare("INSERT INTO pitanja_o_radu (chat, tekst) VALUES (?1, ?2)").bind(chat, tekst).run();
  await posaljiPoruku(env, idChata(env, chat), RAZMISLJAM);
  await pokreniSljedece(env, chat);
}

// Dugme sa tuđeg chata ne dobija ni odgovor.
async function pritisnutoDugme(dugme: any, env: Env): Promise<Response> {
  const saNemanjinogChata =
    env.TELEGRAM_CHAT_NEMANJA && String(dugme.message?.chat?.id) === env.TELEGRAM_CHAT_NEMANJA;
  if (!saNemanjinogChata || typeof dugme.id !== "string") return new Response();

  const podaci = PODACI_DUGMETA.exec(String(dugme.data));
  if (!podaci) {
    await odgovoriNaDugme(env, dugme.id, PITANJE_ISTEKLO);
    return new Response();
  }

  const lokalno = lokalnoVrijeme(new Date());
  const dogadjaj: Dogadjaj = {
    vrsta: "dugme",
    id: dugme.id,
    datum: podaci[1],
    odgovor: podaci[2] === "jesam" ? "jesam" : "nije",
  };
  const { datum, radnje } = await predji(env.DB, () => ucitajRadniDan(env.DB, lokalno), dogadjaj, lokalno);
  await izvrsi(env, datum, radnje, lokalno);
  return new Response();
}

async function telegram(zahtjev: Request, env: Env): Promise<Response> {
  const tajna = zahtjev.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!(await kljucVazi(tajna, env.TELEGRAM_WEBHOOK_TAJNA))) return new Response(null, { status: 401 });

  // Na sve ostalo odgovara 200, jer Telegram inače ponavlja isti zahtjev.
  const izmjena = await zahtjev.json<any>().catch(() => null);
  if (izmjena?.callback_query) return pritisnutoDugme(izmjena.callback_query, env);
  const poruka = izmjena?.message;
  if (!env.TELEGRAM_CHAT_NEMANJA || String(poruka?.chat?.id) !== env.TELEGRAM_CHAT_NEMANJA) return new Response();
  const vrsta = vrstaPoruke(poruka?.text);
  if (vrsta.vrsta === "bez_teksta") {
    await posaljiPoruku(env, env.TELEGRAM_CHAT_NEMANJA, SAMO_TEKST);
    return new Response();
  }
  if (vrsta.vrsta === "pitanje") {
    await primiPitanje(env, "nemanja", vrsta.tekst);
    return new Response();
  }

  const dogadjaj: Dogadjaj = { vrsta: vrsta.komanda };
  const lokalno = lokalnoVrijeme(new Date());
  const { datum, radnje } = await predji(env.DB, () => ucitajRadniDan(env.DB, lokalno), dogadjaj, lokalno);
  await izvrsi(env, datum, radnje, lokalno);
  return new Response();
}

function ispravanDatum(datum: unknown): datum is string {
  if (typeof datum !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(datum)) return false;
  const vrijeme = new Date(`${datum}T00:00:00Z`);
  return !Number.isNaN(vrijeme.getTime()) && vrijeme.toISOString().startsWith(datum);
}

// Telegram ne prima praznu poruku, a duža od NAJDUZA_PORUKA ne bi stala uz oznaku probe.
function ispravanTekst(tekst: unknown): tekst is string {
  return typeof tekst === "string" && Boolean(tekst.trim()) && tekst.length <= NAJDUZA_PORUKA;
}

function dogadjajRezultata(telo: any): Dogadjaj | null {
  if (telo?.ishod === "neuspjeh") return { vrsta: "rezultat", ishod: "neuspjeh" };
  if (telo?.ishod !== "gotovo") return null;
  if (!ispravanTekst(telo.tekst)) return null;
  return { vrsta: "rezultat", ishod: "gotovo", tekst: telo.tekst };
}

async function rezultat(zahtjev: Request, env: Env): Promise<Response> {
  if (!(await kljucVazi(kljucIzZaglavlja(zahtjev), env.KLJUC_ACTIONS))) return new Response(null, { status: 401 });

  const telo = await zahtjev.json<any>().catch(() => null);
  const dogadjaj = dogadjajRezultata(telo);
  if (!dogadjaj || !ispravanDatum(telo?.datum)) return new Response(null, { status: 400 });

  const datum: string = telo.datum;
  const lokalno = lokalnoVrijeme(new Date());
  const { radnje } = await predji(env.DB, () => ucitajDan(env.DB, datum), dogadjaj, lokalno);
  const poslato = await izvrsi(env, datum, radnje, lokalno);
  return new Response(null, { status: poslato ? 200 : 502 });
}

function dogadjajProvjere(telo: any): Dogadjaj | null {
  if (typeof telo?.oznaka !== "string" || !telo.oznaka) return null;
  const { oznaka, ishod } = telo;
  if (ishod === "neuspjeh" || ishod === "nema-svjezeg-rada") return { vrsta: "provjera", oznaka, ishod };
  if (ishod !== "svjez-rad" || typeof telo.vrijeme !== "string" || !OBLIK_VREMENA.test(telo.vrijeme)) return null;
  const vrijeme = Date.parse(telo.vrijeme);
  return Number.isNaN(vrijeme) ? null : { vrsta: "provjera", oznaka, ishod, vrijeme };
}

async function provjera(zahtjev: Request, env: Env): Promise<Response> {
  if (!(await kljucVazi(kljucIzZaglavlja(zahtjev), env.KLJUC_ACTIONS))) return new Response(null, { status: 401 });

  const telo = await zahtjev.json<any>().catch(() => null);
  const dogadjaj = dogadjajProvjere(telo);
  if (!dogadjaj || !ispravanDatum(telo?.datum)) return new Response(null, { status: 400 });

  const datum: string = telo.datum;
  const lokalno = lokalnoVrijeme(new Date());
  const { radnje } = await predji(env.DB, () => ucitajDan(env.DB, datum), dogadjaj, lokalno);
  await izvrsi(env, datum, radnje, lokalno);
  return new Response();
}

// Opšta ruta za poruke vlasniku (ADR 0004): tekst ide samo na Nemanjin chat, bez oznake probe,
// i ništa se ne pamti. Ne ponavlja slanje, pa o novom pokušaju odlučuje workflow.
async function vlasnik(zahtjev: Request, env: Env): Promise<Response> {
  if (!(await kljucVazi(kljucIzZaglavlja(zahtjev), env.KLJUC_ACTIONS))) return new Response(null, { status: 401 });

  const telo = await zahtjev.json<any>().catch(() => null);
  const tekst = telo?.tekst;
  if (!ispravanTekst(tekst)) return new Response(null, { status: 400 });

  // Bez podešenog chata poruka ne ide nigdje, pa ni na neki drugi chat.
  const poslato = Boolean(env.TELEGRAM_CHAT_NEMANJA) && (await posaljiPoruku(env, env.TELEGRAM_CHAT_NEMANJA, tekst));
  return new Response(null, { status: poslato ? 200 : 502 });
}

const ISHODI_ODGOVORA: readonly unknown[] = ["odgovor", "odbijeno", "neuspjeh"] satisfies IshodOdgovora[];
const PERSIRANJA: readonly unknown[] = ["da", "ne", "bez_promjene"] satisfies Persiranje[];

interface JavljanjeOdgovora {
  oznaka: string;
  ishod: IshodOdgovora;
  tekst: string;
}

// Tekst se gleda samo uz odgovor, jer ga odbijeno pitanje i neuspjeh nemaju. Persiranje se za sad
// samo prima i provjerava, a upis i stalne poruke na "vi" su u #60.
function javljanjeOdgovora(telo: any): JavljanjeOdgovora | null {
  if (typeof telo?.oznaka !== "string" || !telo.oznaka) return null;
  if (!ISHODI_ODGOVORA.includes(telo.ishod) || !PERSIRANJA.includes(telo.persiranje)) return null;
  if (telo.ishod === "odgovor" && !ispravanTekst(telo.tekst)) return null;
  return { oznaka: telo.oznaka, ishod: telo.ishod, tekst: telo.ishod === "odgovor" ? telo.tekst : "" };
}

// Javljanje sa nepoznatom ili starom oznakom, dvostruko i zakasnilo ništa ne rade i vraćaju 200.
// Slanje se ne ponavlja: poruke pokretanja su već obrisane, pa ponovni zahtjev ne bi ništa uradio.
async function odgovor(zahtjev: Request, env: Env): Promise<Response> {
  if (!(await kljucVazi(kljucIzZaglavlja(zahtjev), env.KLJUC_ACTIONS))) return new Response(null, { status: 401 });

  const javljanje = javljanjeOdgovora(await zahtjev.json<any>().catch(() => null));
  if (!javljanje) return new Response(null, { status: 400 });

  const pokretanje = await env.DB.prepare("SELECT pokrenuto FROM pitanja_o_radu WHERE oznaka = ?1 LIMIT 1")
    .bind(javljanje.oznaka)
    .first<{ pokrenuto: number }>();
  if (!pokretanje || istekao(pokretanje.pokrenuto, Date.now())) return new Response();
  const chat = await obrisiPokretanje(env.DB, javljanje.oznaka);
  if (!chat) return new Response();

  await posaljiPoruku(env, idChata(env, chat), porukaZaChat(javljanje.ishod, javljanje.tekst));
  await pokreniSljedece(env, chat);
  return new Response();
}

// Rok se provjerava na svaki cron, pa i kad na chatu nema novih poruka.
async function redoviPitanja(env: Env): Promise<void> {
  const { results } = await env.DB.prepare("SELECT DISTINCT chat FROM pitanja_o_radu").all<{ chat: Chat }>();
  for (const { chat } of results) {
    await zavrsiIsteklo(env, chat);
    await pokreniSljedece(env, chat);
  }
}

// Samo čita, a odgovor nosi samo datum i fazu, jer tekst u bazi može biti sadržaj izvještaja.
async function stanjeDana(zahtjev: Request, env: Env): Promise<Response> {
  if (!(await kljucVazi(kljucIzZaglavlja(zahtjev), env.KLJUC_ACTIONS))) return new Response(null, { status: 401 });

  const datum = new URL(zahtjev.url).searchParams.get("datum");
  if (!ispravanDatum(datum)) return new Response(null, { status: 400 });

  const { stanje } = await ucitajDan(env.DB, datum);
  return Response.json({ datum, faza: stanje.faza });
}

// Tijelo zahtjeva se ne čita, a vrijeme je po satu Workera: zahtjev ne može da unese ništa drugo (ADR 0005).
async function aktivnost(zahtjev: Request, env: Env): Promise<Response> {
  if (!(await kljucVazi(kljucIzZaglavlja(zahtjev), env.KLJUC_HOOKA))) return new Response(null, { status: 401 });

  const lokalno = lokalnoVrijeme(new Date());
  await predji(env.DB, () => ucitajRadniDan(env.DB, lokalno), { vrsta: "aktivnost" }, lokalno);
  return new Response(null, { status: 204 });
}

// Jutarnju provjeru radi workflow, a Worker je samo pokreće, jednom dnevno od 6:30 UTC, za jučerašnji
// radni dan (ADR 0010). Tada je po lokalnom vremenu poslije 7:30, pa je jučerašnji radni dan jučerašnji
// datum. Datum se prvo upiše, pa od dva istovremena cron-a pokreće samo jedan. Ako pokretanje ne uspije,
// upis se briše, pa pokušava sljedeći cron. Cron koji izostane tako nadoknadi sljedeći, do kraja dana
// po UTC-u. Ako Worker padne između upisa i pokretanja, provjeru tog dana pokreće samo `schedule`.
async function jutarnjaProvjera(env: Env): Promise<void> {
  const sada = new Date();
  if (sada.getUTCHours() * 60 + sada.getUTCMinutes() < JUTARNJA_PROVJERA_MINUT_UTC) return;

  const datum = pomjerenDatum(sada.toISOString().slice(0, 10), -1);
  const upis = await env.DB.prepare("INSERT OR IGNORE INTO jutarnje_provjere (datum, pokrenuta) VALUES (?1, ?2)")
    .bind(datum, sada.getTime())
    .run();
  if (upis.meta.changes !== 1) return;
  if (!(await pokreniWorkflow(env, WORKFLOW_JUTARNJE_PROVJERE, { datum }))) {
    await env.DB.prepare("DELETE FROM jutarnje_provjere WHERE datum = ?1").bind(datum).run();
  }
}

// Pored današnjeg gleda i ranije dane koji još čekaju, npr. pisanje pokrenuto prije ponoći.
// Do 2:00 gleda i jučerašnji dan, zbog samostalnog slanja do 1:00 i pokušaja u 1:00 (ADR 0008).
async function cron(env: Env): Promise<void> {
  const lokalno = lokalnoVrijeme(new Date());
  const { results } = await env.DB.prepare(
    "SELECT datum FROM dani WHERE faza IN ('pisanje', 'bez_poruke') AND datum <> ?1 ORDER BY datum",
  )
    .bind(lokalno.datum)
    .all<{ datum: string }>();

  const juce = lokalno.sat < KRAJ_DRUGOG_POKUSAJA_SAT ? [pomjerenDatum(lokalno.datum, -1)] : [];
  const datumi = new Set([...results.map((red) => red.datum), ...juce].sort());
  for (const datum of [...datumi, lokalno.datum]) {
    const { radnje } = await predji(env.DB, () => ucitajDan(env.DB, datum), { vrsta: "cron" }, lokalno);
    await izvrsi(env, datum, radnje, lokalno);
  }
}

export default {
  async fetch(zahtjev, env) {
    const { pathname } = new URL(zahtjev.url);
    if (zahtjev.method === "POST" && pathname === "/telegram") return telegram(zahtjev, env);
    if (zahtjev.method === "POST" && pathname === "/actions/rezultat") return rezultat(zahtjev, env);
    if (zahtjev.method === "POST" && pathname === "/actions/provjera") return provjera(zahtjev, env);
    if (zahtjev.method === "POST" && pathname === "/actions/vlasnik") return vlasnik(zahtjev, env);
    if (zahtjev.method === "POST" && pathname === "/actions/odgovor") return odgovor(zahtjev, env);
    if (zahtjev.method === "GET" && pathname === "/actions/stanje") return stanjeDana(zahtjev, env);
    if (zahtjev.method === "POST" && pathname === "/aktivnost") return aktivnost(zahtjev, env);
    return new Response(null, { status: 404 });
  },
  async scheduled(_kontroler, env) {
    await cron(env);
    // Greška jutarnje provjere, npr. u bazi, ne smije da obori pravila dana, a pokušava sljedeći cron.
    await jutarnjaProvjera(env).catch(() => console.error("Jutarnja provjera nije pokrenuta: greška u Workeru."));
    await redoviPitanja(env).catch(() => console.error("Red pitanja o radu nije obrađen: greška u Workeru."));
  },
} satisfies ExportedHandler<Env>;
