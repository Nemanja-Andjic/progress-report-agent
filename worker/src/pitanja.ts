// Pitanja o radu (ADR 0007): bez mreže, baze i sata. Worker drži red u D1, a ovdje je samo ono
// što o poruci, redu i roku može da se odluči bez njih.

export type Chat = "mentor" | "nemanja";
export type IshodOdgovora = "odgovor" | "odbijeno" | "neuspjeh";
export type Persiranje = "da" | "ne" | "bez_promjene";

// Worker čeka odgovor 5 minuta od pokretanja workflow-a.
export const ROK_ODGOVORA_MS = 5 * 60_000;

export const RAZMISLJAM = "Razmišljam, odgovor stiže za minut-dva.";
export const SAMO_TEKST = "Mogu da odgovorim samo na pitanja napisana tekstom.";
export const ODBIJENO =
  "Ovo pitanje ne mogu da obradim jer sadrži nešto što liči na lozinku, ključ ili putanju. Napiši ga bez toga.";
export const NEUSPJEH = "Trenutno ne mogu da odgovorim, pokušaj ponovo za nekoliko minuta.";

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
export function porukaZaChat(ishod: IshodOdgovora, tekst: string): string {
  if (ishod === "odgovor") return tekst;
  return ishod === "odbijeno" ? ODBIJENO : NEUSPJEH;
}

// Poruka o grešci za Nemanju nikad ne nosi tekst pitanja.
export function greskaZaNemanju(chat: Chat, razlog: "rok" | "nije_pokrenuto"): string {
  const opis =
    razlog === "rok"
      ? "odgovor nije stigao u roku od 5 minuta"
      : "GitHub nije pokrenuo pitanje-o-radu.yml";
  return `Pitanje o radu sa chata „${chat}" nije dobilo odgovor: ${opis}.`;
}
