import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { weekdays, weekday } from "./types";
const iso = (d: Date) => d.toISOString().slice(0, 10);
export function MonthCalendar({
  start,
  end,
  renderDay,
  onSelect,
  selected,
  caption,
  actionLabel = "希望を入力",
  dayLabel,
}: {
  start: string;
  end: string;
  renderDay: (date: string) => ReactNode;
  onSelect?: (date: string) => void;
  selected?: string;
  caption?: string;
  actionLabel?: string;
  dayLabel?: (date: string) => string;
}) {
  const [month, M] = useState(start.slice(0, 7));
  const [full, F] = useState(false);
  const first = full ? month + "-01" : start;
  const last = full
    ? iso(
        new Date(
          Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0),
        ),
      )
    : end;
  const from = new Date(first + "T12:00:00Z");
  from.setUTCDate(from.getUTCDate() - weekday(first));
  const to = new Date(last + "T12:00:00Z");
  to.setUTCDate(to.getUTCDate() + 6 - weekday(last));
  const cells = Array.from(
    { length: Math.round((to.getTime() - from.getTime()) / 86400000) + 1 },
    (_, i) => iso(new Date(from.getTime() + i * 86400000)),
  );
  const move = (n: number) => {
    const d = new Date(month + "-01T12:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + n);
    M(iso(d).slice(0, 7));
  };
  return (
    <section
      className={`month-calendar ${full ? "full-month" : "period-calendar"}`}
      aria-label="月カレンダー"
    >
      <header className="month-heading">
        <div>
          <h2>
            <span>
              {Number((full ? month : start).slice(5, 7))}
              {!full && start.slice(0, 7) !== end.slice(0, 7)
                ? " — " + Number(end.slice(5, 7))
                : ""}
            </span>
            月 <small>{(full ? month : start).slice(0, 4)}</small>
          </h2>
          {caption && <p>{caption}</p>}
        </div>
        <div className="month-controls">
          <div className="calendar-mode">
            <button aria-pressed={!full} onClick={() => F(false)}>
              対象期間
            </button>
            <button aria-pressed={full} onClick={() => F(true)}>
              月全体
            </button>
          </div>
          {full && (
            <div className="month-navigation">
              <button
                aria-label="前の月"
                disabled={month <= start.slice(0, 7)}
                onClick={() => move(-1)}
              >
                <ChevronLeft size={20} />
              </button>
              <button
                aria-label="次の月"
                disabled={month >= end.slice(0, 7)}
                onClick={() => move(1)}
              >
                <ChevronRight size={20} />
              </button>
            </div>
          )}
        </div>
      </header>
      <div className="month-weekdays">
        {weekdays.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="month-days">
        {cells.map((d) => {
          const enabled = d >= start && d <= end;
          const number = Number(d.slice(8));
          const contents = (
            <>
              <span className="day-number">
                {number === 1 ? `${Number(d.slice(5, 7))}/` : ""}
                {number}
              </span>
              {enabled && <div className="day-content">{renderDay(d)}</div>}
            </>
          );
          return onSelect ? (
            <button
              type="button"
              aria-label={`${d}の${actionLabel}`}
              aria-description={dayLabel?.(d)}
              aria-pressed={selected === d}
              key={d}
              disabled={!enabled}
              className={`calendar-day ${selected === d ? "chosen" : ""}`}
              onClick={() => onSelect(d)}
            >
              {contents}
            </button>
          ) : (
            <div
              key={d}
              className={`calendar-day readonly ${!enabled ? "outside" : ""}`}
            >
              {contents}
            </div>
          );
        })}
      </div>
    </section>
  );
}
