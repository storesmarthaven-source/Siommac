from pathlib import Path

from PIL import Image

from generate_hr_clean_mockups import COLORS, FONT, button, chip, line, make_canvas, progress, rr, text


OUT_DIR = Path(__file__).resolve().parent
CANVAS = (1920, 1080)

NAVY = "#172A53"
NAVY_2 = "#223963"
PANEL = "#2B416D"
INK = "#16233D"
MUTED = "#667795"
LINE = "#DDE6F1"
BG = "#F5F8FC"
SURFACE = "#FFFFFF"
SOFT = "#F8FAFD"
RED = "#E03131"
GREEN = "#15935D"
AMBER = "#D98500"
BLUE = "#2F67D8"


def label(draw, x, y, value, fill=MUTED):
    text(draw, x, y, value.upper(), FONT["tiny"], fill)


def small_pill(draw, x, y, value, fg=INK, bg="#EEF3F9"):
    return chip(draw, x, y, value, fg, bg, 28, 12, True)


def icon_box(draw, x, y, letters, fill=NAVY, fg="#FFFFFF"):
    rr(draw, x, y, 56, 56, 16, fill=fill)
    text(draw, x + 28, y + 28, letters, FONT["small_sb"], fg, anchor="mm")


def header(draw, with_user=True):
    icon_box(draw, 56, 76, "HR")
    label(draw, 114, 40, "HR", NAVY)
    text(draw, 114, 72, "Employee Master", FONT["h1"], INK)
    text(draw, 114, 116, "Manage workforce records, employment status, assignments, and HR actions.", FONT["body"], MUTED)
    small_pill(draw, 114, 150, "23 employees", NAVY, "#FFFFFF")
    small_pill(draw, 244, 150, "All sites", NAVY, "#FFFFFF")
    if with_user:
        rr(draw, 1366, 56, 500, 88, 44, fill=NAVY)
        rr(draw, 1390, 70, 58, 58, 29, fill="#D90000")
        text(draw, 1419, 99, "S", FONT["body_sb"], "#FFFFFF", anchor="mm")
        text(draw, 1464, 88, "Super Administrator", FONT["body_sb"], "#FFFFFF")
        text(draw, 1464, 114, "Super Administrator", FONT["small"], "#B8C5DA")
        line(draw, [(1686, 76), (1686, 124)], "#51648A", 1)
        for i, letter in enumerate(["N", "M", "T"]):
            rr(draw, 1710 + i * 64, 72, 56, 56, 28, fill="#31466F")
            text(draw, 1738 + i * 64, 100, letter, FONT["tiny"], "#FFFFFF", anchor="mm")


def stat_card(draw, x, y, w, title, value, subtitle, footer, tone=NAVY, bars=None):
    rr(draw, x, y, w, 260, 16, fill=SURFACE, outline=LINE)
    rr(draw, x, y, w, 58, 16, fill=SOFT, outline=LINE)
    text(draw, x + 26, y + 35, title, FONT["body_sb"], INK, anchor="lm")
    text(draw, x + 26, y + 112, value, FONT["kpi"], tone, anchor="lm")
    text(draw, x + 26, y + 156, subtitle, FONT["body"], MUTED, anchor="lm")
    line(draw, [(x + 26, y + 206), (x + w - 26, y + 206)], "#E7EDF5", 1)
    text(draw, x + 26, y + 232, footer, FONT["small"], MUTED, anchor="lm")
    if bars:
        bx = x + 150
        for i, (label_text, count, color, pct) in enumerate(bars):
            yy = y + 112 + i * 34
            text(draw, bx, yy, label_text, FONT["small"], INK, anchor="lm")
            progress(draw, bx + 126, yy - 5, max(90, w - 292), pct, color, "#E8EEF6", 9)
            text(draw, x + w - 36, yy, str(count), FONT["small_sb"], INK, anchor="rm")


