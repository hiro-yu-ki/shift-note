import { test, expect } from "@playwright/test";
test("曜日別設定・特定日・管理者による従業員画面確認", async ({ page }) => {
  const auth = await (await page.request.get("/api/auth/status")).json();
  await page.request.post(`/api/auth/${auth.configured ? "login" : "setup"}`, {
    data: { password: "test-manager-password" },
  });
  let state = await (await page.request.get("/api/state")).json();
  if (!state.store) {
    await page.request.post("/api/setup", {
      data: { store: { name: "設定確認", start: 600, end: 1200 }, demo: true },
    });
    state = await (await page.request.get("/api/state")).json();
  }
  const p = state.periods.find(
    (p: { status: string }) => p.status !== "確定済み",
  );
  await page.goto("/admin");
  await page.getByLabel("対象期間").selectOption(p.id);
  await page
    .getByRole("button", { name: "必要人数・役割", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "必要人数の設定日" })
    .getByRole("button", { name: "火曜日", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "火曜日の必要人数・役割" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "条件を追加" }).click();
  await expect(page.getByLabel("適用する日")).toHaveValue("1");
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await page
    .getByRole("navigation", { name: "必要人数の設定日" })
    .getByRole("button", { name: "特定日", exact: true })
    .click();
  await expect(page.getByLabel("設定する特定日")).toHaveValue(p.start);
  await page.getByRole("button", { name: "条件を追加" }).click();
  await expect(page.getByLabel("適用する日")).toHaveValue("date");
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.screenshot({
    path: "../artifacts/requirements-date-page.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "スタッフ", exact: true }).click();
  const href = await page
    .getByRole("link", {
      name: "選択した従業員の画面を確認（管理者用・閲覧のみ）",
    })
    .getAttribute("href");
  await page.goto(href!);
  await expect(page.getByText(/管理者による閲覧確認です/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "シフト希望を入力" }),
  ).toBeVisible();
  expect(
    await page
      .getByRole("button", { name: /希望を提出する|変更して再提出/ })
      .isEnabled(),
  ).toBe(false);
});
