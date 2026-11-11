import { applyD1Migrations, env as bazniEnv, reset } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";

const CHAT_NEMANJA = 111;
const CHAT_MENTOR = 222;
const CHAT_TUDJI = 333;
const TAJNA_WEBHOOKA = "lazna-tajna-webhooka";
const KLJUC_ACTIONS = "lazni-kljuc-actions";
const KLJUC_HOOKA = "lazni-kljuc-hooka";
const TOKEN_BOTA = "lazni-token-bota";
const TOKEN_GITHUBA = "lazni-token-githuba";

// 12:00 po lokalnom vremenu, jer je 15.5. na snazi ljetnje računanje (+02:00).
const DANAS = "2030-05-15";
const PODNE = new Date("2030-05-15T10:00:00Z");

const ENV = {
  DB: bazniEnv.DB,
  TELEGRAM_BOT_TOKEN: TOKEN_BOTA,
  TELEGRAM_WEBHOOK_TAJNA: TAJNA_WEBHOOKA,
  TELEGRAM_CHAT_NEMANJA: String(CHAT_NEMANJA),
  TELEGRAM_CHAT_MENTOR: String(CHAT_MENTOR),
  GITHUB_TOKEN: TOKEN_GITHUBA,
  KLJUC_ACTIONS,
  KLJUC_HOOKA,
  PROBNI_REZIM: "ukljucen",
};

type Env = typeof ENV;

// Lažni Telegram i GitHub: pamte šta je stiglo, a obaraju se po potrebi.
let poruke: { chat: number; tekst: string; bezZvuka?: true }[];
let pokretanja: { url: string; token: string | null; telo: unknown }[];
let telegramPada: boolean;
let mentorPada: boolean;
let githubPada: boolean;
let dugmad: unknown[];
let odgovoriNaDugmad: { id: string; tekst?: string }[];

async function lazniSvijet(ulaz: RequestInfo | URL, opcije?: RequestInit): Promise<Response> {
  const zahtjev = new Request(ulaz, opcije);
  const adresa = new URL(zahtjev.url);
  if (adresa.hostname === "api.telegram.org") {
    if (telegramPada) return new Response("{}", { status: 500 });
    if (adresa.pathname === `/bot${TOKEN_BOTA}/answerCallbackQuery`) {
      const telo = (await zahtjev.json()) as { callback_query_id: string; text?: string };
      odgovoriNaDugmad.push({ id: telo.callback_query_id, tekst: telo.text });
      return Response.json({ ok: true });
    }
    if (adresa.pathname !== `/bot${TOKEN_BOTA}/sendMessage`) return new Response("{}", { status: 500 });
    const telo = (await zahtjev.json()) as {
      chat_id: string;
      text: string;
      reply_markup?: unknown;
      disable_notification?: boolean;
    };
    if (mentorPada && Number(telo.chat_id) === CHAT_MENTOR) return new Response("{}", { status: 403 });
    // Poruka sa zvukom nema polje bezZvuka, pa je i postojeće provjere vide.
    poruke.push({ chat: Number(telo.chat_id), tekst: telo.text, ...(telo.disable_notification ? { bezZvuka: true } : {}) });
    if (telo.reply_markup) dugmad.push(telo.reply_markup);
    return Response.json({ ok: true });
  }
  if (adresa.hostname === "api.github.com") {
    if (githubPada) return new Response("{}", { status: 500 });
    pokretanja.push({
      url: zahtjev.url,
      token: zahtjev.headers.get("Authorization"),
      telo: await zahtjev.json(),
    });
    return new Response(null, { status: 204 });
  }
  throw new Error(`Neočekivan poziv: ${adresa.hostname}`);
}

function pozovi(zahtjev: Request, env: Partial<Env> = ENV): Promise<Response> {
  return worker.fetch(zahtjev as Parameters<typeof worker.fetch>[0], env as Env);
}

function telegramZahtjev(tekst: string, chat = CHAT_NEMANJA, tajna: string | null = TAJNA_WEBHOOKA): Request {
  const zaglavlja: Record<string, string> = tajna ? { "X-Telegram-Bot-Api-Secret-Token": tajna } : {};
  return new Request("https://worker.test/telegram", {
    method: "POST",
    headers: zaglavlja,
    body: JSON.stringify({ update_id: 1, message: { message_id: 1, chat: { id: chat }, text: tekst } }),
  });
}

function rezultatZahtjev(telo: unknown, kljuc: string | null = KLJUC_ACTIONS): Request {
  const zaglavlja: Record<string, string> = kljuc ? { Authorization: `Bearer ${kljuc}` } : {};
  return new Request("https://worker.test/actions/rezultat", {
    method: "POST",
    headers: zaglavlja,
    body: typeof telo === "string" ? telo : JSON.stringify(telo),
  });
}

function aktivnostZahtjev(kljuc: string | null = KLJUC_HOOKA, telo?: string): Request {
  const zaglavlja: Record<string, string> = kljuc ? { Authorization: `Bearer ${kljuc}` } : {};
  return new Request("https://worker.test/aktivnost", { method: "POST", headers: zaglavlja, body: telo });
}

const aktivnost = (env?: Partial<Env>) => pozovi(aktivnostZahtjev(), env);
// Jedini izuzetak od pravila da testovi ne gledaju u bazu: ovo vrijeme se spolja vidi samo posredno, kroz pitanje.
const posljednjaAktivnost = (datum = DANAS) =>
  bazniEnv.DB.prepare("SELECT posljednja_aktivnost AS vrijeme FROM dani WHERE datum = ?1")
    .bind(datum)
    .first<{ vrijeme: number | null }>()
    .then((red) => red?.vrijeme ?? null);
const zavrsio = (env?: Partial<Env>) => pozovi(telegramZahtjev("završio"), env);
const gotovo = (tekst: string, env?: Partial<Env>, datum = DANAS) =>
  pozovi(rezultatZahtjev({ datum, ishod: "gotovo", tekst }), env);
const neuspjeh = (env?: Partial<Env>, datum = DANAS) => pozovi(rezultatZahtjev({ datum, ishod: "neuspjeh" }), env);
const porukeNaChat = (chat: number) => poruke.filter((poruka) => poruka.chat === chat);
const cron = (env: Partial<Env> = ENV) => worker.scheduled({} as ScheduledController, env as Env);
// Pomjeri sat, pa pokrene cron. Vrijeme je po UTC-u: 15.5. je 23:40 po lokalnom u 21:40 UTC, a 1:00 u 23:00 UTC.
const cronU = (vrijeme: string, env?: Partial<Env>) => {
  vi.setSystemTime(new Date(vrijeme));
  return cron(env);
};

const pokretanjaWorkflowa = (ime: string) => pokretanja.filter((pokretanje) => pokretanje.url.includes(ime));
const provjere = () => pokretanjaWorkflowa("provjera-svjezeg-rada.yml");
const pisanja = () => pokretanjaWorkflowa("pisanje-i-objava.yml");
const datumiPisanja = () => pisanja().map((pokretanje) => (pokretanje.telo as { inputs: { datum: string } }).inputs.datum);
const oznaka = () => (provjere().at(-1)?.telo as { inputs: { oznaka: string } }).inputs.oznaka;

function provjeraZahtjev(telo: unknown, kljuc: string | null = KLJUC_ACTIONS): Request {
  const zaglavlja: Record<string, string> = kljuc ? { Authorization: `Bearer ${kljuc}` } : {};
  return new Request("https://worker.test/actions/provjera", {
    method: "POST",
    headers: zaglavlja,
    body: typeof telo === "string" ? telo : JSON.stringify(telo),
  });
}
const javi = (ishod: string, vrijeme?: string, env?: Partial<Env>) =>
  pozovi(provjeraZahtjev({ datum: DANAS, oznaka: oznaka(), ishod, vrijeme }), env);

// Prvi samostalni pokušaj: provjera u 23:40 po lokalnom ne nađe svjež rad, pa pisanje kreće u 23:42.
async function samostalno(env?: Partial<Env>) {
  await cronU("2030-05-15T21:40:00Z", env);
  vi.setSystemTime(new Date("2030-05-15T21:42:00Z"));
  await javi("nema-svjezeg-rada", undefined, env);
  expect(pisanja()).toHaveLength(1);
}

