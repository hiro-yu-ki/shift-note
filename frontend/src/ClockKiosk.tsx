import { useEffect, useRef, useState } from "react";
import { hm } from "./types";

type Today = {
  date: string;
  store: string;
  scheduled: { staff: string; name: string; start: number; end: number }[];
  working: { id: string; staff: string; name: string; clock_in: string }[];
};

async function kiosk<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(`/api/kiosk/${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "通信に失敗しました");
  return data as T;
}

export default function ClockKiosk() {
  const startup = useRef<Promise<void> | null>(null);
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [today, setToday] = useState<Today | null>(null);
  const [now, setNow] = useState(new Date());
  const [selected, setSelected] = useState("");
  const [mode, setMode] = useState<"in" | "out">("in");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = async () => setToday(await kiosk<Today>("today"));
  useEffect(() => {
    if (!startup.current) startup.current = (async () => {
      const token = new URLSearchParams(location.hash.slice(1)).get("token");
      if (token) {
        await kiosk("pair", { token, label: "店舗の打刻端末" });
        history.replaceState(null, "", "/clock");
      }
      await kiosk("status");
      setRegistered(true);
      await refresh();
    })().catch((e) => {
      setRegistered(false);
      if (location.hash) setError((e as Error).message);
    });
  }, []);
  useEffect(() => {
    if (!registered) return;
    const timer = setInterval(() => { setNow(new Date()); void refresh().catch((e) => setError(e.message)); }, 30000);
    return () => clearInterval(timer);
  }, [registered]);
  const submit = async () => {
    if (!selected || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (mode === "in") await kiosk("clock-in", { staff: selected });
      else await kiosk("clock-out", { attendance: selected });
      setNotice(mode === "in" ? "出勤を記録しました" : "退勤を記録しました。休憩時間は管理者が確認します");
      setSelected("");
      await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const people = mode === "in" ? today?.scheduled || [] : today?.working || [];
  return <div className="kiosk-app">
    <header className="kiosk-header"><a href="/">シフトノート</a><span>勤怠</span></header>
    <main className="kiosk-main">
      <p className="section-kicker">{today?.store || "店舗の打刻画面"}</p>
      <h1>出勤・退勤</h1>
      <p className="kiosk-clock">{now.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" })}</p>
      <p className="muted">{now.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric", weekday: "long" })}</p>
      {registered === false && <p className="notice">この端末はまだ登録されていません。管理者画面の「勤怠・変更申請」で端末登録リンクを一度だけ作り、この端末で開いてください。登録後はこの固定URLから使えます。</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {registered && <>
        <nav className="kiosk-tabs" aria-label="打刻の種類">
          <button className={mode === "in" ? "active" : ""} onClick={() => { setMode("in"); setSelected(""); }}>出勤する</button>
          <button className={mode === "out" ? "active" : ""} onClick={() => { setMode("out"); setSelected(""); }}>退勤する</button>
        </nav>
        <h2>{mode === "in" ? "本日の出勤者" : "現在出勤中"}</h2>
        {!today ? <p>読み込んでいます…</p> : people.length === 0 ? <p className="inline-empty">{mode === "in" ? "これから出勤する方はいません" : "現在出勤中の方はいません"}</p> :
          <div className="kiosk-people">{people.map((person) => <button key={mode === "in" ? person.staff : (person as Today["working"][number]).id} className={selected === (mode === "in" ? person.staff : (person as Today["working"][number]).id) ? "selected" : ""} onClick={() => setSelected(mode === "in" ? person.staff : (person as Today["working"][number]).id)}>
            <strong>{person.name}</strong><small>{"start" in person ? `${hm(person.start)}–${hm(person.end)} 予定` : `${new Date(person.clock_in).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" })} 出勤`}</small>
          </button>)}</div>}
        <button className="primary kiosk-submit" disabled={!selected || busy} onClick={submit}>{busy ? "記録中…" : mode === "in" ? "出勤を記録" : "退勤を記録"}</button>
        <p className="muted">名前を選び、ボタンを押してください。記録の修正や休憩時間の確認は管理者が行います。</p>
      </>}
    </main>
  </div>;
}
