export type Store = {
  name: string;
  start: number;
  end: number;
  step: 15 | 30 | 60;
  week_start: number;
  break_rules?: { after_hours: number; minutes: number }[];
  break_margin?: number;
};
export type Role = { id: string; name: string };
export type Block = { weekday: number; start: number; end: number };
export type Staff = {
  id: string;
  name: string;
  display: string;
  roles: string[];
  skills: string;
  active: boolean;
  target: number;
  minimum: number;
  maximum: number;
  period_max: number;
  day_min: number;
  day_max: number;
  consecutive: number;
  interval: number;
  blocks: Block[];
  notes: string;
  hourly_rate?: number | null;
  transport_per_day?: number;
  closing_day?: number;
  payday?: number;
  pay_month_offset?: number;
  unpaid_break_minutes?: number;
  break_after_hours?: number;
  regular?: Block[];
  regular_only?: boolean;
  employment_type?:
    "未設定" | "社員" | "派遣" | "パート" | "アルバイト" | "その他";
  fixed_shifts?: Block[];
  fixed_exceptions?: string[];
  max_days_week?: number;
  min_shifts_period?: number;
  earliest_start?: number;
  latest_end?: number;
  condition_text?: string;
  condition_reviewed_text?: string;
  extra_fields?: Record<string, string>;
};
export type Period = {
  id: string;
  start: string;
  end: string;
  deadline: string;
  status: string;
  special: { date: string; start: number; end: number; closed: boolean }[];
  pairs?: { first: string; second: string; weight: number }[];
  selected: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
};
export type Requirement = {
  id: string;
  period: string;
  weekday: number;
  date: string | null;
  start: number;
  end: number;
  total: number;
  roles: Record<string, number>;
  hard: boolean;
};
export type Slot = {
  date: string;
  start: number;
  end: number;
  kind: "勤務可能" | "できれば入りたい" | "勤務不可";
};
export type Submission = {
  staff: string;
  period: string;
  status: "下書き" | "提出済み";
  target: number;
  notes: string;
  updated_at: string;
  slots: Slot[];
};
export type Assignment = {
  id: string;
  staff: string;
  role: string;
  date: string;
  start: number;
  end: number;
  reason: string;
  breaks?: { start: number; end: number }[];
};
export type Candidate = {
  id: string;
  period: string;
  name: string;
  archived?: boolean;
  input_fingerprint?: string;
  assignments: Assignment[];
  previous: Assignment[] | null;
  metrics: {
    stale?: boolean;
    coverage: number;
    preference: number;
    fairness: number;
    hard: number;
    total_hours: number;
    missing_slots: number;
    summary: {
      staff: string;
      name: string;
      hours: number;
      target: number;
      difference: number;
      consecutive: number;
      zero_reason?: string;
      submitted_days?: number;
      available_hours?: number;
    }[];
  };
  violations: { code: string; message: string; hard: boolean }[];
  solver: string;
};
export type State = {
  version: number;
  store: Store | null;
  roles: Role[];
  staff: Staff[];
  periods: Period[];
  requirements: Requirement[];
  submissions: Submission[];
  candidates: Candidate[];
  demand_history?: { date: string; sales: number; weather: string }[];
};
export type Portal = {
  store: Store;
  staff: {
    id: string;
    name: string;
    target: number;
    regular?: Block[];
    regular_only?: boolean;
    fixed_shifts?: Block[];
    fixed_exceptions?: string[];
  };
  period: Period;
  submission: Submission | null;
  version: number;
  roles: Role[];
  assignments: Assignment[];
};
export type PayEstimate = {
  hours: number;
  paid_hours: number;
  days: number;
  break_minutes: number;
  total: number | null;
  wage: number | null;
  transport: number;
  hourly_rate: number | null;
};
export type ShiftChangeRequest = {
  id: string;
  staff: string;
  assignment: string;
  date: string;
  start: number;
  end: number;
  kind: string;
  reason: string;
  proposed_start: number | null;
  proposed_end: number | null;
  status: string;
  manager_note: string;
  created_at: string;
  updated_at: string;
};
export type AttendanceRecord = {
  id: string;
  staff: string;
  date: string;
  assignment: string;
  clock_in: string;
  clock_out: string | null;
  break_minutes: number;
  break_confirmed: boolean;
  break_required: number;
  paid_hours: number;
  gross: number | null;
  correction_reason: string;
  needs_review: boolean;
};
export type ActualPay = {
  staff: string;
  name: string;
  start: string;
  end: string;
  payday: string;
  actual_hours: number;
  actual_days: number;
  actual_wage: number | null;
  actual_transport: number;
  actual_total: number | null;
  forecast_hours: number;
  forecast_total: number | null;
  unreviewed_breaks: number;
};
export type MyWork = {
  assignments: Assignment[];
  requests: ShiftChangeRequest[];
  attendance: AttendanceRecord[];
  pay: ActualPay;
  roles: Role[];
};
export const yen = (n: number) =>
  new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(n);
export const uid = () => crypto.randomUUID();
export const paidHours = (a: Assignment) =>
  (a.end -
    a.start -
    (a.breaks || []).reduce((n, b) => n + b.end - b.start, 0)) /
  60;
export const breakLabel = (a: Assignment) =>
  (a.breaks || []).map((b) => `${hm(b.start)}–${hm(b.end)}`).join(" / ");
export const hm = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
export const mins = (s: string) =>
  Number(s.split(":")[0]) * 60 + Number(s.split(":")[1]);
export const weekdays = ["月", "火", "水", "木", "金", "土", "日"];
export const weekday = (s: string) =>
  (new Date(s + "T12:00:00").getDay() + 6) % 7;
export const dateLabel = (s: string) =>
  `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}（${weekdays[weekday(s)]}）`;
export const dates = (p: Period) => {
  const result: string[] = [];
  let d = new Date(p.start + "T00:00:00Z");
  while (d.toISOString().slice(0, 10) <= p.end) {
    result.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86400000);
  }
  return result;
};
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  token?: string,
): Promise<T> {
  const r = await fetch("/api" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "X-Share-Token": token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({
      detail: `接続先からエラーが返りました（${r.status}）。入力は保持しています。再接続してお試しください。`,
    }));
    throw new Error(
      e.errors
        ?.map(
          (x: { field: string; message: string }) => `${x.field}: ${x.message}`,
        )
        .join(" / ") ||
        e.detail ||
        "処理に失敗しました",
    );
  }
  return r.json();
}
