// Ported from Recipe Page.dc.html's ordered step list (`sc-for list="{{ steps }}"`). The
// per-step conditional timer chip (`sc-if value="{{ s.hasTimer }}"`) is the source's own
// partial-data handling and is ported as written — some steps show a timer chip, some do not.
export interface StepRow {
  id: string;
  body: string;
  timerLabel: string | null;
}

interface StepsListProps {
  steps: StepRow[];
  accent: string;
}

export default function StepsList({ steps, accent }: StepsListProps) {
  return (
    <div className="rp-steps-list">
      {steps.map((step, index) => {
        // Source: `numBg: i === 0 ? accent : '#fdf1ea', numColor: i === 0 ? '#fffaf6' : '#c04a26'`
        const isFirst = index === 0;
        const numBg = isFirst ? accent : "#fdf1ea";
        const numColor = isFirst ? "#fffaf6" : "#c04a26";
        return (
          <div key={step.id} className="rp-step">
            <div className="rp-step-num" style={{ background: numBg, color: numColor }}>
              {index + 1}
            </div>
            <div className="rp-step-body-wrap">
              <div className="rp-step-text">{step.body}</div>
              {step.timerLabel && <div className="rp-step-timer">{step.timerLabel}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
