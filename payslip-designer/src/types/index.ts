/**
 * Domain model for the payslip designer.
 * Elements are a discriminated union on `type`; shared visual props live in `StyleProps`.
 */

export type ElementType =
  | 'heading'
  | 'text'
  | 'field'
  | 'table'
  | 'summary'
  | 'image'
  | 'divider'
  | 'box';

export type Align = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'middle' | 'bottom';
export type BorderStyle = 'solid' | 'dashed' | 'dotted';
export type ImageFit = 'contain' | 'cover' | 'fill';

/** Geometry + stacking shared by every element. */
export interface BaseElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  /** Group id — elements sharing one move/resize/select together. */
  group?: string;
  /** Custom layer name shown in the Layers panel (overrides the derived label). */
  name?: string;
}

/** Visual styling shared by the "rich" elements (everything except divider/image). */
export interface StyleProps {
  color: string;
  bg: string; // hex, #rrggbbaa, or 'transparent'
  fontSize: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: Align;
  valign: VAlign;
  borderW: number;
  borderColor: string;
  borderStyle: BorderStyle;
  radius: number;
  padding: number;
  lineHeight: number;
}

export interface TextElement extends BaseElement, StyleProps {
  type: 'heading' | 'text';
  text: string;
}

export interface FieldElement extends BaseElement, StyleProps {
  type: 'field';
  label: string;
  token: string;
  labelWidth: number;
}

export interface BoxElement extends BaseElement, StyleProps {
  type: 'box';
}

export interface SummaryElement extends BaseElement, StyleProps {
  type: 'summary';
  label: string;
  token: string;
  sub: string;
  accent: string;
  /** Static value shown instead of the token when non-empty. */
  value: string;
}

export interface TableRow {
  label: string;
  amount: string;
  /** Only used when the table shows the Hours/Rate columns. */
  hours?: string;
  rate?: string;
  /** Per-row background colour (overrides the zebra striping). */
  bg?: string;
  /** Per-row text colour. */
  color?: string;
  /** Per-row height in px (blank = auto). */
  height?: number;
}

export interface TableElement extends BaseElement, StyleProps {
  type: 'table';
  title: string;
  /** Title text size (px, blank = body size + 2). */
  titleFontSize?: number;
  accent: string;
  rows: TableRow[];
  showHead: boolean;
  showTotal: boolean;
  totalLabel: string;
  labelCol: string;
  amtCol: string;
  /** Adds Hours/Units + Rate columns between description and amount. */
  showHoursRate: boolean;
  hoursCol: string;
  rateCol: string;
  /** Text colour of the accent header row (white on dark, dark on yellow). */
  headColor: string;
  /** Text colour of the total row. */
  totalColor: string;
  /** Header row height (px, blank = auto). */
  headHeight?: number;
  /** Header row font size (px, blank = 11). */
  headFontSize?: number;
  /** Header text weight (default bold). */
  headBold?: boolean;
  /** Header font family (blank = same as body). */
  headFontFamily?: string;
  /** Alternate (zebra) row background. Blank = default; 'transparent' = off. */
  stripeBg?: string;
  /** Draw faint ruled lines in the empty fill area (default true). */
  showRules?: boolean;
  /** Per-column widths as fractions (sum ≈ 1) for the currently visible columns. */
  colFr?: number[];
}

export interface DividerElement extends BaseElement {
  type: 'divider';
  color: string;
  thickness: number;
  style: BorderStyle;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  src: string;
  radius: number;
  fit: ImageFit;
}

export type DesignElement =
  | TextElement
  | FieldElement
  | BoxElement
  | SummaryElement
  | TableElement
  | DividerElement
  | ImageElement;

/**
 * Every editable property across all element types, merged into one interface.
 * (`Omit`/`Partial` over the discriminated union would keep only common keys,
 * and intersecting the members collapses to `never` on the `type` discriminant —
 * so we declare the superset explicitly.)
 */
export interface EditableProps extends BaseElement, StyleProps {
  // text / heading
  text: string;
  // field
  label: string;
  token: string;
  labelWidth: number;
  // summary
  sub: string;
  accent: string;
  value: string;
  // table
  rows: TableRow[];
  title: string;
  showHead: boolean;
  showTotal: boolean;
  totalLabel: string;
  labelCol: string;
  amtCol: string;
  showHoursRate: boolean;
  hoursCol: string;
  rateCol: string;
  titleFontSize?: number;
  headColor: string;
  totalColor: string;
  headHeight?: number;
  headFontSize?: number;
  headBold?: boolean;
  headFontFamily?: string;
  stripeBg?: string;
  showRules?: boolean;
  colFr?: number[];
  // divider
  thickness: number;
  style: BorderStyle;
  // image
  src: string;
  fit: ImageFit;
}

/** A partial patch applied to a single element during editing. */
export type ElementPatch = Partial<Omit<EditableProps, 'id' | 'type'>>;

export type PageSize = 'a4' | 'letter' | 'legal' | 'a5' | 'half';
export type Orientation = 'portrait' | 'landscape';

export interface PageConfig {
  size: PageSize;
  orient: Orientation;
  bg: string;
  grid: boolean;
}

export interface Design {
  page: PageConfig;
  elements: DesignElement[];
}

export interface ViewState {
  zoom: number;
  snap: boolean;
  preview: boolean;
}
