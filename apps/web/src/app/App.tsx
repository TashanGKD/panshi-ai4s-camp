import { EventBanner, EventNavigation } from '@panshi/ui'
import '@panshi/ui/tokens.css'
import { Route, Routes } from 'react-router-dom'
import { homeFixture } from '../data/homeFixture'
import { HomePage, navigationItems } from '../pages/HomePage'
import '../styles/public.css'

const placeholderTitles = new Map(navigationItems.slice(1).map((item) => [item.to, item.label]))

function PlaceholderPage({ title }: { title: string }) {
  return <div className="public-shell"><EventBanner {...homeFixture} /><EventNavigation items={navigationItems} /><main className="event-container placeholder-page"><h2>{title}</h2><p>本页面将在后续任务中开放。</p></main><footer className="event-footer"><div className="event-container">磐石·科学智能（AI for Science）实训营</div></footer></div>
}

export function App() {
  return <Routes><Route path="/" element={<HomePage fixture={homeFixture} />} />{[...placeholderTitles].map(([path, title]) => <Route key={path} path={path} element={<PlaceholderPage title={title} />} />)}</Routes>
}
