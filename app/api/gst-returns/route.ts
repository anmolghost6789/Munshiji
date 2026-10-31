import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { prepareReturns, returnsCsv } from "@/lib/gst-returns";

export const GET = route("gst.view", async (req) => {
  const sp = req.nextUrl.searchParams;
  const month = sp.get("month") || new Date().toISOString().slice(0, 7);
  try {
    if (sp.get("format") === "csv") {
      const out = await returnsCsv(month, sp.get("section") || "");
      if (!out) return NextResponse.json({ error: "No such section for this business" }, { status: 400 });
      return new Response(out.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${out.filename}"` } });
    }
    return NextResponse.json(await prepareReturns(month));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
});
