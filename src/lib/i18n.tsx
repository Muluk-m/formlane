import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Locale = "en" | "zh";

const STRINGS = {
  kicker: { en: "Atoms Demo", zh: "Atoms Demo" },
  hero: { en: "An AI team that ships a working app.", zh: "一组 AI 同事，把想法做成能用的应用。" },
  sub: {
    en: "Describe a product. Mike plans it, Emma scopes it, Bob picks the structure, and Alex writes a page you can click in the preview.",
    zh: "用一句话描述产品。Mike 排计划，Emma 收需求，Bob 定结构，Alex 写出右侧可以直接点的页面。",
  },
  placeholder: {
    en: "A weekend market map, a studio booking board, a tool library…",
    zh: "周末市集地图、工作室预约板、邻里工具图书馆……",
  },
  hint: { en: "Enter to build · Shift+Enter for a new line", zh: "Enter 开始 · Shift+Enter 换行" },
  build: { en: "Build", zh: "开始做" },
  building: { en: "Starting…", zh: "正在开始…" },
  examples: { en: "Try one", zh: "用一个例子" },
  team: { en: "The team on this build", zh: "这一版里的团队" },
  projects: { en: "Your projects", zh: "你的项目" },
  empty: { en: "Nothing in this browser yet. The first idea you send will land here.", zh: "这个浏览器里还没有项目。发出的第一个想法会出现在这里。" },
  noAccount: {
    en: "No account. Projects stay with this browser. Published links are public.",
    zh: "不用注册。项目只跟这台浏览器走。发布出去的链接是公开的。",
  },
  versions: { en: "versions", zh: "个版本" },
  version: { en: "version", zh: "个版本" },
  published: { en: "Published", zh: "已发布" },
  delete: { en: "Delete", zh: "删除" },
  preview: { en: "Preview", zh: "预览" },
  code: { en: "Code", zh: "代码" },
  history: { en: "History", zh: "历史" },
  remix: { en: "Remix", zh: "复制" },
  download: { en: "Download", zh: "下载" },
  publish: { en: "Publish", zh: "发布" },
  updateLive: { en: "Update live", zh: "更新线上" },
  desktop: { en: "Desktop", zh: "桌面" },
  mobile: { en: "Mobile", zh: "手机" },
  back: { en: "All projects", zh: "全部项目" },
  followPlaceholder: { en: "Ask the team to change the app…", zh: "让团队改这个应用…" },
  send: { en: "Send", zh: "发送" },
  stop: { en: "Stop", zh: "停止" },
  files: { en: "Files", zh: "文件" },
  emptyPreview: { en: "The preview will show up here once Alex has a page.", zh: "等 Alex 写出页面，预览会出现在这里。" },
  emptyCode: { en: "No files yet.", zh: "还没有文件。" },
  restore: { en: "Restore", zh: "恢复" },
  current: { en: "Current", zh: "当前" },
  viewing: { en: "Viewing an older version", zh: "正在看旧版本" },
  backToCurrent: { en: "Back to current", zh: "回到当前" },
  copyLink: { en: "Copy link", zh: "复制链接" },
  copied: { en: "Copied", zh: "已复制" },
  unpublish: { en: "Unpublish", zh: "取消发布" },
  close: { en: "Close", zh: "关闭" },
  liveNote: { en: "Anyone with this link can open the app full screen.", zh: "拿到链接的人都能全屏打开这个应用。" },
  retry: { en: "Run the team", zh: "让团队再跑一次" },
  interrupted: { en: "The last run looks interrupted.", zh: "上一次生成好像中断了。" },
  takeOver: { en: "Take over", zh: "重新接手" },
  notFound: { en: "This project isn't in this browser.", zh: "这个浏览器里没有这个项目。" },
  home: { en: "Back home", zh: "回首页" },
  mockPill: { en: "Mock team", zh: "模拟团队" },
  livePill: { en: "Live model", zh: "真实模型" },
  noKey: {
    en: "No OpenAI key on this server. Generation will fail until you set OPENAI_API_KEY, or run with MOCK_LLM=true.",
    zh: "这台服务没有 OpenAI 密钥。设置 OPENAI_API_KEY，或用 MOCK_LLM=true 启动，才能生成。",
  },
} as const;

export type StringKey = keyof typeof STRINGS;

const EXAMPLES = [
  {
    title: { en: "Farmers market map", zh: "农夫市集地图" },
    prompt: {
      en: "A weekend farmers market map for a small coastal town. Shoppers filter stalls by what's in season, save a shortlist, and see which stalls take cards.",
      zh: "一个海滨小镇的周末农夫市集地图。访客可以按当季品类筛选摊位，收藏想去的摊，并看到哪些摊位能刷卡。",
    },
  },
  {
    title: { en: "Pottery studio board", zh: "陶艺工作室预约" },
    prompt: {
      en: "A pottery studio booking board where members reserve wheels, see which glazes are in stock, and join a weekend firing.",
      zh: "陶艺工作室的预约板。成员可以预约拉坯机、查看釉料库存，并报名周末的窑烧。",
    },
  },
  {
    title: { en: "Tool library", zh: "邻里工具图书馆" },
    prompt: {
      en: "A neighborhood tool library. Neighbors list drills and ladders, request to borrow them, and check what's back by Sunday.",
      zh: "邻里工具图书馆。邻居可以挂出电钻和梯子、申请借用，并查看哪些工具会在周日之前还回来。",
    },
  },
  {
    title: { en: "Espresso journal", zh: "浓缩品鉴日记" },
    prompt: {
      en: "An espresso tasting journal. Log beans, score sweetness and finish, and compare the last five shots side by side.",
      zh: "浓缩品鉴日记。记录豆子，给甜感和尾韵打分，并把最近五杯并排比较。",
    },
  },
];

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: StringKey) => string;
  examples: Array<{ title: string; prompt: string }>;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const stored = localStorage.getItem("atoms-locale");
    if (stored === "zh" || stored === "en") return stored;
    return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
  });

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  const value = useMemo<I18nValue>(() => {
    const setLocale = (next: Locale) => {
      localStorage.setItem("atoms-locale", next);
      setLocaleState(next);
    };
    return {
      locale,
      setLocale,
      t: (key) => STRINGS[key][locale],
      examples: EXAMPLES.map((example) => ({ title: example.title[locale], prompt: example.prompt[locale] })),
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n outside provider");
  return value;
}
