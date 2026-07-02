from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = Path(__file__).resolve().parent
BASE = Path("C:/Users/MSI Laptop/Downloads/Screenshot 2026-06-28 at 13-58-05 Advanced Attendance & Location Management System.png")
OUT = OUT_DIR / "hr-employee-master-integrated-widget-mockup.png"

BG = "#F5F8FC"
SURFACE = "#FFFFFF"
SOFT = "#F8FAFD"
LINE = "#DDE6F1"
INK = "#17233D"
MUTED = "#667795"
NAVY = "#172A53"
RED = "#E03131"
GREEN = "#15935D"
AMBER = "#D98500"
BLUE = "#2F67D8"


def font_path(weight):
    root = Path("C:/Windows/Fonts")
    names = {
        "regular": ["segoeui.ttf", "arial.ttf"],
        "semibold": ["seguisb.ttf", "arialbd.ttf"],
        "bold": ["segoeuib.ttf", "arialbd.ttf"],
    }[weight]
    for name in names:
        p = root / name
        if p.exists():
            return str(p)
    return None


def font(size, weight="regular"):
    path = font_path(weight)
    return ImageFont.truetype(path, size) if path else ImageFont.load_default()


F = {
    "h2": font(34, "bold"),
    "h3": font(26, "bold"),
    "body": font(22),
    "body_sb": font(22, "semibold"),
    "small": font(18),
    "small_sb": font(18, "semibold"),
    "tiny": font(15, "bold"),
    "kpi": font(62, "bold"),
}


def rr(draw, x, y, w, h, r=24, fill=None, outline=None, width=2):
    draw.rounded_rectangle([x, y, x + w, y + h], radius=r, fill=fill, outline=outline, width=width if outline else 1)


def txt(draw, x, y, value, fnt, fill=INK, anchor="la"):
    draw.text((x, y), value, font=fnt, fill=fill, anchor=anchor)


def line(draw, points, fill=LINE, width=2):
    draw.line(points, fill=fill, width=width)


def progress(draw, x, y, w, pct, color, bg="#E8EEF6", h=12):
    rr(draw, x, y, w, h, h // 2, fill=bg)
    rr(draw, x, y, max(6, int(w * pct / 100)), h, h // 2, fill=color)


def pill(draw, x, y, label, fg=NAVY, bg="#EDF3FB"):
    pad_x = 18
    bbox = draw.textbbox((0, 0), label, font=F["small_sb"])
    w = bbox[2] - bbox[0] + pad_x * 2
    rr(draw, x, y, w, 34, 17, fill=bg)
    txt(draw, x + w / 2, y + 17, label, F["small_sb"], fg, anchor="mm")
    return w


def card(draw, x, y, w, h, title, subtitle=None, tag=None):
    rr(draw, x, y, w, h, 24, fill=SURFACE, outline=LINE)
    txt(draw, x + 34, y + 36, title, F["h3"], INK)
    if subtitle:
        txt(draw, x + 34, y + 72, subtitle, F["small"], MUTED)
    if tag:
        pill(draw, x + w - 190, y + 28, tag)


def stat(draw, x, y, w, title, value, note, tone=NAVY):
    card(draw, x, y, w, 210, title)
    txt(draw, x + 34, y + 104, value, F["kpi"], tone, anchor="lm")
    txt(draw, x + 34, y + 164, note, F["small"], MUTED, anchor="lm")


def row(draw, x, y, label, value, tone, pct=None, bar_w=210):
    colors = {"red": RED, "amber": AMBER, "green": GREEN, "blue": BLUE, "muted": MUTED}
    color = colors[tone]
    rr(draw, x, y + 4, 14, 14, 7, fill=color)
    txt(draw, x + 26, y + 12, label, F["small_sb"], INK, anchor="lm")
    txt(draw, x + 360, y + 12, value, F["small_sb"], color, anchor="rm")
    if pct is not None:
        progress(draw, x + 392, y + 6, bar_w, pct, color)


def draw_integrated():
    image = Image.open(BASE).convert("RGB")
    draw = ImageDraw.Draw(image)

    # Replace only the current widget area. Header, toolbar, table, and app shell remain from the screenshot.
    draw.rectangle([72, 400, 3048, 1010], fill=BG)

    stat(draw, 90, 430, 410, "Active Workforce", "23", "23 employees - 0 contractors")
    stat(draw, 532, 430, 410, "Open HR Work", "0", "No pending HR actions")
    stat(draw, 974, 430, 410, "Readiness", "0%", "Payroll and training not ready")
    stat(draw, 1416, 430, 410, "Exceptions", "26", "26 records need cleanup", RED)

    card(draw, 1860, 430, 1100, 210, "Workforce Exceptions", "Records blocking clean handoff or assignment", "current data")
    row(draw, 1894, 532, "Missing supervisor", "23", "red", 96, 520)
    row(draw, 1894, 584, "Missing department", "2", "amber", 12, 520)
    row(draw, 1894, 636, "Training status issue", "1", "blue", 6, 520)

    card(draw, 90, 692, 980, 286, "Exception Center", "Prioritized cleanup work HR can act on from this page.", "GridStack")
    txt(draw, 124, 806, "26", F["kpi"], RED, anchor="lm")
    txt(draw, 230, 806, "total blockers", F["body_sb"], INK, anchor="lm")
    row(draw, 124, 878, "Assign supervisors", "23 records", "red", 96, 280)
    row(draw, 124, 930, "Confirm department/site data", "25 records", "amber", 72, 280)
    rr(draw, 794, 782, 210, 126, 22, fill="#FFF5F5", outline="#FFD6D6")
    txt(draw, 899, 828, "23", F["h2"], RED, anchor="mm")
    txt(draw, 899, 868, "blocked by", F["small_sb"], INK, anchor="mm")
    txt(draw, 899, 896, "supervisor gaps", F["small"], MUTED, anchor="mm")

    card(draw, 1108, 692, 820, 286, "Assignment Coverage", "Completeness across key Employee Master fields.", "table fields")
    row(draw, 1142, 802, "Department assigned", "21 / 23", "green", 91, 300)
    row(draw, 1142, 854, "Supervisor assigned", "0 / 23", "red", 0, 300)
    row(draw, 1142, 906, "Site assigned", "0 / 23", "amber", 0, 300)

    card(draw, 1966, 692, 994, 286, "Readiness Breakdown", "Payroll, training, and statutory readiness by action type.", "wire later")
    row(draw, 2000, 802, "Payroll ready", "0 people", "red", 0, 430)
    row(draw, 2000, 854, "Training current", "2 people", "amber", 9, 430)
    row(draw, 2000, 906, "Training due soon", "4 people", "amber", 18, 430)
    row(draw, 2000, 958, "Training expired", "1 person", "red", 5, 430)

    image.save(OUT, quality=95)
    return OUT


if __name__ == "__main__":
    print(draw_integrated())
