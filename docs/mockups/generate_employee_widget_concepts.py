from pathlib import Path

from PIL import Image

from generate_hr_clean_mockups import (
    CANVAS,
    COLORS,
    FONT,
    button,
    chip,
    line,
    make_canvas,
    mini_bars,
    mini_line,
    progress,
    ring,
    rr,
    text,
)


OUT_DIR = Path(__file__).resolve().parent


def tag(draw, x, y, label, kind="now"):
    if kind == "future":
        return chip(draw, x, y, label, COLORS["muted"], COLORS["chip"], 26, 10, True)
    return chip(draw, x, y, label, COLORS["green"], COLORS["green_soft"], 26, 10, True)


def card_title(draw, x, y, title, subtitle, source=None):
    text(draw, x, y, title, FONT["h3"], COLORS["ink"])
    text(draw, x, y + 26, subtitle, FONT["small"], COLORS["muted"])
    if source:
        tag(draw, x, y + 54, source[0], source[1])


def summary_card(draw, x, y, w, title, value, subtitle, source, mode="line", tone=COLORS["blue"]):
    rr(draw, x, y, w, 150, 16, fill=COLORS["surface"], outline=COLORS["line"])
    text(draw, x + 22, y + 30, title, FONT["body_sb"], COLORS["ink"])
    tag(draw, x + w - 102, y + 22, source[0], source[1])
    text(draw, x + 22, y + 86, value, FONT["kpi"], tone, anchor="lm")
    text(draw, x + 22, y + 124, subtitle, FONT["small"], COLORS["muted"], anchor="lm")
    if mode == "ring":
        ring(draw, x + w - 76, y + 86, 42, int(str(value).replace("%", "")), COLORS["green"])
    elif mode == "bars":
        mini_bars(draw, x + w - 136, y + 58, tone)
    else:
        mini_line(draw, x + w - 160, y + 66, 132, 50, tone)


def small_row(draw, x, y, label, value, tone="muted", pct=None):
    tone_map = {
        "green": COLORS["green"],
        "amber": COLORS["amber"],
        "red": COLORS["red"],
        "blue": COLORS["blue"],
        "muted": COLORS["muted"],
    }
    color = tone_map[tone]
    rr(draw, x, y, 12, 12, 6, fill=color)
    text(draw, x + 22, y + 7, label, FONT["small_sb"], COLORS["ink"], anchor="lm")
    text(draw, x + 264, y + 7, value, FONT["small_sb"], color, anchor="rm")
    if pct is not None:
        progress(draw, x + 282, y + 2, 150, pct, color, h=9)


