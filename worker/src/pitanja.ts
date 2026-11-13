// Pitanja o radu (ADR 0007): bez mreže, baze i sata. Worker drži red u D1, a ovdje je samo ono
// što o poruci, redu i roku može da se odluči bez njih.

export type Chat = "mentor" | "nemanja";
export type IshodOdgovora = "odgovor" | "odbijeno" | "neuspjeh";
export type Persiranje = "da" | "ne" | "bez_promjene";

// Worker čeka odgovor 5 minuta od pokretanja workflow-a.
export const ROK_ODGOVORA_MS = 5 * 60_000;

// Mentor ima 15 pitanja po kalendarskom danu, po zoni Europe/Belgrade. Nemanjina pitanja nemaju limit.
export const LIMIT_MENTORA = 15;

export const RAZMISLJAM = "Razmišljam, odgovor stiže za minut-dva.";
export const SAMO_TEKST = "Mogu da odgovorim samo na pitanja napisana tekstom.";

// Mentor ovo dobija jednom, na prvi cron poslije uključivanja pitanja mentora.
export const UVODNA_PORUKA =
  "Od danas možeš i da me pitaš šta je Nemanja radio, npr. „Šta je Nemanja radio juče?” ili „Kako je uradio pitanja o radu?”. " +
  "Odgovaram iz izvještaja, bilješki i GitHub-a za posljednjih 30 dana, obično za minut-dva. " +
  "Dnevno možeš da postaviš do 15 pitanja.";

// Stalne poruke koje se obraćaju onome ko pita, na "ti" i na "vi".
export type StalnaPoruka = "odbijeno" | "neuspjeh" | "limit";

const STALNE_PORUKE: Record<StalnaPoruka, { ti: string; vi: string }> = {
  odbijeno: {
    ti: "Ovo pitanje ne mogu da obradim jer sadrži nešto što liči na lozinku, ključ ili putanju. Napiši ga bez toga.",
    vi: "Ovo pitanje ne mogu da obradim jer sadrži nešto što liči na lozinku, ključ ili putanju. Napišite ga bez toga.",
  },
  neuspjeh: {
    ti: "Trenutno ne mogu da odgovorim, pokušaj ponovo za nekoliko minuta.",
    vi: "Trenutno ne mogu da odgovorim, pokušajte ponovo za nekoliko minuta.",
  },
  limit: {
    ti: "Za danas je potrošen dnevni broj pitanja. Možeš ponovo sutra.",
    vi: "Za danas je potrošen dnevni broj pitanja. Možete ponovo sutra.",
  },
};

export function stalnaPoruka(poruka: StalnaPoruka, persiran: boolean): string {
  return persiran ? STALNE_PORUKE[poruka].vi : STALNE_PORUKE[poruka].ti;
}

export const ODBIJENO = stalnaPoruka("odbijeno", false);
export const NEUSPJEH = stalnaPoruka("neuspjeh", false);

export type Komanda = "zavrsio" | "odlozi";

export type VrstaPoruke =
  | { vrsta: "komanda"; komanda: Komanda }
  | { vrsta: "pitanje"; tekst: string }
  | { vrsta: "bez_teksta" };

const KOMANDE: Record<string, Komanda> = {
  "završio": "zavrsio",
  zavrsio: "zavrsio",
  "odloži": "odlozi",
  odlozi: "odlozi",
};

// Sa Nemanjinog chata su komande samo "završio" i "odloži", bez obzira na velika slova, razmake
// oko riječi i kvačicu. Sve ostalo što ima tekst je pitanje o radu.
export function vrstaPoruke(tekst: unknown): VrstaPoruke {
  if (typeof tekst !== "string" || !tekst.trim()) return { vrsta: "bez_teksta" };
  const poruka = tekst.trim();
  const komanda = poruka.toLowerCase();
  if (Object.hasOwn(KOMANDE, komanda)) return { vrsta: "komanda", komanda: KOMANDE[komanda] };
  return { vrsta: "pitanje", tekst: poruka };
}

// Poruke koje su se nakupile u redu idu kao jedno pitanje, redom kojim su stigle.
export function spojenoPitanje(poruke: string[]): string {
  return poruke.join("\n");
}

// Odgovor stigao tačno na rok je zakasnio, isto kao i pokretanje koje je tada još u toku.
export function istekao(pokrenuto: number, sada: number): boolean {
  return sada - pokrenuto >= ROK_ODGOVORA_MS;
}

// Šta chat pokretanja dobija za javljanje iz Actions.
export function porukaZaChat(ishod: IshodOdgovora, tekst: string, persiran: boolean): string {
  if (ishod === "odgovor") return tekst;
  return stalnaPoruka(ishod, persiran);
}

// Upisuje se samo "da" ili "ne". Za "bez_promjene" ostaje ono što je chat već imao.
export function novoPersiranje(persiranje: Persiranje): boolean | null {
  return persiranje === "bez_promjene" ? null : persiranje === "da";
}

// Broje se uspješni odgovori tog dana i pokretanje koje čeka ili je u toku. Nova poruka ide u
// pokretanje koje čeka: postojeće, ako već ima poruka u redu, ili novo. Poruke spojene u jedno
// pitanje se tako broje kao jedno, pa poruka koja se spoji sa onima koje čekaju ne troši novo.
// Prolazi dok to pokretanje nije preko limita.
export function limitPotrosen(chat: Chat, uspjesnihDanas: number, uToku: boolean): boolean {
  if (chat !== "mentor") return false;
  return uspjesnihDanas + Number(uToku) + 1 > LIMIT_MENTORA;
}

// Poruka o grešci za Nemanju nikad ne nosi tekst pitanja.
export function greskaZaNemanju(chat: Chat, razlog: "rok" | "nije_pokrenuto"): string {
  const opis =
    razlog === "rok"
      ? "odgovor nije stigao u roku od 5 minuta"
      : "GitHub nije pokrenuo pitanje-o-radu.yml";
  return `Pitanje o radu sa chata „${chat}" nije dobilo odgovor: ${opis}.`;
}
