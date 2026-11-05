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
  // Trenutak posljednjeg javljanja hooka tog dana, po satu Workera (ADR 0005).
  posljednjaAktivnost: number | null;
  // Trenutak pokretanja provjere koja se još nije javila. Ujedno je i oznaka te provjere.
  provjeraOd: number | null;
  // Trenutak slanja pitanja bez odgovora. Nova aktivnost ga ne briše, nego se poredi sa njim.
  pitanjeOd: number | null;
  // Trenutak posljednjeg odgovora "Nije".
  nijeOd: number | null;
  // Prije ovog trenutka nema nove provjere: neuspjela provjera ili svjež rad.
  odlozenoDo: number | null;
}

export type OdgovorNaPitanje = "jesam" | "nije";

export type Dogadjaj =
  | { vrsta: "zavrsio" }
  | { vrsta: "cron" }
  | { vrsta: "aktivnost" }
  | { vrsta: "rezultat"; ishod: "gotovo"; tekst: string }
  | { vrsta: "rezultat"; ishod: "neuspjeh" }
  | { vrsta: "pokretanje_nije_uspjelo" }
  | { vrsta: "poruka_poslata" }
  | { vrsta: "slanje_nije_uspjelo" }
  | { vrsta: "provjera"; oznaka: string; ishod: "neuspjeh" | "nema-svjezeg-rada" }
  | { vrsta: "provjera"; oznaka: string; ishod: "svjez-rad"; vrijeme: number }
  | { vrsta: "provjera_nije_pokrenuta" }
  | { vrsta: "pitanje_nije_poslato" }
  // "datum" je dan kad je pitanje poslato, a "id" je ono na šta Telegram čeka odgovor.
  | { vrsta: "dugme"; id: string; datum: string; odgovor: OdgovorNaPitanje };

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
  | { vrsta: "posalji_mentoru"; tekst: string }
  | { vrsta: "pokreni_provjeru"; datum: string; oznaka: string }
  | { vrsta: "posalji_pitanje"; datum: string; tekst: string }
  | { vrsta: "odgovori_na_dugme"; id: string; tekst?: string };

export interface Prelaz {
  stanje: StanjeDana;
  radnje: Radnja[];
}

const SAT_SLANJA = 23;
const ROK_PISANJA_MS = 30 * 60_000;
// Kraće od razmaka između cron-ova, a duže od roka poziva Telegrama. Cron tako ne šalje poruku
// koju neko baš tada šalje, a ipak ponavlja neuspjelo slanje već sljedeći put.
const RAZMAK_SLANJA_MS = 60_000;
const POCETAK_PITANJA_MINUT = 16 * 60;
const KRAJ_PITANJA_MINUT = 22 * 60 + 30;
const PAUZA_MS = 60 * 60_000;
const POSLIJE_NIJE_MS = 30 * 60_000;
const ROK_PROVJERE_MS = 15 * 60_000;
const PONOVO_PROVJERA_MS = 30 * 60_000;

export const PITANJE_ISTEKLO = "Pitanje je isteklo.";

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
  return {
    datum,
    faza: "otvoren",
    tekst: null,
    uTokuOd: null,
    pokusaj23: false,
    upozoren: false,
    posljednjaAktivnost: null,
    provjeraOd: null,
    pitanjeOd: null,
    nijeOd: null,
    odlozenoDo: null,
  };
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

function provjeraPala(stanje: StanjeDana, lokalno: LokalnoVrijeme): StanjeDana {
  return { ...stanje, provjeraOd: null, odlozenoDo: lokalno.trenutak + PONOVO_PROVJERA_MS };
}

// Najraniji trenutak za novu provjeru, a null ako provjere nema: dan bez signala iz hooka,
// ili pitanje bez odgovora poslije kog nije bilo aktivnosti.
function rokProvjere(stanje: StanjeDana): number | null {
  const aktivnost = stanje.posljednjaAktivnost;
  if (aktivnost === null) return null;
  if (stanje.pitanjeOd !== null && aktivnost <= stanje.pitanjeOd) return null;
  const rok =
    stanje.nijeOd !== null && aktivnost <= stanje.nijeOd ? stanje.nijeOd + POSLIJE_NIJE_MS : aktivnost + PAUZA_MS;
  return Math.max(rok, stanje.odlozenoDo ?? 0);
}

function cronProvjere(stanje: StanjeDana, lokalno: LokalnoVrijeme): Prelaz {
  const nista = { stanje, radnje: [] };
  if (stanje.provjeraOd !== null) {
    if (lokalno.trenutak - stanje.provjeraOd < ROK_PROVJERE_MS) return nista;
    return { stanje: provjeraPala(stanje, lokalno), radnje: [] };
  }

  const minut = lokalno.sat * 60 + lokalno.minut;
  if (stanje.datum !== lokalno.datum || minut < POCETAK_PITANJA_MINUT || minut > KRAJ_PITANJA_MINUT) return nista;
  const rok = rokProvjere(stanje);
  if (rok === null || lokalno.trenutak < rok) return nista;
  return {
    stanje: { ...stanje, provjeraOd: lokalno.trenutak },
    radnje: [{ vrsta: "pokreni_provjeru", datum: stanje.datum, oznaka: String(lokalno.trenutak) }],
  };
}

