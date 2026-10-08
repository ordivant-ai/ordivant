"""Run a QA-only headless browser script with synthetic credentials in memory."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import subprocess

from auth_acceptance import QA_EMAIL, QA_PASSWORD
from execution_acceptance import OWNER, ROOT, docker


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("script", type=Path)
    parser.add_argument("--report", type=Path, help="Owned, credential-free live QA report")
    args = parser.parse_args()
    script = args.script.resolve()
    if not script.is_relative_to(ROOT) or script.suffix != ".cjs":
        raise ValueError("Browser script must be a workspace .cjs file")
    if docker("inspect", "--format", '{{index .Config.Labels "com.docker.compose.project"}}', OWNER + "-web-1").strip() != OWNER:
        raise ValueError("QA web owner mismatch")
    environment = os.environ.copy()
    temporary = ROOT / ".cache/browser-qa/tmp"
    temporary.mkdir(parents=True, exist_ok=True)
    environment.update(ORDIVANT_QA_EMAIL=QA_EMAIL, ORDIVANT_QA_PASSWORD=QA_PASSWORD, TMP=str(temporary), TEMP=str(temporary))
    if args.report:
        report = args.report.resolve()
        if not report.is_relative_to(ROOT / ".data/validation") or report.suffix != ".json":
            raise ValueError("Browser report must be a local validation JSON")
        environment["ORDIVANT_QA_LIVE_REPORT"] = str(report)
    return subprocess.run(["node", str(script)], env=environment, cwd=ROOT).returncode


if __name__ == "__main__":
    raise SystemExit(main())
