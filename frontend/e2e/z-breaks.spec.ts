import { test, expect } from "@playwright/test";
import type { State } from "../src/types";

test("文章条件の確認・15分単位の休憩・給与・本人カレンダー", async ({
  page,
  browser,
}) => {
  const status = await (await page.request.get("/api/auth/status")).json();
  const auth = await page.request.post(
    `/api/auth/${status.configured ? "login" : "setup"}`,
    { data: { password: "test-manager-password" } },
  );
  expect(auth.ok()).toBeTruthy();
  let state: State = await (await page.request.get("/api/state")).json();
  for (const p of state.periods.filter((p) => p.status === "確定済み")) {
    const response = await page.request.post(`/api/periods/${p.id}/reopen`, {
      data: { version: state.version },
    });
    expect(response.ok()).toBeTruthy();
    state = await response.json();
  }
  state.store = {
    name: "休憩の検証",
    start: 600,
    end: 1140,
    step: 15,
    week_start: 0,
    break_rules: [
      { after_hours: 6, minutes: 45 },
      { after_hours: 8, minutes: 60 },
    ],
    break_margin: 30,
  };
  state.roles.push({ id: "qa-role", name: "検品" });
  state.staff.forEach((s) => (s.active = false));
  state.staff.push({
    id: "qa-crew",
    name: "検証スタッフ",
    display: "",
    roles: ["qa-role"],
    skills: "",
    active: true,
    target: 40,
    minimum: 0,
    maximum: 40,
    period_max: 100,
    day_min: 3,
    day_max: 8,
    consecutive: 5,
    interval: 11,
    blocks: [],
    notes: "",
    hourly_rate: 1200,
    transport_per_day: 300,
  });
  state.periods.push({
    id: "qa-break",
    start: "2099-02-02",
    end: "2099-02-02",
    deadline: "2099-02-01T18:00:00+09:00",
    status: "募集中",
    special: [],
    selected: null,
    confirmed_at: null,
    confirmed_by: null,
  });
  state.requirements.push({
    id: "qa-need",
    period: "qa-break",
    date: "2099-02-02",
    weekday: 0,
    start: 600,
    end: 1140,
    total: 1,
    roles: {},
    hard: false,
  });
  state.submissions.push({
    staff: "qa-crew",
    period: "qa-break",
    status: "提出済み",
    target: 40,
    notes: "",
    updated_at: "",
    slots: [{ date: "2099-02-02", start: 600, end: 1140, kind: "勤務可能" }],
  });
  const saved = await page.request.put("/api/state", { data: state });
  expect(saved.ok()).toBeTruthy();
  await page.goto("/");
  await page.getByRole("button", { name: "スタッフ", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "検証スタッフ" })
    .getByRole("button", { name: "編集", exact: true })
    .click();
  await page
    .getByLabel("読み取る勤務条件")
    .fill("週の最大日数: 4日\n時給: 1200円");
  await page
    .getByRole("button", { name: "条件を読み取る", exact: true })
    .click();
  await expect(
    page.getByText("週の最大日数：4日", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "確認して勤務条件に反映" }).click();
  await expect(page.getByLabel("週の最大勤務日数")).toHaveValue("4");
  await page.screenshot({
    path: "../artifacts/conditions-v3-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "スタッフを保存" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByLabel("対象期間").selectOption("qa-break");
  await page.getByRole("button", { name: "シフト案", exact: true }).click();
  await page
    .getByRole("button", { name: "シフト案を作成", exact: true })
    .click();
  await page.getByRole("button", { name: "3案を作成する" }).click();
  await expect(page.locator(".candidate")).toHaveCount(3);
  await expect(page.locator(".timeline-break")).toHaveCount(1);
  await expect(page.locator(".labor-total")).toContainText("9,900");
  await page.getByRole("tab", { name: "週・日カレンダー" }).click();
  await expect(page.locator(".time-matrix thead th").first()).toHaveText(
    "日付",
  );
  const timeCell = page
    .locator(".time-cell")
    .filter({ hasText: "検証スタッフ" })
    .first();
  await expect(timeCell).not.toContainText("検品");
  await timeCell.hover();
  await expect(page.getByRole("tooltip")).toContainText("検品");
  await page.screenshot({
    path: "../artifacts/horizontal-week-calendar.png",
    fullPage: true,
  });
  await timeCell.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /検証スタッフ/ })
    .click();
  await expect(page.getByLabel("勤務開始", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.getByRole("tab", { name: "1日の配置" }).click();
  await expect(page.locator(".timeline-person")).toHaveCount(1);
  await page.screenshot({
    path: "../artifacts/breaks-v3-desktop.png",
    fullPage: true,
  });
  state = await (await page.request.get("/api/state")).json();
  const c = state.candidates.find(
    (c) => c.period === "qa-break" && !c.archived,
  )!;
  expect(c.metrics.hard).toBe(0);
  expect(
    c.assignments[0].breaks![0].end - c.assignments[0].breaks![0].start,
  ).toBe(45);
  await page.getByRole("button", { name: "この案を確定する" }).click();
  await page.getByRole("button", { name: "確認して確定" }).click();
  await expect(
    page.getByRole("button", { name: "再編集を開始" }),
  ).toBeVisible();
  const token = await (
    await page.request.post("/api/periods/qa-break/tokens/qa-crew")
  ).json();
  const employee = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const portal = await employee.newPage();
  await portal.goto(`/#token=${token.token}`);
  await portal.getByRole("button", { name: "確定シフト", exact: true }).click();
  await expect(portal.locator(".day-slot.confirmed")).toContainText("休憩");
  await portal.getByRole("button", { name: "2099-02-02の勤務を確認" }).click();
  await expect(portal.getByRole("dialog")).toContainText("8時間");
  await expect(portal.getByRole("dialog")).toContainText("休憩（無給）");
  await portal.getByRole("button", { name: "閉じる", exact: true }).click();
  expect(
    await portal.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await portal.screenshot({
    path: "../artifacts/breaks-v3-employee-mobile.png",
    fullPage: true,
  });
  await employee.close();
});
