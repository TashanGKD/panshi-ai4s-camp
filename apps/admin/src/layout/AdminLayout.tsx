import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'

const contentLinks = [
  ['/content/basic', '基本信息'], ['/content/features', '实训特色'], ['/content/organizations', '组织单位'],
  ['/content/importantDates', '重要日期'], ['/content/schedule', '实训日程与师资'], ['/content/travel', '住宿交通'],
  ['/content/contacts', '联系方式'], ['/content/resources', '相关资料'], ['/content/display', '展示设置'],
] as const

export function AdminLayout({ children, displayName, onLogout }: { children: ReactNode, displayName: string, onLogout?: () => Promise<void> }) {
  return <div className="admin-layout"><aside className="admin-sidebar"><div className="admin-brand"><span>磐石·科学智能</span><strong>实训营管理后台</strong></div>
    <nav aria-label="管理后台主导航"><NavLink end to="/">工作台</NavLink><p>网站内容</p>{contentLinks.map(([to, label]) => <NavLink key={to} to={to}>{label}</NavLink>)}<p>报名管理</p><NavLink to="/registration/form">表单配置</NavLink></nav>
  </aside><div className="admin-main"><header className="admin-topbar"><div><span>当前管理员</span><strong>{displayName}</strong></div>{onLogout ? <button type="button" className="button-secondary" onClick={() => { void onLogout() }}>退出登录</button> : null}</header><main>{children}</main></div></div>
}
