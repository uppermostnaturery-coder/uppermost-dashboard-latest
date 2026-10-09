import { CronExpressionParser } from "cron-parser";
export function nextRuns(expression: string, timezone = "Asia/Kolkata", from = new Date(), count = 5) {
  if (expression.trim().split(/\s+/).length !== 5 || count < 1 || count > 5) throw new Error("INVALID_SCHEDULE");
  const cron = CronExpressionParser.parse(expression, { currentDate: from, tz: timezone });
  return Array.from({ length: count }, () => cron.next().toISOString()!);
}
