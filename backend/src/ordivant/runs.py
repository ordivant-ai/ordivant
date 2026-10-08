from __future__ import annotations

import hashlib
import hmac
import json
import re
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from .errors import DomainError, bad_request, conflict, forbidden, not_found
from .models import (
    Agent,
    Artifact,
    AuditEvent,
    Execution,
    ModelProviderSetting,
    OutboxEvent,
    Principal,
    Project,
    RunEvent,
    RunMirror,
    RunToolConnectionSnapshot,
    Task,
)
from .security import hash_secret, new_id, now_utc, principal_projects

_SENSITIVE_KEY = re.compile(r"(token|secret|credential|password|authorization|cookie|header|api.?key|ciphertext|environment)", re.I)
_SECRET_TEXT = re.compile(r"(?i)(bearer\s+\S+|(?:ovt|lease|delivery)_[A-Za-z0-9._-]+|(?:api[_-]?key|token|secret)\s*[:=]\s*\S+)")
_STATUSES = {"queued", "running", "paused", "done", "failed", "aborted"}
_TERMINAL = {"done", "failed", "aborted"}
_EVENT_LIMIT = 1000


def _loads(value: str | None, default):
    try:
        return json.loads(value) if value is not None else default
    except (TypeError, json.JSONDecodeError):
        return default


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _clean_text(value: str, limit: int = 4000, secrets: tuple[str, ...] = ()) -> str:
    result = _SECRET_TEXT.sub("[redacted]", value)
    for secret in secrets:
        if secret:
            result = result.replace(secret, "[redacted]")
    return result[:limit]


def _clean_value(value, depth: int = 0, secrets: tuple[str, ...] = ()):
    if depth > 6:
        return "[truncated]"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return _clean_text(value, 4000, secrets)
    if isinstance(value, list):
        return [_clean_value(item, depth + 1, secrets) for item in value[:100]]
    if isinstance(value, dict):
        result = {}
        for key, item in list(value.items())[:100]:
            name = str(key)[:100]
            if _SENSITIVE_KEY.search(name):
                continue
            result[name] = _clean_value(item, depth + 1, secrets)
        return result
    return _clean_text(str(value), 1000, secrets)


def _safe_selection(value, secrets: tuple[str, ...] = ()):
    if not isinstance(value, dict):
        return None
    keys = ("provider_id", "model_id", "reasoning_effort", "max_output_tokens")
    return {key: _clean_value(value[key], secrets=secrets) for key in keys if key in value}


def _safe_receipt(value: dict | None, secrets: tuple[str, ...] = ()) -> dict | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise bad_request("run_receipt_invalid", "Run receipt 格式無效")
    mode = value.get("mode")
    if mode not in {"demo", "live"}:
        raise bad_request("run_receipt_invalid", "Run receipt mode 無效")
    returned = value.get("returned")
    safe_returned = None
    if isinstance(returned, dict):
        safe_returned = {key: _clean_value(returned[key], secrets=secrets) for key in ("provider_id", "model_id") if key in returned}
    usage = value.get("usage")
    safe_usage = None
    if isinstance(usage, dict):
        safe_usage = {}
        for key in ("input_tokens", "uncached_input_tokens", "cached_input_tokens", "cache_write_tokens", "output_tokens", "total_tokens"):
            item = usage.get(key)
            safe_usage[key] = item if isinstance(item, int) and item >= 0 else None
    tools = []
    for item in value.get("tools", [])[:100] if isinstance(value.get("tools", []), list) else []:
        if isinstance(item, dict) and isinstance(item.get("name"), str):
            calls = item.get("calls")
            tools.append({"name": _clean_text(item["name"], 200, secrets), "calls": calls if isinstance(calls, int) and calls >= 0 else 0})
    return {
        "mode": mode,
        "requested": _safe_selection(value.get("requested"), secrets),
        "returned": safe_returned,
        "usage": safe_usage,
        "tools": tools,
        "cost_usd": None,
    }


