/* Place of supply for goods (IGST Act s.10): registered buyer's state; otherwise where the goods are delivered. */
import { describe, it, expect, beforeAll } from "vitest";
import { one, exec } from "@/lib/sql";
import { createOrder, advanceOrder } from "@/lib/core/orders";
import { createReceipt } from "@/lib/core/inventory";
import { setTransport } from "@/lib/core/gstdocs";
import { prepareReturns } from "@/lib/gst-returns";
import { placeOfSupply } from "@/lib/gst";
import { owner, manager, staff, seedPilotBusiness } from "./helpers";

async function bill(customer: object, qty: number, key: string, delivery_state?: string) {
  const { order } = await createOrder({ customer, items: [{ product_id: "sku-box", qty }], delivery_state, confirm_duplicate: true }, staff, key);
  for (const s of ["confirmed", "preparing"]) await advanceOrder(order.id, s, staff);
  if (order.grand_total > 50000) await setTransport(order.id, { ewb_number: "341000000001", vehicle_number: "MH12AB1234" }, staff);
  for (const s of ["dispatched", "delivered"]) await advanceOrder(order.id, s, staff);
  await advanceOrder(order.id, "invoiced", manager); // bills are made by an owner or manager
  return (await one<{ cgst: number; sgst: number; igst: number; place_of_supply: string; order_id: string }>("SELECT cgst, sgst, igst, place_of_supply, order_id FROM invoices WHERE order_id = ?", [order.id]))!;
}
beforeAll(async () => { await seedPilotBusiness(); await createReceipt({ supplier_name: "Shree", items: [{ item_id: "sku-box", qty: 100000, rate: 20 }] }, owner); });

describe("place of supply", () => {
  it("the rule: buyer GSTIN state, else delivery state, else seller state", () => {
    expect(placeOfSupply("27", "29AAGCB7383J1Z4", "33")).toBe("29"); // registered buyer wins (bill-to-ship-to)
    expect(placeOfSupply("27", null, "29")).toBe("29");              // consumer delivered to Karnataka
    expect(placeOfSupply("27", null, "")).toBe("27");                // not given: seller's state
    expect(placeOfSupply("27", null, "99")).toBe("27");              // not a state: ignored
  });
  it("a consumer delivered in another state is billed IGST; in the same state, CGST + SGST", async () => {
    const out = await bill({ name: "Bengaluru Home Buyer" }, 100, "pos-1", "29"); // ₹2,800 → 18%
    expect(out).toMatchObject({ igst: 504, cgst: 0, sgst: 0, place_of_supply: "29" });
    const same = await bill({ name: "Pune Home Buyer" }, 100, "pos-2", "27");
    expect(same).toMatchObject({ igst: 0, cgst: 252, sgst: 252, place_of_supply: "27" });
    expect((await one<{ state_code: string }>("SELECT state_code FROM customers WHERE name = 'Bengaluru Home Buyer'"))!.state_code).toBe("29"); // remembered
  });
  it("a registered buyer's GSTIN state wins over any delivery state", async () => {
    expect(await bill({ id: "c-hfl" }, 100, "pos-3", "29")).toMatchObject({ igst: 0, cgst: 252, sgst: 252, place_of_supply: "27" });
  });
  it("GSTR-1 reports consumer sales by delivery state, and large out-of-state ones as B2CL", async () => {
    const big = await bill({ name: "Chennai Bulk Buyer" }, 4000, "pos-4", "33"); // ₹1,12,000 + IGST > ₹1 lakh, Tamil Nadu
    const month = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);
    const r = await prepareReturns(month) as { gstr1: { b2cs: { pos: string; rate: number; igst: number; cgst: number }[]; b2cl: { pos: string; igst: number }[] } };
    expect(r.gstr1.b2cs.find((x) => x.pos === "29")).toMatchObject({ igst: 504, cgst: 0 });
    expect(r.gstr1.b2cs.find((x) => x.pos === "27")).toMatchObject({ igst: 0, cgst: 252 });
    expect(r.gstr1.b2cl).toEqual([expect.objectContaining({ pos: "33", igst: 20160 })]);
    expect(big.igst).toBe(20160);
  });
  it("rejects a delivery state that isn't a real state code", async () => {
    await expect(createOrder({ customer: { name: "Nowhere Buyer" }, items: [{ product_id: "sku-box", qty: 1 }], delivery_state: "99" }, staff)).rejects.toThrow(/delivery state/);
  });
});
