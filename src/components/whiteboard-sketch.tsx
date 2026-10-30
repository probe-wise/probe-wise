/**
 * Hero illustration: a candidate's feed design mid-interview, with the interviewer's
 * follow-up questions in red pen. Purely decorative; the same idea is stated in the copy.
 */

type BoxProps = { x: number; y: number; w: number; h: number; label: string; sub?: string; delay: number };

function Box({ x, y, w, h, label, sub, delay }: BoxProps) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={7}
        className="board-stroke"
        style={{ animationDelay: `${delay}ms` }}
        fill="var(--board-raised)"
        stroke="var(--ink)"
        strokeWidth={2}
      />
      <text
        x={x + w / 2}
        y={sub ? y + h / 2 - 3 : y + h / 2 + 5}
        textAnchor="middle"
        className="board-ink"
        style={{ animationDelay: `${delay + 300}ms` }}
        fill="var(--ink)"
        fontSize="14"
        fontWeight="600"
      >
        {label}
      </text>
      {sub ? (
        <text
          x={x + w / 2}
          y={y + h / 2 + 14}
          textAnchor="middle"
          className="board-ink"
          style={{ animationDelay: `${delay + 300}ms` }}
          fill="var(--ink-faint)"
          fontSize="11.5"
        >
          {sub}
        </text>
      ) : null}
    </g>
  );
}

function Wire({ d, delay, dashed = false }: { d: string; delay: number; dashed?: boolean }) {
  return (
    <path
      d={d}
      className={dashed ? "board-ink" : "board-stroke"}
      style={{ animationDelay: `${delay}ms` }}
      fill="none"
      stroke="var(--marker)"
      strokeWidth={2}
      strokeLinecap="round"
      strokeDasharray={dashed ? "5 6" : undefined}
      markerEnd="url(#arrow)"
    />
  );
}

function Probe({ children, x, y, delay, anchor = "start" }: { children: React.ReactNode; x: number; y: number; delay: number; anchor?: "start" | "end" }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      className="board-ink hand"
      style={{ animationDelay: `${delay}ms` }}
      fill="var(--probe)"
      fontSize="21"
    >
      {children}
    </text>
  );
}

export function WhiteboardSketch() {
  return (
    <figure className="relative">
      <svg
        viewBox="0 0 560 440"
        className="h-auto w-full"
        role="img"
        aria-labelledby="board-title board-desc"
      >
        <title id="board-title">A news feed design sketched on a whiteboard</title>
        <desc id="board-desc">
          Boxes for clients, an API gateway, a feed service, a cache, a database and a fan-out queue. The interviewer has
          written follow-up questions in red: what happens when a cache node dies, what the peak write rate is, and how a
          celebrity post with millions of followers fans out.
        </desc>
        <defs>
          <pattern id="dots" width="18" height="18" patternUnits="userSpaceOnUse">
            <circle cx="1.5" cy="1.5" r="1.1" fill="var(--grid)" />
          </pattern>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M1 1 L9 5 L1 9" fill="none" stroke="var(--marker)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
          <marker id="probe-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M1 1 L9 5 L1 9" fill="none" stroke="var(--probe)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        </defs>

        <rect x="0" y="0" width="560" height="440" rx="14" fill="var(--board-raised)" />
        <rect x="0" y="0" width="560" height="440" rx="14" fill="url(#dots)" />
        <rect x="1" y="1" width="558" height="438" rx="13" fill="none" stroke="var(--grid)" strokeWidth="2" />

        {/* Candidate's design, in black and blue marker */}
        <Box x={28} y={170} w={96} h={56} label="Clients" sub="web · mobile" delay={0} />
        <Box x={168} y={170} w={110} h={56} label="API gateway" sub="auth · rate limit" delay={150} />
        <Box x={322} y={96} w={112} h={56} label="Feed service" sub="read path" delay={300} />
        <Box x={322} y={250} w={112} h={56} label="Post service" sub="write path" delay={450} />
        <Box x={462} y={86} w={80} h={50} label="Cache" sub="timelines" delay={600} />
        <Box x={462} y={250} w={80} h={56} label="Posts DB" sub="sharded" delay={700} />
        <Box x={322} y={346} w={112} h={46} label="Fan-out queue" delay={800} />

        <Wire d="M124 198 L164 198" delay={900} />
        <Wire d="M278 190 C300 170 300 130 318 124" delay={950} />
        <Wire d="M278 206 C300 226 300 270 318 278" delay={1000} />
        <Wire d="M434 118 L456 114" delay={1050} />
        <Wire d="M434 278 L456 278" delay={1100} />
        <Wire d="M378 306 L378 342" delay={1150} />
        <Wire d="M434 369 C520 369 548 300 548 220 C548 170 530 150 512 142" delay={1250} dashed />

        {/* Interviewer's follow-ups, in red pen */}
        <ellipse
          cx="502"
          cy="111"
          rx="54"
          ry="38"
          fill="none"
          stroke="var(--probe)"
          strokeWidth="2"
          className="board-stroke"
          style={{ animationDelay: "1500ms" }}
          transform="rotate(-6 502 111)"
        />
        <Probe x={330} y={44} delay={1650}>this node dies. now what?</Probe>
        <path
          d="M470 52 C482 58 490 64 494 70"
          fill="none"
          stroke="var(--probe)"
          strokeWidth="1.8"
          markerEnd="url(#probe-arrow)"
          className="board-ink"
          style={{ animationDelay: "1650ms" }}
        />

        <Probe x={36} y={296} delay={1900}>peak writes / sec?</Probe>
        <Probe x={36} y={322} delay={1900}>show me the math</Probe>

        <Probe x={40} y={414} delay={2150}>a celebrity posts to 30M followers</Probe>
      </svg>
    </figure>
  );
}
