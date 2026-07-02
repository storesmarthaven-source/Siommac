from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


OUT_DIR = Path(__file__).resolve().parent
SCALE = 2
CANVAS = (1920, 1080)


COLORS = {
    "bg": "#F4F7FB",
    "surface": "#FFFFFF",
    "surface_2": "#F8FAFD",
    "line": "#D9E2EE",
    "line_soft": "#E8EEF6",
    "ink": "#172033",
    "muted": "#64748B",
    "muted_2": "#8A97AA",
    "navy": "#14254A",
    "navy_2": "#1B2E58",
    "blue": "#2563EB",
    "blue_soft": "#EAF1FF",
    "green": "#0F9F6E",
    "green_soft": "#E8F7F0",
    "amber": "#B76E00",
    "amber_soft": "#FFF3D6",
    "red": "#B83232",
    "red_soft": "#FDECEC",
    "chip": "#EDF2F7",
}


def font_path(name):
    root = Path("C:/Windows/Fonts")
    candidates = {
        "regular": ["segoeui.ttf", "arial.ttf"],
        "semibold": ["seguisb.ttf", "arialbd.ttf"],
        "bold": ["segoeuib.ttf", "arialbd.ttf"],
    }[name]
    for candidate in candidates:
        p = root / candidate
        if p.exists():
            return str(p)
    return None


def f(size, weight="regular"):
    path = font_path(weight)
    return ImageFont.truetype(path, size * SCALE) if path else ImageFont.load_default()


FONT = {
    "eyebrow": f(13, "bold"),
    "h1": f(34, "bold"),
    "h2": f(25, "bold"),
    "h3": f(19, "bold"),
    "body": f(15, "regular"),
    "body_sb": f(15, "semibold"),
    "small": f(13, "regular"),
    "small_sb": f(13, "semibold"),
    "tiny": f(11, "semibold"),
    "kpi": f(38, "bold"),
    "percent": f(30, "bold"),
}


def sc(v):
    return int(round(v * SCALE))


def box(x, y, w, h):
    return [sc(x), sc(y), sc(x + w), sc(y + h)]


def make_canvas():
    im = Image.new("RGB", (CANVAS[0] * SCALE, CANVAS[1] * SCALE), COLORS["bg"])
    return im, ImageDraw.Draw(im)


def rr(draw, x, y, w, h, r=18, fill=None, outline=None, width=1):
    draw.rounded_rectangle(
        box(x, y, w, h),
        radius=sc(r),
        fill=fill,
        outline=outline,
        width=sc(width) if outline else 1,
    )


def text(draw, x, y, value, font, fill=COLORS["ink"], anchor="la"):
    draw.text((sc(x), sc(y)), value, font=font, fill=fill, anchor=anchor)


def line(draw, xy, fill=COLORS["line"], width=1):
    draw.line([(sc(x), sc(y)) for x, y in xy], fill=fill, width=sc(width))


def chip(draw, x, y, label, fg=COLORS["ink"], bg=COLORS["chip"], h=32, pad=14, bold=False):
    font = FONT["small_sb"] if bold else FONT["small"]
    b = draw.textbbox((0, 0), label, font=font)
    w = (b[2] - b[0]) / SCALE + pad * 2
    rr(draw, x, y, w, h, h / 2, fill=bg)
    text(draw, x + w / 2, y + h / 2 - 1, label, font, fg, anchor="mm")
    return w


def button(draw, x, y, w, h, label, primary=False):
    fill = COLORS["navy"] if primary else COLORS["surface"]
    outline = None if primary else COLORS["line"]
    fg = "#FFFFFF" if primary else COLORS["ink"]
    rr(draw, x, y, w, h, 13, fill=fill, outline=outline)
    text(draw, x + w / 2, y + h / 2 - 1, label, FONT["body_sb"], fg, anchor="mm")


def progress(draw, x, y, w, pct, color=COLORS["blue"], bg="#E5EBF4", h=10):
    rr(draw, x, y, w, h, h / 2, fill=bg)
    rr(draw, x, y, w * max(0, min(100, pct)) / 100, h, h / 2, fill=color)


