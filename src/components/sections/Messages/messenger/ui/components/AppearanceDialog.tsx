// Ported verbatim from the bundle (ui/components/AppearanceDialog.tsx).
import { Check, Palette, RotateCcw } from "./icons";
import { useEffect, useState } from "preact/hooks";
import { Dialog } from "./Dialog";
import { defaultChatPreferences, type ChatPreferences, type ConversationSurface } from "../../domain/preferences";

const accentPresets = [
  { color: "#001f3f", label: "SIOMAC Navy" },
  { color: "#315d85", label: "Operational Blue" },
  { color: "#147a78", label: "Assurance Teal" },
  { color: "#2f6b45", label: "Safety Green" },
] as const;
const surfaces: Array<{ value: ConversationSurface; label: string; color: string }> = [
  { value: "white", label: "White", color: "#ffffff" },
  { value: "soft-gray", label: "Soft gray", color: "#f5f7fa" },
  { value: "cool-blue", label: "Cool blue", color: "#f2f6fa" },
];

export function AppearanceDialog({ open, value, onSave, onClose }: {
  open: boolean;
  value: ChatPreferences;
  onSave(value: ChatPreferences): Promise<void>;
  onClose(): void;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  useEffect(() => { if (open) { setDraft(value); setSaveError(""); } }, [open, value]);

  function set<K extends keyof ChatPreferences>(key: K, next: ChatPreferences[K]) {
    setDraft((current) => ({ ...current, [key]: next }));
  }
  async function save() {
    setSaving(true); setSaveError("");
    try { await onSave(draft); onClose(); }
    catch { setSaveError("Preferences could not be saved. Try again."); }
    finally { setSaving(false); }
  }

  return <Dialog open={open} title="Chat appearance" description="Personalize how conversations appear on this device." icon={<Palette />} onClose={onClose} size="small">
    <div className="sm-appearance-settings">
      <fieldset>
        <legend>Interface color</legend>
        <div className="sm-color-presets">
          {accentPresets.map((preset) => <button key={preset.color} type="button" aria-label={preset.label} aria-pressed={draft.accent === preset.color} style={{ backgroundColor: preset.color }} onClick={() => set("accent", preset.color)}>{draft.accent === preset.color ? <Check /> : null}</button>)}
        </div>
      </fieldset>

      <fieldset><legend>Conversation surface</legend><div className="sm-surface-options">{surfaces.map((surface) => <button key={surface.value} type="button" aria-pressed={draft.surface === surface.value} onClick={() => set("surface", surface.value)}><i style={{ backgroundColor: surface.color }} />{surface.label}{draft.surface === surface.value ? <Check /> : null}</button>)}</div></fieldset>

      <fieldset>
        <legend>Message spacing</legend>
        <div className="sm-density-options">
          {(["compact", "comfortable", "spacious"] as const).map((density) => <button key={density} type="button" aria-pressed={draft.density === density} onClick={() => set("density", density)}>{density}</button>)}
        </div>
      </fieldset>

      <fieldset>
        <legend>Accessibility</legend>
        <div className="sm-accessibility-controls">
          <div>
            <span><strong>Message text size</strong><small>Increase conversation and composer text.</small></span>
            <select aria-label="Message text size" value={draft.messageTextSize} onChange={(event) => set("messageTextSize", event.currentTarget.value as ChatPreferences["messageTextSize"])}>
              <option value="normal">Normal</option><option value="large">Large</option><option value="extra-large">Extra large</option>
            </select>
          </div>
          <AccessibilitySwitch label="High contrast" description="Strengthen borders and text contrast." checked={draft.highContrast} onChange={(checked) => set("highContrast", checked)} />
          <AccessibilitySwitch label="Reduce motion" description="Disable interface animations." checked={draft.reducedMotion} onChange={(checked) => set("reducedMotion", checked)} />
          <AccessibilitySwitch label="Enhanced focus" description="Show stronger keyboard focus indicators." checked={draft.enhancedFocus} onChange={(checked) => set("enhancedFocus", checked)} />
        </div>
      </fieldset>

      <div className="sm-appearance-preview" aria-label="Appearance preview" style={`--sm-navy:${draft.accent};--sm-thread-bg:${surfaces.find((surface) => surface.value === draft.surface)?.color ?? "#f5f7fa"}`}>
        <span className="is-received">Received message</span><span className="is-admin">Your message</span>
      </div>

      <footer className="sm-appearance-footer">
        <button type="button" onClick={() => setDraft(defaultChatPreferences)}><RotateCcw />Reset defaults</button>
        <button type="button" disabled={saving} onClick={() => void save()}>{saving ? "Saving..." : "Save preferences"}</button>
      </footer>
      {saveError ? <p className="sm-settings-error" role="alert">{saveError}</p> : null}
    </div>
  </Dialog>;
}

function AccessibilitySwitch({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange(checked: boolean): void }) {
  return <div><span><strong>{label}</strong><small>{description}</small></span><button className="sm-settings-switch" type="button" role="switch" aria-label={label} aria-checked={checked} onClick={() => onChange(!checked)}><i /></button></div>;
}
