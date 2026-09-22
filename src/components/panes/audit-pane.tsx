"use client";
import { useQuery } from "@tanstack/react-query";
import { useAppStore, useLangStore } from "@/lib/store";
import { tr } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function AuditPane() {
  const lang = useLangStore((s) => s.lang);
  const activeSchoolId = useAppStore((s) => s.activeSchoolId);

  const { data } = useQuery({
    queryKey: ["audit", activeSchoolId],
    queryFn: async () => {
      const r = await fetch(`/api/audit?schoolId=${activeSchoolId || ""}&limit=100`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });

  const logs = data?.logs || [];

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">{tr("nav_audit", lang)}</h1>

      <Card>
        <CardHeader><CardTitle className="text-base">{lang === "ar" ? "آخر العمليات" : "Recent operations"} ({logs.length})</CardTitle></CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <div className="text-sm text-slate-500">{tr("noData", lang)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>{lang === "ar" ? "المستخدم" : "User"}</TableHead>
                  <TableHead>{lang === "ar" ? "الإجراء" : "Action"}</TableHead>
                  <TableHead>{lang === "ar" ? "الكيان" : "Entity"}</TableHead>
                  <TableHead>{lang === "ar" ? "القيمة" : "Value"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((l: any) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs text-slate-500">{new Date(l.createdAt).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}</TableCell>
                    <TableCell>{l.user?.name || "—"}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px] font-mono">{l.action}</Badge></TableCell>
                    <TableCell className="text-xs">{l.entity}{l.entityId ? `:${l.entityId.slice(-4)}` : ""}</TableCell>
                    <TableCell className="text-xs text-slate-500 max-w-xs truncate">
                      {l.newValue ? <code className="text-[10px]">{l.newValue.slice(0, 80)}…</code> : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
