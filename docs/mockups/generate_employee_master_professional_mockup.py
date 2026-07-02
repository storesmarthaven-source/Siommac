from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


BASE = Path("C:/Users/MSI Laptop/Downloads/Screenshot 2026-06-28 at 13-58-05 Advanced Attendance & Location Management System.png")
OUT = Path(__file__).resolve().parent / "hr-employee-master-professional-dashboard-mockup.png"

BG = "#F5F8FC"
CARD = "#FFFFFF"
CARD_2 = "#F8FAFD"
LINE = "#DCE6F2"
INK = "#14213A"
MUTED = "#627491"
NAVY = "#172B55"
NAVY_2 = "#203B68"
NAVY_3 = "#2D4774"
BLUE = "#4EA1FF"
GREEN = "#21B47B"
AMBER = "#E29500"
RED = "#E03131"
SOFT_WHITE = "#EEF4FF"


def font_path(weight: str) -> str | None:
    root = Path("C:/Windows/Fonts")
    candidates = {
        "regular": ["segoeui.ttf", "arial.ttf"],
        "semibold": ["seguisb.ttf", "arialbd.ttf"],
        "bold": ["segoeuib.ttf", "arialbd.ttf"],
    }[weight]
    for name in candidates:
        p = root / name
        if p.exists():
            return str(p)
    return None


def f(size: int, weight: str = "regular"):
    path = font_path(weight)
    return ImageFont.truetype(path, size) if path else ImageFont.load_default()


FONT = {
    "eyebrow": f(15, "bold"),
    "h2": f(34, "bold"),
    "h3": f(27, "bold"),
    "h4": f(22, "bold"),
    "body": f(21),
    "body_sb": f(21, "semibold"),
    "small": f(17),
    "small_sb": f(17, "semibold"),
    "tiny": f(14, "bold"),
    "metric": f(56, "bold"),
    "metric_sm": f(42, "bold"),
}


def rr(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int, r: int = 24, fill=None, outline=None, width: int = 2):
    draw.rounded_rectangle([x, y, x + w, y + h], radius=r, fill=fill, outline=outline, width=width if outline else 1)


def txt(draw: ImageDraw.ImageDraw, x: int, y: int, value: str, font, fill=INK, anchor="la"):
    draw.text((x, y), value, font=font, fill=fill, anchor=anchor)


def line(draw: ImageDraw.ImageDraw, points, fill=LINE, width=2):
    draw.line(points, fill=fill, width=width)


def shadow_card(base: Image.Image, x: int, y: int, w: int, h: int, r: int, fill: str, outline: str | None = None):
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.rounded_rectangle([x + 4, y + 8, x + w + 4, y + h + 8], radius=r, fill=(22, 36, 60, 20))
    overlay = overlay.filter(ImageFilter.GaussianBlur(8))
    base.alpha_composite(overlay)
    d = ImageDraw.Draw(base)
    rr(d, x, y, w, h, r, fill=fill, outline=outline)


