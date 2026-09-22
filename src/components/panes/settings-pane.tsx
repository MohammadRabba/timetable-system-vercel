"use client";
import { useAppStore, useLangStore } from "@/lib/store";
import { tr } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Keyboard } from "lucide-react";

export function SettingsPane() {
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);
  const activeSchoolId = useAppStore((s) => s.activeSchoolId);

  const seedAdmin = async () => {
    const r = await fetch("/api/auth/seed-admin", { method: "POST" });
    const j = await r.json();
    if (j.ok) toast.success(lang === "ar" ? "تم" : "Done");
  };

  const reseed = async () => {
    if (!confirm(lang === "ar" ? "إعادة زرع البيانات؟" : "Re-seed demo data?")) return;
    toast.info(lang === "ar" ? "تشغيل السكربت..." : "Running...");
    // Note: requires running scripts/seed.ts from CLI
    toast.warning(lang === "ar" ? "الرجاء تشغيل: bun run scripts/seed.ts" : "Run: bun run scripts/seed.ts");
  };

  const shortcuts = [
    { key: "Ctrl + Z", action: lang === "ar" ? "تراجع" : "Undo" },
    { key: "Ctrl + Y", action: lang === "ar" ? "إعادة" : "Redo" },
    { key: "F", action: lang === "ar" ? "بحث" : "Search" },
    { key: "Esc", action: lang === "ar" ? "إلغاء السحب" : "Cancel drag" },
  ];

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <h1 className="text-2xl font-bold">{tr("nav_settings", lang)}</h1>

      <Card>
        <CardHeader><CardTitle className="text-base">{lang === "ar" ? "اللغة والاتجاه" : "Language & Direction"}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <Label>{lang === "ar" ? "اللغة الافتراضية" : "Default language"}</Label>
              <div className="text-xs text-slate-500">Arabic (RTL) · English (LTR)</div>
            </div>
            <Switch checked={lang === "ar"} onCheckedChange={(c) => setLang(c ? "ar" : "en")} />
            <Badge>{lang === "ar" ? "العربية" : "English"}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Keyboard className="w-4 h-4" /> {lang === "ar" ? "اختصارات لوحة المفاتيح" : "Keyboard Shortcuts"}</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {shortcuts.map((s) => (
            <div key={s.key} className="flex items-center justify-between py-1 border-b border-slate-100 dark:border-slate-800">
              <span className="text-sm">{s.action}</span>
              <kbd className="text-xs bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded font-mono">{s.key}</kbd>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{lang === "ar" ? "البيانات التجريبية" : "Demo Data"}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-slate-500">
            {lang === "ar"
              ? "تأكد من وجود حساب المسؤول الأول أو أعد زرع البيانات التجريبية بالكامل من السكربت."
              : "Ensure the initial super admin exists, or re-run the demo data seed script."}
          </p>
          <Button variant="outline" onClick={seedAdmin}>{lang === "ar" ? "إنشاء مسؤول أولي" : "Seed Super Admin"}</Button>
          <Button variant="outline" className="ms-2" onClick={reseed}>{lang === "ar" ? "إعادة زرع البيانات" : "Re-seed demo"}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{lang === "ar" ? "حول النظام" : "About"}</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-1">
          <div>{lang === "ar" ? "نظام الجدول المدرسي" : "School Timetable System"} v1.0</div>
          <div className="text-slate-500 text-xs">{lang === "ar" ? "محرك قيود حقيقي بدون توليد عشوائي" : "Real constraint engine, no random placement"}</div>
          <div className="text-slate-500 text-xs">{lang === "ar" ? "العربية أولاً + RTL" : "Arabic-first + RTL"}</div>
          <div className="text-slate-500 text-xs">Next.js · TypeScript · Prisma · SQLite · dnd-kit · ExcelJS</div>
        </CardContent>
      </Card>
    </div>
  );
}
