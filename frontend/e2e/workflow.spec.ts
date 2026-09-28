import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
test("初回設定から希望提出・作成・修正・確定・CSVまで", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await mkdir("../artifacts", { recursive: true });
  await page.goto("/");
  await page
    .getByLabel("管理者パスワード", { exact: true })
    .fill("test-manager-password");
  await page.getByLabel("パスワードをもう一度").fill("test-manager-password");
  await page.getByRole("button", { name: "パスワードを設定" }).click();
  await expect(
    page.getByRole("heading", { name: "店舗のシフト管理を始める" }),
  ).toBeVisible();
  await page.screenshot({
    path: "../artifacts/setup-desktop.png",
    fullPage: true,
  });
  await page.getByLabel("デモデータで試す", { exact: false }).check();
  await page.getByRole("button", { name: "セットアップを完了" }).click();
  await expect(
    page.getByRole("heading", { name: "概要", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "../artifacts/dashboard-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "スタッフ", exact: true }).click();
  await expect(page.getByRole("cell", { name: /佐藤 美咲/ })).toBeVisible();
  await expect(page.locator("table").last().getByRole("row")).toHaveCount(15);
  await page.screenshot({
    path: "../artifacts/staff-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "期間を作成", exact: true }).click();
  await page.getByLabel("開始日", { exact: true }).fill("2099-01-05");
  await page.getByLabel("終了日", { exact: true }).fill("2099-01-05");
  await page.getByLabel("提出締切（日本時間）").fill("2099-01-04T18:00");
  await page.getByRole("button", { name: "期間を保存" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByRole("button", { name: "必要人数・役割", exact: true })
    .click();
  await page.getByRole("button", { name: "条件を追加" }).click();
  await page.getByLabel("適用する日").selectOption("date");
  await page.getByLabel("必要人数の終了").selectOption("780");
  await page.getByLabel("必要人数（合計）").fill("1");
  await page.getByLabel("責任者の必要人数").fill("1");
  await page.getByLabel("役割人数を必須にする").check();
  await page.getByRole("button", { name: "条件を保存" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.screenshot({
    path: "../artifacts/requirements-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /希望の提出状況/ }).click();
  await page.getByLabel("未提出のみ").check();
  const first = page.getByRole("row").filter({ hasText: "佐藤 美咲" });
  await first.getByRole("button", { name: "提出URL" }).click();
  const url = await page.getByLabel("提出URL", { exact: true }).inputValue();
  const employeeContext = await browser.newContext();
  const portal = await employeeContext.newPage();
  portal.on("pageerror", (e) => errors.push(e.message));
  await portal.setViewportSize({ width: 390, height: 844 });
  await portal.goto(url);
  await expect(
    portal.getByRole("heading", { name: "シフト希望を入力" }),
  ).toBeVisible();
  await portal.getByRole("button", { name: "2099-01-05の希望を入力" }).click();
  await portal.getByLabel("終了時刻", { exact: true }).selectOption("780");
  await portal.getByRole("button", { name: "この日を入力" }).click();
  await portal.getByLabel("連絡事項（任意）").fill("午前の勤務を希望します。");
  await portal.getByRole("button", { name: "下書き保存" }).click();
  await expect(portal.getByRole("status")).toContainText(
    "下書きを保存しました",
  );
  await portal.getByRole("button", { name: "希望を提出する" }).click();
  await expect(portal.getByRole("status")).toContainText("希望を提出しました");
  await portal.screenshot({
    path: "../artifacts/portal-mobile.png",
    fullPage: true,
  });
  expect(
    await portal.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await portal.reload();
  await expect(portal.getByLabel("連絡事項（任意）")).toHaveValue(
    "午前の勤務を希望します。",
  );
  await portal.getByLabel("連絡事項（任意）").fill("13時まで勤務できます。");
  await portal.getByRole("button", { name: "変更して再提出" }).click();
  await expect(portal.getByRole("status")).toContainText("希望を提出しました");
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "希望の提出状況", exact: false })
    .click();
  await page
    .getByLabel("対象期間")
    .selectOption({ label: "2099-01-05 〜 2099-01-05" });
  await page.getByLabel("未提出のみ").check();
  await expect(page.getByRole("cell", { name: /佐藤 美咲/ })).toHaveCount(0);
  await page.getByRole("button", { name: "シフト案", exact: true }).click();
  await page
    .getByRole("button", { name: "シフト案を作成", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("未提出・下書き");
  await page.getByRole("button", { name: "3案を作成する" }).click();
  await expect(page.locator(".candidate")).toHaveCount(3);
  await expect(page.locator(".candidate").first()).toContainText("100%");
  await page.getByRole("tab", { name: "スタッフ別一覧" }).click();
  await page.locator(".shift-cell").first().click();
  await page.getByLabel("勤務開始", { exact: true }).selectOption("570");
  await page.getByRole("button", { name: "変更を保存" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "保存していません",
  );
  await page.getByLabel("勤務開始", { exact: true }).selectOption("630");
  await page.getByRole("button", { name: "変更を保存" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByText("重大な違反があります", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "この案を確定する" }).click();
  await expect(
    page.getByRole("button", { name: "確認して確定" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.getByRole("button", { name: "取り消す" }).click();
  await expect(
    page.getByText("重大な違反はありません", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "再検証", exact: true }).click();
  await page.getByRole("tab", { name: "週・日カレンダー" }).click();
  await page.screenshot({
    path: "../artifacts/schedule-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "この案を確定する" }).click();
  await page.getByLabel("確定者名").fill("店長 佐々木");
  await page.getByRole("button", { name: "確認して確定" }).click();
  await expect(
    page.getByRole("button", { name: "再編集を開始" }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "CSV出力" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("shift.csv");
  await file.saveAs("../artifacts/e2e-shift.csv");
  await portal.reload();
  await portal.getByRole("button", { name: "確定シフト", exact: true }).click();
  await expect(
    portal.getByRole("heading", { name: "確定したシフト" }),
  ).toBeVisible();
  await expect(
    portal
      .locator(".day-slot.confirmed strong")
      .filter({ hasText: "10:00–13:00" }),
  ).toBeVisible();
  await portal.screenshot({
    path: "../artifacts/confirmed-mobile.png",
    fullPage: true,
  });
  await page.evaluate(() => {
    window.print = () => {
      document.documentElement.dataset.printCalled = "yes";
    };
  });
  await page.getByRole("button", { name: "印刷", exact: true }).click();
  expect(
    await page.evaluate(() => document.documentElement.dataset.printCalled),
  ).toBe("yes");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".print-only")).toBeVisible();
  await expect(page.locator(".print-only")).toContainText("13:00");
  await page.screenshot({
    path: "../artifacts/print-layout.png",
    fullPage: true,
  });
  await page.emulateMedia({ media: "screen" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "概要", exact: true }).click();
  await page.screenshot({
    path: "../artifacts/dashboard-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(
    (await portal.request.get("http://127.0.0.1:8001/api/state")).status(),
  ).toBe(401);
  expect(errors.filter((e) => !e.includes("422"))).toEqual([]);
  expect(errors.filter((e) => e.includes("422"))).toHaveLength(1);
  await employeeContext.close();
});
