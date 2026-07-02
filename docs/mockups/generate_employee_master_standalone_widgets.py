from __future__ import annotations

from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFilter, ImageFont


OUT_DIR = Path(__file__).resolve().parent / "employee-master-standalone-widgets"
SHEET = Path(__file__).resolve().parent / "employee-master-standalone-widgets-sheet.png"

W, H = 1280, 720
CARD = (64, 52, 1152, 616)

BG = "#EEF3F9"
CARD_WHITE = "#FFFFFF"
CARD_SOFT = "#F7FAFE"
LINE = "#D8E2EF"
INK = "#12213A"
MUTED = "#637493"
MUTED_2 = "#97A7BD"
NAVY = "#142754"
NAVY_2 = "#1E3A68"
NAVY_3 = "#2C4D80"
BLUE = "#367CFF"
CYAN = "#31C4F3"
GREEN = "#17A66A"
AMBER = "#D88A05"
RED = "#E33434"
VIOLET = "#7568F4"
ICE = "#EAF2FF"


def font_path(weight: str) -> str | None:
    root = Path("C:/Windows/Fonts")
    names = {
        "regular": ["segoeui.ttf", "arial.ttf"],
        "semibold": ["seguisb.ttf", "arialbd.ttf"],
        "bold": ["segoeuib.ttf", "arialbd.ttf"],
    }[weight]
    for name in names:
        candidate = root / name
        if candidate.exists():
            return str(candidate)
    return None


def font(size: int, weight: str = "regular"):
    path = font_path(weight)
    return ImageFont.truetype(path, size) if path else ImageFont.load_default()


F = {
    "eyebrow": font(18, "bold"),
    "caption": font(20),
    "tiny": font(19, "bold"),
    "small": font(23),
    "small_sb": font(23, "semibold"),
    "body": font(28),
    "body_sb": font(28, "semibold"),
    "h3": font(34, "bold"),
    "h2": font(42, "bold"),
    "h1": font(54, "bold"),
    "metric": font(88, "bold"),
    "metric_big": font(124, "bold"),
}


def new_canvas(bg: str = BG) -> Image.Image:
    return Image.new("RGBA", (W, H), bg)


def rr(draw: ImageDraw.ImageDraw, xy, r: int, fill, outline=None, width: int = 2):
    draw.rounded_rectangle(xy, radius=r, fill=fill, outline=outline, width=width if outline else 1)


def text(draw: ImageDraw.ImageDraw, xy, value: str, ft, fill=INK, anchor="la"):
    draw.text(xy, value, font=ft, fill=fill, anchor=anchor)


def shadow(base: Image.Image, xy, r: int = 44, color=(23, 42, 75, 30), blur: int = 20, dy: int = 16):
    x1, y1, x2, y2 = xy
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle([x1 + 4, y1 + dy, x2 + 4, y2 + dy], radius=r, fill=color)
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    base.alpha_composite(layer)


def card(base: Image.Image, fill=CARD_WHITE, outline=LINE, r: int = 44, xy=CARD):
    shadow(base, xy, r=r)
    d = ImageDraw.Draw(base)
    rr(d, xy, r, fill, outline)


def gradient_card(base: Image.Image, xy=CARD, start="#142754", end="#203D70", r: int = 44):
    shadow(base, xy, r=r, color=(7, 20, 48, 58), blur=22, dy=18)
    x1, y1, x2, y2 = xy
    grad = Image.new("RGBA", (x2 - x1, y2 - y1), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    s = tuple(int(start[i : i + 2], 16) for i in (1, 3, 5))
    e = tuple(int(end[i : i + 2], 16) for i in (1, 3, 5))
    for y in range(y2 - y1):
        t = y / max(1, y2 - y1 - 1)
        col = tuple(int(s[i] * (1 - t) + e[i] * t) for i in range(3)) + (255,)
        gd.line([(0, y), (x2 - x1, y)], fill=col)
    mask = Image.new("L", (x2 - x1, y2 - y1), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, x2 - x1, y2 - y1], radius=r, fill=255)
    base.paste(grad, (x1, y1), mask)
    d = ImageDraw.Draw(base)
    rr(d, xy, r, fill=None, outline="#385584", width=2)


