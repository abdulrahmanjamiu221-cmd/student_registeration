# Northstar student registration

The Python server stores registrations in `student_registrations.sqlite3` in this folder. It uses only Python's standard library; no package installation is required.

## Run on Windows PowerShell

From this folder, start the site:

```powershell
python server.py
```

Open <http://127.0.0.1:8000>. The Admin Review password is `1234567890` by default. To override it, set a private password before starting the server:

```powershell
$env:ADMIN_PASSWORD = "choose-a-private-password"
python server.py
```

Keep the server running while using the site. The Admin Review section prompts for the configured password. Registrations are shared by browsers connecting to this server.

The server binds to `127.0.0.1` by default, so it is accessible only from this computer. Before hosting it publicly, use HTTPS and a production-ready deployment setup; do not expose this development server directly to the internet.