def run_json(run: RunMirror) -> dict:
    return {
        "id": run.id,
        "project_id": run.project_id,
        "task_id": run.task_id,
        "agent_id": run.agent_id,
        "execution_id": run.execution_id,
        "status": run.status,
        "desired_action": run.desired_action,
        "control_revision": run.control_revision,
        "retry_of": run.retry_of,
        "mode": run.mode,
        "model_config": _loads(run.model_config_json, None),
        "receipt": _loads(run.receipt_json, None),
        "answer": run.answer,
        "error": run.error,
        "created_at": _iso(run.created_at),
        "updated_at": _iso(run.updated_at),
        "started_at": _iso(run.started_at),
        "finished_at": _iso(run.finished_at),
        "sandbox": _loads(run.sandbox_json, None),
    }


def run_events_json(session: Session, run_id: str, after_sequence: int) -> list[dict]:
    rows = session.scalars(
        select(RunEvent).where(RunEvent.run_id == run_id, RunEvent.sequence > after_sequence).order_by(RunEvent.sequence)
    )
    return [
        {"sequence": row.sequence, "kind": row.kind, "created_at": _iso(row.created_at), "data": _loads(row.data_json, {})}
        for row in rows
    ]


def _require_run(session: Session, actor: Principal, run_id: str) -> tuple[RunMirror, Project]:
    run = session.get(RunMirror, run_id)
    if run is None:
        raise not_found("找不到 run")
    from .service import require_project

    project = require_project(session, actor, run.project_id)
    return run, project


def list_runs(session: Session, actor: Principal, project_id: str | None, task_id: str | None, status: str | None) -> list[dict]:
    project_ids = principal_projects(session, actor.id)
    if project_id:
        from .service import require_project

        require_project(session, actor, project_id)
        project_ids = [project_id]
    if task_id:
        from .service import task_for_actor

        task = task_for_actor(session, actor, task_id)
        project_ids = [task.project_id]
    if status and status not in _STATUSES:
        raise bad_request("run_status_invalid", "Run status 不存在")
    if not project_ids:
        return []
    stmt = select(RunMirror).where(RunMirror.project_id.in_(project_ids))
    if task_id:
        stmt = stmt.where(RunMirror.task_id == task_id)
    if status:
        stmt = stmt.where(RunMirror.status == status)
    return [run_json(row) for row in session.scalars(stmt.order_by(RunMirror.created_at.desc()).limit(200))]


def get_run(session: Session, actor: Principal, run_id: str) -> dict:
    run, _ = _require_run(session, actor, run_id)
    return run_json(run)


def get_run_events(session: Session, actor: Principal, run_id: str, after_sequence: int) -> list[dict]:
    run, _ = _require_run(session, actor, run_id)
    return run_events_json(session, run.id, after_sequence)


def _audit(session: Session, actor: Principal, run: RunMirror, action: str, data: dict) -> None:
    session.add(
        AuditEvent(
            id=new_id(), project_id=run.project_id, actor_id=actor.id, action=action,
            entity_type="run", entity_id=run.id,
            data_json=json.dumps(_clean_value(data), ensure_ascii=False, separators=(",", ":")), created_at=now_utc(),
        )
    )


def _append_event(session: Session, run: RunMirror, kind: str, data: dict, secrets: tuple[str, ...] = ()) -> None:
    latest = session.scalar(select(RunEvent.sequence).where(RunEvent.run_id == run.id).order_by(RunEvent.sequence.desc()).limit(1)) or 0
    session.add(
        RunEvent(
            id=new_id(), run_id=run.id, sequence=latest + 1, kind=kind,
            data_json=json.dumps(_clean_value(data, secrets=secrets), ensure_ascii=False, separators=(",", ":")), created_at=now_utc(),
        )
    )
    session.flush()
    stale_ids = list(
        session.scalars(
            select(RunEvent.id).where(RunEvent.run_id == run.id).order_by(RunEvent.sequence.desc()).offset(_EVENT_LIMIT)
        )
    )
    if stale_ids:
        session.query(RunEvent).filter(RunEvent.id.in_(stale_ids)).delete(synchronize_session=False)


