import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_register_and_login():
    username = "test_alice"
    email = "alice@example.com"
    password = "password123"

    # Register
    reg_response = client.post(
        "/api/auth/register",
        json={
            "username": username,
            "email": email,
            "password": password,
            "confirm_password": password,
            "display_name": "Alice Wonderland"
        }
    )
    assert reg_response.status_code == 201
    data = reg_response.json()
    assert "access_token" in data
    assert data["user"]["username"] == username

    # Login with username
    login_response = client.post(
        "/api/auth/login",
        json={
            "username_or_email": username,
            "password": password
        }
    )
    assert login_response.status_code == 200
    token = login_response.json()["access_token"]
    assert token

    # Login with email
    login_email_res = client.post(
        "/api/auth/login",
        json={
            "username_or_email": email,
            "password": password
        }
    )
    assert login_email_res.status_code == 200

    # Get current user profile
    me_response = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert me_response.status_code == 200
    assert me_response.json()["email"] == email


def test_register_duplicate_username():
    client.post(
        "/api/auth/register",
        json={
            "username": "dup_user",
            "email": "dup1@example.com",
            "password": "password123",
            "confirm_password": "password123"
        }
    )
    res = client.post(
        "/api/auth/register",
        json={
            "username": "dup_user",
            "email": "dup2@example.com",
            "password": "password123",
            "confirm_password": "password123"
        }
    )
    assert res.status_code == 400


def test_change_password():
    username = "test_bob"
    email = "bob@example.com"
    pwd = "original_password"

    reg = client.post(
        "/api/auth/register",
        json={
            "username": username,
            "email": email,
            "password": pwd,
            "confirm_password": pwd
        }
    )
    token = reg.json()["access_token"]

    change_res = client.post(
        "/api/auth/change-password",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "current_password": pwd,
            "new_password": "new_password_123",
            "confirm_new_password": "new_password_123"
        }
    )
    assert change_res.status_code == 200

    # Login with new password
    login_res = client.post(
        "/api/auth/login",
        json={
            "username_or_email": username,
            "password": "new_password_123"
        }
    )
    assert login_res.status_code == 200


def test_phone_registration_and_otp_flow():
    phone = "+14155552671"
    username = "phone_user"

    # 1. Register with phone number
    reg = client.post(
        "/api/auth/register",
        json={
            "username": username,
            "phone_number": phone,
            "display_name": "Phone Tester"
        }
    )
    assert reg.status_code == 201
    reg_data = reg.json()
    assert reg_data["user"]["phone_number"] == phone
    demo_otp = reg_data["demo_otp"]
    assert demo_otp

    # 2. Verify OTP to activate account
    ver_res = client.post(
        "/api/auth/otp/verify",
        json={
            "identifier": phone,
            "otp_code": demo_otp,
            "purpose": "REGISTER"
        }
    )
    assert ver_res.status_code == 200
    ver_data = ver_res.json()
    assert ver_data["access_token"]
    assert ver_data["user"]["is_verified"] is True

    # 3. Passwordless OTP Login
    otp_req = client.post(
        "/api/auth/otp/send",
        json={"identifier": phone, "purpose": "LOGIN"}
    )
    assert otp_req.status_code == 200
    login_otp = otp_req.json()["demo_otp"]

    login_res = client.post(
        "/api/auth/otp/verify",
        json={"identifier": phone, "otp_code": login_otp, "purpose": "LOGIN"}
    )
    assert login_res.status_code == 200
    assert login_res.json()["access_token"]


def test_refresh_token_rotation():
    username = "rot_user"
    email = "rot@example.com"
    pwd = "password123"

    reg = client.post(
        "/api/auth/register",
        json={
            "username": username,
            "email": email,
            "password": pwd,
            "confirm_password": pwd
        }
    )
    assert reg.status_code == 201
    initial_refresh = reg.json()["refresh_token"]
    assert initial_refresh

    # Rotate refresh token
    ref_res = client.post(
        "/api/auth/refresh",
        json={"refresh_token": initial_refresh}
    )
    assert ref_res.status_code == 200
    ref_data = ref_res.json()
    new_refresh = ref_data["refresh_token"]
    assert new_refresh
    assert new_refresh != initial_refresh  # Token rotated

    # Old refresh token should now be invalidated
    old_res = client.post(
        "/api/auth/refresh",
        json={"refresh_token": initial_refresh}
    )
    assert old_res.status_code == 401


