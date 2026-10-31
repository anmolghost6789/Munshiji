-- Contacts you can add and edit directly, and the business each person last worked in.
ALTER TABLE customers ADD COLUMN email TEXT NOT NULL DEFAULT '';
ALTER TABLE suppliers ADD COLUMN email TEXT NOT NULL DEFAULT '';
ALTER TABLE suppliers ADD COLUMN state_code TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN last_business_id TEXT NOT NULL DEFAULT '';
