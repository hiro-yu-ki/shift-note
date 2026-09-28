import { useEffect, useState } from "react";
import { api, dateLabel, hm, mins, yen, type MyWork } from "./types";

const localTime = (value: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export function WorkHub({ view }: { view: "work" | "attendance" }) {
  const [data, setData] = useState<MyWork | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, select] = useState("");
  const [kind, setKind] = useState("休み希望");
  const [reason, setReason] = useState("");
  const [offer, setOffer] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = async () => setData(await api<MyWork>("/employee/my-work"));
  useEffect(() => {
    void reload().catch((e) => setError(e.message));
  }, [view]);

  if (!data) return error ? <p className="error" role="alert">{error}</p> : <p>勤務情報を読み込んでいます…</p>;
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const upcoming = data.assignments.filter((a) => a.date >= today);
  const older = data.assignments.filter((a) => a.date < today);
  const role = (id: string) => data.roles.find((r) => r.id === id)?.name || "担当";

  if (view === "attendance")
    return (
      <div className="work-hub">
        {error && <p className="error" role="alert">{error}</p>}
        <p className="employee-instruction">打刻した実際の勤務を表示します。休憩は管理者が実績を確認するまで給与から引きません。</p>
        <div className="pay-overview">
          <section><p>打刻済みの勤務</p><strong>{data.pay.actual_hours}<small> 時間</small></strong><small>{data.pay.actual_days}日間</small></section>
          <section><p>実績の給与概算 <span>控除前</span></p><strong>{data.pay.actual_total === null ? "時給未登録" : yen(data.pay.actual_total)}</strong><small>支払予定 {data.pay.payday}</small></section>
          <section><p>今後の確定シフトを含む予測</p><strong>{data.pay.forecast_total === null ? "時給未登録" : yen(data.pay.forecast_total)}</strong><small>{data.pay.start} — {data.pay.end}</small></section>
        </div>
        <p className="muted">登録時給による概算です。交通費は打刻日ごとに加算します。割増賃金、税・保険・控除、未打刻の過去勤務は含みません。</p>
        {data.pay.unreviewed_breaks > 0 && <p className="notice">休憩の確認が必要な勤務が{data.pay.unreviewed_breaks}件あります。管理者に実際の休憩時間を伝えてください。</p>}
        <h2>打刻の記録</h2>
        {!data.attendance.length ? <p className="inline-empty">まだ打刻の記録はありません。</p> : (
          <div className="work-rows">
            {data.attendance.slice(0, 40).map((r) => (
              <div className="work-row" key={r.id}>
                <div><strong>{dateLabel(r.date)}</strong><small>{localTime(r.clock_in)} 出勤 → {r.clock_out ? `${localTime(r.clock_out)} 退勤` : "勤務中"}</small></div>
                <div><strong>{r.clock_out ? `${r.paid_hours}時間` : "勤務中"}</strong><small>休憩 {r.break_minutes}分{r.needs_review ? " · 要確認" : ""}</small></div>
                <div><strong>{r.gross === null ? "—" : yen(r.gross)}</strong><small>時給分・控除前</small></div>
              </div>
            ))}
          </div>
        )}
        <p className="muted">打刻漏れや時間が違う場合は管理者に修正を依頼してください。修正内容は管理画面に記録されます。</p>
      </div>
    );

  return (
    <div className="work-hub">
      <p className="employee-instruction">確定した勤務日をすべてまとめています。変更したい日は「変更を相談」から理由と、対応できる時間を伝えてください。</p>
      <h2>これからの勤務 <small>{upcoming.length}件</small></h2>
      {!upcoming.length ? <p className="inline-empty">これからの確定勤務はありません。</p> : (
        <div className="work-rows">
          {upcoming.map((a) => (
            <div className="work-row" key={a.id}>
              <div><strong>{dateLabel(a.date)}</strong><small>{role(a.role)}</small></div>
              <div><strong>{hm(a.start)}–{hm(a.end)}</strong><small>休憩予定 {(a.breaks || []).reduce((n, b) => n + b.end - b.start, 0)}分</small></div>
              <button className="text-button" onClick={() => { select(a.id); setKind("休み希望"); setReason(""); setOffer(false); setStart(""); setEnd(""); }}>変更を相談</button>
            </div>
          ))}
        </div>
      )}
      {selected && (
        <form className="change-form" onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true); setError(""); setNotice("");
          try {
            await api("/employee/change-requests", "POST", {
              assignment: selected, kind, reason,
              proposed_start: offer ? mins(start) : null,
              proposed_end: offer ? mins(end) : null,
            });
            select(""); setNotice("変更の相談を送信しました。管理者の回答を下で確認できます。");
            await reload();
          } catch (ex) { setError((ex as Error).message); }
          finally { setBusy(false); }
        }}>
          <h3>{dateLabel(data.assignments.find((a) => a.id === selected)!.date)} の変更を相談</h3>
          <label>相談内容<select value={kind} onChange={(e) => { setKind(e.target.value); if (e.target.value === "時間変更") setOffer(true); }}><option>休み希望</option><option>時間変更</option><option>相談</option></select></label>
          <label>理由<textarea required minLength={5} maxLength={1000} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例：通院のため出勤が難しいです" /></label>
          <label className="check-line"><input type="checkbox" checked={offer} onChange={(e) => setOffer(e.target.checked || kind === "時間変更")} />時間を変えれば勤務できる</label>
          {offer && <div className="change-times"><label>開始<input type="time" required value={start} onChange={(e) => setStart(e.target.value)} /></label><label>終了<input type="time" required value={end} onChange={(e) => setEnd(e.target.value)} /></label></div>}
          <p className="muted">申請しただけでは確定シフトは変わりません。管理者が調整・再確定します。</p>
          <div className="change-actions"><button className="primary" disabled={busy}>{busy ? "送信中…" : "相談を送信"}</button><button type="button" onClick={() => select("")}>閉じる</button></div>
        </form>
      )}
      {notice && <p role="status" className="notice">{notice}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      <h2>相談の状況</h2>
      {!data.requests.length ? <p className="inline-empty">変更の相談はありません。</p> : (
        <div className="work-rows">{data.requests.map((r) => <div className="work-row request-row" key={r.id}><div><strong>{dateLabel(r.date)} · {r.kind}</strong><small>{r.reason}</small>{r.proposed_start !== null && <small>勤務できる時間 {hm(r.proposed_start)}–{hm(r.proposed_end!)}</small>}</div><div><strong>{r.status}</strong><small>{r.manager_note || "管理者の確認をお待ちください"}</small></div></div>)}</div>
      )}
      {older.length > 0 && <details className="pay-basis"><summary>過去の確定勤務 {older.length}件</summary>{older.slice(-40).reverse().map((a) => <p key={a.id}>{dateLabel(a.date)}　{hm(a.start)}–{hm(a.end)}　{role(a.role)}</p>)}</details>}
    </div>
  );
}
