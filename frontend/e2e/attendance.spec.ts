import { test, expect } from "@playwright/test";

test("店舗の打刻画面で名前を選び出勤・退勤する", async ({ page }) => {
  let working = false;
  await page.route("**/api/kiosk/**", async (route) => {
    const url = route.request().url();
    if (url.endsWith("clock-in")) working = true;
    if (url.endsWith("clock-out")) working = false;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(url.endsWith("today") ? {
        date: "2026-09-29", store: "サンプル店舗",
        scheduled: working ? [] : [{ staff: "s", name: "山田 花", start: 600, end: 1080 }],
        working: working ? [{ id: "a", staff: "s", name: "山田 花", clock_in: "2026-09-29T01:00:00+00:00" }] : [],
        finished: 0,
      } : { id: "a" }),
    });
  });
  await page.goto("/clock#token=test-kiosk-link");
  await expect(page.getByRole("heading", { name: "出勤・退勤" })).toBeVisible();
  await page.getByRole("button", { name: /山田 花.*予定/ }).click();
  await page.getByRole("button", { name: "出勤を記録" }).click();
  await expect(page.getByText("出勤を記録しました")).toBeVisible();
  await page.getByRole("button", { name: "退勤する" }).click();
  await page.getByRole("button", { name: /山田 花.*出勤/ }).click();
  await page.getByRole("button", { name: "退勤を記録" }).click();
  await expect(page.getByText(/退勤を記録しました/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
