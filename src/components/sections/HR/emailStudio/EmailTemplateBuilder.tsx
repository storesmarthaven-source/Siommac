import {
  createContext,
  type TargetedDragEvent,
  type TargetedEvent,
  type VNode,
} from "preact";
import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { Button, Spinner, StatusPill } from "@ui";
import { dialog } from "@lib/dialog";
import { LucideIcon, type LucideName } from "@ui/LucideIcon";
import {
  useCreateSavedSection,
  useDeleteSavedSection,
  useSavedSections,
  useUpdateEmailChrome,
  useUpdateEmailTemplateDraft,
} from "@api/hr/emailTemplates";
import { uploadEmailTemplateAsset } from "@api/hr/emailTemplateAssets";
import { compileEmailDocument } from "@lib/emailMjmlCompiler";
import {
  EMAIL_ICON_CHOICES,
  EMAIL_ICON_COLOR_CHOICES,
  emailIconHex,
  normalizeEmailIconColor,
} from "@lib/emailIcons";
import {
  cloneEmailBlock,
  applyDocumentTypography,
  EMAIL_FONT_STACK,
  applyPageGutter,
  createCallToActionSection,
  createFirstDayOverviewSection,
  createBlankEmailDocument,
  createEmailBlock,
  createEmailSection,
  extractEmailChrome,
  DEFAULT_FOOTER_LINKS,
  DEFAULT_REPLY_NOTICE,
  EMAIL_BLOCK_DEFINITIONS,
  isEmailContainer,
  normalizeEmailDocument,
  renderEmailPreview,
  applySampleVariables,
  SAMPLE_VARIABLES,
  SAMPLE_PROFILE_PHOTO,
  sanitizeRichText,
} from "@lib/emailTemplateDocument";
import type {
  EmailBlockStyles,
  EmailFactTile,
  EmailStatusItem,
  EmailTypographyScale,
  EmailBlockType,
  EmailChromeRole,
  EmailEditorSchema,
  EmailTemplateBlock,
  EmailTemplateDraft,
  EmailTextAlign,
  EmailVerticalAlign,
} from "../../../../../types/emailTemplates";
import "./emailTemplateBuilder.css";

interface Props {
  template: EmailTemplateDraft;
  onBack: () => void;
  onToast: (message: string) => void;
  onCreateEditableCopy?: () => void;
  creatingEditableCopy?: boolean;
}

type SaveState = "saved" | "unsaved" | "saving" | "failed";
type PreviewMode = "desktop" | "mobile";
type LeftTab = "content" | "layout" | "variables" | "structure";
const EMAIL_FONT_SIZE_PRESETS = [10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64] as const;

const BLOCK_MIME = "application/x-siomac-email-block";
const EXISTING_MIME = "application/x-siomac-email-existing";
const GROUPS = ["Basics", "Media", "Actions"] as const;
const VARIABLES = [
  ["Recipient first name", "{{recipient.firstName}}"],
  ["Recipient full name", "{{recipient.fullName}}"],
  ["Company name", "{{company.name}}"],
  ["Employee job title", "{{employee.jobTitle}}"],
  ["Employee department", "{{employee.department}}"],
  ["Start date", "{{employee.startDate}}"],
  ["Manager name", "{{manager.fullName}}"],
  ["Work location", "{{employee.workLocation}}"],
  ["Support email", "{{support.email}}"],
] as const;
const TRANSACTIONAL_DETAILS: Partial<
  Record<EmailBlockType, { purpose: string; source: string; bestFor: string }>
> = {
  welcome_header: {
    purpose: "Greets the recipient with a personalised, branded introduction.",
    source: "Company profile and recipient name.",
    bestFor: "The opening of welcome and invitation messages.",
  },
  employee_details: {
    purpose:
      "Confirms the employee identity, role, and department used by the workflow.",
    source: "The current Employee Master record.",
    bestFor:
      "Helping recipients verify that the email concerns the correct assignment.",
  },
  manager_contact: {
    purpose:
      "Shows the accountable manager and their approved contact details.",
    source: "The employee assignment and manager profile.",
    bestFor: "First-day instructions and escalation guidance.",
  },
  start_date_summary: {
    purpose: "Presents the confirmed start date, time, and work location.",
    source: "The active onboarding case.",
    bestFor: "Welcome messages and pre-arrival reminders.",
  },
  pending_tasks: {
    purpose: "Lists the recipient’s outstanding onboarding actions.",
    source: "Open onboarding tasks visible to the recipient.",
    bestFor: "Reminder and follow-up messages.",
  },
  required_documents: {
    purpose:
      "Lists documents that are still required without exposing restricted files.",
    source: "Document requirements and authorised document health.",
    bestFor: "Evidence request and compliance reminder messages.",
  },
  training_assignments: {
    purpose: "Summarises training that must be completed.",
    source: "Active training assignments for the onboarding case.",
    bestFor: "Orientation and learning reminders.",
  },
  equipment_ppe: {
    purpose: "Shows assigned equipment and PPE preparation.",
    source: "Approved equipment and PPE handoffs.",
    bestFor: "Day-one logistics and collection instructions.",
  },
  invitation_action: {
    purpose: "Provides the secure, single-use account setup action.",
    source: "A server-issued invitation URL at send time.",
    bestFor: "Worker portal and user account invitations.",
  },
  invitation_expiry: {
    purpose: "Explains when the secure invitation will expire.",
    source: "The server-issued invitation expiry.",
    bestFor: "Invitation messages where time limits must be clear.",
  },
  security_notice: {
    purpose: "Gives recipients concise account-safety guidance.",
    source: "Approved SIOMAC security copy.",
    bestFor: "Any message containing a secure account action.",
  },
  support_contact: {
    purpose: "Provides the approved support route if the recipient needs help.",
    source: "Organisation support settings.",
    bestFor: "Footers and task reminders.",
  },
  legal_footer: {
    purpose:
      "Displays the organisation identity and required transactional-email notice.",
    source: "The legal employer profile.",
    bestFor: "The final section of every operational email.",
  },
};
const TRANSACTIONAL_CARD_COPY: Partial<Record<EmailBlockType, string>> = {
  welcome_header: "Welcome to SIOMAC, Damani",
  employee_details: "Damani Baptiste · Project Manager",
  manager_contact: "Your manager · Amara Diallo",
  start_date_summary: "17 August · 8:00 AM",
  pending_tasks: "2 onboarding tasks need your attention",
  required_documents: "Proof of address is still required",
  training_assignments: "Workplace orientation · Due soon",
  equipment_ppe: "Laptop and access badge prepared",
  invitation_action: "Set up your account",
  invitation_expiry: "Secure link expires 14 August",
  security_notice: "Protect your account details",
  support_contact: "People Operations can help",
  legal_footer: "Siddim Integrated O&M Limited",
};
const ICON_LIST_OPTIONS = [
  "Mail",
  "Phone",
  "MapPin",
  "CalendarDays",
  "UserRound",
  "CheckCircle",
  "Clock3",
  "ShieldCheck",
] as const;

function TransactionalCardArt({
  type,
  icon,
  copy,
}: {
  type: EmailBlockType;
  icon: string;
  copy: string;
}): VNode {
  const profileInitials = type === "manager_contact" ? "AD" : "DB";
  if (type === "employee_details" || type === "manager_contact") {
    return (
      <span class="etb-library-card-art etb-library-card-art-profile">
        <span class="etb-library-mini-avatar">{profileInitials}</span>
        <span class="etb-library-mini-copy">
          <b>
            {type === "manager_contact" ? "Amara Diallo" : "Damani Baptiste"}
          </b>
          <em>
            {type === "manager_contact" ? "Case manager" : "Project Manager"}
          </em>
        </span>
      </span>
    );
  }
  if (type === "start_date_summary") {
    return (
      <span class="etb-library-card-art etb-library-card-art-date">
        <span class="etb-library-mini-date">
          <small>Aug</small>
          <b>17</b>
        </span>
        <span class="etb-library-mini-copy">
          <b>Monday</b>
          <em>8:00 AM · Head Office</em>
        </span>
      </span>
    );
  }
  if (
    type === "pending_tasks" ||
    type === "required_documents" ||
    type === "training_assignments" ||
    type === "equipment_ppe"
  ) {
    return (
      <span class="etb-library-card-art etb-library-card-art-list">
        <span class="etb-library-list-heading">
          <i class={`fas ${icon}`} />
          <b>
            {type === "required_documents"
              ? "Documents"
              : type === "equipment_ppe"
                ? "Equipment"
                : type === "training_assignments"
                  ? "Training"
                  : "Your tasks"}
          </b>
        </span>
        <span class="etb-library-mini-row">
          <i />
          <em>{copy}</em>
        </span>
        <span class="etb-library-mini-row muted">
          <i />
          <em>
            {type === "required_documents"
              ? "Photo identification"
              : "Next required action"}
          </em>
        </span>
      </span>
    );
  }
  if (type === "invitation_action") {
    return (
      <span class="etb-library-card-art etb-library-card-art-action">
        <LucideIcon name="MailCheck" size={17} />
        <b>Account invitation</b>
        <span>Set up account</span>
      </span>
    );
  }
  if (type === "legal_footer") {
    return (
      <span class="etb-library-card-art etb-library-card-art-footer">
        <b>SIOMAC</b>
        <span />
        <em>Privacy · Support · Contact</em>
      </span>
    );
  }
  return (
    <span class="etb-library-card-art etb-library-card-art-message">
      <span class="etb-library-art-icon">
        <i class={`fas ${icon}`} />
      </span>
      <span class="etb-library-mini-copy">
        <b>{copy}</b>
        <em>
          {type === "security_notice"
            ? "Secure operational notice"
            : type === "invitation_expiry"
              ? "Time-sensitive information"
              : "Approved contact information"}
        </em>
      </span>
    </span>
  );
}

const pretty = (value: string): string =>
  value
    .split("_")
    .join(" ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
/**
 * When on, the canvas paints sample values instead of {{variable}} tokens so
 * the real layout is visible. Rich text becomes read-only while it is on —
 * typing over substituted copy would save the sample text into the template.
 */
const DemoDataContext = createContext(false);

function findBlock(
  blocks: EmailTemplateBlock[],
  id: string | null,
): EmailTemplateBlock | null {
  if (!id) return null;
  for (const block of blocks) {
    if (block.id === id) return block;
    const nested = findBlock(block.children, id);
    if (nested) return nested;
  }
  return null;
}

function findParentBlock(
  blocks: EmailTemplateBlock[],
  id: string,
): EmailTemplateBlock | null {
  for (const block of blocks) {
    if (block.children.some((child) => child.id === id)) return block;
    const nested = findParentBlock(block.children, id);
    if (nested) return nested;
  }
  return null;
}

function mapBlocks(
  blocks: EmailTemplateBlock[],
  id: string,
  change: (block: EmailTemplateBlock) => EmailTemplateBlock,
): EmailTemplateBlock[] {
  return blocks.map((block) =>
    block.id === id
      ? change(block)
      : block.children.length
        ? { ...block, children: mapBlocks(block.children, id, change) }
        : block,
  );
}

function removeBlock(
  blocks: EmailTemplateBlock[],
  id: string,
): EmailTemplateBlock[] {
  return blocks
    .filter((block) => block.id !== id)
    .map((block) =>
      block.children.length
        ? { ...block, children: removeBlock(block.children, id) }
        : block,
    );
}

interface BlockLocation {
  parentId: string | null;
  index: number;
}

type DropTarget = BlockLocation | { besideId: string; side: "left" | "right" };

function findLocation(
  blocks: EmailTemplateBlock[],
  id: string,
  parentId: string | null = null,
): BlockLocation | null {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block) continue;
    if (block.id === id) return { parentId, index };
    const nested = findLocation(block.children, id, block.id);
    if (nested) return nested;
  }
  return null;
}

function updateContainer(
  blocks: EmailTemplateBlock[],
  parentId: string,
  change: (children: EmailTemplateBlock[]) => EmailTemplateBlock[],
): EmailTemplateBlock[] {
  return blocks.map((block) =>
    block.id === parentId
      ? { ...block, children: change(block.children) }
      : block.children.length
        ? {
            ...block,
            children: updateContainer(block.children, parentId, change),
          }
        : block,
  );
}

/**
 * Dragging the last child out of a section leaves an empty shell behind, which
 * then advertises itself with a "Drop content here" placeholder. Remove that
 * shell — unless it is where the block just landed, or the user is holding a
 * deliberately empty layout column.
 */
function pruneEmptiedSection(
  blocks: EmailTemplateBlock[],
  sourceParentId: string | null,
  targetParentId: string | null,
): EmailTemplateBlock[] {
  if (!sourceParentId || sourceParentId === targetParentId) return blocks;
  const source = findBlock(blocks, sourceParentId);
  if (!source || source.type !== "section" || source.children.length > 0)
    return blocks;
  // A column cell must survive: its parent columns block owns the grid shape.
  const parent = findParentBlock(blocks, sourceParentId);
  if (parent?.type === "columns") return blocks;
  return removeBlock(blocks, sourceParentId);
}

function insertBlockAt(
  blocks: EmailTemplateBlock[],
  target: BlockLocation,
  block: EmailTemplateBlock,
): EmailTemplateBlock[] {
  if (target.parentId === null) {
    const next = [...blocks];
    next.splice(Math.max(0, Math.min(target.index, next.length)), 0, block);
    return next;
  }
  return updateContainer(blocks, target.parentId, (children) => {
    const next = [...children];
    next.splice(Math.max(0, Math.min(target.index, next.length)), 0, block);
    return next;
  });
}

function replaceBlockAt(
  blocks: EmailTemplateBlock[],
  target: BlockLocation,
  block: EmailTemplateBlock,
): EmailTemplateBlock[] {
  if (target.parentId === null) {
    const next = [...blocks];
    next[target.index] = block;
    return next;
  }
  return updateContainer(blocks, target.parentId, (children) => {
    const next = [...children];
    next[target.index] = block;
    return next;
  });
}

function blockHasRichText(block: EmailTemplateBlock): boolean {
  return block.properties.html !== undefined;
}

function layoutBlock(
  columns: 1 | 2 | 3 | 4,
  widths?: number[],
): EmailTemplateBlock {
  const block = createEmailBlock(columns === 1 ? "section" : "columns");
  block.name =
    columns === 1 ? "Full-width section" : `${columns}-column layout`;
  block.properties.columns = columns;
  block.properties.columnWidths =
    widths ?? Array.from({ length: columns }, () => 100 / columns);
  block.properties.minHeight = 120;
  if (columns === 1) {
    block.children = [];
  } else {
    block.children = Array.from({ length: columns }, (_, index) => {
      const column = createEmailBlock("section");
      column.name = `Column ${index + 1}`;
      column.properties.minHeight = 0;
      column.styles.padding = { top: 0, right: 0, bottom: 0, left: 0 };
      column.styles.borderWidth = 0;
      column.styles.backgroundColor = "transparent";
      return column;
    });
  }
  block.styles.backgroundColor = "#ffffff";
  block.styles.padding = { top: 0, right: 0, bottom: 0, left: 0 };
  block.styles.borderWidth = 0;
  return block;
}

function placeBlockBeside(
  blocks: EmailTemplateBlock[],
  targetId: string,
  incoming: EmailTemplateBlock,
  side: "left" | "right",
): { blocks: EmailTemplateBlock[]; layoutId: string } | null {
  const target = findBlock(blocks, targetId);
  const location = findLocation(blocks, targetId);
  if (
    !target ||
    !location ||
    target.locked ||
    isEmailContainer(target) ||
    isEmailContainer(incoming)
  )
    return null;
  const layout = layoutBlock(2);
  const left = layout.children[0];
  const right = layout.children[1];
  if (!left || !right) return null;
  left.children = [side === "left" ? incoming : target];
  right.children = [side === "right" ? incoming : target];
  const withoutTarget = removeBlock(blocks, targetId);
  return {
    blocks: insertBlockAt(withoutTarget, location, layout),
    layoutId: layout.id,
  };
}

function styleValue(block: EmailTemplateBlock): string {
  const style = block.styles;
  const image = block.properties.backgroundImage?.trim();
  const display = block.properties.backgroundDisplay ?? "scale";
  const imageLayer = image
    ? [
        `background-image:url('${image.replace(/'/g, "\\'")}')`,
        `background-repeat:${display === "tile" ? "repeat" : "no-repeat"}`,
        `background-size:${display === "scale" ? "cover" : display === "fit" ? "contain" : "auto"}`,
        "background-position:center center",
      ]
    : [];
  return [
    ...imageLayer,
    `background:${style.backgroundColor}`,
    `color:${style.color}`,
    `font-family:${EMAIL_FONT_STACK}`,
    `text-align:${style.align}`,
    `font-size:${style.fontSize}px`,
    `font-weight:${style.fontWeight}`,
    `line-height:${style.lineHeight}`,
    `letter-spacing:${style.letterSpacing}px`,
    `padding:${style.padding.top}px ${style.padding.right}px ${style.padding.bottom}px ${style.padding.left}px`,
    `border:${style.borderWidth}px solid ${style.borderColor}`,
    `border-radius:${style.borderRadius}px`,
  ].join(";");
}