def pill(draw: ImageDraw.ImageDraw, x: int, y: int, label: str, fg: str, bg: str, h: int = 34, pad: int = 16):
    bbox = draw.textbbox((0, 0), label, font=FONT["small_sb"])
    w = bbox[2] - bbox[0] + pad * 2
    rr(draw, x, y, w, h, h // 2, fill=bg)
    txt(draw, x + w // 2, y + h // 2, label, FONT["small_sb"], fg, anchor="mm")
    return w


def progress(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, pct: float, color: str, bg="#E7EDF6", h: int = 12):
    rr(draw, x, y, w, h, h // 2, fill=bg)
    if pct > 0:
        rr(draw, x, y, max(7, int(w * pct / 100)), h, h // 2, fill=color)


def stat_card(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, title: str, value: str, sub: str, foot: str, tone=NAVY):
    rr(draw, x, y, w, 142, 22, fill=CARD, outline=LINE)
    txt(draw, x + 28, y + 36, title, FONT["body_sb"], INK, anchor="lm")
    txt(draw, x + 28, y + 92, value, FONT["metric_sm"], tone, anchor="lm")
    txt(draw, x + 118, y + 86, sub, FONT["small"], MUTED, anchor="lm")
    txt(draw, x + 28, y + 120, foot, FONT["small"], MUTED, anchor="lm")


def dark_row(draw: ImageDraw.ImageDraw, x: int, y: int, label: str, value: str, pct: float, color: str, w: int = 330):
    rr(draw, x, y + 3, 12, 12, 6, fill=color)
    txt(draw, x + 24, y + 10, label, FONT["small_sb"], "#D9E4F5", anchor="lm")
    txt(draw, x + 230, y + 10, value, FONT["small_sb"], "#FFFFFF", anchor="rm")
    progress(draw, x + 252, y + 4, w, pct, color, "#334D7C", 11)


def dark_metric(draw: ImageDraw.ImageDraw, x: int, y: int, label: str, value: str, note: str, tone="#FFFFFF"):
    rr(draw, x, y, 238, 118, 18, fill=NAVY_2, outline="#3A5483")
    txt(draw, x + 22, y + 34, label.upper(), FONT["tiny"], "#AFC0D8", anchor="lm")
    txt(draw, x + 22, y + 76, value, FONT["metric_sm"], tone, anchor="lm")
    txt(draw, x + 22, y + 102, note, FONT["small"], "#AFC0D8", anchor="lm")


def sparkline(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int, values: list[int], color=BLUE):
    if not values:
        values = [23, 23, 23, 23, 23, 23]
    lo, hi = min(values), max(values)
    span = max(1, hi - lo)
    pts = []
    for i, v in enumerate(values):
        px = x + int(i * w / max(1, len(values) - 1))
        py = y + h - int((v - lo) * h / span) - 8
        pts.append((px, py))
    line(draw, [(x, y + h), (x + w, y + h)], "#3A5483", 2)
    line(draw, pts, color, 5)
    for px, py in pts:
        rr(draw, px - 4, py - 4, 8, 8, 4, fill=color)


def donut(draw: ImageDraw.ImageDraw, cx: int, cy: int, r: int, pct: float, color: str, bg="#415983"):
    box = [cx - r, cy - r, cx + r, cy + r]
    draw.arc(box, 0, 360, fill=bg, width=18)
    if pct > 0:
        draw.arc(box, -90, -90 + 360 * pct / 100, fill=color, width=18)
    txt(draw, cx, cy - 4, f"{round(pct)}%", FONT["h3"], "#FFFFFF", anchor="mm")
    txt(draw, cx, cy + 28, "ready", FONT["small"], "#AFC0D8", anchor="mm")


def draw_professional():
    base = Image.open(BASE).convert("RGBA")
    draw = ImageDraw.Draw(base)

    # Replace the current widget zone only; keep the real Employee Master header, controls, and table.
    draw.rectangle([70, 392, 3055, 1018], fill=BG)

    stat_card(draw, 90, 420, 680, "Active Workforce", "23", "active people", "23 employees - 0 contractors")
    stat_card(draw, 800, 420, 680, "HR Work Queue", "0", "open actions", "No submitted or in-review changes")
    stat_card(draw, 1510, 420, 680, "Payroll Readiness", "0%", "ready", "0 payroll ready - 2 training current", RED)
    stat_card(draw, 2220, 420, 680, "Exceptions", "26", "blocking items", "Supervisor 23 - Department 2 - Training 1", RED)

    # Rich navy widget 1: the real dashboard-stats contract.
    shadow_card(base, 90, 604, 1396, 388, 28, NAVY, "#36507C")
    draw = ImageDraw.Draw(base)
    txt(draw, 130, 652, "Workforce Command", FONT["h2"], "#FFFFFF")
    txt(draw, 130, 690, "A single command view for workforce size, readiness, HR actions, and trend movement.", FONT["small"], "#B7C7DD")
    pill(draw, 1248, 638, "Live data", "#DCEBFF", "#2D4774", 34, 16)

    dark_metric(draw, 130, 742, "Headcount", "23", "active records")
    dark_metric(draw, 392, 742, "Employees", "23", "employee records")
    dark_metric(draw, 654, 742, "Contractors", "0", "no contractors")
    dark_metric(draw, 916, 742, "HR Queue", "0", "urgent actions")

    rr(draw, 1182, 742, 252, 214, 20, fill=NAVY_2, outline="#3A5483")
    txt(draw, 1210, 778, "6-month headcount", FONT["small_sb"], "#D9E4F5")
    sparkline(draw, 1210, 830, 192, 78, [23, 23, 23, 23, 23, 23])
    txt(draw, 1210, 932, "Stable active workforce", FONT["small"], "#AFC0D8")

    txt(draw, 130, 920, "Operational lenses", FONT["small_sb"], "#D9E4F5")
    x = 130
    for label in ["Status", "Department", "Employment type", "Training"]:
        x += pill(draw, x, 946, label, "#DCEBFF", "#314D7A", 32, 14) + 10

    # Rich navy widget 2: fields exposed by list rows and the existing insight widgets.
    shadow_card(base, 1522, 604, 1378, 388, 28, NAVY, "#36507C")
    draw = ImageDraw.Draw(base)
    txt(draw, 1562, 652, "Assignment & Readiness Health", FONT["h2"], "#FFFFFF")
    txt(draw, 1562, 690, "Assignment completeness, department coverage, payroll readiness, and training signals.", FONT["small"], "#B7C7DD")
    pill(draw, 2600, 638, "Register insights", "#DCEBFF", "#2D4774", 34, 16)

    rr(draw, 1562, 742, 272, 214, 20, fill=NAVY_2, outline="#3A5483")
    txt(draw, 1698, 782, "0%", FONT["metric"], "#FFFFFF", anchor="mm")
    txt(draw, 1698, 824, "payroll ready", FONT["small_sb"], "#B7C7DD", anchor="mm")
    donut(draw, 1698, 884, 46, 0, GREEN)

    rr(draw, 1870, 742, 470, 214, 20, fill=NAVY_2, outline="#3A5483")
    txt(draw, 1900, 780, "Exception mix", FONT["body_sb"], "#FFFFFF")
    dark_row(draw, 1900, 830, "Missing supervisor", "23", 100, RED, 160)
    dark_row(draw, 1900, 876, "Missing department", "2", 9, AMBER, 160)
    dark_row(draw, 1900, 922, "Training expired", "1", 4, BLUE, 160)

    rr(draw, 2376, 742, 472, 214, 20, fill=NAVY_2, outline="#3A5483")
    txt(draw, 2406, 780, "Workforce insights", FONT["body_sb"], "#FFFFFF")
    insight = [
        ("Department Distribution", "by assigned department"),
        ("Demographics", "age, tenure, worker type"),
        ("Training Status", "certificate rollup"),
    ]
    for i, (name, desc) in enumerate(insight):
        yy = 826 + i * 42
        rr(draw, 2406, yy - 10, 12, 12, 6, fill=[GREEN, BLUE, AMBER][i])
        txt(draw, 2428, yy - 14, name, FONT["small_sb"], "#FFFFFF")
        txt(draw, 2660, yy - 14, desc, FONT["small"], "#AFC0D8")

    txt(draw, 1562, 968, "Profile review, assignment update, status change, statutory follow-up.", FONT["small_sb"], "#D9E4F5")

    base.convert("RGB").save(OUT, quality=95)
    return OUT


if __name__ == "__main__":
    print(draw_professional())
