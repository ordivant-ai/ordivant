"""Small real Responses/tool-call probe for the explicitly authorized test endpoint.

Only synthetic operands are sent. Credentials are read from an ignored local file,
never printed or written to reports; no redirects, fallback models or automatic retries.
"""
from __future__ import annotations

import argparse
import json
import time
import uuid
from pathlib import Path

import httpx

from configure_test_model import ConfigurationError, load_test_provider_config
from execution_test_credential import read_authorized_test_key

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--key-file", type=Path, help="Explicit credential file override; otherwise use ORDIVANT_TEST_PROVIDER_KEY_FILE")
    args = parser.parse_args()
    try:
        config = load_test_provider_config(args.key_file)
        key = read_authorized_test_key(args.key_file)
    except (ConfigurationError, RuntimeError) as exc:
        print(str(exc))
        return 2
    folder = ROOT / ".data/validation" / ("live-probe-" + uuid.uuid4().hex[:8])
    folder.mkdir(parents=True, exist_ok=True)
    report = {
        "provider_id": config.provider_id,
        "requested_model": config.model,
        "reasoning_effort": "low",
        "store": False,
        "max_output_tokens_per_request": 4096,
        "status": "running",
        "checks": {},
        "responses": [],
    }

    def check(name: str, passed: bool):
        report["checks"][name] = passed
        if not passed:
            raise RuntimeError(name)

    def response(client: httpx.Client, body: dict) -> dict:
        started = time.monotonic()
        completed = None
        with client.stream("POST", config.base_url + "/responses", json=body) as stream:
            if stream.status_code != 200:
                # Do not print upstream response bodies; they can echo credentials.
                raise RuntimeError(f"Provider returned HTTP {stream.status_code}")
            for line in stream.iter_lines():
                if not line.startswith("data:"):
                    continue
                text = line[5:].strip()
                if text == "[DONE]":
                    continue
                data = json.loads(text)
                kind = data.get("type", "")
                if kind in {"error", "response.failed", "response.incomplete"}:
                    raise RuntimeError("Provider stream failed or was incomplete")
                if kind == "response.completed":
                    completed = data.get("response")
        if not isinstance(completed, dict) or completed.get("status") != "completed":
            raise RuntimeError("Provider did not complete the response stream")
        report["responses"].append({
            "returned_model": completed.get("model"),
            "response_id": completed.get("id"),
            "elapsed_seconds": round(time.monotonic() - started, 3),
            "usage": completed.get("usage"),
        })
        return completed

    try:
        with httpx.Client(headers={"Authorization": "Bearer " + key}, timeout=120, trust_env=False,
                          follow_redirects=False) as client:
            catalog = client.get(config.base_url + "/models")
            check("model_catalog_http_200", catalog.status_code == 200)
            ids = {item.get("id") for item in catalog.json().get("data", [])}
            check("requested_model_in_catalog", config.model in ids)
            common = {
                "model": config.model, "store": False, "stream": True,
                "reasoning": {"effort": "low"}, "max_output_tokens": 4096,
                "include": ["reasoning.encrypted_content"],
            }
            tools = [{
                "type": "function", "name": "acceptance_add",
                "description": "Add the two provided synthetic integer operands.",
                "parameters": {"type": "object", "properties": {
                    "a": {"type": "integer"}, "b": {"type": "integer"}},
                    "required": ["a", "b"], "additionalProperties": False}, "strict": True,
            }]
            inputs = [{"role": "user", "content": "Use acceptance_add to calculate 19 plus 23. After its result, reply only MODEL_TOOL_OK=42."}]
            first = response(client, {**common, "input": inputs, "tools": tools,
                                      "tool_choice": {"type": "function", "name": "acceptance_add"}})
            calls = [item for item in first.get("output", []) if item.get("type") == "function_call"]
            check("model_issued_function_call", len(calls) == 1 and calls[0].get("name") == "acceptance_add")
            arguments = json.loads(calls[0]["arguments"])
            check("tool_arguments_match_synthetic_input", arguments == {"a": 19, "b": 23})
            inputs.extend(first["output"])
            inputs.append({"type": "function_call_output", "call_id": calls[0]["call_id"],
                           "output": json.dumps({"result": arguments["a"] + arguments["b"]})})
            second = response(client, {**common, "input": inputs, "tools": tools, "tool_choice": "none"})
            answer = "\n".join(part.get("text", "") for item in second.get("output", [])
                               if item.get("type") == "message" for part in item.get("content", [])
                               if part.get("type") == "output_text")
            check("model_used_returned_tool_result", answer.strip() == "MODEL_TOOL_OK=42")
        report["status"] = "passed"
        report["answer"] = "MODEL_TOOL_OK=42"
        report["billing"] = "Upstream token usage observed; invoice/currency not verified"
        exit_code = 0
    except Exception as exc:
        report["status"] = "failed"
        report["error"] = str(exc).replace(key, "[redacted]")[:300] if isinstance(exc, RuntimeError) else type(exc).__name__
        exit_code = 1
    (folder / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"LIVE_MODEL_PROBE_{report['status'].upper()}: {folder / 'report.json'}")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
