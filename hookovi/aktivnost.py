"""Hook koji Workeru javlja da je u Claude Code-u bilo aktivnosti.

Claude Code ga poziva na svaku poruku i na kraj odgovora. Događaj koji dobija na stdin-u nosi
tekst razgovora, transcript_path i cwd, pa se stdin namjerno nikad ne čita (ADR 0005).

Vidi hookovi/README.md.
"""

import json
import os
import threading
import urllib.request
from pathlib import Path

# Van svih repoa, jer je tu ključ hooka.
FOLDER = Path(os.environ.get("AKTIVNOST_FOLDER", Path.home() / ".claude" / "aktivnost"))
# Važi za cijelo javljanje. Rok poziva ne pokriva DNS, pa ga čuva glavna nit.
ROK = 3


class BezPreusmjeravanja(urllib.request.HTTPRedirectHandler):
    """Inače bi urllib proslijedio ključ na adresu iz preusmjeravanja."""

    def redirect_request(self, *_argumenti, **_opcije):
        return None


def javi() -> None:
    # Greška hooka nikad ne smije da stigne do Claude-a, ni kao ispis.
    try:
        # utf-8-sig, jer Windows PowerShell 5.1 upisuje BOM, a kvar se ovdje nigdje ne bi vidio.
        podesavanja = json.loads((FOLDER / "podesavanja.json").read_text(encoding="utf-8-sig"))
        zahtjev = urllib.request.Request(
            f"{podesavanja['adresa'].rstrip('/')}/aktivnost",
            data=b"",
            method="POST",
            headers={
                "Authorization": f"Bearer {podesavanja['kljuc']}",
                # Cloudflare često odbija podrazumijevano ime koje urllib šalje.
                "User-Agent": "progress-report-hook",
            },
        )
        urllib.request.build_opener(BezPreusmjeravanja).open(zahtjev, timeout=ROK).close()
    except Exception:
        pass


def main() -> None:
    nit = threading.Thread(target=javi, daemon=True)
    nit.start()
    nit.join(ROK)
    # Nit koja još čeka mrežu ne smije da zadrži proces.
    os._exit(0)


if __name__ == "__main__":
    main()
