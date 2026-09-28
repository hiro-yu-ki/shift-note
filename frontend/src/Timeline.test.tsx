import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { WeekTimeline, worksDuring } from "./WeekTimeline";
import { DayTimeline } from "./DayTimeline";
import type { State, Period, Candidate, Assignment } from "./types";

const assignment: Assignment = {
  id: "a",
  staff: "s",
  date: "2099-02-02",
  start: 600,
  end: 720,
  role: "r",
  breaks: [{ start: 630, end: 660 }],
  reason: "",
};
const period = {
  id: "p",
  start: "2099-02-02",
  end: "2099-02-02",
  special: [],
  deadline: "2099-02-01T00:00:00Z",
  status: "募集中",
  selected: null,
  confirmed_at: null,
  confirmed_by: null,
} as Period;
const candidate = { id: "c", assignments: [assignment] } as Candidate;
const state = {
  store: { start: 600, end: 1080 },
  staff: [
    { id: "s", name: "出勤する人", roles: ["r"], active: true },
    { id: "off", name: "休みの人", roles: ["r"], active: true },
  ],
  roles: [{ id: "r", name: "受付" }],
} as State;

describe("日付と時間のシフト表", () => {
  it("勤務と休憩の境界を区別する", () => {
    expect(worksDuring(assignment, 630, 660)).toBe(false);
    expect(worksDuring(assignment, 600, 660)).toBe(true);
    expect(worksDuring(assignment, 720, 780)).toBe(false);
  });
  it("枠は名前だけ、詳細を開いて編集する", () => {
    const edit = vi.fn();
    render(
      <WeekTimeline
        state={state}
        period={period}
        candidate={candidate}
        onEdit={edit}
      />,
    );
    const cell = screen.getByRole("button", {
      name: "2099-02-02 10:00からの勤務 1人",
    });
    expect(cell).toHaveTextContent("出勤する人");
    expect(cell).not.toHaveTextContent("受付");
    fireEvent.mouseEnter(cell);
    expect(screen.getByRole("tooltip")).toHaveTextContent("受付");
    fireEvent.click(cell);
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /出勤する人/,
      }),
    );
    expect(edit).toHaveBeenCalledWith(assignment);
  });
  it("一日の配置は出勤している人だけ", () => {
    render(
      <DayTimeline
        state={state}
        period={period}
        candidate={candidate}
        onEdit={() => {}}
      />,
    );
    expect(screen.queryByText("休みの人")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "出勤する人" }),
    ).toBeInTheDocument();
  });
});
