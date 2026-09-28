import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SubmissionForm } from "./SubmissionForm";
import { RequirementEditor } from "./Editors";
import type { Period, State } from "./types";
const period: Period = {
  id: "p",
  start: "2026-10-05",
  end: "2026-10-06",
  deadline: "2026-10-01T20:00:00+09:00",
  status: "募集中",
  special: [],
  selected: null,
  confirmed_at: null,
  confirmed_by: null,
};
const store = {
  name: "喫茶",
  start: 600,
  end: 1200,
  step: 30 as const,
  week_start: 0,
};
describe("希望入力", () => {
  it("基本パターンの読込は既存の休み希望を上書きせず、提出も自動実行しない", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <SubmissionForm
        period={period}
        store={store}
        staff={{
          id: "s",
          target: 20,
          regular: [
            { weekday: 0, start: 600, end: 780 },
            { weekday: 1, start: 600, end: 780 },
          ],
        }}
        initial={{
          staff: "s",
          period: "p",
          status: "下書き",
          target: 20,
          notes: "",
          updated_at: "",
          slots: [
            { date: "2026-10-05", start: 0, end: 1440, kind: "勤務不可" },
          ],
        }}
        onSave={save}
      />,
    );
    fireEvent.click(screen.getByText("基本の曜日・時間帯を未入力日に入れる"));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("希望を提出する"));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0].slots).toEqual([
      { date: "2026-10-05", start: 0, end: 1440, kind: "勤務不可" },
      { date: "2026-10-06", start: 600, end: 780, kind: "勤務可能" },
    ]);
  });
  it("前日コピーと提出ができる", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <SubmissionForm
        period={period}
        store={store}
        staff={{ id: "s", target: 20 }}
        initial={null}
        onSave={save}
      />,
    );
    fireEvent.click(screen.getByLabelText("2026-10-05の希望を入力"));
    fireEvent.click(screen.getByText("この日を入力"));
    fireEvent.click(screen.getByLabelText("2026-10-06の希望を入力"));
    fireEvent.click(screen.getByText("前日と同じ希望にする"));
    fireEvent.click(screen.getByText("この日を入力"));
    fireEvent.click(screen.getByText("希望を提出する"));
    await waitFor(() => expect(save).toHaveBeenCalled());
    const data = save.mock.calls[0][0];
    expect(data.slots).toHaveLength(2);
    expect(data.status).toBe("提出済み");
  });
  it("無効な時刻をその場で案内する", () => {
    render(
      <SubmissionForm
        period={period}
        store={store}
        staff={{ id: "s", target: 20 }}
        initial={null}
        onSave={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("2026-10-05の希望を入力"));
    fireEvent.change(screen.getByLabelText("終了時刻"), {
      target: { value: "540" },
    });
    fireEvent.click(screen.getByText("この日を入力"));
    expect(screen.getByRole("alert")).toHaveTextContent("終了時刻");
  });
});
it("役割合計が必要人数を超えたら保存を止める", () => {
  const state: State = {
    version: 0,
    store,
    roles: [{ id: "r", name: "責任者" }],
    staff: [],
    periods: [period],
    requirements: [],
    submissions: [],
    candidates: [],
  };
  const save = vi.fn();
  render(<RequirementEditor state={state} period={period} save={save} />);
  fireEvent.change(screen.getByLabelText("責任者の必要人数"), {
    target: { value: "3" },
  });
  fireEvent.click(screen.getByText("条件を保存"));
  expect(screen.getByRole("alert")).toHaveTextContent("役割人数の合計");
  expect(save).not.toHaveBeenCalled();
});
