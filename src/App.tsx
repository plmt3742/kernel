// KERNEL · 应用根（Provider 链 + 路由 + 全局 reduced-motion）
import { lazy } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { MotionConfig } from 'motion/react'
import { ThemeProvider } from '@/context/ThemeContext'
import { ToastProvider } from '@/context/ToastContext'
import { PaletteProvider } from '@/context/PaletteContext'
import { AppLayout } from '@/components/shell/AppLayout'
import { Overview } from '@/views/Overview'
import { Inbox } from '@/views/Inbox'
import { Tasks } from '@/views/Tasks'
import { Calendar } from '@/views/Calendar'
import { Projects } from '@/views/Projects'
import { Review } from '@/views/Review'
import { Settings } from '@/views/Settings'
import { Trash } from '@/views/Trash'
import { NotFound } from '@/views/NotFound'

// 资料页依赖 react-markdown，按需加载以压缩首屏包体
const Library = lazy(() => import('@/views/Library').then((mod) => ({ default: mod.Library })))

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <MotionConfig reducedMotion="user">
          <BrowserRouter>
            <PaletteProvider>
              <Routes>
                <Route element={<AppLayout />}>
                  <Route index element={<Overview />} />
                  <Route path="inbox" element={<Inbox />} />
                  <Route path="tasks" element={<Tasks />} />
                  <Route path="calendar" element={<Calendar />} />
                  <Route path="projects" element={<Projects />} />
                  <Route path="library" element={<Library />} />
                  <Route path="review" element={<Review />} />
                  <Route path="trash" element={<Trash />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Routes>
            </PaletteProvider>
          </BrowserRouter>
        </MotionConfig>
      </ToastProvider>
    </ThemeProvider>
  )
}
