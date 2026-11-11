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
  // Koliko je puta agent sam pokrenuo pisanje: 1 poslije 40 minuta bez rada, 2 u 1:00 (ADR 0008).
  samostalniPokusaji: number;
  // Nemanja je već upozoren da poruka nije poslata.
  upozoren: boolean;
  // Trenutak posljednjeg javljanja hooka tog dana, po satu Workera (ADR 0005).
  posljednjaAktivnost: number | null;
  // Najkasniji rad koji je javila provjera: svjež rad ili signal rada. Nikad nije iz budućnosti.
  radIzProvjere: number | null;
  // Trenutak pokretanja provjere koja se još nije javila. Ujedno je i oznaka te provjere.
  provjeraOd: number | null;
  // Trenutak slanja pitanja bez odgovora. Nova aktivnost ga ne briše, nego se poredi sa njim.
  pitanjeOd: number | null;
  // Trenutak posljednjeg odgovora "Nije".
  nijeOd: number | null;
  // Prije ovog trenutka nema nove provjere, jer prethodna nije uspjela ili pitanje nije poslato.
  odlozenoDo: number | null;
  // Nemanja je poslao "odloži": izvještaj ide na "završio" ili u 1:00 (ADR 0008).
  odlozenoSlanje: boolean;
}

export type OdgovorNaPitanje = "jesam" | "nije";

export type Dogadjaj =
  | { vrsta: "zavrsio" }
  | { vrsta: "odlozi" }
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
  // Bez zvuka kad je kalendarski datum slanja poslije datuma radnog dana, da ne probudi mentora.
  | { vrsta: "posalji_mentoru"; tekst: string; bezZvuka: boolean }
  | { vrsta: "pokreni_provjeru"; datum: string; oznaka: string }
  | { vrsta: "posalji_pitanje"; datum: string; tekst: string }
  | { vrsta: "odgovori_na_dugme"; id: string; tekst?: string };

export interface Prelaz {
  stanje: StanjeDana;
  radnje: Radnja[];
}

const SAT_SLANJA = 23;
const KRAJ_RADNOG_DANA_SAT = 1;
// Do ovog sata cron gleda i jučerašnji radni dan, zbog pokušaja iz 1:00.
export const KRAJ_DRUGOG_POKUSAJA_SAT = 2;
const POCETAK_SAMOSTALNOG_MINUT = 23 * 60 + 40;
const PAUZA_SAMOSTALNOG_MS = 40 * 60_000;
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

// Datum pomjeren za dati broj dana. Podne po UTC-u ne zavisi od ljetnjeg i zimskog vremena.
export function pomjerenDatum(datum: string, dana: number): string {
  const podne = new Date(`${datum}T12:00:00Z`);
  podne.setUTCDate(podne.getUTCDate() + dana);
  return podne.toISOString().slice(0, 10);
}

// Od 0:00 do 1:00 radni dan je jučerašnji dok nije zatvoren, a inače tekući kalendarski (ADR 0008).
export function datumRadnogDana(lokalno: LokalnoVrijeme, fazaJuce: Faza): string {
  if (lokalno.sat < KRAJ_RADNOG_DANA_SAT && fazaJuce !== "zatvoren") return pomjerenDatum(lokalno.datum, -1);
  return lokalno.datum;
}

function jeRadniDan(stanje: StanjeDana, lokalno: LokalnoVrijeme): boolean {
  if (stanje.datum === lokalno.datum) return true;
  return stanje.datum === pomjerenDatum(lokalno.datum, -1) && datumRadnogDana(lokalno, stanje.faza) === stanje.datum;
}

export function noviDan(datum: string): StanjeDana {
  return {
    datum,
    faza: "otvoren",
    tekst: null,
    uTokuOd: null,
    samostalniPokusaji: 0,
    upozoren: false,
    posljednjaAktivnost: null,
    radIzProvjere: null,
    provjeraOd: null,
    pitanjeOd: null,
    nijeOd: null,
    odlozenoDo: null,
    odlozenoSlanje: false,
  };
}

function citljivDatum(datum: string): string {
  const [godina, mjesec, dan] = datum.split("-");
  return `${Number(dan)}.${Number(mjesec)}.${godina}.`;
}

