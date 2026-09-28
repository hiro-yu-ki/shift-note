import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("管理者がメール登録し従業員が本人だけの画面にログインする", async ({
  page,
  browser,
}) => {
  const status = await (await page.request.get("/api/auth/status")).json();
  await page.request.post(
    `/api/auth/${status.configured ? "login" : "setup"}`,
    { data: { password: "test-manager-password" } },
  );
  let state = await (await page.request.get("/api/state")).json();
  if (!state.store) {
    await page.request.post("/api/setup", {
      data: {
        store: { name: "認証テスト", start: 600, end: 1200 },
        demo: true,
      },
    });
    state = await (await page.request.get("/api/state")).json();
  }
  const staff = state.staff.find((s: { active: boolean }) => s.active);
  await page.goto("/admin");
  await page.getByRole("button", { name: "スタッフ", exact: true }).click();
  await page.getByLabel("登録するスタッフ").selectOption(staff.id);
  await page
    .getByLabel("本人のメールアドレス")
    .fill("release-test@example.com");
  await page
    .getByRole("button", { name: "メールアドレスを登録・変更" })
    .click();
  await expect(
    page.getByText(
      "登録しました。以前のログインと確認コードは無効になりました。",
    ),
  ).toBeVisible();
  await page.screenshot({
    path: "../artifacts/release-admin-accounts.png",
    fullPage: true,
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const crew = await context.newPage();
  await crew.goto("/employee");
  await crew
    .getByLabel("メールアドレス", { exact: true })
    .fill("release-test@example.com");
  await crew.getByRole("button", { name: "確認コードを送る" }).click();
  await expect(crew.getByLabel("8桁の確認コード")).toBeVisible();
  const mail = JSON.parse(await readFile("test-results/mailbox.json", "utf8"));
  expect(mail.email).toBe("release-test@example.com");
  await crew.getByLabel("8桁の確認コード").fill(mail.code);
  await crew.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(crew.getByRole("button", { name: "ログアウト" })).toBeVisible();
  await expect(
    crew.getByRole("heading", { name: "シフト希望を入力" }),
  ).toBeVisible();
  expect((await crew.request.get("/api/state")).status()).toBe(401);
  expect((await crew.request.get("/api/employee-accounts")).status()).toBe(401);
  if (state.periods.some((p: {id: string}) => p.id === "qa-break")) {
    await crew.getByLabel("対象期間").selectOption("qa-break");
  }
  await crew.getByRole("button", { name: "確定シフト", exact: true }).click();
  await crew.screenshot({
    path: "../artifacts/release-employee-mobile.png",
    fullPage: true,
  });
  expect(
    await crew.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await crew.getByRole("button", { name: "勤務日・変更相談" }).click();
  await expect(crew.getByRole("heading", { name: "これからの勤務" })).toBeVisible();
  await crew.getByRole("button", { name: "勤務実績・給与" }).click();
  await expect(crew.getByRole("heading", { name: "打刻の記録" })).toBeVisible();
  expect(await crew.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await crew.getByRole("button", { name: "ログアウト" }).click();
  await expect(
    crew.getByRole("heading", { name: "シフトを確認する" }),
  ).toBeVisible();
  expect(
    (
      await crew.request.get(`/api/employee/portal/${state.periods[0].id}`)
    ).status(),
  ).toBe(401);
  await context.close();
});
