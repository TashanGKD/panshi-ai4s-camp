import { ContentSection } from '@panshi/ui'
import type { BasicContent } from '@panshi/contracts'
import { RichText } from '../components/RichText'
import { ApplicationCount } from '../components/ApplicationCount'

export const navigationItems = [
  { label: '首页', to: '/' }, { label: '实训日程', to: '/schedule' }, { label: '在线注册', to: '/application' },
  { label: '住宿交通', to: '/travel' }, { label: '联系我们', to: '/contact' }, { label: '相关资料', to: '/resources' },
  { label: '个人中心', to: '/account' },
] as const

export function HomePage({ basic }: { basic: BasicContent }) {
  return <>
    <ApplicationCount />
    <ContentSection title="实训营简介">{basic.intro.length > 0 ? basic.intro.map((paragraph) => <RichText as="p" key={paragraph} html={paragraph} />) : <p>活动简介尚未发布</p>}</ContentSection>
    {basic.target ? <ContentSection title="面向对象"><p>{basic.target}</p></ContentSection> : null}
  </>
}
