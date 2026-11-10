import { AGENTS } from "../../shared/agents";
import type { AgentId } from "../../shared/types";

export function AgentAvatar({ id, size = 36 }: { id: AgentId; size?: number }) {
  const agent = AGENTS[id];
  return (
    <span
      className="inline-grid place-items-center rounded-full font-semibold text-white shrink-0"
      style={{ width: size, height: size, background: agent.color, fontSize: size < 32 ? 11 : 13 }}
      aria-hidden="true"
    >
      {agent.initials}
    </span>
  );
}
