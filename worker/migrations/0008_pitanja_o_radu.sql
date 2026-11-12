-- Red pitanja o radu, po chatu (ADR 0007). Tekst je ovdje samo dok poruka čeka u redu ili dok je
-- pokretanje u toku. Poruka koja čeka nema oznaku, a poruke jednog pokretanja dijele oznaku i vrijeme.
CREATE TABLE pitanja_o_radu (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat TEXT NOT NULL,
  tekst TEXT NOT NULL,
  oznaka TEXT,
  pokrenuto INTEGER
);

CREATE INDEX pitanja_o_radu_po_chatu ON pitanja_o_radu (chat, oznaka);
CREATE INDEX pitanja_o_radu_po_oznaci ON pitanja_o_radu (oznaka);
