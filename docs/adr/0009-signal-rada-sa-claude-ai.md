# Signal rada sa claude.ai je commit jednog fajla, a vrijeme je vrijeme commita

Hook vidi samo Claude Code (ADR 0005), pa rad na claude.ai poslije 23:00 agent ne bi vidio, a izvještaj bi otišao usred rada (ADR 0008). Zato Claude na claude.ai, u Nemanjinom projektu na claude.ai, upisuje signal rada u privatni repo.

- Signal je jedan fajl, `signal-rada.json` u korijenu privatnog repoa. Claude ga svaki put prepiše sadržajem `{"izvor": "claude.ai", "vrijeme": "<vrijeme Nemanjine poruke>"}`, a commit poruka je uvijek „Signal rada".
- Claude upiše signal na svoj odgovor ako je Nemanjina poruka poslata poslije 22:30, a od prethodnog signala je prošlo 20+ minuta. Vrijeme vidi iz Nemanjinih poruka. O signalu kaže samo jednu kratku rečenicu, da Nemanja vidi da radi.
- Provjera u Actions uzima vrijeme posljednjeg commita koji je mijenjao taj fajl, a ne vrijeme iz fajla. Polje `vrijeme` služi samo da svaki upis bude prava izmjena, jer git ne pravi commit kad se sadržaj ne promijeni.

Na claude.ai nema sata ni hooka, pa vrijeme koje Claude upiše može biti netačno. Vrijeme commita daje GitHub, pa na njega Claude ne utiče.

## Razmotrene opcije

- **Novi fajl za svaki signal**, kao bilješke: više fajlova i buke u repou, a ništa se ne dobija.
- **Vrijeme iz fajla**: Claude ne zna pouzdano tačno vrijeme.
- **Signal pravo na Worker**: Claude na claude.ai ima pristup GitHub-u, a ne Workeru, a ključ za Worker bi morao u uputstvo projekta.

## Posljedice

- Signal ne nosi ništa iz razgovora, pa ADR 0002 nema šta da provjeri.
- Signal je samo aktivnost za samostalno slanje. Nije rad za izvještaj i ne ulazi u izvještaj.
- Objava i `testovi.yml` ignorišu `signal-rada.json`.
- Uputstvo Nemanjinog projekta na claude.ai se dopunjuje ručno, kao kod bilješki.
