import { useState } from 'react'
export function BulkStatusDialog({ count, targetStatus, pending, onCancel, onConfirm }: { count: number, targetStatus: string, pending: boolean, onCancel: () => void, onConfirm: () => Promise<void> }) {
  const [confirmed, setConfirmed] = useState(false)
  return <div role="dialog" aria-modal="true" aria-labelledby="bulk-title" className="admin-dialog"><h2 id="bulk-title">确认批量调整状态</h2><p>将对已选择的 <strong>{count}</strong> 份报名调整为“{targetStatus}”。每份报名将独立校验。</p><label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />我已核对人数和目标状态</label><div className="admin-actions"><button type="button" onClick={onCancel} disabled={pending}>取消</button><button type="button" disabled={!confirmed || pending} onClick={() => void onConfirm()}>{pending ? '处理中' : `确认处理 ${count} 份`}</button></div></div>
}
