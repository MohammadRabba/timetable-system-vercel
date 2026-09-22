import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const all = await db.school.findMany();
  console.log("ALL SCHOOLS in this DB:");
  all.forEach(s => console.log("  ", s.id, s.name));
  const cnt = await db.teacher.count();
  const lcnt = await db.lesson.count();
  console.log("Teachers:", cnt, "Lessons:", lcnt);
}
main().finally(() => db.$disconnect());
