import { describe, it, expect, beforeAll } from "vitest";
import { basicParse } from "@/lib/parse";
import { seedPilotBusiness } from "./helpers";

beforeAll(async () => await seedPilotBusiness());
describe("basic reader (works without AI)", () => {
  it("reads Hinglish quantities and matches catalog products and the buyer", async () => {
    const d = await basicParse("Namaste, Hindustan Foods se. 500 BOPP tape aur 2000 medium 5-ply box chahiye. Delivery 28th tak.", "2026-10-26");
    expect(d.customer?.id).toBe("c-hfl");
    expect(d.items).toEqual([
      { product_id: "sku-tape", name: "BOPP Tape 48mm", qty: 500, unit: "roll" },
      { product_id: "sku-box", name: "5-Ply Box Medium", qty: 2000, unit: "piece" },
    ]);
    expect(d.delivery_date).toBe("2026-10-28");
  });
  it("never drops a line: each sentence's quantity is read, unknown items included", async () => {
    const d = await basicParse("Namaste, 500 BOPP tape aur 1000 medium 5-ply box chahiye. 5 bubble wrap bhi. Delivery 28th tak. Rajesh, Hindustan Foods 98200 12345", "2026-10-26");
    expect(d.items.map((i) => [i.product_id, i.qty])).toEqual([["sku-tape", 500], ["sku-box", 1000], [null, 5]]);
    expect(d.customer?.id).toBe("c-hfl");
  });
  it("marks unknown products as unknown instead of guessing", async () => {
    const d = await basicParse("300 bubble wrap rolls", "2026-10-26");
    expect(d.items).toEqual([{ product_id: null, name: "bubble wrap rolls", qty: 300 }]);
  });
  it("reads Devanagari digits, '2k', and buyers by phone", async () => {
    const d = await basicParse("९८४५० १२३४५ — 2k stretch film", "2026-10-26");
    expect(d.customer?.id).toBe("c-ka");
    expect(d.items[0]).toMatchObject({ product_id: "sku-film", qty: 2000 });
  });
});

import { ORDER_STATES, STATUS_COLORS } from "@/lib/types";
describe("box makers' words", () => {
  it("tells 3-ply from 5-ply and matches sizes written with x, × or *", async () => {
    const { exec } = await import("@/lib/sql");
    await exec("INSERT INTO products (id, name, unit, price, hsn_code, gst_rate) VALUES ('b5', '5-Ply Box 18×12×12 in (printed)', 'piece', 28, '48191010', 5), ('b3', '3-Ply Box 12×10×8 in', 'piece', 11.5, '48191010', 5), ('bp', 'Partition Insert 5-Ply', 'piece', 4.5, '48191090', 5) ON CONFLICT DO NOTHING");
    const d = await basicParse("Ganesh ji, 5000 5-ply box 18x12x12 chahiye, logo print. 2000 partition bhi. 800 3 ply box 12*10*8.", "2026-10-26");
    expect(d.items.map((i) => [i.product_id, i.qty])).toEqual([["b5", 5000], ["bp", 2000], ["b3", 800]]);
  });
});

describe("status colours", () => {
  it("every order status uses a colour that exists (a missing one crashes the Settings page)", () => {
    for (const s of ORDER_STATES) expect(STATUS_COLORS[s.color as keyof typeof STATUS_COLORS], s.key).toBeDefined();
  });
});

import { formatINR } from "@/lib/types";
describe("money on screen", () => {
  it("shows Indian grouping and two paise digits when there are paise", () => {
    expect(formatINR(156450)).toBe("₹1,56,450");
    expect(formatINR(22702.5)).toBe("₹22,702.50");
    expect(formatINR(11.5)).toBe("₹11.50");
    expect(formatINR(1831.36)).toBe("₹1,831.36");
  });
});
