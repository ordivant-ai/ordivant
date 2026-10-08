"""HTTP acceptance for isolated OIDC and SAML-broker SSO on loopback QA only."""

from __future__ import annotations

import argparse
from html.parser import HTMLParser
from http.cookiejar import Cookie
import json
from pathlib import Path
import time
import uuid
import xml.etree.ElementTree as ET
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit, urlunsplit

import httpx

from auth_acceptance import QA_EMAIL, QA_PASSWORD
from sso_fixture import (
    BROKER_REALM,
    FIXTURE_ADMIN_CLIENT_ID,
    FIXTURE_ADMIN_CLIENT_SECRET,
    OIDC_CLIENT_ID,
    OIDC_CLIENT_SECRET,
    SAML_IDP_ALIAS,
    SAML_CLIENT_ID,
    SAML_FIXTURE_ADMIN_CLIENT_ID,
    SAML_FIXTURE_ADMIN_CLIENT_SECRET,
    SAML_REALM,
)


ROOT = Path(__file__).resolve().parents[1]
APP_ORIGIN = "http://127.0.0.1:8092"
KEYCLOAK_ORIGIN = "http://127.0.0.1:8093"
PRODUCTS = {
    "work": {"prefix": "/api", "me": "/api/me", "collection": "/api/projects", "scope_field": "project_ids", "role": "manager"},
    "knowledge": {"prefix": "/knowledge-api", "me": "/knowledge-api/me", "collection": "/knowledge-api/spaces", "scope_field": "scope_ids", "role": "writer"},
    "code": {"prefix": "/code-api", "me": "/code-api/me", "collection": "/code-api/projects", "scope_field": "scope_ids", "role": "writer"},
}
ISSUER = f"{KEYCLOAK_ORIGIN}/realms/{BROKER_REALM}"
CALLBACK_PATH = "/auth-api/oidc/callback"
KEYCLOAK_FLOW_COOKIE_NAMES = {
    "AUTH_SESSION_ID",
    "AUTH_SESSION_ID_LEGACY",
    "KC_RESTART",
    "KC_RESTART_AUTH_SESSION",
}
BROWSER_FLOW_FAILURES = {
    "browser_http_error",
    "cookie_not_found",
    "credential_form_repeated_after_post",
    "expired_login",
    "idp_page_http_error",
    "idp_page_has_no_recognized_form",
    "idp_form_post_http_error",
    "idp_redirect_limit",
    "invalid_code",
    "invalid_credentials",
    "session_cookie_not_sent",
    "untrusted_idp_redirect",
    "untrusted_login_form_action",
    "untrusted_saml_form_action",
}


class BrowserFlowFailure(Exception):
    def __init__(self, reason: str, http_status: int | None = None) -> None:
        if reason not in BROWSER_FLOW_FAILURES:
            raise ValueError("Unknown browser-flow failure reason")
        self.reason = reason
        self.http_status = http_status
        super().__init__(reason)


