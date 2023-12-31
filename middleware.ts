import { authMiddleware } from '@clerk/nextjs'

// add api/webhook to public routes （public routes are not protected by Clerk）
export default authMiddleware({
  publicRoutes: [
    '/',
    '/api/webhook',
    '/question/:id',
    '/tags',
    '/tags/:id',
    '/profile/:id',
    '/community',
    '/jobs'
  ],
  ignoredRoutes: ['/api/webhook', '/api/chatgpt']
})

export const config = {
  // matcher: ['/((?!.+\\.[\\w]+$|_next).*)', '/', '/(api|trpc)(.*)']
  matcher: ['/((?!.*\\..*|_next).*)', '/', '/(api|trpc)(.*)']
}
