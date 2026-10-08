"""Generate deterministic, isolated Keycloak realms for Ordivant SSO QA."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import uuid

ROOT = Path(__file__).resolve().parents[1]
# Keep these aligned with the existing public synthetic QA_FIXTURE.
QA_EMAIL = "qa-browser@example.com"
QA_PASSWORD = "Ordivant-QA-Fixture-2026!"
BROKER_REALM = "ordivant-qa"
SAML_REALM = "ordivant-qa-saml"
OIDC_CLIENT_ID = "ordivant-sso-qa"
SAML_CLIENT_ID = "ordivant-saml-qa"
SAML_IDP_ALIAS = "qa-saml"
FIXTURE_ADMIN_CLIENT_ID = "ordivant-sso-fixture-admin"
SAML_FIXTURE_ADMIN_CLIENT_ID = "ordivant-sso-saml-fixture-admin"
# This secret is only for a disposable local Keycloak realm imported by this fixture.
OIDC_CLIENT_SECRET = "synthetic-ordivant-sso-client-secret"
FIXTURE_ADMIN_CLIENT_SECRET = "synthetic-ordivant-sso-admin-secret"
SAML_FIXTURE_ADMIN_CLIENT_SECRET = "synthetic-ordivant-sso-saml-admin-secret"

GROUPS = ("qa-work", "qa-knowledge", "qa-code", "qa-restricted")
BROKER_USERS = (
    {"email": QA_EMAIL, "name": "QA Local Administrator", "groups": []},
    {"email": "qa-sso-jit@example.com", "name": "QA SSO JIT", "groups": ["qa-work", "qa-knowledge", "qa-code"]},
    {"email": "qa-sso-invited@example.com", "name": "QA SSO Invited", "groups": ["qa-knowledge"]},
    {"email": "qa-sso-group@example.com", "name": "QA SSO Group Sync", "groups": ["qa-work", "qa-knowledge", "qa-code"]},
    {"email": "qa-sso-disabled@example.com", "name": "QA SSO Disabled", "groups": ["qa-work"]},
    {"email": "qa-sso-uninvited@example.com", "name": "QA SSO Uninvited", "groups": ["qa-work"]},
)
SAML_USERS = (
    {"email": "qa-sso-saml@example.com", "name": "QA SAML Broker", "groups": ["qa-work", "qa-knowledge"]},
)


def stable_id(realm: str, value: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"ordivant-sso-qa:{realm}:{value.casefold()}"))


def loopback_origin(raw: str, expected_port: int, label: str) -> str:
    from urllib.parse import urlsplit

    parsed = urlsplit(raw)
    if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.port != expected_port:
        raise argparse.ArgumentTypeError(f"{label} must be http://127.0.0.1:{expected_port}")
    if parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password:
        raise argparse.ArgumentTypeError(f"{label} must be an origin without path or credentials")
    return raw.rstrip("/")


def _users(realm: str, rows: tuple[dict, ...]) -> list[dict]:
    result = []
    for row in rows:
        email = row["email"]
        result.append(
            {
                "id": stable_id(realm, email),
                "username": email,
                "email": email,
                "emailVerified": True,
                "enabled": True,
                "firstName": row["name"],
                "lastName": "Fixture",
                "groups": ["/" + group for group in row["groups"]],
                "credentials": [{"type": "password", "value": QA_PASSWORD, "temporary": False}],
            }
        )
    return result


def _oidc_protocol_mapper() -> dict:
    return {
        "name": "groups",
        "protocol": "openid-connect",
        "protocolMapper": "oidc-group-membership-mapper",
        "consentRequired": False,
        "config": {
            "claim.name": "groups",
            "full.path": "false",
            "id.token.claim": "true",
            "access.token.claim": "true",
            "userinfo.token.claim": "true",
        },
    }


def build_realms(public_origin: str, app_origin: str) -> tuple[dict, dict]:
    saml_issuer = f"{public_origin}/realms/{SAML_REALM}"
    broker_issuer = f"{public_origin}/realms/{BROKER_REALM}"
    app_callback = f"{app_origin}/auth-api/oidc/callback"
    broker_saml_acs = f"{broker_issuer}/broker/{SAML_IDP_ALIAS}/endpoint"

    broker = {
        "realm": BROKER_REALM,
        "displayName": "Ordivant isolated SSO QA",
        "enabled": True,
        "sslRequired": "none",
        "registrationAllowed": False,
        "resetPasswordAllowed": False,
        "loginWithEmailAllowed": True,
        "duplicateEmailsAllowed": False,
        "verifyEmail": False,
        "groups": [{"name": group, "path": "/" + group} for group in GROUPS],
        "clients": [
            {
                "clientId": OIDC_CLIENT_ID,
                "name": "Ordivant SSO isolated QA",
                "enabled": True,
                "protocol": "openid-connect",
                "publicClient": False,
                "secret": OIDC_CLIENT_SECRET,
                "standardFlowEnabled": True,
                "implicitFlowEnabled": False,
                "directAccessGrantsEnabled": False,
                "serviceAccountsEnabled": False,
                "redirectUris": [app_callback],
                "webOrigins": [app_origin],
                "attributes": {
                    "pkce.code.challenge.method": "S256",
                    "backchannel.logout.url": f"http://identity-api:8030/api/auth/oidc/backchannel-logout",
                    "backchannel.logout.session.required": "false",
                    "post.logout.redirect.uris": app_origin,
                },
                "protocolMappers": [_oidc_protocol_mapper()],
            },
            {
                "clientId": FIXTURE_ADMIN_CLIENT_ID,
                "name": "Disposable SSO fixture group administrator",
                "enabled": True,
                "protocol": "openid-connect",
                "publicClient": False,
                "secret": FIXTURE_ADMIN_CLIENT_SECRET,
                "standardFlowEnabled": False,
                "implicitFlowEnabled": False,
                "directAccessGrantsEnabled": False,
                "serviceAccountsEnabled": True,
                "fullScopeAllowed": True,
            },
        ],
        "identityProviders": [
            {
                "alias": SAML_IDP_ALIAS,
                "displayName": "QA SAML upstream",
                "providerId": "saml",
                "enabled": True,
                "trustEmail": True,
                "storeToken": False,
                "addReadTokenRoleOnCreate": False,
                "firstBrokerLoginFlowAlias": "first broker login",
                "config": {
                    "singleSignOnServiceUrl": f"{saml_issuer}/protocol/saml",
                    "idpEntityId": saml_issuer,
                    "entityId": SAML_CLIENT_ID,
                    "nameIDPolicyFormat": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
                    "principalType": "SUBJECT",
                    "signatureAlgorithm": "RSA_SHA256",
                    "wantAuthnRequestsSigned": "false",
                    "useMetadataDescriptorUrl": "true",
                    "metadataDescriptorUrl": f"http://identity-broker:8080/realms/{SAML_REALM}/protocol/saml/descriptor",
                    "validateSignature": "true",
                    "wantAssertionsSigned": "true",
                    "postBindingResponse": "true",
                    "syncMode": "FORCE",
                },
            }
        ],
        "users": _users(BROKER_REALM, BROKER_USERS),
    }
    saml = {
        "realm": SAML_REALM,
        "displayName": "Ordivant isolated SAML upstream QA",
        "enabled": True,
        "sslRequired": "none",
        "registrationAllowed": False,
        "resetPasswordAllowed": False,
        "loginWithEmailAllowed": True,
        "duplicateEmailsAllowed": False,
        "verifyEmail": False,
        "groups": [{"name": group, "path": "/" + group} for group in GROUPS],
        "clients": [
            {
                "clientId": SAML_CLIENT_ID,
                "name": "Ordivant broker SAML service provider",
                "enabled": True,
                "protocol": "saml",
                "publicClient": False,
                "standardFlowEnabled": True,
                "redirectUris": [broker_saml_acs],
                "attributes": {
                    "saml_name_id_format": "email",
                    "saml_force_name_id_format": "true",
                    "saml.assertion.signature": "true",
                    "saml.server.signature": "true",
                    "saml.client.signature": "false",
                    "saml_force_post_binding": "true",
                    "saml_assertion_consumer_url_post": broker_saml_acs,
                    "saml.authnstatement": "true",
                },
                "protocolMappers": [
                    {
                        "name": "email attribute",
                        "protocol": "saml",
                        "protocolMapper": "saml-user-property-mapper",
                        "consentRequired": False,
                        "config": {
                            "user.attribute": "email",
                            "attribute.name": "email",
                            "attribute.nameformat": "Basic",
                            "friendly.name": "email",
                            "single": "true",
                        },
                    },
                    {
                        "name": "groups attribute",
                        "protocol": "saml",
                        "protocolMapper": "saml-group-membership-mapper",
                        "consentRequired": False,
                        "config": {
                            "attribute.name": "groups",
                            "attribute.nameformat": "Basic",
                            "friendly.name": "groups",
                            "single": "true",
                            "full.path": "false",
                        },
                    },
                    {
                        "name": "first name attribute",
                        "protocol": "saml",
                        "protocolMapper": "saml-user-property-mapper",
                        "consentRequired": False,
                        "config": {
                            "user.attribute": "firstName",
                            "attribute.name": "firstName",
                            "attribute.nameformat": "Basic",
                            "friendly.name": "firstName",
                        },
                    },
                    {
                        "name": "last name attribute",
                        "protocol": "saml",
                        "protocolMapper": "saml-user-property-mapper",
                        "consentRequired": False,
                        "config": {
                            "user.attribute": "lastName",
                            "attribute.name": "lastName",
                            "attribute.nameformat": "Basic",
                            "friendly.name": "lastName",
                        },
                    },
                ],
            },
            {
                "clientId": SAML_FIXTURE_ADMIN_CLIENT_ID,
                "name": "Disposable SAML fixture user administrator",
                "enabled": True,
                "protocol": "openid-connect",
                "publicClient": False,
                "secret": SAML_FIXTURE_ADMIN_CLIENT_SECRET,
                "standardFlowEnabled": False,
                "implicitFlowEnabled": False,
                "directAccessGrantsEnabled": False,
                "serviceAccountsEnabled": True,
                "fullScopeAllowed": True,
            },
        ],
        "users": _users(SAML_REALM, SAML_USERS),
    }
    # Importers can manage only the broker realm. No master realm role is granted.
    broker["users"].append(
        {
            "id": stable_id(BROKER_REALM, FIXTURE_ADMIN_CLIENT_ID),
            "username": "service-account-" + FIXTURE_ADMIN_CLIENT_ID,
            "enabled": True,
            "serviceAccountClientId": FIXTURE_ADMIN_CLIENT_ID,
            "clientRoles": {
                "realm-management": [
                    "query-users",
                    "view-users",
                    "manage-users",
                    "view-realm",
                    "manage-realm",
                    "view-clients",
                    "query-clients",
                    "manage-clients",
                    "view-identity-providers",
                ]
            },
        }
    )
    broker["identityProviderMappers"] = [
        {
            "name": f"QA SAML import {property_name}",
            "identityProviderAlias": SAML_IDP_ALIAS,
            "identityProviderMapper": "saml-user-attribute-idp-mapper",
            "config": {
                "attribute.name": property_name,
                "user.attribute": property_name,
                "syncMode": "FORCE",
            },
        }
        for property_name in ["email", "firstName", "lastName"]
    ]
    saml["users"].append(
        {
            "id": stable_id(SAML_REALM, SAML_FIXTURE_ADMIN_CLIENT_ID),
            "username": "service-account-" + SAML_FIXTURE_ADMIN_CLIENT_ID,
            "enabled": True,
            "serviceAccountClientId": SAML_FIXTURE_ADMIN_CLIENT_ID,
            "clientRoles": {
                "realm-management": [
                    "query-users",
                    "view-users",
                    "manage-users",
                    "query-groups",
                    "view-clients",
                    "query-clients",
                ]
            },
        }
    )
    return broker, saml


def generate(args: argparse.Namespace) -> int:
    public_origin = loopback_origin(args.public_origin, 8093, "--public-origin")
    app_origin = loopback_origin(args.app_origin, 8092, "--app-origin")
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    broker, saml = build_realms(public_origin, app_origin)
    files = {
        f"{BROKER_REALM}-realm.json": broker,
        f"{SAML_REALM}-realm.json": saml,
    }
    for name, value in files.items():
        (output / name).write_text(json.dumps(value, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    manifest = {
        "keycloak_version": "26.8.0",
        "public_origin": public_origin,
        "app_origin": app_origin,
        "broker_realm": BROKER_REALM,
        "upstream_saml_realm": SAML_REALM,
        "oidc_client_id": OIDC_CLIENT_ID,
        "saml_client_id": SAML_CLIENT_ID,
        "saml_fixture_admin_client_id": SAML_FIXTURE_ADMIN_CLIENT_ID,
        "saml_idp_alias": SAML_IDP_ALIAS,
        "groups": list(GROUPS),
        "users": [{"email": row["email"], "realm": BROKER_REALM, "subject": stable_id(BROKER_REALM, row["email"])} for row in BROKER_USERS]
        + [{"email": row["email"], "realm": SAML_REALM, "subject": stable_id(SAML_REALM, row["email"])} for row in SAML_USERS],
        "import_note": "Mount this directory at /opt/keycloak/data/import and start the isolated Keycloak container with --import-realm.",
    }
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "generated", "output_dir": str(output), "files": sorted(files), **{k: manifest[k] for k in ["broker_realm", "upstream_saml_realm", "oidc_client_id", "saml_client_id", "saml_idp_alias", "groups"]}}, indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    command = subparsers.add_parser("generate", help="write Keycloak startup import realms for loopback QA")
    command.add_argument("--output-dir", type=Path, default=ROOT / "tests/fixtures/sso/import")
    command.add_argument("--public-origin", default="http://127.0.0.1:8093")
    command.add_argument("--app-origin", default="http://127.0.0.1:8092")
    command.set_defaults(func=generate)
    args = parser.parse_args()
    try:
        return args.func(args)
    except argparse.ArgumentTypeError as error:
        parser.error(str(error))
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
