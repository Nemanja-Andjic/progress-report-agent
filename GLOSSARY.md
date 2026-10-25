# Progress Report Agent

Agent koji na kraju dana sam napiše izvještaj o Nemanjinom radu i pošalje ga mentoru.

## Jezik

**Mentor**:
Tarik, osoba kojoj su izvještaji namijenjeni.

**Agent**:
Program koji sam sastavlja i objavljuje izvještaje, bez Nemanjine ruke.
_Izbjegavaj_: bot (bot je samo Telegram nalog preko kog agent šalje poruke)

**Izvještaj**:
Pregled rada za jedan dan. Nosi datum dana kad je napisan i sastoji se od spiska stavki.
_Izbjegavaj_: dnevnik, report

**Ručno ispravljen izvještaj**:
Izvještaj koji je napisao agent, a poslije ga je mijenjao čovjek. Nosi i oznaku agenta i oznaku "ručno ispravljeno", a agent ga više nikad ne pregazi.

**Ručno napisan izvještaj**:
Izvještaj koji je čovjek napisao od nule, bez agenta. Nosi samo oznaku "napisano ručno", bez oznake agenta, a agent ga nikad ne pregazi.

**Period izvještaja**:
Vrijeme koje izvještaj pokriva: od prethodnog izvještaja do trenutka pisanja, a ne kalendarski dan.

**Dan bez rada**:
Dan u kom period nema nijednu stavku. Za njega se ne pravi izvještaj, a mentor dobija samo kratko obavještenje.

**Stavka**:
Jedna urađena stvar u izvještaju. Ima broj, kratak opis i detalj, a može imati projekat i dokaze.
_Izbjegavaj_: zadatak, task, tačka

**Broj stavke**:
Redni broj stavke u izvještaju (1, 2, 3...). Isti je u sažetku i u detaljnom izvještaju, pa detalj broj 2 uvijek objašnjava kratak opis broj 2.

**Kratak opis**:
Jedan red koji kaže šta je urađeno u stavci.

**Detalj**:
Duže objašnjenje jedne stavke: šta je urađeno i zašto.

**Sažetak**:
Spisak kratkih opisa svih stavki jednog izvještaja. Ide mentoru na Telegram.
_Izbjegavaj_: executive summary, rezime

**Detaljan izvještaj**:
Spisak detalja svih stavki jednog izvještaja, objavljen na sajtu.

**Projekat**:
Posao kojem stavka pripada, npr. "Distill analiza" ili "Agent za izvještaje". Agent ga bira iz spiska projekata i ne izmišlja nove.
_Izbjegavaj_: repo (jedan projekat može imati više repoa)

**Spisak projekata**:
Zatvoren spisak imena projekata koji vodi Nemanja.

**Dokaz**:
Link ka nečemu što pokazuje da je stavka urađena, npr. issue, PR ili commit. Uz link ide kratka oznaka, npr. "PR #12". Smije da vodi samo na adrese sa spiska dozvoljenih linkova.

**Spisak dozvoljenih linkova**:
Zatvoren spisak adresa na koje izvještaj smije da vodi, u dokazima i u detaljima. Vodi ga Nemanja.

**Bilješka sesije**:
Kratak zapis o jednoj Claude sesiji koji napiše Claude na njenom kraju. Bilješka je ono što agent čita, a sažetak je ono što mentor dobija. Bilješka se nikad ne objavljuje.
_Izbjegavaj_: sažetak sesije (sudara se sa pojmom sažetak)

**Arhiva**:
Spisak svih objavljenih izvještaja po datumima.
