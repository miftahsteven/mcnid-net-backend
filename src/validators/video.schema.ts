import { z } from 'zod';

export const CreateVideoSchema = z.object({
  title: z.string().min(1).max(500),
  slug: z.string().min(1).max(500).regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  sourceType: z.enum(['UPLOAD', 'YOUTUBE']).default('YOUTUBE'),
  videoUrl: z.string().optional(),
  coverImage: z.string().optional(),
  duration: z.string().optional(),
  isHighlight: z.boolean().default(false),
  status: z.enum(['DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED']).default('DRAFT'),
  publishedAt: z.union([z.string(), z.date()]).optional().transform(v => v ? new Date(v) : undefined),
  categoryId: z.string().optional(),
  categoryIds: z.array(z.string()).optional(),
});

export const UpdateVideoSchema = CreateVideoSchema.partial();
