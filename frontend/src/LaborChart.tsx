import { useState } from "react";
import { yen, type State, type Candidate } from "./types";
export function calculateLabor(state: State, candidate: Candidate) {
  return state.staff
    .filter(
      (s) => s.active || candidate.assignments.some((a) => a.staff === s.id),
    )
    .map((s) => {
      const daily: Record<string, number> = {};
      candidate.assignments
        .filter((a) => a.staff === s.id)
        .forEach(
          (a) => (daily[a.date] = (daily[a.date] || 0) + a.end - a.start),
        );
      const minutes = Object.values(daily).reduce((n, m) => n + m, 0);
      const breaks = candidate.assignments
        .filter((a) => a.staff === s.id)
        .reduce(
          (sum, a) =>
            sum + (a.breaks || []).reduce((n, b) => n + b.end - b.start, 0),
          0,
        );
      const cost =
        s.hourly_rate == null
          ? null
          : Math.round(((minutes - breaks) * s.hourly_rate) / 60) +
            Object.keys(daily).length * (s.transport_per_day ?? 0);
      return {
        staff: s.id,
        name: s.name,
        hours: (minutes - breaks) / 60,
        cost,
        days: Object.keys(daily).length,
      };
    });
}
export function LaborChart({
  state,
  candidate,
}: {
  state: State;
  candidate: Candidate;
}) {
  const [sort, S] = useState("hours");
  const [query, Q] = useState("");
  const rows = calculateLabor(state, candidate);
  const total = rows.reduce((n, r) => n + (r.cost || 0), 0);
  const missing = rows.filter((r) => r.days && r.cost === null).length;
  const max = Math.max(1, ...rows.map((r) => r.hours));
  return (
    <section className="labor-report">
      <header className="toolbar spread">
        <div>
          <h2>勤務時間と人件費</h2>
          <p className="muted">
            選択中の案の実働時間（休憩を除く）。人件費は登録契約に基づく控除前の概算です。
          </p>
        </div>
        <div className="labor-total">
          <span>合計人件費{missing > 0 ? "（登録済み分）" : ""}</span>
          <strong>
            {missing > 0 && !rows.some((r) => r.days > 0 && r.cost !== null)
              ? "未計算"
              : yen(total)}
          </strong>
          {missing > 0 && <small>時給未登録 {missing}名</small>}
        </div>
      </header>
      <div className="toolbar">
        <input
          aria-label="スタッフを検索"
          placeholder="名前で絞り込み"
          value={query}
          onChange={(e) => Q(e.target.value)}
        />
        <select
          aria-label="勤務時間の並び順"
          value={sort}
          onChange={(e) => S(e.target.value)}
        >
          <option value="hours">勤務時間の多い順</option>
          <option value="name">名前順</option>
        </select>
      </div>
      <div
        className="hours-chart"
        role="img"
        aria-label="スタッフ別の勤務時間と人件費"
      >
        {rows
          .filter((r) => r.name.includes(query))
          .sort((a, b) =>
            sort === "hours"
              ? b.hours - a.hours
              : a.name.localeCompare(b.name, "ja"),
          )
          .map((r) => (
            <div className="hours-row" key={r.staff}>
              <span>{r.name}</span>
              <div className="hours-track">
                <span style={{ width: `${(r.hours / max) * 100}%` }} />
              </div>
              <b>{r.hours}h</b>
              <span>{r.cost === null ? "時給未登録" : yen(r.cost)}</span>
            </div>
          ))}
      </div>
      <p className="muted small-text">
        無給休憩・出勤日ごとの交通費を反映。税・保険・割増賃金は含みません。契約の登録は「スタッフ」の編集から行えます。
      </p>
    </section>
  );
}
