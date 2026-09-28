import { useEffect, useState } from "react";
import { api, appUrl, dateLabel, hm, yen, type ActualPay, type AttendanceRecord, type ShiftChangeRequest } from "./types";

type Overview = {
  date: string;
  kiosk_ready: boolean;
  requests: (ShiftChangeRequest & { name: string })[];
  attendance: (AttendanceRecord & { name: string })[];
  pay: { actual_total: number; forecast_total: number; unpriced: number; rows: ActualPay[]; basis: string };
};
const localInput = (iso: string) => {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return parts.replace(" ", "T");
};
const toIso = (value: string) => new Date(`${value}:00+09:00`).toISOString();

export function Operations() {
  const [data, setData] = useState<Overview | null>(null);
  const [devices, setDevices] = useState<{ id: string; label: string; created_at: string; last_seen: string }[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [link, setLink] = useState("");
  const [editing, setEditing] = useState<AttendanceRecord | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [breakMinutes, setBreakMinutes] = useState(0);
  const [breakConfirmed, setBreakConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const reload = async () => {
    const [overview, registered] = await Promise.all([
      api<Overview>("/operations/overview"),
      api<typeof devices>("/operations/kiosk-devices"),
    ]);
    setData(overview); setDevices(registered);
  };
  useEffect(() => { void reload().catch((e) => setError(e.message)); }, []);
  const run = async (action: () => Promise<void>) => {
    setError(""); setNotice("");
    try { await action(); await reload(); }
    catch (e) { setError((e as Error).message); }
  };
  const edit = (row: AttendanceRecord) => {
    setEditing(row); setStart(localInput(row.clock_in)); setEnd(row.clock_out ? localInput(row.clock_out) : "");
    setBreakMinutes(row.break_minutes); setBreakConfirmed(row.break_confirmed); setReason("");
  };
  return <div className="operations">
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    <section className="operations-section">
      <h2>店舗の打刻画面</h2>
      <p>店舗の端末を最初に一度だけ登録します。その後は固定URLを開くだけで、毎日の出勤者が自動で切り替わります。</p>
      <p><a href={appUrl("/clock")} target="_blank" rel="noreferrer">固定の打刻画面を開く ↗</a> <span className="muted">{location.origin}{appUrl("/clock")}</span></p>
      <button onClick={() => void run(async () => {
        const result = await api<{ token: string }>("/operations/kiosk-token", "POST");
        setLink(`${location.origin}${appUrl("/clock")}#token=${encodeURIComponent(result.token)}`);
        setNotice("端末登録リンクを作成しました。打刻用の端末で一度だけ開いてください");
      })}>端末登録リンクを作る</button>
      {link && <div className="kiosk-link"><a href={link} target="_blank" rel="noreferrer">この端末を登録 ↗</a><button onClick={() => void navigator.clipboard.writeText(link).then(() => setNotice("登録リンクをコピーしました"))}>登録リンクをコピー</button></div>}
      {link && <p className="muted">このリンクは端末を1台登録すると無効になります。登録済み端末は影響を受けません。</p>}
      <h3>登録済み端末</h3>
      {!devices.length ? <p className="inline-empty">登録済みの端末はありません。</p> : <div className="work-rows">{devices.map((device) => <div className="work-row" key={device.id}><div><strong>{device.label}</strong><small>最終利用 {new Date(device.last_seen).toLocaleString("ja-JP")}</small></div><div /><button onClick={() => void run(async () => { await api(`/operations/kiosk-devices/${device.id}`, "DELETE"); setNotice("端末の登録を解除しました"); })}>利用停止</button></div>)}</div>}
    </section>
    <section className="operations-section">
      <h2>勤務変更の相談 <small>{data?.requests.filter((r) => r.status === "未確認").length || 0}件未確認</small></h2>
      {!data?.requests.length ? <p className="inline-empty">申請はありません。</p> : <div className="work-rows">{data.requests.map((r) => <div className="work-row operations-request" key={r.id}>
        <div><strong>{dateLabel(r.date)}　{r.name}</strong><small>{hm(r.start)}–{hm(r.end)}　{r.kind}</small><p>{r.reason}</p>{r.proposed_start !== null && <small>勤務できる時間：{hm(r.proposed_start)}–{hm(r.proposed_end!)}</small>}</div>
        <div><strong>{r.status}</strong>{r.manager_note && <small>{r.manager_note}</small>}
          <form onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const values = new FormData(form); void run(async () => { await api(`/operations/change-requests/${r.id}`, "PUT", { status: values.get("status"), note: values.get("note") }); setNotice("回答を保存しました。シフト変更は別途、シフト案で行ってください"); }); }}>
            <select name="status" defaultValue={r.status} aria-label={`${r.name}さんへの対応`}><option>未確認</option><option>確認中</option><option>確認済み</option><option>見送り</option></select>
            <input name="note" defaultValue={r.manager_note} placeholder="本人への回答・調整内容" aria-label="回答" />
            <button>保存</button>
          </form>
        </div>
      </div>)}</div>}
      <p className="muted">回答を保存しても確定シフトは変わりません。調整後はシフト案を編集して再確定してください。</p>
    </section>
    <section className="operations-section">
      <h2>人件費と勤務実績</h2>
      {data && <><div className="pay-overview"><section><p>打刻済みの概算</p><strong>{yen(data.pay.actual_total)}</strong></section><section><p>今後の確定シフトを含む見込み</p><strong>{yen(data.pay.forecast_total)}</strong></section><section><p>時給未登録</p><strong>{data.pay.unpriced}人</strong></section></div><p className="muted">{data.pay.basis}</p>
        <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>従業員</th><th>実績時間</th><th>実績概算</th><th>今後を含む見込み</th></tr></thead><tbody>{data.pay.rows.map((row) => <tr key={row.staff}><td>{row.name}</td><td>{row.actual_hours}時間</td><td>{row.actual_total === null ? "時給未登録" : yen(row.actual_total)}</td><td>{row.forecast_total === null ? "時給未登録" : yen(row.forecast_total)}</td></tr>)}</tbody></table></div></>}
    </section>
    <section className="operations-section">
      <h2>打刻の確認・修正</h2>
      <p className="muted">休憩は自動で差し引きません。実際に取得した時間を確認して登録してください。</p>
      {!data?.attendance.length ? <p className="inline-empty">打刻はありません。</p> : <div className="work-rows">{data.attendance.slice(0, 80).map((row) => <div className="work-row" key={row.id}><div><strong>{dateLabel(row.date)}　{row.name}</strong><small>{localInput(row.clock_in).slice(11)} 出勤 → {row.clock_out ? `${localInput(row.clock_out).slice(11)} 退勤` : "勤務中"}</small></div><div><strong>{row.clock_out ? `${row.paid_hours}時間` : "勤務中"}</strong><small>休憩 {row.break_minutes}分{row.needs_review ? " ・ 要確認" : ""}</small></div><button onClick={() => edit(row)}>修正</button></div>)}</div>}
    </section>
    {editing && <div className="ops-edit-backdrop"><form className="ops-edit" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`/operations/attendance/${editing.id}`, "PUT", { clock_in: toIso(start), clock_out: toIso(end), break_minutes: breakMinutes, break_confirmed: breakConfirmed, reason }); setEditing(null); setNotice("打刻を修正しました"); }); }}>
      <h2>打刻を修正</h2><p>{dateLabel(editing.date)}</p>
      <label>出勤時刻<input type="datetime-local" required value={start} onChange={(e) => setStart(e.target.value)} /></label>
      <label>退勤時刻<input type="datetime-local" required value={end} onChange={(e) => setEnd(e.target.value)} /></label>
      <label>実際の休憩（分）<input type="number" min="0" max="720" required value={breakMinutes} onChange={(e) => setBreakMinutes(Number(e.target.value))} /></label>
      <label className="check-line"><input type="checkbox" checked={breakConfirmed} onChange={(e) => setBreakConfirmed(e.target.checked)} />休憩時間を確認した</label>
      <label>修正理由<textarea required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <div className="change-actions"><button className="primary">保存</button><button type="button" onClick={() => setEditing(null)}>閉じる</button></div>
    </form></div>}
  </div>;
}