def _fence_execution(session: Session, run: RunMirror, *, keep_agent_busy: bool) -> None:
    task = session.get(Task, run.task_id)
    execution = session.get(Execution, run.execution_id) if run.execution_id else None
    if execution is None:
        execution = session.scalar(
            select(Execution).where(
                Execution.task_id == run.task_id,
                Execution.agent_id == run.agent_id,
                Execution.status == "running",
            ).order_by(Execution.started_at.desc())
        )
    if execution and execution.status == "running":
        execution.status = "released"
        execution.finished_at = now_utc()
        execution.lease_token_hash = None
        run.execution_id = execution.id
    agent = session.get(Agent, run.agent_id)
    if agent:
        agent.status = "busy" if keep_agent_busy else "available"
    if task and task.status != "cancelled":
        task.status = "ready"
        task.blocked_reason = None
        task.progress = 0
        task.updated_at = now_utc()


def stop_task_runs(session: Session, actor: Principal, task: Task) -> None:
    runs = list(session.scalars(select(RunMirror).where(RunMirror.task_id == task.id).where(RunMirror.status.not_in(_TERMINAL))))
    for run in runs:
        event = session.get(OutboxEvent, run.id)
        if event is None:
            continue
        run.desired_action = "stop"
        run.control_revision += 1
        run.updated_at = now_utc()
        if event.status == "pending":
            event.status = "cancelled"
            event.delivery_token_hash = None
            event.claim_expires_at = None
            event.worker_id = None
            run.status = "aborted"
            run.finished_at = now_utc()
            run.desired_action = None
            _fence_execution(session, run, keep_agent_busy=False)
        else:
            _fence_execution(session, run, keep_agent_busy=True)
        _append_event(session, run, "control", {"action": "stop", "source": "task_cancel"})
        _audit(session, actor, run, "run.stop_requested", {"source": "task_cancel"})


def _require_manager(actor: Principal) -> None:
    if actor.kind != "human" or actor.role not in {"admin", "manager"} or not actor.active:
        raise forbidden("只有 project manager 或 admin 可控制 run")


def _validate_execution_live(session: Session, run: RunMirror) -> Execution:
    execution = session.get(Execution, run.execution_id) if run.execution_id else None
    if (
        execution is None
        or execution.status != "running"
        or execution.task_id != run.task_id
        or execution.agent_id != run.agent_id
        or execution.lease_token_hash is None
        or execution.lease_expires_at.replace(tzinfo=UTC) <= now_utc()
    ):
        raise conflict("execution_lease_lost", "Run execution lease 已失效，無法恢復")
    return execution


