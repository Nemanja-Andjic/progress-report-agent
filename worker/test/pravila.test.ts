import { describe, expect, it } from "vitest";
import { noviDan, primijeni, type StanjeDana } from "../src/pravila";

const DATUM = "2030-05-15";
const u = (datum = DATUM, sat = 12, minut = 0) => ({ datum, sat, minut });
const dan = (faza: StanjeDana["faza"], tekst: string | null = null): StanjeDana => ({ datum: DATUM, faza, tekst });
const zavrsio = { vrsta: "zavrsio" } as const;

describe('"završio"', () => {
  it("na otvoren dan pokreće pisanje za taj datum", () => {
    const { stanje, radnje } = primijeni(noviDan(DATUM), zavrsio, u());

    expect(stanje).toMatchObject({ datum: DATUM, faza: "pisanje" });
    expect(radnje).toContainEqual({ vrsta: "pokreni_pisanje", datum: DATUM });
  });

  it("dok pisanje traje ne pokreće novo pisanje", () => {
    const { stanje, radnje } = primijeni(dan("pisanje"), zavrsio, u());

    expect(stanje.faza).toBe("pisanje");
    expect(radnje).toEqual([{ vrsta: "posalji_nemanji", tekst: "Pisanje izvještaja je već u toku." }]);
  });

  it("na zatvoren dan odgovara da je izvještaj već poslat", () => {
    const { stanje, radnje } = primijeni(dan("zatvoren"), zavrsio, u());

    expect(stanje.faza).toBe("zatvoren");
    expect(radnje).toEqual([{ vrsta: "posalji_nemanji", tekst: "Izvještaj za danas je već poslat." }]);
  });

  it("poslije ponoći važi za novi dan, i kad je juče zatvoreno", () => {
    const { stanje, radnje } = primijeni(dan("zatvoren"), zavrsio, u("2030-05-16", 0, 1));

    expect(stanje).toMatchObject({ datum: "2030-05-16", faza: "pisanje" });
    expect(radnje).toContainEqual({ vrsta: "pokreni_pisanje", datum: "2030-05-16" });
  });

  it("poslije ponoći ne čeka jučerašnje pisanje", () => {
    const { radnje } = primijeni(dan("pisanje"), zavrsio, u("2030-05-16", 0, 1));

    expect(radnje).toContainEqual({ vrsta: "pokreni_pisanje", datum: "2030-05-16" });
  });

  it("poslije neuspjeha pokreće novi pokušaj", () => {
    const { stanje, radnje } = primijeni(dan("neuspjeh"), zavrsio, u());

    expect(stanje.faza).toBe("pisanje");
    expect(radnje).toContainEqual({ vrsta: "pokreni_pisanje", datum: DATUM });
  });

  it("na napisan izvještaj bez poruke ne pokreće novo pisanje", () => {
    const { stanje, radnje } = primijeni(dan("bez_poruke", "Tekst"), zavrsio, u());

    expect(stanje).toEqual(dan("bez_poruke", "Tekst"));
    expect(radnje).toEqual([
      { vrsta: "posalji_nemanji", tekst: "Izvještaj je napisan, ali poruka još nije poslata." },
    ]);
  });
});

describe("rezultat iz Actions", () => {
  const gotovo = { vrsta: "rezultat", ishod: "gotovo", tekst: "Tekst poruke" } as const;
  const neuspjeh = { vrsta: "rezultat", ishod: "neuspjeh" } as const;

  it("šalje poruku mentoru i čuva tekst dok poruka ne ode", () => {
    const { stanje, radnje } = primijeni(dan("pisanje"), gotovo, u());

    expect(stanje).toEqual(dan("bez_poruke", "Tekst poruke"));
    expect(radnje).toEqual([{ vrsta: "posalji_mentoru", tekst: "Tekst poruke" }]);
  });

  it("stigao poslije ponoći zatvara svoj dan, a ne novi", () => {
    const { stanje } = primijeni(dan("pisanje"), gotovo, u("2030-05-16", 0, 10));

    expect(stanje.datum).toBe(DATUM);
    expect(stanje.faza).toBe("bez_poruke");
  });

  it.each(["otvoren", "bez_poruke", "zatvoren", "neuspjeh"] as const)(
    "u fazi %s ne šalje poruku",
    (faza) => {
      const pocetno = dan(faza);
      const { stanje, radnje } = primijeni(pocetno, gotovo, u());

      expect(stanje).toEqual(pocetno);
      expect(radnje).toEqual([]);
    },
  );

  it("neuspjeh ne ide mentoru, nego upozorenje Nemanji", () => {
    const { stanje, radnje } = primijeni(dan("pisanje"), neuspjeh, u());

    expect(stanje.faza).toBe("neuspjeh");
    expect(radnje).toEqual([
      {
        vrsta: "posalji_nemanji",
        tekst: 'Pisanje izvještaja za 15.5.2030. nije uspjelo. Pošalji "završio" za novi pokušaj.',
      },
    ]);
  });

  it("drugi neuspjeh ne šalje drugo upozorenje", () => {
    const { radnje } = primijeni(dan("neuspjeh"), neuspjeh, u());

    expect(radnje).toEqual([]);
  });
});

describe("posljedice radnji", () => {
  it("poslata poruka zatvara dan i briše tekst", () => {
    const { stanje, radnje } = primijeni(dan("bez_poruke", "Tekst"), { vrsta: "poruka_poslata" }, u());

    expect(stanje).toEqual(dan("zatvoren"));
    expect(radnje).toEqual([]);
  });

  it("nepokrenuto pisanje je neuspjeh, sa upozorenjem Nemanji", () => {
    const { stanje, radnje } = primijeni(dan("pisanje"), { vrsta: "pokretanje_nije_uspjelo" }, u());

    expect(stanje.faza).toBe("neuspjeh");
    expect(radnje).toEqual([
      {
        vrsta: "posalji_nemanji",
        tekst: 'Pisanje izvještaja za 15.5.2030. nije pokrenuto. Pošalji "završio" za novi pokušaj.',
      },
    ]);
  });
});
