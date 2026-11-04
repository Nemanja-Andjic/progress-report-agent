import { applyD1Migrations, env as bazniEnv, reset } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";

const CHAT_NEMANJA = 111;
const CHAT_MENTOR = 222;
const CHAT_TUDJI = 333;
const TAJNA_WEBHOOKA = "lazna-tajna-webhooka";
const KLJUC_ACTIONS = "lazni-kljuc-actions";
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
  PROBNI_REZIM: "ukljucen",
};

type Env = typeof ENV;

// Lažni Telegram i GitHub: pamte šta je stiglo, a obaraju se po potrebi.
let poruke: { chat: number; tekst: string }[];
let pokretanja: { url: string; token: string | null; telo: unknown }[];
let telegramPada: boolean;
let githubPada: boolean;

async function lazniSvijet(ulaz: RequestInfo | URL, opcije?: RequestInit): Promise<Response> {
  const zahtjev = new Request(ulaz, opcije);
  const adresa = new URL(zahtjev.url);
  if (adresa.hostname === "api.telegram.org") {
    if (telegramPada || adresa.pathname !== `/bot${TOKEN_BOTA}/sendMessage`) {
      return new Response("{}", { status: 500 });
    }
    const telo = (await zahtjev.json()) as { chat_id: string; text: string };
    poruke.push({ chat: Number(telo.chat_id), tekst: telo.text });
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

const zavrsio = (env?: Partial<Env>) => pozovi(telegramZahtjev("završio"), env);
const gotovo = (tekst: string, env?: Partial<Env>, datum = DANAS) =>
  pozovi(rezultatZahtjev({ datum, ishod: "gotovo", tekst }), env);
const porukeNaChat = (chat: number) => poruke.filter((poruka) => poruka.chat === chat);

beforeEach(async () => {
  await reset();
  await applyD1Migrations(bazniEnv.DB, bazniEnv.MIGRACIJE);
  poruke = [];
  pokretanja = [];
  telegramPada = false;
  githubPada = false;
  vi.useFakeTimers({ toFake: ["Date"], now: PODNE });
  vi.spyOn(globalThis, "fetch").mockImplementation(lazniSvijet);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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
  ])("ruta za rezultate odbija zahtjev %s i ne šalje ništa", async (_ime, kljuc) => {
    await zavrsio();
    poruke = [];

    const odgovor = await pozovi(rezultatZahtjev({ datum: DANAS, ishod: "gotovo", tekst: "Tekst" }, kljuc));

    expect(odgovor.status).toBe(401);
    expect(poruke).toEqual([]);
  });

  it("ključ koji nije podešen ne pušta nikoga", async () => {
    const bezTajni = { ...ENV, TELEGRAM_WEBHOOK_TAJNA: undefined, KLJUC_ACTIONS: undefined };

    expect((await pozovi(telegramZahtjev("završio", CHAT_NEMANJA, "undefined"), bezTajni)).status).toBe(401);
    expect((await pozovi(rezultatZahtjev({ datum: DANAS, ishod: "neuspjeh" }, "undefined"), bezTajni)).status).toBe(401);
    expect(pokretanja).toEqual([]);
  });

  it("nepoznata adresa i pogrešna metoda ne postoje", async () => {
    expect((await pozovi(new Request("https://worker.test/nesto", { method: "POST" }))).status).toBe(404);
    expect((await pozovi(new Request("https://worker.test/telegram"))).status).toBe(404);
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

describe("ponoć po lokalnom vremenu", () => {
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

  it("zimi je ponoć sat kasnije po UTC-u", async () => {
    vi.setSystemTime(new Date("2030-01-15T22:30:00Z"));
    await zavrsio();
    vi.setSystemTime(new Date("2030-01-15T23:30:00Z"));
    await zavrsio();

    expect(pokretanja.map((pokretanje) => pokretanje.telo)).toEqual([
      { ref: "main", inputs: { datum: "2030-01-15" } },
      { ref: "main", inputs: { datum: "2030-01-16" } },
    ]);
  });

  it("rezultat stigao poslije ponoći zatvara svoj dan i ne dira novi", async () => {
    vi.setSystemTime(new Date("2030-05-15T21:50:00Z"));
    await zavrsio();

    vi.setSystemTime(new Date("2030-05-15T22:10:00Z"));
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
