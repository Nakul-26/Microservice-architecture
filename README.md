# Microservices Demo

This repository contains a small microservices-based application with:

- `api_gateway`: Express API gateway with JWT auth, proxying, request tracing, rate limiting, and circuit breakers
- `user_service`: Express + MongoDB service for user management and login
- `notes_service`: Express + MongoDB service for note management
- `frontend`: React + Vite dashboard for logging in and managing users/notes

## Architecture

```text
frontend (Vite/React)
        |
        v
api_gateway :3000
  |- /users  -> user_service  :3001 -> MongoDB (users_db)
  |- /notes  -> notes_service :3002 -> MongoDB (notes_db)
```

The gateway is the main entry point for API consumers. It validates bearer tokens, forwards user context to downstream services, applies route-specific rate limits, and opens a circuit breaker when an upstream service repeatedly fails.

## Features

- JWT-based login through `POST /users/login`
- Admin-only user management
- User and admin note management
- Versioned routes under `/api/v1`
- Health endpoints on gateway and both services
- Request IDs and structured logging
- Rate limiting at gateway and service level
- Circuit breaker protection for both upstream services
- Docker Compose setup for the backend stack
- React dashboard for login, users, and notes

## Services And Ports

| Component | Port | Notes |
| --- | --- | --- |
| `api_gateway` | `3000` | Public API entry point |
| `user_service` | `3001` | Internal service in Docker, direct local dev port |
| `notes_service` | `3002` | Internal service in Docker, direct local dev port |
| `frontend` | `5173` | Default Vite dev server |
| `mongo_user` | internal | MongoDB for `users_db` |
| `mongo_notes` | internal | MongoDB for `notes_db` |

## Prerequisites

- Node.js 20+
- npm
- Docker Desktop or Docker Engine with Compose

For local service-by-service development outside Docker, you also need MongoDB available for both backend services.

## Quick Start With Docker

From the repository root:

```powershell
docker compose up --build
```

This starts:

- `api_gateway` on `http://localhost:3000`
- `user_service` and `notes_service` on the internal Docker network
- two MongoDB containers

Useful health checks:

```powershell
Invoke-WebRequest http://localhost:3000/health
Invoke-WebRequest http://localhost:3000/api/v1/health
```

Stop everything:

```powershell
docker compose down
```

Remove containers and volumes:

```powershell
docker compose down -v
```

## Running The Frontend

The frontend is not part of `docker-compose.yml`, so run it separately:

```powershell
cd frontend
npm install
npm run dev
```

By default it targets `http://localhost:3000`. To change that, set:

```powershell
$env:VITE_API_BASE="http://localhost:3000"
```

Then open the Vite URL shown in the terminal, usually `http://localhost:5173`.

## Local Development Without Docker

Install dependencies:

```powershell
cd api_gateway
npm install
cd ..\user_service
npm install
cd ..\notes_service
npm install
cd ..\frontend
npm install
```

Run each backend service in a separate terminal after setting its environment variables.

### `user_service`

Required environment variables:

- `PORT` default: `3001`
- `MONGODB_URI`
- `MONGODB_DB_NAME` default: `app`
- `JWT_SECRET`
- `API_VERSION_PREFIX` default: `/api/v1`

Start it:

```powershell
cd user_service
npm run dev:nodemon
```

### `notes_service`

Required environment variables:

- `PORT` default: `3002`
- `MONGODB_URI`
- `API_VERSION_PREFIX` default: `/api/v1`

Start it:

```powershell
cd notes_service
npm run dev:nodemon
```

### `api_gateway`

Required environment variables:

- `PORT` default: `3000`
- `USER_SERVICE_URL` default: `http://localhost:3001`
- `NOTES_SERVICE_URL` default: `http://localhost:3002`
- `JWT_SECRET`
- `API_VERSION_PREFIX` default: `/api/v1`

Start it:

```powershell
cd api_gateway
npm run dev:nodemon
```

## Environment Variables

`docker-compose.yml` already provides defaults for the backend stack. The most relevant variables are:

| Variable | Used By | Default |
| --- | --- | --- |
| `API_VERSION_PREFIX` | all backend services | `/api/v1` |
| `JWT_SECRET` | gateway, user service | `dev-secret-change-me` |
| `USER_SERVICE_URL` | gateway | `http://user_service:3001` |
| `NOTES_SERVICE_URL` | gateway | `http://notes_service:3002` |
| `UPSTREAM_TIMEOUT_MS` | gateway | `5000` |
| `CIRCUIT_BREAKER_FAILURE_THRESHOLD` | gateway | `5` |
| `CIRCUIT_BREAKER_OPEN_MS` | gateway | `30000` |
| `RATE_LIMIT_*` | gateway/services | see `docker-compose.yml` |
| `BCRYPT_SALT_ROUNDS` | user service | `10` |
| `MONGODB_URI` | user service / notes service | service-specific |
| `MONGODB_DB_NAME` | user service | `users_db` in Docker |
| `VITE_API_BASE` | frontend | `http://localhost:3000` |

## API Overview

The gateway exposes both unversioned and versioned routes. The frontend currently uses the unversioned routes.

### Public Route

- `POST /users/login`
- `POST /api/v1/users/login`

### User Routes

Admin-only:

- `GET /users`
- `POST /users/register`
- `PATCH /users/:id`
- `DELETE /users/:id`

Versioned equivalents are also available under `/api/v1/users`.

### Notes Routes

Authenticated users:

- `GET /notes`
- `POST /notes`
- `PATCH /notes/:id`
- `DELETE /notes/:id`

Versioned equivalents are also available under `/api/v1/notes`.

Behavior:

- admins can view and manage all users
- admins can create notes for any user
- non-admin users can only access their own notes
- all non-login `/users` and `/notes` routes require `Authorization: Bearer <token>`

## Bootstrap An Admin User

User registration is admin-only, so a fresh system usually needs a first admin created with the helper script.

From `user_service`:

```powershell
npm run users:create -- --name "Admin User" --email "admin@example.com" --password "admin123" --role admin
```

List users:

```powershell
npm run users:list
```

Change a password:

```powershell
npm run users:password -- --email "admin@example.com" --password "new-password"
```

These scripts use the `user_service` environment variables, especially `MONGODB_URI` and `MONGODB_DB_NAME`.

## Smoke Test

The gateway includes a small integration smoke test that performs:

1. login
2. create note
3. fetch notes
4. delete note

Run it from `api_gateway` after setting credentials for an existing user:

```powershell
$env:SMOKE_EMAIL="admin@example.com"
$env:SMOKE_PASSWORD="admin123"
npm run test:smoke
```

Optional variables:

- `SMOKE_BASE_URL` default: `http://localhost:3000`
- `SMOKE_TIMEOUT_MS` default: `8000`

## Circuit Breaker Demo

Run this from the repository root to simulate `user_service` failure and verify gateway circuit breaker behavior:

Expected result:

- while `user_service` is stopped, requests move from upstream errors to `503` responses containing `CIRCUIT_OPEN`
- after restart and cooldown, requests reach `user_service` again
- if the demo credentials do not exist, the recovery request typically returns `401 Invalid credentials`

## Example Login Request

```powershell
$body = @{
  email = "admin@example.com"
  password = "admin123"
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/users/login" `
  -ContentType "application/json" `
  -Body $body
```

Use the returned token as a bearer token for protected routes.

## Repository Layout

```text
api_gateway/     API gateway and smoke test
user_service/    user CRUD, login, and admin bootstrap scripts
notes_service/   note CRUD service
frontend/        React dashboard
scripts/         repo-level helper scripts
docker-compose.yml
```
