// Pravila dana: bez mreže, baze i sata. Ostatak Workera učita stanje, pozove primijeni(),
// upiše novo stanje i izvrši radnje.

export type Faza = "otvoren" | "pisanje" | "bez_poruke" | "neuspjeh" | "zatvoren";

export interface StanjeDana {
  datum: string;
  faza: Faza;
  // Tekst poruke, samo dok je izvještaj završen, a poruka nije poslata.
  tekst: string | null;
}

export type Dogadjaj =
  | { vrsta: "zavrsio" }
  | { vrsta: "rezultat"; ishod: "gotovo"; tekst: string }
  | { vrsta: "rezultat"; ishod: "neuspjeh" }
  | { vrsta: "pokretanje_nije_uspjelo" }
  | { vrsta: "poruka_poslata" };

export interface LokalnoVrijeme {
  datum: string;
  sat: number;
  minut: number;
}

export type Radnja =
  | { vrsta: "pokreni_pisanje"; datum: string }
  | { vrsta: "posalji_nemanji"; tekst: string }
  | { vrsta: "posalji_mentoru"; tekst: string };

export interface Prelaz {
  stanje: StanjeDana;
  radnje: Radnja[];
}

export function noviDan(datum: string): StanjeDana {
  return { datum, faza: "otvoren", tekst: null };
}

function citljivDatum(datum: string): string {
  const [godina, mjesec, dan] = datum.split("-");
  return `${Number(dan)}.${Number(mjesec)}.${godina}.`;
}

function poNemanji(stanje: StanjeDana, tekst: string): Prelaz {
  return { stanje, radnje: [{ vrsta: "posalji_nemanji", tekst }] };
}

function zavrsio(stanje: StanjeDana): Prelaz {
  switch (stanje.faza) {
    case "pisanje":
      return poNemanji(stanje, "Pisanje izvještaja je već u toku.");
    case "bez_poruke":
      return poNemanji(stanje, "Izvještaj je napisan, ali poruka još nije poslata.");
    case "zatvoren":
      return poNemanji(stanje, "Izvještaj za danas je već poslat.");
    case "otvoren":
    case "neuspjeh":
      return {
        stanje: { ...stanje, faza: "pisanje" },
        radnje: [
          { vrsta: "pokreni_pisanje", datum: stanje.datum },
          { vrsta: "posalji_nemanji", tekst: "Krećem sa pisanjem izvještaja." },
        ],
      };
  }
}

// Stanje koje se ne mijenja vraća se kao isti objekat, pa Worker zna da nema šta da upiše.
export function primijeni(stanje: StanjeDana, dogadjaj: Dogadjaj, lokalno: LokalnoVrijeme): Prelaz {
  const nista = { stanje, radnje: [] };

  switch (dogadjaj.vrsta) {
    case "zavrsio":
      // "završio" uvijek važi za tekući dan, a ostali događaji za dan kom pripadaju.
      return zavrsio(stanje.datum === lokalno.datum ? stanje : noviDan(lokalno.datum));

    case "rezultat":
      if (stanje.faza !== "pisanje") return nista;
      if (dogadjaj.ishod === "neuspjeh") {
        return poNemanji(
          { ...stanje, faza: "neuspjeh" },
          `Pisanje izvještaja za ${citljivDatum(stanje.datum)} nije uspjelo. Pošalji "završio" za novi pokušaj.`,
        );
      }
      return {
        stanje: { ...stanje, faza: "bez_poruke", tekst: dogadjaj.tekst },
        radnje: [{ vrsta: "posalji_mentoru", tekst: dogadjaj.tekst }],
      };

    case "pokretanje_nije_uspjelo":
      if (stanje.faza !== "pisanje") return nista;
      return poNemanji(
        { ...stanje, faza: "neuspjeh" },
        `Pisanje izvještaja za ${citljivDatum(stanje.datum)} nije pokrenuto. Pošalji "završio" za novi pokušaj.`,
      );

    case "poruka_poslata":
      if (stanje.faza !== "bez_poruke") return nista;
      return { stanje: { ...stanje, faza: "zatvoren", tekst: null }, radnje: [] };
  }
}
