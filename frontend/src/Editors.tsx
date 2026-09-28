import { useState } from "react";
import { StaffConditions } from "./StaffConditions";
import { Field, Num, Time } from "./ui";
import {
  uid,
  weekdays,
  type Staff,
  type State,
  type Period,
  type Requirement,
} from "./types";

export function StaffEditor({
  state,
  initial,
  save,
}: {
  state: State;
  initial?: Staff;
  save: (s: Staff) => Promise<void>;
}) {
  const [s, set] = useState<Staff>(
    initial || {
      id: uid(),
      name: "",
      display: "",
      roles: [],
      skills: "",
      active: true,
      target: 20,
      minimum: 0,
      maximum: 30,
      period_max: 120,
      day_min: 3,
      day_max: 8,
      consecutive: 5,
      interval: 11,
      blocks: [],
      notes: "",
    },
  );
  const [error, E] = useState("");
  const [busy, B] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        B(true);
        try {
          await save(s);
        } catch (e) {
          E((e as Error).message);
        } finally {
          B(false);
        }
      }}
    >
      <div className="form-grid">
        <Field label="氏名">
          <input
            required
            maxLength={60}
            value={s.name}
            onChange={(e) => set({ ...s, name: e.target.value })}
          />
        </Field>
        <Field label="表示名">
          <input
            value={s.display}
            onChange={(e) => set({ ...s, display: e.target.value })}
          />
        </Field>
      </div>
      <Field label="担当を許可する役割">
        <div className="checks">
          {state.roles.map((r) => (
            <label key={r.id}>
              <input
                type="checkbox"
                checked={s.roles.includes(r.id)}
                onChange={(e) =>
                  set({
                    ...s,
                    roles: e.target.checked
                      ? [...s.roles, r.id]
                      : s.roles.filter((x) => x !== r.id),
                  })
                }
              />
              {r.name}
            </label>
          ))}
        </div>
      </Field>
      <p className="muted small-text">
        チェックした役割だけを担当できます。責任者などの役割も、許可のないスタッフには割り当てられません。
      </p>
      <Field label="保有スキル（記録用。割当資格は役割に登録）">
        <input
          value={s.skills}
          onChange={(e) => set({ ...s, skills: e.target.value })}
        />
      </Field>
      <div className="form-grid">
        {(
          [
            ["target", "週の希望時間", 0, 168, 1],
            ["minimum", "週の最低希望時間", 0, 168, 1],
            ["maximum", "週の上限時間", 1, 168, 1],
            ["period_max", "期間の上限時間", 1, 744, 1],
            ["day_min", "1勤務の最短時間", 0.25, 24, 0.25],
            ["day_max", "1日の上限時間", 0.25, 24, 0.25],
            ["consecutive", "連勤上限（日）", 1, 14, 1],
            ["interval", "勤務間隔（時間）", 0, 48, 1],
          ] as const
        ).map(([key, label, min, max, step]) => (
          <Num
            key={key}
            label={label}
            value={s[key]}
            min={min}
            max={max}
            step={step}
            onChange={(n) => set({ ...s, [key]: n })}
          />
        ))}
      </div>
      <Field label="固定の勤務不可">
        <div>
          {s.blocks.map((b, i) => (
            <div className="row" key={i}>
              <select
                aria-label="勤務不可の曜日"
                value={b.weekday}
                onChange={(e) =>
                  set({
                    ...s,
                    blocks: s.blocks.map((x, j) =>
                      i === j ? { ...x, weekday: Number(e.target.value) } : x,
                    ),
                  })
                }
              >
                {weekdays.map((w, n) => (
                  <option value={n} key={w}>
                    {w}
                  </option>
                ))}
              </select>
              <Time
                label="勤務不可の開始"
                value={b.start}
                onChange={(start) =>
                  set({
                    ...s,
                    blocks: s.blocks.map((x, j) =>
                      i === j ? { ...x, start } : x,
                    ),
                  })
                }
              />
              <Time
                label="勤務不可の終了"
                value={b.end}
                onChange={(end) =>
                  set({
                    ...s,
                    blocks: s.blocks.map((x, j) =>
                      i === j ? { ...x, end } : x,
                    ),
                  })
                }
              />
              <button
                type="button"
                onClick={() =>
                  set({ ...s, blocks: s.blocks.filter((_, j) => j !== i) })
                }
              >
                削除
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              set({
                ...s,
                blocks: [...s.blocks, { weekday: 0, start: 0, end: 1440 }],
              })
            }
          >
            勤務不可を追加
          </button>
        </div>
      </Field>
      <StaffConditions staff={s} onChange={set} />
      <Field label="詳細な備考（記録用・自動作成には反映しません）">
        <textarea
          value={s.notes}
          onChange={(e) => set({ ...s, notes: e.target.value })}
        />
      </Field>
      <h3>
        給与契約 <small>管理者・本人のみ</small>
      </h3>
      <p className="muted">
        未登録の時給は概算に含めません。控除・割増賃金はこの概算の対象外です。
      </p>
      <div className="form-grid">
        <Field label="時給（円）">
          <input
            type="number"
            min={0}
            max={100000}
            value={s.hourly_rate ?? ""}
            placeholder="未登録"
            onChange={(e) =>
              set({
                ...s,
                hourly_rate:
                  e.target.value === "" ? null : Number(e.target.value),
              })
            }
          />
        </Field>
        <Num
          label="出勤日ごとの交通費（円）"
          value={s.transport_per_day ?? 0}
          max={100000}
          onChange={(transport_per_day) => set({ ...s, transport_per_day })}
        />
        <Num
          label="締め日（31＝月末）"
          min={1}
          max={31}
          value={s.closing_day ?? 31}
          onChange={(closing_day) => set({ ...s, closing_day })}
        />
        <Num
          label="支払日（31＝月末）"
          min={1}
          max={31}
          value={s.payday ?? 25}
          onChange={(payday) => set({ ...s, payday })}
        />
        <Field label="支払月">
          <select
            value={s.pay_month_offset ?? 1}
            onChange={(e) =>
              set({ ...s, pay_month_offset: Number(e.target.value) })
            }
          >
            <option value={0}>締め月の当月</option>
            <option value={1}>締め月の翌月</option>
            <option value={2}>締め月の翌々月</option>
          </select>
        </Field>
        <Num
          label="1日の無給休憩（分）"
          max={240}
          step={15}
          value={s.unpaid_break_minutes ?? 0}
          onChange={(unpaid_break_minutes) =>
            set({ ...s, unpaid_break_minutes })
          }
        />
        <Num
          label="個別休憩を付ける拘束時間以上（時間）"
          max={24}
          step={0.25}
          value={s.break_after_hours ?? 6}
          onChange={(break_after_hours) => set({ ...s, break_after_hours })}
        />
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={s.active}
          onChange={(e) => set({ ...s, active: e.target.checked })}
        />
        在籍中
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <footer>
        <button className="primary" disabled={busy}>
          スタッフを保存
        </button>
      </footer>
    </form>
  );
}

