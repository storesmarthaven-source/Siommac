from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


BASE = Path("C:/Users/MSI Laptop/Downloads/Screenshot 2026-06-28 at 13-58-05 Advanced Attendance & Location Management System.png")
OUT = Path(__file__).resolve().parent / "hr-employee-master-split-dashboard-mockup.png"

BG = "#F5F8FC"
CARD = "#FFFFFF"
SOFT = "#F8FAFD"
LINE = "#DCE6F2"
INK = "#14213A"
MUTED = "#627491"
NAVY = "#172B55"
NAVY_2 = "#213D6B"
NAVY_3 = "#2C4775"
BLUE = "#4EA1FF"
GREEN = "#21B47B"
AMBER = "#E29500"
RED = "#E03131"


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
    "h2": f(31, "bold"),
    "h3": f(24, "bold"),
    "h4": f(20, "bold"),
    "body": f(20),
    "body_sb": f(20, "semibold"),
    "small": f(16),
    "small_sb": f(16, "semibold"),
    "tiny": f(13, "bold"),
    "metric": f(52, "bold"),
    "metric_sm": f(38, "bold"),
}


def rr(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int, r: int = 22, fill=None, outline=None, width: int = 2):
    draw.rounded_rectangle([x, y, x + w, y + h], radius=r, fill=fill, outline=outline, width=width if outline else 1)


def txt(draw: ImageDraw.ImageDraw, x: int, y: int, value: str, font, fill=INK, anchor="la"):
    draw.text((x, y), value, font=font, fill=fill, anchor=anchor)


def line(draw: ImageDraw.ImageDraw, points, fill=LINE, width=2):
    draw.line(points, fill=fill, width=width)


def shadow_card(base: Image.Image, x: int, y: int, w: int, h: int, r: int, fill: str, outline: str | None = None):
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.rounded_rectangle([x + 4, y + 8, x + w + 4, y + h + 8], radius=r, fill=(22, 36, 60, 18))
    overlay = overlay.filter(ImageFilter.GaussianBlur(7))
    base.alpha_composite(overlay)
    d = ImageDraw.Draw(base)
    rr(d, x, y, w, h, r, fill=fill, outline=outline)


