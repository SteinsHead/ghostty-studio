import type { RefObject } from "react";
import {
  BookOpen,
  ChevronRight,
  FileCog,
  FileText,
  History,
  Layers3,
  MoreHorizontal,
  PanelLeft,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import type { AppLocale, LocalizedText } from "../i18n";
import type { ConfigCandidate } from "../types";
import { categoryLabel } from "../workspaceModel";
import { StudioMark } from "./StudioMark";

interface StudioSidebarProps {
  searchInputRef: RefObject<HTMLInputElement | null>;
  utilityMenuRef: RefObject<HTMLDetailsElement | null>;
  search: string;
  searchLabel: string;
  primaryModifier: string;
  workspaceReady: boolean;
  category: string;
  categories: Array<[string, number]>;
  locale: AppLocale;
  activeCandidate: ConfigCandidate | null;
  desktop: boolean;
  ghosttyVersion: string | null;
  busy: boolean;
  text: LocalizedText;
  onSearch(search: string): void;
  onFocusFirstResult(): void;
  onSelectCategory(category: string): void;
  onOpenHistory(): void;
  onOpenSource(): void;
  onOpenGraph(): void;
}

function categoryIcon(category: string) {
  if (category === "common") return Star;
  if (category === "configured") return FileText;
  if (category === "catalog") return BookOpen;
  if (category === "appearance") return Sparkles;
  if (category === "privacy-security") return ShieldCheck;
  if (category === "window") return PanelLeft;
  if (category === "advanced") return Settings2;
  return SlidersHorizontal;
}

export function StudioSidebar({
  searchInputRef,
  utilityMenuRef,
  search,
  searchLabel,
  primaryModifier,
  workspaceReady,
  category,
  categories,
  locale,
  activeCandidate,
  desktop,
  ghosttyVersion,
  busy,
  text,
  onSearch,
  onFocusFirstResult,
  onSelectCategory,
  onOpenHistory,
  onOpenSource,
  onOpenGraph,
}: StudioSidebarProps) {
  const closeUtilityMenu = () => utilityMenuRef.current?.removeAttribute("open");

  return (
    <aside className="sidebar" data-workspace-ready={workspaceReady ? "true" : "false"}>
      <div className="brand">
        <div className="brand-mark"><StudioMark size={22} /></div>
        <strong>Ghostty Studio</strong>
      </div>

      <div className="sidebar-search search-box">
        <Search size={15} />
        <input
          ref={searchInputRef}
          value={workspaceReady ? search : ""}
          disabled={!workspaceReady}
          onChange={(event) => onSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && search) {
              event.preventDefault();
              onSearch("");
            } else if (
              search
              && (event.key === "Enter"
                || (event.key === "ArrowDown" && (event.metaKey || event.ctrlKey)))
            ) {
              event.preventDefault();
              onFocusFirstResult();
            }
          }}
          placeholder={workspaceReady
            ? searchLabel
            : text("打开配置后即可搜索", "Open a configuration to search")}
          aria-label={searchLabel}
          aria-keyshortcuts={workspaceReady
            ? `Meta+K Control+K${search ? " Escape" : ""}`
            : undefined}
          aria-describedby={workspaceReady && search ? "search-result-count" : undefined}
        />
        {workspaceReady && search ? (
          <button
            type="button"
            className="search-clear"
            aria-label={text("清除搜索", "Clear search")}
            onClick={() => {
              onSearch("");
              searchInputRef.current?.focus();
            }}
          >
            <X size={13} />
          </button>
        ) : workspaceReady ? <kbd>{primaryModifier}K</kbd> : null}
      </div>

      <nav
        className="main-nav"
        aria-label={text("工作区视图", "Workspace views")}
        aria-disabled={!workspaceReady || undefined}
      >
        <span className="nav-title">{text("工作区", "Workspace")}</span>
        {(["common", "configured"] as const).map((view) => {
          const Icon = categoryIcon(view);
          return (
            <button
              type="button"
              key={view}
              className={workspaceReady && !search && category === view ? "active" : ""}
              aria-current={workspaceReady && !search && category === view ? "page" : undefined}
              disabled={!workspaceReady}
              onClick={() => onSelectCategory(view)}
            >
              <Icon size={16} />
              <span>{view === "configured" ? text("已设置", "Configured") : text("常用", "Essentials")}</span>
            </button>
          );
        })}
      </nav>

      <nav
        className="category-nav"
        aria-label={text("设置分类", "Setting categories")}
        aria-disabled={!workspaceReady || undefined}
      >
        <span className="nav-title">{text("设置", "Settings")}</span>
        {categories.map(([name]) => {
          const Icon = categoryIcon(name);
          return (
            <button
              type="button"
              key={name}
              className={workspaceReady && !search && category === name ? "active" : ""}
              aria-current={workspaceReady && !search && category === name ? "page" : undefined}
              disabled={!workspaceReady}
              onClick={() => onSelectCategory(name)}
            >
              <Icon size={16} />
              <span>{categoryLabel(locale, name)}</span>
            </button>
          );
        })}
        <button
          type="button"
          className={workspaceReady && !search && category === "catalog" ? "active" : ""}
          aria-current={workspaceReady && !search && category === "catalog" ? "page" : undefined}
          disabled={!workspaceReady}
          onClick={() => onSelectCategory("catalog")}
        >
          <BookOpen size={16} />
          <span>{text("全部设置", "All settings")}</span>
        </button>
      </nav>

      <div className="sidebar-footer">
        <button type="button" className="source-context" onClick={onOpenSource} disabled={busy}>
          <FileText size={16} />
          <span>
            <strong>{activeCandidate?.label ?? text("选择配置", "Choose configuration")}</strong>
            <small>{desktop
              ? `Ghostty ${ghosttyVersion ?? text("未连接", "Not connected")}`
              : text("试用模式", "Try mode")}</small>
          </span>
          <ChevronRight size={14} />
        </button>
        <details ref={utilityMenuRef} className="utility-menu">
          <summary><MoreHorizontal size={16} /><span>{text("更多", "More")}</span></summary>
          <div className="utility-menu__popover">
            <button type="button" disabled={!workspaceReady || busy} onClick={() => { closeUtilityMenu(); onOpenHistory(); }}>
              <History size={15} /> {text("恢复点", "Restore points")}
            </button>
            <button type="button" disabled={busy} onClick={() => { closeUtilityMenu(); onOpenSource(); }}>
              <Layers3 size={15} /> {text("写入位置", "Write location")}
            </button>
            <button type="button" onClick={() => { closeUtilityMenu(); onOpenGraph(); }}>
              <FileCog size={15} /> {text("加载顺序", "Load order")}
            </button>
          </div>
        </details>
      </div>
    </aside>
  );
}
