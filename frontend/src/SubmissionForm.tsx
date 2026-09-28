import { useEffect, useState } from "react";
import { Plus, Trash2, Check, ArrowRight } from "lucide-react";
import {
  dates,
  dateLabel,
  weekday,
  weekdays,
  hm,
  type Period,
  type Store,
  type Submission,
  type Slot,
  type Block,
} from "./types";
import { Field, Num, Time, Modal } from "./ui";
import { MonthCalendar } from "./MonthCalendar";

export function SubmissionForm({
  period,
  store,
  initial,
  staff,
  onSave,
  locked = false,
}: {
  period: Period;
  store: Store;
  initial: Submission | null;
  staff: {
    id: string;
    target: number;
    regular?: Block[];
    fixed_shifts?: Block[];
    fixed_exceptions?: string[];
  };
  onSave: (s: Submission) => Promise<void>;
  locked?: boolean;
}) {
  const [form, F] = useState<Submission>(
    initial || {
      staff: staff.id,
      period: period.id,
      status: "下書き",
      target: staff.target,
      notes: "",
      updated_at: "",
      slots: [],
    },
  );
  const [day, D] = useState<string | null>(null);
  const [error, E] = useState("");
  const [busy, B] = useState(false);
  const [dirty, Q] = useState(false);
  const [message, M] = useState("");
  useEffect(() => {
    const listener = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, [dirty]);
  const update = (next: Submission) => {
    F(next);
    Q(true);
    M("");
  };
  const save = async (status: Submission["status"]) => {
    B(true);
    E("");
    try {
      await onSave({ ...form, status });
      F({ ...form, status });
      Q(false);
      M(
        status === "提出済み"
          ? "希望を提出しました。締切までは変更できます。"
          : "下書きを保存しました。",
      );
    } catch (e) {
      E((e as Error).message);
    } finally {
      B(false);
    }
  };
  const entered = new Set(form.slots.map((s) => s.date)).size;
  const possible = form.slots.filter((s) => s.kind !== "勤務不可");
  const hours = possible.reduce((n, s) => n + (s.end - s.start) / 60, 0);
  return (
    <div className="request-workspace">
      <div className="request-calendar">
        {!!staff.fixed_shifts?.length && (
          <div className="regular-import">
            <p>
              契約上の固定勤務：
              {staff.fixed_shifts
                .map(
                  (b) => `${weekdays[b.weekday]} ${hm(b.start)}–${hm(b.end)}`,
                )
                .join(" / ")}
            </p>
            {!locked && (
              <button
                type="button"
                onClick={() => {
                  const newSlots: Slot[] = dates(period)
                    .filter(
                      (d) =>
                        !form.slots.some((s) => s.date === d) &&
                        !(staff.fixed_exceptions || []).includes(d),
                    )
                    .flatMap((date) =>
                      (staff.fixed_shifts || [])
                        .filter((b) => b.weekday === weekday(date))
                        .map((b) => ({
                          date,
                          start: b.start,
                          end: b.end,
                          kind: "勤務可能" as const,
                        })),
                    );
                  update({ ...form, slots: [...form.slots, ...newSlots] });
                }}
              >
                固定勤務を未入力日に入れる
              </button>
            )}
            <small>
              内容を確認してから提出してください。入力済みの日は変更しません。変更が必要な場合は管理者へ相談してください。
            </small>
          </div>
        )}
        {!!staff.regular?.length && !locked && (
          <div className="regular-import">
            <button
              type="button"
              onClick={() => {
                const newSlots: Slot[] = dates(period)
                  .filter((d) => !form.slots.some((s) => s.date === d))
                  .flatMap((d) =>
                    (staff.regular || [])
                      .filter((b) => b.weekday === weekday(d))
                      .map((b) => ({
                        date: d,
                        start: Math.ceil(b.start / store.step) * store.step,
                        end: Math.floor(b.end / store.step) * store.step,
                        kind: "勤務可能" as const,
                      })),
                  )
                  .filter((s) => s.end > s.start);
                update({ ...form, slots: [...form.slots, ...newSlots] });
              }}
            >
              基本の曜日・時間帯を未入力日に入れる
            </button>
            <small>
              入力済みの日は変更しません。日付ごとに確認して提出してください。
            </small>
          </div>
        )}
        <MonthCalendar
          key={period.id}
          start={period.start}
          end={period.end}
          selected={day || undefined}
          onSelect={(d) => D(d)}
          caption={
            locked
              ? "入力期間は終了しています。"
              : "日付を押して、勤務できる時間を入力してください。"
          }
          renderDay={(d) => {
            const slots = form.slots.filter((s) => s.date === d);
            return slots.length ? (
              <>
                {slots.slice(0, 2).map((s, i) => (
                  <span
                    key={i}
                    className={`day-slot ${s.kind === "勤務不可" ? "unavailable" : s.kind === "できれば入りたい" ? "preferred" : "available"}`}
                  >
                    <span className="slot-kind">
                      {s.kind === "勤務不可"
                        ? "休み希望"
                        : s.kind === "できれば入りたい"
                          ? "勤務希望"
                          : "勤務可"}
                    </span>
                    {s.kind !== "勤務不可" && (
                      <span className="slot-hours">
                        {hm(s.start)}
                        <br className="mobile-break" />–{hm(s.end)}
                      </span>
                    )}
                  </span>
                ))}
                {slots.length > 2 && <small>ほか{slots.length - 2}件</small>}
              </>
            ) : (
              <span className="day-add">
                <Plus size={13} />
                <span>入力</span>
              </span>
            );
          }}
        />
        <div className="calendar-legend">
          <span>
            <i className="available" />
            勤務可能
          </span>
          <span>
            <i className="preferred" />
            できれば入りたい
          </span>
          <span>
            <i className="unavailable" />
            休み希望
          </span>
        </div>
      </div>
      <aside className="request-summary">
        <p className="section-kicker">今回の希望</p>
        <div className="request-count">
          <strong>{entered}</strong>
          <span> / {dates(period).length}日 入力済み</span>
        </div>
        <p className="plain-status">
          {dirty
            ? "未保存の変更があります"
            : form.status === "提出済み"
              ? "提出済み"
              : "下書き"}
        </p>
        <dl>
          <div>
            <dt>勤務可能な時間</dt>
            <dd>{hours}時間</dd>
          </div>
          <div>
            <dt>入力単位</dt>
            <dd>{store.step === 60 ? "1時間" : store.step + "分"}</dd>
          </div>
          <div>
            <dt>提出締切</dt>
            <dd>
              {new Date(period.deadline).toLocaleDateString("ja-JP", {
                month: "numeric",
                day: "numeric",
                timeZone: "Asia/Tokyo",
              })}
              <br />
              {new Date(period.deadline).toLocaleTimeString("ja-JP", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Asia/Tokyo",
              })}
            </dd>
          </div>
        </dl>
        <p className="muted">未入力の日は勤務できない日として扱われます。</p>
        <fieldset disabled={locked || busy}>
          <Num
            label="週に働きたい時間"
            value={form.target}
            onChange={(target) => update({ ...form, target })}
          />
          <Field label="連絡事項（任意）">
            <textarea
              placeholder="時間の相談などがあれば入力"
              value={form.notes}
              maxLength={2000}
              onChange={(e) => update({ ...form, notes: e.target.value })}
            />
          </Field>
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="inline-success" role="status">
            <Check size={16} />
            {message}
          </p>
        )}
        <div className="request-actions">
          <button
            disabled={locked || busy}
            className="primary"
            onClick={() => save("提出済み")}
          >
            {busy
              ? "保存中…"
              : form.status === "提出済み"
                ? "変更して再提出"
                : "希望を提出する"}
            <ArrowRight size={16} />
          </button>
          <button disabled={locked || busy} onClick={() => save("下書き")}>
            下書き保存
          </button>
        </div>
      </aside>
      {day && (
        <DayEditor
          day={day}
          period={period}
          store={store}
          all={form.slots}
          locked={locked}
          close={() => D(null)}
          save={(slots, copyWeek) => {
            const affected = copyWeek
              ? dates(period).filter((d) => weekday(d) === weekday(day))
              : [day];
            update({
              ...form,
              slots: [
                ...form.slots.filter((s) => !affected.includes(s.date)),
                ...affected.flatMap((d) =>
                  slots.map((s) => ({ ...s, date: d })),
                ),
              ],
            });
            D(null);
          }}
        />
      )}
    </div>
  );
}