def table(draw, x, y, w, h, selected=False):
    rr(draw, x, y, w, h, 18, fill=SURFACE, outline=LINE)
    rr(draw, x + 22, y + 22, 1080 if w > 1200 else w - 356, 62, 14, fill=SURFACE, outline=LINE)
    text(draw, x + 54, y + 53, "Search employee, email, employee no, position, department...", FONT["body"], "#8A98AD", anchor="lm")
    rr(draw, x + w - 722, y + 22, 180, 62, 14, fill=SURFACE, outline=LINE)
    label(draw, x + w - 700, y + 42, "Status")
    text(draw, x + w - 700, y + 66, "All", FONT["body_sb"], INK, anchor="lm")
    rr(draw, x + w - 520, y + 22, 270, 62, 14, fill=NAVY)
    text(draw, x + w - 385, y + 53, "Advanced filters", FONT["body_sb"], "#FFFFFF", anchor="mm")
    rr(draw, x + w - 230, y + 22, 208, 62, 14, fill="#E50909")
    text(draw, x + w - 126, y + 53, "New Employee", FONT["body_sb"], "#FFFFFF", anchor="mm")

    header_y = y + 110
    line(draw, [(x, header_y), (x + w, header_y)], LINE, 1)
    cols = [
        ("Employee", 24),
        ("Employee No.", 408),
        ("Position / Role", 590),
        ("Department", 792),
        ("Site", 990),
        ("Supervisor", 1172),
        ("Status", 1404),
        ("Training", 1564),
    ]
    for name, dx in cols:
        if dx < w - 60:
            text(draw, x + dx, header_y + 34, name, FONT["small_sb"], INK, anchor="lm")
    rows = [
        ("AD", "Amara Diallo", "amara.diallo@siomac.com", "EMP-0010", "Field Engineer", "Operations", "-", "No supervisor", "Active", "Due Soon"),
        ("CP", "Claudia Pierre", "claudia.pierre@siomac.com", "EMP-0017", "Mechanical Superintendent", "Administration", "-", "No supervisor", "Active", "Current"),
        ("DB", "Damani Baptiste", "mani@siomac.com", "EMP-0021", "Civil Engineer", "Operations", "-", "No supervisor", "Active", "Expired"),
        ("DB", "Darrell Browne", "darrellbrowne@siomac.com", "EMP-0022", "Petroleum Engineer", "Administration", "-", "No supervisor", "Active", "Due Soon"),
        ("DO", "David Okafor", "david.okafor@siomac.com", "EMP-0012", "Project Manager", "Operations", "-", "No supervisor", "Active", "Due Soon"),
        ("DE", "Demo Employee", "", "EMP-0003", "Worker", "Administration", "-", "No supervisor", "Active", "None"),
    ]
    for i, row in enumerate(rows):
        yy = header_y + 70 + i * 80
        if selected and i == 0:
            rr(draw, x, yy - 22, w, 80, 0, fill="#EEF4FF")
        line(draw, [(x, yy + 58), (x + w, yy + 58)], "#E8EEF6", 1)
        rr(draw, x + 24, yy - 6, 44, 44, 22, fill="#E7F0FF", outline="#C9DAF5")
        text(draw, x + 46, yy + 16, row[0], FONT["small_sb"], NAVY, anchor="mm")
        text(draw, x + 84, yy + 4, row[1], FONT["body_sb"], INK)
        text(draw, x + 84, yy + 30, row[2], FONT["small"], MUTED)
        values = [row[3], row[4], row[5], row[6], row[7]]
        positions = [408, 590, 792, 990, 1172]
        for value, dx in zip(values, positions):
            if dx < w - 60:
                text(draw, x + dx, yy + 14, value, FONT["body"], INK if value != "No supervisor" else "#9AA7BB", anchor="lm")
        if 1404 < w - 60:
            small_pill(draw, x + 1404, yy - 2, row[8], GREEN, "#DFF7E8")
        if 1564 < w - 60:
            tone = {"Current": (GREEN, "#DFF7E8"), "Expired": (RED, "#FFE2E2"), "Due Soon": (AMBER, "#FFF1C7"), "None": (MUTED, "#EEF2F6")}[row[9]]
            small_pill(draw, x + 1564, yy - 2, row[9], tone[0], tone[1])


def draw_full_width_mockup():
    im, draw = make_canvas()
    header(draw)
    stat_card(draw, 56, 264, 430, "Active Workforce", "23", "Active people records across all sites", "23 Employees - 0 Contractors - +0 Net")
    stat_card(draw, 520, 264, 430, "HR Work Queue", "0", "Open HR actions requiring review", "Nothing urgent")
    stat_card(draw, 984, 264, 430, "Readiness", "0%", "Payroll, statutory and training readiness", "0 Payroll Ready - 2 Training Current")
    stat_card(
        draw,
        1448,
        264,
        430,
        "Workforce Exceptions",
        "26",
        "Records blocking clean handoff or assignment",
        "Needs action",
        bars=[("Supervisor", 23, RED, 95), ("Department", 2, AMBER, 10), ("Training", 1, BLUE, 5)],
    )
    table(draw, 56, 632, 1822, 430, False)
    return im.resize(CANVAS, Image.Resampling.LANCZOS)


