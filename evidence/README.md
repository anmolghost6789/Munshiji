# Readiness evidence

- `test-report.txt`: all 93 automated tests. Each test file gets a fresh PostgreSQL database with the real migrations, and the app
  connects as an ordinary role (no superuser, no BYPASSRLS), so Row-Level Security is genuinely enforced. Includes:
  `tenancy.test.ts` (12 tests: businesses can't see or change each other's data), the two-week 50-order pilot simulation,
  concurrency races, the backup/restore drill, security, WhatsApp, and `accounts.test.ts` (Resend email: reset, confirmation and invites; WhatsApp number linking and replies).
- `run-through/`: order-to-payment in a real browser on a production build: sign-up, invites, purchase, staff order,
  dispatch, bill, part and full payment, WhatsApp draft and approval. `log.txt` lists each step; `run-through.py` reproduces it.
- `multi-business/`: two businesses, invite links, one person in both with different roles, switching, and each business
  seeing only its own data.
- `mobile/`: every main screen on a 390×844 phone viewport (production build, real data).
