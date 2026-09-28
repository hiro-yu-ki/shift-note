import { weekdays, type Staff, type Block } from "./types";
import { Field, Time } from "./ui";
export function ContractFields({
  staff: s,
  onChange: set,
}: {
  staff: Staff;
  onChange: (s: Staff) => void;
}) {
  const update = (i: number, patch: Partial<Block>) =>
    set({
      ...s,
      fixed_shifts: s.fixed_shifts!.map((b, j) =>
        i === j ? { ...b, ...patch } : b,
      ),
    });
  return (
    <section className="contract-fields">
      <h3>契約と固定勤務</h3>
      <Field label="雇用区分">
        <select
          value={s.employment_type || "未設定"}
          onChange={(e) =>
            set({
              ...s,
              employment_type: e.target.value as Staff["employment_type"],
            })
          }
        >
          {["未設定", "社員", "派遣", "パート", "アルバイト", "その他"].map(
            (t) => (
              <option key={t}>{t}</option>
            ),
          )}
        </select>
      </Field>
      <p className="muted">
        区分だけで条件を決めません。勤務上限・曜日・時間は、その人の契約に合わせて登録します。給与見込みは現在、登録時給での概算です。
      </p>
      {(s.fixed_shifts || []).map((r, i) => (
        <div className="condition-row" key={i}>
          <Field label="固定勤務の曜日">
            <select
              value={r.weekday}
              onChange={(e) => update(i, { weekday: Number(e.target.value) })}
            >
              {weekdays.map((d, n) => (
                <option key={d} value={n}>
                  {d}曜日
                </option>
              ))}
            </select>
          </Field>
          <Time
            label="固定勤務の開始"
            value={r.start}
            onChange={(start) => update(i, { start })}
          />
          <Time
            label="固定勤務の終了"
            value={r.end}
            onChange={(end) => update(i, { end })}
          />
          <button
            type="button"
            onClick={() =>
              set({
                ...s,
                fixed_shifts: s.fixed_shifts!.filter((_, j) => i !== j),
              })
            }
          >
            固定勤務を削除
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={(s.fixed_shifts || []).length >= 7}
        onClick={() =>
          set({
            ...s,
            fixed_shifts: [
              ...(s.fixed_shifts || []),
              {
                weekday:
                  [0, 1, 2, 3, 4, 5, 6].find(
                    (d) => !(s.fixed_shifts || []).some((b) => b.weekday === d),
                  ) ?? 0,
                start: 600,
                end: 1080,
              },
            ],
          })
        }
      >
        契約上の固定勤務を追加
      </button>
      <p className="muted small-text">
        固定勤務は必須条件です。休憩を含む開始・終了時刻を指定します。本人の提出希望に含まれない場合は作成を止めます。合意済みの日は除外日を登録してください。除外日は固定勤務の義務だけを解除します。休む日は提出希望も勤務不可にしてください。
      </p>
      {(s.fixed_exceptions || []).map((d, i) => (
        <div className="row" key={i}>
          <Field label="固定勤務の除外日">
            <input
              type="date"
              required
              value={d}
              onChange={(e) =>
                set({
                  ...s,
                  fixed_exceptions: s.fixed_exceptions!.map((v, j) =>
                    j === i ? e.target.value : v,
                  ),
                })
              }
            />
          </Field>
          <button
            type="button"
            onClick={() =>
              set({
                ...s,
                fixed_exceptions: s.fixed_exceptions!.filter((_, j) => j !== i),
              })
            }
          >
            除外日を削除
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          set({ ...s, fixed_exceptions: [...(s.fixed_exceptions || []), ""] })
        }
      >
        固定勤務の除外日を追加
      </button>
    </section>
  );
}
