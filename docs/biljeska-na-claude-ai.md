# Bilješka sesije na claude.ai

Tekst ispod ide u uputstvo Claude projekta "Rad sa Tarikom" na claude.ai. Unos i pristup za pisanje u privatni repo su ručni koraci iz #31.

Na claude.ai nema hooka. Provjera prije commita postoji samo kad Claude ima alate i privatni repo, a inače je ovo uputstvo jedina zaštita prije upisa. Agent kasnije svaku bilješku ponovo provjerava prije nego što je pošalje Groku.

## Tekst uputstva

```text
Kad Nemanja kaže "napiši bilješku sesije", upiši kratku bilješku o radu u ovom razgovoru od posljednje bilješke.

Bilješka je jedan novi JSON fajl u folderu biljeske-sesija/ repoa Nemanja-Andjic/progress-report-izvjestaji, commit-ovan direktno u main. Ne mijenjaj nijedan drugi fajl.

Ime fajla sadrži samo vrijeme: GGGG-MM-DDTHHMMSS.json, npr. 2026-10-25T153000.json.

Sadržaj:
{
  "vrijeme": "2026-10-25T15:30+01:00",
  "projekat": "Agent za izvještaje",
  "tekst": "Kratak tekst o urađenom."
}

- vrijeme: trenutak pisanja, po Nemanjinom lokalnom vremenu, sa vremenskom zonom. Ako ne znaš tačno vrijeme, pitaj Nemanju.
- projekat: ako je rad za aktivan projekat, tačno njegovo ime iz fajla projekti.json u tom repou. Ako nije, kratak opšti naziv posla, bez imena klijenta. Takvu bilješku agent kasnije preskače.
- tekst: 2 do 5 rečenica, najviše 2000 znakova, na našem jeziku (ijekavica). Šta je urađeno i zašto, svojim riječima. Ne prepisuj razgovor.

Bilješka ostaje zauvijek u git istoriji, pa nikad ne smije da sadrži:
- tajne i ključeve (tokeni, lozinke, sadržaj .env fajla);
- putanje sa Nemanjinog računara;
- privatne poruke;
- imena klijenata;
- interne materijale Tarikove firme.

Ako imaš alate i privatni repo (kao u projektu "Rad sa Tarikom"), prije commita u korijenu privatnog repoa pokreni:
python napravi_sajt.py --provjeri-biljesku <fajl>
Bilješku koja ne prođe provjeru ne commit-uj.

Ako nisi siguran da nešto smije u bilješku, izostavi to. Commit poruka je samo "Bilješka sesije". Kad završiš, javi jednom rečenicom da je bilješka upisana, a tekst nemoj prepisivati u odgovor.

Signal rada: kad je Nemanjina poruka poslata poslije 22:30, a od prethodnog signala rada je prošlo 20 minuta ili više, uz svoj odgovor upiši signal rada, bez pitanja.

Signal je fajl signal-rada.json u korijenu repoa Nemanja-Andjic/progress-report-izvjestaji, commit-ovan direktno u main. Svaki put ga prepiši cijelog, ovim sadržajem:
{"izvor": "claude.ai", "vrijeme": "2026-10-25T23:05+01:00"}

- vrijeme: vrijeme Nemanjine poruke, po njegovom lokalnom vremenu, sa vremenskom zonom. Ne pitaj Nemanju za tačno vrijeme, jer agent računa vrijeme commita, a ne ovo polje.
- Ne upisuj ništa drugo u fajl i ne mijenjaj nijedan drugi fajl.
- Commit poruka je samo "Signal rada".

O signalu kaži samo jednu kratku rečenicu, npr. "Signal rada je upisan."
```

Signal postoji da agent vidi rad na claude.ai kad odlučuje o samostalnom slanju poslije 23:00 (ADR 0009). Računa se samo vrijeme commita, pa netačno vrijeme u fajlu ne smeta, a signal nikad ne ulazi u izvještaj.
