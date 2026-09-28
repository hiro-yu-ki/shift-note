import { useEffect, useState } from "react";
import { api, weekdays, type Staff, type Block } from "./types";
import { Field, Num, Time } from "./ui";
import { ContractFields } from "./ContractFields";
type Preview = {
  patch: Partial<Staff>;
  interpreted: string[];
  errors: { line: number; text: string; message: string }[];
  can_apply: boolean;
  notice: string;
};
export function StaffConditions({
  staff: s,
  onChange: set,
}: {
  staff: Staff;
  onChange: (s: Staff) => void;
}) {
  const [preview, P] = useState<Preview | null>(null),
    [busy, B] = useState(false),
    [error, E] = useState("");
  const [ai, A] = useState(false),
    [consent, C] = useState(false),
    [configured, K] = useState(false);
  useEffect(() => {
    api<{ ai_configured: boolean }>("/conditions/status")
      .then((v) => K(v.ai_configured))
      .catch(() => K(false));
  }, []);
  const updateRegular = (index: number, patch: Partial<Block>) =>
    set({
      ...s,
      regular: (s.regular || []).map((r, i) =>
        i === index ? { ...r, ...patch } : r,
      ),
    });
  return (
    <section className="staff-conditions">
      <ContractFields staff={s} onChange={set} />
      <h3>基本の曜日・時間帯</h3>
      <p className="muted">
        毎週の勤務パターンです。提出済みの希望と重なる時間だけを割り当てます。従業員は希望入力時にこのパターンを読み込めます。
      </p>
      {(s.regular || []).map((r, i) => (
        <div className="condition-row" key={i}>
          <Field label="基本の曜日">
            <select
              value={r.weekday}
              onChange={(e) =>
                updateRegular(i, { weekday: Number(e.target.value) })
              }
            >
              {weekdays.map((d, n) => (
                <option key={d} value={n}>
                  {d}曜日
                </option>
              ))}
            </select>
          </Field>
          <Time
            label="基本の開始"
            value={r.start}
            onChange={(start) => updateRegular(i, { start })}
          />
          <Time
            label="基本の終了"
            value={r.end}
            onChange={(end) => updateRegular(i, { end })}
          />
          <button
            type="button"
            onClick={() =>
              set({
                ...s,
                regular: (s.regular || []).filter((_, j) => j !== i),
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
          set({
            ...s,
            regular: [
              ...(s.regular || []),
              { weekday: 0, start: 600, end: 1020 },
            ],
          })
        }
      >
        曜日・時間帯を追加
      </button>
      <label className="check">
        <input
          type="checkbox"
          checked={s.regular_only || false}
          onChange={(e) => set({ ...s, regular_only: e.target.checked })}
        />
        この曜日・時間帯だけに限定する
      </label>
      <p className="muted small-text">
        限定しない場合は通常の希望として優先します。基本パターンだけでは提出扱いになりません。
      </p>
      <div className="form-grid">
        <Num
          label="週の最大勤務日数"
          min={1}
          max={7}
          value={s.max_days_week ?? 7}
          onChange={(max_days_week) => set({ ...s, max_days_week })}
        />
        <Num
          label="期間の最低希望日数（優先条件）"
          min={0}
          max={31}
          value={s.min_shifts_period ?? 0}
          onChange={(min_shifts_period) => set({ ...s, min_shifts_period })}
        />
        <Time
          label="最も早い出勤時刻"
          value={s.earliest_start ?? 0}
          onChange={(earliest_start) => set({ ...s, earliest_start })}
        />
        <Time
          label="最も遅い退勤時刻"
          value={s.latest_end ?? 1440}
          onChange={(latest_end) => set({ ...s, latest_end })}
        />
      </div>
      <h3>文章から勤務条件を入力</h3>
      <p className="muted">
        1行に1条件を記入し、読み取り結果を確認して反映します。読み取れない行がある場合は反映しません。
      </p>
      <details>
        <summary>入力できる書式を見る</summary>
        <pre className="condition-example">
          {
            "基本: 月、水、金 10:00-17:00\n固定: 月、水 10:00-17:00\n限定: 火、木 12:00-18:00\n不可: 土、日 00:00-24:00\n時給: 1200円\n週の希望: 20時間\n週の最低: 6時間\n週の上限: 28時間\n期間の上限: 100時間\n最短勤務: 3時間\n1日の上限: 8時間\n連勤上限: 4日\n勤務間隔: 11時間\n週の最大日数: 4日\n期間の最低日数: 2日\n最早開始: 09:00\n最遅終了: 20:00"
          }
        </pre>
        <p>
          「固定」は契約上の固定勤務を、「基本・限定」は既存の基本パターンを、「不可」は固定の勤務不可を置き換えます。書いていない項目は保持します。
        </p>
      </details>
      <Field label="読み取る勤務条件">
        <textarea
          rows={5}
          value={s.condition_text || ""}
          placeholder="例：基本: 月、水、金 10:00-17:00"
          onChange={(e) => {
            set({
              ...s,
              condition_text: e.target.value,
              condition_reviewed_text: "",
            });
            P(null);
          }}
        />
      </Field>
      <Field label="読み取り方法">
        <select
          value={ai ? "ai" : "local"}
          onChange={(e) => {
            A(e.target.value === "ai");
            C(false);
            P(null);
          }}
        >
          <option value="local">書式解析（外部送信なし）</option>
          <option value="ai" disabled={!configured}>
            AIで日本語を読み取る{!configured ? "（未設定）" : ""}
          </option>
        </select>
      </Field>
      {!configured && (
        <p className="muted small-text">
          自由な日本語を読むAI連携は未設定です。書式解析はAPIキーなしで使えます。
        </p>
      )}
      {ai && (
        <label className="check">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => C(e.target.checked)}
          />
          上の条件文をOpenAIへ送信することを確認しました。氏名など不要な情報は文中から除いてください。スタッフ登録情報は送信しません。
        </label>
      )}
      <button
        type="button"
        disabled={busy || !s.condition_text?.trim() || (ai && !consent)}
        onClick={async () => {
          B(true);
          E("");
          try {
            P(
              await api<Preview>("/conditions/preview", "POST", {
                text: s.condition_text,
                use_ai: ai,
                consent,
              }),
            );
          } catch (e) {
            E((e as Error).message);
          } finally {
            B(false);
          }
        }}
      >
        条件を読み取る
      </button>
      {preview && (
        <div className="condition-preview">
          <p>{preview.notice}</p>
          <ul>
            {preview.interpreted.map((v, i) => (
              <li key={i}>{v}</li>
            ))}
          </ul>
          {preview.errors.map((e, i) => (
            <p className="error" key={i}>
              {e.line}行目「{e.text}」：{e.message}
            </p>
          ))}
          <button
            type="button"
            className="primary"
            disabled={!preview.can_apply}
            onClick={() => {
              set({
                ...s,
                ...preview.patch,
                condition_reviewed_text: s.condition_text,
              });
              P(null);
            }}
          >
            確認して勤務条件に反映
          </button>
        </div>
      )}
      {s.condition_text?.trim() && (
        <p className="muted">
          {s.condition_text === s.condition_reviewed_text
            ? "読み取り結果を反映済みです。スタッフを保存すると有効になります。"
            : "未確認の文章条件があります。自動作成の前に確認・反映してください。"}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <h3>追加の記録項目</h3>
      <p className="muted small-text">
        任意の項目を追加できます。ここは記録用です。自動作成の条件には上の設定を使用してください。
      </p>
      {Object.entries(s.extra_fields || {}).map(([key, value]) => (
        <Field label={key} key={key}>
          <div className="row">
            <input
              value={value}
              maxLength={300}
              onChange={(e) =>
                set({
                  ...s,
                  extra_fields: { ...s.extra_fields, [key]: e.target.value },
                })
              }
            />
            <button
              type="button"
              onClick={() => {
                const next = { ...s.extra_fields };
                delete next[key];
                set({ ...s, extra_fields: next });
              }}
            >
              削除
            </button>
          </div>
        </Field>
      ))}
      <button
        type="button"
        onClick={() => {
          const key = window.prompt("追加する項目名（記録用）");
          if (key?.trim() && key.length <= 60)
            set({
              ...s,
              extra_fields: { ...s.extra_fields, [key.trim()]: "" },
            });
        }}
      >
        記録項目を追加
      </button>
    </section>
  );
}