beforeEach(async () => {
  await reset();
  await applyD1Migrations(bazniEnv.DB, bazniEnv.MIGRACIJE);
  poruke = [];
  pokretanja = [];
  telegramPada = false;
  mentorPada = false;
  githubPada = false;
  dugmad = [];
  odgovoriNaDugmad = [];
  vi.useFakeTimers({ toFake: ["Date"], now: PODNE });
  vi.spyOn(globalThis, "fetch").mockImplementation(lazniSvijet);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("pitanje o završetku", () => {
  const TEKST_PITANJA = "Da li si završio za danas?";
  const sat = (vrijeme: string) => vi.setSystemTime(new Date(`2030-05-15T${vrijeme}:00Z`));
  const cronUTC = (vrijeme: string, env?: Partial<Env>) => cronU(`2030-05-15T${vrijeme}:00Z`, env);
  const pitanja = () => poruke.filter((poruka) => poruka.tekst === TEKST_PITANJA);

  function dugmeZahtjev(data: string, chat = CHAT_NEMANJA, tajna: string | null = TAJNA_WEBHOOKA): Request {
    const zaglavlja: Record<string, string> = tajna ? { "X-Telegram-Bot-Api-Secret-Token": tajna } : {};
    return new Request("https://worker.test/telegram", {
      method: "POST",
      headers: zaglavlja,
      body: JSON.stringify({
        update_id: 2,
        callback_query: { id: "dugme-1", data, from: { id: chat }, message: { message_id: 9, chat: { id: chat } } },
      }),
    });
  }
  const pritisni = (odgovor: "jesam" | "nije", datum = DANAS) => pozovi(dugmeZahtjev(`pitanje:${datum}:${odgovor}`));

  // Aktivnost u 16:00 po lokalnom, provjera u 17:00, a javljanje u 17:02.
  async function doProvjere() {
    sat("14:00");
    await aktivnost();
    await cronUTC("15:00");
    expect(provjere()).toHaveLength(1);
  }
  async function doPitanja() {
    await doProvjere();
    sat("15:02");
    await javi("nema-svjezeg-rada");
    expect(pitanja()).toHaveLength(1);
  }

  describe("granice i uslovi", () => {
    it.each([
      ["15:55 po lokalnom je rano", "13:55", 0],
      ["16:00 po lokalnom je prvi trenutak", "14:00", 1],
      ["22:30 po lokalnom je posljednji trenutak", "20:30", 1],
      ["22:35 po lokalnom je kasno", "20:35", 0],
    ])("%s", async (_ime, vrijeme, broj) => {
      sat("12:00");
      await aktivnost();

      await cronUTC(vrijeme);

      expect(provjere()).toHaveLength(broj);
      expect(poruke).toEqual([]);
    });

    it("pokreće workflow provjere na main, sa datumom i oznakom, a pitanja još nema", async () => {
      await doProvjere();

      expect(provjere()[0].url).toBe(
        "https://api.github.com/repos/Nemanja-Andjic/progress-report-izvjestaji/actions/workflows/provjera-svjezeg-rada.yml/dispatches",
      );
      expect(provjere()[0].token).toBe(`Bearer ${TOKEN_GITHUBA}`);
      expect(provjere()[0].telo).toEqual({
        ref: "main",
        inputs: { datum: DANAS, oznaka: String(Date.parse("2030-05-15T15:00:00Z")) },
      });
      expect(pitanja()).toEqual([]);
    });

    it("pauza kraća od 60 minuta ne pokreće provjeru", async () => {
      sat("14:01");
      await aktivnost();

      await cronUTC("15:00");
      expect(provjere()).toEqual([]);

      await cronUTC("15:05");
      expect(provjere()).toHaveLength(1);
    });

    it("dan bez signala iz hooka nema ni provjeru ni pitanje, a prva provjera mu je u 23:40", async () => {
      for (const vrijeme of ["14:00", "16:00", "18:00", "20:30", "21:00", "21:35"]) await cronUTC(vrijeme);
      expect(provjere()).toEqual([]);
      expect(poruke).toEqual([]);

      await cronUTC("21:40");
      expect(provjere()).toHaveLength(1);
      expect(pisanja()).toEqual([]);
    });

    it("zatvoren dan nema provjeru", async () => {
      sat("14:00");
      await zavrsio();
      await gotovo("Tekst");
      await aktivnost();

      await cronUTC("15:00");

      expect(provjere()).toEqual([]);
    });

    it("dan sa neuspjehom nema provjeru", async () => {
      sat("13:00");
      await zavrsio();
      await neuspjeh();
      await aktivnost();

      await cronUTC("15:00");

      expect(provjere()).toEqual([]);
    });

    it("dok pisanje traje nema provjere", async () => {
      sat("14:00");
      await aktivnost();
      sat("15:00");
      await zavrsio();

      await cronUTC("15:05");

      expect(provjere()).toEqual([]);
    });

    it("dva cron-a u isto vrijeme pokreću jednu provjeru", async () => {
      sat("14:00");
      await aktivnost();
      sat("15:00");

      await Promise.all([cron(), cron()]);

      expect(provjere()).toHaveLength(1);
    });
  });

  describe("rezultat provjere", () => {
    it("bez svježeg rada Nemanja dobija pitanje sa dugmadima, a mentor ništa", async () => {
      await doPitanja();

      expect(pitanja()).toEqual([{ chat: CHAT_NEMANJA, tekst: TEKST_PITANJA }]);
      expect(dugmad).toEqual([
        {
          inline_keyboard: [
            [
              { text: "Jesam", callback_data: `pitanje:${DANAS}:jesam` },
              { text: "Nije", callback_data: `pitanje:${DANAS}:nije` },
            ],
          ],
        },
      ]);
    });

    it("sa svježim radom odlaže pitanje 60 minuta od tog rada, a posljednja aktivnost ostaje", async () => {
      await doProvjere();
      sat("15:02");
      const prije = await posljednjaAktivnost();

      expect((await javi("svjez-rad", "2030-05-15T16:40+02:00")).status).toBe(200);
      expect(pitanja()).toEqual([]);
      expect(await posljednjaAktivnost()).toBe(prije);

      await cronUTC("15:35");
      expect(provjere()).toHaveLength(1);

      await cronUTC("15:40");
      expect(provjere()).toHaveLength(2);

      await javi("svjez-rad", "2030-05-15T16:40+02:00");
      expect(pitanja()).toHaveLength(1);
    });

    it("rad stariji od 60 minuta ne sprečava pitanje", async () => {
      await doProvjere();
      sat("15:02");

      await javi("svjez-rad", "2030-05-15T09:15+02:00");

      expect(pitanja()).toHaveLength(1);
    });

    it("dvostruko javljanje šalje jedno pitanje", async () => {
      await doProvjere();
      sat("15:02");
      const trenutna = oznaka();
      const telo = { datum: DANAS, oznaka: trenutna, ishod: "nema-svjezeg-rada" };

      await Promise.all([pozovi(provjeraZahtjev(telo)), pozovi(provjeraZahtjev(telo))]);
      await pozovi(provjeraZahtjev(telo));

      expect(pitanja()).toHaveLength(1);
    });

    it("javljanje bez pokrenute provjere ne šalje pitanje", async () => {
      sat("15:00");
      const odgovor = await pozovi(provjeraZahtjev({ datum: DANAS, oznaka: "123", ishod: "nema-svjezeg-rada" }));

      expect(odgovor.status).toBe(200);
      expect(poruke).toEqual([]);
    });

    it.each([
      ["nečitljivo tijelo", "nije json"],
      ["nepoznat ishod", { datum: DANAS, oznaka: "1", ishod: "mozda" }],
      ["bez oznake", { datum: DANAS, ishod: "nema-svjezeg-rada" }],
      ["bez datuma", { oznaka: "1", ishod: "nema-svjezeg-rada" }],
      ["svjež rad bez vremena", { datum: DANAS, oznaka: "1", ishod: "svjez-rad" }],
      ["vrijeme bez zone", { datum: DANAS, oznaka: "1", ishod: "svjez-rad", vrijeme: "2030-05-15T16:40" }],
      ["nečitljivo vrijeme", { datum: DANAS, oznaka: "1", ishod: "svjez-rad", vrijeme: "juče" }],
    ])("odbija %s", async (_ime, telo) => {
      expect((await pozovi(provjeraZahtjev(telo))).status).toBe(400);
    });

    it.each([
      ["bez ključa", null],
      ["sa pogrešnim ključem", "pogresan"],
      ["sa ključem hooka", KLJUC_HOOKA],
      ["sa tajnom webhook-a", TAJNA_WEBHOOKA],
    ])("ruta odbija zahtjev %s i ne šalje pitanje", async (_ime, kljuc) => {
      await doProvjere();
      sat("15:02");

      const odgovor = await pozovi(provjeraZahtjev({ datum: DANAS, oznaka: oznaka(), ishod: "nema-svjezeg-rada" }, kljuc));

      expect(odgovor.status).toBe(401);
      expect(pitanja()).toEqual([]);
    });
  });

  describe("neuspjela provjera", () => {
    it("koja se ne javi 15 minuta ponavlja se poslije 30 minuta, bez pitanja", async () => {
      await doProvjere();

      await cronUTC("15:10");
      await cronUTC("15:15");
      await cronUTC("15:40");
      expect(provjere()).toHaveLength(1);
      expect(poruke).toEqual([]);

      await cronUTC("15:45");
      expect(provjere()).toHaveLength(2);
      expect(poruke).toEqual([]);
    });

    it("javljanje poslije roka ne šalje pitanje", async () => {
      await doProvjere();
      sat("15:15");

      await javi("nema-svjezeg-rada");

      expect(pitanja()).toEqual([]);
    });

    it("javljanje stare provjere ne odlučuje umjesto nove", async () => {
      await doProvjere();
      const stara = oznaka();
      await cronUTC("15:15");
      await cronUTC("15:45");
      sat("15:46");

      await pozovi(provjeraZahtjev({ datum: DANAS, oznaka: stara, ishod: "nema-svjezeg-rada" }));
      expect(pitanja()).toEqual([]);

      await javi("nema-svjezeg-rada");
      expect(pitanja()).toHaveLength(1);
    });

    it("javljeni neuspjeh ne šalje pitanje, a ne šalje ni tekst iz zahtjeva", async () => {
      await doProvjere();
      sat("15:02");

      await pozovi(provjeraZahtjev({ datum: DANAS, oznaka: oznaka(), ishod: "neuspjeh", razlog: "Tajna vrijednost" }));

      expect(poruke).toEqual([]);
      await cronUTC("15:30");
      expect(provjere()).toHaveLength(1);
      await cronUTC("15:35");
      expect(provjere()).toHaveLength(2);
    });

    it("workflow koji GitHub ne pokrene ponavlja se poslije 30 minuta", async () => {
      sat("14:00");
      await aktivnost();
      githubPada = true;
      await cronUTC("15:00");
      githubPada = false;

      await cronUTC("15:25");
      expect(provjere()).toEqual([]);

      await cronUTC("15:30");
      expect(provjere()).toHaveLength(1);
    });

    it("pitanje koje Telegram ne primi ne blokira sljedeće", async () => {
      await doProvjere();
      sat("15:02");
      telegramPada = true;
      expect((await javi("nema-svjezeg-rada")).status).toBe(200);
      telegramPada = false;

      await cronUTC("15:35");
      expect(provjere()).toHaveLength(2);
      sat("15:36");
      await javi("nema-svjezeg-rada");
      expect(pitanja()).toHaveLength(1);
    });
  });

  describe("pitanje bez odgovora", () => {
    it("nema novog pitanja ni provjere dok se ne pojavi nova aktivnost", async () => {
      await doPitanja();

      for (const vrijeme of ["16:00", "17:00", "18:00", "20:30"]) await cronUTC(vrijeme);

      expect(provjere()).toHaveLength(1);
      expect(pitanja()).toHaveLength(1);
    });

    it("nova aktivnost otvara put novom pitanju, poslije 60 minuta pauze", async () => {
      await doPitanja();
      sat("16:00");
      await aktivnost();

      await cronUTC("16:55");
      expect(provjere()).toHaveLength(1);

      await cronUTC("17:00");
      sat("17:01");
      await javi("nema-svjezeg-rada");
      expect(pitanja()).toHaveLength(2);
    });
  });

  describe('"Jesam"', () => {
    it("pokreće pisanje odmah i odgovara na dugme", async () => {
      await doPitanja();
      sat("15:10");

      expect((await pritisni("jesam")).status).toBe(200);

      expect(pisanja().map((pokretanje) => pokretanje.telo)).toEqual([{ ref: "main", inputs: { datum: DANAS } }]);
      expect(odgovoriNaDugmad[0].id).toBe("dugme-1");
      expect(poruke.at(-1)?.tekst).toBe("Krećem sa pisanjem izvještaja.");

      await gotovo("Tekst");
      expect(poruke.at(-1)?.tekst).toBe("(proba)\n\nTekst");
    });

    it("dvostruki pritisak pokreće jedno pisanje, a oba dobijaju odgovor", async () => {
      await doPitanja();

      await pritisni("jesam");
      await pritisni("jesam");

      expect(pisanja()).toHaveLength(1);
      expect(odgovoriNaDugmad).toHaveLength(2);
    });

    it("pritisci u isto vrijeme pokreću jedno pisanje", async () => {
      await doPitanja();

      await Promise.all([pritisni("jesam"), pritisni("jesam"), pritisni("jesam")]);

      expect(pisanja()).toHaveLength(1);
    });

    it('dugme i "završio" u isto vrijeme pokreću jedno pisanje', async () => {
      await doPitanja();

      await Promise.all([pritisni("jesam"), zavrsio()]);

      expect(pisanja()).toHaveLength(1);
    });

    it("javljanje provjere poslije pritiska ne šalje pitanje", async () => {
      await doProvjere();
      sat("15:01");
      await pritisni("jesam");

      await javi("nema-svjezeg-rada");

      expect(pitanja()).toEqual([]);
    });

    it("poslije zatvorenog dana odgovara da je izvještaj već poslat", async () => {
      await doPitanja();
      await pritisni("jesam");
      await gotovo("Tekst");

      await pritisni("jesam");

      expect(pisanja()).toHaveLength(1);
      expect(poruke.at(-1)?.tekst).toBe("Izvještaj za danas je već poslat.");
    });
  });

  describe('"Nije"', () => {
    it("bez aktivnosti: novo pitanje za 30 minuta", async () => {
      await doPitanja();
      sat("15:10");

      await pritisni("nije");
      expect(pisanja()).toEqual([]);
      expect(odgovoriNaDugmad).toEqual([{ id: "dugme-1", tekst: "U redu, pitaću te kasnije." }]);

      await cronUTC("15:35");
      expect(provjere()).toHaveLength(1);

      await cronUTC("15:40");
      expect(provjere()).toHaveLength(2);
      sat("15:41");
      await javi("nema-svjezeg-rada");
      expect(pitanja()).toHaveLength(2);
    });

    it("sa aktivnošću: opet važi 60 minuta pauze", async () => {
      await doPitanja();
      sat("15:10");
      await pritisni("nije");
      sat("15:20");
      await aktivnost();

      await cronUTC("15:40");
      await cronUTC("16:15");
      expect(provjere()).toHaveLength(1);

      await cronUTC("16:20");
      expect(provjere()).toHaveLength(2);
    });
  });

  describe("staro dugme", () => {
    it.each(["jesam", "nije"] as const)('"%s" sa jučerašnjeg pitanja samo dobija odgovor da je isteklo', async (odgovor) => {
      await pritisni(odgovor, "2030-05-14");

      expect(odgovoriNaDugmad).toEqual([{ id: "dugme-1", tekst: "Pitanje je isteklo." }]);
      expect(pokretanja).toEqual([]);
      expect(poruke).toEqual([]);
    });

    async function pitanjeU2240() {
      sat("19:30");
      await aktivnost();
      await cronUTC("20:30");
      sat("20:40");
      await javi("nema-svjezeg-rada");
    }

    it("pitanje iz 22:40 u 0:30 i dalje pokreće pisanje za svoj radni dan", async () => {
      await pitanjeU2240();
      vi.setSystemTime(new Date("2030-05-15T22:30:00Z"));

      await pritisni("jesam");

      expect(odgovoriNaDugmad).toEqual([{ id: "dugme-1" }]);
      expect(datumiPisanja()).toEqual([DANAS]);
    });

    it("pitanje iz 22:40 od 1:00 više ne pokreće pisanje", async () => {
      await pitanjeU2240();
      vi.setSystemTime(new Date("2030-05-15T23:01:00Z"));

      await pritisni("jesam");

      expect(odgovoriNaDugmad).toEqual([{ id: "dugme-1", tekst: "Pitanje je isteklo." }]);
      expect(pisanja()).toEqual([]);
    });

    it("pitanje iz 22:40 poslije zatvaranja radnog dana je isteklo, i prije 1:00", async () => {
      await pitanjeU2240();
      vi.setSystemTime(new Date("2030-05-15T22:10:00Z"));
      await zavrsio();
      await gotovo("Tekst");

      vi.setSystemTime(new Date("2030-05-15T22:20:00Z"));
      await pritisni("jesam");

      expect(odgovoriNaDugmad.at(-1)).toEqual({ id: "dugme-1", tekst: "Pitanje je isteklo." });
      expect(pisanja()).toHaveLength(1);
    });

    it("nepoznati podaci na dugmetu ne pokreću ništa", async () => {
      await pozovi(dugmeZahtjev("nesto-drugo"));

      expect(odgovoriNaDugmad).toEqual([{ id: "dugme-1", tekst: "Pitanje je isteklo." }]);
      expect(pokretanja).toEqual([]);
    });
  });

  describe("tuđe dugme", () => {
    it.each([
      ["tuđeg", CHAT_TUDJI],
      ["mentorovog", CHAT_MENTOR],
    ])("sa %s chata se ignoriše, bez odgovora", async (_ime, chat) => {
      await doPitanja();

      const odgovor = await pozovi(dugmeZahtjev(`pitanje:${DANAS}:jesam`, chat));

      expect(odgovor.status).toBe(200);
      expect(odgovoriNaDugmad).toEqual([]);
      expect(pisanja()).toEqual([]);
    });

    it("bez tajne webhook-a se odbija", async () => {
      const odgovor = await pozovi(dugmeZahtjev(`pitanje:${DANAS}:jesam`, CHAT_NEMANJA, null));

      expect(odgovor.status).toBe(401);
      expect(pisanja()).toEqual([]);
    });
  });
});

describe("put od završio do poruke", () => {
  it('"završio" pokreće workflow sa datumom, a rezultat šalje poruku i zatvara dan', async () => {
    expect((await zavrsio()).status).toBe(200);

    expect(pokretanja).toHaveLength(1);
    expect(pokretanja[0].url).toBe(
      "https://api.github.com/repos/Nemanja-Andjic/progress-report-izvjestaji/actions/workflows/pisanje-i-objava.yml/dispatches",
    );
    expect(pokretanja[0].token).toBe(`Bearer ${TOKEN_GITHUBA}`);
    expect(pokretanja[0].telo).toEqual({ ref: "main", inputs: { datum: DANAS } });

    expect((await gotovo("🤖 Izvještaj")).status).toBe(200);
    expect(porukeNaChat(CHAT_NEMANJA).at(-1)?.tekst).toBe("(proba)\n\n🤖 Izvještaj");

    await zavrsio();
    expect(porukeNaChat(CHAT_NEMANJA).at(-1)?.tekst).toBe("Izvještaj za danas je već poslat.");
    expect(pokretanja).toHaveLength(1);
  });
});

describe("ključevi", () => {
  it.each([
    ["bez tajne", null],
    ["sa pogrešnom tajnom", "pogresna"],
    ["sa ključem za Actions", KLJUC_ACTIONS],
    ["sa ključem hooka", KLJUC_HOOKA],
  ])("webhook odbija zahtjev %s i ne radi ništa", async (_ime, tajna) => {
    const odgovor = await pozovi(telegramZahtjev("završio", CHAT_NEMANJA, tajna));

    expect(odgovor.status).toBe(401);
    expect(pokretanja).toEqual([]);
    expect(poruke).toEqual([]);
  });

  it.each([
    ["bez ključa", null],
    ["sa pogrešnim ključem", "pogresan"],
    ["sa tajnom webhook-a", TAJNA_WEBHOOKA],
    ["sa ključem hooka", KLJUC_HOOKA],
  ])("ruta za rezultate odbija zahtjev %s i ne šalje ništa", async (_ime, kljuc) => {
    await zavrsio();
    poruke = [];

    const odgovor = await pozovi(rezultatZahtjev({ datum: DANAS, ishod: "gotovo", tekst: "Tekst" }, kljuc));

    expect(odgovor.status).toBe(401);
    expect(poruke).toEqual([]);
  });

  it.each([
    ["bez ključa", null],
    ["sa pogrešnim ključem", "pogresan"],
    ["sa ključem za Actions", KLJUC_ACTIONS],
    ["sa tajnom webhook-a", TAJNA_WEBHOOKA],
  ])("ruta za aktivnost odbija zahtjev %s i ne pamti ništa", async (_ime, kljuc) => {
    const odgovor = await pozovi(aktivnostZahtjev(kljuc));

    expect(odgovor.status).toBe(401);
    expect(await posljednjaAktivnost()).toBeNull();
  });

  it("ključ koji nije podešen ne pušta nikoga", async () => {
    const bezTajni = { ...ENV, TELEGRAM_WEBHOOK_TAJNA: undefined, KLJUC_ACTIONS: undefined, KLJUC_HOOKA: undefined };

    expect((await pozovi(telegramZahtjev("završio", CHAT_NEMANJA, "undefined"), bezTajni)).status).toBe(401);
    expect((await pozovi(rezultatZahtjev({ datum: DANAS, ishod: "neuspjeh" }, "undefined"), bezTajni)).status).toBe(401);
    expect((await pozovi(aktivnostZahtjev("undefined"), bezTajni)).status).toBe(401);
    expect(pokretanja).toEqual([]);
    expect(await posljednjaAktivnost()).toBeNull();
  });

  it("nepoznata adresa i pogrešna metoda ne postoje", async () => {
    expect((await pozovi(new Request("https://worker.test/nesto", { method: "POST" }))).status).toBe(404);
    expect((await pozovi(new Request("https://worker.test/telegram"))).status).toBe(404);
    expect((await pozovi(new Request("https://worker.test/aktivnost"))).status).toBe(404);
  });
});

describe("javljanje aktivnosti", () => {
  it("prima zahtjev bez odgovora u tijelu, pamti vrijeme i ne šalje ništa", async () => {
    const odgovor = await aktivnost();

    expect(odgovor.status).toBe(204);
    expect(await odgovor.text()).toBe("");
    expect(await posljednjaAktivnost()).toBe(PODNE.getTime());
    expect(poruke).toEqual([]);
    expect(pokretanja).toEqual([]);
  });

  it("vrijeme određuje Worker svojim satom, a tijelo zahtjeva se ne čita", async () => {
    const telo = JSON.stringify({ vrijeme: 1, datum: "2000-01-01", faza: "zatvoren", prompt: "Tekst razgovora" });

    expect((await pozovi(aktivnostZahtjev(KLJUC_HOOKA, telo))).status).toBe(204);

    expect(await posljednjaAktivnost()).toBe(PODNE.getTime());
    expect(await posljednjaAktivnost("2000-01-01")).toBeNull();
  });

  it("sljedeća aktivnost pomjera vrijeme", async () => {
    await aktivnost();
    vi.setSystemTime(new Date("2030-05-15T11:00:00Z"));
    await aktivnost();

    expect(await posljednjaAktivnost()).toBe(Date.parse("2030-05-15T11:00:00Z"));
  });

  it("na zatvoren dan ne otvara dan i ne šalje ništa", async () => {
    await zavrsio();
    await gotovo("Tekst");
    poruke = [];

    expect((await aktivnost()).status).toBe(204);
    expect(poruke).toEqual([]);

    await cronU("2030-05-15T21:00:00Z");
    expect(pokretanja).toHaveLength(1);
    expect(poruke).toEqual([]);

    await zavrsio();
    expect(poruke.at(-1)?.tekst).toBe("Izvještaj za danas je već poslat.");
    expect(pokretanja).toHaveLength(1);
  });

  it("dan sa samo aktivnošću preko dana ćuti, a poslije 23:00 ide samo preko provjere u 23:40", async () => {
    await aktivnost();

    await cronU("2030-05-15T10:05:00Z");
    await cronU("2030-05-15T21:00:00Z");
    await cronU("2030-05-15T21:35:00Z");
    expect(pokretanja).toEqual([]);
    expect(poruke).toEqual([]);

    await cronU("2030-05-15T21:40:00Z");
    expect(provjere()).toHaveLength(1);
    expect(pisanja()).toEqual([]);
  });

  it("u 0:30 ulazi u jučerašnji radni dan dok nije zatvoren", async () => {
    vi.setSystemTime(new Date("2030-05-15T22:30:00Z"));
    await aktivnost();

    expect(await posljednjaAktivnost()).toBe(Date.parse("2030-05-15T22:30:00Z"));
    expect(await posljednjaAktivnost("2030-05-16")).toBeNull();
  });

  it("od 1:00 ulazi u novi radni dan, iako jučerašnji nije zatvoren", async () => {
    await aktivnost();
    vi.setSystemTime(new Date("2030-05-15T23:00:00Z"));
    await aktivnost();

    expect(await posljednjaAktivnost()).toBe(PODNE.getTime());
    expect(await posljednjaAktivnost("2030-05-16")).toBe(Date.parse("2030-05-15T23:00:00Z"));
  });

  it("poslije ponoći važi za novi dan i ne dira zatvoren jučerašnji", async () => {
    await zavrsio();
    await gotovo("Tekst");
    const juce = await posljednjaAktivnost();

    vi.setSystemTime(new Date("2030-05-15T22:30:00Z"));
    await aktivnost();

    expect(await posljednjaAktivnost()).toBe(juce);
    expect(await posljednjaAktivnost("2030-05-16")).toBe(Date.parse("2030-05-15T22:30:00Z"));

    await zavrsio();
    expect(pokretanja.at(-1)?.telo).toEqual({ ref: "main", inputs: { datum: "2030-05-16" } });
  });

  it("za vrijeme pisanja ne prekida čekanje na rezultat", async () => {
    await zavrsio();

    await aktivnost();
    await gotovo("Tekst");

    expect(poruke.at(-1)?.tekst).toBe("(proba)\n\nTekst");
  });

  it("ne briše tekst poruke koja još nije poslata", async () => {
    await zavrsio();
    telegramPada = true;
    await gotovo("Tekst");
    telegramPada = false;

    await aktivnost();
    await cronU("2030-05-15T10:05:00Z");

    expect(poruke.filter((poruka) => poruka.tekst === "(proba)\n\nTekst")).toHaveLength(1);
  });

  it('u isto vrijeme kad i "završio" ne gubi se ni pisanje ni aktivnost', async () => {
    const odgovori = await Promise.all([aktivnost(), zavrsio(), aktivnost(), zavrsio()]);

    expect(odgovori.map((odgovor) => odgovor.status)).toEqual([204, 200, 204, 200]);
    expect(pokretanja).toHaveLength(1);
    expect(await posljednjaAktivnost()).toBe(PODNE.getTime());

    await gotovo("Tekst");
    expect(poruke.at(-1)?.tekst).toBe("(proba)\n\nTekst");
  });
});

describe("Telegram webhook", () => {
  it("ignoriše poruku sa tuđeg chata", async () => {
    const odgovor = await pozovi(telegramZahtjev("završio", CHAT_TUDJI));

    expect(odgovor.status).toBe(200);
    expect(pokretanja).toEqual([]);
    expect(poruke).toEqual([]);
  });

  it("ignoriše poruku sa mentorovog chata", async () => {
    await pozovi(telegramZahtjev("završio", CHAT_MENTOR));

    expect(pokretanja).toEqual([]);
    expect(poruke).toEqual([]);
  });

  it.each(["Završio", "  završio\n", "zavrsio"])("prihvata %j", async (tekst) => {
    await pozovi(telegramZahtjev(tekst));

    expect(pokretanja).toHaveLength(1);
  });

  it.each(["završio sam", "zdravo", ""])("ne pokreće pisanje na %j", async (tekst) => {
    expect((await pozovi(telegramZahtjev(tekst))).status).toBe(200);

    expect(pokretanja).toEqual([]);
  });

  it("nečitljivo tijelo ne obara Worker, da Telegram ne ponavlja", async () => {
    const zahtjev = new Request("https://worker.test/telegram", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": TAJNA_WEBHOOKA },
      body: "nije json",
    });

    expect((await pozovi(zahtjev)).status).toBe(200);
  });
});

describe("jedno pisanje", () => {
  it("poruke u isto vrijeme pokreću samo jedno pisanje", async () => {
    await Promise.all([zavrsio(), zavrsio(), zavrsio()]);

    expect(pokretanja).toHaveLength(1);
    expect(poruke.filter((poruka) => poruka.tekst === "Pisanje izvještaja je već u toku.")).toHaveLength(2);
  });

  it("druga poruka dok pisanje traje samo dobija odgovor", async () => {
    await zavrsio();
    await zavrsio();

    expect(pokretanja).toHaveLength(1);
    expect(poruke.at(-1)?.tekst).toBe("Pisanje izvještaja je već u toku.");
  });

  it("nepokrenut workflow ne ostavlja dan zaglavljen: upozorenje, pa novi pokušaj", async () => {
    githubPada = true;
    await zavrsio();

    expect(poruke.map((poruka) => poruka.tekst)).toEqual([
      'Pisanje izvještaja za 15.5.2030. nije pokrenuto. Pošalji "završio" za novi pokušaj.',
    ]);

    githubPada = false;
    await zavrsio();
    expect(pokretanja).toHaveLength(1);
  });

  it("poslije neuspjelog rezultata nema poruke mentoru, a završio ponovo pokreće pisanje", async () => {
    await zavrsio();
    const neuspjeh = () => pozovi(rezultatZahtjev({ datum: DANAS, ishod: "neuspjeh" }));
    expect((await neuspjeh()).status).toBe(200);
    await neuspjeh();

    expect(poruke.filter((poruka) => poruka.tekst.includes("nije uspjelo"))).toHaveLength(1);
    expect(poruke.some((poruka) => poruka.tekst.startsWith("(proba)"))).toBe(false);

    await zavrsio();
    expect(pokretanja).toHaveLength(2);
  });
});

describe("rezultat iz Actions", () => {
  it("dvostruk rezultat šalje jednu poruku", async () => {
    await zavrsio();

    await gotovo("Tekst");
    expect((await gotovo("Tekst")).status).toBe(200);

    expect(poruke.filter((poruka) => poruka.tekst.includes("Tekst"))).toHaveLength(1);
  });

  it("rezultati u isto vrijeme šalju jednu poruku", async () => {
    await zavrsio();

    await Promise.all([gotovo("Tekst"), gotovo("Tekst"), gotovo("Tekst")]);

    expect(poruke.filter((poruka) => poruka.tekst.includes("Tekst"))).toHaveLength(1);
  });

  it("rezultat bez pokrenutog pisanja ne šalje ništa", async () => {
    expect((await gotovo("Tekst")).status).toBe(200);

    expect(poruke).toEqual([]);
  });

  it("neuspjelo slanje ne zatvara dan i ne pokreće novo pisanje", async () => {
    await zavrsio();
    telegramPada = true;
    expect((await gotovo("Tekst")).status).toBe(502);
    telegramPada = false;

    await zavrsio();

    expect(pokretanja).toHaveLength(1);
    expect(poruke.at(-1)?.tekst).toBe("Izvještaj je napisan, ali poruka još nije poslata.");
  });

  it("log neuspjelog slanja ne sadrži tekst ni token", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await zavrsio();
    telegramPada = true;

    await gotovo("Tajni tekst");

    const ispis = JSON.stringify(log.mock.calls);
    expect(log).toHaveBeenCalled();
    expect(ispis).not.toContain("Tajni tekst");
    expect(ispis).not.toContain(TOKEN_BOTA);
  });

  it.each([
    ["nečitljivo tijelo", "nije json"],
    ["nepoznat ishod", { datum: DANAS, ishod: "mozda", tekst: "Tekst" }],
    ["bez datuma", { ishod: "gotovo", tekst: "Tekst" }],
    ["pogrešan oblik datuma", { datum: "15.5.2030.", ishod: "gotovo", tekst: "Tekst" }],
    ["nepostojeći datum", { datum: "2030-02-31", ishod: "gotovo", tekst: "Tekst" }],
    ["bez teksta", { datum: DANAS, ishod: "gotovo" }],
    ["prazan tekst", { datum: DANAS, ishod: "gotovo", tekst: "  " }],
    ["predugačak tekst", { datum: DANAS, ishod: "gotovo", tekst: "a".repeat(4001) }],
  ])("odbija %s, a pisanje ostaje u toku", async (_ime, telo) => {
    await zavrsio();
    poruke = [];

    expect((await pozovi(rezultatZahtjev(telo))).status).toBe(400);
    expect(poruke).toEqual([]);

    await gotovo("Tekst");
    expect(poruke).toHaveLength(1);
  });
});

