-- Credit notes (CGST Act s.34), e-invoicing (IRN) and e-way bill details.

ALTER TABLE business_profile ADD COLUMN einvoice_applicable INTEGER NOT NULL DEFAULT 0;   -- AATO > ₹5 crore in any FY since 2017-18
ALTER TABLE business_profile ADD COLUMN ewb_threshold NUMERIC(14,2) NOT NULL DEFAULT 50000; -- consignment value incl. GST
ALTER TABLE business_profile ADD COLUMN credit_note_prefix TEXT NOT NULL DEFAULT 'CN';

-- E-invoice registration details, recorded from the IRP (Invoice Registration Portal)
ALTER TABLE invoices ADD COLUMN einvoice_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN irn TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN ack_no TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN ack_date TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN signed_qr TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX ux_invoice_irn ON invoices(business_id, irn) WHERE irn <> '';

-- E-way bill and transport details on the order (filled at dispatch)
ALTER TABLE orders ADD COLUMN ewb_number TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN ewb_date TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN ewb_exempt_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN vehicle_number TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN transporter_name TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN transporter_id TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN distance_km INTEGER;
ALTER TABLE orders ADD COLUMN amount_credited NUMERIC(14,2) NOT NULL DEFAULT 0;

CREATE TABLE credit_notes (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL DEFAULT current_setting('app.business_id', true) REFERENCES businesses(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  number TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('goods_returned','price_reduction','excess_tax','deficiency','discount','other')),
  reason_note TEXT NOT NULL DEFAULT '',
  doc_type TEXT NOT NULL DEFAULT 'credit_note',
  place_of_supply TEXT NOT NULL DEFAULT '',
  subtotal NUMERIC(14,2) NOT NULL, cgst NUMERIC(14,2) NOT NULL DEFAULT 0, sgst NUMERIC(14,2) NOT NULL DEFAULT 0, igst NUMERIC(14,2) NOT NULL DEFAULT 0,
  grand_total NUMERIC(14,2) NOT NULL CHECK (grand_total > 0),
  restocked INTEGER NOT NULL DEFAULT 0,
  einvoice_required INTEGER NOT NULL DEFAULT 0, irn TEXT NOT NULL DEFAULT '', ack_no TEXT NOT NULL DEFAULT '', ack_date TIMESTAMPTZ, signed_qr TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  FOREIGN KEY (business_id, order_id) REFERENCES orders(business_id, id),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id)
);
CREATE UNIQUE INDEX ux_credit_note_number ON credit_notes(business_id, number);
CREATE UNIQUE INDEX ux_credit_note_idem ON credit_notes(business_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_credit_notes_order ON credit_notes(business_id, order_id);
CREATE TABLE credit_note_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id TEXT NOT NULL DEFAULT current_setting('app.business_id', true) REFERENCES businesses(id) ON DELETE CASCADE,
  credit_note_id TEXT NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL, product_name TEXT NOT NULL,
  qty NUMERIC(14,3) NOT NULL DEFAULT 0,          -- 0 for value-only credit (price reduction, discount)
  unit TEXT NOT NULL DEFAULT '', price NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL CHECK (total > 0),  -- taxable value credited
  hsn_code TEXT NOT NULL DEFAULT '', gst_rate NUMERIC(5,2) NOT NULL DEFAULT 0, gst_amount NUMERIC(14,2) NOT NULL DEFAULT 0
);
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['credit_notes','credit_note_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (business_id = current_setting(''app.business_id'', true)) WITH CHECK (business_id = current_setting(''app.business_id'', true))', t);
  END LOOP;
END $$;
ALTER TABLE orders ADD CONSTRAINT orders_credit_not_more_than_total CHECK (amount_credited <= grand_total + 0.005);

-- Consent and legal acceptance (DPDP): what each person agreed to, and when
ALTER TABLE users ADD COLUMN terms_version TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN terms_accepted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE businesses ADD COLUMN closed_at TIMESTAMPTZ;
