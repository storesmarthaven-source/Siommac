from __future__ import annotations

from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFilter, ImageFont


S = 2
W, H = 1280, 720
OUT_DIR = Path(__file__).resolve().parent / "employee-master-alt-design-widgets"
SHEET = Path(__file__).resolve().parent / "employee-master-alt-design-widgets-sheet.png"


def sc(v: int | float) -> int:
    return int(round(v * S))


def rgba(value: str, alpha: int = 255):
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
    "micro": make_font(11, "bold"),
    "caption": make_font(14),
    "caption_sb": make_font(14, "semibold"),
    "small": make_font(16),
    "small_sb": make_font(16, "semibold"),
    "body": make_font(20),
    "body_sb": make_font(20, "semibold"),
    "h3": make_font(25, "bold"),
    "h2": make_font(35, "bold"),
    "h1": make_font(50, "bold"),
    "metric": make_font(86, "bold"),
    "metric_xl": make_font(124, "bold"),
}


def canvas(bg: str) -> Image.Image:
    return Image.new("RGBA", (sc(W), sc(H)), rgba(bg))


def text(d: ImageDraw.ImageDraw, x: int, y: int, value: str, font, fill: str, anchor="la"):
    d.text((sc(x), sc(y)), value, font=font, fill=rgba(fill), anchor=anchor)


def rr(d: ImageDraw.ImageDraw, xy: list[int], r: int, fill: str | tuple | None = None, outline: str | None = None, width: int = 1):
    if isinstance(fill, str):
        fill = rgba(fill)
    d.rounded_rectangle(
        [sc(xy[0]), sc(xy[1]), sc(xy[2]), sc(xy[3])],
        radius=sc(r),
        fill=fill,
        outline=rgba(outline) if outline else None,
        width=sc(width),
    )


def rect(d: ImageDraw.ImageDraw, xy: list[int], fill: str, outline: str | None = None, width=1):
    d.rectangle([sc(xy[0]), sc(xy[1]), sc(xy[2]), sc(xy[3])], fill=rgba(fill), outline=rgba(outline) if outline else None, width=sc(width))


def line(d: ImageDraw.ImageDraw, pts: list[tuple[int, int]], fill: str, width=2):
    d.line([(sc(x), sc(y)) for x, y in pts], fill=rgba(fill), width=sc(width), joint="curve")


def circle(d: ImageDraw.ImageDraw, cx: int, cy: int, r: int, fill: str, outline: str | None = None, width=1):
    d.ellipse([sc(cx - r), sc(cy - r), sc(cx + r), sc(cy + r)], fill=rgba(fill), outline=rgba(outline) if outline else None, width=sc(width))


def shadow(img: Image.Image, xy: list[int], r=34, alpha=32, blur=18, dy=14):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle(
        [sc(xy[0] + 4), sc(xy[1] + dy), sc(xy[2] + 4), sc(xy[3] + dy)],
        radius=sc(r),
        fill=(24, 30, 43, alpha),
    )
    layer = layer.filter(ImageFilter.GaussianBlur(sc(blur)))
    img.alpha_composite(layer)


