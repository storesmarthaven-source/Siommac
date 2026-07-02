from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


BASE = Path("C:/Users/MSI Laptop/Downloads/Screenshot 2026-06-28 at 13-58-05 Advanced Attendance & Location Management System.png")
OUT = Path(__file__).resolve().parent / "hr-employee-master-ten-widget-dashboard-mockup.png"

BG = "#F5F8FC"
CARD = "#FFFFFF"
SOFT = "#F8FAFD"
LINE = "#DCE6F2"
INK = "#14213A"
MUTED = "#627491"
NAVY = "#172B55"
NAVY_2 = "#213D6B"
NAVY_3 = "#2D4774"
BLUE = "#4EA1FF"
GREEN = "#21B47B"
AMBER = "#E29500"
RED = "#E03131"
LAV = "#7C6FF0"


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
    od.rounded_rectangle([x + 5, y + 9, x + w + 5, y + h + 9], radius=r, fill=(21, 34, 56, 18))
    overlay = overlay.filter(ImageFilter.GaussianBlur(8))
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


def top_stat(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, title: str, value: str, sub: str, tone=NAVY):
    rr(draw, x, y, w, 150, 24, fill=CARD, outline=LINE)
    rr(draw, x + 24, y + 28, 38, 38, 14, fill="#EEF4FF")
    txt(draw, x + 43, y + 47, title[:1], FONT["small_sb"], tone, anchor="mm")
    txt(draw, x + 78, y + 38, title, FONT["body_sb"], INK, anchor="lm")
    txt(draw, x + 78, y + 96, value, FONT["metric_sm"], tone, anchor="lm")
    txt(draw, x + 180, y + 94, sub, FONT["small"], MUTED, anchor="lm")
    progress(draw, x + w - 180, y + 112, 132, 65 if tone != RED else 35, tone if tone != NAVY else BLUE, "#EDF2F8", 9)


def dark_row(draw: ImageDraw.ImageDraw, x: int, y: int, label: str, value: str, pct: float, color: str, bar_w: int):
    rr(draw, x, y + 4, 12, 12, 6, fill=color)
    txt(draw, x + 24, y + 11, label, FONT["small_sb"], "#D9E4F5", anchor="lm")
    txt(draw, x + 230, y + 11, value, FONT["small_sb"], "#FFFFFF", anchor="rm")
    progress(draw, x + 252, y + 5, bar_w, pct, color, "#334D7C", 11)


def light_row(draw: ImageDraw.ImageDraw, x: int, y: int, label: str, value: str, pct: float, color: str, bar_w: int):
    rr(draw, x, y + 4, 12, 12, 6, fill=color)
    txt(draw, x + 24, y + 11, label, FONT["small_sb"], INK, anchor="lm")
    txt(draw, x + 250, y + 11, value, FONT["small_sb"], color, anchor="rm")
    progress(draw, x + 276, y + 5, bar_w, pct, color, "#E7EDF6", 11)


def donut(draw: ImageDraw.ImageDraw, cx: int, cy: int, r: int, pct: float, color: str, bg="#E7EDF6", dark=False):
    box = [cx - r, cy - r, cx + r, cy + r]
    draw.arc(box, 0, 360, fill=bg, width=16)
    if pct > 0:
        draw.arc(box, -90, -90 + 360 * pct / 100, fill=color, width=16)
    txt(draw, cx, cy - 4, f"{round(pct)}%", FONT["h3"], "#FFFFFF" if dark else INK, anchor="mm")
    txt(draw, cx, cy + 26, "ready", FONT["small"], "#AFC0D8" if dark else MUTED, anchor="mm")


def sparkline(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int, values: list[int], color=BLUE, dark=True):
    lo, hi = min(values), max(values)
    span = max(1, hi - lo)
    pts = []
    for i, v in enumerate(values):
        px = x + int(i * w / max(1, len(values) - 1))
        py = y + h - int((v - lo) * h / span) - 6
        pts.append((px, py))
    line(draw, [(x, y + h), (x + w, y + h)], "#3A5483" if dark else "#DDE6F2", 2)
    line(draw, pts, color, 5)
    for px, py in pts:
        rr(draw, px - 4, py - 4, 8, 8, 4, fill=color)


