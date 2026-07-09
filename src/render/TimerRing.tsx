/** טיימר עיגול בולט (SPEC סעיף 9) — סטרוק SVG שמתרוקן עם הזמן. */

export function TimerRing({ remaining, total }: { remaining: number; total: number }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const fraction = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  const urgent = remaining <= 5;

  return (
    <div className={`timer-ring${urgent ? ' timer-ring--urgent' : ''}`}>
      <svg viewBox="0 0 128 128" width="128" height="128">
        <circle cx="64" cy="64" r={radius} className="timer-ring-track" />
        <circle
          cx="64"
          cy="64"
          r={radius}
          className="timer-ring-progress"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          transform="rotate(-90 64 64)"
        />
      </svg>
      <span className="timer-ring-value">{Math.ceil(remaining)}</span>
    </div>
  );
}