def readiness_command_center(draw):
    x, y, w, h = 56, 420, 1160, 350
    rr(draw, x, y, w, h, 18, fill=COLORS["surface"], outline=COLORS["line"])
    card_title(
        draw,
        x + 28,
        y + 30,
        "Readiness Command Center",
        "One place to see whether people can be safely handed to payroll, site and systems.",
        ("Composite", "future"),
    )
    button(draw, x + w - 154, y + 26, 122, 42, "Open queue")

    # Left score
    rr(draw, x + 28, y + 104, 250, 206, 14, fill=COLORS["navy"])
    text(draw, x + 52, y + 136, "Workforce ready", FONT["small_sb"], "#CBD5E1")
    text(draw, x + 52, y + 198, "82%", FONT["kpi"], "#FFFFFF", anchor="lm")
    text(draw, x + 52, y + 232, "190 payroll ready", FONT["small"], "#CBD5E1", anchor="lm")
    text(draw, x + 52, y + 256, "176 training current", FONT["small"], "#CBD5E1", anchor="lm")
    progress(draw, x + 52, y + 284, 176, 82, "#FFFFFF", "#425578", 11)

    # Readiness lanes
    lanes = [
        ("Payroll", "190 ready", 82, "green"),
        ("Training", "176 current", 71, "amber"),
        ("Statutory", "23 missing", 88, "green"),
        ("Documents", "12 need review", 64, "amber"),
        ("Access", "8 pending", 76, "blue"),
    ]
    lx, ly = x + 316, y + 116
    for i, (label, value, pct, tone) in enumerate(lanes):
        row_y = ly + i * 42
        text(draw, lx, row_y, label, FONT["body_sb"], COLORS["ink"])
        text(draw, lx + 160, row_y, value, FONT["small"], COLORS["muted"])
        color = {"green": COLORS["green"], "amber": COLORS["amber"], "blue": COLORS["blue"]}[tone]
        progress(draw, lx + 292, row_y + 5, 230, pct, color, h=10)
        text(draw, lx + 536, row_y + 10, f"{pct}%", FONT["small_sb"], color, anchor="rm")

    # Escalation strip
    rr(draw, x + 866, y + 110, 254, 200, 14, fill=COLORS["surface_2"], outline=COLORS["line"])
    text(draw, x + 890, y + 140, "Next actions", FONT["body_sb"], COLORS["ink"])
    actions = [
        ("Resolve payroll blockers", "5", "red"),
        ("Review expiring training", "11", "amber"),
        ("Assign supervisors", "2", "red"),
        ("Verify statutory updates", "7", "blue"),
    ]
    tone_map = {"red": COLORS["red"], "amber": COLORS["amber"], "blue": COLORS["blue"]}
    for i, (label, value, tone_name) in enumerate(actions):
        row_y = y + 178 + i * 32
        color = tone_map[tone_name]
        rr(draw, x + 890, row_y, 12, 12, 6, fill=color)
        text(draw, x + 912, row_y + 7, label, FONT["small_sb"], COLORS["ink"], anchor="lm")
        text(draw, x + 1098, row_y + 7, value, FONT["small_sb"], color, anchor="rm")


def lifecycle_watch(draw):
    x, y, w, h = 1244, 420, 620, 164
    rr(draw, x, y, w, h, 18, fill=COLORS["surface"], outline=COLORS["line"])
    card_title(draw, x + 24, y + 26, "Lifecycle Watch", "Starters, probation, contracts and exits in the next 30 days.", ("New API", "future"))
    stats = [("8", "new starts"), ("6", "probation"), ("4", "contracts"), ("2", "exits")]
    for i, (value, label) in enumerate(stats):
        sx = x + 24 + i * 142
        text(draw, sx, y + 112, value, FONT["percent"], COLORS["ink"], anchor="lm")
        text(draw, sx + 48, y + 112, label, FONT["small"], COLORS["muted"], anchor="lm")


def org_coverage(draw):
    x, y, w, h = 1244, 606, 620, 164
    rr(draw, x, y, w, h, 18, fill=COLORS["surface"], outline=COLORS["line"])
    card_title(draw, x + 24, y + 26, "Org Coverage", "Department, site and supervisor completeness.", ("List data", "now"))
    rows = [
        ("Department assigned", "96%", "green", 96),
        ("Site assigned", "93%", "green", 93),
        ("Supervisor assigned", "89%", "amber", 89),
    ]
    for i, row in enumerate(rows):
        small_row(draw, x + 24, y + 96 + i * 34, row[0], row[1], row[2], row[3])


def exception_workbench(draw):
    x, y, w, h = 56, 800, 570, 198
    rr(draw, x, y, w, h, 18, fill=COLORS["surface"], outline=COLORS["line"])
    card_title(draw, x + 24, y + 24, "Exception Workbench", "Actionable record gaps, ranked by operational risk.", ("Stats", "now"))
    items = [
        ("Payroll blocked", "5 people", "red"),
        ("No supervisor", "2 people", "red"),
        ("Training expired", "4 people", "amber"),
        ("Missing department", "1 person", "amber"),
    ]
    for i, row in enumerate(items):
        small_row(draw, x + 24, y + 98 + i * 28, row[0], row[1], row[2])


