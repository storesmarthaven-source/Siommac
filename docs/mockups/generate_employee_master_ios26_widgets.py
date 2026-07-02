from __future__ import annotations

import math
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFilter, ImageFont


S = 2
W, H = 1280, 720
OUT_DIR = Path(__file__).resolve().parent / "employee-master-ios26-inspired-widgets"
SHEET = Path(__file__).resolve().parent / "employee-master-ios26-inspired-widgets-sheet.png"

PAGE = "#E4E8F0"
INK = "#070B18"
MUTED = "#7B8190"
LINE = "#EEF1F6"
WHITE = "#FFFFFF"
GREEN = "#20C76A"
BLUE = "#357FF4"
VIOLET = "#7B6DF6"
PINK = "#FF83A8"
RED = "#FF5B66"
ORANGE = "#FF9F16"
CYAN = "#58C8D8"
YELLOW = "#FFD648"


def sc(value: int | float) -> int:
    return int(round(value * S))


def color(value: str, alpha: int = 255) -> tuple[int, int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4)) + (alpha,)


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
    return ImageFont.truetype(path, sc(size)) if path else ImageFont.load_default()


F = {
    "micro": make_font(12, "bold"),
    "caption": make_font(15),
    "caption_sb": make_font(15, "semibold"),
    "small": make_font(17),
    "small_sb": make_font(17, "semibold"),
    "body": make_font(21),
    "body_sb": make_font(21, "semibold"),
    "h3": make_font(27, "bold"),
    "h2": make_font(35, "bold"),
    "h1": make_font(50, "bold"),
    "metric": make_font(84, "bold"),
    "metric_xl": make_font(120, "bold"),
}


def canvas() -> Image.Image:
    img = Image.new("RGBA", (sc(W), sc(H)), color(PAGE))
    d = ImageDraw.Draw(img, "RGBA")
    d.ellipse([sc(-95), sc(-50), sc(142), sc(186)], fill=color("#F8FAFC", 118))
    d.ellipse([sc(1048), sc(36), sc(1212), sc(200)], fill=color("#F8FAFC", 116))
    d.ellipse([sc(42), sc(535), sc(326), sc(822)], fill=color("#FFF3C4", 84))
    d.ellipse([sc(930), sc(0), sc(1285), sc(355)], fill=color("#DCEBFF", 82))
    return img


def text(d: ImageDraw.ImageDraw, x: int, y: int, value: str, font, fill: str = INK, anchor="la"):
    d.text((sc(x), sc(y)), value, font=font, fill=color(fill), anchor=anchor)


def rr(d: ImageDraw.ImageDraw, xy: list[int], r: int, fill: str | tuple[int, int, int, int] | None, outline: str | None = None, width: int = 1):
    if isinstance(fill, str):
        fill = color(fill)
    d.rounded_rectangle(
        [sc(xy[0]), sc(xy[1]), sc(xy[2]), sc(xy[3])],
        radius=sc(r),
        fill=fill,
        outline=color(outline) if outline else None,
        width=sc(width),
    )


def line(d: ImageDraw.ImageDraw, pts: list[tuple[int, int]], fill: str, width=2):
    d.line([(sc(x), sc(y)) for x, y in pts], fill=color(fill), width=sc(width), joint="curve")


def circle(d: ImageDraw.ImageDraw, cx: int, cy: int, r: int, fill: str | tuple[int, int, int, int], outline: str | None = None, width=1):
    if isinstance(fill, str):
        fill = color(fill)
    d.ellipse([sc(cx - r), sc(cy - r), sc(cx + r), sc(cy + r)], fill=fill, outline=color(outline) if outline else None, width=sc(width))


def shadow(img: Image.Image, xy: list[int], r=42, alpha=34, blur=24, dy=16):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer, "RGBA")
    d.rounded_rectangle(
        [sc(xy[0] + 4), sc(xy[1] + dy), sc(xy[2] + 4), sc(xy[3] + dy)],
        radius=sc(r),
        fill=(49, 58, 78, alpha),
    )
    layer = layer.filter(ImageFilter.GaussianBlur(sc(blur)))
    img.alpha_composite(layer)


def card(img: Image.Image, xy: list[int] | None = None, r=42) -> ImageDraw.ImageDraw:
    xy = xy or [82, 70, 1198, 650]
    shadow(img, xy, r)
    d = ImageDraw.Draw(img, "RGBA")
    rr(d, xy, r, color(WHITE, 238), "#FFFFFF", 1)
    return d


def glass_panel(d: ImageDraw.ImageDraw, xy: list[int], r=28, alpha=150):
    rr(d, xy, r, color("#FFFFFF", alpha), "#FFFFFF", 1)


