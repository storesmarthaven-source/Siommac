// icons.tsx — adapts the bundle's `lucide-preact` per-icon imports onto the
// app's STANDARD icon system (the `lucide` data package rendered through
// @ui LucideIcon). Icon names are typed against the lucide export map, so a
// missing/renamed icon fails the typecheck instead of rendering blank.
// Sizing/stroke come from the scoped messenger.css (`.sm-workspace svg`).
import type { VNode } from "preact";
import { LucideIcon, type LucideName } from "@ui";

export type IconProps = { className?: string };

function make(name: LucideName) {
  return function Icon({ className }: IconProps): VNode {
    return <LucideIcon name={name} {...(className ? { class: className } : {})} />;
  };
}

export const Activity = make("Activity");
export const AlertCircle = make("AlertCircle");
export const Archive = make("Archive");
export const ArrowLeft = make("ArrowLeft");
export const ArrowUpRight = make("ArrowUpRight");
export const AudioLines = make("AudioLines");
export const Bell = make("Bell");
export const BellOff = make("BellOff");
export const Check = make("Check");
export const CheckCheck = make("CheckCheck");
export const CheckCircle2 = make("CheckCircle2");
export const ChevronDown = make("ChevronDown");
export const ChevronLeft = make("ChevronLeft");
export const ChevronRight = make("ChevronRight");
export const Clock3 = make("Clock3");
export const Copy = make("Copy");
export const Download = make("Download");
export const ExternalLink = make("ExternalLink");
export const Eye = make("Eye");
export const File = make("File");
export const FileArchive = make("FileArchive");
export const FileCode2 = make("FileCode2");
export const FileImage = make("FileImage");
export const FileJson = make("FileJson");
export const FileSpreadsheet = make("FileSpreadsheet");
export const FileText = make("FileText");
export const FileUp = make("FileUp");
export const FolderOpen = make("FolderOpen");
export const Globe2 = make("Globe2");
export const Heart = make("Heart");
export const Image = make("Image");
export const Inbox = make("Inbox");
export const Info = make("Info");
export const Link = make("Link");
export const Link2 = make("Link2");
export const LockKeyhole = make("LockKeyhole");
export const MessageCircle = make("MessageCircle");
export const MessageSquare = make("MessageSquare");
export const MessageSquareText = make("MessageSquareText");
export const MoreHorizontal = make("MoreHorizontal");
export const Palette = make("Palette");
export const PenSquare = make("PenSquare");
export const Paperclip = make("Paperclip");
export const Pin = make("Pin");
export const PinOff = make("PinOff");
export const Presentation = make("Presentation");
export const Reply = make("Reply");
export const RotateCcw = make("RotateCcw");
export const Search = make("Search");
export const Send = make("Send");
export const Settings2 = make("Settings2");
export const ShieldCheck = make("ShieldCheck");
export const Smile = make("Smile");
export const SmilePlus = make("SmilePlus");
export const Trash2 = make("Trash2");
export const UploadCloud = make("UploadCloud");
export const UserMinus = make("UserMinus");
export const UserPlus = make("UserPlus");
export const Users = make("Users");
export const X = make("X");
