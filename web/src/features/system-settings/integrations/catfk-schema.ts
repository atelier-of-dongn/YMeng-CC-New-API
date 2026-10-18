import { z } from 'zod'

export const catfkProductSchema = z.object({
  id: z
    .string()
    .regex(
      /^[a-zA-Z0-9_-]{1,64}$/,
      'Use a stable ID with 1–64 letters, digits, underscores or hyphens'
    ),
  name: z.string().trim().min(1, 'Product name is required').max(200),
  goods_key: z.string().trim().min(1, 'CatFK goods key is required').max(512),
  amount: z
    .number()
    .positive('Expected credit must be greater than zero')
    .max(1000000),
})
export type CatFKProduct = z.infer<typeof catfkProductSchema>
export const catfkChannelSchema = z.object({
  id: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(200),
  icon: z.string().max(2048).default(''),
})
export type CatFKChannel = z.infer<typeof catfkChannelSchema>
export const catfkProductsSchema = z
  .array(catfkProductSchema)
  .max(100)
  .refine(
    (items) => new Set(items.map((item) => item.id)).size === items.length,
    'CatFK product IDs must be unique'
  )
export const catfkChannelsSchema = z
  .array(catfkChannelSchema)
  .max(100)
  .refine(
    (items) => new Set(items.map((item) => item.id)).size === items.length,
    'CatFK channel IDs must be unique'
  )

export function parseCatFKProducts(value: string): CatFKProduct[] {
  return catfkProductsSchema.parse(JSON.parse(value))
}
export function parseCatFKChannels(value: string): CatFKChannel[] {
  return catfkChannelsSchema.parse(JSON.parse(value))
}