def pill(d: ImageDraw.ImageDraw, x: int, y: int, label: str, fg: str, bg: str, h=34, pad=16, font=F["caption_sb"]):
    box = d.textbbox((0, 0), label, font=font)
    w = int((box[2] - box[0]) / S) + pad * 2
    rr(d, [x, y, x + w, y + h], h // 2, bg)
    text(d, x + w // 2, y + h // 2 - 1, label, font, fg, anchor="mm")
    return w


def icon_bubble(d: ImageDraw.ImageDraw, cx: int, cy: int, label: str, bg: str, fg=WHITE, r=30):
    circle(d, cx, cy, r, bg)
    text(d, cx, cy - 1, label, F["body_sb"], fg, anchor="mm")


def progress(d: ImageDraw.ImageDraw, x: int, y: int, w: int, pct: float, fill: str, bg="#EDF1F6", h=12):
    rr(d, [x, y, x + w, y + h], h // 2, bg)
    if pct > 0:
        rr(d, [x, y, x + max(h, int(w * pct / 100)), y + h], h // 2, fill)


def arc(d: ImageDraw.ImageDraw, box: list[int], start: int, end: int, fill: str, width: int):
    d.arc([sc(box[0]), sc(box[1]), sc(box[2]), sc(box[3])], start=start, end=end, fill=color(fill), width=sc(width))


def gradient_arc(d: ImageDraw.ImageDraw, box: list[int], start: int, end: int, stops: list[str], width: int, steps=90):
    if end < start:
        end += 360
    for i in range(steps):
        t = i / max(1, steps - 1)
        raw = t * (len(stops) - 1)
        idx = min(len(stops) - 2, int(raw))
        local = raw - idx
        a = color(stops[idx])
        b = color(stops[idx + 1])
        col = tuple(int(a[j] * (1 - local) + b[j] * local) for j in range(3)) + (255,)
        seg_start = start + (end - start) * i / steps
        seg_end = start + (end - start) * (i + 1.25) / steps
        d.arc([sc(box[0]), sc(box[1]), sc(box[2]), sc(box[3])], start=int(seg_start), end=int(seg_end), fill=col, width=sc(width))


def wave(d: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int, color_hex: str, amp=12, width=3):
    pts = []
    for i in range(90):
        px = x + int(w * i / 89)
        py = y + h // 2 + int(math.sin(i / 5.2) * amp + math.sin(i / 2.6) * amp * 0.28)
        pts.append((px, py))
    line(d, pts, color_hex, width)


def mini_avatar(d: ImageDraw.ImageDraw, x: int, y: int, initials: str, bg: str):
    circle(d, x, y, 22, bg, "#FFFFFF", 3)
    text(d, x, y - 1, initials, F["caption_sb"], WHITE, anchor="mm")


def save(img: Image.Image, name: str) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / name
    img.resize((W, H), Image.Resampling.LANCZOS).convert("RGB").save(out, quality=96)
    return out


def header(d: ImageDraw.ImageDraw, title: str, subtitle: str, icon: str, icon_color: str, badge: str | None = None, badge_color: str = GREEN):
    text(d, 122, 126, title, F["h2"], INK)
    text(d, 122, 164, subtitle, F["small"], MUTED)
    icon_bubble(d, 1088, 132, icon, icon_color)
    if badge:
        pill(d, 898, 116, badge, badge_color, "#F3F0FF" if badge_color == VIOLET else "#EAFBF1" if badge_color == GREEN else "#FFF1F2")


def widget_01_active_workforce() -> Path:
    img = canvas()
    d = card(img)
    header(d, "Workforce Orbit", "Active people records at a glance", "HR", GREEN, "+0 net", GREEN)
    circle(d, 336, 380, 126, "#F7FAFF", "#FFFFFF", 3)
    circle(d, 336, 380, 82, "#EEF8F2")
    text(d, 336, 358, "23", F["metric"], INK, anchor="mm")
    text(d, 336, 424, "active", F["h3"], GREEN, anchor="mm")
    orbit = [(196, 294, "Ops", GREEN), (474, 298, "Adm", BLUE), (214, 500, "New", VIOLET), (500, 482, "Site", ORANGE)]
    for x, y, label, c in orbit:
        line(d, [(336, 380), (x, y)], "#E8EDF5", 3)
        circle(d, x, y, 34, c)
        text(d, x, y - 1, label, F["caption_sb"], WHITE, anchor="mm")
    glass_panel(d, [642, 238, 1078, 576], 34)
    items = [("Employee records", "23", GREEN, 100), ("Contractors", "0", CYAN, 0), ("Site coverage", "0%", ORANGE, 0)]
    y = 298
    for label, value, c, pct in items:
        text(d, 686, y, label, F["body_sb"], INK)
        text(d, 1018, y, value, F["h3"], c, anchor="ra")
        progress(d, 686, y + 42, 304, pct, c)
        y += 90
    return save(img, "01-ios26-inspired-workforce-orbit.png")


def widget_02_record_quality() -> Path:
    img = canvas()
    d = card(img)
    header(d, "Profile Completeness", "Fields that make employee records usable", "OK", GREEN, "20/100", ORANGE)
    fields = [("Supervisor", "0", RED, 0), ("Department", "21", GREEN, 91), ("Site", "0", ORANGE, 0), ("Training", "2", BLUE, 9)]
    for i, (label, value, c, pct) in enumerate(fields):
        x = 132 + (i % 2) * 274
        y = 250 + (i // 2) * 164
        glass_panel(d, [x, y, x + 232, y + 126], 30)
        text(d, x + 26, y + 36, label, F["body_sb"], INK, anchor="lm")
        text(d, x + 26, y + 84, value, F["h2"], c, anchor="lm")
        progress(d, x + 106, y + 74, 88, pct, c, h=12)
    glass_panel(d, [700, 252, 1084, 540], 38)
    text(d, 748, 334, "Clean record score", F["body_sb"], MUTED)
    text(d, 748, 430, "20", F["metric"], INK, anchor="lm")
    text(d, 898, 426, "/100", F["h3"], MUTED, anchor="lm")
    text(d, 748, 500, "Supervisor and site data are the blockers.", F["small_sb"], ORANGE)
    return save(img, "02-ios26-inspired-profile-completeness.png")


def widget_03_exception_monitor() -> Path:
    img = canvas()
    d = card(img)
    header(d, "Exception Flow", "Grouped blockers by cleanup path", "!", RED, "26 blockers", RED)
    text(d, 142, 378, "26", F["metric_xl"], INK, anchor="lm")
    text(d, 142, 464, "blocking items", F["h3"], RED)
    bubbles = [(570, 300, 92, "23", "Supervisor", RED), (790, 430, 58, "2", "Department", ORANGE), (972, 310, 48, "1", "Training", BLUE)]
    for x, y, r, value, label, c in bubbles:
        line(d, [(414, 398), (x - r, y)], "#E8EDF5", 4)
        circle(d, x, y, r, c)
        text(d, x, y - 12, value, F["h2"], WHITE, anchor="mm")
        text(d, x, y + 28, label, F["caption_sb"], WHITE, anchor="mm")
    glass_panel(d, [128, 540, 1078, 600], 24)
    text(d, 164, 574, "Start with supervisor assignment; it clears the largest dependency chain.", F["small_sb"], INK, anchor="lm")
    return save(img, "03-ios26-inspired-exception-flow.png")


def widget_04_hr_queue() -> Path:
    img = canvas()
    d = card(img)
    header(d, "Action Deck", "Recommended cleanup cards", "+", VIOLET, "0 open", GREEN)
    cards = [("Assign supervisors", "23 rows", RED, "High impact"), ("Review departments", "2 rows", ORANGE, "Routing"), ("Training refresh", "1 expired", BLUE, "Compliance")]
    for i, (title, count, c, tag) in enumerate(cards):
        x = 128 + i * 318
        y = 256 + i * 28
        shadow(img, [x, y, x + 276, y + 270], r=34, alpha=18, blur=18, dy=12)
        rr(d, [x, y, x + 276, y + 270], 34, color(WHITE, 236), "#FFFFFF")
        circle(d, x + 52, y + 54, 22, c)
        text(d, x + 86, y + 48, tag, F["caption_sb"], MUTED, anchor="lm")
        text(d, x + 32, y + 124, title, F["h3"], INK)
        text(d, x + 32, y + 170, count, F["h3"], c)
        mini_avatar(d, x + 48, y + 224, "AD", "#8FA2D1")
        mini_avatar(d, x + 84, y + 224, "CP", "#9EE3B4")
        mini_avatar(d, x + 120, y + 224, "DB", "#F3B4CA")
    return save(img, "04-ios26-inspired-action-deck.png")


def widget_05_assignment_battery() -> Path:
    img = canvas()
    d = card(img)
    header(d, "Assignment Coverage", "Department, supervisor, and site readiness", "A", GREEN, "23 records", VIOLET)
    lanes = [("Department", 21, 23, GREEN), ("Supervisor", 0, 23, RED), ("Site", 0, 23, ORANGE)]
    y = 260
    for label, ok, total, c in lanes:
        glass_panel(d, [136, y, 1072, y + 94], 30)
        text(d, 176, y + 36, label, F["body_sb"], INK, anchor="lm")
        text(d, 176, y + 66, f"{ok}/{total} assigned", F["caption"], MUTED, anchor="lm")
        x = 432
        for i in range(total):
            rr(d, [x, y + 36, x + 14, y + 60], 7, c if i < ok else "#DCE4EF")
            x += 22
        text(d, 1018, y + 48, f"{total - ok} missing", F["small_sb"], c, anchor="rm")
        y += 112
    return save(img, "05-ios26-inspired-assignment-coverage.png")


def widget_06_training_quality() -> Path:
    img = canvas()
    d = card(img)
    header(d, "Training Board", "Certificate status by action urgency", "T", VIOLET, "1 expired", RED)
    statuses = [("Current", "2", GREEN), ("Due soon", "4", ORANGE), ("Expired", "1", RED)]
    for i, (label, value, c) in enumerate(statuses):
        x = 132 + i * 248
        glass_panel(d, [x, 250, x + 206, 400], 32)
        circle(d, x + 42, 306, 13, c)
        text(d, x + 74, 300, label, F["body_sb"], INK, anchor="lm")
        text(d, x + 74, 352, value, F["h2"], c, anchor="lm")
    glass_panel(d, [132, 452, 1076, 592], 32)
    groups = [("Ops", GREEN), ("Admin", GREEN), ("Field", ORANGE), ("Worker", RED), ("Project", BLUE), ("New", "#DCE4EF")]
    x = 184
    for label, c in groups:
        circle(d, x, 512, 24, c)
        text(d, x, 558, label, F["caption_sb"], MUTED, anchor="mm")
        x += 150
    return save(img, "06-ios26-inspired-training-board.png")


def widget_07_org_activity() -> Path:
    img = canvas()
    d = card(img)
    header(d, "Department Cloud", "Workforce mix across the visible register", "O", GREEN, "2 unassigned", ORANGE)
    cloud = [(352, 396, 116, "Operations", "52%", GREEN), (590, 410, 92, "Admin", "39%", BLUE), (780, 332, 56, "Missing", "9%", ORANGE)]
    for x, y, r, label, pct, c in cloud:
        circle(d, x, y, r, c)
        text(d, x, y - 10, pct, F["h3"], WHITE, anchor="mm")
        text(d, x, y + 24, label, F["caption_sb"], WHITE, anchor="mm")
    glass_panel(d, [884, 278, 1080, 548], 32)
    text(d, 928, 352, "23", F["metric"], INK, anchor="lm")
    text(d, 928, 416, "people", F["h3"], MUTED)
    text(d, 928, 486, "+0 net movement", F["small_sb"], GREEN)
    return save(img, "07-ios26-inspired-department-cloud.png")


def widget_08_employee_focus() -> Path:
    img = canvas()
    d = card(img)
    header(d, "Employee Focus", "Selected row", "AD", VIOLET, "Active", GREEN)
    circle(d, 194, 324, 64, "#92A5CC")
    text(d, 194, 326, "AD", F["h2"], WHITE, anchor="mm")
    text(d, 296, 300, "Amara Diallo", F["h1"], INK)
    text(d, 296, 350, "EMP-0010  /  Field Engineer  /  Operations", F["small"], MUTED)
    text(d, 296, 396, "No supervisor  /  No site assigned", F["small_sb"], ORANGE)
    chips = [("Training", "Due soon", ORANGE), ("Supervisor", "Missing", RED), ("Workflow", "0 open", CYAN), ("Payroll", "Not ready", RED)]
    for i, (label, value, c) in enumerate(chips):
        x = 142 + i * 244
        glass_panel(d, [x, 486, x + 210, 584], 28)
        text(d, x + 24, 524, label, F["caption_sb"], MUTED, anchor="lm")
        text(d, x + 24, 558, value, F["body_sb"], INK, anchor="lm")
        circle(d, x + 176, 526, 7, c)
    return save(img, "08-ios26-employee-focus.png")


def widget_09_handoff_o2() -> Path:
    img = canvas()
    d = card(img)
    header(d, "Handoff Map", "Downstream paths and blocked gates", "M", BLUE, "Blocked", RED)
    nodes = [("HR", 246, 398, GREEN, "100%"), ("HSE", 480, 398, BLUE, "9%"), ("Ops", 714, 398, ORANGE, "0%"), ("Payroll", 948, 398, RED, "0%")]
    for i in range(len(nodes) - 1):
        line(d, [(nodes[i][1] + 64, 398), (nodes[i + 1][1] - 64, 398)], "#E7EDF6", 8)
    for label, x, y, c, value in nodes:
        glass_panel(d, [x - 76, y - 76, x + 76, y + 76], 34)
        circle(d, x, y - 26, 12, c)
        text(d, x, y + 8, label, F["body_sb"], INK, anchor="mm")
        text(d, x, y + 42, value, F["small_sb"], c, anchor="mm")
    glass_panel(d, [190, 554, 1034, 610], 24)
    text(d, 226, 586, "Operations and Payroll stay blocked until supervisor, site, and statutory data are complete.", F["small_sb"], INK, anchor="lm")
    return save(img, "09-ios26-inspired-handoff-map.png")


def widget_10_supervisor_hrv() -> Path:
    img = canvas()
    d = card(img)
    header(d, "Reporting Lines", "Supervisor coverage as a relationship map", "SV", VIOLET, "0 assigned", RED)
    text(d, 132, 344, "0", F["metric"], INK, anchor="lm")
    text(d, 228, 348, "supervisors assigned", F["h3"], MUTED, anchor="lm")
    pill(d, 132, 398, "23 employees missing line manager", RED, "#FFF1F2", h=42)
    center = (760, 390)
    circle(d, center[0], center[1], 56, VIOLET)
    text(d, center[0], center[1] - 1, "SV", F["h3"], WHITE, anchor="mm")
    people = [(604, 282, "AD"), (914, 284, "CP"), (590, 516, "DB"), (932, 512, "DO"), (760, 560, "DE")]
    for x, y, label in people:
        line(d, [center, (x, y)], "#E7EDF6", 4)
        circle(d, x, y, 34, "#A5B4D6", "#FFFFFF", 3)
        text(d, x, y - 1, label, F["caption_sb"], WHITE, anchor="mm")
    return save(img, "10-ios26-inspired-reporting-lines.png")


def sheet_font(size: int, weight: str = "regular"):
    path = font_path(weight)
    return ImageFont.truetype(path, size) if path else ImageFont.load_default()


def sheet(paths: Iterable[Path]) -> Path:
    board = Image.new("RGBA", (1240, 1850), color(PAGE))
    d = ImageDraw.Draw(board, "RGBA")
    d.ellipse([-110, -80, 130, 160], fill=color("#F8FAFC", 120))
    d.ellipse([1010, 8, 1200, 198], fill=color("#F8FAFC", 110))
    d.text((56, 54), "Employee Master - iOS 26 Inspired Widgets", font=sheet_font(34, "bold"), fill=color(INK))
    d.text((56, 96), "Reference-inspired only: soft mobile surfaces, original Employee Master layouts.", font=sheet_font(19), fill=color(MUTED))
    xs = [56, 624]
    y = 150
    for i, path in enumerate(paths):
        if i > 0 and i % 2 == 0:
            y += 338
        x = xs[i % 2]
        thumb = Image.open(path).convert("RGB")
        thumb.thumbnail((560, 315), Image.Resampling.LANCZOS)
        layer = Image.new("RGBA", board.size, (0, 0, 0, 0))
        sd = ImageDraw.Draw(layer, "RGBA")
        sd.rounded_rectangle([x + 3, y + 9, x + 563, y + 324], radius=22, fill=(49, 58, 78, 25))
        layer = layer.filter(ImageFilter.GaussianBlur(14))
        board.alpha_composite(layer)
        board.paste(thumb, (x, y))
        d.rounded_rectangle([x, y, x + 560, y + 315], radius=22, outline=color("#CFD7E4"), width=1)
        d.rounded_rectangle([x, y + 276, x + 560, y + 315], radius=22, fill=(255, 255, 255, 232))
        d.rectangle([x, y + 276, x + 560, y + 296], fill=(255, 255, 255, 232))
        d.text((x + 18, y + 292), path.stem.replace("-", " ").title(), font=sheet_font(16, "semibold"), fill=color(INK))
    board.convert("RGB").save(SHEET, quality=95)
    return SHEET


def main():
    paths = [
        widget_01_active_workforce(),
        widget_02_record_quality(),
        widget_03_exception_monitor(),
        widget_04_hr_queue(),
        widget_05_assignment_battery(),
        widget_06_training_quality(),
        widget_07_org_activity(),
        widget_08_employee_focus(),
        widget_09_handoff_o2(),
        widget_10_supervisor_hrv(),
    ]
    print(sheet(paths))
    for path in paths:
        print(path)


if __name__ == "__main__":
    main()