describe("probni režim", () => {
  const VRSTE_PORUKA = [
    ["izvještaj agenta", "🤖 Izvještaj za 15.5.2030.\n\n1. Stavka\n\nhttps://sajt.test/izvjestaji/2030-05-15/"],
    ["ručno napisan izvještaj", "✍️ Izvještaj (napisano ručno) za 15.5.2030.\n\n1. Stavka"],
    ["dan bez rada", "Danas nema zabilježenog rada"],
  ];

  it.each(VRSTE_PORUKA)("%s ide na Nemanjin chat, sa oznakom, a na mentorov ništa", async (_ime, tekst) => {
    await zavrsio();

    await gotovo(tekst);

    expect(porukeNaChat(CHAT_NEMANJA).at(-1)?.tekst).toBe(`(proba)\n\n${tekst}`);
    expect(porukeNaChat(CHAT_MENTOR)).toEqual([]);
  });

  it.each([
    ["fali", undefined],
    ["prazno", ""],
    ["false", "false"],
    ["0", "0"],
    ["velika slova", "ISKLJUCEN"],
    ["razmak", " iskljucen"],
    ["sa kvačicama", "isključen"],
  ])("uključen je kad je podešavanje: %s", async (_ime, vrijednost) => {
    const env = { ...ENV, PROBNI_REZIM: vrijednost };
    await zavrsio(env);

    await gotovo("Tekst", env);

    expect(porukeNaChat(CHAT_NEMANJA).at(-1)?.tekst).toBe("(proba)\n\nTekst");
    expect(porukeNaChat(CHAT_MENTOR)).toEqual([]);
  });

  it.each(VRSTE_PORUKA)("izričito isključen: %s ide mentoru, bez oznake", async (_ime, tekst) => {
    const env = { ...ENV, PROBNI_REZIM: "iskljucen" };
    await zavrsio(env);

    await gotovo(tekst, env);

    expect(porukeNaChat(CHAT_MENTOR)).toEqual([{ chat: CHAT_MENTOR, tekst }]);
    expect(porukeNaChat(CHAT_NEMANJA).some((poruka) => poruka.tekst.includes("proba"))).toBe(false);
  });
});

