import { useEffect, useState, type FormEvent } from "react";
import { Building2, FileText, LayoutDashboard, Settings, Plus, Download } from "lucide-react";
import { yen } from "./types";

type Merchant = {
  id: string; slug: string; name: string; legal_name: string; contact_name: string;
  contact_email: string; contact_phone: string; billing_address: string;
  status: string; plan_name: string; monthly_fee: number; tax_rate: number;
  billing_due_days: number; contract_start: string; contract_end: string;
  suite_origin: string; deployment_status: string; notes: string;
};
type Invoice = {
  id: number; merchant_id: string; service_month: string; number: string | null;
  status: string; record_status: string; description: string; issue_date: string;
  due_date: string; seller_name: string; seller_registration: string;
  seller_address: string; payment_instructions: string; buyer_name: string; buyer_address: string;
  subtotal: number; tax_rate: number; tax: number; total: number; paid: number; balance: number;
  payments?: { id: number; amount: number; paid_on: string; reference: string; reversed_at: string; reversal_reason: string }[];
};
type Dashboard = {
  merchants: number; active: number; trial: number; unprovisioned: number;
  mrr: number; outstanding: number; overdue: number;
  recent_activity: { kind: string; subject: string; detail: string; created_at: string }[];
};
type Seller = { seller_name: string; seller_address: string; registration_number: string; payment_instructions: string };
type Auth = { configured: boolean; authenticated: boolean; setup_token_required: boolean };

async function papi<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch("/api/platform" + path, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.errors?.map((e: { message: string }) => e.message).join(" / ") || data.detail || (response.status >= 500 ? "サーバーに接続できません。少し待ってから再試行してください" : "処理に失敗しました"));
  return data as T;
}

const blank: Merchant = {
  id: "", slug: "", name: "", legal_name: "", contact_name: "", contact_email: "",
  contact_phone: "", billing_address: "", status: "準備中", plan_name: "標準",
  monthly_fee: 0, tax_rate: 10, billing_due_days: 30, contract_start: "",
  contract_end: "", suite_origin: "", deployment_status: "未設置", notes: "",
};