def draw_table(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int):
    rr(draw, x, y, w, h, 24, fill=CARD, outline=LINE)
    rr(draw, x + 32, y + 28, w - 520, 66, 16, fill=CARD, outline=LINE)
    txt(draw, x + 78, y + 62, "Search employee, email, employee no, position, department...", FONT["body"], "#8A98AD", anchor="lm")
    rr(draw, x + w - 466, y + 28, 178, 66, 16, fill=CARD, outline=LINE)
    txt(draw, x + w - 438, y + 52, "STATUS", FONT["tiny"], MUTED)
    txt(draw, x + w - 438, y + 76, "All", FONT["body_sb"], INK)
    rr(draw, x + w - 270, y + 28, 238, 66, 16, fill=NAVY)
    txt(draw, x + w - 151, y + 61, "Advanced filters", FONT["body_sb"], "#FFFFFF", anchor="mm")

    header_y = y + 122
    line(draw, [(x, header_y), (x + w, header_y)], LINE)
    headers = [("Employee", 24), ("Employee No.", 510), ("Role", 704), ("Department", 1018), ("Supervisor", 1260), ("Status", 1560), ("Training", 1730)]
    for label, dx in headers:
        if dx < w - 40:
            txt(draw, x + dx, header_y + 34, label, FONT["small_sb"], INK, anchor="lm")
    rows = [
        ("AD", "Amara Diallo", "amara.diallo@siomac.com", "EMP-0010", "Field Engineer", "Operations", "No supervisor", "Active", "Due Soon", AMBER),
        ("CP", "Claudia Pierre", "claudia.pierre@siomac.com", "EMP-0017", "Mechanical Superintendent", "Administration", "No supervisor", "Active", "Current", GREEN),
        ("DB", "Damani Baptiste", "mani@siomac.com", "EMP-0021", "Civil Engineer", "Operations", "No supervisor", "Active", "Expired", RED),
        ("DB", "Darrell Browne", "darrellbrowne@siomac.com", "EMP-0022", "Petroleum Engineer", "Administration", "No supervisor", "Active", "Due Soon", AMBER),
        ("DO", "David Okafor", "david.okafor@siomac.com", "EMP-0012", "Project Manager", "Operations", "No supervisor", "Active", "Due Soon", AMBER),
        ("DE", "Demo Employee", "", "EMP-0003", "Worker", "Administration", "No supervisor", "Active", "None", MUTED),
    ]
    for i, r in enumerate(rows):
        yy = header_y + 78 + i * 92
        if i == 0:
            rr(draw, x, yy - 28, w, 84, 0, fill="#F1F6FF")
        line(draw, [(x, yy + 56), (x + w, yy + 56)], "#E8EEF6")
        rr(draw, x + 24, yy - 10, 46, 46, 23, fill="#E7F0FF", outline="#C9DAF5")
        txt(draw, x + 47, yy + 13, r[0], FONT["small_sb"], NAVY, anchor="mm")
        txt(draw, x + 88, yy - 2, r[1], FONT["body_sb"], INK)
        txt(draw, x + 88, yy + 26, r[2], FONT["small"], MUTED)
        txt(draw, x + 510, yy + 14, r[3], FONT["body"], INK, anchor="lm")
        role = r[4]
        if len(role) > 19 and " " in role:
            first, second = role.split(" ", 1)
            txt(draw, x + 704, yy + 2, first, FONT["body"], INK, anchor="lm")
            txt(draw, x + 704, yy + 28, second, FONT["body"], INK, anchor="lm")
        else:
            txt(draw, x + 704, yy + 14, role, FONT["body"], INK, anchor="lm")
        txt(draw, x + 1018, yy + 14, r[5], FONT["body"], INK, anchor="lm")
        txt(draw, x + 1260, yy + 14, r[6], FONT["body"], "#9AA7BB", anchor="lm")
        pill(draw, x + 1560, yy - 8, r[7], GREEN, "#DFF7E8", 32, 14)
        pill(draw, x + 1730, yy - 8, r[8], r[9], "#FFF1C7" if r[9] == AMBER else "#DFF7E8" if r[9] == GREEN else "#FFE2E2" if r[9] == RED else "#EEF2F6", 32, 14)


