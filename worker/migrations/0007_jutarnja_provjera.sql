-- Datumi za koje je Worker pokrenuo jutarnju provjeru (ADR 0010), da je ne pokrene dvaput.
CREATE TABLE jutarnje_provjere (
  datum TEXT PRIMARY KEY,
  pokrenuta INTEGER NOT NULL
);
