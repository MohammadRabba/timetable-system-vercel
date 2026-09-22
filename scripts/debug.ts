import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  // Check the school with the API-returned ID
  const schoolId = "cmucu27a80004lzsyu5cw4gjv";
  const school = await db.school.findUnique({ where: { id: schoolId } });
  console.log("School:", school ? school.name : "NOT FOUND");
  if (school) {
    const teachers = await db.teacher.findMany({ where: { schoolId }, take: 5, include: { _count: { select: { lessons: true } } } });
    teachers.forEach(t => console.log(`  ${t.name} (${t.employeeNumber}): ${t._count.lessons} lessons`));
    const lessons = await db.lesson.aggregate({ where: { schoolId }, _sum: { weeklyOccurrences: true } });
    console.log("Total weekly:", lessons._sum.weeklyOccurrences);
    // First teacher's lessons
    if (teachers.length) {
      const tls = await db.lesson.findMany({ where: { teacherId: teachers[0].id }, select: { weeklyOccurrences: true } });
      const sum = tls.reduce((s, l) => s + l.weeklyOccurrences, 0);
      console.log(`${teachers[0].name}: ${tls.length} lessons, ${sum} weekly occurrences`);
    }
  }
}
main().finally(() => db.$disconnect());
