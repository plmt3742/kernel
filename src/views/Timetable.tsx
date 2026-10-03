// KERNEL · 课表 TIMETABLE（v0.5 · Slice H2）：独立一级页面
// 从日程页「议程 / 课表」切换中搬出，成为侧栏一级视图。
// 机制与 Slice H0 原样迁移：周网格（ClassGrid）+ 课程详情 / 新建 / 学期设置弹窗。
// 页头由 TopBar 统一提供（课表 · TIMETABLE），此处保持克制，避免与 ClassGrid 自带周次条重复。
import { useState } from 'react'
import { ClassGrid } from '@/components/ClassGrid'
import { CourseDetailModal } from '@/components/CourseDetailModal'
import { CourseDraftModal, type CourseDraftPreset } from '@/components/CourseDraftModal'
import { TermModal } from '@/components/TermModal'
import { useToast } from '@/context/ToastContext'
import { removeCourse } from '@/lib/mutations'
import { errorText } from '@/lib/api'
import type { Course } from '@/types'

export function Timetable() {
  const { toast } = useToast()
  // 课程详情 / 新建课程草稿 / 学期设置
  const [courseDetailId, setCourseDetailId] = useState<string | null>(null)
  const [courseDraft, setCourseDraft] = useState<{ preset?: CourseDraftPreset } | null>(null)
  const [termOpen, setTermOpen] = useState(false)

  // 课程创建成功：关闭草稿 + toast 撤销（删除走回收站，经 course.remove）
  const handleCourseCreated = (course: Course): void => {
    setCourseDraft(null)
    toast(`已创建课程「${course.title}」`, {
      action: {
        label: '撤销',
        onClick: () => {
          void removeCourse(course.id).catch((err) => {
            toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
          })
        },
      },
    })
  }

  return (
    <div className="k-view">
      <ClassGrid
        onCreateCourse={(preset) => setCourseDraft(preset !== undefined ? { preset } : {})}
        onOpenCourse={(id) => setCourseDetailId(id)}
        onOpenTerm={() => setTermOpen(true)}
      />

      {/* 课程详情（Slice H0）：编辑 / 删除（都可撤销） */}
      <CourseDetailModal courseId={courseDetailId} onClose={() => setCourseDetailId(null)} />
      {/* 新建课程（先确认后写入）：确认前零落盘 */}
      <CourseDraftModal
        open={courseDraft !== null}
        preset={courseDraft?.preset}
        onClose={() => setCourseDraft(null)}
        onCreated={handleCourseCreated}
      />
      {/* 学期设置（第 1 周周一 + 总周数） */}
      <TermModal open={termOpen} onClose={() => setTermOpen(false)} />
    </div>
  )
}
