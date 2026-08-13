export function SkipLink() {
  const focusMainContent = () => {
    document.getElementById('main-content')?.focus()
  }

  return <a className="skip-link" href="#main-content" onClick={focusMainContent}>跳至主要内容</a>
}