describe("radni dan po lokalnom vremenu", () => {
  it('"završio" u 0:30 zatvara jučerašnji radni dan koji nije zatvoren', async () => {
    vi.setSystemTime(new Date("2030-05-15T22:30:00Z"));
    await zavrsio();

    expect(datumiPisanja()).toEqual([DANAS]);
  });

  it('"završio" poslije ponoći pokreće pisanje za novi dan, iako je juče zatvoreno', async () => {
    vi.setSystemTime(new Date("2030-05-15T21:59:00Z"));
    await zavrsio();
    await gotovo("Tekst");

    vi.setSystemTime(new Date("2030-05-15T22:01:00Z"));
    await zavrsio();

    expect(pokretanja.map((pokretanje) => pokretanje.telo)).toEqual([
      { ref: "main", inputs: { datum: "2030-05-15" } },
      { ref: "main", inputs: { datum: "2030-05-16" } },
    ]);
  });

  it("poruke u isto vrijeme, prve na novi dan, pokreću samo jedno pisanje", async () => {
    await zavrsio();
    await gotovo("Tekst");

    vi.setSystemTime(new Date("2030-05-16T10:00:00Z"));
    await Promise.all([zavrsio(), zavrsio(), zavrsio()]);

    expect(pokretanja.map((pokretanje) => pokretanje.telo)).toEqual([
      { ref: "main", inputs: { datum: "2030-05-15" } },
      { ref: "main", inputs: { datum: "2030-05-16" } },
    ]);
  });

  it("zimi je 1:00 sat kasnije po UTC-u", async () => {
    vi.setSystemTime(new Date("2030-01-15T23:30:00Z"));
    await zavrsio();
    vi.setSystemTime(new Date("2030-01-16T00:00:00Z"));
    await zavrsio();

    expect(pokretanja.map((pokretanje) => pokretanje.telo)).toEqual([
      { ref: "main", inputs: { datum: "2030-01-15" } },
      { ref: "main", inputs: { datum: "2030-01-16" } },
    ]);
  });

  it("rezultat stigao poslije 1:00 zatvara svoj dan i ne dira novi", async () => {
    vi.setSystemTime(new Date("2030-05-15T22:50:00Z"));
    await zavrsio();

    vi.setSystemTime(new Date("2030-05-15T23:10:00Z"));
    await zavrsio();
    await gotovo("Juče", ENV, "2030-05-15");
    await zavrsio();

    expect(pokretanja).toHaveLength(2);
    expect(poruke.at(-1)?.tekst).toBe("Pisanje izvještaja je već u toku.");

    await gotovo("Danas", ENV, "2030-05-16");
    await zavrsio();
    expect(poruke.at(-1)?.tekst).toBe("Izvještaj za danas je već poslat.");
  });
});