def profile_drawer(draw, x, y, w, h):
    rr(draw, x, y, w, h, 0, fill=NAVY)
    rr(draw, x, y, w, 88, 0, fill="#3A4D76")
    text(draw, x + 28, y + 47, "Employee Profile", FONT["h2"], "#FFFFFF", anchor="lm")
    rr(draw, x + w - 122, y + 22, 44, 44, 10, fill="#4A5D85", outline="#62759B")
    text(draw, x + w - 100, y + 44, "...", FONT["body_sb"], "#FFFFFF", anchor="mm")
    rr(draw, x + w - 66, y + 22, 44, 44, 10, fill="#4A5D85", outline="#62759B")
    text(draw, x + w - 44, y + 43, "x", FONT["body_sb"], "#FFFFFF", anchor="mm")

    rr(draw, x + 28, y + 118, 82, 82, 41, fill="#58709A", outline="#6F86AE")
    text(draw, x + 69, y + 159, "AD", FONT["h3"], "#FFFFFF", anchor="mm")
    text(draw, x + 132, y + 134, "Amara Diallo", FONT["h2"], "#FFFFFF")
    text(draw, x + 132, y + 174, "EMP-0010", FONT["body_sb"], "#B8C5DA")
    small_pill(draw, x + 318, y + 158, "Active", "#A6F3C6", "#2B795A")
    text(draw, x + 132, y + 214, "Field Engineer  -  Operations", FONT["body"], "#AAB8CF")

    rr(draw, x + 28, y + 260, w - 56, 116, 14, fill=PANEL, outline="#455A83")
    metric_cells = [("Training", "None"), ("Supervisor", "-"), ("Open Workflows", "0 open")]
    for i, (k, v) in enumerate(metric_cells):
        cx = x + 50 + i * ((w - 100) / 3)
        label(draw, cx, y + 294, k, "#B8C5DA")
        text(draw, cx, y + 332, v, FONT["body_sb"], "#FFFFFF", anchor="lm")
        if i:
            line(draw, [(cx - 28, y + 260), (cx - 28, y + 376)], "#4C6088", 1)

    for i, (label_text, fill, outline) in enumerate([
        ("Request Change", "#44597F", "#63769D"),
        ("Change Status", "#152744", "#405173"),
        ("More", "#152744", "#405173"),
    ]):
        bx = x + 28 + i * ((w - 72) / 3)
        rr(draw, bx, y + 404, (w - 96) / 3, 58, 10, fill=fill, outline=outline)
        text(draw, bx + ((w - 96) / 6), y + 433, label_text, FONT["body_sb"], "#FFFFFF", anchor="mm")

    tabs = ["Overview", "Employment", "Assignments", "Documents", "Timeline", "More"]
    tx = x + 28
    for i, tab in enumerate(tabs):
        col = "#FFFFFF" if i == 0 else "#9EABC2"
        text(draw, tx, y + 516, tab, FONT["body_sb"], col)
        if i == 0:
            line(draw, [(tx, y + 538), (tx + 78, y + 538)], "#58A6FF", 4)
        tx += 104 if tab not in ("Assignments", "Documents") else 126

    rr(draw, x + 28, y + 568, w - 56, 382, 14, fill="#2E436E", outline="#465C87")
    text(draw, x + 56, y + 622, "Personal Summary", FONT["h3"], "#FFFFFF")
    button(draw, x + w - 184, y + 594, 132, 44, "Edit Contact")
    fields = [
        ("Full Name", "Amara Diallo"),
        ("Email", "amara.diallo@siomac.com"),
        ("Phone", "(868) 752-2123"),
        ("Employee No.", "EMP-0010"),
        ("Personal Email", "ervinbaptiste@gmail.com"),
        ("Date of Birth", "Feb 18, 1989"),
        ("Nationality", "Guinean"),
    ]
    for i, (k, v) in enumerate(fields):
        yy = y + 674 + i * 40
        text(draw, x + 86, yy, k, FONT["body_sb"], "#AAB8CF", anchor="lm")
        text(draw, x + 288, yy, v, FONT["body_sb"], "#FFFFFF", anchor="lm")

    rr(draw, x + 28, y + 974, w - 56, 150, 14, fill="#2E436E", outline="#465C87")
    text(draw, x + 56, y + 1028, "Current Assignment", FONT["h3"], "#FFFFFF")


