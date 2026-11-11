-- Radni dan i samostalno slanje poslije 23:00 (ADR 0008). Jedan pokušaj u 23:00 je ukinut.
ALTER TABLE dani ADD COLUMN samostalni_pokusaji INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dani ADD COLUMN rad_iz_provjere INTEGER;
ALTER TABLE dani DROP COLUMN pokusaj_23;
