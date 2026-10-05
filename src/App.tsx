// KERNEL · 应用根（Provider 链 + 路由 + 全局 reduced-motion）
// 路由级懒加载（Slice C 清扫）：每个视图独立分包，主包只保留应用壳与共享依赖，
// 首屏按需下载当前路由，见 docs/05 与 CHANGELOG。AppLayout 内的 Suspense 提供回退。
import { lazy } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { MotionConfig } from 'motion/react'
import { ThemeProvider } from '@/context/ThemeContext'
import { ToastProvider } from '@/context/ToastContext'
import { PaletteProvider } from '@/context/PaletteContext'
import { AppLayout } from '@/components/shell/AppLayout'

const Overview = lazy(() => import('@/views/Overview').then((m) => ({ default: m.Overview })))
const Inbox = lazy(() => import('@/views/Inbox').then((m) => ({ default: m.Inbox })))
const Tasks = lazy(() => import('@/views/Tasks').then((m) => ({ default: m.Tasks })))
const Calendar = lazy(() => import('@/views/Calendar').then((m) => ({ default: m.Calendar })))
const Timetable = lazy(() => import('@/views/Timetable').then((m) => ({ default: m.Timetable })))
const Projects = lazy(() => import('@/views/Projects').then((m) => ({ default: m.Projects })))
// 习惯页（独立一级页）与个人页（顶栏头像进入）
const Habits = lazy(() => import('@/views/Habits').then((m) => ({ default: m.Habits })))
const Profile = lazy(() => import('@/views/Profile').then((m) => ({ default: m.Profile })))
// 资料页依赖 react-markdown，单独分包以压缩其它路由的载入
const Library = lazy(() => import('@/views/Library').then((m) => ({ default: m.Library })))
const Review = lazy(() => import('@/views/Review').then((m) => ({ default: m.Review })))
const Trash = lazy(() => import('@/views/Trash').then((m) => ({ default: m.Trash })))
const Settings = lazy(() => import('@/views/Settings').then((m) => ({ default: m.Settings })))
const NotFound = lazy(() => import('@/views/NotFound').then((m) => ({ default: m.NotFound })))

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
                  <Route path="timetable" element={<Timetable />} />
                  <Route path="projects" element={<Projects />} />
                  <Route path="habits" element={<Habits />} />
                  <Route path="profile" element={<Profile />} />
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
