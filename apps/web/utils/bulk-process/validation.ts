import { z } from "zod";

export const startBulkProcessSchema = z.object({
  emailAccountId: z.string().min(1),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
  onlyUnread: z.coerce.boolean().default(true),
  forceReprocess: z.coerce.boolean().default(false),
});
export type StartBulkProcessBody = z.infer<typeof startBulkProcessSchema>;

export const bulkProcessJobIdSchema = z.object({
  jobId: z.string().min(1),
});
export type BulkProcessJobIdParams = z.infer<typeof bulkProcessJobIdSchema>;

export const bulkProcessWorkerSchema = z.object({
  jobId: z.string().min(1),
  emailAccountId: z.string().min(1),
  messageId: z.string().min(1),
  threadId: z.string().min(1),
});
export type BulkProcessWorkerBody = z.infer<typeof bulkProcessWorkerSchema>;
