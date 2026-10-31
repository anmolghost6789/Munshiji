-- Munshiji schema v1 for PostgreSQL. Money is NUMERIC (exact), timestamps are timestamptz (UTC).
CREATE TABLE business_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  company_name TEXT NOT NULL DEFAULT '', gstin TEXT DEFAULT '', udyam_number TEXT DEFAULT '', pan TEXT DEFAULT '',
  address TEXT DEFAULT '', city TEXT DEFAULT '', state TEXT DEFAULT '', pincode TEXT DEFAULT '', phone TEXT DEFAULT '', email TEXT DEFAULT '',
  bank_name TEXT DEFAULT '', bank_account TEXT DEFAULT '', bank_ifsc TEXT DEFAULT '',
  overdue_days INTEGER DEFAULT 30, status_styles TEXT DEFAULT '{}', template TEXT DEFAULT 'manufacturer', capabilities TEXT DEFAULT '',
  gst_registration TEXT DEFAULT 'regular', composition_rate NUMERIC(5,2) DEFAULT 1, upi_id TEXT DEFAULT '',
  invoice_prefix TEXT DEFAULT 'INV', invoice_start INTEGER DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT now()
);
INSERT INTO business_profile (id) VALUES (1);

CREATE TABLE users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','manager','staff')),
  phone TEXT DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(), last_login TIMESTAMPTZ
);

CREATE TABLE customers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT DEFAULT '', address TEXT DEFAULT '', gstin TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE products (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, name_hi TEXT DEFAULT '', sku TEXT DEFAULT '', unit TEXT DEFAULT 'piece',
  price NUMERIC(14,2) DEFAULT 0, hsn_code TEXT DEFAULT '', gst_rate NUMERIC(5,2) DEFAULT 18, active INTEGER DEFAULT 1,
  track_stock INTEGER DEFAULT 1, current_stock NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (current_stock >= 0), reorder_level NUMERIC(14,3) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id),
  state TEXT NOT NULL DEFAULT 'new', subtotal NUMERIC(14,2) DEFAULT 0, gst NUMERIC(14,2) DEFAULT 0, grand_total NUMERIC(14,2) DEFAULT 0,
  delivery_date TEXT DEFAULT '', notes TEXT DEFAULT '', raw_message TEXT DEFAULT '', invoice_id TEXT,
  idempotency_key TEXT, source TEXT DEFAULT 'manual', created_by TEXT DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
  stock_deducted INTEGER NOT NULL DEFAULT 0, amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0, cancel_reason TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(),
  CHECK (amount_paid <= grand_total + 0.005)
);
CREATE UNIQUE INDEX ux_orders_idem ON orders(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_orders_state ON orders(state);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_created ON orders(created_at);

CREATE TABLE order_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id), product_name TEXT NOT NULL, qty NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  unit TEXT DEFAULT 'piece', price NUMERIC(14,2) NOT NULL, total NUMERIC(14,2) NOT NULL, hsn_code TEXT DEFAULT '',
  gst_rate NUMERIC(5,2) DEFAULT 18, gst_amount NUMERIC(14,2) DEFAULT 0
);
CREATE INDEX idx_order_items_order ON order_items(order_id);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), customer_id TEXT NOT NULL REFERENCES customers(id),
  invoice_number TEXT NOT NULL, subtotal NUMERIC(14,2) DEFAULT 0, cgst NUMERIC(14,2) DEFAULT 0, sgst NUMERIC(14,2) DEFAULT 0, igst NUMERIC(14,2) DEFAULT 0,
  grand_total NUMERIC(14,2) DEFAULT 0, doc_type TEXT DEFAULT 'tax_invoice', place_of_supply TEXT DEFAULT '', status TEXT DEFAULT 'generated',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX ux_invoice_order ON invoices(order_id);   -- one bill per order
CREATE UNIQUE INDEX ux_invoice_number ON invoices(invoice_number); -- bill numbers never repeat

CREATE TABLE counters (name TEXT NOT NULL, period TEXT NOT NULL, value INTEGER NOT NULL, PRIMARY KEY (name, period));

