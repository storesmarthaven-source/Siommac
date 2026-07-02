from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


BASE = Path("C:/Users/MSI Laptop/Downloads/Screenshot 2026-06-28 at 13-58-05 Advanced Attendance & Location Management System.png")
OUT = Path(__file__).resolve().parent / "hr-employee-master-premium-widget-dashboard.png"

BG = "#F4F7FB"
CARD = "#FFFFFF"
CARD_SOFT = "#F8FAFD"
LINE = "#D9E4F0"
INK = "#13213A"
MUTED = "#657795"
MUTED_2 = "#92A0B7"
NAVY = "#142653"
NAVY_2 = "#203A68"
NAVY_3 = "#2D4B7C"
BLUE = "#3B82F6"
CYAN = "#38BDF8"
GREEN = "#16A36C"
AMBER = "#D98905"
RED = "#DC3030"
VIOLET = "#7C6FF0"


def font_path(weight: str) -> str | None:
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


def f(size: int, weight: str = "regular"):
    path = font_path(weight)
    return ImageFont.truetype(path, size) if path else ImageFont.load_default()


FONT = {
    "h1": f(38, "bold"),
    "h2": f(31, "bold"),
    "h3": f(24, "bold"),
    "h4": f(20, "bold"),
    "body": f(20),
    "body_sb": f(20, "semibold"),
    "small": f(16),
    "small_sb": f(16, "semibold"),
    "tiny": f(13, "bold"),
    "metric": f(56, "bold"),
    "metric_sm": f(38, "bold"),
    "metric_xs": f(30, "bold"),
}


def rr(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int, r: int = 24, fill=None, outline=None, width: int = 2):
    draw.rounded_rectangle([x, y, x + w, y + h], radius=r, fill=fill, outline=outline, width=width if outline else 1)


def txt(draw: ImageDraw.ImageDraw, x: int, y: int, value: str, font, fill=INK, anchor="la"):
    draw.text((x, y), value, font=font, fill=fill, anchor=anchor)


def line(draw: ImageDraw.ImageDraw, points, fill=LINE, width=2):
    draw.line(points, fill=fill, width=width)


def shadow_card(base: Image.Image, x: int, y: int, w: int, h: int, r: int, fill: str, outline: str | None = None, shadow=(18, 36, 62, 22)):
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.rounded_rectangle([x + 5, y + 10, x + w + 5, y + h + 10], radius=r, fill=shadow)
    overlay = overlay.filter(ImageFilter.GaussianBlur(10))
    base.alpha_composite(overlay)
    d = ImageDraw.Draw(base)
    rr(d, x, y, w, h, r, fill=fill, outline=outline)