// Dio radnog dana po lokalnom satu. "samostalno" traje od 23:00 do 1:00, a "drugi_pokusaj" od 1:00
// do 2:00, cijeli sat, jer jedan cron može da izostane.
type DioRadnogDana = "pitanja" | "samostalno" | "drugi_pokusaj" | null;

function dioRadnogDana(stanje: StanjeDana, lokalno: LokalnoVrijeme): DioRadnogDana {
  const minut = lokalno.sat * 60 + lokalno.minut;
  if (lokalno.datum === stanje.datum) {
    if (minut >= POCETAK_PITANJA_MINUT && minut <= KRAJ_PITANJA_MINUT) return "pitanja";
    return lokalno.sat >= SAT_SLANJA ? "samostalno" : null;
  }
  if (lokalno.datum !== pomjerenDatum(stanje.datum, 1)) return null;
  if (lokalno.sat < KRAJ_RADNOG_DANA_SAT) return "samostalno";
  return lokalno.sat < KRAJ_DRUGOG_POKUSAJA_SAT ? "drugi_pokusaj" : null;
}

// Provjera u toku se odbacuje, jer njen rezultat ne smije da odluči o danu koji je već u pisanju.
function pokreniPisanje(stanje: StanjeDana, lokalno: LokalnoVrijeme, izmjene: Partial<StanjeDana> = {}): Prelaz {
  return {
    stanje: { ...stanje, ...izmjene, faza: "pisanje", uTokuOd: lokalno.trenutak, provjeraOd: null },
    radnje: [{ vrsta: "pokreni_pisanje", datum: stanje.datum }],
  };
}

function porukaMentoru(stanje: StanjeDana, tekst: string, lokalno: LokalnoVrijeme): Radnja {
  return { vrsta: "posalji_mentoru", tekst, bezZvuka: lokalno.datum > stanje.datum };
}

function poNemanji(stanje: StanjeDana, tekst: string): Prelaz {
  return { stanje, radnje: [{ vrsta: "posalji_nemanji", tekst }] };
}

// Mentor ne dobija ništa, pa ni "nema rada": rad možda postoji, a izvještaj nije napisan.
// Kad radni dan prođe, "završio" bi pokrenulo novi dan, pa se ne nudi. Pisanje koje padne od 1:00
// je bilo u toku u 1:00 ili je to pokušaj iz 1:00, pa poslije njega nema samostalnog pokušaja.
function neuspjeh(stanje: StanjeDana, opis: string, lokalno: LokalnoVrijeme): Prelaz {
  const poslije1 = dioRadnogDana(stanje, lokalno) === "drugi_pokusaj";
  const dalje = jeRadniDan(stanje, lokalno)
    ? 'Pošalji "završio" za novi pokušaj.'
    : "Rad ulazi u sljedeći izvještaj.";
  return poNemanji(
    { ...stanje, faza: "neuspjeh", uTokuOd: null, ...(poslije1 ? { samostalniPokusaji: 2 } : {}) },
    `Pisanje izvještaja za ${citljivDatum(stanje.datum)} ${opis}. ${dalje}`,
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
    case "neuspjeh": {
      const prelaz = pokreniPisanje(stanje, lokalno);
      return {
        stanje: prelaz.stanje,
        radnje: [...prelaz.radnje, { vrsta: "posalji_nemanji", tekst: "Krećem sa pisanjem izvještaja." }],
      };
    }
  }
}

const POTVRDA_ODLAGANJA = "U redu, čekam tvoje ‚završio', najkasnije do 1:00.";

// Pisanje, poruka bez slanja i zatvoren dan dobijaju isti odgovor kao na "završio".
function odlozi(stanje: StanjeDana, lokalno: LokalnoVrijeme): Prelaz {
  if (stanje.faza !== "otvoren" && stanje.faza !== "neuspjeh") return zavrsio(stanje, lokalno);
  // Provjera u toku se odbacuje, da njen rezultat ne pošalje pitanje ni ne pokrene pisanje.
  const odlozeno = stanje.odlozenoSlanje ? stanje : { ...stanje, odlozenoSlanje: true, provjeraOd: null };
  return poNemanji(odlozeno, POTVRDA_ODLAGANJA);
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
  return Math.max(rok, (stanje.radIzProvjere ?? 0) + PAUZA_MS, stanje.odlozenoDo ?? 0);
}

