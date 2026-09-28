from pathlib import Path
p=Path('backend/engine.py')
s=p.read_text(encoding='utf-8-sig')
s=s.replace('from datetime import timedelta','from datetime import timedelta\nfrom math import ceil, floor')
s=s.replace('def validate(state, candidate):','def validate(state, candidate):\n    step = state.store.step')
s=s.replace('def solve(state, period, preset="バランス重視", seed=42, relaxed=False):','def solve(state, period, preset="バランス重視", seed=42, relaxed=False):\n    step = state.store.step\n    units = 60 / step')
s=s.replace('def preflight_check(state, p):','def preflight_check(state, p):\n    step = state.store.step')
s=s.replace(', 30)', ', step)').replace('t + 30','t + step').replace('t - 30','t - step').replace('t-30','t-step').replace('t + 30','t + step').replace('u - t - 30','u - t - step').replace('selected[-1][0] + 30','selected[-1][0] + step')
s=s.replace('round(s.day_min * 2)','ceil(s.day_min * units)').replace('round(s.day_max * 2)','floor(s.day_max * units)').replace('s.maximum * 2','floor(s.maximum * units)').replace('s.period_max * 2','floor(s.period_max * units)').replace('/ 7 * 2','/ 7 * units')
s=s.replace('(a.end - a.start) // 30','ceil((a.end - a.start) / step)')
s=s.replace('model.new_int_var(0, 1500','model.new_int_var(0, 4000').replace('model.new_int_var(0, 3000','model.new_int_var(0, 5000')
# Existing stored dates are retained. Solver snaps opening to the configured grid.
s=s.replace('lo, hi = hours(state, period, d)','lo, hi = hours(state, period, d)\n            lo, hi = ceil(lo / step) * step, floor(hi / step) * step',1)
# All solver day ranges use aligned hours (Store and Special are validated on save).
p.write_text(s,encoding='utf-8')
p=Path('backend/schema.py');s=p.read_text(encoding='utf-8-sig').replace('t + 30','t + state.store.step');p.write_text(s,encoding='utf-8')
