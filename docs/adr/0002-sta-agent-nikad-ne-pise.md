# Šta agent nikad ne piše u izvještaj

Iako je sajt zaštićen (vidi [0001](0001-izvjestaji-u-privatnom-repou-iza-prijave.md)), agent u izvještaj **nikad** ne piše:

- tajne i ključeve (tokeni, lozinke, sadržaj `.env` fajla),
- putanje sa Nemanjinog računara,
- privatne poruke,
- imena klijenata,
- interne materijale Tarikove firme.

Zaštita sajta može da otkaže (pogrešno podešavanje, procurjeli link, greška u repou), a izvještaj ostaje zauvijek u git istoriji. Zato se na zaštitu ne oslanjamo kao na jedinu odbranu. Pravilo važi naročito od trenutka kad agent počne da čita Claude Code sesije, jer u njima ima svega navedenog.