def test_device_sessions_management():
    username = "sess_user"
    email = "sess@example.com"
    pwd = "password123"

    reg = client.post(
        "/api/auth/register",
        json={
            "username": username,
            "email": email,
            "password": pwd,
            "confirm_password": pwd
        }
    )
    token = reg.json()["access_token"]

    # List active sessions
    sess_res = client.get(
        "/api/auth/sessions",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert sess_res.status_code == 200
    sessions = sess_res.json()
    assert len(sessions) >= 1
    assert "session_id" in sessions[0]
    assert sessions[0]["is_current"] is True

    # Revoke others
    revoke_res = client.post(
        "/api/auth/sessions/revoke-others",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert revoke_res.status_code == 200


def test_two_factor_auth_lifecycle():
    import pyotp
    username = "twofa_user"
    email = "twofa@example.com"
    pwd = "password123"

    reg = client.post(
        "/api/auth/register",
        json={
            "username": username,
            "email": email,
            "password": pwd,
            "confirm_password": pwd
        }
    )
    token = reg.json()["access_token"]

    # 1. Initiate TOTP setup
    setup_res = client.post(
        "/api/auth/2fa/totp/setup",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert setup_res.status_code == 200
    setup_data = setup_res.json()
    secret = setup_data["secret"]
    assert "qr_code" in setup_data

    # 2. Confirm & Enable TOTP
    totp = pyotp.TOTP(secret)
    valid_code = totp.now()
    enable_res = client.post(
        "/api/auth/2fa/totp/enable",
        headers={"Authorization": f"Bearer {token}"},
        json={"code": valid_code}
    )
    assert enable_res.status_code == 200
    recovery_codes = enable_res.json()["recovery_codes"]
    assert len(recovery_codes) == 8

    # 3. Login - Should require 2FA ticket
    login_1 = client.post(
        "/api/auth/login",
        json={"username_or_email": username, "password": pwd}
    )
    assert login_1.status_code == 200
    login_1_data = login_1.json()
    assert login_1_data["requires_2fa"] is True
    ticket = login_1_data["ticket"]
    assert ticket

    # 4. Verify 2FA challenge with TOTP
    verify_2fa_res = client.post(
        "/api/auth/2fa/verify",
        json={"ticket": ticket, "code": totp.now()}
    )
    assert verify_2fa_res.status_code == 200
    assert verify_2fa_res.json()["access_token"]

    # 5. Login and verify 2FA challenge with Recovery Code
    login_2 = client.post(
        "/api/auth/login",
        json={"username_or_email": username, "password": pwd}
    )
    ticket_2 = login_2.json()["ticket"]
    first_recovery_code = recovery_codes[0]

    verify_rec_res = client.post(
        "/api/auth/2fa/verify",
        json={"ticket": ticket_2, "code": first_recovery_code}
    )
    assert verify_rec_res.status_code == 200
    assert verify_rec_res.json()["access_token"]

    # Recovery code cannot be reused
    login_3 = client.post(
        "/api/auth/login",
        json={"username_or_email": username, "password": pwd}
    )
    ticket_3 = login_3.json()["ticket"]
    reuse_res = client.post(
        "/api/auth/2fa/verify",
        json={"ticket": ticket_3, "code": first_recovery_code}
    )
    assert reuse_res.status_code == 400


def test_passkey_options_endpoints():
    username = "passkey_user"
    email = "passkey@example.com"
    pwd = "password123"

    reg = client.post(
        "/api/auth/register",
        json={
            "username": username,
            "email": email,
            "password": pwd,
            "confirm_password": pwd
        }
    )
    token = reg.json()["access_token"]

    # Registration options
    reg_opts = client.post(
        "/api/auth/passkeys/register/options",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert reg_opts.status_code == 200
    assert "challenge" in reg_opts.json()
    assert "rp" in reg_opts.json()

    # Login options
    login_opts = client.post(
        "/api/auth/passkeys/login/options",
        json={"identifier": username}
    )
    assert login_opts.status_code == 200
    assert "challenge" in login_opts.json()
