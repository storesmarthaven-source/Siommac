interface ToastProgressProps {
  duration: number;
  remainingMs: number;
}

export function ToastProgress({ duration, remainingMs }: ToastProgressProps) {
  if (duration <= 0) return null;

  const elapsedRatio = Math.min(1, Math.max(0, (duration - remainingMs) / duration));

  return (
    <div className="siomac-toast__progress-track" aria-hidden="true">
      <div
        className="siomac-toast__progress"
        style={{ transform: `scaleX(${elapsedRatio})` }}
      />
    </div>
  );
}
