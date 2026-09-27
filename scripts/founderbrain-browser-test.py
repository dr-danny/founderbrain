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

    def test_signed_in_empty_workspace_opens_welcome_typeform(self):
        brain = {
            "workspaceId": "ws_fixture", "version": 0, "sha": "0" * 64, "updatedAt": None,
            "brain": {
                "schemaVersion": 1,
                "identity": {"name": "", "venture": "", "role": "", "stage": "exploring", "goal": "", "approved": False},
                "customer": {"segment": "", "problem": "", "outcome": "", "workaround": "",
                             "evidenceStatus": "hypothesis", "evidence": "", "approved": False},
                "offer": {"description": "", "delivery": "", "outcome": "", "cta": "", "price": "", "approved": False},
                "voice": {"tone": "", "boundaries": "", "sample": "", "approved": False},
            },
            "readiness": {"identity": False, "customer": False, "offer": False, "voice": False, "output": False},
            "verified": False, "artifact": None,
        }
        orientation = {
            "firstLoginScreen": 1, "firstLoginCompletedAt": None, "track": None,
            "contentScreen": 1, "contentCompletedAt": None, "contentAnswers": {},
            "outreachScreen": 1, "outreachCompletedAt": None, "outreachAnswers": {},
            "ghlScreen": 1, "ghlCompletedAt": None, "ghlAnswers": {},
            "updatedAt": "2026-09-18T00:00:00.000Z",
        }
        self.context.route(self.origin + "/api/me", lambda r: r.fulfill(json={"email": "ada@example.test"}))
        self.context.route(self.origin + "/api/brain", lambda r: r.fulfill(json=brain))
        self.context.route(self.origin + "/api/artifact", lambda r: r.fulfill(json={"artifact": None, "stale": False}))
        self.context.route(self.origin + "/api/orientation", lambda r: r.fulfill(json=orientation))
        self.page.goto(self.origin)
        self.page.get_by_role("button", name="Sign in", exact=True).click()
        expect(self.page.get_by_role("heading", name="Hosted sign-in fixture")).to_be_visible()
        state = parse_qs(urlparse(self.page.url).query)["hexclave_cross_domain_state"][0]
        self.page.goto(self.origin + "/?" + urlencode({"code": "fixture-code", "state": state}))
        expect(self.page.get_by_text("Welcome", exact=False)).to_be_visible(timeout=20000)
        expect(self.page.locator(".typeform-sequence")).to_be_visible()
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

    def _complete_brain(self):
        section = {"approved": True}
        return {
            "schemaVersion": 1,
            "identity": {
                "name": "Ada", "venture": "Fixture Co", "role": "Founder",
                "stage": "building", "revenueBand": "pre", "goal": "More qualified calls",
                "track": "b2b", "hybrid": False, "model": "", "modelNearestFit": False,
                "modelNote": "", "team": "Just me", **section,
            },
            "customer": {
                "segment": "Ops leads at logistics firms", "problem": "Manual scheduling",
                "outcome": "An hour back a day", "workaround": "Spreadsheets",
                "evidenceStatus": "supported", "evidence": "12 paying pilots",
                "buyer": "Ops director", "trigger": "Missed a shipment", "bestFit": "Regional 3PLs",
                "attention": "", "adjacent": "", **section,
            },
            "offer": {
                "description": "Scheduling software for small fleets", "delivery": "Web app + onboarding call",
                "outcome": "Fewer missed pickups", "cta": "Book a demo", "price": "$300/mo",
                "why": "Built by a former dispatcher", "pricingModel": "subscription", "proof": "12 pilots",
                **section,
            },
            "voice": {
                "tone": "Direct and a little dry", "boundaries": "No hype, no jargon",
                "sample": "We fix the schedule so you do not have to.", "sampleCount": 10, **section,
            },
            "context": {
                "channelsActive": "", "channelsDormant": "", "emailProvider": "google",
                "domainStatus": "warm", "igAccountType": "", "customersNow": "12",
                "avgMonthlyValue": "300", "target90": "40", "sourceMaterial": "", **section,
            },
        }

    def _complete_orientation(self):
        return {
            "firstLoginScreen": 2, "firstLoginCompletedAt": "2026-09-18T00:00:00.000Z",
            "track": "b2b",
            # Screen 4 in contentScreens() is always "thirty": content-intro, track, the
            # track-setup confirm screen, then thirty. Loading straight there is what the
            # real founder flow does once the earlier chapter screens are already saved.
            "contentScreen": 4, "contentCompletedAt": None, "contentAnswers": {},
            "outreachScreen": 1, "outreachCompletedAt": None, "outreachAnswers": {},
            "ghlScreen": 1, "ghlCompletedAt": None, "ghlAnswers": {},
            "updatedAt": "2026-09-18T00:00:00.000Z",
        }

    def test_higgsfield_connect_modal_portals_under_body_and_escape_closes(self):
        """Regression for the dark-blank-backdrop bug: the Content chapter's `.entry-panel`
        keeps a `both`-filled `transform` animation running forever, which makes it the
        containing block for any `position: fixed` descendant. Before the portal fix this
        blew up `.pack-modal` to the ancestor's full scroll height. After the fix the dialog
        must render as a direct child of `document.body`, size to the viewport, close on
        Escape, and hand focus back to the button that opened it."""
        brain = {
            "workspaceId": "ws_fixture", "version": 3, "sha": "0" * 64, "updatedAt": "2026-09-18T00:00:00.000Z",
            "brain": self._complete_brain(),
            "readiness": {"identity": True, "customer": True, "offer": True, "voice": True, "context": True, "output": True},
            "verified": True, "artifact": None,
        }
        self.context.route(self.origin + "/api/me", lambda r: r.fulfill(json={"email": "ada@example.test"}))
        self.context.route(self.origin + "/api/brain", lambda r: r.fulfill(json=brain))
        self.context.route(self.origin + "/api/artifact", lambda r: r.fulfill(json={"artifact": None, "stale": False}))
        self.context.route(self.origin + "/api/orientation", lambda r: r.fulfill(json=self._complete_orientation()))
        self.context.route(self.origin + "/api/history", lambda r: r.fulfill(json={"versions": []}))
        self.context.route(self.origin + "/api/media", lambda r: r.fulfill(json={
            "items": [], "higgsfield": {"connected": False, "hint": None, "spentUsd": 0, "capUsd": 50},
        }))
        self.context.route(self.origin + "/api/config", lambda r: r.fulfill(json={
            "authMode": "hexclave", "hexclave": {
                "projectId": PROJECT, "apiUrl": AUTH_ORIGIN, "publishableClientKey": None,
            }, "aiEnabled": False, "mediaEnabled": True, "routinesEnabled": False,
        }))

        self.page.set_viewport_size({"width": 1280, "height": 900})
        self.page.goto(self.origin)
        self.page.get_by_role("button", name="Sign in", exact=True).click()
        expect(self.page.get_by_role("heading", name="Hosted sign-in fixture")).to_be_visible()
        state = parse_qs(urlparse(self.page.url).query)["hexclave_cross_domain_state"][0]
        self.page.goto(self.origin + "/?" + urlencode({"code": "fixture-code", "state": state}))

        # Signed-in founder lands on the Atlanta hub; open the Content chapter, which
        # mounts MediaProvider under the animated .entry-panel typeform ancestor.
        expect(self.page.get_by_role("button", name="Set up your content plan")).to_be_visible(timeout=20000)
        self.page.get_by_role("button", name="Set up your content plan").click()
        expect(self.page.get_by_role("heading", name="Thirty pieces")).to_be_visible(timeout=20000)
        connect_button = self.page.get_by_role("button", name="Connect Higgsfield", exact=True)
        expect(connect_button).to_be_visible(timeout=20000)

        # Sanity check on the bug itself: before opening the dialog, the transformed
        # ancestor really is there, still animating (fill-mode "both" never releases it).
        ancestor_transformed = self.page.evaluate(
            """() => {
                const panel = document.querySelector('.entry-panel');
                return panel ? getComputedStyle(panel).transform !== 'none' : null;
            }"""
        )
        self.assertTrue(ancestor_transformed, ".entry-panel must still be transformed for this regression to be meaningful")

        # Reproduce the long 30-piece layout without generating content or contacting a provider.
        self.page.locator(".typeform-body").evaluate("el => el.style.minHeight = '15000px'")
        connect_button.click()
        dialog = self.page.get_by_role("dialog", name="Connect Higgsfield")
        expect(dialog).to_be_visible()

        # The fix: the dialog is a portal child of <body>, not nested under the
        # transformed .entry-panel, so it is never trapped inside a broken containing block.
        portal_info = self.page.evaluate(
            """() => {
                const modal = document.querySelector('.pack-modal');
                const rect = modal.getBoundingClientRect();
                return {
                    parentIsBody: modal.parentElement === document.body,
                    underEntryPanel: Boolean(modal.closest('.entry-panel')),
                    height: rect.height,
                };
            }"""
        )
        self.assertTrue(portal_info["parentIsBody"], ".pack-modal must be a direct child of document.body")
        self.assertFalse(portal_info["underEntryPanel"], ".pack-modal must not sit under the transformed .entry-panel")
        # Before the fix this was reported at ~15340px; it must now match the viewport.
        self.assertLess(portal_info["height"], 950, ".pack-modal must size to the viewport, not the ancestor's scroll height")

        card = self.page.locator(".higgsfield-card")
        expect(card).to_be_visible()
        card_box = card.bounding_box()
        self.assertIsNotNone(card_box)
        self.assertGreaterEqual(card_box["y"], 0)
        self.assertLess(card_box["y"], 900, "the card must be inside the 900px viewport, not scrolled far below it")

        # Initial focus lands inside the dialog, on "Not now" rather than the key fields.
        initial_focus = self.page.evaluate("() => document.activeElement && document.activeElement.textContent.trim()")
        self.assertEqual(initial_focus, "Not now")

        # Escape closes it and hands focus back to the button that opened it.
        self.page.keyboard.press("Escape")
        expect(self.page.locator(".pack-modal")).to_have_count(0)
        restored_focus = self.page.evaluate("() => document.activeElement && document.activeElement.textContent.trim()")
        self.assertEqual(restored_focus, "Connect Higgsfield")

        # The portal must also fit a phone viewport, with keyboard focus contained and
        # the existing Not now action usable without entering any credentials.
        self.page.set_viewport_size({"width": 390, "height": 844})
        connect_button.click()
        expect(dialog).to_be_visible()
        mobile_box = self.page.locator(".higgsfield-card").bounding_box()
        self.assertGreaterEqual(mobile_box["x"], 0)
        self.assertGreaterEqual(mobile_box["y"], 0)
        self.assertLessEqual(mobile_box["x"] + mobile_box["width"], 390)
        self.assertLessEqual(mobile_box["y"] + mobile_box["height"], 844)
        self.page.keyboard.press("Tab")
        self.assertTrue(dialog.evaluate("el => el.contains(document.activeElement)"))
        dialog.get_by_role("button", name="Not now", exact=True).click()
        expect(dialog).to_have_count(0)
        expect(connect_button).to_be_focused()
        self.assertEqual(self.errors, [])

    def _open_ghl_fixture(self, *, name="Demo Clinic", remote=None):
        """All provider traffic is intercepted. No real founder or CRM is used."""
        brain = self._complete_brain()
        brain["identity"]["track"] = "b2c"
        orientation = self._complete_orientation()
        orientation.update({"track": "b2c", "ghlScreen": 5,
                            "ghlCompletedAt": "2026-09-27T00:00:00.000Z",
                            "ghlAnswers": {"hasAccount": True, "connected": True}})
        state = {
            "connection": {"connected": True, "locationId": "demo-location",
                           "locationName": name, "connectionId": "fixture-connection-1",
                           "nameUnavailable": name is None},
            "link": {"key": "dm_booking_link", "name": "DM Booking Link", "value": remote},
            "writes": [], "disconnects": [], "starts": 0,
            "failStatus": False, "failLink": False, "proven": True,
        }
        self.context.route(self.origin + "/api/**", lambda r: r.fulfill(status=404, json={"message": "Unknown fixture endpoint"}))
        self.context.route(self.origin + "/api/config", lambda r: r.fulfill(json={
            "authMode": "hexclave", "hexclave": {"projectId": PROJECT, "apiUrl": AUTH_ORIGIN,
            "publishableClientKey": None}, "aiEnabled": True, "crmConnectEnabled": True,
        }))
        self.context.route(self.origin + "/api/me", lambda r: r.fulfill(json={"email": "ada@example.test"}))
        self.context.route(self.origin + "/api/brain", lambda r: r.fulfill(json={
            "workspaceId": "ws_fixture", "version": 3, "sha": "0" * 64,
            "updatedAt": "2026-09-27T00:00:00.000Z", "brain": brain,
            "readiness": dict.fromkeys(["identity", "customer", "offer", "voice", "context", "output"], True),
            "verified": True, "artifact": None,
        }))
        # Model the completed setup without the unrelated fixed V2-upgrade banner.
        self.context.route(self.origin + "/api/artifact", lambda r: r.fulfill(json={
            "artifact": {"id": "ghl-fixture-pack", "sourceVersion": 3,
                         "text": "## Content\nSynthetic fixture.\n## Outreach\nSynthetic fixture.\n90 day plan\nSynthetic fixture.",
                         "acceptedAt": "2026-09-27T00:00:00.000Z"},
            "stale": False,
        }))
        self.context.route(self.origin + "/api/orientation", lambda r: r.fulfill(json=orientation))
        self.context.route(self.origin + "/api/history", lambda r: r.fulfill(json={"versions": []}))
        self.context.route(self.origin + "/api/usage", lambda r: r.fulfill(json={
            "ai": {"events": 0, "inputTokens": 0, "outputTokens": 0, "priceMicroUsd": 0},
            "firecrawl": {"scrapes": 0, "credits": 0, "priceMicroUsd": 0}, "totalMicroUsd": 0,
        }))
        def status(route):
            if state["failStatus"]:
                route.fulfill(status=503, json={"message": "Status fixture unavailable"})
            else:
                route.fulfill(json=state["connection"])
        def links(route):
            if route.request.method == "GET":
                route.fulfill(json={"connection": state["connection"], "links": [state["link"]]})
                return
            body = route.request.post_data_json
            state["writes"].append(body)
            if state["failLink"]:
                route.fulfill(status=422, json={"message": "Provider fixture refused the link"})
                return
            state["link"]["value"] = body["url"]
            route.fulfill(json={"connection": state["connection"], "link": state["link"],
                                "written": True, "proven": state["proven"]})
        def disconnect(route):
            state["disconnects"].append(route.request.post_data_json)
            state["connection"] = {"connected": False, "locationId": None,
                                   "locationName": None, "connectionId": None}
            orientation["ghlAnswers"]["connected"] = False
            orientation["ghlCompletedAt"] = None
            route.fulfill(json={**state["connection"], "orientation": orientation})
        def start(route):
            state["starts"] += 1
            route.fulfill(json={"url": self.origin + "/ghl-fixture-picker"})
        self.context.route(self.origin + "/api/oauth/status", status)
        self.context.route(self.origin + "/api/ghl/booking-links*", links)
        self.context.route(self.origin + "/api/oauth/connection", disconnect)
        self.context.route(self.origin + "/api/oauth/start", start)
        self.context.route(self.origin + "/ghl-fixture-picker", lambda r: r.fulfill(content_type="text/html", body="<h1>Fixture account picker</h1>"))
        self.set_session()
        self.page.goto(self.origin)
        self.page.get_by_role("button", name="Review GoHighLevel", exact=True).click()
        panel = self.page.get_by_role("region", name="Connected GoHighLevel subaccount", exact=True)
        expect(panel).to_be_visible()
        expect(panel.get_by_role("textbox", name="DM Booking Link HTTPS URL", exact=True)).to_be_visible()
        return state, panel

    def test_ghl_named_destination_transfer_replace_disconnect_and_reconnect(self):
        state, panel = self._open_ghl_fixture()
        expect(panel.get_by_role("heading", name="Demo Clinic", exact=True)).to_be_visible()
        expect(panel).to_contain_text("demo-location")
        field = panel.get_by_role("textbox", name="DM Booking Link HTTPS URL", exact=True)
        transfer = panel.get_by_role("button", name="Transfer DM Booking Link to Demo Clinic", exact=True)
        field.fill("javascript:alert(1)")
        transfer.click()
        expect(panel).to_contain_text("Enter the actual HTTPS booking URL")
        self.assertEqual(state["writes"], [])
        field.fill("https://book.example.test/first")
        transfer.click()
        expect(panel).to_contain_text("Written and verified in Demo Clinic")
        self.assertEqual(state["writes"][-1]["connectionId"], "fixture-connection-1")
        field.fill("https://book.example.test/second")
        transfer.click()
        expect(panel.get_by_role("group", name="Replace DM Booking Link")).to_be_visible()
        self.assertEqual(len(state["writes"]), 1)
        panel.get_by_role("button", name="Confirm replacement", exact=True).click()
        expect(panel.get_by_role("link", name="https://book.example.test/second", exact=True)).to_be_visible()
        self.assertEqual(state["writes"][-1]["expectedValue"], "https://book.example.test/first")
        self.assertIs(state["writes"][-1]["replaceExisting"], True)
        panel.get_by_role("button", name="Disconnect", exact=True).click()
        expect(panel).to_contain_text("It does not delete content or workflows")
        self.assertEqual(state["disconnects"], [])
        panel.get_by_role("button", name="Disconnect Demo Clinic", exact=True).click()
        expect(self.page.get_by_role("heading", name="No subaccount connected", exact=True)).to_be_visible()
        expect(self.page.get_by_text("Written and verified in Demo Clinic", exact=True)).to_have_count(0)
        self.assertEqual(state["disconnects"], [{"connectionId": "fixture-connection-1", "confirmed": True}])
        self.page.get_by_role("button", name="Connect another subaccount", exact=True).click()
        expect(self.page.get_by_role("heading", name="Fixture account picker", exact=True)).to_be_visible()
        self.assertEqual(state["starts"], 1)
        self.assertEqual(self.errors, [])

    def test_ghl_failed_transfer_retains_input_and_unverified_is_not_success(self):
        state, panel = self._open_ghl_fixture()
        field = panel.get_by_role("textbox", name="DM Booking Link HTTPS URL", exact=True)
        transfer = panel.get_by_role("button", name="Transfer DM Booking Link to Demo Clinic", exact=True)
        state["failLink"] = True
        field.fill("https://book.example.test/retry")
        transfer.click()
        expect(panel).to_contain_text("Your typed URL is still here")
        expect(field).to_have_value("https://book.example.test/retry")
        state["failLink"] = False
        state["proven"] = False
        transfer.click()
        expect(panel).to_contain_text("GoHighLevel did not verify the exact URL")
        expect(panel.get_by_text("Written and verified in Demo Clinic", exact=True)).to_have_count(0)
        self.assertEqual(self.errors, [])

    def test_ghl_status_failure_keeps_name_but_blocks_writes(self):
        state, panel = self._open_ghl_fixture()
        state["failStatus"] = True
        panel.get_by_role("button", name="Refresh status", exact=True).click()
        expect(panel).to_contain_text("could not verify")
        expect(panel.get_by_role("heading", name="Demo Clinic", exact=True)).to_be_visible()
        expect(panel.get_by_role("button", name="Disconnect", exact=True)).to_be_disabled()
        expect(panel.get_by_role("button", name="Transfer DM Booking Link to Demo Clinic", exact=True)).to_be_disabled()
        expect(self.page.get_by_role("heading", name="No subaccount connected", exact=True)).to_have_count(0)
        state["failStatus"] = False
        panel.get_by_role("button", name="Refresh status", exact=True).click()
        expect(panel.get_by_role("button", name="Disconnect", exact=True)).to_be_enabled()
        self.assertEqual(self.errors, [])

    def test_ghl_name_fallback_remains_disconnectable_on_mobile(self):
        self.page.set_viewport_size({"width": 390, "height": 844})
        state, panel = self._open_ghl_fixture(name=None)
        expect(panel.get_by_role("heading", name="Subaccount name unavailable", exact=True)).to_be_visible()
        expect(panel).to_contain_text("demo-location")
        expect(panel.get_by_role("button", name="Disconnect", exact=True)).to_be_enabled()
        box = panel.bounding_box()
        self.assertGreaterEqual(box["x"], 0)
        self.assertLessEqual(box["x"] + box["width"], 390)
        self.assertEqual(state["writes"], [])
        self.assertEqual(self.errors, [])

    # -- /highlevel and /oauth/callback recovery: no useFounderBrainApp mount --------
    #
    # These cover the GoHighLevel Marketplace "Open" landing and a broken/expired
    # /oauth/callback redirect. Both must render without ever checking a session or
    # calling the API: nothing here is a private-app boot screen.

    def _no_backend_requests(self):
        """Collects every request the page makes so a test can assert none of them
        reached the API or the Hexclave auth origin (asset/document loads are fine)."""
        seen = []
        self.page.on("request", lambda r: seen.append(r.url))
        return seen

    def _assert_no_auth_or_api_traffic(self, seen):
        def is_backend_call(url):
            # Match the request path, not a raw string prefix: "/api.ts" is the Vite
            # module for api.ts (a same-origin source file, not a backend call) and
            # must not be miscounted as "/api" traffic just because it starts with
            # those four characters.
            if not url.startswith(self.origin):
                return False
            path = urlparse(url).path
            return path == "/api" or path.startswith("/api/")

        backend = [u for u in seen if is_backend_call(u)]
        # Vite module URLs can contain "hexclave" without contacting the auth service.
        # Count actual auth-origin traffic, not same-origin JavaScript imports.
        auth = [u for u in seen if u.startswith(AUTH_ORIGIN + "/")]
        self.assertEqual(backend, [], "a public recovery screen must never call the API")
        self.assertEqual(auth, [], "a public recovery screen must never touch Hexclave auth")
        self.assertEqual(self.auth_requests, [], "no cross-origin auth traffic should start at all")

    LAUNCH_HEADING = "Open FounderBrain."

    def _expect_launch_screen(self):
        expect(self.page.get_by_role("heading", name=self.LAUNCH_HEADING, exact=True)).to_be_visible()
        link = self.page.get_by_role("link", name="Open FounderBrain", exact=True)
        expect(link).to_be_visible()
        self.assertEqual(link.get_attribute("href"), "/")
        self.assertEqual(link.get_attribute("target"), "_top")
        return link

    def _expect_no_launch_screen(self):
        expect(self.page.get_by_role("heading", name=self.LAUNCH_HEADING, exact=True)).to_have_count(0)

    def test_highlevel_launch_route_shows_launch_screen_with_no_auth_or_network(self):
        seen = self._no_backend_requests()
        self.page.goto(self.origin + "/highlevel")
        link = self._expect_launch_screen()
        self.page.wait_for_timeout(200)
        self._assert_no_auth_or_api_traffic(seen)
        self.assertEqual(self.errors, [])
        # It must never claim a connection: this screen has no way to know one exists,
        # and must never show the real connected-status region from the authenticated app.
        expect(
            self.page.get_by_role("region", name="Connected GoHighLevel subaccount")
        ).to_have_count(0)
        box = link.bounding_box()
        self.assertIsNotNone(box)
        self.assertGreaterEqual(box["x"], 0)

        # Same route, phone viewport: the CTA must stay reachable and on-screen.
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.page.goto(self.origin + "/highlevel")
        mobile_link = self._expect_launch_screen()
        mobile_box = mobile_link.bounding_box()
        self.assertIsNotNone(mobile_box)
        self.assertGreaterEqual(mobile_box["x"], 0)
        self.assertLessEqual(mobile_box["x"] + mobile_box["width"], 390)
        self.assertEqual(self.errors, [])

    def test_highlevel_launch_route_strips_a_stray_query_or_fragment(self):
        # /highlevel never needs a query or fragment; any that arrive (e.g. a stale
        # bookmark or a Marketplace link with tracking params) are dropped on load.
        self.page.goto(self.origin + "/highlevel?code=abc123&state=xyz789#leftover")
        self._expect_launch_screen()
        parsed = urlparse(self.page.url)
        self.assertEqual(parsed.path, "/highlevel")
        self.assertEqual(parsed.query, "")
        self.assertEqual(parsed.fragment, "")
        self.assertEqual(self.errors, [])

    def test_oauth_callback_missing_state_shows_recovery_and_strips_query(self):
        seen = self._no_backend_requests()
        self.page.goto(self.origin + "/oauth/callback?code=abc123")
        self._expect_launch_screen()
        parsed = urlparse(self.page.url)
        self.assertEqual(parsed.path, "/oauth/callback")
        self.assertEqual(parsed.query, "", "the code must be stripped from the address bar promptly")
        self.assertEqual(parsed.fragment, "")
        self.page.wait_for_timeout(200)
        self._assert_no_auth_or_api_traffic(seen)
        self.assertEqual(self.errors, [])

    def test_oauth_callback_duplicate_code_is_not_silently_accepted(self):
        self.page.goto(self.origin + "/oauth/callback?code=a&code=b&state=xyz")
        self._expect_launch_screen()
        self.assertEqual(urlparse(self.page.url).query, "")
        self.assertEqual(self.errors, [])

    def test_oauth_callback_blank_state_shows_recovery(self):
        self.page.goto(self.origin + "/oauth/callback?code=abc123&state=")
        self._expect_launch_screen()
        self.assertEqual(self.errors, [])

    def test_oauth_callback_code_and_error_together_is_ambiguous_and_shows_recovery(self):
        # code+error together is not a legitimate GoHighLevel shape; do not resolve it
        # in favor of either side, including when the code is also duplicated.
        self.page.goto(self.origin + "/oauth/callback?error=access_denied&code=abc123&state=xyz789")
        self._expect_launch_screen()
        self.page.goto(
            self.origin + "/oauth/callback?error=access_denied&code=a&code=b&state=xyz789"
        )
        self._expect_launch_screen()
        self.assertEqual(self.errors, [])

    def test_oauth_callback_valid_code_and_state_is_not_swallowed_by_recovery_screen(self):
        # A legitimate callback must fall through to the existing authenticated flow
        # (here: the normal signed-out boot, since no session cookie is set) rather
        # than being caught by the public recovery screen. The query must also already
        # be gone from the address bar before the Hexclave SDK (constructed inside
        # useFounderBrainApp once config loads) ever gets a chance to read it.
        self.page.goto(self.origin + "/oauth/callback?code=abc123&state=xyz789")
        expect(self.page.get_by_role("button", name="Sign in", exact=True)).to_be_visible()
        self._expect_no_launch_screen()
        self.assertEqual(urlparse(self.page.url).query, "")
        self.assertEqual(self.errors, [])

    def test_oauth_callback_error_with_state_is_not_swallowed_by_recovery_screen(self):
        # Regression: a bare error+state pair here is GoHighLevel's Connect denial, not
        # a Hexclave hosted-sign-in denial. Before main.tsx stripped this pre-boot, the
        # Hexclave SDK read it on init and redirected through its own error handling
        # (surfaced as OAUTH_PROVIDER_ACCESS_DENIED), never reaching the normal
        # signed-out boot at all.
        self.page.goto(self.origin + "/oauth/callback?error=access_denied&state=xyz789")
        expect(self.page.get_by_role("button", name="Sign in", exact=True)).to_be_visible()
        self._expect_no_launch_screen()
        self.assertEqual(urlparse(self.page.url).query, "")
        expect(self.page.get_by_text("OAUTH_PROVIDER_ACCESS_DENIED", exact=False)).to_have_count(0)
        self.assertEqual(self.errors, [])

    def _route_oauth_callback_completion_fixture(self, *, ghl_screen=5):
        """Authenticated callback with disposable state and no live API/provider traffic."""
        self.context.route(self.origin + "/api/**", lambda r: r.fulfill(
            status=404, json={"message": "Unknown fixture endpoint"}))
        self._callback_connection = {
            "connected": False, "locationId": None, "locationName": None,
            "connectionId": None, "nameUnavailable": False,
        }
        self.context.route(self.origin + "/api/oauth/status", lambda r: r.fulfill(
            json=self._callback_connection))
        self.context.route(self.origin + "/api/ghl/booking-links*", lambda r: r.fulfill(
            json={"connection": self._callback_connection, "links": []}))
        brain = self._complete_brain()
        brain["identity"]["track"] = "b2c"
        orientation = self._complete_orientation()
        orientation.update({
            "track": "b2c", "ghlScreen": ghl_screen, "ghlCompletedAt": None,
            "ghlAnswers": {"hasAccount": True, "connected": False},
        })
        self.context.route(self.origin + "/api/config", lambda r: r.fulfill(json={
            "authMode": "hexclave", "hexclave": {"projectId": PROJECT, "apiUrl": AUTH_ORIGIN,
            "publishableClientKey": None}, "aiEnabled": False, "crmConnectEnabled": True,
        }))
        self.context.route(self.origin + "/api/me", lambda r: r.fulfill(json={"email": "ada@example.test"}))
        self.context.route(self.origin + "/api/brain", lambda r: r.fulfill(json={
            "workspaceId": "ws_fixture", "version": 3, "sha": "0" * 64,
            "updatedAt": "2026-09-27T00:00:00.000Z", "brain": brain,
            "readiness": dict.fromkeys(["identity", "customer", "offer", "voice", "context", "output"], True),
            "verified": True, "artifact": None,
        }))
        self.context.route(self.origin + "/api/artifact", lambda r: r.fulfill(json={"artifact": None, "stale": False}))
        self.context.route(self.origin + "/api/orientation", lambda r: r.fulfill(json=orientation))
        self.context.route(self.origin + "/api/history", lambda r: r.fulfill(json={"versions": []}))
        self.context.route(self.origin + "/api/usage", lambda r: r.fulfill(json={
            "ai": {"events": 0, "inputTokens": 0, "outputTokens": 0, "priceMicroUsd": 0},
            "firecrawl": {"scrapes": 0, "credits": 0, "priceMicroUsd": 0}, "totalMicroUsd": 0,
        }))
        return orientation

    def test_oauth_callback_valid_code_completes_via_api_exactly_once(self):
        """Authenticated path: the code/state captured pre-boot by main.tsx reaches the
        existing completion effect once useFounderBrainApp resolves api+email, and is
        POSTed to the real completion endpoint exactly once. No real provider is used;
        /api/oauth/complete is a disposable fixture like every other route here."""
        orientation = self._route_oauth_callback_completion_fixture()
        completes = []
        def complete(route):
            completes.append(route.request.post_data_json)
            self._callback_connection.update({
                "connected": True, "locationId": "demo-location", "locationName": "Demo Clinic",
                "connectionId": "fixture-connection-1", "nameUnavailable": False,
            })
            route.fulfill(json={
                **self._callback_connection,
                "orientation": {**orientation, "ghlCompletedAt": "2026-09-27T00:00:00.000Z",
                                "ghlAnswers": {"hasAccount": True, "connected": True}},
            })
        self.context.route(self.origin + "/api/oauth/complete", complete)
        self.set_session()
        self.page.goto(self.origin + "/oauth/callback?code=abc123&state=xyz789")
        panel = self.page.get_by_role("region", name="Connected GoHighLevel subaccount", exact=True)
        expect(panel.get_by_role("heading", name="Demo Clinic", exact=True)).to_be_visible(timeout=20000)
        self.assertEqual(completes, [{"code": "abc123", "state": "xyz789"}])
        parsed = urlparse(self.page.url)
        self.assertEqual(parsed.path, "/")
        self.assertEqual(parsed.query, "")
        self.assertEqual(self.errors, [])

    def test_oauth_callback_denial_completes_via_api_exactly_once_and_shows_cancelled_notice(self):
        """The denial branch also calls the completion endpoint (to consume the
        server-side state once), exactly once, and never reaches Hexclave's own error
        handling: the founder sees FounderBrain's own cancelled message."""
        self._route_oauth_callback_completion_fixture()
        completes = []
        def complete(route):
            completes.append(route.request.post_data_json)
            route.fulfill(json={
                "connected": False, "locationId": None, "locationName": None,
                "connectionId": None, "nameUnavailable": False,
            })
        self.context.route(self.origin + "/api/oauth/complete", complete)
        self.set_session()
        self.page.goto(self.origin + "/oauth/callback?error=access_denied&state=xyz789")
        expect(
            self.page.get_by_text(
                "GoHighLevel Connect was cancelled. Start Connect again when you are ready.",
                exact=True,
            )
        ).to_be_visible(timeout=20000)
        self.assertEqual(completes, [{"error": "access_denied", "state": "xyz789"}])
        parsed = urlparse(self.page.url)
        self.assertEqual(parsed.path, "/")
        self.assertEqual(parsed.query, "")
        expect(self.page.get_by_text("OAUTH_PROVIDER_ACCESS_DENIED", exact=False)).to_have_count(0)
        self.assertEqual(self.errors, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