describe("samostalno slanje", () => {
  it("poslije provjere u 23:40 bez svježeg rada piše samo, a rezultat šalje poruku i zatvara dan", async () => {
    await cronU("2030-05-15T21:00:00Z");
    await cronU("2030-05-15T21:35:00Z");
    expect(pokretanja).toEqual([]);

    await samostalno();
    expect(datumiPisanja()).toEqual([DANAS]);

    await cronU("2030-05-15T21:45:00Z");
    expect(pisanja()).toHaveLength(1);

    await gotovo("🤖 Izvještaj");
    expect(poruke.at(-1)?.tekst).toBe("(proba)\n\n🤖 Izvještaj");
    await zavrsio();
    expect(poruke.at(-1)?.tekst).toBe("Izvještaj za danas je već poslat.");
  });

  it("svjež rad iz provjere odlaže pisanje", async () => {
    await cronU("2030-05-15T21:40:00Z");
    await javi("svjez-rad", "2030-05-15T23:30+02:00");

    expect(pisanja()).toEqual([]);
    await cronU("2030-05-15T22:05:00Z");
    expect(provjere()).toHaveLength(1);
    await cronU("2030-05-15T22:10:00Z");
    expect(provjere()).toHaveLength(2);
  });

  it("u 1:00 pisanje kreće bez provjere, za jučerašnji radni dan", async () => {
    vi.setSystemTime(new Date("2030-05-15T22:50:00Z"));
    await aktivnost();

    await cronU("2030-05-15T22:55:00Z");
    expect(pokretanja).toEqual([]);

    await cronU("2030-05-15T23:00:00Z");
    expect(datumiPisanja()).toEqual([DANAS]);
    expect(provjere()).toEqual([]);
  });

  it.each([
    ["na ljetnje", "2030-03-31T01:00:00Z", 23, "2030-03-31"],
    ["na zimsko", "2030-10-27T00:00:00Z", 25, "2030-10-27"],
  ])("na dan prelaska %s pisanje kreće tačno jednom, u 1:00 sljedećeg dana", async (_ime, pocetak, sati, datum) => {
    const start = Date.parse(pocetak);
    for (let korak = 0; korak < (sati * 60) / 5; korak++) {
      await cronU(new Date(start + korak * 5 * 60_000).toISOString());
    }

    expect(datumiPisanja()).toEqual([datum]);
  });

  it('"završio" i javljanje provjere u isto vrijeme pokreću samo jedno pisanje', async () => {
    await cronU("2030-05-15T21:40:00Z");
    vi.setSystemTime(new Date("2030-05-15T21:42:00Z"));

    await Promise.all([javi("nema-svjezeg-rada"), zavrsio(), javi("nema-svjezeg-rada"), zavrsio()]);

    expect(pisanja()).toHaveLength(1);
  });

  it("na zatvoren dan ne radi ništa, a kasniji rad čeka izvještaj sljedećeg dana", async () => {
    vi.setSystemTime(new Date("2030-05-15T16:00:00Z"));
    await zavrsio();
    await gotovo("Tekst");
    poruke = [];

    await cronU("2030-05-15T21:40:00Z");
    await cronU("2030-05-15T23:00:00Z");
    expect(pokretanja).toHaveLength(1);
    expect(poruke).toEqual([]);

    vi.setSystemTime(new Date("2030-05-15T21:45:00Z"));
    await zavrsio();
    expect(poruke.at(-1)?.tekst).toBe("Izvještaj za danas je već poslat.");
    expect(pokretanja).toHaveLength(1);

    await cronU("2030-05-16T21:40:00Z");
    expect(provjere().map((pokretanje) => (pokretanje.telo as { inputs: { datum: string } }).inputs.datum)).toEqual([
      "2030-05-16",
    ]);
  });

  it("dok pisanje traje, 1:00 ne pokreće novo", async () => {
    vi.setSystemTime(new Date("2030-05-15T22:50:00Z"));
    await zavrsio();

    await cronU("2030-05-15T23:00:00Z");

    expect(pisanja()).toHaveLength(1);
  });
});

