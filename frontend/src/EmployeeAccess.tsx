import { useEffect, useState } from "react";
import { api } from "./types";
import { Field } from "./ui";
import { Employee } from "./Employee";

type Status = {
  authenticated: boolean;
  email_ready: boolean;
  name?: string;
  periods?: { id: string; start: string; end: string; status: string }[];
};

export default function EmployeeAccess() {
  const [status, S] = useState<Status | null>(null);
  const [email, E] = useState("");
  const [ticket, T] = useState("");
  const [code, C] = useState("");
  const [error, Err] = useState("");
  const [notice, N] = useState("");
  const [busy, B] = useState(false);
  const [pid, P] = useState("");
  const refresh = async () => {
    const s = await api<Status>("/employee/status");
    S(s);
    const today = new Date().toLocaleDateString("sv-SE");
    P(
      s.periods?.find((p) => p.start <= today && p.end >= today)?.id ||
        [...(s.periods || [])]
          .sort((a, b) => a.start.localeCompare(b.start))
          .find((p) => p.start > today)?.id ||
        s.periods?.[0]?.id ||
        "",
    );
  };
  useEffect(() => {
    void refresh().catch((e) => Err(e.message));
  }, []);
  if (status?.authenticated)
    return (
      <>
        <div className="employee-session-bar">
          <Field label="対象期間">
            <select value={pid} onChange={(e) => P(e.target.value)}>
              {status.periods?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.start} 〜 {p.end} · {p.status}
                </option>
              ))}
            </select>
          </Field>
          <a href="/help/employee.html" target="_blank" rel="noreferrer">
            使い方
          </a>
          <button
            onClick={async () => {
              try {
                await api("/employee/logout", "POST");
                S(null);
                T("");
                C("");
                await refresh();
              } catch (e) {
                Err((e as Error).message);
              }
            }}
          >
            ログアウト
          </button>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {pid ? (
          <Employee key={pid} periodId={pid} />
        ) : (
          <main className="access-page">
            <h1>{status.name}さん</h1>
            <p>まだ対象期間がありません。管理者の登録をお待ちください。</p>
          </main>
        )}
      </>
    );
  return (
    <main className="access-page">
      <div className="employee-logo">シフトノート</div>
      <p className="section-kicker">従業員用</p>
      <h1>{ticket ? "確認コードを入力" : "シフトを確認する"}</h1>
      <p className="muted">
        管理者に登録してもらったメールアドレスでログインします。自分の希望と確定シフトを確認できます。
      </p>
      {status && !status.email_ready && (
        <p role="status">
          メール送信がまだ設定されていません。管理者が送信元を設定すると、この画面から確認コードを送れます。
        </p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          B(true);
          Err("");
          try {
            if (ticket) {
              await api("/employee/verify", "POST", { ticket, code });
              C("");
              await refresh();
            } else {
              const r = await api<{ ticket: string; message: string }>(
                "/employee/request-code",
                "POST",
                { email },
              );
              T(r.ticket);
              N(r.message);
            }
          } catch (e) {
            Err((e as Error).message);
          } finally {
            B(false);
          }
        }}
      >
        {!ticket ? (
          <Field label="メールアドレス">
            <input
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(e) => E(e.target.value)}
            />
          </Field>
        ) : (
          <>
            <p>{email}</p>
            <Field label="8桁の確認コード">
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{8}"
                maxLength={8}
                required
                value={code}
                onChange={(e) => C(e.target.value.replace(/[^0-9]/g, ""))}
              />
            </Field>
            <p className="muted">
              有効期限は10分です。新しいコードを発行すると以前のコードは使えません。
            </p>
          </>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "処理中…" : ticket ? "ログイン" : "確認コードを送る"}
        </button>
      </form>
      {ticket && (
        <button
          disabled={busy}
          onClick={() => {
            T("");
            C("");
            N("");
            Err("");
          }}
        >
          メールアドレスを変更・コードを再送
        </button>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p className="muted">
        コードは誰にも教えないでください。共用端末では利用後にログアウトしてください。
      </p>
      <a href="/help/employee.html">利用手順を見る</a>
    </main>
  );
}
