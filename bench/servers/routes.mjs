// Shared by every server: 50 routes registered before the measured ones,
// as a real app's route table would have.
export const FILLER = Array.from({ length: 50 }, (_, i) => `/api/resource${i}/:id/items`)
export const port = Number(process.env.PORT)
