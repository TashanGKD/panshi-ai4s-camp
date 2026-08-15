import { useCallback, useEffect, useState } from 'react'
import type { AdminClient, AdminResource, AdminResourceInput } from '../api/admin-client'

const empty: AdminResourceInput = { key: '', title: '', description: null, fileId: '', accessScope: 'public', sortOrder: 0 }

export function ResourcesPage({ client }: { client: AdminClient }) {
  const [items, setItems] = useState<AdminResource[]>([])
  const [form, setForm] = useState<AdminResourceInput>(empty)
  const [editing, setEditing] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const load = useCallback(async () => { const response = await client.listResources(); setItems(response.data.resources) }, [client])
  useEffect(() => { void load().catch(() => setMessage('资料列表加载失败')) }, [load])
  const upload = async (file?: File) => {
    if (!file) return
    setPending(true); setMessage('')
    try { const response = await client.uploadResourceFile(file, form.accessScope); setForm((current) => ({ ...current, fileId: response.data.file.id })); setMessage('文件已上传，请保存配置') }
    catch { setMessage('文件上传失败') } finally { setPending(false) }
  }
  const save = async () => {
    setPending(true); setMessage('')
    try {
      if (editing) await client.updateResource(editing, form); else await client.createResource(form)
      setEditing(null); setForm(empty); await load(); setMessage('资料草稿已保存，请确认后发布')
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败') } finally { setPending(false) }
  }
  const edit = (item: AdminResource) => { setEditing(item.id); setForm({ key: item.key, title: item.title, description: item.description, fileId: item.fileId, accessScope: item.accessScope, sortOrder: item.sortOrder }) }
  const publish = async (item: AdminResource) => { setPending(true); try { await client.publishResource(item.id, !item.active); await load() } catch { setMessage('发布状态更新失败') } finally { setPending(false) } }
  return <section><header className="admin-page-header"><div><h1>相关资料</h1><p>上传资料、设置访问范围并发布；隐藏或删除底层文件后下载会立即失效。</p></div></header>
    {message ? <p role="status">{message}</p> : null}
    <div className="content-editor"><label>标识<input value={form.key} maxLength={80} onChange={(event) => setForm({ ...form, key: event.target.value })} /></label><label>标题<input value={form.title} maxLength={200} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label>说明<textarea value={form.description ?? ''} maxLength={1000} onChange={(event) => setForm({ ...form, description: event.target.value || null })} /></label><label>访问范围<select value={form.accessScope} onChange={(event) => setForm({ ...form, accessScope: event.target.value as AdminResourceInput['accessScope'], fileId: '' })}><option value="public">公开</option><option value="authenticated">登录学员</option><option value="admitted">已录取学员</option></select></label><label>排序<input type="number" min={0} max={10000} value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: Number(event.target.value) })} /></label><label>资料文件（PDF/DOCX）<input type="file" accept=".pdf,.docx" disabled={pending} onChange={(event) => void upload(event.target.files?.[0])} /></label><p>文件标识：{form.fileId || '尚未上传'}</p><button type="button" disabled={pending || !form.key || !form.title || !form.fileId} onClick={() => void save()}>{editing ? '保存修改并转为未发布' : '保存资料草稿'}</button></div>
    {items.length === 0 ? <p>暂无资料。</p> : <table><thead><tr><th>标题</th><th>范围</th><th>排序</th><th>状态</th><th>操作</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{item.title}</td><td>{item.accessScope}</td><td>{item.sortOrder}</td><td>{item.active ? '已发布' : '草稿/已下线'}</td><td><button type="button" disabled={pending} onClick={() => edit(item)}>编辑</button><button type="button" disabled={pending} onClick={() => void publish(item)}>{item.active ? '下线' : '发布'}</button></td></tr>)}</tbody></table>}
  </section>
}
