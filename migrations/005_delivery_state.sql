-- Place of supply for buyers without a GSTIN: the state where the goods are delivered (IGST Act s.10(1)(a)).
ALTER TABLE orders ADD COLUMN delivery_state TEXT NOT NULL DEFAULT '';   -- 2-digit GST state code; '' = seller's state
ALTER TABLE customers ADD COLUMN state_code TEXT NOT NULL DEFAULT '';    -- remembered for next time
