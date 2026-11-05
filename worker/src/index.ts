// Worker samo provjeri ulaz, učita stanje, pozove pravila dana, upiše stanje i izvrši radnje.
// Vidi worker/README.md.

import {
  lokalnoVrijeme,
  noviDan,
  PITANJE_ISTEKLO,
  primijeni,
  type Dogadjaj,
  type Faza,
  type LokalnoVrijeme,
  type Radnja,
  type StanjeDana,
} from "./pravila";

const REPO_IZVJESTAJA = "Nemanja-Andjic/progress-report-izvjestaji";
const WORKFLOW_PISANJA = "pisanje-i-objava.yml";
const WORKFLOW_PROVJERE = "provjera-svjezeg-rada.yml";
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
  pokusaj_23: number;
  upozoren: number;
  posljednja_aktivnost: number | null;
  provjera_od: number | null;
  pitanje_od: number | null;
  nije_od: number | null;
  odlozeno_do: number | null;
  verzija: number;
}

function izReda(red: RedDana): UcitanDan {
  return {
    stanje: {
      datum: red.datum,
      faza: red.faza,
      tekst: red.tekst,
      uTokuOd: red.u_toku_od,
      pokusaj23: Boolean(red.pokusaj_23),
      upozoren: Boolean(red.upozoren),
      posljednjaAktivnost: red.posljednja_aktivnost,
      provjeraOd: red.provjera_od,
      pitanjeOd: red.pitanje_od,
      nijeOd: red.nije_od,
      odlozenoDo: red.odlozeno_do,
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

async function ucitajPosljednjiDan(db: D1Database, danas: string): Promise<UcitanDan> {
  const red = await db.prepare("SELECT * FROM dani ORDER BY datum DESC LIMIT 1").first<RedDana>();
  return red ? izReda(red) : { stanje: noviDan(danas), verzija: 0 };
}

// Upisuje samo ako red nije mijenjan od učitavanja. Zato od dva istovremena događaja prolazi
// jedan, a drugi ponovo učita stanje i dobije odgovor za novu fazu.
async function upisi(db: D1Database, stanje: StanjeDana, verzija: number): Promise<boolean> {
  const rezultat = await db
    .prepare(
      `INSERT INTO dani (datum, faza, tekst, u_toku_od, pokusaj_23, upozoren, posljednja_aktivnost,
         provjera_od, pitanje_od, nije_od, odlozeno_do, verzija)
       VALUES (?1, ?2, ?3, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?4 + 1)
       ON CONFLICT (datum) DO UPDATE SET faza = excluded.faza, tekst = excluded.tekst,
         u_toku_od = excluded.u_toku_od, pokusaj_23 = excluded.pokusaj_23, upozoren = excluded.upozoren,
         posljednja_aktivnost = excluded.posljednja_aktivnost, provjera_od = excluded.provjera_od,
         pitanje_od = excluded.pitanje_od, nije_od = excluded.nije_od, odlozeno_do = excluded.odlozeno_do,
         verzija = excluded.verzija
       WHERE dani.verzija = ?4`,
    )
    .bind(
      stanje.datum,
      stanje.faza,
      stanje.tekst,
      verzija,
      stanje.uTokuOd,
      Number(stanje.pokusaj23),
      Number(stanje.upozoren),
      stanje.posljednjaAktivnost,
      stanje.provjeraOd,
      stanje.pitanjeOd,
      stanje.nijeOd,
      stanje.odlozenoDo,
    )
    .run();
  return rezultat.meta.changes === 1;
}

async function predji(
  db: D1Database,
  ucitaj: () => Promise<UcitanDan>,
  dogadjaj: Dogadjaj,
  lokalno: LokalnoVrijeme,
): Promise<Radnja[]> {
  for (let pokusaj = 0; pokusaj < POKUSAJI_UPISA; pokusaj++) {
    const { stanje, verzija } = await ucitaj();
    const prelaz = primijeni(stanje, dogadjaj, lokalno);
    if (prelaz.stanje === stanje) return prelaz.radnje;
    // Novi dan još nema red u bazi, pa se ne poredi sa verzijom prethodnog dana.
    const ocekivana = prelaz.stanje.datum === stanje.datum ? verzija : 0;
    if (await upisi(db, prelaz.stanje, ocekivana)) return prelaz.radnje;
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
function posaljiMentoru(env: Env, tekst: string): Promise<boolean> {
  if (env.PROBNI_REZIM === "iskljucen") return posaljiPoruku(env, env.TELEGRAM_CHAT_MENTOR, tekst);
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
    izvrsi(env, datum, await predji(env.DB, () => ucitajDan(env.DB, datum), dogadjaj, lokalno), lokalno);

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
        if (!(await posaljiMentoru(env, radnja.tekst))) {
          await nastavi({ vrsta: "slanje_nije_uspjelo" });
          return false;
        }
        await nastavi({ vrsta: "poruka_poslata" });
        break;
    }
  }
  return true;
}

function jeZavrsio(tekst: unknown): boolean {
  if (typeof tekst !== "string") return false;
  const poruka = tekst.trim().toLowerCase();
  return poruka === "završio" || poruka === "zavrsio";
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
  const radnje = await predji(env.DB, () => ucitajDan(env.DB, lokalno.datum), dogadjaj, lokalno);
  await izvrsi(env, lokalno.datum, radnje, lokalno);
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
  if (!jeZavrsio(poruka?.text)) return new Response();

  const lokalno = lokalnoVrijeme(new Date());
  const radnje = await predji(
    env.DB,
    () => ucitajPosljednjiDan(env.DB, lokalno.datum),
    { vrsta: "zavrsio" },
    lokalno,
  );
  await izvrsi(env, lokalno.datum, radnje, lokalno);
  return new Response();
}

function ispravanDatum(datum: unknown): datum is string {
  if (typeof datum !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(datum)) return false;
  const vrijeme = new Date(`${datum}T00:00:00Z`);
  return !Number.isNaN(vrijeme.getTime()) && vrijeme.toISOString().startsWith(datum);
}

function dogadjajRezultata(telo: any): Dogadjaj | null {
  if (telo?.ishod === "neuspjeh") return { vrsta: "rezultat", ishod: "neuspjeh" };
  if (telo?.ishod !== "gotovo") return null;
  if (typeof telo.tekst !== "string" || !telo.tekst.trim() || telo.tekst.length > NAJDUZA_PORUKA) return null;
  return { vrsta: "rezultat", ishod: "gotovo", tekst: telo.tekst };
}

async function rezultat(zahtjev: Request, env: Env): Promise<Response> {
  if (!(await kljucVazi(kljucIzZaglavlja(zahtjev), env.KLJUC_ACTIONS))) return new Response(null, { status: 401 });

  const telo = await zahtjev.json<any>().catch(() => null);
  const dogadjaj = dogadjajRezultata(telo);
  if (!dogadjaj || !ispravanDatum(telo?.datum)) return new Response(null, { status: 400 });

  const datum: string = telo.datum;
  const lokalno = lokalnoVrijeme(new Date());
  const radnje = await predji(env.DB, () => ucitajDan(env.DB, datum), dogadjaj, lokalno);
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
  const radnje = await predji(env.DB, () => ucitajDan(env.DB, datum), dogadjaj, lokalno);
  await izvrsi(env, datum, radnje, lokalno);
  return new Response();
}

// Tijelo zahtjeva se ne čita, a vrijeme je po satu Workera: zahtjev ne može da unese ništa drugo (ADR 0005).
async function aktivnost(zahtjev: Request, env: Env): Promise<Response> {
  if (!(await kljucVazi(kljucIzZaglavlja(zahtjev), env.KLJUC_HOOKA))) return new Response(null, { status: 401 });

  const lokalno = lokalnoVrijeme(new Date());
  await predji(env.DB, () => ucitajDan(env.DB, lokalno.datum), { vrsta: "aktivnost" }, lokalno);
  return new Response(null, { status: 204 });
}

// Pored današnjeg gleda i ranije dane koji još čekaju, npr. pisanje pokrenuto prije ponoći.
async function cron(env: Env): Promise<void> {
  const lokalno = lokalnoVrijeme(new Date());
  const { results } = await env.DB.prepare(
    "SELECT datum FROM dani WHERE faza IN ('pisanje', 'bez_poruke') AND datum <> ?1 ORDER BY datum",
  )
    .bind(lokalno.datum)
    .all<{ datum: string }>();

  for (const datum of [...results.map((red) => red.datum), lokalno.datum]) {
    const radnje = await predji(env.DB, () => ucitajDan(env.DB, datum), { vrsta: "cron" }, lokalno);
    await izvrsi(env, datum, radnje, lokalno);
  }
}

export default {
  async fetch(zahtjev, env) {
    const { pathname } = new URL(zahtjev.url);
    if (zahtjev.method === "POST" && pathname === "/telegram") return telegram(zahtjev, env);
    if (zahtjev.method === "POST" && pathname === "/actions/rezultat") return rezultat(zahtjev, env);
    if (zahtjev.method === "POST" && pathname === "/actions/provjera") return provjera(zahtjev, env);
    if (zahtjev.method === "POST" && pathname === "/aktivnost") return aktivnost(zahtjev, env);
    return new Response(null, { status: 404 });
  },
  async scheduled(_kontroler, env) {
    await cron(env);
  },
} satisfies ExportedHandler<Env>;
