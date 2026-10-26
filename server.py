import base64
import hmac
import json
import logging
import os
import re
import sqlite3
import uuid
from datetime import date, datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


BASE_DIR = Path(__file__).resolve().parent
DATABASE_PATH = BASE_DIR / "student_registrations.sqlite3"
MAX_REQUEST_BYTES = 16_384
VALID_PROGRAMS = {
    "Business & Management",
    "Computer Science",
    "Education",
    "Engineering",
    "Health Sciences",
    "Humanities",
    "Natural Sciences",
    "Social Sciences",
    "Other",
}
VALID_YEARS = {"Year 1", "Year 2", "Year 3", "Year 4", "Postgraduate"}
STATUSES = {"approved", "declined"}
APPLICATION_ID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.IGNORECASE)
DEFAULT_ADMIN_PASSWORD = "1234567890"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def get_database():
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 10000")
    return connection


def initialize_database():
    with get_database() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS applications (
                id TEXT PRIMARY KEY,
                full_name TEXT NOT NULL,
                student_id TEXT NOT NULL COLLATE NOCASE UNIQUE,
                date_of_birth TEXT NOT NULL,
                email TEXT NOT NULL COLLATE NOCASE UNIQUE,
                phone TEXT NOT NULL,
                program TEXT NOT NULL,
                study_year TEXT NOT NULL,
                address TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'declined')),
                submitted_at TEXT NOT NULL,
                reviewed_at TEXT
            )
            """
        )


def application_from_row(row):
    return {
        "id": row["id"],
        "fullName": row["full_name"],
        "studentId": row["student_id"],
        "dateOfBirth": row["date_of_birth"],
        "email": row["email"],
        "phone": row["phone"],
        "program": row["program"],
        "studyYear": row["study_year"],
        "address": row["address"],
        "status": row["status"],
        "submittedAt": row["submitted_at"],
        "reviewedAt": row["reviewed_at"],
    }


class ApplicationHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def log_message(self, format_string, *args):
        logging.info("%s - %s", self.address_string(), format_string % args)

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        content_length = self.headers.get("Content-Length")
        if content_length is None:
            raise ValueError("A request body is required.")
        try:
            length = int(content_length)
        except ValueError as error:
            raise ValueError("Invalid request body length.") from error
        if length < 1 or length > MAX_REQUEST_BYTES:
            raise ValueError("Request body must be between 1 and 16384 bytes.")
        try:
            payload = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ValueError("Request body must be valid JSON.") from error
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        return payload

    def admin_is_authenticated(self):
        expected_password = os.environ.get("ADMIN_PASSWORD", DEFAULT_ADMIN_PASSWORD)
        authorization = self.headers.get("Authorization", "")
        try:
            scheme, encoded_credentials = authorization.split(" ", 1)
            credentials = base64.b64decode(encoded_credentials, validate=True).decode("utf-8")
            username, password = credentials.split(":", 1)
        except (ValueError, UnicodeDecodeError):
            self.send_response(401)
            self.send_header("WWW-Authenticate", 'Basic realm="Northstar Admissions", charset="UTF-8"')
            self.send_header("Content-Length", "0")
            self.end_headers()
            return False
        if scheme.lower() != "basic" or username != "admin" or not hmac.compare_digest(password, expected_password):
            self.send_response(401)
            self.send_header("WWW-Authenticate", 'Basic realm="Northstar Admissions", charset="UTF-8"')
            self.send_header("Content-Length", "0")
            self.end_headers()
            return False
        return True

    @staticmethod
    def validate_application(payload):
        required_fields = {
            "fullName": 100,
            "studentId": 30,
            "dateOfBirth": 10,
            "email": 254,
            "phone": 25,
            "program": 100,
            "studyYear": 30,
            "address": 200,
        }
        values = {}
        for field, max_length in required_fields.items():
            value = payload.get(field)
            if not isinstance(value, str):
                raise ValueError(f"{field} is required.")
            value = value.strip()
            if not value or len(value) > max_length:
                raise ValueError(f"{field} must be between 1 and {max_length} characters.")
            values[field] = value

        if len(values["fullName"]) < 2:
            raise ValueError("Full name must contain at least 2 characters.")
        if len(values["studentId"]) > 30:
            raise ValueError("Student ID must not exceed 30 characters.")
        try:
            birth_date = date.fromisoformat(values["dateOfBirth"])
        except ValueError as error:
            raise ValueError("Enter a valid date of birth.") from error
        if birth_date >= date.today():
            raise ValueError("Date of birth must be in the past.")
        values["email"] = values["email"].lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", values["email"]):
            raise ValueError("Enter a valid email address.")
        if len(values["phone"]) < 7:
            raise ValueError("Phone number must contain at least 7 characters.")
        if values["program"] not in VALID_PROGRAMS:
            raise ValueError("Select a valid program of study.")
        if values["studyYear"] not in VALID_YEARS:
            raise ValueError("Select a valid year of study.")
        if len(values["address"]) < 5:
            raise ValueError("Home address must contain at least 5 characters.")
        return values

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/applications":
            if not self.admin_is_authenticated():
                return
            try:
                with get_database() as connection:
                    rows = connection.execute(
                        "SELECT * FROM applications ORDER BY submitted_at DESC"
                    ).fetchall()
                self.send_json(200, {"applications": [application_from_row(row) for row in rows]})
            except sqlite3.Error:
                logging.exception("Failed to retrieve student applications.")
                self.send_json(500, {"error": "Unable to retrieve student applications."})
            return
        if path.startswith("/api/"):
            self.send_json(404, {"error": "API endpoint not found."})
            return
        if Path(unquote(path)).name.lower() in {
            DATABASE_PATH.name.lower(),
            f"{DATABASE_PATH.name}-wal".lower(),
            f"{DATABASE_PATH.name}-shm".lower(),
            f"{DATABASE_PATH.name}-journal".lower(),
            "server.py",
        }:
            self.send_error(404, "File not found")
            return
        super().do_GET()

    def do_POST(self):
        if urlsplit(self.path).path != "/api/applications":
            self.send_json(404, {"error": "API endpoint not found."})
            return
        try:
            application = self.validate_application(self.read_json())
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
            return

        application_id = str(uuid.uuid4())
        submitted_at = datetime.now(timezone.utc).isoformat()
        try:
            with get_database() as connection:
                connection.execute(
                    """
                    INSERT INTO applications (
                        id, full_name, student_id, date_of_birth, email, phone,
                        program, study_year, address, submitted_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        application_id,
                        application["fullName"],
                        application["studentId"],
                        application["dateOfBirth"],
                        application["email"],
                        application["phone"],
                        application["program"],
                        application["studyYear"],
                        application["address"],
                        submitted_at,
                    ),
                )
                row = connection.execute(
                    "SELECT * FROM applications WHERE id = ?", (application_id,)
                ).fetchone()
            self.send_json(201, {"application": application_from_row(row)})
        except sqlite3.IntegrityError:
            self.send_json(409, {"error": "A registration with this student ID or email address already exists."})
        except sqlite3.Error:
            logging.exception("Failed to save a student application.")
            self.send_json(500, {"error": "Unable to save your registration."})

    def do_PATCH(self):
        match = re.fullmatch(r"/api/applications/([^/]+)/status", unquote(urlsplit(self.path).path))
        if not match:
            self.send_json(404, {"error": "API endpoint not found."})
            return
        if not self.admin_is_authenticated():
            return
        application_id = match.group(1)
        if not APPLICATION_ID_PATTERN.fullmatch(application_id):
            self.send_json(400, {"error": "Invalid application ID."})
            return
        try:
            payload = self.read_json()
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
            return
        status = payload.get("status")
        if not isinstance(status, str) or status not in STATUSES:
            self.send_json(400, {"error": "Status must be approved or declined."})
            return

        reviewed_at = datetime.now(timezone.utc).isoformat()
        try:
            with get_database() as connection:
                result = connection.execute(
                    """
                    UPDATE applications
                    SET status = ?, reviewed_at = ?
                    WHERE id = ? AND status = 'pending'
                    """,
                    (status, reviewed_at, application_id),
                )
                if result.rowcount == 0:
                    exists = connection.execute(
                        "SELECT 1 FROM applications WHERE id = ?", (application_id,)
                    ).fetchone()
                    if exists is None:
                        self.send_json(404, {"error": "Registration not found."})
                    else:
                        self.send_json(409, {"error": "This registration has already been reviewed."})
                    return
                row = connection.execute(
                    "SELECT * FROM applications WHERE id = ?", (application_id,)
                ).fetchone()
            self.send_json(200, {"application": application_from_row(row)})
        except sqlite3.Error:
            logging.exception("Failed to update application status.")
            self.send_json(500, {"error": "Unable to update the registration status."})


def main():
    initialize_database()
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer((host, port), ApplicationHandler)
    logging.info("Northstar server listening at http://%s:%s", host, port)
    if "ADMIN_PASSWORD" not in os.environ:
        logging.warning("Using the default admin password. Set ADMIN_PASSWORD to override it.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logging.info("Server shutdown requested.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
