import { z } from "zod";

export const adminCustomerListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const notifyCustomerSchema = z.object({
  subject: z.string().trim().min(1, "Subject is required").max(200),
  message: z.string().trim().min(1, "Message is required").max(5000),
});

export const assignPlanSchema = z.object({
  planKey: z.string().min(1),
  trialEndsAt: z.coerce.date().nullable().optional(),
});

export const deleteCustomerSchema = z.object({
  confirmEmail: z.string().min(1),
});
