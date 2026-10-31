import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { getGSTR1Data, getBusinessProfile } from "@/lib/db";

export const GET = route("gst.view", async (req) => {
  const from = req.nextUrl.searchParams.get("from") || new Date(Date.now() - 30*86400000).toISOString().split("T")[0];
  const to = req.nextUrl.searchParams.get("to") || new Date().toISOString().split("T")[0];
  const format = req.nextUrl.searchParams.get("format") || "json";

  const data = await getGSTR1Data(from, to);
  const biz = await getBusinessProfile();

  if (format === "csv") {
    const headers = ["Invoice Number","Invoice Date","Buyer Name","Buyer GSTIN","Taxable Value","CGST","SGST","IGST","Total Value","Place of Supply"];
    const rows = data.map((r: any) => [r.invoice_number, r.invoice_date?.split(" ")[0], r.buyer_name, r.buyer_gstin, r.taxable_value, r.cgst, r.sgst, r.igst || 0, r.total_value, r.place_of_supply || biz?.state || ""].join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="GSTR1_${from}_to_${to}.csv"`,
      },
    });
  }

  return NextResponse.json({ data, from, to, seller_gstin: biz?.gstin || "" });
});
