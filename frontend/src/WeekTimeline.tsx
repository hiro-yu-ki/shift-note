import { useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  dates,
  dateLabel,
  hm,
  paidHours,
  breakLabel,
  type State,
  type Period,
  type Candidate,
  type Assignment,
} from "./types";
import { Modal } from "./ui";

export function worksDuring(a: Assignment, start: number, end: number) {
  const lo = Math.max(a.start, start),
    hi = Math.min(a.end, end);
  return (
    hi > lo &&
    (a.breaks || []).reduce(
      (n, b) => n + Math.max(0, Math.min(hi, b.end) - Math.max(lo, b.start)),
      0,
    ) <
      hi - lo
  );
}

export function WeekTimeline({
  state,
  period,
  candidate,
  onEdit,
}: {
  state: State;
  period: Period;
  candidate: Candidate;
  onEdit: (a: Assignment) => void;
}) {
  const allDays = dates(period);
  const [offset, O] = useState(0);
  const [mode, M] = useState(7);
  const [windowHours, WH] = useState(() => (window.innerWidth < 600 ? 4 : 8));
  const [unit, U] = useState(60);
  const [timeOffset, TO] = useState(0);
  const [detail, D] = useState(false);
  const [hover, H] = useState<{
    day: string;
    start: number;
    x: number;
    y: number;
  } | null>(null);
  const [selected, S] = useState<{ day: string; start: number } | null>(null);
  const lo = Math.min(
    state.store!.start,
    ...period.special.map((d) => d.start),
    ...candidate.assignments.map((a) => a.start),
  );
  const hi = Math.max(
    state.store!.end,
    ...period.special.map((d) => d.end),
    ...candidate.assignments.map((a) => a.end),
  );
  const span = windowHours * 60;
  const from = Math.max(
    lo,
    Math.min(lo + timeOffset, hi - Math.min(span, hi - lo)),
  );
  const end = Math.min(hi, from + span);
  const slots = Array.from(
    { length: Math.ceil((end - from) / unit) },
    (_, i) => from + i * unit,
  );
  const visibleDays = allDays.slice(
    Math.min(offset, allDays.length - 1),
    offset + mode,
  );
  const names = (a: Assignment) =>
    state.staff.find((s) => s.id === a.staff)?.name || "不明";
  const inSlot = (day: string, start: number) =>
    candidate.assignments
      .filter(
        (a) =>
          a.date === day &&
          a.start < Math.min(start + unit, hi) &&
          a.end > start,
      )
      .sort((a, b) => names(a).localeCompare(names(b), "ja"));
  const description = (a: Assignment, start: number) =>
    `${state.roles.find((r) => r.id === a.role)?.name || "未設定"} · ${hm(a.start)}–${hm(a.end)} · 実働${paidHours(a)}時間${breakLabel(a) ? ` · 休憩 ${breakLabel(a)}` : ""}${worksDuring(a, start, Math.min(start + unit, hi)) ? "" : " · この枠は休憩中"}`;
  return (
    <section className="week-timeline">
      <div className="toolbar spread">
        <div className="row">
          <button
            aria-label="前の日付"
            disabled={offset === 0}
            onClick={() => O(Math.max(0, offset - mode))}
          >
            <ChevronLeft size={17} />
          </button>
          <strong>
            {dateLabel(visibleDays[0])}{" "}
            {mode === 7 && visibleDays.length > 1
              ? `〜 ${dateLabel(visibleDays.at(-1)!)}`
              : ""}
          </strong>
          <button
            aria-label="次の日付"
            disabled={offset + mode >= allDays.length}
            onClick={() => O(offset + mode)}
          >
            <ChevronRight size={17} />
          </button>
        </div>
        <div className="row">
          <button aria-pressed={mode === 7} onClick={() => M(7)}>
            週
          </button>
          <button aria-pressed={mode === 1} onClick={() => M(1)}>
            日
          </button>
        </div>
      </div>
      <details className="timeline-options">
        <summary>表示の詳細設定</summary>
        <div className="row">
          <label>
            時間の区切り{" "}
            <select
              aria-label="時間の区切り"
              value={unit}
              onChange={(e) => U(Number(e.target.value))}
            >
              <option value={30}>30分</option>
              <option value={60}>1時間</option>
              <option value={120}>2時間</option>
            </select>
          </label>
          <label>
            一度に表示する時間{" "}
            <select
              value={windowHours}
              onChange={(e) => WH(Number(e.target.value))}
            >
              {[4, 8, 12].map((v) => (
                <option key={v} value={v}>
                  {v}時間
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={detail}
              onChange={(e) => D(e.target.checked)}
            />
            時刻・役割も表示
          </label>
        </div>
      </details>
      <div className="toolbar spread">
        <p className="muted">
          枠内のいずれかの時間に勤務する人の名前を表示します。時間帯を押すと詳細を確認・編集できます。
        </p>
        <div className="row">
          <button
            aria-label="前の時間帯"
            disabled={from <= lo}
            onClick={() => TO(Math.max(0, from - lo - span))}
          >
            前の時間
          </button>
          <span>
            {hm(from)}–{hm(end)}
          </span>
          <button
            aria-label="次の時間帯"
            disabled={end >= hi}
            onClick={() => TO(from - lo + span)}
          >
            次の時間
          </button>
        </div>
      </div>
      <div className="time-matrix-scroll" role="region" aria-label="日付と時間帯別の勤務表" tabIndex={0}>
      <table className="time-matrix">
        <thead>
          <tr>
            <th scope="col">日付</th>
            {slots.map((t) => (
              <th key={t} scope="col">
                {hm(t)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleDays.map((day) => (
            <tr key={day}>
              <th scope="row">{dateLabel(day)}</th>
              {slots.map((start) => {
                const rows = inSlot(day, start),
                  working = rows.filter((a) =>
                    worksDuring(a, start, Math.min(start + unit, hi)),
                  );
                return (
                  <td key={start}>
                    <button
                      className="time-cell"
                      aria-label={`${day} ${hm(start)}からの勤務 ${working.length}人`}
                      onMouseEnter={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        H({
                          day,
                          start,
                          x: Math.max(8, Math.min(r.left, innerWidth - 328)),
                          y: Math.max(
                            8,
                            Math.min(r.bottom + 6, innerHeight - 260),
                          ),
                        });
                      }}
                      onMouseLeave={() => H(null)}
                      onFocus={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        H({
                          day,
                          start,
                          x: Math.max(8, Math.min(r.left, innerWidth - 328)),
                          y: Math.max(
                            8,
                            Math.min(r.bottom + 6, innerHeight - 260),
                          ),
                        });
                      }}
                      onBlur={() => H(null)}
                      onClick={() => {
                        H(null);
                        S({ day, start });
                      }}
                    >
                      {working.slice(0, 3).map((a) => (
                        <span className="matrix-name" key={a.id}>
                          {names(a)}
                          {detail && (
                            <small>
                              {hm(a.start)}–{hm(a.end)}
                              <br />
                              {state.roles.find((r) => r.id === a.role)?.name}
                            </small>
                          )}
                        </span>
                      ))}
                      {working.length > 3 && (
                        <span className="matrix-more">
                          ほか{working.length - 3}人
                        </span>
                      )}
                      {!working.length && <span className="muted">—</span>}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {hover &&
        createPortal(
          <div
            role="tooltip"
            className="shift-hover"
            style={{ left: hover.x, top: hover.y }}
          >
            <strong>
              {dateLabel(hover.day)} {hm(hover.start)}–
              {hm(Math.min(hover.start + unit, hi))}
            </strong>
            {inSlot(hover.day, hover.start)
              .slice(0, 3)
              .map((a) => (
                <p key={a.id}>
                  <b>{names(a)}</b>
                  <small>{description(a, hover.start)}</small>
                </p>
              ))}
            {inSlot(hover.day, hover.start).length > 3 && (
              <p>
                ほか{inSlot(hover.day, hover.start).length - 3}
                人。クリックですべて表示
              </p>
            )}
            {!inSlot(hover.day, hover.start).length && (
              <p>この時間帯の勤務はありません。</p>
            )}
          </div>,
          document.body,
        )}
      {selected && (
        <Modal
          title={`${dateLabel(selected.day)} ${hm(selected.start)}–${hm(Math.min(selected.start + unit, hi))}の勤務`}
          onClose={() => S(null)}
        >
          <p>名前を押すと勤務の詳細を確認・編集できます。</p>
          {inSlot(selected.day, selected.start).map((a) => (
            <button
              className="shift-person-detail"
              key={a.id}
              onClick={() => {
                S(null);
                onEdit(a);
              }}
            >
              <strong>{names(a)}</strong>
              <small>{description(a, selected.start)}</small>
            </button>
          ))}
          {!inSlot(selected.day, selected.start).length && (
            <p>この時間帯の勤務はありません。</p>
          )}
        </Modal>
      )}
    </section>
  );
}
