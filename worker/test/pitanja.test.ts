import { describe, expect, it } from "vitest";
import {
  greskaZaNemanju,
  istekao,
  NEUSPJEH,
  ODBIJENO,
  porukaZaChat,
  ROK_ODGOVORA_MS,
  spojenoPitanje,
  vrstaPoruke,
} from "../src/pitanja";

describe("vrsta poruke", () => {
  it.each(["završio", "zavrsio", " ZAVRŠIO\n"])("%j je komanda završio", (tekst) => {
    expect(vrstaPoruke(tekst)).toEqual({ vrsta: "komanda", komanda: "zavrsio" });
  });

  it.each(["odloži", "Odlozi", "  ODLOŽI "])("%j je komanda odloži", (tekst) => {
    expect(vrstaPoruke(tekst)).toEqual({ vrsta: "komanda", komanda: "odlozi" });
  });

  it.each(["završio sam", "odlo", "zdravo", "Šta sam radio juče?"])("%j je pitanje", (tekst) => {
    expect(vrstaPoruke(tekst)).toEqual({ vrsta: "pitanje", tekst });
  });

  it("pitanje gubi razmake oko teksta", () => {
    expect(vrstaPoruke("  Šta sam radio?\n")).toEqual({ vrsta: "pitanje", tekst: "Šta sam radio?" });
  });

  it.each([undefined, null, 42, "", "  \n "])("%j je poruka bez teksta", (tekst) => {
    expect(vrstaPoruke(tekst)).toEqual({ vrsta: "bez_teksta" });
  });
});

describe("spojeno pitanje", () => {
  it("jedna poruka ostaje ista", () => {
    expect(spojenoPitanje(["Šta sam radio?"])).toBe("Šta sam radio?");
  });

  it("više poruka ide redom kojim su stigle, svaka u svom redu", () => {
    expect(spojenoPitanje(["Prvo", "Drugo", "Treće"])).toBe("Prvo\nDrugo\nTreće");
  });
});

describe("rok", () => {
  it("je 5 minuta", () => {
    expect(ROK_ODGOVORA_MS).toBe(300_000);
  });

  it("nije istekao malo prije 5 minuta", () => {
    expect(istekao(1_000, 1_000 + ROK_ODGOVORA_MS - 1)).toBe(false);
  });

  it("je istekao tačno na 5 minuta i poslije", () => {
    expect(istekao(1_000, 1_000 + ROK_ODGOVORA_MS)).toBe(true);
    expect(istekao(1_000, 1_000 + ROK_ODGOVORA_MS + 60_000)).toBe(true);
  });
});

describe("poruka za chat", () => {
  it("odgovor šalje tekst iz javljanja", () => {
    expect(porukaZaChat("odgovor", "Juče je radio na Workeru.")).toBe("Juče je radio na Workeru.");
  });

  it("odbijeno i neuspjeh šalju stalne poruke, bez teksta iz javljanja", () => {
    expect(porukaZaChat("odbijeno", "nešto")).toBe(ODBIJENO);
    expect(porukaZaChat("neuspjeh", "nešto")).toBe(NEUSPJEH);
  });
});

describe("greška za Nemanju", () => {
  it("kaže sa kog chata je pitanje i šta nije uspjelo", () => {
    expect(greskaZaNemanju("nemanja", "rok")).toBe(
      'Pitanje o radu sa chata „nemanja" nije dobilo odgovor: odgovor nije stigao u roku od 5 minuta.',
    );
    expect(greskaZaNemanju("mentor", "nije_pokrenuto")).toBe(
      'Pitanje o radu sa chata „mentor" nije dobilo odgovor: GitHub nije pokrenuo pitanje-o-radu.yml.',
    );
  });
});