describe("bez zvuka", () => {
  const MENTOR = { ...ENV, PROBNI_REZIM: "iskljucen" };

  it("izvještaj poslat prije ponoći ide mentoru sa zvukom", async () => {
    await samostalno(MENTOR);
    vi.setSystemTime(new Date("2030-05-15T21:59:00Z"));

    await gotovo("Tekst", MENTOR);

    expect(porukeNaChat(CHAT_MENTOR)).toEqual([{ chat: CHAT_MENTOR, tekst: "Tekst" }]);
  });

  it("izvještaj poslat poslije ponoći ide mentoru bez zvuka", async () => {
    await samostalno(MENTOR);
    vi.setSystemTime(new Date("2030-05-15T22:01:00Z"));

    await gotovo("Tekst", MENTOR);

    expect(porukeNaChat(CHAT_MENTOR)).toEqual([{ chat: CHAT_MENTOR, tekst: "Tekst", bezZvuka: true }]);
  });

  it("dan bez rada poslije ponoći ide bez zvuka", async () => {
    await cronU("2030-05-15T23:00:00Z", MENTOR);

    await gotovo("Danas nema zabilježenog rada", MENTOR);

    expect(porukeNaChat(CHAT_MENTOR)).toEqual([
      { chat: CHAT_MENTOR, tekst: "Danas nema zabilježenog rada", bezZvuka: true },
    ]);
  });

  it("ponovljeno slanje poslije ponoći ide bez zvuka, iako je prvo bilo prije", async () => {
    await samostalno(MENTOR);
    mentorPada = true;
    vi.setSystemTime(new Date("2030-05-15T21:55:00Z"));
    await gotovo("Tekst", MENTOR);
    mentorPada = false;

    await cronU("2030-05-15T22:05:00Z", MENTOR);

    expect(porukeNaChat(CHAT_MENTOR)).toEqual([{ chat: CHAT_MENTOR, tekst: "Tekst", bezZvuka: true }]);
  });

  it("poruke Nemanji poslije ponoći stižu sa zvukom", async () => {
    vi.setSystemTime(new Date("2030-05-15T22:30:00Z"));
    await zavrsio(MENTOR);
    await neuspjeh(MENTOR);

    expect(porukeNaChat(CHAT_NEMANJA)).toHaveLength(2);
    expect(poruke.some((poruka) => poruka.bezZvuka)).toBe(false);
  });

  it("u probnom režimu poruka poslije ponoći ide Nemanji sa zvukom", async () => {
    await samostalno();
    vi.setSystemTime(new Date("2030-05-15T22:01:00Z"));

    await gotovo("Tekst");

    expect(poruke).toEqual([{ chat: CHAT_NEMANJA, tekst: "(proba)\n\nTekst" }]);
  });
});

