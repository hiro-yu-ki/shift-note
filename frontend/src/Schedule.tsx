import { useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { Download, Printer, Undo2, Plus, ShieldCheck } from "lucide-react";
import {
  api,
  uid,
  hm,
  dates,
  dateLabel,
  paidHours,
  breakLabel,
  type State,
  type Period,
  type Assignment,
} from "./types";
import { Modal, Field, Time, Empty } from "./ui";
import { LaborChart } from "./LaborChart";
import { WeekTimeline } from "./WeekTimeline";
import { DayTimeline } from "./DayTimeline";

export function Schedule({
  state,
  period,
  onState,
  run,
}: {
  state: State;
  period: Period;
  onState: (s: State) => void;
  run: (f: () => Promise<void>) => Promise<void>;
}) {
  const candidates = state.candidates.filter(
    (c) => c.period === period.id && !c.archived,
  );
  const [selected, S] = useState(
    period.selected || candidates.at(-3)?.id || candidates[0]?.id || "",
  );
  const c = candidates.find((c) => c.id === selected) || candidates[0];
  const [edit, E] = useState<Assignment | null>(null);
  const [confirm, C] = useState(false);
  const [name, N] = useState("店長");
  const [hard, H] = useState(false);
  const [busy, B] = useState(false);
  const [editError, EE] = useState("");
  const locked = period.status === "確定済み";
  const action = async (fn: () => Promise<void>) => {
    B(true);
    try {
      await run(fn);
    } finally {
      B(false);
    }
  };
  const save = async (rows: Assignment[]) => {
    EE("");
    try {
      onState(
        await api<State>("/candidates/" + c.id, "PUT", {
          version: state.version,
          assignments: rows,
        }),
      );
      E(null);
    } catch (error) {
      EE((error as Error).message);
      throw error;
    }
  };
  if (!c)
    return (
      <Empty>
        シフト案はまだありません。「シフト案を作成」から作成してください。
      </Empty>
    );
  return (
    <>
      {c.metrics.stale && !locked && (
        <p className="notice warning">
          この案の作成後に希望・勤務条件が更新されています。現在の条件で「シフト案を作成」を実行してください。
        </p>
      )}
      <div className="candidate-grid">
        {candidates.map((x, i) => (
          <button
            key={x.id}
            className={`candidate ${x.id === c.id ? "selected" : ""}`}
            onClick={() => S(x.id)}
          >
            <span className="eyebrow">
              案 {i + 1} {x.id === period.selected ? "・確定済み" : ""}
            </span>
            <strong>{x.name}</strong>
            <div className="candidate-metrics">
              <span>
                充足率 <b>{x.metrics.coverage}%</b>
              </span>
              <span>
                優先希望枠 <b>{x.metrics.preference}%</b>
              </span>
              <span>
                重大違反 <b>{x.metrics.hard}件</b>
              </span>
            </div>
            <small>
              総勤務 {x.metrics.total_hours}h ・ 希望差のばらつき{" "}
              {x.metrics.fairness}h
            </small>
          </button>
        ))}
      </div>
      <div className="toolbar spread">
        <div>
          <h2>シフト案を確認・調整</h2>
          <p className="muted">
            操作は自動保存されます。勤務をクリックして編集できます。
          </p>
        </div>
        <div className="row no-print">
          <button
            disabled={locked || busy || !c.previous}
            onClick={() =>
              action(async () =>
                onState(
                  await api("/candidates/" + c.id + "/undo", "POST", {
                    version: state.version,
                  }),
                ),
              )
            }
          >
            <Undo2 size={16} />
            取り消す
          </button>
          <button
            disabled={busy}
            onClick={() =>
              action(async () =>
                onState(
                  await api("/candidates/" + c.id + "/validate", "POST", {
                    version: state.version,
                  }),
                ),
              )
            }
          >
            <ShieldCheck size={16} />
            再検証
          </button>
          <button
            disabled={
              locked ||
              busy ||
              !state.staff.some((s) => s.active && s.roles.length)
            }
            onClick={() => {
              const s = state.staff.find((s) => s.active && s.roles.length)!;
              E({
                id: uid(),
                staff: s.id,
                role: s.roles[0],
                date: period.start,
                start: state.store!.start,
                end: state.store!.start + 180,
                reason: "店長による調整",
              });
            }}
          >
            <Plus size={16} />
            勤務を追加
          </button>
        </div>
      </div>
      <div
        className={`notice ${c.metrics.hard ? "danger" : c.violations.length ? "warning" : "success"}`}
      >
        <strong>
          {c.metrics.hard
            ? "重大な違反があります"
            : c.violations.length
              ? "確認が必要な時間帯があります"
              : "重大な違反はありません"}
        </strong>
        <span>
          人数不足 {c.metrics.missing_slots}枠 / 重大違反 {c.metrics.hard}
          件。人数不足のみの場合は確認のうえ確定できます。
        </span>
      </div>
      <details className="warnings">
        <summary>警告の詳細（{c.violations.length}件）</summary>
        <label className="check">
          <input
            type="checkbox"
            checked={hard}
            onChange={(e) => H(e.target.checked)}
          />
          重大な違反のみ
        </label>
        <ul>
          {c.violations
            .filter((v) => !hard || v.hard)
            .map((v, i) => (
              <li key={i}>
                <span className={`badge ${v.hard ? "red" : "amber"}`}>
                  {v.hard ? "重大" : "確認"}
                </span>{" "}
                {v.message}
              </li>
            ))}
        </ul>
      </details>
      <div className="print-only">
        <h2>全期間の勤務一覧</h2>
        <table>
          <thead>
            <tr>
              <th>日付</th>
              <th>スタッフ</th>
              <th>役割</th>
              <th>開始</th>
              <th>終了</th>
              <th>休憩</th>
              <th>実働時間</th>
            </tr>
          </thead>
          <tbody>
            {[...c.assignments]
              .sort(
                (a, b) =>
                  a.date.localeCompare(b.date) ||
                  a.start - b.start ||
                  a.staff.localeCompare(b.staff),
              )
              .map((a) => (
                <tr key={a.id}>
                  <td>{dateLabel(a.date)}</td>
                  <td>{state.staff.find((s) => s.id === a.staff)?.name}</td>
                  <td>{state.roles.find((r) => r.id === a.role)?.name}</td>
                  <td>{hm(a.start)}</td>
                  <td>{hm(a.end)}</td>
                  <td>{breakLabel(a) || "なし"}</td>
                  <td>{paidHours(a)}h</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <Tabs.Root defaultValue="timeline">
        <Tabs.List className="tabs no-print" aria-label="シフト表示">
          <Tabs.Trigger value="timeline">1日の配置</Tabs.Trigger>
          <Tabs.Trigger value="calendar">週・日カレンダー</Tabs.Trigger>
          <Tabs.Trigger value="table">スタッフ別一覧</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="timeline">
          <DayTimeline state={state} period={period} candidate={c} onEdit={E} />
        </Tabs.Content>
        <Tabs.Content value="calendar">
          <WeekTimeline
            state={state}
            period={period}
            candidate={c}
            onEdit={E}
          />
        </Tabs.Content>
        <Tabs.Content value="table">
          <div className="table-scroll">
            <table className="shift-table">
              <thead>
                <tr>
                  <th>スタッフ</th>
                  {dates(period).map((d) => (
                    <th key={d}>{dateLabel(d)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.staff.map((s) => (
                  <tr key={s.id}>
                    <th>{s.name}</th>
                    {dates(period).map((d) => (
                      <td key={d}>
                        {c.assignments
                          .filter((a) => a.staff === s.id && a.date === d)
                          .map((a) => (
                            <button
                              key={a.id}
                              className="shift-cell"
                              onClick={() => E(a)}
                            >
                              {hm(a.start)}–{hm(a.end)}
                              {breakLabel(a) && (
                                <small>休憩 {breakLabel(a)}</small>
                              )}
                              <small>
                                {state.roles.find((r) => r.id === a.role)?.name}
                              </small>
                            </button>
                          ))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tabs.Content>
      </Tabs.Root>
      <LaborChart state={state} candidate={c} />
      <h3>スタッフごとの勤務時間</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>スタッフ</th>
              <th>勤務時間</th>
              <th>希望時間（期間換算）</th>
              <th>希望との差</th>
              <th>最大連勤</th>
            </tr>
          </thead>
          <tbody>
            {c.metrics.summary.map((s) => (
              <tr key={s.staff}>
                <td>
                  {s.name}
                  {s.zero_reason && (
                    <small className="zero-reason">{s.zero_reason}</small>
                  )}
                </td>
                <td>{s.hours}h</td>
                <td>{s.target}h</td>
                <td>
                  {s.difference > 0 ? "+" : ""}
                  {s.difference}h
                </td>
                <td>{s.consecutive}日</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small-text">
        求解結果: {c.solver} /
        優先希望枠＝「できれば入りたい」への割当比率（通常の勤務可能枠は含みません）。提出時間外の勤務は保存できません。希望時間との差は実働時間で比較します。
      </p>
      <footer className="toolbar spread no-print">
        <div className="row">
          <a
            className="button"
            href={"/api/candidates/" + c.id + "/csv"}
            download
          >
            <Download size={16} />
            CSV出力
          </a>
          <button onClick={() => window.print()}>
            <Printer size={16} />
            印刷
          </button>
        </div>
        {locked ? (
          <button
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  "確定を解除して再編集します。スタッフの確定シフト表示も一時的に非表示になります。",
                )
              )
                action(async () =>
                  onState(
                    await api("/periods/" + period.id + "/reopen", "POST", {
                      version: state.version,
                    }),
                  ),
                );
            }}
          >
            再編集を開始
          </button>
        ) : (
          <button className="primary" disabled={busy} onClick={() => C(true)}>
            この案を確定する
          </button>
        )}
      </footer>
      {locked && (
        <p className="success-text">
          確定者: {period.confirmed_by} /{" "}
          {new Date(period.confirmed_at!).toLocaleString("ja-JP")}
        </p>
      )}
      {edit && (
        <Modal
          title={locked ? "勤務の詳細" : "勤務を編集"}
          onClose={() => E(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action(() =>
                save(
                  c.assignments.some((a) => a.id === edit.id)
                    ? c.assignments.map((a) => (a.id === edit.id ? edit : a))
                    : [...c.assignments, edit],
                ),
              );
            }}
          >
            <fieldset disabled={locked || busy}>
              <Field label="スタッフ">
                <select
                  value={edit.staff}
                  onChange={(e) =>
                    E({
                      ...edit,
                      staff: e.target.value,
                      role:
                        state.staff.find((s) => s.id === e.target.value)!
                          .roles[0] || "",
                    })
                  }
                >
                  {state.staff
                    .filter((s) => s.active)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="役割">
                <select
                  required
                  value={edit.role}
                  onChange={(e) => E({ ...edit, role: e.target.value })}
                >
                  {state.roles
                    .filter((r) =>
                      state.staff
                        .find((s) => s.id === edit.staff)
                        ?.roles.includes(r.id),
                    )
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="勤務日">
                <input
                  type="date"
                  required
                  min={period.start}
                  max={period.end}
                  value={edit.date}
                  onChange={(e) => E({ ...edit, date: e.target.value })}
                />
              </Field>
              <div className="row">
                <Time
                  label="勤務開始"
                  value={edit.start}
                  onChange={(start) => E({ ...edit, start })}
                />
                〜
                <Time
                  label="勤務終了"
                  value={edit.end}
                  onChange={(end) => E({ ...edit, end })}
                />
              </div>
              <h3>休憩（無給・15分単位）</h3>
              <p className="muted small-text">
                勤務の途中に配置してください。必要な休憩がない勤務や、提出希望の時間外の勤務は保存できません。
              </p>
              {(edit.breaks || []).map((b, i) => (
                <div className="condition-row" key={i}>
                  <Time
                    label="休憩開始"
                    step={15}
                    value={b.start}
                    onChange={(start) =>
                      E({
                        ...edit,
                        breaks: (edit.breaks || []).map((r, j) =>
                          j === i ? { ...r, start } : r,
                        ),
                      })
                    }
                  />
                  <Time
                    label="休憩終了"
                    step={15}
                    value={b.end}
                    onChange={(end) =>
                      E({
                        ...edit,
                        breaks: (edit.breaks || []).map((r, j) =>
                          j === i ? { ...r, end } : r,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    onClick={() =>
                      E({
                        ...edit,
                        breaks: (edit.breaks || []).filter((_, j) => j !== i),
                      })
                    }
                  >
                    休憩を削除
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  const start = Math.floor((edit.start + edit.end) / 30) * 15;
                  E({
                    ...edit,
                    breaks: [
                      ...(edit.breaks || []),
                      { start, end: start + 45 },
                    ],
                  });
                }}
              >
                休憩を追加
              </button>
              <p>
                実働 {paidHours(edit)}時間 / 休憩{" "}
                {(edit.breaks || []).reduce((n, b) => n + b.end - b.start, 0)}分
              </p>
            </fieldset>
            {editError && (
              <p className="error" role="alert">
                {editError}
              </p>
            )}
            <p className="notice">割当理由：{edit.reason}</p>
            {!locked && (
              <footer className="spread">
                <button
                  type="button"
                  className="danger-text"
                  disabled={busy}
                  onClick={() =>
                    action(() =>
                      save(c.assignments.filter((a) => a.id !== edit.id)),
                    )
                  }
                >
                  勤務を削除
                </button>
                <button className="primary" disabled={busy}>
                  変更を保存
                </button>
              </footer>
            )}
          </form>
        </Modal>
      )}
      {confirm && (
        <Modal title="シフトを確定しますか" onClose={() => C(false)}>
          <p>
            確定すると編集がロックされ、スタッフ本人の画面にシフトが表示されます。
          </p>
          <div className={c.metrics.hard ? "error" : "notice"}>
            重大違反 {c.metrics.hard}件 / 人数不足 {c.metrics.missing_slots}枠
          </div>
          <p>
            人数不足・希望との差を確認してください。重大な違反がある案は確定できません。
          </p>
          <Field label="確定者名">
            <input value={name} onChange={(e) => N(e.target.value)} />
          </Field>
          <footer>
            <button
              className="primary"
              disabled={busy || c.metrics.hard > 0 || !name.trim()}
              onClick={() =>
                action(async () => {
                  onState(
                    await api("/candidates/" + c.id + "/confirm", "POST", {
                      version: state.version,
                      name,
                    }),
                  );
                  C(false);
                })
              }
            >
              確認して確定
            </button>
          </footer>
        </Modal>
      )}
    </>
  );
}
