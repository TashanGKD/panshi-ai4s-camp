import { ContentSection } from '@panshi/ui'
import type { BasicContent } from '@panshi/contracts'

export const navigationItems = [
  { label: '首页', to: '/' }, { label: '实训日程', to: '/schedule' }, { label: '在线注册', to: '/register' },
  { label: '住宿交通', to: '/travel' }, { label: '联系我们', to: '/contact' }, { label: '相关资料', to: '/resources' },
  { label: '个人中心', to: '/account' },
] as const

export function HomePage({ basic }: { basic: BasicContent }) {
  return <>
    <ContentSection title="实训营简介">{basic.intro.length > 0 ? basic.intro.map((paragraph) => <p key={paragraph}>{paragraph}</p>) : <p>活动简介尚未发布</p>}</ContentSection>
    {basic.target ? <ContentSection title="面向对象"><p>{basic.target}</p></ContentSection> : null}
  </>
}
