import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import {
  api,
  hm,
  breakLabel,
  paidHours,
  yen,
  type Portal,
  type Submission,
  type PayEstimate,
} from "./types";
import { SubmissionForm } from "./SubmissionForm";
import { MonthCalendar } from "./MonthCalendar";
import { Modal } from "./ui";
import { WorkHub } from "./WorkHub";

type EmployeeData = Portal & {
  pay: PayEstimate & {
    payday: string;
    start: string;
    end: string;
    basis: string;
  };
  period_pay: PayEstimate;
};
export function Employee({
  token,
  periodId,
  previewStaff,
}: {
  token?: string;
  periodId?: string;
  previewStaff?: string;
}) {
  const endpoint =
    previewStaff && periodId
      ? `/employee-preview/${encodeURIComponent(previewStaff)}/${encodeURIComponent(periodId)}`
      : periodId
        ? `/employee/portal/${encodeURIComponent(periodId)}`
        : "/portal";
  const [data, D] = useState<EmployeeData | null>(null);
  const [error, E] = useState("");
  const [view, V] = useState("request");
  const [detailDay, DD] = useState<string | null>(null);
  useEffect(() => {
    api<EmployeeData>(endpoint, "GET", undefined, token)
      .then(D)
      .catch((e) => E(e.message));
  }, [token, endpoint]);
  const save = async (submission: Submission) => {
    D(
      await api<EmployeeData>(
        endpoint,
        "PUT",
        { version: data!.version, submission },
        token,
      ),
    );
  };
  return (
    <div className="employee-app">
      <header className="employee-header">
        <a href={location.hash} className="employee-logo">
          シフトノート
        </a>
        <span>{data?.store.name}</span>
        <span className="employee-person">{data?.staff.name}</span>
      </header>
      <main className="employee-main">
        {previewStaff && (
          <p className="notice">
            管理者による閲覧確認です。希望の保存・提出はできません。本人のメール認証とは別の機能です。
          </p>
        )}
        {error ? (
          <p role="alert" className="error">
            {error}
          </p>
        ) : !data ? (
          <p>シフトを読み込んでいます…</p>
        ) : (
          <>
            <nav className="employee-nav" aria-label="従業員メニュー">
              <button
                className={view === "request" ? "active" : ""}
                onClick={() => V("request")}
              >
                希望を申請
              </button>
              <button
                className={view === "confirmed" ? "active" : ""}
                onClick={() => V("confirmed")}
              >
                確定シフト
              </button>
              {!previewStaff && !token && <>
                <button className={view === "work" ? "active" : ""} onClick={() => V("work")}>勤務日・変更相談</button>
                <button className={view === "attendance" ? "active" : ""} onClick={() => V("attendance")}>勤務実績・給与</button>
              </>}
            </nav>
            <div className="employee-title">
              <div>
                <p className="section-kicker">{data.staff.name}さん</p>
                <h1>
                  {view === "request" ? "シフト希望を入力" : view === "confirmed" ? "確定したシフト" : view === "work" ? "勤務日と変更相談" : "勤務実績と給与"}
                </h1>
              </div>
              <span>
                {data.period.start.replaceAll("-", " / ")} —{" "}
                {data.period.end.replaceAll("-", " / ")}
              </span>
            </div>
            <section hidden={view !== "request"}>
              <p className="employee-instruction">
                {data.store.step === 60 ? "1時間" : data.store.step + "分"}
                単位で入力できます。
                {data.period.status === "確定済み"
                  ? "この期間のシフトは確定しています。"
                  : new Date(data.period.deadline) < new Date()
                    ? "締切を過ぎています。変更は管理者へご相談ください。"
                    : "提出後も締切まで変更できます。"}
              </p>
              <SubmissionForm
                key={data.period.id}
                period={data.period}
                store={data.store}
                staff={data.staff}
                initial={data.submission}
                onSave={save}
                locked={
                  !!previewStaff ||
                  data.period.status === "確定済み" ||
                  new Date(data.period.deadline) < new Date()
                }
              />
            </section>
            <section hidden={view !== "confirmed"}>
              <div className="pay-overview">
                <section>
                  <p>
                    次回給与の見込み <span>控除前</span>
                  </p>
                  <strong>
                    {data.pay.total === null
                      ? "時給未登録"
                      : yen(data.pay.total)}
                  </strong>
                  <small>支払予定 {data.pay.payday}</small>
                </section>
                <section>
                  <p>対象の勤務時間</p>
                  <strong>
                    {data.pay.paid_hours}
                    <small> 時間</small>
                  </strong>
                  <small>
                    {data.pay.start} — {data.pay.end}
                  </small>
                </section>
                <section>
                  <p>表示期間の勤務</p>
                  <strong>
                    {data.period_pay.paid_hours}
                    <small> 時間</small>
                  </strong>
                  <small>{data.period_pay.days}日間</small>
                </section>
              </div>
              <details className="pay-basis">
                <summary>給与見込みの計算内容</summary>
                <p>{data.pay.basis}</p>
                <p>
                  本人時給：
                  {data.pay.hourly_rate === null
                    ? "管理者による登録待ち"
                    : yen(data.pay.hourly_rate)}{" "}
                  / 時給分：
                  {data.pay.wage === null ? "未計算" : yen(data.pay.wage)} /
                  交通費：{yen(data.pay.transport)} / 無給休憩：
                  {data.pay.break_minutes}分
                </p>
                <p>
                  支払日の休日調整は含みません。契約に基づく追加手当・控除は管理者へご確認ください。
                </p>
              </details>
              {data.period.status !== "確定済み" && (
                <p className="inline-empty">
                  この期間はまだ確定していません。確定するとカレンダーに表示されます。
                </p>
              )}
              <MonthCalendar
                start={data.period.start}
                end={data.period.end}
                caption="日付を押すと勤務・休憩の詳細を確認できます。"
                actionLabel="勤務を確認"
                onSelect={DD}
                renderDay={(d) => (
                  <>
                    {data.assignments
                      .filter((a) => a.date === d)
                      .map((a) => (
                        <span className="day-slot confirmed" key={a.id}>
                          <strong>
                            {hm(a.start)}
                            <br className="mobile-break" />–{hm(a.end)}
                          </strong>
                          <small className="confirmed-paid">
                            実働 {paidHours(a)}h
                          </small>
                          {breakLabel(a) && (
                            <small className="confirmed-break">
                              休憩{" "}
                              {(a.breaks || []).reduce(
                                (n, b) => n + b.end - b.start,
                                0,
                              )}
                              分
                            </small>
                          )}
                          <span>
                            {data.roles.find((r) => r.id === a.role)?.name}
                          </span>
                        </span>
                      ))}
                  </>
                )}
              />
              {detailDay && (
                <Modal title={`${detailDay} の勤務`} onClose={() => DD(null)}>
                  {data.assignments.filter((a) => a.date === detailDay)
                    .length === 0 ? (
                    <p>この日の確定勤務はありません。</p>
                  ) : (
                    data.assignments
                      .filter((a) => a.date === detailDay)
                      .map((a) => (
                        <div className="employee-shift-detail" key={a.id}>
                          <h2>
                            {hm(a.start)}–{hm(a.end)}
                          </h2>
                          <p>{data.roles.find((r) => r.id === a.role)?.name}</p>
                          <dl>
                            <dt>休憩（無給）</dt>
                            <dd>{breakLabel(a) || "なし"}</dd>
                            <dt>実働</dt>
                            <dd>{paidHours(a)}時間</dd>
                          </dl>
                        </div>
                      ))
                  )}
                </Modal>
              )}
              <footer className="employee-bottom">
                <span>給与情報はご本人にのみ表示されます。</span>
                <button className="no-print" onClick={() => window.print()}>
                  <Printer size={16} />
                  印刷
                </button>
              </footer>
            </section>
            {(view === "work" || view === "attendance") && <WorkHub view={view} />}
          </>
        )}
      </main>
      <footer className="employee-footer">シフトノート</footer>
    </div>
  );
}