def draw_mockup():
    base = Image.open(BASE).convert("RGBA")
    draw = ImageDraw.Draw(base)

    draw.rectangle([70, 392, 3055, 2042], fill=BG)

    # 1-4: redesigned top stats.
    top_stat(draw, 90, 418, 690, "Active Workforce", "23", "active people")
    top_stat(draw, 810, 418, 690, "HR Work Queue", "0", "open actions")
    top_stat(draw, 1530, 418, 690, "Payroll Ready", "0%", "ready", RED)
    top_stat(draw, 2250, 418, 690, "Exceptions", "26", "blocking items", RED)

    # 5: navy command widget.
    shadow_card(base, 90, 602, 760, 330, 30, NAVY, "#36507C")
    draw = ImageDraw.Draw(base)
    txt(draw, 130, 652, "Workforce Command", FONT["h2"], "#FFFFFF")
    txt(draw, 130, 690, "Headcount, queue, trend, and quick filters in one board tile.", FONT["small"], "#B7C7DD")
    pill(draw, 648, 638, "Live", "#DCEBFF", NAVY_3)
    for i, (label, value, note) in enumerate([("Headcount", "23", "active"), ("Employees", "23", "records"), ("Queue", "0", "open")]):
        xx = 130 + i * 190
        rr(draw, xx, 740, 166, 90, 18, fill=NAVY_2, outline="#3A5483")
        txt(draw, xx + 18, 768, label.upper(), FONT["tiny"], "#AFC0D8", anchor="lm")
        txt(draw, xx + 18, 804, value, FONT["metric_sm"], "#FFFFFF", anchor="lm")
        txt(draw, xx + 74, 802, note, FONT["small"], "#AFC0D8", anchor="lm")
    sparkline(draw, 130, 876, 250, 38, [23, 23, 23, 23, 23, 23])
    x = 420
    for label in ["Status", "Department", "Training"]:
        x += pill(draw, x, 862, label, "#DCEBFF", NAVY_3, 30, 12) + 10

    # 6: assignment coverage.
    shadow_card(base, 884, 602, 610, 330, 26, CARD, LINE)
    draw = ImageDraw.Draw(base)
    txt(draw, 924, 652, "Assignment Coverage", FONT["h3"], INK)
    txt(draw, 924, 686, "Department, site, supervisor, and role completeness.", FONT["small"], MUTED)
    light_row(draw, 924, 750, "Department assigned", "21 / 23", 91, GREEN, 210)
    light_row(draw, 924, 804, "Supervisor assigned", "0 / 23", 0, RED, 210)
    light_row(draw, 924, 858, "Site assigned", "0 / 23", 0, AMBER, 210)

    # 7: readiness health.
    shadow_card(base, 1528, 602, 660, 330, 30, NAVY, "#36507C")
    draw = ImageDraw.Draw(base)
    txt(draw, 1568, 652, "Readiness Health", FONT["h2"], "#FFFFFF")
    txt(draw, 1568, 690, "Payroll readiness and training certificate rollup.", FONT["small"], "#B7C7DD")
    rr(draw, 1568, 746, 190, 138, 22, fill=NAVY_2, outline="#3A5483")
    donut(draw, 1663, 812, 42, 0, GREEN, "#3D5782", True)
    dark_row(draw, 1800, 750, "Payroll ready", "0", 0, RED, 120)
    dark_row(draw, 1800, 802, "Training current", "2", 9, AMBER, 120)
    dark_row(draw, 1800, 854, "Training expired", "1", 4, RED, 120)

    # 8: department mix / demographics.
    shadow_card(base, 2222, 602, 718, 330, 26, CARD, LINE)
    draw = ImageDraw.Draw(base)
    txt(draw, 2262, 652, "Org Mix & Demographics", FONT["h3"], INK)
    txt(draw, 2262, 686, "Existing Department Distribution and Demographics widgets staged together.", FONT["small"], MUTED)
    # simple pie approximation
    draw.pieslice([2262, 740, 2384, 862], 0, 225, fill=GREEN)
    draw.pieslice([2262, 740, 2384, 862], 225, 360, fill=BLUE)
    rr(draw, 2300, 778, 46, 46, 23, fill=CARD)
    txt(draw, 2420, 758, "Operations", FONT["small_sb"], INK)
    progress(draw, 2540, 762, 250, 55, GREEN)
    txt(draw, 2420, 810, "Administration", FONT["small_sb"], INK)
    progress(draw, 2540, 814, 250, 45, BLUE)
    pill(draw, 2420, 862, "Avg age", NAVY, "#EEF4FF")
    pill(draw, 2534, 862, "Tenure", NAVY, "#EEF4FF")
    pill(draw, 2634, 862, "Worker type", NAVY, "#EEF4FF")

    # Register, narrowed to make room for right-side widgets.
    draw_table(draw, 90, 976, 2050, 980)

    # 9: profile focus widget to the right of the table.
    shadow_card(base, 2174, 976, 766, 438, 30, NAVY, "#36507C")
    draw = ImageDraw.Draw(base)
    txt(draw, 2214, 1028, "Employee Focus", FONT["h2"], "#FFFFFF")
    txt(draw, 2214, 1066, "Selected record context without opening a second page.", FONT["small"], "#B7C7DD")
    rr(draw, 2214, 1122, 70, 70, 35, fill="#5470A0", outline="#6F86AE")
    txt(draw, 2249, 1157, "AD", FONT["h3"], "#FFFFFF", anchor="mm")
    txt(draw, 2310, 1132, "Amara Diallo", FONT["h3"], "#FFFFFF")
    pill(draw, 2498, 1130, "Active", "#A6F3C6", "#2B795A")
    txt(draw, 2310, 1172, "EMP-0010 - Field Engineer - Operations", FONT["small"], "#B7C7DD")
    for i, (label, value) in enumerate([("Training", "Due Soon"), ("Supervisor", "Missing"), ("Workflow", "0 open")]):
        xx = 2214 + i * 236
        rr(draw, xx, 1232, 208, 86, 18, fill=NAVY_2, outline="#3A5483")
        txt(draw, xx + 18, 1262, label.upper(), FONT["tiny"], "#AFC0D8", anchor="lm")
        txt(draw, xx + 18, 1296, value, FONT["small_sb"], "#FFFFFF", anchor="lm")
    pill(draw, 2214, 1350, "Request Change", "#FFFFFF", NAVY_3, 36, 18)
    pill(draw, 2408, 1350, "Change Status", "#FFFFFF", NAVY_3, 36, 18)
    pill(draw, 2600, 1350, "Open Profile", "#FFFFFF", NAVY_3, 36, 18)

    # 10: corporate action queue below the focus card.
    shadow_card(base, 2174, 1440, 766, 516, 26, CARD, LINE)
    draw = ImageDraw.Draw(base)
    txt(draw, 2214, 1490, "HR Action Queue", FONT["h3"], INK)
    txt(draw, 2214, 1524, "Actionable cleanup and follow-up tied to Employee Master permissions.", FONT["small"], MUTED)
    actions = [
        ("Assign supervisors", "23 records", RED),
        ("Review departments", "2 records", AMBER),
        ("Open training records", "1 expired", BLUE),
        ("Check payroll readiness", "0 ready", RED),
        ("Prepare Finance handoff", "blocked", LAV),
    ]
    for i, (label, value, color) in enumerate(actions):
        yy = 1588 + i * 66
        rr(draw, 2214, yy, 666, 48, 16, fill=SOFT, outline=LINE)
        rr(draw, 2234, yy + 18, 12, 12, 6, fill=color)
        txt(draw, 2260, yy + 24, label, FONT["small_sb"], INK, anchor="lm")
        txt(draw, 2846, yy + 24, value, FONT["small_sb"], color, anchor="rm")

    base.convert("RGB").save(OUT, quality=95)
    return OUT


if __name__ == "__main__":
    print(draw_mockup())
