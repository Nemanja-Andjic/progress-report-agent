import { describe, expect, it } from "vitest";
import {
  greskaZaNemanju,
  istekao,
  limitPotrosen,
  LIMIT_MENTORA,
  NEUSPJEH,
  novoPersiranje,
  ODBIJENO,
  porukaZaChat,
  ROK_ODGOVORA_MS,
  spojenoPitanje,
  stalnaPoruka,
  UVODNA_PORUKA,
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
  it.each([false, true])("odgovor šalje tekst iz javljanja, i uz persiranje %j", (persiran) => {
    expect(porukaZaChat("odgovor", "Juče je radio na Workeru.", persiran)).toBe("Juče je radio na Workeru.");
  });

  it("odbijeno i neuspjeh šalju stalne poruke, bez teksta iz javljanja", () => {
    expect(porukaZaChat("odbijeno", "nešto", false)).toBe(ODBIJENO);
    expect(porukaZaChat("neuspjeh", "nešto", false)).toBe(NEUSPJEH);
  });

  it("uz persiranje stalne poruke idu na \"vi\"", () => {
    expect(porukaZaChat("odbijeno", "nešto", true)).toBe(
      "Ovo pitanje ne mogu da obradim jer sadrži nešto što liči na lozinku, ključ ili putanju. Napišite ga bez toga.",
    );
    expect(porukaZaChat("neuspjeh", "nešto", true)).toBe(
      "Trenutno ne mogu da odgovorim, pokušajte ponovo za nekoliko minuta.",
    );
  });
});

describe("stalne poruke", () => {
  it("na \"ti\"", () => {
    expect(stalnaPoruka("limit", false)).toBe("Za danas je potrošen dnevni broj pitanja. Možeš ponovo sutra.");
    expect(NEUSPJEH).toBe("Trenutno ne mogu da odgovorim, pokušaj ponovo za nekoliko minuta.");
    expect(ODBIJENO).toBe(
      "Ovo pitanje ne mogu da obradim jer sadrži nešto što liči na lozinku, ključ ili putanju. Napiši ga bez toga.",
    );
  });

  it("na \"vi\"", () => {
    expect(stalnaPoruka("limit", true)).toBe("Za danas je potrošen dnevni broj pitanja. Možete ponovo sutra.");
  });

  it("uvodna poruka je tačno ona iz speca", () => {
    expect(UVODNA_PORUKA).toBe(
      "Od danas možeš i da me pitaš šta je Nemanja radio, npr. „Šta je Nemanja radio juče?” ili „Kako je uradio pitanja o radu?”. " +
        "Odgovaram iz izvještaja, bilješki i GitHub-a za posljednjih 30 dana, obično za minut-dva. Dnevno možeš da postaviš do 15 pitanja.",
    );
  });
});

describe("novo persiranje", () => {
  it("upisuje se samo za \"da\" i \"ne\"", () => {
    expect(novoPersiranje("da")).toBe(true);
    expect(novoPersiranje("ne")).toBe(false);
    expect(novoPersiranje("bez_promjene")).toBeNull();
  });
});

describe("limit", () => {
  it("je 15", () => {
    expect(LIMIT_MENTORA).toBe(15);
  });

  it("14 uspješnih ostavlja još jedno pitanje", () => {
    expect(limitPotrosen("mentor", 14, false)).toBe(false);
  });

  it("15 uspješnih troši limit", () => {
    expect(limitPotrosen("mentor", 15, false)).toBe(true);
  });

  it("pokretanje u toku se broji kao jedno pitanje", () => {
    expect(limitPotrosen("mentor", 13, true)).toBe(false);
    expect(limitPotrosen("mentor", 14, true)).toBe(true);
  });

  it("Nemanjina pitanja nemaju limit", () => {
    expect(limitPotrosen("nemanja", 100, true)).toBe(false);
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
