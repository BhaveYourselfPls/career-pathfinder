"""Start Career Pathfinder:  python app.py

Opens the app in your browser at http://127.0.0.1:8000 (or the next free port).
"""
from __future__ import annotations

import logging
import socket
import sys
import threading
import webbrowser

if sys.version_info < (3, 10):
    sys.exit("Career Pathfinder needs Python 3.10 or newer.")

try:
    import uvicorn
except ImportError:
    sys.exit("Missing packages. Run:  pip install -r requirements.txt")

from backend.config import ENV_FILE, settings


def free_port(host: str, start: int) -> int:
    for port in range(start, start + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex((host, port)) != 0:
                return port
    return start


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    if not settings.portkey_api_key:
        print(
            "\n  PORTKEY_API_KEY was not found.\n"
            "  Put it in a .env file in this folder or the folder above it, e.g.\n"
            "      PORTKEY_API_KEY=your-key-here\n"
            "  (see .env.example). The app will start, but AI steps will not work.\n"
        )
    else:
        print(f"  Using PORTKEY_API_KEY from {ENV_FILE or 'the environment'}.")

    port = free_port(settings.host, settings.port)
    url = f"http://{settings.host}:{port}"
    print(f"  Career Pathfinder running at {url}  (Ctrl+C to stop)\n")
    if "--no-browser" not in sys.argv:
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    uvicorn.run("backend.main:app", host=settings.host, port=port, log_level="warning")


if __name__ == "__main__":
    main()
