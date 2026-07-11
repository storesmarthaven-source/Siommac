export interface FontOption {
  value: string;
  label: string;
}

export const FONT_OPTIONS: readonly FontOption[] = [
  { value: 'Inter, sans-serif', label: 'Inter — modern UI' },
  { value: 'Manrope, sans-serif', label: 'Manrope — geometric' },
  { value: 'Sora, sans-serif', label: 'Sora — corporate' },
  { value: "'Space Grotesk', sans-serif", label: 'Space Grotesk — techy' },
  { value: 'Fraunces, serif', label: 'Fraunces — elegant serif' },
  { value: 'Georgia, serif', label: 'Georgia — classic serif' },
  { value: "'IBM Plex Mono', monospace", label: 'IBM Plex Mono — ledger' },
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: "'Times New Roman', serif", label: 'Times New Roman' },
];

export const DEFAULT_FONT = 'Inter, sans-serif';
