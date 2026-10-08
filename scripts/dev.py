"""Run selected Ordivant Suite products; Ctrl+C stops only processes we started."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def wait_http(url: str, process: subprocess.Popen, seconds: int = 30) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Service exited with code {process.returncode}: {url}")
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return
        except (OSError, urllib.error.URLError):
            time.sleep(0.25)
    raise RuntimeError(f"Service did not become ready: {url}")


def free_port(port: int) -> None:
    with socket.socket() as probe:
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            raise RuntimeError(f"Port {port} is in use. Stop its service or choose another port.") from None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-port", type=int, default=8000)
    parser.add_argument("--web-port", type=int, default=5173)
    parser.add_argument("--runtime-port", type=int, default=8090)
    parser.add_argument("--knowledge-port", type=int, default=8010)
    parser.add_argument("--code-port", type=int, default=8020)
    parser.add_argument("--identity-port", type=int, default=8030)
    parser.add_argument("--products", nargs="+", choices=["work", "knowledge", "code"], default=["work", "knowledge", "code"])
    parser.add_argument("--no-runtime", action="store_true")
    parser.add_argument("--no-dispatcher", action="store_true")
    parser.add_argument("--seed", action="store_true", help="Explicitly install idempotent demonstration data")
    parser.add_argument("--log-dir", type=Path, default=ROOT / ".data" / "logs")
    args = parser.parse_args()

    try:
        from dotenv import load_dotenv

        load_dotenv(ROOT / ".env.local", override=False)
    except ImportError:
        pass
    environment = os.environ.copy()
    environment.setdefault("PYTHONUTF8", "1")
    environment.setdefault("ORDIVANT_MODE", "development")
    environment.setdefault("ORDIVANT_RUNTIME_MODE", "demo")
    environment.setdefault("ORDIVANT_DATA_DIR", str(ROOT / ".data"))
    environment["ORDIVANT_API_URL"] = f"http://127.0.0.1:{args.api_port}"
    environment["ORDIVANT_RUNTIME_PORT"] = str(args.runtime_port)
    environment["VITE_API_TARGET"] = environment["ORDIVANT_API_URL"]
    environment.setdefault("ORDIVANT_KNOWLEDGE_DATA_DIR", str(ROOT / ".data" / "knowledge"))
    environment.setdefault("ORDIVANT_CODE_DATA_DIR", str(ROOT / ".data" / "code"))
    environment["VITE_KNOWLEDGE_API_TARGET"] = f"http://127.0.0.1:{args.knowledge_port}"
    environment["VITE_CODE_API_TARGET"] = f"http://127.0.0.1:{args.code_port}"
    environment["ORDIVANT_IDENTITY_URL"] = f"http://127.0.0.1:{args.identity_port}"
    environment["VITE_IDENTITY_API_TARGET"] = environment["ORDIVANT_IDENTITY_URL"]
    environment.setdefault("ORDIVANT_IDENTITY_DATA_DIR", str(ROOT / ".data" / "identity"))
    environment.setdefault("ORDIVANT_AUTH_COOKIE_NAME", "ordivant_native_session")
    environment.setdefault("ORDIVANT_AUTH_COOKIE_SECURE", "false")
    environment.setdefault("ORDIVANT_AUTH_ORIGINS", f"http://127.0.0.1:{args.web_port},http://localhost:{args.web_port}")
    if not environment.get("ORDIVANT_IDENTITY_SERVICE_TOKEN_FILE"):
        identity_secret = ROOT / ".data" / "identity" / "service-token"
        identity_secret.parent.mkdir(parents=True, exist_ok=True)
        if not identity_secret.exists():
            with identity_secret.open("x", encoding="utf-8") as secret_file:
                secret_file.write(secrets.token_hex(32))
        environment["ORDIVANT_IDENTITY_SERVICE_TOKEN_FILE"] = str(identity_secret)
    if "work" not in args.products:
        args.no_runtime = True
    if len(args.products) == 1:
        environment["VITE_API_TARGET"] = {"work": environment["ORDIVANT_API_URL"], "knowledge": environment["VITE_KNOWLEDGE_API_TARGET"], "code": environment["VITE_CODE_API_TARGET"]}[args.products[0]]
    gitea_config = ROOT / ".data" / "gitea" / "connection.json"
    if gitea_config.exists():
        environment.setdefault("ORDIVANT_CODE_GITEA_CONFIG", str(gitea_config))

    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js 24 is required. Run scripts/setup.ps1 first.")
    vite = ROOT / "frontend" / "node_modules" / "vite" / "bin" / "vite.js"
    runtime = ROOT / "runtime" / "dist" / "server.js"
    if not vite.exists() or (not args.no_runtime and not runtime.exists()):
        raise RuntimeError("Dependencies/build are missing. Run scripts/setup.ps1 first.")

    product_ports = {"work": args.api_port, "knowledge": args.knowledge_port, "code": args.code_port}
    selected_ports = [product_ports[product] for product in args.products] + [args.web_port, args.identity_port] + ([] if args.no_runtime else [args.runtime_port])
    if len(set(selected_ports)) != len(selected_ports):
        raise RuntimeError("Selected services must have distinct ports")
    for port in selected_ports:
        free_port(port)

    def python_for(product: str) -> Path:
        directory = ROOT / "backend" if product == "work" else ROOT / "products" / product / "backend"
        python = directory / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        if not python.exists():
            raise RuntimeError(f"{product} environment is missing; run scripts/setup.ps1")
        return python

    if args.seed:
        for product in args.products:
            package = "ordivant" if product == "work" else "ordivant_" + product
            subprocess.run([str(python_for(product)), "-m", package + ".seed"], cwd=ROOT, env=environment, check=True)

    args.log_dir.mkdir(parents=True, exist_ok=True)
    processes: list[tuple[str, subprocess.Popen]] = []
    handles = []

    def start(name: str, command: list[str], cwd: Path) -> subprocess.Popen:
        output = (args.log_dir / f"{name}.log").open("a", encoding="utf-8")
        handles.append(output)
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        process_environment = environment.copy()
        product_org = environment.get("ORDIVANT_" + name.removesuffix("-api").upper() + "_IDENTITY_ORG_ID") if name.endswith("-api") else None
        if product_org:
            process_environment["ORDIVANT_IDENTITY_ORG_ID"] = product_org
        process = subprocess.Popen(command, cwd=cwd, env=process_environment, stdout=output, stderr=subprocess.STDOUT, creationflags=flags)
        processes.append((name, process))
        return process

    try:
        identity = start("identity-api", [str(python_for("identity")), "-m", "uvicorn", "ordivant_identity.main:app", "--host", "127.0.0.1", "--port", str(args.identity_port), "--no-access-log"], ROOT)
        wait_http(f"http://127.0.0.1:{args.identity_port}/api/health", identity)
        for product in args.products:
            package = "ordivant" if product == "work" else "ordivant_" + product
            port = product_ports[product]
            process = start(product + "-api", [str(python_for(product)), "-m", "uvicorn", package + ".main:app", "--host", "127.0.0.1", "--port", str(port), "--no-access-log"], ROOT)
            wait_http(f"http://127.0.0.1:{port}/api/health", process)
        if not args.no_runtime:
            command = [node, str(runtime)]
            if not args.no_dispatcher:
                command.append("--dispatcher")
            engine = start("runtime", command, ROOT / "runtime")
            wait_http(f"http://127.0.0.1:{args.runtime_port}/health", engine)
        mode = args.products[0] if len(args.products) == 1 else "suite"
        web = start("web", [node, str(vite), "--configLoader", "runner", "--mode", mode, "--host", "127.0.0.1", "--port", str(args.web_port), "--strictPort"], ROOT / "frontend")
        wait_http(f"http://127.0.0.1:{args.web_port}", web)
        print(f"Ordivant Suite: http://127.0.0.1:{args.web_port}", flush=True)
        for product in args.products:
            print(f"{product.title()} API: http://127.0.0.1:{product_ports[product]}/docs", flush=True)
        if not args.no_runtime:
            print(f"Pi runtime: http://127.0.0.1:{args.runtime_port}/health ({environment['ORDIVANT_RUNTIME_MODE']})", flush=True)
        print(f"Logs: {args.log_dir}\nCtrl+C stops this local session.", flush=True)
        while True:
            for name, process in processes:
                if process.poll() is not None:
                    raise RuntimeError(f"{name} stopped with code {process.returncode}; inspect {args.log_dir / (name + '.log')}")
            time.sleep(0.5)
    except KeyboardInterrupt:
        return 0
    finally:
        for _, process in reversed(processes):
            if process.poll() is None:
                process.terminate()
        for _, process in reversed(processes):
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        for handle in handles:
            handle.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from None
