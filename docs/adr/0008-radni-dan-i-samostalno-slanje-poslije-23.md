# Radni dan traje do slanja, a poslije 23:00 izvještaj ide sam tek poslije 40 minuta bez rada

Do sad je izvještaj sam kretao u 23:00, a dan se završavao u ponoć. Nemanja često radi i poslije 23:00, ponekad i poslije ponoći, pa bi takav izvještaj otišao usred rada, a rad poslije ponoći bi pripao sljedećem danu. Zato uvodimo **radni dan**: traje do slanja izvještaja, a najkasnije do 1:00.

Ovo mijenja „slanje u 23:00" iz ADR 0004 i ADR 0005.

## Pravilo

- Do 23:00 sve ostaje kao do sad: pitanje o završetku poslije pauze, a „Jesam" i „završio" šalju odmah. Prije 23:00 izvještaj nikad ne ide sam.
- Poslije 23:00 izvještaj ide sam tek kad prođe 40 minuta bez rada, i to najranije u 23:40. Ranije ide samo na „završio". Najkasnije ide u 1:00.
- Rad je: aktivnost iz hooka, Nemanjini commitovi na GitHub-u, bilješke sesija i signal rada sa claude.ai (ADR 0009). Commitovi u `pitanja-o-radu/` i commitovi agenta nisu rad.
- Dan bez rada se utvrđuje po istom pravilu, najranije u 23:40.
- Izvještaj i poruka „Danas nema zabilježenog rada" poslati poslije ponoći idu mentoru bez zvuka.
- Rad poslije ponoći ulazi u izvještaj radnog dana koji je u toku, dok se on ne pošalje. Izvještaj nosi datum radnog dana. „završio" i aktivnost poslije ponoći pripadaju radnom danu koji je u toku. Poslije slanja, a najkasnije od 1:00, počinje novi radni dan.
- Od 1:00 do 5:00 „završio", „odloži" i „Jesam" sa jučerašnjeg pitanja se uvijek odnose na sinoćni rad. Ne pokreću ništa i ne važe za novi radni dan, a bot odgovori: „Radni dan je zatvoren u 1:00. Rad od sada ulazi u sljedeći izvještaj." Od 5:00 sve radi kao inače.

## „odloži"

Poruka „odloži" (ili „odlozi"), samo sa Nemanjinog chata, rezerva je za rad koji agent ne vidi. Bot potvrdi: „U redu, čekam tvoje ‚završio', najkasnije do 1:00."

- Važi cijeli radni dan, i prije 23:00. Od tada nema pitanja o završetku ni samostalnog slanja poslije 40 minuta bez rada. Izvještaj ide na „završio" ili u 1:00.
- Ponovno „odloži" samo ponovi potvrdu. Na zatvoren radni dan bot kaže da je izvještaj već poslat, a dok pisanje teče, da je pisanje u toku.
- Komande za poništavanje nema. Izlaz je „završio".

## Provjere i pokušaji

Worker sam zna aktivnost iz hooka, a GitHub, bilješke i signale rada ne vidi (ADR 0004, ADR 0005). Za njih pokreće provjeru u Actions, ali štedi minute:

- prva provjera je u 23:40;
- ako je posljednji rad bio u trenutku T, sljedeća provjera je tek u T + 40 minuta, bez obzira na to da li je T došao iz hooka ili iz provjere;
- u 1:00 izvještaj ide bez provjere.

Agent sam pokušava najviše dvaput: prvi put kad prođe 40 minuta bez rada, a drugi put u 1:00, samo ako prvi nije uspio, a pisanje tada nije u toku. Neuspjeh prije 23:00, npr. poslije „Jesam", ukida samo nova pitanja tog dana, a samostalno slanje i dalje važi. Poslije neuspjeha u 1:00 mentor ne dobija ništa, a Nemanja dobija upozorenje. Rad ulazi u sljedeći izvještaj (ADR 0006).

## Razmotrene opcije

- **Ostaviti 23:00**: izvještaj bi išao usred rada, a kasni rad bi se prelio u sljedeći dan.
- **Provjera svakih 5 minuta poslije 23:00**: tačnije, ali troši minute Actions bez potrebe, jer prije T + 40 odluka ionako ne može da padne.
- **Bez gornje granice**: izvještaj bi mogao da ne ode cijelu noć, a jutarnja provjera bi javila neuspjeh.

## Posljedice

- Faza u D1 i pravila Workera računaju radni dan, a ne kalendarski. Prva aktivnost poslije ponoći više ne pravi novi dan dok je radni dan u toku.
- Rječnik se mijenja: izvještaj nosi datum radnog dana, a dan bez rada se ne javlja u 23:00.
- Pitanje o završetku i dalje kreće samo između 16:00 i 22:30.