def control_run(session: Session, actor: Principal, run_id: str, action: str) -> dict:
    _require_manager(actor)
    run, _project = _require_run(session, actor, run_id)
    run = session.scalar(select(RunMirror).where(RunMirror.id == run.id).with_for_update()) or run
    event = session.scalar(select(OutboxEvent).where(OutboxEvent.id == run.id).with_for_update())
    task = session.get(Task, run.task_id)
    if event is None or task is None:
        raise not_found("找不到 run")
    if action == "retry":
        if run.status not in {"failed", "aborted"} or task.status != "ready":
            raise conflict("run_not_retryable", "只有 task 為 ready 的 failed/aborted run 可 retry")
        if event.status in {"pending", "claimed"}:
            raise conflict("run_delivery_active", "原 run 的 runtime delivery 尚未結束")
        from .service import dispatch_task

        dispatched = dispatch_task(session, actor, task.id, run.agent_id)
        retry = session.get(RunMirror, dispatched["id"])
        if retry is None:
            raise DomainError(500, "run_create_failed", "Retry run 建立失敗")
        retry.retry_of = run.id
        session.flush()
        _append_event(session, retry, "control", {"action": "retry", "retry_of": run.id})
        _audit(session, actor, retry, "run.retried", {"retry_of": run.id})
        return run_json(retry)

    if action == "pause":
        if run.status in _TERMINAL or run.desired_action == "stop":
            raise conflict("run_control_conflict", "Run 目前不可 pause")
        if run.desired_action == "pause" or run.status == "paused":
            return run_json(run)
        if run.desired_action != "pause":
            run.desired_action = "pause"
            run.control_revision += 1
    elif action == "resume":
        if run.desired_action == "stop" or run.status in {"done", "failed", "aborted"}:
            raise conflict("run_control_conflict", "Run 目前不可 resume")
        if run.desired_action == "resume":
            return run_json(run)
        if run.status == "paused" or run.desired_action == "pause":
            if run.execution_id:
                _validate_execution_live(session, run)
            run.desired_action = "resume"
            run.control_revision += 1
        elif run.status == "running" and run.desired_action is None:
            return run_json(run)
        else:
            raise conflict("run_control_conflict", "Run 尚未到可 resume 的狀態")
    elif action == "stop":
        if run.status == "done":
            raise conflict("run_control_conflict", "已完成的 Run 不可 stop")
        if run.desired_action == "stop" and event.status == "claimed":
            return run_json(run)
        if run.status == "aborted" and event.status not in {"pending", "claimed"}:
            return run_json(run)
        if run.desired_action != "stop":
            run.desired_action = "stop"
            run.control_revision += 1
        if event.status == "pending":
            event.status = "cancelled"
            event.delivery_token_hash = None
            event.claim_expires_at = None
            event.worker_id = None
            run.status = "aborted"
            run.finished_at = now_utc()
            run.desired_action = None
            _fence_execution(session, run, keep_agent_busy=False)
        else:
            _fence_execution(session, run, keep_agent_busy=True)
    else:
        raise bad_request("run_control_invalid", "Run control action 無效")

    run.updated_at = now_utc()
    _append_event(session, run, "control", {"action": action, "control_revision": run.control_revision})
    _audit(session, actor, run, f"run.{action}_requested", {"control_revision": run.control_revision})
    session.flush()
    return run_json(run)


def list_runtime_controls(session: Session, actor: Principal, worker_id: str) -> list[dict]:
    if actor.kind != "runtime" or not actor.active:
        raise forbidden("只有 runtime 可讀取 run controls")
    project_ids = principal_projects(session, actor.id)
    if not project_ids:
        return []
    rows = session.scalars(
        select(RunMirror)
        .join(OutboxEvent, OutboxEvent.id == RunMirror.id)
        .where(
            RunMirror.project_id.in_(project_ids),
            OutboxEvent.status == "claimed",
            OutboxEvent.worker_id == worker_id,
            OutboxEvent.claim_expires_at > now_utc(),
            RunMirror.desired_action.is_not(None),
        )
        .order_by(RunMirror.created_at)
    )
    return [{"id": row.id, "desired_action": row.desired_action, "control_revision": row.control_revision} for row in rows]


def _safe_sandbox(value: dict | None) -> dict | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise bad_request("sandbox_summary_invalid", "Sandbox summary 格式無效")
    status = value.get("status")
    if status not in {"ready", "stopped", "failed", "lost"}:
        raise bad_request("sandbox_summary_invalid", "Sandbox summary status 無效")
    return {
        "run_id": str(value.get("run_id", ""))[:100],
        "status": status,
        "workspace_available": bool(value.get("workspace_available", False)),
    }


