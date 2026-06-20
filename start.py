#!/usr/bin/env python3
"""OracleSentinel V2 - Lanceur Python.

Equivalent de start.bat : lance la BONNE version (serveur RACINE = V2).
NE lance PAS la V1 du dossier .\\Chatbot (obsolete).

Ce que fait ce script :
  1. Verifie que le backend (server/package.json) et la config (.env racine) existent.
  2. Libere le port 3001 si un process obsolete (ex. ancienne V1 .\\Chatbot\\server)
     le squatte -> sinon /qg et /priv repondent en 404 (c'est la V1 qui repond).
  3. Lance le backend V2 (server -> npm run dev) sur http://localhost:3001
  4. Lance le frontend widget (racine -> npm run dev) sur http://localhost:3000

Usage : python start.py
"""

from __future__ import annotations

import os
import platform
import subprocess
import sys
import time
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
SERVER_DIR = ROOT_DIR / "server"
BACKEND_PORT = 3001
FRONTEND_PORT = 3000
IS_WINDOWS = platform.system() == "Windows"


def fail(message: str) -> None:
    print(f"[ERREUR] {message}")
    if IS_WINDOWS:
        os.system("pause")
    sys.exit(1)


def free_port(port: int) -> None:
    """Tue tout process en ecoute (LISTENING) sur le port donne (Windows)."""
    print(f"[INFO] Verification du port {port}...")
    if not IS_WINDOWS:
        # Best effort sur Unix (non utilise sur ce projet Windows).
        subprocess.run(
            f"lsof -ti tcp:{port} | xargs -r kill -9", shell=True, check=False
        )
        return

    try:
        output = subprocess.check_output(
            f'netstat -ano | findstr "LISTENING" | findstr ":{port} "',
            shell=True,
            text=True,
        )
    except subprocess.CalledProcessError:
        print(f"[INFO] Port {port} libre.")
        return

    pids = set()
    for line in output.splitlines():
        parts = line.split()
        if parts:
            pids.add(parts[-1])

    if not pids:
        print(f"[INFO] Port {port} libre.")
        return

    for pid in pids:
        print(f"[INFO] Port {port} occupe par PID {pid} (process obsolete) -- arret")
        subprocess.run(f"taskkill /F /PID {pid}", shell=True, check=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"[INFO] Port {port} libere.")
    time.sleep(2)


def launch(title: str, cwd: Path, command: str) -> None:
    """Ouvre une nouvelle fenetre qui execute `command` dans `cwd`."""
    if IS_WINDOWS:
        subprocess.Popen(
            f'start "{title}" /D "{cwd}" cmd /k "{command}"', shell=True
        )
    else:
        subprocess.Popen(command, cwd=str(cwd), shell=True)


def main() -> None:
    os.chdir(ROOT_DIR)

    print()
    print("==========================================")
    print("  OracleSentinel V2 - Lanceur (Python)")
    print("==========================================")
    print()

    if not (SERVER_DIR / "package.json").exists():
        fail("Backend introuvable : server/package.json")

    if not (ROOT_DIR / ".env").exists():
        fail(
            ".env manquant a la racine. Copiez .env.example vers .env et "
            "renseignez vos cles (DATABASE_URL, GROQ_API_KEY, ADMIN_API_KEY, ...)."
        )

    if not (ROOT_DIR / "build" / "dashboard.html").exists():
        print("[INFO] build/dashboard.html absent : le QG /qg ne sera servi "
              "qu'apres un build (npm run build a la racine).")
        print()

    free_port(BACKEND_PORT)

    print(f"[1/2] Backend  -> http://localhost:{BACKEND_PORT}")
    launch("OracleSentinel Backend (3001)", SERVER_DIR, "npm run dev")

    print("[INFO] Initialisation du backend (4s)...")
    time.sleep(4)

    print(f"[2/2] Frontend (widget dev) -> http://localhost:{FRONTEND_PORT}")
    launch("OracleSentinel Frontend (3000)", ROOT_DIR, "npm run dev")

    print()
    print("==========================================")
    print("  ACCES")
    print("------------------------------------------")
    print(f"  QG (Command Center) : http://localhost:{BACKEND_PORT}/qg")
    print(f"  Infra / Flotte      : http://localhost:{BACKEND_PORT}/priv")
    print(f"  Admin (DB)          : http://localhost:{BACKEND_PORT}/admin")
    print(f"  Factory             : http://localhost:{BACKEND_PORT}/factory")
    print(f"  Widget (dev Vite)   : http://localhost:{FRONTEND_PORT}")
    print("------------------------------------------")
    print("  Connexion QG : colle la valeur de ADMIN_API_KEY (voir .env)")
    print("==========================================")
    print()
    print("Deux fenetres ouvertes (backend + frontend). Fermez-les pour tout arreter.")


if __name__ == "__main__":
    main()
