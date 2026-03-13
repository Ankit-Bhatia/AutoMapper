# Runbooks

## Local Dev Setup

1. Install dependencies from the repository root:
   `npm install`
2. Start the core backend API (full app path):
   `npm run dev:api`
3. Start the frontend:
   `npm run dev:frontend`
4. Optional: start the demo API server:
   `npm run demo:backend`

## Running Demo

1. Start demo API:
   `npm run demo:backend`
2. Start frontend:
   `npm run demo:frontend`
3. Open the local URL shown by Vite and keep both terminals running.

## Running Tests

1. Run full test suite:
   `npm test`
2. Run backend tests only:
   `npm run test:backend`
3. Run frontend tests only:
   `npm run test:frontend`

## Deploying

1. Build application artifacts:
   `npm run build`
2. Start backend from compiled output:
   `npm --prefix backend run start`
3. Serve frontend build output from `apps/web/dist` using your static hosting stack.
