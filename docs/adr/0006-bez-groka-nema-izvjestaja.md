# Grok piše samo stavke, a bez Groka nema izvještaja

Izvještaj piše Grok (`grok-4.7`) preko xAI API-ja, sa šemom odgovora (`response_format: json_schema`). Grok vraća samo stavke: kratak opis, detalj, projekat iz spiska aktivnih projekata i ID-eve dokaza sa spiska koji mu dajemo. Datum, period, broj stavki i prave linkove dodaje Python, pa Grok ne može da izmisli ni link ni period. Ako nema ulaznih podataka, Grok se ne poziva i to je dan bez rada.

Ako Grok ne odgovori ni poslije ponovljenih pokušaja, mentor tog puta ne dobija ništa, a Nemanja dobija upozorenje. Rad nije izgubljen, jer period sljedećeg izvještaja počinje od kraja prethodnog. Jednostavan izvještaj bez Groka je odbijen: bez Groka nema ko da prečisti tekst, a sirove bilješke i naslovi iz privatnih repoa mogu da sadrže ono što ADR 0002 zabranjuje, i to bi ostalo u git istoriji.

## Posljedice

- Neuspjeh Groka se ne smije javiti mentoru kao dan bez rada, jer rad postoji, a izvještaj nije napisan.