def draw_selected_profile_mockup():
    im, draw = make_canvas()
    header(draw, with_user=False)
    stat_card(draw, 56, 264, 430, "Active Workforce", "23", "Active people records across all sites", "23 Employees - 0 Contractors - +0 Net")
    stat_card(draw, 520, 264, 430, "HR Work Queue", "0", "Open HR actions requiring review", "Nothing urgent")
    stat_card(draw, 984, 264, 430, "Readiness", "0%", "Payroll, statutory and training readiness", "0 Payroll Ready - 2 Training Current")
    table(draw, 56, 632, 1220, 430, True)
    rr(draw, 1200, 0, 160, 1080, 0, fill="#FFFFFF")
    for i in range(160):
        alpha = i / 160
        shade = int(255 - alpha * 18)
        line(draw, [(1200 + i, 0), (1200 + i, 1080)], f"#{shade:02x}{shade:02x}{shade:02x}", 1)
    profile_drawer(draw, 1240, 0, 680, 1080)
    return im.resize(CANVAS, Image.Resampling.LANCZOS)


def compact_stat(draw, x, y, w, h, title, value, note, tone=NAVY):
    rr(draw, x, y, w, h, 16, fill=SURFACE, outline=LINE)
    text(draw, x + 22, y + 30, title, FONT["body_sb"], INK)
    text(draw, x + 22, y + 82, value, FONT["kpi"], tone, anchor="lm")
    text(draw, x + 22, y + h - 30, note, FONT["small"], MUTED, anchor="lm")


def widget_header(draw, x, y, title, subtitle=None, action=None):
    text(draw, x, y, title, FONT["h3"], INK)
    if subtitle:
        text(draw, x, y + 28, subtitle, FONT["small"], MUTED)
    if action:
        small_pill(draw, x + 300, y - 6, action, NAVY, "#EDF3FB")


def priority_row(draw, x, y, label_text, value, tone, pct=None):
    color = {"red": RED, "amber": AMBER, "green": GREEN, "blue": BLUE, "muted": MUTED}[tone]
    rr(draw, x, y + 3, 10, 10, 5, fill=color)
    text(draw, x + 20, y + 9, label_text, FONT["small_sb"], INK, anchor="lm")
    text(draw, x + 250, y + 9, value, FONT["small_sb"], color, anchor="rm")
    if pct is not None:
        progress(draw, x + 274, y + 4, 160, pct, color, "#E8EEF6", 8)


