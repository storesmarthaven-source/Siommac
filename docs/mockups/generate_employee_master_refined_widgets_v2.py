from __future__ import annotations

from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFilter, ImageFont


S = 2
W, H = 1280, 720
OUT_DIR = Path(__file__).resolve().parent / "employee-master-refined-widgets-v2"
SHEET = Path(__file__).resolve().parent / "employee-master-refined-widgets-v2-sheet.png"

BG = "#EEF3F8"
INK = "#10203A"
MUTED = "#65758F"
QUIET = "#94A3B8"
LINE = "#D7E2EF"
SOFT = "#F6F9FD"
WHITE = "#FFFFFF"
NAVY = "#132755"
NAVY_2 = "#1E3D70"
NAVY_3 = "#2B528B"
BLUE = "#367CFF"
CYAN = "#35C7F3"
GREEN = "#16A66B"
AMBER = "#D98A00"
RED = "#E33737"
VIOLET = "#7067F0"


def hp(value: str) -> tuple[int, int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4)) + (255,)


def sp(v: int | float) -> int:
    return int(round(v * S))


def font_path(weight: str) -> str | None:
    root = Path("C:/Windows/Fonts")
    names = {
        "regular": ["segoeui.ttf", "arial.ttf"],
        "semibold": ["seguisb.ttf", "arialbd.ttf"],
        "bold": ["segoeuib.ttf", "arialbd.ttf"],
    }[weight]
    for name in names:
        path = root / name
        if path.exists():
            return str(path)
    return None


def make_font(size: int, weight: str = "regular"):
    path = font_path(weight)
    return ImageFont.truetype(path, sp(size)) if path else ImageFont.load_default()


F = {
    "label": make_font(12, "bold"),
    "caption": make_font(14),
    "caption_sb": make_font(14, "semibold"),
    "small": make_font(16),
    "small_sb": make_font(16, "semibold"),
    "body": make_font(20),
    "body_sb": make_font(20, "semibold"),
    "h3": make_font(24, "bold"),
    "h2": make_font(34, "bold"),
    "h1": make_font(44, "bold"),
    "metric": make_font(78, "bold"),
    "metric_xl": make_font(112, "bold"),
}


def canvas(bg: str = BG) -> Image.Image:
    return Image.new("RGBA", (sp(W), sp(H)), hp(bg))


def draw_text(d: ImageDraw.ImageDraw, x: int, y: int, value: str, font, fill=INK, anchor="la"):
    d.text((sp(x), sp(y)), value, font=font, fill=hp(fill) if isinstance(fill, str) else fill, anchor=anchor)


def rr(d: ImageDraw.ImageDraw, xy: list[int], r: int, fill: str | None = None, outline: str | None = None, width: int = 1):
    d.rounded_rectangle(
        [sp(xy[0]), sp(xy[1]), sp(xy[2]), sp(xy[3])],
        radius=sp(r),
        fill=hp(fill) if fill else None,
        outline=hp(outline) if outline else None,
        width=sp(width),
    )


def line(d: ImageDraw.ImageDraw, pts: list[tuple[int, int]], fill: str, width: int = 2):
    d.line([(sp(x), sp(y)) for x, y in pts], fill=hp(fill), width=sp(width), joint="curve")


def shadow(base: Image.Image, xy: list[int], r: int = 36, alpha: int = 34, blur: int = 20, dy: int = 14):
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle(
        [sp(xy[0] + 4), sp(xy[1] + dy), sp(xy[2] + 4), sp(xy[3] + dy)],
        radius=sp(r),
        fill=(14, 30, 58, alpha),
    )
    layer = layer.filter(ImageFilter.GaussianBlur(sp(blur)))
    base.alpha_composite(layer)


def base_card(img: Image.Image, dark=False, xy: list[int] | None = None, r: int = 36):
    xy = xy or [80, 58, 1200, 662]
    shadow(img, xy, r=r, alpha=46 if dark else 28)
    d = ImageDraw.Draw(img)
    if dark:
        gradient(img, xy, NAVY, "#1F4379", r)
    else:
        rr(d, xy, r, WHITE, LINE, 1)


