import { useEffect, useState, type ReactNode } from "react";
import { CalendarDays, ArrowRight } from "lucide-react";
import { api, appUrl } from "./types";
import { Field } from "./ui";
export function ManagerAccess({ children }: { children: ReactNode }) {
  const [status, S] = useState<{
    configured: boolean;
    authenticated: boolean;
    setup_token_required?: boolean;
  } | null>(null);
  const [password, P] = useState("");
  const [confirm, C] = useState("");
  const [setupToken, ST] = useState("");
  const [error, E] = useState("");
  const [busy, B] = useState(false);
  useEffect(() => {
    api<{ configured: boolean; authenticated: boolean }>("/auth/status")
      .then(S)
      .catch((e) => E(e.message));
  }, []);
  if (status?.authenticated) return children;
  return (
    <main className="access-page">
      <div className="employee-logo">
        <CalendarDays size={24} />
        シフトノート
      </div>
      <p className="section-kicker">管理者用</p>
      <h1>{status?.configured ? "ログイン" : "管理画面の保護を設定"}</h1>
      <p className="muted">
        スタッフの契約・給与情報を保護するため、管理者だけが使うパスワードを設定します。従業員は専用URLからアクセスできます。
      </p>
      {status && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            E("");
            if (!status.configured && password !== confirm) {
              E("パスワードが一致しません");
              return;
            }
            B(true);
            try {
              await api(
                "/auth/" + (status.configured ? "login" : "setup"),
                "POST",
                { password, setup_token: setupToken },
              );
              S({ configured: true, authenticated: true });
            } catch (e) {
              E((e as Error).message);
            } finally {
              B(false);
            }
          }}
        >
          <Field label="管理者パスワード">
            <input
              required
              minLength={10}
              maxLength={128}
              type="password"
              autoComplete={
                status.configured ? "current-password" : "new-password"
              }
              value={password}
              onChange={(e) => P(e.target.value)}
            />
          </Field>
          {!status.configured && (
            <Field label="パスワードをもう一度">
              <input
                required
                minLength={10}
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => C(e.target.value)}
              />
            </Field>
          )}
          {!status.configured && status.setup_token_required && (
            <Field label="初回設定キー">
              <input
                type="password"
                autoComplete="off"
                required
                value={setupToken}
                onChange={(e) => ST(e.target.value)}
              />
            </Field>
          )}
          <p className="muted">10文字以上</p>
          <button className="primary" disabled={busy}>
            {status.configured ? "ログイン" : "パスワードを設定"}
            <ArrowRight size={16} />
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p>
        <a href={appUrl("/employee")}>従業員の方はこちら</a> ·{" "}
        <a href="/help/manager.html">利用手順</a>
      </p>
    </main>
  );
}