def _terminalize_outbox(session: Session, actor: Principal, run: RunMirror, event: OutboxEvent, status: str) -> None:
    from .model_settings import revoke_runtime_credential

    event.status = "failed" if status == "failed" else "delivered"
    event.error = _clean_text(run.error or "", 1000) if status == "failed" else None
    event.delivery_token_hash = None
    event.claim_expires_at = None
    event.updated_at = now_utc()
    revoke_runtime_credential(session, event.id, event.agent_id)
    agent = session.get(Agent, event.agent_id)
    still_running = session.scalar(
        select(Execution.id).where(Execution.agent_id == event.agent_id, Execution.status == "running").limit(1)
    )
    if agent and not still_running:
        agent.status = "available"
    _audit(session, actor, run, "run.runtime_terminal", {"status": status})


def _known_runtime_secrets(session: Session, run: RunMirror, project: Project, delivery_token: str) -> tuple[str, ...]:
    from .model_settings import _decrypt_secret

    values = {delivery_token}
    snapshots = session.scalars(
        select(RunToolConnectionSnapshot).where(RunToolConnectionSnapshot.run_id == run.id)
    )
    for snapshot in snapshots:
        if snapshot.auth_token_ciphertext:
            values.add(_decrypt_secret(snapshot.auth_token_ciphertext, project.organization_id, snapshot.connection_id))
    selection = _loads(run.model_config_json, None)
    if isinstance(selection, dict):
        provider = session.get(ModelProviderSetting, (project.organization_id, selection.get("provider_id")))
        if provider and provider.api_key_ciphertext:
            values.add(_decrypt_secret(provider.api_key_ciphertext, project.organization_id, provider.provider_id))
    return tuple(sorted((value for value in values if value), key=len, reverse=True))


def _require_submitted_execution(session: Session, run: RunMirror, execution_id: str | None) -> None:
    if not execution_id:
        raise conflict("run_completion_unsubmitted", "Run done 必須對應已提交成果的 Execution")
    execution = session.get(Execution, execution_id)
    if (
        execution is None
        or execution.id != run.execution_id
        or execution.task_id != run.task_id
        or execution.agent_id != run.agent_id
        or execution.status not in {"submitted", "accepted", "rejected"}
        or execution.finished_at is None
    ):
        raise conflict("run_completion_unsubmitted", "Run done 必須對應已提交成果的 Execution")
    artifact_id = session.scalar(
        select(Artifact.id)
        .where(Artifact.task_id == run.task_id, Artifact.execution_id == execution.id)
        .limit(1)
    )
    if artifact_id is None:
        raise conflict("run_completion_unsubmitted", "Run done 必須包含已提交的 Execution Artifact")


