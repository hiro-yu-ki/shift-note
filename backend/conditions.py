"""Deterministic, preview-only Japanese condition parsing. Never execute prose."""

import re
import unicodedata

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/conditions")
WEEK = "月火水木金土日"


class TextInput(BaseModel):
    text: str = Field(max_length=2000)
    use_ai: bool = False
    consent: bool = False


def parse_conditions(text):
    patch, interpreted, errors = {}, [], []
    # One clause per line. Full matching deliberately rejects ambiguous leftovers.
    for number, raw in enumerate(text.splitlines(), 1):
        line = unicodedata.normalize("NFKC", raw).strip().rstrip("。")
        if not line:
            continue
        match = re.fullmatch(
            r"(基本|限定|不可|固定)[:： ]+([月火水木金土日、,・ ]+)\s+(\d{1,2}):(\d{2})\s*[-〜～–]\s*(\d{1,2}):(\d{2})",
            line,
        )
        if match:
            kind, wd, h1, m1, h2, m2 = match.groups()
            lo, hi = int(h1) * 60 + int(m1), int(h2) * 60 + int(m2)
            if (
                int(m1) >= 60
                or int(m2) >= 60
                or lo < 0
                or hi > 1440
                or lo >= hi
                or lo % 15
                or hi % 15
            ):
                errors.append(
                    {
                        "line": number,
                        "text": raw,
                        "message": "時間は15分単位・0:00〜24:00で、終了を開始より後にしてください",
                    }
                )
                continue
            key = "blocks" if kind == "不可" else "fixed_shifts" if kind == "固定" else "regular"
            patch.setdefault(key, []).extend(
                {"weekday": WEEK.index(w), "start": lo, "end": hi}
                for w in dict.fromkeys(wd)
                if w in WEEK
            )
            if kind == "限定":
                patch["regular_only"] = True
            interpreted.append(f"{kind}曜日・時間帯：{wd} {h1}:{m1}–{h2}:{m2}")
            continue
        match = re.fullmatch(
            r"(時給|週の希望|週の最低|週の上限|期間の上限|最短勤務|1日の上限|連勤上限|勤務間隔|週の最大日数|期間の最低日数)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(円|時間|日)?",
            line,
        )
        if match:
            label, value, unit = match.groups()
            keys = {
                "時給": "hourly_rate",
                "週の希望": "target",
                "週の最低": "minimum",
                "週の上限": "maximum",
                "期間の上限": "period_max",
                "最短勤務": "day_min",
                "1日の上限": "day_max",
                "連勤上限": "consecutive",
                "勤務間隔": "interval",
                "週の最大日数": "max_days_week",
                "期間の最低日数": "min_shifts_period",
            }
            expected = (
                "円"
                if label == "時給"
                else "日"
                if "日数" in label or label == "連勤上限"
                else "時間"
            )
            if unit and unit != expected:
                errors.append({"line": number, "text": raw, "message": f"単位は{expected}です"})
                continue
            key = keys[label]
            val = float(value)
            if (key not in ("day_min", "day_max") and val % 1) or (
                key in patch and patch[key] != val
            ):
                errors.append(
                    {
                        "line": number,
                        "text": raw,
                        "message": "数値の形式または同じ項目の矛盾を確認してください",
                    }
                )
                continue
            patch[key] = val if key in ("day_min", "day_max") else int(val)
            interpreted.append(f"{label}：{value}{expected}")
            continue
        match = re.fullmatch(r"(最早開始|最遅終了)\s*[:： ]\s*(\d{1,2}):(\d{2})", line)
        if match:
            label, hour, minute = match.groups()
            value = int(hour) * 60 + int(minute)
            if int(minute) >= 60 or value > 1440 or value % 15:
                errors.append(
                    {"line": number, "text": raw, "message": "時刻は15分単位・0:00〜24:00です"}
                )
            else:
                patch["earliest_start" if label == "最早開始" else "latest_end"] = value
                interpreted.append(line)
            continue
        errors.append(
            {
                "line": number,
                "text": raw,
                "message": "解釈できません。表示されている書式へ直すか、記録用の備考へ移してください。自動割当には反映しません。",
            }
        )
    return {
        "patch": patch,
        "interpreted": interpreted,
        "errors": errors,
        "can_apply": bool(interpreted) and not errors,
        "mode": "local",
        "notice": "外部送信なしの書式解析です。自由な文章を理解する生成AIではありません。確認して反映するまで勤務条件は変更されません。",
    }


@router.post("/preview")
def preview(body: TextInput):
    if body.use_ai:
        from .condition_ai import translate

        if not body.consent:
            raise HTTPException(422, "条件文をOpenAIへ送信する確認が必要です")
        result = translate(body.text)
        parsed = parse_conditions("\n".join(result.lines))
        parsed["errors"].extend(
            {
                "line": 0,
                "text": v,
                "message": "自動作成で扱えない、または曖昧な条件です。書式を修正するか管理者が個別に確認してください",
            }
            for v in result.unsupported
        )
        parsed["can_apply"] = bool(parsed["interpreted"]) and not parsed["errors"]
        parsed["mode"] = "ai"
        parsed["notice"] = (
            "AIによる読み取り案です。原文と数値・曜日・必須／優先の違いを確認してください。反映後もローカルの制約検証を必ず行います。"
        )
        return parsed
    return parse_conditions(body.text)


@router.get("/status")
def status():
    from .condition_ai import configured

    return {"ai_configured": configured()}