def gradient(img: Image.Image, xy: list[int], start: str, end: str, r: int):
    x1, y1, x2, y2 = [sp(v) for v in xy]
    w, h = x2 - x1, y2 - y1
    grad = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    s = hp(start)
    e = hp(end)
    for y in range(h):
        t = y / max(1, h - 1)
        col = tuple(int(s[i] * (1 - t) + e[i] * t) for i in range(3)) + (255,)
        gd.line([(0, y), (w, y)], fill=col)
    mask = Image.new("L", (w, h), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, w, h], radius=sp(r), fill=255)
    img.paste(grad, (x1, y1), mask)
    od = ImageDraw.Draw(img)
    od.rounded_rectangle([x1, y1, x2, y2], radius=sp(r), outline=hp("#3C5C91"), width=sp(1))


def pill(d: ImageDraw.ImageDraw, x: int, y: int, label: str, fg: str, bg: str, font=F["caption_sb"], h=32, pad=14):
    box = d.textbbox((0, 0), label, font=font)
    w = int((box[2] - box[0]) / S) + pad * 2
    rr(d, [x, y, x + w, y + h], h // 2, bg)
    draw_text(d, x + w // 2, y + h // 2 - 1, label, font, fg, anchor="mm")
    return w


def progress(d: ImageDraw.ImageDraw, x: int, y: int, w: int, pct: float, color: str, bg="#E4ECF6", h=10):
    rr(d, [x, y, x + w, y + h], h // 2, bg)
    if pct > 0:
        rr(d, [x, y, x + max(h, int(w * pct / 100)), y + h], h // 2, color)


def dot(d: ImageDraw.ImageDraw, x: int, y: int, color: str, r=5):
    d.ellipse([sp(x - r), sp(y - r), sp(x + r), sp(y + r)], fill=hp(color))


def ring(d: ImageDraw.ImageDraw, cx: int, cy: int, r: int, pct: float, color: str, bg="#E5EDF7", width=14, text_fill=INK, sub_fill=MUTED):
    box = [sp(cx - r), sp(cy - r), sp(cx + r), sp(cy + r)]
    d.arc(box, 0, 360, fill=hp(bg), width=sp(width))
    if pct > 0:
        d.arc(box, -90, -90 + int(360 * pct / 100), fill=hp(color), width=sp(width))
    draw_text(d, cx, cy - 6, f"{int(round(pct))}%", F["h2"], text_fill, anchor="mm")
    draw_text(d, cx, cy + 29, "ready", F["caption"], sub_fill, anchor="mm")


def icon_box(d: ImageDraw.ImageDraw, x: int, y: int, label: str, fg: str, bg: str, size=44):
    rr(d, [x, y, x + size, y + size], 14, bg)
    draw_text(d, x + size // 2, y + size // 2 - 1, label, F["caption_sb"], fg, anchor="mm")


def save(name: str, img: Image.Image) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / name
    img = img.resize((W, H), Image.Resampling.LANCZOS).convert("RGB")
    img.save(out, quality=96)
    return out


def header(d, title, subtitle, dark=False, badge=None, badge_color=BLUE):
    fill = WHITE if dark else INK
    sub = "#B9C8DE" if dark else MUTED
    draw_text(d, 128, 118, title, F["h2"], fill)
    draw_text(d, 128, 160, subtitle, F["small"], sub)
    if badge:
        if dark:
            bg = "#254B81" if badge_color not in (RED, GREEN, AMBER) else {
                RED: "#3A284B",
                GREEN: "#214E5B",
                AMBER: "#433A25",
            }[badge_color]
            fg = "#CDEEFF" if badge_color == BLUE else {
                RED: "#FFD1D1",
                GREEN: "#C7F5D8",
                AMBER: "#FFE1A3",
            }.get(badge_color, WHITE)
        else:
            bg = {
                RED: "#FFF0F0",
                AMBER: "#FFF4DF",
                GREEN: "#EAFBF0",
                BLUE: "#EAF2FF",
            }.get(badge_color, "#EEF3FF")
            fg = badge_color
        pill(d, 990, 112, badge, fg, bg)


def widget_workforce_command() -> Path:
    img = canvas("#E9F0F8")
    base_card(img, dark=True)
    d = ImageDraw.Draw(img)
    icon_box(d, 126, 104, "HR", WHITE, "#2C5288", 46)
    draw_text(d, 190, 114, "Workforce Command", F["h2"], WHITE)
    draw_text(d, 190, 156, "Current shape of the active employee register.", F["small"], "#B9C8DE")
    pill(d, 1016, 110, "LIVE", "#CDEEFF", "#294D82", h=32)

    draw_text(d, 128, 338, "23", F["metric_xl"], WHITE, anchor="lm")
    draw_text(d, 326, 312, "active workforce", F["h3"], "#F4F8FF", anchor="lm")
    draw_text(d, 326, 350, "23 employees  /  0 contractors  /  +0 net", F["small"], "#B9C8DE", anchor="lm")

    for i, (label, value, note, color) in enumerate(
        [("EMPLOYEES", "23", "records", GREEN), ("HR QUEUE", "0", "open", CYAN), ("SITES", "0", "assigned", AMBER)]
    ):
        x = 128 + i * 236
        rr(d, [x, 454, x + 204, 560], 22, "#254573", "#42649A")
        draw_text(d, x + 24, 490, label, F["label"], "#B9C8DE", anchor="lm")
        draw_text(d, x + 24, 528, value, F["h2"], WHITE, anchor="lm")
        draw_text(d, x + 82, 527, note, F["small"], "#B9C8DE", anchor="lm")
        dot(d, x + 172, 490, color, 7)

    pts = [(834, 480), (872, 466), (910, 468), (948, 454), (986, 448), (1024, 438), (1062, 430)]
    line(d, pts, CYAN, 4)
    for p in pts:
        dot(d, p[0], p[1], "#BDEFFF", 6)
    draw_text(d, 832, 406, "6 month trend", F["caption_sb"], "#DDE9F7")
    draw_text(d, 832, 588, "Stable", F["body_sb"], WHITE)
    draw_text(d, 915, 590, "no change", F["small"], "#B9C8DE")
    return save("01-workforce-command.png", img)


def widget_record_quality() -> Path:
    img = canvas()
    base_card(img)
    d = ImageDraw.Draw(img)
    header(d, "Record Quality", "Completeness and blockers across the master data fields.", badge="NEEDS CLEANUP", badge_color=RED)

    rr(d, [126, 236, 418, 536], 30, SOFT, LINE)
    ring(d, 272, 354, 88, 20, RED)
    draw_text(d, 272, 482, "clean record score", F["small_sb"], MUTED, anchor="mm")

    rows = [
        ("Supervisor", "0 / 23", 0, RED),
        ("Department", "21 / 23", 91, GREEN),
        ("Site", "0 / 23", 0, AMBER),
        ("Payroll statutory", "0 / 23", 0, RED),
        ("Training current", "2 / 23", 9, BLUE),
    ]
    y = 242
    for label, value, pct, color in rows:
        dot(d, 500, y + 16, color, 7)
        draw_text(d, 526, y + 18, label, F["body_sb"], INK, anchor="lm")
        draw_text(d, 790, y + 18, value, F["body_sb"], INK, anchor="rm")
        progress(d, 838, y + 12, 214, pct, color)
        y += 66

    rr(d, [498, 592, 1058, 632], 20, "#EEF5FF", "#D5E5FA")
    draw_text(d, 526, 613, "Next action: assign supervisors before handoff.", F["small_sb"], NAVY, anchor="lm")
    return save("02-record-quality.png", img)


def widget_exception_triage() -> Path:
    img = canvas()
    base_card(img)
    d = ImageDraw.Draw(img)
    rr(d, [80, 58, 500, 662], 36, NAVY, None)
    draw_text(d, 128, 122, "Exception Triage", F["h2"], WHITE)
    draw_text(d, 128, 166, "Cleanup priority by record impact.", F["small"], "#B9C8DE")
    draw_text(d, 128, 350, "26", F["metric_xl"], WHITE, anchor="lm")
    draw_text(d, 128, 430, "blocking items", F["h3"], "#DDE8F7")
    pill(d, 128, 478, "23 SUPERVISOR", "#FFD7D7", "#3A284B")
    pill(d, 128, 526, "2 DEPARTMENT", "#FFE2A8", "#413A28")
    pill(d, 128, 574, "1 TRAINING", "#CFE0FF", "#263E73")

    draw_text(d, 570, 122, "Priority Queue", F["h2"], INK)
    draw_text(d, 570, 164, "Actionable records that block clean assignment.", F["small"], MUTED)
    items = [
        ("01", "Assign supervisors", "23 records", RED, "Approval line missing"),
        ("02", "Review departments", "2 records", AMBER, "Reporting group missing"),
        ("03", "Open training records", "1 expired", BLUE, "Certificate refresh needed"),
    ]
    y = 242
    for n, title, count, color, note in items:
        rr(d, [570, y, 1088, y + 96], 24, SOFT, LINE)
        rr(d, [598, y + 24, 646, y + 72], 16, WHITE, LINE)
        draw_text(d, 622, y + 48, n, F["caption_sb"], color, anchor="mm")
        draw_text(d, 680, y + 34, title, F["body_sb"], INK)
        draw_text(d, 680, y + 66, note, F["caption"], MUTED)
        draw_text(d, 1048, y + 48, count, F["small_sb"], color, anchor="rm")
        y += 116
    return save("03-exception-triage.png", img)


def widget_readiness_stack() -> Path:
    img = canvas("#EDF3F8")
    base_card(img)
    d = ImageDraw.Draw(img)
    header(d, "Readiness Stack", "Payroll, training, and profile gates in one compact widget.", badge="BLOCKED", badge_color=RED)
    cards = [
        ("Payroll", "0%", "statutory ready", 0, RED),
        ("Training", "9%", "current certificates", 9, BLUE),
        ("Profile", "100%", "no HR actions", 100, GREEN),
    ]
    for i, (title, value, note, pct, color) in enumerate(cards):
        x = 128 + i * 320
        rr(d, [x, 242, x + 276, 544], 30, SOFT, LINE)
        draw_text(d, x + 28, 294, title, F["h3"], INK)
        draw_text(d, x + 28, 332, note, F["small"], MUTED)
        ring(d, x + 138, 438, 66, pct, color)
        draw_text(d, x + 138, 562, value, F["h3"], color, anchor="mm")
    rr(d, [128, 592, 1080, 632], 20, "#FFF2F2", "#F6D5D5")
    draw_text(d, 158, 613, "Blocked by missing statutory, supervisor, and site assignment data.", F["small_sb"], RED, anchor="lm")
    return save("04-readiness-stack.png", img)


def widget_assignment_board() -> Path:
    img = canvas()
    base_card(img)
    d = ImageDraw.Draw(img)
    header(d, "Assignment Board", "A field-completion view for records that must route into operations.", badge="23 EMPLOYEES", badge_color=BLUE)
    rows = [
        ("Department", 21, 2, GREEN),
        ("Supervisor", 0, 23, RED),
        ("Site", 0, 23, AMBER),
    ]
    y = 248
    for label, ok, missing, color in rows:
        draw_text(d, 130, y + 34, label, F["body_sb"], INK)
        draw_text(d, 130, y + 66, f"{ok} assigned", F["caption"], MUTED)
        rr(d, [360, y, 1080, y + 92], 24, SOFT, LINE)
        x = 390
        for i in range(23):
            active = i < ok
            rr(d, [x, y + 34, x + 16, y + 58], 6, color if active else "#DDE7F2")
            x += 27
        draw_text(d, 1020, y + 47, f"{missing} missing", F["small_sb"], color, anchor="rm")
        y += 126
    return save("05-assignment-board.png", img)


def widget_training_signal() -> Path:
    img = canvas("#E9F0F8")
    base_card(img, dark=True)
    d = ImageDraw.Draw(img)
    header(d, "Training Signal", "Certificate state by worker readiness and review urgency.", dark=True, badge="1 EXPIRED", badge_color=RED)

    draw_text(d, 128, 270, "2", F["metric"], GREEN, anchor="lm")
    draw_text(d, 224, 256, "current", F["h3"], WHITE, anchor="lm")
    draw_text(d, 128, 382, "4", F["metric"], AMBER, anchor="lm")
    draw_text(d, 224, 368, "due soon", F["h3"], WHITE, anchor="lm")
    draw_text(d, 128, 494, "1", F["metric"], RED, anchor="lm")
    draw_text(d, 224, 480, "expired", F["h3"], WHITE, anchor="lm")

    rr(d, [500, 236, 1076, 540], 30, "#244573", "#43659B")
    labels = ["Ops", "Admin", "Field", "Proj.", "Worker"]
    for i, label in enumerate(labels):
        draw_text(d, 574 + i * 94, 282, label, F["caption_sb"], "#B9C8DE", anchor="mm")
    grid = [
        [GREEN, AMBER, RED, "#3A5A8B", AMBER],
        [GREEN, GREEN, AMBER, "#3A5A8B", "#3A5A8B"],
        [AMBER, RED, "#3A5A8B", GREEN, AMBER],
    ]
    for r, cells in enumerate(grid):
        draw_text(d, 522, 338 + r * 72, f"G{r + 1}", F["caption"], "#B9C8DE", anchor="lm")
        for c, color in enumerate(cells):
            rr(d, [552 + c * 94, 316 + r * 72, 594 + c * 94, 358 + r * 72], 14, color)
    draw_text(d, 500, 596, "Heatmap shows training exposure without opening the employee drawer.", F["small"], "#B9C8DE")
    return save("06-training-signal.png", img)


def widget_org_composition() -> Path:
    img = canvas()
    base_card(img)
    d = ImageDraw.Draw(img)
    header(d, "Org Composition", "Department mix, unassigned records, and employee type at a glance.", badge="2 UNASSIGNED", badge_color=AMBER)

    box = [sp(150), sp(250), sp(430), sp(530)]
    d.pieslice(box, -90, 97, fill=hp(GREEN))
    d.pieslice(box, 97, 237, fill=hp(BLUE))
    d.pieslice(box, 237, 270, fill=hp(AMBER))
    d.ellipse([sp(244), sp(344), sp(336), sp(436)], fill=hp(WHITE))
    draw_text(d, 290, 376, "23", F["h2"], INK, anchor="mm")
    draw_text(d, 290, 410, "people", F["caption"], MUTED, anchor="mm")

    rows = [("Operations", "major group", 52, GREEN), ("Administration", "secondary group", 39, BLUE), ("Missing dept.", "cleanup", 9, AMBER)]
    y = 262
    for label, note, pct, color in rows:
        rr(d, [560, y, 1060, y + 82], 22, SOFT, LINE)
        dot(d, 596, y + 42, color, 9)
        draw_text(d, 628, y + 33, label, F["body_sb"], INK)
        draw_text(d, 628, y + 62, note, F["caption"], MUTED)
        progress(d, 840, y + 39, 130, pct, color)
        draw_text(d, 1030, y + 44, f"{pct}%", F["small_sb"], color, anchor="rm")
        y += 102
    return save("07-org-composition.png", img)


def widget_supervisor_coverage() -> Path:
    img = canvas("#EAF1F9")
    base_card(img, dark=True)
    d = ImageDraw.Draw(img)
    header(d, "Supervisor Coverage", "Reporting-line completeness before approval routing.", dark=True, badge="0 ASSIGNED", badge_color=RED)
    nodes = [(240, 382, "23", "Employees", GREEN), (640, 382, "0", "Supervisors", RED), (1040, 382, "0", "Sites", AMBER)]
    line(d, [(340, 382), (540, 382)], "#4F72A6", 6)
    line(d, [(740, 382), (940, 382)], "#4F72A6", 6)
    for x, y, value, label, color in nodes:
        rr(d, [x - 92, y - 92, x + 92, y + 92], 30, "#244573", "#45699E")
        dot(d, x, y - 116, color, 12)
        draw_text(d, x, y - 12, value, F["metric"], WHITE, anchor="mm")
        draw_text(d, x, y + 54, label, F["body_sb"], "#EAF2FF", anchor="mm")
    rr(d, [128, 582, 1084, 624], 20, "#244573", "#45699E")
    draw_text(d, 158, 604, "Use this as the relationship cleanup widget beside the register.", F["small_sb"], "#DDE8F7", anchor="lm")
    return save("08-supervisor-coverage.png", img)


def widget_employee_context() -> Path:
    img = canvas("#E9F0F8")
    base_card(img, dark=True)
    d = ImageDraw.Draw(img)
    header(d, "Employee Context", "Selected-row summary without opening the full profile drawer.", dark=True, badge="ACTIVE", badge_color=GREEN)
    rr(d, [128, 246, 232, 350], 52, "#7590BF", "#92A8CD")
    draw_text(d, 180, 298, "AD", F["h2"], WHITE, anchor="mm")
    draw_text(d, 270, 264, "Amara Diallo", F["h2"], WHITE)
    draw_text(d, 270, 306, "EMP-0010  /  Field Engineer  /  Operations", F["small"], "#B9C8DE")
    draw_text(d, 270, 344, "No supervisor  /  No site assigned", F["small_sb"], "#FFE2A8")

    tiles = [("Training", "Due soon", AMBER), ("Supervisor", "Missing", RED), ("Workflow", "0 open", CYAN), ("Payroll", "Not ready", RED)]
    for i, (label, value, color) in enumerate(tiles):
        x = 128 + i * 244
        rr(d, [x, 438, x + 214, 540], 22, "#244573", "#45699E")
        draw_text(d, x + 24, 470, label.upper(), F["label"], "#B9C8DE", anchor="lm")
        draw_text(d, x + 24, 512, value, F["body_sb"], WHITE, anchor="lm")
        dot(d, x + 178, 470, color, 7)

    pill(d, 128, 586, "REQUEST CHANGE", WHITE, "#3A5E93", h=42)
    pill(d, 326, 586, "OPEN PROFILE", NAVY, "#EAF2FF", h=42)
    return save("09-employee-context.png", img)


def widget_handoff_gates() -> Path:
    img = canvas()
    base_card(img)
    d = ImageDraw.Draw(img)
    header(d, "Handoff Gates", "Where the employee register can and cannot move downstream.", badge="BLOCKED", badge_color=RED)
    gates = [
        ("Payroll", "0%", "Missing statutory", RED, 0),
        ("Operations", "0%", "Needs supervisor/site", AMBER, 0),
        ("HSE", "9%", "Training partial", BLUE, 9),
        ("HR", "100%", "No open changes", GREEN, 100),
    ]
    y = 232
    for label, value, note, color, pct in gates:
        rr(d, [128, y, 1084, y + 76], 24, SOFT, LINE)
        draw_text(d, 164, y + 28, label, F["body_sb"], INK)
        draw_text(d, 164, y + 56, note, F["caption"], MUTED)
        progress(d, 530, y + 34, 382, pct, color)
        draw_text(d, 1032, y + 39, value, F["body_sb"], color, anchor="rm")
        y += 88
    rr(d, [128, 602, 1084, 636], 17, "#FFF2F2", "#F5D9D9")
    draw_text(d, 158, 620, "Resolve record blockers before payroll or operations handoff.", F["caption_sb"], RED, anchor="lm")
    return save("10-handoff-gates.png", img)


def make_sheet(paths: Iterable[Path]) -> Path:
    def sheet_font(size: int, weight: str = "regular"):
        path = font_path(weight)
        return ImageFont.truetype(path, size) if path else ImageFont.load_default()

    def sheet_shadow(base: Image.Image, xy: list[int], r: int = 20):
        layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
        sd = ImageDraw.Draw(layer)
        sd.rounded_rectangle([xy[0] + 3, xy[1] + 8, xy[2] + 3, xy[3] + 8], radius=r, fill=(14, 30, 58, 26))
        layer = layer.filter(ImageFilter.GaussianBlur(14))
        base.alpha_composite(layer)

    thumbs: list[tuple[Path, Image.Image]] = []
    for path in paths:
        img = Image.open(path).convert("RGB")
        img.thumbnail((560, 315), Image.Resampling.LANCZOS)
        thumbs.append((path, img.copy()))

    sheet = Image.new("RGBA", (1240, 1850), hp("#E8EFF7"))
    d = ImageDraw.Draw(sheet)
    d.text((56, 54), "Employee Master - Refined Widget Concepts v2", font=sheet_font(34, "bold"), fill=hp(INK))
    d.text((56, 96), "Separate widget designs with cleaner hierarchy and less repeated KPI treatment.", font=sheet_font(19), fill=hp(MUTED))
    xs = [56, 624]
    y = 150
    for idx, (path, img) in enumerate(thumbs):
        if idx > 0 and idx % 2 == 0:
            y += 338
        x = xs[idx % 2]
        sheet_shadow(sheet, [x, y, x + 560, y + 315], r=20)
        sheet.paste(img, (x, y))
        d.rounded_rectangle([x, y, x + 560, y + 315], radius=20, outline=hp("#D2DFED"), width=1)
        d.rounded_rectangle([x, y + 276, x + 560, y + 315], radius=20, fill=(16, 31, 55, 210))
        d.rectangle([x, y + 276, x + 560, y + 296], fill=(16, 31, 55, 210))
        label = path.stem.replace("-", " ").title()
        d.text((x + 18, y + 292), label, font=sheet_font(16, "semibold"), fill=hp(WHITE))
    SHEET.parent.mkdir(parents=True, exist_ok=True)
    sheet = sheet.convert("RGB")
    sheet.save(SHEET, quality=95)
    return SHEET


def main():
    paths = [
        widget_workforce_command(),
        widget_record_quality(),
        widget_exception_triage(),
        widget_readiness_stack(),
        widget_assignment_board(),
        widget_training_signal(),
        widget_org_composition(),
        widget_supervisor_coverage(),
        widget_employee_context(),
        widget_handoff_gates(),
    ]
    print(make_sheet(paths))
    for path in paths:
        print(path)


if __name__ == "__main__":
    main()
