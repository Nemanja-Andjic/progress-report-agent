-- Pitanja mentora: limit, persiranje i uvodna poruka, po chatu (ADR 0007). Tekst razgovora nije ovdje.

-- Broj uspješnih odgovora po kalendarskom danu, po zoni Europe/Belgrade.
CREATE TABLE odgovori_po_danu (
  chat TEXT NOT NULL,
  datum TEXT NOT NULL,
  broj INTEGER NOT NULL,
  PRIMARY KEY (chat, datum)
);

-- 1 je obraćanje na "vi", a 0 na "ti". Chat bez reda dobija "ti".
CREATE TABLE persiranje (
  chat TEXT PRIMARY KEY,
  persiran INTEGER NOT NULL
);

-- Red postoji kad je uvodna poruka poslata, ili dok se šalje.
CREATE TABLE uvodne_poruke (
  chat TEXT PRIMARY KEY,
  poslata INTEGER NOT NULL
);
