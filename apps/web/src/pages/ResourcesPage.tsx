export function ResourcesPage({ apiReady }: { apiReady: boolean }) {
  return <section className="public-page__section"><h2>相关资料</h2>
    {apiReady ? <p>相关资料尚未发布</p> : <p role="status">正在加载活动信息</p>}
  </section>
}
