const translations = {
  en: {
    skip: "Skip to content",
    navWhy: "Why Studio",
    navDemo: "Demo",
    navSafety: "Safety",
    navRoadmap: "Roadmap",
    github: "GitHub",
    downloadShort: "Download",
    brandHome: "Ghostty Studio home",
    primaryNav: "Primary navigation",
    principles: "Product principles",
    productDemo: "Ghostty Studio product demonstration",
    fullDemo: "Full Ghostty Studio demonstration with English captions",
    pauseDemo: "Pause product demonstration",
    playDemo: "Play product demonstration",
    generatedExample: "Regenerated configuration example",
    preservedExample: "Preserved configuration example",
    architectureLabel: "Ghostty Studio architecture layers",
    footerNav: "Footer navigation",
    eyebrow: "LOCAL · LOSSLESS · REVIEWED",
    heroTitle: "Your Ghostty config,<br /><span>without the config-file anxiety.</span>",
    heroLede: "Open the config you already use. Tune it visually, inspect the exact diff, let Ghostty validate it, and save with a restore point.",
    download: "Download for Apple Silicon",
    watch: "Watch 23-second demo",
    releaseNote: "Early preview · macOS 11+ · MIT licensed",
    calloutPreserve: "Comments and ordering preserved",
    calloutLocal: "No account. No telemetry.",
    trustLocal: "Runs locally",
    trustExisting: "Edits your existing file",
    trustGhostty: "Validated by Ghostty",
    trustOpen: "Open source",
    problemEyebrow: "THE FILE IS THE PRODUCT",
    problemTitle: "A configurator should respect the config you wrote.",
    problemLede: "Most visual editors regenerate a clean file. Ghostty Studio changes only the settings you review and leaves the rest exactly where you put it.",
    before: "Typical generator",
    after: "Ghostty Studio",
    beforeCopy: "The setting is right, but the document is no longer yours.",
    afterCopy: "One reviewed change. Everything else remains byte-for-byte familiar.",
    demoEyebrow: "ONE CALM JOURNEY",
    demoTitle: "Adjust. Review. Save. Recover if you need to.",
    demoLede: "The preview moves quickly. Your real config never does.",
    videoFallback: "Your browser cannot play the demo video.",
    journeyOpen: "Open what is real",
    journeyOpenCopy: "Studio finds macOS and XDG candidates and opens the right source when there is nothing to decide.",
    journeyTune: "Tune with context",
    journeyTuneCopy: "Visual controls appear where they help. Reference details stay one disclosure away.",
    journeyReview: "Review the exact write",
    journeyReviewCopy: "A human summary and the raw diff show precisely what will change before confirmation.",
    journeySave: "Save with a way back",
    journeySaveCopy: "Ghostty validates the candidate and Studio creates a private restore point before replacing the file.",
    featureEyebrow: "BUILT FOR REAL SETUPS",
    featureTitle: "Simple on the surface. Careful underneath.",
    featureBackground: "A background studio, not a path field",
    featureBackgroundCopy: "Import private PNG or JPEG images, preview fit and position, adjust visibility, and switch between a small local library.",
    featureRuntime: "Learns from your Ghostty",
    featureRuntimeCopy: "The settings catalog comes from the Ghostty version installed on your machine, not a stale copied list.",
    featureSources: "Understands multiple sources",
    featureSourcesCopy: "Studio distinguishes the file you selected from the later include that may win, then verifies saved values with Ghostty.",
    featureLanguage: "English and 简体中文",
    featureLanguageCopy: "Follow the system language or switch instantly. Labels are written for people, while technical keys remain available.",
    featureUpgrade: "Upgrade-aware by default",
    featureUpgradeCopy: "Writable behavior is matched to a reviewed Ghostty contract. Unknown versions fail closed instead of guessing at write semantics.",
    safetyEyebrow: "LOCAL MEANS LOCAL",
    safetyTitle: "The safest network request is the one the app never makes.",
    safetyLede: "Ghostty Studio has no account, cloud service, telemetry, or general-purpose network, shell, and filesystem access in its webview.",
    threatModel: "Read the threat model",
    safeOpaque: "Fixed write targets",
    safeOpaqueCopy: "Rust binds a fixed write target to the current session. The interface cannot submit an arbitrary path.",
    safeConflict: "External-change protection",
    safeConflictCopy: "Revision checks stop a stale draft from overwriting edits made by another process.",
    safeAtomic: "Validated, atomic writes",
    safeAtomicCopy: "Ghostty checks the candidate; Studio snapshots, fsyncs, and replaces the target atomically.",
    safeImages: "Private image handling",
    safeImagesCopy: "Images are bounded, normalized, stripped of metadata, and stored with private permissions.",
    architectureEyebrow: "A SMALL TRUSTED CORE",
    architectureTitle: "Presentation can change. Safety rules do not.",
    archUi: "React interface",
    archUiCopy: "Untrusted presentation",
    archIpc: "Typed Tauri boundary",
    archIpcCopy: "Allowlisted commands",
    archRust: "Rust services",
    archRustCopy: "Parse · validate · write · recover",
    archGhostty: "Ghostty + your file",
    archGhosttyCopy: "The final source of truth",
    architectureLink: "Explore the architecture and invariants",
    roadmapEyebrow: "EARLY PREVIEW, CLEAR DIRECTION",
    roadmapTitle: "Depth before checkbox count.",
    roadmapLede: "The next milestones expand effective-value insight, recovery, compatibility, and specialized editors without weakening the save contract.",
    roadmapNow: "Lossless editing, review, validation, snapshots, local images",
    roadmapNext: "Richer effective-value and recovery center",
    roadmapLater: "Specialized editors and declarative extension packs",
    roadmapRelease: "Notarized and broader platform releases",
    roadmapLink: "Read the roadmap",
    faqEyebrow: "GOOD TO KNOW",
    faqTitle: "Before you download.",
    faqOfficial: "Is this an official Ghostty project?",
    faqOfficialCopy: "No. Ghostty Studio is an independent community project and is not affiliated with or endorsed by Ghostty.",
    faqPlatforms: "Which platforms are supported?",
    faqPlatformsCopy: "The current preview targets Apple Silicon Macs on macOS 11 or later. Linux and Intel support require their own tested platform contracts before release.",
    faqNotarized: "Why does macOS show a first-launch warning?",
    faqNotarizedCopy: "The preview is ad-hoc signed but not Apple-notarized. The release includes a SHA-256 checksum, and you can build from source.",
    faqSettings: "Why are some Ghostty settings reference-only?",
    faqSettingsCopy: "Repeatable, sensitive, and source-dependent settings need specialized write semantics. Studio shows them honestly instead of guessing.",
    ctaEyebrow: "YOUR CONFIG. STILL YOURS.",
    ctaTitle: "Make Ghostty feel like home.",
    ctaCopy: "Then save only when everything looks right.",
    starGithub: "Star on GitHub",
    footerCopy: "Local by design. Open source under MIT.",
    releases: "Releases",
    issues: "Issues",
    security: "Security",
  },
  zh: {
    skip: "跳到主要内容",
    navWhy: "为什么选择 Studio",
    navDemo: "演示",
    navSafety: "安全",
    navRoadmap: "路线图",
    github: "GitHub",
    downloadShort: "下载",
    brandHome: "Ghostty Studio 首页",
    primaryNav: "主要导航",
    principles: "产品原则",
    productDemo: "Ghostty Studio 产品演示",
    fullDemo: "带英文字幕的 Ghostty Studio 完整演示",
    pauseDemo: "暂停产品演示",
    playDemo: "播放产品演示",
    generatedExample: "重新生成配置的示例",
    preservedExample: "保留原文配置的示例",
    architectureLabel: "Ghostty Studio 架构分层",
    footerNav: "页脚导航",
    eyebrow: "本地 · 无损 · 先审后写",
    heroTitle: "可视化调整 Ghostty，<br /><span>原来的配置仍然是你的。</span>",
    heroLede: "打开你正在使用的配置，直观调整效果，查看实际差异，交给 Ghostty 验证，再带着恢复点安全保存。",
    download: "下载 Apple Silicon 版本",
    watch: "观看 23 秒演示",
    releaseNote: "早期预览版 · macOS 11+ · MIT 许可",
    calloutPreserve: "注释和顺序完整保留",
    calloutLocal: "无账号，无遥测",
    trustLocal: "完全本地运行",
    trustExisting: "编辑现有文件",
    trustGhostty: "由 Ghostty 验证",
    trustOpen: "开放源代码",
    problemEyebrow: "配置文件本身就是产品",
    problemTitle: "可视化编辑器，也应该尊重你写下的配置。",
    problemLede: "多数可视化工具会重新生成一份整洁的新文件。Ghostty Studio 只修改你确认过的设置，其余内容仍留在原来的位置。",
    before: "常见配置生成器",
    after: "Ghostty Studio",
    beforeCopy: "设置改对了，但这份文档已经不再像你的。",
    afterCopy: "只有一项经过确认的改动，其余内容仍保持熟悉的样子。",
    demoEyebrow: "一条平静、完整的旅程",
    demoTitle: "调整、检查、保存；需要时随时恢复。",
    demoLede: "预览可以很快，真实配置永远不会被仓促写入。",
    videoFallback: "当前浏览器无法播放演示视频。",
    journeyOpen: "打开真实来源",
    journeyOpenCopy: "Studio 会发现 macOS 与 XDG 候选；没有需要决定的事项时，直接进入正确的配置。",
    journeyTune: "在上下文中调整",
    journeyTuneCopy: "视觉控件只在有帮助时出现；技术参考始终只隔着一次展开。",
    journeyReview: "确认将要写入的内容",
    journeyReviewCopy: "自然语言摘要和原始 Diff 会在确认前逐项展示实际变化。",
    journeySave: "保存，也留好退路",
    journeySaveCopy: "Ghostty 先验证候选配置，Studio 再创建私有恢复点并原子替换文件。",
    featureEyebrow: "为真实配置而设计",
    featureTitle: "表面简单，底层谨慎。",
    featureBackground: "真正的背景工作台，不是一个路径输入框",
    featureBackgroundCopy: "导入私有 PNG 或 JPEG，实时预览适配与位置，调整可见度，并在小型本地图库中切换。",
    featureRuntime: "从你的 Ghostty 获取设置",
    featureRuntimeCopy: "设置目录来自机器上安装的 Ghostty 版本，而不是一份迟早会过期的复制表格。",
    featureSources: "理解多个配置来源",
    featureSourcesCopy: "Studio 区分你选择的文件与可能最终胜出的 include，并在保存后让 Ghostty 核对实际值。",
    featureLanguage: "English 与简体中文",
    featureLanguageCopy: "默认跟随系统，也可立即切换。标签写给人看，技术键名仍然随时可查。",
    featureUpgrade: "默认考虑升级风险",
    featureUpgradeCopy: "可写行为绑定到经过审查的 Ghostty 契约。遇到未验证版本时自动保持只读，不猜测写入语义。",
    safetyEyebrow: "本地，就应该真的留在本地",
    safetyTitle: "最安全的网络请求，是应用从未发出的那一次。",
    safetyLede: "Ghostty Studio 不需要账号，没有云服务与遥测；WebView 也没有通用网络、Shell 和文件系统访问能力。",
    threatModel: "阅读威胁模型",
    safeOpaque: "固定写入目标",
    safeOpaqueCopy: "Rust 会为当前会话绑定固定的写入目标，界面不能提交任意路径。",
    safeConflict: "外部修改保护",
    safeConflictCopy: "版本检查会阻止过期草稿覆盖其他程序刚刚写入的内容。",
    safeAtomic: "验证后的原子写入",
    safeAtomicCopy: "Ghostty 先检查候选；Studio 创建快照、同步数据并原子替换目标。",
    safeImages: "私有图片处理",
    safeImagesCopy: "图片受尺寸限制，会被标准化并去除元数据，再以私有权限保存。",
    architectureEyebrow: "小而可信的核心",
    architectureTitle: "界面可以演进，安全规则不会动摇。",
    archUi: "React 界面",
    archUiCopy: "不受信任的呈现层",
    archIpc: "类型化 Tauri 边界",
    archIpcCopy: "仅允许白名单命令",
    archRust: "Rust 服务",
    archRustCopy: "解析 · 验证 · 写入 · 恢复",
    archGhostty: "Ghostty 与你的文件",
    archGhosttyCopy: "最终事实来源",
    architectureLink: "查看完整架构与安全不变量",
    roadmapEyebrow: "早期预览，方向清晰",
    roadmapTitle: "先把旅程做深，再增加选项数量。",
    roadmapLede: "后续里程碑会加强生效值、恢复、兼容性与专用编辑器，同时不削弱现有保存契约。",
    roadmapNow: "无损编辑、检查、验证、快照与本地图片",
    roadmapNext: "更完整的生效值与恢复中心",
    roadmapLater: "专用编辑器与声明式扩展包",
    roadmapRelease: "公证签名与更广的平台发布",
    roadmapLink: "阅读路线图",
    faqEyebrow: "下载前需要知道",
    faqTitle: "几个诚实的答案。",
    faqOfficial: "这是 Ghostty 官方项目吗？",
    faqOfficialCopy: "不是。Ghostty Studio 是独立社区项目，与 Ghostty 官方没有隶属或背书关系。",
    faqPlatforms: "目前支持哪些平台？",
    faqPlatformsCopy: "当前预览版面向 macOS 11 或更高版本的 Apple Silicon Mac。Linux 与 Intel 需要各自经过测试的平台契约后才会发布。",
    faqNotarized: "为什么 macOS 首次打开会提示确认？",
    faqNotarizedCopy: "预览版采用 ad-hoc 签名，尚未经过 Apple 公证。Release 提供 SHA-256 校验值，你也可以从源码构建。",
    faqSettings: "为什么有些 Ghostty 设置只能查阅？",
    faqSettingsCopy: "重复值、敏感项和依赖来源的设置需要专用写入语义。Studio 会诚实说明，而不是猜测。",
    ctaEyebrow: "你的配置，仍然是你的",
    ctaTitle: "让 Ghostty 真正像自己的终端。",
    ctaCopy: "一切看起来正确之后，再安心保存。",
    starGithub: "在 GitHub 点 Star",
    footerCopy: "本地优先，以 MIT 许可开放源代码。",
    releases: "版本发布",
    issues: "问题反馈",
    security: "安全策略",
  },
};

