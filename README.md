# Team Management System (TMS)

A modern, high-performance Node.js task management platform and workforce portal with a responsive, zero-build web application for desktop and mobile.

Each organization runs its own instance and connects to its own private storage backend (PostgreSQL, Google Sheets, or local file storage).

---

## 📖 Documentation
Detailed user manuals, administration guidelines, RBAC specifications, and architecture notes are available in:
👉 **[DOCUMENTATION.md](DOCUMENTATION.md)**

---

## Features
- **Role-Based Access Control**: Strict separation of concerns for Admins, Department Managers, and Team Members.
- **Smart Deadline Calculator**: Accurately schedules deadlines based on employee shifts, lunch breaks, weekends, and holidays.
- **Lifecycle Validation**: Structured task progression (`Scope of Work` → `Planned` → `Pending` → `To Be Validated` → `Completed`).
- **Flexible Storage Adapters**: Plug-and-play support for **PostgreSQL**, **Google Sheets**, and **Local File** storage.
- **Optimistic Concurrency**: Built-in revision tracking prevents overwriting simultaneous edits.
- **Automated 90-Day Archival**: Older completed tasks are automatically migrated to archive storage to maintain speed.
- **Comprehensive Test Suite**: Built-in unit, integration, and security tests using native Node.js test runner (`npm test`).

---

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Application
```bash
# Using local file storage for trial / development:
STORAGE=file node server.js
```
Then visit **`http://localhost:3000`** in your browser.

### 3. Run Automated Tests
```bash
npm test
```

---

## Storage Options

| Team size | Storage Mode | Required Environment Variables |
|---|---|---|
| **1–10** | `sheets` | `STORAGE=sheets`, `SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON` |
| **11–200** | `postgres` | `STORAGE=postgres`, `DATABASE_URL` |
| **200+** | `postgres` (Self-hosted or managed) | `STORAGE=postgres`, `DATABASE_URL` |
| **Trial / Dev** | `file` | `STORAGE=file`, optional `DATA_DIR` |

---

## Deploy to Render (One-Click)
1. Fork or push this repository to GitHub.
2. In [Render](https://render.com), click **New → Blueprint** and select the repository.
3. Configure your storage environment variables and deploy.

See **[DOCUMENTATION.md](DOCUMENTATION.md)** for complete setup instructions.
