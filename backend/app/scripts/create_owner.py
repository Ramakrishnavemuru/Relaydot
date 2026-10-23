"""One-time local operator command. Run with PYTHONPATH=backend python -m app.scripts.create_owner."""
import argparse
import getpass
import os
import tempfile
from pathlib import Path

import pyotp
import qrcode

from app.database import Base, SessionLocal, engine
from app.main import run_schema_migrations
from app.models.user import User
from app.security.password import hash_password
from app.utils.validators import validate_email, validate_password, validate_username


def main() -> None:
    parser = argparse.ArgumentParser(description="Provision the first Relaydot owner")
    parser.add_argument("--email", required=True, help="Operator-controlled, verified email address")
    parser.add_argument("--username", required=True)
    args = parser.parse_args()
    email = validate_email(args.email)
    username = validate_username(args.username)
    run_schema_migrations()
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        owner = db.query(User).filter_by(role="OWNER").first()
        if owner:
            if owner.email == email and owner.username == username:
                print("Owner already provisioned; no changes made.")
                return
            raise SystemExit("An owner already exists. Refusing to create another.")
        if db.query(User).filter((User.email == email) | (User.username == username)).first():
            raise SystemExit("This email or username already belongs to an account. Refusing overwrite.")
        if input("Type the verified owner email to confirm: ").strip().lower() != email:
            raise SystemExit("Email confirmation did not match.")
        password = getpass.getpass("New owner password: ")
        confirmation = getpass.getpass("Confirm password: ")
        if password != confirmation:
            raise SystemExit("Passwords do not match.")
        validate_password(password)
        secret = pyotp.random_base32()
        uri = pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name="Relaydot staff")
        fd, path = tempfile.mkstemp(prefix="relaydot-owner-mfa-", suffix=".png")
        os.close(fd)
        os.chmod(path, 0o600)
        qrcode.make(uri).save(path)
        try:
            print(f"Scan the one-time MFA QR image at {path}. It will be deleted after verification.")
            code = getpass.getpass("Authenticator code: ")
            if not pyotp.TOTP(secret).verify(code, valid_window=1):
                raise SystemExit("MFA verification failed; owner was not created.")
            db.add(User(username=username, email=email, display_name=username,
                        password_hash=hash_password(password), is_verified=True,
                        totp_secret=secret, totp_enabled=True, role="OWNER"))
            db.commit()
            print("Owner provisioned. Sign in at /app/staff/login.")
        finally:
            Path(path).unlink(missing_ok=True)


if __name__ == "__main__":
    main()
