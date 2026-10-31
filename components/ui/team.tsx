"use client";
/* Team for the current business: members (role per business) and invite links. */
import { useCallback, useEffect, useState } from "react";
import { Avatar } from "./kit";
import { IcPlus } from "../icons";

interface M { id: string; name: string; email: string; role: string; phone: string; active: number; last_login: string | null }
interface Inv { id: string; email: string; role: string; expires_at: string }
interface JoinReq { id: string; name: string; email: string; created_at: string }
const ROLES = [["owner", "Owner", "Everything, including team and settings"], ["manager", "Manager", "Orders, bills, payments, stock, GST"], ["staff", "Staff", "Create and update orders, dispatch and delivery"]];
const field = "h-10 px-3 rounded-[10px] border border-stone-300 bg-white text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";

export function TeamSettings({ myId, businessName }: { myId?: string; businessName: string }) {
  const [members, setMembers] = useState<M[]>([]);
  const [invites, setInvites] = useState<Inv[]>([]);
  const [requests, setRequests] = useState<JoinReq[]>([]);
  const [reqRole, setReqRole] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ email: "", role: "staff", phone: "" });
  const [link, setLink] = useState<{ url: string; code: string; email: string; emailed?: boolean } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => { const r = await fetch("/api/team"); if (r.ok) { const d = await r.json(); setMembers(d.members || []); setInvites(d.invites || []); setRequests(d.requests || []); } }, []);
  useEffect(() => { load(); }, [load]);

  async function call(method: "POST" | "PATCH" | "DELETE", body: object | null, ok: string, url = "/api/team") {
    setMsg(null);
    try {
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ ok: false, text: d.error || "Couldn't save." }); return null; }
      if (ok) setMsg({ ok: true, text: ok }); await load(); return d;
    } catch { setMsg({ ok: false, text: "Couldn't reach Munshiji. Try again." }); return null; }
  }
  const waText = (url: string, code: string) => `https://wa.me/?text=${encodeURIComponent(`Join ${businessName} on Munshiji.\nOpen this link: ${url}\nOr choose “Join my team” at sign-up and enter the code ${code}.`)}`;

  return (
    <div className="rounded-2xl border border-stone-200 bg-white shadow-card p-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h3 className="text-sm font-bold text-stone-800">Team</h3>
        {!adding && <button onClick={() => { setAdding(true); setLink(null); }} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-emerald-700"><IcPlus className="w-4 h-4" /> Invite someone</button>}
      </div>
      <p className="text-xs text-stone-500 mb-4">People join with an invite link or code, or by asking to join. Each invite works once and expires in 7 days.</p>

      {requests.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 mb-4">
        <div className="text-sm font-semibold text-amber-900 mb-2">{requests.length === 1 ? "1 person wants" : `${requests.length} people want`} to join {businessName}</div>
        <ul className="divide-y divide-amber-200">{requests.map((r) => (
          <li key={r.id} className="py-2 flex flex-col sm:flex-row sm:items-center gap-2">
            <span className="flex-1 min-w-0"><b className="text-stone-800">{r.name}</b> <span className="text-xs text-stone-600">{r.email} · asked {r.created_at.slice(0, 10)}</span></span>
            <span className="flex gap-2 items-center">
              <select aria-label={`Role for ${r.name}`} value={reqRole[r.id] || "staff"} onChange={(e) => setReqRole({ ...reqRole, [r.id]: e.target.value })} className={`${field} h-9`}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <button onClick={() => call("PATCH", { request_id: r.id, decision: "approve", role: reqRole[r.id] || "staff" }, `${r.name} has joined as ${reqRole[r.id] || "staff"}.`)} className="h-9 px-3 rounded-[10px] bg-emerald-600 text-white text-[13px] font-semibold">Let in</button>
              <button onClick={() => call("PATCH", { request_id: r.id, decision: "decline" }, `Declined ${r.name}'s request.`)} className="h-9 px-3 rounded-[10px] border border-stone-300 bg-white text-[13px] font-semibold text-stone-700">Decline</button>
            </span>
          </li>))}</ul>
      </div>}

      {adding && !link && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 mb-4 space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input aria-label="Email to invite" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Their email (optional)" className={field} />
          <select aria-label="Role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} className={field}>{ROLES.map(([v, l, h]) => <option key={v} value={v}>{l}: {h}</option>)}</select>
          <input aria-label="Their WhatsApp number (optional)" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="WhatsApp number (optional)" inputMode="tel" className={`${field} sm:col-span-2`} />
        </div>
        <div className="flex gap-2">
          <button onClick={async () => { const d = await call("POST", f, ""); if (d) setLink({ url: d.url, code: d.code, email: f.email, emailed: d.emailed }); }} disabled={!!f.email && !f.email.includes("@")} className="h-10 px-4 rounded-xl bg-emerald-600 text-white text-sm font-semibold disabled:opacity-40">Create invite link</button>
          <button onClick={() => setAdding(false)} className="h-10 px-4 rounded-xl border border-stone-300 bg-white text-sm font-semibold text-stone-700">Cancel</button>
        </div>
      </div>}

      {link && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 mb-4 space-y-2">
        <p className="text-sm font-semibold text-stone-800">Invite{link.email ? ` for ${link.email}` : ""}</p>
        <div className="rounded-xl bg-white border border-emerald-200 px-4 py-3 text-center"><div className="text-xs text-stone-500">Invite code</div><div className="font-mono text-2xl font-bold tracking-[0.15em] text-stone-800">{link.code}</div><div className="text-xs text-stone-500 mt-0.5">They choose “Join my team” at sign-up and type this.</div></div>
        <p className="text-xs text-stone-600">{link.emailed ? `We emailed it to ${link.email}. You can also share it yourself; ` : "Send it to them now; "}for security it&apos;s shown only once.</p>
        <input readOnly aria-label="Invite link" value={link.url} onFocus={(e) => e.currentTarget.select()} className={`${field} w-full font-mono text-xs`} />
        <div className="flex flex-wrap gap-2">
          <button onClick={() => navigator.clipboard?.writeText(link.url).then(() => setMsg({ ok: true, text: "Link copied." }))} className="h-9 px-3 rounded-[10px] bg-emerald-600 text-white text-[13px] font-semibold">Copy link</button>
          <a href={waText(link.url, link.code)} target="_blank" rel="noopener noreferrer" className="h-9 px-3 inline-flex items-center rounded-[10px] border border-emerald-600 text-[13px] font-semibold text-emerald-700">Share on WhatsApp</a>
          <button onClick={() => { setLink(null); setAdding(false); setF({ email: "", role: "staff", phone: "" }); }} className="h-9 px-3 rounded-[10px] border border-stone-300 text-[13px] font-semibold text-stone-700">Done</button>
        </div>
      </div>}

      {msg && <p role="status" className={`text-sm mb-3 ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>}
      <ul className="divide-y divide-stone-100">{members.map((m) => (
        <li key={m.id} className={`py-3 flex flex-col sm:flex-row sm:items-center gap-3 ${m.active ? "" : "opacity-60"}`}>
          <div className="flex items-center gap-3 flex-1 min-w-0"><Avatar name={m.name} /><div className="min-w-0"><div className="text-sm font-semibold text-stone-800 truncate">{m.name}{m.id === myId ? " (you)" : ""}{!m.active ? " · removed" : ""}</div><div className="text-xs text-stone-500 truncate">{m.email}{m.last_login ? ` · last in ${m.last_login.slice(0, 10)}` : ""}</div></div></div>
          {m.id === myId ? <span className="text-xs font-semibold text-stone-500 capitalize">{m.role}</span> : <div className="flex flex-wrap gap-2 items-center">
            <select aria-label={`Role for ${m.name}`} value={m.role} onChange={(e) => call("PATCH", { user_id: m.id, role: e.target.value }, `${m.name} is now ${e.target.value}.`)} className={`${field} h-9`}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <button onClick={() => call("PATCH", { user_id: m.id, active: !m.active }, m.active ? `${m.name} was removed from ${businessName}.` : `${m.name} is back on the team.`)} className={`h-9 px-3 rounded-[10px] border text-[13px] font-semibold ${m.active ? "border-red-200 text-red-700" : "border-emerald-200 text-emerald-700"}`}>{m.active ? "Remove" : "Restore"}</button>
          </div>}
        </li>
      ))}</ul>
      {invites.length > 0 && <>
        <div className="text-xs font-medium text-stone-500 mt-4 mb-1">Waiting to join</div>
        <ul className="divide-y divide-stone-100">{invites.map((i) => (
          <li key={i.id} className="py-2.5 flex items-center justify-between gap-3 text-sm"><span className="min-w-0 truncate"><b className="text-stone-800">{i.email}</b> <span className="text-stone-500">· {i.role} · expires {i.expires_at.slice(0, 10)}</span></span>
            <button onClick={() => call("DELETE", null, `Invite for ${i.email} cancelled.`, `/api/team?invite_id=${encodeURIComponent(i.id)}`)} className="text-[13px] font-semibold text-red-700 hover:underline">Cancel invite</button></li>
        ))}</ul>
      </>}
    </div>
  );
}