def mini_line(draw, x, y, w, h, color=COLORS["blue"]):
    pts = [(x, y + h * 0.78), (x + w * 0.22, y + h * 0.64), (x + w * 0.47, y + h * 0.45), (x + w * 0.72, y + h * 0.31), (x + w, y + h * 0.10)]
    line(draw, pts, color, 3)
    line(draw, [(x, y + h), (x + w, y + h)], COLORS["line_soft"], 1)


def mini_bars(draw, x, y, color=COLORS["blue"], muted=False):
    heights = [58, 45, 33, 18]
    for i, h in enumerate(heights):
        fill = "#C9D5E6" if muted else color
        rr(draw, x + i * 28, y + (64 - h), 18, h, 6, fill=fill)


def ring(draw, cx, cy, r, pct, color=COLORS["green"]):
    bbox = [sc(cx - r), sc(cy - r), sc(cx + r), sc(cy + r)]
    draw.arc(bbox, 0, 360, fill="#E3EAF3", width=sc(10))
    draw.arc(bbox, -90, -90 + 360 * pct / 100, fill=color, width=sc(10))
    text(draw, cx, cy, f"{pct}%", FONT["h3"], color, anchor="mm")


def section_header(draw, x, y, title, subtitle):
    text(draw, x, y, title, FONT["h2"])
    text(draw, x, y + 34, subtitle, FONT["body"], COLORS["muted"])


def draw_top(draw, module, title, subtitle, chips, add_label="+ New"):
    rr(draw, 56, 54, 58, 58, 29, fill=COLORS["navy"])
    text(draw, 85, 83, module[:2].upper(), FONT["small_sb"], "#FFFFFF", anchor="mm")
    text(draw, 132, 64, "HR OPERATIONS", FONT["eyebrow"], COLORS["muted"])
    text(draw, 132, 92, title, FONT["h1"])
    text(draw, 132, 136, subtitle, FONT["body"], COLORS["muted"])
    cx = 132
    for label in chips:
        w = chip(draw, cx, 170, label, COLORS["muted"], "#EAF0F7", 30, 13, True)
        cx += w + 8
    button(draw, 1684, 64, 130, 48, "Customize")
    button(draw, 1826, 64, 76, 48, add_label, True)


def kpi_card(draw, x, y, w, title, sub, value, foot, mode="line", color=COLORS["blue"], ring_pct=None):
    rr(draw, x, y, w, 132, 16, fill=COLORS["surface"], outline=COLORS["line"])
    rr(draw, x + 22, y + 24, 42, 42, 11, fill=COLORS["blue_soft"])
    text(draw, x + 43, y + 45, title[:2].upper(), FONT["tiny"], COLORS["blue"], anchor="mm")
    text(draw, x + 82, y + 25, title, FONT["h3"])
    text(draw, x + 82, y + 53, sub, FONT["small"], COLORS["muted"])
    text(draw, x + 24, y + 94, value, FONT["kpi"], COLORS["ink"], anchor="lm")
    text(draw, x + 24, y + 117, foot, FONT["small"], COLORS["muted"], anchor="lm")
    if ring_pct is not None:
        ring(draw, x + w - 68, y + 74, 42, ring_pct, color)
    elif mode == "bars":
        mini_bars(draw, x + w - 128, y + 48, color, muted=color == COLORS["muted"])
    else:
        mini_line(draw, x + w - 150, y + 48, 128, 52, color)


