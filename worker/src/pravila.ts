// Pravila dana: bez mreže, baze i sata. Ostatak Workera učita stanje, pozove primijeni(),
// upiše novo stanje i izvrši radnje.

export type Faza = "otvoren" | "pisanje" | "bez_poruke" | "neuspjeh" | "zatvoren";

export interface StanjeDana {
  datum: string;
  faza: Faza;
  // Tekst poruke, samo dok je izvještaj završen, a poruka nije poslata.
  tekst: string | null;
  // Trenutak kad je pisanje pokrenuto ili kad je slanje poruke posljednji put pokušano.
  uTokuOd: number | null;
  // Cron je već pokrenuo pisanje za ovaj dan, pa ga više ne pokreće.
  pokusaj23: boolean;
  // Nemanja je već upozoren da poruka nije poslata.
  upozoren: boolean;
}

export type Dogadjaj =
  | { vrsta: "zavrsio" }
  | { vrsta: "cron" }
  | { vrsta: "rezultat"; ishod: "gotovo"; tekst: string }
  | { vrsta: "rezultat"; ishod: "neuspjeh" }
  | { vrsta: "pokretanje_nije_uspjelo" }
  | { vrsta: "poruka_poslata" }
  | { vrsta: "slanje_nije_uspjelo" };

export interface LokalnoVrijeme {
  datum: string;
  sat: number;
  minut: number;
  // Rokovi se računaju po ovome, jer lokalni sat skače pri prelasku na ljetnje i zimsko vrijeme.
  trenutak: number;
}

export type Radnja =
  | { vrsta: "pokreni_pisanje"; datum: string }
  | { vrsta: "posalji_nemanji"; tekst: string }
  | { vrsta: "posalji_mentoru"; tekst: string };

export interface Prelaz {
  stanje: StanjeDana;
  radnje: Radnja[];
}

const SAT_SLANJA = 23;
const ROK_PISANJA_MS = 30 * 60_000;
// Kraće od razmaka između cron-ova, a duže od roka poziva Telegrama. Cron tako ne šalje poruku
// koju neko baš tada šalje, a ipak ponavlja neuspjelo slanje već sljedeći put.
const RAZMAK_SLANJA_MS = 60_000;

const FORMAT_VREMENA = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Belgrade",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function lokalnoVrijeme(sada: Date): LokalnoVrijeme {
  const dijelovi = Object.fromEntries(FORMAT_VREMENA.formatToParts(sada).map((dio) => [dio.type, dio.value]));
  return {
    datum: `${dijelovi.year}-${dijelovi.month}-${dijelovi.day}`,
    sat: Number(dijelovi.hour),
    minut: Number(dijelovi.minute),
    trenutak: sada.getTime(),
  };
}

export function noviDan(datum: string): StanjeDana {
  return { datum, faza: "otvoren", tekst: null, uTokuOd: null, pokusaj23: false, upozoren: false };
}

function citljivDatum(datum: string): string {
  const [godina, mjesec, dan] = datum.split("-");
  return `${Number(dan)}.${Number(mjesec)}.${godina}.`;
}

function poNemanji(stanje: StanjeDana, tekst: string): Prelaz {
  return { stanje, radnje: [{ vrsta: "posalji_nemanji", tekst }] };
}

// Mentor ne dobija ništa, pa ni "nema rada": rad možda postoji, a izvještaj nije napisan.
function neuspjeh(stanje: StanjeDana, opis: string): Prelaz {
  return poNemanji(
    { ...stanje, faza: "neuspjeh", uTokuOd: null },
    `Pisanje izvještaja za ${citljivDatum(stanje.datum)} ${opis}. Pošalji "završio" za novi pokušaj.`,
  );
}

function zavrsio(stanje: StanjeDana, lokalno: LokalnoVrijeme): Prelaz {
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
        stanje: { ...stanje, faza: "pisanje", uTokuOd: lokalno.trenutak },
        radnje: [
          { vrsta: "pokreni_pisanje", datum: stanje.datum },
          { vrsta: "posalji_nemanji", tekst: "Krećem sa pisanjem izvještaja." },
        ],
      };
  }
}

function cron(stanje: StanjeDana, lokalno: LokalnoVrijeme): Prelaz {
  const nista = { stanje, radnje: [] };
  const proslo = lokalno.trenutak - (stanje.uTokuOd ?? 0);

  switch (stanje.faza) {
    case "pisanje":
      return proslo < ROK_PISANJA_MS ? nista : neuspjeh(stanje, "se nije javilo u roku");
    case "bez_poruke":
      if (stanje.tekst === null || proslo < RAZMAK_SLANJA_MS) return nista;
      return {
        stanje: { ...stanje, uTokuOd: lokalno.trenutak },
        radnje: [{ vrsta: "posalji_mentoru", tekst: stanje.tekst }],
      };
    case "otvoren":
    case "neuspjeh":
      // Cijeli sat, a ne samo 23:00, jer jedan cron može da izostane. Oznaka čuva da krene jednom.
      if (stanje.datum !== lokalno.datum || lokalno.sat !== SAT_SLANJA || stanje.pokusaj23) return nista;
      return {
        stanje: { ...stanje, faza: "pisanje", uTokuOd: lokalno.trenutak, pokusaj23: true },
        radnje: [{ vrsta: "pokreni_pisanje", datum: stanje.datum }],
      };
    case "zatvoren":
      return nista;
  }
}

function slanjeNijeUspjelo(stanje: StanjeDana, lokalno: LokalnoVrijeme): Prelaz {
  const prijeSlanja = stanje.datum === lokalno.datum && lokalno.sat < SAT_SLANJA;
  if (stanje.faza !== "bez_poruke" || stanje.upozoren || prijeSlanja) return { stanje, radnje: [] };
  return poNemanji(
    { ...stanje, upozoren: true },
    `Poruka o izvještaju za ${citljivDatum(stanje.datum)} nije poslata. Pokušavam ponovo svakih 5 minuta.`,
  );
}

// Stanje koje se ne mijenja vraća se kao isti objekat, pa Worker zna da nema šta da upiše.
export function primijeni(stanje: StanjeDana, dogadjaj: Dogadjaj, lokalno: LokalnoVrijeme): Prelaz {
  const nista = { stanje, radnje: [] };

  switch (dogadjaj.vrsta) {
    case "zavrsio":
      // "završio" uvijek važi za tekući dan, a ostali događaji za dan kom pripadaju.
      return zavrsio(stanje.datum === lokalno.datum ? stanje : noviDan(lokalno.datum), lokalno);

    case "cron":
      return cron(stanje, lokalno);

    case "rezultat":
      if (stanje.faza !== "pisanje") return nista;
      if (dogadjaj.ishod === "neuspjeh") return neuspjeh(stanje, "nije uspjelo");
      return {
        stanje: { ...stanje, faza: "bez_poruke", tekst: dogadjaj.tekst, uTokuOd: lokalno.trenutak },
        radnje: [{ vrsta: "posalji_mentoru", tekst: dogadjaj.tekst }],
      };

    case "pokretanje_nije_uspjelo":
      if (stanje.faza !== "pisanje") return nista;
      return neuspjeh(stanje, "nije pokrenuto");

    case "poruka_poslata":
      if (stanje.faza !== "bez_poruke") return nista;
      return { stanje: { ...stanje, faza: "zatvoren", tekst: null, uTokuOd: null }, radnje: [] };

    case "slanje_nije_uspjelo":
      return slanjeNijeUspjelo(stanje, lokalno);
  }
}