def document_watch(draw):
    x, y, w, h = 654, 800, 570, 198
    rr(draw, x, y, w, h, 18, fill=COLORS["surface"], outline=COLORS["line"])
    card_title(draw, x + 24, y + 24, "Documents & Statutory", "Verification load, expiring documents and payroll blockers.", ("New API", "future"))
    rows = [
        ("Pending verification", "12", "blue", 68),
        ("Expiring in 30 days", "9", "amber", 42),
        ("Missing statutory", "7", "red", 30),
    ]
    for i, row in enumerate(rows):
        small_row(draw, x + 24, y + 104 + i * 34, row[0], row[1], row[2], row[3])


def movement_feed(draw):
    x, y, w, h = 1252, 800, 612, 198
    rr(draw, x, y, w, h, 18, fill=COLORS["surface"], outline=COLORS["line"])
    card_title(draw, x + 24, y + 24, "People Signals", "Recent HR changes and downstream handoff triggers.", ("Audit", "future"))
    feed = [
        ("Status change requested", "O. Mohammed - submitted 2h ago", "amber"),
        ("Payroll-ready event", "A. Rampersad - sent to Finance", "green"),
        ("Transfer pending", "R. James - needs supervisor approval", "blue"),
    ]
    for i, (primary, secondary, tone) in enumerate(feed):
        yy = y + 94 + i * 34
        color = {"green": COLORS["green"], "amber": COLORS["amber"], "blue": COLORS["blue"]}[tone]
        rr(draw, x + 24, yy, 12, 12, 6, fill=color)
        text(draw, x + 46, yy + 2, primary, FONT["small_sb"], COLORS["ink"])
        text(draw, x + 220, yy + 2, secondary, FONT["small"], COLORS["muted"])


def draw_mockup():
    im, draw = make_canvas()

    # Header
    rr(draw, 56, 54, 58, 58, 29, fill=COLORS["navy"])
    text(draw, 85, 83, "HR", FONT["small_sb"], "#FFFFFF", anchor="mm")
    text(draw, 132, 64, "EMPLOYEE MASTER", FONT["eyebrow"], COLORS["muted"])
    text(draw, 132, 96, "Page-Level Widget Concepts", FONT["h1"], COLORS["ink"])
    text(draw, 132, 140, "The existing register and profile drawer stay intact. These widgets add operational intelligence above the table.", FONT["body"], COLORS["muted"])
    chip(draw, 132, 170, "designed for widget board", COLORS["muted"], "#EAF0F7", 30, 13, True)
    chip(draw, 342, 170, "some require new summaries", COLORS["muted"], "#EAF0F7", 30, 13, True)
    button(draw, 1684, 64, 130, 48, "Customize")
    button(draw, 1826, 64, 76, 48, "+ New", True)

    y = 232
    summary_card(draw, 56, y, 432, "Workforce Snapshot", "248", "206 employees - 42 contractors - +8 net", ("Now", "now"))
    summary_card(draw, 508, y, 432, "Readiness Index", "82%", "Payroll, statutory and training readiness", ("Now", "now"), "ring", COLORS["green"])
    summary_card(draw, 960, y, 432, "Exception Triage", "5", "Supervisor, department, payroll and training gaps", ("Now", "now"), "bars", COLORS["red"])
    summary_card(draw, 1412, y, 432, "HR Action Queue", "14", "3 urgent - status, documents and changes", ("New API", "future"), "bars", COLORS["muted"])

    readiness_command_center(draw)
    lifecycle_watch(draw)
    org_coverage(draw)
    exception_workbench(draw)
    document_watch(draw)
    movement_feed(draw)

    rr(draw, 56, 1022, 1808, 38, 12, fill="#EEF3F9", outline=COLORS["line"])
    text(draw, 80, 1041, "Existing Employee Register widget continues below this intelligence layer. Existing profile drawer opens from row click.", FONT["small_sb"], COLORS["muted"], anchor="lm")

    return im.resize(CANVAS, Image.Resampling.LANCZOS)


def main():
    draw_mockup().save(OUT_DIR / "hr-employee-master-widget-concepts-v3.png", quality=95)


if __name__ == "__main__":
    main()