def sync_run(session: Session, actor: Principal, run_id: str, value: dict) -> dict:
    if actor.kind != "runtime" or not actor.active:
        raise forbidden("只有 runtime 可同步 run")
    run = session.scalar(select(RunMirror).where(RunMirror.id == run_id).with_for_update())
    event = session.scalar(select(OutboxEvent).where(OutboxEvent.id == run_id).with_for_update()) if run else None
    project = session.get(Project, run.project_id) if run else None
    if (
        run is None or event is None or project is None or actor.organization_id != project.organization_id
        or run.project_id not in principal_projects(session, actor.id)
    ):
        raise not_found("找不到 run")
    if event.worker_id != value["worker_id"]:
        raise conflict("delivery_lease_invalid", "runtime outbox ownership 已變更")
    token_hash = hash_secret(value["delivery_token"])
    request_without_token = {key: item for key, item in value.items() if key != "delivery_token"}
    request_without_token["delivery_token_hash"] = token_hash
    sync_hash = hashlib.sha256(json.dumps(request_without_token, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str).encode()).hexdigest()
    sequence = value["sequence"]
    if event.status != "claimed":
        if (
            run.status in _TERMINAL
            and sequence == run.last_sync_sequence
            and run.last_sync_hash is not None
            and hmac.compare_digest(run.last_sync_hash, sync_hash)
        ):
            return run_json(run)
        raise conflict("delivery_lease_invalid", "runtime outbox ownership 已變更")
    if event.claim_expires_at is None or event.claim_expires_at.replace(tzinfo=UTC) <= now_utc():
        raise conflict("delivery_lease_expired", "runtime outbox claim 已過期")
    if not event.delivery_token_hash or not hmac.compare_digest(event.delivery_token_hash, token_hash):
        raise conflict("delivery_token_invalid", "runtime delivery fence 無效")
    known_secrets = _known_runtime_secrets(session, run, project, value["delivery_token"])

    if sequence < run.last_sync_sequence:
        raise conflict("run_sync_stale", "Run sync sequence 已過期")
    if sequence == run.last_sync_sequence:
        if run.last_sync_hash == sync_hash:
            return run_json(run)
        raise conflict("run_sync_conflict", "相同 Run sync sequence 的內容不同")
    if value["status"] not in _STATUSES:
        raise bad_request("run_status_invalid", "Run status 無效")
    if run.status in _TERMINAL and value["status"] != run.status:
        raise conflict("run_terminal", "Run 已進入終止狀態")
    if run.desired_action == "stop" and value["status"] == "done":
        raise conflict("run_stopping", "Run stop 已送出，不可回報 done")
    if run.desired_action == "stop" and value["status"] in {"queued", "running", "paused"}:
        raise conflict("run_stopping", "Run stop 已送出，runtime 必須停止並回報 terminal status")
    if value.get("execution_id"):
        execution = session.get(Execution, value["execution_id"])
        if execution is None or execution.task_id != run.task_id or execution.agent_id != run.agent_id:
            raise conflict("run_execution_mismatch", "Execution 不屬於此 run")
        if run.execution_id and run.execution_id != execution.id:
            raise conflict("run_execution_changed", "Run execution ownership 已改變")
        run.execution_id = execution.id
    if value["status"] == "done":
        _require_submitted_execution(session, run, run.execution_id)
    expected_mode = "live" if run.model_config_json else "demo"
    if value.get("mode") is not None and value["mode"] != expected_mode:
        raise conflict("run_mode_mismatch", "Runtime mode 與 dispatch snapshot 不符")
    if value.get("mode") is not None:
        run.mode = value["mode"]
    old_status = run.status
    run.status = value["status"]
    if run.status == "running" and run.started_at is None:
        run.started_at = now_utc()
    if run.status in _TERMINAL:
        run.finished_at = now_utc()
        run.desired_action = None
    elif run.status == "running" and run.desired_action == "resume":
        run.desired_action = None
    run.receipt_json = json.dumps(_safe_receipt(value.get("receipt"), known_secrets), ensure_ascii=False, separators=(",", ":")) if value.get("receipt") is not None else run.receipt_json
    if value.get("answer") is not None:
        run.answer = _clean_text(value["answer"], 100000, known_secrets)
    if value.get("error") is not None:
        run.error = _clean_text(value["error"], 4000, known_secrets)
    sandbox = _safe_sandbox(value.get("sandbox"))
    if sandbox is not None:
        run.sandbox_json = json.dumps(sandbox, separators=(",", ":"))
    for entry in value.get("events", []):
        _append_event(session, run, entry["kind"], entry.get("data", {}), known_secrets)
    if old_status != run.status:
        _append_event(session, run, "status", {"from": old_status, "to": run.status})
    run.last_sync_sequence = sequence
    run.last_sync_hash = sync_hash
    run.updated_at = now_utc()
    if run.status in {"failed", "aborted"}:
        _fence_execution(session, run, keep_agent_busy=False)
    if run.status in _TERMINAL:
        _terminalize_outbox(session, actor, run, event, run.status)
    else:
        _audit(session, actor, run, "run.runtime_synced", {"sequence": sequence, "status": run.status})
    session.flush()
    return run_json(run)
