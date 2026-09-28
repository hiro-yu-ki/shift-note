import { useEffect, useState, type ReactNode } from "react";
import {
  CalendarDays,
  LayoutDashboard,
  Users,
  SlidersHorizontal,
  ClipboardCheck,
  PanelLeftClose,
  Plus,
  ArrowRight,
  Check,
  Copy,
  RefreshCw,
  Settings,
  Sparkles,
  Clock3,
} from "lucide-react";
import {
  api,
  appUrl,
  uid,
  hm,
  weekdays,
  type State,
  type Staff,
  type Period,
  type Requirement,
  type Store,
} from "./types";
import { Empty, Field, Modal, Time, Num } from "./ui";
import { StaffEditor, PeriodEditor, RequirementEditor } from "./Editors";
import { SubmissionForm } from "./SubmissionForm";
import { Schedule } from "./Schedule";
import { Employee } from "./Employee";
import { EmployeeAccounts } from "./EmployeeAccounts";
import { ManagerAccess } from "./ManagerAccess";
import { DemandProposal } from "./DemandProposal";
import { TimeUnit } from "./ui";
import { Operations } from "./Operations";

const navigation = [
  ["overview", "概要", LayoutDashboard],
  ["staff", "スタッフ", Users],
  ["requirements", "必要人数・役割", SlidersHorizontal],
  ["submissions", "希望の提出状況", ClipboardCheck],
  ["schedule", "シフト案", CalendarDays],
  ["operations", "勤怠・変更申請", Clock3],
  ["settings", "店舗設定", Settings],
] as const;

export default function App() {
  if (appUrl("/admin/employee-preview") === location.pathname) {
    const query = new URLSearchParams(location.search);
    return (
      <ManagerAccess>
        <Employee
          previewStaff={query.get("staff") || ""}
          periodId={query.get("period") || ""}
        />
      </ManagerAccess>
    );
  }
  const token = new URLSearchParams(location.hash.slice(1)).get("token");
  return token ? (
    <Employee token={token} />
  ) : (
    <ManagerAccess>
      <Manager />
    </ManagerAccess>
  );
}

