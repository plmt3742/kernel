// KERNEL · 应用根（Provider 链 + 路由 + 全局 reduced-motion）
// 路由级懒加载（Slice C 清扫）：每个视图独立分包，主包只保留应用壳与共享依赖，
// 首屏按需下载当前路由，见 docs/05 与 CHANGELOG。AppLayout 内的 Suspense 提供回退。
import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { MotionConfig } from 'motion/react'
import { ThemeProvider } from '@/context/ThemeContext'
import { ToastProvider } from '@/context/ToastContext'
import { PaletteProvider } from '@/context/PaletteContext'
import { AppLayout } from '@/components/shell/AppLayout'
const StartPage = lazy(() =>
  import('@/views/StartPage').then((m) => ({ default: m.StartPage })),
)

const Overview = lazy(() => import('@/views/Overview').then((m) => ({ default: m.Overview })))
const Assistant = lazy(() => import('@/views/Assistant').then((m) => ({ default: m.Assistant })))
const Inbox = lazy(() => import('@/views/Inbox').then((m) => ({ default: m.Inbox })))
const Tasks = lazy(() => import('@/views/Tasks').then((m) => ({ default: m.Tasks })))
const Calendar = lazy(() => import('@/views/Calendar').then((m) => ({ default: m.Calendar })))
const Timetable = lazy(() => import('@/views/Timetable').then((m) => ({ default: m.Timetable })))
const Projects = lazy(() => import('@/views/Projects').then((m) => ({ default: m.Projects })))
const ProjectDetailPage = lazy(() =>
  import('@/views/ProjectDetailPage').then((m) => ({ default: m.ProjectDetailPage })),
)
const TaskDetailPage = lazy(() =>
  import('@/views/TaskDetailPage').then((m) => ({ default: m.TaskDetailPage })),
)
// 习惯页（独立一级页）与个人页（顶栏头像进入）
const Habits = lazy(() => import('@/views/Habits').then((m) => ({ default: m.Habits })))
const HabitDetailPage = lazy(() =>
  import('@/views/HabitDetailPage').then((m) => ({ default: m.HabitDetailPage })),
)
const Traces = lazy(() => import('@/views/Traces').then((m) => ({ default: m.Traces })))
const TraceDetailPage = lazy(() =>
  import('@/views/TraceDetailPage').then((m) => ({ default: m.TraceDetailPage })),
)
const Profile = lazy(() => import('@/views/Profile').then((m) => ({ default: m.Profile })))
const ProfileActivity = lazy(() =>
  import('@/views/ProfileActivity').then((m) => ({ default: m.ProfileActivity })),
)
// 资料页依赖 react-markdown，单独分包以压缩其它路由的载入
const Library = lazy(() => import('@/views/Library').then((m) => ({ default: m.Library })))
const LibraryDetailPage = lazy(() =>
  import('@/views/LibraryDetailPage').then((m) => ({ default: m.LibraryDetailPage })),
)
const Review = lazy(() => import('@/views/Review').then((m) => ({ default: m.Review })))
const Trash = lazy(() => import('@/views/Trash').then((m) => ({ default: m.Trash })))
const Settings = lazy(() => import('@/views/Settings').then((m) => ({ default: m.Settings })))
const NotFound = lazy(() => import('@/views/NotFound').then((m) => ({ default: m.NotFound })))
const MobileHome = lazy(() =>
  import('@/views/MobileHome').then((m) => ({ default: m.MobileHome })),
)

function RootEntry() {
  const location = useLocation()
  const [phone, setPhone] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches,
  )

  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)')
    const onChange = (): void => setPhone(query.matches)
    onChange()
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const desktop = new URLSearchParams(location.search).get('desktop') === '1'
  if (phone && !desktop) return <Navigate to="/m" replace />

  return (
    <Suspense fallback={<div className="gh-boot">KERNEL</div>}>
      <StartPage />
    </Suspense>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <MotionConfig reducedMotion="user">
          <BrowserRouter>
            <PaletteProvider>
              <Routes>
                <Route path="/" element={<RootEntry />} />
                <Route
                  path="/m"
                  element={
                    <Suspense fallback={<div className="m-boot">KERNEL</div>}>
                      <MobileHome />
                    </Suspense>
                  }
                />
                <Route element={<AppLayout />}>
                  <Route path="today" element={<Overview />} />
                  <Route path="assistant" element={<Assistant />} />
                  <Route path="inbox" element={<Inbox />} />
                  <Route path="inbox/:view" element={<Inbox />} />
                  <Route path="tasks" element={<Tasks />} />
                  <Route path="tasks/:id" element={<TaskDetailPage />} />
                  <Route path="tasks/:id/:tab" element={<TaskDetailPage />} />
                  <Route path="calendar" element={<Calendar />} />
                  <Route path="timetable" element={<Timetable />} />
                  <Route path="projects" element={<Projects />} />
                  <Route path="projects/:id" element={<ProjectDetailPage />} />
                  <Route path="projects/:id/:tab" element={<ProjectDetailPage />} />
                  <Route path="habits" element={<Habits />} />
                  <Route path="habits/:id" element={<HabitDetailPage />} />
                  <Route path="traces" element={<Traces />} />
                  <Route path="traces/:id" element={<TraceDetailPage />} />
                  <Route path="profile" element={<Profile />} />
                  <Route path="profile/activity" element={<ProfileActivity />} />
                  <Route path="library" element={<Library />} />
                  <Route path="library/:kind/:id" element={<LibraryDetailPage />} />
                  <Route path="review" element={<Review />} />
                  <Route path="trash" element={<Trash />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="settings/:section" element={<Settings />} />
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
