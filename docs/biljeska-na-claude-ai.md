# Bilješka sesije na claude.ai

Tekst ispod ide u uputstvo Claude projekta "Rad sa Tarikom" na claude.ai. Unos i pristup za pisanje u privatni repo su ručni koraci iz #31.

Na claude.ai nema hooka ni provjere prije commita, pa je ovo uputstvo jedina zaštita prije upisa. Agent kasnije svaku bilješku ponovo provjerava prije nego što je pošalje Groku.

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

Ako nisi siguran da nešto smije u bilješku, izostavi to. Commit poruka je samo "Bilješka sesije". Kad završiš, javi jednom rečenicom da je bilješka upisana, a tekst nemoj prepisivati u odgovor.
```
