import { describe, expect, it } from "vitest";
import { lokalnoVrijeme, noviDan, primijeni, type StanjeDana } from "../src/pravila";

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

describe("aktivnost", () => {
  const aktivnost = { vrsta: "aktivnost" } as const;

  it.each(["otvoren", "pisanje", "bez_poruke", "neuspjeh", "zatvoren"] as const)(
    "u fazi %s pamti samo vrijeme i ne radi ništa drugo",
    (faza) => {
      const pocetno = { ...dan(faza, "Tekst"), uTokuOd: 123, pokusaj23: true, upozoren: true };
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
    expect(radnje).toEqual([{ vrsta: "posalji_mentoru", tekst: "Tekst poruke" }]);
  });

  it("dan bez rada se zatvara kao i svaki drugi: poruka, pa zatvoren dan", () => {
    const tekst = "Danas nema zabilježenog rada";
    const poslije = primijeni(dan("pisanje"), { vrsta: "rezultat", ishod: "gotovo", tekst }, u());

    expect(poslije.radnje).toEqual([{ vrsta: "posalji_mentoru", tekst }]);
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

describe("cron u 23:00", () => {
  it("na otvoren dan pokreće pisanje za taj datum", () => {
    const { stanje, radnje } = primijeni(noviDan(DATUM), cron, u(DATUM, 23, 0));

    expect(stanje.faza).toBe("pisanje");
    expect(radnje).toEqual([{ vrsta: "pokreni_pisanje", datum: DATUM }]);
  });

  it("u 22:55 još ne pokreće ništa", () => {
    const pocetno = noviDan(DATUM);
    const { stanje, radnje } = primijeni(pocetno, cron, u(DATUM, 22, 55));

    expect(stanje).toBe(pocetno);
    expect(radnje).toEqual([]);
  });

  it("kreće i ako je cron u 23:00 izostao", () => {
    const { radnje } = primijeni(noviDan(DATUM), cron, u(DATUM, 23, 40));

    expect(radnje).toEqual([{ vrsta: "pokreni_pisanje", datum: DATUM }]);
  });

  it("poslije ponoći ne pokreće pisanje za juče", () => {
    const { radnje } = primijeni(noviDan(DATUM), cron, u("2030-05-16", 23, 0));

    expect(radnje).toEqual([]);
  });

  it.each(["zatvoren", "pisanje"] as const)("u fazi %s ne pokreće pisanje", (faza) => {
    const pocetno = { ...dan(faza), uTokuOd: u(DATUM, 23, 0).trenutak };
    const { stanje, radnje } = primijeni(pocetno, cron, u(DATUM, 23, 0));

    expect(stanje).toBe(pocetno);
    expect(radnje).toEqual([]);
  });

  it("poslije ranijeg neuspjeha pokušava još jednom", () => {
    const { stanje, radnje } = primijeni(dan("neuspjeh"), cron, u(DATUM, 23, 0));

    expect(stanje.faza).toBe("pisanje");
    expect(radnje).toEqual([{ vrsta: "pokreni_pisanje", datum: DATUM }]);
  });

  it("poslije neuspjeha pokušaja iz 23:00 ne pokušava ponovo, a završio još radi", () => {
    const pokusaj = primijeni(noviDan(DATUM), cron, u(DATUM, 23, 0));
    const pao = primijeni(pokusaj.stanje, { vrsta: "rezultat", ishod: "neuspjeh" }, u(DATUM, 23, 5));

    expect(primijeni(pao.stanje, cron, u(DATUM, 23, 10)).radnje).toEqual([]);
    expect(primijeni(pao.stanje, zavrsio, u(DATUM, 23, 15)).radnje).toContainEqual({
      vrsta: "pokreni_pisanje",
      datum: DATUM,
    });
  });

  it("neuspjeh pisanja pokrenutog prije 23:00 ne troši pokušaj iz 23:00", () => {
    const pisanje = primijeni(noviDan(DATUM), zavrsio, u(DATUM, 22, 50));
    const pao = primijeni(pisanje.stanje, cron, u(DATUM, 23, 20));

    expect(pao.stanje.faza).toBe("neuspjeh");
    expect(primijeni(pao.stanje, cron, u(DATUM, 23, 25)).radnje).toEqual([
      { vrsta: "pokreni_pisanje", datum: DATUM },
    ]);
  });

  it("poslije neuspjeha preko dana cron do 23:00 ne šalje ništa, pa ni pitanje", () => {
    const pocetno = { ...dan("neuspjeh"), posljednjaAktivnost: u(DATUM, 12, 0).trenutak };
    for (let sat = 16; sat < 23; sat++) {
      expect(primijeni(pocetno, cron, u(DATUM, sat, 0)).radnje).toEqual([]);
    }
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

      expect(poslije.odlozenoDo).toBe(u(DATUM, 18, 2).trenutak);
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

      expect(primijeni(stanje, bezRada(oznaka), u(DATUM, 22, 44)).radnje).toHaveLength(1);
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

    it("minut poslije ponoći je već staro", () => {
      const { radnje } = primijeni(noviDan("2030-05-16"), dugme("jesam"), u("2030-05-16", 0, 1));

      expect(radnje).toEqual([{ vrsta: "odgovori_na_dugme", id: "d1", tekst: "Pitanje je isteklo." }]);
    });
  });

  it("u 23:00 pisanje kreće i ako pitanje još čeka odgovor", () => {
    const { stanje, radnje } = primijeni(pitanje(), cron, u(DATUM, 23, 0));

    expect(stanje.faza).toBe("pisanje");
    expect(radnje).toEqual([{ vrsta: "pokreni_pisanje", datum: DATUM }]);
  });
});

describe("prelazak na ljetnje i zimsko vrijeme", () => {
  const PET_MINUTA = 5 * 60_000;

  // Prolazi kroz cijeli dan po UTC-u, a pisanje se nikad ne javi.
  function pokretanjaKrozDan(pocetak: string, kraj: string) {
    let stanje = noviDan(lokalnoVrijeme(new Date(pocetak)).datum);
    const pokretanja: string[] = [];
    for (let t = Date.parse(pocetak); t <= Date.parse(kraj); t += PET_MINUTA) {
      const prelaz = primijeni(stanje, cron, lokalnoVrijeme(new Date(t)));
      stanje = prelaz.stanje;
      if (prelaz.radnje.some((radnja) => radnja.vrsta === "pokreni_pisanje")) {
        pokretanja.push(new Date(t).toISOString());
      }
    }
    return pokretanja;
  }

  it.each([
    ["običan ljetnji dan", "2030-05-14T22:00:00Z", "2030-05-15T21:55:00Z", "2030-05-15T21:00:00.000Z"],
    ["običan zimski dan", "2030-01-14T23:00:00Z", "2030-01-15T22:55:00Z", "2030-01-15T22:00:00.000Z"],
    ["prelazak na ljetnje (23 sata)", "2030-03-30T23:00:00Z", "2030-03-31T21:55:00Z", "2030-03-31T21:00:00.000Z"],
    ["prelazak na zimsko (25 sati)", "2030-10-26T22:00:00Z", "2030-10-27T22:55:00Z", "2030-10-27T22:00:00.000Z"],
  ])("%s: pisanje kreće tačno jednom, u 23:00", (_ime, pocetak, kraj, ocekivano) => {
    expect(pokretanjaKrozDan(pocetak, kraj)).toEqual([ocekivano]);
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
    expect(radnje).toEqual([{ vrsta: "posalji_mentoru", tekst: "Tekst" }]);
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