def draw_widget_board_mockup():
    im, draw = make_canvas()
    header(draw)

    # Small existing headline KPIs stay, but reduced so the useful widgets carry the page.
    compact_stat(draw, 56, 236, 260, 148, "Active Workforce", "23", "23 employees - 0 contractors")
    compact_stat(draw, 336, 236, 260, 148, "Open HR Work", "0", "No pending HR actions")
    compact_stat(draw, 616, 236, 260, 148, "Readiness", "0%", "Payroll and training not ready")
    compact_stat(draw, 896, 236, 260, 148, "Exceptions", "26", "26 records need cleanup", RED)

    # Primary operational widget.
    rr(draw, 56, 420, 700, 300, 18, fill=SURFACE, outline=LINE)
    widget_header(draw, 84, 452, "Workforce Exception Center", "What prevents a clean handoff to payroll, sites, and supervisors.", "current data")
    text(draw, 84, 560, "26", FONT["kpi"], RED, anchor="lm")
    text(draw, 170, 560, "total blockers", FONT["body_sb"], INK, anchor="lm")
    priority_row(draw, 84, 616, "Missing supervisor", "23", "red", 96)
    priority_row(draw, 84, 652, "Missing department", "2", "amber", 12)
    priority_row(draw, 84, 688, "Training status issue", "1", "blue", 6)
    rr(draw, 548, 526, 160, 134, 14, fill="#FFF5F5", outline="#FFD6D6")
    text(draw, 628, 574, "23", FONT["percent"], RED, anchor="mm")
    text(draw, 628, 610, "records blocked", FONT["small_sb"], INK, anchor="mm")
    text(draw, 628, 636, "by supervisor gaps", FONT["small"], MUTED, anchor="mm")

    # Assignment quality.
    rr(draw, 784, 420, 456, 300, 18, fill=SURFACE, outline=LINE)
    widget_header(draw, 812, 452, "Assignment Coverage", "Completeness by core HR fields.", "table fields")
    priority_row(draw, 812, 536, "Department assigned", "21 / 23", "green", 91)
    priority_row(draw, 812, 580, "Supervisor assigned", "0 / 23", "red", 0)
    priority_row(draw, 812, 624, "Site assigned", "0 / 23", "amber", 0)
    priority_row(draw, 812, 668, "Role assigned", "23 / 23", "green", 100)

    # Readiness and compliance.
    rr(draw, 1268, 420, 596, 300, 18, fill=SURFACE, outline=LINE)
    widget_header(draw, 1296, 452, "Readiness Breakdown", "Payroll, training, and statutory readiness by action type.", "wire later")
    for i, (name, value, tone, pct) in enumerate([
        ("Payroll ready", "0 people", "red", 0),
        ("Training current", "2 people", "amber", 9),
        ("Training due soon", "4 people", "amber", 18),
        ("Training expired", "1 person", "red", 5),
    ]):
        priority_row(draw, 1296, 536 + i * 42, name, value, tone, pct)

    # Action queue.
    rr(draw, 56, 748, 520, 284, 18, fill=SURFACE, outline=LINE)
    widget_header(draw, 84, 780, "Suggested Cleanup Queue", "Ranked work HR can act on from this page.", "new widget")
    queue = [
        ("Assign supervisors", "23 records", "red"),
        ("Confirm site assignments", "23 records", "amber"),
        ("Review due-soon training", "4 records", "amber"),
        ("Verify expired training", "1 record", "red"),
    ]
    for i, (name, value, tone) in enumerate(queue):
        yy = 852 + i * 42
        priority_row(draw, 84, yy, name, value, tone)
        rr(draw, 424, yy - 6, 104, 28, 14, fill="#F5F8FC", outline=LINE)
        text(draw, 476, yy + 8, "Open", FONT["small_sb"], NAVY, anchor="mm")

    # Lifecycle.
    rr(draw, 604, 748, 408, 284, 18, fill=SURFACE, outline=LINE)
    widget_header(draw, 632, 780, "Lifecycle Watch", "Starts, probation, status changes, and exits.", "new widget")
    lifecycle = [("New starts", "0"), ("Probation ending", "0"), ("Status changes", "0"), ("Inactive / exit", "0")]
    for i, (name, value) in enumerate(lifecycle):
        cx = 632 + (i % 2) * 186
        cy = 850 + (i // 2) * 78
        text(draw, cx, cy, value, FONT["percent"], INK, anchor="lm")
        text(draw, cx + 56, cy, name, FONT["small"], MUTED, anchor="lm")

    # People movement / feed.
    rr(draw, 1040, 748, 824, 284, 18, fill=SURFACE, outline=LINE)
    widget_header(draw, 1068, 780, "People Signals", "Useful page-level history once audit/workflow events are connected.", "wire later")
    feed = [
        ("Profile opened", "Amara Diallo selected from Employee Master", "blue"),
        ("Training due soon", "4 active employees need renewal planning", "amber"),
        ("Supervisor cleanup", "No active employee has a supervisor assigned", "red"),
        ("Readiness handoff", "Payroll readiness can be added as a Finance handoff widget", "green"),
    ]
    for i, (primary, secondary, tone) in enumerate(feed):
        yy = 848 + i * 42
        color = {"blue": BLUE, "amber": AMBER, "red": RED, "green": GREEN}[tone]
        rr(draw, 1068, yy, 12, 12, 6, fill=color)
        text(draw, 1090, yy - 2, primary, FONT["small_sb"], INK)
        text(draw, 1296, yy - 2, secondary, FONT["small"], MUTED)

    # Table anchor below the board.
    rr(draw, 56, 1048, 1808, 26, 10, fill="#EEF3F9", outline=LINE)
    text(draw, 80, 1061, "Existing employee table continues below the widget board; row click still opens the current dark profile drawer.", FONT["small_sb"], MUTED, anchor="lm")
    return im.resize(CANVAS, Image.Resampling.LANCZOS)


def main():
    draw_full_width_mockup().save(OUT_DIR / "hr-employee-master-refined-full-width.png", quality=95)
    draw_selected_profile_mockup().save(OUT_DIR / "hr-employee-master-refined-profile-open.png", quality=95)
    draw_widget_board_mockup().save(OUT_DIR / "hr-employee-master-widget-board-mockup.png", quality=95)


if __name__ == "__main__":
    main()
