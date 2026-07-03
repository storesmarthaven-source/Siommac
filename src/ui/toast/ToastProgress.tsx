interface ToastProgressProps {
  duration: number;
  paused: boolean;
}

export function ToastProgress({ duration }: ToastProgressProps) {
  if (duration <= 0) return null;

  return (
    <div
      className="siomac-toast__progress"
      style={{ animationDuration: `${duration}ms` }}
    />
  );
}