function Manager() {
  const [state, S] = useState<State | null>(null);
  const [error, E] = useState("");
  const [notice, N] = useState("");
  const [view, V] = useState("overview");
  const [reqDay, ReqDay] = useState("0");
  const [reqDate, ReqDate] = useState("");
  const [pid, P] = useState("");
  const [modal, M] = useState<ReactNode>(null);
  const [busy, B] = useState(false);
  const [generationMessage, GM] = useState("");
  const [filter, F] = useState(false);
  const [preset, G] = useState("バランス重視");
  const [seed, Seed] = useState(42);
  const [collapsed, C] = useState(false);
  const reload = async () => {
    S(await api<State>("/state"));
    E("");
  };
  useEffect(() => {
    api<State>("/state")
      .then(S)
      .catch((e) => E(e.message));
    const savedJob = sessionStorage.getItem("shift-generation-job");
    let active = true;
    if (savedJob) {
      void (async () => {
        B(true);
        try {
          while (active) {
            const job = await api<{
              status: string;
              message: string;
              period: string;
            }>(`/generation-jobs/${savedJob}`);
            if (!active) return;
            GM(job.message);
            P(job.period);
            V("schedule");
            if (job.status !== "running") {
              sessionStorage.removeItem("shift-generation-job");
              if (job.status === "failed") throw new Error(job.message);
              S(await api<State>("/state"));
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        } catch (e) {
          if (active) E((e as Error).message);
        } finally {
          if (active) B(false);
        }
      })();
    }
    return () => {
      active = false;
    };
  }, []);
  const run = async (fn: () => Promise<void>) => {
    E("");
    N("");
    try {
      await fn();
      N("保存しました");
    } catch (e) {
      E((e as Error).message);
    }
  };
  const accept = (s: State) => {
    S(s);
    N("保存しました");
  };
  const save = async (s: State) => {
    const next = await api<State>("/state", "PUT", s);
    accept(next);
    M(null);
  };
  if (!state)
    return (
      <main className="loading">
        <h1>シフトノート</h1>
        {error ? (
          <>
            <p role="alert" className="error">
              {error}
            </p>
            <button onClick={() => run(reload)}>再読み込み</button>
          </>
        ) : (
          <p>読み込み中…</p>
        )}
      </main>
    );
  if (!state.store) return <Setup onSave={accept} />;
  const period =
    state.periods.find((p) => p.id === pid) || state.periods.at(-1);
  const locked = period?.status === "確定済み";
  const subs = state.submissions.filter((s) => s.period === period?.id);
  const submitted = subs.filter(
    (s) =>
      s.status === "提出済み" &&
      state.staff.some((x) => x.id === s.staff && x.active),
  ).length;
  const active = state.staff.filter((s) => s.active);
  const candidates = state.candidates.filter(
    (c) => c.period === period?.id && !c.archived,
  );
  const latest =
    candidates.find((c) => c.id === period?.selected) ||
    candidates.at(-3) ||
    candidates[0];
  const staffEditor = (s?: Staff) =>
    M(
      <Modal
        title={s ? "スタッフを編集" : "スタッフを追加"}
        onClose={() => M(null)}
      >
        <StaffEditor
          state={state}
          initial={s}
          save={async (x) =>
            save({
              ...state,
              staff: s
                ? state.staff.map((a) => (a.id === x.id ? x : a))
                : [...state.staff, x],
            })
          }
        />
      </Modal>,
    );
  const periodEditor = (p?: Period) =>
    M(
      <Modal
        title={p ? "期間・営業時間を編集" : "新しいシフト期間"}
        onClose={() => M(null)}
      >
        <PeriodEditor
          state={state}
          initial={p}
          save={async (x, copy) => {
            await save({
              ...state,
              periods: p
                ? state.periods.map((a) => (a.id === x.id ? x : a))
                : [...state.periods, x],
              requirements: [
                ...state.requirements,
                ...state.requirements
                  .filter((r) => r.period === copy && !r.date)
                  .map((r) => ({ ...r, id: uid(), period: x.id })),
              ],
            });
            P(x.id);
          }}
        />
      </Modal>,
    );
  const reqEditor = (r?: Requirement) =>
    period &&
    M(
      <Modal
        title={r ? "必要人数を編集" : "必要人数を追加"}
        onClose={() => M(null)}
      >
        <RequirementEditor
          state={state}
          period={period}
          initial={
            r || {
              id: uid(),
              period: period.id,
              weekday: Number(reqDay === "date" ? 0 : reqDay),
              date:
                reqDay === "date"
                  ? reqDate >= period.start && reqDate <= period.end
                    ? reqDate
                    : period.start
                  : null,
              start: state.store!.start,
              end: state.store!.end,
              total: 2,
              roles: {},
              hard: false,
            }
          }
          save={async (x) => {
            await save({
              ...state,
              requirements: state.requirements.some((a) => a.id === x.id)
                ? state.requirements.map((a) => (a.id === x.id ? x : a))
                : [...state.requirements, x],
            });
            ReqDay(x.date ? "date" : String(x.weekday));
            if (x.date) ReqDate(x.date);
          }}
        />
      </Modal>,
    );
  const submissionEditor = (staff: Staff) =>
    period &&
    M(
      <Modal title={staff.name + " の希望を代理入力"} onClose={() => M(null)}>
        <p className="notice">
          店長の代理入力は締切後も可能です。変更内容は履歴に記録されます。
        </p>
        <SubmissionForm
          period={period}
          store={state.store!}
          staff={staff}
          initial={subs.find((s) => s.staff === staff.id) || null}
          locked={locked}
          onSave={async (x) =>
            save({
              ...state,
              submissions: [
                ...state.submissions.filter(
                  (a) => !(a.staff === x.staff && a.period === x.period),
                ),
                x,
              ],
            })
          }
        />
      </Modal>,
    );
  const issueUrl = async (s: Staff) => {
    const access = await api<{ production: boolean }>("/employee-accounts");
    if (access.production) {
      M(
        <Modal title="従業員用の配布URL" onClose={() => M(null)}>
          <p>
            「スタッフ」で {s.name}{" "}
            さんのメールアドレスを登録してください。本人が確認コードでログインします。
          </p>
          <a href={appUrl("/employee")} target="_blank" rel="noreferrer">
            {location.origin}{appUrl("/employee")}
          </a>
        </Modal>,
      );
      return;
    }
    const result = await api<{ token: string }>(
      `/periods/${period!.id}/tokens/${s.id}`,
      "POST",
    );
    const url = location.origin + appUrl("/") + "#token=" + result.token;
    M(
      <Modal title={s.name + " の提出URL"} onClose={() => M(null)}>
        <p>
          このURLから希望提出と確定シフトの確認ができます。再発行すると以前のURLは無効になります。
        </p>
        <p className="notice">
          ローカル版では、このPCのブラウザで利用できます。
        </p>
        <Field label="提出URL">
          <input readOnly value={url} onFocus={(e) => e.target.select()} />
        </Field>
        <footer className="row">
          <button
            onClick={() =>
              run(async () => {
                await navigator.clipboard.writeText(url);
              })
            }
          >
            <Copy size={16} />
            コピー
          </button>
          <a
            className="button primary"
            href={url}
            target="_blank"
            rel="noreferrer"
          >
            スタッフ画面を開く
          </a>
        </footer>
      </Modal>,
    );
  };
  const generate = async () => {
    B(true);
    await run(async () => {
      const check = await api<{
        unsubmitted: string[];
        messages: string[];
        required_slots: number;
        impossible: string[];
        reusable: boolean;
      }>(`/periods/${period!.id}/preflight?seed=${seed}`, "POST");
      if (check.reusable) {
        accept(
          await api(`/periods/${period!.id}/generate`, "POST", {
            version: state.version,
            preset,
            seed,
          }),
        );
        GM(
          "条件に変更がないため、保存済みの案を表示しています。手動で調整した内容もそのままです。",
        );
        V("schedule");
        return;
      }
      GM("");
      M(
        <Modal title="作成前の確認" onClose={() => M(null)}>
          <p>
            対象：{period!.start} 〜 {period!.end}
          </p>
          <p>未提出・下書き：{check.unsubmitted.join("、") || "なし"}</p>
          {check.messages.map((m) => (
            <p key={m} className="notice">
              {m}
            </p>
          ))}
          {check.impossible.length > 0 && (
            <details open>
              <summary>
                事前に分かる人数・役割の不足（{check.impossible.length}件）
              </summary>
              <ul>
                {check.impossible.slice(0, 20).map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </details>
          )}
          <p>
            提出した勤務可能日時・上限・連勤・勤務間隔・休憩は必ず守ります。希望する勤務時間数と必要人数の充足は、優先度に沿って調整します。
          </p>
          <footer>
            <button
              className="primary"
              onClick={() => {
                M(null);
                B(true);
                run(async () => {
                  const latest = await api<State>("/state");
                  S(latest);
                  let job = await api<{
                    id: string;
                    status: string;
                    message: string;
                  }>(`/periods/${period!.id}/generation-jobs`, "POST", {
                    version: latest.version,
                    preset,
                    seed,
                  });
                  sessionStorage.setItem("shift-generation-job", job.id);
                  while (job.status === "running") {
                    GM(job.message);
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                    job = await api(`/generation-jobs/${job.id}`);
                  }
                  sessionStorage.removeItem("shift-generation-job");
                  if (job.status === "failed") {
                    GM("");
                    throw new Error(job.message);
                  }
                  accept(await api<State>("/state"));
                  V("schedule");
                  GM(
                    "最新の条件で3案を作成しました。以前の案は履歴として保持しています。",
                  );
                }).finally(() => B(false));
              }}
            >
              3案を作成する
            </button>
          </footer>
        </Modal>,
      );
    });
    B(false);
  };
  return (
    <TimeUnit.Provider value={state.store.step}>
      <div className={`app ${collapsed ? "collapsed" : ""}`}>
        <aside className="sidebar no-print">
          <div className="brand">
            <CalendarDays size={25} />
            <span>シフトノート</span>
          </div>
          <div className="store-name">
            <span className="eyebrow">WORKSPACE</span>
            <strong>{state.store.name}</strong>
            <small>店舗のシフト管理</small>
          </div>
          <nav>
            {navigation.map(([key, label, Icon]) => (
              <button
                key={key}
                title={label}
                className={view === key ? "active" : ""}
                onClick={() => V(key)}
              >
                <Icon size={19} />
                <span>{label}</span>
                {key === "submissions" && active.length - submitted > 0 && (
                  <b>{active.length - submitted}</b>
                )}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <span>
              <span className="dot" />
              店舗データ
            </span>
            <small>データは店舗のサーバーに保存されます</small>
            <button
              className="icon"
              aria-label="メニューを折りたたむ"
              onClick={() => C(!collapsed)}
            >
              <PanelLeftClose size={18} />
            </button>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar no-print">
            <span>
              店舗管理 <span className="crumb">/</span>{" "}
              {navigation.find((n) => n[0] === view)?.[1]}
            </span>
            <button
              className="text-button"
              onClick={async () => {
                await api("/auth/logout", "POST");
                location.reload();
              }}
            >
              ログアウト
            </button>
          </header>
          <main>
            <div className="page-heading">
              <div>
                <span className="eyebrow">SHIFT MANAGEMENT</span>
                <h1>{navigation.find((n) => n[0] === view)?.[1]}</h1>
                <p className="muted">
                  {view === "overview"
                    ? "希望の提出状況と、確定までの作業を確認できます。"
                    : view === "staff"
                      ? "スタッフの役割と勤務条件を管理します。"
                      : view === "requirements"
                        ? "店舗に必要な人数を、曜日・時間帯ごとに設定します。"
                        : view === "submissions"
                          ? "提出状況の確認と、希望の代理入力ができます。"
                          : view === "schedule"
                            ? "希望と店舗の条件をもとに作成した案を比較・調整します。"
                            : view === "operations"
                              ? "勤務変更の相談、打刻、実績の人件費を確認します。"
                            : "営業時間と、店舗の基本情報を管理します。"}
                </p>
              </div>
              {view !== "operations" && <button className="no-print" onClick={() => periodEditor()}>
                <Plus size={16} />
                期間を作成
              </button>}
            </div>
            {error && (
              <div className="error" role="alert">
                {error}
                <button onClick={() => run(reload)}>
                  <RefreshCw size={14} />
                  再読み込み
                </button>
              </div>
            )}
            {notice && (
              <div role="status" className="toast no-print">
                <Check size={15} />
                {notice}
              </div>
            )}
            {busy && (
              <div role="status" className="notice">
                シフト案を作成しています。条件が多い場合はしばらくお待ちください。
              </div>
            )}
            {period && view !== "settings" && view !== "operations" && (
              <div className="period-bar">
                <div>
                  <span className="eyebrow">対象期間</span>
                  <select
                    aria-label="対象期間"
                    value={period.id}
                    onChange={(e) => {
                      P(e.target.value);
                      N("");
                    }}
                  >
                    {state.periods.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.start} 〜 {p.end}
                      </option>
                    ))}
                  </select>
                  <span className={"badge " + (locked ? "green" : "blue")}>
                    {period.status}
                  </span>
                </div>
                <button
                  disabled={locked}
                  className="text-button no-print"
                  onClick={() => periodEditor(period)}
                >
                  期間・営業時間を編集
                </button>
              </div>
            )}
            {view === "overview" && (
              <>
                {!period ? (
                  <Empty>
                    <h2>最初のシフト期間を作りましょう</h2>
                    <p>スタッフ登録後、期間と必要人数を設定できます。</p>
                    <button className="primary" onClick={() => periodEditor()}>
                      期間を作成
                    </button>
                  </Empty>
                ) : (
                  <>
                    <div className="stats">
                      <div>
                        <span>希望の提出</span>
                        <strong>
                          {submitted}
                          <small> / {active.length}人</small>
                        </strong>
                        <div className="progress">
                          <i
                            style={{
                              width: `${(100 * submitted) / (active.length || 1)}%`,
                            }}
                          />
                        </div>
                        <small>
                          あと{active.length - submitted}人の希望を確認
                        </small>
                      </div>
                      <div>
                        <span>提出締切</span>
                        <strong className="date-stat">
                          {new Date(period.deadline).toLocaleDateString(
                            "ja-JP",
                            {
                              month: "long",
                              day: "numeric",
                            },
                          )}
                        </strong>
                        <small>
                          <Clock3 size={13} />{" "}
                          {new Date(period.deadline).toLocaleTimeString(
                            "ja-JP",
                            {
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                          )}{" "}
                          {new Date(period.deadline) < new Date()
                            ? "・締切を過ぎています"
                            : "まで"}
                        </small>
                      </div>
                      <div>
                        <span>人数不足</span>
                        <strong>
                          {latest ? latest.metrics.missing_slots : "—"}
                          <small> 枠</small>
                        </strong>
                        <small>
                          {latest
                            ? "設定した勤務時間単位で集計"
                            : "シフト作成後に確認できます"}
                        </small>
                      </div>
                      <div>
                        <span>保存済みの案</span>
                        <strong>
                          {candidates.length}
                          <small> 案</small>
                        </strong>
                        <small>
                          {locked
                            ? "確定済みの案を共有できます"
                            : "比較して最適な案を選択"}
                        </small>
                      </div>
                    </div>
                    <section className="next-action">
                      <div>
                        <span className="eyebrow">NEXT STEP</span>
                        <h2>
                          {locked
                            ? "確定したシフトを共有しましょう"
                            : candidates.length
                              ? "シフト案を確認しましょう"
                              : "希望を確認して、シフト案を作成しましょう"}
                        </h2>
                        <p>
                          {locked
                            ? "スタッフ用URLで本人のシフトを確認できます。CSV出力・印刷にも対応しています。"
                            : "未提出のスタッフは自動割当に含まれません。必要に応じて代理入力できます。"}
                        </p>
                      </div>
                      <button
                        className="primary"
                        onClick={() =>
                          V(candidates.length ? "schedule" : "submissions")
                        }
                      >
                        {candidates.length
                          ? "シフト案を見る"
                          : "提出状況を見る"}
                        <ArrowRight size={16} />
                      </button>
                    </section>
                    <div className="overview-columns">
                      <section>
                        <div className="section-title">
                          <h2>希望の提出状況</h2>
                          <button
                            className="text-button"
                            onClick={() => V("submissions")}
                          >
                            すべて見る <ArrowRight size={14} />
                          </button>
                        </div>
                        <table>
                          <thead>
                            <tr>
                              <th>スタッフ</th>
                              <th>状態</th>
                              <th>希望 / 週</th>
                            </tr>
                          </thead>
                          <tbody>
                            {active.slice(0, 6).map((s) => {
                              const sub = subs.find((x) => x.staff === s.id);
                              return (
                                <tr key={s.id}>
                                  <td>
                                    <span className="avatar">{s.name[0]}</span>
                                    {s.name}
                                  </td>
                                  <td>
                                    <span
                                      className={
                                        "badge " +
                                        (sub?.status === "提出済み"
                                          ? "green"
                                          : "amber")
                                      }
                                    >
                                      {sub?.status || "未提出"}
                                    </span>
                                  </td>
                                  <td>{sub?.target ?? "—"}h</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </section>
                      <section className="workflow">
                        <h2>シフト作成の流れ</h2>
                        {[
                          [
                            "1",
                            "スタッフと勤務条件",
                            state.staff.length > 0,
                            "staff",
                          ],
                          [
                            "2",
                            "必要人数を設定",
                            state.requirements.some(
                              (r) => r.period === period.id,
                            ),
                            "requirements",
                          ],
                          [
                            "3",
                            "希望を集める",
                            submitted === active.length && active.length > 0,
                            "submissions",
                          ],
                          [
                            "4",
                            "シフト案を作成・調整",
                            candidates.length > 0,
                            "schedule",
                          ],
                          ["5", "確定して共有", locked, "schedule"],
                        ].map(([n, title, done, key]) => (
                          <button
                            key={String(n)}
                            onClick={() => V(String(key))}
                          >
                            <span className={done ? "step done" : "step"}>
                              {done ? <Check size={15} /> : n}
                            </span>
                            <span>{title}</span>
                            <ArrowRight size={15} />
                          </button>
                        ))}
                      </section>
                    </div>
                    <h2>最近のシフト期間</h2>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>期間</th>
                            <th>状態</th>
                            <th>確定者</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {[...state.periods].reverse().map((p) => (
                            <tr key={p.id}>
                              <td>
                                {p.start} 〜 {p.end}
                              </td>
                              <td>{p.status}</td>
                              <td>{p.confirmed_by || "—"}</td>
                              <td>
                                <button
                                  onClick={() => {
                                    P(p.id);
                                    V("schedule");
                                  }}
                                >
                                  開く
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            )}
            {view === "staff" && (
              <>
                <EmployeeAccounts staff={active} periodId={period?.id} />
                <div className="toolbar spread">
                  <h2>
                    スタッフ一覧{" "}
                    <span className="count">{active.length}人</span>
                  </h2>
                  <button className="primary" onClick={() => staffEditor()}>
                    <Plus size={16} />
                    スタッフを追加
                  </button>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>氏名</th>
                        <th>役割</th>
                        <th>希望 / 週</th>
                        <th>上限 / 週</th>
                        <th>状態</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {state.staff.map((s) => (
                        <tr key={s.id}>
                          <td>
                            <span className="avatar">{s.name[0]}</span>
                            {s.name}
                          </td>
                          <td>
                            {s.roles
                              .map(
                                (r) =>
                                  state.roles.find((x) => x.id === r)?.name,
                              )
                              .join("・") || "未設定"}
                          </td>
                          <td>{s.target}h</td>
                          <td>{s.maximum}h</td>
                          <td>{s.active ? "在籍中" : "無効"}</td>
                          <td>
                            <div className="row">
                              <button
                                className="small"
                                onClick={() => staffEditor(s)}
                              >
                                編集
                              </button>
                              <button
                                className="small danger-text"
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `${s.name}を無効化しますか？履歴を保つため削除は行いません。`,
                                    )
                                  )
                                    run(() =>
                                      save({
                                        ...state,
                                        staff: state.staff.map((x) =>
                                          x.id === s.id
                                            ? { ...x, active: false }
                                            : x,
                                        ),
                                      }),
                                    );
                                }}
                              >
                                無効化
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!state.staff.length && (
                  <Empty>スタッフを追加してください。</Empty>
                )}
                <h2>役割の管理</h2>
                <div className="roles-list">
                  {state.roles.map((r) => (
                    <div key={r.id}>
                      <span>{r.name}</span>
                      <button
                        className="small"
                        onClick={() => {
                          const name = window.prompt("役割名", r.name);
                          if (name)
                            run(() =>
                              save({
                                ...state,
                                roles: state.roles.map((x) =>
                                  x.id === r.id ? { ...x, name } : x,
                                ),
                              }),
                            );
                        }}
                      >
                        名前を変更
                      </button>
                      <button
                        className="small"
                        onClick={() => {
                          if (
                            window.confirm(
                              "使用中の役割は削除できません。削除しますか？",
                            )
                          )
                            run(() =>
                              save({
                                ...state,
                                roles: state.roles.filter((x) => x.id !== r.id),
                              }),
                            );
                        }}
                      >
                        削除
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => {
                      const name = window.prompt("追加する役割名");
                      if (name)
                        run(() =>
                          save({
                            ...state,
                            roles: [...state.roles, { id: uid(), name }],
                          }),
                        );
                    }}
                  >
                    <Plus size={15} />
                    役割を追加
                  </button>
                </div>
              </>
            )}
            {view === "requirements" &&
              (period ? (
                <>
                  <nav
                    className="requirement-days"
                    aria-label="必要人数の設定日"
                  >
                    {weekdays.map((d, i) => (
                      <button
                        key={d}
                        aria-current={reqDay === String(i) ? "page" : undefined}
                        onClick={() => ReqDay(String(i))}
                      >
                        {d}曜日
                      </button>
                    ))}
                    <button
                      aria-current={reqDay === "date" ? "page" : undefined}
                      onClick={() => ReqDay("date")}
                    >
                      特定日
                    </button>
                  </nav>
                  {reqDay === "date" && (
                    <>
                      <Field label="設定する特定日">
                        <input
                          type="date"
                          min={period.start}
                          max={period.end}
                          value={
                            reqDate >= period.start && reqDate <= period.end
                              ? reqDate
                              : period.start
                          }
                          onChange={(e) => ReqDate(e.target.value)}
                        />
                      </Field>
                      <p className="muted">
                        この日に条件を1件以上登録すると、その日の曜日設定全体を置き換えます。未登録の時間帯には必要人数を設定しません。条件が0件なら曜日設定を使います。
                      </p>
                    </>
                  )}
                  <div className="toolbar spread">
                    <h2>
                      {reqDay === "date"
                        ? "特定日"
                        : weekdays[Number(reqDay)] + "曜日"}
                      の必要人数・役割
                    </h2>
                    <button
                      disabled={locked}
                      onClick={() =>
                        M(
                          <DemandProposal
                            state={state}
                            period={period}
                            close={() => M(null)}
                            save={accept}
                          />,
                        )
                      }
                    >
                      実績から提案
                    </button>
                    <div className="row">
                      <button
                        disabled={locked}
                        onClick={() =>
                          M(
                            <BulkRequirements
                              state={state}
                              period={period}
                              save={save}
                              close={() => M(null)}
                            />,
                          )
                        }
                      >
                        表を貼り付け
                      </button>
                      <button
                        className="primary"
                        disabled={locked}
                        onClick={() => reqEditor()}
                      >
                        <Plus size={16} />
                        条件を追加
                      </button>
                    </div>
                  </div>
                  <div className="notice">
                    役割人数の「必須」は確定時に必ず満たす条件です。合計人数の不足は警告として表示します。
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>適用日</th>
                          <th>時間帯</th>
                          <th>合計</th>
                          <th>役割内訳</th>
                          <th>役割条件</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {state.requirements
                          .filter(
                            (r) =>
                              r.period === period.id &&
                              (reqDay === "date"
                                ? r.date ===
                                  (reqDate >= period.start &&
                                  reqDate <= period.end
                                    ? reqDate
                                    : period.start)
                                : !r.date && r.weekday === Number(reqDay)),
                          )
                          .sort((a, b) => a.start - b.start)
                          .map((r) => (
                            <tr key={r.id}>
                              <td>
                                {r.date ||
                                  "毎週" + weekdays[r.weekday] + "曜日"}
                              </td>
                              <td>
                                {hm(r.start)} – {hm(r.end)}
                              </td>
                              <td>{r.total}人</td>
                              <td>
                                {Object.entries(r.roles)
                                  .filter(([, v]) => v)
                                  .map(
                                    ([k, v]) =>
                                      `${state.roles.find((x) => x.id === k)?.name} ${v}人`,
                                  )
                                  .join(" / ") || "—"}
                              </td>
                              <td>
                                <span
                                  className={
                                    "badge " + (r.hard ? "blue" : "gray")
                                  }
                                >
                                  {r.hard ? "必須" : "目安"}
                                </span>
                              </td>
                              <td>
                                <div className="row">
                                  <button
                                    className="small"
                                    disabled={locked}
                                    onClick={() => reqEditor(r)}
                                  >
                                    編集
                                  </button>
                                  <button
                                    className="small"
                                    disabled={locked}
                                    onClick={() =>
                                      reqEditor({
                                        ...r,
                                        id: uid(),
                                        weekday: (r.weekday + 1) % 7,
                                      })
                                    }
                                  >
                                    複製
                                  </button>
                                  <button
                                    className="small"
                                    disabled={locked}
                                    onClick={() => {
                                      if (
                                        window.confirm(
                                          "この条件を削除しますか？",
                                        )
                                      )
                                        run(() =>
                                          save({
                                            ...state,
                                            requirements:
                                              state.requirements.filter(
                                                (x) => x.id !== r.id,
                                              ),
                                          }),
                                        );
                                    }}
                                  >
                                    削除
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <Empty>先にシフト期間を作成してください。</Empty>
              ))}
            {view === "submissions" &&
              (period ? (
                <>
                  <div className="toolbar spread">
                    <h2>
                      提出済み {submitted} / {active.length}人
                    </h2>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={filter}
                        onChange={(e) => F(e.target.checked)}
                      />
                      未提出のみ
                    </label>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>スタッフ</th>
                          <th>状態</th>
                          <th>希望 / 週</th>
                          <th>更新日時</th>
                          <th>連絡事項</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {active
                          .filter(
                            (s) =>
                              !filter ||
                              !subs.some(
                                (x) =>
                                  x.staff === s.id && x.status === "提出済み",
                              ),
                          )
                          .map((s) => {
                            const sub = subs.find((x) => x.staff === s.id);
                            return (
                              <tr key={s.id}>
                                <td>{s.name}</td>
                                <td>
                                  <span
                                    className={
                                      "badge " +
                                      (sub?.status === "提出済み"
                                        ? "green"
                                        : "amber")
                                    }
                                  >
                                    {sub?.status || "未提出"}
                                  </span>
                                </td>
                                <td>{sub?.target ?? "—"}h</td>
                                <td>
                                  {sub?.updated_at
                                    ? new Date(sub.updated_at).toLocaleString(
                                        "ja-JP",
                                      )
                                    : "—"}
                                </td>
                                <td className="notes-cell">
                                  {sub?.notes || "—"}
                                </td>
                                <td>
                                  <div className="row">
                                    <button
                                      className="small"
                                      onClick={() => run(() => issueUrl(s))}
                                    >
                                      提出URL
                                    </button>
                                    <button
                                      className="small"
                                      onClick={() => submissionEditor(s)}
                                    >
                                      代理入力
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <Empty>先にシフト期間を作成してください。</Empty>
              ))}
            {view === "schedule" &&
              (period ? (
                <>
                  <div className="generation no-print">
                    <div>
                      <h2>
                        <Sparkles size={19} /> シフト案の自動作成
                      </h2>
                      <p className="muted">
                        勤務条件を守りながら、3つの方針で案を作成します。
                      </p>
                    </div>
                    <select
                      aria-label="作成方針"
                      disabled={busy || locked}
                      value={preset}
                      onChange={(e) => G(e.target.value)}
                    >
                      {["バランス重視", "希望優先", "人件費を抑える"].map(
                        (x) => (
                          <option key={x}>{x}</option>
                        ),
                      )}
                    </select>
                    <button
                      className="primary"
                      disabled={busy || locked}
                      onClick={generate}
                    >
                      {busy ? "作成中…" : "シフト案を作成"}
                    </button>
                    <details>
                      <summary>詳細設定</summary>
                      <Num
                        label="再現用seed"
                        value={seed}
                        max={2147483647}
                        onChange={Seed}
                      />
                      <p className="muted">
                        希望時間と公平性は目安、勤務不可と上限は必須です。未提出のスタッフは割当対象外です。
                      </p>
                    </details>
                  </div>
                  {generationMessage && (
                    <p className="inline-success" role="status">
                      {generationMessage}
                    </p>
                  )}
                  <Schedule
                    key={period.id + ":" + (candidates[0]?.id || "empty")}
                    state={state}
                    period={period}
                    onState={accept}
                    run={run}
                  />
                </>
              ) : (
                <Empty>先にシフト期間を作成してください。</Empty>
              ))}
            {view === "settings" && (
              <StoreSettings state={state} save={save} run={run} />
            )}
            {view === "operations" && <Operations />}
          </main>
          <div className="app-footer no-print">
            シフトノート <span>店舗のための、シンプルなシフト管理</span>
          </div>
        </div>
        {modal}
      </div>
    </TimeUnit.Provider>
  );
}

function Setup({ onSave }: { onSave: (s: State) => void }) {
  const [store, S] = useState<Store>({
    name: "喫茶 こもれび",
    start: 600,
    end: 1200,
    step: 30,
    week_start: 0,
  });
  const [demo, D] = useState(false);
  const [error, E] = useState("");
  const [busy, B] = useState(false);
  return (
    <main className="setup">
      <div className="brand">
        <CalendarDays size={27} />
        シフトノート
      </div>
      <div className="setup-panel">
        <span className="eyebrow">はじめての設定</span>
        <h1>店舗のシフト管理を始める</h1>
        <p className="muted">
          まずは店舗の基本情報を設定しましょう。あとから変更できます。
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            B(true);
            try {
              onSave(await api("/setup", "POST", { store, demo }));
            } catch (e) {
              E((e as Error).message);
            } finally {
              B(false);
            }
          }}
        >
          <StoreFields store={store} set={S} />
          <label className="demo-choice">
            <input
              type="checkbox"
              checked={demo}
              onChange={(e) => D(e.target.checked)}
            />
            <span>
              <strong>デモデータで試す</strong>
              <small>
                架空のスタッフ14名と、2週間の希望・店舗条件を用意します。
              </small>
            </span>
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary wide" disabled={busy}>
            {busy ? "設定中…" : "セットアップを完了"}
            <ArrowRight size={16} />
          </button>
        </form>
      </div>
      <p className="muted">データは店舗のサーバーに保存されます。</p>
    </main>
  );
}
function StoreFields({
  store,
  set,
}: {
  store: Store;
  set: (s: Store) => void;
}) {
  return (
    <>
      <Field label="店舗名">
        <input
          required
          maxLength={80}
          value={store.name}
          onChange={(e) => set({ ...store, name: e.target.value })}
        />
      </Field>
      <div className="form-grid">
        <Field label="基本営業時間・開始">
          <Time
            label="基本営業開始"
            step={store.step}
            value={store.start}
            onChange={(start) => set({ ...store, start })}
          />
        </Field>
        <Field label="基本営業時間・終了">
          <Time
            label="基本営業終了"
            step={store.step}
            value={store.end}
            onChange={(end) => set({ ...store, end })}
          />
        </Field>
        <Field label="1週間の起点">
          <select
            value={store.week_start}
            onChange={(e) =>
              set({ ...store, week_start: Number(e.target.value) })
            }
          >
            {weekdays.map((w, i) => (
              <option value={i} key={w}>
                {w}曜日
              </option>
            ))}
          </select>
        </Field>
        <Field label="勤務時間の入力単位">
          <select
            value={store.step}
            onChange={(e) =>
              set({ ...store, step: Number(e.target.value) as 15 | 30 | 60 })
            }
          >
            <option value={15}>15分</option>
            <option value={30}>30分（標準）</option>
            <option value={60}>1時間</option>
          </select>
        </Field>
      </div>
      <p className="muted small-text">
        従業員の入力・自動作成・手動編集に同じ単位を使います。単位変更で合わなくなる既存の時刻は、丸めずに警告します。
      </p>
    </>
  );
}
function StoreSettings({
  state,
  save,
  run,
}: {
  state: State;
  save: (s: State) => Promise<void>;
  run: (f: () => Promise<void>) => Promise<void>;
}) {
  const [store, S] = useState(state.store!);
  const [audit, A] = useState<
    { action: string; created_at: string; version: number }[]
  >([]);
  return (
    <div className="settings-page">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(() => save({ ...state, store }));
        }}
      >
        <StoreFields store={store} set={S} />
        <h2>勤務途中の休憩</h2>
        <p className="muted">
          実働6時間超で45分、8時間超で60分を下限に配置します。会社の追加ルールを設定できます。休憩は15分単位で、給与・必要人数から除外します。
        </p>
        {(
          store.break_rules || [
            { after_hours: 6, minutes: 45 },
            { after_hours: 8, minutes: 60 },
          ]
        ).map((rule, i) => (
          <div className="condition-row" key={i}>
            <Num
              label="実働がこの時間を超える場合"
              step={0.25}
              min={0}
              max={24}
              value={rule.after_hours}
              onChange={(after_hours) =>
                S({
                  ...store,
                  break_rules: (
                    store.break_rules || [
                      { after_hours: 6, minutes: 45 },
                      { after_hours: 8, minutes: 60 },
                    ]
                  ).map((r, j) => (i === j ? { ...r, after_hours } : r)),
                })
              }
            />
            <Num
              label="休憩の最低分数"
              step={15}
              min={15}
              max={240}
              value={rule.minutes}
              onChange={(minutes) =>
                S({
                  ...store,
                  break_rules: (
                    store.break_rules || [
                      { after_hours: 6, minutes: 45 },
                      { after_hours: 8, minutes: 60 },
                    ]
                  ).map((r, j) => (i === j ? { ...r, minutes } : r)),
                })
              }
            />
            <button
              type="button"
              onClick={() =>
                S({
                  ...store,
                  break_rules: (
                    store.break_rules || [
                      { after_hours: 6, minutes: 45 },
                      { after_hours: 8, minutes: 60 },
                    ]
                  ).filter((_, j) => i !== j),
                })
              }
            >
              削除
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            S({
              ...store,
              break_rules: [
                ...(store.break_rules || [
                  { after_hours: 6, minutes: 45 },
                  { after_hours: 8, minutes: 60 },
                ]),
                { after_hours: 4, minutes: 15 },
              ],
            })
          }
        >
          休憩ルールを追加
        </button>
        <Num
          label="休憩前後に必要な勤務（分）"
          min={15}
          max={180}
          step={15}
          value={store.break_margin ?? 30}
          onChange={(break_margin) => S({ ...store, break_margin })}
        />
        <p className="muted small-text">
          例：30分なら出勤直後と退勤直前の30分は休憩にしません。個別契約に追加の休憩があれば、それも満たす長さで配置します。
        </p>
        <button className="primary">店舗設定を保存</button>
      </form>
      <h2>更新履歴</h2>
      <button onClick={() => run(async () => A(await api("/audit")))}>
        履歴を表示
      </button>
      <table>
        <thead>
          <tr>
            <th>日時</th>
            <th>操作</th>
            <th>版</th>
          </tr>
        </thead>
        <tbody>
          {audit.map((a) => (
            <tr key={a.version}>
              <td>{new Date(a.created_at).toLocaleString("ja-JP")}</td>
              <td>{a.action}</td>
              <td>{a.version}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function BulkRequirements({
  state,
  period,
  save,
  close,
}: {
  state: State;
  period: Period;
  save: (s: State) => Promise<void>;
  close: () => void;
}) {
  const [text, T] = useState("");
  const [error, E] = useState("");
  return (
    <Modal title="表から必要人数を貼り付け" onClose={close}>
      <p>
        タブ区切りで「曜日（0=月〜6=日）・開始・終了・人数」を貼り付けます。役割条件は保存後に編集できます。既存の条件に追加します。
      </p>
      <p className="muted">例：0　10:00　14:00　3</p>
      <Field label="貼り付ける表">
        <textarea rows={8} value={text} onChange={(e) => T(e.target.value)} />
      </Field>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <button
          className="primary"
          onClick={async () => {
            try {
              const rows = text
                .trim()
                .split("\n")
                .map((line) => {
                  const [w, a, b, n] = line.split("\t");
                  const parse = (s: string) => {
                    const parts = s.split(":").map(Number);
                    return parts[0] * 60 + parts[1];
                  };
                  return {
                    id: uid(),
                    period: period.id,
                    weekday: Number(w),
                    date: null,
                    start: parse(a),
                    end: parse(b),
                    total: Number(n),
                    roles: {},
                    hard: false,
                  };
                });
              await save({
                ...state,
                requirements: [...state.requirements, ...rows],
              });
            } catch (e) {
              E((e as Error).message);
            }
          }}
        >
          表を保存
        </button>
      </footer>
    </Modal>
  );
}