// Poslije 23:00: T je posljednji rad koji Worker zna, a provjera kreće najranije u 23:40 i u T + 40.
// Dan bez ijednog signala iz hooka i bez rada iz provjere ima T = 0, pa mu je prva provjera u 23:40.
function rokSamostalneProvjere(stanje: StanjeDana): number {
  const posljednjiRad = Math.max(stanje.posljednjaAktivnost ?? 0, stanje.radIzProvjere ?? 0);
  return Math.max(posljednjiRad + PAUZA_SAMOSTALNOG_MS, stanje.odlozenoDo ?? 0);
}

function pokreniProvjeru(stanje: StanjeDana, lokalno: LokalnoVrijeme): Prelaz {
  return {
    stanje: { ...stanje, provjeraOd: lokalno.trenutak },
    radnje: [{ vrsta: "pokreni_provjeru", datum: stanje.datum, oznaka: String(lokalno.trenutak) }],
  };
}

function cronProvjere(stanje: StanjeDana, lokalno: LokalnoVrijeme, dio: DioRadnogDana): Prelaz {
  const nista = { stanje, radnje: [] };
  // Odloženo slanje nema ni pitanja ni samostalnog slanja, nego samo pokušaj iz 1:00.
  if (stanje.odlozenoSlanje) return nista;
  if (stanje.provjeraOd !== null) {
    if (lokalno.trenutak - stanje.provjeraOd < ROK_PROVJERE_MS) return nista;
    return { stanje: provjeraPala(stanje, lokalno), radnje: [] };
  }

  if (dio === "samostalno") {
    // Poslije neuspjeha prvog samostalnog pokušaja sljedeći je tek u 1:00.
    const prerano = lokalno.datum === stanje.datum && lokalno.sat * 60 + lokalno.minut < POCETAK_SAMOSTALNOG_MINUT;
    if (stanje.samostalniPokusaji > 0 || prerano || lokalno.trenutak < rokSamostalneProvjere(stanje)) return nista;
    return pokreniProvjeru(stanje, lokalno);
  }

  // Poslije neuspjeha tog dana nema novih pitanja.
  if (dio !== "pitanja" || stanje.faza !== "otvoren") return nista;
  const rok = rokProvjere(stanje);
  if (rok === null || lokalno.trenutak < rok) return nista;
  return pokreniProvjeru(stanje, lokalno);
}

function rezultatProvjere(
  stanje: StanjeDana,
  dogadjaj: Extract<Dogadjaj, { vrsta: "provjera" }>,
  lokalno: LokalnoVrijeme,
): Prelaz {
  const nista = { stanje, radnje: [] };
  // Javljanje stare provjere ne smije da odluči umjesto one koja je sad u toku.
  if (stanje.provjeraOd === null || String(stanje.provjeraOd) !== dogadjaj.oznaka) return nista;
  if (stanje.faza !== "otvoren" && stanje.faza !== "neuspjeh") return nista;
  // Rok važi i kad cron još nije stigao. Zato pitanje nikad ne krene poslije 22:45.
  const zakasnila = lokalno.trenutak - stanje.provjeraOd >= ROK_PROVJERE_MS;
  if (dogadjaj.ishod === "neuspjeh" || zakasnila) return { stanje: provjeraPala(stanje, lokalno), radnje: [] };

  // Provjera prije pitanja kreće najkasnije u 22:30 i zakasni u 22:45, a samostalna kreće od 23:40.
  // Zato javljanje koje nije zakasnilo i stigne od 23:00 pripada samostalnoj provjeri.
  const dio = dioRadnogDana(stanje, lokalno);
  const samostalno = dio === "samostalno" || dio === "drugi_pokusaj";
  const pauza = samostalno ? PAUZA_SAMOSTALNOG_MS : PAUZA_MS;
  let gotova: StanjeDana = { ...stanje, provjeraOd: null };
  if (dogadjaj.ishod === "svjez-rad") {
    // Vrijeme iz budućnosti ne odlaže duže od pauze.
    const rad = Math.min(dogadjaj.vrijeme, lokalno.trenutak);
    gotova = { ...gotova, radIzProvjere: Math.max(stanje.radIzProvjere ?? 0, rad) };
    // Prije pitanja se računa samo rad mlađi od pauze, inače bi jutarnji commit zauvijek držao pitanje.
    if (rad + pauza > lokalno.trenutak) return { stanje: gotova, radnje: [] };
  }

  // Aktivnost dok je provjera trajala znači da pauze više nema, pa cron opet čeka cijelu pauzu.
  if ((stanje.posljednjaAktivnost ?? 0) > stanje.provjeraOd) return { stanje: gotova, radnje: [] };
  // Javljanje poslije 1:00, prije crona, pokreće pokušaj iz 1:00, pa trećeg nema.
  if (samostalno) return pokreniPisanje(gotova, lokalno, { samostalniPokusaji: dio === "drugi_pokusaj" ? 2 : 1 });
  if (stanje.faza !== "otvoren") return { stanje: gotova, radnje: [] };
  return {
    stanje: { ...gotova, pitanjeOd: lokalno.trenutak },
    radnje: [{ vrsta: "posalji_pitanje", datum: stanje.datum, tekst: "Da li si završio za danas?" }],
  };
}

