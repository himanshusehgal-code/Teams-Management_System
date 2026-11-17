# Team Management System (TMS) - User & Admin Documentation

Welcome to the **Team Management System (TMS)**. TMS is an agile, multi-tenant workforce management and task coordination platform built with a high-performance Node.js backend and a responsive, zero-build client interface designed for both desktop and mobile screens.

---

## Table of Contents
1. [System Overview & Architecture](#system-overview--architecture)
2. [Quick Start & Local Setup](#quick-start--local-setup)
3. [First-Time Setup Wizard](#first-time-setup-wizard)
4. [User Roles & Permissions (RBAC)](#user-roles--permissions-rbac)
5. [Core Features & User Guide](#core-features--user-guide)
   - [Dashboard & Analytics](#dashboard--analytics)
   - [Delegating Tasks (One-Time & Recurring)](#delegating-tasks-one-time--recurring)
   - [Working-Time & Deadline Calculation Engine](#working-time--deadline-calculation-engine)
   - [Task Lifecycle & Workflow Transitions](#task-lifecycle--workflow-transitions)
   - [Validating, Approving & Reopening Tasks](#validating-approving--reopening-tasks)
   - [Team & Roster Management](#team--roster-management)
   - [Settings, Holidays & Manager Delegation Controls](#settings-holidays--manager-delegation-controls)
6. [Automated 90-Day Archival](#automated-90-day-archival)
7. [Storage Backends Configuration](#storage-backends-configuration)
8. [Automated Testing Suite](#automated-testing-suite)
9. [Deployment Guide (Render / Cloud Servers)](#deployment-guide-render--cloud-servers)

---

## System Overview & Architecture

- **Backend**: Node.js (v18+) with Express.
- **Frontend**: Clean, reactive HTML5/CSS3/Vanilla JavaScript interface in `public/index.html`. No build tools (Webpack/Vite) required.
- **Authentication**: Stateless, cryptographically signed tokens (HMAC-SHA256) with `scrypt` password hashing and constant-time comparisons.
- **Concurrency Control**: Optimistic concurrency locking (`rev` counter) prevents conflicting overwrites.
- **Data Privacy**: Customer-owned storage adapters (`postgres`, `sheets`, or `file`). Your data is never held on third-party SaaS servers.

---

## Quick Start & Local Setup

### 1. Prerequisites
Ensure you have **Node.js 18 or higher** installed.

### 2. Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/himanshusehgal-code/Teams-Management_System.git
cd Teams-Management_System
npm install
```

### 3. Run Locally
To run the server with local file storage:
```bash
# Windows PowerShell
$env:PORT="3000"; $env:STORAGE="file"; npm start

# Linux / macOS
PORT=3000 STORAGE=file npm start
```

Open your browser and navigate to:
👉 **`http://localhost:3000`**

---

## First-Time Setup Wizard

When accessing an uninitialized workspace, the 4-step Setup Wizard launches automatically:

1. **Team Size**:
   - `1–10 people` (Recommended: Google Sheets or Local File)
   - `11–50 people` (Recommended: Postgres database)
   - `51–200 people` (Recommended: Postgres database)
   - `200+ people` (Recommended: Dedicated Server / Postgres)
2. **Storage Selection**:
   - Choose your backend (`Google Sheets`, `Cloud database (Postgres)`, or `Local file (Trial)`).
   - Press **Continue** to run an automated connection verification test.
3. **Admin Account Creation**:
   - Enter Admin's Full Name, Email, Mobile number, Department, and a secure password (minimum 8 characters).
4. **Register Initial Team**:
   - Add managers and members with their work shifts, lunch breaks, and reporting managers.
   - Click **Finish setup** to lock down the workspace and open the login screen.

> 💡 **Quick Demo**: On step 1, you can click **"Try with demo data"** to test-drive TMS with preloaded mock teams, tasks, and recurring schedules in browser memory.

---

## User Roles & Permissions (RBAC)

TMS enforces strict role-based access control:

| Capability | Admin | Manager | Member |
|---|:---:|:---:|:---:|
| **View Dashboard** | All departments & employees | Department team members only | Self only |
| **Delegate to Anyone** | Yes | Yes (if enabled in Settings) | Self only |
| **Delegate to Self** | Yes | Yes | Yes |
| **Plan & Start Work** | Yes | If assigned as Doer | If assigned as Doer |
| **Submit for Validation** | Yes | If assigned as Doer | If assigned as Doer |
| **Validate / Approve Tasks** | Yes | If assigned as Validator | No |
| **Reopen Task with Extra Hours** | Yes | If assigned as Validator | No |
| **Delete Tasks** | Yes | Yes (within team) | No (Protected) |
| **Manage Team Roster** | Yes | View only | View only |
| **Manage Company Holidays** | Yes | No | No |
| **Manage Delegation Access** | Yes | No | No |

---

## Core Features & User Guide

### Dashboard & Analytics
The Dashboard provides real-time workload visibility:
- **KPI Metrics**:
  - `To plan` (*Scope of Work*)
  - `In progress` (*Pending*)
  - `Awaiting review` (*To Be Validated*)
  - `Overdue` (Tasks past due date that are not completed)
  - `Done on time %` (Historical on-time completion performance)
- **Workload by Person**:
  - Open task count
  - Overdue task count
  - Total working hours currently assigned
  - Shift schedules

### Delegating Tasks (One-Time & Recurring)
Navigate to **Delegate** in the navigation menu:
1. **Task Title & Description**: State the objective and deliverables clearly.
2. **Type**: Choose `One-Time` or `Recurring`.
3. **Doer & Validator**: Select the assignee and the reviewer (Manager or Admin).
4. **Start Date & Time**: When work can begin.
5. **Lead Time**: Total estimated effort in hours and minutes.
6. **Weekend Inclusion**: Check `Include Saturday` or `Include Sunday` if weekend work is approved.
7. **Recurring Schedules** *(Recurring type only)*:
   - Select frequency: `Daily`, `Weekly`, or `Monthly`.
   - Specify generator horizon (e.g. generate occurrences for the next 30 days).

### Working-Time & Deadline Calculation Engine
TMS features an intelligent deadline engine (`addWork`) that computes accurate completion dates:
- **Shift Respecting**: Work is only credited during the employee's active shift hours (e.g., 09:00 – 18:00).
- **Lunch Deduction**: Automatically reserves a 30-minute lunch pause during the employee's specified lunch window.
- **Holiday & Weekend Skipping**: Automatically rolls remaining lead time forward past non-working days.
- **Off-Hours Clamping**: Tasks starting before shift hours automatically align with the shift opening; tasks created after shift hours shift to the next working day.

### Task Lifecycle & Workflow Transitions
Every task progresses through structured validation stages:
```
[Scope of Work] ──> [Planned] ──> [Pending] ──> [To Be Validated] ──> [Completed]
                                                        │
                                                        ├──> [Reopened with Extra Hours]
                                                        └──> [Marked Invalid]
```
1. **Scope of Work**: Newly created task awaiting doer planning.
2. **Planned**: Doer acknowledges requirements and schedule.
3. **Pending**: Work actively in progress.
4. **To Be Validated**: Work completed by doer and awaiting review.
5. **Completed**: Approved by Validator or Admin.

### Validating, Approving & Reopening Tasks
When a task is submitted for review (*To Be Validated*):
- The Validator can click **Approve** to mark it `Completed`.
- If revisions are required, the Validator specifies additional hours (e.g., `2 hours`) and clicks **Reopen with extra hours**. The system recalculates the new end deadline and moves the status back to `Pending`.
- If the task is obsolete or non-compliant, click **Mark invalid**.

### Team & Roster Management
Admins can manage employees under the **Team** screen:
- Register employees with their official Name, Email, and Mobile number.
- Assign roles (`Member` or `Manager`).
- Configure reporting hierarchy (`Reports to`).
- Set custom work shifts (`Shift start` and `Shift end`) and lunch start times.

#### Account Activation Flow:
- When a new team member is registered, their account is in an unactivated state.
- Upon first visiting the portal, they click **"First time here? Activate your account"**.
- They enter their registered email or mobile number, choose an 8+ character password, and gain immediate access.

### Settings, Holidays & Manager Delegation Controls
Admins can customize workspace behavior in **Settings**:
- **Manager Access**: Check/uncheck whether Managers are permitted to assign tasks to other staff members or only to themselves.
- **Holidays**: Add company-observed holiday dates (`YYYY-MM-DD`). The working-time engine automatically skips these dates.
- **Theme**: Switch between `Auto` (system preference), `Light`, and `Dark` modes.

---

## Automated 90-Day Archival

To guarantee optimal database read performance, TMS automatically identifies tasks marked `Completed` with a completion timestamp older than **90 days**.

When state is updated:
1. Tasks older than 90 days are extracted from active memory/tables.
2. They are safely appended to the `archive` collection.
3. The active task board remains clean, lightweight, and fast.

---

## Storage Backends Configuration

Configure your environment variables based on your selected storage adapter:

### 1. Local File Storage (Development / Trial)
```bash
STORAGE=file
DATA_DIR=./data
```

### 2. PostgreSQL Storage (Production Recommended)
Compatible with Neon, Supabase, AWS RDS, GCP Cloud SQL, or self-hosted Postgres:
```bash
STORAGE=postgres
DATABASE_URL=postgres://username:password@hostname:5432/dbname
```
*TMS automatically initializes the `_meta` and `app_data` tables with JSONB support upon first run.*

### 3. Google Sheets Storage (Small Teams)
```bash
STORAGE=sheets
SHEET_ID=1A2B3C4D5E6F... (from your Google Sheet URL)
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":...}
```
*TMS automatically adds the required worksheets (`Meta`, `Employees`, `Masters`, `Tasks`, `Archive`).*

---

## Automated Testing Suite

TMS includes a built-in automated test suite covering unit tests, API integration tests, RBAC rules, security, rate limiting, and working-hour calculations:

```bash
npm test
```

### Test Coverage:
- **`test/store.test.js`**: File store persistence, directory initialization, default schema fallbacks.
- **`test/addwork.test.js`**: Working-hours engine, shift boundaries, lunch skips, weekend and holiday rollover.
- **`test/api.test.js`**: Setup endpoints, login, activation, RBAC permissions, task state changes, concurrency conflicts (409), and 90-day task archival.
- **`test/security.test.js`**: Token expiry, signature tampering, 2MB body limit (413), and IP rate limiting (429).
- **`test/frontend.test.js`**: DOM structure, syntax parsing with Node `vm`, and XSS escaping validation.

---

## Deployment Guide (Render / Cloud Servers)

TMS includes a ready-to-deploy [`render.yaml`](render.yaml) blueprint:

1. Push this repository to your GitHub account.
2. In [render.com](https://render.com), select **New → Blueprint** and select your repository.
3. Render reads `render.yaml` and provisions the Web Service.
4. Set your environment variables (`STORAGE`, `DATABASE_URL`, or `SHEET_ID` / `GOOGLE_SERVICE_ACCOUNT_JSON`).
5. Ensure `JWT_SECRET` is set to a long random hexadecimal string so user sessions persist across restarts.
6. Deploy and access your live application!