def pill(draw: ImageDraw.ImageDraw, x: int, y: int, label: str, fg: str, bg: str, h: int = 30, pad: int = 14):
    bbox = draw.textbbox((0, 0), label, font=FONT["small_sb"])
    w = bbox[2] - bbox[0] + pad * 2
    rr(draw, x, y, w, h, h // 2, fill=bg)
    txt(draw, x + w // 2, y + h // 2, label, FONT["small_sb"], fg, anchor="mm")
    return w


def progress(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, pct: float, color: str, bg="#E7EDF6", h: int = 11):
    rr(draw, x, y, w, h, h // 2, fill=bg)
    if pct > 0:
        rr(draw, x, y, max(7, int(w * pct / 100)), h, h // 2, fill=color)


def mini_stat(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, title: str, value: str, sub: str, tone=NAVY):
    rr(draw, x, y, w, 128, 20, fill=CARD, outline=LINE)
    txt(draw, x + 24, y + 32, title, FONT["small_sb"], INK, anchor="lm")
    txt(draw, x + 24, y + 82, value, FONT["metric_sm"], tone, anchor="lm")
    txt(draw, x + 106, y + 78, sub, FONT["small"], MUTED, anchor="lm")


def dark_chip(draw: ImageDraw.ImageDraw, x: int, y: int, title: str, value: str, note: str):
    rr(draw, x, y, 170, 92, 16, fill=NAVY_2, outline="#3A5483")
    txt(draw, x + 18, y + 28, title.upper(), FONT["tiny"], "#AFC0D8", anchor="lm")
    txt(draw, x + 18, y + 62, value, FONT["metric_sm"], "#FFFFFF", anchor="lm")
    txt(draw, x + 72, y + 60, note, FONT["small"], "#AFC0D8", anchor="lm")


def sparkline(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int, values: list[int], color=BLUE):
    lo, hi = min(values), max(values)
    span = max(1, hi - lo)
    pts = []
    for i, v in enumerate(values):
        px = x + int(i * w / max(1, len(values) - 1))
        py = y + h - int((v - lo) * h / span) - 6
        pts.append((px, py))
    line(draw, [(x, y + h), (x + w, y + h)], "#3A5483", 2)
    line(draw, pts, color, 5)
    for px, py in pts:
        rr(draw, px - 4, py - 4, 8, 8, 4, fill=color)


def dark_row(draw: ImageDraw.ImageDraw, x: int, y: int, label: str, value: str, pct: float, color: str, bar_w: int):
    rr(draw, x, y + 4, 12, 12, 6, fill=color)
    txt(draw, x + 24, y + 11, label, FONT["small_sb"], "#D9E4F5", anchor="lm")
    txt(draw, x + 240, y + 11, value, FONT["small_sb"], "#FFFFFF", anchor="rm")
    progress(draw, x + 262, y + 5, bar_w, pct, color, "#334D7C", 11)


def light_row(draw: ImageDraw.ImageDraw, x: int, y: int, label: str, value: str, pct: float, color: str, bar_w: int = 250):
    rr(draw, x, y + 4, 12, 12, 6, fill=color)
    txt(draw, x + 24, y + 11, label, FONT["small_sb"], INK, anchor="lm")
    txt(draw, x + 260, y + 11, value, FONT["small_sb"], color, anchor="rm")
    progress(draw, x + 286, y + 5, bar_w, pct, color, "#E7EDF6", 11)


def donut(draw: ImageDraw.ImageDraw, cx: int, cy: int, r: int, pct: float, color: str):
    box = [cx - r, cy - r, cx + r, cy + r]
    draw.arc(box, 0, 360, fill="#3D5782", width=16)
    if pct > 0:
        draw.arc(box, -90, -90 + 360 * pct / 100, fill=color, width=16)
    txt(draw, cx, cy - 4, f"{round(pct)}%", FONT["h3"], "#FFFFFF", anchor="mm")
    txt(draw, cx, cy + 26, "ready", FONT["small"], "#AFC0D8", anchor="mm")


def draw_split():
    base = Image.open(BASE).convert("RGBA")
    draw = ImageDraw.Draw(base)

    # Clear the original widget grid area only.
    draw.rectangle([70, 392, 3055, 1018], fill=BG)

    # Smaller stat row, still matching the real dashboard-stats contract.
    mini_stat(draw, 90, 418, 430, "Active Workforce", "23", "active people")
    mini_stat(draw, 548, 418, 430, "HR Work Queue", "0", "open actions")
    mini_stat(draw, 1006, 418, 430, "Payroll Ready", "0%", "ready", RED)
    mini_stat(draw, 1464, 418, 430, "Exceptions", "26", "blocking items", RED)
    mini_stat(draw, 1922, 418, 430, "Departments", "2", "assigned groups", NAVY)
    mini_stat(draw, 2380, 418, 430, "Training", "2", "current records", AMBER)

    # Main navy tile: compact command surface.
    shadow_card(base, 90, 586, 1000, 392, 28, NAVY, "#36507C")
    draw = ImageDraw.Draw(base)
    txt(draw, 130, 636, "Workforce Command", FONT["h2"], "#FFFFFF")
    txt(draw, 130, 674, "Headcount, HR queue, and movement lenses without leaving the register.", FONT["small"], "#B7C7DD")
    pill(draw, 878, 624, "Live data", "#DCEBFF", NAVY_3)
    dark_chip(draw, 130, 730, "Headcount", "23", "active")
    dark_chip(draw, 312, 730, "Employees", "23", "records")
    dark_chip(draw, 494, 730, "Queue", "0", "open")
    dark_chip(draw, 676, 730, "Contractors", "0", "active")
    txt(draw, 130, 880, "Operational lenses", FONT["small_sb"], "#D9E4F5")
    x = 130
    for label in ["Status", "Department", "Employment", "Training"]:
        x += pill(draw, x, 910, label, "#DCEBFF", NAVY_3, 30, 12) + 10
    rr(draw, 866, 732, 182, 166, 18, fill=NAVY_2, outline="#3A5483")
    txt(draw, 886, 770, "6-month trend", FONT["small_sb"], "#D9E4F5")
    sparkline(draw, 886, 816, 126, 48, [23, 23, 23, 23, 23, 23])
    txt(draw, 886, 884, "Stable workforce", FONT["small"], "#AFC0D8")

    # Assignment card, light to break up the navy.
    shadow_card(base, 1124, 586, 610, 186, 24, CARD, LINE)
    draw = ImageDraw.Draw(base)
    txt(draw, 1160, 632, "Assignment Coverage", FONT["h3"], INK)
    txt(draw, 1160, 666, "Department, site, supervisor, and role completeness.", FONT["small"], MUTED)
    light_row(draw, 1160, 716, "Department assigned", "21 / 23", 91, GREEN, 210)
    light_row(draw, 1160, 758, "Supervisor assigned", "0 / 23", 0, RED, 210)

    shadow_card(base, 1124, 798, 610, 180, 24, CARD, LINE)
    draw = ImageDraw.Draw(base)
    txt(draw, 1160, 844, "Register Insights", FONT["h3"], INK)
    txt(draw, 1160, 878, "Built from Employee Master row fields.", FONT["small"], MUTED)
    pill(draw, 1160, 922, "Department Distribution", NAVY, "#EEF4FF")
    pill(draw, 1400, 922, "Demographics", NAVY, "#EEF4FF")

    # Second navy tile: readiness and exception health.
    shadow_card(base, 1768, 586, 696, 392, 28, NAVY, "#36507C")
    draw = ImageDraw.Draw(base)
    txt(draw, 1808, 636, "Readiness Health", FONT["h2"], "#FFFFFF")
    txt(draw, 1808, 674, "Payroll readiness and training rollups from HR + HSE worker certificates.", FONT["small"], "#B7C7DD")
    rr(draw, 1808, 730, 220, 196, 20, fill=NAVY_2, outline="#3A5483")
    donut(draw, 1918, 810, 48, 0, GREEN)
    txt(draw, 1918, 890, "0 payroll ready", FONT["small_sb"], "#D9E4F5", anchor="mm")
    dark_row(draw, 2070, 746, "Payroll ready", "0", 0, RED, 100)
    dark_row(draw, 2070, 794, "Training current", "2", 9, AMBER, 100)
    dark_row(draw, 2070, 842, "Training expired", "1", 4, RED, 100)
    dark_row(draw, 2070, 890, "Finance eligible", "0", 0, BLUE, 100)

    # Action tile near the register, separate from readiness.
    shadow_card(base, 2498, 586, 462, 392, 24, CARD, LINE)
    draw = ImageDraw.Draw(base)
    txt(draw, 2534, 632, "Exception Actions", FONT["h3"], INK)
    txt(draw, 2534, 666, "Quick entry points tied to real Employee Master actions.", FONT["small"], MUTED)
    actions = [
        ("Assign supervisors", "23", RED),
        ("Review departments", "2", AMBER),
        ("Open training records", "1", BLUE),
        ("Review selected profile", "Amara", GREEN),
    ]
    for i, (label, value, color) in enumerate(actions):
        yy = 732 + i * 56
        rr(draw, 2534, yy, 382, 42, 14, fill=SOFT, outline=LINE)
        rr(draw, 2552, yy + 15, 12, 12, 6, fill=color)
        txt(draw, 2578, yy + 22, label, FONT["small_sb"], INK, anchor="lm")
        txt(draw, 2892, yy + 22, value, FONT["small_sb"], color, anchor="rm")

    # A narrow bridge into the register, so the board feels connected to the table below.
    rr(draw, 90, 990, 2870, 28, 14, fill="#EEF4FF", outline="#D8E5F4")
    txt(draw, 122, 1004, "Employee register remains the primary workspace below; selecting a row opens the existing dark profile drawer.", FONT["small_sb"], MUTED, anchor="lm")

    base.convert("RGB").save(OUT, quality=95)
    return OUT


if __name__ == "__main__":
    print(draw_split())
