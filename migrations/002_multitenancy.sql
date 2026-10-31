-- Munshiji v2: many businesses per deployment.
-- Isolation is enforced by PostgreSQL Row-Level Security: every business table carries business_id, and a
-- request can only see or write rows of the business set with set_config('app.business_id', …, true).
-- The app's database role must NOT be a superuser and must NOT have BYPASSRLS.

CREATE TABLE businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  whatsapp_phone_number_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX ux_business_wa ON businesses(whatsapp_phone_number_id) WHERE whatsapp_phone_number_id <> '';

CREATE TABLE memberships (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','manager','staff')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, business_id)
);
CREATE INDEX idx_memberships_business ON memberships(business_id);

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','manager','staff')),
  phone TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL UNIQUE,        -- sha256 of the link token; the token itself is never stored
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_invites_business ON invites(business_id);

-- ── Convert an existing single-business install (no-op on a fresh database) ──
DO $$
DECLARE bid TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM users) THEN
    bid := 'b-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
    INSERT INTO businesses (id, name) SELECT bid, COALESCE((SELECT company_name FROM business_profile LIMIT 1), '');
    INSERT INTO memberships (user_id, business_id, role, active) SELECT id, bid, role, active FROM users;
    PERFORM set_config('munshiji.migrate_bid', bid, true);
  ELSE
    DELETE FROM business_profile;  -- the placeholder row; businesses get their profile row at sign-up
  END IF;
END $$;