const languageButton = document.querySelector("[data-language-toggle]");
const languageLabel = document.querySelector("[data-language-label]");

function preferredLanguage() {
  let saved;
  try {
    saved = localStorage.getItem("ghostty-studio-site-language");
  } catch {
    saved = undefined;
  }
  if (saved === "en" || saved === "zh") return saved;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function rememberLanguage(language) {
  try {
    localStorage.setItem("ghostty-studio-site-language", language);
  } catch {
    // The preference is optional; the language switch still works for this page view.
  }
}

function applyLanguage(language) {
  const copy = translations[language];
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const value = copy[element.dataset.i18n];
    if (value) element.textContent = value;
  });
  document.querySelectorAll("[data-i18n-html]").forEach((element) => {
    const value = copy[element.dataset.i18nHtml];
    if (value) element.innerHTML = value;
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    const value = copy[element.dataset.i18nAriaLabel];
    if (value) element.setAttribute("aria-label", value);
  });
  languageLabel.textContent = language === "zh" ? "English" : "中文";
  languageButton.setAttribute("aria-label", language === "zh" ? "Switch to English" : "切换为中文");
  document.title = language === "zh"
    ? "Ghostty Studio — 更安心地调整 Ghostty"
    : "Ghostty Studio — a safer way to edit Ghostty";
  rememberLanguage(language);
  updateHeroVideoButton();
}

