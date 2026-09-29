import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { CalendarDays, ArrowRight } from "lucide-react";
import { api, appUrl } from "./types";
import { Field } from "./ui";

type Status = {
  configured: boolean;
  authenticated: boolean;
  setup_token_required: boolean;
  email_setup_required: boolean;
  email_login_required: boolean;
  email_ready: boolean;
};

export function ManagerAccess({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [setupKey, setSetupKey] = useState("");
  const [linkToken, setLinkToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("setup") || "");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const acceptLink = () => {
      const token = new URLSearchParams(window.location.hash.slice(1)).get("setup");
      if (token) {
        setLinkToken(token);
        setNotice("");
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    };
    acceptLink();
    window.addEventListener("hashchange", acceptLink);
    api<Status>("/auth/status").then(setStatus).catch((e) => setError(e.message));
    return () => window.removeEventListener("hashchange", acceptLink);
  }, []);

  if (status?.authenticated) return children;
  const emailSetup = !!status?.email_setup_required;
  const completing = emailSetup && !!linkToken;
  const title = status?.configured ? "ログイン" : completing ? "管理者パスワードを設定" : emailSetup ? "管理者のメールを確認" : "管理画面の保護を設定";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!status) return;
    if (!status.configured && (!emailSetup || completing) && password !== confirm) {
      setError("パスワードが一致しません");
      return;
    }
    setBusy(true);
    try {
      if (status.configured) {
        await api("/auth/login", "POST", { email, password });
        setStatus({ ...status, authenticated: true });
      } else if (completing) {
        await api("/auth/setup-complete", "POST", { token: linkToken, password });
        setLinkToken("");
        setStatus({ ...status, configured: true, authenticated: true });
      } else if (emailSetup) {
        const result = await api<{ message: string }>("/auth/setup-request", "POST", { email, setup_token: setupKey });
        setNotice(result.message);
        setSetupKey("");
      } else {
        await api("/auth/setup", "POST", { password, setup_token: setupKey });
        setStatus({ ...status, configured: true, authenticated: true });
      }
      setPassword("");
      setConfirm("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return <main className="access-page">
    <div className="employee-logo"><CalendarDays size={24} />シフトノート</div>
    <p className="section-kicker">管理者用</p>
    <h1>{title}</h1>
    <p className="muted">{emailSetup
      ? completing ? "メールに届いたリンクからパスワードを登録してください。このリンクは一度だけ使えます。" : "初回設定キーとメールアドレスを入力します。届いたリンクからパスワードを登録してください。"
      : "スタッフの契約・給与情報を保護する管理者専用の画面です。"}</p>
    {status && <form onSubmit={submit}>
      {((status.configured && status.email_login_required) || (emailSetup && !completing)) && <Field label="管理者メールアドレス"><input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>}
      {(status.configured || completing || !emailSetup) && <Field label="管理者パスワード"><input required minLength={10} maxLength={128} type="password" autoComplete={status.configured ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>}
      {!status.configured && (completing || !emailSetup) && <Field label="パスワードをもう一度"><input required minLength={10} maxLength={128} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>}
      {!status.configured && !completing && (emailSetup || status.setup_token_required) && <Field label="初回設定キー"><input type="password" autoComplete="off" required value={setupKey} onChange={(e) => setSetupKey(e.target.value)} /></Field>}
      {emailSetup && !status.email_ready && !completing && <p className="error" role="alert">メール送信の設定が必要です。運営者にお問い合わせください。</p>}
      {(!emailSetup || completing || status.configured) && <p className="muted">パスワードは10文字以上</p>}
      <button className="primary" disabled={busy || (emailSetup && !status.email_ready && !completing)}>{status.configured ? "ログイン" : completing ? "パスワードを設定" : emailSetup ? "設定リンクを送る" : "パスワードを設定"}<ArrowRight size={16} /></button>
    </form>}
    {completing && <button type="button" onClick={() => { setLinkToken(""); setError(""); }}>リンクが使えない場合は初回設定からやり直す</button>}
    {notice && <p role="status" className="notice">{notice}</p>}
    {error && <p role="alert" className="error">{error}</p>}
    <p><a href={appUrl("/employee")}>従業員の方はこちら</a> · <a href={appUrl("/help/manager.html")}>利用手順</a></p>
  </main>;
}
