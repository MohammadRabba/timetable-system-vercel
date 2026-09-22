"use client";
import { useEffect, useState } from "react";
import { useAppStore, useLangStore, type Pane } from "@/lib/store";
import { t, tr, DAY_LABELS, type DayCode } from "@/lib/i18n";
import {
  LayoutDashboard, School, GraduationCap, BookOpen, Users, DoorOpen,
  CalendarDays, ClipboardList, SlidersHorizontal, Calendar, CalendarRange,
  AlertTriangle, FileText, FileSpreadsheet, History, Settings,
  Menu, X, LogOut, Globe, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Sheet, SheetContent, SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface NavItem {
  pane: Pane;
  icon: any;
  labelKey: string;
}
const NAV: NavItem[] = [
  { pane: "dashboard", icon: LayoutDashboard, labelKey: "nav_dashboard" },
  { pane: "school", icon: School, labelKey: "nav_school" },
  { pane: "academic", icon: GraduationCap, labelKey: "nav_academic" },
  { pane: "subjects", icon: BookOpen, labelKey: "nav_subjects" },
  { pane: "teachers", icon: Users, labelKey: "nav_teachers" },
  { pane: "rooms", icon: DoorOpen, labelKey: "nav_rooms" },
  { pane: "lessons", icon: CalendarDays, labelKey: "nav_lessons" },
  { pane: "duties", icon: ClipboardList, labelKey: "nav_duties" },
  { pane: "constraints", icon: SlidersHorizontal, labelKey: "nav_constraints" },
  { pane: "schedule", icon: Calendar, labelKey: "nav_schedule" },
  { pane: "timetable", icon: CalendarRange, labelKey: "nav_timetable" },
  { pane: "conflicts", icon: AlertTriangle, labelKey: "nav_conflicts" },
  { pane: "reports", icon: FileText, labelKey: "nav_reports" },
  { pane: "excel", icon: FileSpreadsheet, labelKey: "nav_excel" },
  { pane: "audit", icon: History, labelKey: "nav_audit" },
  { pane: "settings", icon: Settings, labelKey: "nav_settings" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);
  const pane = useAppStore((s) => s.pane);
  const setPane = useAppStore((s) => s.setPane);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<{ name: string; email: string; role: string; schoolId: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [schoolName, setSchoolName] = useState<string>("");

  // Apply dir attribute on language change
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/auth/session");
      const j = await r.json();
      setUser(j.user || null);
      setLoading(false);
      if (j.user?.schoolId) {
        const sr = await fetch(`/api/schools/${j.user.schoolId}`);
        const sj = await sr.json();
        if (sj.school) {
          setSchoolName(sj.school.name);
          useAppStore.getState().setActiveSchoolId(j.user.schoolId);
        }
      } else if (j.user?.role === "SUPER_ADMIN") {
        // Auto-select first school for super admin
        const sr = await fetch("/api/schools", { cache: "no-store" });
        const sj = await sr.json();
        if (sj.schools?.length) {
          setSchoolName(sj.schools[0].name);
          useAppStore.getState().setActiveSchoolId(sj.schools[0].id);
        }
      }
    })();
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.ctrlKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        document.getElementById("btn-undo")?.click();
      } else if (e.ctrlKey && e.key.toLowerCase() === "y") {
        e.preventDefault();
        document.getElementById("btn-redo")?.click();
      } else if (e.key === "Escape") {
        // Cancel any active drag (dnd-kit handles this internally)
      } else if (e.key.toLowerCase() === "f" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const el = document.getElementById("global-search") as HTMLInputElement | null;
        el?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-slate-500">جارٍ التحميل… / Loading…</div>
      </div>
    );
  }

  if (!user) {
    // Show login screen
    return <LoginScreen />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950">
      <Header
        user={user}
        schoolName={schoolName}
        lang={lang}
        onToggleLang={() => setLang(lang === "ar" ? "en" : "ar")}
        onLogout={async () => {
          await fetch("/api/auth/logout", { method: "POST" });
          location.reload();
        }}
        onSearch={(q) => {
          // Dispatch search event for active pane
          window.dispatchEvent(new CustomEvent("global-search", { detail: q }));
        }}
      />

      <div className="flex-1 flex">
        {/* Sidebar (desktop) */}
        <aside className="hidden md:flex flex-col w-60 border-e border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <nav className="flex-1 overflow-y-auto p-2 space-y-1">
            {NAV.map((n) => {
              const Icon = n.icon;
              const active = pane === n.pane;
              return (
                <button
                  key={n.pane}
                  onClick={() => setPane(n.pane)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors text-start",
                    active
                      ? "bg-slate-900 text-white font-medium"
                      : "text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                  )}
                  title={tr(n.labelKey, lang)}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{tr(n.labelKey, lang)}</span>
                </button>
              );
            })}
          </nav>
          <div className="p-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500">
            <div>v1.0 · {schoolName || "No school"}</div>
            <div className="mt-1">{new Date().toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US")}</div>
          </div>
        </aside>

        {/* Mobile sidebar */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side={lang === "ar" ? "right" : "left"} className="w-64 p-0">
            <nav className="flex-1 overflow-y-auto p-2 space-y-1">
              {NAV.map((n) => {
                const Icon = n.icon;
                const active = pane === n.pane;
                return (
                  <button
                    key={n.pane}
                    onClick={() => {
                      setPane(n.pane);
                      setMobileOpen(false);
                    }}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm",
                      active ? "bg-slate-900 text-white" : "hover:bg-slate-100 dark:hover:bg-slate-800"
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {tr(n.labelKey, lang)}
                  </button>
                );
              })}
            </nav>
          </SheetContent>
        </Sheet>

        {/* Main content */}
        <main className="flex-1 overflow-x-hidden">
          <div className="md:hidden p-2 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="sm">
                  <Menu className="w-4 h-4" /> {tr("nav_dashboard", lang)}
                </Button>
              </SheetTrigger>
            </Sheet>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}

function Header({
  user, schoolName, lang, onToggleLang, onLogout, onSearch,
}: {
  user: { name: string; email: string; role: string };
  schoolName: string;
  lang: "ar" | "en";
  onToggleLang: () => void;
  onLogout: () => void;
  onSearch: (q: string) => void;
}) {
  return (
    <header className="h-14 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-3 px-4">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-md bg-slate-900 dark:bg-white text-white dark:text-slate-900 flex items-center justify-center font-bold text-sm">
          ST
        </div>
        <div>
          <div className="text-sm font-semibold leading-tight">{tr("appName", lang)}</div>
          {schoolName && <div className="text-[11px] text-slate-500">{schoolName}</div>}
        </div>
      </div>

      <div className="flex-1 max-w-md">
        <Input
          id="global-search"
          placeholder={`${tr("search", lang)}... (F)`}
          className="h-9"
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onToggleLang} title="Toggle language">
          <Globe className="w-4 h-4" />
          <span className="text-xs ms-1">{lang === "ar" ? "EN" : "ع"}</span>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2">
              <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-xs font-semibold">
                {user.name.charAt(0)}
              </div>
              <span className="hidden md:inline text-sm">{user.name}</span>
              <ChevronDown className="w-3 h-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="px-2 py-1.5 text-xs text-slate-500">
              <div>{user.email}</div>
              <Badge variant="outline" className="mt-1">{user.role}</Badge>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onLogout} className="text-red-600">
              <LogOut className="w-4 h-4 me-2" /> {tr("logout", lang)}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

function LoginScreen() {
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);
  const [email, setEmail] = useState("admin@school.tt");
  const [password, setPassword] = useState("admin123");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const doLogin = async () => {
    setLoading(true);
    setErr("");
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const j = await r.json();
    if (!r.ok || j.error) {
      setErr(j.error || "Login failed");
      setLoading(false);
      return;
    }
    location.reload();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-xl font-bold">{tr("appName", lang)}</div>
            <div className="text-xs text-slate-500 mt-1">{tr("appTagline", lang)}</div>
          </div>
          <button
            onClick={() => setLang(lang === "ar" ? "en" : "ar")}
            className="text-xs px-2 py-1 rounded border border-slate-200 dark:border-slate-700"
          >
            {lang === "ar" ? "English" : "العربية"}
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">{tr("email", lang)}</label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">{tr("password", lang)}</label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {err && (
            <div className="text-red-600 text-xs bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded p-2">
              {err}
            </div>
          )}
          <Button onClick={doLogin} disabled={loading} className="w-full">
            {loading ? "..." : tr("signIn", lang)}
          </Button>
          
        </div>
      </div>
    </div>
  );
}
