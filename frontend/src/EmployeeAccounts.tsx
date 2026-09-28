import { useEffect, useState } from "react";
import { api, appUrl, type Staff } from "./types";
import { Field } from "./ui";

type Account = { staff: string; email: string; revision: number };
type Data = { accounts: Account[]; email_ready: boolean; production: boolean };
export function EmployeeAccounts({
  staff,
  periodId,
}: {
  staff: Staff[];
  periodId?: string;
}) {
  const [data, D] = useState<Data | null>(null);
  const [sid, S] = useState(staff[0]?.id || "");
  const [email, E] = useState("");
  const [error, Err] = useState("");
  const [notice, N] = useState("");
  const [busy, B] = useState(false);
  useEffect(() => {
    api<Data>("/employee-accounts")
      .then(D)
      .catch((e) => Err(e.message));
  }, []);
  const selected = data?.accounts.find((a) => a.staff === sid);
  const select = (id: string) => {
    S(id);
    E(data?.accounts.find((a) => a.staff === id)?.email || "");
    N("");
  };
  return (
    <section className="account-settings">
      <h2>従業員のログイン管理</h2>
      <p>
        本人のメールアドレスを登録し、下の共通URLを配布してください。メールに届く確認コードで本人を識別します。
      </p>
      <div className="toolbar">
        <a href={appUrl("/employee")} target="_blank" rel="noreferrer">
          {location.origin}{appUrl("/employee")}
        </a>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                location.origin + appUrl("/employee"),
              );
              N("従業員用URLをコピーしました");
            } catch {
              N("上のURLを選択してコピーしてください");
            }
          }}
        >
          配布URLをコピー
        </button>
        <a href="/help/manager.html" target="_blank" rel="noreferrer">
          管理者の利用手順
        </a>
      </div>
      {data && !data.email_ready && (
        <p className="warning">
          メール送信が未設定です。登録はできますが、従業員のログインには公開・メール設定が必要です。
          <a href="/help/email.html" target="_blank" rel="noreferrer">
            Gmailで送信を設定する手順
          </a>
        </p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          B(true);
          Err("");
          N("");
          try {
            D(
              await api<Data>(
                `/employee-accounts/${encodeURIComponent(sid)}`,
                "PUT",
                { email, revision: selected?.revision || 0 },
              ),
            );
            N("登録しました。以前のログインと確認コードは無効になりました。");
          } catch (e) {
            Err((e as Error).message);
          } finally {
            B(false);
          }
        }}
      >
        <div className="form-grid">
          <Field label="登録するスタッフ">
            <select value={sid} onChange={(e) => select(e.target.value)}>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="本人のメールアドレス">
            <input
              type="email"
              required
              maxLength={254}
              autoComplete="off"
              value={email}
              placeholder={selected?.email || "name@example.com"}
              onChange={(e) => E(e.target.value)}
            />
          </Field>
        </div>
        <button disabled={busy || !sid} className="primary">
          メールアドレスを登録・変更
        </button>
      </form>
      <p className="muted">
        変更すると、その人のログインが解除されます。退職時はスタッフを無効化するか、下の「利用停止」を押してください。
      </p>
      {sid && periodId && (
        <p>
          <a
            href={`/admin/employee-preview?staff=${encodeURIComponent(sid)}&period=${encodeURIComponent(periodId)}`}
            target="_blank"
            rel="noreferrer"
          >
            選択した従業員の画面を確認（管理者用・閲覧のみ）
          </a>
        </p>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>スタッフ</th>
              <th>登録メール</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {data?.accounts.map((a) => (
              <tr key={a.staff}>
                <td>
                  {staff.find((s) => s.id === a.staff)?.name ||
                    "無効化済みスタッフ"}
                </td>
                <td>{a.email}</td>
                <td>
                  <button
                    disabled={busy}
                    onClick={async () => {
                      if (
                        !confirm(
                          "このスタッフのメール認証を停止し、すべてのログインを解除します。再登録すれば利用を再開できます。",
                        )
                      )
                        return;
                      B(true);
                      try {
                        D(
                          await api<Data>(
                            `/employee-accounts/${encodeURIComponent(a.staff)}/revoke`,
                            "POST",
                          ),
                        );
                        N("利用を停止しました");
                      } catch (e) {
                        Err((e as Error).message);
                      } finally {
                        B(false);
                      }
                    }}
                  >
                    利用停止
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
