import { z } from "zod";

export const createKnowledgeBody = z.object({
  title: z.string().min(1, "Title is required"),
  content: z.string(),
});

export type CreateKnowledgeBody = z.infer<typeof createKnowledgeBody>;

export const updateKnowledgeBody = z.object({
  id: z.string(),
  title: z.string().min(1, "Title is required"),
  content: z.string(),
});

export type UpdateKnowledgeBody = z.infer<typeof updateKnowledgeBody>;

export const deleteKnowledgeBody = z.object({
  id: z.string(),
});

export type DeleteKnowledgeBody = z.infer<typeof deleteKnowledgeBody>;

// Auto-generate knowledge validation
export const startAutoGenerateBody = z.object({
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
  maxEntries: z.number().min(1).max(50).default(20),
  groupBy: z.enum(["topic", "sender", "both"]).default("both"),
});

export type StartAutoGenerateBody = z.infer<typeof startAutoGenerateBody>;

// Schema for a generated knowledge entry that can be approved
export const generatedKnowledgeEntrySchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(10000),
  topic: z.string().optional(),
  groupType: z.enum(["TOPIC", "SENDER"]).optional(),
  senderPattern: z.string().optional(),
  sourceEmailCount: z.number().optional(),
  confidence: z.number().min(0).max(1),
  keywords: z.array(z.string()).optional(),
  sourceEmailIds: z.array(z.string()).optional(),
});

export const approveGeneratedKnowledgeBody = z.object({
  entries: z
    .array(generatedKnowledgeEntrySchema)
    .min(1, "At least one entry is required"),
});

export type ApproveGeneratedKnowledgeBody = z.infer<
  typeof approveGeneratedKnowledgeBody
>;

export const rejectGeneratedKnowledgeBody = z.object({
  jobId: z.string(),
});

export type RejectGeneratedKnowledgeBody = z.infer<
  typeof rejectGeneratedKnowledgeBody
>;

export const updateKnowledgeSettingsBody = z.object({
  knowledgeExtractionEnabled: z.boolean().optional(),
  knowledgeAutoApprove: z.boolean().optional(),
});

export type UpdateKnowledgeSettingsBody = z.infer<
  typeof updateKnowledgeSettingsBody
>;