function DayEditor({
  day,
  period,
  store,
  all,
  locked,
  save,
  close,
}: {
  day: string;
  period: Period;
  store: Store;
  all: Slot[];
  locked: boolean;
  save: (slots: Slot[], copyWeek: boolean) => void;
  close: () => void;
}) {
  const existing = all.filter((s) => s.date === day);
  const [slots, S] = useState<Slot[]>(
    existing.length
      ? existing
      : [
          {
            date: day,
            start: Math.ceil(store.start / store.step) * store.step,
            end: Math.floor(store.end / store.step) * store.step,
            kind: "勤務可能",
          },
        ],
  );
  const [error, E] = useState("");
  const [copy, C] = useState(false);
  const kind = slots[0]?.kind || "勤務可能";
  const change = (i: number, patch: Partial<Slot>) =>
    S(slots.map((s, j) => (i === j ? { ...s, ...patch } : s)));
  const previous = dates(period)[dates(period).indexOf(day) - 1];
  return (
    <Modal title={`${dateLabel(day)} の希望`} onClose={close}>
      <p className="muted">
        {store.step === 60 ? "1時間" : store.step + "分"}単位で入力できます。
      </p>
      <fieldset disabled={locked}>
        <div className="choice-tabs" role="group" aria-label="希望の種類">
          {(["勤務可能", "できれば入りたい", "勤務不可"] as const).map((k) => (
            <button
              type="button"
              key={k}
              aria-pressed={kind === k}
              onClick={() =>
                S(
                  k === "勤務不可"
                    ? [{ date: day, start: 0, end: 1440, kind: k }]
                    : [
                        {
                          date: day,
                          start: store.start,
                          end: store.end,
                          kind: k,
                        },
                      ],
                )
              }
            >
              {k === "勤務不可" ? "休み希望" : k}
            </button>
          ))}
        </div>
        {kind !== "勤務不可" && (
          <>
            {slots.map((s, i) => (
              <div key={i} className="day-time-row">
                <Field label={`開始時刻${i ? " " + (i + 1) : ""}`}>
                  <Time
                    label={`開始時刻${i ? " " + (i + 1) : ""}`}
                    step={store.step}
                    value={s.start}
                    onChange={(start) => change(i, { start })}
                  />
                </Field>
                <span>—</span>
                <Field label={`終了時刻${i ? " " + (i + 1) : ""}`}>
                  <Time
                    label={`終了時刻${i ? " " + (i + 1) : ""}`}
                    step={store.step}
                    value={s.end}
                    onChange={(end) => change(i, { end })}
                  />
                </Field>
                {slots.length > 1 && (
                  <button
                    className="icon"
                    aria-label="時間帯を削除"
                    onClick={() => S(slots.filter((_, j) => j !== i))}
                  >
                    <Trash2 size={17} />
                  </button>
                )}
              </div>
            ))}
            <button
              className="text-button"
              onClick={() =>
                S([
                  ...slots,
                  { date: day, start: store.start, end: store.end, kind },
                ])
              }
            >
              <Plus size={15} />
              別の時間帯を追加
            </button>
          </>
        )}
        {previous && (
          <p>
            <button
              className="text-button"
              onClick={() =>
                S(
                  all
                    .filter((s) => s.date === previous)
                    .map((s) => ({ ...s, date: day })),
                )
              }
            >
              前日と同じ希望にする
            </button>
          </p>
        )}
        <label className="check copy-week">
          <input
            type="checkbox"
            checked={copy}
            onChange={(e) => C(e.target.checked)}
          />
          期間内の{weekdays[weekday(day)]}曜日にも同じ希望を入力
        </label>
      </fieldset>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <footer>
        <button disabled={locked} onClick={() => save([], false)}>
          この日の入力を消す
        </button>
        <button
          className="primary"
          disabled={locked}
          onClick={() => {
            if (
              slots.some(
                (s) =>
                  s.start >= s.end ||
                  s.start % store.step ||
                  s.end % store.step,
              )
            ) {
              E("開始・終了時刻を確認してください");
              return;
            }
            if (
              slots.some((s, i) =>
                slots.some(
                  (t, j) => i !== j && s.start < t.end && t.start < s.end,
                ),
              )
            ) {
              E("時間帯が重複しています");
              return;
            }
            save(slots, copy);
          }}
        >
          この日を入力
        </button>
      </footer>
      <p className="muted small-text">
        入力後、カレンダー横の「希望を提出する」で送信します。
      </p>
    </Modal>
  );
}
