import { describe, expect, it } from "vitest";
import { datumRadnogDana, lokalnoVrijeme, noviDan, primijeni, type StanjeDana } from "../src/pravila";

const DATUM = "2030-05-15";
const dvije = (broj: number) => String(broj).padStart(2, "0");
// Datumi u ovim testovima su u ljetnjem računanju (+02:00), osim u testovima prelaska.
const u = (datum = DATUM, sat = 12, minut = 0) =>
  lokalnoVrijeme(new Date(`${datum}T${dvije(sat)}:${dvije(minut)}:00+02:00`));
const dan = (faza: StanjeDana["faza"], tekst: string | null = null): StanjeDana => ({
  ...noviDan(DATUM),
  faza,
  tekst,
});
const zavrsio = { vrsta: "zavrsio" } as const;
const cron = { vrsta: "cron" } as const;

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

  it("poslije ponoći važi za novi dan kad je juče zatvoreno", () => {
    const { stanje, radnje } = primijeni(dan("zatvoren"), zavrsio, u("2030-05-16", 0, 1));

    expect(stanje).toMatchObject({ datum: "2030-05-16", faza: "pisanje" });
    expect(radnje).toContainEqual({ vrsta: "pokreni_pisanje", datum: "2030-05-16" });
  });

  it("od 1:00 ne čeka jučerašnje pisanje", () => {
    const { radnje } = primijeni(dan("pisanje"), zavrsio, u("2030-05-16", 1, 0));

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

describe("radni dan", () => {
  const SUTRA = "2030-05-16";

  it.each([
    ["u 23:59 je današnji", DATUM, 23, 59, "otvoren", DATUM],
    ["u 0:00 je jučerašnji dok nije zatvoren", SUTRA, 0, 0, "otvoren", DATUM],
    ["u 0:59 je jučerašnji i dok pisanje teče", SUTRA, 0, 59, "pisanje", DATUM],
    ["u 0:30 je jučerašnji i poslije neuspjeha", SUTRA, 0, 30, "neuspjeh", DATUM],
    ["u 0:30 je današnji kad je juče zatvoreno", SUTRA, 0, 30, "zatvoren", SUTRA],
    ["od 1:00 je uvijek današnji", SUTRA, 1, 0, "otvoren", SUTRA],
  ] as const)("%s", (_ime, datum, sat, minut, fazaJuce, ocekivan) => {
    expect(datumRadnogDana(u(datum, sat, minut), fazaJuce)).toBe(ocekivan);
  });

  it("prvi dan u godini poslije ponoći je 31. decembar", () => {
    expect(datumRadnogDana(lokalnoVrijeme(new Date("2031-01-01T00:30:00+01:00")), "otvoren")).toBe("2030-12-31");
  });

  it('"završio" u 0:30 zatvara jučerašnji radni dan', () => {
    const { stanje, radnje } = primijeni(noviDan(DATUM), zavrsio, u(SUTRA, 0, 30));

    expect(stanje).toMatchObject({ datum: DATUM, faza: "pisanje" });
    expect(radnje).toContainEqual({ vrsta: "pokreni_pisanje", datum: DATUM });
  });

  it('"završio" u 0:30 dok jučerašnje pisanje teče samo javlja da je u toku', () => {
    const { radnje } = primijeni(dan("pisanje"), zavrsio, u(SUTRA, 0, 30));

    expect(radnje).toEqual([{ vrsta: "posalji_nemanji", tekst: "Pisanje izvještaja je već u toku." }]);
  });

  it('neuspjeh poslije ponoći, dok radni dan traje, i dalje nudi "završio"', () => {
    const { radnje } = primijeni(dan("pisanje"), { vrsta: "rezultat", ishod: "neuspjeh" }, u(SUTRA, 0, 30));

    expect(radnje).toEqual([
      {
        vrsta: "posalji_nemanji",
        tekst: 'Pisanje izvještaja za 15.5.2030. nije uspjelo. Pošalji "završio" za novi pokušaj.',
      },
    ]);
  });

  it('neuspjeh od 1:00 ne nudi "završio", jer bi ono pokrenulo novi dan', () => {
    const { radnje } = primijeni(dan("pisanje"), { vrsta: "rezultat", ishod: "neuspjeh" }, u(SUTRA, 1, 10));

    expect(radnje).toEqual([
      {
        vrsta: "posalji_nemanji",
        tekst: "Pisanje izvještaja za 15.5.2030. nije uspjelo. Rad ulazi u sljedeći izvještaj.",
      },
    ]);
  });
});

describe("aktivnost", () => {
  const aktivnost = { vrsta: "aktivnost" } as const;

  it.each(["otvoren", "pisanje", "bez_poruke", "neuspjeh", "zatvoren"] as const)(
    "u fazi %s pamti samo vrijeme i ne radi ništa drugo",
    (faza) => {
      const pocetno = { ...dan(faza, "Tekst"), uTokuOd: 123, samostalniPokusaji: 1, upozoren: true };
      const { stanje, radnje } = primijeni(pocetno, aktivnost, u(DATUM, 14, 30));

      expect(stanje).toEqual({ ...pocetno, posljednjaAktivnost: u(DATUM, 14, 30).trenutak });
      expect(radnje).toEqual([]);
    },
  );

  it("zatvoren dan ostaje zatvoren i za događaje koji stignu poslije nje", () => {
    const { stanje } = primijeni(dan("zatvoren"), aktivnost, u(DATUM, 20, 0));

    expect(primijeni(stanje, zavrsio, u(DATUM, 20, 5)).radnje).toEqual([
      { vrsta: "posalji_nemanji", tekst: "Izvještaj za danas je već poslat." },
    ]);
    expect(primijeni(stanje, cron, u(DATUM, 23, 0)).radnje).toEqual([]);
  });

  it("nova aktivnost pomjera vrijeme", () => {
    const prva = primijeni(noviDan(DATUM), aktivnost, u(DATUM, 14, 0)).stanje;

    expect(primijeni(prva, aktivnost, u(DATUM, 15, 0)).stanje.posljednjaAktivnost).toBe(u(DATUM, 15, 0).trenutak);
  });

  it("ostaje zapamćena kroz pisanje i zatvaranje dana", () => {
    const trenutak = u(DATUM, 14, 0).trenutak;
    const pisanje = primijeni(primijeni(noviDan(DATUM), aktivnost, u(DATUM, 14, 0)).stanje, zavrsio, u(DATUM, 15, 0));
    const poruka = primijeni(pisanje.stanje, { vrsta: "rezultat", ishod: "gotovo", tekst: "Tekst" }, u(DATUM, 15, 5));
    const zatvoren = primijeni(poruka.stanje, { vrsta: "poruka_poslata" }, u(DATUM, 15, 5));

    expect(pisanje.stanje.posljednjaAktivnost).toBe(trenutak);
    expect(zatvoren.stanje).toMatchObject({ faza: "zatvoren", posljednjaAktivnost: trenutak });
  });

  it("novi dan počinje bez aktivnosti, iako je juče bilo", () => {
    const juce = primijeni(noviDan(DATUM), aktivnost, u(DATUM, 14, 0)).stanje;

    expect(primijeni(juce, zavrsio, u("2030-05-16", 9, 0)).stanje).toMatchObject({
      datum: "2030-05-16",
      posljednjaAktivnost: null,
    });
  });
});

describe("rezultat iz Actions", () => {
  const gotovo = { vrsta: "rezultat", ishod: "gotovo", tekst: "Tekst poruke" } as const;
  const neuspjeh = { vrsta: "rezultat", ishod: "neuspjeh" } as const;

  it("šalje poruku mentoru i čuva tekst dok poruka ne ode", () => {
    const { stanje, radnje } = primijeni(dan("pisanje"), gotovo, u());

    expect(stanje).toMatchObject({ faza: "bez_poruke", tekst: "Tekst poruke" });
    expect(radnje).toEqual([{ vrsta: "posalji_mentoru", tekst: "Tekst poruke", bezZvuka: false }]);
  });

  it("dan bez rada se zatvara kao i svaki drugi: poruka, pa zatvoren dan", () => {
    const tekst = "Danas nema zabilježenog rada";
    const poslije = primijeni(dan("pisanje"), { vrsta: "rezultat", ishod: "gotovo", tekst }, u());

    expect(poslije.radnje).toEqual([{ vrsta: "posalji_mentoru", tekst, bezZvuka: false }]);
    expect(primijeni(poslije.stanje, { vrsta: "poruka_poslata" }, u()).stanje.faza).toBe("zatvoren");
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

describe("bez zvuka", () => {
  const gotovo = { vrsta: "rezultat", ishod: "gotovo", tekst: "Tekst" } as const;

  it("poruka poslata istog dana ide sa zvukom, i u 23:59", () => {
    expect(primijeni(dan("pisanje"), gotovo, u(DATUM, 23, 59)).radnje).toEqual([
      { vrsta: "posalji_mentoru", tekst: "Tekst", bezZvuka: false },
    ]);
  });

  it("poruka poslata poslije ponoći ide bez zvuka", () => {
    expect(primijeni(dan("pisanje"), gotovo, u("2030-05-16", 0, 0)).radnje).toEqual([
      { vrsta: "posalji_mentoru", tekst: "Tekst", bezZvuka: true },
    ]);
  });

  it("ponovljeno slanje poslije ponoći ide bez zvuka, iako je prvo bilo prije", () => {
    const napisano = primijeni(dan("pisanje"), gotovo, u(DATUM, 23, 58)).stanje;

    expect(primijeni(napisano, cron, u("2030-05-16", 0, 5)).radnje).toEqual([
      { vrsta: "posalji_mentoru", tekst: "Tekst", bezZvuka: true },
    ]);
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

describe("samostalno slanje", () => {
  const SUTRA = "2030-05-16";
  const aktivnost = { vrsta: "aktivnost" } as const;
  const neuspjeh = { vrsta: "rezultat", ishod: "neuspjeh" } as const;
  const aktivanU = (sat: number, minut = 0, datum = DATUM) =>
    primijeni(noviDan(DATUM), aktivnost, u(datum, sat, minut)).stanje;
  const vrste = (radnje: { vrsta: string }[]) => radnje.map((radnja) => radnja.vrsta);
  const bezRada = (oznaka: string) => ({ vrsta: "provjera", oznaka, ishod: "nema-svjezeg-rada" }) as const;
  const sRadom = (oznaka: string, vrijeme: number) =>
    ({ vrsta: "provjera", oznaka, ishod: "svjez-rad", vrijeme }) as const;
  const palo = (oznaka: string) => ({ vrsta: "provjera", oznaka, ishod: "neuspjeh" }) as const;
  const POKRENI = { vrsta: "pokreni_pisanje", datum: DATUM };
  // Cron u datom trenutku mora da pokrene provjeru za radni dan.
  const provjeraU = (stanje: StanjeDana, datum: string, sat: number, minut: number) => {
    const { stanje: poslije, radnje } = primijeni(stanje, cron, u(datum, sat, minut));
    expect(radnje).toEqual([
      { vrsta: "pokreni_provjeru", datum: DATUM, oznaka: String(u(datum, sat, minut).trenutak) },
    ]);
    return { stanje: poslije, oznaka: String(u(datum, sat, minut).trenutak) };
  };
  // Prvi samostalni pokušaj: provjera u 23:40 bez svježeg rada.
  const prviPokusaj = () => {
    const { stanje, oznaka } = provjeraU(aktivanU(20), DATUM, 23, 40);
    const prelaz = primijeni(stanje, bezRada(oznaka), u(DATUM, 23, 42));
    expect(prelaz.radnje).toEqual([POKRENI]);
    return prelaz.stanje;
  };

  it("prije 23:00 izvještaj nikad ne ide sam, ni kad je pauza duga", () => {
    let stanje = aktivanU(9);
    for (let minut = 9 * 60; minut < 23 * 60 + 40; minut += 5) {
      const prelaz = primijeni(stanje, cron, u(DATUM, Math.floor(minut / 60), minut % 60));
      expect(vrste(prelaz.radnje)).not.toContain("pokreni_pisanje");
      stanje = prelaz.stanje;
    }
  });

  it("između 22:30 i 23:40 nema ni provjere", () => {
    for (const [sat, minut] of [[22, 35], [23, 0], [23, 35]]) {
      expect(primijeni(aktivanU(20), cron, u(DATUM, sat, minut)).radnje).toEqual([]);
    }
  });

  it("prva provjera je u 23:40", () => {
    provjeraU(aktivanU(20), DATUM, 23, 40);
  });

  it("dan bez signala iz hooka ima prvu provjeru u 23:40", () => {
    expect(primijeni(noviDan(DATUM), cron, u(DATUM, 23, 35)).radnje).toEqual([]);
    provjeraU(noviDan(DATUM), DATUM, 23, 40);
  });

  it("aktivnost iz hooka u 23:30 pomjera prvu provjeru na 0:10", () => {
    const stanje = aktivanU(23, 30);

    expect(primijeni(stanje, cron, u(SUTRA, 0, 5)).radnje).toEqual([]);
    provjeraU(stanje, SUTRA, 0, 10);
  });

  it("aktivnost poslije ponoći pomjera provjeru jučerašnjeg radnog dana", () => {
    const stanje = aktivanU(0, 10, SUTRA);

    expect(primijeni(stanje, cron, u(SUTRA, 0, 45)).radnje).toEqual([]);
    provjeraU(stanje, SUTRA, 0, 50);
  });

  it("provjera bez svježeg rada pokreće pisanje", () => {
    expect(prviPokusaj().faza).toBe("pisanje");
  });

  it("svjež rad mlađi od 40 minuta odlaže provjeru do 40 minuta poslije tog rada", () => {
    const { stanje, oznaka } = provjeraU(aktivanU(20), DATUM, 23, 40);
    const poslije = primijeni(stanje, sRadom(oznaka, u(DATUM, 23, 30).trenutak), u(DATUM, 23, 42));

    expect(poslije.radnje).toEqual([]);
    expect(primijeni(poslije.stanje, cron, u(SUTRA, 0, 5)).radnje).toEqual([]);
    provjeraU(poslije.stanje, SUTRA, 0, 10);
  });

  it("svjež rad star 40 minuta pokreće pisanje", () => {
    const { stanje, oznaka } = provjeraU(aktivanU(20), DATUM, 23, 40);

    expect(primijeni(stanje, sRadom(oznaka, u(DATUM, 23, 2).trenutak), u(DATUM, 23, 42)).radnje).toEqual([POKRENI]);
  });

  it("svjež rad iz budućnosti ne odlaže duže od 40 minuta", () => {
    const { stanje, oznaka } = provjeraU(aktivanU(20), DATUM, 23, 40);
    const poslije = primijeni(stanje, sRadom(oznaka, u(SUTRA, 5, 0).trenutak), u(DATUM, 23, 42)).stanje;

    expect(primijeni(poslije, cron, u(SUTRA, 0, 21)).radnje).toEqual([]);
    provjeraU(poslije, SUTRA, 0, 22);
  });

  it("aktivnost iz hooka za vrijeme provjere pomjera T, a rezultat ne pokreće pisanje", () => {
    const { stanje, oznaka } = provjeraU(aktivanU(20), DATUM, 23, 40);
    const sAktivnoscu = primijeni(stanje, aktivnost, u(DATUM, 23, 41)).stanje;
    const poslije = primijeni(sAktivnoscu, bezRada(oznaka), u(DATUM, 23, 42));

    expect(poslije.radnje).toEqual([]);
    expect(primijeni(poslije.stanje, cron, u(SUTRA, 0, 20)).radnje).toEqual([]);
    provjeraU(poslije.stanje, SUTRA, 0, 21);
  });

  it("provjera koja se ne javi 15 minuta ponavlja se poslije 30 minuta", () => {
    const { stanje } = provjeraU(aktivanU(20), DATUM, 23, 40);
    const pala = primijeni(stanje, cron, u(DATUM, 23, 55));

    expect(pala.radnje).toEqual([]);
    expect(primijeni(pala.stanje, cron, u(SUTRA, 0, 20)).radnje).toEqual([]);
    provjeraU(pala.stanje, SUTRA, 0, 25);
  });

  it("javljeni neuspjeh provjere ponavlja se poslije 30 minuta", () => {
    const { stanje, oznaka } = provjeraU(aktivanU(20), DATUM, 23, 40);
    const pala = primijeni(stanje, palo(oznaka), u(DATUM, 23, 42));

    expect(pala.radnje).toEqual([]);
    expect(primijeni(pala.stanje, cron, u(SUTRA, 0, 10)).radnje).toEqual([]);
    provjeraU(pala.stanje, SUTRA, 0, 12);
  });

  it("provjera u 23:40 kreće i kad pitanje čeka odgovor", () => {
    provjeraU({ ...aktivanU(16), pitanjeOd: u(DATUM, 17, 2).trenutak }, DATUM, 23, 40);
  });

  it("u 1:00 pisanje kreće bez provjere, i kad prvi pokušaj nije ni krenuo", () => {
    const stanje = aktivanU(0, 50, SUTRA);

    expect(primijeni(stanje, cron, u(SUTRA, 0, 55)).radnje).toEqual([]);
    const { stanje: poslije, radnje } = primijeni(stanje, cron, u(SUTRA, 1, 0));
    expect(radnje).toEqual([POKRENI]);
    expect(poslije.faza).toBe("pisanje");
  });

  it("u 1:00 kreće i kad je provjera u toku, a njeno javljanje ne pokreće drugo pisanje", () => {
    const { stanje, oznaka } = provjeraU(aktivanU(0, 10, SUTRA), SUTRA, 0, 50);
    const pisanje = primijeni(stanje, cron, u(SUTRA, 1, 0));

    expect(pisanje.radnje).toEqual([POKRENI]);
    expect(primijeni(pisanje.stanje, bezRada(oznaka), u(SUTRA, 1, 2)).radnje).toEqual([]);
  });

  it("izostali cron u 1:00 nadoknadi sljedeći", () => {
    expect(primijeni(aktivanU(0, 50, SUTRA), cron, u(SUTRA, 1, 5)).radnje).toEqual([POKRENI]);
  });

  it("dok pisanje teče, 1:00 ne pokreće novo", () => {
    const stanje = { ...dan("pisanje"), uTokuOd: u(SUTRA, 0, 50).trenutak };

    expect(primijeni(stanje, cron, u(SUTRA, 1, 0)).radnje).toEqual([]);
  });

  it("pisanje koje je u 1:00 bilo u toku troši pokušaj iz 1:00, pa poslije njegovog neuspjeha nema novog", () => {
    const pisanje = primijeni(aktivanU(20), zavrsio, u(SUTRA, 0, 50)).stanje;
    const uToku = primijeni(pisanje, cron, u(SUTRA, 1, 0)).stanje;
    const pao = primijeni(uToku, neuspjeh, u(SUTRA, 1, 10)).stanje;

    for (const minut of [15, 30, 55]) {
      expect(primijeni(pao, cron, u(SUTRA, 1, minut)).radnje).toEqual([]);
    }
  });

  it("javljanje provjere poslije 1:00 pokreće pokušaj iz 1:00, pa poslije njegovog neuspjeha nema trećeg", () => {
    const { stanje, oznaka } = provjeraU(aktivanU(0, 10, SUTRA), SUTRA, 0, 55);
    const pisanje = primijeni(stanje, bezRada(oznaka), u(SUTRA, 1, 1));
    expect(pisanje.radnje).toEqual([POKRENI]);
    const pao = primijeni(pisanje.stanje, neuspjeh, u(SUTRA, 1, 10)).stanje;

    expect(primijeni(pao, cron, u(SUTRA, 1, 15)).radnje).toEqual([]);
  });

  it.each(["zatvoren", "bez_poruke"] as const)("u fazi %s ni 23:40 ni 1:00 ne pokreću ništa", (faza) => {
    const stanje = { ...dan(faza, "Tekst"), uTokuOd: u(DATUM, 23, 39).trenutak };

    expect(vrste(primijeni(stanje, cron, u(DATUM, 23, 40)).radnje)).not.toContain("pokreni_provjeru");
    expect(vrste(primijeni(stanje, cron, u(SUTRA, 1, 0)).radnje)).not.toContain("pokreni_pisanje");
  });

  it("poslije neuspjeha prvog pokušaja nema provjera do 1:00, a u 1:00 je drugi", () => {
    const pao = primijeni(prviPokusaj(), neuspjeh, u(DATUM, 23, 50)).stanje;
    const saAktivnoscu = primijeni(pao, aktivnost, u(DATUM, 23, 55)).stanje;

    for (let minut = 0; minut < 60; minut += 5) {
      expect(primijeni(saAktivnoscu, cron, u(SUTRA, 0, minut)).radnje).toEqual([]);
    }
    expect(primijeni(saAktivnoscu, cron, u(SUTRA, 1, 0)).radnje).toEqual([POKRENI]);
  });

  it("poslije neuspjeha u 1:00 nema trećeg pokušaja: mentoru ništa, a Nemanji upozorenje", () => {
    const pao = primijeni(prviPokusaj(), neuspjeh, u(DATUM, 23, 50)).stanje;
    const drugi = primijeni(pao, cron, u(SUTRA, 1, 0)).stanje;
    const { stanje, radnje } = primijeni(drugi, neuspjeh, u(SUTRA, 1, 10));

    expect(radnje).toEqual([
      {
        vrsta: "posalji_nemanji",
        tekst: "Pisanje izvještaja za 15.5.2030. nije uspjelo. Rad ulazi u sljedeći izvještaj.",
      },
    ]);
    for (const minut of [15, 30, 55]) {
      expect(primijeni(stanje, cron, u(SUTRA, 1, minut)).radnje).toEqual([]);
    }
  });

  it('"završio" i poslije neuspjeha prvog pokušaja pokreće novi', () => {
    const pao = primijeni(prviPokusaj(), neuspjeh, u(DATUM, 23, 50)).stanje;

    expect(primijeni(pao, zavrsio, u(SUTRA, 0, 10)).radnje).toContainEqual(POKRENI);
  });

  it('pisanje pokrenuto sa "završio" ne troši samostalni pokušaj', () => {
    const pisanje = primijeni(aktivanU(20), zavrsio, u(DATUM, 23, 10)).stanje;
    const pao = primijeni(pisanje, neuspjeh, u(DATUM, 23, 15)).stanje;
    const { stanje, oznaka } = provjeraU(pao, DATUM, 23, 40);

    expect(primijeni(stanje, bezRada(oznaka), u(DATUM, 23, 42)).radnje).toEqual([POKRENI]);
  });

  it("neuspjeh prije 23:00 ukida pitanja, ali ne i samostalno slanje", () => {
    const pao = { ...aktivanU(14), faza: "neuspjeh" as const };

    expect(primijeni(pao, cron, u(DATUM, 18, 0)).radnje).toEqual([]);
    provjeraU(pao, DATUM, 23, 40);
    expect(primijeni(pao, cron, u(SUTRA, 1, 0)).radnje).toEqual([POKRENI]);
  });

  it("od 2:00 jučerašnji dan više ne pokreće ništa", () => {
    expect(primijeni(aktivanU(20), cron, u(SUTRA, 2, 0)).radnje).toEqual([]);
  });

  it("provjera iz 22:30 koja se javi poslije 23:00 ne pokreće pisanje", () => {
    const stanje = primijeni(aktivanU(21, 30), cron, u(DATUM, 22, 30)).stanje;

    expect(primijeni(stanje, bezRada(String(stanje.provjeraOd)), u(DATUM, 23, 0)).radnje).toEqual([]);
  });
});

describe("pitanje o završetku", () => {
  const aktivnost = { vrsta: "aktivnost" } as const;
  const POKRENI = { vrsta: "pokreni_provjeru", datum: DATUM };
  const aktivanU = (sat: number, minut = 0) => primijeni(noviDan(DATUM), aktivnost, u(DATUM, sat, minut)).stanje;
  // Dan u kom je provjera pokrenuta u datom trenutku, a posljednja aktivnost je 60 minuta ranije.
  const uProvjeri = (sat = 17, minut = 0) => {
    const stanje = primijeni(aktivanU(sat - 1, minut), cron, u(DATUM, sat, minut)).stanje;
    expect(stanje.provjeraOd).not.toBeNull();
    return { stanje, oznaka: String(stanje.provjeraOd) };
  };
  const bezRada = (oznaka: string) => ({ vrsta: "provjera", oznaka, ishod: "nema-svjezeg-rada" }) as const;
  const sRadom = (oznaka: string, vrijeme: number) =>
    ({ vrsta: "provjera", oznaka, ishod: "svjez-rad", vrijeme }) as const;
  const palo = (oznaka: string) => ({ vrsta: "provjera", oznaka, ishod: "neuspjeh" }) as const;
  const pitanje = () => {
    const { stanje, oznaka } = uProvjeri();
    return primijeni(stanje, bezRada(oznaka), u(DATUM, 17, 2)).stanje;
  };
  const dugme = (odgovor: "jesam" | "nije", datum = DATUM) => ({ vrsta: "dugme", id: "d1", datum, odgovor }) as const;

  describe("uslovi za provjeru", () => {
    it.each([
      ["15:59 je rano", 15, 59, false],
      ["16:00 je prvi trenutak", 16, 0, true],
      ["22:30 je posljednji trenutak", 22, 30, true],
      ["22:31 je kasno", 22, 31, false],
    ])("%s", (_ime, sat, minut, krece) => {
      const { radnje } = primijeni(aktivanU(14), cron, u(DATUM, sat, minut));

      expect(radnje.length > 0).toBe(krece);
    });

    it("pauza mora biti bar 60 minuta", () => {
      const pocetno = aktivanU(16, 1);
      const prerano = { ...u(DATUM, 17, 0), trenutak: u(DATUM, 17, 1).trenutak - 1 };

      expect(primijeni(pocetno, cron, prerano).radnje).toEqual([]);
      expect(primijeni(pocetno, cron, u(DATUM, 17, 1)).radnje).toEqual([
        { ...POKRENI, oznaka: String(u(DATUM, 17, 1).trenutak) },
      ]);
    });

    it("dan bez signala iz hooka nema provjeru", () => {
      const pocetno = noviDan(DATUM);

      expect(primijeni(pocetno, cron, u(DATUM, 18, 0))).toEqual({ stanje: pocetno, radnje: [] });
    });

    it.each(["pisanje", "bez_poruke", "neuspjeh", "zatvoren"] as const)("u fazi %s nema provjere", (faza) => {
      const pocetno = {
        ...dan(faza, "Tekst"),
        uTokuOd: u(DATUM, 17, 59).trenutak,
        posljednjaAktivnost: u(DATUM, 12).trenutak,
      };

      expect(primijeni(pocetno, cron, u(DATUM, 18, 0)).radnje).not.toContainEqual(
        expect.objectContaining({ vrsta: "pokreni_provjeru" }),
      );
    });

    it("dok je provjera u toku nema druge", () => {
      const { stanje } = uProvjeri();

      expect(primijeni(stanje, cron, u(DATUM, 17, 5)).radnje).toEqual([]);
    });

    it("provjera ne mijenja posljednju aktivnost", () => {
      expect(uProvjeri().stanje.posljednjaAktivnost).toBe(u(DATUM, 16, 0).trenutak);
    });
  });

  describe("rezultat provjere", () => {
    it("bez svježeg rada šalje pitanje", () => {
      const { stanje, oznaka } = uProvjeri();
      const prelaz = primijeni(stanje, bezRada(oznaka), u(DATUM, 17, 2));

      expect(prelaz.radnje).toEqual([{ vrsta: "posalji_pitanje", datum: DATUM, tekst: "Da li si završio za danas?" }]);
      expect(prelaz.stanje).toMatchObject({ provjeraOd: null, pitanjeOd: u(DATUM, 17, 2).trenutak });
    });

    it("sa svježim radom odlaže 60 minuta od tog rada i ne dira posljednju aktivnost", () => {
      const { stanje, oznaka } = uProvjeri();
      const prelaz = primijeni(stanje, sRadom(oznaka, u(DATUM, 16, 40).trenutak), u(DATUM, 17, 2));

      expect(prelaz.radnje).toEqual([]);
      expect(prelaz.stanje.posljednjaAktivnost).toBe(stanje.posljednjaAktivnost);

      const prije = { ...u(DATUM, 17, 39), trenutak: u(DATUM, 17, 40).trenutak - 1 };
      expect(primijeni(prelaz.stanje, cron, prije).radnje).toEqual([]);
      expect(primijeni(prelaz.stanje, cron, u(DATUM, 17, 40)).radnje).toEqual([
        { ...POKRENI, oznaka: String(u(DATUM, 17, 40).trenutak) },
      ]);
    });

    it("rad star 60 minuta ne odlaže pitanje, inače bi jutarnji commit držao pitanje cijeli dan", () => {
      const { stanje, oznaka } = uProvjeri();
      const { radnje } = primijeni(stanje, sRadom(oznaka, u(DATUM, 16, 2).trenutak), u(DATUM, 17, 2));

      expect(radnje.map((radnja) => radnja.vrsta)).toEqual(["posalji_pitanje"]);
    });

    it("rad star 59 minuta još odlaže", () => {
      const { stanje, oznaka } = uProvjeri();

      expect(primijeni(stanje, sRadom(oznaka, u(DATUM, 16, 3).trenutak), u(DATUM, 17, 2)).radnje).toEqual([]);
    });

    it("vrijeme iz budućnosti ne odlaže duže od pauze", () => {
      const { stanje, oznaka } = uProvjeri();
      const { stanje: poslije } = primijeni(stanje, sRadom(oznaka, u(DATUM, 22, 0).trenutak), u(DATUM, 17, 2));

      expect(primijeni(poslije, cron, u(DATUM, 18, 1)).radnje).toEqual([]);
      expect(primijeni(poslije, cron, u(DATUM, 18, 2)).radnje).toHaveLength(1);
    });

    it("aktivnost dok provjera traje poništava pitanje, pa opet važi 60 minuta pauze", () => {
      const { stanje, oznaka } = uProvjeri();
      const sAktivnoscu = primijeni(stanje, aktivnost, u(DATUM, 17, 1)).stanje;
      const prelaz = primijeni(sAktivnoscu, bezRada(oznaka), u(DATUM, 17, 2));

      expect(prelaz.radnje).toEqual([]);
      expect(primijeni(prelaz.stanje, cron, u(DATUM, 18, 0)).radnje).toEqual([]);
      expect(primijeni(prelaz.stanje, cron, u(DATUM, 18, 1)).radnje).toHaveLength(1);
    });

    it("javljanje sa tuđom oznakom ne radi ništa", () => {
      const { stanje } = uProvjeri();

      expect(primijeni(stanje, bezRada("123"), u(DATUM, 17, 2))).toEqual({ stanje, radnje: [] });
    });

    it("dvostruko javljanje šalje jedno pitanje", () => {
      const { stanje, oznaka } = uProvjeri();
      const prvo = primijeni(stanje, bezRada(oznaka), u(DATUM, 17, 2));

      expect(primijeni(prvo.stanje, bezRada(oznaka), u(DATUM, 17, 3)).radnje).toEqual([]);
    });

    it("poslije pokrenutog pisanja javljanje ne šalje pitanje", () => {
      const { stanje, oznaka } = uProvjeri();
      const pisanje = primijeni(stanje, zavrsio, u(DATUM, 17, 1)).stanje;

      expect(primijeni(pisanje, bezRada(oznaka), u(DATUM, 17, 2)).radnje).toEqual([]);
    });

    it("provjera iz 22:30 može da pita do 22:45, a ne pred slanje u 23:00", () => {
      const { stanje, oznaka } = uProvjeri(22, 30);

      expect(primijeni(stanje, bezRada(oznaka), u(DATUM, 22, 44)).radnje.map((radnja) => radnja.vrsta)).toEqual([
        "posalji_pitanje",
      ]);
      expect(primijeni(stanje, bezRada(oznaka), u(DATUM, 22, 45)).radnje).toEqual([]);
      expect(primijeni(stanje, bezRada(oznaka), u(DATUM, 23, 0)).radnje).toEqual([]);
      expect(primijeni(stanje, bezRada(oznaka), u("2030-05-16", 0, 5)).radnje).toEqual([]);
    });
  });

  describe("neuspjela provjera", () => {
    it("koja se ne javi 15 minuta ponavlja se poslije 30 minuta, a pitanja nema", () => {
      const { stanje } = uProvjeri();
      const prije = { ...u(DATUM, 17, 14), trenutak: u(DATUM, 17, 15).trenutak - 1 };
      expect(primijeni(stanje, cron, prije).stanje).toBe(stanje);

      const pala = primijeni(stanje, cron, u(DATUM, 17, 15));
      expect(pala.radnje).toEqual([]);
      expect(pala.stanje.provjeraOd).toBeNull();

      expect(primijeni(pala.stanje, cron, u(DATUM, 17, 40)).radnje).toEqual([]);
      expect(primijeni(pala.stanje, cron, u(DATUM, 17, 45)).radnje).toEqual([
        { ...POKRENI, oznaka: String(u(DATUM, 17, 45).trenutak) },
      ]);
    });

    it("javljeni neuspjeh ne šalje pitanje, a ponavlja se poslije 30 minuta", () => {
      const { stanje, oznaka } = uProvjeri();
      const pala = primijeni(stanje, palo(oznaka), u(DATUM, 17, 2));

      expect(pala.radnje).toEqual([]);
      expect(primijeni(pala.stanje, cron, u(DATUM, 17, 30)).radnje).toEqual([]);
      expect(primijeni(pala.stanje, cron, u(DATUM, 17, 32)).radnje).toHaveLength(1);
    });

    it("javljanje poslije roka je neuspjeh, i kad cron još nije stigao", () => {
      const { stanje, oznaka } = uProvjeri();
      const prelaz = primijeni(stanje, bezRada(oznaka), u(DATUM, 17, 15));

      expect(prelaz.radnje).toEqual([]);
      expect(prelaz.stanje.odlozenoDo).toBe(u(DATUM, 17, 45).trenutak);
    });

    it("nepokrenuta provjera se ponavlja poslije 30 minuta", () => {
      const { stanje } = primijeni(uProvjeri().stanje, { vrsta: "provjera_nije_pokrenuta" }, u(DATUM, 17, 0));

      expect(stanje).toMatchObject({ provjeraOd: null, odlozenoDo: u(DATUM, 17, 30).trenutak });
    });

    it("pitanje koje nije stiglo ne čeka odgovor, nego se ponavlja poslije 30 minuta", () => {
      const { stanje } = primijeni(pitanje(), { vrsta: "pitanje_nije_poslato" }, u(DATUM, 17, 2));

      expect(primijeni(stanje, cron, u(DATUM, 17, 30)).radnje).toEqual([]);
      expect(primijeni(stanje, cron, u(DATUM, 17, 32)).radnje).toHaveLength(1);
    });
  });

  describe("pitanje bez odgovora", () => {
    it("nema novog pitanja dok nema nove aktivnosti", () => {
      const pocetno = pitanje();

      for (const sat of [18, 19, 20, 21, 22]) {
        expect(primijeni(pocetno, cron, u(DATUM, sat, 0)).radnje).toEqual([]);
      }
    });

    it("nova aktivnost ponovo otvara put, poslije 60 minuta pauze", () => {
      const { stanje } = primijeni(pitanje(), aktivnost, u(DATUM, 18, 0));

      expect(primijeni(stanje, cron, u(DATUM, 18, 55)).radnje).toEqual([]);
      expect(primijeni(stanje, cron, u(DATUM, 19, 0)).radnje).toHaveLength(1);
    });
  });

  describe('"Jesam"', () => {
    it("pokreće pisanje odmah, a prvo odgovara na dugme", () => {
      const { stanje, radnje } = primijeni(pitanje(), dugme("jesam"), u(DATUM, 17, 5));

      expect(stanje.faza).toBe("pisanje");
      expect(radnje[0]).toEqual({ vrsta: "odgovori_na_dugme", id: "d1" });
      expect(radnje).toContainEqual({ vrsta: "pokreni_pisanje", datum: DATUM });
    });

    it("dvostruki pritisak pokreće jedno pisanje", () => {
      const prvi = primijeni(pitanje(), dugme("jesam"), u(DATUM, 17, 5));
      const drugi = primijeni(prvi.stanje, dugme("jesam"), u(DATUM, 17, 5));

      expect(drugi.stanje).toBe(prvi.stanje);
      expect(drugi.radnje).not.toContainEqual({ vrsta: "pokreni_pisanje", datum: DATUM });
      expect(drugi.radnje[0]).toEqual({ vrsta: "odgovori_na_dugme", id: "d1" });
    });

    it("na zatvoren dan ne pokreće pisanje", () => {
      const { radnje } = primijeni(dan("zatvoren"), dugme("jesam"), u(DATUM, 18, 0));

      expect(radnje).not.toContainEqual({ vrsta: "pokreni_pisanje", datum: DATUM });
    });
  });

  describe('"Nije"', () => {
    const odgovoreno = () => primijeni(pitanje(), dugme("nije"), u(DATUM, 17, 10));

    it("odgovara na dugme i ne pokreće ništa", () => {
      expect(odgovoreno().radnje).toEqual([
        { vrsta: "odgovori_na_dugme", id: "d1", tekst: "U redu, pitaću te kasnije." },
      ]);
    });

    it("bez aktivnosti: nova provjera za 30 minuta", () => {
      const { stanje } = odgovoreno();

      expect(primijeni(stanje, cron, u(DATUM, 17, 35)).radnje).toEqual([]);
      expect(primijeni(stanje, cron, u(DATUM, 17, 40)).radnje).toHaveLength(1);
    });

    it("sa aktivnošću: opet važi 60 minuta pauze", () => {
      const { stanje } = primijeni(odgovoreno().stanje, aktivnost, u(DATUM, 17, 20));

      expect(primijeni(stanje, cron, u(DATUM, 17, 40)).radnje).toEqual([]);
      expect(primijeni(stanje, cron, u(DATUM, 18, 15)).radnje).toEqual([]);
      expect(primijeni(stanje, cron, u(DATUM, 18, 20)).radnje).toHaveLength(1);
    });

    it("provjeru koja je u toku odbacuje, da pitanje ne stigne odmah poslije odgovora", () => {
      const { stanje, oznaka } = uProvjeri();
      const poslije = primijeni(stanje, dugme("nije"), u(DATUM, 17, 1)).stanje;

      expect(primijeni(poslije, bezRada(oznaka), u(DATUM, 17, 2)).radnje).toEqual([]);
    });

    it.each(["pisanje", "bez_poruke", "neuspjeh", "zatvoren"] as const)("u fazi %s ne mijenja stanje", (faza) => {
      const pocetno = dan(faza);
      const { stanje, radnje } = primijeni(pocetno, dugme("nije"), u(DATUM, 18, 0));

      expect(stanje).toBe(pocetno);
      expect(radnje).toEqual([{ vrsta: "odgovori_na_dugme", id: "d1", tekst: "U redu." }]);
    });
  });

  describe("staro dugme", () => {
    it.each(["jesam", "nije"] as const)('"%s" od juče samo odgovara da je pitanje isteklo', (odgovor) => {
      const pocetno = aktivanU(16);
      const { stanje, radnje } = primijeni(pocetno, dugme(odgovor, "2030-05-14"), u(DATUM, 17, 0));

      expect(stanje).toBe(pocetno);
      expect(radnje).toEqual([{ vrsta: "odgovori_na_dugme", id: "d1", tekst: "Pitanje je isteklo." }]);
    });

    it("od juče, kad je juče zatvoreno, poslije ponoći je isteklo", () => {
      const { radnje } = primijeni(noviDan("2030-05-16"), dugme("jesam"), u("2030-05-16", 0, 1));

      expect(radnje).toEqual([{ vrsta: "odgovori_na_dugme", id: "d1", tekst: "Pitanje je isteklo." }]);
    });

    it("od juče važi poslije ponoći dok radni dan nije zatvoren", () => {
      const { stanje, radnje } = primijeni(pitanje(), dugme("jesam"), u("2030-05-16", 0, 30));

      expect(stanje).toMatchObject({ datum: DATUM, faza: "pisanje" });
      expect(radnje).toContainEqual({ vrsta: "pokreni_pisanje", datum: DATUM });
    });

    it("od juče od 1:00 je isteklo, iako radni dan nije zatvoren", () => {
      const { radnje } = primijeni(pitanje(), dugme("jesam"), u("2030-05-16", 1, 0));

      expect(radnje).toEqual([{ vrsta: "odgovori_na_dugme", id: "d1", tekst: "Pitanje je isteklo." }]);
    });
  });

});

describe("prelazak na ljetnje i zimsko vrijeme", () => {
  const PET_MINUTA = 5 * 60_000;

  // Prolazi kroz radni dan po UTC-u, bez hooka, a ni provjera ni pisanje se nikad ne jave.
  function samostalnoKrozDan(datum: string, pocetak: string, kraj: string) {
    let stanje = noviDan(datum);
    const pokretanja: string[] = [];
    for (let t = Date.parse(pocetak); t <= Date.parse(kraj); t += PET_MINUTA) {
      const prelaz = primijeni(stanje, cron, lokalnoVrijeme(new Date(t)));
      stanje = prelaz.stanje;
      for (const radnja of prelaz.radnje) pokretanja.push(`${radnja.vrsta} ${new Date(t).toISOString()}`);
    }
    return pokretanja;
  }

  // Provjera iz 23:40 se ne javi, pa se ponavlja u 0:25. Pisanje kreće u 1:00, a rok mu ističe u 1:30.
  // Vremena su po UTC-u, izračunata ručno.
  it.each([
    ["običan ljetnji dan", "2030-05-15", "2030-05-14T22:00:00Z", "2030-05-16T01:00:00Z",
      ["2030-05-15T21:40", "2030-05-15T22:25", "2030-05-15T23:00", "2030-05-15T23:30"]],
    ["običan zimski dan", "2030-01-15", "2030-01-14T23:00:00Z", "2030-01-16T02:00:00Z",
      ["2030-01-15T22:40", "2030-01-15T23:25", "2030-01-16T00:00", "2030-01-16T00:30"]],
    ["dan prije prelaska na ljetnje, 1:00 je još po zimskom", "2030-03-30", "2030-03-29T23:00:00Z", "2030-03-31T02:00:00Z",
      ["2030-03-30T22:40", "2030-03-30T23:25", "2030-03-31T00:00", "2030-03-31T00:30"]],
    ["dan prelaska na ljetnje (23 sata)", "2030-03-31", "2030-03-30T23:00:00Z", "2030-04-01T01:00:00Z",
      ["2030-03-31T21:40", "2030-03-31T22:25", "2030-03-31T23:00", "2030-03-31T23:30"]],
    ["dan prije prelaska na zimsko, 1:00 je još po ljetnjem", "2030-10-26", "2030-10-25T22:00:00Z", "2030-10-27T02:00:00Z",
      ["2030-10-26T21:40", "2030-10-26T22:25", "2030-10-26T23:00", "2030-10-26T23:30"]],
    ["dan prelaska na zimsko (25 sati)", "2030-10-27", "2030-10-26T22:00:00Z", "2030-10-28T02:00:00Z",
      ["2030-10-27T22:40", "2030-10-27T23:25", "2030-10-28T00:00", "2030-10-28T00:30"]],
  ])("%s: provjere u 23:40 i 0:25, a pisanje u 1:00", (_ime, datum, pocetak, kraj, [prva, druga, pisanje, rok]) => {
    expect(samostalnoKrozDan(datum, pocetak, kraj)).toEqual([
      `pokreni_provjeru ${prva}:00.000Z`,
      `pokreni_provjeru ${druga}:00.000Z`,
      `pokreni_pisanje ${pisanje}:00.000Z`,
      `posalji_nemanji ${rok}:00.000Z`,
    ]);
  });

  it("rok se računa po pravom vremenu kad se sat vrati unazad", () => {
    // 02:50 po ljetnjem, pa 02:20 po zimskom: sat kaže da je vrijeme proteklo unazad.
    const pisanje = primijeni(noviDan("2030-10-27"), zavrsio, lokalnoVrijeme(new Date("2030-10-27T00:50:00Z")));
    const poslije = lokalnoVrijeme(new Date("2030-10-27T01:20:00Z"));

    expect(poslije.sat).toBe(2);
    expect(primijeni(pisanje.stanje, cron, poslije).stanje.faza).toBe("neuspjeh");
  });

  it("rok se računa po pravom vremenu kad sat skoči unaprijed", () => {
    // 01:50 po zimskom, pa 03:10 po ljetnjem: prošlo je 20 minuta, a sat kaže 80.
    const pisanje = primijeni(noviDan("2030-03-31"), zavrsio, lokalnoVrijeme(new Date("2030-03-31T00:50:00Z")));
    const poslije = lokalnoVrijeme(new Date("2030-03-31T01:10:00Z"));

    expect(poslije.sat).toBe(3);
    expect(primijeni(pisanje.stanje, cron, poslije).stanje.faza).toBe("pisanje");
  });
});

describe("rok pisanja", () => {
  const pokrenuto = () => primijeni(noviDan(DATUM), zavrsio, u(DATUM, 12, 0)).stanje;
  const uMs = (ms: number) => ({ ...u(DATUM, 12, 0), trenutak: u(DATUM, 12, 0).trenutak + ms });

  it("prije 30 minuta se čeka", () => {
    const { stanje, radnje } = primijeni(pokrenuto(), cron, uMs(30 * 60_000 - 1));

    expect(stanje.faza).toBe("pisanje");
    expect(radnje).toEqual([]);
  });

  it("poslije 30 minuta je neuspjeh: upozorenje Nemanji, a mentoru ništa", () => {
    const { stanje, radnje } = primijeni(pokrenuto(), cron, uMs(30 * 60_000));

    expect(stanje.faza).toBe("neuspjeh");
    expect(radnje).toEqual([
      {
        vrsta: "posalji_nemanji",
        tekst: 'Pisanje izvještaja za 15.5.2030. se nije javilo u roku. Pošalji "završio" za novi pokušaj.',
      },
    ]);
  });

  it("pisanje bez zapisanog početka ne ostaje zaglavljeno", () => {
    expect(primijeni(dan("pisanje"), cron, u()).stanje.faza).toBe("neuspjeh");
  });

  it("važi i kad je rok istekao poslije ponoći, za dan u kom je pisanje pokrenuto", () => {
    const pisanje = primijeni(noviDan(DATUM), zavrsio, u(DATUM, 23, 55));
    const { stanje } = primijeni(pisanje.stanje, cron, u("2030-05-16", 0, 25));

    expect(stanje).toMatchObject({ datum: DATUM, faza: "neuspjeh" });
  });
});

describe("neuspjelo slanje", () => {
  const SLANJE_PALO = { vrsta: "slanje_nije_uspjelo" } as const;
  const napisano = (sat = 12) =>
    primijeni(dan("pisanje"), { vrsta: "rezultat", ishod: "gotovo", tekst: "Tekst" }, u(DATUM, sat, 0)).stanje;

  it("sljedeći cron ponavlja poruku, bez novog pisanja", () => {
    const { stanje, radnje } = primijeni(napisano(), cron, u(DATUM, 12, 5));

    expect(stanje).toMatchObject({ faza: "bez_poruke", tekst: "Tekst" });
    expect(radnje).toEqual([{ vrsta: "posalji_mentoru", tekst: "Tekst", bezZvuka: false }]);
  });

  it("cron ne šalje poruku koja je baš poslata", () => {
    const { radnje } = primijeni(napisano(), cron, { ...u(DATUM, 12, 0), trenutak: u(DATUM, 12, 0).trenutak + 59_000 });

    expect(radnje).toEqual([]);
  });

  it("cron prije 23:00 ponavlja bez upozorenja", () => {
    const pocetno = napisano();

    expect(primijeni(pocetno, SLANJE_PALO, u(DATUM, 22, 55))).toEqual({ stanje: pocetno, radnje: [] });
  });

  it("u 23:00 Nemanja dobija jedno upozorenje, bez teksta poruke", () => {
    const prvo = primijeni(napisano(), SLANJE_PALO, u(DATUM, 23, 0));

    expect(prvo.radnje).toEqual([
      {
        vrsta: "posalji_nemanji",
        tekst: "Poruka o izvještaju za 15.5.2030. nije poslata. Pokušavam ponovo svakih 5 minuta.",
      },
    ]);
    expect(primijeni(prvo.stanje, SLANJE_PALO, u(DATUM, 23, 5)).radnje).toEqual([]);
  });

  it("poslije ponoći upozorenje važi i za pisanje završeno juče", () => {
    expect(primijeni(napisano(), SLANJE_PALO, u("2030-05-16", 0, 5)).radnje).toHaveLength(1);
  });

  it("poslije zatvaranja nema upozorenja", () => {
    expect(primijeni(dan("zatvoren"), SLANJE_PALO, u(DATUM, 23, 0)).radnje).toEqual([]);
  });
});

describe('"odloži"', () => {
  const SUTRA = "2030-05-16";
  const odlozi = { vrsta: "odlozi" } as const;
  const aktivnost = { vrsta: "aktivnost" } as const;
  const POTVRDA = { vrsta: "posalji_nemanji", tekst: "U redu, čekam tvoje ‚završio', najkasnije do 1:00." };
  const aktivanU = (sat: number, minut = 0) => primijeni(noviDan(DATUM), aktivnost, u(DATUM, sat, minut)).stanje;
  const odlozenU = (stanje: StanjeDana, vrijeme = u(DATUM, 20, 0)) => {
    const prelaz = primijeni(stanje, odlozi, vrijeme);
    expect(prelaz.radnje).toEqual([POTVRDA]);
    return prelaz.stanje;
  };
  // Svi cron-ovi od datog trenutka do 0:55 ne rade ništa.
  const tihoDo1 = (stanje: StanjeDana, od = u(DATUM, 20, 0)) => {
    for (let trenutak = od.trenutak; trenutak < u(SUTRA, 1, 0).trenutak; trenutak += 5 * 60_000) {
      const prelaz = primijeni(stanje, cron, lokalnoVrijeme(new Date(trenutak)));
      expect(prelaz.radnje).toEqual([]);
      stanje = prelaz.stanje;
    }
    return stanje;
  };

  it("potvrđuje, a poslije 23:00 nema samostalnog slanja ni provjere do 1:00", () => {
    tihoDo1(odlozenU(aktivanU(20)));
  });

  it("u 1:00 pisanje kreće bez provjere", () => {
    const stanje = tihoDo1(odlozenU(aktivanU(20)));

    expect(primijeni(stanje, cron, u(SUTRA, 1, 0)).radnje).toEqual([{ vrsta: "pokreni_pisanje", datum: DATUM }]);
  });

  it('"završio" i dalje pokreće pisanje odmah', () => {
    const { stanje, radnje } = primijeni(odlozenU(aktivanU(20)), zavrsio, u(DATUM, 23, 50));

    expect(stanje.faza).toBe("pisanje");
    expect(radnje).toContainEqual({ vrsta: "pokreni_pisanje", datum: DATUM });
  });

  it("prije 23:00 nema pitanja o završetku", () => {
    tihoDo1(odlozenU(aktivanU(9), u(DATUM, 9, 30)), u(DATUM, 9, 30));
  });

  it("odbacuje provjeru koja je u toku", () => {
    const sProvjerom = primijeni(aktivanU(20), cron, u(DATUM, 23, 40));
    const oznaka = String(u(DATUM, 23, 40).trenutak);
    const stanje = odlozenU(sProvjerom.stanje, u(DATUM, 23, 41));

    expect(
      primijeni(stanje, { vrsta: "provjera", oznaka, ishod: "nema-svjezeg-rada" }, u(DATUM, 23, 42)).radnje,
    ).toEqual([]);
  });

  it("ponovno samo ponovi potvrdu, bez promjene stanja", () => {
    const stanje = odlozenU(aktivanU(20));

    expect(primijeni(stanje, odlozi, u(DATUM, 21, 0))).toEqual({ stanje, radnje: [POTVRDA] });
  });

  it("od 0:00 do 1:00 važi za jučerašnji radni dan", () => {
    const stanje = odlozenU(aktivanU(23, 50), u(SUTRA, 0, 20));

    expect(stanje.datum).toBe(DATUM);
    tihoDo1(stanje, u(SUTRA, 0, 20));
  });

  it("poslije neuspjeha važi kao i inače", () => {
    const stanje = tihoDo1(odlozenU({ ...aktivanU(14), faza: "neuspjeh" }));

    expect(stanje.faza).toBe("neuspjeh");
    expect(primijeni(stanje, cron, u(SUTRA, 1, 0)).radnje).toEqual([{ vrsta: "pokreni_pisanje", datum: DATUM }]);
  });

  it("poslije neuspjelog prvog samostalnog pokušaja pisanje i dalje kreće u 1:00", () => {
    const pisanje = primijeni(aktivanU(20), cron, u(DATUM, 23, 40));
    const oznaka = String(u(DATUM, 23, 40).trenutak);
    const pokusaj = primijeni(pisanje.stanje, { vrsta: "provjera", oznaka, ishod: "nema-svjezeg-rada" }, u(DATUM, 23, 42));
    const pao = primijeni(pokusaj.stanje, { vrsta: "rezultat", ishod: "neuspjeh" }, u(DATUM, 23, 50)).stanje;
    const stanje = tihoDo1(odlozenU(pao, u(DATUM, 23, 55)), u(DATUM, 23, 55));

    expect(primijeni(stanje, cron, u(SUTRA, 1, 0)).radnje).toEqual([{ vrsta: "pokreni_pisanje", datum: DATUM }]);
  });

  it.each([
    ["pisanje", "Pisanje izvještaja je već u toku."],
    ["bez_poruke", "Izvještaj je napisan, ali poruka još nije poslata."],
    ["zatvoren", "Izvještaj za danas je već poslat."],
  ] as const)("u fazi %s odgovara isto kao na \"završio\" i ništa ne mijenja", (faza, tekst) => {
    const pocetno = dan(faza, faza === "bez_poruke" ? "Tekst" : null);

    expect(primijeni(pocetno, odlozi, u(DATUM, 20, 0))).toEqual({
      stanje: pocetno,
      radnje: [{ vrsta: "posalji_nemanji", tekst }],
    });
  });

  it("poslije ponoći, dok jučerašnje pisanje teče, odgovara da je pisanje u toku", () => {
    expect(primijeni(dan("pisanje"), odlozi, u(SUTRA, 0, 30)).radnje).toEqual([
      { vrsta: "posalji_nemanji", tekst: "Pisanje izvještaja je već u toku." },
    ]);
  });

  describe("pitanje koje je već poslato", () => {
    const poslatoPitanje = () => {
      const { stanje } = primijeni(aktivanU(16), cron, u(DATUM, 17, 0));
      const oznaka = String(u(DATUM, 17, 0).trenutak);
      const pitanje = primijeni(stanje, { vrsta: "provjera", oznaka, ishod: "nema-svjezeg-rada" }, u(DATUM, 17, 2));
      expect(pitanje.radnje.map((radnja) => radnja.vrsta)).toEqual(["posalji_pitanje"]);
      return odlozenU(pitanje.stanje, u(DATUM, 17, 5));
    };
    const dugme = (odgovor: "jesam" | "nije") => ({ vrsta: "dugme", id: "d", datum: DATUM, odgovor }) as const;

    it('"Jesam" i dalje pokreće pisanje', () => {
      const { radnje } = primijeni(poslatoPitanje(), dugme("jesam"), u(DATUM, 17, 10));

      expect(radnje).toContainEqual({ vrsta: "pokreni_pisanje", datum: DATUM });
    });

    it('"Nije" ne pravi novo pitanje i ne obećava ga', () => {
      const { stanje, radnje } = primijeni(poslatoPitanje(), dugme("nije"), u(DATUM, 17, 10));

      expect(radnje).toEqual([{ vrsta: "odgovori_na_dugme", id: "d", tekst: "U redu." }]);
      tihoDo1(stanje, u(DATUM, 17, 10));
    });
  });
});