export default function Platform() {
  const [auth, setAuth] = useState<Auth | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [view, setView] = useState<"overview" | "merchants" | "invoices" | "settings">("overview");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [seller, setSeller] = useState<Seller>({ seller_name: "", seller_address: "", registration_number: "", payment_instructions: "" });
  const [editing, setEditing] = useState<Merchant | null>(null);
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [billMerchant, setBillMerchant] = useState("");
  const [billMonth, setBillMonth] = useState(new Date().toISOString().slice(0, 7));
  const [registration, setRegistration] = useState<{ manager_setup_token: string; manager: string; employee: string; attendance: string } | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [payment, setPayment] = useState(0);
  const [paymentOn, setPaymentOn] = useState(new Date().toISOString().slice(0, 10));
  const [paymentRef, setPaymentRef] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const [d, m, i, s] = await Promise.all([
      papi<Dashboard>("/dashboard"), papi<Merchant[]>("/merchants"),
      papi<Invoice[]>("/invoices"), papi<Seller>("/billing-settings"),
    ]);
    setDashboard(d); setMerchants(m); setInvoices(i); setSeller(s);
  };
  useEffect(() => { void papi<Auth>("/auth/status").then(async (a) => { setAuth(a); if (a.authenticated) await reload(); }).catch((e) => setError(e.message)); }, []);
  const run = async (action: () => Promise<void>) => {
    setError(""); setNotice(""); setBusy(true);
    try { await action(); await reload(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const login = (event: FormEvent) => {
    event.preventDefault();
    if (!auth) return;
    if (!auth.configured && password !== confirm) { setError("パスワードが一致しません"); return; }
    void run(async () => {
      await papi("/auth/" + (auth.configured ? "login" : "setup"), "POST", { password, setup_token: setupToken });
      setPassword(""); setSetupToken(""); setAuth({ configured: true, authenticated: true, setup_token_required: auth.setup_token_required });
    });
  };
  if (!auth?.authenticated) return <main className="access-page platform-login">
    <p className="section-kicker">SHIFT NOTE / OPERATOR</p>
    <h1>加盟店管理</h1>
    <p>加盟店の提供状況と請求を管理します。店舗のシフト・従業員データは加盟店ごとの専用DBに保存します。</p>
    {auth && <form onSubmit={login}>
      <label>運営者パスワード<input type="password" required minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      {!auth.configured && <><label>パスワードをもう一度<input type="password" required minLength={12} value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
        {auth.setup_token_required && <label>運営者用初回設定キー<input type="password" required value={setupToken} onChange={(e) => setSetupToken(e.target.value)} /></label>}</>}
      <button className="primary" disabled={busy}>{auth.configured ? "ログイン" : "運営者アカウントを作成"}</button>
    </form>}
    {error && <p className="error" role="alert">{error}</p>}
  </main>;

  const current = merchants.find((m) => m.id === selected);
  const shown = merchants.filter((m) => [m.name, m.slug, m.contact_name, m.contact_email].some((v) => v.toLowerCase().includes(query.toLowerCase())));
  const nav = [
    ["overview", "概要", LayoutDashboard], ["merchants", "加盟店", Building2],
    ["invoices", "請求・入金", FileText], ["settings", "請求元設定", Settings],
  ] as const;
  return <div className="platform-shell">
    <aside className="platform-sidebar">
      <div className="platform-brand">シフトノート <small>運営者</small></div>
      <nav>{nav.map(([id, label, Icon]) => <button key={id} className={view === id ? "active" : ""} onClick={() => { setView(id); setError(""); }}><Icon size={18} />{label}</button>)}</nav>
      <button className="platform-logout" onClick={() => void papi("/auth/logout", "POST").then(() => { setAuth({ ...auth, authenticated: false }); setDashboard(null); })}>ログアウト</button>
    </aside>
    <main className="platform-main">
      <header className="platform-top"><div><p className="section-kicker">SHIFT NOTE / OPERATOR</p><h1>{nav.find(([id]) => id === view)?.[1]}</h1></div><span>{new Date().toLocaleDateString("ja-JP")}</span></header>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {view === "overview" && <>
        <div className="platform-metrics">
          <div><span>利用中</span><strong>{dashboard?.active ?? "—"}</strong><small>加盟店</small></div>
          <div><span>月額契約額（税抜）</span><strong>{dashboard ? yen(dashboard.mrr) : "—"}</strong></div>
          <div><span>未収金</span><strong>{dashboard ? yen(dashboard.outstanding) : "—"}</strong></div>
          <div><span>期限超過</span><strong>{dashboard ? yen(dashboard.overdue) : "—"}</strong></div>
        </div>
        <section className="platform-section"><h2>対応が必要な項目</h2><div className="platform-todo"><button onClick={() => setView("merchants")}>専用環境が未設置 <strong>{dashboard?.unprovisioned || 0}件</strong></button><button onClick={() => setView("invoices")}>請求の未収額 <strong>{dashboard ? yen(dashboard.outstanding) : "—"}</strong></button></div></section>
        <section className="platform-section"><h2>最近の操作</h2>{!dashboard?.recent_activity.length ? <p className="inline-empty">まだ操作履歴はありません。</p> : <div className="work-rows">{dashboard.recent_activity.map((a, index) => <div className="platform-activity" key={index}><strong>{a.kind}</strong><span>{a.detail}</span><small>{new Date(a.created_at).toLocaleString("ja-JP")}</small></div>)}</div>}</section>
      </>}
      {view === "merchants" && <>
        <div className="platform-toolbar"><input aria-label="加盟店を検索" placeholder="加盟店名・担当者・メールで検索" value={query} onChange={(e) => setQuery(e.target.value)} /><a className="text-button" href="/api/platform/merchants.csv" download><Download size={15} />CSV</a><button className="primary" onClick={() => setEditing({ ...blank })}><Plus size={16} />加盟店を登録</button></div>
        {!shown.length ? <p className="inline-empty">加盟店はまだありません。</p> : <div className="platform-merchant-list">{shown.map((m) => <button key={m.id} className={selected === m.id ? "active" : ""} onClick={() => { setSelected(m.id); setRegistration(null); }}><span><strong>{m.name}</strong><small>{m.slug}</small></span><span>{m.status}</span><span>{m.deployment_status}</span><span>{yen(m.monthly_fee)} / 月</span></button>)}</div>}
        {current && <section className="platform-merchant-detail">
          <div className="spread"><div><p className="section-kicker">加盟店の詳細</p><h2>{current.name}</h2></div><button onClick={() => setEditing({ ...current })}>契約・連絡先を編集</button></div>
          <dl><dt>契約名義</dt><dd>{current.legal_name}</dd><dt>担当者</dt><dd>{current.contact_name || "未登録"}</dd><dt>連絡先</dt><dd>{current.contact_email || "未登録"}　{current.contact_phone}</dd><dt>プラン</dt><dd>{current.plan_name} · {yen(current.monthly_fee)} / 月（税抜）</dd><dt>請求先</dt><dd>{current.billing_address || "未登録"}</dd></dl>
          {current.deployment_status !== "稼働中" ? <div className="platform-provision"><p>この加盟店専用のデータベースと3つの画面を作成します。作成後、管理者の初回設定キーが一度だけ表示されます。</p><button className="primary" disabled={busy} onClick={() => void run(async () => { const r = await papi<typeof registration & { manager_setup_token: string }>(`/merchants/${current.id}/provision`, "POST"); setRegistration(r); setNotice("専用環境を作成しました。初回設定キーを安全に加盟店へ渡してください"); })}>専用環境を作成</button></div> : <div className="platform-distribution"><h3>加盟店への配布URL</h3><p>各画面はこの加盟店だけのデータを使用します。</p><a href={current.suite_origin + "/admin"} target="_blank" rel="noreferrer">管理画面 ↗</a><a href={current.suite_origin + "/employee"} target="_blank" rel="noreferrer">従業員画面 ↗</a><a href={current.suite_origin + "/clock"} target="_blank" rel="noreferrer">勤怠画面 ↗</a></div>}
          {registration && <div className="platform-setup-key"><h3>管理者の初回設定キー</h3><p>この表示を閉じると再表示できません。加盟店の管理担当者へ安全な方法で伝えてください。</p><code>{registration.manager_setup_token}</code><button onClick={() => void navigator.clipboard.writeText(registration.manager_setup_token).then(() => setNotice("初回設定キーをコピーしました"))}>コピー</button><button onClick={() => setRegistration(null)}>表示を閉じる</button></div>}
          {current.deployment_status === "稼働中" && <div className="platform-reset"><h3>管理者のログインを再設定</h3><p>管理者がパスワードを失った場合に使います。現在の管理者ログインをすべて無効にし、新しい初回設定キーを表示します。</p><button onClick={() => { if (window.confirm(`${current.name} の管理者ログインを無効にして再設定しますか？`)) void run(async () => { const r = await papi<{ manager_setup_token: string; manager: string }>(`/merchants/${current.id}/reset-manager`, "POST"); setRegistration({ ...r, employee: current.suite_origin + "/employee", attendance: current.suite_origin + "/clock" }); setNotice("管理者ログインを再設定しました。新しい初回設定キーを渡してください"); }); }}>管理者ログインを再設定</button></div>}
          {current.notes && <p className="muted">メモ：{current.notes}</p>}
        </section>}
      </>}
      {view === "invoices" && <>
        <section className="platform-section"><h2>月額請求を作成</h2><p>加盟店の契約料金を対象月の下書きに取り込みます。内容を確認してから発行してください。メール送信と決済は行いません。</p>
          <form className="platform-bill-form" onSubmit={(e) => { e.preventDefault(); void run(async () => { await papi("/invoices/draft", "POST", { merchant_id: billMerchant, service_month: billMonth }); setNotice("請求書の下書きを作成しました"); }); }}>
            <label>加盟店<select aria-label="加盟店" required value={billMerchant} onChange={(e) => setBillMerchant(e.target.value)}><option value="">選択してください</option>{merchants.filter((m) => ["利用中", "試用中"].includes(m.status)).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
            <label>対象月<input type="month" required value={billMonth} onChange={(e) => setBillMonth(e.target.value)} /></label><button className="primary" disabled={busy}>下書きを作成</button>
          </form>
        </section>
        <section className="platform-section"><h2>請求書一覧</h2>{!invoices.length ? <p className="inline-empty">まだ請求書はありません。</p> : <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>番号</th><th>加盟店</th><th>対象月</th><th>支払期限</th><th>請求額</th><th>未収</th><th>状態</th><th /></tr></thead><tbody>{invoices.map((i) => <tr key={i.id}><td>{i.number || "下書き"}</td><td>{merchants.find((m) => m.id === i.merchant_id)?.name || i.buyer_name}</td><td>{i.service_month}</td><td>{i.due_date}</td><td>{yen(i.total)}</td><td>{yen(i.balance)}</td><td>{i.status}</td><td><button className="text-button" onClick={() => void papi<Invoice>(`/invoices/${i.id}`).then((detail) => { setSelectedInvoice(detail); setPayment(detail.balance); }).catch((e) => setError(e.message))}>確認</button></td></tr>)}</tbody></table></div>}</section>
      </>}
      {view === "settings" && <><section className="platform-section"><h2>請求元情報</h2><p>請求書の下書きを作る時点の情報を保存します。発行済みの請求書は変更されません。</p><form className="platform-settings" onSubmit={(e) => { e.preventDefault(); void run(async () => { await papi("/billing-settings", "PUT", seller); setNotice("請求元情報を保存しました"); }); }}><label>請求元の名称<input required value={seller.seller_name} onChange={(e) => setSeller({ ...seller, seller_name: e.target.value })} /></label><label>住所<textarea value={seller.seller_address} onChange={(e) => setSeller({ ...seller, seller_address: e.target.value })} /></label><label>適格請求書発行事業者の登録番号（ある場合）<input value={seller.registration_number} placeholder="Tと13桁の数字" onChange={(e) => setSeller({ ...seller, registration_number: e.target.value })} /></label><label>お支払い方法・振込先<textarea value={seller.payment_instructions} onChange={(e) => setSeller({ ...seller, payment_instructions: e.target.value })} placeholder="例：〇〇銀行 〇〇支店 普通 1234567 口座名義" /></label><button className="primary" disabled={busy}>保存</button></form></section><section className="platform-section"><h2>運営者パスワード</h2><p>変更すると他の端末のログインは無効になります。</p><form className="platform-settings" onSubmit={(e) => { e.preventDefault(); void run(async () => { await papi("/auth/change-password", "POST", { current_password: currentPassword, new_password: newPassword }); setCurrentPassword(""); setNewPassword(""); setNotice("パスワードを変更しました"); }); }}><label>現在のパスワード<input type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} /></label><label>新しいパスワード（12文字以上）<input type="password" required minLength={12} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></label><button disabled={busy}>パスワードを変更</button></form></section></>}
    </main>
    {editing && <div className="ops-edit-backdrop"><form className="platform-editor" onSubmit={(e) => { e.preventDefault(); void run(async () => { await papi(editing.id ? `/merchants/${editing.id}` : "/merchants", editing.id ? "PUT" : "POST", editing); setEditing(null); setNotice("加盟店を保存しました"); }); }}>
      <div className="spread"><h2>{editing.id ? "加盟店を編集" : "加盟店を登録"}</h2><button type="button" onClick={() => setEditing(null)}>閉じる</button></div>
      <div className="platform-fields"><label>加盟店ID（URLに使用）<input required disabled={!!editing.id} pattern="[a-z][a-z0-9-]{2,30}" value={editing.slug} onChange={(e) => setEditing({ ...editing, slug: e.target.value.toLowerCase() })} /></label><label>表示名<input required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label><label>契約名義<input required value={editing.legal_name} onChange={(e) => setEditing({ ...editing, legal_name: e.target.value })} /></label><label>担当者<input value={editing.contact_name} onChange={(e) => setEditing({ ...editing, contact_name: e.target.value })} /></label><label>連絡先メール<input type="email" value={editing.contact_email} onChange={(e) => setEditing({ ...editing, contact_email: e.target.value })} /></label><label>電話<input value={editing.contact_phone} onChange={(e) => setEditing({ ...editing, contact_phone: e.target.value })} /></label><label>請求先住所<textarea value={editing.billing_address} onChange={(e) => setEditing({ ...editing, billing_address: e.target.value })} /></label><label>利用状態<select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>{["準備中", "試用中", "利用中", "停止中", "解約"].map((s) => <option key={s}>{s}</option>)}</select></label><label>プラン名<input value={editing.plan_name} onChange={(e) => setEditing({ ...editing, plan_name: e.target.value })} /></label><label>月額料金（税抜・円）<input type="number" min="0" required value={editing.monthly_fee} onChange={(e) => setEditing({ ...editing, monthly_fee: Number(e.target.value) })} /></label><label>消費税率（%）<input type="number" min="0" max="100" required value={editing.tax_rate} onChange={(e) => setEditing({ ...editing, tax_rate: Number(e.target.value) })} /></label><label>支払期限（日数）<input type="number" min="1" max="180" required value={editing.billing_due_days} onChange={(e) => setEditing({ ...editing, billing_due_days: Number(e.target.value) })} /></label><label>契約開始<input type="date" value={editing.contract_start} onChange={(e) => setEditing({ ...editing, contract_start: e.target.value })} /></label><label>契約終了<input type="date" value={editing.contract_end} onChange={(e) => setEditing({ ...editing, contract_end: e.target.value })} /></label><label className="wide">内部メモ<textarea value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></label></div><button className="primary" disabled={busy}>保存</button>
    </form></div>}
    {selectedInvoice && <div className="ops-edit-backdrop"><div className="platform-invoice-detail"><div className="spread"><h2>請求書 {selectedInvoice.number || "下書き"}</h2><button onClick={() => setSelectedInvoice(null)}>閉じる</button></div><p>{selectedInvoice.buyer_name} 御中</p><p>{selectedInvoice.description}</p><dl><dt>対象月</dt><dd>{selectedInvoice.service_month}</dd><dt>発行日</dt><dd>{selectedInvoice.issue_date || "未発行"}</dd><dt>支払期限</dt><dd>{selectedInvoice.due_date}</dd><dt>税抜</dt><dd>{yen(selectedInvoice.subtotal)}</dd><dt>消費税 {selectedInvoice.tax_rate}%</dt><dd>{yen(selectedInvoice.tax)}</dd><dt>請求額</dt><dd><strong>{yen(selectedInvoice.total)}</strong></dd><dt>未収</dt><dd>{yen(selectedInvoice.balance)}</dd></dl><p>{selectedInvoice.seller_name}　{selectedInvoice.seller_registration}</p><p>{selectedInvoice.seller_address}</p>
      {selectedInvoice.record_status === "下書き" && <div className="change-actions"><button className="primary" onClick={() => void run(async () => { const i = await papi<Invoice>(`/invoices/${selectedInvoice.id}/issue`, "POST"); setSelectedInvoice(i); setNotice("請求書を発行しました"); })}>内容を確認して発行</button><button onClick={() => void run(async () => { await papi(`/invoices/${selectedInvoice.id}/void`, "POST"); setSelectedInvoice(null); setNotice("下書きを取り消しました"); })}>取り消す</button></div>}
      {selectedInvoice.payment_instructions && <p>お支払い方法：{selectedInvoice.payment_instructions}</p>}
      {selectedInvoice.record_status === "発行済み" && <p><a href={`/api/platform/invoices/${selectedInvoice.id}/print`} target="_blank" rel="noreferrer">請求書を開く・PDF保存 ↗</a></p>}
      {!!selectedInvoice.payments?.length && <div className="platform-payments"><h3>入金履歴</h3>{selectedInvoice.payments.map((p) => <div key={p.id} className="spread"><span>{p.paid_on}　{yen(p.amount)}　{p.reference}{p.reversed_at ? `（訂正済み：${p.reversal_reason}）` : ""}</span>{!p.reversed_at && <button onClick={() => { const reason = window.prompt("入金記録を訂正する理由（5文字以上）"); if (reason && reason.trim().length >= 5) void run(async () => { await papi(`/invoices/${selectedInvoice.id}/payments/${p.id}/reverse`, "POST", { reason }); setSelectedInvoice(await papi<Invoice>(`/invoices/${selectedInvoice.id}`)); setNotice("入金記録を訂正しました"); }); }}>訂正</button>}</div>)}</div>}
      {selectedInvoice.record_status === "発行済み" && selectedInvoice.balance > 0 && <form className="platform-payment" onSubmit={(e) => { e.preventDefault(); void run(async () => { await papi(`/invoices/${selectedInvoice.id}/payments`, "POST", { amount: payment, paid_on: paymentOn, reference: paymentRef }); const i = await papi<Invoice>(`/invoices/${selectedInvoice.id}`); setSelectedInvoice(i); setPayment(i.balance); setPaymentRef(""); setNotice("入金を記録しました"); }); }}><h3>入金を記録</h3><label>入金額<input type="number" min="1" max={selectedInvoice.balance} required value={payment} onChange={(e) => setPayment(Number(e.target.value))} /></label><label>入金日<input type="date" required value={paymentOn} onChange={(e) => setPaymentOn(e.target.value)} /></label><label>振込番号・メモ<input value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} /></label><button className="primary">記録</button></form>}
      {selectedInvoice.record_status === "発行済み" && selectedInvoice.paid === 0 && <button onClick={() => void run(async () => { await papi(`/invoices/${selectedInvoice.id}/void`, "POST"); setSelectedInvoice(null); setNotice("請求書を取り消しました"); })}>発行を取り消す</button>}
    </div></div>}
  </div>;
}