describe("dan bez rada", () => {
  const TEKST = "Danas nema zabilježenog rada";

  it("ne ide prije 23:40", async () => {
    for (const vrijeme of ["2030-05-15T18:00:00Z", "2030-05-15T21:00:00Z", "2030-05-15T21:35:00Z"]) {
      await cronU(vrijeme);
    }

    expect(pisanja()).toEqual([]);
    expect(poruke).toEqual([]);
  });

  it("šalje poruku i zatvara dan", async () => {
    await samostalno();

    await gotovo(TEKST);

    expect(poruke.at(-1)?.tekst).toBe(`(proba)\n\n${TEKST}`);
    await cronU("2030-05-15T21:45:00Z");
    expect(poruke.filter((poruka) => poruka.tekst.includes(TEKST))).toHaveLength(1);
    await zavrsio();
    expect(poruke.at(-1)?.tekst).toBe("Izvještaj za danas je već poslat.");
  });

  it("sa isključenim probnim režimom ide mentoru", async () => {
    const env = { ...ENV, PROBNI_REZIM: "iskljucen" };
    await samostalno(env);

    await gotovo(TEKST, env);

    expect(porukeNaChat(CHAT_MENTOR)).toEqual([{ chat: CHAT_MENTOR, tekst: TEKST }]);
  });
});

describe("neuspjeh", () => {
  const MENTOR = { ...ENV, PROBNI_REZIM: "iskljucen" };

  it("mentor ne dobija ništa, a upozorenje ne liči na dan bez rada i ne nosi tekst iz zahtjeva", async () => {
    await samostalno(MENTOR);

    await pozovi(rezultatZahtjev({ datum: DANAS, ishod: "neuspjeh", tekst: "Tajna vrijednost" }), MENTOR);

    expect(porukeNaChat(CHAT_MENTOR)).toEqual([]);
    expect(porukeNaChat(CHAT_NEMANJA).map((poruka) => poruka.tekst)).toEqual([
      'Pisanje izvještaja za 15.5.2030. nije uspjelo. Pošalji "završio" za novi pokušaj.',
    ]);
  });

  it("dan ostaje otvoren: preko dana nema ničega, a samostalno slanje i dalje važi", async () => {
    vi.setSystemTime(new Date("2030-05-15T16:00:00Z"));
    await zavrsio();
    await neuspjeh();
    poruke = [];

    await cronU("2030-05-15T16:05:00Z");
    await cronU("2030-05-15T20:30:00Z");
    expect(poruke).toEqual([]);
    expect(pokretanja).toHaveLength(1);

    await cronU("2030-05-15T21:40:00Z");
    vi.setSystemTime(new Date("2030-05-15T21:42:00Z"));
    await javi("nema-svjezeg-rada");
    expect(pisanja()).toHaveLength(2);

    await gotovo("Tekst");
    expect(poruke.at(-1)?.tekst).toBe("(proba)\n\nTekst");
  });

  it('neuspjeh prvog samostalnog pokušaja se ne ponavlja do 1:00, a "završio" pokreće novi', async () => {
    await samostalno();
    await neuspjeh();

    for (const vrijeme of ["21:45", "22:10", "22:30", "22:55"]) await cronU(`2030-05-15T${vrijeme}:00Z`);
    expect(pokretanja).toHaveLength(2);

    await zavrsio();
    expect(pisanja()).toHaveLength(2);
  });

  it("u 1:00 je drugi pokušaj, a poslije njegovog neuspjeha mentor ne dobija ništa, a Nemanja upozorenje", async () => {
    await samostalno(MENTOR);
    await neuspjeh(MENTOR);
    poruke = [];

    await cronU("2030-05-15T23:00:00Z", MENTOR);
    expect(pisanja()).toHaveLength(2);
    vi.setSystemTime(new Date("2030-05-15T23:10:00Z"));
    await neuspjeh(MENTOR);
    for (const vrijeme of ["23:15", "23:55"]) await cronU(`2030-05-15T${vrijeme}:00Z`, MENTOR);

    expect(pisanja()).toHaveLength(2);
    expect(porukeNaChat(CHAT_MENTOR)).toEqual([]);
    expect(poruke).toEqual([
      { chat: CHAT_NEMANJA, tekst: "Pisanje izvještaja za 15.5.2030. nije uspjelo. Rad ulazi u sljedeći izvještaj." },
    ]);
  });

  it("nepokrenut workflow u 1:00 daje upozorenje i ne ponavlja se svakih 5 minuta", async () => {
    githubPada = true;
    await cronU("2030-05-15T23:00:00Z");
    await cronU("2030-05-15T23:05:00Z");

    expect(poruke.map((poruka) => poruka.tekst)).toEqual([
      "Pisanje izvještaja za 15.5.2030. nije pokrenuto. Rad ulazi u sljedeći izvještaj.",
    ]);
  });
});

describe("rok pisanja", () => {
  const UPOZORENJE = 'Pisanje izvještaja za 15.5.2030. se nije javilo u roku. Pošalji "završio" za novi pokušaj.';

  it("pisanje koje se ne javi 30 minuta je neuspjeh, a novo završio ga ponavlja", async () => {
    await zavrsio();
    poruke = [];

    await cronU("2030-05-15T10:25:00Z");
    expect(poruke).toEqual([]);

    await cronU("2030-05-15T10:30:00Z");
    expect(poruke.map((poruka) => poruka.tekst)).toEqual([UPOZORENJE]);

    await cronU("2030-05-15T10:35:00Z");
    expect(poruke).toHaveLength(1);

    await zavrsio();
    expect(pokretanja).toHaveLength(2);
  });

  it("rezultat stigao poslije roka ne šalje poruku", async () => {
    await zavrsio();
    await cronU("2030-05-15T10:30:00Z");

    expect((await gotovo("Kasno")).status).toBe(200);

    expect(poruke.some((poruka) => poruka.tekst.includes("Kasno"))).toBe(false);
  });

  it("pisanje iz 22:50 koje se ne javi ne pokreće samostalno pisanje prije provjere u 23:40", async () => {
    vi.setSystemTime(new Date("2030-05-15T20:50:00Z"));
    await zavrsio();

    await cronU("2030-05-15T21:20:00Z");
    await cronU("2030-05-15T21:25:00Z");
    expect(pokretanja).toHaveLength(1);

    await cronU("2030-05-15T21:40:00Z");
    expect(pisanja()).toHaveLength(1);
    expect(provjere()).toHaveLength(1);
  });

  it('rok istekao poslije ponoći javlja jučerašnji dan, a "završio" ga ponavlja dok radni dan traje', async () => {
    vi.setSystemTime(new Date("2030-05-15T21:55:00Z"));
    await zavrsio();
    poruke = [];

    await cronU("2030-05-15T22:25:00Z");

    expect(poruke.map((poruka) => poruka.tekst)).toEqual([UPOZORENJE]);
    expect(pisanja()).toHaveLength(1);
    await zavrsio();
    expect(datumiPisanja()).toEqual([DANAS, DANAS]);
  });
});

