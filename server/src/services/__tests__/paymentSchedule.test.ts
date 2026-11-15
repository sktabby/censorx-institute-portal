import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { firstUnpaid, installmentViews } from "../paymentSchedule";

const due = (iso: string) => Timestamp.fromDate(new Date(iso));
const item = (number: number, amount: number, iso: string) => ({
  number,
  amount,
  dueDate: due(iso),
  upcomingNoticeAt: null,
  dueNoticeAt: null,
  overdueNoticeAt: null,
  addedOnBill: null,
});

describe("installmentViews", () => {
  // Installment 4 was added later for extra codes and falls due before installment 3.
  const plan = [
    item(1, 1000, "2027-01-01T00:00:00Z"),
    item(2, 1000, "2027-02-01T00:00:00Z"),
    item(3, 1000, "2027-06-01T00:00:00Z"),
    item(4, 200, "2027-03-01T00:00:00Z"),
  ];

  it("settles the installment due first, and lists by number", () => {
    const views = installmentViews({ installmentPlan: plan, paidAmount: 2200 }, { asOf: new Date("2027-03-20T00:00:00Z") });
    expect(views.map((view) => view.number)).toEqual([1, 2, 3, 4]);
    expect(views.map((view) => view.status)).toEqual(["PAID", "PAID", "UPCOMING", "PAID"]);
  });

  it("names the earliest-due unpaid installment as next", () => {
    const views = installmentViews({ installmentPlan: plan, paidAmount: 2000 }, { asOf: new Date("2027-02-15T00:00:00Z") });
    expect(firstUnpaid(views)?.number).toBe(4);
  });
});
