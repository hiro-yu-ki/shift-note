import { useState } from "react";
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
const colors = [
  "#42745e",
  "#587597",
  "#946b48",
  "#757d47",
  "#855e75",
  "#527f86",
];
export function DayTimeline({
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
  const [day, D] = useState(period.start);
  const [filter, F] = useState("");
  const [detail, Detail] = useState(false);
  const list = dates(period);
  const special = period.special.find((s) => s.date === day);
  const lo = special?.start ?? state.store!.start;
  const hi = special?.end ?? state.store!.end;
  const total = Math.max(60, hi - lo);
  const rows = state.staff.filter((s) =>
    candidate.assignments.some(
      (a) =>
        a.staff === s.id && a.date === day && (!filter || a.role === filter),
    ),
  );
  return (
    <section className="timeline">
      <header className="toolbar spread">
        <div className="row">
          <button
            aria-label="前の日"
            disabled={day === period.start}
            onClick={() => D(list[list.indexOf(day) - 1])}
          >
            <ChevronLeft size={17} />
          </button>
          <select
            aria-label="配置を見る日"
            value={day}
            onChange={(e) => D(e.target.value)}
          >
            {list.map((d) => (
              <option key={d} value={d}>
                {dateLabel(d)}
              </option>
            ))}
          </select>
          <button
            aria-label="次の日"
            disabled={day === period.end}
            onClick={() => D(list[list.indexOf(day) + 1])}
          >
            <ChevronRight size={17} />
          </button>
        </div>
        <select
          aria-label="役割で絞り込み"
          value={filter}
          onChange={(e) => F(e.target.value)}
        >
          <option value="">すべての役割</option>
          {state.roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </header>
      <details className="timeline-options">
        <summary>表示の詳細設定</summary>
        <label className="check">
          <input
            type="checkbox"
            checked={detail}
            onChange={(e) => Detail(e.target.checked)}
          />
          時刻・役割も表示
        </label>
      </details>
      <p className="muted small-text">
        色の帯は勤務、斜線は無給休憩です。右端は休憩を除いた実働時間。帯を押すと編集できます。
      </p>
      <div className="timeline-scroll">
        <div className="timeline-grid">
          <div className="timeline-ruler">
            <span>スタッフ</span>
            <div>
              {Array.from(
                { length: Math.ceil(total / 120) + 1 },
                (_, i) => lo + i * 120,
              )
                .filter((t) => t <= hi)
                .map((t) => (
                  <span
                    key={t}
                    style={{ left: `${((t - lo) / total) * 100}%` }}
                  >
                    {hm(t)}
                  </span>
                ))}
            </div>
            <span>時間</span>
          </div>
          {rows.map((s) => {
            const shifts = candidate.assignments.filter(
              (a) =>
                a.staff === s.id &&
                a.date === day &&
                (!filter || a.role === filter),
            );
            return (
              <div className="timeline-person" key={s.id}>
                <span>
                  {s.name}
                  {detail && (
                    <small>
                      {s.roles
                        .map((id) => state.roles.find((r) => r.id === id)?.name)
                        .join(" / ")}
                    </small>
                  )}
                </span>
                <div className="timeline-track">
                  {shifts.length ? (
                    shifts.map((a) => (
                      <button
                        key={a.id}
                        className="timeline-shift"
                        style={{
                          left: `${Math.max(0, ((a.start - lo) / total) * 100)}%`,
                          width: `${Math.max(1, ((Math.min(a.end, hi) - Math.max(a.start, lo)) / total) * 100)}%`,
                          background:
                            colors[
                              state.roles.findIndex((r) => r.id === a.role) %
                                colors.length
                            ],
                        }}
                        onClick={() => onEdit(a)}
                        title={`${s.name} ${hm(a.start)}〜${hm(a.end)} ${state.roles.find((r) => r.id === a.role)?.name} 休憩 ${breakLabel(a) || "なし"}`}
                      >
                        {(a.breaks || []).map((b, i) => (
                          <i
                            key={i}
                            className="timeline-break"
                            style={{
                              left: `${((b.start - a.start) / (a.end - a.start)) * 100}%`,
                              width: `${((b.end - b.start) / (a.end - a.start)) * 100}%`,
                            }}
                            title={`休憩 ${hm(b.start)}–${hm(b.end)}`}
                          >
                            {detail ? "休憩" : ""}
                          </i>
                        ))}
                        <strong>{s.name}</strong>
                        {detail && (
                          <span>
                            {hm(a.start)}–{hm(a.end)} ·
                            {state.roles.find((r) => r.id === a.role)?.name}
                          </span>
                        )}
                      </button>
                    ))
                  ) : (
                    <span className="no-shift">—</span>
                  )}
                </div>
                <b>{shifts.reduce((n, a) => n + paidHours(a), 0)}h</b>
              </div>
            );
          })}
        </div>
      </div>
      {!rows.length && (
        <p className="muted">この日に該当する勤務はありません。</p>
      )}
      {detail && (
        <div className="role-legend">
          {state.roles.map((r, i) => (
            <span key={r.id}>
              <i style={{ background: colors[i % colors.length] }} />
              {r.name}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
