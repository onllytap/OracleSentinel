#!/usr/bin/env python3
"""[OBSOLETE] Lanceur de l'ANCIENNE racine OracleSentinel.

⛔ ATTENTION : ce dossier racine est OBSOLETE.
La VRAIE application a jour est dans le sous-dossier  Chatbot/.

   ->  cd "D:\\Chatbot - Copy\\Chatbot"  &&  python start.py

(Ancien commentaire trompeur : il pretendait que "serveur RACINE = V2" et que
.\\Chatbot serait "V1 obsolete". C'est FAUX et INVERSE : la reference = Chatbot/.)
Voir 000_STOP_VRAIE_APP_DANS_CHATBOT.md.

Ce que fait ce script :
  1. Verifie que le backend (server/package.json) et la config (.env racine) existent.
  2. (Par defaut) BUILD le QG (npm run build a la racine) -> build/dashboard.html,
     afin que /qg affiche bien la derniere version (onglets Mandats, CRM, etc.).
     Desactivable avec --no-build.
  3. (Optionnel) Ingere des donnees DVF reelles (--ingest <fichier.csv|.gz>) pour
     que /estimer renvoie de vraies fourchettes. ATTENTION : ecrit dans la base
     pointee par DATABASE_URL (.env).
  4. Libere le port 3001 si un process obsolete le squatte.
  5. Lance le backend V2 (server -> npm run dev) sur http://localhost:3001
     (sert /qg, /priv, /admin, /factory, ET /estimer + l'API d'estimation).
  6. Lance le frontend widget (racine -> npm run dev) sur http://localhost:3000

Usage :
  python start.py
  python start.py --no-build
  python start.py --build
  python start.py --ingest data/dvf/28.csv.gz
"""

from __future__ import annotations

import argparse
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


def run_sync(title: str, cwd: Path, command: str) -> int:
    """Execute une commande et ATTEND la fin (build, ingestion...)."""
    print(f"[INFO] {title}")
    result = subprocess.run(command, cwd=str(cwd), shell=True)
    if result.returncode != 0:
        print(f"[ATTENTION] '{command}' a renvoye le code {result.returncode}.")
    return result.returncode


def free_port(port: int) -> None:
    """Tue tout process en ecoute (LISTENING) sur le port donne (Windows)."""
    print(f"[INFO] Verification du port {port}...")
    if not IS_WINDOWS:
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Lanceur OracleSentinel V2 (backend + frontend + QG)."
    )
    parser.add_argument(
        "--no-build", action="store_true",
        help="Ne pas (re)builder le QG, meme si build/dashboard.html est present/absent.",
    )
    parser.add_argument(
        "--build", action="store_true",
        help="Forcer le build du QG meme si build/dashboard.html existe deja.",
    )
    parser.add_argument(
        "--ingest", metavar="FICHIER", default=None,
        help="Ingerer un fichier DVF (geo-dvf .csv ou .csv.gz) avant de lancer. "
             "ATTENTION : ecrit dans la base DATABASE_URL du .env.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    os.chdir(ROOT_DIR)

    print()
    print("##############################################################")
    print("#  /!\\  DOSSIER RACINE OBSOLETE  /!\\                          #")
    print("#  La VRAIE app est dans le sous-dossier  Chatbot\\            #")
    print("#     cd \"D:\\Chatbot - Copy\\Chatbot\"  &&  python start.py     #")
    print("#  (voir 000_STOP_VRAIE_APP_DANS_CHATBOT.md)                  #")
    print("##############################################################")
    print()
    try:
        if sys.stdin and sys.stdin.isatty():
            input("Entree = lancer QUAND MEME la racine obsolete | Ctrl+C = arreter... ")
    except (EOFError, KeyboardInterrupt):
        print("\n[INFO] Arret. Va dans Chatbot/ : python \"D:\\Chatbot - Copy\\Chatbot\\start.py\"")
        return

    print()
    print("==========================================")
    print("  [OBSOLETE] OracleSentinel racine - Lanceur (Python)")
    print("==========================================")
    print()

    if not (SERVER_DIR / "package.json").exists():
        fail("Backend introuvable : server/package.json")

    if not (ROOT_DIR / ".env").exists():
        fail(
            ".env manquant a la racine. Copiez .env.example vers .env et "
            "renseignez vos cles (DATABASE_URL, GROQ_API_KEY, ADMIN_API_KEY, ...)."
        )

    # ── Build du QG (pour que /qg affiche la derniere version : Mandats, etc.) ──
    dashboard = ROOT_DIR / "build" / "dashboard.html"
    if args.no_build:
        if not dashboard.exists():
            print("[INFO] --no-build : /qg ne sera pas servi (build/dashboard.html absent).")
    elif args.build or not dashboard.exists():
        reason = "forcage --build" if args.build else "build/dashboard.html absent"
        rc = run_sync(f"Build du QG (npm run build) [{reason}]...", ROOT_DIR, "npm run build")
        if rc != 0:
            print("[ATTENTION] Le build du QG a echoue : /qg pourrait etre obsolete.")
    else:
        print("[INFO] QG deja builde (build/dashboard.html present). "
              "Utilisez --build pour le rafraichir apres un changement de code.")

    # ── Ingestion DVF optionnelle (donnees reelles pour /estimer) ──────────────
    if args.ingest:
        dvf_path = args.ingest
        print()
        print("[ATTENTION] Ingestion DVF -> ecrit dans la base DATABASE_URL du .env.")
        print(f"            Fichier : {dvf_path}")
        run_sync(f"Ingestion DVF ({dvf_path})...", SERVER_DIR,
                 f'npm run ingest-dvf -- "{dvf_path}"')
    else:
        print("[INFO] Estimations /estimer : pour des fourchettes REELLES, charger "
              "les ventes DVF une fois : python start.py --ingest <fichier 28.csv.gz>")
        print("       (Sans donnees DVF, /estimer capture quand meme le vendeur, "
              "estimation 'a affiner'.)")

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
    print(f"     -> onglet 'Mandats' = vendeurs captes par l'estimation")
    print(f"  Estimation (vendeurs): http://localhost:{BACKEND_PORT}/estimer")
    print(f"     -> par agence       : /estimer?w=<widget_id>")
    print(f"  Infra / Flotte      : http://localhost:{BACKEND_PORT}/priv")
    print(f"  Admin (DB)          : http://localhost:{BACKEND_PORT}/admin")
    print(f"  Factory             : http://localhost:{BACKEND_PORT}/factory")
    print(f"  Widget (dev Vite)   : http://localhost:{FRONTEND_PORT}")
    print("------------------------------------------")
    print("  Connexion QG : passkey, ou colle ADMIN_API_KEY (voir .env)")
    print("==========================================")
    print()
    print("Deux fenetres ouvertes (backend + frontend). Fermez-les pour tout arreter.")


if __name__ == "__main__":
    main()
