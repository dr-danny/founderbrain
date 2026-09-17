"""Browser regressions with the real Hexclave SDK and disposable HTTP fixtures.

Run after installing Python playwright and its Chromium browser. No live identity
project, emails, database, or provider calls are used by these tests.
"""
import base64
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import unittest
from urllib.parse import parse_qs, quote, urlencode, urlparse
from urllib.request import urlopen

from playwright.sync_api import sync_playwright, expect

PROJECT = "7f2d1c3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f"
AUTH_ORIGIN = "https://api.hexclave.com"


def token(user, session):
    def encode(value):
        return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")
    # The browser decodes these; cryptographic verification is covered by auth.test.ts.
    return ".".join([encode({"alg": "ES256", "typ": "JWT"}), encode({
        "sub": user, "exp": int(time.time()) + 3600, "iat": int(time.time()),
        "refresh_token_id": session,
        "iss": AUTH_ORIGIN + "/api/v1/projects/" + PROJECT, "aud": PROJECT,
        "project_id": PROJECT, "branch_id": "main", "role": "authenticated",
        "name": "Fixture", "email": user + "@example.test", "email_verified": True,
        "selected_team_id": None, "signed_up_at": 1, "is_anonymous": False,
        "is_restricted": False, "restricted_reason": None, "requires_totp_mfa": False,
    }), "fixture-signature"])


class BrowserAuthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        cls.origin = f"http://127.0.0.1:{port}"
        cls.server_log = tempfile.TemporaryFile(mode="w+")
        cls.server = subprocess.Popen(
            ["npm", "run", "fb:preview", "--", "--port", str(port), "--strictPort"],
            cwd=Path(__file__).resolve().parents[1], stdout=cls.server_log,
            stderr=subprocess.STDOUT, start_new_session=True,
        )
        cls.addClassCleanup(cls.stop_server)
        for _ in range(100):
            try:
                with urlopen(cls.origin, timeout=1):
                    break
            except OSError:
                if cls.server.poll() is not None:
                    cls.server_log.seek(0)
                    raise RuntimeError(cls.server_log.read())
                time.sleep(0.1)
        else:
            raise RuntimeError("Vite did not start")
        cls.playwright = sync_playwright().start()
        cls.addClassCleanup(cls.playwright.stop)
        cls.browser = cls.playwright.chromium.launch(headless=True)
        cls.addClassCleanup(cls.browser.close)

    @classmethod
    def stop_server(cls):
        import signal
        os.killpg(cls.server.pid, signal.SIGTERM)
        cls.server.wait(timeout=10)
        cls.server_log.close()

    def setUp(self):
        self.context = self.browser.new_context()
        self.addCleanup(self.context.close)
        self.page = self.context.new_page()
        self.auth_requests = []
        self.errors = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        # Keep every request off real services, including the SDK's separate telemetry host.
        self.context.route("**/*", lambda r: r.continue_() if r.request.url.startswith(self.origin + "/") else self.auth_route(r))
        self.context.route(self.origin + "/sdk-check", lambda r: r.fulfill(
            content_type="text/html", body="<h1>Private founder research</h1>"))
        self.context.route(self.origin + "/api/config", lambda r: r.fulfill(json={
            "authMode": "hexclave", "hexclave": {
                "projectId": PROJECT, "apiUrl": AUTH_ORIGIN, "publishableClientKey": None,
            }, "aiEnabled": False,
        }))

    def auth_route(self, route):
        request = route.request
        path = urlparse(request.url).path
        self.auth_requests.append((request.method, path))
        if request.is_navigation_request():
            route.fulfill(content_type="text/html", body="<h1>Hosted sign-in fixture</h1>")
        elif path == "/api/v1/projects/current":
            route.fulfill(json={
                "id": PROJECT, "display_name": "Fixture", "is_development_environment": False,
                "pushed_config_error": None, "config_warnings": [], "config": {
                    "sign_up_enabled": False, "credential_enabled": False, "magic_link_enabled": True,
                    "passkey_enabled": False, "client_team_creation_enabled": False,
                    "client_user_deletion_enabled": False, "allow_team_api_keys": False,
                    "allow_user_api_keys": False, "enabled_oauth_providers": [],
                    "allow_localhost": True, "domains": [{"domain": self.origin}],
                },
            })
        elif path == "/api/v1/users/me":
            access = request.headers["x-hexclave-access-token"]
            claims = json.loads(base64.urlsafe_b64decode(access.split(".")[1] + "==="))
            route.fulfill(json={
                "id": claims["sub"], "primary_email": claims["sub"] + "@example.test",
                "primary_email_verified": True, "display_name": "Fixture", "profile_image_url": None,
                "signed_up_at_millis": 1, "client_metadata": {}, "client_read_only_metadata": {},
                "has_password": False, "auth_with_email": True, "otp_auth_enabled": True,
                "oauth_providers": [], "passkey_auth_enabled": False, "requires_totp_mfa": False,
                "is_anonymous": False, "is_restricted": False, "restricted_reason": None,
                "restricted_by_admin": False, "restricted_by_admin_reason": None, "selected_team": None,
            })
        elif path == "/api/v1/auth/sessions/current" and request.method == "DELETE":
            route.fulfill(json={})
        elif path == "/api/v1/auth/oauth/token":
            route.fulfill(json={
                "access_token": token("ada", "hosted-session"),
                "refresh_token": "fixture-refresh-hosted-session", "token_type": "Bearer",
                "expires_in": 3600,
            })
        elif "analytics" in path or "session-replay" in path:
            route.fulfill(json={})
        else:
            route.fulfill(status=400, json={"error": "Unexpected fixture request", "path": path})

    def set_session(self, user="ada", session="first-session"):
        access = token(user, session)
        refresh = "fixture-refresh-" + session
        self.context.add_cookies([
            {"name": f"hexclave-refresh-{PROJECT}--default", "value": quote(json.dumps({
                "refresh_token": refresh, "updated_at_millis": int(time.time() * 1000),
            })), "url": self.origin},
            {"name": "hexclave-access", "value": quote(json.dumps([refresh, access])), "url": self.origin},
        ])
        return access

    def open_sdk(self):
        self.page.goto(self.origin + "/sdk-check")
        self.page.evaluate("""async config => {
            const { createHexclave } = await import('/hexclave.ts');
            window.auth = createHexclave(config);
            window.session = await window.auth.currentSession();
        }""", {"projectId": PROJECT, "apiUrl": AUTH_ORIGIN, "publishableClientKey": None})

    def test_private_text_never_starts_analytics_or_replay_requests(self):
        self.set_session()
        self.open_sdk()
        self.page.locator("h1").click()
        self.page.evaluate("window.dispatchEvent(new Event('pagehide'))")
        # pagehide flushes the SDK's pending events immediately.
        self.page.wait_for_timeout(500)
        forbidden = [r for r in self.auth_requests if r[0] != "GET"]
        self.assertEqual(forbidden, [], "Private DOM text must never reach Hexclave telemetry")
        self.assertEqual(self.errors, [])

    def test_existing_draft_session_uses_same_founders_new_login(self):
        first = self.set_session()
        self.open_sdk()
        self.assertEqual(self.page.evaluate("window.session.getToken()"), first)
        second = self.set_session(session="renewed-session")
        self.page.wait_for_timeout(200)  # The SDK polls cookie changes every 100 ms.
        self.assertEqual(self.page.evaluate("window.session.getToken()"), second)
        self.assertEqual(self.errors, [])

    def test_draft_session_refuses_another_founders_login(self):
        self.set_session()
        self.open_sdk()
        self.set_session(user="grace", session="other-founder")
        self.page.wait_for_timeout(200)
        self.assertIsNone(self.page.evaluate("window.session.getToken()"))
        self.assertEqual(self.errors, [])

    def test_dev_page_loads_and_signed_out_user_can_start_sign_in(self):
        self.page.goto(self.origin)
        expect(self.page.get_by_role("button", name="Sign in", exact=True)).to_be_visible()
        self.page.get_by_role("button", name="Sign in", exact=True).click()
        expect(self.page.get_by_role("heading", name="Hosted sign-in fixture")).to_be_visible()
        hosted = urlparse(self.page.url)
        self.assertEqual(hosted.scheme, "https")
        self.assertIn(PROJECT, hosted.hostname)
        self.assertTrue(parse_qs(hosted.query).get("hexclave_cross_domain_state"))
        self.assertEqual(self.errors, [])

    def test_hosted_callback_establishes_session_and_api_uses_access_token(self):
        received_tokens = []
        def me(route):
            received_tokens.append(route.request.headers.get("x-stack-access-token"))
            route.fulfill(json={"email": "ada@example.test"})
        self.context.route(self.origin + "/api/me", me)
        self.context.route(self.origin + "/api/brain", lambda r: r.fulfill(
            status=503, json={"error": "fixture", "message": "Workspace fixture reached"}))
        self.page.goto(self.origin)
        self.page.get_by_role("button", name="Sign in", exact=True).click()
        expect(self.page.get_by_role("heading", name="Hosted sign-in fixture")).to_be_visible()
        state = parse_qs(urlparse(self.page.url).query)["hexclave_cross_domain_state"][0]
        self.page.goto(self.origin + "/?" + urlencode({"code": "fixture-code", "state": state}))
        expect(self.page.get_by_text("Workspace fixture reached", exact=True)).to_be_visible()
        self.assertTrue(received_tokens)
        self.assertTrue(all(t and t.endswith(".fixture-signature") for t in received_tokens))
        self.assertNotIn("code", parse_qs(urlparse(self.page.url).query))
        self.assertEqual(self.errors, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
