import os
import unittest
from unittest.mock import MagicMock
from fastapi import HTTPException
from fastapi.security import HTTPBasicCredentials

from api.server import require_admin_auth


class DashboardAuthTests(unittest.TestCase):
    def setUp(self):
        self._orig_token = os.environ.get("ADMIN_API_TOKEN")
        self._orig_pass = os.environ.get("DASHBOARD_PASSWORD")
        self._orig_user = os.environ.get("DASHBOARD_USERNAME")

    def tearDown(self):
        if self._orig_token is not None:
            os.environ["ADMIN_API_TOKEN"] = self._orig_token
        else:
            os.environ.pop("ADMIN_API_TOKEN", None)

        if self._orig_pass is not None:
            os.environ["DASHBOARD_PASSWORD"] = self._orig_pass
        else:
            os.environ.pop("DASHBOARD_PASSWORD", None)

        if self._orig_user is not None:
            os.environ["DASHBOARD_USERNAME"] = self._orig_user
        else:
            os.environ.pop("DASHBOARD_USERNAME", None)

    def test_auth_permitted_when_no_password_configured(self):
        os.environ.pop("ADMIN_API_TOKEN", None)
        os.environ.pop("DASHBOARD_PASSWORD", None)
        # Should not raise exception
        try:
            require_admin_auth()
        except HTTPException:
            self.fail("require_admin_auth raised HTTPException unexpectedly when no password was set")

    def test_auth_succeeds_with_valid_x_admin_token(self):
        os.environ["ADMIN_API_TOKEN"] = "secure-admin-token-12345"
        # Valid header
        require_admin_auth(x_admin_token="secure-admin-token-12345")

    def test_auth_succeeds_with_valid_bearer_token(self):
        os.environ["ADMIN_API_TOKEN"] = "secure-bearer-token-67890"
        # Valid Bearer
        require_admin_auth(authorization="Bearer secure-bearer-token-67890")

    def test_auth_succeeds_with_valid_basic_auth(self):
        os.environ["DASHBOARD_USERNAME"] = "superadmin"
        os.environ["DASHBOARD_PASSWORD"] = "mypassword999"
        creds = HTTPBasicCredentials(username="superadmin", password="mypassword999")
        require_admin_auth(credentials=creds)

    def test_auth_fails_with_invalid_credentials(self):
        os.environ["ADMIN_API_TOKEN"] = "real-token"
        with self.assertRaises(HTTPException) as ctx:
            require_admin_auth(x_admin_token="wrong-token")
        self.assertEqual(ctx.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()