def pill(d: ImageDraw.ImageDraw, x: int, y: int, value: str, fg: str, bg: str, font=F["caption_sb"], h=34, pad=16):
    box = d.textbbox((0, 0), value, font=font)
    w = int((box[2] - box[0]) / S) + pad * 2
    rr(d, [x, y, x + w, y + h], h // 2, bg)
    text(d, x + w // 2, y + h // 2 - 1, value, font, fg, anchor="mm")
    return w


def progress(d: ImageDraw.ImageDraw, x: int, y: int, w: int, pct: float, color: str, bg: str, h=10):
    rr(d, [x, y, x + w, y + h], h // 2, bg)
    if pct > 0:
        rr(d, [x, y, x + max(h, int(w * pct / 100)), y + h], h // 2, color)


def downsave(img: Image.Image, name: str) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / name
    img.resize((W, H), Image.Resampling.LANCZOS).convert("RGB").save(out, quality=96)
    return out


def ring(d: ImageDraw.ImageDraw, cx: int, cy: int, r: int, pct: float, color: str, bg: str, width=16, fg="#111827"):
    box = [sc(cx - r), sc(cy - r), sc(cx + r), sc(cy + r)]
    d.arc(box, 0, 360, fill=rgba(bg), width=sc(width))
    if pct > 0:
        d.arc(box, -90, -90 + int(360 * pct / 100), fill=rgba(color), width=sc(width))
    text(d, cx, cy - 4, f"{int(pct)}%", F["h2"], fg, anchor="mm")
    text(d, cx, cy + 31, "ready", F["caption"], "#6B7280", anchor="mm")


def gradient_bg(img: Image.Image, top: str, bottom: str):
    d = ImageDraw.Draw(img)
    a = rgba(top)
    b = rgba(bottom)
    for y in range(sc(H)):
        t = y / max(1, sc(H) - 1)
        col = tuple(int(a[i] * (1 - t) + b[i] * t) for i in range(3)) + (255,)
        d.line([(0, y), (sc(W), y)], fill=col)


def widget_studio_glass() -> Path:
    img = canvas("#EAF7F3")
    gradient_bg(img, "#EAF7F3", "#F8F4EA")
    d = ImageDraw.Draw(img)
    circle(d, 1030, 132, 210, "#DDF5EF")
    circle(d, 190, 612, 170, "#F5E4DA")
    shadow(img, [88, 70, 1192, 650], r=44, alpha=26)
    rr(d, [88, 70, 1192, 650], 44, (255, 255, 255, 184), "#FFFFFF", 1)
    text(d, 132, 128, "People Signal", F["h2"], "#1F2937")
    text(d, 132, 168, "Active workforce health without the legacy dashboard feel.", F["small"], "#6B7280")
    pill(d, 1014, 120, "LIVE", "#0F766E", "#CCFBF1")

    text(d, 132, 370, "23", F["metric_xl"], "#111827", anchor="lm")
    text(d, 344, 338, "active records", F["h3"], "#111827", anchor="lm")
    text(d, 344, 376, "23 employees  /  0 contractors", F["small"], "#6B7280", anchor="lm")
    for i, (label, value, color) in enumerate([("Queue", "0", "#0EA5E9"), ("Missing supervisor", "23", "#F43F5E"), ("Ready", "0%", "#10B981")]):
        x = 132 + i * 318
        rr(d, [x, 478, x + 270, 574], 28, (255, 255, 255, 132), "#FFFFFF")
        text(d, x + 26, 516, label, F["caption_sb"], "#6B7280", anchor="lm")
        text(d, x + 26, 550, value, F["h3"], "#111827", anchor="lm")
        circle(d, x + 230, 520, 7, color)
    return downsave(img, "01-studio-glass-people-signal.png")


def widget_swiss_audit() -> Path:
    img = canvas("#F7F7F4")
    d = ImageDraw.Draw(img)
    rect(d, [88, 76, 1192, 648], "#F7F7F4", "#111111", 2)
    text(d, 124, 128, "RECORD QUALITY", F["micro"], "#111111")
    text(d, 124, 176, "Clean Record Score", F["h1"], "#111111")
    text(d, 124, 244, "Completion across supervisor, department, site, payroll, and training fields.", F["small"], "#525252")
    rect(d, [124, 296, 1156, 298], "#111111")

    text(d, 124, 420, "20", F["metric_xl"], "#111111", anchor="lm")
    text(d, 304, 390, "%", F["h1"], "#111111", anchor="lm")
    text(d, 124, 484, "clean", F["h2"], "#111111")
    rows = [("SUPERVISOR", "0/23", 0, "#E11D48"), ("DEPARTMENT", "21/23", 91, "#16A34A"), ("SITE", "0/23", 0, "#D97706"), ("TRAINING", "2/23", 9, "#2563EB")]
    y = 336
    for label, value, pct, color in rows:
        text(d, 522, y, label, F["micro"], "#111111")
        text(d, 750, y, value, F["body_sb"], "#111111")
        progress(d, 860, y - 3, 240, pct, color, "#E5E5E5", 12)
        y += 66
    rect(d, [124, 592, 1156, 596], "#111111")
    text(d, 124, 620, "NEXT: ASSIGN SUPERVISORS BEFORE DOWNSTREAM HANDOFF", F["caption_sb"], "#111111")
    return downsave(img, "02-swiss-record-quality.png")


def widget_brutalist_exceptions() -> Path:
    img = canvas("#FDF251")
    d = ImageDraw.Draw(img)
    rect(d, [88, 74, 1192, 648], "#FDF251", "#111111", 4)
    rect(d, [88, 74, 476, 648], "#111111")
    text(d, 126, 136, "EXCEPTION STACK", F["h2"], "#FDF251")
    text(d, 126, 222, "26", F["metric_xl"], "#FFFFFF")
    text(d, 126, 344, "BLOCKERS", F["h2"], "#FFFFFF")
    pill(d, 126, 400, "23 SUPERVISOR", "#111111", "#FFFFFF", h=42)
    pill(d, 126, 454, "2 DEPARTMENT", "#111111", "#F7B801", h=42)
    pill(d, 126, 508, "1 TRAINING", "#FFFFFF", "#2563EB", h=42)

    text(d, 542, 138, "Priority Actions", F["h1"], "#111111")
    actions = [("01", "Assign supervisors", "23 records", "#E11D48"), ("02", "Review departments", "2 records", "#D97706"), ("03", "Open training records", "1 expired", "#2563EB")]
    y = 236
    for n, title, count, color in actions:
        rect(d, [542, y, 1106, y + 90], "#FFFFFF", "#111111", 3)
        rect(d, [542, y, 618, y + 90], color, "#111111", 3)
        text(d, 580, y + 47, n, F["h3"], "#FFFFFF", anchor="mm")
        text(d, 652, y + 34, title, F["h3"], "#111111")
        text(d, 652, y + 66, count, F["small_sb"], color)
        y += 118
    return downsave(img, "03-brutalist-exception-stack.png")


def widget_clay_assignments() -> Path:
    img = canvas("#EEF0F5")
    d = ImageDraw.Draw(img)
    shadow(img, [92, 72, 1188, 648], r=46, alpha=20, blur=24)
    rr(d, [92, 72, 1188, 648], 46, "#F7F8FB", "#FFFFFF")
    text(d, 132, 130, "Assignment Lanes", F["h2"], "#1F2937")
    text(d, 132, 170, "A soft operational view of which employee rows are ready to route.", F["small"], "#667085")
    pill(d, 970, 124, "23 EMPLOYEES", "#4338CA", "#E0E7FF")
    rows = [("Department", 21, 23, "#22C55E"), ("Supervisor", 0, 23, "#EF4444"), ("Site", 0, 23, "#F59E0B")]
    y = 258
    for label, count, total, color in rows:
        text(d, 144, y + 30, label, F["body_sb"], "#1F2937")
        text(d, 144, y + 60, f"{count} assigned", F["caption"], "#667085")
        rr(d, [360, y, 1084, y + 92], 30, "#EBEEF5", "#FFFFFF")
        x = 396
        for i in range(total):
            rr(d, [x, y + 31, x + 16, y + 61], 8, color if i < count else "#D8DFEA")
            x += 27
        text(d, 1022, y + 47, f"{total - count} missing", F["small_sb"], color, anchor="rm")
        y += 118
    return downsave(img, "04-clay-assignment-lanes.png")


def widget_data_ink_readiness() -> Path:
    img = canvas("#FFFFFF")
    d = ImageDraw.Draw(img)
    rect(d, [0, 0, W, H], "#FFFFFF")
    for x in range(80, 1201, 80):
        line(d, [(x, 70), (x, 650)], "#EEF2F7", 1)
    for y in range(80, 641, 80):
        line(d, [(80, y), (1200, y)], "#EEF2F7", 1)
    text(d, 116, 126, "Readiness Radar", F["h2"], "#0F172A")
    text(d, 116, 166, "Gate health as a radar, not another KPI card.", F["small"], "#64748B")
    labels = [("Payroll", 0, -90), ("Training", 9, -18), ("Profile", 100, 54), ("Assignment", 30, 126), ("Workflow", 100, 198)]
    cx, cy, radius = 620, 380, 170
    for r in [50, 90, 130, 170]:
        d.polygon([(sc(cx + r * __import__("math").cos(__import__("math").radians(a))), sc(cy + r * __import__("math").sin(__import__("math").radians(a)))) for _, _, a in labels], outline=rgba("#D8DEE9"))
    pts = []
    import math
    for label, pct, angle in labels:
        x = cx + radius * math.cos(math.radians(angle))
        y = cy + radius * math.sin(math.radians(angle))
        line(d, [(cx, cy), (int(x), int(y))], "#CBD5E1", 1)
        text(d, int(cx + (radius + 54) * math.cos(math.radians(angle))), int(cy + (radius + 54) * math.sin(math.radians(angle))), label, F["caption_sb"], "#334155", anchor="mm")
        pts.append((sc(cx + radius * pct / 100 * math.cos(math.radians(angle))), sc(cy + radius * pct / 100 * math.sin(math.radians(angle)))))
    d.polygon(pts, fill=(37, 99, 235, 74), outline=rgba("#2563EB"))
    metrics = [("Payroll", "0%", "#EF4444"), ("Training", "9%", "#2563EB"), ("Profile", "100%", "#16A34A")]
    for i, (label, value, color) in enumerate(metrics):
        x = 900
        y = 292 + i * 74
        circle(d, x, y + 8, 6, color)
        text(d, x + 24, y, label, F["small_sb"], "#0F172A")
        text(d, x + 150, y, value, F["small_sb"], color)
    return downsave(img, "05-data-ink-readiness-radar.png")


def widget_graphite_training() -> Path:
    img = canvas("#151515")
    d = ImageDraw.Draw(img)
    rr(d, [92, 72, 1188, 648], 40, "#1F1F1F", "#333333")
    text(d, 132, 128, "Training Matrix", F["h2"], "#F5F5F5")
    text(d, 132, 170, "Certificate exposure grouped into a compact risk surface.", F["small"], "#A3A3A3")
    pill(d, 1000, 124, "1 EXPIRED", "#FCA5A5", "#3A1F1F")
    text(d, 132, 310, "2", F["metric"], "#4ADE80", anchor="lm")
    text(d, 224, 292, "current", F["h3"], "#F5F5F5")
    text(d, 132, 430, "4", F["metric"], "#FBBF24", anchor="lm")
    text(d, 224, 412, "due soon", F["h3"], "#F5F5F5")
    text(d, 132, 550, "1", F["metric"], "#F87171", anchor="lm")
    text(d, 224, 532, "expired", F["h3"], "#F5F5F5")
    rr(d, [500, 236, 1080, 544], 28, "#262626", "#3F3F46")
    labels = ["Ops", "Admin", "Field", "Proj.", "Worker"]
    for i, label in enumerate(labels):
        text(d, 576 + i * 94, 286, label, F["caption_sb"], "#A3A3A3", anchor="mm")
    colors = [["#22C55E", "#F59E0B", "#EF4444", "#3F3F46", "#F59E0B"], ["#22C55E", "#22C55E", "#F59E0B", "#3F3F46", "#3F3F46"], ["#F59E0B", "#EF4444", "#3F3F46", "#22C55E", "#F59E0B"]]
    for r, row in enumerate(colors):
        text(d, 526, 342 + r * 72, f"G{r+1}", F["caption"], "#A3A3A3")
        for c, color in enumerate(row):
            rr(d, [558 + c * 94, 320 + r * 72, 604 + c * 94, 366 + r * 72], 12, color)
    return downsave(img, "06-graphite-training-matrix.png")


def widget_editorial_org() -> Path:
    img = canvas("#FAFAFA")
    d = ImageDraw.Draw(img)
    text(d, 100, 126, "Org Composition", F["h1"], "#18181B")
    text(d, 100, 174, "Department distribution in a high-contrast editorial treatment.", F["small"], "#71717A")
    rect(d, [100, 220, 1180, 222], "#18181B")
    box = [sc(138), sc(282), sc(454), sc(598)]
    d.pieslice(box, -90, 97, fill=rgba("#14B8A6"))
    d.pieslice(box, 97, 237, fill=rgba("#A855F7"))
    d.pieslice(box, 237, 270, fill=rgba("#F59E0B"))
    d.ellipse([sc(244), sc(388), sc(348), sc(492)], fill=rgba("#FAFAFA"))
    text(d, 296, 422, "23", F["h2"], "#18181B", anchor="mm")
    text(d, 296, 458, "people", F["caption"], "#71717A", anchor="mm")
    items = [("Operations", "52%", "#14B8A6"), ("Administration", "39%", "#A855F7"), ("Missing dept.", "9%", "#F59E0B")]
    y = 288
    for label, pct, color in items:
        circle(d, 612, y + 13, 8, color)
        text(d, 642, y, label, F["h3"], "#18181B")
        text(d, 1040, y, pct, F["h3"], color, anchor="ra")
        rect(d, [612, y + 48, 1040, y + 50], "#E4E4E7")
        y += 104
    return downsave(img, "07-editorial-org-composition.png")


def widget_ios_employee() -> Path:
    img = canvas("#EDF2FF")
    gradient_bg(img, "#EDF2FF", "#FFF7ED")
    d = ImageDraw.Draw(img)
    circle(d, 1030, 116, 180, "#DBEAFE")
    circle(d, 188, 610, 160, "#FDE68A")
    shadow(img, [102, 82, 1178, 638], r=54, alpha=28)
    rr(d, [102, 82, 1178, 638], 54, (255, 255, 255, 190), "#FFFFFF")
    pill(d, 992, 124, "ACTIVE", "#047857", "#D1FAE5")
    text(d, 150, 150, "Employee Focus", F["h2"], "#111827")
    text(d, 150, 190, "Selected-row context in a softer mobile-widget style.", F["small"], "#6B7280")
    circle(d, 190, 318, 58, "#93A4C8")
    text(d, 190, 320, "AD", F["h2"], "#FFFFFF", anchor="mm")
    text(d, 282, 292, "Amara Diallo", F["h1"], "#111827")
    text(d, 282, 342, "EMP-0010  /  Field Engineer  /  Operations", F["small"], "#6B7280")
    text(d, 282, 382, "No supervisor  /  No site assigned", F["small_sb"], "#B45309")
    tiles = [("Training", "Due soon", "#F59E0B"), ("Supervisor", "Missing", "#EF4444"), ("Workflow", "0 open", "#06B6D4"), ("Payroll", "Not ready", "#EF4444")]
    for i, (label, value, color) in enumerate(tiles):
        x = 150 + i * 240
        rr(d, [x, 476, x + 204, 568], 28, (255, 255, 255, 142), "#FFFFFF")
        text(d, x + 22, 508, label, F["caption_sb"], "#6B7280", anchor="lm")
        text(d, x + 22, 542, value, F["body_sb"], "#111827", anchor="lm")
        circle(d, x + 174, 510, 6, color)
    return downsave(img, "08-ios-employee-focus.png")


def widget_industrial_handoff() -> Path:
    img = canvas("#E8E3DA")
    d = ImageDraw.Draw(img)
    rr(d, [90, 72, 1190, 648], 24, "#2F3437", None)
    text(d, 132, 130, "Handoff Flow", F["h2"], "#F5F2EA")
    text(d, 132, 172, "Downstream readiness as an operational routing board.", F["small"], "#B8B2A8")
    gates = [("HR", "100%", "#27AE60"), ("HSE", "9%", "#3B82F6"), ("OPS", "0%", "#F59E0B"), ("PAY", "0%", "#EF4444")]
    x = 156
    for i, (label, value, color) in enumerate(gates):
        rr(d, [x, 284, x + 190, 454], 18, "#3F464A", "#555F65")
        circle(d, x + 42, 328, 10, color)
        text(d, x + 70, 318, label, F["h3"], "#F5F2EA")
        text(d, x + 42, 398, value, F["h2"], color)
        if i < len(gates) - 1:
            line(d, [(x + 190, 370), (x + 248, 370)], "#7C858B", 4)
        x += 248
    rr(d, [132, 548, 1088, 592], 12, "#F5F2EA", None)
    text(d, 160, 570, "Blocked before Operations and Payroll until supervisor/site/statutory fields are completed.", F["small_sb"], "#2F3437", anchor="lm")
    return downsave(img, "09-industrial-handoff-flow.png")


def widget_command_feed() -> Path:
    img = canvas("#0B0F12")
    d = ImageDraw.Draw(img)
    rr(d, [92, 72, 1188, 648], 28, "#111820", "#26313A")
    text(d, 132, 128, "Action Feed", F["h2"], "#E5E7EB")
    text(d, 132, 168, "A command-center treatment for HR cleanup work.", F["small"], "#94A3B8")
    pill(d, 1010, 124, "0 OPEN HR ACTIONS", "#A7F3D0", "#12372E")
    rows = [
        ("WARN", "Supervisor missing", "23 records require reporting line assignment", "#F43F5E"),
        ("INFO", "Departments mostly complete", "21 of 23 records assigned", "#22C55E"),
        ("HOLD", "Payroll not ready", "0 statutory records ready", "#F59E0B"),
        ("TASK", "Training review", "1 expired certificate signal", "#38BDF8"),
    ]
    y = 248
    for level, title, note, color in rows:
        rr(d, [132, y, 1080, y + 78], 16, "#17212B", "#26313A")
        text(d, 160, y + 38, level, F["caption_sb"], color, anchor="lm")
        text(d, 262, y + 30, title, F["body_sb"], "#E5E7EB")
        text(d, 262, y + 58, note, F["caption"], "#94A3B8")
        y += 94
    return downsave(img, "10-command-action-feed.png")


def sheet_font(size: int, weight: str = "regular"):
    path = font_path(weight)
    return ImageFont.truetype(path, size) if path else ImageFont.load_default()


def make_sheet(paths: Iterable[Path]) -> Path:
    sheet = Image.new("RGBA", (1240, 1850), rgba("#E7EDF5"))
    d = ImageDraw.Draw(sheet)
    d.text((56, 54), "Employee Master - Alternative Design Directions", font=sheet_font(34, "bold"), fill=rgba("#111827"))
    d.text((56, 96), "No SIOMAC navy/corporate language: varied visual systems for direction finding.", font=sheet_font(19), fill=rgba("#64748B"))
    xs = [56, 624]
    y = 150
    for i, path in enumerate(paths):
        if i > 0 and i % 2 == 0:
            y += 338
        x = xs[i % 2]
        img = Image.open(path).convert("RGB")
        img.thumbnail((560, 315), Image.Resampling.LANCZOS)
        shadow_layer = Image.new("RGBA", sheet.size, (0, 0, 0, 0))
        sd = ImageDraw.Draw(shadow_layer)
        sd.rounded_rectangle([x + 3, y + 8, x + 563, y + 323], radius=20, fill=(24, 30, 43, 24))
        shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(14))
        sheet.alpha_composite(shadow_layer)
        sheet.paste(img, (x, y))
        d.rounded_rectangle([x, y, x + 560, y + 315], radius=20, outline=rgba("#CFD9E6"), width=1)
        d.rounded_rectangle([x, y + 276, x + 560, y + 315], radius=20, fill=(15, 23, 42, 210))
        d.rectangle([x, y + 276, x + 560, y + 296], fill=(15, 23, 42, 210))
        d.text((x + 18, y + 292), path.stem.replace("-", " ").title(), font=sheet_font(16, "semibold"), fill=rgba("#FFFFFF"))
    sheet.convert("RGB").save(SHEET, quality=95)
    return SHEET


def main():
    paths = [
        widget_studio_glass(),
        widget_swiss_audit(),
        widget_brutalist_exceptions(),
        widget_clay_assignments(),
        widget_data_ink_readiness(),
        widget_graphite_training(),
        widget_editorial_org(),
        widget_ios_employee(),
        widget_industrial_handoff(),
        widget_command_feed(),
    ]
    print(make_sheet(paths))
    for path in paths:
        print(path)


if __name__ == "__main__":
    main()
