"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAppStore, useLangStore } from "@/lib/store";
import { tr } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useMemo } from "react";

export function ConstraintsPane() {
  const lang = useLangStore((s) => s.lang);
  const activeSchoolId = useAppStore((s) => s.activeSchoolId);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["constraints", activeSchoolId],
    queryFn: async () => {
      const r = await fetch(`/api/constraints?schoolId=${activeSchoolId || ""}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });
  const constraints = data?.constraints || [];

  const hard = useMemo(() => constraints.filter((c: any) => c.type === "HARD"), [constraints]);
  const soft = useMemo(() => constraints.filter((c: any) => c.type === "SOFT"), [constraints]);

  const update = useMutation({
    mutationFn: async (c: any) => {
      const r = await fetch("/api/constraints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...c, schoolId: activeSchoolId }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["constraints", activeSchoolId] });
    },
  });

  const toggle = (c: any) => {
    update.mutate({ ...c, enabled: !c.enabled });
    toast.success(lang === "ar" ? "تم التحديث" : "Updated");
  };
  const changeWeight = (c: any, weight: number) => {
    update.mutate({ ...c, weight });
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{tr("nav_constraints", lang)}</h1>
        <p className="text-sm text-slate-500 mt-1">
          {lang === "ar"
            ? "القيود الصلبة لا يمكن انتهاكها إطلاقاً. القيود الناعمة تُحسّن جودة الجدول وتقلل العقوبة الإجمالية."
            : "Hard constraints are never violated. Soft constraints improve quality and minimize total penalty."}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Badge>HARD</Badge> {lang === "ar" ? "قيود صلبة" : "Hard Constraints"} ({hard.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {hard.map((c: any) => (
            <ConstraintRow key={c.code} c={c} onToggle={() => toggle(c)} onWeight={(w) => changeWeight(c, w)} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Badge variant="secondary">SOFT</Badge> {lang === "ar" ? "قيود ناعمة" : "Soft Constraints"} ({soft.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {soft.map((c: any) => (
            <ConstraintRow key={c.code} c={c} onToggle={() => toggle(c)} onWeight={(w) => changeWeight(c, w)} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function ConstraintRow({ c, onToggle, onWeight }: { c: any; onToggle: () => void; onWeight: (w: number) => void }) {
  return (
    <div className="flex items-center gap-3 p-2 border border-slate-200 dark:border-slate-800 rounded">
      <Switch checked={c.enabled} onCheckedChange={onToggle} />
      <div className="flex-1">
        <div className="text-sm font-medium">{c.name}</div>
        <div className="text-xs text-slate-500 font-mono">{c.code}</div>
      </div>
      <div className="w-28">
        <Label className="text-xs">{c.type === "HARD" ? "Weight (≥1M)" : "Weight"}</Label>
        <Input
          type="number"
          value={c.weight}
          onChange={(e) => onWeight(Number(e.target.value))}
          className="h-8"
        />
      </div>
      <Badge variant={c.enabled ? "default" : "outline"}>{c.enabled ? "ON" : "OFF"}</Badge>
    </div>
  );
}