class LoginPage(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.forms: list[dict] = []
        self.links: list[dict] = []
        self._form: dict | None = None
        self._link: dict | None = None
        self.referrer_policy = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "meta" and (attributes.get("name") or "").casefold() == "referrer":
            self.referrer_policy = (attributes.get("content") or "").casefold().strip()
        elif tag == "form":
            self._form = {
                "action": attributes.get("action", ""),
                "method": attributes.get("method", "get").lower(),
                "fields": {},
                "submitters": [],
                "controls": [],
            }
            self.forms.append(self._form)
        elif tag == "input" and self._form is not None:
            name = attributes.get("name")
            input_type = (attributes.get("type") or "text").lower()
            disabled = "disabled" in attributes
            checked = "checked" in attributes
            successful = bool(name) and not disabled and input_type not in {"button", "file", "image", "reset", "submit"}
            if input_type in {"checkbox", "radio"} and not checked:
                successful = False
            control = {"name": name or "", "type": input_type, "disabled": disabled, "checked": checked, "successful": successful}
            self._form["controls"].append(control)
            if input_type == "submit" and name and not disabled:
                self._form["submitters"].append({"name": name, "value": attributes.get("value") or ""})
            elif successful:
                value = attributes.get("value") or ""
                if input_type in {"checkbox", "radio"} and "value" not in attributes:
                    value = "on"
                self._form["fields"][name] = value
        elif tag == "button" and self._form is not None:
            name = attributes.get("name")
            button_type = (attributes.get("type") or "submit").lower()
            disabled = "disabled" in attributes
            if name:
                self._form["controls"].append({"name": name, "type": button_type, "disabled": disabled, "checked": False, "successful": False})
            if name and button_type == "submit" and not disabled:
                self._form["submitters"].append({"name": name, "value": attributes.get("value") or ""})
        elif tag == "a":
            self._link = {"href": attributes.get("href", ""), "text": ""}
            self.links.append(self._link)

    def handle_endtag(self, tag: str) -> None:
        if tag == "form":
            self._form = None
        elif tag == "a":
            self._link = None

    def handle_data(self, data: str) -> None:
        if self._link is not None:
            self._link["text"] += data


class VisibleErrorMessage(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.messages: list[str] = []
        self._capture_stack: list[str] = []
        self._void_tags = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        classes = set((attributes.get("class") or "").split())
        if attributes.get("id") == "kc-error-message" or "kc-feedback-text" in classes or self._capture_stack:
            if tag not in self._void_tags:
                self._capture_stack.append(tag)

    def handle_endtag(self, tag: str) -> None:
        for index in range(len(self._capture_stack) - 1, -1, -1):
            if self._capture_stack[index] == tag:
                del self._capture_stack[index:]
                break

    def handle_data(self, data: str) -> None:
        if self._capture_stack:
            self.messages.append(data)


def browser_form_error_class(response: httpx.Response, *, fallback: str = "idp_form_post_http_error") -> str:
    parser = VisibleErrorMessage()
    parser.feed(response.text[:131072])
    message = " ".join(" ".join(parser.messages).split())[:512].casefold()
    if "cookie not found" in message or "cookie_not_found" in message:
        return "cookie_not_found"
    if "invalid code" in message or "invalid_code" in message:
        return "invalid_code"
    if "expired" in message or "login has expired" in message:
        return "expired_login"
    if "invalid username" in message or "invalid password" in message or "invalid credentials" in message:
        return "invalid_credentials"
    return fallback


def _cookie_path_matches(cookie_path: str, request_path: str) -> bool:
    cookie_path = cookie_path or "/"
    request_path = request_path or "/"
    if request_path == cookie_path:
        return True
    if not request_path.startswith(cookie_path):
        return False
    return cookie_path.endswith("/") or request_path[len(cookie_path):len(cookie_path) + 1] == "/"


def _cookie_domain_matches(cookie: Cookie, host: str) -> bool:
    domain = cookie.domain.lstrip(".").casefold()
    host = host.casefold()
    return host == domain or (cookie.domain_specified and host.endswith("." + domain))


def browser_cookie_state(browser: httpx.Client, action: str, *, method: str = "POST") -> dict[str, bool]:
    parts = urlsplit(action)
    applicable = [
        cookie for cookie in browser.cookies.jar
        if _cookie_domain_matches(cookie, parts.hostname or "") and _cookie_path_matches(cookie.path, parts.path)
        and (cookie.expires is None or cookie.expires > time.time())
    ]
    flow_cookies = [cookie for cookie in applicable if cookie.name in KEYCLOAK_FLOW_COOKIE_NAMES]
    probe = httpx.Request(method.upper(), action)
    browser.cookies.set_cookie_header(probe)
    sent_names = {item.partition("=")[0].strip() for item in probe.headers.get("cookie", "").split(";") if "=" in item}
    return {
        "flow_cookie_in_jar": bool(flow_cookies),
        "secure_flow_cookie_blocked": parts.scheme == "http" and any(cookie.secure for cookie in flow_cookies),
        "flow_cookie_sent": any(cookie.name in sent_names for cookie in flow_cookies),
    }


def active_response_cookie_names(response: httpx.Response) -> set[str]:
    now = time.time()
    return {
        cookie.name
        for cookie in response.cookies.jar
        if cookie.value and (cookie.expires is None or cookie.expires > now)
    }


def browser_form_headers(page: httpx.Response, action: str, meta_policy: str) -> tuple[dict[str, str], str]:
    source = urlsplit(str(page.url))
    target = urlsplit(action)
    source_origin = f"{source.scheme}://{source.netloc}"
    same_origin = source.scheme == target.scheme and source.netloc == target.netloc
    policy = (page.headers.get("Referrer-Policy") or meta_policy or "strict-origin-when-cross-origin").casefold().strip()
    policy = policy.split(",", 1)[0].strip()
    headers = {"Origin": source_origin}
    if policy == "no-referrer" or (policy == "same-origin" and not same_origin):
        return headers, "none"
    if policy in {"origin", "strict-origin"} or not same_origin:
        if policy.startswith("strict-") and source.scheme == "https" and target.scheme == "http":
            return headers, "none"
        headers["Referer"] = source_origin + "/"
        return headers, "origin"
    headers["Referer"] = str(page.url)
    return headers, "full"


def browser_form_data(form: dict) -> dict[str, str]:
    fields = dict(form["fields"])
    if form["submitters"]:
        submitter = form["submitters"][0]
        fields[submitter["name"]] = submitter["value"]
    return fields


def loopback_secure_cookie_header(
    browser: httpx.Client,
    action: str,
    *,
    app_origin: str,
    keycloak_origin: str,
    method: str = "POST",
) -> str | None:
    if app_origin != APP_ORIGIN or keycloak_origin != KEYCLOAK_ORIGIN:
        return None
    parts = urlsplit(action)
    if parts.scheme != "http" or parts.netloc != urlsplit(KEYCLOAK_ORIGIN).netloc:
        return None
    if method.upper() not in {"GET", "POST"}:
        return None
    state = browser_cookie_state(browser, action, method=method)
    if not state["secure_flow_cookie_blocked"]:
        return None
    secure_url = urlunsplit(("https", parts.netloc, parts.path, parts.query, ""))
    secure_probe = httpx.Request(method.upper(), secure_url)
    browser.cookies.set_cookie_header(secure_probe)
    cookie_header = secure_probe.headers.get("cookie", "")
    sent_names = {item.partition("=")[0].strip() for item in cookie_header.split(";") if "=" in item}
    return cookie_header if sent_names.intersection(KEYCLOAK_FLOW_COOKIE_NAMES) else None


class Acceptance:
    def __init__(self, base: str, keycloak: str) -> None:
        self.base = base
        self.keycloak = keycloak
        self.run = uuid.uuid4().hex[:8]
        self.checks: dict[str, bool] = {}
        self.diagnostics: dict[str, list[bool | str]] = {}
        self.current_check = "startup"
        self.directory = ROOT / ".data" / "validation" / f"sso-{self.run}"
        self.directory.mkdir(parents=True, exist_ok=False)
        self.origin_headers = {"Origin": self.base}
        self.admin = httpx.Client(base_url=base, headers=self.origin_headers, timeout=20, trust_env=False, follow_redirects=False)
        self.anonymous = httpx.Client(base_url=base, headers=self.origin_headers, timeout=20, trust_env=False, follow_redirects=False)
        self.kc = httpx.Client(base_url=keycloak, timeout=15, trust_env=False, follow_redirects=False)
        self.kc_admin_token = ""
        self.saml_admin_token = ""
        self.resource_ids: dict[str, str] = {}
        self.code_internal_scope_id: str | None = None
        self.oidc_start_requests = 0
        self.failure_http_status: int | None = None

    def check(self, name: str, result: bool, *, http_status: int | None = None) -> None:
        self.current_check = name
        accumulated = self.checks.get(name, True) and bool(result)
        self.checks[name] = accumulated
        if not accumulated:
            if http_status is not None:
                self.failure_http_status = http_status
            raise AssertionError(name)

    def diagnose(self, name: str, value: bool | str) -> None:
        self.diagnostics.setdefault(name, []).append(value)

    def browser_request(
        self,
        browser: httpx.Client,
        method: str,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        data: dict[str, str] | None = None,
    ) -> httpx.Response:
        request = browser.build_request(method, url, headers=headers, data=data)
        target = urlsplit(url)
        app = urlsplit(self.base)
        if target.scheme == app.scheme and target.netloc == app.netloc and target.path == CALLBACK_PATH:
            self.diagnose("browser_app_callback_idp_cookie_emulation_applied", False)
            return browser.send(request)

        keycloak = urlsplit(self.keycloak)
        if target.scheme != keycloak.scheme or target.netloc != keycloak.netloc:
            return browser.send(request)

        state = browser_cookie_state(browser, url, method=method)
        cookie_header = loopback_secure_cookie_header(
            browser,
            url,
            app_origin=self.base,
            keycloak_origin=self.keycloak,
            method=method,
        )
        if method.upper() == "GET":
            self.diagnose("browser_idp_get_secure_cookie_blocked_by_httpx", state["secure_flow_cookie_blocked"])
            self.diagnose("browser_idp_get_loopback_secure_cookie_emulation_applied", bool(cookie_header))
            if state["secure_flow_cookie_blocked"]:
                self.check("browser_idp_get_secure_cookie_emulation_when_required", bool(cookie_header))
        elif method.upper() == "POST":
            self.diagnose("browser_idp_post_secure_cookie_blocked_by_httpx", state["secure_flow_cookie_blocked"])
            self.diagnose("browser_idp_post_loopback_secure_cookie_emulation_applied", bool(cookie_header))
            if self.current_check == "browser_login_post_credentials":
                self.diagnose("browser_loopback_secure_cookie_emulation_applied", bool(cookie_header))
            elif self.current_check == "browser_login_post_saml_form":
                self.diagnose("browser_saml_loopback_secure_cookie_emulation_applied", bool(cookie_header))
            if state["secure_flow_cookie_blocked"]:
                self.check("browser_idp_post_secure_cookie_emulation_when_required", bool(cookie_header))

        if cookie_header:
            request.headers["Cookie"] = cookie_header
        return browser.send(request)

    def request(self, client: httpx.Client, method: str, path: str, body=None, *, expected: tuple[int, ...] = (200,), csrf: bool = False) -> httpx.Response:
        mutating = method.upper() not in {"GET", "HEAD", "OPTIONS"}
        headers = {"Idempotency-Key": str(uuid.uuid4())} if mutating else {}
        if mutating:
            headers["Origin"] = self.base
        if csrf:
            csrf_token = client.headers.get("X-CSRF-Token")
            if not csrf_token:
                raise AssertionError("csrf_token_missing")
            headers["X-CSRF-Token"] = csrf_token
        response = client.request(method, path, json=body, headers=headers)
        self.check(
            "http_" + method.lower() + "_" + path.split("?")[0].replace("/", "_").strip("_"),
            response.status_code in expected,
            http_status=response.status_code,
        )
        return response

    def kc_request(self, method: str, path: str, body=None, *, expected: tuple[int, ...] = (200,), params=None) -> httpx.Response:
        response = self.kc.request(method, "/admin/realms/" + BROKER_REALM + path, json=body, params=params, headers={"Authorization": "Bearer " + self.kc_admin_token})
        self.check("keycloak_admin_" + method.lower() + "_" + path.split("?")[0].replace("/", "_").strip("_"), response.status_code in expected)
        return response

    def saml_kc_request(self, method: str, path: str, body=None, *, expected: tuple[int, ...] = (200,), params=None) -> httpx.Response:
        response = self.kc.request(method, "/admin/realms/" + SAML_REALM + path, json=body, params=params, headers={"Authorization": "Bearer " + self.saml_admin_token})
        self.check("keycloak_saml_admin_" + method.lower() + "_" + path.split("?")[0].replace("/", "_").strip("_"), response.status_code in expected)
        return response

    def login_local_admin(self) -> dict:
        response = self.request(self.admin, "POST", "/auth-api/login", {"email": QA_EMAIL, "password": QA_PASSWORD})
        session = response.json()
        self.admin.headers["X-CSRF-Token"] = session["csrf_token"]
        self.check("qa_fixture_is_local_admin", session.get("user", {}).get("role") == "admin")
        self.check("local_login_reports_password_method", session.get("authentication", {}).get("method") == "password")
        return session

    def create_scopes(self) -> None:
        for product, config in PRODUCTS.items():
            key = "sq" + self.run.lower() if product == "code" else "SQ" + self.run.upper()
            body = {"key": key, "name": f"SSO {product} QA {self.run}"}
            response = self.request(self.admin, "POST", config["collection"], body, expected=(200, 201))
            self.resource_ids[product] = response.json()["id"]
        self.check("three_product_scopes_created", len(self.resource_ids) == 3 and len(set(self.resource_ids.values())) == 3)

    def acquire_fixture_admin(self) -> None:
        response = self.kc.post(
            f"/realms/{BROKER_REALM}/protocol/openid-connect/token",
            data={"grant_type": "client_credentials", "client_id": FIXTURE_ADMIN_CLIENT_ID, "client_secret": FIXTURE_ADMIN_CLIENT_SECRET},
        )
        self.check("fixture_control_plane_client_credentials", response.status_code == 200 and bool(response.json().get("access_token")))
        self.kc_admin_token = response.json()["access_token"]
        saml_response = self.kc.post(
            f"/realms/{SAML_REALM}/protocol/openid-connect/token",
            data={"grant_type": "client_credentials", "client_id": SAML_FIXTURE_ADMIN_CLIENT_ID, "client_secret": SAML_FIXTURE_ADMIN_CLIENT_SECRET},
        )
        self.check("saml_fixture_client_credentials", saml_response.status_code == 200 and bool(saml_response.json().get("access_token")))
        self.saml_admin_token = saml_response.json()["access_token"]

    def group_id(self, name: str) -> str:
        response = self.kc_request("GET", "/groups", params={"search": name})
        matches = [item for item in response.json() if item.get("name") == name]
        if not matches:
            raise AssertionError("fixture_group_missing")
        return matches[0]["id"]

    def saml_group_id(self, name: str) -> str:
        response = self.saml_kc_request("GET", "/groups", params={"search": name})
        matches = [item for item in response.json() if item.get("name") == name]
        if not matches:
            raise AssertionError("saml_fixture_group_missing")
        return matches[0]["id"]

    def verify_keycloak_configuration(self) -> None:
        discovery = self.kc.get(f"/realms/{BROKER_REALM}/.well-known/openid-configuration")
        self.check("broker_realm_discovery_ready", discovery.status_code == 200)
        discovery_data = discovery.json()
        self.check(
            "broker_realm_issuer_and_pkce_ready",
            discovery_data.get("issuer") == ISSUER
            and "S256" in discovery_data.get("code_challenge_methods_supported", []),
        )

        clients = self.kc_request("GET", "/clients", params={"clientId": OIDC_CLIENT_ID}).json()
        client = next((item for item in clients if item.get("clientId") == OIDC_CLIENT_ID), None)
        self.check("confidential_oidc_client_imported", bool(client and client.get("publicClient") is False))
        attributes = client.get("attributes", {}) if client else {}
        self.check(
            "oidc_client_requires_pkce_and_backchannel_logout",
            attributes.get("pkce.code.challenge.method") == "S256"
            and attributes.get("backchannel.logout.url")
            == "http://identity-api:8030/api/auth/oidc/backchannel-logout",
        )
        self.check(
            "oidc_password_and_implicit_grants_disabled",
            client is not None
            and client.get("directAccessGrantsEnabled") is False
            and client.get("implicitFlowEnabled") is False
            and client.get("standardFlowEnabled") is True,
        )
        client_id = client.get("id", "") if client else ""
        protocol_mappers = self.kc_request("GET", f"/clients/{client_id}/protocol-mappers/models").json() if client_id else []
        self.check(
            "oidc_client_groups_mapper_imported",
            any(item.get("protocolMapper") == "oidc-group-membership-mapper" for item in protocol_mappers),
        )

        idp_path = f"/identity-provider/instances/{SAML_IDP_ALIAS}"
        idp_response = self.kc_request("GET", idp_path)
        idp = idp_response.json()
        idp_config = idp.get("config", {})
        self.check(
            "saml_idp_trusts_verified_email_and_signatures",
            idp.get("enabled") is True
            and idp.get("trustEmail") is True
            and idp_config.get("validateSignature") == "true"
            and idp_config.get("wantAssertionsSigned") == "true",
        )
        expected_metadata_url = f"http://identity-broker:8080/realms/{SAML_REALM}/protocol/saml/descriptor"
        self.check(
            "saml_idp_uses_upstream_metadata_for_signing_keys",
            idp_config.get("useMetadataDescriptorUrl") == "true"
            and idp_config.get("metadataDescriptorUrl") == expected_metadata_url,
        )
        mappers = self.kc_request("GET", idp_path + "/mappers").json()
        profile_mappers = {
            (item.get("config") or {}).get("attribute.name")
            for item in mappers
            if item.get("identityProviderMapper") == "saml-user-attribute-idp-mapper"
            and (item.get("config") or {}).get("syncMode") == "FORCE"
        }
        self.check("saml_email_and_profile_mappers_imported", {"email", "firstName", "lastName"} <= profile_mappers)

        saml_clients = self.saml_kc_request("GET", "/clients", params={"clientId": SAML_CLIENT_ID}).json()
        saml_client = next((item for item in saml_clients if item.get("clientId") == SAML_CLIENT_ID), None)
        saml_client_attributes = saml_client.get("attributes", {}) if saml_client else {}
        broker_signs_authn = idp_config.get("wantAuthnRequestsSigned") == "true"
        upstream_requires_signed_authn = saml_client_attributes.get("saml.client.signature") == "true"
        self.check(
            "saml_authn_request_signature_policy_aligned",
            broker_signs_authn == upstream_requires_signed_authn,
        )
        self.check(
            "upstream_saml_client_signs_assertion_and_response",
            saml_client is not None
            and saml_client_attributes.get("saml.assertion.signature") == "true"
            and saml_client_attributes.get("saml.server.signature") == "true",
        )

        metadata = self.kc.get(f"/realms/{SAML_REALM}/protocol/saml/descriptor")
        self.check("upstream_saml_metadata_ready", metadata.status_code == 200)
        descriptor = ET.fromstring(metadata.content)
        elements = list(descriptor.iter())
        has_post_sso = any(
            element.tag.rsplit("}", 1)[-1] == "SingleSignOnService"
            and element.attrib.get("Binding") == "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
            for element in elements
        )
        has_signing_key = any(
            element.tag.rsplit("}", 1)[-1] == "KeyDescriptor"
            and element.attrib.get("use") == "signing"
            for element in elements
        )
        metadata_signing_certificates = {
            "".join((certificate.text or "").split())
            for key_descriptor in elements
            if key_descriptor.tag.rsplit("}", 1)[-1] == "KeyDescriptor"
            and key_descriptor.attrib.get("use") == "signing"
            for certificate in key_descriptor.iter()
            if certificate.tag.rsplit("}", 1)[-1] == "X509Certificate"
            and certificate.text
        }
        self.check(
            "upstream_saml_realm_is_signed_post_idp",
            descriptor.attrib.get("entityID") == f"{self.keycloak}/realms/{SAML_REALM}"
            and has_post_sso
            and has_signing_key,
        )
        jwks = self.kc.get(f"/realms/{SAML_REALM}/protocol/openid-connect/certs")
        self.check("upstream_saml_public_signing_keys_ready", jwks.status_code == 200)
        signing_certificates = {
            "".join((certificate or "").split())
            for key in jwks.json().get("keys", [])
            if key.get("use") == "sig"
            for certificate in key.get("x5c", [])
        } if jwks.status_code == 200 else set()
        self.check(
            "upstream_saml_metadata_matches_public_signing_key",
            bool(metadata_signing_certificates & signing_certificates),
        )

    def realm_user(self, realm: str, email: str) -> dict:
        token = self.saml_admin_token if realm == SAML_REALM else self.kc_admin_token
        response = self.kc.get(
            f"/admin/realms/{realm}/users",
            params={"username": email, "exact": "true"},
            headers={"Authorization": "Bearer " + token},
        )
        self.check("keycloak_user_lookup", response.status_code == 200)
        users = [user for user in response.json() if user.get("username", "").casefold() == email.casefold()]
        if not users:
            raise AssertionError("fixture_user_missing")
        return users[0]

    def ensure_saml_user(self, email: str, groups: list[str]) -> dict:
        response = self.saml_kc_request("GET", "/users", params={"username": email, "exact": "true"})
        matches = [user for user in response.json() if user.get("username", "").casefold() == email.casefold()]
        if matches:
            user = matches[0]
            detail = self.saml_kc_request("GET", "/users/" + user["id"]).json()
            current = set(detail.get("groups", []))
            for group in groups:
                path = "/" + group
                if path not in current:
                    self.saml_kc_request("PUT", f"/users/{user['id']}/groups/{self.saml_group_id(group)}", expected=(204,))
            return user
        response = self.saml_kc_request(
            "POST",
            "/users",
            {
                "username": email,
                "email": email,
                "emailVerified": True,
                "enabled": True,
                "firstName": "QA SAML",
                "lastName": "Run " + self.run,
                "credentials": [{"type": "password", "value": QA_PASSWORD, "temporary": False}],
            },
            expected=(201,),
        )
        location = response.headers.get("Location", "")
        user_id = location.rstrip("/").rsplit("/", 1)[-1]
        for group in groups:
            self.saml_kc_request("PUT", f"/users/{user_id}/groups/{self.saml_group_id(group)}", expected=(204,))
        return {"id": user_id, "username": email, "email": email}

    def ensure_direct_user(self, email: str, groups: list[str]) -> dict:
        response = self.kc.get(
            f"/admin/realms/{BROKER_REALM}/users",
            params={"username": email, "exact": "true"},
            headers={"Authorization": "Bearer " + self.kc_admin_token},
        )
        self.check("keycloak_user_lookup", response.status_code == 200)
        matches = [user for user in response.json() if user.get("username", "").casefold() == email.casefold()]
        if matches:
            user = matches[0]
            user_detail = self.kc_request("GET", "/users/" + user["id"])
            user_detail_data = user_detail.json()
            current = set(user_detail_data.get("groups", []))
            desired = {"/" + group for group in groups}
            if current != desired:
                user_detail_data["groups"] = sorted(desired)
                self.kc_request("PUT", "/users/" + user["id"], user_detail_data, expected=(204,))
            return user
        response = self.kc_request(
            "POST",
            "/users",
            {
                "username": email,
                "email": email,
                "emailVerified": True,
                "enabled": True,
                "firstName": "QA SSO",
                "lastName": "Run " + self.run,
                "credentials": [{"type": "password", "value": QA_PASSWORD, "temporary": False}],
            },
            expected=(201,),
        )
        location = response.headers.get("Location", "")
        user_id = location.rstrip("/").rsplit("/", 1)[-1]
        for group in groups:
            self.kc_request("PUT", f"/users/{user_id}/groups/{self.group_id(group)}", expected=(204,))
        return {"id": user_id, "username": email, "email": email}

    def settings_body(self, previous: dict, *, provisioning: str = "jit", login_policy: str = "password_and_sso") -> dict:
        group_mappings = [
            {"group": "qa-work", "permissions": {"work": {"role": "manager", "scope_ids": [self.resource_ids["work"]]}}},
            {"group": "qa-knowledge", "permissions": {"knowledge": {"role": "writer", "scope_ids": [self.resource_ids["knowledge"]]}}},
            {"group": "qa-code", "permissions": {"code": {"role": "writer", "scope_ids": [self.resource_ids["code"]]}}},
        ]
        return {
            "revision": previous["revision"],
            "enabled": True,
            "display_name": "QA Keycloak",
            "issuer_url": ISSUER,
            "client_id": OIDC_CLIENT_ID,
            "client_secret": OIDC_CLIENT_SECRET,
            "scopes": ["openid", "profile", "email"],
            "allowed_email_domains": ["example.com"],
            "email_claim": "email",
            "require_email_verified": True,
            "groups_claim": "groups",
            "provisioning": provisioning,
            "default_permissions": {},
            "group_mappings": group_mappings,
            "login_policy": login_policy,
        }

    def save_settings(self, previous: dict, *, provisioning: str = "jit", login_policy: str = "password_and_sso") -> dict:
        body = self.settings_body(previous, provisioning=provisioning, login_policy=login_policy)
        response = self.request(self.admin, "PUT", "/auth-api/sso/settings", body, csrf=True, expected=(200,))
        value = response.json()
        serialized = json.dumps(value, ensure_ascii=True)
        self.check("settings_never_return_client_secret", OIDC_CLIENT_SECRET not in serialized and value.get("client_secret_configured") is True)
        return value

    def login_page(self, browser: httpx.Client, url: str, *, saml: bool, email: str) -> dict:
        self.current_check = "browser_login_authorization_get"
        try:
            current = self.browser_request(browser, "GET", url)
        except httpx.HTTPError as error:
            raise BrowserFlowFailure("browser_http_error") from error
        clicked_saml = False
        posted_credentials = False
        for _ in range(20):
            if current.status_code in (301, 302, 303, 307, 308):
                target = urljoin(str(current.url), current.headers.get("Location", ""))
                parts = urlsplit(target)
                if parts.scheme == "http" and parts.netloc == urlsplit(self.base).netloc and parts.path == CALLBACK_PATH:
                    callback = self.browser_request(browser, "GET", target)
                    location = callback.headers.get("Location", "")
                    parsed_location = urlsplit(urljoin(self.base, location))
                    self.check("callback_redirect_is_pinned_and_local", parsed_location.scheme == "http" and parsed_location.netloc == urlsplit(self.base).netloc and parsed_location.path in {"/work", "/knowledge", "/code"})
                    auth_error = parse_qs(parsed_location.query).get("auth_error", [""])[0]
                    return {"callback": callback, "auth_error": auth_error, "success": callback.status_code in (302, 303) and not auth_error, "browser": browser}
                if parts.scheme != "http" or parts.netloc not in {urlsplit(self.keycloak).netloc, urlsplit(self.base).netloc}:
                    raise BrowserFlowFailure("untrusted_idp_redirect", current.status_code)
                self.current_check = "browser_login_follow_redirect_get"
                try:
                    current = self.browser_request(browser, "GET", target)
                except httpx.HTTPError as error:
                    raise BrowserFlowFailure("browser_http_error") from error
                continue
            if current.status_code != 200:
                if self.current_check == "browser_login_post_credentials":
                    raise BrowserFlowFailure(browser_form_error_class(current), current.status_code)
                if current.status_code == 400 and urlsplit(str(current.url)).netloc == urlsplit(self.keycloak).netloc:
                    reason = browser_form_error_class(current, fallback="idp_page_http_error")
                    raise BrowserFlowFailure(reason, current.status_code)
                raise BrowserFlowFailure("idp_page_http_error", current.status_code)
            self.current_check = "browser_login_parse_idp_form"
            parser = LoginPage()
            parser.feed(current.text)
            if saml and not clicked_saml:
                link = next((item for item in parser.links if f"/broker/{SAML_IDP_ALIAS}/login" in item["href"]), None)
                if link:
                    clicked_saml = True
                    self.current_check = "browser_login_follow_saml_idp_get"
                    try:
                        current = self.browser_request(browser, "GET", urljoin(str(current.url), link["href"]))
                    except httpx.HTTPError as error:
                        raise BrowserFlowFailure("browser_http_error") from error
                    continue
            login_form = next((form for form in parser.forms if "username" in form["fields"] and "password" in form["fields"]), None)
            if login_form and not posted_credentials:
                posted_credentials = True
                field_names = set(login_form["fields"])
                blocked_controls_excluded = all(
                    not control["name"] or control["name"] not in field_names
                    for control in login_form["controls"]
                    if control["disabled"]
                    or control["type"] in {"button", "file", "image", "reset", "submit"}
                    or (control["type"] in {"checkbox", "radio"} and not control["checked"])
                )
                self.check("browser_form_excludes_unsuccessful_controls", blocked_controls_excluded)
                fields = browser_form_data(login_form)
                fields["username"] = email
                fields["password"] = QA_PASSWORD
                action = urljoin(str(current.url), login_form["action"] or str(current.url))
                if urlsplit(action).netloc != urlsplit(self.keycloak).netloc:
                    raise BrowserFlowFailure("untrusted_login_form_action", current.status_code)
                headers, referer_mode = browser_form_headers(current, action, parser.referrer_policy)
                cookie_state = browser_cookie_state(browser, action)
                self.diagnose("browser_form_referer_mode", referer_mode)
                self.diagnose("browser_form_cookie_path_matches_action", cookie_state["flow_cookie_in_jar"])
                self.diagnose("browser_form_secure_cookie_blocked_by_httpx", cookie_state["secure_flow_cookie_blocked"])
                self.diagnose("browser_form_httpx_sends_flow_cookie", cookie_state["flow_cookie_sent"])
                self.check("browser_keycloak_flow_cookie_matches_form_action", cookie_state["flow_cookie_in_jar"])
                self.current_check = "browser_login_post_credentials"
                try:
                    current = self.browser_request(browser, "POST", action, headers=headers, data=fields)
                except httpx.HTTPError as error:
                    raise BrowserFlowFailure("browser_http_error") from error
                continue
            saml_form = next((form for form in parser.forms if "SAMLRequest" in form["fields"] or "SAMLResponse" in form["fields"]), None)
            if saml_form:
                action = urljoin(str(current.url), saml_form["action"] or str(current.url))
                if urlsplit(action).netloc not in {urlsplit(self.keycloak).netloc, urlsplit(self.base).netloc}:
                    raise BrowserFlowFailure("untrusted_saml_form_action", current.status_code)
                self.current_check = "browser_login_post_saml_form"
                try:
                    headers, referer_mode = browser_form_headers(current, action, parser.referrer_policy)
                    self.diagnose("browser_saml_form_referer_mode", referer_mode)
                    cookie_state = browser_cookie_state(browser, action)
                    self.diagnose("browser_saml_form_cookie_path_matches_action", cookie_state["flow_cookie_in_jar"])
                    self.diagnose("browser_saml_form_secure_cookie_blocked_by_httpx", cookie_state["secure_flow_cookie_blocked"])
                    self.diagnose("browser_saml_form_httpx_sends_flow_cookie", cookie_state["flow_cookie_sent"])
                    if "SAMLResponse" in saml_form["fields"] and urlsplit(action).netloc == urlsplit(self.keycloak).netloc:
                        self.check("browser_saml_response_flow_cookie_matches_form_action", cookie_state["flow_cookie_in_jar"])
                    current = self.browser_request(
                        browser,
                        "POST",
                        action,
                        headers=headers,
                        data=browser_form_data(saml_form),
                    )
                except httpx.HTTPError as error:
                    raise BrowserFlowFailure("browser_http_error") from error
                continue
            if login_form and posted_credentials:
                raise BrowserFlowFailure("credential_form_repeated_after_post", current.status_code)
            raise BrowserFlowFailure("idp_page_has_no_recognized_form", current.status_code)
        raise BrowserFlowFailure("idp_redirect_limit", current.status_code)

    def browser_login(self, email: str, *, saml: bool = False, return_to: str = "/work") -> dict:
        browser = httpx.Client(base_url=self.base, timeout=20, trust_env=False, follow_redirects=False)
        self.oidc_start_requests += 1
        started = browser.post(self.base + "/auth-api/oidc/start", json={"return_to": return_to}, headers={"Origin": self.base})
        self.check("oidc_start_returns_authorization_url", started.status_code == 200)
        authorization_url = started.json().get("authorization_url", "")
        parsed = urlsplit(authorization_url)
        params = parse_qs(parsed.query)
        self.check("oidc_start_uses_keycloak_and_pkce_s256", parsed.scheme == "http" and parsed.netloc == urlsplit(self.keycloak).netloc and params.get("code_challenge_method") == ["S256"] and bool(params.get("code_challenge")))
        if saml:
            params["kc_idp_hint"] = [SAML_IDP_ALIAS]
            authorization_url = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(params, doseq=True), parsed.fragment))
        try:
            result = self.login_page(browser, authorization_url, saml=saml, email=email)
        except Exception:
            browser.close()
            raise
        if result["success"]:
            return result
        browser.close()
        return result

    def product_scope_check(self, client: httpx.Client, expected: set[str]) -> None:
        identity_me = self.request(client, "GET", "/auth-api/me").json()
        permissions = (identity_me.get("user") or {}).get("permissions") or {}
        code_permission = permissions.get("code") or {}
        code_permission_ids = code_permission.get("scope_ids", []) if isinstance(code_permission, dict) else []
        expected_code_ids = [self.resource_ids["code"]] if "code" in expected else []
        self.check(
            "identity_code_permission_public_project_scope",
            isinstance(code_permission_ids, list)
            and all(isinstance(item, str) for item in code_permission_ids)
            and len(code_permission_ids) == len(expected_code_ids)
            and set(code_permission_ids) == set(expected_code_ids),
        )

        for product, config in PRODUCTS.items():
            if product not in expected:
                self.request(client, "GET", config["me"], expected=(403,))
                self.request(client, "GET", config["collection"], expected=(403,))
                self.check("product_scope_denied_" + product, True)
                continue

            expected_ids = {self.resource_ids[product]}
            me_response = self.request(client, "GET", config["me"])
            principal = me_response.json()
            scope_ids = principal.get(config["scope_field"])
            if product == "code":
                valid_code_scope_id = False
                if isinstance(scope_ids, list) and len(scope_ids) == 1 and isinstance(scope_ids[0], str):
                    try:
                        uuid.UUID(scope_ids[0])
                        valid_code_scope_id = scope_ids[0] != self.resource_ids["code"]
                    except ValueError:
                        pass
                if valid_code_scope_id and self.code_internal_scope_id is None:
                    self.code_internal_scope_id = scope_ids[0]
                self.check(
                    "product_me_scope_code",
                    valid_code_scope_id
                    and self.code_internal_scope_id is not None
                    and scope_ids[0] == self.code_internal_scope_id,
                    http_status=me_response.status_code,
                )
                list_response = self.request(client, "GET", config["collection"])
                resources = list_response.json()
                ids = {item.get("id") for item in resources} if isinstance(resources, list) else set()
                self.check(
                    "product_scope_code",
                    isinstance(resources, list) and len(resources) == 1 and ids == expected_ids,
                    http_status=list_response.status_code,
                )
                continue

            self.check(
                "product_me_scope_" + product,
                isinstance(scope_ids, list)
                and len(scope_ids) == 1
                and all(isinstance(item, str) for item in scope_ids)
                and set(scope_ids) == expected_ids,
                http_status=me_response.status_code,
            )

            list_response = self.request(client, "GET", config["collection"])
            resources = list_response.json()
            ids = {item.get("id") for item in resources} if isinstance(resources, list) else set()
            self.check(
                "product_scope_" + product,
                isinstance(resources, list) and len(resources) == 1 and ids == expected_ids,
                http_status=list_response.status_code,
            )

    def invitation(self, email: str, permissions: dict) -> None:
        response = self.request(
            self.admin,
            "POST",
            "/auth-api/invitations",
            {"email": email, "name": "QA invited SSO member", "role": "member", "permissions": permissions},
            csrf=True,
            expected=(201,),
        )
        self.check("invitation_has_one_time_code", bool(response.json().get("invitation_code")))

    def create_local_password_member(self, email: str) -> dict:
        invitation = self.request(
            self.admin,
            "POST",
            "/auth-api/invitations",
            {"email": email, "name": "QA local password member", "role": "member", "permissions": {}},
            csrf=True,
            expected=(201,),
        ).json()
        self.check("local_member_invitation_created", bool(invitation.get("invitation_code")))
        client = httpx.Client(base_url=self.base, headers={"Origin": self.base}, timeout=15, trust_env=False, follow_redirects=False)
        try:
            accepted = client.post(
                "/auth-api/accept-invitation",
                json={"invitation_code": invitation["invitation_code"], "password": QA_PASSWORD},
                headers={"Idempotency-Key": str(uuid.uuid4())},
            )
            self.check("local_password_fixture_created", accepted.status_code == 201)
            user = accepted.json().get("user", {})
            self.check("local_password_fixture_is_member", user.get("email", "").casefold() == email.casefold() and user.get("role") == "member" and user.get("credential_type") == "local")
            self.check("local_password_fixture_session_valid_before_policy", client.get("/auth-api/me").status_code == 200)
            return {"cookies": dict(client.cookies), "user_id": user.get("id")}
        finally:
            client.close()

    def configure(self) -> dict:
        self.check("qa_setup_target_is_isolated_loopback", self.base == APP_ORIGIN and self.keycloak == KEYCLOAK_ORIGIN)
        health = self.request(self.anonymous, "GET", "/auth-api/status")
        data = health.json()
        setup_required = data.get("setup_required")
        self.check("qa_setup_state_is_boolean", isinstance(setup_required, bool))
        if setup_required:
            setup_client = httpx.Client(base_url=self.base, headers=self.origin_headers, timeout=15, trust_env=False, follow_redirects=False)
            try:
                self.request(
                    setup_client,
                    "POST",
                    "/auth-api/setup",
                    {"name": "QA synthetic admin", "email": QA_EMAIL, "password": QA_PASSWORD},
                    expected=(201,),
                )
                self.check("synthetic_first_admin_created", True)
            finally:
                setup_client.close()
        else:
            self.check("qa_first_admin_already_initialized", True)
        self.login_local_admin()
        self.create_scopes()
        settings = self.request(self.admin, "GET", "/auth-api/sso/settings").json()
        self.check("settings_response_redacts_secret", OIDC_CLIENT_SECRET not in json.dumps(settings) and isinstance(settings.get("client_secret_configured"), bool))
        first = self.save_settings(settings)
        stale = self.request(self.admin, "PUT", "/auth-api/sso/settings", self.settings_body(settings), expected=(409,), csrf=True)
        self.check("stale_settings_revision_conflicts", stale.status_code == 409)
        connection_test = self.request(self.admin, "POST", "/auth-api/sso/test", {}, csrf=True)
        test_data = connection_test.json()
        self.check("saved_provider_discovery_and_jwks_test", test_data.get("status") == "ok" and test_data.get("issuer") == ISSUER and OIDC_CLIENT_SECRET not in json.dumps(test_data))
        self.check("member_cannot_read_sso_admin_settings", self.anonymous.get("/auth-api/sso/settings").status_code == 401)
        return first

    def link_existing_admin(self) -> None:
        qa_user = self.realm_user(BROKER_REALM, QA_EMAIL)
        admin_user = self.request(self.admin, "GET", "/auth-api/me").json()["user"]
        links = self.request(self.admin, "GET", "/auth-api/sso/links").json().get("links", [])
        link = next((item for item in links if item.get("issuer") == ISSUER and item.get("subject") == qa_user["id"]), None)
        created = link is None
        if link is None:
            link = self.request(self.admin, "POST", "/auth-api/sso/links", {"user_id": admin_user["id"], "subject": qa_user["id"], "managed_permissions": False}, csrf=True, expected=(201,)).json()
        self.check("explicit_local_account_link_created", link.get("user_id") == admin_user["id"])
        self.check("explicit_link_does_not_manage_permissions", link.get("managed_permissions") is False)
        self.check("idp_admin_claim_does_not_replace_local_admin", admin_user.get("role") == "admin")
        if created:
            self.login_local_admin()

    def run_sso(self) -> None:
        self.acquire_fixture_admin()
        self.verify_keycloak_configuration()
        settings = self.configure()
        self.link_existing_admin()

        # Direct OIDC callback links only after an explicit issuer+subject link.
        linked = self.browser_login(QA_EMAIL)
        self.check("direct_oidc_browser_flow_completed", linked["success"])
        linked_me = self.request(linked["browser"], "GET", "/auth-api/me").json()
        self.check("linked_session_reports_oidc", linked_me.get("authentication", {}).get("method") == "oidc")
        self.check("linked_local_admin_remains_admin", linked_me.get("user", {}).get("role") == "admin")
        linked["browser"].close()

        jit_email = f"qa-sso-jit-{self.run}@example.com"
        self.ensure_direct_user(jit_email, ["qa-work", "qa-knowledge", "qa-code"])
        jit = self.browser_login(jit_email, return_to="/knowledge")
        self.check("oidc_jit_user_created", jit["success"])
        jit_me = self.request(jit["browser"], "GET", "/auth-api/me").json()
        self.check("jit_user_is_sso_only_member", jit_me.get("user", {}).get("role") == "member" and jit_me.get("user", {}).get("credential_type") == "sso")
        self.product_scope_check(jit["browser"], {"work", "knowledge", "code"})
        self.check("member_cannot_read_sso_admin_settings", jit["browser"].get("/auth-api/sso/settings").status_code == 403)
        jit["browser"].close()

        group_email = f"qa-sso-group-{self.run}@example.com"
        group_user = self.ensure_direct_user(group_email, ["qa-work", "qa-knowledge", "qa-code"])
        group_first = self.browser_login(group_email)
        self.check("group_member_initial_login", group_first["success"])
        self.product_scope_check(group_first["browser"], {"work", "knowledge", "code"})
        self.check("group_member_session_valid_before_change", group_first["browser"].get("/auth-api/me").status_code == 200)
        code_group = self.group_id("qa-code")
        self.kc_request("DELETE", f"/users/{group_user['id']}/groups/{code_group}", expected=(204,))
        group_second = self.browser_login(group_email)
        self.check("group_removal_login", group_second["success"])
        self.check("group_change_revokes_prior_identity_session", group_first["browser"].get("/auth-api/me").status_code == 401)
        self.product_scope_check(group_second["browser"], {"work", "knowledge"})
        group_first["browser"].close()
        group_second["browser"].close()

        # An uninvited verified user is denied in invited-only mode; a live member
        # invitation provisions the next identity with exact product scopes.
        settings = self.request(self.admin, "GET", "/auth-api/sso/settings").json()
        invited_settings = self.save_settings(settings, provisioning="invited_only")
        denied_email = f"qa-sso-uninvited-{self.run}@example.com"
        self.ensure_direct_user(denied_email, ["qa-work"])
        denied = self.browser_login(denied_email)
        self.check("invited_only_denies_uninvited_identity", not denied["success"] and denied.get("auth_error") == "invitation_required")

        invited_email = f"qa-sso-invited-{self.run}@example.com"
        self.ensure_direct_user(invited_email, ["qa-knowledge"])
        invited_permissions = {
            product: {"role": PRODUCTS[product]["role"], "scope_ids": [self.resource_ids[product]]}
            for product in PRODUCTS
        }
        self.invitation(invited_email, invited_permissions)
        invited = self.browser_login(invited_email)
        self.check("invited_only_browser_provisioning", invited["success"])
        invited_me = self.request(invited["browser"], "GET", "/auth-api/me").json()
        self.check("invited_member_provisioned_as_sso_only", invited_me.get("user", {}).get("role") == "member" and invited_me.get("user", {}).get("credential_type") == "sso" and invited_me.get("user", {}).get("permissions_source") == "manual")
        self.product_scope_check(invited["browser"], {"work", "knowledge", "code"})
        invited["browser"].close()

        saml_email = f"qa-sso-saml-{self.run}@example.com"
        self.ensure_saml_user(saml_email, ["qa-work", "qa-knowledge"])
        self.invitation(saml_email, invited_permissions)
        saml = self.browser_login(saml_email, saml=True, return_to="/code")
        self.check("saml_to_oidc_browser_chain_completed", saml["success"])
        saml_me = self.request(saml["browser"], "GET", "/auth-api/me").json()
        self.check("saml_brokered_session_is_oidc", saml_me.get("authentication", {}).get("method") == "oidc" and saml_me.get("user", {}).get("email", "").casefold() == saml_email.casefold())
        brokered_saml_user = self.realm_user(BROKER_REALM, saml_email)
        brokered_saml_profile = self.kc_request("GET", "/users/" + brokered_saml_user["id"]).json()
        self.check(
            "saml_broker_trusts_verified_email_and_profile",
            brokered_saml_profile.get("emailVerified") is True
            and brokered_saml_profile.get("email", "").casefold() == saml_email.casefold()
            and bool(brokered_saml_profile.get("firstName")),
        )
        self.product_scope_check(saml["browser"], {"work", "knowledge", "code"})
        saml["browser"].close()

        local_member_email = f"qa-sso-local-member-{self.run}@example.com"
        local_member = self.create_local_password_member(local_member_email)

        # New logins for members cannot use local passwords under sso_only. The
        # explicitly created local administrator remains the recovery route.
        settings = self.request(self.admin, "GET", "/auth-api/sso/settings").json()
        self.save_settings(settings, provisioning="invited_only", login_policy="sso_only")
        stale_member_session = httpx.Client(base_url=self.base, headers={"Origin": self.base}, cookies=local_member["cookies"], timeout=10, trust_env=False, follow_redirects=False)
        self.check("sso_only_revokes_existing_member_password_session", stale_member_session.get("/auth-api/me").status_code == 401)
        stale_member_session.close()
        member_local = self.anonymous.post("/auth-api/login", json={"email": local_member_email, "password": QA_PASSWORD})
        self.check("sso_only_rejects_member_password_login", member_local.status_code == 401 and member_local.json().get("detail", {}).get("code") == "invalid_credentials")
        self.check("sso_only_member_login_does_not_create_session", self.anonymous.get("/auth-api/me").status_code == 401)
        local_admin = self.anonymous.post("/auth-api/login", json={"email": QA_EMAIL, "password": QA_PASSWORD})
        self.check("sso_only_keeps_local_admin_recovery", local_admin.status_code == 200 and local_admin.json().get("user", {}).get("role") == "admin")
        local_admin_session = local_admin.json()
        recovery = httpx.Client(base_url=self.base, headers={"Origin": self.base, "X-CSRF-Token": local_admin_session["csrf_token"]}, cookies=local_admin.cookies, timeout=15, trust_env=False, follow_redirects=False)
        response = recovery.get("/auth-api/me")
        self.check("local_recovery_session_valid", response.status_code == 200 and response.json().get("authentication", {}).get("method") == "password" and response.json().get("user", {}).get("role") == "admin")
        recovery.close()

        # A second subject for the SSO-only account lifecycle verifies immediate
        # session revocation and that a later valid IdP assertion cannot reactivate it.
        disabled_email = f"qa-sso-disabled-{self.run}@example.com"
        self.ensure_direct_user(disabled_email, ["qa-work"])
        disabled_permissions = {"work": {"role": "manager", "scope_ids": [self.resource_ids["work"]]}}
        self.invitation(disabled_email, disabled_permissions)
        disable_login = self.browser_login(disabled_email)
        self.check("disable_fixture_initial_login", disable_login["success"])
        disable_session = self.request(disable_login["browser"], "GET", "/auth-api/me").json()
        disabled_user_id = disable_session["user"]["id"]
        self.request(self.admin, "PATCH", "/auth-api/users/" + disabled_user_id, {"active": False}, csrf=True)
        self.check("disabled_sso_user_session_revoked", disable_login["browser"].get("/auth-api/me").status_code == 401)
        disabled_retry = self.browser_login(disabled_email)
        self.check("disabled_sso_user_not_reactivated", not disabled_retry["success"] and disabled_retry.get("auth_error") == "sso_disabled")
        disable_login["browser"].close()

        # The configured OIDC client sends a signed Keycloak backchannel logout
        # to the Identity service when its broker user is logged out by Keycloak.
        backchannel_email = group_email
        backchannel_login = self.browser_login(backchannel_email)
        self.check("backchannel_subject_login", backchannel_login["success"])
        self.check("backchannel_session_valid_before_logout", backchannel_login["browser"].get("/auth-api/me").status_code == 200)
        backchannel_user = self.realm_user(BROKER_REALM, backchannel_email)
        logout_response = self.kc_request("POST", f"/users/{backchannel_user['id']}/logout", expected=(204,))
        self.check("keycloak_admin_logout_delivered_backchannel", logout_response.status_code == 204)
        deadline = time.monotonic() + 8
        revoked = False
        while time.monotonic() < deadline:
            if backchannel_login["browser"].get("/auth-api/me").status_code == 401:
                revoked = True
                break
            time.sleep(0.2)
        self.check("valid_backchannel_logout_revokes_sso_session", revoked)
        backchannel_login["browser"].close()

        settings = self.request(self.admin, "GET", "/auth-api/sso/settings").json()
        self.save_settings(settings, provisioning="jit", login_policy="password_and_sso")
        settings_text = json.dumps(self.request(self.admin, "GET", "/auth-api/sso/settings").json(), ensure_ascii=True)
        self.check("settings_write_only_secret_stays_redacted", OIDC_CLIENT_SECRET not in settings_text and '"client_secret":' not in settings_text)
        audit = self.request(self.admin, "GET", "/auth-api/audit?limit=200").json()
        audit_text = json.dumps(audit, ensure_ascii=True).casefold()
        self.check("identity_audit_contains_sso_activity", any(any(term in (item.get("action", "") + " " + json.dumps(item.get("details", {}))).casefold() for term in ["sso", "oidc", "backchannel"]) for item in audit.get("events", [])))
        self.check("audit_contains_no_authenticator_material", all(value.casefold() not in audit_text for value in [OIDC_CLIENT_SECRET, FIXTURE_ADMIN_CLIENT_SECRET, SAML_FIXTURE_ADMIN_CLIENT_SECRET, QA_PASSWORD, "authorization_code", "logout_token", "id_token"]))

        invalid_browser = httpx.Client(headers={"Origin": self.base}, timeout=10, trust_env=False, follow_redirects=False)
        self.oidc_start_requests += 1
        invalid_start = invalid_browser.post(self.base + "/auth-api/oidc/start", json={"return_to": "/work"})
        self.check("state_fixture_start", invalid_start.status_code == 200)
        self.check("oidc_start_requests_within_fixture_rate_limit", self.oidc_start_requests <= 20)
        wrong_state = invalid_browser.get(self.base + CALLBACK_PATH, params={"state": "invalid-state", "code": "synthetic-invalid-code"})
        invalid_location = urlsplit(urljoin(self.base, wrong_state.headers.get("Location", "")))
        invalid_state_error = parse_qs(invalid_location.query).get("auth_error", [""])[0]
        self.check("forged_state_rejected_without_open_redirect", wrong_state.status_code in (302, 303) and invalid_location.netloc == urlsplit(self.base).netloc and invalid_location.path in {"/work", "/knowledge", "/code"} and invalid_state_error == "invalid_state")
        self.check("forged_state_does_not_create_session", invalid_browser.get(self.base + "/auth-api/me").status_code == 401)
        invalid_browser.close()

        # Local logout is also checked with the old browser cookie retained so the
        # assertion covers server revocation, not merely browser-side cookie clearing.
        ending = self.browser_login(QA_EMAIL)
        self.check("linked_admin_relogin_for_logout", ending["success"])
        ending_me = self.request(ending["browser"], "GET", "/auth-api/me").json()
        ending["browser"].headers["X-CSRF-Token"] = ending_me["csrf_token"]
        old_cookies = dict(ending["browser"].cookies)
        platform_cookie_names = active_response_cookie_names(ending["callback"])
        old_cookie_names = {cookie.name for cookie in ending["browser"].cookies.jar}
        self.check(
            "oidc_callback_sets_unique_platform_session_cookie",
            len(platform_cookie_names) == 1 and platform_cookie_names <= old_cookie_names,
        )
        platform_cookie_name = next(iter(platform_cookie_names))
        self.request(ending["browser"], "POST", "/auth-api/logout", {}, csrf=True)
        remaining_cookie_names = {cookie.name for cookie in ending["browser"].cookies.jar}
        self.check("oidc_logout_clears_browser_cookie", platform_cookie_name not in remaining_cookie_names)
        old = httpx.Client(base_url=self.base, headers={"Origin": self.base}, cookies=old_cookies, timeout=10, trust_env=False, follow_redirects=False)
        self.check("oidc_logout_revokes_server_session", old.get("/auth-api/me").status_code == 401)
        old.close()
        ending["browser"].close()
        self.check("local_password_account_retained", ending_me.get("user", {}).get("credential_type") == "local")

    def close(self) -> None:
        self.admin.close()
        self.anonymous.close()
        self.kc.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=APP_ORIGIN)
    parser.add_argument("--keycloak-url", default=KEYCLOAK_ORIGIN)
    args = parser.parse_args()
    if args.base_url != APP_ORIGIN or args.keycloak_url != KEYCLOAK_ORIGIN:
        parser.error("SSO acceptance is restricted to the isolated loopback QA origins on 8092 and 8093")
    suite = Acceptance(args.base_url, args.keycloak_url)
    report = {
        "status": "failed",
        "target": {"app_origin": args.base_url, "keycloak_origin": args.keycloak_url},
        "fixture": {"broker_realm": BROKER_REALM, "upstream_saml_realm": SAML_REALM, "oidc_client_id": OIDC_CLIENT_ID, "saml_idp_alias": SAML_IDP_ALIAS},
        "scope_validation": {
            "code_private_scope_id": "opaque UUID from the first authorized Code /me response, compared across sessions",
            "direct_database_lookup": False,
        },
    }
    try:
        suite.run_sso()
        report.update({"status": "passed", "checks": suite.checks, "diagnostics": suite.diagnostics, "resource_ids": suite.resource_ids})
        result = 0
    except Exception as error:
        report.update({"failed_check": suite.current_check, "error_type": type(error).__name__, "checks": suite.checks, "diagnostics": suite.diagnostics, "resource_ids": suite.resource_ids})
        if isinstance(error, BrowserFlowFailure):
            report["failure_reason"] = error.reason
            if error.http_status is not None:
                report["http_status"] = error.http_status
        elif suite.failure_http_status is not None:
            report["http_status"] = suite.failure_http_status
        result = 1
    finally:
        suite.close()
        report_path = suite.directory / "report.json"
        report_path.write_text(json.dumps(report, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
        if report["status"] == "passed":
            print(f"SSO_ACCEPTANCE_PASSED {len(suite.checks)} checks; {report_path}")
        else:
            print(f"SSO_ACCEPTANCE_FAILED check={report.get('failed_check', 'unknown')}; {report_path}")
    return result


if __name__ == "__main__":
    raise SystemExit(main())
