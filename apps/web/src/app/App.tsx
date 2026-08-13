import { EventBanner, EventNavigation } from '@panshi/ui'
import '@panshi/ui/tokens.css'
import { Route, Routes } from 'react-router-dom'
import { homeFixture } from '../data/homeFixture'
import { HomePage, navigationItems } from '../pages/HomePage'
import { SkipLink } from './SkipLink'
import '../styles/public.css'

const placeholderTitles = new Map(navigationItems.slice(1).map((item) => [item.to, item.label]))

function PlaceholderPage({ title }: { title: string }) {
  return <div className="public-shell"><SkipLink /><EventBanner {...homeFixture} /><EventNavigation items={navigationItems} /><main id="main-content" className="event-container placeholder-page" tabIndex={-1}><h2>{title}</h2><p>本页面将在后续任务中开放。</p></main><footer className="event-footer"><div className="event-container">{homeFixture.title}</div></footer></div>
}

export function App() {
  return <Routes><Route path="/" element={<HomePage fixture={homeFixture} />} />{[...placeholderTitles].map(([path, title]) => <Route key={path} path={path} element={<PlaceholderPage title={title} />} />)}</Routes>
}
