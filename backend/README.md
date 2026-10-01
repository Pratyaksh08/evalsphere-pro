# EvalSphere Backend

Express.js server with GCC compiler execution bridge and SQLite WebAssembly (`sql.js`) in-memory engine.

## Setup & Run

1. Navigate to backend directory:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```
   The server starts at `http://localhost:3000` and automatically serves the `frontend/` directory.

## Endpoints

- `GET /api/health` — Checks server status, uptime, GCC, and SQLite engine status.
- `GET /api/problems` — Retrieves public metadata for C and SQL problems.
- `POST /api/run-c` — Compiles and executes C source code with GCC against hidden test cases.
- `POST /api/run-sql` — Executes user SQL queries against in-memory SQLite datasets.
