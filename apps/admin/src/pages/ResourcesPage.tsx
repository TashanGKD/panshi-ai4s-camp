import { useCallback, useEffect, useRef, useState } from 'react'
import { AdminApiError, type AdminClient, type AdminResource, type AdminResourceInput } from '../api/admin-client'

const empty: AdminResourceInput = { key: '', title: '', description: null, fileId: '', accessScope: 'public', sortOrder: 0 }

export function ResourcesPage({ client }: { client: AdminClient }) {
  const [items, setItems] = useState<AdminResource[]>([])
  const [form, setForm] = useState<AdminResourceInput>(empty)
  const [editing, setEditing] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const mounted = useRef(true)
  const loadSequence = useRef(0)
  const operationSequence = useRef(0)
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current
    const response = await client.listResources()
    if (mounted.current && sequence === loadSequence.current) setItems(response.data.resources)
  }, [client])
  useEffect(() => {
    mounted.current = true
    void load().catch(() => { if (mounted.current) setMessage('资料列表加载失败') })
    return () => { mounted.current = false; loadSequence.current += 1; operationSequence.current += 1 }
  }, [load])
  const upload = async (file?: File) => {
    if (!file) return
    setPending(true); setMessage('')
    try { const response = await client.uploadResourceFile(file, form.accessScope); setForm((current) => ({ ...current, fileId: response.data.file.id })); setMessage('文件已上传，请保存配置') }
    catch { setMessage('文件上传失败') } finally { setPending(false) }
  }
  const save = async () => {
    if (pending) return
    const sequence = ++operationSequence.current
    setPending(true); setMessage('')
    try {
      const current = editing ? items.find((item) => item.id === editing) : null
      if (editing && !current) throw new Error('资料已变化，请刷新后重试')
      const response = editing
        ? await client.updateResource(editing, form, current!.revision)
        : await client.createResource(form, 0)
      if (!mounted.current || sequence !== operationSequence.current) return
      setItems((existing) => editing
        ? existing.map((item) => item.id === response.data.resource.id ? response.data.resource : item)
        : [...existing, response.data.resource].sort((left, right) => left.sortOrder - right.sortOrder))
      setEditing(null); setForm(empty); setMessage('资料草稿已保存，请确认后发布')
    } catch (error) {
      if (!mounted.current || sequence !== operationSequence.current) return
      if (error instanceof AdminApiError && error.code === 'RESOURCE_REVISION_CONFLICT') {
        try { await load() } catch { /* Keep the conflict message even if refresh fails. */ }
        if (mounted.current && sequence === operationSequence.current) setMessage('资料已被其他管理员修改，已刷新最新状态')
      } else setMessage(error instanceof Error ? error.message : '保存失败')
    } finally { if (mounted.current && sequence === operationSequence.current) setPending(false) }
  }
  const edit = (item: AdminResource) => { setEditing(item.id); setForm({ key: item.key, title: item.title, description: item.description, fileId: item.fileId, accessScope: item.accessScope, sortOrder: item.sortOrder }) }
  const publish = async (item: AdminResource) => {
    if (pending) return
    const sequence = ++operationSequence.current
    setPending(true); setMessage('')
    try {
      const response = await client.publishResource(item.id, !item.active, item.revision)
      if (!mounted.current || sequence !== operationSequence.current) return
      setItems((existing) => existing.map((current) => current.id === response.data.resource.id ? response.data.resource : current))
      setMessage(response.data.resource.active ? '资料已发布' : '资料已下线')
    } catch (error) {
      if (!mounted.current || sequence !== operationSequence.current) return
      if (error instanceof AdminApiError && error.code === 'RESOURCE_REVISION_CONFLICT') {
        try { await load() } catch { /* Keep the conflict message even if refresh fails. */ }
        if (mounted.current && sequence === operationSequence.current) setMessage('资料已被其他管理员修改，已刷新最新状态')
      } else setMessage('发布状态更新失败')
    } finally { if (mounted.current && sequence === operationSequence.current) setPending(false) }
  }
  const preview = async (item: AdminResource) => {
    setPreviewing(item.id); setMessage('正在准备预览')
    try {
      const file = await client.previewResource(item.id)
      const url = URL.createObjectURL(file.blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      setTimeout(() => URL.revokeObjectURL(url), 0)
      setMessage(`已打开预览：${file.filename}`)
    } catch (error) {
      setMessage(error instanceof AdminApiError && error.status === 404 ? '资料文件已失效或下线，请刷新列表后重试' : '预览文件失败，请稍后重试')
    } finally { setPreviewing(null) }
  }
  return <section><header className="admin-page-header"><div><h1>相关资料</h1><p>上传资料、设置访问范围并发布；隐藏或删除底层文件后下载会立即失效。</p></div></header>
    {message ? <p role="status">{message}</p> : null}
    <div className="content-editor"><label>标识<input value={form.key} maxLength={80} onChange={(event) => setForm({ ...form, key: event.target.value })} /></label><label>标题<input value={form.title} maxLength={200} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label>说明<textarea value={form.description ?? ''} maxLength={1000} onChange={(event) => setForm({ ...form, description: event.target.value || null })} /></label><label>访问范围<select value={form.accessScope} onChange={(event) => setForm({ ...form, accessScope: event.target.value as AdminResourceInput['accessScope'], fileId: '' })}><option value="public">公开</option><option value="authenticated">登录学员</option><option value="admitted">已录取学员</option></select></label><label>排序<input type="number" min={0} max={10000} value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: Number(event.target.value) })} /></label><label>资料文件（PDF/DOCX）<input type="file" accept=".pdf,.docx" disabled={pending} onChange={(event) => void upload(event.target.files?.[0])} /></label><p>文件标识：{form.fileId || '尚未上传'}</p><button type="button" disabled={pending || !form.key || !form.title || !form.fileId} onClick={() => void save()}>{editing ? '保存修改并转为未发布' : '保存资料草稿'}</button></div>
    {items.length === 0 ? <p>暂无资料。</p> : <table><thead><tr><th>标题</th><th>范围</th><th>排序</th><th>状态</th><th>操作</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{item.title}</td><td>{item.accessScope}</td><td>{item.sortOrder}</td><td>{item.active ? '已发布' : '草稿/已下线'}</td><td><button type="button" disabled={pending || previewing !== null} onClick={() => void preview(item)}>{previewing === item.id ? '正在预览' : '预览文件'}</button><button type="button" disabled={pending || previewing !== null} onClick={() => edit(item)}>编辑</button><button type="button" disabled={pending || previewing !== null} onClick={() => void publish(item)}>{item.active ? '下线' : '发布'}</button></td></tr>)}</tbody></table>}
  </section>
}