def pill(draw: ImageDraw.ImageDraw, x: int, y: int, label: str, fg: str, bg: str, h: int = 32, pad: int = 14):
    bbox = draw.textbbox((0, 0), label, font=FONT["small_sb"])
    w = bbox[2] - bbox[0] + pad * 2
    rr(draw, x, y, w, h, h // 2, fill=bg)
    txt(draw, x + w // 2, y + h // 2, label, FONT["small_sb"], fg, anchor="mm")
    return w


def progress(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, pct: float, color: str, bg="#E7EEF7", h: int = 11):
    rr(draw, x, y, w, h, h // 2, fill=bg)
    if pct > 0:
        rr(draw, x, y, max(7, int(w * pct / 100)), h, h // 2, fill=color)


def icon(draw: ImageDraw.ImageDraw, x: int, y: int, label: str, color=NAVY, bg="#EEF4FF"):
    rr(draw, x, y, 42, 42, 15, fill=bg)
    txt(draw, x + 21, y + 21, label, FONT["small_sb"], color, anchor="mm")


def top_widget(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, title: str, value: str, sub: str, tone: str, detail: str, icon_label: str):
    rr(draw, x, y, w, 170, 26, fill=CARD, outline=LINE)
    icon(draw, x + 24, y + 24, icon_label, tone, "#EEF4FF" if tone != RED else "#FFF0F0")
    txt(draw, x + 82, y + 38, title, FONT["body_sb"], INK, anchor="lm")
    txt(draw, x + 82, y + 94, value, FONT["metric_sm"], tone, anchor="lm")
    txt(draw, x + 184, y + 92, sub, FONT["small"], MUTED, anchor="lm")
    txt(draw, x + 82, y + 132, detail, FONT["small"], MUTED, anchor="lm")
    progress(draw, x + w - 176, y + 124, 120, 72 if tone not in (RED, AMBER) else 34, tone if tone != NAVY else BLUE)


def sparkline(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int, values: list[int], color=CYAN, dark=True):
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


def donut(draw: ImageDraw.ImageDraw, cx: int, cy: int, r: int, pct: float, color: str, bg="#E7EEF7", dark=False):
    box = [cx - r, cy - r, cx + r, cy + r]
    draw.arc(box, 0, 360, fill=bg, width=16)
    if pct > 0:
        draw.arc(box, -90, -90 + 360 * pct / 100, fill=color, width=16)
    txt(draw, cx, cy - 5, f"{round(pct)}%", FONT["h3"], "#FFFFFF" if dark else INK, anchor="mm")
    txt(draw, cx, cy + 25, "ready", FONT["small"], "#AFC0D8" if dark else MUTED, anchor="mm")


def row_light(draw: ImageDraw.ImageDraw, x: int, y: int, label: str, value: str, pct: float, color: str, bar_w: int = 190):
    rr(draw, x, y + 5, 12, 12, 6, fill=color)
    txt(draw, x + 24, y + 12, label, FONT["small_sb"], INK, anchor="lm")
    txt(draw, x + 260, y + 12, value, FONT["small_sb"], color, anchor="rm")
    progress(draw, x + 286, y + 6, bar_w, pct, color)


def row_dark(draw: ImageDraw.ImageDraw, x: int, y: int, label: str, value: str, pct: float, color: str, bar_w: int = 118):
    rr(draw, x, y + 5, 12, 12, 6, fill=color)
    txt(draw, x + 24, y + 12, label, FONT["small_sb"], "#DDE8F7", anchor="lm")
    txt(draw, x + 226, y + 12, value, FONT["small_sb"], "#FFFFFF", anchor="rm")
    progress(draw, x + 246, y + 6, bar_w, pct, color, "#344F80")


def action_row(draw: ImageDraw.ImageDraw, x: int, y: int, label: str, value: str, color: str, w: int):
    rr(draw, x, y, w, 48, 16, fill=CARD_SOFT, outline=LINE)
    rr(draw, x + 18, y + 18, 12, 12, 6, fill=color)
    txt(draw, x + 44, y + 24, label, FONT["small_sb"], INK, anchor="lm")
    txt(draw, x + w - 28, y + 24, value, FONT["small_sb"], color, anchor="rm")


def draw_register(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int):
    rr(draw, x, y, w, h, 28, fill=CARD, outline=LINE)
    rr(draw, x + 32, y + 30, w - 510, 66, 18, fill=CARD, outline=LINE)
    txt(draw, x + 76, y + 63, "Search employee, email, employee no, position, department...", FONT["body"], "#8A98AD", anchor="lm")
    rr(draw, x + w - 460, y + 30, 174, 66, 18, fill=CARD, outline=LINE)
    txt(draw, x + w - 432, y + 54, "STATUS", FONT["tiny"], MUTED)
    txt(draw, x + w - 432, y + 78, "All", FONT["body_sb"], INK)
    rr(draw, x + w - 268, y + 30, 236, 66, 18, fill=NAVY)
    txt(draw, x + w - 150, y + 63, "Advanced filters", FONT["body_sb"], "#FFFFFF", anchor="mm")

    hy = y + 126
    line(draw, [(x, hy), (x + w, hy)], LINE)
    headers = [("Employee", 24), ("Employee No.", 500), ("Role", 690), ("Department", 995), ("Supervisor", 1230), ("Status", 1510), ("Training", 1680)]
    for label, dx in headers:
        if dx < w - 40:
            txt(draw, x + dx, hy + 34, label, FONT["small_sb"], INK, anchor="lm")

    rows = [
        ("AD", "Amara Diallo", "amara.diallo@siomac.com", "EMP-0010", "Field Engineer", "Operations", "No supervisor", "Active", "Due Soon", AMBER),
        ("CP", "Claudia Pierre", "claudia.pierre@siomac.com", "EMP-0017", "Mechanical Superintendent", "Administration", "No supervisor", "Active", "Current", GREEN),
        ("DB", "Damani Baptiste", "mani@siomac.com", "EMP-0021", "Civil Engineer", "Operations", "No supervisor", "Active", "Expired", RED),
        ("DB", "Darrell Browne", "darrellbrowne@siomac.com", "EMP-0022", "Petroleum Engineer", "Administration", "No supervisor", "Active", "Due Soon", AMBER),
        ("DO", "David Okafor", "david.okafor@siomac.com", "EMP-0012", "Project Manager", "Operations", "No supervisor", "Active", "Due Soon", AMBER),
        ("DE", "Demo Employee", "", "EMP-0003", "Worker", "Administration", "No supervisor", "Active", "None", MUTED),
    ]
    for i, row in enumerate(rows):
        yy = hy + 78 + i * 92
        if i == 0:
            rr(draw, x, yy - 28, w, 84, 0, fill="#F1F6FF")
        line(draw, [(x, yy + 56), (x + w, yy + 56)], "#E8EEF6")
        rr(draw, x + 24, yy - 10, 46, 46, 23, fill="#E7F0FF", outline="#C9DAF5")
        txt(draw, x + 47, yy + 13, row[0], FONT["small_sb"], NAVY, anchor="mm")
        txt(draw, x + 88, yy - 2, row[1], FONT["body_sb"], INK)
        txt(draw, x + 88, yy + 26, row[2], FONT["small"], MUTED)
        txt(draw, x + 500, yy + 14, row[3], FONT["body"], INK, anchor="lm")
        role = row[4]
        if len(role) > 19 and " " in role:
            first, second = role.split(" ", 1)
            txt(draw, x + 690, yy + 2, first, FONT["body"], INK, anchor="lm")
            txt(draw, x + 690, yy + 28, second, FONT["body"], INK, anchor="lm")
        else:
            txt(draw, x + 690, yy + 14, role, FONT["body"], INK, anchor="lm")
        txt(draw, x + 995, yy + 14, row[5], FONT["body"], INK, anchor="lm")
        txt(draw, x + 1230, yy + 14, row[6], FONT["body"], "#9AA7BB", anchor="lm")
        pill(draw, x + 1510, yy - 8, row[7], GREEN, "#DFF7E8", 32, 14)
        bg = "#FFF1C7" if row[9] == AMBER else "#DFF7E8" if row[9] == GREEN else "#FFE2E2" if row[9] == RED else "#EEF2F6"
        pill(draw, x + 1680, yy - 8, row[8], row[9], bg, 32, 14)


def draw_premium():
    base = Image.open(BASE).convert("RGBA")
    draw = ImageDraw.Draw(base)

    draw.rectangle([70, 392, 3055, 2042], fill=BG)

    # 1-4: top polished KPI widgets.
    top_widget(draw, 90, 418, 690, "Active Workforce", "23", "active people", NAVY, "23 employees - 0 contractors", "A")
    top_widget(draw, 810, 418, 690, "HR Work Queue", "0", "open actions", BLUE, "No submitted or in-review changes", "Q")
    top_widget(draw, 1530, 418, 690, "Payroll Ready", "0%", "ready", RED, "0 payroll ready - 2 training current", "P")
    top_widget(draw, 2250, 418, 690, "Exception Risk", "26", "blocking items", RED, "Supervisor 23 - Department 2 - Training 1", "R")

    # 5: rich navy command widget.
    shadow_card(base, 90, 622, 760, 350, 34, NAVY, "#36507C", shadow=(10, 30, 64, 32))
    draw = ImageDraw.Draw(base)
    txt(draw, 130, 674, "Workforce Command", FONT["h2"], "#FFFFFF")
    txt(draw, 130, 712, "Operational pulse for the Employee Master register.", FONT["small"], "#B8C8DF")
    pill(draw, 646, 660, "Live", "#DCEBFF", NAVY_3)
    for i, (label, value, note) in enumerate([("Headcount", "23", "active"), ("Employees", "23", "records"), ("Queue", "0", "open")]):
        xx = 130 + i * 190
        rr(draw, xx, 762, 166, 92, 20, fill=NAVY_2, outline="#3A5483")
        txt(draw, xx + 18, 790, label.upper(), FONT["tiny"], "#AFC0D8", anchor="lm")
        txt(draw, xx + 18, 826, value, FONT["metric_sm"], "#FFFFFF", anchor="lm")
        txt(draw, xx + 76, 824, note, FONT["small"], "#AFC0D8", anchor="lm")
    txt(draw, 130, 900, "Six-month active workforce", FONT["small_sb"], "#DDE8F7")
    sparkline(draw, 388, 888, 230, 44, [23, 23, 23, 23, 23, 23])

    # 6: assignment coverage.
    shadow_card(base, 884, 622, 610, 350, 30, CARD, LINE)
    draw = ImageDraw.Draw(base)
    txt(draw, 924, 674, "Assignment Coverage", FONT["h3"], INK)
    txt(draw, 924, 708, "Completeness across fields that drive reporting and handoffs.", FONT["small"], MUTED)
    row_light(draw, 924, 774, "Department assigned", "21 / 23", 91, GREEN, 230)
    row_light(draw, 924, 832, "Supervisor assigned", "0 / 23", 0, RED, 230)
    row_light(draw, 924, 890, "Site assigned", "0 / 23", 0, AMBER, 230)

    # 7: readiness health.
    shadow_card(base, 1528, 622, 660, 350, 34, NAVY, "#36507C", shadow=(10, 30, 64, 30))
    draw = ImageDraw.Draw(base)
    txt(draw, 1568, 674, "Readiness Health", FONT["h2"], "#FFFFFF")
    txt(draw, 1568, 712, "Payroll readiness with HSE certificate signal rollup.", FONT["small"], "#B8C8DF")
    rr(draw, 1568, 768, 192, 148, 24, fill=NAVY_2, outline="#3A5483")
    donut(draw, 1664, 834, 44, 0, GREEN, "#3D5782", True)
    row_dark(draw, 1810, 780, "Payroll ready", "0", 0, RED, 126)
    row_dark(draw, 1810, 836, "Training current", "2", 9, AMBER, 126)
    row_dark(draw, 1810, 892, "Training expired", "1", 4, RED, 126)

    # 8: org mix and demographics.
    shadow_card(base, 2222, 622, 718, 350, 30, CARD, LINE)
    draw = ImageDraw.Draw(base)
    txt(draw, 2262, 674, "Org Mix & Demographics", FONT["h3"], INK)
    txt(draw, 2262, 708, "Department distribution, worker type, age, and tenure lenses.", FONT["small"], MUTED)
    draw.pieslice([2262, 768, 2396, 902], 0, 225, fill=GREEN)
    draw.pieslice([2262, 768, 2396, 902], 225, 360, fill=BLUE)
    rr(draw, 2304, 810, 50, 50, 25, fill=CARD)
    txt(draw, 2444, 788, "Operations", FONT["small_sb"], INK)
    progress(draw, 2580, 792, 248, 55, GREEN)
    txt(draw, 2444, 840, "Administration", FONT["small_sb"], INK)
    progress(draw, 2580, 844, 248, 45, BLUE)
    x = 2444
    for label in ["Avg age", "Tenure", "Worker type"]:
        x += pill(draw, x, 892, label, NAVY, "#EEF4FF", 30, 12) + 10

    # Register, left of the side rail.
    draw_register(draw, 90, 1018, 2050, 930)

    # 9: dark selected employee widget, beside the table.
    shadow_card(base, 2174, 1018, 766, 430, 34, NAVY, "#36507C", shadow=(10, 30, 64, 32))
    draw = ImageDraw.Draw(base)
    txt(draw, 2214, 1072, "Employee Focus", FONT["h2"], "#FFFFFF")
    txt(draw, 2214, 1110, "Selected record context and next best profile actions.", FONT["small"], "#B8C8DF")
    rr(draw, 2214, 1168, 76, 76, 38, fill="#5872A2", outline="#6F86AE")
    txt(draw, 2252, 1206, "AD", FONT["h3"], "#FFFFFF", anchor="mm")
    txt(draw, 2320, 1179, "Amara Diallo", FONT["h3"], "#FFFFFF")
    pill(draw, 2510, 1176, "Active", "#A6F3C6", "#2B795A", 30, 12)
    txt(draw, 2320, 1218, "EMP-0010 - Field Engineer - Operations", FONT["small"], "#B8C8DF")
    for i, (label, value) in enumerate([("Training", "Due Soon"), ("Supervisor", "Missing"), ("Workflow", "0 open")]):
        xx = 2214 + i * 238
        rr(draw, xx, 1276, 210, 86, 20, fill=NAVY_2, outline="#3A5483")
        txt(draw, xx + 18, 1304, label.upper(), FONT["tiny"], "#AFC0D8", anchor="lm")
        txt(draw, xx + 18, 1338, value, FONT["small_sb"], "#FFFFFF", anchor="lm")
    x = 2214
    for label in ["Request Change", "Change Status", "Open Profile"]:
        x += pill(draw, x, 1390, label, "#FFFFFF", NAVY_3, 36, 18) + 18

    # 10: corporate action queue.
    shadow_card(base, 2174, 1480, 766, 468, 30, CARD, LINE)
    draw = ImageDraw.Draw(base)
    txt(draw, 2214, 1532, "HR Action Queue", FONT["h3"], INK)
    txt(draw, 2214, 1566, "Actionable cleanup tied to Employee Master permissions.", FONT["small"], MUTED)
    actions = [
        ("Assign supervisors", "23 records", RED),
        ("Review departments", "2 records", AMBER),
        ("Open training records", "1 expired", BLUE),
        ("Check payroll readiness", "0 ready", RED),
        ("Prepare Finance handoff", "blocked", VIOLET),
    ]
    for i, (label, value, color) in enumerate(actions):
        action_row(draw, 2214, 1628 + i * 62, label, value, color, 666)

    base.convert("RGB").save(OUT, quality=95)
    return OUT


if __name__ == "__main__":
    print(draw_premium())
