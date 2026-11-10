import type { AgentId } from "./types";

export interface AgentProfile {
  id: AgentId;
  name: string;
  role: string;
  roleZh: string;
  blurb: string;
  blurbZh: string;
  color: string;
  initials: string;
  status: string;
  statusZh: string;
}

export const AGENTS: Record<AgentId, AgentProfile> = {
  mike: {
    id: "mike",
    name: "Mike",
    role: "Team lead",
    roleZh: "团队负责人",
    blurb: "Runs the plan and keeps every specialist on the same job.",
    blurbZh: "排好顺序，让每个角色做自己那一段。",
    color: "#2046f0",
    initials: "M",
    status: "Mike is planning the work…",
    statusZh: "Mike 正在排计划…",
  },
  emma: {
    id: "emma",
    name: "Emma",
    role: "Product manager",
    roleZh: "产品经理",
    blurb: "Turns the idea into a small spec Alex can actually build.",
    blurbZh: "把想法收成 Alex 能直接做的小规格。",
    color: "#6d4aff",
    initials: "E",
    status: "Emma is writing the requirements…",
    statusZh: "Emma 正在写需求…",
  },
  bob: {
    id: "bob",
    name: "Bob",
    role: "Architect",
    roleZh: "架构师",
    blurb: "Picks a structure that fits a single self-contained page.",
    blurbZh: "选定一个单页就能跑起来的结构。",
    color: "#0e7c66",
    initials: "B",
    status: "Bob is choosing the structure…",
    statusZh: "Bob 正在定结构…",
  },
  alex: {
    id: "alex",
    name: "Alex",
    role: "Engineer",
    roleZh: "工程师",
    blurb: "Writes the app you can click in the live preview.",
    blurbZh: "把页面写出来，让右侧预览可以直接点。",
    color: "#d4652f",
    initials: "A",
    status: "Alex is writing code…",
    statusZh: "Alex 正在写代码…",
  },
  david: {
    id: "david",
    name: "David",
    role: "Data analyst",
    roleZh: "数据分析",
    blurb: "Says what you would measure if this met real people.",
    blurbZh: "告诉你如果拿去给人用，该看哪些数。",
    color: "#c43b6e",
    initials: "D",
    status: "David is reading the results…",
    statusZh: "David 正在看结果…",
  },
};