def draw_employee_mockup():
    im, draw = make_canvas()
    draw_top(
        draw,
        "HR",
        "Employee Master",
        "A clean workforce register for identity, assignment, readiness and lifecycle control.",
        ["248 people", "42 contractors", "82% ready", "5 exceptions"],
    )

    y = 232
    kpi_card(draw, 56, y, 432, "Active Workforce", "employees and contractors", "248", "206 employees - 42 contractors", "line", COLORS["blue"])
    kpi_card(draw, 508, y, 432, "HR Work Queue", "changes, documents, status", "14", "3 urgent - 6 change requests", "bars", COLORS["muted"])
    kpi_card(draw, 960, y, 432, "Readiness", "payroll, statutory, training", "82%", "190 payroll ready - 176 training current", "ring", COLORS["green"], 82)
    kpi_card(draw, 1412, y, 432, "Exceptions", "items blocking clean handoff", "5", "statutory gaps - supervisor gaps", "bars", COLORS["red"])

    # Register
    rr(draw, 56, 420, 1188, 612, 18, fill=COLORS["surface"], outline=COLORS["line"])
    section_header(draw, 84, 456, "Workforce Register", "Backend source: app_users enriched with department, site, supervisor, training and payroll readiness.")
    button(draw, 1080, 448, 136, 48, "Onboard", True)
    rr(draw, 84, 528, 430, 50, 12, fill=COLORS["surface_2"], outline=COLORS["line"])
    text(draw, 108, 553, "Search name, employee no, email or position", FONT["body"], COLORS["muted"], anchor="lm")
    x = 538
    for label, active in [("All", True), ("Active", False), ("Contractors", False), ("Exceptions", False)]:
        w = 54 if label == "All" else 94 if label == "Active" else 128 if label == "Contractors" else 120
        button(draw, x, 528, w, 50, label, active)
        x += w + 10
    button(draw, 1062, 528, 154, 50, "Filters")

    table_x, table_y, table_w = 84, 610, 1098
    rr(draw, table_x, table_y, table_w, 46, 0, fill="#F6F8FB")
    headers = [("EMPLOYEE", 16), ("ASSIGNMENT", 300), ("SUPERVISOR", 560), ("READINESS", 720), ("LIFECYCLE", 900)]
    for h, hx in headers:
        text(draw, table_x + hx, table_y + 25, h, FONT["tiny"], COLORS["muted"], anchor="lm")

    rows = [
        ("AR", "Aisha Rampersad", "EMP-1042 - aisha.r@siomac.com", "HSE Officer", "HSE - Point Lisas", "Marcus Lee", [("Payroll ready", "green"), ("Training current", "green")], "Active", "green"),
        ("BC", "Brian Chen", "EMP-0987 - brian.c@siomac.com", "Mechanical Tech", "Operations - Galeota", "Priya Singh", [("Payroll pending", "amber"), ("Training due", "amber")], "Probation", "amber"),
        ("LW", "Leanna Williams", "EMP-0872 - leanna.w@siomac.com", "Payroll Analyst", "Finance - Head Office", "Nadia James", [("Payroll ready", "green"), ("No training", "neutral")], "Active", "green"),
        ("OM", "Omar Mohammed", "EMP-0765 - omar.m@siomac.com", "Field Engineer", "Engineering - Brighton", "Samuel Clarke", [("Payroll blocked", "red"), ("Training expired", "red")], "Suspended", "red"),
        ("DP", "Devika Persad", "EMP-0661 - devika.p@siomac.com", "HR Coordinator", "HR - Head Office", "Unassigned", [("Statutory missing", "red"), ("Training current", "green")], "Active", "green"),
    ]
    chip_styles = {
        "green": (COLORS["green"], COLORS["green_soft"]),
        "amber": (COLORS["amber"], COLORS["amber_soft"]),
        "red": (COLORS["red"], COLORS["red_soft"]),
        "neutral": (COLORS["muted"], COLORS["chip"]),
    }
    avatar_colors = [COLORS["blue"], COLORS["navy_2"], "#334155", "#334155", COLORS["navy"]]
    for i, row in enumerate(rows):
        y0 = table_y + 46 + i * 64
        if i:
            line(draw, [(table_x, y0), (table_x + table_w, y0)], COLORS["line_soft"])
        rr(draw, table_x + 16, y0 + 12, 40, 40, 20, fill=avatar_colors[i])
        text(draw, table_x + 36, y0 + 32, row[0], FONT["small_sb"], "#FFFFFF", anchor="mm")
        text(draw, table_x + 74, y0 + 18, row[1], FONT["body_sb"], COLORS["ink"])
        text(draw, table_x + 74, y0 + 42, row[2], FONT["small"], COLORS["muted"])
        text(draw, table_x + 300, y0 + 18, row[3], FONT["body_sb"], COLORS["ink"])
        text(draw, table_x + 300, y0 + 42, row[4], FONT["small"], COLORS["muted"])
        text(draw, table_x + 560, y0 + 32, row[5], FONT["body_sb"], COLORS["ink"], anchor="lm")
        cy = y0 + 8
        for lab, st in row[6]:
            fg, bg = chip_styles[st]
            chip(draw, table_x + 720, cy, lab, fg, bg, 26, 10, True)
            cy += 28
        fg, bg = chip_styles[row[8]]
        chip(draw, table_x + 900, y0 + 18, row[7], fg, bg, 30, 12, True)
        button(draw, table_x + 1020, y0 + 13, 64, 38, "Open")

    line(draw, [(84, 988), (1182, 988)], COLORS["line_soft"])
    text(draw, 84, 1012, "Showing 1-25 of 248 records", FONT["small"], COLORS["muted"], anchor="lm")
    for i, label in enumerate(["<", "1", "2", "3", "...", "10", ">"]):
        button(draw, 968 + i * 46, 990, 38 if label != "..." else 48, 38, label, label == "1")

    # Selected employee panel
    rr(draw, 1272, 420, 592, 612, 18, fill=COLORS["surface"], outline=COLORS["line"])
    rr(draw, 1272, 420, 592, 132, 18, fill=COLORS["navy"])
    text(draw, 1304, 462, "Selected Employee", FONT["small_sb"], "#CBD5E1")
    text(draw, 1304, 500, "Aisha Rampersad", FONT["h2"], "#FFFFFF")
    text(draw, 1304, 528, "EMP-1042 - HSE Officer - Point Lisas", FONT["small"], "#DDE6F3")
    chip(draw, 1756, 472, "Active", COLORS["green"], "#DDFBEA", 30, 14, True)
    rr(draw, 1304, 578, 60, 60, 30, fill=COLORS["blue"])
    text(draw, 1334, 608, "AR", FONT["small_sb"], "#FFFFFF", anchor="mm")
    text(draw, 1384, 592, "Profile completeness", FONT["small"], COLORS["muted"])
    text(draw, 1384, 632, "92%", FONT["percent"], COLORS["ink"], anchor="lm")
    progress(draw, 1480, 620, 326, 92, COLORS["green"], h=12)

    cards = [
        ("Training", "Current", "12 required / 0 expired", COLORS["green"]),
        ("Payroll", "Ready", "NIS, BIR, TD1 complete", COLORS["green"]),
        ("Workflow", "2 open", "status and document review", COLORS["blue"]),
    ]
    y0 = 680
    for title, value, sub, color in cards:
        rr(draw, 1304, y0, 532, 86, 12, fill=COLORS["surface_2"], outline=COLORS["line"])
        text(draw, 1324, y0 + 26, title, FONT["small"], COLORS["muted"])
        text(draw, 1324, y0 + 60, value, FONT["h3"], color, anchor="lm")
        text(draw, 1460, y0 + 60, sub, FONT["small"], COLORS["muted"], anchor="lm")
        y0 += 100

    x = 1304
    for label, active in [("Overview", True), ("Documents", False), ("Statutory", False), ("Audit", False)]:
        w = 96 if label == "Documents" else 84
        button(draw, x, 990, w, 38, label, active)
        x += w + 10

    return im.resize(CANVAS, Image.Resampling.LANCZOS)


