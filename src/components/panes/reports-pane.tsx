"use client";
import { useQuery } from "@tanstack/react-query";
import { useAppStore, useLangStore } from "@/lib/store";
import { tr } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";

export function ReportsPane() {
  const lang = useLangStore((s) => s.lang);
  const activeSchoolId = useAppStore((s) => s.activeSchoolId);
  const activeVersionId = useAppStore((s) => s.activeVersionId);
  const [tab, setTab] = useStateLocal("workload");

  const workload = useQuery({
    queryKey: ["rep-workload", activeVersionId],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (activeVersionId) p.set("versionId", activeVersionId);
      const r = await fetch(`/api/reports/workload?${p}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });
  const free = useQuery({
    queryKey: ["rep-free", activeVersionId],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (activeVersionId) p.set("versionId", activeVersionId);
      const r = await fetch(`/api/reports/free-periods?${p}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });
  const duties = useQuery({
    queryKey: ["rep-duties", activeVersionId],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (activeVersionId) p.set("versionId", activeVersionId);
      const r = await fetch(`/api/reports/duties?${p}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });
  const rooms = useQuery({
    queryKey: ["rep-rooms", activeVersionId],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (activeVersionId) p.set("versionId", activeVersionId);
      const r = await fetch(`/api/reports/rooms?${p}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });
  const seventh = useQuery({
    queryKey: ["rep-seventh", activeVersionId],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (activeVersionId) p.set("versionId", activeVersionId);
      const r = await fetch(`/api/reports/seventh?${p}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });
  const quality = useQuery({
    queryKey: ["rep-quality", activeVersionId],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (activeVersionId) p.set("versionId", activeVersionId);
      const r = await fetch(`/api/reports/quality?${p}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });

  if (!activeSchoolId) return <div className="p-6">{tr("loading", lang)}</div>;

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">{tr("nav_reports", lang)}</h1>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="workload">{tr("report_workload", lang)}</TabsTrigger>
          <TabsTrigger value="free">{tr("report_free", lang)}</TabsTrigger>
          <TabsTrigger value="duties">{tr("report_duties", lang)}</TabsTrigger>
          <TabsTrigger value="rooms">{tr("report_room", lang)}</TabsTrigger>
          <TabsTrigger value="seventh">{lang === "ar" ? "السابعة" : "Seventh"}</TabsTrigger>
          <TabsTrigger value="quality">{tr("report_quality", lang)}</TabsTrigger>
        </TabsList>

        <TabsContent value="workload">
          <Card>
            <CardHeader><CardTitle className="text-base">{tr("report_workload", lang)}</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr("nav_teachers", lang)}</TableHead>
                    <TableHead>{lang === "ar" ? "مطلوب" : "Required"}</TableHead>
                    <TableHead>{lang === "ar" ? "تدريس" : "Teaching"}</TableHead>
                    <TableHead>{lang === "ar" ? "إشغالات" : "Duties"}</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>{lang === "ar" ? "متبقي" : "Remaining"}</TableHead>
                    <TableHead>{lang === "ar" ? "سابعة" : "Seventh"}</TableHead>
                    <TableHead>%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(workload.data?.items || []).map((it: any) => (
                    <TableRow key={it.teacherId}>
                      <TableCell className="font-medium">{it.teacherName}</TableCell>
                      <TableCell>{it.required}</TableCell>
                      <TableCell>{it.teaching}</TableCell>
                      <TableCell>{it.duties}</TableCell>
                      <TableCell>{it.total}</TableCell>
                      <TableCell>
                        <Badge variant={it.remaining > 0 ? "destructive" : "default"}>{it.remaining}</Badge>
                      </TableCell>
                      <TableCell>{it.seventh}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Progress value={(it.total / Math.max(1, it.required)) * 100} className="w-16 h-2" />
                          <span className="text-[10px]">{Math.round((it.total / Math.max(1, it.required)) * 100)}%</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="free">
          <Card>
            <CardHeader><CardTitle className="text-base">{tr("report_free", lang)}</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr("nav_teachers", lang)}</TableHead>
                    <TableHead>{tr("count", lang)}</TableHead>
                    <TableHead>Slots</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(free.data?.items || []).map((it: any) => (
                    <TableRow key={it.teacherId}>
                      <TableCell className="font-medium">{it.teacherName}</TableCell>
                      <TableCell><Badge variant="outline">{it.freeCount}</Badge></TableCell>
                      <TableCell className="text-[10px] text-slate-500 font-mono">{it.freeSlots?.join(", ")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="duties">
          <Card>
            <CardHeader><CardTitle className="text-base">{tr("report_duties", lang)}</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr("nav_teachers", lang)}</TableHead>
                    <TableHead>{tr("type", lang)}</TableHead>
                    <TableHead>{tr("name", lang)}</TableHead>
                    <TableHead>Day</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>{lang === "ar" ? "المكان" : "Location"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(duties.data?.items || []).map((it: any) => (
                    <TableRow key={it.id}>
                      <TableCell className="font-medium">{it.teacherName}</TableCell>
                      <TableCell><Badge variant="outline">{it.type}</Badge></TableCell>
                      <TableCell>{it.title}</TableCell>
                      <TableCell>{it.day}</TableCell>
                      <TableCell>P{it.period}</TableCell>
                      <TableCell>{it.location || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rooms">
          <Card>
            <CardHeader><CardTitle className="text-base">{tr("report_room", lang)}</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr("rooms", lang)}</TableHead>
                    <TableHead>{tr("type", lang)}</TableHead>
                    <TableHead>{lang === "ar" ? "السعة" : "Cap."}</TableHead>
                    <TableHead>{lang === "ar" ? "مستخدم" : "Used"}</TableHead>
                    <TableHead>%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(rooms.data?.items || []).map((it: any) => (
                    <TableRow key={it.roomId}>
                      <TableCell className="font-medium">{it.roomName}</TableCell>
                      <TableCell><Badge variant="outline">{it.type}</Badge></TableCell>
                      <TableCell>{it.capacity}</TableCell>
                      <TableCell>{it.used} / {it.totalSlots}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Progress value={it.utilization} className="w-16 h-2" />
                          <span className="text-[10px]">{it.utilization}%</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="seventh">
          <Card>
            <CardHeader><CardTitle className="text-base">{lang === "ar" ? "توازن السابعة" : "Seventh Balance"}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-4">
                <div>{lang === "ar" ? "الهدف" : "Target"}: <b>{seventh.data?.target ?? 0}</b></div>
                <div>{lang === "ar" ? "الانحراف" : "Deviation"}: <b className="text-amber-600">{seventh.data?.deviation ?? 0}</b></div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr("nav_teachers", lang)}</TableHead>
                    <TableHead>{lang === "ar" ? "مطلوب" : "Required"}</TableHead>
                    <TableHead>{lang === "ar" ? "فعلي" : "Actual"}</TableHead>
                    <TableHead>{lang === "ar" ? "الفرق" : "Diff"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(seventh.data?.items || []).map((it: any) => (
                    <TableRow key={it.teacherId}>
                      <TableCell className="font-medium">{it.teacherName}</TableCell>
                      <TableCell>{it.required}</TableCell>
                      <TableCell>{it.actual}</TableCell>
                      <TableCell>
                        <Badge variant={it.diff === 0 ? "default" : it.diff > 0 ? "secondary" : "destructive"}>
                          {it.diff > 0 ? "+" : ""}{it.diff}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="quality">
          <Card>
            <CardHeader><CardTitle className="text-base">{tr("report_quality", lang)}</CardTitle></CardHeader>
            <CardContent>
              {quality.data?.metrics ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {Object.entries(quality.data.metrics).map(([k, v]) => (
                    <div key={k} className="border border-slate-200 dark:border-slate-800 rounded p-3">
                      <div className="text-xs text-slate-500">{k}</div>
                      <div className="text-lg font-bold">{String(v)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-slate-500">{tr("noData", lang)}</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Local useState wrapper
import { useState } from "react";
function useStateLocal<T>(initial: T) {
  return useState<T>(initial);
}