def pill(draw: ImageDraw.ImageDraw, x: int, y: int, label: str, fg: str, bg: str, pad=22, h=42):
    box = draw.textbbox((0, 0), label, font=F["small_sb"])
    w = box[2] - box[0] + pad * 2
    rr(draw, [x, y, x + w, y + h], h // 2, bg)
    text(draw, (x + w / 2, y + h / 2 - 1), label, F["small_sb"], fg, anchor="mm")
    return w


def progress(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, pct: float, color: str, bg="#E6EDF6", h=16):
    rr(draw, [x, y, x + w, y + h], h // 2, bg)
    if pct > 0:
        rr(draw, [x, y, x + max(h, int(w * pct / 100)), y + h], h // 2, color)


def donut(draw: ImageDraw.ImageDraw, cx: int, cy: int, r: int, pct: float, color: str, bg="#E5ECF5", width=24, dark=False):
    box = [cx - r, cy - r, cx + r, cy + r]
    draw.arc(box, 0, 360, fill=bg, width=width)
    if pct > 0:
        draw.arc(box, -90, -90 + 360 * pct / 100, fill=color, width=width)
    text(draw, (cx, cy - 9), f"{int(round(pct))}%", F["h2"], "#FFFFFF" if dark else INK, anchor="mm")
    text(draw, (cx, cy + 34), "ready", F["small"], "#B8C6DC" if dark else MUTED, anchor="mm")


def mini_icon(draw: ImageDraw.ImageDraw, x: int, y: int, label: str, tone: str, bg: str = ICE):
    rr(draw, [x, y, x + 56, y + 56], 18, bg)
    text(draw, (x + 28, y + 27), label, F["tiny"], tone, anchor="mm")


def section_title(draw, title: str, subtitle: str, dark=False):
    fill = "#FFFFFF" if dark else INK
    sub = "#AFC0D9" if dark else MUTED
    text(draw, (112, 116), title, F["h2"], fill)
    text(draw, (112, 166), subtitle, F["small"], sub)


def small_stat(draw, x, y, w, label, value, note, dark=False, tone=BLUE):
    fill = "#24436F" if dark else CARD_SOFT
    outline = "#3A5B8B" if dark else LINE
    rr(draw, [x, y, x + w, y + 112], 24, fill, outline)
    text(draw, (x + 28, y + 34), label.upper(), F["eyebrow"], "#AFC0D9" if dark else MUTED, anchor="lm")
    text(draw, (x + 28, y + 78), value, F["h2"], "#FFFFFF" if dark else INK, anchor="lm")
    text(draw, (x + 116, y + 78), note, F["small"], "#B9C6D8" if dark else MUTED, anchor="lm")
    rr(draw, [x + w - 42, y + 34, x + w - 22, y + 54], 10, tone)


def row(draw, x, y, label, value, pct, color, dark=False, w=420):
    rr(draw, [x, y + 5, x + 18, y + 23], 9, color)
    text(draw, (x + 34, y + 14), label, F["small_sb"], "#DCE7F7" if dark else INK, anchor="lm")
    text(draw, (x + 368, y + 14), value, F["small_sb"], "#FFFFFF" if dark else INK, anchor="rm")
    progress(draw, x + 402, y + 6, w - 402, pct, color, "#365783" if dark else "#E6EDF6", h=16)


def compact_dark_row(draw, x, y, label, value, pct, color, w=220):
    rr(draw, [x, y + 5, x + 18, y + 23], 9, color)
    text(draw, (x + 30, y + 14), label, F["small_sb"], "#DCE7F7", anchor="lm")
    text(draw, (x + w, y + 14), value, F["small_sb"], "#FFFFFF", anchor="rm")
    progress(draw, x + 30, y + 40, w - 30, pct, color, "#365783", h=12)


def save(name: str, img: Image.Image) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / name
    img.convert("RGB").save(out, quality=96)
    return out


def widget_01_workforce_pulse() -> Path:
    img = new_canvas("#EAF1F9")
    gradient_card(img, start="#111F46", end="#1F4274")
    d = ImageDraw.Draw(img)
    mini_icon(d, 108, 104, "HR", "#FFFFFF", "#2E4E80")
    text(d, (184, 118), "Workforce Pulse", F["h2"], "#FFFFFF")
    text(d, (184, 168), "Live people record signal for the Employee Master register.", F["small"], "#B9C8DE")
    pill(d, 998, 110, "LIVE REGISTER", "#BFE4FF", "#294C7F", h=44)

    text(d, (116, 352), "23", F["metric_big"], "#FFFFFF", anchor="lm")
    text(d, (300, 330), "active people records", F["body_sb"], "#DDE8F7", anchor="lm")
    text(d, (300, 374), "23 employees  |  0 contractors  |  +0 net movement", F["small"], "#AFC0D9", anchor="lm")

    small_stat(d, 112, 444, 246, "Employees", "23", "records", dark=True, tone=GREEN)
    small_stat(d, 386, 444, 246, "HR queue", "0", "open", dark=True, tone=CYAN)
    small_stat(d, 660, 444, 246, "Sites", "0", "assigned", dark=True, tone=AMBER)

    xs = [922, 954, 986, 1018, 1050, 1082]
    ys = [506, 498, 494, 488, 484, 478]
    d.line(list(zip(xs, ys)), fill=CYAN, width=8)
    for x, y in zip(xs, ys):
        rr(d, [x - 8, y - 8, x + 8, y + 8], 8, "#D7F6FF")
    text(d, (922, 432), "6-month trend", F["small_sb"], "#DDE8F7")
    text(d, (922, 568), "Stable", F["body_sb"], "#FFFFFF")
    text(d, (1014, 568), "no change", F["small"], "#AFC0D9")
    return save("01-workforce-pulse.png", img)


def widget_02_record_health() -> Path:
    img = new_canvas()
    card(img)
    d = ImageDraw.Draw(img)
    section_title(d, "Record Health", "Completeness, blocker density, and clean handoff status.")
    pill(d, 990, 108, "NEEDS CLEANUP", RED, "#FFF0F0")

    rr(d, [118, 230, 450, 536], 36, "#F8FBFF", LINE)
    donut(d, 284, 360, 104, 20, RED)
    text(d, (284, 484), "master data complete", F["small_sb"], MUTED, anchor="mm")

    metrics = [
        ("Supervisor attached", "0 / 23", 0, RED),
        ("Department assigned", "21 / 23", 91, GREEN),
        ("Site assigned", "0 / 23", 0, AMBER),
        ("Payroll ready", "0 / 23", 0, RED),
        ("Training current", "2 / 23", 9, BLUE),
    ]
    y = 246
    for label, value, pct, color in metrics:
        row(d, 520, y, label, value, pct, color, w=560)
        y += 70

    rr(d, [520, 582, 1100, 624], 21, "#F0F5FC", LINE)
    text(d, (552, 603), "Next action: assign supervisors before handoff.", F["small_sb"], NAVY, anchor="lm")
    return save("02-record-health.png", img)


def widget_03_assignment_coverage() -> Path:
    img = new_canvas("#F1F5FA")
    card(img, fill="#FBFDFF")
    d = ImageDraw.Draw(img)
    section_title(d, "Assignment Coverage", "A clean operating view of department, supervisor, and site coverage.")
    pill(d, 980, 108, "23 BLOCKED", RED, "#FFF1F1")

    lanes = [
        ("Department", "21 assigned", 21, 23, GREEN),
        ("Supervisor", "0 assigned", 0, 23, RED),
        ("Site", "0 assigned", 0, 23, AMBER),
    ]
    y = 244
    for title, caption, count, total, color in lanes:
        text(d, (120, y + 28), title, F["body_sb"], INK)
        text(d, (120, y + 68), caption, F["small"], MUTED)
        rr(d, [356, y, 1090, y + 92], 28, "#F4F8FD", LINE)
        cell_x = 386
        for i in range(total):
            fill = color if i < count else "#DDE7F2"
            rr(d, [cell_x, y + 34, cell_x + 18, y + 58], 8, fill)
            cell_x += 28
        text(d, (1036, y + 46), f"{count}/{total}", F["body_sb"], color, anchor="rm")
        y += 128

    rr(d, [120, 594, 1090, 636], 21, "#142754")
    text(d, (150, 615), "Cleanup queue: supervisor first, then site and department handoff checks.", F["small_sb"], "#FFFFFF", anchor="lm")
    return save("03-assignment-coverage.png", img)


def widget_04_readiness_ledger() -> Path:
    img = new_canvas("#EAF1F9")
    gradient_card(img, start="#13244F", end="#183967")
    d = ImageDraw.Draw(img)
    section_title(d, "Readiness Ledger", "Payroll, statutory, and certificate readiness without opening every profile.", dark=True)
    pill(d, 998, 108, "0% READY", "#FFD1D1", "#3A284C")

    rr(d, [116, 240, 386, 520], 34, "#24436F", "#3B5E91")
    donut(d, 251, 352, 84, 0, GREEN, "#3D5D8E", dark=True)
    text(d, (251, 464), "payroll ready", F["small_sb"], "#DDE8F7", anchor="mm")

    columns = [
        ("Payroll", [("Ready", "0", 0, RED), ("Missing", "23", 100, RED)]),
        ("Training", [("Current", "2", 9, GREEN), ("Expired", "1", 4, RED), ("Due soon", "4", 17, AMBER)]),
        ("Workflow", [("Open changes", "0", 0, CYAN), ("Profile tasks", "0", 0, BLUE)]),
    ]
    x = 438
    for title, rows in columns:
        text(d, (x, 254), title, F["body_sb"], "#FFFFFF")
        y = 314
        for label, value, pct, color in rows:
            compact_dark_row(d, x, y, label, value, pct, color, w=208)
            y += 72
        x += 250

    text(d, (116, 580), "Readiness cockpit for payroll, statutory, and training cleanup.", F["small"], "#B8C8DF")
    return save("04-readiness-ledger.png", img)


def widget_05_exception_command() -> Path:
    img = new_canvas()
    card(img)
    d = ImageDraw.Draw(img)
    mini_icon(d, 108, 104, "!", RED, "#FFF0F0")
    text(d, (184, 118), "Exception Command", F["h2"], INK)
    text(d, (184, 168), "Prioritized cleanup by business impact, not generic KPI counts.", F["small"], MUTED)
    text(d, (1072, 146), "26", F["metric"], RED, anchor="mm")
    text(d, (1072, 204), "blocking items", F["small_sb"], MUTED, anchor="mm")

    items = [
        ("Supervisor missing", "23 records", "Blocks approvals and reporting lines", RED, 100),
        ("Department missing", "2 records", "Blocks workforce grouping", AMBER, 9),
        ("Training expired", "1 record", "Blocks readiness confidence", BLUE, 4),
    ]
    y = 280
    for label, value, note, color, pct in items:
        rr(d, [116, y, 1088, y + 88], 28, "#F8FBFF", LINE)
        rr(d, [144, y + 30, 172, y + 58], 14, color)
        text(d, (198, y + 31), label, F["body_sb"], INK)
        text(d, (198, y + 64), note, F["small"], MUTED)
        progress(d, 654, y + 40, 260, pct, color)
        text(d, (1048, y + 44), value, F["small_sb"], color, anchor="rm")
        y += 112

    pill(d, 116, 604, "ASSIGN SUPERVISORS", "#FFFFFF", NAVY, h=50)
    pill(d, 388, 604, "REVIEW DEPARTMENTS", NAVY, "#EAF2FF", h=50)
    return save("05-exception-command.png", img)


def widget_06_training_risk() -> Path:
    img = new_canvas("#EFF5FA")
    card(img, fill="#FFFFFF")
    d = ImageDraw.Draw(img)
    section_title(d, "Training Risk", "Certificate signal from worker training records and HSE readiness.")
    pill(d, 970, 108, "1 EXPIRED", RED, "#FFF0F0")

    labels = ["Ops", "Admin", "Field", "Project", "Worker"]
    states = [
        [GREEN, AMBER, RED, "#DCE6F2", AMBER],
        [GREEN, GREEN, AMBER, "#DCE6F2", "#DCE6F2"],
        [AMBER, RED, "#DCE6F2", GREEN, AMBER],
        ["#DCE6F2", AMBER, GREEN, "#DCE6F2", RED],
    ]
    text(d, (120, 246), "Risk heatmap", F["body_sb"], INK)
    for i, label in enumerate(labels):
        text(d, (220 + i * 100, 300), label, F["small_sb"], MUTED, anchor="mm")
    for r, row_colors in enumerate(states):
        text(d, (128, 352 + r * 70), f"Group {r + 1}", F["small_sb"], MUTED, anchor="lm")
        for c, color in enumerate(row_colors):
            rr(d, [190 + c * 100, 328 + r * 70, 250 + c * 100, 388 + r * 70], 18, color)

    rr(d, [790, 246, 1084, 534], 34, "#F7FAFE", LINE)
    donut(d, 937, 356, 78, 9, GREEN)
    text(d, (854, 482), "2 current", F["small_sb"], GREEN)
    text(d, (982, 482), "1 expired", F["small_sb"], RED)
    text(d, (854, 520), "4 due soon", F["small_sb"], AMBER)
    return save("06-training-risk.png", img)


def widget_07_department_mix() -> Path:
    img = new_canvas()
    card(img)
    d = ImageDraw.Draw(img)
    section_title(d, "Department Mix", "How the visible workforce is distributed across HR reporting groups.")
    pill(d, 1004, 108, "2 UNASSIGNED", AMBER, "#FFF7E6")

    box = [124, 248, 456, 580]
    d.pieslice(box, -90, 97, fill=GREEN)
    d.pieslice(box, 97, 237, fill=BLUE)
    d.pieslice(box, 237, 270, fill=AMBER)
    rr(d, [228, 352, 352, 476], 62, CARD_WHITE)
    text(d, (290, 394), "23", F["h2"], INK, anchor="mm")
    text(d, (290, 434), "people", F["small"], MUTED, anchor="mm")

    rows_data = [
        ("Operations", "major group", 52, GREEN),
        ("Administration", "secondary group", 39, BLUE),
        ("Missing dept.", "cleanup required", 9, AMBER),
    ]
    y = 286
    for label, note, pct, color in rows_data:
        rr(d, [560, y, 1066, y + 88], 26, "#F8FBFF", LINE)
        rr(d, [592, y + 32, 620, y + 60], 14, color)
        text(d, (644, y + 32), label, F["body_sb"], INK)
        text(d, (644, y + 64), note, F["small"], MUTED)
        progress(d, 888, y + 42, 114, pct, color)
        text(d, (1036, y + 44), f"{pct}%", F["small_sb"], color, anchor="rm")
        y += 108
    return save("07-department-mix.png", img)


def widget_08_supervisor_span() -> Path:
    img = new_canvas("#EAF1F9")
    gradient_card(img, start="#101F48", end="#1E3F70")
    d = ImageDraw.Draw(img)
    section_title(d, "Supervisor Span", "A relationship widget for reporting lines and approval coverage.", dark=True)
    pill(d, 948, 108, "NO SUPERVISORS", "#FFD1D1", "#3A284C")

    nodes = [
        (214, 368, "23", "Employees", GREEN),
        (552, 368, "0", "Supervisors", RED),
        (890, 368, "0", "Sites", AMBER),
    ]
    for i in range(len(nodes) - 1):
        x1, y1 = nodes[i][0], nodes[i][1]
        x2, y2 = nodes[i + 1][0], nodes[i + 1][1]
        d.line([(x1 + 90, y1), (x2 - 90, y2)], fill="#45699B", width=8)
        rr(d, [x1 + 238, y1 - 12, x1 + 262, y1 + 12], 12, RED if i == 0 else AMBER)
    for x, y, value, label, color in nodes:
        rr(d, [x - 100, y - 100, x + 100, y + 100], 46, "#24436F", "#466A9B")
        text(d, (x, y - 12), value, F["metric"], "#FFFFFF", anchor="mm")
        text(d, (x, y + 62), label, F["body_sb"], "#DDE8F7", anchor="mm")
        rr(d, [x - 16, y - 132, x + 16, y - 100], 16, color)

    text(d, (114, 564), "Every row should resolve to supervisor and site before downstream approvals.", F["small"], "#B8C8DF")
    return save("08-supervisor-span.png", img)


def widget_09_employee_focus() -> Path:
    img = new_canvas()
    gradient_card(img, start="#152A5A", end="#203E70")
    d = ImageDraw.Draw(img)
    section_title(d, "Employee Focus", "Selected-row context without opening the full profile drawer.", dark=True)
    pill(d, 1030, 108, "ACTIVE", "#BEF3D4", "#214C5A")

    rr(d, [122, 242, 246, 366], 62, "#6C87B5", "#87A0C9")
    text(d, (184, 304), "AD", F["h2"], "#FFFFFF", anchor="mm")
    text(d, (286, 258), "Amara Diallo", F["h2"], "#FFFFFF")
    text(d, (286, 312), "EMP-0010  |  Field Engineer  |  Operations", F["small"], "#B9C8DE")
    text(d, (286, 354), "No site assigned  |  No supervisor assigned", F["small_sb"], "#FFDFA6")

    chips = [
        ("Training", "Due soon", AMBER),
        ("Supervisor", "Missing", RED),
        ("Workflow", "0 open", CYAN),
        ("Payroll", "Not ready", RED),
    ]
    x = 122
    for title, value, color in chips:
        rr(d, [x, 438, x + 230, 548], 28, "#24436F", "#3B5E91")
        text(d, (x + 28, 472), title.upper(), F["eyebrow"], "#AFC0D9", anchor="lm")
        text(d, (x + 28, 514), value, F["body_sb"], "#FFFFFF", anchor="lm")
        rr(d, [x + 190, 472, x + 206, 488], 8, color)
        x += 256

    pill(d, 122, 584, "REQUEST CHANGE", "#FFFFFF", "#3A5B8C", h=48)
    pill(d, 356, 584, "OPEN PROFILE", NAVY, "#EAF2FF", h=48)
    return save("09-employee-focus.png", img)


def widget_10_handoff_readiness() -> Path:
    img = new_canvas("#F0F5FA")
    card(img)
    d = ImageDraw.Draw(img)
    section_title(d, "Handoff Readiness", "Shows whether employee records can safely move to Payroll, Operations, and HSE.")
    pill(d, 1006, 108, "BLOCKED", RED, "#FFF0F0")

    tracks = [
        ("Payroll", "statutory data missing", 0, RED),
        ("Operations", "supervisor and site missing", 0, AMBER),
        ("HSE", "training signal partial", 9, BLUE),
        ("HR", "profile changes clear", 100, GREEN),
    ]
    y = 238
    for label, note, pct, color in tracks:
        rr(d, [120, y, 1090, y + 82], 26, "#F8FBFF", LINE)
        text(d, (154, y + 30), label, F["body_sb"], INK)
        text(d, (154, y + 58), note, F["caption"], MUTED)
        progress(d, 528, y + 38, 410, pct, color)
        text(d, (1048, y + 44), f"{pct}%", F["body_sb"], color, anchor="rm")
        y += 90

    text(d, (154, 610), "Resolve blocked records before payroll or operations handoff.", F["small_sb"], NAVY, anchor="lm")
    return save("10-handoff-readiness.png", img)


def make_sheet(paths: Iterable[Path]) -> Path:
    thumbs = []
    for path in paths:
        img = Image.open(path).convert("RGB")
        img.thumbnail((560, 315), Image.Resampling.LANCZOS)
        thumbs.append((path, img.copy()))
    sheet = Image.new("RGBA", (1240, 1850), "#E9F0F8")
    d = ImageDraw.Draw(sheet)
    text(d, (56, 44), "Employee Master - Standalone Widget Concepts", font(34, "bold"), INK)
    text(d, (56, 88), "Ten separate widget directions, not adapted from the current page screenshot.", font(21), MUTED)
    x_positions = [56, 624]
    y = 142
    for idx, (path, img) in enumerate(thumbs):
        col = idx % 2
        if col == 0 and idx > 0:
            y += 338
        x = x_positions[col]
        shadow(sheet, [x, y, x + 560, y + 315], r=22, color=(23, 42, 75, 22), blur=12, dy=9)
        sheet.paste(img, (x, y))
        d.rounded_rectangle([x, y, x + 560, y + 315], radius=22, outline="#D7E2EF", width=1)
        d.rounded_rectangle([x, y + 276, x + 560, y + 315], radius=22, fill=(18, 33, 58, 190))
        d.rectangle([x, y + 276, x + 560, y + 296], fill=(18, 33, 58, 190))
        text(d, (x + 18, y + 292), path.stem.replace("-", " ").title(), font(16, "semibold"), "#FFFFFF")
    SHEET.parent.mkdir(parents=True, exist_ok=True)
    sheet.convert("RGB").save(SHEET, quality=95)
    return SHEET


def main():
    paths = [
        widget_01_workforce_pulse(),
        widget_02_record_health(),
        widget_03_assignment_coverage(),
        widget_04_readiness_ledger(),
        widget_05_exception_command(),
        widget_06_training_risk(),
        widget_07_department_mix(),
        widget_08_supervisor_span(),
        widget_09_employee_focus(),
        widget_10_handoff_readiness(),
    ]
    sheet = make_sheet(paths)
    print(sheet)
    for path in paths:
        print(path)


if __name__ == "__main__":
    main()
