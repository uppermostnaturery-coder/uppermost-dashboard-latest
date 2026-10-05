import type { SubscriptionIntervalDays } from "../types";

export const SUBSCRIPTION_INTERVAL_DAYS = [15, 30, 60] as const;

export function isSubscriptionIntervalDays(value: number): value is SubscriptionIntervalDays {
  return SUBSCRIPTION_INTERVAL_DAYS.includes(value as SubscriptionIntervalDays);
}

export function assertSubscriptionIntervalDays(value: number): SubscriptionIntervalDays {
  if (!isSubscriptionIntervalDays(value)) {
    throw new Error("Subscription interval must be exactly 15, 30, or 60 days.");
  }
  return value;
}

export function addExactUtcDays(iso: string, intervalDays: number): string {
  const validInterval = assertSubscriptionIntervalDays(intervalDays);
  const start = new Date(iso);
  if (Number.isNaN(start.getTime())) throw new Error("Invalid subscription schedule timestamp.");
  return new Date(start.getTime() + validInterval * 86_400_000).toISOString();
}

export function renewalScheduleForDueAt(dueAt: string) {
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) throw new Error("Invalid renewal due timestamp.");
  return {
    // Production currently runs on Vercel Hobby (daily cron with up to one
    // hour of scheduling jitter). A 50-hour lead guarantees the provider
    // notification is created at least 24 hours before payment_after.
    notificationDueAt: new Date(due.getTime() - 50 * 60 * 60 * 1000).toISOString(),
    scheduledChargeAt: due.toISOString(),
  };
}

export type DueCycleItem = {
  id: string;
  sku: string;
  quantity: number;
};

// V1 supplies every active item because one subscription has one schedule.
// Keeping this explicit boundary lets a future schedule-group implementation
// pass only the items due in a particular occurrence.
export function selectDueCycleItems<T extends DueCycleItem>(items: T[]): T[] {
  return items.map((item) => ({ ...item }));
}