-- ── business_id on every business table ──
DO $$
DECLARE t TEXT; bid TEXT := current_setting('munshiji.migrate_bid', true);
BEGIN
  FOREACH t IN ARRAY ARRAY['business_profile','customers','products','orders','order_items','invoices','counters','payments',
    'suppliers','raw_materials','purchase_orders','purchase_items','purchase_receipts','purchase_receipt_items',
    'inventory_ledger','bom','audit_log','inbound_messages'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN business_id TEXT', t);
    IF bid IS NOT NULL AND bid <> '' THEN EXECUTE format('UPDATE %I SET business_id = %L', t, bid); END IF;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN business_id SET DEFAULT current_setting(''app.business_id'', true)', t);
  END LOOP;
END $$;
-- inbound messages that couldn't be attributed (e.g. unknown senders) may stay without a business
UPDATE inbound_messages SET business_id = NULL WHERE business_id = '';
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['business_profile','customers','products','orders','order_items','invoices','counters','payments',
    'suppliers','raw_materials','purchase_orders','purchase_items','purchase_receipts','purchase_receipt_items',
    'inventory_ledger','bom','audit_log'] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN business_id SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE', t, t || '_business_fk');
  END LOOP;
  ALTER TABLE inbound_messages ADD CONSTRAINT inbound_messages_business_fk FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
END $$;

-- ── Keys scoped per business ──
ALTER TABLE business_profile DROP COLUMN id;                 -- was the single-row id = 1
ALTER TABLE business_profile ADD PRIMARY KEY (business_id);

ALTER TABLE counters DROP CONSTRAINT counters_pkey;
ALTER TABLE counters ADD PRIMARY KEY (business_id, name, period);

-- Order numbers (ORD-1001…) repeat across businesses, so orders are keyed by (business_id, id).
ALTER TABLE order_items DROP CONSTRAINT order_items_order_id_fkey;
ALTER TABLE invoices DROP CONSTRAINT invoices_order_id_fkey;
ALTER TABLE payments DROP CONSTRAINT payments_order_id_fkey;
ALTER TABLE orders DROP CONSTRAINT orders_pkey;
ALTER TABLE orders ADD PRIMARY KEY (business_id, id);

-- Every cross-table link carries business_id, so a row can never point at another business's data.
ALTER TABLE customers ADD CONSTRAINT customers_bid_id UNIQUE (business_id, id);
ALTER TABLE products ADD CONSTRAINT products_bid_id UNIQUE (business_id, id);
ALTER TABLE suppliers ADD CONSTRAINT suppliers_bid_id UNIQUE (business_id, id);
ALTER TABLE raw_materials ADD CONSTRAINT raw_materials_bid_id UNIQUE (business_id, id);
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_bid_id UNIQUE (business_id, id);
ALTER TABLE purchase_receipts ADD CONSTRAINT purchase_receipts_bid_id UNIQUE (business_id, id);
ALTER TABLE orders DROP CONSTRAINT orders_customer_id_fkey;
ALTER TABLE orders ADD CONSTRAINT orders_customer_fk FOREIGN KEY (business_id, customer_id) REFERENCES customers(business_id, id);
ALTER TABLE order_items ADD CONSTRAINT order_items_order_fk FOREIGN KEY (business_id, order_id) REFERENCES orders(business_id, id) ON DELETE CASCADE;
ALTER TABLE order_items DROP CONSTRAINT order_items_product_id_fkey;
ALTER TABLE order_items ADD CONSTRAINT order_items_product_fk FOREIGN KEY (business_id, product_id) REFERENCES products(business_id, id);
ALTER TABLE invoices ADD CONSTRAINT invoices_order_fk FOREIGN KEY (business_id, order_id) REFERENCES orders(business_id, id);
ALTER TABLE invoices DROP CONSTRAINT invoices_customer_id_fkey;
ALTER TABLE invoices ADD CONSTRAINT invoices_customer_fk FOREIGN KEY (business_id, customer_id) REFERENCES customers(business_id, id);
ALTER TABLE payments ADD CONSTRAINT payments_order_fk FOREIGN KEY (business_id, order_id) REFERENCES orders(business_id, id);
ALTER TABLE purchase_orders DROP CONSTRAINT purchase_orders_supplier_id_fkey;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_supplier_fk FOREIGN KEY (business_id, supplier_id) REFERENCES suppliers(business_id, id);
ALTER TABLE purchase_items DROP CONSTRAINT purchase_items_po_id_fkey;
ALTER TABLE purchase_items ADD CONSTRAINT purchase_items_po_fk FOREIGN KEY (business_id, po_id) REFERENCES purchase_orders(business_id, id) ON DELETE CASCADE;
ALTER TABLE purchase_items DROP CONSTRAINT purchase_items_material_id_fkey;
ALTER TABLE purchase_items ADD CONSTRAINT purchase_items_material_fk FOREIGN KEY (business_id, material_id) REFERENCES raw_materials(business_id, id);
ALTER TABLE purchase_receipts DROP CONSTRAINT purchase_receipts_supplier_id_fkey;
ALTER TABLE purchase_receipts ADD CONSTRAINT purchase_receipts_supplier_fk FOREIGN KEY (business_id, supplier_id) REFERENCES suppliers(business_id, id);
ALTER TABLE purchase_receipt_items DROP CONSTRAINT purchase_receipt_items_receipt_id_fkey;
ALTER TABLE purchase_receipt_items ADD CONSTRAINT purchase_receipt_items_receipt_fk FOREIGN KEY (business_id, receipt_id) REFERENCES purchase_receipts(business_id, id) ON DELETE CASCADE;
ALTER TABLE bom DROP CONSTRAINT bom_product_id_fkey;
ALTER TABLE bom DROP CONSTRAINT bom_material_id_fkey;
ALTER TABLE bom ADD CONSTRAINT bom_product_fk FOREIGN KEY (business_id, product_id) REFERENCES products(business_id, id);
ALTER TABLE bom ADD CONSTRAINT bom_material_fk FOREIGN KEY (business_id, material_id) REFERENCES raw_materials(business_id, id);

-- Uniqueness rules, now per business
DROP INDEX ux_orders_idem;      CREATE UNIQUE INDEX ux_orders_idem ON orders(business_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
DROP INDEX ux_invoice_order;    CREATE UNIQUE INDEX ux_invoice_order ON invoices(business_id, order_id);
DROP INDEX ux_invoice_number;   CREATE UNIQUE INDEX ux_invoice_number ON invoices(business_id, invoice_number);
ALTER TABLE payments DROP CONSTRAINT payments_idempotency_key_key;
CREATE UNIQUE INDEX ux_payments_idem ON payments(business_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE purchase_receipts DROP CONSTRAINT purchase_receipts_idempotency_key_key;
CREATE UNIQUE INDEX ux_receipts_idem ON purchase_receipts(business_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
DROP INDEX ux_receipt_bill;     CREATE UNIQUE INDEX ux_receipt_bill ON purchase_receipts(business_id, supplier_id, bill_number) WHERE bill_number <> '';
DROP INDEX ux_ledger_order_moves;
CREATE UNIQUE INDEX ux_ledger_order_moves ON inventory_ledger(business_id, ref_type, ref_id, item_type, item_id, direction) WHERE ref_type IN ('order_dispatch','order_cancel');
CREATE INDEX idx_orders_business_created ON orders(business_id, created_at);
CREATE INDEX idx_audit_business ON audit_log(business_id, id);

-- ── Row-Level Security: the isolation boundary ──
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['business_profile','customers','products','orders','order_items','invoices','counters','payments',
    'suppliers','raw_materials','purchase_orders','purchase_items','purchase_receipts','purchase_receipt_items',
    'inventory_ledger','bom','audit_log','inbound_messages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);   -- applies to the table owner too
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (business_id = current_setting(''app.business_id'', true)) WITH CHECK (business_id = current_setting(''app.business_id'', true))', t);
  END LOOP;
END $$;

-- Users are now identities only; roles live on memberships.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ALTER COLUMN role SET DEFAULT '';
