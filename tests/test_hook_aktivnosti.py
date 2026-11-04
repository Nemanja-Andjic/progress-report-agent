"""Hook za aktivnost kao pravi proces: šta šalje, šta ispisuje i kako se ponaša kad Worker ne radi."""

import json
import os
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

HOOK = Path(__file__).resolve().parents[1] / "hookovi" / "aktivnost.py"
KLJUC = "lazni-kljuc-hooka"
# Isto što Claude Code šalje hooku: tekst razgovora, putanje i ID-evi ne smiju nikud da odu.
DOGADJAJ = json.dumps({
    "session_id": "lazna-sesija",
    "transcript_path": "lazna/putanja/razgovor.jsonl",
    "cwd": "lazni/folder",
    "hook_event_name": "UserPromptSubmit",
    "prompt": "Tajni tekst razgovora",
})


class LazniWorker(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, status=204, zaglavlja=None):
        class Obrada(BaseHTTPRequestHandler):
            def do_POST(obrada):
                duzina = int(obrada.headers.get("Content-Length") or 0)
                self.zahtjevi.append({
                    "putanja": obrada.path,
                    "zaglavlja": dict(obrada.headers),
                    "telo": obrada.rfile.read(duzina),
                })
                obrada.send_response(status)
                for ime, vrijednost in (zaglavlja or {}).items():
                    obrada.send_header(ime, vrijednost)
                obrada.send_header("Content-Length", "0")
                obrada.end_headers()

            do_GET = do_POST

            def log_message(obrada, *_argumenti):
                pass

        self.zahtjevi = []
        super().__init__(("127.0.0.1", 0), Obrada)
        threading.Thread(target=self.serve_forever, daemon=True).start()

    @property
    def adresa(self):
        return f"http://127.0.0.1:{self.server_port}"


@pytest.fixture
def worker():
    server = LazniWorker()
    yield server
    server.shutdown()
    server.server_close()


def podesi(folder, adresa, kljuc=KLJUC, kodiranje="utf-8"):
    (folder / "podesavanja.json").write_text(json.dumps({"adresa": adresa, "kljuc": kljuc}), encoding=kodiranje)


def pokreni(folder, ulaz=DOGADJAJ):
    return subprocess.run(
        [sys.executable, str(HOOK)],
        input=ulaz,
        capture_output=True,
        encoding="utf-8",
        timeout=20,
        env={**os.environ, "AKTIVNOST_FOLDER": str(folder)},
    )


def tiho(rezultat):
    assert rezultat.returncode == 0
    assert rezultat.stdout == ""
    assert rezultat.stderr == ""


def test_javlja_samo_da_je_aktivnost_bila(tmp_path, worker):
    podesi(tmp_path, worker.adresa)

    tiho(pokreni(tmp_path))

    assert len(worker.zahtjevi) == 1
    zahtjev = worker.zahtjevi[0]
    assert zahtjev["putanja"] == "/aktivnost"
    assert zahtjev["telo"] == b""
    assert zahtjev["zaglavlja"]["Authorization"] == f"Bearer {KLJUC}"
    # Ništa iz događaja nije izašlo, ni u zaglavljima.
    ispis = json.dumps([zahtjev["putanja"], zahtjev["zaglavlja"]])
    for vrijednost in ("Tajni tekst", "lazna-sesija", "razgovor.jsonl", "lazni/folder", "UserPromptSubmit"):
        assert vrijednost not in ispis


def test_ne_predstavlja_se_kao_python(tmp_path, worker):
    # Cloudflare često odbija podrazumijevani User-Agent za urllib.
    podesi(tmp_path, worker.adresa)

    pokreni(tmp_path)

    assert "Python" not in worker.zahtjevi[0]["zaglavlja"]["User-Agent"]


def test_adresa_sa_kosom_crtom_na_kraju(tmp_path, worker):
    podesi(tmp_path, worker.adresa + "/")

    pokreni(tmp_path)

    assert worker.zahtjevi[0]["putanja"] == "/aktivnost"


def test_podesavanja_sa_bom_oznakom_rade(tmp_path, worker):
    # Windows PowerShell 5.1 tako upisuje UTF-8, a kvar bi inače ostao nevidljiv.
    podesi(tmp_path, worker.adresa, kodiranje="utf-8-sig")

    pokreni(tmp_path)

    assert len(worker.zahtjevi) == 1


def test_radi_i_bez_ulaza(tmp_path, worker):
    podesi(tmp_path, worker.adresa)

    tiho(pokreni(tmp_path, ulaz=""))

    assert len(worker.zahtjevi) == 1


@pytest.mark.parametrize("status", [401, 404, 500, 503])
def test_odbijanje_ne_pravi_gresku(tmp_path, status):
    server = LazniWorker(status=status)
    podesi(tmp_path, server.adresa)

    tiho(pokreni(tmp_path))

    assert len(server.zahtjevi) == 1
    server.shutdown()
    server.server_close()


def test_ugasen_worker_ne_pravi_gresku(tmp_path):
    with socket.create_server(("127.0.0.1", 0)) as zauzet:
        adresa = f"http://127.0.0.1:{zauzet.getsockname()[1]}"
    podesi(tmp_path, adresa)

    tiho(pokreni(tmp_path))


def test_worker_koji_ne_odgovara_ne_zadrzava_rad(tmp_path):
    with socket.create_server(("127.0.0.1", 0)) as nijem:
        podesi(tmp_path, f"http://127.0.0.1:{nijem.getsockname()[1]}")
        pocetak = time.monotonic()

        tiho(pokreni(tmp_path))

        # Rok iz podešavanja u README-u je 5 sekundi, pa hook mora da završi sam, prije njega.
        assert time.monotonic() - pocetak < 5


@pytest.mark.parametrize(
    "sadrzaj",
    [None, "nije json", "[]", "{}", '{"adresa": "http://127.0.0.1:1"}', '{"kljuc": "k"}', '{"adresa": 1, "kljuc": 2}'],
)
def test_neispravna_podesavanja_ne_prave_gresku(tmp_path, sadrzaj):
    if sadrzaj is not None:
        (tmp_path / "podesavanja.json").write_text(sadrzaj, encoding="utf-8")

    tiho(pokreni(tmp_path))


def test_worker_koji_salje_bajt_po_bajt_ne_zadrzava_rad(tmp_path):
    # Svaki bajt obnavlja rok poziva, pa ovo hvata samo rok za cijelo javljanje.
    def kapa(server):
        veza, _ = server.accept()
        try:
            veza.sendall(b"HTTP/1.1 200 OK\r\n")
            while True:
                veza.sendall(b"X: y\r\n")
                time.sleep(0.5)
        except OSError:
            pass

    with socket.create_server(("127.0.0.1", 0)) as server:
        threading.Thread(target=kapa, args=(server,), daemon=True).start()
        podesi(tmp_path, f"http://127.0.0.1:{server.getsockname()[1]}")
        pocetak = time.monotonic()

        tiho(pokreni(tmp_path))

        assert time.monotonic() - pocetak < 5


@pytest.mark.parametrize("status", [301, 302, 303, 307, 308])
def test_kljuc_ne_prati_preusmjeravanje(tmp_path, worker, status):
    preusmjerava = LazniWorker(status=status, zaglavlja={"Location": f"{worker.adresa}/krade"})
    podesi(tmp_path, preusmjerava.adresa)

    tiho(pokreni(tmp_path))

    assert len(preusmjerava.zahtjevi) == 1
    assert worker.zahtjevi == []
    preusmjerava.shutdown()
    preusmjerava.server_close()