describe("neuspjelo slanje poruke", () => {
  const MENTOR = { ...ENV, PROBNI_REZIM: "iskljucen" };
  const UPOZORENJE = "Poruka o izvještaju za 15.5.2030. nije poslata. Pokušavam ponovo svakih 5 minuta.";

  it("sljedeći cron ga ponavlja, bez novog pisanja, pa zatvara dan", async () => {
    await zavrsio();
    telegramPada = true;
    await gotovo("Tekst");
    telegramPada = false;
    expect(poruke.some((poruka) => poruka.tekst.includes("Tekst"))).toBe(false);

    await cronU("2030-05-15T10:05:00Z");
    expect(poruke.filter((poruka) => poruka.tekst === "(proba)\n\nTekst")).toHaveLength(1);
    expect(pokretanja).toHaveLength(1);

    await cronU("2030-05-15T10:10:00Z");
    expect(poruke.filter((poruka) => poruka.tekst === "(proba)\n\nTekst")).toHaveLength(1);
    await zavrsio();
    expect(poruke.at(-1)?.tekst).toBe("Izvještaj za danas je već poslat.");
  });

  it("ponavlja se dok ne uspije, a poslije 23:00 Nemanja dobija jedno upozorenje", async () => {
    mentorPada = true;
    vi.setSystemTime(new Date("2030-05-15T20:50:00Z"));
    await zavrsio(MENTOR);
    await gotovo("Tekst", MENTOR);
    poruke = [];

    await cronU("2030-05-15T20:55:00Z", MENTOR);
    expect(poruke).toEqual([]);

    await cronU("2030-05-15T21:00:00Z", MENTOR);
    await cronU("2030-05-15T21:05:00Z", MENTOR);
    expect(poruke).toEqual([{ chat: CHAT_NEMANJA, tekst: UPOZORENJE }]);

    mentorPada = false;
    await cronU("2030-05-15T21:10:00Z", MENTOR);
    expect(porukeNaChat(CHAT_MENTOR)).toEqual([{ chat: CHAT_MENTOR, tekst: "Tekst" }]);
  });

  it("rezultat koji poslije 23:00 ne može da pošalje poruku odmah upozorava", async () => {
    mentorPada = true;
    await samostalno(MENTOR);

    expect((await gotovo("Tekst", MENTOR)).status).toBe(502);

    expect(poruke.at(-1)).toEqual({ chat: CHAT_NEMANJA, tekst: UPOZORENJE });
  });

  it("nastavlja se poslije ponoći, a novi dan radi nezavisno", async () => {
    await zavrsio();
    telegramPada = true;
    await gotovo("Juče");
    telegramPada = false;

    await cronU("2030-05-16T21:40:00Z");

    expect(poruke.filter((poruka) => poruka.tekst === "(proba)\n\nJuče")).toHaveLength(1);
    expect(pokretanja.at(-1)?.telo).toMatchObject({ ref: "main", inputs: { datum: "2030-05-16" } });
  });

  it("cron u trenutku kad rezultat šalje poruku ne šalje je drugi put", async () => {
    await zavrsio();

    await Promise.all([gotovo("Tekst"), cron(), cron()]);

    expect(poruke.filter((poruka) => poruka.tekst.includes("Tekst"))).toHaveLength(1);
  });

  it("dva cron-a u isto vrijeme ponavljaju poruku jednom", async () => {
    await zavrsio();
    telegramPada = true;
    await gotovo("Tekst");
    telegramPada = false;
    vi.setSystemTime(new Date("2030-05-15T10:05:00Z"));

    await Promise.all([cron(), cron()]);

    expect(poruke.filter((poruka) => poruka.tekst.includes("Tekst"))).toHaveLength(1);
  });

  it("u probnom režimu ni ponovljena poruka ne ide na mentorov chat", async () => {
    await zavrsio();
    telegramPada = true;
    await gotovo("Tekst");
    telegramPada = false;

    await cronU("2030-05-15T10:05:00Z");

    expect(porukeNaChat(CHAT_MENTOR)).toEqual([]);
  });
});

describe("stanje dana", () => {
  function stanjeZahtjev(datum: string | null = DANAS, kljuc: string | null = KLJUC_ACTIONS, metoda = "GET"): Request {
    const zaglavlja: Record<string, string> = kljuc ? { Authorization: `Bearer ${kljuc}` } : {};
    const upit = datum === null ? "" : `?datum=${encodeURIComponent(datum)}`;
    return new Request(`https://worker.test/actions/stanje${upit}`, { method: metoda, headers: zaglavlja });
  }
  const stanje = async (datum = DANAS) => (await pozovi(stanjeZahtjev(datum))).json();

  it.each([
    ["bez ključa", null],
    ["sa pogrešnim ključem", "pogresan"],
    ["sa ključem hooka", KLJUC_HOOKA],
    ["sa tajnom webhook-a", TAJNA_WEBHOOKA],
  ])("odbija zahtjev %s, a odgovor ne otkriva stanje", async (_ime, kljuc) => {
    await zavrsio();
    await gotovo("Tekst izvještaja");

    const odgovor = await pozovi(stanjeZahtjev(DANAS, kljuc));

    expect(odgovor.status).toBe(401);
    expect(await odgovor.text()).toBe("");
  });

  it("bez podešenog ključa na Workeru odbija svaki zahtjev", async () => {
    const odgovor = await pozovi(stanjeZahtjev(), { ...ENV, KLJUC_ACTIONS: undefined });

    expect(odgovor.status).toBe(401);
  });

  it.each([
    ["bez datuma", null],
    ["sa datumom koji ne postoji", "2030-13-45"],
    ["sa datumom u drugom obliku", "15.5.2030."],
    ["sa praznim datumom", ""],
  ])("odbija zahtjev %s", async (_ime, datum) => {
    expect((await pozovi(stanjeZahtjev(datum))).status).toBe(400);
  });

  it("radi samo na GET", async () => {
    expect((await pozovi(stanjeZahtjev(DANAS, KLJUC_ACTIONS, "POST"))).status).toBe(404);
  });

  it("zatvoren dan", async () => {
    await zavrsio();
    await gotovo("Tekst izvještaja");

    expect(await stanje()).toEqual({ datum: DANAS, faza: "zatvoren" });
  });

  it("dan bez rada je zatvoren", async () => {
    await zavrsio();
    await gotovo("Danas nema zabilježenog rada");

    expect(await stanje()).toEqual({ datum: DANAS, faza: "zatvoren" });
  });

  it("dan koji Worker nikad nije vidio je otvoren, a ruta mu ne pravi red u bazi", async () => {
    expect(await stanje("2030-05-14")).toEqual({ datum: "2030-05-14", faza: "otvoren" });

    const { results } = await bazniEnv.DB.prepare("SELECT datum FROM dani").all();
    expect(results).toEqual([]);
  });

  it("dan sa neuspjehom nije zatvoren", async () => {
    await zavrsio();
    await neuspjeh();

    expect(await stanje()).toEqual({ datum: DANAS, faza: "neuspjeh" });
  });

  it("dan na kom pisanje još traje nije zatvoren", async () => {
    await zavrsio();

    expect(await stanje()).toEqual({ datum: DANAS, faza: "pisanje" });
  });

  it("dan bez poslate poruke nije zatvoren, a tekst izvještaja ne izlazi iz baze", async () => {
    mentorPada = true;
    const tekst = "Tekst izvještaja koji čeka slanje";
    await zavrsio();
    await gotovo(tekst, { ...ENV, PROBNI_REZIM: "iskljucen" });

    const odgovor = await pozovi(stanjeZahtjev());
    const telo = await odgovor.text();

    expect(JSON.parse(telo)).toEqual({ datum: DANAS, faza: "bez_poruke" });
    expect(telo).not.toContain(tekst);
  });

  it("pitanje za stanje ne mijenja dan, ne šalje poruke i ne pokreće workflow", async () => {
    await zavrsio();
    const prijePoruke = poruke.length;
    const prijePokretanja = pokretanja.length;

    await stanje();
    await stanje();

    expect(poruke).toHaveLength(prijePoruke);
    expect(pokretanja).toHaveLength(prijePokretanja);
    expect(await stanje()).toEqual({ datum: DANAS, faza: "pisanje" });
    expect((await gotovo("Tekst")).status).toBe(200);
    expect(await stanje()).toEqual({ datum: DANAS, faza: "zatvoren" });
  });

  it("jutro poslije: rezultat stigao poslije ponoći zatvara juče, a današnja aktivnost ga ne dira", async () => {
    await zavrsio();
    vi.setSystemTime(new Date("2030-05-15T22:30:00Z"));
    await gotovo("Tekst izvještaja");
    vi.setSystemTime(new Date("2030-05-16T05:00:00Z"));
    await aktivnost();

    expect(await stanje(DANAS)).toEqual({ datum: DANAS, faza: "zatvoren" });
    expect(await stanje("2030-05-16")).toEqual({ datum: "2030-05-16", faza: "otvoren" });
  });
});