def draw_onboarding_mockup():
    im, draw = make_canvas()
    draw_top(
        draw,
        "ON",
        "Onboarding",
        "A focused case queue for readiness, blockers, task ownership and cross-module handoffs.",
        ["42 active cases", "9 due today", "18 blocked", "78% ready"],
        "+ Case",
    )

    y = 232
    kpi_card(draw, 56, y, 432, "Active Cases", "new hire, transfer, contractor", "42", "28 new hires - 9 transfers - 5 contractors", "line", COLORS["blue"])
    kpi_card(draw, 508, y, 432, "Due This Week", "open tasks due in 7 days", "47", "9 today - 6 overdue - 2 critical", "bars", COLORS["muted"])
    kpi_card(draw, 960, y, 432, "Blocked Cases", "open blocking dependencies", "18", "docs, training, HSE and payroll", "bars", COLORS["red"])
    kpi_card(draw, 1412, y, 432, "Activation", "ready for activation", "78%", "profile 90% - training 71% - access 66%", "ring", COLORS["green"], 78)

    # Queue left
    rr(draw, 56, 420, 772, 612, 18, fill=COLORS["surface"], outline=COLORS["line"])
    section_header(draw, 84, 456, "Priority Case Queue", "Sorted by due date, blocker state and readiness.")
    rr(draw, 84, 528, 326, 50, 12, fill=COLORS["surface_2"], outline=COLORS["line"])
    text(draw, 108, 553, "Search case, employee or package", FONT["body"], COLORS["muted"], anchor="lm")
    x = 428
    for label, fg, bg in [("blocked", COLORS["red"], COLORS["red_soft"]), ("due", COLORS["amber"], COLORS["amber_soft"]), ("ready", COLORS["green"], COLORS["green_soft"])]:
        w = chip(draw, x, 537, label, fg, bg, 32, 14, True)
        x += w + 8

    cases = [
        ("AR", "Aisha Rampersad", "ONB-1042 - Field New Hire", "Jul 05", 68, "In progress", "blue", 2),
        ("RJ", "Renaldo James", "ONB-1043 - Contractor Mobilization", "Jun 29", 34, "Blocked", "red", 3),
        ("MC", "Mei Chen", "ONB-1044 - Office New Hire", "Jul 02", 91, "Ready", "green", 0),
        ("AK", "Alecia Khan", "ONB-1045 - Transfer In", "Jul 08", 48, "Open", "neutral", 0),
        ("BS", "Brian Singh", "ONB-1046 - Rehire", "Jul 10", 22, "Paused", "amber", 1),
    ]
    avatar_colors = [COLORS["blue"], COLORS["navy_2"], "#334155", "#334155", "#334155"]
    status_map = {
        "blue": (COLORS["blue"], COLORS["blue_soft"]),
        "red": (COLORS["red"], COLORS["red_soft"]),
        "green": (COLORS["green"], COLORS["green_soft"]),
        "amber": (COLORS["amber"], COLORS["amber_soft"]),
        "neutral": (COLORS["muted"], COLORS["chip"]),
    }
    for i, (initials, name, meta, due, pct, status, st, blockers) in enumerate(cases):
        y0 = 596 + i * 86
        selected = i == 0
        rr(draw, 84, y0, 712, 74, 12, fill=COLORS["surface_2"] if selected else COLORS["surface"], outline=COLORS["blue"] if selected else COLORS["line"], width=2 if selected else 1)
        rr(draw, 104, y0 + 15, 44, 44, 22, fill=avatar_colors[i])
        text(draw, 126, y0 + 37, initials, FONT["small_sb"], "#FFFFFF", anchor="mm")
        text(draw, 166, y0 + 22, name, FONT["body_sb"], COLORS["ink"])
        text(draw, 166, y0 + 48, meta, FONT["small"], COLORS["muted"])
        text(draw, 488, y0 + 22, "Due", FONT["small"], COLORS["muted"])
        text(draw, 488, y0 + 50, due, FONT["body_sb"], COLORS["ink"])
        progress(draw, 548, y0 + 39, 90, pct, COLORS["blue"], h=10)
        text(draw, 650, y0 + 44, f"{pct}%", FONT["tiny"], COLORS["muted"], anchor="lm")
        fg, bg = status_map[st]
        chip(draw, 690, y0 + 23, status if not blockers else f"{status} ({blockers})", fg, bg, 30, 10, True)

    # Selected case workspace right, using the employee profile dark panel pattern.
    rr(draw, 860, 420, 1004, 612, 18, fill=COLORS["surface"], outline=COLORS["line"])
    rr(draw, 860, 420, 1004, 132, 18, fill=COLORS["navy"])
    text(draw, 892, 462, "Selected Case Workspace", FONT["small_sb"], "#CBD5E1")
    text(draw, 892, 500, "ONB-1042 - Aisha Rampersad", FONT["h2"], "#FFFFFF")
    text(draw, 892, 528, "Field New Hire - Owner S. Rampersad - Due Jul 05", FONT["small"], "#DDE6F3")
    chip(draw, 1710, 472, "In progress", COLORS["blue"], "#E4ECFF", 30, 14, True)

    button(draw, 892, 580, 92, 44, "Pause")
    button(draw, 998, 580, 116, 44, "Mark ready")
    button(draw, 1128, 580, 116, 44, "Complete", True)

    metric_y = 650
    metric_w = 298
    metrics = [
        ("Progress", "68%", "17 done / 25 tasks", COLORS["blue"]),
        ("SLA", "6 days", "target Jul 05", COLORS["amber"]),
        ("Blockers", "2", "1 critical - HSE waiting", COLORS["red"]),
    ]
    for i, (title, value, sub, color) in enumerate(metrics):
        x0 = 892 + i * (metric_w + 24)
        rr(draw, x0, metric_y, metric_w, 102, 14, fill=COLORS["surface_2"], outline=COLORS["line"])
        text(draw, x0 + 20, metric_y + 32, title, FONT["body_sb"], COLORS["ink"])
        text(draw, x0 + 20, metric_y + 72, value, FONT["percent"], color, anchor="lm")
        text(draw, x0 + 132, metric_y + 72, sub, FONT["small"], COLORS["muted"], anchor="lm")

    rr(draw, 892, 780, 940, 78, 12, fill=COLORS["surface_2"], outline=COLORS["line"])
    text(draw, 916, 808, "Readiness Path", FONT["body_sb"], COLORS["ink"])
    path_x, path_y = 916, 842
    steps = [("Profile", COLORS["green"]), ("Docs", COLORS["green"]), ("Training", COLORS["amber"]), ("Access", "#B8C4D4"), ("Payroll", "#B8C4D4"), ("Ready", "#B8C4D4")]
    line(draw, [(path_x + 16, path_y), (path_x + 660, path_y)], COLORS["line"], 4)
    for i, (label, color) in enumerate(steps):
        sx = path_x + i * 132
        rr(draw, sx, path_y - 9, 18, 18, 9, fill=color)
        text(draw, sx, path_y + 26, label, FONT["tiny"], COLORS["muted"], anchor="ma")

    # Bottom split
    rr(draw, 892, 884, 452, 128, 12, fill=COLORS["surface_2"], outline=COLORS["line"])
    text(draw, 916, 916, "Open Work", FONT["body_sb"])
    tasks = [("Safety induction", "HSE", "Blocked", "red"), ("Provision mailbox", "IT", "In progress", "blue"), ("TD1 document", "HR", "Due today", "amber")]
    for i, (task, owner, state, st) in enumerate(tasks):
        y0 = 944 + i * 24
        text(draw, 916, y0, task, FONT["small_sb"], COLORS["ink"], anchor="lm")
        text(draw, 1130, y0, owner, FONT["small"], COLORS["muted"], anchor="lm")
        fg, bg = status_map[st]
        chip(draw, 1202, y0 - 15, state, fg, bg, 26, 9, True)

    rr(draw, 1370, 884, 462, 128, 12, fill=COLORS["surface_2"], outline=COLORS["line"])
    text(draw, 1394, 916, "Handoffs & Audit", FONT["body_sb"])
    handoffs = [("HSE", "Safety induction", "sent", "blue"), ("Payroll", "Enrollment", "pending", "amber"), ("IT", "Account access", "accepted", "green")]
    for i, (owner, item, state, st) in enumerate(handoffs):
        y0 = 942 + i * 24
        rr(draw, 1394, y0 - 9, 22, 12, 6, fill=status_map[st][0])
        text(draw, 1428, y0, owner, FONT["small_sb"], COLORS["ink"], anchor="lm")
        text(draw, 1526, y0, item, FONT["small"], COLORS["muted"], anchor="lm")
        text(draw, 1788, y0, state, FONT["small_sb"], status_map[st][0], anchor="rm")

    return im.resize(CANVAS, Image.Resampling.LANCZOS)


def main():
    employee = draw_employee_mockup()
    onboarding = draw_onboarding_mockup()
    employee.save(OUT_DIR / "hr-employee-master-page-mockup-v5.png", quality=95)
    onboarding.save(OUT_DIR / "hr-onboarding-page-mockup-v7.png", quality=95)


if __name__ == "__main__":
    main()