let language = preferredLanguage();
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const heroVideo = document.querySelector("[data-hero-video]");
const heroVideoButton = document.querySelector("[data-video-toggle]");
const heroVideoButtonIcon = document.querySelector("[data-video-toggle-icon]");

function updateHeroVideoButton() {
  if (!heroVideo || !heroVideoButton || !heroVideoButtonIcon) return;
  const isPaused = heroVideo.paused;
  const label = translations[language][isPaused ? "playDemo" : "pauseDemo"];
  heroVideoButton.setAttribute("aria-label", label);
  heroVideoButton.title = label;
  heroVideoButtonIcon.textContent = isPaused ? "▶" : "Ⅱ";
}

applyLanguage(language);

languageButton.addEventListener("click", () => {
  language = language === "zh" ? "en" : "zh";
  applyLanguage(language);
});

if (heroVideo && heroVideoButton) {
  if (reducedMotion) heroVideo.pause();
  heroVideoButton.addEventListener("click", async () => {
    if (heroVideo.paused) {
      try {
        await heroVideo.play();
      } catch {
        // The browser may require a different media gesture; keep the paused state truthful.
      }
    } else {
      heroVideo.pause();
    }
    updateHeroVideoButton();
  });
  heroVideo.addEventListener("play", updateHeroVideoButton);
  heroVideo.addEventListener("pause", updateHeroVideoButton);
  updateHeroVideoButton();
}

const reveals = [...document.querySelectorAll(".reveal")];

if (reducedMotion || !("IntersectionObserver" in window)) {
  reveals.forEach((element) => element.classList.add("is-visible"));
} else {
  try {
    document.documentElement.classList.add("js");
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8%", threshold: 0.1 },
    );
    reveals.forEach((element) => observer.observe(element));
  } catch {
    document.documentElement.classList.remove("js");
  }
}
