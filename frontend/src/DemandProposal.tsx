import { useState } from "react";
import { api, hm, yen, type State, type Period } from "./types";
import { Modal, Field, Num } from "./ui";
type Row = {
  date: string;
  start: number;
  end: number;
  total: number;
  sales: number | null;
  samples: number;
  confidence: string;
  reason: string;
  roles: Record<string, number>;
};
export function DemandProposal({
  state,
  period,
  close,
  save,
}: {
  state: State;
  period: Period;
  close: () => void;
  save: (s: State) => void;
}) {
  const [history, H] = useState((state.demand_history||[]).map(r=>`${r.date},${r.sales},${r.weather}`).join('\n'));
  const [capacity, C] = useState(5000);
  const [min, M] = useState(2);
  const [factor, F] = useState(1);
  const [weather, W] = useState("");
  const [roles, R] = useState<Record<string, number>>({});
  const [preview, P] = useState<{
    rows: Row[];
    method: string;
    version: number;
  } | null>(null);
  const [error, E] = useState("");
  const [busy, B] = useState(false);
  const body = () => ({
    period: period.id,
    version: state.version,
    history: history.trim()
      ? history
          .trim()
          .split("\n")
          .filter((x) => x.trim())
          .map((line) => {
            const [date, sales, weather = ""] = line
              .split(/[,\t]/)
              .map((x) => x.trim());
            return { date, sales: Number(sales), weather };
          })
      : [],
    sales_per_labor_hour: capacity,
    minimum: min,
    weather,
    event_factor: factor,
    roles,
  });
  const changed = () => P(null);
  return (
    <Modal title="実績から必要人数を提案" onClose={close}>
      <p>
        過去の売上から日別の人数目安を計算します。実績が少ない日は「データ不足」と表示します。自動では反映されません。
      </p>
      <Field label="過去の実績（日付,売上,天気）">
        <textarea
          rows={5}
          placeholder={"2026-09-01,120000,晴れ\n2026-09-08,135000,雨"}
          value={history}
          onChange={(e) => {
            H(e.target.value);
            changed();
          }}
        />
      </Field>
      <div className="form-grid">
        <Num
          label="1人1時間あたり売上の目安（円）"
          value={capacity}
          min={1}
          max={100000000}
          onChange={(n) => {
            C(n);
            changed();
          }}
        />
        <Num
          label="最低人数"
          value={min}
          max={30}
          onChange={(n) => {
            M(n);
            changed();
          }}
        />
        <Field label="期間中の想定天気（任意）">
          <input
            value={weather}
            placeholder="例：雨"
            onChange={(e) => {
              W(e.target.value);
              changed();
            }}
          />
        </Field>
        <Num
          label="イベントなどの補正倍率"
          value={factor}
          min={0.1}
          max={5}
          step={0.1}
          onChange={(n) => {
            F(n);
            changed();
          }}
        />
      </div>
      <details>
        <summary>必ず必要な役割人数</summary>
        <div className="form-grid">
          {state.roles.map((r) => (
            <Num
              key={r.id}
              label={r.name}
              value={roles[r.id] || 0}
              max={30}
              onChange={(n) => {
                R({ ...roles, [r.id]: n });
                changed();
              }}
            />
          ))}
        </div>
      </details>
      <p className="muted small-text">
        同曜日・直近60日・前年同時期・同じ天気を重視します。天気は入力値を使用し、自動取得しません。日別の目安のため、ピーク時間は反映後に調整してください。
      </p>
      <button
        disabled={busy}
        onClick={async () => {
          B(true);
          E("");
          try {
            P(await api("/demand/preview", "POST", body()));
          } catch (e) {
            E((e as Error).message);
          } finally {
            B(false);
          }
        }}
      >
        {busy ? "計算中…" : "提案を確認"}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <>
          <p>{preview.method}</p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>日付</th>
                  <th>時間</th>
                  <th>売上見込み</th>
                  <th>人数</th>
                  <th>根拠</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.date}>
                    <td>{r.date}</td>
                    <td>
                      {hm(r.start)}–{hm(r.end)}
                    </td>
                    <td>{r.sales === null ? "実績なし" : yen(r.sales)}</td>
                    <td>{r.total}人</td>
                    <td>
                      <strong>{r.confidence}</strong>
                      <br />
                      {r.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            反映すると、この期間の既存の必要人数設定を提案内容で置き換えます。
          </p>
          <footer>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                if (
                  !window.confirm(
                    "確認した提案で、この期間の必要人数を置き換えますか？",
                  )
                )
                  return;
                B(true);
                try {
                  save(
                    await api("/demand/apply", "POST", {
                      ...body(),
                      version: preview.version,
                    }),
                  );
                  close();
                } catch (e) {
                  E((e as Error).message);
                } finally {
                  B(false);
                }
              }}
            >
              確認した提案を反映
            </button>
          </footer>
        </>
      )}
    </Modal>
  );
}