function dugme(stanje: StanjeDana, dogadjaj: Extract<Dogadjaj, { vrsta: "dugme" }>, lokalno: LokalnoVrijeme): Prelaz {
  const { id } = dogadjaj;
  // Dugme važi za radni dan u kom je pitanje poslato, pa i poslije ponoći, dok taj dan traje.
  if (dogadjaj.datum !== stanje.datum || !jeRadniDan(stanje, lokalno)) {
    return { stanje, radnje: [{ vrsta: "odgovori_na_dugme", id, tekst: PITANJE_ISTEKLO }] };
  }
  if (dogadjaj.odgovor === "jesam") {
    // Telegram vrti znak na dugmetu dok ne dobije odgovor, pa on ide prije ostalih radnji.
    const prelaz = zavrsio(stanje, lokalno);
    return { stanje: prelaz.stanje, radnje: [{ vrsta: "odgovori_na_dugme", id }, ...prelaz.radnje] };
  }
  // Poslije "odloži" novog pitanja nema, pa se ni ne obećava.
  if (stanje.faza !== "otvoren" || stanje.odlozenoSlanje) {
    return { stanje, radnje: [{ vrsta: "odgovori_na_dugme", id, tekst: "U redu." }] };
  }
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
      return proslo < ROK_PISANJA_MS ? nista : neuspjeh(stanje, "se nije javilo u roku", lokalno);
    case "bez_poruke":
      if (stanje.tekst === null || proslo < RAZMAK_SLANJA_MS) return nista;
      return {
        stanje: { ...stanje, uTokuOd: lokalno.trenutak },
        radnje: [porukaMentoru(stanje, stanje.tekst, lokalno)],
      };
    case "otvoren":
    case "neuspjeh": {
      // U 1:00 pisanje kreće bez provjere, i kad prvi samostalni pokušaj nije ni krenuo.
      const dio = dioRadnogDana(stanje, lokalno);
      if (dio === "drugi_pokusaj") {
        return stanje.samostalniPokusaji < 2 ? pokreniPisanje(stanje, lokalno, { samostalniPokusaji: 2 }) : nista;
      }
      return cronProvjere(stanje, lokalno, dio);
    }
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
      // "završio" uvijek važi za radni dan, a ostali događaji za dan kom pripadaju.
      return zavrsio(jeRadniDan(stanje, lokalno) ? stanje : noviDan(lokalno.datum), lokalno);

    case "odlozi":
      return odlozi(jeRadniDan(stanje, lokalno) ? stanje : noviDan(lokalno.datum), lokalno);

    case "cron":
      return cron(stanje, lokalno);

    case "aktivnost":
      // Samo vrijeme, u svakoj fazi: ni zatvoren dan se ne otvara, ni pisanje se ne prekida.
      return { stanje: { ...stanje, posljednjaAktivnost: lokalno.trenutak }, radnje: [] };

    case "rezultat":
      if (stanje.faza !== "pisanje") return nista;
      if (dogadjaj.ishod === "neuspjeh") return neuspjeh(stanje, "nije uspjelo", lokalno);
      return {
        stanje: { ...stanje, faza: "bez_poruke", tekst: dogadjaj.tekst, uTokuOd: lokalno.trenutak },
        radnje: [porukaMentoru(stanje, dogadjaj.tekst, lokalno)],
      };

    case "pokretanje_nije_uspjelo":
      if (stanje.faza !== "pisanje") return nista;
      return neuspjeh(stanje, "nije pokrenuto", lokalno);

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