export function PeriodEditor({
  state,
  initial,
  save,
}: {
  state: State;
  initial?: Period;
  save: (p: Period, copy: string) => Promise<void>;
}) {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const [p, set] = useState<Period>(
    initial || {
      id: uid(),
      start: tomorrow,
      end: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
      deadline: new Date(Date.now() + 86400000).toISOString(),
      status: "募集中",
      special: [],
      selected: null,
      confirmed_at: null,
      confirmed_by: null,
    },
  );
  const [copy, C] = useState("");
  const [error, E] = useState("");
  const [busy, B] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        B(true);
        try {
          await save(p, copy);
        } catch (e) {
          E((e as Error).message);
        } finally {
          B(false);
        }
      }}
    >
      <div className="form-grid">
        <Field label="開始日">
          <input
            type="date"
            required
            value={p.start}
            onChange={(e) => set({ ...p, start: e.target.value })}
          />
        </Field>
        <Field label="終了日">
          <input
            type="date"
            required
            min={p.start}
            value={p.end}
            onChange={(e) => set({ ...p, end: e.target.value })}
          />
        </Field>
      </div>
      <Field label="提出締切（日本時間）">
        <input
          type="datetime-local"
          required
          value={new Date(new Date(p.deadline).getTime() + 9 * 3600000)
            .toISOString()
            .slice(0, 16)}
          onChange={(e) =>
            e.target.value &&
            set({ ...p, deadline: e.target.value + ":00+09:00" })
          }
        />
      </Field>
      {!initial && (
        <Field label="前期間の曜日条件を複製">
          <select value={copy} onChange={(e) => C(e.target.value)}>
            <option value="">複製しない</option>
            {state.periods.map((x) => (
              <option key={x.id} value={x.id}>
                {x.start} 〜 {x.end}
              </option>
            ))}
          </select>
        </Field>
      )}
      <h3>日ごとの営業時間・休業</h3>
      {p.special.map((s, i) => (
        <div className="special-row" key={i}>
          <input
            aria-label="特別営業日"
            type="date"
            required
            min={p.start}
            max={p.end}
            value={s.date}
            onChange={(e) =>
              set({
                ...p,
                special: p.special.map((x, j) =>
                  i === j ? { ...x, date: e.target.value } : x,
                ),
              })
            }
          />
          <Time
            label="特別営業の開始"
            value={s.start}
            onChange={(start) =>
              set({
                ...p,
                special: p.special.map((x, j) =>
                  i === j ? { ...x, start } : x,
                ),
              })
            }
          />
          <Time
            label="特別営業の終了"
            value={s.end}
            onChange={(end) =>
              set({
                ...p,
                special: p.special.map((x, j) => (i === j ? { ...x, end } : x)),
              })
            }
          />
          <label className="check">
            <input
              type="checkbox"
              checked={s.closed}
              onChange={(e) =>
                set({
                  ...p,
                  special: p.special.map((x, j) =>
                    i === j ? { ...x, closed: e.target.checked } : x,
                  ),
                })
              }
            />
            休業
          </label>
          <button
            type="button"
            onClick={() =>
              set({ ...p, special: p.special.filter((_, j) => i !== j) })
            }
          >
            削除
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          set({
            ...p,
            special: [
              ...p.special,
              {
                date: p.start,
                start: state.store!.start,
                end: state.store!.end,
                closed: false,
              },
            ],
          })
        }
      >
        特別営業日を追加
      </button>
      <h3>同じ時間に勤務してほしい組み合わせ</h3>
      <p className="muted">
        教育担当と新人などの組み合わせを、可能な範囲で優先します。
      </p>
      {(p.pairs || []).map((pair, i) => (
        <div className="special-row" key={i}>
          {(["first", "second"] as const).map((key) => (
            <select
              key={key}
              aria-label={`組み合わせ ${i + 1} ${key === "first" ? "1人目" : "2人目"}`}
              value={pair[key]}
              onChange={(e) =>
                set({
                  ...p,
                  pairs: p.pairs!.map((x, j) =>
                    i === j ? { ...x, [key]: e.target.value } : x,
                  ),
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
          ))}
          <Num
            label="優先度"
            value={pair.weight}
            min={1}
            max={100}
            onChange={(weight) =>
              set({
                ...p,
                pairs: p.pairs!.map((x, j) => (i === j ? { ...x, weight } : x)),
              })
            }
          />
          <button
            type="button"
            onClick={() =>
              set({ ...p, pairs: p.pairs!.filter((_, j) => i !== j) })
            }
          >
            組み合わせを削除
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={state.staff.filter((s) => s.active).length < 2}
        onClick={() => {
          const active = state.staff.filter((s) => s.active);
          set({
            ...p,
            pairs: [
              ...(p.pairs || []),
              { first: active[0].id, second: active[1].id, weight: 5 },
            ],
          });
        }}
      >
        組み合わせを追加
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <button className="primary" disabled={busy}>
          期間を保存
        </button>
      </footer>
    </form>
  );
}

export function RequirementEditor({
  state,
  period,
  initial,
  save,
}: {
  state: State;
  period: Period;
  initial?: Requirement;
  save: (r: Requirement) => Promise<void>;
}) {
  const [r, set] = useState<Requirement>(
    initial || {
      id: uid(),
      period: period.id,
      weekday: 0,
      date: null,
      start: state.store!.start,
      end: state.store!.end,
      total: 2,
      roles: {},
      hard: false,
    },
  );
  const [error, E] = useState("");
  const [busy, B] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        E("");
        if (r.end <= r.start) {
          E("終了時刻は開始時刻より後にしてください");
          return;
        }
        if (Object.values(r.roles).reduce((a, b) => a + b, 0) > r.total) {
          E("役割人数の合計は必要人数以下にしてください");
          return;
        }
        B(true);
        try {
          await save(r);
        } catch (e) {
          E((e as Error).message);
        } finally {
          B(false);
        }
      }}
    >
      <Field label="適用する日">
        <select
          value={r.date ? "date" : r.weekday}
          onChange={(e) =>
            set({
              ...r,
              date: e.target.value === "date" ? period.start : null,
              weekday: e.target.value === "date" ? 0 : Number(e.target.value),
            })
          }
        >
          {weekdays.map((w, i) => (
            <option value={i} key={w}>
              毎週{w}曜日
            </option>
          ))}
          <option value="date">特定日の上書き</option>
        </select>
      </Field>
      {r.date && (
        <Field label="日付">
          <input
            type="date"
            min={period.start}
            max={period.end}
            value={r.date}
            onChange={(e) => set({ ...r, date: e.target.value })}
          />
        </Field>
      )}
      <p className="muted">
        特定日を設定すると、その日の曜日テンプレート全体を置き換えます。必要な時間帯をすべて登録してください。
      </p>
      <div className="form-grid">
        <Field label="開始">
          <Time
            label="必要人数の開始"
            value={r.start}
            onChange={(start) => set({ ...r, start })}
          />
        </Field>
        <Field label="終了">
          <Time
            label="必要人数の終了"
            value={r.end}
            onChange={(end) => set({ ...r, end })}
          />
        </Field>
      </div>
      <Num
        label="必要人数（合計）"
        value={r.total}
        max={30}
        onChange={(total) => set({ ...r, total })}
      />
      <h3>役割ごとの内訳</h3>
      <p className="muted">1人が同じ時間に担当する役割は1つです。</p>
      <div className="form-grid">
        {state.roles.map((x) => (
          <Num
            key={x.id}
            label={x.name + "の必要人数"}
            value={r.roles[x.id] || 0}
            max={30}
            onChange={(n) => set({ ...r, roles: { ...r.roles, [x.id]: n } })}
          />
        ))}
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={r.hard}
          onChange={(e) => set({ ...r, hard: e.target.checked })}
        />
        役割人数を必須にする（不足があると確定不可）
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <button className="primary" disabled={busy}>
          条件を保存
        </button>
      </footer>
    </form>
  );
}