function rezultatProvjere(
  stanje: StanjeDana,
  dogadjaj: Extract<Dogadjaj, { vrsta: "provjera" }>,
  lokalno: LokalnoVrijeme,
): Prelaz {
  // Javljanje stare provjere ne smije da odluči umjesto one koja je sad u toku.
  if (stanje.faza !== "otvoren" || stanje.provjeraOd === null || String(stanje.provjeraOd) !== dogadjaj.oznaka) {
    return { stanje, radnje: [] };
  }
  // Rok važi i kad cron još nije stigao. Zato pitanje nikad ne krene poslije 22:45.
  const zakasnila = lokalno.trenutak - stanje.provjeraOd >= ROK_PROVJERE_MS;
  if (dogadjaj.ishod === "neuspjeh" || zakasnila) return { stanje: provjeraPala(stanje, lokalno), radnje: [] };

  const gotova = { ...stanje, provjeraOd: null };
  if (dogadjaj.ishod === "svjez-rad") {
    // Period izvještaja traje cijeli dan, pa rad stariji od pauze više ne odlaže pitanje.
    // Inače bi jutarnji commit zauvijek držao pitanje. Vrijeme iz budućnosti ne odlaže duže od pauze.
    const odlozeno = Math.min(dogadjaj.vrijeme, lokalno.trenutak) + PAUZA_MS;
    if (odlozeno > lokalno.trenutak) {
      return { stanje: { ...gotova, odlozenoDo: Math.max(stanje.odlozenoDo ?? 0, odlozeno) }, radnje: [] };
    }
  }

  // Aktivnost dok je provjera trajala znači da pauze više nema, pa cron čeka novih 60 minuta.
  if ((stanje.posljednjaAktivnost ?? 0) > stanje.provjeraOd) return { stanje: gotova, radnje: [] };
  return {
    stanje: { ...gotova, pitanjeOd: lokalno.trenutak },
    radnje: [{ vrsta: "posalji_pitanje", datum: stanje.datum, tekst: "Da li si završio za danas?" }],
  };
}

function dugme(stanje: StanjeDana, dogadjaj: Extract<Dogadjaj, { vrsta: "dugme" }>, lokalno: LokalnoVrijeme): Prelaz {
  const { id } = dogadjaj;
  if (dogadjaj.datum !== lokalno.datum || stanje.datum !== lokalno.datum) {
    return { stanje, radnje: [{ vrsta: "odgovori_na_dugme", id, tekst: PITANJE_ISTEKLO }] };
  }
  if (dogadjaj.odgovor === "jesam") {
    // Telegram vrti znak na dugmetu dok ne dobije odgovor, pa on ide prije ostalih radnji.
    const prelaz = zavrsio(stanje, lokalno);
    return { stanje: prelaz.stanje, radnje: [{ vrsta: "odgovori_na_dugme", id }, ...prelaz.radnje] };
  }
  if (stanje.faza !== "otvoren") return { stanje, radnje: [{ vrsta: "odgovori_na_dugme", id, tekst: "U redu." }] };
  return {
    // Provjera u toku se odbacuje, da pitanje ne stigne odmah poslije "Nije".
    stanje: { ...stanje, pitanjeOd: null, nijeOd: lokalno.trenutak, provjeraOd: null },
    radnje: [{ vrsta: "odgovori_na_dugme", id, tekst: "U redu, pitaću te kasnije." }],
  };
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
      if (stanje.datum === lokalno.datum && lokalno.sat === SAT_SLANJA && !stanje.pokusaj23) {
        return {
          stanje: { ...stanje, faza: "pisanje", uTokuOd: lokalno.trenutak, pokusaj23: true },
          radnje: [{ vrsta: "pokreni_pisanje", datum: stanje.datum }],
        };
      }
      // Poslije neuspjeha tog dana nema novih pitanja.
      return stanje.faza === "otvoren" ? cronProvjere(stanje, lokalno) : nista;
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

    case "aktivnost":
      // Samo vrijeme, u svakoj fazi: ni zatvoren dan se ne otvara, ni pisanje se ne prekida.
      return { stanje: { ...stanje, posljednjaAktivnost: lokalno.trenutak }, radnje: [] };

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

    case "provjera":
      return rezultatProvjere(stanje, dogadjaj, lokalno);

    case "provjera_nije_pokrenuta":
      if (stanje.provjeraOd === null) return nista;
      return { stanje: provjeraPala(stanje, lokalno), radnje: [] };

    case "pitanje_nije_poslato":
      // Pitanje koje nije stiglo ne čeka odgovor, pa ponovo ide kroz provjeru.
      if (stanje.pitanjeOd === null) return nista;
      return { stanje: { ...stanje, pitanjeOd: null, odlozenoDo: lokalno.trenutak + PONOVO_PROVJERA_MS }, radnje: [] };

    case "dugme":
      return dugme(stanje, dogadjaj, lokalno);
  }
}