function FloatingTextToolbar({
  target,
  disabled,
  style,
  variant = "rich",
  align = "left",
  fontWeight = 400,
  onChange,
  onStyleChange,
  onAlignChange,
  onWeightChange,
}: {
  target: HTMLElement;
  disabled: boolean;
  style: Pick<EmailBlockStyles, "fontSize" | "color">;
  variant?: "rich" | "button";
  align?: EmailTextAlign;
  fontWeight?: EmailBlockStyles["fontWeight"];
  onChange: (html: string) => void;
  onStyleChange: (
    change: Partial<
      Pick<EmailBlockStyles, "fontSize" | "color">
    >,
  ) => void;
  onAlignChange?: (align: EmailTextAlign) => void;
  onWeightChange?: (weight: EmailBlockStyles["fontWeight"]) => void;
}): VNode {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef<HTMLSpanElement>(null);
  const [sizeMenuOpen, setSizeMenuOpen] = useState(false);
  const [activeFormats, setActiveFormats] = useState<Set<string>>(
    () => new Set(),
  );
  useEffect(() => {
    if (!sizeMenuOpen) return;
    const close = (event: MouseEvent): void => {
      if (!sizeRef.current?.contains(event.target as Node))
        setSizeMenuOpen(false);
    };
    globalThis.document.addEventListener("mousedown", close);
    return () => globalThis.document.removeEventListener("mousedown", close);
  }, [sizeMenuOpen]);
  // Position is null until the first successful measurement: the toolbar stays
  // invisible instead of painting one frame at a default spot (top-left flash).
  const [position, setPosition] = useState<
    { left: number; top: number; placement: "above" | "below" } | null
  >(null);
  const updatePosition = (): boolean => {
    const toolbar = toolbarRef.current;
    if (!toolbar || !target.isConnected) return false;
    const anchor = target.getBoundingClientRect();
    const toolbarWidth = toolbar.offsetWidth;
    const toolbarHeight = toolbar.offsetHeight;
    // Measuring before layout gives 0×0 (and an anchor with no box while the
    // canvas is still painting). Report failure so the caller can retry.
    if (!toolbarWidth || !toolbarHeight || (!anchor.width && !anchor.height))
      return false;
    const left = Math.max(
      12,
      Math.min(
        globalThis.innerWidth - toolbarWidth - 12,
        anchor.left + (anchor.width - toolbarWidth) / 2,
      ),
    );
    const fitsAbove = anchor.top >= toolbarHeight + 18;
    const top = fitsAbove
      ? anchor.top - toolbarHeight - 10
      : Math.min(
          globalThis.innerHeight - toolbarHeight - 12,
          anchor.bottom + 10,
        );
    setPosition({
      left,
      top: Math.max(12, top),
      placement: fitsAbove ? "above" : "below",
    });
    return true;
  };
  const refreshActiveFormats = (): void => {
    const selection = globalThis.document.getSelection();
    let selectedNode = selection?.rangeCount
      ? selection.getRangeAt(0).commonAncestorContainer
      : null;
    if (
      (!selectedNode || !target.contains(selectedNode)) &&
      globalThis.document.activeElement === target
    ) {
      selectedNode =
        target.childNodes.length === 1 ? target.firstChild : target;
    }
    if (!selectedNode || !target.contains(selectedNode)) {
      setActiveFormats(new Set());
      return;
    }
    const formats = new Set<string>();
    let node =
      selectedNode instanceof HTMLElement
        ? selectedNode
        : selectedNode.parentElement;
    while (node && target.contains(node)) {
      const tag = node.tagName.toLowerCase();
      if (tag === "strong" || tag === "b") formats.add("bold");
      if (tag === "em" || tag === "i") formats.add("italic");
      if (tag === "u") formats.add("underline");
      if (tag === "s" || tag === "strike") formats.add("strikeThrough");
      if (tag === "ul") formats.add("insertUnorderedList");
      if (tag === "ol") formats.add("insertOrderedList");
      if (tag === "a") formats.add("createLink");
      if (tag === "h1" || tag === "h2" || tag === "h3") formats.add("heading");
      if (tag === "p" || tag === "div") formats.add("paragraph");
      if (node === target) break;
      node = node.parentElement;
    }
    const commandDocument = globalThis.document as unknown as {
      queryCommandState?(commandId: string): boolean;
    };
    // queryCommandState reflects the WHOLE selection; the ancestor walk above
    // only sees the common ancestor and misses partially-formatted ranges.
    for (const command of [
      "bold",
      "italic",
      "underline",
      "strikeThrough",
      "insertUnorderedList",
      "insertOrderedList",
      "justifyLeft",
      "justifyCenter",
      "justifyRight",
      "justifyFull",
    ]) {
      if (commandDocument.queryCommandState?.(command)) formats.add(command);
    }
    setActiveFormats(formats);
  };
  useEffect(() => {
    setPosition(null);
    let frame = 0;
    // The toolbar mounts in the same commit that focuses the editor, so the
    // first measurement can land before layout. Retry on animation frames
    // until both boxes are real, then stop.
    const measure = (attempt = 0): void => {
      if (updatePosition() || attempt > 8) return;
      frame = globalThis.requestAnimationFrame(() => measure(attempt + 1));
    };
    measure();
    refreshActiveFormats();
    const reposition = (): void => { updatePosition(); };
    // A resized/reflowed anchor (font change, block resize, canvas zoom) moves
    // the toolbar without any scroll or window resize event.
    const observer = new ResizeObserver(reposition);
    observer.observe(target);
    globalThis.document.addEventListener(
      "selectionchange",
      refreshActiveFormats,
    );
    globalThis.addEventListener("resize", reposition);
    globalThis.addEventListener("scroll", reposition, true);
    return () => {
      if (frame) globalThis.cancelAnimationFrame(frame);
      observer.disconnect();
      globalThis.document.removeEventListener(
        "selectionchange",
        refreshActiveFormats,
      );
      globalThis.removeEventListener("resize", reposition);
      globalThis.removeEventListener("scroll", reposition, true);
    };
  }, [target]);
  const applyCommand = (command: string, value?: string): void => {
    const selection = globalThis.document.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!target.contains(range.commonAncestorContainer)) return;
    const commandDocument = globalThis.document as unknown as {
      execCommand(
        commandId: string,
        showUi?: boolean,
        commandValue?: string,
      ): boolean;
    };
    commandDocument.execCommand(command, false, value);
    onChange(sanitizeRichText(target.innerHTML));
    globalThis.requestAnimationFrame(refreshActiveFormats);
  };
  const linkRef = useRef<HTMLSpanElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const [linkMenuOpen, setLinkMenuOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  useEffect(() => {
    if (!linkMenuOpen) return;
    linkInputRef.current?.focus();
    const close = (event: MouseEvent): void => {
      if (!linkRef.current?.contains(event.target as Node))
        setLinkMenuOpen(false);
    };
    globalThis.document.addEventListener("mousedown", close);
    return () => globalThis.document.removeEventListener("mousedown", close);
  }, [linkMenuOpen]);
  const openLinkMenu = (): void => {
    const selection = globalThis.document.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!target.contains(range.commonAncestorContainer)) return;
    // The input steals focus and can collapse the selection; keep a copy so
    // Apply can restore it before running the command.
    savedRangeRef.current = range.cloneRange();
    let node =
      range.commonAncestorContainer instanceof HTMLElement
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
    let existing = "";
    while (node && target.contains(node)) {
      if (node.tagName === "A") {
        existing = node.getAttribute("href") ?? "";
        break;
      }
      node = node.parentElement;
    }
    setLinkDraft(existing);
    setLinkMenuOpen(true);
  };
  const applyLink = (): void => {
    const raw = linkDraft.trim();
    setLinkMenuOpen(false);
    if (!raw) return;
    // Bare domains used to be silently STRIPPED by the sanitizer; give them
    // a scheme. Variables ({{company.privacyUrl}}) pass through untouched.
    const href = /^(?:https?:|mailto:|tel:|\{\{)/i.test(raw)
      ? raw
      : `https://${raw}`;
    const saved = savedRangeRef.current;
    const selection = globalThis.document.getSelection();
    if (saved && selection) {
      selection.removeAllRanges();
      selection.addRange(saved);
    }
    applyCommand("createLink", href);
  };
  const sizeControl = (
    <span class="etb-floating-size" ref={sizeRef}>
      <input
        type="number"
        min="8"
        max="72"
        value={style.fontSize}
        disabled={disabled}
        onInput={(event) => {
          const next = Number(event.currentTarget.value);
          if (Number.isFinite(next) && next >= 8 && next <= 72)
            onStyleChange({ fontSize: next });
        }}
        aria-label="Text size"
        title="Text size in pixels"
      />
      <b>px</b>
      <button
        type="button"
        class={`etb-size-toggle ${sizeMenuOpen ? "is-open" : ""}`}
        disabled={disabled}
        onClick={() => setSizeMenuOpen((current) => !current)}
        aria-label="Text size presets"
        aria-expanded={sizeMenuOpen}
        title="Text size presets"
      >
        <i class="fas fa-chevron-down" />
      </button>
      {sizeMenuOpen && (
        <div class="etb-size-menu" role="listbox" aria-label="Text size">
          {EMAIL_FONT_SIZE_PRESETS.map((size) => (
            <button
              type="button"
              role="option"
              aria-selected={style.fontSize === size}
              class={style.fontSize === size ? "active" : ""}
              onClick={() => {
                onStyleChange({ fontSize: size });
                setSizeMenuOpen(false);
              }}
            >
              {size}px
            </button>
          ))}
        </div>
      )}
    </span>
  );

  // Buttons carry a plain label: size, colour, weight and placement only.
  if (variant === "button") {
    return (
      <div
        ref={toolbarRef}
        class={`etb-floating-text-toolbar ${position?.placement ?? "above"}${position ? "" : " measuring"}`}
        style={position ? `left:${position.left}px;top:${position.top}px` : ""}
        role="toolbar"
        aria-label="Button formatting"
      >
        <div class="etb-floating-text-row primary">
          {sizeControl}
          <span class="etb-floating-sep" />
          {/* Email-safe stacks ship Regular and Bold only — 500/600 render
              identically to 700, so they are not offered. */}
          <select
            class="etb-weight-select"
            value={fontWeight >= 600 ? "700" : "400"}
            disabled={disabled}
            onMouseDown={(event) => event.stopPropagation()}
            onChange={(event) =>
              onWeightChange?.(
                Number(
                  event.currentTarget.value,
                ) as EmailBlockStyles["fontWeight"],
              )
            }
            aria-label="Label weight"
            title="Label weight"
          >
            <option value="400">Regular</option>
            <option value="700">Bold</option>
          </select>
          <span class="etb-floating-sep" />
          <span class="etb-floating-colour-group" title="Label colour">
            <ColorControl
              value={style.color}
              ariaLabel="Label colour"
              compact
              onChange={(color) => onStyleChange({ color })}
            />
          </span>
          <span class="etb-floating-sep" />
          {(["left", "center", "right"] as EmailTextAlign[]).map((option) => (
            <button
              type="button"
              class={align === option ? "active" : ""}
              disabled={disabled}
              onMouseDown={(event) => {
                event.preventDefault();
                onAlignChange?.(option);
              }}
              aria-label={`Place button ${option}`}
              title={`Place button ${option}`}
            >
              <i class={`fas fa-align-${option}`} />
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={toolbarRef}
      class={`etb-floating-text-toolbar ${position?.placement ?? "above"}${position ? "" : " measuring"}`}
      style={position ? `left:${position.left}px;top:${position.top}px` : ""}
      role="toolbar"
      aria-label="Text formatting"
    >
      <div class="etb-floating-text-row primary">
        <select
          value={activeFormats.has("heading") ? "h2" : "p"}
          disabled={disabled}
          onMouseDown={(event) => event.stopPropagation()}
          onChange={(event) =>
            applyCommand("formatBlock", event.currentTarget.value)
          }
          aria-label="Text style"
          title="Text style"
        >
          <option value="p">Paragraph</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
        </select>
        {/* Type any size directly, or open the chevron for the presets. */}
        {sizeControl}
        <span class="etb-floating-spacer" />
        <button
          type="button"
          class={activeFormats.has("bold") ? "active" : ""}
          aria-pressed={activeFormats.has("bold")}
          disabled={disabled}
          onMouseDown={(event) => {
            event.preventDefault();
            applyCommand("bold");
          }}
          aria-label="Bold"
          title="Bold"
        >
          <i class="fas fa-bold" />
        </button>
        <button
          type="button"
          class={activeFormats.has("italic") ? "active" : ""}
          aria-pressed={activeFormats.has("italic")}
          disabled={disabled}
          onMouseDown={(event) => {
            event.preventDefault();
            applyCommand("italic");
          }}
          aria-label="Italic"
          title="Italic"
        >
          <i class="fas fa-italic" />
        </button>
        <span class="etb-floating-colour-group" title="Text colour">
          <ColorControl
            value={style.color}
            ariaLabel="Text colour"
            compact
            onChange={(color) => onStyleChange({ color })}
          />
        </span>
      </div>
      <div class="etb-floating-text-row secondary">
        {(
          [
            ["justifyLeft", "fa-align-left", "Align left"],
            ["justifyCenter", "fa-align-center", "Align center"],
            ["justifyRight", "fa-align-right", "Align right"],
            ["justifyFull", "fa-align-justify", "Justify"],
          ] as const
        ).map(([command, icon, label]) => (
          <button
            type="button"
            class={activeFormats.has(command) ? "active" : ""}
            aria-pressed={activeFormats.has(command)}
            disabled={disabled}
            onMouseDown={(event) => {
              event.preventDefault();
              applyCommand(command);
            }}
            aria-label={label}
            title={label}
          >
            <i class={`fas ${icon}`} />
          </button>
        ))}
        <span class="etb-floating-sep" />
        <button
          type="button"
          class={activeFormats.has("insertUnorderedList") ? "active" : ""}
          aria-pressed={activeFormats.has("insertUnorderedList")}
          disabled={disabled}
          onMouseDown={(event) => {
            event.preventDefault();
            applyCommand("insertUnorderedList");
          }}
          aria-label="Bulleted list"
          title="Bulleted list"
        >
          <i class="fas fa-list-ul" />
        </button>
        <button
          type="button"
          class={activeFormats.has("insertOrderedList") ? "active" : ""}
          aria-pressed={activeFormats.has("insertOrderedList")}
          disabled={disabled}
          onMouseDown={(event) => {
            event.preventDefault();
            applyCommand("insertOrderedList");
          }}
          aria-label="Numbered list"
          title="Numbered list"
        >
          <i class="fas fa-list-ol" />
        </button>
        <button
          type="button"
          disabled={disabled}
          onMouseDown={(event) => {
            event.preventDefault();
            applyCommand("formatBlock", "blockquote");
          }}
          aria-label="Quote"
          title="Quote"
        >
          <i class="fas fa-quote-right" />
        </button>
        <span class="etb-floating-spacer" />
        <span class="etb-floating-sep" />
        <span class="etb-link-wrap" ref={linkRef}>
          <button
            type="button"
            class={activeFormats.has("createLink") || linkMenuOpen ? "active" : ""}
            aria-pressed={activeFormats.has("createLink")}
            disabled={disabled}
            onMouseDown={(event) => {
              event.preventDefault();
              openLinkMenu();
            }}
            aria-label="Add link"
            title="Add link"
          >
            <i class="fas fa-link" />
          </button>
          {linkMenuOpen && (
            <div class="etb-link-menu" onMouseDown={(event) => event.stopPropagation()}>
              <input
                ref={linkInputRef}
                value={linkDraft}
                placeholder="https:// link or {{variable}}"
                aria-label="Link address"
                onInput={(event) => setLinkDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyLink();
                  }
                  if (event.key === "Escape") setLinkMenuOpen(false);
                }}
              />
              <button type="button" onClick={applyLink}>
                Apply
              </button>
            </div>
          )}
        </span>
        <button
          type="button"
          disabled={disabled}
          onMouseDown={(event) => {
            event.preventDefault();
            applyCommand("unlink");
          }}
          aria-label="Remove link"
          title="Remove link"
        >
          <i class="fas fa-link-slash" />
        </button>
      </div>
    </div>
  );
}

function verticalFlex(value: EmailVerticalAlign | undefined): string {
  if (value === "middle") return "center";
  if (value === "bottom") return "flex-end";
  return "flex-start";
}

/** Email-safe swatch palette: 5 hues × 4 tints, then neutrals. */
const COLOR_SWATCHES: readonly (readonly string[])[] = [
  ["#BFE8CE", "#FBECB4", "#F8CFC4", "#EBD0F5", "#C3E0F5"],
  ["#31B96A", "#EFBB11", "#E0432B", "#A855C8", "#2A87CE"],
  ["#128268", "#E2830F", "#C0342A", "#7B3AA6", "#25628F"],
  ["#EDF1F4", "#C6CCD6", "#95A1AC", "#78858E", "#31465C"],
  ["#000000", "#FFFFFF", "#5F6B80", "#102442", "#0B57D0"],
] as const;

function ColorControl({
  value,
  onChange,
  allowTransparent = false,
  ariaLabel = "Colour",
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  allowTransparent?: boolean;
  ariaLabel?: string;
  compact?: boolean;
}): VNode {
  const normalized = /^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff";
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(normalized.toUpperCase());
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => setDraft(normalized.toUpperCase()), [normalized]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    globalThis.document.addEventListener("mousedown", close);
    return () => globalThis.document.removeEventListener("mousedown", close);
  }, [open]);
  const commitDraft = (): void => {
    if (/^#[0-9a-f]{6}$/i.test(draft)) onChange(draft.toUpperCase());
    else setDraft(normalized.toUpperCase());
  };
  const transparent = value === "transparent";
  return (
    <div
      ref={rootRef}
      class={`etb-color-control ${compact ? "compact" : ""}`}
    >
      <button
        type="button"
        class={`etb-color-trigger ${open ? "is-open" : ""}`}
        onClick={() => setOpen((current) => !current)}
        aria-label={`${ariaLabel} — choose a colour`}
        aria-expanded={open}
        title={transparent ? "Transparent" : normalized.toUpperCase()}
      >
        {compact ? (
          <span class="etb-color-glyph">
            <i class="fas fa-font" />
            <em
              class={transparent ? "is-transparent" : ""}
              style={transparent ? undefined : `background:${normalized}`}
            />
          </span>
        ) : (
          <span
            class={`etb-color-chip ${transparent ? "is-transparent" : ""}`}
            style={transparent ? undefined : `background:${normalized}`}
          />
        )}
        {!compact && <b>{transparent ? "Transparent" : draft}</b>}
        <i class="fas fa-chevron-down" />
      </button>
      {open && (
        <div class="etb-color-popover" role="dialog" aria-label={ariaLabel}>
          <div class="etb-color-grid">
            {COLOR_SWATCHES.map((row) =>
              row.map((swatch) => (
                <button
                  type="button"
                  class={
                    normalized.toUpperCase() === swatch && !transparent
                      ? "active"
                      : ""
                  }
                  style={`background:${swatch}`}
                  onClick={() => {
                    onChange(swatch);
                    setOpen(false);
                  }}
                  aria-label={swatch}
                  title={swatch}
                />
              )),
            )}
          </div>
          <div class="etb-color-custom">
            <label class="etb-color-native" title="Custom colour">
              <input
                type="color"
                value={normalized}
                onInput={(event) =>
                  onChange(event.currentTarget.value.toUpperCase())
                }
                aria-label={`${ariaLabel} picker`}
              />
              <i class="fas fa-palette" />
            </label>
            <input
              class="etb-hex-input"
              value={draft}
              maxLength={7}
              spellcheck={false}
              onInput={(event) => setDraft(event.currentTarget.value)}
              onBlur={commitDraft}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitDraft();
                }
              }}
              aria-label={`${ariaLabel} hex`}
            />
            {allowTransparent && (
              <button
                type="button"
                class={`etb-color-none ${transparent ? "active" : ""}`}
                onClick={() => {
                  onChange("transparent");
                  setOpen(false);
                }}
                aria-label="Use transparent background"
                title="Transparent"
              >
                <i class="fas fa-droplet-slash" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface DragPreview {
  label: string;
  icon: string;
}

function DropGuide({
  visible,
  active,
  preview,
  onActivate,
  onDrop,
}: {
  visible: boolean;
  active: boolean;
  preview: DragPreview;
  onActivate: () => void;
  onDrop: (event: TargetedDragEvent<HTMLDivElement>) => void;
}): VNode {
  return (
    <div
      class={`etb-drop-guide ${visible ? "visible" : ""} ${active ? "active" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onActivate();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        // dropEffect MUST be compatible with the drag source's effectAllowed.
        // Palette drags allow only "copy"; forcing "move" made the browser
        // reject the drop and never fire a drop event.
        if (event.dataTransfer)
          event.dataTransfer.dropEffect =
            event.dataTransfer.effectAllowed === "copy" ? "copy" : "move";
      }}
      onDrop={onDrop}
    >
      <span>
        <i class={`fas ${preview.icon}`} />
        <b>{preview.label}</b>
        <small>Insert here</small>
      </span>
    </div>
  );
}

function SideDropZone({
  side,
  active,
  preview,
  onActivate,
  onDrop,
}: {
  side: "left" | "right";
  active: boolean;
  preview: DragPreview;
  onActivate: () => void;
  onDrop: (event: TargetedDragEvent<HTMLDivElement>) => void;
}): VNode {
  return (
    <div
      class={`etb-side-drop-zone ${side} ${active ? "active" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onActivate();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        // dropEffect MUST be compatible with the drag source's effectAllowed.
        // Palette drags allow only "copy"; forcing "move" made the browser
        // reject the drop and never fire a drop event.
        if (event.dataTransfer)
          event.dataTransfer.dropEffect =
            event.dataTransfer.effectAllowed === "copy" ? "copy" : "move";
      }}
      onDrop={onDrop}
    >
      <span>
        <i class={`fas ${preview.icon}`} />
        <b>{preview.label}</b>
        <small>New {side} column</small>
      </span>
    </div>
  );
}

/**
 * Icon picker popover. Offers only icons the EMAIL renderer can draw, so the
 * canvas and the delivered message never disagree.
 */
function IconPicker({
  value,
  ariaLabel,
  onChange,
  allowNone = false,
}: {
  value: string;
  ariaLabel: string;
  onChange: (icon: string) => void;
  allowNone?: boolean;
}): VNode {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    globalThis.document.addEventListener("mousedown", close);
    return () => globalThis.document.removeEventListener("mousedown", close);
  }, [open]);
  const matches = EMAIL_ICON_CHOICES.filter((name) =>
    name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <div class="etb-icon-picker" ref={rootRef}>
      <button
        type="button"
        class="etb-icon-picker-trigger"
        aria-label={ariaLabel}
        aria-expanded={open}
        title={value}
        onClick={() => setOpen((current) => !current)}
      >
        {value.trim() ? (
          <LucideIcon name={value as LucideName} size={17} />
        ) : (
          <i class="fas fa-ban etb-icon-picker-none" />
        )}
        <i class="fas fa-chevron-down" />
      </button>
      {open && (
        <div class="etb-icon-picker-menu">
          <input
            class="etb-icon-picker-search"
            value={query}
            placeholder="Search icons"
            aria-label="Search icons"
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
          <div class="etb-icon-picker-grid">
            {allowNone && (
              <button
                type="button"
                class={value.trim() === "" ? "active" : ""}
                title="No icon"
                aria-label="No icon"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                <i class="fas fa-ban" />
              </button>
            )}
            {matches.map((name) => (
              <button
                type="button"
                class={name === value ? "active" : ""}
                title={name}
                aria-label={name}
                onClick={() => {
                  onChange(name);
                  setOpen(false);
                }}
              >
                <LucideIcon name={name as LucideName} size={17} />
              </button>
            ))}
            {matches.length === 0 && (
              <p class="etb-icon-picker-empty">No icons match "{query}".</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** One labelled slider with a live read-out. The single numeric primitive. */
function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "px",
  hint,
  readout,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  hint?: string;
  readout?: string;
  onChange: (value: number) => void;
}): VNode {
  return (
    <label class="etb-slider-field">
      <span>
        {label}
        <output>
          {readout ?? `${value}${unit}`}
        </output>
      </span>
      <input
        class="etb-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onInput={(event) => onChange(Number(event.currentTarget.value))}
      />
      {hint && <small class="etb-slider-hint">{hint}</small>}
    </label>
  );
}

/**
 * Spacing as ONE slider by default (drives all four sides). The per-side
 * toggle opens Top/Right/Bottom/Left sliders for asymmetric control; the
 * master readout shows "Mixed" while sides differ.
 */
function SpacingEditor({
  label,
  value,
  max = 60,
  onChange,
  axis = "all",
}: {
  label: string;
  value: EmailBlockStyles["padding"];
  max?: number;
  onChange: (value: EmailBlockStyles["padding"]) => void;
  /**
   * `vertical` hides the horizontal sides for a top-level section, whose left/right inset is owned
   * by the document's Page padding. Showing them would be a control that changes a value nothing
   * renders — the accept-and-drop failure this codebase forbids.
   */
  axis?: "all" | "vertical";
}): VNode {
  const verticalOnly = axis === "vertical";
  const uniform = verticalOnly
    ? value.top === value.bottom
    : value.top === value.right &&
      value.top === value.bottom &&
      value.top === value.left;
  const [perSide, setPerSide] = useState(!uniform);
  const sides = (verticalOnly
    ? ([["top", "Top"], ["bottom", "Bottom"]] as const)
    : ([["top", "Top"], ["right", "Right"], ["bottom", "Bottom"], ["left", "Left"]] as const));
  return (
    <div class="etb-spacing-editor">
      <div class="etb-spacing-head">
        <SliderField
          label={label}
          value={value.top}
          min={0}
          max={max}
          readout={uniform ? `${value.top}px` : "Mixed"}
          onChange={(next) =>
            onChange(verticalOnly
              ? { ...value, top: next, bottom: next }
              : { top: next, right: next, bottom: next, left: next })
          }
        />
        <button
          type="button"
          class={`etb-spacing-split${perSide ? " active" : ""}`}
          aria-label={`Adjust ${label.toLowerCase()} per side`}
          aria-expanded={perSide}
          title="Per-side control"
          onClick={() => setPerSide((open) => !open)}
        >
          <LucideIcon name="UnfoldVertical" size={13} />
        </button>
      </div>
      {perSide && (
        <div class="etb-spacing-sides">
          {sides.map(([side, sideLabel]) => (
            <SliderField
              key={side}
              label={sideLabel}
              value={value[side]}
              min={0}
              max={max}
              onChange={(next) => onChange({ ...value, [side]: next })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const TRANSACTIONAL_LIST_TYPES: EmailBlockType[] = [
  "pending_tasks",
  "required_documents",
  "training_assignments",
  "equipment_ppe",
];
/** Built-in reusable sections offered beside the user's saved ones. */
const SECTION_PRESETS: readonly {
  label: string;
  description: string;
  icon: string;
  build: () => EmailTemplateBlock;
}[] = [
  {
    label: "First-Day Overview",
    description: "Title, fact tiles and next-step card",
    icon: "fa-calendar-day",
    build: createFirstDayOverviewSection,
  },
  {
    label: "Call to Action Card",
    description: "Heading, message and action link",
    icon: "fa-arrow-up-right-from-square",
    build: () =>
      createCallToActionSection(
        "What’s next?",
        "Add a concise explanation of the next action.",
        "Continue",
        "#",
      ),
  },
];

const TRANSACTIONAL_CANVAS_TYPES: EmailBlockType[] = [
  "icon_list",
  "smart_fact_grid",
  "smart_progress",
  "smart_status_list",
  "welcome_header",
  "employee_details",
  "manager_contact",
  "start_date_summary",
  ...TRANSACTIONAL_LIST_TYPES,
  "invitation_action",
  "invitation_expiry",
  "security_notice",
  "support_contact",
  "legal_footer",
];

function TransactionalCanvasContent({
  block,
  editable,
  onChange,
  onPropertiesChange,
}: {
  block: EmailTemplateBlock;
  editable: boolean;
  onChange: (html: string) => void;
  onPropertiesChange: (
    properties: Partial<EmailTemplateBlock["properties"]>,
  ) => void;
}): VNode {
  const demoData = useContext(DemoDataContext);
  const richCopy = (className = ""): VNode => (
    <div
      class={`etb-transactional-copy etb-editable-copy ${className}`}
      data-rich-editor={demoData ? undefined : "true"}
      data-demo-text={demoData ? "true" : undefined}
      contentEditable={
        !demoData && editable && !block.locked && blockHasRichText(block)
      }
      dangerouslySetInnerHTML={{
        __html: demoData
          ? applySampleVariables(sanitizeRichText(block.properties.html ?? ""))
          : sanitizeRichText(block.properties.html ?? ""),
      }}
      onInput={(event) => {
        if (!editable || block.locked || !blockHasRichText(block)) return;
        const html = sanitizeRichText(event.currentTarget.innerHTML);
        if (html !== block.properties.html) onChange(html);
      }}
      onBlur={(event) => {
        if (!editable || block.locked || !blockHasRichText(block)) return;
        const html = sanitizeRichText(event.currentTarget.innerHTML);
        if (html !== block.properties.html) onChange(html);
      }}
    />
  );
  if (block.type === "icon_list") {
    const shape = block.properties.iconShape ?? "rounded";
    const rowGap = Math.max(
      2,
      Math.round((block.styles.lineHeight - 1) * block.styles.fontSize),
    );
    return (
      <div
        class="etb-icon-list"
        style={`--etb-list-icon-color:${emailIconHex(normalizeEmailIconColor(block.properties.iconColor))};--etb-list-icon-bg:${block.properties.iconBackground ?? "#ffffff"};row-gap:${rowGap}px`}
      >
        {(block.properties.iconItems ?? []).map((item) => (
          <div>
            <span
              class={`${shape} ${block.properties.iconTreatment ?? "outline"}`}
            >
              <LucideIcon name={item.icon as LucideName} size={18} />
            </span>
            <p>{applySampleVariables(item.text)}</p>
          </div>
        ))}
      </div>
    );
  }
  if (block.type === "smart_progress") {
    const percent = Math.max(
      0,
      Math.min(100, Math.round(block.properties.percent ?? 0)),
    );
    const caption = block.properties.progressCaption?.trim();
    return (
      <div class="etb-progress-block">
        <div class="etb-progress-head">
          {richCopy("etb-progress-label")}
          <b>{percent}%</b>
        </div>
        <div class="etb-progress-track">
          <div class="etb-progress-fill" style={`width:${percent}%`} />
        </div>
        {caption && <small>{applySampleVariables(caption)}</small>}
      </div>
    );
  }
  if (block.type === "smart_status_list") {
    return (
      <div class="etb-status-list">
        {(block.properties.statusItems ?? []).map((item) => (
          <div class="etb-status-row">
            <span class="etb-status-text">
              <strong>{applySampleVariables(item.title)}</strong>
              <small>{applySampleVariables(item.meta)}</small>
            </span>
            <em class={`etb-status-pill is-${item.status}`}>
              {item.status === "done"
                ? "Completed"
                : item.status === "current"
                  ? "In progress"
                  : "Pending"}
            </em>
          </div>
        ))}
      </div>
    );
  }
  if (block.type === "smart_fact_grid") {
    const shape = block.properties.iconShape ?? "rounded";
    const treatment = block.properties.iconTreatment ?? "outline";
    const perRow = Math.min(4, Math.max(1, block.properties.columns ?? 4));
    const tileAlign = block.properties.factTileAlign ?? "left";
    const dividers = block.properties.factDividers ?? false;
    const iconSize = Math.max(16, block.properties.iconSize ?? 28);
    return (
      <div
        class="etb-fact-grid-block"
        style={`--etb-list-icon-color:${emailIconHex(normalizeEmailIconColor(block.properties.iconColor))};--etb-list-icon-bg:${block.properties.iconBackground ?? "#ffffff"};--etb-fact-rule:${block.styles.borderColor};--etb-fact-icon:${iconSize}px`}
      >
        {richCopy("etb-fact-grid-heading")}
        <div
          class={`etb-fact-grid ${dividers ? "has-rules" : ""} align-${tileAlign}`}
          style={`grid-template-columns:repeat(${perRow},minmax(0,1fr))`}
        >
          {(block.properties.factTiles ?? []).map((tile, index) => (
            <div
              class={`etb-fact-tile ${dividers && index % perRow !== 0 ? "has-rule" : ""}`}
            >
              {tile.icon.trim() !== "" && (
                <span class={`${shape} ${treatment}`}>
                  <LucideIcon
                    name={tile.icon as LucideName}
                    size={Math.round(iconSize * 0.55)}
                  />
                </span>
              )}
              <small>{applySampleVariables(tile.label)}</small>
              <strong>{applySampleVariables(tile.value)}</strong>
              {tile.caption && <em>{applySampleVariables(tile.caption)}</em>}
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (block.type === "welcome_header")
    return (
      <div class="etb-transactional-welcome">
        <small>Welcome to SIOMAC</small>
        {richCopy()}
        <span />
      </div>
    );
  if (block.type === "employee_details")
    return (
      <div class="etb-transactional-profile">
        <img src={SAMPLE_PROFILE_PHOTO} alt="Damani Baptiste" />
        <span>
          {richCopy()}
          <small>Employee record</small>
        </span>
        <em>Employee</em>
      </div>
    );
  if (block.type === "manager_contact" || block.type === "start_date_summary")
    return (
      <div class="etb-transactional-summary">
        <span class="etb-transactional-symbol">
          {block.type === "manager_contact" ? (
            <LucideIcon name="UserRound" size={18} />
          ) : (
            <LucideIcon name="CalendarDays" size={18} />
          )}
        </span>
        <span>
          <small>
            {block.type === "manager_contact"
              ? "Accountable contact"
              : "Confirmed schedule"}
          </small>
          {richCopy()}
        </span>
      </div>
    );
  if (TRANSACTIONAL_LIST_TYPES.includes(block.type)) {
    const itemCopy =
      block.type === "required_documents"
        ? ["Proof of address", "Bank account confirmation"]
        : block.type === "training_assignments"
          ? ["Workplace orientation", "Information security"]
          : block.type === "equipment_ppe"
            ? ["Laptop and charger", "Access badge"]
            : ["Complete your employee profile", "Review required documents"];
    return (
      <div class={`etb-transactional-list tone-${block.type}`}>
        <header>
          <span class="etb-transactional-symbol">
            <i
              class={`fas ${EMAIL_BLOCK_DEFINITIONS.find((item) => item.type === block.type)?.icon ?? "fa-list-check"}`}
            />
          </span>
          {richCopy()}
          <small>{itemCopy.length} items</small>
        </header>
        <ol>
          {itemCopy.map((item, index) => (
            <li>
              <i>{index + 1}</i>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }
  if (block.type === "invitation_action")
    return (
      <div class="etb-transactional-invitation">
        <span class="etb-transactional-symbol">
          <LucideIcon name="MailCheck" size={20} />
        </span>
        <span>
          <small>Secure account invitation</small>
          <strong>Complete your SIOMAC access setup</strong>
        </span>
        <button
          type="button"
          style={`background:${block.styles.backgroundColor};color:${block.styles.color};border-radius:${block.styles.borderRadius}px`}
        >
          {block.properties.label}
        </button>
      </div>
    );
  if (block.type === "support_contact")
    return (
      <div class="etb-welcome-support">
        {richCopy()}
        <span>
          <LucideIcon name="Mail" size={16} />{" "}
          {applySampleVariables(
            block.properties.contactEmail ?? "{{support.email}}",
          )}
        </span>
        <span>
          <LucideIcon name="Phone" size={16} />{" "}
          {applySampleVariables(
            block.properties.contactPhone ?? "{{support.phone}}",
          )}
        </span>
      </div>
    );
  if (block.type === "legal_footer") {
    const links = (
      block.properties.footerLinks ?? DEFAULT_FOOTER_LINKS
    ).filter((link) => link.label.trim());
    const notice = (
      block.properties.replyNotice ?? DEFAULT_REPLY_NOTICE
    ).trim();
    return (
      <div class="etb-welcome-footer">
        <div>
          <span>
            <LucideIcon name="Building2" size={16} />
          </span>
          <span>
            <LucideIcon name="Clock3" size={16} />
          </span>
          <span>
            <LucideIcon name="ShieldCheck" size={16} />
          </span>
        </div>
        {richCopy()}
        {links.length > 0 && (
          <small>
            {links.map((link, index) => (
              <>
                {index > 0 && <>&nbsp;&nbsp;·&nbsp;&nbsp;</>}
                {applySampleVariables(link.label)}
              </>
            ))}
          </small>
        )}
        {notice && <em>{applySampleVariables(notice)}</em>}
      </div>
    );
  }
  return (
    <div class={`etb-transactional-message tone-${block.type}`}>
      <span class="etb-transactional-symbol">
        <i
          class={`fas ${EMAIL_BLOCK_DEFINITIONS.find((item) => item.type === block.type)?.icon ?? "fa-circle-info"}`}
        />
      </span>
      {richCopy()}
    </div>
  );
}

function LayerTree({
  blocks,
  selectedId,
  onSelect,
  depth = 0,
}: {
  blocks: EmailTemplateBlock[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  depth?: number;
}): VNode {
  return (
    <div
      class={depth === 0 ? "etb-layer-tree" : "etb-layer-children"}
      role={depth === 0 ? "tree" : "group"}
    >
      {blocks.map((block) => {
        const container = isEmailContainer(block);
        const definition = EMAIL_BLOCK_DEFINITIONS.find(
          (item) => item.type === block.type,
        );
        return (
          <div class="etb-layer-node">
            <button
              type="button"
              role="treeitem"
              aria-level={depth + 1}
              aria-selected={selectedId === block.id}
              class={selectedId === block.id ? "active" : ""}
              style={`--etb-layer-depth:${depth}`}
              onClick={() => onSelect(block.id)}
            >
              <i
                class={`fas ${container ? (block.type === "columns" ? "fa-table-columns" : "fa-layer-group") : (definition?.icon ?? "fa-square")}`}
              />
              <span>
                <strong>{block.name}</strong>
                <small>
                  {container
                    ? block.type === "columns"
                      ? `${block.children.length} columns`
                      : `${block.children.length} elements`
                    : (definition?.label ?? block.type)}
                </small>
              </span>
              <em>
                {block.hidden ? (
                  <LucideIcon name="EyeOff" size={13} />
                ) : block.locked ? (
                  <LucideIcon name="Lock" size={13} />
                ) : null}
              </em>
            </button>
            {block.children.length > 0 && (
              <LayerTree
                blocks={block.children}
                selectedId={selectedId}
                onSelect={onSelect}
                depth={depth + 1}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CanvasBlock({
  block,
  allowSideDrop = false,
  structuralCell = false,
  dragSourceIsContainer = false,
  selectedId,
  editable,
  dragActive,
  dragPreview,
  activeDropKey,
  onSelect,
  onChange,
  onDrop,
  onActivateDrop,
  onDragStart,
  onDragEnd,
  onDuplicate,
  onRemove,
  onResize,
  onQuickAdd,
}: {
  block: EmailTemplateBlock;
  allowSideDrop?: boolean;
  /** Column cells are structural wrappers — they get no selection chrome. */
  structuralCell?: boolean;
  dragSourceIsContainer?: boolean;
  selectedId: string | null;
  editable: boolean;
  dragActive: boolean;
  dragPreview: DragPreview;
  activeDropKey: string | null;
  onSelect: (id: string) => void;
  onChange: (
    id: string,
    change: (block: EmailTemplateBlock) => EmailTemplateBlock,
  ) => void;
  onDrop: (
    event: TargetedDragEvent<HTMLDivElement>,
    target: DropTarget,
  ) => void;
  onActivateDrop: (key: string, target: DropTarget) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onResize: (
    id: string,
    properties: Partial<
      Pick<
        EmailTemplateBlock["properties"],
        "widthPercent" | "minHeight" | "width"
      >
    >,
  ) => void;
  onQuickAdd: (type: EmailBlockType, target: BlockLocation) => void;
}): VNode {
  const demoData = useContext(DemoDataContext);
  const selected = selectedId === block.id;
  const style = styleValue(block);
  const imageBlock = ["image", "company_logo", "profile_photo"].includes(
    block.type,
  );
  const transactionalBlock = TRANSACTIONAL_CANVAS_TYPES.includes(block.type);
  const widthPercent = Math.max(
    20,
    Math.min(100, block.properties.widthPercent ?? 100),
  );
  const margin =
    block.styles.align === "center"
      ? "0 auto"
      : block.styles.align === "right"
        ? "0 0 0 auto"
        : "0 auto 0 0";
  const flushTransactional = ["support_contact", "legal_footer"].includes(
    block.type,
  );
  const transactionalStyle = flushTransactional
    ? "background:transparent;color:inherit;font-family:Arial,Helvetica,sans-serif;text-align:left;font-size:inherit;font-weight:400;line-height:1.5;padding:0;border:0;border-radius:0"
    : block.type === "invitation_action"
      ? "background:#f4f8ff;color:#24314d;font-family:Arial,Helvetica,sans-serif;text-align:left;font-size:14px;font-weight:400;line-height:1.45;padding:18px 20px;border:1px solid #cfdbef;border-radius:8px"
      : style;

  const beginResize = (
    event: TargetedEvent<HTMLButtonElement, PointerEvent>,
  ): void => {
    event.preventDefault();
    event.stopPropagation();
    const root = event.currentTarget.closest<HTMLElement>(".etb-canvas-block");
    const parent = root?.parentElement;
    if (!root || !parent) return;
    const start = root.getBoundingClientRect();
    const parentWidth = parent.getBoundingClientRect().width;
    const originX = event.clientX;
    const originY = event.clientY;
    let nextWidth = widthPercent;
    let nextHeight = Math.max(0, block.properties.minHeight ?? start.height);
    let nextImageWidth = block.properties.width;
    // The single diagonal handle serves both axes; only commit the axis the user
    // actually dragged along. Writing both unconditionally locked the height (or
    // width) on every drag — a width-only resize froze the block's auto height and
    // it then had to be corrected by hand.
    const AXIS_INTENT_PX = 4;
    let movedX = false;
    let movedY = false;
    const move = (pointer: PointerEvent): void => {
      if (imageBlock) {
        // Resize only the image itself — never the wrapping block/container.
        nextImageWidth = Math.max(
          24,
          Math.min(
            600,
            Math.round(
              (block.properties.width ?? start.width) +
                pointer.clientX -
                originX,
            ),
          ),
        );
        const image = root.querySelector<HTMLImageElement>(
          ".etb-image-block img",
        );
        if (image && nextImageWidth) image.style.width = `${nextImageWidth}px`;
        return;
      }
      if (Math.abs(pointer.clientX - originX) >= AXIS_INTENT_PX) movedX = true;
      if (Math.abs(pointer.clientY - originY) >= AXIS_INTENT_PX) movedY = true;
      if (movedX) {
        nextWidth = Math.max(
          20,
          Math.min(
            100,
            ((start.width + pointer.clientX - originX) / parentWidth) * 100,
          ),
        );
        root.style.width = `${nextWidth}%`;
      }
      if (movedY) {
        nextHeight = Math.max(
          24,
          Math.round(start.height + pointer.clientY - originY),
        );
        root.style.minHeight = `${nextHeight}px`;
      }
    };
    const finish = (): void => {
      globalThis.removeEventListener("pointermove", move);
      globalThis.removeEventListener("pointerup", finish);
      if (imageBlock) {
        onResize(block.id, { width: nextImageWidth });
        return;
      }
      if (!movedX && !movedY) return;
      onResize(block.id, {
        ...(movedX ? { widthPercent: Math.round(nextWidth) } : {}),
        ...(movedY ? { minHeight: nextHeight } : {}),
      });
    };
    globalThis.addEventListener("pointermove", move);
    globalThis.addEventListener("pointerup", finish, { once: true });
  };

  const renderChildren = (
    containerId: string,
    children: EmailTemplateBlock[],
  ): VNode => (
    <div class="etb-nested-stack">
      {children.length === 0 && (
        <div
          class="etb-empty-section"
          onClick={(event) => event.stopPropagation()}
        >
          <i class="fas fa-plus" aria-hidden="true" />
          <span>Drop content here</span>
        </div>
      )}
      {children.map((child, index) => (
        <div
          class={`etb-nested-slot ${child.id === selectedId && index > 0 ? "element-gap-before" : ""} ${child.id === selectedId && index < children.length - 1 ? "element-gap-after" : ""}`}
          style={`--etb-space-top:${child.properties.outerSpacing?.top ?? 0}px;--etb-space-right:${child.properties.outerSpacing?.right ?? 0}px;--etb-space-bottom:${child.properties.outerSpacing?.bottom ?? 0}px;--etb-space-left:${child.properties.outerSpacing?.left ?? 0}px`}
          key={child.id}
          onDragOver={(event) => {
            // Sections reorder at root level: let their drags bubble out.
            if (!dragActive || dragSourceIsContainer) return;
            event.preventDefault();
            // Without this, the event bubbles to the ROOT slot whose handler
            // runs last and overwrites this precise target every frame.
            event.stopPropagation();
            const bounds = event.currentTarget.getBoundingClientRect();
            const after = event.clientY > bounds.top + bounds.height / 2;
            const position = after ? index + 1 : index;
            onActivateDrop(`${containerId}:${position}`, {
              parentId: containerId,
              index: position,
            });
          }}
        >
          <DropGuide
            visible={dragActive}
            active={activeDropKey === `${containerId}:${index}`}
            preview={dragPreview}
            onActivate={() =>
              onActivateDrop(`${containerId}:${index}`, {
                parentId: containerId,
                index,
              })
            }
            onDrop={(event) => onDrop(event, { parentId: containerId, index })}
          />
          <CanvasBlock
            block={child}
            allowSideDrop
            selectedId={selectedId}
            editable={editable}
            dragActive={dragActive}
            dragSourceIsContainer={dragSourceIsContainer}
            dragPreview={dragPreview}
            activeDropKey={activeDropKey}
            onSelect={onSelect}
            onChange={onChange}
            onDrop={onDrop}
            onActivateDrop={onActivateDrop}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDuplicate={onDuplicate}
            onRemove={onRemove}
            onResize={onResize}
            onQuickAdd={onQuickAdd}
          />
        </div>
      ))}
      <DropGuide
        visible={dragActive || children.length === 0}
        active={activeDropKey === `${containerId}:${children.length}`}
        preview={dragPreview}
        onActivate={() =>
          onActivateDrop(`${containerId}:${children.length}`, {
            parentId: containerId,
            index: children.length,
          })
        }
        onDrop={(event) =>
          onDrop(event, { parentId: containerId, index: children.length })
        }
      />
    </div>
  );

  const beginDrag = (event: TargetedDragEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(EXISTING_MIME, block.id);
    event.currentTarget.closest(".etb-canvas-block")?.classList.add("dragging");
    // Deferred: mutating layout during dragstart dispatch aborts the drag in
    // Chromium. The guides may only expand AFTER the drag has actually begun.
    globalThis.setTimeout(() => onDragStart(block.id), 0);
  };
  const finishBlockDrag = (
    event: TargetedDragEvent<HTMLButtonElement>,
  ): void => {
    event.stopPropagation();
    event.currentTarget
      .closest(".etb-canvas-block")
      ?.classList.remove("dragging");
    onDragEnd();
  };
  const container = isEmailContainer(block);

  return (
    <div
      class={`etb-canvas-block ${container ? "container-block" : "content-block"} ${selected ? "selected" : ""} ${block.hidden ? "hidden-block" : ""}`}
      data-block-id={block.id}
      style={`width:${widthPercent}%;min-height:${Math.max(0, block.properties.minHeight ?? 0)}px;margin:${margin};display:flex;flex-direction:column;justify-content:${verticalFlex(block.properties.verticalAlign)}`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(block.id);
      }}
    >
      {dragActive && !container && allowSideDrop && (
        <div class="etb-side-drop-zones" aria-hidden="true">
          <SideDropZone
            side="left"
            preview={dragPreview}
            active={activeDropKey === `side:${block.id}:left`}
            onActivate={() =>
              onActivateDrop(`side:${block.id}:left`, {
                besideId: block.id,
                side: "left",
              })
            }
            onDrop={(event) =>
              onDrop(event, { besideId: block.id, side: "left" })
            }
          />
          <SideDropZone
            side="right"
            preview={dragPreview}
            active={activeDropKey === `side:${block.id}:right`}
            onActivate={() =>
              onActivateDrop(`side:${block.id}:right`, {
                besideId: block.id,
                side: "right",
              })
            }
            onDrop={(event) =>
              onDrop(event, { besideId: block.id, side: "right" })
            }
          />
        </div>
      )}
      {editable && !structuralCell && (
        <div
          class={`etb-block-chrome ${container ? "etb-chrome-rail" : "etb-chrome-bar"}`}
          aria-label={`${block.name} controls`}
          onClick={(event) => event.stopPropagation()}
        >
          <div class="etb-chrome-tools">
          <button
            type="button"
            class="etb-drag-handle"
            draggable={!block.locked}
            onDragStart={beginDrag}
            onDragEnd={finishBlockDrag}
            aria-label={`Drag ${block.name}`}
            title="Drag to move"
          >
            <i class="fas fa-up-down-left-right" />
          </button>
          <button
            type="button"
            disabled={block.locked}
            onClick={() => onDuplicate(block.id)}
            aria-label={`Duplicate ${block.name}`}
            title="Duplicate"
          >
            <LucideIcon name="Copy" size={14} />
          </button>
          {container && (
            <button
              type="button"
              onClick={() =>
                onChange(block.id, (current) => ({
                  ...current,
                  locked: !current.locked,
                }))
              }
              aria-label={block.locked ? "Unlock selection" : "Lock selection"}
              title={block.locked ? "Unlock" : "Lock"}
            >
              <i class={`fas ${block.locked ? "fa-lock-open" : "fa-lock"}`} />
            </button>
          )}
          {!block.locked && (
            <button
              type="button"
              class="danger"
              onClick={() => onRemove(block.id)}
              aria-label={`Delete ${block.name}`}
              title="Delete"
            >
              <LucideIcon name="Trash2" size={14} />
            </button>
          )}
          </div>
        </div>
      )}
      <div
        class="etb-canvas-body"
        style={`min-height:${Math.max(0, block.properties.minHeight ?? 0)}px;justify-content:${verticalFlex(block.properties.verticalAlign)}`}
      >
        {block.type === "divider" && (
          <div
            class="etb-divider-frame"
            style={`padding:${block.styles.padding.top}px ${block.styles.padding.right}px ${block.styles.padding.bottom}px ${block.styles.padding.left}px;background:${block.styles.backgroundColor}`}
          >
            <div
              class="etb-divider"
              style={`border-color:${block.styles.borderColor};border-width:${Math.max(1, block.styles.borderWidth)}px`}
            />
          </div>
        )}
        {block.type === "spacer" && (
          <div
            class="etb-spacer"
            style={`height:${block.properties.height ?? 24}px`}
          >
            <span>{block.properties.height ?? 24}px</span>
          </div>
        )}
        {imageBlock && (
          <div class="etb-image-block" style={style}>
            {block.properties.src ? (
              <img
                src={
                  SAMPLE_VARIABLES[block.properties.src] ?? block.properties.src
                }
                alt={applySampleVariables(block.properties.alt ?? "")}
                style={`width:${block.properties.width ?? 320}px;${block.type === "profile_photo" ? "border-radius:999px" : ""}`}
              />
            ) : (
              <div class="etb-image-placeholder">
                <i class="fas fa-cloud-arrow-up" />
                <strong>Add an image</strong>
                <span>Select this block and upload an approved asset.</span>
              </div>
            )}
          </div>
        )}
        {block.type === "button" && (
          <div
            class="etb-button-row"
            style={`text-align:${block.styles.align}`}
          >
            <span
              class="etb-editable-button-label"
              data-text-editor={demoData ? undefined : "true"}
              data-demo-text={demoData ? "true" : undefined}
              contentEditable={!demoData && editable && !block.locked}
              style={`background:${block.styles.backgroundColor};color:${block.styles.color};font-family:${EMAIL_FONT_STACK};font-size:${block.styles.fontSize}px;font-weight:${block.styles.fontWeight};line-height:${block.styles.lineHeight};letter-spacing:${block.styles.letterSpacing}px;border-radius:${block.styles.borderRadius}px;padding:${block.styles.padding.top}px ${block.styles.padding.right}px ${block.styles.padding.bottom}px ${block.styles.padding.left}px`}
              onInput={(event) => {
                if (!editable || block.locked) return;
                const label = event.currentTarget.textContent ?? "";
                if (label !== block.properties.label)
                  onChange(block.id, (current) => ({
                    ...current,
                    properties: { ...current.properties, label },
                  }));
              }}
            >
              {demoData
                ? applySampleVariables(block.properties.label ?? "")
                : block.properties.label}
            </span>
          </div>
        )}
        {transactionalBlock && (
          <div class="etb-transactional-shell" style={transactionalStyle}>
            <TransactionalCanvasContent
              block={block}
              editable={editable}
              onChange={(html) =>
                onChange(block.id, (current) => ({
                  ...current,
                  properties: { ...current.properties, html },
                }))
              }
              onPropertiesChange={(properties) =>
                onChange(block.id, (current) => ({
                  ...current,
                  properties: { ...current.properties, ...properties },
                }))
              }
            />
          </div>
        )}
        {block.type === "section" && (
          <div
            class="etb-layout-block single"
            style={`${style};justify-content:${verticalFlex(block.properties.verticalAlign)}`}
            /* Hovering anywhere in a section that isn't a guide targets the end
               of that section, so content can be dropped straight into it. */
            onDragOver={(event) => {
              if (!dragActive || dragSourceIsContainer) return;
              event.preventDefault();
              event.stopPropagation();
              onActivateDrop(`${block.id}:${block.children.length}`, {
                parentId: block.id,
                index: block.children.length,
              });
            }}
          >
            {renderChildren(block.id, block.children)}
          </div>
        )}
        {block.type === "columns" && (
          <div
            class="etb-layout-block columns"
            style={`${style};grid-template-columns:${(block.properties.columnWidths ?? block.children.map(() => 1)).map((value) => `${value}fr`).join(" ")}`}
          >
            {block.children.map((column, index) => (
              <div class="etb-layout-cell" key={column.id}>
                <CanvasBlock
                  block={column}
                  structuralCell
                  selectedId={selectedId}
                  editable={editable}
                  dragActive={dragActive}
                  dragSourceIsContainer={dragSourceIsContainer}
                  dragPreview={dragPreview}
                  activeDropKey={activeDropKey}
                  onSelect={onSelect}
                  onChange={onChange}
                  onDrop={onDrop}
                  onActivateDrop={onActivateDrop}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                        onDuplicate={onDuplicate}
                  onRemove={onRemove}
                  onResize={onResize}
                  onQuickAdd={onQuickAdd}
                />
              </div>
            ))}
          </div>
        )}
        {!imageBlock &&
          !transactionalBlock &&
          block.type !== "button" &&
          block.type !== "divider" &&
          block.type !== "spacer" &&
          block.type !== "section" &&
          block.type !== "columns" && (
            <div
              class="etb-block-surface"
              style={`${style};justify-content:${verticalFlex(block.properties.verticalAlign)}`}
            >
              <div
                class={blockHasRichText(block) ? "etb-editable-copy" : ""}
                data-rich-editor={
                  blockHasRichText(block) && !demoData ? "true" : undefined
                }
                data-demo-text={
                  blockHasRichText(block) && demoData ? "true" : undefined
                }
                contentEditable={
                  !demoData && editable && blockHasRichText(block) && !block.locked
                }
                dangerouslySetInnerHTML={{
                  __html: demoData
                    ? applySampleVariables(
                        sanitizeRichText(block.properties.html ?? ""),
                      )
                    : sanitizeRichText(block.properties.html ?? ""),
                }}
                onInput={(event) => {
                  if (!editable || !blockHasRichText(block)) return;
                  const html = sanitizeRichText(event.currentTarget.innerHTML);
                  if (html !== block.properties.html)
                    onChange(block.id, (current) => ({
                      ...current,
                      properties: { ...current.properties, html },
                    }));
                }}
                onBlur={(event) => {
                  if (!editable || !blockHasRichText(block)) return;
                  const html = sanitizeRichText(event.currentTarget.innerHTML);
                  if (html !== block.properties.html)
                    onChange(block.id, (current) => ({
                      ...current,
                      properties: { ...current.properties, html },
                    }));
                }}
              />
            </div>
          )}
      </div>
      {selected && editable && !block.locked && (
        <button
          type="button"
          class="etb-resize-handle diagonal"
          aria-label="Resize selection"
          onPointerDown={beginResize}
        >
          <i class="fas fa-up-right-and-down-left-from-center" />
        </button>
      )}
    </div>
  );
}

export function EmailTemplateBuilder({
  template,
  onBack,
  onToast,
  onCreateEditableCopy,
  creatingEditableCopy = false,
}: Props): VNode {
  const rootRef = useRef<HTMLDivElement>(null);
  const [emailDocument, setEmailDocument] = useState<EmailEditorSchema>(() =>
    normalizeEmailDocument(template.editorSchema),
  );
  const documentRef = useRef(emailDocument);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<LeftTab>("content");
  const [blockSearch, setBlockSearch] = useState("");
  const [name, setName] = useState(template.name);
  const [subject, setSubject] = useState(template.subject);
  const [preheader, setPreheader] = useState(template.preheader);
  const nameRef = useRef(name);
  const subjectRef = useRef(subject);
  const preheaderRef = useRef(preheader);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("desktop");
  const [zoom, setZoom] = useState(100);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [transactionalLibraryOpen, setTransactionalLibraryOpen] =
    useState(false);
  const transactionalDefinitions = useMemo(
    () =>
      EMAIL_BLOCK_DEFINITIONS.filter((item) => item.group === "Transactional"),
    [],
  );
  const [transactionalPreviewType, setTransactionalPreviewType] =
    useState<EmailBlockType>("welcome_header");
  const [previewTab, setPreviewTab] = useState<"html" | "text">("html");
  const [showDemoData, setShowDemoData] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [draggingSource, setDraggingSource] = useState<string | null>(null);
  const [activeDropKey, setActiveDropKey] = useState<string | null>(null);
  /** The guide the pointer last entered. A drop always resolves to this, so a
      few pixels of pointer drift never silently appends to the end. */
  const activeDropTargetRef = useRef<DropTarget | null>(null);
  const [activeTextTarget, setActiveTextTarget] = useState<HTMLElement | null>(
    null,
  );
  const uploadRef = useRef<HTMLInputElement>(null);
  const backgroundUploadRef = useRef<HTMLInputElement>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const undoStackRef = useRef<EmailEditorSchema[]>([]);
  const redoStackRef = useRef<EmailEditorSchema[]>([]);
  const [historyState, setHistoryState] = useState({
    canUndo: false,
    canRedo: false,
  });
  const saveMutation = useUpdateEmailTemplateDraft();
  const chromeMutation = useUpdateEmailChrome();
  const savedSectionsQuery = useSavedSections();
  const createSavedSection = useCreateSavedSection();
  const deleteSavedSection = useDeleteSavedSection();
  const canEdit =
    template.status === "draft" || template.status === "changes_requested";
  const selected = findBlock(emailDocument.blocks, selectedId);
  const selectedParent = selected
    ? findParentBlock(emailDocument.blocks, selected.id)
    : null;
  const selectedIsContainer = selected ? isEmailContainer(selected) : false;
  const selectedHasRichText = selected ? blockHasRichText(selected) : false;
  const selectedHasSurface = selected
    ? selectedIsContainer ||
      selected.styles.backgroundColor !== "transparent" ||
      selected.styles.borderWidth > 0 ||
      ["image", "company_logo", "profile_photo", "button"].includes(
        selected.type,
      )
    : false;
  const selectedIsButton =
    selected?.type === "button" || selected?.type === "invitation_action";
  /** Text blocks and buttons get their typography from the floating toolbar. */
  const selectedShowsTypography = selected
    ? !selectedIsContainer &&
      !selectedHasRichText &&
      !selectedIsButton &&
      !blockHasRichText(selected) &&
      !["image", "company_logo", "profile_photo", "divider", "spacer"].includes(
        selected.type,
      )
    : false;
  const selectedSection =
    selected?.type === "section"
      ? selected
      : selectedParent?.type === "section"
        ? selectedParent
        : null;
  const activeSectionId = selectedIsContainer
    ? (selected?.id ?? null)
    : selectedParent?.type === "section"
      ? selectedParent.id
      : null;
  const activeTextStyle = selected?.styles ?? {
    color: "#24314d",
    fontSize: 16,
  };
  // Preview shows what actually gets SENT: the MJML-compiled HTML.
  const [preview, setPreview] = useState<{
    html: string;
    text: string;
    errors: string[];
  } | null>(null);
  useEffect(() => {
    if (!previewOpen) return;
    let cancelled = false;
    setPreview(null);
    void compileEmailDocument(emailDocument, name || "Untitled template").then(
      (compiled) => {
        if (cancelled) return;
        setPreview({
          html: applySampleVariables(compiled.html),
          text: applySampleVariables(compiled.text),
          errors: compiled.errors,
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [previewOpen, emailDocument, name]);
  const transactionalPreview = useMemo(() => {
    const document = createBlankEmailDocument();
    document.blocks = [
      createEmailSection([createEmailBlock(transactionalPreviewType)]),
    ];
    const rendered = renderEmailPreview(
      document,
      "Transactional block preview",
    );
    return {
      html: applySampleVariables(rendered.html),
      text: applySampleVariables(rendered.text),
    };
  }, [transactionalPreviewType]);
  const transactionalDefinition = transactionalDefinitions.find(
    (item) => item.type === transactionalPreviewType,
  );
  const transactionalDetail = TRANSACTIONAL_DETAILS[transactionalPreviewType];
  const filteredDefinitions = useMemo(() => {
    const query = blockSearch.trim().toLowerCase();
    return EMAIL_BLOCK_DEFINITIONS.filter(
      (item) =>
        !query ||
        `${item.label} ${item.description}`.toLowerCase().includes(query),
    );
  }, [blockSearch]);
  const dragPreview = useMemo<DragPreview>(() => {
    if (!draggingSource) return { label: "Content", icon: "fa-shapes" };
    const type = draggingSource.startsWith("new:")
      ? (draggingSource.slice(4) as EmailBlockType)
      : null;
    const definition = type
      ? EMAIL_BLOCK_DEFINITIONS.find((item) => item.type === type)
      : null;
    const existing = type
      ? null
      : findBlock(emailDocument.blocks, draggingSource);
    const existingDefinition = existing
      ? EMAIL_BLOCK_DEFINITIONS.find((item) => item.type === existing.type)
      : null;
    return {
      label: definition?.label ?? existing?.name ?? "Content",
      icon: definition?.icon ?? existingDefinition?.icon ?? "fa-shapes",
    };
  }, [draggingSource, emailDocument.blocks]);
  const transactionalSearchMatch = useMemo(() => {
    const query = blockSearch.trim().toLowerCase();
    return (
      !query ||
      transactionalDefinitions.some((item) =>
        `${item.label} ${item.description} ${TRANSACTIONAL_DETAILS[item.type]?.purpose ?? ""}`
          .toLowerCase()
          .includes(query),
      )
    );
  }, [blockSearch, transactionalDefinitions]);
  /** Sections being dragged reorder at ROOT level; content nests. */
  const dragSourceIsContainer = useMemo(() => {
    if (!draggingSource) return false;
    if (draggingSource.startsWith("new:"))
      return isEmailContainer({
        type: draggingSource.slice(4) as EmailBlockType,
      });
    const dragged = findBlock(emailDocument.blocks, draggingSource);
    return dragged ? isEmailContainer(dragged) : false;
  }, [draggingSource, emailDocument.blocks]);
  // A chrome section's children are chrome too, so resolve the role from the
  // selected block's ancestry rather than the block alone.
  const selectedChromeRole = useMemo(() => {
    if (!selectedId) return null;
    const walk = (
      blocks: EmailTemplateBlock[],
      inherited: EmailChromeRole | null,
    ): EmailChromeRole | null => {
      for (const block of blocks) {
        const role = block.properties.chromeRole ?? inherited;
        if (block.id === selectedId) return role;
        const found = walk(block.children, role);
        if (found !== null) return found;
      }
      return null;
    };
    return walk(emailDocument.blocks, null);
  }, [emailDocument.blocks, selectedId]);

  const selectedOuterSpacing = selected?.properties.outerSpacing ?? {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };

  /**
   * The canvas draws the SAME gutter projection the email renderer applies, so what the editor
   * shows is what gets sent. It is render-only: every edit path resolves the block by id from
   * `documentRef.current`, so a projected padding can never be written back into the model and
   * become a second authority for the gutter.
   */
  const canvasBlocks = useMemo(
    () => applyPageGutter(emailDocument).blocks,
    [emailDocument],
  );

  /**
   * A TOP-LEVEL section: the only kind whose horizontal inset comes from the document's Page
   * padding. A nested section sits inside that gutter already and keeps its own four-side control.
   */
  const isPageSection =
    selected?.type === "section" &&
    emailDocument.blocks.some((block) => block.id === selected.id);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const handleFocus = (event: FocusEvent): void => {
      const element =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(
              '[data-rich-editor="true"],[data-text-editor="true"]',
            )
          : null;
      if (!canEdit || !element || !root.contains(element)) return;
      const blockId =
        element.closest<HTMLElement>("[data-block-id]")?.dataset.blockId;
      if (blockId) setSelectedId(blockId);
      setActiveTextTarget(element);
    };
    const handlePointer = (event: PointerEvent): void => {
      const element = event.target instanceof Element ? event.target : null;
      if (
        element?.closest(".etb-floating-text-toolbar") ||
        element?.closest('[data-rich-editor="true"]') ||
        element?.closest('[data-text-editor="true"]')
      )
        return;
      setActiveTextTarget(null);
    };
    // `focusin` only fires when focus ENTERS an editor. Clicking away to a
    // control that keeps DOM focus (or that we cleared on pointerdown) and then
    // clicking/selecting back inside the SAME editor fires no focusin at all,
    // so the toolbar never returned. Recover from the live selection instead:
    // the editor must still hold focus, which keeps genuine outside clicks clear.
    const handleSelection = (): void => {
      if (!canEdit) return;
      const active = globalThis.document.activeElement;
      const element =
        active instanceof Element
          ? active.closest<HTMLElement>(
              '[data-rich-editor="true"],[data-text-editor="true"]',
            )
          : null;
      if (!element || !root.contains(element)) return;
      const selection = globalThis.document.getSelection();
      if (
        !selection?.rangeCount ||
        !element.contains(selection.getRangeAt(0).commonAncestorContainer)
      )
        return;
      const blockId =
        element.closest<HTMLElement>("[data-block-id]")?.dataset.blockId;
      if (blockId) setSelectedId(blockId);
      setActiveTextTarget(element);
    };
    root.addEventListener("focusin", handleFocus);
    globalThis.document.addEventListener("pointerdown", handlePointer);
    globalThis.document.addEventListener("selectionchange", handleSelection);
    return () => {
      root.removeEventListener("focusin", handleFocus);
      globalThis.document.removeEventListener("pointerdown", handlePointer);
      globalThis.document.removeEventListener(
        "selectionchange",
        handleSelection,
      );
    };
  }, [canEdit]);

  useEffect(() => {
    const targetBlockId =
      activeTextTarget?.closest<HTMLElement>("[data-block-id]")?.dataset
        .blockId;
    if (!selectedId || (targetBlockId && targetBlockId !== selectedId))
      setActiveTextTarget(null);
  }, [selectedId]);

  // A re-render (autosave, style change, drag) can replace the editable element
  // in the DOM. The captured node is then detached, the toolbar has nothing to
  // measure and silently disappears — re-point it at the live node instead.
  useEffect(() => {
    if (!activeTextTarget || activeTextTarget.isConnected) return;
    const root = rootRef.current;
    if (!root || !selectedId) {
      setActiveTextTarget(null);
      return;
    }
    const replacement = root.querySelector<HTMLElement>(
      `[data-block-id="${selectedId}"] [data-rich-editor="true"], [data-block-id="${selectedId}"] [data-text-editor="true"]`,
    );
    setActiveTextTarget(replacement ?? null);
  });

  useEffect(
    () => () => {
      if (autosaveTimerRef.current !== null)
        globalThis.clearTimeout(autosaveTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      const editing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      const command = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (command && key === "s" && canEdit) {
        event.preventDefault();
        void persist(true);
        return;
      }
      if (editing || !canEdit) return;
      if (command && key === "z" && event.shiftKey) {
        event.preventDefault();
        redoChange();
      } else if (command && key === "z") {
        event.preventDefault();
        undoChange();
      } else if (command && key === "y") {
        event.preventDefault();
        redoChange();
      } else if (command && key === "d" && selectedId) {
        event.preventDefault();
        duplicateBlock(selectedId);
      } else if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedId
      ) {
        const block = findBlock(documentRef.current.blocks, selectedId);
        if (!block || block.locked) return;
        event.preventDefault();
        deleteBlock(selectedId);
      } else if (event.altKey && event.key === "ArrowUp" && selectedId) {
        event.preventDefault();
        moveBlock(selectedId, -1);
      } else if (event.altKey && event.key === "ArrowDown" && selectedId) {
        event.preventDefault();
        moveBlock(selectedId, 1);
      } else if (event.key === "Escape") {
        finishDrag();
        setSelectedId(null);
      }
    };
    globalThis.addEventListener("keydown", handleKeyDown);
    return () => globalThis.removeEventListener("keydown", handleKeyDown);
  }, [canEdit, selectedId]);

  function queueAutosave(): void {
    if (!canEdit) return;
    setSaveState("unsaved");
    if (autosaveTimerRef.current !== null)
      globalThis.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = globalThis.setTimeout(
      () => void persist(),
      1200,
    ) as unknown as number;
  }

  function commit(next: EmailEditorSchema, recordHistory = true): void {
    if (!canEdit) return;
    if (recordHistory) {
      undoStackRef.current.push(structuredClone(documentRef.current));
      if (undoStackRef.current.length > 60) undoStackRef.current.shift();
      redoStackRef.current = [];
      setHistoryState({ canUndo: true, canRedo: false });
    }
    documentRef.current = next;
    setEmailDocument(next);
    queueAutosave();
  }

  async function persist(notify = false): Promise<boolean> {
    if (!canEdit) return false;
    setSaveState("saving");
    try {
      // The persisted artifacts are the production outputs: MJML-compiled HTML
      // plus the schema-derived plain text. The server recompiles before send.
      const compiled = await compileEmailDocument(
        documentRef.current,
        nameRef.current || "Untitled template",
      );
      await saveMutation.mutateAsync({
        id: template.id,
        name: nameRef.current.trim(),
        subject: subjectRef.current,
        preheader: preheaderRef.current,
        editorSchema: documentRef.current,
        compiledHtml: compiled.html,
        compiledText: compiled.text,
      });
      setSaveState("saved");
      if (notify) onToast("Draft saved.");
      return true;
    } catch (error) {
      setSaveState("failed");
      if (notify)
        onToast(
          error instanceof Error ? error.message : "Draft could not be saved.",
        );
      return false;
    }
  }

  /**
   * Pushes THIS template's header/footer out as the shared chrome. The blocks
   * are edited in place like any other block; this is the only step that
   * reaches other templates, so it is always an explicit action.
   */
  async function applyChromeToAllTemplates(): Promise<void> {
    if (!canEdit) return;
    const { header, footer } = extractEmailChrome(documentRef.current);
    if (!header.length && !footer.length) {
      onToast("This template has no shared header or footer to apply.");
      return;
    }
    const confirmed = await dialog.confirm({
      title: "Apply this header & footer to all templates?",
      text: "Every editable template will use this header and footer. Published versions keep the chrome they were published with.",
      confirmText: "Apply to all",
    });
    if (!confirmed) return;
    try {
      if (saveState !== "saved") await persist();
      const result = await chromeMutation.mutateAsync({ header, footer });
      const synced = result.syncedTemplateIds.length;
      const skipped = result.skippedTemplateIds.length;
      onToast(
        synced === 0
          ? "Header & footer saved. Every other template already matched."
          : `Header & footer applied to ${synced} ${synced === 1 ? "template" : "templates"}` +
            (skipped
              ? ` · ${skipped} published ${skipped === 1 ? "version keeps" : "versions keep"} their own.`
              : "."),
      );
    } catch (error) {
      onToast(
        error instanceof Error
          ? error.message
          : "Header & footer could not be applied.",
      );
    }
  }

  function addBlock(type: EmailBlockType, target?: BlockLocation): void {
    const block = applyDocumentTypography(
      createEmailBlock(type),
      documentRef.current.settings,
    );
    const sharedSection =
      selectedSection && !selectedSection.locked ? selectedSection : null;
    const resolvedTarget =
      target ??
      (sharedSection
        ? { parentId: sharedSection.id, index: sharedSection.children.length }
        : { parentId: null, index: documentRef.current.blocks.length });
    const inserted =
      resolvedTarget.parentId === null ? createEmailSection([block]) : block;
    const blocks = insertBlockAt(
      documentRef.current.blocks,
      resolvedTarget,
      inserted,
    );
    commit({ ...documentRef.current, blocks });
    setSelectedId(block.id);
  }

  function addLayout(columns: 1 | 2 | 3 | 4, widths?: number[]): void {
    const block = layoutBlock(columns, widths);
    commit({
      ...documentRef.current,
      blocks: [...documentRef.current.blocks, block],
    });
    setSelectedId(block.id);
  }

  function addColumnToSection(sectionId: string, side: "left" | "right"): void {
    const section = findBlock(documentRef.current.blocks, sectionId);
    const location = findLocation(documentRef.current.blocks, sectionId);
    if (!location || section?.type !== "section" || section.locked) return;
    const empty = createEmailSection();
    empty.name = "New column";
    empty.properties.minHeight = 0;
    empty.styles.padding = { top: 0, right: 0, bottom: 0, left: 0 };
    empty.styles.borderWidth = 0;
    empty.styles.backgroundColor = "transparent";
    const parent = location.parentId
      ? findBlock(documentRef.current.blocks, location.parentId)
      : null;
    if (parent?.type === "columns") {
      if (parent.children.length >= 4) {
        onToast("Email layouts support up to four columns.");
        return;
      }
      const insertionIndex =
        side === "left" ? location.index : location.index + 1;
      const nextCount = parent.children.length + 1;
      updateBlock(parent.id, (current) => {
        const children = [...current.children];
        children.splice(insertionIndex, 0, empty);
        return {
          ...current,
          properties: {
            ...current.properties,
            columns: Math.min(4, nextCount) as 1 | 2 | 3 | 4,
            columnWidths: children.map(() => 100 / children.length),
          },
          children,
        };
      });
      setSelectedId(empty.id);
      return;
    }
    const populated = createEmailSection(section.children);
    populated.name = "Column 1";
    populated.properties.minHeight = 0;
    populated.styles = {
      ...populated.styles,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      borderWidth: 0,
      backgroundColor: "transparent",
    };
    const layout: EmailTemplateBlock = {
      ...section,
      type: "columns",
      name: "2-column section",
      properties: { ...section.properties, columns: 2, columnWidths: [50, 50] },
      children: side === "left" ? [empty, populated] : [populated, empty],
    };
    commit({
      ...documentRef.current,
      blocks: replaceBlockAt(documentRef.current.blocks, location, layout),
    });
    setSelectedId(empty.id);
  }

  function mergeColumnsToSection(columnsId: string): void {
    const columns = findBlock(documentRef.current.blocks, columnsId);
    const location = findLocation(documentRef.current.blocks, columnsId);
    if (!location || columns?.type !== "columns" || columns.locked) return;
    const children = columns.children.flatMap((column) =>
      column.type === "section" ? column.children : [column],
    );
    const section: EmailTemplateBlock = {
      ...columns,
      type: "section",
      name: "Full-width section",
      properties: { ...columns.properties, columns: 1, columnWidths: [100] },
      children,
    };
    commit({
      ...documentRef.current,
      blocks: replaceBlockAt(documentRef.current.blocks, location, section),
    });
    setSelectedId(section.id);
  }

  function addMany(blocks: EmailTemplateBlock[]): void {
    const section = createEmailSection(blocks);
    section.name = "Saved section";
    commit({
      ...documentRef.current,
      blocks: [...documentRef.current.blocks, section],
    });
    setSelectedId(blocks[0]?.id ?? null);
  }

  function updateSelected(
    change: (block: EmailTemplateBlock) => EmailTemplateBlock,
  ): void {
    if (!selectedId) return;
    updateBlock(selectedId, change);
  }

  function updateBlock(
    id: string,
    change: (block: EmailTemplateBlock) => EmailTemplateBlock,
  ): void {
    commit({
      ...documentRef.current,
      blocks: mapBlocks(documentRef.current.blocks, id, change),
    });
  }

  function moveBlock(id: string, direction: -1 | 1): void {
    const location = findLocation(documentRef.current.blocks, id);
    const item = findBlock(documentRef.current.blocks, id);
    if (!location || !item || item.locked) return;
    const siblings =
      location.parentId === null
        ? documentRef.current.blocks
        : (findBlock(documentRef.current.blocks, location.parentId)?.children ??
          []);
    const targetIndex = location.index + direction;
    if (targetIndex < 0 || targetIndex >= siblings.length) return;
    const without = removeBlock(documentRef.current.blocks, id);
    const blocks = insertBlockAt(
      without,
      { parentId: location.parentId, index: targetIndex },
      item,
    );
    commit({ ...documentRef.current, blocks });
  }

  function duplicateBlock(id: string): void {
    const source = findBlock(documentRef.current.blocks, id);
    const location = findLocation(documentRef.current.blocks, id);
    if (!source || !location || source.locked) return;
    const clone = cloneEmailBlock(source);
    const blocks = insertBlockAt(
      documentRef.current.blocks,
      { parentId: location.parentId, index: location.index + 1 },
      clone,
    );
    commit({ ...documentRef.current, blocks });
    setSelectedId(clone.id);
  }

  function deleteBlock(id: string): void {
    const source = findBlock(documentRef.current.blocks, id);
    if (!source || source.locked) return;
    const location = findLocation(documentRef.current.blocks, id);
    const blocks = removeBlock(documentRef.current.blocks, id);
    commit({ ...documentRef.current, blocks });
    setSelectedId(
      location?.parentId && findBlock(blocks, location.parentId)
        ? location.parentId
        : (blocks[
            Math.min(location?.index ?? 0, Math.max(0, blocks.length - 1))
          ]?.id ?? null),
    );
  }

  function undoChange(): void {
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    redoStackRef.current.push(structuredClone(documentRef.current));
    documentRef.current = previous;
    setEmailDocument(previous);
    setHistoryState({
      canUndo: undoStackRef.current.length > 0,
      canRedo: true,
    });
    queueAutosave();
  }

  function redoChange(): void {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(structuredClone(documentRef.current));
    documentRef.current = next;
    setEmailDocument(next);
    setHistoryState({
      canUndo: true,
      canRedo: redoStackRef.current.length > 0,
    });
    queueAutosave();
  }

  function dropAt(
    event: TargetedDragEvent<HTMLElement>,
    target: DropTarget,
  ): void {
    event.preventDefault();
    event.stopPropagation();
    if (!event.dataTransfer) return;
    const rawType = event.dataTransfer.getData(BLOCK_MIME);
    const existingId = event.dataTransfer.getData(EXISTING_MIME);
    if (rawType) {
      const block = applyDocumentTypography(
        createEmailBlock(rawType as EmailBlockType),
        documentRef.current.settings,
      );
      if ("besideId" in target) {
        const placed = placeBlockBeside(
          documentRef.current.blocks,
          target.besideId,
          block,
          target.side,
        );
        if (!placed) {
          onToast("That block cannot be converted into a column layout.");
          finishDrag();
          return;
        }
        commit({ ...documentRef.current, blocks: placed.blocks });
        setSelectedId(block.id);
      } else {
        const inserted =
          target.parentId === null ? createEmailSection([block]) : block;
        const blocks = insertBlockAt(
          documentRef.current.blocks,
          target,
          inserted,
        );
        commit({ ...documentRef.current, blocks });
        setSelectedId(block.id);
      }
      finishDrag();
      return;
    }
    if (existingId) {
      const moved = findBlock(documentRef.current.blocks, existingId);
      const source = findLocation(documentRef.current.blocks, existingId);
      if (!moved || !source) return;
      if ("besideId" in target) {
        if (
          target.besideId === existingId ||
          findBlock(moved.children, target.besideId)
        ) {
          onToast(
            "A block cannot be placed beside itself or one of its children.",
          );
          finishDrag();
          return;
        }
        const withoutSource = removeBlock(
          documentRef.current.blocks,
          existingId,
        );
        const placed = placeBlockBeside(
          withoutSource,
          target.besideId,
          moved,
          target.side,
        );
        if (!placed) {
          onToast("That block cannot be converted into a column layout.");
          finishDrag();
          return;
        }
        commit({ ...documentRef.current, blocks: placed.blocks });
        setSelectedId(moved.id);
        finishDrag();
        return;
      }
      if (
        target.parentId === existingId ||
        (target.parentId && findBlock(moved.children, target.parentId))
      ) {
        onToast("A block cannot be moved inside itself.");
        finishDrag();
        return;
      }
      const adjustedTarget = {
        parentId: target.parentId,
        index:
          source.parentId === target.parentId && source.index < target.index
            ? target.index - 1
            : target.index,
      };
      const without = removeBlock(documentRef.current.blocks, existingId);
      const inserted =
        adjustedTarget.parentId === null && !isEmailContainer(moved)
          ? createEmailSection([moved])
          : moved;
      const blocks = pruneEmptiedSection(
        insertBlockAt(without, adjustedTarget, inserted),
        source.parentId,
        adjustedTarget.parentId,
      );
      commit({ ...documentRef.current, blocks });
      setSelectedId(moved.id);
    }
    finishDrag();
  }

  function updateTypography(change: Partial<EmailTypographyScale>): void {
    commit({
      ...documentRef.current,
      settings: {
        ...documentRef.current.settings,
        typography: { ...documentRef.current.settings.typography, ...change },
      },
    });
  }

  /**
   * TEMPORARY dev helper — see the "Copy Layout" button. Copies the current
   * document as JSON so it can be pasted back and baked into the default
   * template. Falls back to a manual selection when the clipboard is blocked.
   */
  async function copyLayoutJson(): Promise<void> {
    const json = JSON.stringify(documentRef.current);
    try {
      await globalThis.navigator.clipboard.writeText(json);
      onToast(`Layout JSON copied (${json.length.toLocaleString()} chars).`);
      return;
    } catch {
      const field = globalThis.document.createElement("textarea");
      field.value = json;
      field.style.position = "fixed";
      field.style.opacity = "0";
      globalThis.document.body.appendChild(field);
      field.select();
      const copied = globalThis.document.execCommand?.("copy") ?? false;
      field.remove();
      onToast(
        copied
          ? `Layout JSON copied (${json.length.toLocaleString()} chars).`
          : "Could not copy the layout JSON.",
      );
    }
  }

  function updateStatusItem(
    index: number,
    change: Partial<EmailStatusItem>,
  ): void {
    updateSelected((block) => {
      const statusItems = [...(block.properties.statusItems ?? [])];
      const current = statusItems[index];
      if (!current) return block;
      statusItems[index] = { ...current, ...change };
      return { ...block, properties: { ...block.properties, statusItems } };
    });
  }

  function moveStatusItem(index: number, direction: -1 | 1): void {
    updateSelected((block) => {
      const statusItems = [...(block.properties.statusItems ?? [])];
      const next = index + direction;
      const current = statusItems[index];
      const swap = statusItems[next];
      if (!current || !swap) return block;
      statusItems[index] = swap;
      statusItems[next] = current;
      return { ...block, properties: { ...block.properties, statusItems } };
    });
  }

  function removeStatusItem(index: number): void {
    updateSelected((block) => ({
      ...block,
      properties: {
        ...block.properties,
        statusItems: (block.properties.statusItems ?? []).filter(
          (_item, position) => position !== index,
        ),
      },
    }));
  }

  function addStatusItem(): void {
    updateSelected((block) => ({
      ...block,
      properties: {
        ...block.properties,
        statusItems: [
          ...(block.properties.statusItems ?? []),
          { title: "New item", meta: "", status: "pending" },
        ],
      },
    }));
  }

  function updateFactTile(index: number, change: Partial<EmailFactTile>): void {
    updateSelected((block) => {
      const factTiles = [...(block.properties.factTiles ?? [])];
      const current = factTiles[index];
      if (!current) return block;
      factTiles[index] = { ...current, ...change };
      return { ...block, properties: { ...block.properties, factTiles } };
    });
  }

  function moveFactTile(index: number, direction: -1 | 1): void {
    updateSelected((block) => {
      const factTiles = [...(block.properties.factTiles ?? [])];
      const next = index + direction;
      const current = factTiles[index];
      const swap = factTiles[next];
      if (!current || !swap) return block;
      factTiles[index] = swap;
      factTiles[next] = current;
      return { ...block, properties: { ...block.properties, factTiles } };
    });
  }

  function removeFactTile(index: number): void {
    updateSelected((block) => ({
      ...block,
      properties: {
        ...block.properties,
        factTiles: (block.properties.factTiles ?? []).filter(
          (_tile, position) => position !== index,
        ),
      },
    }));
  }

  function addFactTile(): void {
    updateSelected((block) => ({
      ...block,
      properties: {
        ...block.properties,
        factTiles: [
          ...(block.properties.factTiles ?? []),
          { icon: "CheckCircle", label: "New label", value: "Value", caption: "" },
        ],
      },
    }));
  }

  /**
   * Auto-scrolls the stage while a drag hovers near its top or bottom edge, so
   * a long email can be traversed without dropping. The canvas is never
   * scrolled programmatically anywhere else during a drag — that was the
   * "jumps to the top" behaviour.
   */
  useEffect(() => {
    if (!draggingSource) return;
    const scroller = rootRef.current?.querySelector<HTMLElement>(
      ".etb-stage-scroll",
    );
    if (!scroller) return;
    const EDGE = 72;
    const MAX_STEP = 18;
    let pointerX: number | null = null;
    let pointerY: number | null = null;
    let frame = 0;
    const track = (event: DragEvent): void => {
      pointerX = event.clientX;
      pointerY = event.clientY;
    };
    const step = (): void => {
      frame = globalThis.requestAnimationFrame(step);
      if (pointerX === null || pointerY === null) return;
      const bounds = scroller.getBoundingClientRect();
      // Never scroll while the pointer is outside the stage (e.g. still over
      // the palette) — that was the jump-to-top at drag start.
      if (pointerX < bounds.left || pointerX > bounds.right) return;
      const fromTop = pointerY - bounds.top;
      const fromBottom = bounds.bottom - pointerY;
      if (fromTop < EDGE && fromTop > -EDGE) {
        scroller.scrollTop -= Math.ceil(((EDGE - fromTop) / EDGE) * MAX_STEP);
      } else if (fromBottom < EDGE && fromBottom > -EDGE) {
        scroller.scrollTop += Math.ceil(
          ((EDGE - fromBottom) / EDGE) * MAX_STEP,
        );
      }
    };
    // Capture phase: guides and slots stopPropagation on dragover, which
    // starves a bubble-phase listener and kills the auto-scroll.
    globalThis.document.addEventListener("dragover", track, true);
    frame = globalThis.requestAnimationFrame(step);
    return () => {
      globalThis.document.removeEventListener("dragover", track, true);
      globalThis.cancelAnimationFrame(frame);
    };
  }, [draggingSource]);

  async function uploadBackground(
    event: TargetedEvent<HTMLInputElement, Event>,
  ): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !selected) return;
    if (!canEdit) {
      onToast(
        "Published templates are read-only. Create an editable draft version first.",
      );
      return;
    }
    setImageUploading(true);
    try {
      const asset = await uploadEmailTemplateAsset(template.id, file);
      updateSelected((block) => ({
        ...block,
        properties: {
          ...block.properties,
          backgroundImage: asset.publicUrl,
          backgroundDisplay: block.properties.backgroundDisplay ?? "scale",
        },
      }));
      onToast("Background image applied.");
    } catch (error) {
      onToast(
        error instanceof Error ? error.message : "Image could not be uploaded.",
      );
    } finally {
      setImageUploading(false);
    }
  }

  function insertPreset(block: EmailTemplateBlock): void {
    if (!canEdit) return;
    commit({
      ...documentRef.current,
      blocks: [...documentRef.current.blocks, block],
    });
    setSelectedId(block.id);
  }

  async function saveSelectionAsSection(): Promise<void> {
    const block = selected;
    if (!block || !isEmailContainer(block)) return;
    const name = globalThis.prompt(
      "Name this saved section",
      block.name || "Saved section",
    );
    if (name === null) return;
    try {
      await createSavedSection.mutateAsync({ name, block });
      onToast(`Saved "${name.trim()}" for reuse.`);
    } catch (error) {
      onToast(
        error instanceof Error
          ? error.message
          : "The section could not be saved.",
      );
    }
  }

  async function removeSavedSection(id: string, name: string): Promise<void> {
    try {
      await deleteSavedSection.mutateAsync(id);
      onToast(`Removed "${name}".`);
    } catch (error) {
      onToast(
        error instanceof Error
          ? error.message
          : "The saved section could not be removed.",
      );
    }
  }

  function activateDrop(key: string, target: DropTarget): void {
    activeDropTargetRef.current = target;
    setActiveDropKey(key);
  }

  function finishDrag(): void {
    activeDropTargetRef.current = null;
    setDraggingSource(null);
    setActiveDropKey(null);
  }

  function setMetadata(
    field: "name" | "subject" | "preheader",
    value: string,
  ): void {
    if (field === "name") {
      nameRef.current = value;
      setName(value);
    }
    if (field === "subject") {
      subjectRef.current = value;
      setSubject(value);
    }
    if (field === "preheader") {
      preheaderRef.current = value;
      setPreheader(value);
    }
    queueAutosave();
  }

  async function leaveBuilder(): Promise<void> {
    if (autosaveTimerRef.current !== null)
      globalThis.clearTimeout(autosaveTimerRef.current);
    if (canEdit && saveState !== "saved" && !(await persist())) return;
    onBack();
  }

  async function uploadImage(
    event: TargetedEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !selected) return;
    if (!canEdit) {
      onToast(
        "Published templates are read-only. Create an editable draft version first.",
      );
      return;
    }
    setImageUploading(true);
    try {
      const asset = await uploadEmailTemplateAsset(template.id, file);
      updateSelected((block) => ({
        ...block,
        properties: {
          ...block.properties,
          src: asset.publicUrl,
          alt: block.properties.alt?.trim()
            ? block.properties.alt
            : file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "),
          width: Math.min(asset.width, 560),
        },
      }));
      onToast("Image added to the template.");
    } catch (error) {
      onToast(
        error instanceof Error ? error.message : "Image could not be uploaded.",
      );
    } finally {
      setImageUploading(false);
    }
  }

  function insertVariable(variable: string): void {
    if (!selected || !blockHasRichText(selected)) {
      onToast("Select a text-based block before inserting a variable.");
      return;
    }
    updateSelected((block) => ({
      ...block,
      properties: {
        ...block.properties,
        html: `${block.properties.html ?? ""} ${variable}`.trim(),
      },
    }));
  }

  const updateStyle = <K extends keyof EmailBlockStyles>(
    key: K,
    value: EmailBlockStyles[K],
  ): void => {
    updateSelected((block) => ({
      ...block,
      styles: { ...block.styles, [key]: value },
    }));
  };

  return (
    <div ref={rootRef} class={`etb-root ${canEdit ? "" : "is-readonly"}`}>
      <header class="etb-toolbar">
        <div class="etb-toolbar-brand">
          <button
            type="button"
            class="etb-tool-button"
            onClick={() => void leaveBuilder()}
            aria-label="Back to templates"
          >
            <i class="fas fa-arrow-left" />
          </button>
          <span class="etb-studio-mark">
            <i class="fas fa-envelope" />
          </span>
          <div>
            <small>Email Studio · {pretty(template.family)}</small>
            <input
              value={name}
              disabled={!canEdit}
              aria-label="Template name"
              style={`width:${Math.min(30, Math.max(9, name.length + 2))}ch`}
              onInput={(event) =>
                setMetadata("name", event.currentTarget.value)
              }
            />
          </div>
          <StatusPill status={template.status}>
            {pretty(template.status)}
          </StatusPill>
          <span class={`etb-save-state ${saveState}`} aria-live="polite">
            {saveState === "saving"
              ? "Saving…"
              : saveState === "failed"
                ? "Save failed"
                : saveState === "unsaved"
                  ? "Unsaved"
                  : "Saved"}
          </span>
        </div>
        <div class="etb-toolbar-actions">
          <button
            type="button"
            class="etb-tool-button"
            onClick={undoChange}
            disabled={!historyState.canUndo}
            aria-label="Undo"
          >
            <i class="fas fa-rotate-left" />
          </button>
          <button
            type="button"
            class="etb-tool-button"
            onClick={redoChange}
            disabled={!historyState.canRedo}
            aria-label="Redo"
          >
            <i class="fas fa-rotate-right" />
          </button>
          <label
            class={`etb-demo-switch ${showDemoData ? "is-on" : ""}`}
            title={
              showDemoData
                ? "Showing sample data — text editing is paused"
                : "Show sample data instead of {{variable}} placeholders"
            }
          >
            <input
              type="checkbox"
              checked={showDemoData}
              onChange={(event) => {
                setShowDemoData(event.currentTarget.checked);
                setActiveTextTarget(null);
              }}
            />
            <span class="etb-demo-track" aria-hidden="true">
              <span class="etb-demo-thumb" />
            </span>
            <span class="etb-demo-label">Demo data</span>
          </label>
          <div class="etb-device-switch">
            <button
              type="button"
              class={previewMode === "desktop" ? "active" : ""}
              onClick={() => setPreviewMode("desktop")}
            >
              <i class="fas fa-desktop" /> Desktop
            </button>
            <button
              type="button"
              class={previewMode === "mobile" ? "active" : ""}
              onClick={() => setPreviewMode("mobile")}
            >
              <i class="fas fa-mobile-screen" /> Mobile
            </button>
          </div>
          <button
            type="button"
            class="etb-tool-button wide"
            aria-label="Zoom out"
            onClick={() => setZoom((value) => Math.max(60, value - 10))}
          >
            <i class="fas fa-minus" />
          </button>
          <span class="etb-zoom">{zoom}%</span>
          <button
            type="button"
            class="etb-tool-button wide"
            aria-label="Zoom in"
            onClick={() => setZoom((value) => Math.min(130, value + 10))}
          >
            <i class="fas fa-plus" />
          </button>
          {/* TEMPORARY dev-only helper: copies the live layout JSON so it can
              be pasted back and baked into the default template. Never built
              into production bundles. Remove once the default is updated. */}
          {import.meta.env.DEV && (
            <Button
              variant="outline"
              icon="fa-clipboard"
              onClick={() => void copyLayoutJson()}
            >
              Copy Layout
            </Button>
          )}
          <Button
            variant="outline"
            icon="fa-eye"
            onClick={() => setPreviewOpen(true)}
          >
            Preview
          </Button>
          {/* Placed here per the agreed home for test sending (the Studio, not
              the library). NOT wired yet - there is no send-test service, so it
              says so rather than silently doing nothing. */}
          <Button
            variant="outline"
            icon="fa-paper-plane"
            onClick={() => onToast('Test sending is not available yet.')}
          >
            Send Test
          </Button>
          {canEdit && (
            <Button
              variant="blue"
              class="etb-save-draft"
              icon="fa-floppy-disk"
              onClick={() => void persist(true)}
              disabled={saveState === "saving"}
            >
              Save Draft
            </Button>
          )}
          {!canEdit && onCreateEditableCopy && (
            <Button
              variant="blue"
              class="etb-save-draft"
              icon="fa-copy"
              onClick={onCreateEditableCopy}
              disabled={creatingEditableCopy}
            >
              {creatingEditableCopy ? "Creating Copy…" : "Create Editable Copy"}
            </Button>
          )}
        </div>
      </header>

      {!canEdit && (
        <aside class="etb-readonly-banner" role="status">
          <i class="fas fa-lock" />
          <span>
            <strong>This published version is read-only.</strong> Create an
            editable draft copy to change content, layout, or styling.
          </span>
        </aside>
      )}

      <main class="etb-workspace">
        <aside class="etb-left-panel">
          <nav class="etb-left-tabs" aria-label="Email building tools">
            {(
              [
                ["content", "fa-shapes", "Content"],
                ["layout", "fa-table-columns", "Layout"],
                ["variables", "fa-brackets-curly", "Variables"],
                ["structure", "fa-layer-group", "Layers"],
              ] as const
            ).map(([id, icon, label]) => (
              <button
                type="button"
                class={leftTab === id ? "active" : ""}
                onClick={() => setLeftTab(id)}
                title={label}
              >
                <i class={`fas ${icon}`} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <div class="etb-left-content">
            {leftTab === "content" && (
              <>
                <label class="etb-search">
                  <i class="fas fa-magnifying-glass" />
                  <input
                    value={blockSearch}
                    onInput={(event) =>
                      setBlockSearch(event.currentTarget.value)
                    }
                    placeholder="Find a content block"
                  />
                </label>
                {GROUPS.map((group) => {
                  const items = filteredDefinitions.filter(
                    (item) => item.group === group,
                  );
                  if (!items.length) return null;
                  return (
                    <details class="etb-palette-group" open>
                      <summary>
                        {group}
                        <i class="fas fa-chevron-down etb-acc-chevron" />
                      </summary>
                      <div class="etb-palette-grid">
                        {items.map((item) => (
                          <button
                            type="button"
                            disabled={!canEdit}
                            draggable={canEdit}
                            title={item.description}
                            aria-label={`Add ${item.label}`}
                            onDragStart={(event) => {
                              if (!event.dataTransfer) return;
                              event.dataTransfer.effectAllowed = "copy";
                              event.dataTransfer.setData(BLOCK_MIME, item.type);
                              globalThis.setTimeout(
                                () => setDraggingSource(`new:${item.type}`),
                                0,
                              );
                            }}
                            onDragEnd={finishDrag}
                            onClick={() => addBlock(item.type)}
                          >
                            <i class={`fas ${item.icon}`} />
                            <strong>{item.label}</strong>
                          </button>
                        ))}
                      </div>
                    </details>
                  );
                })}
                <details class="etb-palette-group" open>
                  <summary>
                    Dynamic content
                    <i class="fas fa-chevron-down etb-acc-chevron" />
                  </summary>
                  {transactionalSearchMatch && (
                    <button
                      type="button"
                      disabled={!canEdit}
                      class="etb-library-entry"
                      onClick={() => setTransactionalLibraryOpen(true)}
                    >
                      <span class="etb-library-entry-icon">
                        <i class="fas fa-wand-magic-sparkles" />
                      </span>
                      <span class="etb-library-entry-text">
                        <strong>Transactional library</strong>
                        <small>Live-data sections for people and compliance</small>
                      </span>
                      <LucideIcon name="ChevronRight" size={16} />
                    </button>
                  )}
                  <div class="etb-saved-list">
                    {SECTION_PRESETS.map((preset) => (
                      <button
                        type="button"
                        disabled={!canEdit}
                        onClick={() => insertPreset(preset.build())}
                      >
                        <i class={`fas ${preset.icon}`} />
                        <span>
                          <strong>{preset.label}</strong>
                          <small>{preset.description}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                  <h4 class="etb-saved-heading">Your saved sections</h4>
                  {savedSectionsQuery.isLoading && (
                    <p class="etb-saved-empty">Loading…</p>
                  )}
                  {!savedSectionsQuery.isLoading &&
                    (savedSectionsQuery.data ?? []).length === 0 && (
                      <p class="etb-saved-empty">
                        Select a section on the canvas and choose
                        <strong> Save as section</strong> to reuse it here.
                      </p>
                    )}
                  <div class="etb-saved-list">
                    {(savedSectionsQuery.data ?? []).map((saved) => (
                      <button
                        type="button"
                        disabled={!canEdit}
                        onClick={() => insertPreset(cloneEmailBlock(saved.block))}
                      >
                        <i class="fas fa-bookmark" />
                        <span>
                          <strong>{saved.name}</strong>
                          <small>Saved section</small>
                        </span>
                        <em
                          class="etb-saved-delete"
                          role="button"
                          tabIndex={0}
                          aria-label={`Delete ${saved.name}`}
                          title="Delete saved section"
                          onClick={(event) => {
                            event.stopPropagation();
                            void removeSavedSection(saved.id, saved.name);
                          }}
                        >
                          <LucideIcon name="Trash2" size={13} />
                        </em>
                      </button>
                    ))}
                  </div>
                </details>
              </>
            )}
            {leftTab === "layout" && (
              <section class="etb-panel-section">
                <h2>Layouts</h2>
                <p>
                  Choose a structure first, then drag real content blocks into
                  each column.
                </p>
                <div class="etb-layout-options">
                  <button onClick={() => addLayout(1)}>
                    <span class="one">
                      <i />
                    </span>
                    <strong>Full width</strong>
                  </button>
                  <button onClick={() => addLayout(2)}>
                    <span class="two">
                      <i />
                      <i />
                    </span>
                    <strong>Two columns</strong>
                  </button>
                  <button onClick={() => addLayout(3)}>
                    <span class="three">
                      <i />
                      <i />
                      <i />
                    </span>
                    <strong>Three columns</strong>
                  </button>
                  <button onClick={() => addLayout(4)}>
                    <span class="four">
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                    <strong>Four columns</strong>
                  </button>
                  <button onClick={() => addLayout(2, [34, 66])}>
                    <span class="ratio-left">
                      <i />
                      <i />
                    </span>
                    <strong>1 : 2 columns</strong>
                  </button>
                  <button onClick={() => addLayout(2, [66, 34])}>
                    <span class="ratio-right">
                      <i />
                      <i />
                    </span>
                    <strong>2 : 1 columns</strong>
                  </button>
                </div>
              </section>
            )}
            {leftTab === "variables" && (
              <section class="etb-panel-section">
                <h2>Variables</h2>
                <p>
                  Insert approved runtime information into the selected block.
                </p>
                <div class="etb-variable-list">
                  {VARIABLES.map(([label, value]) => (
                    <button type="button" onClick={() => insertVariable(value)}>
                      <span>{label}</span>
                      <code>{value}</code>
                    </button>
                  ))}
                </div>
              </section>
            )}
            {leftTab === "structure" && (
              <section class="etb-panel-section">
                <h2>Layers</h2>
                <p>
                  Select a layer to edit only its own properties. Sections own
                  backgrounds and spacing; content blocks own their content and
                  presentation.
                </p>
                <LayerTree
                  blocks={emailDocument.blocks}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              </section>
            )}
          </div>
        </aside>

        <section
          class={`etb-stage ${previewMode} ${draggingSource ? "drag-active" : ""}`}
          onClick={() => setSelectedId(null)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            // Prefer the highlighted guide; fall back to the end of the email
            // so a drop is never silently swallowed.
            dropAt(
              event,
              activeDropTargetRef.current ?? {
                parentId: null,
                index: documentRef.current.blocks.length,
              },
            );
          }}
        >
          {showDemoData && (
            <div class="etb-demo-banner" role="status">
              <i class="fas fa-eye" />
              Demo data — editing paused. Switch it off to edit text.
            </div>
          )}
          <div class="etb-stage-scroll">
            <div
              class="etb-canvas-scale"
              style={`transform:scale(${zoom / 100});transform-origin:top center`}
            >
              <DemoDataContext.Provider value={showDemoData}>
              <div
                class={`etb-email-canvas ${previewMode === "mobile" ? "is-mobile" : ""} ${selectedChromeRole ? "chrome-focus" : ""}`}
                // Capture phase: block selection stopPropagation()s clicks,
                // which would keep this from ever firing in the bubble phase.
                onClickCapture={(event) => {
                  if (!showDemoData) return;
                  const element =
                    event.target instanceof Element ? event.target : null;
                  if (element?.closest('[data-demo-text="true"]')) {
                    setShowDemoData(false);
                    onToast("Demo data off so you can edit the text.");
                  }
                }}
                style={`width:${previewMode === "mobile" ? 390 : emailDocument.settings.width}px;--etb-viewport-background:${emailDocument.settings.outerBackground};--etb-link-color:${emailDocument.settings.linkColor};--etb-link-decoration:${emailDocument.settings.linkUnderline ? "underline" : "none"};--etb-heading-font:${EMAIL_FONT_STACK};--etb-heading-line:${emailDocument.settings.typography.headingLineHeight};--etb-h1-size:${emailDocument.settings.typography.h1.fontSize}px;--etb-h1-color:${emailDocument.settings.typography.h1.color};--etb-h2-size:${emailDocument.settings.typography.h2.fontSize}px;--etb-h2-color:${emailDocument.settings.typography.h2.color};--etb-h3-size:${emailDocument.settings.typography.h3.fontSize}px;--etb-h3-color:${emailDocument.settings.typography.h3.color};font-family:${EMAIL_FONT_STACK}`}
              >
                {emailDocument.blocks.length === 0 && (
                  <div class="etb-empty-canvas">
                    <i class="fas fa-layer-group" />
                    <h2>Add your first section</h2>
                    <p>
                      Choose a layout, or add content and SIOMAC will create its
                      section automatically.
                    </p>
                  </div>
                )}
                {canvasBlocks.map((block, index) => (
                  <div
                    class={`etb-canvas-slot ${block.id === activeSectionId && index > 0 ? "section-gap-before" : ""} ${block.id === activeSectionId && index < emailDocument.blocks.length - 1 ? "section-gap-after" : ""} ${block.properties.chromeRole ? "is-chrome" : "is-content"}`}
                    style={`--etb-space-top:${block.properties.outerSpacing?.top ?? 0}px;--etb-space-right:${block.properties.outerSpacing?.right ?? 0}px;--etb-space-bottom:${block.properties.outerSpacing?.bottom ?? 0}px;--etb-space-left:${block.properties.outerSpacing?.left ?? 0}px`}
                    key={block.id}
                    onDragOver={(event) => {
                      if (!draggingSource) return;
                      event.preventDefault();
                      event.stopPropagation();
                      const bounds = event.currentTarget.getBoundingClientRect();
                      const after =
                        event.clientY > bounds.top + bounds.height / 2;
                      const position = after ? index + 1 : index;
                      activateDrop(`root:${position}`, {
                        parentId: null,
                        index: position,
                      });
                    }}
                  >
                    <DropGuide
                      visible={Boolean(draggingSource)}
                      active={activeDropKey === `root:${index}`}
                      preview={dragPreview}
                      onActivate={() =>
                        activateDrop(`root:${index}`, {
                          parentId: null,
                          index,
                        })
                      }
                      onDrop={(event) =>
                        dropAt(event, { parentId: null, index })
                      }
                    />
                    <CanvasBlock
                      block={block}
                      selectedId={selectedId}
                      editable={canEdit}
                      dragActive={Boolean(draggingSource)}
                      dragSourceIsContainer={dragSourceIsContainer}
                      dragPreview={dragPreview}
                      activeDropKey={activeDropKey}
                      onSelect={setSelectedId}
                      onChange={updateBlock}
                      onDrop={dropAt}
                      onActivateDrop={activateDrop}
                      onDragStart={setDraggingSource}
                      onDragEnd={finishDrag}
                      onDuplicate={duplicateBlock}
                      onRemove={deleteBlock}
                      onResize={(id, properties) =>
                        updateBlock(id, (current) => ({
                          ...current,
                          properties: { ...current.properties, ...properties },
                        }))
                      }
                      onQuickAdd={addBlock}
                    />
                  </div>
                ))}
                <DropGuide
                  visible={
                    Boolean(draggingSource) || emailDocument.blocks.length === 0
                  }
                  active={
                    activeDropKey === `root:${emailDocument.blocks.length}`
                  }
                  preview={dragPreview}
                  onActivate={() =>
                    activateDrop(`root:${emailDocument.blocks.length}`, {
                      parentId: null,
                      index: emailDocument.blocks.length,
                    })
                  }
                  onDrop={(event) =>
                    dropAt(event, {
                      parentId: null,
                      index: emailDocument.blocks.length,
                    })
                  }
                />
              </div>
              </DemoDataContext.Provider>
            </div>
          </div>
        </section>

        <aside class="etb-inspector">
          {selected ? (
            <>
              <header>
                <div>
                  {selectedParent && (
                    <button
                      type="button"
                      class="etb-inspector-back"
                      onClick={() => setSelectedId(selectedParent.id)}
                      aria-label={`Edit ${selectedParent.name}`}
                    >
                      <i class="fas fa-arrow-left" />
                    </button>
                  )}
                  <i
                    class={`fas ${selectedIsContainer ? "fa-layer-group" : "fa-sliders"}`}
                  />
                  <span>
                    <small>
                      {selectedIsContainer
                        ? "Section settings"
                        : `Content in ${selectedParent?.name ?? "section"}`}
                    </small>
                    {canEdit && !selected.locked ? (
                      <input
                        class="etb-rename-input"
                        value={selected.name}
                        aria-label="Block name"
                        title="Rename this block"
                        onInput={(event) =>
                          updateSelected((block) => ({
                            ...block,
                            name: event.currentTarget.value,
                          }))
                        }
                      />
                    ) : (
                      <strong>{selected.name}</strong>
                    )}
                  </span>
                </div>
                <div class="etb-head-actions">
                  {canEdit && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          updateSelected((block) => ({
                            ...block,
                            hidden: !block.hidden,
                          }))
                        }
                        aria-label={
                          selected.hidden ? "Show selection" : "Hide selection"
                        }
                        title={
                          selected.hidden
                            ? "Show in the email"
                            : "Hide from the email"
                        }
                      >
                        <i
                          class={`fas ${selected.hidden ? "fa-eye" : "fa-eye-slash"}`}
                        />
                      </button>
                      {selectedIsContainer && (
                        <button
                          type="button"
                          onClick={() => void saveSelectionAsSection()}
                          aria-label="Save as section"
                          title="Save this section for reuse"
                        >
                          <i class="fas fa-bookmark" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          updateSelected((block) => ({
                            ...block,
                            locked: !block.locked,
                          }))
                        }
                        aria-label={
                          selected.locked
                            ? "Unlock selection"
                            : "Lock selection"
                        }
                        title={selected.locked ? "Unlock" : "Lock"}
                      >
                        <i
                          class={`fas ${selected.locked ? "fa-lock-open" : "fa-lock"}`}
                        />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    aria-label="Close properties"
                  >
                    <i class="fas fa-xmark" />
                  </button>
                </div>
              </header>
              <fieldset
                class="etb-inspector-scroll etb-inspector-fields"
                disabled={!canEdit || selected.locked}
              >
                {selectedChromeRole && (
                  <section class="etb-chrome-notice">
                    <p>
                      <i class="fas fa-table-columns" /> You are editing the{" "}
                      {selectedChromeRole}. Changes stay on this template until
                      you apply them everywhere.
                    </p>
                    <Button
                      variant="outline"
                      icon="fa-clone"
                      disabled={!canEdit || chromeMutation.isPending}
                      onClick={() => void applyChromeToAllTemplates()}
                    >
                      {chromeMutation.isPending
                        ? "Applying…"
                        : "Apply to all templates"}
                    </Button>
                  </section>
                )}
                <section>
                  <h3>Content</h3>
                  {blockHasRichText(selected) && (
                    <p class="etb-field-note etb-canvas-edit-note">
                      <i class="fas fa-text-cursor" /> Select text directly on
                      the canvas to open its formatting palette.
                    </p>
                  )}
                  {selected.type === "support_contact" && (
                    <div class="etb-binding-fields">
                      <label>
                        <span>Support email</span>
                        <input
                          value={selected.properties.contactEmail ?? ""}
                          onInput={(event) =>
                            updateSelected((block) => ({
                              ...block,
                              properties: {
                                ...block.properties,
                                contactEmail: event.currentTarget.value,
                              },
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>Support phone</span>
                        <input
                          value={selected.properties.contactPhone ?? ""}
                          onInput={(event) =>
                            updateSelected((block) => ({
                              ...block,
                              properties: {
                                ...block.properties,
                                contactPhone: event.currentTarget.value,
                              },
                            }))
                          }
                        />
                      </label>
                    </div>
                  )}
                  {selected.type === "smart_progress" && (
                    <>
                      <p class="etb-field-note">
                        Edit the label directly on the canvas.
                      </p>
                      <SliderField
                        label="Progress"
                        value={selected.properties.percent ?? 0}
                        min={0}
                        max={100}
                        unit="%"
                        onChange={(value) =>
                          updateSelected((block) => ({
                            ...block,
                            properties: { ...block.properties, percent: value },
                          }))
                        }
                      />
                      <label>
                        <span>Caption</span>
                        <input
                          value={selected.properties.progressCaption ?? ""}
                          placeholder="e.g. 3 of 6 completed"
                          onInput={(event) =>
                            updateSelected((block) => ({
                              ...block,
                              properties: {
                                ...block.properties,
                                progressCaption: event.currentTarget.value,
                              },
                            }))
                          }
                        />
                      </label>
                    </>
                  )}
                  {selected.type === "smart_status_list" && (
                    <div class="etb-fact-editor">
                      {(selected.properties.statusItems ?? []).map(
                        (item, index, items) => (
                          <div class="etb-fact-row">
                            <div class="etb-fact-row-head">
                              <select
                                class="etb-status-select"
                                value={item.status}
                                aria-label={`Row ${index + 1} status`}
                                onChange={(event) =>
                                  updateStatusItem(index, {
                                    status: event.currentTarget.value as
                                      | "done"
                                      | "current"
                                      | "pending",
                                  })
                                }
                              >
                                <option value="done">Completed</option>
                                <option value="current">In progress</option>
                                <option value="pending">Pending</option>
                              </select>
                              <div class="etb-fact-row-actions">
                                <button
                                  type="button"
                                  disabled={index === 0}
                                  aria-label={`Move row ${index + 1} up`}
                                  title="Move up"
                                  onClick={() => moveStatusItem(index, -1)}
                                >
                                  <i class="fas fa-caret-up" />
                                </button>
                                <button
                                  type="button"
                                  disabled={index === items.length - 1}
                                  aria-label={`Move row ${index + 1} down`}
                                  title="Move down"
                                  onClick={() => moveStatusItem(index, 1)}
                                >
                                  <i class="fas fa-caret-down" />
                                </button>
                                <button
                                  type="button"
                                  class="danger"
                                  aria-label={`Remove row ${index + 1}`}
                                  title="Remove row"
                                  onClick={() => removeStatusItem(index)}
                                >
                                  <LucideIcon name="Trash2" size={13} />
                                </button>
                              </div>
                            </div>
                            <input
                              value={item.title}
                              aria-label={`Row ${index + 1} title`}
                              placeholder="Title"
                              onInput={(event) =>
                                updateStatusItem(index, {
                                  title: event.currentTarget.value,
                                })
                              }
                            />
                            <input
                              value={item.meta}
                              aria-label={`Row ${index + 1} detail`}
                              placeholder="Detail (optional)"
                              onInput={(event) =>
                                updateStatusItem(index, {
                                  meta: event.currentTarget.value,
                                })
                              }
                            />
                          </div>
                        ),
                      )}
                      <button
                        type="button"
                        class="etb-add-row"
                        onClick={addStatusItem}
                      >
                        <LucideIcon name="Plus" size={15} /> Add row
                      </button>
                    </div>
                  )}
                  {selected.type === "smart_fact_grid" && (
                    <div class="etb-fact-editor">
                      <p class="etb-field-note">
                        Edit the heading directly on the canvas. Each tile below
                        is its own icon, label, value and caption.
                      </p>
                      <label>
                        <span>Tile alignment</span>
                        <div class="etb-segmented">
                          {(["left", "center", "right"] as EmailTextAlign[]).map(
                            (align) => (
                              <button
                                type="button"
                                class={
                                  (selected.properties.factTileAlign ??
                                    "left") === align
                                    ? "active"
                                    : ""
                                }
                                aria-label={`Tiles ${align}`}
                                title={`Tiles ${align}`}
                                onClick={() =>
                                  updateSelected((block) => ({
                                    ...block,
                                    properties: {
                                      ...block.properties,
                                      factTileAlign: align,
                                    },
                                  }))
                                }
                              >
                                <i class={`fas fa-align-${align}`} />
                              </button>
                            ),
                          )}
                        </div>
                      </label>
                      <label class="etb-checkbox-row">
                        <input
                          type="checkbox"
                          checked={selected.properties.factDividers ?? false}
                          onChange={(event) =>
                            updateSelected((block) => ({
                              ...block,
                              properties: {
                                ...block.properties,
                                factDividers: event.currentTarget.checked,
                              },
                            }))
                          }
                        />
                        <span>Separator lines between tiles</span>
                      </label>
                      <SliderField
                        label="Icon size"
                        value={selected.properties.iconSize ?? 28}
                        min={16}
                        max={56}
                        onChange={(value) =>
                          updateSelected((block) => ({
                            ...block,
                            properties: { ...block.properties, iconSize: value },
                          }))
                        }
                      />
                      <SliderField
                        label="Tiles per row"
                        value={selected.properties.columns ?? 4}
                        min={1}
                        max={4}
                        unit=""
                        onChange={(value) =>
                          updateSelected((block) => ({
                            ...block,
                            properties: {
                              ...block.properties,
                              columns: value as 1 | 2 | 3 | 4,
                            },
                          }))
                        }
                      />
                      {(selected.properties.factTiles ?? []).map(
                        (tile, index, tiles) => (
                          <div class="etb-fact-row">
                            <div class="etb-fact-row-head">
                              <IconPicker
                                value={tile.icon}
                                allowNone
                                ariaLabel={`Tile ${index + 1} icon`}
                                onChange={(icon) =>
                                  updateFactTile(index, { icon })
                                }
                              />
                              <input
                                class="etb-fact-label"
                                value={tile.label}
                                aria-label={`Tile ${index + 1} label`}
                                placeholder="Label"
                                onInput={(event) =>
                                  updateFactTile(index, {
                                    label: event.currentTarget.value,
                                  })
                                }
                              />
                              <div class="etb-fact-row-actions">
                                <button
                                  type="button"
                                  disabled={index === 0}
                                  aria-label={`Move tile ${index + 1} up`}
                                  title="Move up"
                                  onClick={() => moveFactTile(index, -1)}
                                >
                                  <i class="fas fa-caret-up" />
                                </button>
                                <button
                                  type="button"
                                  disabled={index === tiles.length - 1}
                                  aria-label={`Move tile ${index + 1} down`}
                                  title="Move down"
                                  onClick={() => moveFactTile(index, 1)}
                                >
                                  <i class="fas fa-caret-down" />
                                </button>
                                <button
                                  type="button"
                                  class="danger"
                                  aria-label={`Remove tile ${index + 1}`}
                                  title="Remove tile"
                                  onClick={() => removeFactTile(index)}
                                >
                                  <LucideIcon name="Trash2" size={13} />
                                </button>
                              </div>
                            </div>
                            <input
                              value={tile.value}
                              aria-label={`Tile ${index + 1} value`}
                              placeholder="Value"
                              onInput={(event) =>
                                updateFactTile(index, {
                                  value: event.currentTarget.value,
                                })
                              }
                            />
                            <input
                              value={tile.caption}
                              aria-label={`Tile ${index + 1} caption`}
                              placeholder="Caption (optional)"
                              onInput={(event) =>
                                updateFactTile(index, {
                                  caption: event.currentTarget.value,
                                })
                              }
                            />
                          </div>
                        ),
                      )}
                      <button
                        type="button"
                        class="etb-add-row"
                        onClick={addFactTile}
                      >
                        <LucideIcon name="Plus" size={15} /> Add tile
                      </button>
                    </div>
                  )}
                  {selected.type === "icon_list" && (
                    <div class="etb-icon-list-editor">
                      <p class="etb-field-note">
                        Choose a Lucide icon and edit the text for each row.
                      </p>
                      {(selected.properties.iconItems ?? []).map(
                        (item, index, items) => (
                          <div class="etb-icon-list-row">
                            <select
                              aria-label={`Icon ${index + 1}`}
                              value={item.icon}
                              onChange={(event) =>
                                updateSelected((block) => {
                                  const iconItems = [
                                    ...(block.properties.iconItems ?? []),
                                  ];
                                  iconItems[index] = {
                                    ...item,
                                    icon: event.currentTarget.value,
                                  };
                                  return {
                                    ...block,
                                    properties: {
                                      ...block.properties,
                                      iconItems,
                                    },
                                  };
                                })
                              }
                            >
                              {ICON_LIST_OPTIONS.map((icon) => (
                                <option value={icon}>{icon}</option>
                              ))}
                            </select>
                            <input
                              aria-label={`Text ${index + 1}`}
                              value={item.text}
                              onInput={(event) =>
                                updateSelected((block) => {
                                  const iconItems = [
                                    ...(block.properties.iconItems ?? []),
                                  ];
                                  iconItems[index] = {
                                    ...item,
                                    text: event.currentTarget.value,
                                  };
                                  return {
                                    ...block,
                                    properties: {
                                      ...block.properties,
                                      iconItems,
                                    },
                                  };
                                })
                              }
                            />
                            <div>
                              <button
                                type="button"
                                disabled={index === 0}
                                aria-label={`Move row ${index + 1} up`}
                                onClick={() =>
                                  updateSelected((block) => {
                                    const iconItems = [
                                      ...(block.properties.iconItems ?? []),
                                    ];
                                    [iconItems[index - 1], iconItems[index]] = [
                                      iconItems[index]!,
                                      iconItems[index - 1]!,
                                    ];
                                    return {
                                      ...block,
                                      properties: {
                                        ...block.properties,
                                        iconItems,
                                      },
                                    };
                                  })
                                }
                              >
                                <LucideIcon name="ChevronUp" size={14} />
                              </button>
                              <button
                                type="button"
                                disabled={index === items.length - 1}
                                aria-label={`Move row ${index + 1} down`}
                                onClick={() =>
                                  updateSelected((block) => {
                                    const iconItems = [
                                      ...(block.properties.iconItems ?? []),
                                    ];
                                    [iconItems[index], iconItems[index + 1]] = [
                                      iconItems[index + 1]!,
                                      iconItems[index]!,
                                    ];
                                    return {
                                      ...block,
                                      properties: {
                                        ...block.properties,
                                        iconItems,
                                      },
                                    };
                                  })
                                }
                              >
                                <LucideIcon name="ChevronDown" size={14} />
                              </button>
                              <button
                                type="button"
                                aria-label={`Remove row ${index + 1}`}
                                onClick={() =>
                                  updateSelected((block) => ({
                                    ...block,
                                    properties: {
                                      ...block.properties,
                                      iconItems: (
                                        block.properties.iconItems ?? []
                                      ).filter(
                                        (_, rowIndex) => rowIndex !== index,
                                      ),
                                    },
                                  }))
                                }
                              >
                                <LucideIcon name="Trash2" size={14} />
                              </button>
                            </div>
                          </div>
                        ),
                      )}
                      <button
                        type="button"
                        class="etb-layout-action"
                        onClick={() =>
                          updateSelected((block) => ({
                            ...block,
                            properties: {
                              ...block.properties,
                              iconItems: [
                                ...(block.properties.iconItems ?? []),
                                { icon: "CheckCircle", text: "New list item" },
                              ],
                            },
                          }))
                        }
                      >
                        <LucideIcon name="Plus" size={15} /> Add list row
                      </button>
                      <div class="etb-icon-style-controls">
                        {(selected.properties.iconTreatment ?? "outline") !==
                          "plain" && <label>
                          <span>Icon shape</span>
                          <select
                            value={selected.properties.iconShape ?? "rounded"}
                            onInput={(event) =>
                              updateSelected((block) => ({
                                ...block,
                                properties: {
                                  ...block.properties,
                                  iconShape: event.currentTarget.value as
                                    "circle" | "square" | "rounded",
                                },
                              }))
                            }
                          >
                            <option value="rounded">Rounded square</option>
                            <option value="circle">Circle</option>
                            <option value="square">Square</option>
                          </select>
                        </label>}
                        <label>
                          <span>Icon treatment</span>
                          <select
                            value={
                              selected.properties.iconTreatment ?? "outline"
                            }
                            onInput={(event) =>
                              updateSelected((block) => ({
                                ...block,
                                properties: {
                                  ...block.properties,
                                  iconTreatment: event.currentTarget.value as
                                    "plain" | "outline" | "solid",
                                },
                              }))
                            }
                          >
                            <option value="plain">Icon only</option>
                            <option value="outline">Outline</option>
                            <option value="solid">Solid colour</option>
                          </select>
                        </label>
                        <label>
                          <span>Icon colour</span>
                          {/*
                            A closed palette, not a colour picker: a delivered email icon is a
                            pre-rendered PNG, so only colours that have a published asset can be
                            offered. An arbitrary hex here would author a broken image.
                          */}
                          <select
                            class="etb-icon-color-select"
                            value={normalizeEmailIconColor(
                              selected.properties.iconColor,
                            )}
                            onInput={(event) =>
                              updateSelected((block) => ({
                                ...block,
                                properties: {
                                  ...block.properties,
                                  iconColor: normalizeEmailIconColor(
                                    event.currentTarget.value,
                                  ),
                                },
                              }))
                            }
                          >
                            {EMAIL_ICON_COLOR_CHOICES.map((choice) => (
                              <option value={choice.value}>
                                {choice.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        {(selected.properties.iconTreatment ?? "outline") !==
                          "plain" && <label>
                          <span>Icon background</span>
                          <ColorControl
                            value={
                              selected.properties.iconBackground ?? "#ffffff"
                            }
                            onChange={(iconBackground) =>
                              updateSelected((block) => ({
                                ...block,
                                properties: {
                                  ...block.properties,
                                  iconBackground,
                                },
                              }))
                            }
                          />
                        </label>}
                      </div>
                    </div>
                  )}
                  {selected.type === "legal_footer" && (
                    <div class="etb-icon-list-editor">
                      <p class="etb-field-note">
                        Policy links shown under the company details. Leave a
                        destination empty to render the label as plain text.
                      </p>
                      {(
                        selected.properties.footerLinks ?? DEFAULT_FOOTER_LINKS
                      ).map(
                        (link, index, links) => (
                          <div class="etb-footer-link-row">
                            <input
                              aria-label={`Link ${index + 1} label`}
                              placeholder="Label"
                              value={link.label}
                              onInput={(event) =>
                                updateSelected((block) => {
                                  const footerLinks = [
                                    ...(block.properties.footerLinks ??
                                      DEFAULT_FOOTER_LINKS),
                                  ];
                                  footerLinks[index] = {
                                    ...link,
                                    label: event.currentTarget.value,
                                  };
                                  return {
                                    ...block,
                                    properties: {
                                      ...block.properties,
                                      footerLinks,
                                    },
                                  };
                                })
                              }
                            />
                            <input
                              aria-label={`Link ${index + 1} destination`}
                              placeholder="https:// or {{variable}}"
                              value={link.href}
                              onInput={(event) =>
                                updateSelected((block) => {
                                  const footerLinks = [
                                    ...(block.properties.footerLinks ??
                                      DEFAULT_FOOTER_LINKS),
                                  ];
                                  footerLinks[index] = {
                                    ...link,
                                    href: event.currentTarget.value,
                                  };
                                  return {
                                    ...block,
                                    properties: {
                                      ...block.properties,
                                      footerLinks,
                                    },
                                  };
                                })
                              }
                            />
                            <div>
                              <button
                                type="button"
                                disabled={index === 0}
                                aria-label={`Move link ${index + 1} up`}
                                onClick={() =>
                                  updateSelected((block) => {
                                    const footerLinks = [
                                      ...(block.properties.footerLinks ??
                                        DEFAULT_FOOTER_LINKS),
                                    ];
                                    [
                                      footerLinks[index - 1],
                                      footerLinks[index],
                                    ] = [
                                      footerLinks[index]!,
                                      footerLinks[index - 1]!,
                                    ];
                                    return {
                                      ...block,
                                      properties: {
                                        ...block.properties,
                                        footerLinks,
                                      },
                                    };
                                  })
                                }
                              >
                                <LucideIcon name="ChevronUp" size={14} />
                              </button>
                              <button
                                type="button"
                                disabled={index === links.length - 1}
                                aria-label={`Move link ${index + 1} down`}
                                onClick={() =>
                                  updateSelected((block) => {
                                    const footerLinks = [
                                      ...(block.properties.footerLinks ??
                                        DEFAULT_FOOTER_LINKS),
                                    ];
                                    [
                                      footerLinks[index],
                                      footerLinks[index + 1],
                                    ] = [
                                      footerLinks[index + 1]!,
                                      footerLinks[index]!,
                                    ];
                                    return {
                                      ...block,
                                      properties: {
                                        ...block.properties,
                                        footerLinks,
                                      },
                                    };
                                  })
                                }
                              >
                                <LucideIcon name="ChevronDown" size={14} />
                              </button>
                              <button
                                type="button"
                                aria-label={`Remove link ${index + 1}`}
                                onClick={() =>
                                  updateSelected((block) => ({
                                    ...block,
                                    properties: {
                                      ...block.properties,
                                      footerLinks: (
                                        block.properties.footerLinks ??
                                        DEFAULT_FOOTER_LINKS
                                      ).filter(
                                        (_, linkIndex) => linkIndex !== index,
                                      ),
                                    },
                                  }))
                                }
                              >
                                <LucideIcon name="Trash2" size={14} />
                              </button>
                            </div>
                          </div>
                        ),
                      )}
                      <button
                        type="button"
                        class="etb-layout-action"
                        onClick={() =>
                          updateSelected((block) => ({
                            ...block,
                            properties: {
                              ...block.properties,
                              footerLinks: [
                                ...(block.properties.footerLinks ??
                                  DEFAULT_FOOTER_LINKS),
                                { label: "New link", href: "" },
                              ],
                            },
                          }))
                        }
                      >
                        <LucideIcon name="Plus" size={15} /> Add policy link
                      </button>
                      <label>
                        <span>Reply notice</span>
                        <input
                          value={
                            selected.properties.replyNotice ??
                            DEFAULT_REPLY_NOTICE
                          }
                          placeholder="Leave empty to hide this line"
                          onInput={(event) =>
                            updateSelected((block) => ({
                              ...block,
                              properties: {
                                ...block.properties,
                                replyNotice: event.currentTarget.value,
                              },
                            }))
                          }
                        />
                      </label>
                    </div>
                  )}
                  {(selected.type === "button" ||
                    selected.type === "invitation_action") && (
                    <>
                      <label>
                        <span>Button label</span>
                        <input
                          value={selected.properties.label ?? ""}
                          onInput={(event) =>
                            updateSelected((block) => ({
                              ...block,
                              properties: {
                                ...block.properties,
                                label: event.currentTarget.value,
                              },
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>Destination</span>
                        <input
                          value={selected.properties.href ?? ""}
                          disabled={selected.type === "invitation_action"}
                          onInput={(event) =>
                            updateSelected((block) => ({
                              ...block,
                              properties: {
                                ...block.properties,
                                href: event.currentTarget.value,
                              },
                            }))
                          }
                        />
                      </label>
                      {selected.type === "invitation_action" && (
                        <p class="etb-field-note">
                          <i class="fas fa-shield-halved" /> The secure
                          destination is supplied by the server.
                        </p>
                      )}
                    </>
                  )}
                  {["image", "company_logo", "profile_photo"].includes(
                    selected.type,
                  ) && (
                    <>
                      <input
                        ref={uploadRef}
                        class="etb-hidden-input"
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        onChange={(event) => void uploadImage(event)}
                      />
                      {selected.properties.src && (
                        <div class="etb-inspector-image-preview">
                          <img
                            src={
                              SAMPLE_VARIABLES[selected.properties.src] ??
                              selected.properties.src
                            }
                            alt={applySampleVariables(
                              selected.properties.alt ?? "",
                            )}
                          />
                        </div>
                      )}
                      <button
                        type="button"
                        class="etb-upload-button"
                        onClick={() => uploadRef.current?.click()}
                        disabled={imageUploading || !canEdit}
                      >
                        {imageUploading ? (
                          <Spinner size={14} />
                        ) : (
                          <i class="fas fa-cloud-arrow-up" />
                        )}{" "}
                        {imageUploading
                          ? "Uploading…"
                          : selected.properties.src
                            ? "Change image"
                            : "Upload image"}
                      </button>
                      <label>
                        <span>Alternative text</span>
                        <input
                          disabled={!canEdit}
                          value={selected.properties.alt ?? ""}
                          onInput={(event) =>
                            updateSelected((block) => ({
                              ...block,
                              properties: {
                                ...block.properties,
                                alt: event.currentTarget.value,
                              },
                            }))
                          }
                          placeholder="Describe the image"
                        />
                      </label>
                      <label>
                        <span>
                          Link destination <small>Optional</small>
                        </span>
                        <input
                          disabled={!canEdit}
                          value={selected.properties.href ?? ""}
                          onInput={(event) =>
                            updateSelected((block) => ({
                              ...block,
                              properties: {
                                ...block.properties,
                                href: event.currentTarget.value,
                              },
                            }))
                          }
                          placeholder="https:// or approved variable"
                        />
                      </label>
                      <label>
                        <span>
                          Image width{" "}
                          <output>{selected.properties.width ?? 320}px</output>
                        </span>
                        <input
                          class="etb-range"
                          disabled={!canEdit}
                          type="range"
                          min="24"
                          max="600"
                          value={selected.properties.width ?? 320}
                          onInput={(event) =>
                            updateSelected((block) => ({
                              ...block,
                              properties: {
                                ...block.properties,
                                width: Number(event.currentTarget.value),
                              },
                            }))
                          }
                        />
                      </label>
                    </>
                  )}
                </section>
                <section>
                  <h3>Appearance</h3>
                  {!selectedHasRichText && !selectedIsButton && (
                    <label>
                      <span>Alignment</span>
                      <div class="etb-segmented">
                        {(["left", "center", "right"] as EmailTextAlign[]).map(
                          (align) => (
                            <button
                              type="button"
                              class={
                                selected.styles.align === align ? "active" : ""
                              }
                              aria-label={`Align ${align}`}
                              title={`Align ${align}`}
                              onClick={() => updateStyle("align", align)}
                            >
                              <i class={`fas fa-align-${align}`} />
                            </button>
                          ),
                        )}
                      </div>
                    </label>
                  )}
                  {selectedShowsTypography && (
                    <>
                      <label>
                        <span>Text colour</span>
                        <ColorControl
                          value={selected.styles.color}
                          onChange={(value) => updateStyle("color", value)}
                        />
                      </label>
                      <SliderField
                        label="Text size"
                        value={selected.styles.fontSize}
                        min={11}
                        max={42}
                        onChange={(value) => updateStyle("fontSize", value)}
                      />
                      <SliderField
                        label="Letter spacing"
                        value={Number(selected.styles.letterSpacing.toFixed(1))}
                        min={-2}
                        max={4}
                        step={0.1}
                        onChange={(value) => updateStyle("letterSpacing", value)}
                      />
                      <label>
                        <span>Text weight</span>
                        <div class="etb-segmented etb-weight-options">
                          {([400, 700] as const).map((weight) => (
                            <button
                              type="button"
                              class={
                                (selected.styles.fontWeight >= 600
                                  ? 700
                                  : 400) === weight
                                  ? "active"
                                  : ""
                              }
                              onClick={() => updateStyle("fontWeight", weight)}
                            >
                              {weight === 400 ? "Regular" : "Bold"}
                            </button>
                          ))}
                        </div>
                      </label>
                    </>
                  )}
                  {!selectedIsContainer &&
                    !["image", "company_logo", "profile_photo", "divider", "spacer"].includes(
                      selected.type,
                    ) && (
                      <SliderField
                        label="Line spacing"
                        value={Number(selected.styles.lineHeight.toFixed(2))}
                        min={1}
                        max={2}
                        step={0.05}
                        unit=""
                        onChange={(value) => updateStyle("lineHeight", value)}
                      />
                    )}
                  <label>
                    <span>Background</span>
                    <ColorControl
                      value={selected.styles.backgroundColor}
                      allowTransparent
                      onChange={(value) =>
                        updateStyle("backgroundColor", value)
                      }
                    />
                  </label>
                  {selectedIsContainer && (
                    <>
                      <label>
                        <span>Background image</span>
                        <input
                          value={selected.properties.backgroundImage ?? ""}
                          placeholder="https://"
                          onInput={(event) =>
                            updateSelected((block) => ({
                              ...block,
                              properties: {
                                ...block.properties,
                                backgroundImage: event.currentTarget.value,
                              },
                            }))
                          }
                        />
                      </label>
                      <button
                        type="button"
                        class="etb-upload-button"
                        disabled={imageUploading}
                        onClick={() => backgroundUploadRef.current?.click()}
                      >
                        {imageUploading ? (
                          <Spinner size={14} />
                        ) : (
                          <i class="fas fa-arrow-up-from-bracket" />
                        )}
                        Select background image
                      </button>
                      <input
                        ref={backgroundUploadRef}
                        class="etb-hidden-input"
                        type="file"
                        accept="image/*"
                        onChange={(event) => void uploadBackground(event)}
                      />
                      {selected.properties.backgroundImage?.trim() && (
                        <>
                          <label>
                            <span>Display</span>
                            <div class="etb-segmented">
                              {(
                                [
                                  ["scale", "Scale"],
                                  ["fit", "Fit"],
                                  ["tile", "Tile"],
                                ] as const
                              ).map(([mode, label]) => (
                                <button
                                  type="button"
                                  class={
                                    (selected.properties.backgroundDisplay ??
                                      "scale") === mode
                                      ? "active"
                                      : ""
                                  }
                                  onClick={() =>
                                    updateSelected((block) => ({
                                      ...block,
                                      properties: {
                                        ...block.properties,
                                        backgroundDisplay: mode,
                                      },
                                    }))
                                  }
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </label>
                          <p class="etb-field-note">
                            <i class="fas fa-circle-info" /> Some email clients
                            drop background images — keep a background colour
                            that still reads well without it.
                          </p>
                          <button
                            type="button"
                            class="etb-reset-spacing"
                            onClick={() =>
                              updateSelected((block) => ({
                                ...block,
                                properties: {
                                  ...block.properties,
                                  backgroundImage: "",
                                },
                              }))
                            }
                          >
                            <i class="fas fa-xmark" /> Remove background image
                          </button>
                        </>
                      )}
                    </>
                  )}
                  {selectedHasSurface && (
                    <>
                      <SliderField
                        label="Rounded corners"
                        value={selected.styles.borderRadius}
                        min={0}
                        max={40}
                        onChange={(value) => updateStyle("borderRadius", value)}
                      />
                      <SliderField
                        label="Border"
                        value={selected.styles.borderWidth}
                        min={0}
                        max={12}
                        onChange={(value) => updateStyle("borderWidth", value)}
                      />
                      {selected.styles.borderWidth > 0 && (
                        <label>
                          <span>Border colour</span>
                          <ColorControl
                            value={selected.styles.borderColor}
                            onChange={(value) =>
                              updateStyle("borderColor", value)
                            }
                          />
                        </label>
                      )}
                    </>
                  )}
                </section>
                <section>
                  <h3>Size &amp; spacing</h3>
                  <SliderField
                    label="Width"
                    value={selected.properties.widthPercent ?? 100}
                    min={20}
                    max={100}
                    unit="%"
                    onChange={(value) =>
                      updateSelected((block) => ({
                        ...block,
                        properties: {
                          ...block.properties,
                          widthPercent: value,
                        },
                      }))
                    }
                  />
                  <SliderField
                    label="Height"
                    value={selected.properties.minHeight ?? 0}
                    min={0}
                    max={600}
                    step={4}
                    hint="0 lets the block grow with its content."
                    onChange={(value) =>
                      updateSelected((block) => ({
                        ...block,
                        properties: { ...block.properties, minHeight: value },
                      }))
                    }
                  />
                  {(selectedIsContainer ||
                    (selected.properties.minHeight ?? 0) > 0) && (
                    <label>
                      <span>Content sits</span>
                      <div class="etb-segmented">
                        {(
                          [
                            ["top", "AlignVerticalJustifyStart", "Top"],
                            ["middle", "AlignVerticalJustifyCenter", "Middle"],
                            ["bottom", "AlignVerticalJustifyEnd", "Bottom"],
                          ] as const
                        ).map(([align, icon, label]) => (
                          <button
                            type="button"
                            class={
                              (selected.properties.verticalAlign ?? "top") ===
                              align
                                ? "active"
                                : ""
                            }
                            onClick={() =>
                              updateSelected((block) => ({
                                ...block,
                                properties: {
                                  ...block.properties,
                                  verticalAlign: align,
                                },
                              }))
                            }
                            aria-label={`${label} align`}
                            title={label}
                          >
                            <LucideIcon name={icon} size={17} />
                          </button>
                        ))}
                      </div>
                    </label>
                  )}
                  <SpacingEditor
                    label="Inner spacing"
                    value={selected.styles.padding}
                    axis={isPageSection ? "vertical" : "all"}
                    onChange={(value) => updateStyle("padding", value)}
                  />
                  {isPageSection && (
                    <label class="etb-toggle-field">
                      <input
                        type="checkbox"
                        checked={selected.properties.fullBleed === true}
                        onChange={(event) =>
                          updateSelected((block) => ({
                            ...block,
                            properties: {
                              ...block.properties,
                              fullBleed: event.currentTarget.checked,
                            },
                          }))
                        }
                      />
                      <span>
                        Full bleed
                        <small>
                          Ignore the page padding so this band reaches both
                          edges. Its own blocks supply the inset.
                        </small>
                      </span>
                    </label>
                  )}
                  <SpacingEditor
                    label="Outer spacing"
                    value={selectedOuterSpacing}
                    onChange={(value) =>
                      updateSelected((block) => ({
                        ...block,
                        properties: {
                          ...block.properties,
                          outerSpacing: value,
                        },
                      }))
                    }
                  />
                </section>
                {selectedSection && (
                  <section>
                    <h3>Add a column</h3>
                    <p class="etb-field-note">
                      Keep this content and create a real empty column beside it
                      for another block.
                    </p>
                    <div class="etb-add-column-actions">
                      <button
                        type="button"
                        onClick={() =>
                          addColumnToSection(selectedSection.id, "left")
                        }
                      >
                        <i class="fas fa-table-columns" /> Add left
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          addColumnToSection(selectedSection.id, "right")
                        }
                      >
                        Add right <i class="fas fa-table-columns" />
                      </button>
                    </div>
                  </section>
                )}
                {selected.type === "columns" && (
                  <section>
                    <h3>Column layout</h3>
                    <p class="etb-field-note">
                      Adjust the proportions, or merge every column back into
                      one full-width section without losing its content.
                    </p>
                    <div class="etb-column-widths">
                      {selected.children.map((column, index) => (
                        <label>
                          <span>Column {index + 1}</span>
                          <div class="etb-unit-input">
                            <input
                              type="number"
                              min="10"
                              max="90"
                              value={
                                selected.properties.columnWidths?.[index] ??
                                Math.round(100 / selected.children.length)
                              }
                              onInput={(event) =>
                                updateSelected((block) => {
                                  const widths = [
                                    ...(block.properties.columnWidths ??
                                      block.children.map(
                                        () => 100 / block.children.length,
                                      )),
                                  ];
                                  widths[index] = Number(
                                    event.currentTarget.value,
                                  );
                                  return {
                                    ...block,
                                    properties: {
                                      ...block.properties,
                                      columnWidths: widths,
                                    },
                                  };
                                })
                              }
                            />
                            <b>%</b>
                          </div>
                        </label>
                      ))}
                    </div>
                    <button
                      type="button"
                      class="etb-layout-action"
                      onClick={() => mergeColumnsToSection(selected.id)}
                    >
                      <i class="fas fa-table-cells-large" /> Merge to one column
                    </button>
                  </section>
                )}
              </fieldset>
            </>
          ) : (
            <>
              <header>
                <div>
                  <i class="fas fa-envelope-open-text" />
                  <span>
                    <small>Nothing selected</small>
                    <strong>Page properties</strong>
                  </span>
                </div>
              </header>
              <fieldset
                class="etb-inspector-scroll etb-inspector-fields"
                disabled={!canEdit}
              >
                <section>
                  <h3>Email details</h3>
                  <label>
                    <span>Template name</span>
                    <input
                      value={name}
                      maxLength={120}
                      placeholder="Name this template"
                      onInput={(event) =>
                        setMetadata("name", event.currentTarget.value)
                      }
                    />
                  </label>
                  <label>
                    <span>
                      Subject <small>{subject.length}/150</small>
                    </span>
                    <input
                      value={subject}
                      maxLength={150}
                      placeholder="Add a clear subject line"
                      onInput={(event) =>
                        setMetadata("subject", event.currentTarget.value)
                      }
                    />
                  </label>
                  <label>
                    <span>
                      Preheader <small>{preheader.length}/150</small>
                    </span>
                    <textarea
                      rows={3}
                      value={preheader}
                      maxLength={150}
                      placeholder="Add inbox preview text"
                      onInput={(event) =>
                        setMetadata("preheader", event.currentTarget.value)
                      }
                    />
                  </label>
                </section>
                <section>
                  <h3>Canvas</h3>
                  <SliderField
                    label="Email width"
                    value={emailDocument.settings.width}
                    min={480}
                    max={760}
                    step={10}
                    onChange={(width) =>
                      commit({
                        ...documentRef.current,
                        settings: { ...documentRef.current.settings, width },
                      })
                    }
                  />
                  {/*
                    The ONE horizontal gutter for the whole email. Sections own vertical spacing;
                    blocks own their internal spacing. Before this existed the inset was authored
                    per section and had drifted to 0/8/34/36/48 inside a single template, so
                    changing one number moved nothing predictably.
                  */}
                  <SliderField
                    label="Page padding"
                    value={emailDocument.settings.pagePadding}
                    min={0}
                    max={72}
                    step={1}
                    onChange={(pagePadding) =>
                      commit({
                        ...documentRef.current,
                        settings: { ...documentRef.current.settings, pagePadding },
                      })
                    }
                  />
                  <label>
                    <span>Page background</span>
                    <ColorControl
                      value={emailDocument.settings.outerBackground}
                      onChange={(value) =>
                        commit({
                          ...documentRef.current,
                          settings: {
                            ...documentRef.current.settings,
                            outerBackground: value,
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Content background</span>
                    <ColorControl
                      value={emailDocument.settings.contentBackground}
                      onChange={(value) =>
                        commit({
                          ...documentRef.current,
                          settings: {
                            ...documentRef.current.settings,
                            contentBackground: value,
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Primary colour</span>
                    <ColorControl
                      value={emailDocument.settings.primaryColor}
                      onChange={(value) =>
                        commit({
                          ...documentRef.current,
                          settings: {
                            ...documentRef.current.settings,
                            primaryColor: value,
                          },
                        })
                      }
                    />
                  </label>
                </section>
                <section>
                  <h3>Typography</h3>
                  <SliderField
                    label="Body text size"
                    hint="Used for new text blocks. Existing blocks keep their own size."
                    value={emailDocument.settings.typography.body.fontSize}
                    min={11}
                    max={24}
                    onChange={(fontSize) => updateTypography({ body: { ...documentRef.current.settings.typography.body, fontSize } })}
                  />
                  <label>
                    <span>Body text colour</span>
                    <ColorControl
                      value={emailDocument.settings.typography.body.color}
                      onChange={(color) => updateTypography({ body: { ...documentRef.current.settings.typography.body, color } })}
                    />
                  </label>
                  <SliderField
                    label="Body line spacing"
                    value={Number(emailDocument.settings.typography.textLineHeight.toFixed(2))}
                    min={1}
                    max={2}
                    step={0.05}
                    unit=""
                    onChange={(textLineHeight) => updateTypography({ textLineHeight })}
                  />
                </section>
                <section>
                  <h3>Headings</h3>
                  {(["h1", "h2", "h3"] as const).map((level) => (
                    <>
                      <SliderField
                        label={`${level.toUpperCase()} size`}
                        value={emailDocument.settings.typography[level].fontSize}
                        min={14}
                        max={48}
                        onChange={(fontSize) => updateTypography({ [level]: { ...documentRef.current.settings.typography[level], fontSize } })}
                      />
                      <label>
                        <span>{level.toUpperCase()} colour</span>
                        <ColorControl
                          value={emailDocument.settings.typography[level].color}
                          onChange={(color) => updateTypography({ [level]: { ...documentRef.current.settings.typography[level], color } })}
                        />
                      </label>
                    </>
                  ))}
                  <SliderField
                    label="Heading line spacing"
                    value={Number(emailDocument.settings.typography.headingLineHeight.toFixed(2))}
                    min={1}
                    max={2}
                    step={0.05}
                    unit=""
                    onChange={(headingLineHeight) => updateTypography({ headingLineHeight })}
                  />
                </section>
                <section>
                  <h3>Links</h3>
                  <label>
                    <span>Link colour</span>
                    <ColorControl
                      value={emailDocument.settings.linkColor}
                      onChange={(linkColor) =>
                        commit({
                          ...documentRef.current,
                          settings: { ...documentRef.current.settings, linkColor },
                        })
                      }
                    />
                  </label>
                  <label class="etb-checkbox-row">
                    <input
                      type="checkbox"
                      checked={emailDocument.settings.linkUnderline}
                      onChange={(event) =>
                        commit({
                          ...documentRef.current,
                          settings: {
                            ...documentRef.current.settings,
                            linkUnderline: event.currentTarget.checked,
                          },
                        })
                      }
                    />
                    <span>Underline links</span>
                  </label>
                </section>
              </fieldset>
            </>
          )}
        </aside>
      </main>
      {/* A read-only template would render every control disabled — a "broken"
          toolbar. The banner already explains why editing is unavailable. */}
      {canEdit &&
        activeTextTarget &&
        selected &&
        (blockHasRichText(selected) || selectedIsButton) && (
        <FloatingTextToolbar
          target={activeTextTarget}
          variant={selectedIsButton ? "button" : "rich"}
          align={selected.styles.align}
          fontWeight={selected.styles.fontWeight}
          onAlignChange={(align) => updateStyle("align", align)}
          onWeightChange={(fontWeight) => updateStyle("fontWeight", fontWeight)}
          disabled={!canEdit || selected.locked}
          style={activeTextStyle}
          onChange={(html) =>
            updateSelected((block) => ({
              ...block,
              properties: { ...block.properties, html },
            }))
          }
          onStyleChange={(change) =>
            updateSelected((block) => ({
              ...block,
              styles: { ...block.styles, ...change },
            }))
          }
        />
      )}
      <footer class="etb-statusbar">
        <span>
          <i class="fas fa-layer-group" /> {emailDocument.blocks.length}{" "}
          sections
        </span>
        <span>
          <i class="fas fa-envelope" />{" "}
          {previewMode === "desktop"
            ? `${emailDocument.settings.width}px email`
            : "390px mobile preview"}
        </span>
        <span>
          <i class="fas fa-keyboard" /> Ctrl/Cmd+Z undo · Shift+Z redo · S save
          · D duplicate
        </span>
        <span class="etb-status-spacer" />
        <span>Email-compatible table output</span>
      </footer>

      {previewOpen && (
        <div
          class="ets-preview-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setPreviewOpen(false);
          }}
        >
          <section
            class="ets-preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Email preview"
          >
            <header>
              <div>
                <span>Rendered output</span>
                <h2>{name || "Untitled template"}</h2>
              </div>
              <div class="ets-preview-tabs">
                <button
                  class={previewTab === "html" ? "active" : ""}
                  onClick={() => setPreviewTab("html")}
                >
                  Email
                </button>
                <button
                  class={previewTab === "text" ? "active" : ""}
                  onClick={() => setPreviewTab("text")}
                >
                  Plain text
                </button>
              </div>
              <button
                class="ets-icon-button"
                onClick={() => setPreviewOpen(false)}
                aria-label="Close preview"
              >
                <i class="fas fa-xmark" />
              </button>
            </header>
            <div class="ets-inbox-preview">
              <strong>{subject || "No subject"}</strong>
              <span>{preheader || "No preheader text"}</span>
            </div>
            {!preview ? (
              <div class="ets-preview-loading">
                <Spinner size={18} /> Compiling email&hellip;
              </div>
            ) : previewTab === "html" ? (
              <iframe
                title="Rendered email"
                sandbox="allow-popups"
                srcDoc={preview.html}
              />
            ) : (
              <pre>{preview.text || "The plain-text version is empty."}</pre>
            )}
          </section>
        </div>
      )}
      {transactionalLibraryOpen && (
        <div
          class="etb-library-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target)
              setTransactionalLibraryOpen(false);
          }}
        >
          <section
            class="etb-library-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="etb-library-title"
          >
            <header>
              <div>
                <small>Smart content collection</small>
                <h2 id="etb-library-title">Transactional library</h2>
                <p>
                  Add polished sections that are filled safely from live SIOMAC
                  records when the message is sent.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTransactionalLibraryOpen(false)}
                aria-label="Close transactional library"
              >
                <LucideIcon name="X" size={20} />
              </button>
            </header>
            <div class="etb-library-body">
              <nav aria-label="Transactional content blocks">
                {transactionalDefinitions.map((item) => {
                  const cardCopy =
                    TRANSACTIONAL_CARD_COPY[item.type] ?? item.description;
                  return (
                    <button
                      type="button"
                      class={`etb-library-card tone-${item.type} ${transactionalPreviewType === item.type ? "active" : ""}`}
                      onClick={() => setTransactionalPreviewType(item.type)}
                    >
                      <TransactionalCardArt
                        type={item.type}
                        icon={item.icon}
                        copy={cardCopy}
                      />
                      <span class="etb-library-card-copy">
                        <strong>{item.label}</strong>
                        <small>
                          {TRANSACTIONAL_DETAILS[item.type]?.bestFor ??
                            item.description}
                        </small>
                      </span>
                      <LucideIcon name="ChevronRight" size={16} />
                    </button>
                  );
                })}
              </nav>
              <article class="etb-library-preview">
                <div class="etb-library-purpose">
                  <span>
                    <i
                      class={`fas ${transactionalDefinition?.icon ?? "fa-database"}`}
                    />{" "}
                    {transactionalDefinition?.label}
                  </span>
                  <h3>{transactionalDetail?.purpose}</h3>
                  <dl>
                    <div>
                      <dt>Live data source</dt>
                      <dd>{transactionalDetail?.source}</dd>
                    </div>
                    <div>
                      <dt>Best used for</dt>
                      <dd>{transactionalDetail?.bestFor}</dd>
                    </div>
                  </dl>
                </div>
                <div class="etb-library-preview-frame">
                  <span>Recipient preview · Realistic sample data</span>
                  <iframe
                    title="Transactional content preview"
                    sandbox="allow-popups"
                    srcDoc={transactionalPreview.html}
                  />
                </div>
              </article>
            </div>
            <footer>
              <span>
                <i class="fas fa-shield-halved" /> Preview values are examples.
                Runtime values remain server-controlled.
              </span>
              <div>
                <button
                  type="button"
                  class="etb-library-cancel"
                  onClick={() => setTransactionalLibraryOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  class="etb-library-add"
                  onClick={() => {
                    addBlock(transactionalPreviewType);
                    setTransactionalLibraryOpen(false);
                  }}
                >
                  <i class="fas fa-plus" /> Add to email
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