CREATE TABLE payments (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  mode TEXT NOT NULL DEFAULT 'upi', reference TEXT DEFAULT '', received_on DATE NOT NULL, idempotency_key TEXT UNIQUE,
  voided INTEGER NOT NULL DEFAULT 0, void_reason TEXT DEFAULT '', created_by TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_payments_order ON payments(order_id);

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT DEFAULT '', address TEXT DEFAULT '', gstin TEXT DEFAULT '',
  contact_person TEXT DEFAULT '', payment_terms TEXT DEFAULT 'Net 30', created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE raw_materials (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, name_hi TEXT DEFAULT '', sku TEXT DEFAULT '', unit TEXT DEFAULT 'kg', hsn_code TEXT DEFAULT '',
  gst_rate NUMERIC(5,2) DEFAULT 18, current_stock NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (current_stock >= 0), reorder_level NUMERIC(14,3) DEFAULT 0,
  last_purchase_price NUMERIC(14,2) DEFAULT 0, active INTEGER DEFAULT 1, created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE purchase_orders (
  id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL REFERENCES suppliers(id), state TEXT DEFAULT 'draft',
  subtotal NUMERIC(14,2) DEFAULT 0, gst NUMERIC(14,2) DEFAULT 0, grand_total NUMERIC(14,2) DEFAULT 0,
  expected_date TEXT DEFAULT '', notes TEXT DEFAULT '', raw_message TEXT DEFAULT '', bill_number TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_po_supplier ON purchase_orders(supplier_id);
CREATE TABLE purchase_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, po_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  material_id TEXT NOT NULL REFERENCES raw_materials(id), material_name TEXT NOT NULL, qty NUMERIC(14,3) NOT NULL, unit TEXT DEFAULT 'kg',
  price NUMERIC(14,2) NOT NULL, total NUMERIC(14,2) NOT NULL, hsn_code TEXT DEFAULT '', gst_rate NUMERIC(5,2) DEFAULT 18, gst_amount NUMERIC(14,2) DEFAULT 0
);

CREATE TABLE purchase_receipts (
  id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL REFERENCES suppliers(id), bill_number TEXT DEFAULT '', bill_date DATE NOT NULL,
  subtotal NUMERIC(14,2) DEFAULT 0, gst NUMERIC(14,2) DEFAULT 0, grand_total NUMERIC(14,2) DEFAULT 0, notes TEXT DEFAULT '',
  idempotency_key TEXT UNIQUE, created_by TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX ux_receipt_bill ON purchase_receipts(supplier_id, bill_number) WHERE bill_number <> '';
CREATE TABLE purchase_receipt_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, receipt_id TEXT NOT NULL REFERENCES purchase_receipts(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('product','material')), item_id TEXT NOT NULL, item_name TEXT NOT NULL,
  qty NUMERIC(14,3) NOT NULL CHECK (qty > 0), unit TEXT DEFAULT '', rate NUMERIC(14,2) NOT NULL CHECK (rate >= 0), total NUMERIC(14,2) NOT NULL,
  gst_rate NUMERIC(5,2) DEFAULT 0, gst_amount NUMERIC(14,2) DEFAULT 0
);

CREATE TABLE inventory_ledger (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, item_type TEXT NOT NULL, item_id TEXT NOT NULL, item_name TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')), qty NUMERIC(14,3) NOT NULL, unit TEXT DEFAULT '',
  ref_type TEXT DEFAULT '', ref_id TEXT DEFAULT '', notes TEXT DEFAULT '', balance_after NUMERIC(14,3), user_id TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_inv_ledger_item ON inventory_ledger(item_type, item_id);
CREATE UNIQUE INDEX ux_ledger_order_moves ON inventory_ledger(ref_type, ref_id, item_type, item_id, direction) WHERE ref_type IN ('order_dispatch','order_cancel');

CREATE TABLE bom (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), material_id TEXT NOT NULL REFERENCES raw_materials(id),
  qty_per_unit NUMERIC(14,4) NOT NULL, unit TEXT DEFAULT 'kg', UNIQUE (product_id, material_id)
);

CREATE TABLE audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id TEXT DEFAULT '', user_name TEXT DEFAULT '',
  action TEXT NOT NULL, entity_type TEXT DEFAULT '', entity_id TEXT DEFAULT '', details TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);

CREATE TABLE inbound_messages (
  id TEXT PRIMARY KEY, channel TEXT NOT NULL DEFAULT 'whatsapp', external_id TEXT NOT NULL UNIQUE, sender TEXT DEFAULT '', sender_user_id TEXT DEFAULT '',
  body TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'received', parsed_json TEXT DEFAULT '', error TEXT DEFAULT '', order_id TEXT DEFAULT '',
  received_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_inbound_status ON inbound_messages(status);

-- Login attempts live in the database so the lockout works across serverless instances and pods.
CREATE TABLE login_attempts (key TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX idx_login_attempts ON login_attempts(key, at);
